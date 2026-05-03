import * as vscode from 'vscode';
import type { VetoCouncilOutcome } from '../types';

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function verdictIcon(verdict: string): vscode.ThemeIcon {
  if (verdict === 'GREEN') return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
  if (verdict === 'RED')   return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
  return new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconQueued'));
}

function agentItem(name: string, raw: string | null): vscode.TreeItem {
  const t = new vscode.TreeItem(name);
  t.description = raw?.slice(0, 40) ?? '—';
  const isApprove = raw?.toLowerCase().includes('approve') ?? false;
  t.iconPath = isApprove
    ? new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'))
    : new vscode.ThemeIcon('issues', new vscode.ThemeColor('testing.iconQueued'));
  return t;
}

export class CouncilProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private data: VetoCouncilOutcome | null = null;

  refresh(data: VetoCouncilOutcome | null): void {
    this.data = data;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    if (!this.data) {
      return [new vscode.TreeItem('No council verdict yet')];
    }
    const d = this.data;
    const verdictItem = new vscode.TreeItem(d.verdict);
    verdictItem.iconPath = verdictIcon(d.verdict);

    const items: vscode.TreeItem[] = [
      verdictItem,
      agentItem('Lead Dev', d.lead_dev),
      agentItem('PM', d.pm),
      agentItem('Architect', d.architect),
      agentItem('UX', d.ux),
      agentItem('Devil', d.devil),
      agentItem('Legal', d.legal),
      agentItem('Security', d.security),
    ];

    if (d.recommended) {
      const rec = new vscode.TreeItem('Recommended');
      rec.description = d.recommended.slice(0, 80);
      items.push(rec);
    }

    const debated = new vscode.TreeItem('Debated');
    debated.description = relativeTime(d.debated_at);
    items.push(debated);

    return items;
  }
}
