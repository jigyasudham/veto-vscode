// Pure read queries against an open node:sqlite handle. No connection management
// here — VetoStore owns the single long-lived connection and passes it in.
// SQL ported from the original db/reader.ts so no working behavior is lost.

import type { DatabaseSync } from 'node:sqlite';
import { statSync } from 'node:fs';
import { normPath, budgetFor } from '../core/paths';
import type {
  VetoSession, VetoSessionSummary, VetoMemoryData, VetoMemoryEntry,
  VetoCouncilOutcome, VetoPattern, VetoRateEntry, VetoUsageSummary,
  VetoHealthStats, VetoLearningStats, ScanDiagnosticRow,
} from '../core/snapshot';

/** Cheap existence check so the extension degrades gracefully on schema drift. */
export function hasTable(db: DatabaseSync, name: string): boolean {
  const rows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).all(name) as Array<{ name: string }>;
  return rows.length > 0;
}

export function queryLatestSession(db: DatabaseSync, projectDir?: string): VetoSession | null {
  if (!projectDir) {
    return (db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 1').get() as VetoSession | undefined) ?? null;
  }
  // Fast path: exact match
  const exact = db.prepare(
    'SELECT * FROM sessions WHERE project_dir = ? ORDER BY created_at DESC LIMIT 1'
  ).get(projectDir) as VetoSession | undefined;
  if (exact) return exact;
  // Normalized fallback: Windows backslash↔slash and drive-letter case differences
  const norm = normPath(projectDir);
  const candidates = db.prepare(
    'SELECT * FROM sessions WHERE project_dir IS NOT NULL ORDER BY created_at DESC LIMIT 200'
  ).all() as unknown as VetoSession[];
  return candidates.find(s => normPath(s.project_dir ?? '') === norm) ?? null;
}

export function querySessions(db: DatabaseSync, limit = 10): VetoSessionSummary[] {
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

export function queryMemory(db: DatabaseSync, projectDir?: string): VetoMemoryData {
  let countRow: { count: number };
  let rows: RawMemory[];
  if (projectDir) {
    countRow = db.prepare('SELECT COUNT(*) as count FROM knowledge_base WHERE project_dir = ?').get(projectDir) as { count: number };
    rows = db.prepare('SELECT id, title, tags, project_dir, type, created_at FROM knowledge_base WHERE project_dir = ? ORDER BY created_at DESC LIMIT 3').all(projectDir) as RawMemory[];
  } else {
    countRow = db.prepare('SELECT COUNT(*) as count FROM knowledge_base').get() as { count: number };
    rows = db.prepare('SELECT id, title, tags, project_dir, type, created_at FROM knowledge_base ORDER BY created_at DESC LIMIT 3').all() as RawMemory[];
  }
  return { totalCount: countRow.count, entries: rows.map(parseMemory), scoped: !!projectDir };
}

export function searchMemory(db: DatabaseSync, query: string): VetoMemoryEntry[] {
  const like = `%${query}%`;
  const rows = db.prepare(
    'SELECT id, title, tags, project_dir, type, created_at FROM knowledge_base WHERE title LIKE ? OR tags LIKE ? ORDER BY created_at DESC LIMIT 20'
  ).all(like, like) as RawMemory[];
  return rows.map(parseMemory);
}

export function queryLastCouncil(db: DatabaseSync): VetoCouncilOutcome | null {
  return (db.prepare('SELECT * FROM council_outcomes ORDER BY debated_at DESC LIMIT 1').get() as VetoCouncilOutcome | undefined) ?? null;
}

export function queryTopPatterns(db: DatabaseSync): VetoPattern[] {
  return db.prepare(
    'SELECT * FROM patterns ORDER BY confidence DESC, seen_count DESC LIMIT 10'
  ).all() as unknown as VetoPattern[];
}

export function queryRate(db: DatabaseSync, budgets: Record<string, number>): VetoRateEntry[] {
  const today = new Date().toISOString().slice(0, 10);
  type RateRow = { platform: string; request_count: number; token_count: number };
  const rows = db.prepare(
    `SELECT platform, COALESCE(request_count, 0) as request_count, COALESCE(token_count, 0) as token_count
     FROM rate_usage WHERE date_key = ?`
  ).all(today) as unknown as RateRow[];
  return rows.map(r => ({ ...r, daily_token_budget: budgetFor(r.platform, budgets) }));
}

export function queryUsage(db: DatabaseSync): VetoUsageSummary {
  type TotalRow = { totalSessions: number; totalTokens: number };
  type PlatformRow = { platform: string; tokens: number };
  const total = db.prepare(
    'SELECT COUNT(*) as totalSessions, COALESCE(SUM(tokens), 0) as totalTokens FROM usage_events'
  ).get() as TotalRow;
  const byPlatform = db.prepare(
    'SELECT platform, COALESCE(SUM(tokens), 0) as tokens FROM usage_events GROUP BY platform ORDER BY tokens DESC'
  ).all() as PlatformRow[];
  return { totalSessions: total.totalSessions, totalTokens: total.totalTokens, byPlatform };
}

export function queryHealth(db: DatabaseSync, dbFilePath: string): VetoHealthStats {
  type CountRow = { c: number };
  const sessionCount  = (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as CountRow).c;
  const memoryCount   = (db.prepare('SELECT COUNT(*) as c FROM knowledge_base').get() as CountRow).c;
  const patternCount  = (db.prepare('SELECT COUNT(*) as c FROM patterns').get() as CountRow).c;
  const learningCount = (db.prepare('SELECT COUNT(*) as c FROM learning_data').get() as CountRow).c;
  const dbSizeMb = Math.round((statSync(dbFilePath).size / 1024 / 1024) * 10) / 10;
  return { sessionCount, memoryCount, patternCount, learningCount, dbSizeMb };
}

export function queryLearning(db: DatabaseSync): VetoLearningStats {
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

export function queryDiagnostics(db: DatabaseSync): ScanDiagnosticRow[] {
  if (!hasTable(db, 'scan_diagnostics')) return [];
  return db.prepare('SELECT * FROM scan_diagnostics ORDER BY file_path, line').all() as unknown as ScanDiagnosticRow[];
}
