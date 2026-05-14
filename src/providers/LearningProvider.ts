import * as vscode from 'vscode';
import type { VetoLearningStats } from '../db/reader';
import { makeItem } from '../utils';

export class LearningProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private data: VetoLearningStats | null = null;
  private notInstalled = false;

  refresh(data: VetoLearningStats | null, notInstalled = false): void {
    this.data = data;
    this.notInstalled = notInstalled;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

  getChildren(): vscode.TreeItem[] {
    if (this.notInstalled) {
      return [makeItem('Veto not installed — run: npm i -g @jigyasudham/veto', undefined, 'veto.openInstallDocs')];
    }
    if (!this.data || this.data.totalOutcomes === 0) {
      return [makeItem('No learning data yet — use veto_record_outcome to teach the router')];
    }

    const d = this.data;
    const items: vscode.TreeItem[] = [
      makeItem(
        `${d.totalOutcomes} outcomes recorded`,
        d.avgQuality !== null ? `avg quality: ${d.avgQuality}/100` : undefined,
      ),
    ];

    for (const t of d.tierBreakdown) {
      const label = t.tier === 1 ? 'Tier 1 — fast' : t.tier === 2 ? 'Tier 2 — balanced' : 'Tier 3 — deep';
      const desc = t.avgQuality !== null
        ? `${t.count} tasks · avg ${t.avgQuality}/100`
        : `${t.count} tasks`;
      items.push(makeItem(label, desc));
    }

    if (d.topAgents.length) {
      items.push(makeItem('Top agents', ''));
      for (const a of d.topAgents) {
        const desc = a.avgQuality !== null ? `${a.count} tasks · ${a.avgQuality}/100` : `${a.count} tasks`;
        items.push(makeItem(a.agent, desc));
      }
    }

    return items;
  }
}
