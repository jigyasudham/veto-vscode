// Pure read queries against an open node:sqlite handle. No connection management
// here — VetoStore owns the single long-lived connection and passes it in.
// Adheres strictly to the Veto stable read contract defined in S/src/memory/schema.ts.

import type { DatabaseSync } from 'node:sqlite';
import { statSync, existsSync } from 'node:fs';
import { normPath, budgetFor, isSubpath, sqlPathCondition } from '../core/paths';
import type {
  VetoSession, VetoSessionSummary, VetoMemoryData, VetoMemoryEntry,
  VetoCouncilOutcome, VetoPattern, VetoRateEntry, VetoUsageSummary,
  VetoHealthStats, VetoLearningStats, ScanDiagnosticRow,
} from '../core/snapshot';

/** Cheap existence check so the extension degrades gracefully on schema drift. */
export function hasTable(db: DatabaseSync, name: string): boolean {
  try {
    const rows = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).all(name) as Array<{ name: string }>;
    return rows.length > 0;
  } catch {
    return false;
  }
}

export function hasColumn(db: DatabaseSync, table: string, column: string): boolean {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return info.some(c => c.name === column);
  } catch {
    return false;
  }
}

/** Check PRAGMA user_version to detect schema contract changes. */
export function querySchemaVersion(db: DatabaseSync): number {
  try {
    const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
    return row?.user_version ?? 0;
  } catch {
    return 0;
  }
}

const SESSION_COLS = 'id, platform, active_client, last_resumed_at, connection_type, started_at, summary, project_dir, token_count';

export function queryLatestSession(db: DatabaseSync, projectDir?: string): VetoSession | null {
  if (!hasTable(db, 'sessions')) return null;

  if (!projectDir) {
    return (db.prepare(`SELECT ${SESSION_COLS} FROM sessions ORDER BY created_at DESC LIMIT 1`).get() as VetoSession | undefined) ?? null;
  }

  // Fast path: exact match
  const exact = db.prepare(
    `SELECT ${SESSION_COLS} FROM sessions WHERE project_dir = ? ORDER BY created_at DESC LIMIT 1`
  ).get(projectDir) as VetoSession | undefined;
  if (exact) return exact;

  // Normalized SQL match across slashes and case (unbounded, no 200-row cutoff)
  const cond = sqlPathCondition('project_dir', projectDir);
  const match = db.prepare(
    `SELECT ${SESSION_COLS} FROM sessions WHERE ${cond.sql} ORDER BY created_at DESC LIMIT 1`
  ).get(...cond.params) as VetoSession | undefined;
  return match ?? null;
}

export function querySessions(db: DatabaseSync, limit = 10): VetoSessionSummary[] {
  if (!hasTable(db, 'sessions')) return [];
  return db.prepare(
    'SELECT id, platform, active_client, started_at, summary, token_count, project_dir FROM sessions ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as unknown as VetoSessionSummary[];
}

type RawMemory = { id: string; title: string; tags: string | null; project_dir: string | null; type: string; created_at: string };

function parseMemory(r: RawMemory): VetoMemoryEntry {
  return { ...r, tags: r.tags ? safeTags(r.tags) : [] };
}

function safeTags(raw: string): string[] {
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v as string[] : []; }
  catch { return []; }
}

const MEMORY_COLS = 'id, title, tags, project_dir, type, created_at';

export function queryMemory(db: DatabaseSync, projectDir?: string): VetoMemoryData {
  if (!hasTable(db, 'knowledge_base')) {
    return { totalCount: 0, entries: [], scoped: !!projectDir };
  }

  let countRow: { count: number } | undefined;
  let rows: RawMemory[] = [];

  if (projectDir) {
    const cond = sqlPathCondition('project_dir', projectDir);
    countRow = db.prepare(
      `SELECT COUNT(*) as count FROM knowledge_base WHERE project_dir = ? OR ${cond.sql}`
    ).get(projectDir, ...cond.params) as { count: number } | undefined;

    rows = db.prepare(
      `SELECT ${MEMORY_COLS} FROM knowledge_base WHERE project_dir = ? OR ${cond.sql} ORDER BY created_at DESC LIMIT 3`
    ).all(projectDir, ...cond.params) as RawMemory[];
  } else {
    countRow = db.prepare('SELECT COUNT(*) as count FROM knowledge_base').get() as { count: number } | undefined;
    rows = db.prepare(`SELECT ${MEMORY_COLS} FROM knowledge_base ORDER BY created_at DESC LIMIT 3`).all() as RawMemory[];
  }

  return { totalCount: countRow?.count ?? 0, entries: rows.map(parseMemory), scoped: !!projectDir };
}

