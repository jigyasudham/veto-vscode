import * as vscode from 'vscode';
import type { VetoRateEntry } from '../types';
import { makeItem } from '../utils';

function bar(pct: number): string {
  const filled = Math.round(pct / 20);
  return '█'.repeat(filled) + '░'.repeat(5 - filled);
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

const PLATFORMS = ['claude', 'gemini', 'codex'];

const DEFAULT_BUDGETS: Record<string, number> = {
  claude:  500_000,
  gemini: 1_000_000,
  codex:   200_000,
};

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

    return PLATFORMS.map(platform => {
      const entry  = map.get(platform);
      const tokens = entry?.token_count ?? 0;
      const budget = entry?.daily_token_budget ?? DEFAULT_BUDGETS[platform] ?? 500_000;
      const pct    = Math.min(100, Math.round((tokens / budget) * 100));
      const label  = platform.charAt(0).toUpperCase() + platform.slice(1);
      const item   = makeItem(label, `${fmtTokens(tokens)} / ${fmtTokens(budget)} ${bar(pct)} ${pct}%`);
      item.tooltip = [
        `${label}: ${tokens.toLocaleString()} tokens used today`,
        `Budget: ${budget.toLocaleString()} tokens`,
        `To change: veto_usage_status({ set_budget: { ${platform}: <number> } })`,
      ].join('\n');
      return item;
    });
  }
}
