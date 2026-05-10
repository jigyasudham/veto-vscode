import * as vscode from 'vscode';
import type { VetoRateEntry } from '../types';
import { makeItem } from '../utils';

const DAILY_LIMITS: Record<string, number> = {
  claude: 100,
  gemini: 200,
  codex:  150,
};

function bar(pct: number): string {
  const filled = Math.round(pct / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

export class RateProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private data: VetoRateEntry[] | null = null;
  private notInstalled = false;

  refresh(data: VetoRateEntry[] | null, notInstalled = false): void {
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

    const map = new Map<string, VetoRateEntry>();
    (this.data ?? []).forEach(r => map.set(r.platform, r));

    return Object.entries(DAILY_LIMITS).flatMap(([platform, limit]) => {
      const entry    = map.get(platform);
      const count    = entry?.request_count ?? 0;
      const tokens   = entry?.token_count   ?? 0;
      const pct      = Math.min(100, Math.round((count / limit) * 100));
      const label    = platform.charAt(0).toUpperCase() + platform.slice(1);
      const reqItem  = makeItem(label, `${count} / ${limit} requests  ${bar(pct)}  ${pct}%`);
      reqItem.tooltip = `${label}: ${count} requests today out of ${limit} daily limit`;

      const items: vscode.TreeItem[] = [reqItem];
      if (tokens > 0) {
        items.push(makeItem('', `${tokens.toLocaleString()} tokens`));
      }
      return items;
    });
  }
}
