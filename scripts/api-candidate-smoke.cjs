// Explicit opt-in acceptance against a built backend; never uses the user's DB.
// node scripts/api-candidate-smoke.cjs <path/to/cli.js>
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { gzipSync } = require('node:zlib');
const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { buildSync } = require('esbuild');

const cli = path.resolve(process.argv[2] || '');
assert.ok(process.argv[2] && fs.existsSync(cli), 'Supply a built cli.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veto-api-consumer-'));
const project = path.join(root, 'project');
const other = path.join(root, 'other');
for (const dir of [project, other, path.join(root, 'transcripts')]) fs.mkdirSync(dir, { recursive: true });
process.env.VETO_TEST_DB = path.join(root, 'veto.db');
process.env.VETO_CONFIG_PATH = path.join(root, 'config.json');
process.env.VETO_TRANSCRIPTS_DIR = path.join(root, 'transcripts');
process.env.VETO_TRANSCRIPTS_DB = path.join(root, 'transcripts', 'index.db');
fs.writeFileSync(process.env.VETO_CONFIG_PATH, JSON.stringify({ transcripts: { enabled: false, consent_version: 1 } }));
new DatabaseSync(process.env.VETO_TEST_DB).close();

function load(file, overrides = {}) {
  const code = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vscode'] }).outputFiles[0].text;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(id => overrides[id] || require(id), module, module.exports);
  return module.exports;
}

