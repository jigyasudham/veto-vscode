import * as vscode from 'vscode';
import type { VetoSession } from '../types';

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function item(label: string, description?: string): vscode.TreeItem {
  const t = new vscode.TreeItem(label);
  if (description) t.description = description;
  return t;
}

export class SessionProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private data: VetoSession | null = null;

  refresh(data: VetoSession | null): void {
    this.data = data;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    if (!this.data) {
      return [item('No active session — run veto_session_save first')];
    }
    const s = this.data;
    const items = [
      item('Session', `${s.id.slice(0, 8)}…`),
      item('Created by', s.platform),
      item('Active in', s.active_client ?? s.platform),
      item('Started', relativeTime(s.started_at)),
      item('Tokens', s.token_count.toLocaleString()),
    ];
    if (s.summary) items.push(item('Summary', s.summary.slice(0, 60)));
    return items;
  }
}
