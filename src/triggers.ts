import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { watch as fsWatch, FSWatcher } from 'node:fs';
import { join } from 'node:path';

function runClaude(args: string[], outputChannel: vscode.OutputChannel): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, { shell: true, windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) {
        outputChannel.appendLine(`[trigger] claude exited ${code}: ${stderr.slice(0, 200)}`);
        reject(new Error(`claude exited ${code}`));
      } else {
        resolve(stdout.trim());
      }
    });
    proc.on('error', reject);
  });
}

let reviewDebounce: ReturnType<typeof setTimeout> | undefined;
let ciGateDebounce: ReturnType<typeof setTimeout> | undefined;
let gitIndexWatcher: FSWatcher | null = null;

export function registerAutoReviewTrigger(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
): void {
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (!vscode.workspace.getConfiguration('veto').get<boolean>('autoReview', false)) return;
      clearTimeout(reviewDebounce);
      reviewDebounce = setTimeout(async () => {
        const filePath = doc.uri.fsPath;
        outputChannel.appendLine(`[autoReview] Reviewing ${filePath}`);
        try {
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Window, title: 'Veto: reviewing…' },
            async () => {
              const out = await runClaude(
                ['--allowedTools', 'mcp__veto__veto_code_review', '-p',
                  `Run veto_code_review on this file: ${filePath}`],
                outputChannel,
              );
              outputChannel.appendLine(`[autoReview] ${out.slice(0, 500)}`);
              const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
              const openCouncil = 'Open Council';
              if (out.includes('RED')) {
                vscode.window.showWarningMessage(`Veto review: RED — ${fileName}`, openCouncil)
                  .then(a => { if (a === openCouncil) vscode.commands.executeCommand('veto-council.focus'); });
              } else if (out.includes('GREEN')) {
                vscode.window.showInformationMessage(`Veto review: GREEN — ${fileName}`, openCouncil)
                  .then(a => { if (a === openCouncil) vscode.commands.executeCommand('veto-council.focus'); });
              } else {
                vscode.window.showInformationMessage(`Veto review done — ${fileName}`, openCouncil)
                  .then(a => { if (a === openCouncil) vscode.commands.executeCommand('veto-council.focus'); });
              }
            },
          );
        } catch (e) {
          outputChannel.appendLine(`[autoReview] error: ${e instanceof Error ? e.message : String(e)}`);
        }
      }, 1000);
    }),
  );
}

export function registerGitStageTrigger(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
): void {
  function startWatcher(workspaceRoot: string): void {
    gitIndexWatcher?.close();
    gitIndexWatcher = null;
    const gitIndex = join(workspaceRoot, '.git', 'index');
    if (!existsSync(gitIndex)) return;
    try {
      gitIndexWatcher = fsWatch(gitIndex, { persistent: false }, () => {
        const cfg = vscode.workspace.getConfiguration('veto');
        const ciGateEnabled   = cfg.get<boolean>('autoCiGate', false);
        const secretsEnabled  = cfg.get<boolean>('autoSecretsOnStage', false);
        if (!ciGateEnabled && !secretsEnabled) return;
        clearTimeout(ciGateDebounce);
        ciGateDebounce = setTimeout(async () => {
          const openCouncil = 'Open Council';
          const openLog = 'Open Log';

          if (ciGateEnabled) {
            outputChannel.appendLine(`[autoCiGate] Staged changes detected in ${workspaceRoot}`);
            try {
              await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Window, title: 'Veto: CI gate…' },
                async () => {
                  const out = await runClaude(
                    ['--allowedTools', 'mcp__veto__veto_ci_gate', '-p',
                      `Run veto_ci_gate for staged changes in project: ${workspaceRoot}`],
                    outputChannel,
                  );
                  outputChannel.appendLine(`[autoCiGate] ${out.slice(0, 500)}`);
                  const failed = out.toLowerCase().includes('fail') || out.includes('RED');
                  if (failed) {
                    vscode.window.showWarningMessage('Veto CI gate: issues found', openCouncil)
                      .then(a => { if (a === openCouncil) vscode.commands.executeCommand('veto-council.focus'); });
                  } else {
                    vscode.window.showInformationMessage('Veto CI gate: passed', openCouncil)
                      .then(a => { if (a === openCouncil) vscode.commands.executeCommand('veto-council.focus'); });
                  }
                },
              );
            } catch (e) {
              outputChannel.appendLine(`[autoCiGate] error: ${e instanceof Error ? e.message : String(e)}`);
            }
          }

          if (secretsEnabled) {
            outputChannel.appendLine(`[autoSecrets] Scanning staged changes for secrets in ${workspaceRoot}`);
            try {
              await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Window, title: 'Veto: scanning secrets…' },
                async () => {
                  const out = await runClaude(
                    ['--allowedTools', 'mcp__veto__veto_secrets_scan', '-p',
                      `Run veto_secrets_scan for project: ${workspaceRoot}`],
                    outputChannel,
                  );
                  outputChannel.appendLine(`[autoSecrets] ${out.slice(0, 500)}`);
                  const found = out.toLowerCase().includes('secret') || out.toLowerCase().includes('leak') || out.toLowerCase().includes('token') || out.toLowerCase().includes('key');
                  if (found) {
                    vscode.window.showWarningMessage('Veto: possible secrets detected in staged files', openLog)
                      .then(a => { if (a === openLog) vscode.commands.executeCommand('veto.openLog'); });
                  } else {
                    vscode.window.showInformationMessage('Veto secrets scan: clean');
                  }
                },
              );
            } catch (e) {
              outputChannel.appendLine(`[autoSecrets] error: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }, 1500);
      });
      gitIndexWatcher.on('error', () => { gitIndexWatcher = null; });
    } catch { /* ignore if not watchable */ }
  }

  const rootFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (rootFolder) startWatcher(rootFolder);

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (root) startWatcher(root);
    }),
    {
      dispose: () => {
        gitIndexWatcher?.close();
        clearTimeout(ciGateDebounce);
        clearTimeout(reviewDebounce);
      },
    },
  );
}
