// Action helpers. Enforces hard rule (council, CWE-78): NEVER build a shell string from
// user input. One-shot Veto tools run via spawn(argv) with shell:false and windowsHide:true.
// Lifecycle contracts (F06): timeouts, buffer bounds, cancellation, running-job tracking,
// and clean child-process disposal.
// Result contracts (F07): structured verdict parsing (GREEN, YELLOW, RED, DEADLOCK).

import * as vscode from 'vscode';
import {
  spawnProcess,
  cancelAllProcesses,
  resolveExecutable,
  parseToolOutput,
  currentBranch,
  detectPrUrl,
  type CouncilVerdict,
  type ParsedToolResult,
  type SpawnOptions,
} from './process';

export {
  spawnProcess,
  cancelAllProcesses,
  resolveExecutable,
  parseToolOutput,
  currentBranch,
  detectPrUrl,
  type CouncilVerdict,
  type ParsedToolResult,
  type SpawnOptions,
};

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const PLATFORMS = new Set(['claude', 'gemini', 'codex']);

/** Run `claude` as a one-shot with an argv array (no shell). Streams to the output channel. */
export function spawnClaude(
  args: string[],
  outputChannel: vscode.OutputChannel,
  cwd?: string,
  cancellationToken?: vscode.CancellationToken,
): Promise<string> {
  return spawnProcess('claude', args, line => outputChannel.appendLine(line), { cwd, cancellationToken });
}

/** Run a one-shot Veto tool with a progress spinner, cancellation, and verdict-aware notification. */
export async function runVetoTool(
  outputChannel: vscode.OutputChannel,
  opts: { title: string; args: string[]; cwd?: string; label?: string },
): Promise<void> {
  const tag = opts.label ?? 'Veto';
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: opts.title, cancellable: true },
      async (_progress, token) => {
        const out = await spawnClaude(opts.args, outputChannel, opts.cwd, token);
        outputChannel.appendLine(`[${tag}] ${out.slice(0, 800)}`);

        const result = parseToolOutput(out);
        if (result.verdict === 'DEADLOCK') {
          vscode.window.showWarningMessage(`${tag}: DEADLOCK — Human decision required`, 'Open Log')
            .then(a => a && outputChannel.show(true));
        } else if (result.verdict === 'RED') {
          vscode.window.showErrorMessage(`${tag}: RED (blocked)`, 'Open Log')
            .then(a => a && outputChannel.show(true));
        } else if (result.verdict === 'YELLOW') {
          vscode.window.showWarningMessage(`${tag}: YELLOW (warnings found)`, 'Open Log')
            .then(a => a && outputChannel.show(true));
        } else if (result.verdict === 'GREEN') {
          vscode.window.showInformationMessage(`${tag}: GREEN (approved)`, 'Open Log')
            .then(a => a && outputChannel.show(true));
        } else if (result.isError) {
          vscode.window.showErrorMessage(`${tag}: completed with errors — see log`, 'Open Log')
            .then(a => a && outputChannel.show(true));
        } else {
          vscode.window.showInformationMessage(`${tag}: completed`, 'Open Log')
            .then(a => a && outputChannel.show(true));
        }
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('cancelled') || msg.includes('cancelled by user')) {
      vscode.window.showInformationMessage(`${tag}: cancelled`);
      return;
    }
    vscode.window.showErrorMessage(`Veto: ${opts.title} failed — ${msg}`);
  }
}

/**
 * Resume a session in an interactive terminal with explicit cwd and terminal reuse (F06).
 */
export function resumeSessionInTerminal(sessionId: string, platform = 'claude', cwd?: string): void {
  if (!SAFE_ID.test(sessionId)) {
    vscode.window.showErrorMessage('Veto: refusing to resume — session ID has unexpected characters.');
    return;
  }
  const p = PLATFORMS.has(platform.toLowerCase()) ? platform.toLowerCase() : 'claude';
  let cmd: string;
  if (p === 'gemini') {
    cmd = `gemini -p "veto_continue ${sessionId}"`;
  } else if (p === 'codex') {
    cmd = `codex "veto_continue ${sessionId}"`;
  } else {
    // Interactive Claude session resuming the context
    cmd = `claude --allowedTools "mcp__veto__veto_continue" -p "veto_continue ${sessionId}"`;
  }

  const label = p.charAt(0).toUpperCase() + p.slice(1);
  const termName = `Veto Resume (${label})`;

  // Reuse existing active terminal with the same name if available
  let terminal = vscode.window.terminals.find(t => t.name === termName && t.exitStatus === undefined);
  if (!terminal) {
    terminal = vscode.window.createTerminal({ name: termName, cwd });
  }
  terminal.show(false);
  terminal.sendText(cmd, true);
}
