// Smoke test for the data path: a fixture Veto DB must produce a valid VetoSnapshot,
// and a missing DB must degrade to the empty/not-installed snapshot. This is the
// regression guard for the full rewrite (there was no test suite before v1.0).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VetoStore } from '../src/core/VetoStore';
import { normPath } from '../src/core/paths';
import { maxRatePct, topPattern } from '../src/core/snapshot';

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