const MIGRATIONS = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS archives (
        id                  TEXT PRIMARY KEY,
        source              TEXT NOT NULL DEFAULT 'claude',
        source_session_id   TEXT NOT NULL,
        project_dir         TEXT,
        veto_session_id     TEXT,
        archive_path        TEXT NOT NULL,
        content_sha256      TEXT NOT NULL,
        source_bytes        INTEGER NOT NULL DEFAULT 0,
        archive_bytes       INTEGER NOT NULL DEFAULT 0,
        source_format_hint  TEXT,
        parser_version      INTEGER NOT NULL DEFAULT 0,
        indexed_through_seq INTEGER NOT NULL DEFAULT 0,
        captured_at         TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        UNIQUE(source, source_session_id)
      );
      CREATE INDEX IF NOT EXISTS idx_archives_project ON archives(project_dir);
      CREATE INDEX IF NOT EXISTS idx_archives_sha     ON archives(content_sha256);
      CREATE TABLE IF NOT EXISTS session_map (
        source            TEXT NOT NULL DEFAULT 'claude',
        source_session_id TEXT NOT NULL,
        transcript_path   TEXT NOT NULL,
        project_dir       TEXT,
        last_seen_at      TEXT NOT NULL,
        PRIMARY KEY (source, source_session_id)
      );
      CREATE INDEX IF NOT EXISTS idx_session_map_project ON session_map(project_dir);
    `,
  },
  {
    version: 2,
    up: `
      CREATE TABLE IF NOT EXISTS events (
        id                TEXT PRIMARY KEY,
        archive_id        TEXT NOT NULL,
        source_session_id TEXT NOT NULL,
        seq               INTEGER NOT NULL,
        line_index        INTEGER NOT NULL,
        block_index       INTEGER NOT NULL DEFAULT 0,
        kind              TEXT NOT NULL,
        source_type       TEXT,
        role              TEXT,
        tool_name         TEXT,
        text              TEXT,
        secret_count      INTEGER NOT NULL DEFAULT 0,
        event_uuid        TEXT,
        parent_uuid       TEXT,
        is_sidechain      INTEGER NOT NULL DEFAULT 0,
        ts_source         TEXT,
        ts_utc            TEXT,
        raw_offset        INTEGER NOT NULL DEFAULT 0,
        raw_length        INTEGER NOT NULL DEFAULT 0,
        UNIQUE(archive_id, seq),
        FOREIGN KEY (archive_id) REFERENCES archives(id)
      );
      CREATE INDEX IF NOT EXISTS idx_events_archive ON events(archive_id, seq);
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(source_session_id);
      CREATE INDEX IF NOT EXISTS idx_events_kind    ON events(kind);
    `,
  },
  {
    version: 3,
    up: `
      CREATE TABLE IF NOT EXISTS search_docs (
        id                INTEGER PRIMARY KEY,
        event_id          TEXT NOT NULL UNIQUE,
        archive_id        TEXT NOT NULL,
        source_session_id TEXT NOT NULL,
        project_dir       TEXT,
        seq               INTEGER NOT NULL,
        kind              TEXT NOT NULL,
        len               INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_search_docs_archive ON search_docs(archive_id);
      CREATE INDEX IF NOT EXISTS idx_search_docs_scope ON search_docs(project_dir, source_session_id);
      CREATE TABLE IF NOT EXISTS search_terms (
        id   INTEGER PRIMARY KEY,
        term TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS search_postings (
        term_id INTEGER NOT NULL,
        doc_id  INTEGER NOT NULL,
        tf      INTEGER NOT NULL,
        PRIMARY KEY (term_id, doc_id)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS idx_postings_doc ON search_postings(doc_id);
    `,
  },
  {
    version: 4,
    up: `
      CREATE TABLE IF NOT EXISTS search_vectors (
        doc_id      INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        vec         BLOB NOT NULL,
        norm        REAL NOT NULL,
        PRIMARY KEY (doc_id, chunk_index)
      );
      ALTER TABLE archives ADD COLUMN chunker_version INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE archives ADD COLUMN embed_model TEXT;
    `,
  },
];

const index = new DatabaseSync(process.env.VETO_TRANSCRIPTS_DB);
for (const migration of MIGRATIONS) index.exec(`${migration.up}\nPRAGMA user_version=${migration.version}`);
const fixture = fs.readFileSync(path.resolve(__dirname, '../test/fixtures/codex-sample.jsonl'), 'utf8');
for (const dir of [project, other]) {
  const session = randomUUID(), archive = randomUUID();
  const raw = fixture.replaceAll('CODEXA', session);
  const gz = path.join(root, 'transcripts', `${archive}.gz`);
  fs.writeFileSync(gz, gzipSync(raw));
  index.prepare('INSERT INTO archives (id,source,source_session_id,project_dir,archive_path,content_sha256,captured_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(archive, 'codex', session, dir.toLowerCase(), gz, createHash('sha256').update(raw).digest('hex'), new Date().toISOString(), new Date().toISOString());
}
index.close();

const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fingerprint = () => Object.fromEntries(fs.readdirSync(root, { recursive: true }).map(p => path.join(root, p)).filter(p => fs.statSync(p).isFile() && !/-(wal|shm)$/.test(p)).map(p => [p, hash(p)]));
let selectedProject = project, selectedDb = process.env.VETO_TEST_DB, snapshot;
const commands = new Map(), docs = [], errors = [];
const token = { isCancellationRequested: false, onCancellationRequested() { return { dispose() {} }; } };
const vscode = {
  ProgressLocation: { Notification: 1 },
  workspace: { isTrusted: true, getConfiguration: () => ({ get: () => cli }), openTextDocument: async doc => doc },
  window: {
    withProgress: async (_, callback) => callback({}, token), showTextDocument: async doc => docs.push(doc.content),
    showErrorMessage: message => errors.push(message), showWarningMessage: message => errors.push(message),
    showInputBox: async () => 'deploy.ts key',
    showQuickPick: async items => typeof items[0] === 'string' ? 'All sources' : items[0],
  },
  commands: { registerCommand: (id, callback) => { commands.set(id, callback); return { dispose() {} }; } },
};
const { registerBackendCommands } = load(path.resolve('src/commands/backend.ts'), { vscode });
registerBackendCommands({ subscriptions: [] }, { getProjectDir: () => selectedProject, getDbPath: () => selectedDb, showSnapshot: value => { snapshot = value; } });
const { spawnProcess } = load(path.resolve('src/commands/process.ts'));
const { parseApiEnvelope } = load(path.resolve('src/core/backend.ts'));
async function call(command, input) {
  return parseApiEnvelope(await spawnProcess('node', [cli, 'api', ...command.split(' '), '--stdin'], undefined, { input: JSON.stringify(input), timeoutMs: 60000 }), command, input.project);
}

async function main() {
  const before = fingerprint();
  await commands.get('veto.backendVisibility')();
  assert.deepEqual(errors, []);
  assert.equal(snapshot.backend_version, '3.8.0');
  assert.equal(snapshot.data.transcripts.archives_in_project, 1);
  assert.equal(snapshot.data.transcripts.capture, 'disabled');
  assert.deepEqual(fingerprint(), before, 'snapshot is passive');

  // Execute the real HUD renderer with the live snapshot in a minimal DOM.
  class Element {
    children = []; textContent = ''; style = {}; dataset = {}; classList = { add() {}, toggle() {} };
    appendChild(child) { this.children.push(child); return child; } setAttribute() {} addEventListener() {}
  }
  const roots = new Map(['notInstalled','verdict','stale','cards'].map(id => [id, new Element()]));
  const { emptySnapshot } = load(path.resolve('src/core/snapshot.ts'));
  const state = { ...emptySnapshot(true), backend: snapshot };
  const messages = [];
  vm.runInNewContext(fs.readFileSync('src/ui/assets/hud.js', 'utf8') + '\nrender(snapshot);', {
    snapshot: state, acquireVsCodeApi: () => ({ getState: () => ({}), setState() {}, postMessage: m => messages.push(m) }),
    document: { activeElement: {}, getElementById: id => roots.get(id), createElement: () => new Element(), createTextNode: text => Object.assign(new Element(), { textContent: text }), addEventListener() {} },
    window: { addEventListener() {} },
  });
  const flatten = n => [n.textContent, ...n.children.flatMap(flatten)];
  const rendered = [...roots.values()].flatMap(flatten).join('\n');
  assert.match(rendered, /3\.8\.0/); assert.match(rendered, /disabled/); assert.deepEqual(messages, []);

  await commands.get('veto.searchTranscripts')();
  assert.deepEqual(errors, []);
  assert.match(docs.at(-1), /Veto recall expand/);
  assert.ok(!docs.at(-1).includes('AKIA1234567890ABCDEF'), 'fake key is masked');

  const found = await call('recall search', { project: other, db: selectedDb, query: 'deploy.ts key', limit: 20 });
  assert.equal(found.state, 'ok');
  const expandedBefore = fingerprint();
  const crossed = await call('recall expand', { project, db: selectedDb, event_id: found.data.hits[0].event_id });
  assert.equal(crossed.state, 'not_found');
  assert.deepEqual(fingerprint(), expandedBefore, 'expansion is passive');

  assert.equal((await call('recall search', { project, db: selectedDb, query: 'zzznomatch987', limit: 20 })).state, 'no_match');
  assert.equal((await call('recall search', { project: path.join(root, 'absent'), db: selectedDb, query: 'x' })).state, 'no_archive');

  selectedDb = path.join(root, 'wrong.db');
  await commands.get('veto.backendVisibility')();
  assert.equal(snapshot.state, 'db_mismatch');
  assert.match(errors.pop() || '', /Veto database mismatch/);

  selectedDb = process.env.VETO_TEST_DB;
  await commands.get('veto.backendDiagnostics')();
  assert.deepEqual(errors, []);
  assert.match(docs.at(-1), /not_checked/);

  console.log('PASS acceptance against published package: version handshake, real command handlers, live HUD card rendering, search/result selection/expansion, masking, project isolation, passive snapshot/expand, db mismatch, no-match/no-archive, diagnostics.');
  console.log(`Synthetic fixture retained at ${root}. UI interactions are mocked; this is not a packaged VS Code host test.`);
}

main().catch(error => { console.error(error); console.error(`Fixture: ${root}`); process.exitCode = 1; });
