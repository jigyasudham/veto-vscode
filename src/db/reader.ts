import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import type { VetoSession, VetoMemoryData, VetoMemoryEntry, VetoCouncilOutcome, VetoPattern, VetoRateEntry } from '../types';

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
    return db.prepare('SELECT * FROM patterns ORDER BY confidence DESC, seen_count DESC LIMIT 10').all() as VetoPattern[];
  } catch (e) {
    logger?.(`getTopPatterns error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    db.close();
  }
}

export function getRateStatus(): VetoRateEntry[] | null {
  const db = openDb();
  if (!db) return null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    return db.prepare('SELECT platform, date_key, request_count, updated_at FROM rate_usage WHERE date_key = ?').all(today) as VetoRateEntry[];
  } catch (e) {
    logger?.(`getRateStatus error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    db.close();
  }
}
