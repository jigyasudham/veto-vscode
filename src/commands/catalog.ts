import * as vscode from 'vscode';
import { spawnProcess } from './process';
import { parseCatalog } from '../core/catalog';

export function registerCatalogCommands(context: vscode.ExtensionContext, getProjectDir: () => string | undefined): void {
  for (const kind of ['tools', 'agents'] as const) {
    context.subscriptions.push(vscode.commands.registerCommand(kind === 'tools' ? 'veto.browseTools' : 'veto.browseAgents', async () => {
      if (!vscode.workspace.isTrusted) {
        void vscode.window.showWarningMessage('Veto: trust this workspace before running the Veto CLI.');
        return;
      }
      try {
        const entries = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Veto: loading ${kind}`, cancellable: true }, async (_, token) => {
          const raw = await spawnProcess('veto', [kind, '--json'], undefined, { cwd: getProjectDir(), cancellationToken: token, timeoutMs: 15000 });
          return parseCatalog(raw, kind);
        });
        const choice = await vscode.window.showQuickPick(entries.map(entry => ({ label: entry.name, description: entry.category, detail: entry.description, entry })), {
          placeHolder: `Inspect Veto ${kind}`, matchOnDescription: true, matchOnDetail: true,
        });
        if (!choice) return;
        const content = `${choice.entry.name}\n${choice.entry.category}\n\n${choice.entry.description}\n\nCatalog from the installed Veto CLI. Inspect the tool schema in your connected AI client before invoking it. This view does not execute the selected capability.\n`;
        const document = await vscode.workspace.openTextDocument({ content, language: 'plaintext' });
        await vscode.window.showTextDocument(document, { preview: true });
      } catch (error) {
        void vscode.window.showErrorMessage(`Veto catalog unavailable: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
  }
}
