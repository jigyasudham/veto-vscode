// HUD message routing regressions from the 1.2.0 audit. Loads the real src/extension.ts
// with a fake VS Code API, store, HUD, backend, and AI adapter; no subprocess is launched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import * as realProcess from '../src/commands/process';
import { fakeVscode, loadModule, settle } from './helpers/harness';

type Outcome = import('../src/commands/process').ToolOutcome;
const DEFAULT_DB = join(homedir(), '.veto', 'veto.db');
const CLI_JS = resolve('/tools/veto/cli.js');
const DETECTED_CLI = resolve('/npm/node_modules/@jigyasudham/veto/dist/cli.js');

function setup(opts: {
  trusted?: boolean; config?: Record<string, unknown>; dbPath?: string;
  tool?: (o: any) => Promise<Outcome>;
  api?: (command: string, input: any) => Promise<any>;
  spawn?: (cmd: string, args: string[], log?: unknown, o?: any) => Promise<string>;
  detectPr?: (cwd: string) => Promise<string | undefined>;
} = {}) {
  const vs = fakeVscode({ trusted: opts.trusted, config: opts.config });
  const hudCalls: Array<{ method: string; args: any[] }> = [];
  const toolCalls: any[] = [];
  const apiCalls: Array<{ command: string; input: any }> = [];
  const spawned: Array<{ cmd: string; args: string[]; opts: any }> = [];
  const storeCalls: Array<{ method: string; args: any[] }> = [];
  let route!: (msg: any) => void;

  class FakeHud {
    static viewType = 'veto-hud';
    constructor(handler: (m: any) => void) { route = handler; }
  }
  for (const method of ['render', 'setBackendSnapshot', 'postMemoryResults', 'postSettings', 'postProjects', 'postExplorerData',
    'postExplorerDetail', 'postActionStatus', 'postLogEntry', 'clearLogs', 'replayLogs', 'postDetection', 'postScopeChanged']) {
    (FakeHud.prototype as any)[method] = (...args: any[]) => { hudCalls.push({ method, args }); };
  }
  const recordStore = (method: string, value: unknown) => (...args: any[]) => { storeCalls.push({ method, args }); return value; };
  class FakeStore {
    isSupported() { return true; }
    setProjectDir() {} refresh() {} start() {} setDbPath() {} setPollInterval() {} dispose() {}
    onChange() { return { dispose() {} }; }
    getDbPath() { return opts.dbPath ?? DEFAULT_DB; }
    getSnapshot() { return { diagnostics: [], projectDir: 'D:/fixture' }; }
    sessionPage = recordStore('sessionPage', { items: [{ id: 's1' }], hasMore: true });
    memoryPage = recordStore('memoryPage', { items: [], hasMore: false });
    councilPage = recordStore('councilPage', { items: [], hasMore: false });
    decisionPage = recordStore('decisionPage', { items: [], hasMore: false });
    constraintPage = recordStore('constraintPage', { items: [], hasMore: false });
    reviewDetails = recordStore('reviewDetails', [
      { message: 'SQL injection risk', source: 'security', file_path: 'a.ts', line: 1 },
      { message: 'Unused variable', source: 'lint', file_path: 'b.ts', line: 2 },
    ]);
    learningDetails = recordStore('learningDetails', {});
    memoryDetail = recordStore('memoryDetail', null);
    searchMemory = recordStore('searchMemory', []);
  }

  const catalog = JSON.stringify({ tools: [
    { name: 'veto_code_review', description: 'Review code' },
    { name: 'veto_secrets_scan', description: 'Find secrets' },
  ] });
  const ext = loadModule('src/extension.ts', {
    vscode: vs.api,
    './core/VetoStore': { VetoStore: FakeStore },
    './ui/StatusBar': { StatusBar: class { render() {} dispose() {} } },
    './ui/HudView': { HudView: FakeHud },
    './commands': { registerCommands() {} },
    './commands/veto': { runStructuredTool: async (_c: unknown, o: any) => { toolCalls.push(o); return (opts.tool ?? (async () => ({ status: 'completed', output: '{"success":true}', parsed: realProcess.parseToolOutput('{"success":true}') })))(o); } },
    './commands/backend': { registerBackendCommands: () => ({
      refreshSnapshot: async () => undefined,
      callApi: async (command: string, input: any) => { apiCalls.push({ command, input }); return (opts.api ?? (async () => ({ state: 'ok', data: { hits: [] } })))(command, input); },
    }) },
    './commands/process': { ...realProcess,
      spawnProcess: async (cmd: string, args: string[], log?: unknown, o?: any) => { spawned.push({ cmd, args, opts: o }); return (opts.spawn ?? (async () => catalog))(cmd, args, log, o); },
      detectPrUrl: async (cwd: string) => (opts.detectPr ?? (async () => undefined))(cwd),
    },
  });
  const context = { subscriptions: [] as unknown[], workspaceState: { get() { return undefined; }, update: async () => {} }, extension: { packageJSON: { version: '1.2.0' } } };
  ext.activate(context);
  const statuses = () => hudCalls.filter(c => c.method === 'postActionStatus').map(c => c.args[0]);
  const explorer = () => hudCalls.filter(c => c.method === 'postExplorerData').map(c => c.args[0]);
  return { vs, route: (m: any) => route(m), hudCalls, toolCalls, apiCalls, spawned, storeCalls, statuses, explorer };
}

