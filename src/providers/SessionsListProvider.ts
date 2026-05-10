import * as vscode from 'vscode';
import type { VetoSessionSummary } from '../types';
import { relativeTime } from '../utils';

export class SessionsListProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private data: VetoSessionSummary[] | null = null;
  private notInstalled = false;

  refresh(data: VetoSessionSummary[] | null, notInstalled = false): void {
    this.data = data;
    this.notInstalled = notInstalled;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    if (this.notInstalled) {
      const item = new vscode.TreeItem('Veto not installed — run: npm i -g @jigyasudham/veto');
      item.command = { command: 'veto.openInstallDocs', title: 'Install Docs', arguments: [] };
      return [item];
    }
    if (!this.data?.length) {
      return [new vscode.TreeItem('No sessions found')];
    }

    return this.data.map(s => {
      const label = s.summary
        ? s.summary.slice(0, 50) + (s.summary.length > 50 ? '…' : '')
        : `Session ${s.id.slice(0, 8)}…`;

      const item = new vscode.TreeItem(label);
      item.description = relativeTime(s.started_at);
      item.tooltip = new vscode.MarkdownString(
        `**ID:** \`${s.id}\`\n\n` +
        `**Platform:** ${s.active_client ?? s.platform}\n\n` +
        `**Tokens:** ${s.token_count.toLocaleString()}\n\n` +
        (s.project_dir ? `**Project:** ${s.project_dir}\n\n` : '') +
        (s.summary ? `**Summary:** ${s.summary}` : '')
      );
      item.iconPath = new vscode.ThemeIcon('history');
      item.command = {
        command: 'veto.continueSession',
        title: 'Resume Session',
        arguments: [s.id, s.active_client ?? s.platform],
      };
      return item;
    });
  }
}
