// Registers every Veto command. Action logic lives in ./veto (spawn-argv helpers);
// this module only wires commands to those helpers + the store/HUD.

import * as vscode from 'vscode';
import type { VetoStore } from '../core/VetoStore';
import { runVetoTool, resumeSessionInTerminal, spawnProcess, detectPrUrl } from './veto';

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

    vscode.commands.registerCommand('veto.refresh', () => store.refresh(true)),

    vscode.commands.registerCommand('veto.openLog', () => outputChannel.show(true)),

    vscode.commands.registerCommand('veto.openInstallDocs', () =>
      vscode.env.openExternal(vscode.Uri.parse(INSTALL_URL))),

    vscode.commands.registerCommand('veto.copySessionId', (id: string) => {
      if (!id) return;
      vscode.env.clipboard.writeText(id).then(() =>
        vscode.window.showInformationMessage(`Copied: ${id.slice(0, 40)}`));
    }),

    vscode.commands.registerCommand('veto.continueSession', (id: string, platform = 'claude') =>
      resumeSessionInTerminal(id, platform, workspaceRoot())),

    vscode.commands.registerCommand('veto.saveSession', async () => {
      const session = store.getSnapshot().session;
      const summary = await vscode.window.showInputBox({
        prompt: 'Session summary checkpoint',
        placeHolder: 'What did you accomplish this session?',
        value: session?.summary ?? '',
        ignoreFocusOut: true,
      });
      if (!summary?.trim()) return;
      const dir = workspaceRoot();
      const prompt = `Save this veto session checkpoint using veto_session_save with summary: "${summary.trim()}"`
        + (dir ? ` and project_dir: "${dir}"` : '')
        + (session?.id ? ` and session_id: "${session.id}"` : '');
      // summary is a single argv element — spawn(shell:false) never re-parses it.
      await runVetoTool(outputChannel, {
        title: 'Veto: saving session checkpoint…', label: 'Veto Save', cwd: dir,
        args: ['--allowedTools', 'mcp__veto__veto_session_save', '-p', prompt],
      });
    }),

    vscode.commands.registerCommand('veto.councilDebate', async () => {
      const topic = await vscode.window.showInputBox({
        prompt: 'Council debate topic', placeHolder: 'What should the council debate?', ignoreFocusOut: true,
      });
      if (!topic?.trim()) return;
      const dir = workspaceRoot();
      const prompt = `Run a Veto council debate using veto_council_debate with task: "${topic.trim()}"`
        + (dir ? ` and project_dir: "${dir}"` : '');
      await runVetoTool(outputChannel, {
        title: 'Veto: council debating…', label: 'Veto Council', cwd: dir,
        args: ['--allowedTools', 'mcp__veto__veto_council_debate', '-p', prompt],
      });
    }),

    vscode.commands.registerCommand('veto.reviewFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { vscode.window.showWarningMessage('Veto: no active file to review'); return; }
      const filePath = editor.document.uri.fsPath;
      const fullText = editor.document.getText();
      if (!fullText.trim()) {
        vscode.window.showWarningMessage('Veto: active file is empty');
        return;
      }
      // Bound code size to stay comfortably within OS command-line limits (~20k chars)
      const maxChars = 20_000;
      const code = fullText.length > maxChars
        ? fullText.slice(0, maxChars) + `\n\n// [Veto: truncated ${fullText.length - maxChars} characters to fit command-line limits]`
        : fullText;

      await runVetoTool(outputChannel, {
        title: `Veto: reviewing ${editor.document.fileName}…`, label: 'Veto Review', cwd: workspaceRoot(),
        args: [
          '--allowedTools', 'mcp__veto__veto_code_review',
          '-p',
          `Run veto_code_review for file_path: "${filePath}" with code:\n\n${code}`,
        ],
      });
    }),

    vscode.commands.registerCommand('veto.reviewPR', async () => {
      const root = workspaceRoot();
      if (!root) { vscode.window.showWarningMessage('Veto: no workspace folder open'); return; }
      const detected = await detectPrUrl(root);
      const prUrl = await vscode.window.showInputBox({
        prompt: 'Enter GitHub Pull Request URL to review',
        placeHolder: 'https://github.com/owner/repo/pull/123',
        value: detected ?? '',
        ignoreFocusOut: true,
        validateInput: val => {
          if (!val || !val.trim()) return 'Pull Request URL is required';
          if (!/^https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/i.test(val.trim())) {
            return 'Please enter a valid GitHub pull request URL (e.g. https://github.com/owner/repo/pull/123)';
          }
          return null;
        },
      });
      if (!prUrl?.trim()) return;

      await runVetoTool(outputChannel, {
        title: 'Veto: reviewing PR…', label: 'Veto PR Review', cwd: root,
        args: ['--allowedTools', 'mcp__veto__veto_pr_review', '-p',
          `Run veto_pr_review with pr_url: "${prUrl.trim()}"`],
      });
    }),

    vscode.commands.registerCommand('veto.scanSecrets', async () => {
      const root = workspaceRoot();
      const editor = vscode.window.activeTextEditor;

      interface ScanOption extends vscode.QuickPickItem {
        action: 'active' | 'staged' | 'working';
      }

      const items: ScanOption[] = [];
      if (editor && editor.document.getText().trim()) {
        items.push({
          label: '$(file-code) Active File',
          description: editor.document.fileName,
          detail: 'Scan active editor buffer for leaked credentials and surface inline squiggles',
          action: 'active',
        });
      }
      if (root) {
        items.push({
          label: '$(git-commit) Staged Git Changes',
          detail: 'Scan git staged changes (git diff --cached) before committing',
          action: 'staged',
        });
        items.push({
          label: '$(diff) Working Tree Changes',
          detail: 'Scan unstaged working tree changes (git diff HEAD)',
          action: 'working',
        });
      }

      if (items.length === 0) {
        vscode.window.showWarningMessage('Veto: no workspace or open file to scan for secrets');
        return;
      }

      const picked = items.length === 1 ? items[0] : await vscode.window.showQuickPick(items, {
        placeHolder: 'Select target to scan for secrets',
      });
      if (!picked) return;

      let textToScan = '';
      let scanFilePath: string | undefined;

      if (picked.action === 'active' && editor) {
        scanFilePath = editor.document.uri.fsPath;
        textToScan = editor.document.getText();
      } else if (picked.action === 'staged' && root) {
        try {
          textToScan = await spawnProcess('git', ['diff', '--cached'], undefined, { cwd: root });
          if (!textToScan.trim()) {
            vscode.window.showInformationMessage('Veto: no staged changes found to scan.');
            return;
          }
        } catch (e) {
          vscode.window.showErrorMessage(`Veto: git diff --cached failed: ${e instanceof Error ? e.message : e}`);
          return;
        }
      } else if (picked.action === 'working' && root) {
        try {
          textToScan = await spawnProcess('git', ['diff', 'HEAD'], undefined, { cwd: root });
          if (!textToScan.trim()) {
            vscode.window.showInformationMessage('Veto: no working tree changes found to scan.');
            return;
          }
        } catch (e) {
          vscode.window.showErrorMessage(`Veto: git diff HEAD failed: ${e instanceof Error ? e.message : e}`);
          return;
        }
      }

      const maxChars = 20_000;
      const text = textToScan.length > maxChars
        ? textToScan.slice(0, maxChars) + `\n\n// [Veto: truncated ${textToScan.length - maxChars} characters to fit command-line limits]`
        : textToScan;

      const pathArg = scanFilePath ? ` and file_path: "${scanFilePath}"` : '';
      await runVetoTool(outputChannel, {
        title: 'Veto: scanning secrets…',
        label: 'Veto Secrets',
        cwd: root,
        args: [
          '--allowedTools', 'mcp__veto__veto_secrets_scan',
          '-p',
          `Run veto_secrets_scan on this text${pathArg}:\n\n${text}`,
        ],
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