export function searchMemory(db: DatabaseSync, query: string, projectDir?: string): VetoMemoryEntry[] {
  if (!hasTable(db, 'knowledge_base')) return [];
  const like = `%${query}%`;

  if (projectDir) {
    const cond = sqlPathCondition('project_dir', projectDir);
    const rows = db.prepare(
      `SELECT ${MEMORY_COLS} FROM knowledge_base WHERE (title LIKE ? OR tags LIKE ?) AND (project_dir = ? OR ${cond.sql}) ORDER BY created_at DESC LIMIT 20`
    ).all(like, like, projectDir, ...cond.params) as RawMemory[];
    return rows.map(parseMemory);
  }

  const rows = db.prepare(
    `SELECT ${MEMORY_COLS} FROM knowledge_base WHERE title LIKE ? OR tags LIKE ? ORDER BY created_at DESC LIMIT 20`
  ).all(like, like) as RawMemory[];
  return rows.map(parseMemory);
}

export function queryLastCouncil(db: DatabaseSync, projectDir?: string): VetoCouncilOutcome | null {
  if (!hasTable(db, 'council_outcomes')) return null;

  const useDirectColumn = hasColumn(db, 'council_outcomes', 'project_dir');
  const projCol = useDirectColumn ? 'project_dir' : 'NULL as project_dir';
  const councilCols = `id, session_id, task, verdict, lead_dev, pm, architect, ux, devil, legal, security, recommended, debated_at, ${projCol}`;

  if (!projectDir) {
    return (db.prepare(`SELECT ${councilCols} FROM council_outcomes ORDER BY debated_at DESC LIMIT 1`).get() as VetoCouncilOutcome | undefined) ?? null;
  }

  if (useDirectColumn) {
    // Exact match
    const exact = db.prepare(
      `SELECT ${councilCols} FROM council_outcomes WHERE project_dir = ? ORDER BY debated_at DESC LIMIT 1`
    ).get(projectDir) as VetoCouncilOutcome | undefined;
    if (exact) return exact;

    // Normalized match in SQL (unbounded)
    const cond = sqlPathCondition('project_dir', projectDir);
    const match = db.prepare(
      `SELECT ${councilCols} FROM council_outcomes WHERE ${cond.sql} ORDER BY debated_at DESC LIMIT 1`
    ).get(...cond.params) as VetoCouncilOutcome | undefined;
    return match ?? null;
  } else {
    // Join on session_id to get project_dir as an interim fallback
    if (!hasTable(db, 'sessions')) return null;

    const joinCols = 'c.id, c.session_id, c.task, c.verdict, c.lead_dev, c.pm, c.architect, c.ux, c.devil, c.legal, c.security, c.recommended, c.debated_at, s.project_dir';
    const exact = db.prepare(`
      SELECT ${joinCols} FROM council_outcomes c
      JOIN sessions s ON c.session_id = s.id
      WHERE s.project_dir = ?
      ORDER BY c.debated_at DESC LIMIT 1
    `).get(projectDir) as VetoCouncilOutcome | undefined;
    if (exact) return exact;

    const cond = sqlPathCondition('s.project_dir', projectDir);
    const match = db.prepare(`
      SELECT ${joinCols} FROM council_outcomes c
      JOIN sessions s ON c.session_id = s.id
      WHERE ${cond.sql}
      ORDER BY c.debated_at DESC LIMIT 1
    `).get(...cond.params) as VetoCouncilOutcome | undefined;
    return match ?? null;
  }
}

export function queryTopPatterns(db: DatabaseSync): VetoPattern[] {
  if (!hasTable(db, 'patterns')) return [];
  return db.prepare(
    'SELECT pattern_key, pattern_val, confidence, seen_count, updated_at FROM patterns ORDER BY confidence DESC, seen_count DESC LIMIT 10'
  ).all() as unknown as VetoPattern[];
}

export function queryRate(db: DatabaseSync, budgets: Record<string, number>): VetoRateEntry[] {
  if (!hasTable(db, 'rate_usage')) return [];
  const today = new Date().toISOString().slice(0, 10);
  type RateRow = { platform: string; request_count: number; token_count: number };
  const rows = db.prepare(
    `SELECT platform, COALESCE(request_count, 0) as request_count, COALESCE(token_count, 0) as token_count
     FROM rate_usage WHERE date_key = ?`
  ).all(today) as unknown as RateRow[];
  return rows.map(r => ({ ...r, daily_token_budget: budgetFor(r.platform, budgets) }));
}

