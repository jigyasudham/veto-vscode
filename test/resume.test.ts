import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeVscode, loadModule } from './helpers/harness';

function harness(selected: string | undefined = 'antigravity', probeError?: Error, trusted = true) {
  const vs = fakeVscode({ trusted });
  const probes: unknown[] = [];
  let choices: any[] = [];
  vs.api.window.showQuickPick = async (items: any[]) => {
    choices = items;
    return items.find(item => item.id === selected);
  };
  const mod = loadModule('src/commands/veto.ts', {
    vscode: vs.api,
    './process': {
      spawnProcess: async (...args: unknown[]) => {
        probes.push(args);
        if (probeError) throw probeError;
        return 'AGY help';
      },
      resolveInvocation: (command: string, args: string[]) => ({ command, args }),
    },
  });
  return { vs, probes, choices: () => choices, resume: mod.resumeSessionInTerminal };
}

test('Antigravity resume launches an interactive Veto restore in the requested project', async () => {
  const h = harness();
  const cwd = 'D:/Projects/with spaces';
  await h.resume('session-123', 'antigravity', cwd);
  assert.equal(h.choices().find(item => item.id === 'antigravity').description, 'Saved session provider');
  assert.deepEqual(h.probes, [['agy', ['--help'], undefined, { timeoutMs: 5000 }]]);
  assert.deepEqual(h.vs.terminals, [{
    name: 'Veto Resume (Antigravity (agy))', cwd, shellPath: 'agy',
    shellArgs: ['--prompt-interactive', 'veto_continue session-123'],
  }]);
});

test('agy source alias marks Antigravity as the saved provider', async () => {
  const h = harness();
  await h.resume('session-123', 'AGY');
  assert.equal(h.choices().find(item => item.id === 'antigravity').description, 'Saved session provider');
});

test('unavailable AGY reports how to fix installation without opening a terminal', async () => {
  const h = harness('antigravity', new Error('spawn agy ENOENT'));
  await h.resume('session-123');
  assert.equal(h.vs.terminals.length, 0);
  assert.match(h.vs.messages[0].text, /AGY CLI is installed and on PATH/);
  assert.match(h.vs.messages[0].text, /ENOENT/);
});

test('resume cancellation, invalid IDs and untrusted workspaces never launch AGY', async () => {
  for (const scenario of ['cancel', 'invalid', 'untrusted']) {
    const h = harness(scenario === 'cancel' ? 'none' : 'antigravity', undefined, scenario !== 'untrusted');
    await h.resume(scenario === 'invalid' ? 'id; echo unsafe' : 'session-123');
    assert.equal(h.probes.length, 0);
    assert.equal(h.vs.terminals.length, 0);
  }
});

test('existing providers retain their terminal arguments', async () => {
  for (const provider of ['claude', 'gemini', 'codex']) {
    const h = harness(provider);
    await h.resume('session-123', provider, 'D:/project');
    assert.equal(h.probes.length, 0);
    assert.deepEqual(h.vs.terminals, [{
      name: `Veto Resume (${provider})`, cwd: 'D:/project', shellPath: provider,
      shellArgs: provider === 'gemini' ? ['--prompt-interactive', 'veto_continue session-123'] : ['veto_continue session-123'],
    }]);
  }
});
