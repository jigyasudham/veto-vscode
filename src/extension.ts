import * as vscode from 'vscode';
import { getLatestSession, getMemoryEntries, getLastCouncilOutcome, getTopPatterns } from './db/reader';
import { SessionProvider } from './providers/SessionProvider';
import { MemoryProvider } from './providers/MemoryProvider';
import { CouncilProvider } from './providers/CouncilProvider';
import { RouterProvider } from './providers/RouterProvider';

export function activate(context: vscode.ExtensionContext): void {
  const sessionProvider = new SessionProvider();
  const memoryProvider  = new MemoryProvider();
  const councilProvider = new CouncilProvider();
  const routerProvider  = new RouterProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('veto-session', sessionProvider),
    vscode.window.registerTreeDataProvider('veto-memory',  memoryProvider),
    vscode.window.registerTreeDataProvider('veto-council', councilProvider),
    vscode.window.registerTreeDataProvider('veto-router',  routerProvider),
  );

  const projectDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  function refresh(): void {
    sessionProvider.refresh(getLatestSession());
    memoryProvider.refresh(getMemoryEntries(projectDir));
    councilProvider.refresh(getLastCouncilOutcome());
    routerProvider.refresh(getTopPatterns());
  }

  refresh();

  const intervalId = setInterval(refresh, 5000);
  context.subscriptions.push({ dispose: () => clearInterval(intervalId) });
}

export function deactivate(): void {}
