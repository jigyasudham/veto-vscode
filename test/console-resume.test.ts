import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyResumeStream, consoleResumeInvocation, resumeProgress } from '../src/commands/consoleResume';
import * as realProcess from '../src/commands/process';
import { fakeVscode, loadModule } from './helpers/harness';

const providers = ['gemini', 'codex', 'antigravity'] as const;
type Provider = typeof providers[number];
function events(provider: Provider, input: unknown, output = JSON.stringify({ session_id: 's1', restored_at: '2026-10-11T00:00:00Z' })): any[] {
  if (provider === 'gemini') return [
    { type: 'tool_use', tool_id: 'call1', tool_name: 'veto_continue', parameters: input },
    { type: 'tool_result', tool_id: 'call1', status: 'success', output },
    { type: 'result', status: 'success' },
  ];
  if (provider === 'codex') return [
    { type: 'item.completed', item: { type: 'mcp_tool_call', server: 'veto', tool: 'veto_continue', arguments: input,
      status: 'completed', result: { content: [{ type: 'text', text: output }] } } },
    { type: 'turn.completed' },
  ];
  return [
    { event: 'step_update', step_update: { state: 'DONE', step_type: 'tool', tool_name: 'veto_continue',
      tool_info: { parameters: input, output } } },
    { event: 'result', result: { status: 'SUCCESS' } },
  ];
}
const stream = (events: unknown[]) => events.map(e => JSON.stringify(e)).join('\n');

for (const provider of providers) {
  const input = { session_id: 's1', resuming_as: provider };
  test(`${provider}: native backend evidence and final success are required`, () => {
    assert.equal(classifyResumeStream(stream(events(provider, input)), provider, input).status, 'completed');
    for (const output of ['Restored successfully!', '{"error":"missing session"}', '{"status":"pending"}']) {
      assert.equal(classifyResumeStream(stream(events(provider, input, output)), provider, input).status, 'error');
    }
    assert.equal(classifyResumeStream(stream(events(provider, { ...input, session_id: 'other' })), provider, input).status, 'error');
    assert.equal(classifyResumeStream(stream(events(provider, input).slice(0, -1)), provider, input).status, 'error');
    assert.equal(classifyResumeStream(stream(events(provider, input).slice(-1)), provider, input).status, 'error');
    assert.equal(classifyResumeStream('null\n{}\nnot json', provider, input).status, 'error');
  });

  test(`${provider}: console adapter launches the selected CLI with cancellation and timeout`, async () => {
    const vs = fakeVscode({ config: { actionTimeoutMs: 5000 } });
    const calls: any[] = [];
    const progress: string[] = [];
    const mod = loadModule('src/commands/veto.ts', { vscode: vs.api, './process': {
      ...realProcess, spawnProcess: async (...args: any[]) => { calls.push(args); return stream(events(provider, input)); },
    } });
    const source = new vs.api.CancellationTokenSource();
    const outcome = await mod.runStructuredTool(vs.api.window.createOutputChannel(), {
      title: 'Resume', provider, tool: 'veto_continue', input, cwd: 'D:/project',
      cancellationToken: source.token, onProgress: (line: string) => progress.push(line),
    });
    assert.equal(outcome.status, 'completed');
    assert.equal(calls[0][0], provider === 'antigravity' ? 'agy' : provider);
    assert.equal(calls[0][3].cwd, 'D:/project');
    assert.equal(calls[0][3].timeoutMs, 5000);
    source.cancel();
    assert.equal(calls[0][3].cancellationToken.isCancellationRequested, true);
    assert.ok(progress.length);
    assert.ok(!calls[0][1].some((arg: string) => /yolo|dangerously/.test(arg)));
  });
}

test('provider invocation uses supported noninteractive modes', () => {
  assert.deepEqual(consoleResumeInvocation('gemini', 'prompt').args.slice(-2), ['-p', 'prompt']);
  assert.equal(consoleResumeInvocation('codex', 'prompt').input, 'prompt');
  assert.deepEqual(consoleResumeInvocation('antigravity', 'prompt').args.slice(-2), ['-p', 'prompt']);
});

test('provider progress extracts assistant text without accepting it as evidence', () => {
  assert.match(resumeProgress(JSON.stringify({ type: 'message', role: 'assistant', content: 'Restoring' }), 'gemini')!, /Restoring/);
  assert.match(resumeProgress(JSON.stringify({ item: { type: 'agent_message', text: 'Restoring' } }), 'codex')!, /Restoring/);
  assert.equal(resumeProgress(JSON.stringify({ step_update: { text_delta: 'Restoring' } }), 'antigravity'), undefined);
});

test('AGY wrapped MCP calls read only correlated native step output and verify its identity', () => {
  const input = { session_id: 's1', resuming_as: 'antigravity' };
  const native = { event: 'step_update', step_update: { conversation_id: '0d9c37fe-e891-44df-88a2-9a7df942b55d',
    step_index: 4, state: 'DONE', step_type: 'tool', tool_name: 'call_mcp_tool', tool_info: {
      parameters: { ServerName: 'veto', ToolName: 'veto_continue', Arguments: input },
    } } };
  const final = { event: 'result', result: { status: 'SUCCESS', response: 'I restored it' } };
  const raw = stream([native, final]);
  const payload = { session_id: 's1', active_client: 'antigravity', restored_at: '2026-10-11T13:20:10Z' };
  assert.equal(classifyResumeStream(raw, 'antigravity', input, (conversation, step) => {
    assert.equal(conversation, native.step_update.conversation_id);
    assert.equal(step, 4);
    return 'Restored session\n\n' + JSON.stringify(payload);
  }).status, 'completed');
  for (const output of ['I restored it', JSON.stringify({ ...payload, session_id: 'wrong' }), JSON.stringify({ ...payload, active_client: 'codex' })]) {
    assert.equal(classifyResumeStream(raw, 'antigravity', input, () => output).status, 'error');
  }
  assert.equal(classifyResumeStream(raw, 'antigravity', input, () => { throw new Error('Missing output'); }).status, 'error');
  assert.match(resumeProgress(JSON.stringify(native), 'antigravity')!, /finished veto_continue/);
  assert.equal(resumeProgress(JSON.stringify({ ...native, step_update: { ...native.step_update, state: 'ACTIVE' } }), 'antigravity'), undefined);
  native.step_update.tool_info.parameters.ServerName = 'other';
  assert.equal(classifyResumeStream(stream([native, final]), 'antigravity', input, () => { throw new Error('Must not read'); }).status, 'error');
});

test('console adapter preserves cancellation and spawn failures and blocks untrusted execution', async () => {
  for (const scenario of ['cancelled', 'ENOENT', 'untrusted']) {
    const vs = fakeVscode({ trusted: scenario !== 'untrusted' });
    let launched = false;
    const mod = loadModule('src/commands/veto.ts', { vscode: vs.api, './process': { ...realProcess,
      spawnProcess: async () => { launched = true; throw new Error(scenario); },
    } });
    const outcome = await mod.runStructuredTool(vs.api.window.createOutputChannel(), {
      title: 'Resume', provider: 'codex', tool: 'veto_continue', input: { session_id: 's1', resuming_as: 'codex' },
    });
    assert.equal(outcome.status, scenario === 'cancelled' ? 'cancelled' : 'error');
    assert.equal(launched, scenario !== 'untrusted');
  }
});
