import * as vscode from 'vscode';
import type { VetoRateEntry } from '../types';
import { makeItem } from '../utils';

const KNOWN_PLATFORMS = ['claude', 'gemini', 'codex'];

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
    const map = new Map<string, number>();
    (this.data ?? []).forEach(r => map.set(r.platform, r.request_count));
    return KNOWN_PLATFORMS.map(p => {
      const count = map.get(p) ?? 0;
      const label = p.charAt(0).toUpperCase() + p.slice(1);
      return makeItem(label, `${count} requests today`);
    });
  }
}
