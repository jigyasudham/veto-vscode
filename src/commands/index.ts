// Registers every Veto command. Action logic lives in ./veto (spawn-argv helpers);
// this module only wires commands to those helpers + the store/HUD.

import * as vscode from 'vscode';
import type { VetoStore } from '../core/VetoStore';
import { runVetoTool, resumeSessionInTerminal, currentBranch } from './veto';

export interface CommandDeps {
  store: VetoStore;
  outputChannel: vscode.OutputChannel;
  openHud: () => void;
}

const INSTALL_URL = 'https://www.npmjs.com/package/@jigyasudham/veto';

export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  const { store, outputChannel, openHud } = deps;
  const workspaceRoot = () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  context.subscriptions.push(
    vscode.commands.registerCommand('veto.openHud', () => openHud()),

    vscode.commands.registerCommand('veto.refresh', () => store.refresh()),

    vscode.commands.registerCommand('veto.openLog', () => outputChannel.show(true)),

    vscode.commands.registerCommand('veto.openInstallDocs', () =>
      vscode.env.openExternal(vscode.Uri.parse(INSTALL_URL))),

    vscode.commands.registerCommand('veto.copySessionId', (id: string) => {
      if (!id) return;
      vscode.env.clipboard.writeText(id).then(() =>
        vscode.window.showInformationMessage(`Copied: ${id.slice(0, 40)}`));
    }),

    vscode.commands.registerCommand('veto.continueSession', (id: string, platform = 'claude') =>
      resumeSessionInTerminal(id, platform)),

    vscode.commands.registerCommand('veto.saveSession', async () => {
      const session = store.getSnapshot().session;
      const summary = await vscode.window.showInputBox({
        prompt: 'Session summary',
        placeHolder: 'What did you accomplish this session?',
        value: session?.summary ?? '',
        ignoreFocusOut: true,
      });
      if (!summary?.trim()) return;
      const dir = workspaceRoot();
      const prompt = `Save this veto session using veto_session_save. Summary: "${summary.trim()}"`
        + (dir ? ` Project dir: ${dir}` : '');
      // summary is a single argv element — spawn(shell:false) never re-parses it.
      await runVetoTool(outputChannel, {
        title: 'Veto: saving session…', label: 'Veto Save', cwd: dir,
        args: ['--allowedTools', 'mcp__veto__veto_session_save', '-p', prompt],
      });
    }),

    vscode.commands.registerCommand('veto.councilDebate', async () => {
      const topic = await vscode.window.showInputBox({
        prompt: 'Council debate topic', placeHolder: 'What should the council debate?', ignoreFocusOut: true,
      });
      if (!topic?.trim()) return;
      await runVetoTool(outputChannel, {
        title: 'Veto: council debating…', label: 'Veto Council', cwd: workspaceRoot(),
        args: ['--allowedTools', 'mcp__veto__veto_council_debate', '-p',
          `Run a Veto council debate using veto_council_debate. Topic: "${topic.trim()}"`],
      });
    }),

    vscode.commands.registerCommand('veto.reviewFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { vscode.window.showWarningMessage('Veto: no active file to review'); return; }
      const filePath = editor.document.uri.fsPath;
      await runVetoTool(outputChannel, {
        title: 'Veto: reviewing file…', label: 'Veto Review', cwd: workspaceRoot(),
        args: ['--allowedTools', 'mcp__veto__veto_code_review', '-p', `Run veto_code_review on this file: ${filePath}`],
      });
    }),

    vscode.commands.registerCommand('veto.reviewPR', async () => {
      const root = workspaceRoot();
      if (!root) { vscode.window.showWarningMessage('Veto: no workspace folder open'); return; }
      const branch = await currentBranch(root);
      await runVetoTool(outputChannel, {
        title: `Veto: reviewing PR (${branch})…`, label: 'Veto PR Review', cwd: root,
        args: ['--allowedTools', 'mcp__veto__veto_pr_review', '-p',
          `Run veto_pr_review for branch "${branch}" in project: ${root}`],
      });
    }),

    vscode.commands.registerCommand('veto.scanSecrets', async () => {
      const root = workspaceRoot();
      if (!root) { vscode.window.showWarningMessage('Veto: no workspace folder open'); return; }
      await runVetoTool(outputChannel, {
        title: 'Veto: scanning secrets…', label: 'Veto Secrets', cwd: root,
        args: ['--allowedTools', 'mcp__veto__veto_secrets_scan', '-p', `Run veto_secrets_scan for project: ${root}`],
      });
    }),

    vscode.commands.registerCommand('veto.searchMemory', async () => {
      const query = await vscode.window.showInputBox({ prompt: 'Search Veto memory', placeHolder: 'keyword or tag…' });
      if (!query?.trim()) return;
      const results = store.searchMemory(query.trim());
      if (!results.length) {
        vscode.window.showInformationMessage(`Veto: no memory entries matching "${query}"`);
        return;
      }
      const picked = await vscode.window.showQuickPick(
        results.map(r => ({
          label: r.title,
          description: r.tags.length ? r.tags.join(', ') : r.type,
          detail: r.project_dir ?? 'global',
        })),
        { placeHolder: `${results.length} result(s) for "${query}"`, matchOnDescription: true },
      );
      if (picked) {
        vscode.env.clipboard.writeText(picked.label).then(() =>
          vscode.window.showInformationMessage(`Copied: ${picked.label}`));
      }
    }),
  );
}
