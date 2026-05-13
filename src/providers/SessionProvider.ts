import * as vscode from 'vscode';
import type { VetoSession } from '../types';
import { relativeTime, makeItem } from '../utils';

const CONTEXT_WINDOWS: Record<string, number> = {
  claude: 200_000,
  gemini: 1_000_000,
  codex:  128_000,
};

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
      makeItem('Connection', s.connection_type ?? 'subscription'),
      makeItem('Started', relativeTime(s.started_at)),
      ...(() => {
        const client = (s.active_client ?? s.platform).toLowerCase();
        const ctxWindow = CONTEXT_WINDOWS[client] ?? 200_000;
        const tokens = s.token_count ?? 0;
        const pct = Math.min(100, Math.round((tokens / ctxWindow) * 100));
        const filled = Math.round(pct / 20);
        const bar = '█'.repeat(filled) + '░'.repeat(5 - filled);
        const tokK = Math.round(tokens / 1000);
        const ctxK = Math.round(ctxWindow / 1000);
        const tokItem = makeItem('Tokens (last save)', `${tokK}K/${ctxK}K ${bar} ${pct}%`);
        tokItem.tooltip = `${tokens.toLocaleString()} tokens at last veto_session_save — not a live counter`;
        return [tokItem];
      })(),
    ];

    if (s.project_dir) {
      const dirParts = s.project_dir.replace(/\\/g, '/').split('/');
      const shortDir = dirParts.slice(-2).join('/');
      const dirItem = makeItem('Project', shortDir);
      dirItem.tooltip = s.project_dir;
      items.push(dirItem);
    }

    if (s.summary) {
      const summaryItem = makeItem('Summary', s.summary.slice(0, 60));
      summaryItem.tooltip = s.summary;
      items.push(summaryItem);
    }

    return items;
  }
}
