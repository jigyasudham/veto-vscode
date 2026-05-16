import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, statSync, readFileSync } from 'node:fs';
import type { VetoSession, VetoMemoryData, VetoMemoryEntry, VetoCouncilOutcome, VetoPattern, VetoRateEntry, VetoUsageSummary, VetoHealthStats, VetoSessionSummary } from '../types';

let dbPath = join(homedir(), '.veto', 'veto.db');
let logger: ((msg: string) => void) | undefined;

export function setDbPath(p: string): void {
  dbPath = p || join(homedir(), '.veto', 'veto.db');
}

export function getDbPath(): string {
  return dbPath;
}

export function setLogger(fn: (msg: string) => void): void {
  logger = fn;
}

function openDb(): DatabaseSync | null {
  if (!existsSync(dbPath)) {
    logger?.(`Veto DB not found at ${dbPath}`);
    return null;
  }
  try {
    return new DatabaseSync(dbPath, { open: true });
  } catch (e) {
    logger?.(`Veto DB open error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export function getLatestSession(): VetoSession | null {
  const db = openDb();
  if (!db) return null;
  try {
    return (db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 1').get() as VetoSession | undefined) ?? null;
  } catch (e) {
    logger?.(`getLatestSession error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    db.close();
  }
}

function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function getLatestSessionForDir(dir: string): VetoSession | null {
  const db = openDb();
  if (!db) return null;
  try {
    // Fast path: exact match
    const exact = db.prepare('SELECT * FROM sessions WHERE project_dir = ? ORDER BY created_at DESC LIMIT 1').get(dir) as VetoSession | undefined;
    if (exact) return exact;
    // Normalized fallback: handles Windows backslash↔forward-slash and drive-letter case differences
    const norm = normPath(dir);
    const candidates = db.prepare(
      'SELECT * FROM sessions WHERE project_dir IS NOT NULL ORDER BY created_at DESC LIMIT 200'
    ).all() as unknown as VetoSession[];
    return candidates.find(s => normPath(s.project_dir ?? '') === norm) ?? null;
  } catch (e) {
    logger?.(`getLatestSessionForDir error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    db.close();
  }
}

export function getMemoryEntries(projectDir?: string): VetoMemoryData | null {
  const db = openDb();
  if (!db) return null;
  try {
    type CountRow = { count: number };
    type RawEntry = { id: string; title: string; tags: string | null; project_dir: string | null; type: string; created_at: string };

    let countRow: CountRow;
    let rows: RawEntry[];

    if (projectDir) {
      countRow = db.prepare('SELECT COUNT(*) as count FROM knowledge_base WHERE project_dir = ?').get(projectDir) as CountRow;
      rows = db.prepare('SELECT id, title, tags, project_dir, type, created_at FROM knowledge_base WHERE project_dir = ? ORDER BY created_at DESC LIMIT 3').all(projectDir) as RawEntry[];
    } else {
      countRow = db.prepare('SELECT COUNT(*) as count FROM knowledge_base').get() as CountRow;
      rows = db.prepare('SELECT id, title, tags, project_dir, type, created_at FROM knowledge_base ORDER BY created_at DESC LIMIT 3').all() as RawEntry[];
    }

    const entries: VetoMemoryEntry[] = rows.map(r => ({
      ...r,
      tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
    }));

    return { totalCount: countRow.count, entries, scoped: !!projectDir };
  } catch (e) {
    logger?.(`getMemoryEntries error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    db.close();
  }
}

export function getLastCouncilOutcome(): VetoCouncilOutcome | null {
  const db = openDb();
  if (!db) return null;
  try {
    return (db.prepare('SELECT * FROM council_outcomes ORDER BY debated_at DESC LIMIT 1').get() as VetoCouncilOutcome | undefined) ?? null;
  } catch (e) {
    logger?.(`getLastCouncilOutcome error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    db.close();
  }
}

export function getTopPatterns(): VetoPattern[] | null {
  const db = openDb();
  if (!db) return null;
  try {
    return db.prepare('SELECT * FROM patterns ORDER BY confidence DESC, seen_count DESC LIMIT 10').all() as unknown as VetoPattern[];
  } catch (e) {
    logger?.(`getTopPatterns error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    db.close();
  }
}

const DEFAULT_BUDGETS: Record<string, number> = {
  claude:  500_000,
  gemini: 1_000_000,
  codex:   200_000,
};

function readTokenBudgets(): Record<string, number> {
  try {
    const configPath = join(homedir(), '.veto', 'config.json');
    if (!existsSync(configPath)) return { ...DEFAULT_BUDGETS };
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as { dailyTokenBudget?: Record<string, number> };
    return {
      claude: raw.dailyTokenBudget?.claude  ?? DEFAULT_BUDGETS.claude,
      gemini: raw.dailyTokenBudget?.gemini  ?? DEFAULT_BUDGETS.gemini,
      codex:  raw.dailyTokenBudget?.codex   ?? DEFAULT_BUDGETS.codex,
    };
  } catch {
    return { ...DEFAULT_BUDGETS };
  }
}

export function getRateStatus(): VetoRateEntry[] | null {
  const db = openDb();
  if (!db) return null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    type RateRow = { platform: string; request_count: number; token_count: number };
    const rows = db.prepare(
      `SELECT platform,
              COALESCE(request_count, 0) as request_count,
              COALESCE(token_count, 0) as token_count
       FROM rate_usage
       WHERE date_key = ?`
    ).all(today) as unknown as RateRow[];
    const budgets = readTokenBudgets();
    return rows.map(r => ({
      ...r,
      daily_token_budget: budgets[r.platform] ?? DEFAULT_BUDGETS[r.platform] ?? 500_000,
    }));
  } catch (e) {
    logger?.(`getRateStatus error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    db.close();
  }
}

export function getUsageSummary(): VetoUsageSummary | null {
  const db = openDb();
  if (!db) return null;
  try {
    type TotalRow = { totalSessions: number; totalTokens: number };
    type PlatformRow = { platform: string; tokens: number };
    const total = db.prepare(
      'SELECT COUNT(*) as totalSessions, COALESCE(SUM(tokens), 0) as totalTokens FROM usage_events'
    ).get() as TotalRow;
    const byPlatform = db.prepare(
      'SELECT platform, COALESCE(SUM(tokens), 0) as tokens FROM usage_events GROUP BY platform ORDER BY tokens DESC'
    ).all() as PlatformRow[];
    return { totalSessions: total.totalSessions, totalTokens: total.totalTokens, byPlatform };
  } catch (e) {
    logger?.(`getUsageSummary error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    db.close();
  }
}

export function getSessions(limit = 10): VetoSessionSummary[] | null {
  const db = openDb();
  if (!db) return null;
  try {
    return db.prepare(
      'SELECT id, platform, active_client, started_at, summary, token_count, project_dir FROM sessions ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as unknown as VetoSessionSummary[];
  } catch (e) {
    logger?.(`getSessions error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    db.close();
  }
}

export type ScanDiagnosticRow = {
  id: string;
  file_path: string;
  line: number;
  col_start: number;
  message: string;
  severity: string;
  source: string;
  created_at: string;
};

export function getScanDiagnostics(): ScanDiagnosticRow[] | null {
  const db = openDb();
  if (!db) return null;
  try {
    // Table may not exist on older DBs
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scan_diagnostics'").all() as Array<{ name: string }>;
    if (tables.length === 0) return [];
    return db.prepare('SELECT * FROM scan_diagnostics ORDER BY file_path, line').all() as unknown as ScanDiagnosticRow[];
  } catch (e) {
    logger?.(`getScanDiagnostics error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    db.close();
  }
}

export function searchMemoryEntries(query: string): VetoMemoryEntry[] | null {
  const db = openDb();
  if (!db) return null;
  try {
    const like = `%${query}%`;
    type RawEntry = { id: string; title: string; tags: string | null; project_dir: string | null; type: string; created_at: string };
    const rows = db.prepare(
      'SELECT id, title, tags, project_dir, type, created_at FROM knowledge_base WHERE title LIKE ? OR tags LIKE ? ORDER BY created_at DESC LIMIT 20'
    ).all(like, like) as RawEntry[];
    return rows.map(r => ({ ...r, tags: r.tags ? (JSON.parse(r.tags) as string[]) : [] }));
  } catch (e) {
    logger?.(`searchMemoryEntries error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    db.close();
  }
}

export type VetoLearningStats = {
  totalOutcomes: number;
  avgQuality: number | null;
  tierBreakdown: { tier: number; count: number; avgQuality: number | null }[];
  topAgents: { agent: string; count: number; avgQuality: number | null }[];
};

export function getLearningStats(): VetoLearningStats | null {
  const db = openDb();
  if (!db) return null;
  try {
    type CountRow = { c: number };
    type AvgRow = { avg: number | null };
    type TierRow = { model_tier: number; count: number; avg_quality: number | null };
    type AgentRow = { agent: string; count: number; avg_quality: number | null };

    const total = (db.prepare('SELECT COUNT(*) as c FROM learning_data').get() as CountRow).c;
    const avgRow = db.prepare(
      'SELECT AVG(output_quality) as avg FROM learning_data WHERE output_quality IS NOT NULL'
    ).get() as AvgRow;
    const tierRows = db.prepare(
      'SELECT model_tier, COUNT(*) as count, AVG(output_quality) as avg_quality FROM learning_data GROUP BY model_tier ORDER BY model_tier'
    ).all() as TierRow[];
    const agentRows = db.prepare(
      'SELECT agent, COUNT(*) as count, AVG(output_quality) as avg_quality FROM learning_data WHERE agent IS NOT NULL GROUP BY agent ORDER BY avg_quality DESC LIMIT 5'
    ).all() as AgentRow[];

    return {
      totalOutcomes: total,
      avgQuality: avgRow.avg !== null ? Math.round(avgRow.avg) : null,
      tierBreakdown: tierRows.map(r => ({
        tier: r.model_tier, count: r.count,
        avgQuality: r.avg_quality !== null ? Math.round(r.avg_quality) : null,
      })),
      topAgents: agentRows.map(r => ({
        agent: r.agent, count: r.count,
        avgQuality: r.avg_quality !== null ? Math.round(r.avg_quality) : null,
      })),
    };
  } catch (e) {
    logger?.(`getLearningStats error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    db.close();
  }
}

export function getHealthStats(): VetoHealthStats | null {
  const db = openDb();
  if (!db) return null;
  try {
    type CountRow = { c: number };
    const sessionCount  = (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as CountRow).c;
    const memoryCount   = (db.prepare('SELECT COUNT(*) as c FROM knowledge_base').get() as CountRow).c;
    const patternCount  = (db.prepare('SELECT COUNT(*) as c FROM patterns').get() as CountRow).c;
    const learningCount = (db.prepare('SELECT COUNT(*) as c FROM learning_data').get() as CountRow).c;
    const dbSizeMb = Math.round((statSync(dbPath).size / 1024 / 1024) * 10) / 10;
    return { sessionCount, memoryCount, patternCount, learningCount, dbSizeMb };
  } catch (e) {
    logger?.(`getHealthStats error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    db.close();
  }
}
