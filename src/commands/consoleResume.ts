import { isDeepStrictEqual } from 'node:util';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { parseToolOutput, type ToolOutcome } from './process';

export type ConsoleProvider = 'claude' | 'gemini' | 'codex' | 'antigravity';
export const consoleProviders = ['claude', 'gemini', 'codex', 'antigravity'] as const;

export function consoleResumeInvocation(provider: Exclude<ConsoleProvider, 'claude'>, prompt: string) {
  switch (provider) {
    case 'gemini': return { command: 'gemini', args: ['--output-format', 'stream-json', '--approval-mode', 'default', '-p', prompt] };
    case 'codex': return { command: 'codex', args: ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '-'], input: prompt };
    case 'antigravity': return { command: 'agy', args: ['--output-format', 'stream-json', '--mode', 'plan', '-p', prompt] };
  }
}

const textOf = (value: any): string => typeof value === 'string' ? value :
  Array.isArray(value) ? value.filter(v => v?.type === 'text').map(v => v.text).join('\n') :
  value === undefined ? '' : JSON.stringify(value);

/** AGY externalizes MCP output. Derive its path from native event IDs, never model text. */
export function readAgyToolOutput(conversation: string, step: number): string {
  if (!/^[a-f0-9-]{36}$/i.test(conversation) || !Number.isSafeInteger(step) || step < 0) throw new Error('Invalid AGY output reference.');
  const root = realpathSync(join(homedir(), '.gemini', 'antigravity-cli', 'brain'));
  const file = realpathSync(join(root, conversation, '.system_generated', 'steps', String(step), 'output.txt'));
  const rel = relative(root, file);
  if (isAbsolute(rel) || rel.startsWith('..')) throw new Error('AGY output escaped its storage directory.');
  if (statSync(file).size > 1024 * 1024) throw new Error('AGY tool output exceeded 1 MB.');
  return readFileSync(file, 'utf8');
}

/** Only native tool events are evidence; assistant text can never verify a restore. */
export function classifyResumeStream(stream: string, provider: Exclude<ConsoleProvider, 'claude'>,
  expectedInput: Record<string, unknown>, readOutput = readAgyToolOutput): ToolOutcome {
  const calls = new Set<string>();
  let output: string | undefined;
  let finished = false;
  let failure: string | undefined;
  const check = (name: unknown, input: unknown) => {
    if (!['veto_continue', 'mcp__veto__veto_continue', 'veto__veto_continue'].includes(String(name))) return false;
    if (!isDeepStrictEqual(input, expectedInput)) throw new Error('Backend tool arguments differed from the requested resume.');
    return true;
  };
  try {
    for (const line of stream.split(/\r?\n/)) {
      let e: any;
      try { e = JSON.parse(line); } catch { continue; }
      if (!e || typeof e !== 'object') continue;
      if (provider === 'gemini') {
        if (e.type === 'tool_use' && typeof e.tool_id === 'string' && check(e.tool_name, e.parameters)) calls.add(e.tool_id);
        if (e.type === 'tool_result' && calls.has(e.tool_id)) {
          if (e.status !== 'success') failure = textOf(e.error) || 'Gemini tool call failed.';
          else output = textOf(e.output);
        }
        if (e.type === 'result') { finished = e.status === 'success'; if (!finished) failure = textOf(e.error) || 'Gemini failed.'; }
        if (e.type === 'error' && e.severity === 'error') failure = textOf(e.message);
      } else if (provider === 'codex') {
        const item = e.item;
        if (e.type === 'item.completed' && item?.type === 'mcp_tool_call' && item.server === 'veto' && check(item.tool, item.arguments)) {
          if (item.status !== 'completed' || item.error || item.result?.isError) failure = textOf(item.error) || 'Codex tool call failed.';
          else output = textOf(item.result?.structured_content ?? item.result?.content);
        }
        if (e.type === 'turn.completed') finished = true;
        if (e.type === 'turn.failed' || e.type === 'error') failure = textOf(e.error ?? e.message) || 'Codex failed.';
      } else {
        const step = e.step_update;
        if (e.event === 'step_update' && step?.step_type === 'tool' && step.state === 'DONE') {
          const info = step.tool_info;
          const wrapped = step.tool_name === 'call_mcp_tool' && info?.parameters?.ServerName === 'veto';
          if (check(wrapped ? info.parameters.ToolName : step.tool_name, wrapped ? info.parameters.Arguments : info?.parameters)) {
            if (info.error) failure = textOf(info.error);
            else {
              output = info.output === undefined ? readOutput(step.conversation_id, step.step_index) : textOf(info.output);
              if (wrapped) {
                const start = output.indexOf('\n{');
                const payload = JSON.parse(start >= 0 ? output.slice(start + 1) : output);
                if (payload.session_id !== expectedInput.session_id || payload.active_client !== 'antigravity' ||
                    typeof payload.restored_at !== 'string' || !Number.isFinite(Date.parse(payload.restored_at))) {
                  throw new Error('AGY output does not confirm the requested session restore.');
                }
              }
            }
          }
        }
        if (e.event === 'result') { finished = e.result?.status === 'SUCCESS'; if (!finished) failure = textOf(e.result?.error) || 'AGY failed.'; }
      }
    }
  } catch (e) { return { status: 'error', message: String(e) }; }
  if (failure) return { status: 'error', message: failure, output };
  if (!finished || !output) return { status: 'error', message: `No verified restore from ${provider}. Check CLI authentication and the Veto MCP connection; use terminal resume if permission approval is needed.`, output };
  const parsed = parseToolOutput(output);
  if (parsed.failed) return { status: 'error', message: parsed.errorMessage || 'Restore failed.', output };
  if (!parsed.isSuccess || parsed.isPendingPhase2) return { status: 'error', message: 'The backend did not confirm a completed restore.', output };
  return { status: 'completed', output, parsed };
}

export function resumeProgress(line: string, provider: ConsoleProvider): string | undefined {
  let e: any;
  try { e = JSON.parse(line); } catch { return undefined; }
  if (!e || typeof e !== 'object') return;
  if (provider === 'antigravity') {
    const step = e.step_update;
    if (e.event === 'step_update' && step?.state === 'DONE' && step.step_type === 'tool') {
      const name = step.tool_name === 'call_mcp_tool' ? step.tool_info?.parameters?.ToolName ?? step.tool_name : step.tool_name;
      return `antigravity: finished ${name}`;
    }
    if (e.event === 'result') return `antigravity: response received (${e.result?.status ?? 'unknown'})`;
    return;
  }
  const message = provider === 'gemini' ? (e.type === 'message' && e.role === 'assistant' ? e.content : undefined) :
    provider === 'codex' ? (e.item?.type === 'agent_message' ? e.item.text : undefined) : e.step_update?.text_delta;
  if (typeof message === 'string' && message.trim()) return `${provider}: ${message.trim().slice(0, 300)}`;
  const name = e.tool_name ?? (e.item?.type === 'mcp_tool_call' ? e.item.tool : undefined) ?? e.step_update?.tool_name;
  if (name) return `${provider}: calling ${name}`;
}
