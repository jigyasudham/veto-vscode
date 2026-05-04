import * as vscode from 'vscode';
import type { VetoHealthStats, VetoUsageSummary } from '../types';
import { makeItem } from '../utils';

export class HealthProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private health: VetoHealthStats | null = null;
  private usage: VetoUsageSummary | null = null;
  private notInstalled = false;

  refresh(health: VetoHealthStats | null, usage: VetoUsageSummary | null, notInstalled = false): void {
    this.health = health;
    this.usage = usage;
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

    const items: vscode.TreeItem[] = [];

    if (this.health) {
      const h = this.health;
      items.push(
        makeItem('DB size',       `${h.dbSizeMb} MB`),
        makeItem('Sessions',      h.sessionCount.toLocaleString()),
        makeItem('Memory',        h.memoryCount.toLocaleString() + ' entries'),
        makeItem('Patterns',      h.patternCount.toLocaleString()),
        makeItem('Outcomes',      h.learningCount.toLocaleString()),
      );
    }

    if (this.usage && this.usage.totalTokens > 0) {
      items.push(makeItem('Total tokens', this.usage.totalTokens.toLocaleString()));
      for (const p of this.usage.byPlatform) {
        if (p.tokens > 0) {
          const label = p.platform.charAt(0).toUpperCase() + p.platform.slice(1);
          items.push(makeItem(`  ${label}`, p.tokens.toLocaleString() + ' tokens'));
        }
      }
    }

    if (items.length === 0) {
      return [makeItem('No data yet — start using Veto tools')];
    }

    return items;
  }
}
