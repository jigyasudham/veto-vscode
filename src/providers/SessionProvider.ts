import * as vscode from 'vscode';
import type { VetoSession } from '../types';
import { relativeTime, makeItem } from '../utils';

export class SessionProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private data: VetoSession | null = null;
  private notInstalled = false;

  refresh(data: VetoSession | null, notInstalled = false): void {
    this.data = data;
    this.notInstalled = notInstalled;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    if (this.notInstalled) {
      return [makeItem('Veto not installed — run: npm i -g @jigyasudham/veto', undefined, 'veto.openInstallDocs')];
    }
    if (!this.data) {
      return [makeItem('No active session — run veto_session_save first')];
    }
    const s = this.data;

    const sessionItem = new vscode.TreeItem(`${s.id.slice(0, 8)}…`);
    sessionItem.description = 'Session ID';
    sessionItem.tooltip = s.id;
    sessionItem.command = { command: 'veto.copySessionId', title: 'Copy Session ID', arguments: [s.id] };

    const items: vscode.TreeItem[] = [
      sessionItem,
      makeItem('Created by', s.platform),
      makeItem('Active in', s.active_client ?? s.platform),
      makeItem('Started', relativeTime(s.started_at)),
      makeItem('Tokens', s.token_count.toLocaleString()),
    ];

    if (s.summary) {
      const summaryItem = makeItem('Summary', s.summary.slice(0, 60));
      summaryItem.tooltip = s.summary;
      items.push(summaryItem);
    }

    return items;
  }
}
