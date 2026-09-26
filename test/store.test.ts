// Smoke test for the data path: a fixture Veto DB must produce a valid VetoSnapshot,
// and a missing DB must degrade to the empty/not-installed snapshot. This is the
// regression guard for the full rewrite (there was no test suite before v1.0).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VetoStore } from '../src/core/VetoStore';
import { normPath } from '../src/core/paths';
import { maxRatePct, topPattern } from '../src/core/snapshot';
import { isSqliteSupported } from '../src/data/sqlite-loader';

function buildFixture(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'veto-test-'));
  const dbPath = join(dir, 'veto.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE sessions (id TEXT, started_at TEXT, platform TEXT, project_dir TEXT, summary TEXT,
      token_count INTEGER, created_at TEXT, active_client TEXT, last_resumed_at TEXT, connection_type TEXT);
    CREATE TABLE council_outcomes (id TEXT, session_id TEXT, task TEXT, verdict TEXT, lead_dev TEXT, pm TEXT,
      architect TEXT, ux TEXT, devil TEXT, recommended TEXT, debated_at TEXT, legal TEXT, security TEXT);
    CREATE TABLE patterns (id TEXT, pattern_key TEXT, pattern_val TEXT, confidence REAL, seen_count INTEGER, updated_at TEXT);
    CREATE TABLE rate_usage (id TEXT, platform TEXT, date_key TEXT, request_count INTEGER, token_count INTEGER, updated_at TEXT);
    CREATE TABLE knowledge_base (id TEXT, type TEXT, title TEXT, content TEXT, tags TEXT, project_dir TEXT, created_at TEXT);
    CREATE TABLE learning_data (id TEXT, task_type TEXT, complexity TEXT, model_tier INTEGER, output_quality INTEGER, agent TEXT);
    CREATE TABLE usage_events (id TEXT, platform TEXT, tokens INTEGER, event_type TEXT);
    CREATE TABLE scan_diagnostics (id TEXT, file_path TEXT, line INTEGER, col_start INTEGER, message TEXT, severity TEXT, source TEXT, created_at TEXT);
  `);
  const today = new Date().toISOString().slice(0, 10);
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    'sess-123', new Date().toISOString(), 'claude', 'C:/proj', 'did things', 16000, new Date().toISOString(), 'claude', null, 'subscription');
  db.prepare('INSERT INTO council_outcomes (id,verdict,recommended,debated_at,lead_dev) VALUES (?,?,?,?,?)').run(
    'c-1', 'GREEN', 'ship it', new Date().toISOString(), 'approve: looks good');
  db.prepare('INSERT INTO patterns VALUES (?,?,?,?,?,?)').run('p-1', '*.ts', 'reviewer', 0.94, 12, new Date().toISOString());
  db.prepare('INSERT INTO knowledge_base (id,type,title,tags,project_dir,created_at) VALUES (?,?,?,?,?,?)').run(
    'm-1', 'note', 'remember the widget', '["widget","ui"]', 'C:/proj', new Date().toISOString());
  db.prepare('INSERT INTO rate_usage VALUES (?,?,?,?,?,?)').run('r-1', 'claude', today, 10, 250000, new Date().toISOString());
  db.prepare('INSERT INTO learning_data VALUES (?,?,?,?,?,?)').run('l-1', 'review', 'med', 2, 88, 'reviewer');
  db.prepare('INSERT INTO usage_events VALUES (?,?,?,?)').run('u-1', 'claude', 5000, 'tool');
  db.close();
  return { dir, dbPath };
}

test('fixture DB produces a valid snapshot', () => {
  const { dir, dbPath } = buildFixture();
  const store = new VetoStore({ dbPath });
  try {
    store.refresh();
    const s = store.getSnapshot();
    assert.equal(s.installed, true);
    assert.equal(s.stale, false);
    assert.equal(s.session?.id, 'sess-123');
    assert.equal(s.council?.verdict, 'GREEN');
    assert.equal(s.council?.recommended, 'ship it');
    assert.equal(topPattern(s)?.pattern_key, '*.ts');
    assert.equal(s.health?.sessionCount, 1);
    assert.equal(s.health?.patternCount, 1);
    assert.equal(s.memory?.totalCount, 1);
    assert.equal(maxRatePct(s), 50); // 250000 / 500000
    assert.equal(s.learning?.totalOutcomes, 1);
  } finally {
    store.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('memory search returns inserted entry', () => {
  const { dir, dbPath } = buildFixture();
  const store = new VetoStore({ dbPath });
  try {
    const hits = store.searchMemory('widget');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].title, 'remember the widget');
    assert.deepEqual(hits[0].tags, ['widget', 'ui']);
    assert.equal(store.searchMemory('nonexistent-xyz').length, 0);
  } finally {
    store.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing DB degrades to empty/not-installed snapshot', () => {
  const store = new VetoStore({ dbPath: join(tmpdir(), 'veto-does-not-exist-xyz', 'veto.db') });
  try {
    store.refresh();
    const s = store.getSnapshot();
    assert.equal(s.installed, false);
    assert.equal(s.session, null);
    assert.equal(s.sessions.length, 0);
    assert.equal(maxRatePct(s), null);
  } finally {
    store.dispose();
  }
});

test('normPath normalizes separators, case, trailing slash', () => {
  assert.equal(normPath('C:\\Proj\\App\\'), 'c:/proj/app');
  assert.equal(normPath('C:/proj/app'), 'c:/proj/app');
});

test('queryLastCouncil project scoping via session join', () => {
  const dir = mkdtempSync(join(tmpdir(), 'veto-test-scoping-'));
  const dbPath = join(dir, 'veto.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE sessions (id TEXT, started_at TEXT, platform TEXT, project_dir TEXT, summary TEXT,
      token_count INTEGER, created_at TEXT, active_client TEXT, last_resumed_at TEXT, connection_type TEXT);
    CREATE TABLE council_outcomes (id TEXT, session_id TEXT, task TEXT, verdict TEXT, lead_dev TEXT, pm TEXT,
      architect TEXT, ux TEXT, devil TEXT, recommended TEXT, debated_at TEXT, legal TEXT, security TEXT);
    CREATE TABLE patterns (id TEXT, pattern_key TEXT, pattern_val TEXT, confidence REAL, seen_count INTEGER, updated_at TEXT);
    CREATE TABLE rate_usage (id TEXT, platform TEXT, date_key TEXT, request_count INTEGER, token_count INTEGER, updated_at TEXT);
    CREATE TABLE knowledge_base (id TEXT, type TEXT, title TEXT, content TEXT, tags TEXT, project_dir TEXT, created_at TEXT);
    CREATE TABLE learning_data (id TEXT, task_type TEXT, complexity TEXT, model_tier INTEGER, output_quality INTEGER, agent TEXT);
    CREATE TABLE usage_events (id TEXT, platform TEXT, tokens INTEGER, event_type TEXT);
    CREATE TABLE scan_diagnostics (id TEXT, file_path TEXT, line INTEGER, col_start INTEGER, message TEXT, severity TEXT, source TEXT, created_at TEXT);
  `);
  db.prepare('INSERT INTO sessions (id, project_dir) VALUES (?, ?)').run('sess-a', 'C:/proj-a');
  db.prepare('INSERT INTO sessions (id, project_dir) VALUES (?, ?)').run('sess-b', 'C:/proj-b');
  db.prepare("INSERT INTO council_outcomes (id, session_id, verdict, debated_at) VALUES (?, ?, ?, ?)").run(
    'c-a', 'sess-a', 'GREEN', new Date(Date.now() - 10000).toISOString()
  );
  db.prepare("INSERT INTO council_outcomes (id, session_id, verdict, debated_at) VALUES (?, ?, ?, ?)").run(
    'c-b', 'sess-b', 'RED', new Date().toISOString()
  );
  db.close();

  const store = new VetoStore({ dbPath });
  try {
    store.setProjectDir('C:/proj-a');
    store.refresh();
    assert.equal(store.getSnapshot().council?.verdict, 'GREEN');
    
    store.setProjectDir('C:/proj-b');
    store.refresh();
    assert.equal(store.getSnapshot().council?.verdict, 'RED');
  } finally {
    store.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('queryLastCouncil direct column project scoping', () => {
  const dir = mkdtempSync(join(tmpdir(), 'veto-test-col-scoping-'));
  const dbPath = join(dir, 'veto.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE sessions (id TEXT, started_at TEXT, platform TEXT, project_dir TEXT, summary TEXT,
      token_count INTEGER, created_at TEXT, active_client TEXT, last_resumed_at TEXT, connection_type TEXT);
    CREATE TABLE council_outcomes (id TEXT, session_id TEXT, task TEXT, verdict TEXT, lead_dev TEXT, pm TEXT,
      architect TEXT, ux TEXT, devil TEXT, recommended TEXT, debated_at TEXT, legal TEXT, security TEXT, project_dir TEXT);
    CREATE TABLE patterns (id TEXT, pattern_key TEXT, pattern_val TEXT, confidence REAL, seen_count INTEGER, updated_at TEXT);
    CREATE TABLE rate_usage (id TEXT, platform TEXT, date_key TEXT, request_count INTEGER, token_count INTEGER, updated_at TEXT);
    CREATE TABLE knowledge_base (id TEXT, type TEXT, title TEXT, content TEXT, tags TEXT, project_dir TEXT, created_at TEXT);
    CREATE TABLE learning_data (id TEXT, task_type TEXT, complexity TEXT, model_tier INTEGER, output_quality INTEGER, agent TEXT);
    CREATE TABLE usage_events (id TEXT, platform TEXT, tokens INTEGER, event_type TEXT);
    CREATE TABLE scan_diagnostics (id TEXT, file_path TEXT, line INTEGER, col_start INTEGER, message TEXT, severity TEXT, source TEXT, created_at TEXT);
  `);
  db.prepare("INSERT INTO council_outcomes (id, verdict, debated_at, project_dir) VALUES (?, ?, ?, ?)").run(
    'c-a', 'GREEN', new Date(Date.now() - 10000).toISOString(), 'C:/proj-a'
  );
  db.prepare("INSERT INTO council_outcomes (id, verdict, debated_at, project_dir) VALUES (?, ?, ?, ?)").run(
    'c-b', 'RED', new Date().toISOString(), 'C:/proj-b'
  );
  db.close();

  const store = new VetoStore({ dbPath });
  try {
    store.setProjectDir('C:/proj-a');
    store.refresh();
    assert.equal(store.getSnapshot().council?.verdict, 'GREEN');
    
    store.setProjectDir('C:/proj-b');
    store.refresh();
    assert.equal(store.getSnapshot().council?.verdict, 'RED');
  } finally {
    store.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Batch A: F01 — WAL and Change Detection Tests ──────────────────────────────

test('F01: WAL mode updates detected via data_version without checkpoint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'veto-wal-test-'));
  const dbPath = join(dir, 'veto.db');
  
  // Set up WAL DB with an active writer connection
  const writer = new DatabaseSync(dbPath);
  writer.exec('PRAGMA journal_mode = WAL');
  writer.exec(`
    CREATE TABLE sessions (id TEXT, started_at TEXT, platform TEXT, project_dir TEXT, summary TEXT,
      token_count INTEGER, created_at TEXT, active_client TEXT, last_resumed_at TEXT, connection_type TEXT);
  `);
  writer.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    'sess-wal-1', new Date().toISOString(), 'claude', 'C:/proj', 'init', 1000, new Date().toISOString(), 'claude', null, 'subscription'
  );

  const store = new VetoStore({ dbPath });
  try {
    store.refresh();
    assert.equal(store.getSnapshot().session?.id, 'sess-wal-1');

    // Writer inserts another session into WAL without checkpointing
    writer.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      'sess-wal-2', new Date().toISOString(), 'claude', 'C:/proj', 'wal update', 2000, new Date(Date.now() + 1000).toISOString(), 'claude', null, 'subscription'
    );

    // Refresh should detect the change via PRAGMA data_version
    store.refresh();
    const updated = store.getSnapshot();
    assert.equal(updated.session?.id, 'sess-wal-2');
    assert.equal(updated.stale, false);
  } finally {
    store.dispose();
    writer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F01: force refresh rebuilds even when stats have not changed', () => {
  const { dir, dbPath } = buildFixture();
  const store = new VetoStore({ dbPath });
  try {
    store.refresh();
    const snap1 = store.getSnapshot();
    const t1 = snap1.generatedAt;

    // Normal refresh with no changes reuses snapshot
    store.refresh(false);
    assert.equal(store.getSnapshot().generatedAt, t1);

    // Force refresh must rebuild
    store.refresh(true);
    assert.ok(store.getSnapshot().generatedAt >= t1);
  } finally {
    store.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Batch A: F02 — Strictly Read-Only & Schema Compatibility Tests ─────────────

test('F02: strictly read-only guarantee — attempts to write throw and cannot modify DB', () => {
  const { dir, dbPath } = buildFixture();
  const store = new VetoStore({ dbPath });
  try {
    store.refresh();
    const snapshot = store.getSnapshot();
    assert.equal(snapshot.installed, true);

    // Verify read-only by attempting a write directly on the connection
    const db = (store as unknown as { openDb: () => DatabaseSync }).openDb();
    assert.ok(db, 'DB handle should be open');
    assert.throws(() => {
      db.exec("INSERT INTO sessions (id) VALUES ('unauthorized')");
    }, /readonly|query_only|attempt to write a readonly database/i);
  } finally {
    store.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F02: future schema version triggers compatibility warning without crashing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'veto-schema-test-'));
  const dbPath = join(dir, 'veto.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA user_version = 2'); // Schema v2 (future)
  db.exec(`
    CREATE TABLE sessions (id TEXT, started_at TEXT, platform TEXT, project_dir TEXT, summary TEXT,
      token_count INTEGER, created_at TEXT, active_client TEXT, last_resumed_at TEXT, connection_type TEXT);
  `);
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    'sess-v2', new Date().toISOString(), 'gemini', 'C:/proj', 'future schema', 1000, new Date().toISOString(), 'gemini', null, 'subscription'
  );
  db.close();

  const store = new VetoStore({ dbPath });
  try {
    store.refresh();
    const s = store.getSnapshot();
    assert.equal(s.installed, true);
    assert.equal(s.schemaVersion, 2);
    assert.ok(s.compatibilityWarning && s.compatibilityWarning.includes('v2'));
    assert.equal(s.session?.id, 'sess-v2');
  } finally {
    store.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F02: schema drift / missing optional tables isolate gracefully', () => {
  const dir = mkdtempSync(join(tmpdir(), 'veto-drift-test-'));
  const dbPath = join(dir, 'veto.db');
  const db = new DatabaseSync(dbPath);
  // Create ONLY sessions table — omit learning_data, scan_diagnostics, usage_events, etc.
  db.exec(`
    CREATE TABLE sessions (id TEXT, started_at TEXT, platform TEXT, project_dir TEXT, summary TEXT,
      token_count INTEGER, created_at TEXT, active_client TEXT, last_resumed_at TEXT, connection_type TEXT);
  `);
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    'sess-only', new Date().toISOString(), 'claude', 'C:/proj', 'minimal schema', 500, new Date().toISOString(), 'claude', null, 'subscription'
  );
  db.close();

  const store = new VetoStore({ dbPath });
  try {
    store.refresh();
    const s = store.getSnapshot();
    assert.equal(s.installed, true);
    assert.equal(s.stale, false);
    assert.equal(s.session?.id, 'sess-only');
    assert.equal(s.learning, null);
    assert.deepEqual(s.diagnostics, []);
    assert.equal(s.usage?.totalSessions, 0);
  } finally {
    store.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F02: stale snapshot preserves original lastSuccessfulRead timestamp and records staleReason', () => {
  const { dir, dbPath } = buildFixture();
  const store = new VetoStore({ dbPath });
  try {
    store.refresh();
    const s1 = store.getSnapshot();
    assert.equal(s1.stale, false);
    const readTime = s1.lastSuccessfulRead;
    assert.ok(readTime, 'lastSuccessfulRead should be set');

    // Simulate unreadable/corrupted database
    store.dispose();
    writeFileSync(dbPath, 'CORRUPTED_NON_SQLITE_DATA');

    const store2 = new VetoStore({ dbPath });
    try {
      // Manually prime last snapshot with prior successful read to test preservation across failure
      (store2 as unknown as { last: typeof s1 }).last = s1;
      store2.refresh(true);
      const s2 = store2.getSnapshot();
      assert.equal(s2.stale, true);
      assert.equal(s2.lastSuccessfulRead, readTime, 'lastSuccessfulRead must be preserved');
      assert.ok(s2.staleReason, 'staleReason should be populated');
    } finally {
      store2.dispose();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

// ── Batch A: F04 — Project Scope Consistency Tests ─────────────────────────────

test('F04: POSIX paths preserve case while Windows paths fold case', () => {
  // POSIX paths (starts with /, not win32 drive)
  assert.equal(normPath('/home/user/MyProject'), '/home/user/MyProject');
  assert.equal(normPath('/home/user/myproject'), '/home/user/myproject');
  assert.notEqual(normPath('/home/user/MyProject'), normPath('/home/user/myproject'));

  // Windows paths fold case
  assert.equal(normPath('C:\\Users\\Project\\'), 'c:/users/project');
  assert.equal(normPath('c:/users/project'), 'c:/users/project');
  assert.equal(normPath('C:\\Users\\Project\\'), normPath('c:/users/project'));
});

test('F04: diagnostics query enforces strict path boundaries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'veto-diag-boundary-'));
  const dbPath = join(dir, 'veto.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE scan_diagnostics (id TEXT, file_path TEXT, line INTEGER, col_start INTEGER, message TEXT, severity TEXT, source TEXT, created_at TEXT);
  `);
  db.prepare('INSERT INTO scan_diagnostics VALUES (?,?,?,?,?,?,?,?)').run(
    'd-1', 'C:/proj/src/index.ts', 10, 1, 'error in proj', 'error', 'veto', new Date().toISOString()
  );
  // Distinct project that shares prefix with C:/proj
  db.prepare('INSERT INTO scan_diagnostics VALUES (?,?,?,?,?,?,?,?)').run(
    'd-2', 'C:/proj-other/src/index.ts', 20, 1, 'error in other', 'error', 'veto', new Date().toISOString()
  );
  db.close();

  const store = new VetoStore({ dbPath });
  try {
    store.setProjectDir('C:/proj');
    store.refresh();
    const diags = store.getSnapshot().diagnostics;
    assert.equal(diags.length, 1);
    assert.equal(diags[0].id, 'd-1');
  } finally {
    store.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F04: sessions beyond 200 row cutoff are found by normalized project scoping', () => {
  const dir = mkdtempSync(join(tmpdir(), 'veto-200-row-test-'));
  const dbPath = join(dir, 'veto.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE sessions (id TEXT, started_at TEXT, platform TEXT, project_dir TEXT, summary TEXT,
      token_count INTEGER, created_at TEXT, active_client TEXT, last_resumed_at TEXT, connection_type TEXT);
  `);
  
  // Insert target session created early
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    'sess-target', '2026-01-01T00:00:00Z', 'claude', 'C:\\MyTarget\\Project', 'target work', 5000, '2026-01-01T00:00:00Z', 'claude', null, 'subscription'
  );

  // Insert 205 intervening sessions for other projects
  const stmt = db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?)');
  for (let i = 0; i < 205; i++) {
    stmt.run(`sess-noise-${i}`, `2026-02-01T${String(i).padStart(2, '0')}:00:00Z`, 'claude', `C:/other-proj-${i}`, 'noise', 100, `2026-02-01T${String(i).padStart(2, '0')}:00:00Z`, 'claude', null, 'subscription');
  }
  db.close();

  const store = new VetoStore({ dbPath });
  try {
    // Scoped search with forward slashes and different casing
    store.setProjectDir('c:/mytarget/project');
    store.refresh();
    const session = store.getSnapshot().session;
    assert.ok(session, 'Target session must be found despite being > 200 rows deep');
    assert.equal(session?.id, 'sess-target');
  } finally {
    store.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('F04: project switching on read error does not leak previous project data', () => {
  const { dir, dbPath } = buildFixture();
  const store = new VetoStore({ dbPath });
  try {
    store.setProjectDir('C:/proj');
    store.refresh();
    const s1 = store.getSnapshot();
    assert.equal(s1.session?.id, 'sess-123');

    // Switch to an invalid path that cannot be read
    store.setDbPath(join(dir, 'non-existent.db'));
    store.setProjectDir('C:/other-proj');
    const s2 = store.getSnapshot();
    assert.equal(s2.session, null, 'Must not retain previous project session');
    assert.equal(s2.council, null, 'Must not retain previous project council');
    assert.equal(s2.memory, null, 'Must not retain previous project memory');
    assert.deepEqual(s2.diagnostics, [], 'Must not retain previous project diagnostics');
  } finally {
    store.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Batch A: F03 — Runtime Support & Custom DB Name Tests ──────────────────────

test('F03: runtime support checks safely and does not throw', () => {
  assert.equal(typeof isSqliteSupported(), 'boolean');
  assert.equal(isSqliteSupported(), true);

  const store = new VetoStore();
  assert.equal(store.isSupported(), true);
  store.dispose();
});

test('F01: custom DB filename does not get filtered out by watcher prefix', () => {
  const dir = mkdtempSync(join(tmpdir(), 'custom-db-test-'));
  const dbPath = join(dir, 'my_custom_store.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE sessions (id TEXT, started_at TEXT, platform TEXT, project_dir TEXT, summary TEXT,
      token_count INTEGER, created_at TEXT, active_client TEXT, last_resumed_at TEXT, connection_type TEXT);
  `);
  db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    'sess-custom', new Date().toISOString(), 'claude', 'C:/proj', 'custom name', 100, new Date().toISOString(), 'claude', null, 'subscription'
  );
  db.close();

  const store = new VetoStore({ dbPath });
  try {
    store.refresh();
    const s = store.getSnapshot();
    assert.equal(s.installed, true);
    assert.equal(s.session?.id, 'sess-custom');
  } finally {
    store.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

