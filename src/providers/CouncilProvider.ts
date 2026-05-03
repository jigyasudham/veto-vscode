import * as vscode from 'vscode';
import type { VetoCouncilOutcome, CouncilNode } from '../types';
import { relativeTime, makeItem } from '../utils';

function verdictIcon(verdict: string): vscode.ThemeIcon {
  if (verdict === 'GREEN') return new vscode.ThemeIcon('check',   new vscode.ThemeColor('testing.iconPassed'));
  if (verdict === 'RED')   return new vscode.ThemeIcon('error',   new vscode.ThemeColor('testing.iconFailed'));
  return                          new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconQueued'));
}

function agentTreeItem(name: string, raw: string | null): vscode.TreeItem {
  const t = new vscode.TreeItem(name);
  t.description = raw?.slice(0, 40) ?? '—';
  t.tooltip = raw ?? undefined;
  const isApprove = raw?.toLowerCase().includes('approve') ?? false;
  t.iconPath = isApprove
    ? new vscode.ThemeIcon('pass',   new vscode.ThemeColor('testing.iconPassed'))
    : new vscode.ThemeIcon('issues', new vscode.ThemeColor('testing.iconQueued'));
  return t;
}

export class CouncilProvider implements vscode.TreeDataProvider<CouncilNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private data: VetoCouncilOutcome | null = null;
  private notInstalled = false;

  refresh(data: VetoCouncilOutcome | null, notInstalled = false): void {
    this.data = data;
    this.notInstalled = notInstalled;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: CouncilNode): vscode.TreeItem {
    switch (node.kind) {
      case 'empty':
        return makeItem(this.notInstalled
          ? 'Veto not installed — run: npm i -g @jigyasudham/veto'
          : 'No council verdict yet',
          undefined,
          this.notInstalled ? 'veto.openInstallDocs' : undefined
        );
      case 'verdict': {
        const t = new vscode.TreeItem(node.data.verdict, vscode.TreeItemCollapsibleState.Collapsed);
        t.id = node.data.id;
        t.iconPath = verdictIcon(node.data.verdict);
        return t;
      }
      case 'agent':
        return agentTreeItem(node.name, node.raw);
      case 'recommended': {
        const t = makeItem('Recommended', node.text.slice(0, 80));
        t.tooltip = node.text;
        return t;
      }
      case 'debated':
        return makeItem('Debated', relativeTime(node.iso));
    }
  }

  getChildren(node?: CouncilNode): CouncilNode[] {
    if (!node) {
      if (this.notInstalled || !this.data) return [{ kind: 'empty' }];
      return [{ kind: 'verdict', data: this.data }];
    }
    if (node.kind === 'verdict') {
      const d = node.data;
      const children: CouncilNode[] = [
        { kind: 'agent', name: 'Lead Dev',  raw: d.lead_dev },
        { kind: 'agent', name: 'PM',        raw: d.pm },
        { kind: 'agent', name: 'Architect', raw: d.architect },
        { kind: 'agent', name: 'UX',        raw: d.ux },
        { kind: 'agent', name: 'Devil',     raw: d.devil },
        { kind: 'agent', name: 'Legal',     raw: d.legal },
        { kind: 'agent', name: 'Security',  raw: d.security },
        { kind: 'debated', iso: d.debated_at },
      ];
      if (d.recommended) children.splice(7, 0, { kind: 'recommended', text: d.recommended });
      return children;
    }
    return [];
  }
}
