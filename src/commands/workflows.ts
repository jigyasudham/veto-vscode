import * as vscode from 'vscode';
import { runStructuredTool } from './veto';

/** Draft-only workflows: the backend generates text; no commit or PR is created. */
export function registerDraftWorkflows(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  getProjectDir: () => string | undefined,
  beforeWorkflow?: (projectDir?: string) => Promise<void>,
): void {
  for (const kind of ['commit', 'pr'] as const) {
    context.subscriptions.push(vscode.commands.registerCommand(
      kind === 'commit' ? 'veto.draftCommitMessage' : 'veto.draftPrDescription',
      async () => {
        if (!vscode.workspace.isTrusted) {
          vscode.window.showWarningMessage('Veto: trust this workspace before generating drafts.');
          return;
        }
        const project = getProjectDir();
        if (!project) { vscode.window.showWarningMessage('Veto: select a project first.'); return; }
        const input: Record<string, unknown> = { project_dir: project };
        if (kind === 'pr') {
          const base = await vscode.window.showInputBox({ prompt: 'Base branch for PR description draft', value: 'main',
            validateInput: value => /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) && !value.includes('..') ? null : 'Enter a branch name' });
          if (!base) return;
          input.base_branch = base;
        }
        try {
          await beforeWorkflow?.(project);
        } catch (error) {
          vscode.window.showErrorMessage(`Veto: ${error instanceof Error ? error.message : String(error)}`);
          return;
        }
        await runStructuredTool(outputChannel, {
          title: kind === 'commit' ? 'Veto: drafting commit message' : 'Veto: drafting PR description',
          label: 'Veto Draft', cwd: project,
          tool: kind === 'commit' ? 'veto_commit_message' : 'veto_pr_description', input,
        });
      },
    ));
  }
}
