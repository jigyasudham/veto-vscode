// VetoStore — the single source of truth for Veto state in the extension.
//
// Owns ONE long-lived strictly read-only SQLite connection (never writable fallback),
// detects DB changes via a debounced fs.watch + PRAGMA data_version / WAL tracking,
// and emits a typed VetoSnapshot. On read failures (DB locked mid-WAL-write, transient I/O)
// it returns the last-good snapshot with preserved read timestamps and stale reasons.
//
// UI-agnostic on purpose (no vscode import) — keeps the data path unit-testable.

import { existsSync, statSync, watch as fsWatch, type FSWatcher } from 'node:fs';
import { dirname, basename } from 'node:path';
import { loadSqlite, isSqliteSupported, type DatabaseSync } from '../data/sqlite-loader';
import { getDbPath, setDbPath, readTokenBudgets, pathsEqual } from './paths';
import { emptySnapshot, type VetoSnapshot, type VetoMemoryEntry, type DetailScope } from './snapshot';
import {
  queryLatestSession, querySessions, queryMemory, searchMemory, queryLastCouncil,
  queryTopPatterns, queryRate, queryUsage, queryHealth, queryLearning, queryDiagnostics,
  querySchemaVersion, querySessionPage, queryMemoryPage, queryMemoryDetail, queryCouncilPage, queryConstraints, queryDecisionPage,
} from '../data/queries';

export type Disposable = { dispose: () => void };
type Listener = (snap: VetoSnapshot) => void;

export interface VetoStoreOptions {
  dbPath?: string;
  pollIntervalMs?: number;
  log?: (msg: string) => void;
  /** Injectable sources keep midnight/config invalidation deterministic in tests. */
  readBudgets?: () => Record<string, number>;
  dateKey?: () => string;
}

export class VetoStore {
  private db: DatabaseSync | null = null;
  private projectDir: string | undefined;
  private pollIntervalMs: number;
  private readonly log: (msg: string) => void;
  private readonly readBudgets: () => Record<string, number>;
  private readonly dateKey: () => string;
  private lastBudgets = '';
  private dbIdentity = '';

  private last: VetoSnapshot = emptySnapshot(false);
  private listeners = new Set<Listener>();

  private watcher: FSWatcher | null = null;
  private watchDebounce: ReturnType<typeof setTimeout> | undefined;
  private intervalId: ReturnType<typeof setInterval> | undefined;

  // Change tracking state
  private lastDbSize = -1;
  private lastDbMtimeMs = -1;
  private lastWalSize = -1;
  private lastWalMtimeMs = -1;
  private lastDataVersion = -1;
  private lastDateKey = '';
  private isDirty = false;
  private lastProjectDir: string | undefined = undefined;

  constructor(opts: VetoStoreOptions = {}) {
    if (opts.dbPath) setDbPath(opts.dbPath);
    this.pollIntervalMs = Math.max(1000, opts.pollIntervalMs ?? 5000);
    this.log = opts.log ?? (() => {});
    this.readBudgets = opts.readBudgets ?? readTokenBudgets;
    this.dateKey = opts.dateKey ?? (() => new Date().toISOString().slice(0, 10));
  }

  isSupported(): boolean {
    return isSqliteSupported();
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
    this.intervalId = setInterval(() => this.refresh(false), this.pollIntervalMs);
    this.refresh(false);
  }

  setProjectDir(dir: string | undefined): void {
    if (pathsEqual(this.projectDir, dir)) return;
    this.projectDir = dir;
    this.refresh(true);
  }

  setDbPath(p: string | undefined): void {
    setDbPath(p ?? '');
    this.closeDb();
    this.resetStats();
    this.last = emptySnapshot(false);
    this.startWatcher();
    this.refresh(true);
  }