const completed = (output: string): Outcome => ({ status: 'completed', output, verdict: realProcess.parseToolOutput(output).verdict, parsed: realProcess.parseToolOutput(output) });

test('F01: checkpoint reports error, not success, when the tool outcome is an error', async () => {
  const h = setup({ tool: async () => ({ status: 'error', message: 'No verified backend result.' }) });
  h.route({ type: 'runAction', action: 'saveCheckpoint', params: { summary: 'x' }, requestId: 1 });
  await settle();
  const last = h.statuses().at(-1);
  assert.equal(last.status, 'error');
  assert.equal(last.requestId, 1);
  assert.match(last.message, /No verified backend result/);
  const logs = h.hudCalls.filter(c => c.method === 'postLogEntry').map(c => c.args[0].text).join('\n');
  assert.doesNotMatch(logs, /Saved successfully/);
});

test('F01: completed checkpoint reports done with the backend output', async () => {
  const h = setup({ tool: async () => completed('{"success":true,"session_id":"abc"}') });
  h.route({ type: 'runAction', action: 'saveCheckpoint', params: { summary: 'x' }, requestId: 2 });
  await settle();
  const last = h.statuses().at(-1);
  assert.equal(last.status, 'done');
  assert.match(String(last.result), /abc/);
});

test('F01: cancelled and pending outcomes never report done', async () => {
  for (const [outcome, expected] of [[{ status: 'cancelled', message: 'Cancelled.' }, 'cancelled'], [{ status: 'pending', message: 'unfinished', output: '{}' }, 'error']] as const) {
    const h = setup({ tool: async () => outcome as Outcome });
    h.route({ type: 'runAction', action: 'draftCommit', requestId: 3 });
    await settle();
    assert.equal(h.statuses().at(-1).status, expected);
  }
});

test('F01/F17: a completed council result keeps its verdict', async () => {
  const h = setup({ tool: async () => completed('{"final_verdict":"RED","votes":{}}') });
  h.route({ type: 'runAction', action: 'debate', params: { task: 'topic' }, requestId: 4 });
  await settle();
  const last = h.statuses().at(-1);
  assert.equal(last.status, 'done');
  assert.equal(last.verdict, 'RED');
});

test('F01: backend diagnostics with a non-ok state is an error result', async () => {
  const h = setup({ api: async () => ({ state: 'db_mismatch', message: 'different database' }) });
  h.route({ type: 'runAction', action: 'backendDiagnostics', requestId: 5 });
  await settle();
  const last = h.statuses().at(-1);
  assert.equal(last.status, 'error');
  assert.match(last.message, /different database/);
});

test('HUD actions run one at a time and cancel only through their own token', async () => {
  let release!: () => void;
  let token: any;
  const h = setup({ tool: o => { token = o.cancellationToken; return new Promise(resolve => { release = () => resolve({ status: 'cancelled', message: 'Cancelled.' }); }); } });
  h.route({ type: 'runAction', action: 'draftCommit', requestId: 10 });
  await settle();
  h.route({ type: 'runAction', action: 'draftPR', params: { baseBranch: 'main' }, requestId: 11 });
  await settle();
  const rejected = h.statuses().find(s => s.requestId === 11);
  assert.equal(rejected.status, 'error');
  assert.match(rejected.message, /already running/i);
  assert.equal(h.toolCalls.length, 1);
  h.route({ type: 'cancelAction', requestId: 10 });
  assert.equal(token.isCancellationRequested, true);
  release();
  await settle();
  assert.equal(h.statuses().at(-1).status, 'cancelled');
  assert.equal(h.statuses().at(-1).requestId, 10);
});

