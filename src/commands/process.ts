// Subprocess execution, executable resolution, and structured verdict parsing (F05, F06, F07).
// Decoupled from VS Code APIs to allow full unit testability under Node.js test runner.

import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

const MAX_BUFFER = 1024 * 1024; // 1 MB buffer limit to prevent runaway memory
const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

// Track running processes for clean cancellation and disposal (F06)
const activeProcesses = new Set<ChildProcess>();
const runningJobs = new Set<string>();
const cancellations = new Map<ChildProcess, () => void>();

function terminateProcess(proc: ChildProcess): void {
  if (process.platform === 'win32' && proc.pid) {
    // Kill CLI descendants too; taskkill receives only a numeric PID, never user text.
    const killer = spawn('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
    killer.on('error', () => { try { proc.kill('SIGKILL'); } catch { /* already exited */ } });
  } else {
    try { proc.kill('SIGKILL'); } catch { /* already exited */ }
  }
}

export function getActiveProcessesCount(): number {
  return activeProcesses.size;
}

export function getRunningJobsCount(): number {
  return runningJobs.size;
}

export function cancelAllProcesses(): void {
  for (const cancel of [...cancellations.values()]) cancel();
}

/**
 * Resolve the real executable on Windows (.exe, .cmd, .bat) so that spawn
 * works reliably with shell: false and does not fail on Windows npm shims.
 */
export function resolveExecutable(cmd: string): string {
  if (process.platform !== 'win32') return cmd;
  if (/\.(exe|cmd|bat)$/i.test(cmd)) return cmd;
  try {
    const stdout = execFileSync('where.exe', [cmd], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const exe = lines.find(l => /\.exe$/i.test(l));
    if (exe) return exe;
    const cmdShim = lines.find(l => /\.(cmd|bat)$/i.test(l));
    if (cmdShim) return cmdShim;
    if (lines[0]) return lines[0];
  } catch {
    // fallback to original cmd
  }
  return cmd;
}

/** Extract only the literal Node entry from an npm launcher; never execute the batch text. */
export function npmShimEntry(source: string, directory: string): string | undefined {
  if (!source.includes('SET dp0=%~dp0') || !source.includes('SET "_prog=node"')) return;
  const matches = [...source.matchAll(/"%_prog%"\s+"%dp0%\\(node_modules\\[A-Za-z0-9_@.\\/-]+\.(?:c?js|mjs))"\s+%\*/g)];
  if (matches.length !== 1) return;
  const relative = matches[0][1];
  if (relative.split(/[\\/]/).includes('..')) return;
  return path.resolve(directory, relative);
}

export type CouncilVerdict = 'GREEN' | 'YELLOW' | 'RED' | 'DEADLOCK';

export interface ParsedToolResult {
  verdict?: CouncilVerdict;
  isSuccess: boolean;
  isError: boolean;
  isPendingPhase2?: boolean;
  message: string;
  raw: string;
}

/**
 * Parse structured verdict from tool output using word boundaries and JSON inspection (F07).
 * Avoids false matches (e.g. "We do not approve RED" or "approve" substring in reason).
 */
export function parseToolOutput(output: string): ParsedToolResult {
  const trimmed = output.trim();
  const base: ParsedToolResult = { isSuccess: false, isError: false, message: trimmed.slice(0, 300), raw: trimmed };
  let value: any;
  try { value = JSON.parse(trimmed.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch {
    return { ...base, isError: /^(error|failed|exception)\b/i.test(trimmed), message: trimmed ? 'Unverified response: no structured tool result' : 'No tool result received' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
  // A pending reasoning request is never a completed result, even with a provisional verdict.
  const pending = !!(value.debate_prompt || value.agent_prompt || value.output_prompt || value.prompts || value.llm_upgrade || value.status === 'pending' || ['agentic', 'agentic_loop'].includes(value.mode));
  const returnedVerdict = String(value.verdict ?? '').toUpperCase();
  const rawVerdict = ({ PASS: 'GREEN', WARN: 'YELLOW', FAIL: 'RED' } as Record<string,string>)[returnedVerdict] ?? returnedVerdict;
  const verdict = ['GREEN', 'YELLOW', 'RED', 'DEADLOCK'].includes(rawVerdict) ? rawVerdict as CouncilVerdict : undefined;
  const failed = value.isError === true || value.success === false || !!value.error || ['fail', 'failed', 'error'].includes(value.status);
  const success = value.success === true || ['success', 'completed', 'pass', 'warn'].includes(value.status) || verdict === 'GREEN' || verdict === 'YELLOW';
  return { ...base, verdict, isPendingPhase2: pending, isSuccess: !pending && !failed && success,
    isError: failed || verdict === 'RED' || verdict === 'DEADLOCK' };
}

/** Accept only a tool_result correlated to an actual matching tool_use event. */
export function extractToolResult(stream: string, toolName: string, expectedInput?: Record<string, unknown>): string | undefined {
  const calls = new Set<string>();
  let result: string | undefined;
  for (const line of stream.split(/\r?\n/)) {
    let event: any;
    try { event = JSON.parse(line); } catch { continue; }
    if (!Array.isArray(event.message?.content)) continue;
    for (const block of event.message.content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'tool_use' && block.name === toolName && typeof block.id === 'string') {
        if (expectedInput) {
          const supplied = block.input;
          const original = JSON.parse(JSON.stringify(expectedInput));
          const phaseFields = new Set(['agent_response', 'agent_responses', 'agent_outputs']);
          if (!supplied || typeof supplied !== 'object' ||
              !Object.entries(original).every(([key, value]) => isDeepStrictEqual(supplied[key], value)) ||
              Object.keys(supplied).some(key => !(key in original) && !phaseFields.has(key))) {
            throw new Error('Backend tool arguments differed from the requested input; result cannot be verified.');
          }
        }
        calls.add(block.id);
      }
      if (block.type === 'tool_result' && calls.has(block.tool_use_id)) {
        const content = typeof block.content === 'string' ? block.content :
          Array.isArray(block.content) ? block.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') : '';
        result = block.is_error ? JSON.stringify({ isError: true, error: content }) : content;
      }
    }
  }
  return result;
}

export interface ProcessCancellationToken {
  readonly isCancellationRequested?: boolean;
  onCancellationRequested(listener: (e: any) => any): { dispose(): void } | void;
}

export interface SpawnOptions {
  cwd?: string;
  timeoutMs?: number;
  cancellationToken?: ProcessCancellationToken;
  jobKey?: string;
  input?: string;
}

export type LogAppender = (line: string) => void;

export function resolveInvocation(command: string, args: string[]): { command: string; args: string[] } {
  let resolved = resolveExecutable(command);
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    const entry = npmShimEntry(readFileSync(resolved, 'utf8'), path.dirname(resolved));
    if (!entry || !existsSync(entry)) throw new Error(`Cannot safely launch ${command}: unrecognized npm launcher.`);
    const adjacentNode = path.join(path.dirname(resolved), 'node.exe');
    resolved = existsSync(adjacentNode) ? adjacentNode : resolveExecutable('node');
    if (!/\.exe$/i.test(resolved)) throw new Error('Native Node executable not found');
    args = [entry, ...args];
  }
  return { command: resolved, args };
}

/**
 * Run an executable safely with an argv array (no shell), bounded buffers, timeout,
 * and cancellation support.
 */
export function spawnProcess(
  command: string,
  args: string[],
  logAppender?: LogAppender,
  opts: SpawnOptions = {},
): Promise<string> {
  if (opts.cancellationToken?.isCancellationRequested) return Promise.reject(new Error('Operation cancelled by user'));
  const jobKey = opts.jobKey ?? `${command} ${args[0] ?? ''}`;
  if (runningJobs.has(jobKey)) {
    return Promise.reject(new Error(`Operation "${jobKey}" is already running.`));
  }
  runningJobs.add(jobKey);

  let resolved: string;
  try { const invocation = resolveInvocation(command, args); resolved = invocation.command; args = invocation.args; }
  catch (error) { runningJobs.delete(jobKey); return Promise.reject(error); }
  const configuredTimeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(configuredTimeout) ? Math.min(600000, Math.max(1, configuredTimeout)) : DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let proc: ChildProcess;
    let timer: NodeJS.Timeout | null = null;
    let isSettled = false;
    let cancellation: { dispose(): void } | void;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      cancellation?.dispose();
      activeProcesses.delete(proc);
      cancellations.delete(proc);
      runningJobs.delete(jobKey);
    };
    try {
      proc = spawn(resolved, args, {
        shell: false,
        windowsHide: true,
        cwd: opts.cwd,
      });
      activeProcesses.add(proc);
    } catch (err: unknown) {
      runningJobs.delete(jobKey);
      const msg = err instanceof Error ? err.message : String(err);
      return reject(new Error(`Failed to spawn ${command}: ${msg}`));
    }

    proc.stdin?.on('error', () => { /* process exit handles closed stdin */ });
    proc.stdin?.end(opts.input);
    let stdout = '';
    let stderr = '';
    const abort = (message: string) => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      terminateProcess(proc);
      reject(new Error(message));
    };
    cancellations.set(proc, () => abort('Operation cancelled by user'));

    proc.stdout?.on('data', (d: Buffer) => {
      if (stdout.length + d.length > MAX_BUFFER) { abort('Operation output exceeded the 1 MB limit'); return; }
      if (stdout.length < MAX_BUFFER) {
        stdout += d.toString().slice(0, MAX_BUFFER - stdout.length);
      }
    });

    proc.stderr?.on('data', (d: Buffer) => {
      if (stderr.length + d.length > MAX_BUFFER) { abort('Operation output exceeded the 1 MB limit'); return; }
      if (stderr.length < MAX_BUFFER) {
        stderr += d.toString().slice(0, MAX_BUFFER - stderr.length);
      }
    });

    timer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        cleanup();
        terminateProcess(proc);
        logAppender?.(`[${command}] process timed out after ${timeoutMs / 1000}s`);
        reject(new Error(`Operation timed out after ${timeoutMs / 1000}s`));
      }
    }, timeoutMs);

    if (opts.cancellationToken) {
      cancellation = opts.cancellationToken.onCancellationRequested(() => {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          terminateProcess(proc);
          logAppender?.(`[${command}] operation cancelled by user.`);
          reject(new Error('Operation cancelled by user'));
        }
      });
    }

    proc.on('close', code => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        logAppender?.(`[${command}] exited ${code}: ${stderr.slice(0, 300)}`);
        reject(new Error(`${command} exited with code ${code}`));
      }
    });

    proc.on('error', err => {
      if (isSettled) return;
      isSettled = true;
      cleanup();
      logAppender?.(`[${command}] spawn error: ${err.message}`);
      reject(err);
    });
  });
}

/** Resolve the current git branch for the workspace. */
export function currentBranch(cwd: string): Promise<string> {
  return spawnProcess('git', ['rev-parse', '--abbrev-ref', 'HEAD'], undefined, { cwd })
    .catch(() => 'HEAD');
}

/** Try detecting GitHub PR URL from git remote origin and current branch. */
export async function detectPrUrl(cwd: string): Promise<string | undefined> {
  try {
    const url = await spawnProcess('gh', ['pr', 'view', '--json', 'url', '--jq', '.url'], undefined, { cwd, timeoutMs: 15000 });
    return /^https:\/\/github\.com\/[^/?#\s]+\/[^/?#\s]+\/pull\/\d+\/?$/.test(url) ? url : undefined;
  } catch {
    return undefined;
  }
}
