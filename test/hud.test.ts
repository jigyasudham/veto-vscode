// Tests for Batch C (F08, F09, F10):
// Webview message validation and allowlisting, pattern filtering, and WAL health stats.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateHudMessage, ALLOWED_HUD_COMMANDS } from '../src/ui/messages';
import { queryTopPatterns, queryHealth, queryUsage } from '../src/data/queries';

test('F08: validateHudMessage permits only allowed Veto commands', () => {
  // Allowed commands
  for (const cmd of ALLOWED_HUD_COMMANDS) {
    const res = validateHudMessage({ type: 'command', command: cmd });
    assert.deepEqual(res, { type: 'command', command: cmd });
  }

  // Unauthorized commands must be rejected
  const malicious = [
    'workbench.action.reloadWindow',
    'vscode.openFolder',
    'veto.someNonexistentAction',
    'exec:rm -rf /',
    '',
  ];
  for (const cmd of malicious) {
    const res = validateHudMessage({ type: 'command', command: cmd });
    assert.equal(res, null, `Command "${cmd}" should have been rejected`);
  }
});

test('F08: validateHudMessage validates and sanitizes resume and copyId messages', () => {
  // Valid resume
  assert.deepEqual(
    validateHudMessage({ type: 'resume', id: 'sess-abc_123', platform: 'claude' }),
    { type: 'resume', id: 'sess-abc_123', platform: 'claude' },
  );

  // Resume with unsafe characters (injection attempt) must be rejected
  assert.equal(validateHudMessage({ type: 'resume', id: 'sess; rm -rf /', platform: 'claude' }), null);
  assert.equal(validateHudMessage({ type: 'resume', id: '../sess', platform: 'claude' }), null);

  // Valid copyId
  assert.deepEqual(
    validateHudMessage({ type: 'copyId', id: 'my-session-title' }),
    { type: 'copyId', id: 'my-session-title' },
  );

  // Overlong copyId
  const overlong = 'a'.repeat(600);
  assert.equal(validateHudMessage({ type: 'copyId', id: overlong }), null);
});

test('F08: validateHudMessage sanitizes search query and preserves requestId for race condition prevention', () => {
  const res = validateHudMessage({ type: 'searchMemory', query: 'auth token', requestId: 42 });
  assert.deepEqual(res, { type: 'searchMemory', query: 'auth token', requestId: 42 });

  // Query length is capped to 256
  const longQuery = 'x'.repeat(300);
  const capped = validateHudMessage({ type: 'searchMemory', query: longQuery, requestId: 1 });
  assert.equal(capped?.query.length, 256);

  // Non-string or null queries are rejected
  assert.equal(validateHudMessage({ type: 'searchMemory', query: 123 }), null);
  assert.equal(validateHudMessage(null), null);
  assert.equal(validateHudMessage('string'), null);
});

test('F09: queryTopPatterns filters out router.* and composed_agent:* configuration records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'veto-pat-test-'));
  const dbPath = join(dir, 'patterns.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE patterns (pattern_key TEXT, pattern_val TEXT, confidence REAL, seen_count INTEGER, updated_at TEXT);
  `);
  // Insert legitimate patterns
  db.prepare('INSERT INTO patterns VALUES (?,?,?,?,?)').run('*.ts', 'reviewer', 0.95, 10, '2026-09-27');
  db.prepare('INSERT INTO patterns VALUES (?,?,?,?,?)').run('*.py', 'tester', 0.90, 8, '2026-09-27');
  
  // Insert internal configuration/routing records
  db.prepare('INSERT INTO patterns VALUES (?,?,?,?,?)').run('router.last_apply_count', '5', 1.0, 1, '2026-09-27');
  db.prepare('INSERT INTO patterns VALUES (?,?,?,?,?)').run('router.tier1_max', '10', 1.0, 1, '2026-09-27');
  db.prepare('INSERT INTO patterns VALUES (?,?,?,?,?)').run('composed_agent:meta', 'runner', 1.0, 1, '2026-09-27');

  const top = queryTopPatterns(db);
  assert.equal(top.length, 2);
  const keys = top.map(p => p.pattern_key);
  assert.ok(keys.includes('*.ts'));
  assert.ok(keys.includes('*.py'));
  assert.ok(!keys.some(k => k.startsWith('router.') || k.startsWith('composed_agent:')));

  db.close();
});

test('F09: queryHealth accounts for WAL sidecar file in database footprint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'veto-health-test-'));
  const dbPath = join(dir, 'test.db');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE test (col TEXT);');
  db.close();

  // Create mock WAL file of 1.5 MB
  const walPath = `${dbPath}-wal`;
  const mockWalBytes = Buffer.alloc(1024 * 1024 * 1.5);
  writeFileSync(walPath, mockWalBytes);

  const readonlyDb = new DatabaseSync(dbPath, { readOnly: true });
  const health = queryHealth(readonlyDb, dbPath);
  readonlyDb.close();

  assert.ok(health.walSizeMb !== undefined);
  assert.equal(health.walSizeMb, 1.5);
  assert.ok(health.dbSizeMb >= 1.5, `Total dbSizeMb (${health.dbSizeMb}) should include WAL storage`);
});

test('F09: queryUsage reports totalEvents accurately alongside totalSessions alias', () => {
  const dir = mkdtempSync(join(tmpdir(), 'veto-usage-test-'));
  const dbPath = join(dir, 'usage.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE usage_events (id TEXT, platform TEXT, tokens INTEGER, event_type TEXT);
  `);
  db.prepare('INSERT INTO usage_events VALUES (?,?,?,?)').run('e1', 'claude', 1500, 'call');
  db.prepare('INSERT INTO usage_events VALUES (?,?,?,?)').run('e2', 'claude', 2500, 'call');
  db.prepare('INSERT INTO usage_events VALUES (?,?,?,?)').run('e3', 'gemini', 1000, 'call');

  const usage = queryUsage(db);
  assert.equal(usage.totalEvents, 3);
  assert.equal(usage.totalSessions, 3); // backward-compatible alias
  assert.equal(usage.totalTokens, 5000);
  assert.equal(usage.byPlatform.length, 2);

  db.close();
});

