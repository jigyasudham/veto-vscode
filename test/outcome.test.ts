// Regression tests for the 1.2.0 audit: action outcomes (F01), real backend result
// formats (F17), and oversized tool results (F19). Fixtures are actual Veto 3.8.0
// responses captured during the authenticated audit, trimmed of machine-local data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseToolOutput,
  classifyToolStream,
  outcomeFromError,
  anyCancellation,
  summarizeStreamLine,
} from '../src/commands/process';

const fixture = (name: string) => readFileSync(join(process.cwd(), 'test/fixtures/tool-results', name), 'utf8');
const TOOL = 'mcp__veto__veto_code_review';
const INPUT = { code: 'x', file_path: '/p/x.js' };

function stream(result: string | undefined, opts: { isError?: boolean; input?: unknown } = {}): string {
  const events: unknown[] = [
    { type: 'system', subtype: 'init' },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: TOOL, id: 't1', input: opts.input ?? INPUT }] } },
  ];
  if (result !== undefined) {
    events.push({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: opts.isError, content: result }] } });
  }
  return events.map(e => JSON.stringify(e)).join('\n');
}

test('F17: real review and scan results (verdict=approved, generation=complete) are completed GREEN', () => {
  for (const name of ['review.json', 'scan.json']) {
    const parsed = parseToolOutput(fixture(name));
    assert.equal(parsed.verdict, 'GREEN', name);
    assert.equal(parsed.isSuccess, true, name);
    assert.equal(parsed.failed, false, name);
  }
});

test('F17: council result with a prose preamble is parsed from its JSON final_verdict', () => {
  const parsed = parseToolOutput(fixture('debate.txt'));
  assert.equal(parsed.verdict, 'GREEN');
  assert.equal(parsed.isSuccess, true);
  assert.equal(parsed.isPendingPhase2, false);
});

test('F17: generated drafts and resume results complete without a verdict', () => {
  const commit = parseToolOutput(fixture('commit-staged.json'));
  assert.equal(commit.isSuccess, true);
  assert.equal(commit.verdict, undefined);
  const resume = parseToolOutput(fixture('resume.txt'));
  assert.equal(resume.failed, false);
  assert.equal(resume.isSuccess, true);
});

test('F17: small PR review verdict=pass stays GREEN; prose-only output is never success', () => {
  assert.equal(parseToolOutput(fixture('pr-review-small.json')).verdict, 'GREEN');
  const prose = parseToolOutput('Everything looks good. VERDICT: GREEN');
  assert.equal(prose.isSuccess, false);
  assert.equal(prose.verdict, undefined);
});

test('F17: rejection-style verdicts map to RED and are not operation failures', () => {
  const parsed = parseToolOutput(JSON.stringify({ verdict: 'rejected', generation: 'complete' }));
  assert.equal(parsed.verdict, 'RED');
  assert.equal(parsed.failed, false);
});

test('F01: a correlated successful result is a completed outcome carrying the output and verdict', () => {
  const outcome = classifyToolStream(stream(fixture('review.json')), TOOL, INPUT);
  assert.equal(outcome.status, 'completed');
  assert.ok(outcome.status === 'completed' && outcome.verdict === 'GREEN' && outcome.output.includes('"approved"'));
});

test('F01: a completed RED verdict is still a completed operation', () => {
  const outcome = classifyToolStream(stream(JSON.stringify({ verdict: 'RED', reason: 'blocked' })), TOOL, INPUT);
  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.status === 'completed' && outcome.verdict, 'RED');
});

test('F01: no correlated result is an error, never success', () => {
  const outcome = classifyToolStream(stream(undefined), TOOL, INPUT);
  assert.equal(outcome.status, 'error');
  assert.match(outcome.status === 'error' ? outcome.message : '', /no verified backend result/i);
});

test('F01: backend is_error results surface the backend message', () => {
  const outcome = classifyToolStream(stream('{"success":false,"message":"No staged changes. Run git add first."}', { isError: true }), TOOL, INPUT);
  assert.equal(outcome.status, 'error');
  assert.equal(outcome.status === 'error' && outcome.message, 'No staged changes. Run git add first.');
});

test('F01: success=false results are errors with their message', () => {
  const outcome = classifyToolStream(stream('{"success":false,"message":"Session not found"}'), TOOL, INPUT);
  assert.equal(outcome.status, 'error');
  assert.equal(outcome.status === 'error' && outcome.message, 'Session not found');
});

test('F01: unfinished reasoning is pending, not completed', () => {
  const outcome = classifyToolStream(stream('{"debate_prompt":"reason as all agents"}'), TOOL, INPUT);
  assert.equal(outcome.status, 'pending');
});

test('F01: changed tool arguments become an error outcome instead of throwing', () => {
  const outcome = classifyToolStream(stream('{"success":true}', { input: { ...INPUT, code: 'other' } }), TOOL, INPUT);
  assert.equal(outcome.status, 'error');
  assert.match(outcome.status === 'error' ? outcome.message : '', /differed/);
});

test('F19: an oversized tool result produces an actionable error', () => {
  const outcome = classifyToolStream(stream(fixture('pr-review-oversized.txt')), TOOL, INPUT);
  assert.equal(outcome.status, 'error');
  const message = outcome.status === 'error' ? outcome.message : '';
  assert.match(message, /too large/i);
  assert.match(message, /601,395/);
  assert.match(message, /smaller/i);
});

test('F01: cancellation and timeout errors map to cancelled and error outcomes', () => {
  assert.equal(outcomeFromError(new Error('Operation cancelled by user')).status, 'cancelled');
  const timeout = outcomeFromError(new Error('Operation timed out after 1s'));
  assert.equal(timeout.status, 'error');
  assert.match(timeout.status === 'error' ? timeout.message : '', /timed out/);
});

test('anyCancellation fires when any source token is cancelled', () => {
  const listeners: Array<() => void> = [];
  let cancelled = false;
  const a = { get isCancellationRequested() { return cancelled; }, onCancellationRequested: (l: () => void) => { listeners.push(l); return { dispose() {} }; } };
  const b = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  const combined = anyCancellation([a, b, undefined]);
  let fired = 0;
  combined.onCancellationRequested(() => fired++);
  assert.equal(combined.isCancellationRequested, false);
  cancelled = true;
  listeners.forEach(l => l());
  assert.equal(combined.isCancellationRequested, true);
  assert.equal(fired, 1);
});

test('summarizeStreamLine turns stream-json events into readable console lines', () => {
  assert.equal(summarizeStreamLine('not json'), undefined);
  assert.equal(summarizeStreamLine(JSON.stringify({ type: 'system', subtype: 'init' })), undefined);
  assert.equal(summarizeStreamLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Reviewing now.' }] } })), 'Claude: Reviewing now.');
  assert.equal(summarizeStreamLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: TOOL, id: 'x' }] } })), `Calling ${TOOL}`);
  assert.equal(summarizeStreamLine(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'abc' }] } })), 'Tool result received (3 characters)');
  assert.equal(summarizeStreamLine(JSON.stringify({ type: 'result', subtype: 'success', duration_ms: 1500 })), 'Claude finished (success, 1.5s)');
});
