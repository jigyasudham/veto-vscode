import * as vscode from 'vscode';
import type { VetoMemoryData } from '../types';

function item(label: string, description?: string): vscode.TreeItem {
  const t = new vscode.TreeItem(label);
  if (description) t.description = description;
  return t;
}

export class MemoryProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private data: VetoMemoryData | null = null;

  refresh(data: VetoMemoryData | null): void {
    this.data = data;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    if (!this.data || this.data.totalCount === 0) {
      return [item('No memories stored yet')];
    }
    const scope = this.data.scoped ? 'project-scoped' : 'all projects';
    return [
      item(`${this.data.totalCount} memories`, scope),
      ...this.data.entries.map(e => item(e.title, e.type)),
    ];
  }
}
