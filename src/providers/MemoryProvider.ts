import * as vscode from 'vscode';
import type { VetoMemoryData } from '../types';
import { makeItem } from '../utils';

export class MemoryProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private data: VetoMemoryData | null = null;
  private notInstalled = false;

  refresh(data: VetoMemoryData | null, notInstalled = false): void {
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
    if (!this.data || this.data.totalCount === 0) {
      return [makeItem('No memories stored yet')];
    }
    const scope = this.data.scoped ? 'project-scoped' : 'all projects';
    return [
      makeItem(`${this.data.totalCount} memories`, scope),
      ...this.data.entries.map(e => {
        const t = makeItem(e.title, e.type);
        t.tooltip = e.title;
        return t;
      }),
    ];
  }
}