export function queryUsage(db: DatabaseSync): VetoUsageSummary {
  if (!hasTable(db, 'usage_events')) {
    return { totalSessions: 0, totalTokens: 0, byPlatform: [] };
  }
  type TotalRow = { totalSessions: number; totalTokens: number };
  type PlatformRow = { platform: string; tokens: number };
  const total = (db.prepare(
    'SELECT COUNT(*) as totalSessions, COALESCE(SUM(tokens), 0) as totalTokens FROM usage_events'
  ).get() as TotalRow | undefined) ?? { totalSessions: 0, totalTokens: 0 };
  const byPlatform = db.prepare(
    'SELECT platform, COALESCE(SUM(tokens), 0) as tokens FROM usage_events GROUP BY platform ORDER BY tokens DESC'
  ).all() as PlatformRow[];
  return { totalSessions: total.totalSessions, totalTokens: total.totalTokens, byPlatform };
}

export function queryHealth(db: DatabaseSync, dbFilePath: string): VetoHealthStats {
  type CountRow = { c: number };
  const sessionCount  = hasTable(db, 'sessions') ? (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as CountRow).c : 0;
  const memoryCount   = hasTable(db, 'knowledge_base') ? (db.prepare('SELECT COUNT(*) as c FROM knowledge_base').get() as CountRow).c : 0;
  const patternCount  = hasTable(db, 'patterns') ? (db.prepare('SELECT COUNT(*) as c FROM patterns').get() as CountRow).c : 0;
  const learningCount = hasTable(db, 'learning_data') ? (db.prepare('SELECT COUNT(*) as c FROM learning_data').get() as CountRow).c : 0;
  
  let dbSizeMb = 0;
  try {
    if (existsSync(dbFilePath)) {
      dbSizeMb = Math.round((statSync(dbFilePath).size / 1024 / 1024) * 10) / 10;
    }
  } catch {
    dbSizeMb = 0;
  }
  return { sessionCount, memoryCount, patternCount, learningCount, dbSizeMb };
}

export function queryLearning(db: DatabaseSync): VetoLearningStats | null {
  if (!hasTable(db, 'learning_data')) return null;

  type AvgRow = { avg: number | null };
  type TierRow = { model_tier: number; count: number; avg_quality: number | null };
  type AgentRow = { agent: string; count: number; avg_quality: number | null };

  const total = (db.prepare('SELECT COUNT(*) as c FROM learning_data').get() as { c: number }).c;
  const avgRow = db.prepare('SELECT AVG(output_quality) as avg FROM learning_data WHERE output_quality IS NOT NULL').get() as AvgRow;
  const tierRows = db.prepare(
    'SELECT model_tier, COUNT(*) as count, AVG(output_quality) as avg_quality FROM learning_data GROUP BY model_tier ORDER BY model_tier'
  ).all() as TierRow[];
  const agentRows = db.prepare(
    'SELECT agent, COUNT(*) as count, AVG(output_quality) as avg_quality FROM learning_data WHERE agent IS NOT NULL GROUP BY agent ORDER BY avg_quality DESC LIMIT 5'
  ).all() as AgentRow[];

  return {
    totalOutcomes: total,
    avgQuality: avgRow.avg !== null ? Math.round(avgRow.avg) : null,
    tierBreakdown: tierRows.map(r => ({ tier: r.model_tier, count: r.count, avgQuality: r.avg_quality !== null ? Math.round(r.avg_quality) : null })),
    topAgents: agentRows.map(r => ({ agent: r.agent, count: r.count, avgQuality: r.avg_quality !== null ? Math.round(r.avg_quality) : null })),
  };
}

export function queryDiagnostics(db: DatabaseSync, projectDir?: string): ScanDiagnosticRow[] {
  if (!hasTable(db, 'scan_diagnostics')) return [];
  const rows = db.prepare(
    'SELECT id, file_path, line, col_start, message, severity, source, created_at FROM scan_diagnostics ORDER BY file_path, line'
  ).all() as unknown as ScanDiagnosticRow[];

  if (!projectDir) return rows;
  // Apply strict path boundary check so other projects never leak diagnostics
  return rows.filter(r => isSubpath(r.file_path, projectDir));
}
