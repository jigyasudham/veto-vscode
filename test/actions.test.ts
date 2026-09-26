// Tests for Batch B actions (F05, F06, F07):
// Subprocess lifecycle, executable resolution, structured verdict parsing, and vote chip parsing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseToolOutput,
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

test('F07: parseToolOutput prioritizes explicit Verdict pattern over historical prose', () => {
  const output = 'Deliberation log: previously had RED outcome on commit abc. Current Verdict: GREEN.';
  const res = parseToolOutput(output);
  assert.equal(res.verdict, 'GREEN');
  assert.equal(res.isSuccess, true);
  assert.equal(res.isError, false);

  const deadlockOutput = '### Council Outcome\n**Verdict:** DEADLOCK\nAgents could not agree.';
  const resDl = parseToolOutput(deadlockOutput);
  assert.equal(resDl.verdict, 'DEADLOCK');
  assert.equal(resDl.isSuccess, false);
  assert.equal(resDl.isError, true);
});

test('F07: parseToolOutput respects safety precedence DEADLOCK > RED > YELLOW > GREEN on mixed prose', () => {
  const mixedOutput = 'Warning: RED detected in test suite, though GREEN in lint';
  const res = parseToolOutput(mixedOutput);
  assert.equal(res.verdict, 'RED');
  assert.equal(res.isSuccess, false);
  assert.equal(res.isError, true);
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
    timeoutMs: 500,
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
