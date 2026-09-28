// Command-palette route regressions from the 1.2.0 audit (F02, F18), using the real
// src/commands/index.ts with a fake VS Code API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeVscode, loadModule, settle } from './helpers/harness';

function setup(opts: { trusted?: boolean; beforeWorkflow?: (dir?: string) => Promise<void> } = {}) {
  const vs = fakeVscode({ trusted: opts.trusted });
  const toolCalls: any[] = [];
  const mod = loadModule('src/commands/index.ts', {
    vscode: vs.api,
    './veto': {
      runStructuredTool: async (_c: unknown, o: any) => { toolCalls.push(o); return { status: 'completed', output: '{}' }; },
      resumeSessionInTerminal: async () => {}, spawnProcess: async () => '', detectPrUrl: async () => undefined,
    },
    './details': { registerDetailCommands() {} },
    './catalog': { registerCatalogCommands() {} },
    './workflows': { registerDraftWorkflows() {} },
  });
  const store = { refresh() {}, getSnapshot: () => ({}) };
  mod.registerCommands({ subscriptions: [], extension: { packageJSON: {} } },
    { store, outputChannel: { show() {} }, openHud() {}, getProjectDir: () => 'D:/fixture', beforeWorkflow: opts.beforeWorkflow });
  return { vs, toolCalls };
}

test('F02: veto.openTerminal requires a trusted workspace', async () => {
  const h = setup({ trusted: false });
  await h.vs.commands.get('veto.openTerminal')!();
  assert.equal(h.vs.terminals.length, 0);
  const trusted = setup();
  await trusted.vs.commands.get('veto.openTerminal')!();
  assert.equal(trusted.vs.terminals.length, 1);
});

test('F18: palette AI workflows stop when the workflow database guard rejects', async () => {
  const h = setup({ beforeWorkflow: async () => { throw new Error('HUD database differs'); } });
  h.vs.api.window.showInputBox = async () => 'checkpoint summary';
  await h.vs.commands.get('veto.saveSession')!();
  await settle();
  assert.equal(h.toolCalls.length, 0);
  assert.ok(h.vs.messages.some(m => m.level === 'error' && /HUD database differs/.test(m.text)));
});
