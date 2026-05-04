import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import {
  getLatestSession, getMemoryEntries, getLastCouncilOutcome,
  getTopPatterns, getRateStatus, getUsageSummary, getHealthStats,
  setDbPath, setLogger, getDbPath,
} from './db/reader';
import { SessionProvider } from './providers/SessionProvider';
import { MemoryProvider }  from './providers/MemoryProvider';
import { CouncilProvider } from './providers/CouncilProvider';
import { RouterProvider }  from './providers/RouterProvider';
import { RateProvider }    from './providers/RateProvider';
import { HealthProvider }  from './providers/HealthProvider';
import type { VetoSession, VetoCouncilOutcome } from './types';

export function activate(context: vscode.ExtensionContext): void {
  // Output channel for diagnostics
  const outputChannel = vscode.window.createOutputChannel('Veto');
  context.subscriptions.push(outputChannel);
  setLogger(msg => outputChannel.appendLine(`[${new Date().toISOString()}] ${msg}`));

  // Settings
  const config = vscode.workspace.getConfiguration('veto');
  const pollIntervalMs = Math.max(1000, config.get<number>('pollInterval', 5000));
  const dbPathOverride = config.get<string>('dbPath', '');
  if (dbPathOverride) setDbPath(dbPathOverride);

  // Providers
  const sessionProvider = new SessionProvider();
  const memoryProvider  = new MemoryProvider();
  const councilProvider = new CouncilProvider();
  const routerProvider  = new RouterProvider();
  const rateProvider    = new RateProvider();
  const healthProvider  = new HealthProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('veto-session', sessionProvider),
    vscode.window.registerTreeDataProvider('veto-memory',  memoryProvider),
    vscode.window.registerTreeDataProvider('veto-council', councilProvider),
    vscode.window.registerTreeDataProvider('veto-router',  routerProvider),
    vscode.window.registerTreeDataProvider('veto-rate',    rateProvider),
    vscode.window.registerTreeDataProvider('veto-health',  healthProvider),
  );

  // Status bar
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'veto.focusSidebar';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('veto.refresh', () => refresh()),

    vscode.commands.registerCommand('veto.copySessionId', (id: string) => {
      vscode.env.clipboard.writeText(id).then(() => {
        vscode.window.showInformationMessage('Session ID copied');
      });
    }),

    vscode.commands.registerCommand('veto.openInstallDocs', () => {
      vscode.env.openExternal(vscode.Uri.parse('https://www.npmjs.com/package/@jigyasudham/veto'));
    }),

    vscode.commands.registerCommand('veto.focusSidebar', () => {
      vscode.commands.executeCommand('veto-session.focus');
    }),
  );

  const projectDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  let previousVerdictId: string | null = null;

  function updateStatusBar(session: VetoSession | null, council: VetoCouncilOutcome | null): void {
    const id8 = session ? session.id.slice(0, 8) : 'no session';
    if (!session) {
      statusBarItem.text = '$(circle-slash) Veto';
      statusBarItem.tooltip = 'Veto: no active session';
      return;
    }
    if (!council) {
      statusBarItem.text = `$(circle-outline) ${id8}`;
    } else if (council.verdict === 'GREEN') {
      statusBarItem.text = `$(check) GREEN ${id8}`;
    } else if (council.verdict === 'RED') {
      statusBarItem.text = `$(error) RED ${id8}`;
    } else {
      statusBarItem.text = `$(warning) YELLOW ${id8}`;
    }
    statusBarItem.tooltip = `Veto session: ${session.id}`;
  }

  function refresh(): void {
    const dbExists = existsSync(getDbPath());

    if (!dbExists) {
      sessionProvider.refresh(null, true);
      memoryProvider.refresh(null, true);
      councilProvider.refresh(null, true);
      routerProvider.refresh(null, true);
      rateProvider.refresh(null, true);
      healthProvider.refresh(null, null, true);
      updateStatusBar(null, null);
      return;
    }

    const session  = getLatestSession();
    const memory   = getMemoryEntries(projectDir);
    const council  = getLastCouncilOutcome();
    const patterns = getTopPatterns();
    const rates    = getRateStatus();
    const usage    = getUsageSummary();
    const health   = getHealthStats();

    // RED verdict notification — only fires when a new RED outcome appears
    if (council && council.id !== previousVerdictId && council.verdict === 'RED') {
      vscode.window.showWarningMessage(
        `Veto Council: RED verdict — ${council.recommended ?? 'no recommendation'}`
      );
    }
    if (council) previousVerdictId = council.id;

    sessionProvider.refresh(session, false);
    memoryProvider.refresh(memory,   false);
    councilProvider.refresh(council, false);
    routerProvider.refresh(patterns, false);
    rateProvider.refresh(rates,      false);
    healthProvider.refresh(health, usage, false);

    updateStatusBar(session, council);
  }

  // Log startup DB state once
  if (!existsSync(getDbPath())) {
    outputChannel.appendLine(`[startup] Veto DB not found at ${getDbPath()}. Install Veto: npm i -g @jigyasudham/veto`);
  }

  refresh();

  const intervalId = setInterval(refresh, pollIntervalMs);
  context.subscriptions.push({ dispose: () => clearInterval(intervalId) });
}

export function deactivate(): void {}
