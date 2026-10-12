// ARCHIVED: Diagnostic reproductions for the historical 2026-09-28 pre-release audit.
// These assert the pre-remediation defect states from audit-1.2.0; the actual regression
// test suite lives in test/ (test/webview.test.ts, test/extension-routes.test.ts, etc.).
// This script fails by design against fixed code.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const observations = [];
class Element {
  constructor() {
    this.children = []; this.listeners = {}; this.attrs = {}; this.dataset = {};
    this.value = ''; this.style = {}; this.classes = new Set(); this._text = '';
    this.classList = {
      add: x => this.classes.add(x), remove: x => this.classes.delete(x),
      toggle: (x, value) => { const on = value ?? !this.classes.has(x); on ? this.classes.add(x) : this.classes.delete(x); return on; },
    };
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map(x => x.textContent).join(''); }
  appendChild(n) { this.children.push(n); return n; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(k, f) { this.listeners[k] = f; }
  focus() {}
}
const roots = new Map();
const html = fs.readFileSync('src/ui/assets/hud.html', 'utf8');
for (const [, id] of html.matchAll(/id="([^"]+)"/g)) roots.set(id, new Element());
const posted = [];
let receive;
const ctx = vm.createContext({
  acquireVsCodeApi: () => ({ getState: () => ({}), setState() {}, postMessage: m => posted.push(m) }),
  document: { getElementById: id => roots.get(id), createElement: () => new Element(), querySelectorAll: () => [] },
  window: { addEventListener: (name, f) => { if (name === 'message') receive = f; } },
  setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
});
vm.runInContext(fs.readFileSync('src/ui/assets/hud.js', 'utf8'), ctx);
assert.equal(posted.some(m => m.type === 'getProjects'), false);
observations.push('Default webview startup never requests projects; activation does not seed the project list.');
const click = id => roots.get(id).listeners.click();
click('btnDetectCli');
assert.equal(roots.get('settingCliPath').value, 'veto');
observations.push('CLI Auto-Detect writes veto, which the backend rejects as not an absolute .js path.');
posted.length = 0;
click('btnDetectPr');
assert.equal(posted.length, 0);
assert.equal(roots.get('wfPrUrl').placeholder, 'Detecting PR...');
observations.push('PR Auto-Detect only changes the placeholder; it emits no request.');
assert.ok(html.includes('data-cmd="veto.openInstallDocs"'));
assert.ok(!fs.readFileSync('src/ui/assets/hud.js', 'utf8').includes('data-cmd'));
observations.push('Missing-database Install docs button has data-cmd but no dispatcher binds it.');
vm.runInContext("lastActionResultText = 'x'.repeat(513)", ctx);
click('btnCopyResult');
const messagesCode = ts.transpileModule(fs.readFileSync('src/ui/messages.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const messagesExports = {};
vm.runInNewContext(messagesCode, { exports: messagesExports });
assert.equal(messagesExports.validateHudMessage(posted.at(-1)), null);
observations.push('Copy Result silently rejects 513 characters; Copy Log uses the same capped copyId route.');
const session = id => ({ id, summary: id, platform: 'codex', created_at: '2026-09-28' });
receive({ data: { type: 'explorerData', kind: 'sessions', requestId: 20, items: [session('new-search')] } });
receive({ data: { type: 'explorerData', kind: 'sessions', requestId: 19, items: [session('old-search')] } });
assert.match(roots.get('explorerItems').textContent, /old-search/);
observations.push('Older same-kind Explorer responses overwrite newer results despite requestId.');
const first = roots.get('explorerItems').children[0];
assert.equal(first.attrs.role, 'button');
assert.equal(first.listeners.keydown, undefined);
observations.push('Explorer cards are focusable role=button divs with no keyboard activation handler.');
vm.runInContext("switchTab('settings')", ctx);
receive({ data: { type: 'explorerDetail', kind: 'memory', id: 'old', detail: { title: 'Late reply' }, requestId: 1 } });
assert.equal(roots.get('detailDrawer').classes.has('hidden'), false);
observations.push('A late detail reply reopens the drawer after switching tabs.');
posted.length = 0;
vm.runInContext('loadExplorerData()', ctx);
assert.equal(posted.at(-1).offset, 0);
receive({ data: { type: 'explorerData', kind: 'sessions', items: [session('page-one')], hasMore: true } });
assert.equal(roots.get('explorerItems').children.length, 1);
assert.ok(!/hasMore/.test(fs.readFileSync('src/ui/assets/hud.js', 'utf8')));
observations.push('Explorer always requests offset 0 and never handles hasMore.');

async function hostReproductions() {
  let route;
  const statuses = [], spawned = [], toolCalls = [];
  const disposable = () => ({ dispose() {} });
  const config = { get: (_key, fallback) => fallback, update: async () => {} };
  const vscode = {
    workspace: { isTrusted: true, workspaceFolders: [{ name: 'fixture', uri: { fsPath: 'D:/fixture' } }], getConfiguration: () => config,
      onDidChangeConfiguration: disposable, onDidChangeWorkspaceFolders: disposable },
    window: { createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
      showWarningMessage: () => Promise.resolve(), showInformationMessage() {}, showErrorMessage() {}, onDidChangeActiveTextEditor: disposable },
    extensions: { getExtension: () => ({ packageJSON: { version: '1.2.0' } }) },
    commands: { registerCommand: disposable, executeCommand() {} },
    languages: { createDiagnosticCollection: () => ({ clear() {}, dispose() {} }) },
  };
  vscode.window.registerWebviewViewProvider = disposable;
  class Store {
    isSupported() { return true; } setProjectDir() {} refresh() {} start() {} onChange() { return disposable(); }
    getDbPath() { return 'D:/fixture/unused.db'; } getSnapshot() { return { diagnostics: [] }; }
  }
  class Hud {
    constructor(handler) { route = handler; }
    postActionStatus(s) { statuses.push(s); } postLogEntry() {} postExplorerData() {}
  }
  const deps = {
    vscode, './core/VetoStore': { VetoStore: Store }, './ui/StatusBar': { StatusBar: class {} }, './ui/HudView': { HudView: Hud },
    './commands': { registerCommands() {} },
    './commands/process': { spawnProcess: async (...args) => { spawned.push(args); return '{}'; }, cancelAllProcesses() {}, parseToolOutput: () => ({}) },
    './commands/veto': { runStructuredTool: async (_channel, opts) => { toolCalls.push(opts); return undefined; } },
    './core/catalog': { parseCatalog: () => [] }, './core/projects': { selectedProject: () => 'D:/fixture' },
    './commands/backend': { registerBackendCommands: () => ({}) }, './core/paths': { pathsEqual: (a,b) => a === b, isCustomDbPath: () => false },
    './core/visibility': { visibilityReport: () => 'fixture report' },
  };
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync('src/extension.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { exports, require: id => id in deps ? deps[id] : require(id), process, console });
  exports.activate({ subscriptions: [], workspaceState: { get() {}, update: async () => {} }, extension: { packageJSON: { version: '1.2.0' } } });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  route({ type: 'runAction', action: 'saveCheckpoint', params: { summary: 'fixture' } });
  await flush();
  assert.equal(statuses.at(-1).status, 'done');
  assert.equal(statuses.at(-1).result, undefined);
  observations.push('Checkpoint handler reports done when the tool adapter returns undefined (failure/cancel/no verified result).');
  route({ type: 'resume', id: 'fixture', platform: 'codex', target: 'console' });
  await flush();
  assert.equal(toolCalls.at(-1).input.resuming_as, 'antigravity');
  assert.equal(statuses.at(-1).status, 'done');
  observations.push('Console resume hardcodes antigravity for a Codex session and reports restored even with undefined output.');
  vscode.workspace.isTrusted = false;
  route({ type: 'queryExplorer', kind: 'tools' });
  route({ type: 'queryExplorer', kind: 'agents' });
  await flush();
  assert.equal(spawned.length, 2);
  observations.push('Restricted workspace Explorer tools/agents handlers invoke subprocesses without a trust check.');
  console.log(JSON.stringify({ reproduced: observations.length, observations }, null, 2));
}
hostReproductions().catch(e => { console.error(e); process.exitCode = 1; });
