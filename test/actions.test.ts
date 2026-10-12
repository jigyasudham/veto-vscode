// Tests for Batch B actions (F05, F06, F07):
// Subprocess lifecycle, executable resolution, structured verdict parsing, and vote chip parsing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseToolOutput,
  extractToolResult,
  npmShimEntry,
  resolveExecutable,
  spawnProcess,
  cancelAllProcesses,
  getActiveProcessesCount,
} from '../src/commands/process';

test('F07: parseToolOutput extracts structured JSON verdicts accurately', () => {
  const greenJson = JSON.stringify({ verdict: 'GREEN', summary: 'All checks passed' });
  const resGreen = parseToolOutput(greenJson);
  assert.equal(resGreen.verdict, 'GREEN');
  assert.equal(resGreen.isSuccess, true);
  assert.equal(resGreen.isError, false);

  const yellowJson = JSON.stringify({ verdict: 'YELLOW', reason: 'Minor lint warnings' });
  const resYellow = parseToolOutput(yellowJson);
  assert.equal(resYellow.verdict, 'YELLOW');
  assert.equal(resYellow.isSuccess, true);
  assert.equal(resYellow.isError, false);

  const redJson = JSON.stringify({ verdict: 'RED', reason: 'Critical vulnerability detected' });
  const resRed = parseToolOutput(redJson);
  assert.equal(resRed.verdict, 'RED');
  assert.equal(resRed.isSuccess, false);
  assert.equal(resRed.isError, true);

  const deadlockJson = JSON.stringify({ verdict: 'DEADLOCK', reason: 'Tie between security and dev' });
  const resDeadlock = parseToolOutput(deadlockJson);
  assert.equal(resDeadlock.verdict, 'DEADLOCK');
  assert.equal(resDeadlock.isSuccess, false);
  assert.equal(resDeadlock.isError, true);
});

test('F07: prose, malformed JSON, and empty output never imply completion', () => {
  for (const text of ['', 'Verdict: GREEN', 'Warning: RED detected, GREEN in lint', '{"verdict":"GREEN"', 'I will run the tool']) {
    assert.equal(parseToolOutput(text).isSuccess, false);
    assert.equal(parseToolOutput(text).verdict, undefined);
  }
});

test('F07: parseToolOutput detects pending Phase 2 / debate prompts', () => {
  const phase2Output = JSON.stringify({
    verdict: 'YELLOW',
    llm_upgrade: { debate_prompt: 'Reason as all 7 agents' },
  });
  const res = parseToolOutput(phase2Output);
  assert.equal(res.verdict, 'YELLOW');
  assert.equal(res.isPendingPhase2, true);
});

test('F07: parseToolOutput marks errors without false green', () => {
  const errorOutput = 'Error: Failed to connect to veto daemon';
  const res = parseToolOutput(errorOutput);
  assert.equal(res.verdict, undefined);
  assert.equal(res.isError, true);
  assert.equal(res.isSuccess, false);
});

test('F06: resolveExecutable resolves Windows executables safely without shell interpolation', () => {
  const gitResolved = resolveExecutable('git');
  assert.ok(typeof gitResolved === 'string');
  assert.ok(gitResolved.length > 0);
  if (process.platform === 'win32') {
    assert.match(gitResolved, /\.(exe|cmd|bat)$/i);
  }

  // Already qualified executable returns unchanged
  assert.equal(resolveExecutable('custom.exe'), 'custom.exe');
  // Nonexistent command safely falls back
  assert.equal(resolveExecutable('nonexistent-cmd-xyz'), 'nonexistent-cmd-xyz');
});

test('F06: spawnProcess enforces timeouts and terminates timed-out processes', async () => {
  // Spawn a long-lived process (node -e "setTimeout(()=>{}, 10000)") with a 50ms timeout
  const startTime = Date.now();
  await assert.rejects(
    () => spawnProcess(process.execPath, ['-e', 'setTimeout(()=>{}, 10000)'], undefined, {
      timeoutMs: 50,
      jobKey: 'timeout-test',
    }),
    /timed out after/i,
  );
  const elapsed = Date.now() - startTime;
  assert.ok(elapsed < 2000, `Process should have timed out quickly, took ${elapsed}ms`);
  assert.equal(getActiveProcessesCount(), 0);
});

test('F06: spawnProcess deduplicates concurrently running jobs with the same key', async () => {
  const jobKey = 'duplicate-job-test';
  const promise1 = spawnProcess(process.execPath, ['-e', 'setTimeout(()=>{}, 200)'], undefined, {
    jobKey,
    timeoutMs: 3000,
  });

  // Concurrently spawning the same job key must immediately reject
  await assert.rejects(
    () => spawnProcess(process.execPath, ['-e', 'setTimeout(()=>{}, 200)'], undefined, { jobKey }),
    /already running/i,
  );

  await promise1;
});

test('F06: cancelAllProcesses kills active child processes and clears tracking', async () => {
  const promise = spawnProcess(process.execPath, ['-e', 'setTimeout(()=>{}, 10000)'], undefined, {
    jobKey: 'cancel-test',
    timeoutMs: 15000,
  });

  // Give process a moment to spawn
  await new Promise(r => setTimeout(r, 50));
  assert.ok(getActiveProcessesCount() >= 1);

  cancelAllProcesses();
  assert.equal(getActiveProcessesCount(), 0);

  // The child process promise will reject due to kill or close
  await assert.rejects(promise);
});

