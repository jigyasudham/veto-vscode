// VetoStore — the single source of truth for Veto state in the extension.
//
// Owns ONE long-lived read-only SQLite connection (no per-query open/close churn),
// detects DB changes via a debounced fs.watch + a slow interval fallback, and emits
// a typed VetoSnapshot. On any read failure (DB locked mid-WAL-write, transient I/O)
// it returns the last-good snapshot instead of throwing, so the UI never blanks.
//
// UI-agnostic on purpose (no vscode import) — keeps the data path unit-testable.

import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync, watch as fsWatch, type FSWatcher } from 'node:fs';
import { dirname } from 'node:path';
import { getDbPath, setDbPath, readTokenBudgets } from './paths';
import { emptySnapshot, type VetoSnapshot, type VetoMemoryEntry } from './snapshot';
import {
  queryLatestSession, querySessions, queryMemory, searchMemory, queryLastCouncil,
  queryTopPatterns, queryRate, queryUsage, queryHealth, queryLearning, queryDiagnostics,
} from '../data/queries';

export type Disposable = { dispose: () => void };
type Listener = (snap: VetoSnapshot) => void;

export interface VetoStoreOptions {
  dbPath?: string;
  pollIntervalMs?: number;
  log?: (msg: string) => void;
}

export class VetoStore {
  private db: DatabaseSync | null = null;
  private projectDir: string | undefined;
  private pollIntervalMs: number;
  private readonly log: (msg: string) => void;

  private last: VetoSnapshot = emptySnapshot(false);
  private listeners = new Set<Listener>();

  private watcher: FSWatcher | null = null;
  private watchDebounce: ReturnType<typeof setTimeout> | undefined;
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private lastSize = -1;
  private lastMtimeMs = -1;

  constructor(opts: VetoStoreOptions = {}) {
    if (opts.dbPath) setDbPath(opts.dbPath);
    this.pollIntervalMs = Math.max(1000, opts.pollIntervalMs ?? 5000);
    this.log = opts.log ?? (() => {});
  }

  // ── Subscription ───────────────────────────────────────────────────────────
  onChange(listener: Listener): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  private emit(): void {
    for (const l of this.listeners) {
      try { l(this.last); } catch (e) { this.log(`listener error: ${errMsg(e)}`); }
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────
  start(): void {
    this.startWatcher();
    this.intervalId = setInterval(() => this.refresh(), this.pollIntervalMs);
    this.refresh();
  }

  setProjectDir(dir: string | undefined): void {
    this.projectDir = dir;
    this.refresh();
  }

  setDbPath(p: string | undefined): void {
    setDbPath(p ?? '');
    this.closeDb();
    this.startWatcher();
    this.refresh();
  }

  setPollInterval(ms: number): void {
    const next = Math.max(1000, ms);
    if (next === this.pollIntervalMs) return;
    this.pollIntervalMs = next;
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => this.refresh(), this.pollIntervalMs);
  }

  getSnapshot(): VetoSnapshot {
    return this.last;
  }

  getDbPath(): string {
    return getDbPath();
  }

  /** One-off memory search (own try/catch — never throws to the caller). */
  searchMemory(query: string): VetoMemoryEntry[] {
    const db = this.openDb();
    if (!db) return [];
    try {
      return searchMemory(db, query.trim());
    } catch (e) {
      this.log(`searchMemory error: ${errMsg(e)}`);
      this.closeDb();
      return [];
    }
  }

  // ── Change detection ─────────────────────────────────────────────────────────
  private startWatcher(): void {
    this.watcher?.close();
    this.watcher = null;
    const dir = dirname(getDbPath());
    if (!existsSync(dir)) return;
    try {
      this.watcher = fsWatch(dir, { persistent: false }, (_event, filename) => {
        if (filename && !filename.toString().startsWith('veto')) return;
        clearTimeout(this.watchDebounce);
        this.watchDebounce = setTimeout(() => this.refresh(), 150);
      });
      this.watcher.on('error', () => { this.watcher = null; });
    } catch { /* dir not watchable — interval fallback covers it */ }
  }

  /** Cheap stat-based dirty check so polls that change nothing don't rebuild the snapshot. */
  private changedSinceLast(): boolean {
    try {
      const st = statSync(getDbPath());
      const changed = st.size !== this.lastSize || st.mtimeMs !== this.lastMtimeMs;
      this.lastSize = st.size;
      this.lastMtimeMs = st.mtimeMs;
      return changed;
    } catch {
      return true; // can't stat — let the read attempt decide
    }
  }

  // ── Snapshot building ─────────────────────────────────────────────────────────
  refresh(): void {
    const next = this.build();
    this.last = next;
    this.emit();
  }

  private build(): VetoSnapshot {
    if (!existsSync(getDbPath())) {
      this.closeDb();
      this.lastSize = -1; this.lastMtimeMs = -1;
      return emptySnapshot(false);
    }

    // Nothing changed since the last successful read → reuse it (cheap path).
    if (!this.changedSinceLast() && this.last.installed && !this.last.stale) {
      return this.last;
    }

    const db = this.openDb();
    if (!db) return staleCopy(this.last);

    try {
      const budgets = readTokenBudgets();
      const snap: VetoSnapshot = {
        installed: true,
        session:     queryLatestSession(db, this.projectDir),
        sessions:    querySessions(db),
        council:     queryLastCouncil(db),
        patterns:    queryTopPatterns(db),
        rate:        queryRate(db, budgets),
        usage:       queryUsage(db),
        health:      queryHealth(db, getDbPath()),
        learning:    queryLearning(db),
        memory:      queryMemory(db, this.projectDir),
        diagnostics: queryDiagnostics(db),
        generatedAt: Date.now(),
        stale: false,
      };
      return snap;
    } catch (e) {
      // DB locked mid-write / transient error → drop the connection and serve last-good.
      this.log(`snapshot build error (serving last-good): ${errMsg(e)}`);
      this.closeDb();
      return staleCopy(this.last);
    }
  }

  // ── Connection management ─────────────────────────────────────────────────────
  private openDb(): DatabaseSync | null {
    if (this.db) return this.db;
    try {
      // read-only so we can never mutate Veto's DB; falls back if the flag is unsupported.
      try {
        this.db = new DatabaseSync(getDbPath(), { open: true, readOnly: true } as ConstructorParameters<typeof DatabaseSync>[1]);
      } catch {
        this.db = new DatabaseSync(getDbPath(), { open: true });
      }
      return this.db;
    } catch (e) {
      this.log(`DB open error: ${errMsg(e)}`);
      this.db = null;
      return null;
    }
  }

  private closeDb(): void {
    try { this.db?.close(); } catch { /* already closed */ }
    this.db = null;
  }

  dispose(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    clearTimeout(this.watchDebounce);
    this.watcher?.close();
    this.closeDb();
    this.listeners.clear();
  }
}

function staleCopy(snap: VetoSnapshot): VetoSnapshot {
  return { ...snap, stale: true, generatedAt: Date.now() };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
