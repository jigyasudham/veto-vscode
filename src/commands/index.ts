import * as vscode from 'vscode';
import type { VetoStore } from '../core/VetoStore';
import { visibilityReport } from '../core/visibility';
import { runStructuredTool, resumeSessionInTerminal, spawnProcess, detectPrUrl } from './veto';
import { registerDetailCommands } from './details';
import { registerCatalogCommands } from './catalog';
import { registerDraftWorkflows } from './workflows';

export interface CommandDeps {
  store: VetoStore;
  outputChannel: vscode.OutputChannel;
  openHud: () => void;
  getProjectDir?: () => string | undefined;
}

export function registerCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
  const { store, outputChannel, openHud } = deps;
  const project = () => deps.getProjectDir?.() ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const register = (name: string, callback: (...args: any[]) => unknown, action = false) => {
    context.subscriptions.push(vscode.commands.registerCommand(name, async (...args: any[]) => {
      if (action && !vscode.workspace.isTrusted) {
        void vscode.window.showWarningMessage('Veto: trust this workspace before launching an action.');
        return;
      }
      try { return await callback(...args); }
      catch (error) { void vscode.window.showErrorMessage('Veto: ' + (error instanceof Error ? error.message : String(error))); }
    }));
  };
  const call = async (tool: string, input: Record<string, unknown>, title: string, cwd = project()) => {
    const result = await runStructuredTool(outputChannel, { title, cwd, tool, input });
    store.refresh(true);
    return result;
  };
  const bounded = (text: string) => {
    if (text.length > 200_000) throw new Error('Input exceeds 200,000 characters. Select a smaller file or change set; no partial scan was submitted.');
    return text;
  };
  const editorProject = (editor: vscode.TextEditor) => vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath ?? project();

  registerDetailCommands(context, { store, getProjectDir: project });
  registerCatalogCommands(context, project);
  registerDraftWorkflows(context, outputChannel, project);
  register('veto.setupDiagnostics', async () => {
    const content = visibilityReport(store.getSnapshot(), {
      extensionVersion: context.extension.packageJSON.version ?? 'Unknown', runtimeVersion: process.versions.node,
      trusted: vscode.workspace.isTrusted, remoteName: vscode.env.remoteName, projectDir: project(),
    });
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content, language: 'plaintext' }), { preview: true });
  });
  register('veto.openHud', openHud);
  register('veto.refresh', () => store.refresh(true));
  register('veto.openLog', () => outputChannel.show(true));
  register('veto.openInstallDocs', () => vscode.env.openExternal(vscode.Uri.parse('https://www.npmjs.com/package/@jigyasudham/veto')));
  register('veto.copySessionId', async (id: unknown) => {
    if (typeof id !== 'string' || id.length > 512) return;
    await vscode.env.clipboard.writeText(id);
    void vscode.window.showInformationMessage('Veto: copied to clipboard');
  });
  register('veto.continueSession', async (id?: string, platform?: string, cwd?: string) => {
    if (!id) { await vscode.commands.executeCommand('veto.browseSessions'); return; }
    await resumeSessionInTerminal(id, platform, cwd ?? project());
  }, true);
  register('veto.saveSession', async () => {
    const summary = await vscode.window.showInputBox({ prompt: 'Save a summary-only checkpoint (does not capture another terminal conversation)', ignoreFocusOut: true });
    if (!summary?.trim()) return;
    const dir = project();
    if (!dir) throw new Error('Open or select a project before saving a checkpoint.');
    await call('veto_session_save', { summary: summary.trim(), project_dir: dir, platform: 'claude', auto_summarize: false }, 'Veto: save summary checkpoint');
  }, true);
  register('veto.councilDebate', async () => {
    const topic = await vscode.window.showInputBox({ prompt: 'Council debate topic (Claude)', ignoreFocusOut: true });
    if (topic?.trim()) await call('veto_council_debate', { task: topic.trim(), project_dir: project() }, 'Veto: council debate');
  }, true);
  register('veto.reviewFile', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) throw new Error('Open a file to review.');
    const code = bounded(editor.document.getText());
    if (!code.trim()) throw new Error('The active file is empty.');
    await call('veto_code_review', { code, file_path: editor.document.uri.fsPath }, 'Veto: review editor buffer', editorProject(editor));
  }, true);
  register('veto.reviewPR', async () => {
    const cwd = project();
    if (!cwd) throw new Error('Open a project to review its PR.');
    const value = await detectPrUrl(cwd);
    const prUrl = await vscode.window.showInputBox({ prompt: 'GitHub pull request URL', value: value ?? '', ignoreFocusOut: true,
      validateInput: val => /^https:\/\/github\.com\/[^/?#\s]+\/[^/?#\s]+\/pull\/\d+\/?$/.test(val.trim()) ? null : 'Enter a complete GitHub pull request URL',
    });
    if (prUrl) await call('veto_pr_review', { pr_url: prUrl.trim() }, 'Veto: review PR', cwd);
  }, true);
  register('veto.scanSecrets', async () => {
    const editor = vscode.window.activeTextEditor;
    const cwd = project();
    const choices = [
      ...(editor ? [{ label: 'Active editor buffer', scanKind: 'active' }] : []),
      ...(cwd ? [{ label: 'Staged changes', scanKind: 'staged' }, { label: 'All tracked changes against HEAD', scanKind: 'working' }] : []),
    ];
    const choice = await vscode.window.showQuickPick(choices, { placeHolder: 'Choose the exact secret-scan scope' });
    if (!choice) return;
    const text = bounded(choice.scanKind === 'active' && editor ? editor.document.getText() : await spawnProcess('git', choice.scanKind === 'staged' ? ['diff', '--cached', '--no-ext-diff', '--no-textconv'] : ['diff', 'HEAD', '--no-ext-diff', '--no-textconv'], undefined, { cwd }));
    if (!text.trim()) { void vscode.window.showInformationMessage('Veto: no content to scan.'); return; }
    await call('veto_secrets_scan', { text, ...(choice.scanKind === 'active' && editor ? { file_path: editor.document.uri.fsPath } : {}) }, 'Veto: scan secrets', choice.scanKind === 'active' && editor ? editorProject(editor) : cwd);
  }, true);
  register('veto.searchMemory', () => vscode.commands.executeCommand('veto.browseMemory'));
}