test('F07: vote parsing handles JSON objects without false green when reason mentions approve', () => {
  // Test the parsing logic matching hud.js parseAgentVote
  function parseAgentVote(raw: any) {
    if (!raw) return { state: 'none', icon: '', reason: '' };
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === 'object') {
        const v = (parsed.verdict || '').toLowerCase();
        const reason = parsed.reason || parsed.recommendation || '';
        if (v === 'approve' || v === 'green' || v === 'ok') return { state: 'ok', icon: '✓ ', reason };
        if (v === 'block' || v === 'red' || v === 'reject' || v === 'veto') return { state: 'block', icon: '✕ ', reason };
        if (v === 'warn' || v === 'yellow') return { state: 'warn', icon: '⚠ ', reason };
        return { state: 'warn', icon: '⚠ ', reason };
      }
    } catch { /* ignored */ }
    const str = String(raw).trim();
    const lower = str.toLowerCase();
    if (/^(block|red|reject|veto)\b/.test(lower)) return { state: 'block', icon: '✕ ', reason: str };
    if (/^(warn|yellow)\b/.test(lower)) return { state: 'warn', icon: '⚠ ', reason: str };
    if (/^(approve|green|ok)\b/.test(lower)) return { state: 'ok', icon: '✓ ', reason: str };
    if (/\b(block|reject|veto)\b/.test(lower)) return { state: 'block', icon: '✕ ', reason: str };
    if (/\b(warn)\b/.test(lower)) return { state: 'warn', icon: '⚠ ', reason: str };
    if (/\b(approve)\b/.test(lower)) return { state: 'ok', icon: '✓ ', reason: str };
    return { state: 'warn', icon: '⚠ ', reason: str };
  }

  // A blocking vote that says "cannot approve" in the reason MUST NOT evaluate to ok
  const blockWithApproveWord = JSON.stringify({
    verdict: 'block',
    reason: 'Cannot approve because security requirements are not met.',
  });
  const resBlock = parseAgentVote(blockWithApproveWord);
  assert.equal(resBlock.state, 'block');
  assert.equal(resBlock.icon, '✕ ');

  // A normal approve vote
  const approveVote = JSON.stringify({
    verdict: 'approve',
    reason: 'Code conforms to all architectural guidelines.',
  });
  const resApprove = parseAgentVote(approveVote);
  assert.equal(resApprove.state, 'ok');
  assert.equal(resApprove.icon, '✓ ');

  // A warning vote
  const warnVote = JSON.stringify({
    verdict: 'warn',
    reason: 'Missing performance index on query.',
  });
  const resWarn = parseAgentVote(warnVote);
  assert.equal(resWarn.state, 'warn');
  assert.equal(resWarn.icon, '⚠ ');
});


test('F07: pending phase two overrides provisional approval', () => {
  assert.equal(parseToolOutput(JSON.stringify({ verdict: 'GREEN', debate_prompt: 'reason' })).isSuccess, false);
  assert.equal(parseToolOutput(JSON.stringify({ mode: 'agentic_loop', prompts: [], success: true })).isSuccess, false);
});

test('tool result correlation rejects changed arguments and permits phase-two response fields', () => {
  const name = 'mcp__veto__veto_code_review';
  const stream = (input: unknown) => [
    { message: { content: [{ type: 'tool_use', name, id: 'r', input }] } },
    { message: { content: [{ type: 'tool_result', tool_use_id: 'r', content: '{"success":true}' }] } },
  ].map(e => JSON.stringify(e)).join('\n');
  const requested = { code: 'real code', file_path: '/project/file.ts' };
  assert.throws(() => extractToolResult(stream({ ...requested, code: 'other code' }),name,requested), /differed/);
  assert.throws(() => extractToolResult(stream({ ...requested, project_dir: '/other' }),name,requested), /differed/);
  assert.equal(extractToolResult(stream({ ...requested, agent_response: { verdict:'pass' } }),name,requested), '{"success":true}');
});

test('F07: stream results must match an actual tool call; last phase wins', () => {
  const events = [
    { message: { content: [{ type: 'tool_use', name: 'mcp__veto__veto_council_debate', id: 'a' }] } },
    { message: { content: [{ type: 'tool_result', tool_use_id: 'unrelated', content: '{"verdict":"GREEN"}' }] } },
    { message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: '{"debate_prompt":"reason"}' }] }] } },
  ];
  const stream = () => events.map(e => JSON.stringify(e)).join('\n');
  assert.equal(extractToolResult(stream(), 'other'), undefined);
  assert.equal(parseToolOutput(extractToolResult(stream(), 'mcp__veto__veto_council_debate')!).isPendingPhase2, true);
  events.push({ message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: '{"verdict":"GREEN"}' }] } } as any);
  assert.equal(parseToolOutput(extractToolResult(stream(), 'mcp__veto__veto_council_debate')!).isSuccess, true);
});

test('F06: pre-cancelled action never launches and stdin is delivered without shell parsing', async () => {
  await assert.rejects(spawnProcess(process.execPath, ['-e', 'process.exit(0)'], undefined, {
    cancellationToken: { isCancellationRequested: true, onCancellationRequested: () => ({ dispose() {} }) },
  }), /cancelled/);
  const input = 'literal $() & `data` \n full content';
  assert.equal(await spawnProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], undefined, { input }), input);
});

test('F06: only literal npm Node entries are extracted from launchers', () => {
  assert.equal(npmShimEntry('malicious arbitrary batch file', process.cwd()), undefined);
  assert.equal(npmShimEntry('SET dp0=%~dp0\nSET "_prog=node"\n"%_prog%" "%dp0%\\node_modules\\..\\evil.js" %*', process.cwd()), undefined);
  assert.ok(npmShimEntry('SET dp0=%~dp0\nSET "_prog=node"\n"%_prog%" "%dp0%\\node_modules\\tool\\cli.js" %*', process.cwd())?.endsWith('cli.js'));
});