test('action progress lines are streamed to the HUD console', async () => {
  const h = setup({ tool: async o => { o.onProgress?.('Calling mcp__veto__veto_commit_message'); return completed('{"generation":"complete"}'); } });
  h.route({ type: 'runAction', action: 'draftCommit', requestId: 12 });
  await settle();
  const logs = h.hudCalls.filter(c => c.method === 'postLogEntry').map(c => c.args[0].text);
  assert.ok(logs.some(l => l.includes('Calling mcp__veto__veto_commit_message')));
});

test('F02: restricted workspaces never spawn the CLI from Explorer tools/agents', async () => {
  const h = setup({ trusted: false });
  h.route({ type: 'queryExplorer', kind: 'tools', requestId: 1 });
  h.route({ type: 'queryExplorer', kind: 'agents', requestId: 2 });
  await settle();
  assert.equal(h.spawned.length, 0);
  for (const reply of h.explorer()) assert.match(reply.error, /trust/i);
});

test('Explorer catalog surfaces CLI errors and honors the configured cliPath', async () => {
  const failing = setup({ spawn: async () => { throw new Error('veto exited with code 1'); } });
  failing.route({ type: 'queryExplorer', kind: 'tools', requestId: 1 });
  await settle();
  assert.match(failing.explorer().at(-1).error, /exited with code 1/);

  const configured = setup({ config: { cliPath: CLI_JS } });
  configured.route({ type: 'queryExplorer', kind: 'tools', requestId: 2 });
  await settle();
  assert.equal(configured.spawned[0].cmd, 'node');
  assert.deepEqual(configured.spawned[0].args, [CLI_JS, 'tools', '--json']);
});

test('Explorer search filters tools and reviews, and reaches council/decision queries', async () => {
  const h = setup();
  h.route({ type: 'queryExplorer', kind: 'tools', search: 'secret', requestId: 1 });
  h.route({ type: 'queryExplorer', kind: 'reviews', search: 'injection', requestId: 2 });
  h.route({ type: 'queryExplorer', kind: 'council', search: 'redis', offset: 30, requestId: 3 });
  h.route({ type: 'queryExplorer', kind: 'decisions', search: 'cache', requestId: 4 });
  await settle();
  const byId = (id: number) => h.explorer().find(r => r.requestId === id);
  assert.deepEqual(byId(1).items.map((i: any) => i.name), ['veto_secrets_scan']);
  assert.deepEqual(byId(2).items.map((i: any) => i.message), ['SQL injection risk']);
  assert.deepEqual(h.storeCalls.find(c => c.method === 'councilPage')!.args.slice(1), [30, 'redis']);
  assert.equal(h.storeCalls.find(c => c.method === 'decisionPage')!.args[2], 'cache');
  assert.equal(byId(3).offset, 30);
});

test('F16: transcript search respects the backend limit and surfaces non-ok envelopes', async () => {
  const h = setup({ api: async () => ({ state: 'invalid_request', message: 'limit: Too big' }) });
  h.route({ type: 'queryExplorer', kind: 'transcripts', search: 'auth', requestId: 7 });
  await settle();
  assert.equal(h.apiCalls[0].input.limit, 20);
  assert.match(h.explorer().at(-1).error, /limit: Too big/);

  const empty = setup({ api: async () => ({ state: 'no_archive', message: 'No archive for this project.' }) });
  empty.route({ type: 'queryExplorer', kind: 'transcripts', search: 'auth', requestId: 8 });
  await settle();
  const reply = empty.explorer().at(-1);
  assert.equal(reply.error, undefined);
  assert.match(reply.notice, /No archive/);
});

test('F16: transcript expansion reports non-ok envelopes as errors', async () => {
  const h = setup({ api: async () => ({ state: 'not_found', message: 'Event not found' }) });
  h.route({ type: 'expandTranscript', eventId: 'e1', requestId: 9 });
  await settle();
  const detail = h.hudCalls.filter(c => c.method === 'postExplorerDetail').at(-1)!.args[0];
  assert.equal(detail.detail, null);
  assert.match(detail.error, /Event not found/);
});

test('F07: console resume identifies the client that actually runs it and reports failures', async () => {
  const h = setup({ tool: async () => ({ status: 'error', message: 'Session not found' }) });
  h.route({ type: 'resume', id: 'abc', platform: 'codex', target: 'console', requestId: 21 });
  await settle();
  assert.equal(h.toolCalls[0].input.resuming_as, 'claude');
  const last = h.statuses().at(-1);
  assert.equal(last.status, 'error');
  assert.equal(last.requestId, 21);
});

