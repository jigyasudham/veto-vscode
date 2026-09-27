import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { querySessionPage, queryMemoryDetail, queryCouncilPage, queryDecisionPage, queryConstraints } from '../src/data/queries';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sessions (id TEXT, platform TEXT, active_client TEXT, started_at TEXT, summary TEXT, token_count INTEGER, project_dir TEXT, created_at TEXT);
    CREATE TABLE knowledge_base (id TEXT, title TEXT, tags TEXT, project_dir TEXT, type TEXT, created_at TEXT, content TEXT);
    CREATE TABLE council_outcomes (id TEXT, session_id TEXT, task TEXT, verdict TEXT, lead_dev TEXT, pm TEXT, architect TEXT, ux TEXT, devil TEXT, legal TEXT, security TEXT, recommended TEXT, debated_at TEXT);
    CREATE TABLE decisions (id TEXT, session_id TEXT, made_at TEXT, decision TEXT, rationale TEXT, council_verdict TEXT, files_affected TEXT, overridden INTEGER);`);
  const insert = db.prepare('INSERT INTO sessions VALUES (?, ?, NULL, ?, ?, 42, ?, ?)');
  for (let n = 0; n < 65; n++) insert.run(`s${String(n).padStart(3, '0')}`, 'codex', '2026-09-27', `Session ${n}`, n % 2 ? 'D:\\Repo' : '/other', '2026-09-27');
  return db;
}

test('session pagination scopes before LIMIT, has stable ties and supports cross-page search', () => {
  const db = fixture();
  try {
    const scope = { projectDir: 'd:/repo' };
    const first = querySessionPage(db, scope);
    const second = querySessionPage(db, scope, 30);
    assert.equal(first.items.length, 30);
    assert.equal(first.hasMore, true);
    assert.equal(second.items.length, 2);
    assert.equal(second.hasMore, false);
    assert.equal(new Set([...first.items, ...second.items].map(row => row.id)).size, 32);
    assert.deepEqual(querySessionPage(db, scope, 0, 30, 'Session 1').items.map(row => row.id), ['s019', 's017', 's015', 's013', 's011', 's001']);
    assert.equal(querySessionPage(db, { all: true }, 0, 100).items.length, 65);
    assert.throws(() => querySessionPage(db, { projectDir: '' }), /Select a project/);
  } finally { db.close(); }
});

test('memory content is only fetched on demand and cannot cross project boundaries by ID', () => {
  const db = fixture();
  try {
    db.prepare('INSERT INTO knowledge_base VALUES (?, ?, ?, ?, ?, ?, ?)').run('m1', 'Title', '["tag"]', '/Repo', 'note', 'now', 'Private content');
    assert.equal(queryMemoryDetail(db, { projectDir: '/repo' }, 'm1'), null);
    assert.equal(queryMemoryDetail(db, { projectDir: '/Repo' }, 'm1')?.content, 'Private content');
    assert.equal(queryMemoryDetail(db, { all: true }, 'm1')?.content, 'Private content');
  } finally { db.close(); }
});

test('council and decisions join saved session project, excluding orphan records from scoped history', () => {
  const db = fixture();
  try {
    const council = db.prepare('INSERT INTO council_outcomes (id, session_id, task, verdict, debated_at) VALUES (?, ?, ?, ?, ?)');
    const decision = db.prepare('INSERT INTO decisions (id, session_id, decision, made_at) VALUES (?, ?, ?, ?)');
    for (const [id, session] of [['one', 's001'], ['other', 's002'], ['orphan', 'deleted']]) {
      council.run(id, session, id, 'YELLOW', 'now');
      decision.run(id, session, id, 'now');
    }
    assert.deepEqual(queryCouncilPage(db, { projectDir: 'D:/Repo' }).items.map(row => row.id), ['one']);
    assert.deepEqual(queryDecisionPage(db, { projectDir: 'D:/Repo' }).items.map(row => row.id), ['one']);
    assert.equal(queryCouncilPage(db, { all: true }).items.length, 3);
    assert.equal(queryDecisionPage(db, { all: true }).items.length, 3);
    assert.throws(() => queryConstraints(db, { projectDir: 'D:/Repo' }), /unavailable/);
  } finally { db.close(); }
});

test('direct council project column takes precedence over session attribution', () => {
  const db = fixture();
  try {
    db.exec('ALTER TABLE council_outcomes ADD COLUMN project_dir TEXT');
    db.prepare('INSERT INTO council_outcomes (id, session_id, project_dir, debated_at) VALUES (?, ?, ?, ?)').run('direct', 's002', 'D:/Repo', 'now');
    assert.equal(queryCouncilPage(db, { projectDir: 'd:/repo' }).items[0]?.id, 'direct');
    assert.equal(queryCouncilPage(db, { projectDir: '/other' }).items.length, 0);
  } finally { db.close(); }
});