  setPollInterval(ms: number): void {
    const next = Math.max(1000, ms);
    if (next === this.pollIntervalMs) return;
    this.pollIntervalMs = next;
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => this.refresh(false), this.pollIntervalMs);
  }

  getSnapshot(): VetoSnapshot {
    return this.last;
  }

  getDbPath(): string {
    return getDbPath();
  }

  /** Detail reads are explicit and fail visibly; never substitute another project's cached data. */
  private readDetail<T>(read: (db: DatabaseSync) => T): T {
    const db = this.openDb();
    if (!db) throw new Error('Veto database is unavailable or cannot be opened read-only.');
    return read(db);
  }

  sessionPage(scope: DetailScope, offset = 0, search = '') {
    return this.readDetail(db => querySessionPage(db, scope, offset, 30, search));
  }
  memoryPage(scope: DetailScope, offset = 0, search = '') {
    return this.readDetail(db => queryMemoryPage(db, scope, offset, search));
  }
  memoryDetail(scope: DetailScope, id: string) {
    return this.readDetail(db => queryMemoryDetail(db, scope, id));
  }
  councilPage(scope: DetailScope, offset = 0, search = '') {
    return this.readDetail(db => queryCouncilPage(db, scope, offset, search));
  }
  constraintPage(scope: DetailScope, offset = 0, search = '') {
    return this.readDetail(db => queryConstraints(db, scope, offset, search));
  }
  decisionPage(scope: DetailScope, offset = 0, search = '') {
    return this.readDetail(db => queryDecisionPage(db, scope, offset, search));
  }
  reviewDetails(scope: DetailScope) {
    return this.readDetail(db => queryDiagnostics(db, 'projectDir' in scope ? scope.projectDir : undefined));
  }
  learningDetails() {
    return this.readDetail(db => ({ learning: queryLearning(db), patterns: queryTopPatterns(db) }));
  }

  /** One-off memory search (own try/catch — never throws to the caller). */
  searchMemory(query: string, projectDir?: string): VetoMemoryEntry[] {
    const db = this.openDb();
    if (!db) return [];
    try {
      return searchMemory(db, query.trim(), projectDir ?? this.projectDir);
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
    const dbPath = getDbPath();
    const dir = dirname(dbPath);
    if (!existsSync(dir)) return;

    const baseName = basename(dbPath);

    try {
      this.watcher = fsWatch(dir, { persistent: false }, (_event, filename) => {
        if (filename) {
          const str = filename.toString();
          // Watch the configured database file and its sidecars (-wal, -shm)
          if (![baseName, `${baseName}-wal`, `${baseName}-shm`].includes(str)) return;
        }
        this.isDirty = true;
        clearTimeout(this.watchDebounce);
        this.watchDebounce = setTimeout(() => this.refresh(false), 150);
      });
      this.watcher.on('error', () => { this.watcher = null; });
    } catch { /* dir not watchable — interval fallback covers it */ }
  }

  private resetStats(): void {
    this.lastDbSize = -1;
    this.lastDbMtimeMs = -1;
    this.lastWalSize = -1;
    this.lastWalMtimeMs = -1;
    this.lastDataVersion = -1;
    this.isDirty = false;
  }

  /**
   * Fast check for external database changes:
   * 1. Day rollover (rate_usage date_key changes at UTC midnight)
   * 2. Main DB file stat changes
   * 3. WAL file stat changes
   * 4. Connection-local PRAGMA data_version (increments on other-connection commits)
   */
  private changedSinceLast(): boolean {
    const today = this.dateKey();
    if (this.lastDateKey && this.lastDateKey !== today) {
      return true;
    }

    const dbPath = getDbPath();
    try {
      const st = statSync(dbPath);
      if (st.size !== this.lastDbSize || st.mtimeMs !== this.lastDbMtimeMs) {
        this.lastDbSize = st.size;
        this.lastDbMtimeMs = st.mtimeMs;
        return true;
      }
    } catch {
      return true;
    }

    const walPath = `${dbPath}-wal`;
    try {
      if (existsSync(walPath)) {
        const wst = statSync(walPath);
        if (wst.size !== this.lastWalSize || wst.mtimeMs !== this.lastWalMtimeMs) {
          this.lastWalSize = wst.size;
          this.lastWalMtimeMs = wst.mtimeMs;
          return true;
        }
      } else if (this.lastWalSize !== -1) {
        this.lastWalSize = -1;
        this.lastWalMtimeMs = -1;
        return true;
      }
    } catch {
      // WAL stat error ignored
    }

    if (this.db) {
      try {
        const row = this.db.prepare('PRAGMA data_version').get() as { data_version?: number } | undefined;
        const ver = row?.data_version ?? -1;
        if (ver !== -1 && ver !== this.lastDataVersion) {
          this.lastDataVersion = ver;
          return true;
        }
      } catch {
        return true;
      }
    }

    return false;
  }

  // ── Snapshot building ─────────────────────────────────────────────────────────
  refresh(force = false): void {
    const next = this.build(force);
    if (next === this.last) return;
    this.last = next;
    this.emit();
  }

  private build(force = false): VetoSnapshot {
    if (!isSqliteSupported()) {
      return {
        ...emptySnapshot(false),
        compatibilityWarning: 'node:sqlite is not supported in this runtime environment.',
      };
    }

    const dbPath = getDbPath();
    if (!this.watcher && this.intervalId) this.startWatcher();
    if (!existsSync(dbPath)) {
      this.closeDb();
      this.resetStats();
      this.lastProjectDir = undefined;
      return { ...emptySnapshot(false), projectDir: this.projectDir };
    }

    const projectDirChanged = !pathsEqual(this.projectDir, this.lastProjectDir);
    this.checkDbIdentity();
    const budgets = this.readBudgets();
    const budgetsKey = JSON.stringify(budgets);

    if (!force && !this.isDirty && !projectDirChanged && budgetsKey === this.lastBudgets && !this.changedSinceLast() && this.last.installed && !this.last.stale) {
      return this.last;
    }
    this.isDirty = false;

    const db = this.openDb();
    if (!db) {
      return this.createStaleSnapshot('Database could not be opened in read-only mode.', projectDirChanged);
    }

    try {
      // Verify basic database readability; throws if corrupt or unreadable
      db.prepare('SELECT 1 FROM sqlite_master LIMIT 1').get();

      const schemaVersion = querySchemaVersion(db);
      let compatibilityWarning: string | undefined = undefined;
      if (schemaVersion > 1) {
        compatibilityWarning = `Veto DB schema v${schemaVersion} is newer than extension read contract v1. Some fields may degrade.`;
      }

      const warnings: string[] = [];
      const section = <T>(name: string, read: () => T, fallback: T): T => {
        try { return read(); }
        catch (error) {
          const message = `${name} unavailable: ${errMsg(error)}`;
          warnings.push(message);
          this.log(message);
          return fallback;
        }
      };

      // Read transaction for point-in-time cross-table consistency
      let inTx = false;
      try {
        db.exec('BEGIN DEFERRED');
        inTx = true;
      } catch { /* proceed without tx if busy */ }

      let snap: VetoSnapshot;
      try {
        snap = {
          installed: true,
          projectDir: this.projectDir,
          session:     section('Session', () => queryLatestSession(db, this.projectDir), null),
          sessions:    section('Sessions', () => querySessions(db, 10, this.projectDir), []),
          council:     section('Council', () => queryLastCouncil(db, this.projectDir), null),
          patterns:    section('Patterns', () => queryTopPatterns(db), []),
          rate:        section('Rate', () => queryRate(db, budgets, this.dateKey()), []),
          usage:       section('Usage', () => queryUsage(db), null),
          health:      section('Health', () => queryHealth(db, dbPath), null),
          learning:    section('Learning', () => queryLearning(db), null),
          memory:      section('Memory', () => queryMemory(db, this.projectDir), null),
          diagnostics: section('Diagnostics', () => queryDiagnostics(db, this.projectDir), []),
          generatedAt: Date.now(),
          lastSuccessfulRead: Date.now(),
          stale: false,
          staleReason: undefined,
          schemaVersion,
          compatibilityWarning: [compatibilityWarning, ...warnings].filter(Boolean).join('\n') || undefined,
        };
      } finally {
        if (inTx) {
          try { db.exec('COMMIT'); }
          catch (error) { try { db.exec('ROLLBACK'); } catch { /* preserve original failure */ } throw error; }
        }
      }

      try {
        const row = db.prepare('PRAGMA data_version').get() as { data_version?: number } | undefined;
        this.lastDataVersion = row?.data_version ?? -1;
      } catch { /* ignored */ }

      try {
        const st = statSync(dbPath);
        this.lastDbSize = st.size;
        this.lastDbMtimeMs = st.mtimeMs;
      } catch { /* ignored */ }

      const walPath = `${dbPath}-wal`;
      try {
        if (existsSync(walPath)) {
          const wst = statSync(walPath);
          this.lastWalSize = wst.size;
          this.lastWalMtimeMs = wst.mtimeMs;
        } else {
          this.lastWalSize = -1;
          this.lastWalMtimeMs = -1;
        }
      } catch { /* ignored */ }

      this.lastDateKey = this.dateKey();
      this.lastBudgets = budgetsKey;
      this.lastProjectDir = this.projectDir;
      return snap;
    } catch (e) {
      const err = errMsg(e);
      this.log(`snapshot build error (serving last-good): ${err}`);
      this.closeDb();
      return this.createStaleSnapshot(`Database read error: ${err}`, projectDirChanged);
    }
  }

  private createStaleSnapshot(reason: string, projectChanged: boolean): VetoSnapshot {
    const base = this.last.installed ? this.last : emptySnapshot(true);
    const copy: VetoSnapshot = {
      ...base,
      projectDir: this.projectDir,
      stale: true,
      staleReason: reason,
      lastSuccessfulRead: this.last.lastSuccessfulRead ?? (this.last.installed ? this.last.generatedAt : undefined),
      generatedAt: Date.now(),
    };

    // If the project changed but reading failed, do NOT present the previous project's
    // data under the newly selected project. Clear project-scoped fields.
    if (projectChanged) {
      copy.session = null;
      copy.sessions = [];
      copy.council = null;
      copy.memory = null;
      copy.diagnostics = [];
    }

    return copy;
  }

  // ── Connection management ─────────────────────────────────────────────────────
  private openDb(): DatabaseSync | null {
    this.checkDbIdentity();
    if (this.db) return this.db;
    const sqlite = loadSqlite();
    if (!sqlite) return null;

    let dbInstance: DatabaseSync | null = null;
    try {
      // Strictly read-only: never fall back to a writable connection.
      dbInstance = new sqlite.DatabaseSync(getDbPath(), { open: true, readOnly: true });
      dbInstance.exec('PRAGMA query_only = ON');
      dbInstance.exec('PRAGMA busy_timeout = 500');
      this.db = dbInstance;
      return this.db;
    } catch (e) {
      this.log(`DB open error: ${errMsg(e)}`);
      try { dbInstance?.close(); } catch { /* ignore */ }
      this.db = null;
      return null;
    }
  }

  private closeDb(): void {
    try { this.db?.close(); } catch { /* already closed */ }
    this.db = null;
  }

  /** A replaced file requires a new connection even when size/mtime were preserved. */
  private checkDbIdentity(): void {
    let identity = '';
    try {
      const stat = statSync(getDbPath());
      identity = `${getDbPath()}:${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
    } catch { /* removal also invalidates an already-open handle */ }
    if (this.dbIdentity && this.dbIdentity !== identity) {
      this.closeDb();
      this.resetStats();
      this.last = emptySnapshot(false);
    }
    this.dbIdentity = identity;
  }

  dispose(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    clearTimeout(this.watchDebounce);
    this.watcher?.close();
    this.closeDb();
    this.listeners.clear();
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