test('F18: AI workflows refuse to write when the HUD database differs from the backend database', async () => {
  const h = setup({ dbPath: 'D:/fixture/custom.db', api: async () => ({ state: 'db_mismatch', message: 'This Veto uses a different database' }) });
  h.route({ type: 'runAction', action: 'saveCheckpoint', params: { summary: 'x' }, requestId: 30 });
  await settle();
  assert.equal(h.toolCalls.length, 0);
  assert.deepEqual(h.apiCalls[0], { command: 'diagnostics', input: { checks: [], db: 'D:/fixture/custom.db' } });
  const last = h.statuses().at(-1);
  assert.equal(last.status, 'error');
  assert.match(last.message, /custom\.db/);
});

test('F18: matching custom databases and the default database proceed', async () => {
  const matching = setup({ dbPath: 'D:/fixture/custom.db', api: async () => ({ state: 'ok', data: {} }) });
  matching.route({ type: 'runAction', action: 'saveCheckpoint', params: { summary: 'x' }, requestId: 31 });
  await settle();
  assert.equal(matching.toolCalls.length, 1);

  const standard = setup();
  standard.route({ type: 'runAction', action: 'saveCheckpoint', params: { summary: 'x' }, requestId: 32 });
  await settle();
  assert.equal(standard.apiCalls.length, 0);
  assert.equal(standard.toolCalls.length, 1);
});

test('F10: the webview ready handshake sends projects, settings, snapshot, and buffered logs', async () => {
  const h = setup();
  h.hudCalls.length = 0;
  h.route({ type: 'ready' });
  await settle();
  const methods = h.hudCalls.map(c => c.method);
  for (const m of ['postProjects', 'postSettings', 'render', 'replayLogs']) assert.ok(methods.includes(m), m);
  const projects = h.hudCalls.find(c => c.method === 'postProjects')!.args[0];
  assert.ok(projects.some((p: any) => p.path === 'D:/fixture'));
});

test('F03: CLI auto-detect resolves an absolute cli.js from the installed backend', async () => {
  const version = JSON.stringify({ contract: 1, command: 'version', backend_version: '3.8.0', generated_at: '2026-09-28T00:00:00Z', state: 'ok',
    data: { contract: 1, commands: ['version'], request_via: ['stdin'], cli_path: DETECTED_CLI } });
  const h = setup({ spawn: async () => version });
  h.route({ type: 'detectCli', requestId: 1 });
  await settle();
  assert.deepEqual(h.spawned[0].args, ['api', 'version', '--stdin']);
  const reply = h.hudCalls.find(c => c.method === 'postDetection')!.args;
  assert.deepEqual(reply, ['cli', { value: DETECTED_CLI }, 1]);

  const untrusted = setup({ trusted: false });
  untrusted.route({ type: 'detectCli', requestId: 2 });
  await settle();
  assert.equal(untrusted.spawned.length, 0);
  assert.match(untrusted.hudCalls.find(c => c.method === 'postDetection')!.args[1].error, /trust/i);
});

test('F08: PR auto-detect returns the branch PR URL or an explicit error', async () => {
  const found = setup({ detectPr: async () => 'https://github.com/o/r/pull/7' });
  found.route({ type: 'detectPr', requestId: 3 });
  await settle();
  assert.deepEqual(found.hudCalls.find(c => c.method === 'postDetection')!.args, ['pr', { value: 'https://github.com/o/r/pull/7' }, 3]);

  const missing = setup();
  missing.route({ type: 'detectPr', requestId: 4 });
  await settle();
  assert.match(missing.hudCalls.find(c => c.method === 'postDetection')!.args[1].error, /No open pull request/i);
});

test('F06: copyText writes full text to the clipboard', async () => {
  const h = setup();
  const text = 'x'.repeat(5000);
  h.route({ type: 'copyText', text });
  await settle();
  assert.deepEqual(h.vs.clipboard, [text]);
});

test('F05: project selection tells the webview to discard stale Explorer state', async () => {
  const h = setup();
  h.route({ type: 'selectProject', projectDir: 'D:/fixture' });
  await settle();
  assert.ok(h.hudCalls.some(c => c.method === 'postScopeChanged'));
});

test('F16: an empty transcript query asks for a search instead of calling the backend', async () => {
  const h = setup();
  h.route({ type: 'queryExplorer', kind: 'transcripts', search: '  ', requestId: 40 });
  await settle();
  assert.equal(h.apiCalls.length, 0);
  const reply = h.explorer().at(-1);
  assert.equal(reply.error, undefined);
  assert.match(reply.notice, /Type a search/);
});