test('F11: validateHudMessage validates in-extension settings, explorer, actions, and console messages', () => {
  // Resume with target
  assert.deepEqual(
    validateHudMessage({ type: 'resume', id: 'sess-123', platform: 'claude', target: 'console' }),
    { type: 'resume', id: 'sess-123', platform: 'claude', target: 'console' },
  );
  assert.deepEqual(
    validateHudMessage({ type: 'resume', id: 'sess-123', platform: 'gemini', target: 'terminal' }),
    { type: 'resume', id: 'sess-123', platform: 'gemini', target: 'terminal' },
  );

  // Settings
  assert.deepEqual(validateHudMessage({ type: 'getSettings' }), { type: 'getSettings' });
  const validSettings = {
    cliPath: 'd:/cli.js',
    dbPath: 'd:/veto.db',
    pollInterval: 3000,
    actionTimeoutMs: 60000,
  };
  assert.deepEqual(
    validateHudMessage({ type: 'saveSettings', settings: validSettings }),
    { type: 'saveSettings', settings: validSettings },
  );
  // Negative / out of bounds pollInterval clamped
  const clamped = validateHudMessage({ type: 'saveSettings', settings: { pollInterval: 500, actionTimeoutMs: 9999999 } });
  assert.equal(clamped?.settings.pollInterval, 1000);
  assert.equal(clamped?.settings.actionTimeoutMs, 600000);

  // Projects
  assert.deepEqual(validateHudMessage({ type: 'getProjects' }), { type: 'getProjects' });
  assert.deepEqual(
    validateHudMessage({ type: 'selectProject', projectDir: 'D:/repo' }),
    { type: 'selectProject', projectDir: 'D:/repo' },
  );

  // Explorer queries
  for (const kind of ['sessions', 'memory', 'council', 'decisions', 'constraints', 'reviews', 'learning', 'tools', 'agents', 'transcripts']) {
    const res = validateHudMessage({ type: 'queryExplorer', kind, scope: 'project', search: 'auth', offset: 0, requestId: 10 });
    assert.deepEqual(res, { type: 'queryExplorer', kind, scope: 'project', search: 'auth', source: undefined, offset: 0, requestId: 10 });
  }
  // Unknown kind rejected
  assert.equal(validateHudMessage({ type: 'queryExplorer', kind: 'invalid_kind' }), null);

  // Detail queries
  assert.deepEqual(
    validateHudMessage({ type: 'getMemoryDetail', id: 'm123', scope: 'project', requestId: 5 }),
    { type: 'getMemoryDetail', id: 'm123', scope: 'project', requestId: 5 },
  );
  assert.deepEqual(
    validateHudMessage({ type: 'expandTranscript', eventId: 'ev456', requestId: 7 }),
    { type: 'expandTranscript', eventId: 'ev456', requestId: 7 },
  );

  // Actions
  for (const act of ['debate', 'saveCheckpoint', 'reviewFile', 'reviewPR', 'scanSecrets', 'draftCommit', 'draftPR', 'backendDiagnostics', 'setupDiagnostics']) {
    const res = validateHudMessage({ type: 'runAction', action: act, params: { test: true }, requestId: 1 });
    assert.deepEqual(res, { type: 'runAction', action: act, params: { test: true }, requestId: 1 });
  }
  // Unknown action rejected
  assert.equal(validateHudMessage({ type: 'runAction', action: 'dropDatabase' }), null);

  // Control messages
  assert.deepEqual(validateHudMessage({ type: 'cancelAction' }), { type: 'cancelAction', requestId: undefined });
  assert.deepEqual(validateHudMessage({ type: 'clearLog' }), { type: 'clearLog' });
});


test('audit 1.2.0: validator accepts handshake, bounded copyText, detection and correlated cancel/resume', () => {
  assert.deepEqual(validateHudMessage({ type: 'ready' }), { type: 'ready' });
  const text = 'x'.repeat(5000);
  assert.deepEqual(validateHudMessage({ type: 'copyText', text }), { type: 'copyText', text });
  assert.equal(validateHudMessage({ type: 'copyText', text: 'x'.repeat(1_000_001) }), null);
  assert.equal(validateHudMessage({ type: 'copyText', text: 42 }), null);
  assert.deepEqual(validateHudMessage({ type: 'detectCli', requestId: 3 }), { type: 'detectCli', requestId: 3 });
  assert.deepEqual(validateHudMessage({ type: 'detectPr', requestId: -1 }), { type: 'detectPr', requestId: undefined });
  assert.deepEqual(validateHudMessage({ type: 'cancelAction', requestId: 9 }), { type: 'cancelAction', requestId: 9 });
  assert.deepEqual(validateHudMessage({ type: 'resume', id: 's1', platform: 'claude', target: 'console', requestId: 4 }),
    { type: 'resume', id: 's1', platform: 'claude', target: 'console', requestId: 4 });
});
