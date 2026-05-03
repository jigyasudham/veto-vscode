import * as vscode from 'vscode';

export function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function makeItem(label: string, description?: string, command?: string): vscode.TreeItem {
  const t = new vscode.TreeItem(label);
  if (description) t.description = description;
  if (command) t.command = { command, title: label };
  return t;
}
