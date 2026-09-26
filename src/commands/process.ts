// Subprocess execution, executable resolution, and structured verdict parsing (F05, F06, F07).
// Decoupled from VS Code APIs to allow full unit testability under Node.js test runner.

import { spawn, execFileSync, type ChildProcess } from 'node:child_process';

const MAX_BUFFER = 1024 * 1024; // 1 MB buffer limit to prevent runaway memory
const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes

// Track running processes for clean cancellation and disposal (F06)
const activeProcesses = new Set<ChildProcess>();
const runningJobs = new Set<string>();

export function getActiveProcessesCount(): number {
  return activeProcesses.size;
}

export function getRunningJobsCount(): number {
  return runningJobs.size;
}

export function cancelAllProcesses(): void {
  for (const proc of activeProcesses) {
    try {
      proc.kill('SIGTERM');
    } catch { /* ignored */ }
  }
  activeProcesses.clear();
  runningJobs.clear();
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
  if (!trimmed) {
    return { isSuccess: true, isError: false, message: 'Completed with empty output', raw: '' };
  }

  const isPending = /"debate_prompt"|"agent_responses"|"llm_upgrade"/i.test(trimmed);

  // 1. Try extracting structured JSON verdict if output contains a JSON block
  const jsonMatch = trimmed.match(/\{[\s\S]*"verdict"\s*:\s*"([^"]+)"[\s\S]*\}/);
  if (jsonMatch) {
    const rawV = jsonMatch[1].toUpperCase();
    if (rawV === 'GREEN' || rawV === 'YELLOW' || rawV === 'RED' || rawV === 'DEADLOCK') {
      return {
        verdict: rawV as CouncilVerdict,
        isSuccess: rawV === 'GREEN' || rawV === 'YELLOW',
        isError: rawV === 'RED' || rawV === 'DEADLOCK',
        isPendingPhase2: isPending,
        message: trimmed.slice(0, 300),
        raw: trimmed,
      };
    }
  }

  // 2. Check for explicit "Verdict: <VAL>" pattern (case-insensitive)
  const explicitMatch = trimmed.match(/(?:\*{0,2}verdict\*{0,2}\s*[:=]\s*\*{0,2})(GREEN|YELLOW|RED|DEADLOCK)\b/i);
  if (explicitMatch) {
    const v = explicitMatch[1].toUpperCase() as CouncilVerdict;
    return {
      verdict: v,
      isSuccess: v === 'GREEN' || v === 'YELLOW',
      isError: v === 'RED' || v === 'DEADLOCK',
      isPendingPhase2: isPending,
      message: trimmed.slice(0, 300),
      raw: trimmed,
    };
  }

  // 3. Check for standalone lines starting with verdict keyword
  const lineMatch = trimmed.match(/^(?:#+\s*)?(DEADLOCK|RED|YELLOW|GREEN)\b/im);
  if (lineMatch) {
    const v = lineMatch[1].toUpperCase() as CouncilVerdict;
    return {
      verdict: v,
      isSuccess: v === 'GREEN' || v === 'YELLOW',
      isError: v === 'RED' || v === 'DEADLOCK',
      isPendingPhase2: isPending,
      message: trimmed.slice(0, 300),
      raw: trimmed,
    };
  }

  // 4. Word boundary regex check in conservative precedence order: DEADLOCK > RED > YELLOW > GREEN
  let verdict: CouncilVerdict | undefined;
  if (/\bDEADLOCK\b/i.test(trimmed)) {
    verdict = 'DEADLOCK';
  } else if (/\bRED\b/i.test(trimmed)) {
    verdict = 'RED';
  } else if (/\bYELLOW\b/i.test(trimmed)) {
    verdict = 'YELLOW';
  } else if (/\bGREEN\b/i.test(trimmed)) {
    verdict = 'GREEN';
  }

  const hasExplicitErrorWord = /\b(error|failed|exception)\b/i.test(trimmed);
  const isError = (hasExplicitErrorWord && !verdict) || verdict === 'RED' || verdict === 'DEADLOCK';
  const isSuccess = !isError && (verdict === 'GREEN' || verdict === 'YELLOW' || !verdict);

  return {
    verdict,
    isSuccess,
    isError,
    isPendingPhase2: isPending,
    message: trimmed.slice(0, 300),
    raw: trimmed,
  };
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
}

export type LogAppender = (line: string) => void;

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
  const jobKey = opts.jobKey ?? `${command} ${args[0] ?? ''}`;
  if (runningJobs.has(jobKey)) {
    return Promise.reject(new Error(`Operation "${jobKey}" is already running.`));
  }
  runningJobs.add(jobKey);

  const resolved = resolveExecutable(command);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let proc: ChildProcess;
    let timer: NodeJS.Timeout | null = null;
    let isSettled = false;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      activeProcesses.delete(proc);
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

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < MAX_BUFFER) {
        stdout += d.toString();
      }
    });

    proc.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < MAX_BUFFER) {
        stderr += d.toString();
      }
    });

    timer = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        cleanup();
        try { proc.kill('SIGTERM'); } catch { /* ignore */ }
        logAppender?.(`[${command}] process timed out after ${timeoutMs / 1000}s`);
        reject(new Error(`Operation timed out after ${timeoutMs / 1000}s`));
      }
    }, timeoutMs);

    if (opts.cancellationToken) {
      opts.cancellationToken.onCancellationRequested(() => {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          try { proc.kill('SIGTERM'); } catch { /* ignore */ }
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
    const remoteUrl = await spawnProcess('git', ['remote', 'get-url', 'origin'], undefined, { cwd });
    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/i);
    if (!match) return undefined;
    const owner = match[1];
    const repo = match[2];
    return `https://github.com/${owner}/${repo}/pull/`;
  } catch {
    return undefined;
  }
}
