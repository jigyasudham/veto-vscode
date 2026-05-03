import * as vscode from 'vscode';
import type { VetoPattern } from '../types';

export class RouterProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private data: VetoPattern[] | null = null;

  refresh(data: VetoPattern[] | null): void {
    this.data = data;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    if (!this.data || this.data.length === 0) {
      return [new vscode.TreeItem('No routing data yet — use veto_record_outcome to teach the router')];
    }
    return this.data.map(p => {
      const t = new vscode.TreeItem(p.pattern_key);
      t.description = `${p.pattern_val} · ${Math.round(p.confidence * 100)}% (${p.seen_count}x)`;
      return t;
    });
  }
}
