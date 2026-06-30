// Action helpers. The hard rule here (council, CWE-78): NEVER build a shell string from
// user input. One-shot Veto tools run via spawn(argv) with shell:false so arguments are
// passed as a vector and never re-parsed. The one interactive case (resume in a terminal)
// only ever uses values validated against a strict allowlist — no free text.

import * as vscode from 'vscode';
import { spawn } from 'node:child_process';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const PLATFORMS = new Set(['claude', 'gemini', 'codex']);

/** Run `claude` as a one-shot with an argv array (no shell). Streams to the output channel. */
export function spawnClaude(
  args: string[],
  outputChannel: vscode.OutputChannel,
  cwd?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, { shell: false, windowsHide: true, cwd });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve(stdout.trim());
      else { outputChannel.appendLine(`[claude] exited ${code}: ${stderr.slice(0, 300)}`); reject(new Error(`claude exited ${code}`)); }
    });
    proc.on('error', err => {
      outputChannel.appendLine(`[claude] spawn error: ${err.message} — is the claude CLI installed?`);
      reject(err);
    });
  });
}

/** Run a one-shot Veto tool with a progress spinner and a verdict-aware notification. */
export async function runVetoTool(
  outputChannel: vscode.OutputChannel,
  opts: { title: string; args: string[]; cwd?: string; label?: string },
): Promise<void> {
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: opts.title, cancellable: false },
      async () => {
        const out = await spawnClaude(opts.args, outputChannel, opts.cwd);
        outputChannel.appendLine(`[${opts.label ?? 'veto'}] ${out.slice(0, 800)}`);
        const tag = opts.label ?? 'Veto';
        if (out.includes('RED')) {
          vscode.window.showWarningMessage(`${tag}: RED`, 'Open Log').then(a => a && outputChannel.show(true));
        } else if (out.includes('GREEN')) {
          vscode.window.showInformationMessage(`${tag}: GREEN`, 'Open Log').then(a => a && outputChannel.show(true));
        } else {
          vscode.window.showInformationMessage(`${tag}: done`, 'Open Log').then(a => a && outputChannel.show(true));
        }
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    vscode.window.showErrorMessage(`Veto: ${opts.title} failed — ${msg}`);
  }
}

/**
 * Resume a session in an interactive terminal. Inputs are validated against allowlists,
 * so the (necessarily string-based) terminal command can never carry injected shell syntax.
 */
export function resumeSessionInTerminal(sessionId: string, platform: string): void {
  if (!SAFE_ID.test(sessionId)) {
    vscode.window.showErrorMessage('Veto: refusing to resume — session ID has unexpected characters.');
    return;
  }
  const p = PLATFORMS.has(platform.toLowerCase()) ? platform.toLowerCase() : 'claude';
  let cmd: string;
  if (p === 'gemini') cmd = `gemini -p "veto_continue ${sessionId}"`;
  else if (p === 'codex') cmd = `codex "veto_continue ${sessionId}"`;
  else cmd = `claude --allowedTools "mcp__veto__veto_continue" -p "veto_continue ${sessionId}"`;

  const label = p.charAt(0).toUpperCase() + p.slice(1);
  const terminal = vscode.window.createTerminal({ name: `Veto Resume (${label})` });
  terminal.show(false);
  terminal.sendText(cmd, true);
}

/** Resolve the current git branch for the workspace (used by PR review). */
export function currentBranch(cwd: string): Promise<string> {
  return new Promise(resolve => {
    const proc = spawn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { shell: false, windowsHide: true, cwd });
    let out = '';
    proc.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('close', code => resolve(code === 0 ? out.trim() : 'HEAD'));
    proc.on('error', () => resolve('HEAD'));
  });
}
