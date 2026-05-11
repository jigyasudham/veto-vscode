import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import { watch as fsWatch, FSWatcher } from 'node:fs';
import { dirname } from 'node:path';
import {
  getLatestSession, getMemoryEntries, getLastCouncilOutcome,
  getTopPatterns, getRateStatus, getUsageSummary, getHealthStats,
  searchMemoryEntries, getSessions, setDbPath, setLogger, getDbPath,
} from './db/reader';
import { registerAutoReviewTrigger, registerGitStageTrigger } from './triggers';
import { SessionProvider } from './providers/SessionProvider';
import { MemoryProvider }  from './providers/MemoryProvider';
import { CouncilProvider } from './providers/CouncilProvider';
import { RouterProvider }  from './providers/RouterProvider';
import { RateProvider }    from './providers/RateProvider';
import { HealthProvider }       from './providers/HealthProvider';
import { SessionsListProvider } from './providers/SessionsListProvider';
import type { VetoSession, VetoCouncilOutcome } from './types';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('Veto');
  context.subscriptions.push(outputChannel);
  setLogger(msg => outputChannel.appendLine(`[${new Date().toISOString()}] ${msg}`));

  let config = vscode.workspace.getConfiguration('veto');
  let pollIntervalMs = Math.max(1000, config.get<number>('pollInterval', 5000));
  const dbPathOverride = config.get<string>('dbPath', '');
  if (dbPathOverride) setDbPath(dbPathOverride);

  // Providers
  const sessionProvider      = new SessionProvider();
  const sessionsListProvider = new SessionsListProvider();
  const memoryProvider       = new MemoryProvider();
  const councilProvider      = new CouncilProvider();
  const routerProvider       = new RouterProvider();
  const rateProvider         = new RateProvider();
  const healthProvider       = new HealthProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('veto-session',       sessionProvider),
    vscode.window.registerTreeDataProvider('veto-sessions-list', sessionsListProvider),
    vscode.window.registerTreeDataProvider('veto-memory',        memoryProvider),
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

  let projectDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
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
    const health = getHealthStats();
    const sessionCount = health?.sessionCount ?? '?';
    const ext = vscode.extensions.getExtension('jigyasudham.veto-vscode');
    const version = ext?.packageJSON?.version ?? '?';
    statusBarItem.tooltip = [
      `Veto v${version}`,
      `Session: ${session.id}`,
      `Total sessions: ${sessionCount}`,
      health ? `Memory: ${health.memoryCount}  Patterns: ${health.patternCount}  DB: ${health.dbSizeMb}MB` : '',
    ].filter(Boolean).join('\n');
  }

  function refresh(): void {
    const dbExists = existsSync(getDbPath());

    if (!dbExists) {
      sessionProvider.refresh(null, true);
      sessionsListProvider.refresh(null, true);
      memoryProvider.refresh(null, true);
      councilProvider.refresh(null, true);
      routerProvider.refresh(null, true);
      rateProvider.refresh(null, true);
      healthProvider.refresh(null, null, true);
      updateStatusBar(null, null);
      return;
    }

    const session  = getLatestSession();
    const sessions = getSessions();
    const memory   = getMemoryEntries(projectDir);
    const council  = getLastCouncilOutcome();
    const patterns = getTopPatterns();
    const rates    = getRateStatus();
    const usage    = getUsageSummary();
    const health   = getHealthStats();

    if (council && council.id !== previousVerdictId && council.verdict === 'RED') {
      vscode.window.showWarningMessage(
        `Veto Council: RED verdict — ${council.recommended ?? 'no recommendation'}`
      );
    }
    if (council) previousVerdictId = council.id;

    sessionProvider.refresh(session, false);
    sessionsListProvider.refresh(sessions, false);
    memoryProvider.refresh(memory,   false);
    councilProvider.refresh(council, false);
    routerProvider.refresh(patterns, false);
    rateProvider.refresh(rates,      false);
    healthProvider.refresh(health, usage, false);

    updateStatusBar(session, council);
  }

  // ── Auto-trigger 1: DB directory watcher ─────────────────────────────────
  // Watches ~/.veto/ for any change → instant refresh (sub-second vs poll interval)
  let dbWatcher: FSWatcher | null = null;
  let dbWatchDebounce: ReturnType<typeof setTimeout> | undefined;

  function startDbWatcher(): void {
    dbWatcher?.close();
    dbWatcher = null;
    const dir = dirname(getDbPath());
    if (!existsSync(dir)) return;
    try {
      dbWatcher = fsWatch(dir, { persistent: false }, (_event, filename) => {
        if (filename && !filename.startsWith('veto')) return;
        clearTimeout(dbWatchDebounce);
        dbWatchDebounce = setTimeout(() => refresh(), 150);
      });
      dbWatcher.on('error', () => { dbWatcher = null; });
    } catch { /* ignore if dir not watchable */ }
  }

  startDbWatcher();
  context.subscriptions.push({ dispose: () => { dbWatcher?.close(); clearTimeout(dbWatchDebounce); } });

  // ── Auto-trigger 2: Live configuration reload ─────────────────────────────
  let intervalId = setInterval(refresh, pollIntervalMs);
  context.subscriptions.push({ dispose: () => clearInterval(intervalId) });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('veto')) return;
      config = vscode.workspace.getConfiguration('veto');
      const newInterval = Math.max(1000, config.get<number>('pollInterval', 5000));
      const newDbPath = config.get<string>('dbPath', '');
      if (newDbPath) setDbPath(newDbPath);
      if (newInterval !== pollIntervalMs) {
        pollIntervalMs = newInterval;
        clearInterval(intervalId);
        intervalId = setInterval(refresh, pollIntervalMs);
      }
      startDbWatcher();
      refresh();
      outputChannel.appendLine(`[config] Reloaded — pollInterval=${pollIntervalMs}ms dbPath=${getDbPath()}`);
    })
  );

  // ── Auto-trigger 3: Workspace folder change ───────────────────────────────
  // Re-scopes Memory panel to the new active folder
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      projectDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      refresh();
    })
  );

  // ── Auto-trigger 4: Optional refresh on file save ────────────────────────
  let saveDebounce: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      if (!vscode.workspace.getConfiguration('veto').get<boolean>('autoRefreshOnSave', false)) return;
      clearTimeout(saveDebounce);
      saveDebounce = setTimeout(() => refresh(), 300);
    })
  );

  // ── Auto-trigger 5: file save → veto_code_review ─────────────────────────
  registerAutoReviewTrigger(context, outputChannel);

  // ── Auto-trigger 6: git stage → veto_ci_gate ─────────────────────────────
  registerGitStageTrigger(context, outputChannel);

  // ── Commands ──────────────────────────────────────────────────────────────
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

    vscode.commands.registerCommand('veto.openLog', () => {
      outputChannel.show(true);
    }),

    vscode.commands.registerCommand('veto.saveSession', async () => {
      const session = getLatestSession();
      const summary = await vscode.window.showInputBox({
        prompt: 'Session summary',
        placeHolder: 'What did you accomplish this session?',
        value: session?.summary ?? '',
        ignoreFocusOut: true,
      });
      if (!summary?.trim()) return;

      const projectDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
      const msg = [
        'Save this veto session using veto_session_save.',
        `Summary: "${summary.trim()}"`,
        projectDir ? `Project dir: ${projectDir}` : '',
      ].filter(Boolean).join(' ');

      const terminal = vscode.window.createTerminal({ name: 'Veto Save', hideFromUser: false });
      terminal.show(false);
      terminal.sendText(`claude -p "${msg.replace(/"/g, '\\"')}"`, true);
    }),

    vscode.commands.registerCommand('veto.continueSession', (sessionId: string, platform = 'claude') => {
      const p = platform.toLowerCase();
      let cmd: string;
      if (p === 'gemini') {
        cmd = `gemini -p "veto_continue ${sessionId}"`;
      } else if (p === 'codex') {
        cmd = `codex "veto_continue ${sessionId}"`;
      } else {
        // claude (default) — pre-authorise the tool so it doesn't block
        cmd = `claude --allowedTools "mcp__veto__veto_continue" -p "veto_continue ${sessionId}"`;
      }
      const label = p.charAt(0).toUpperCase() + p.slice(1);
      const terminal = vscode.window.createTerminal({ name: `Veto Resume (${label})`, hideFromUser: false });
      terminal.show(false);
      terminal.sendText(cmd, true);
    }),

    vscode.commands.registerCommand('veto.councilDebate', async () => {
      const topic = await vscode.window.showInputBox({
        prompt: 'Council debate topic',
        placeHolder: 'What should the council debate?',
        ignoreFocusOut: true,
      });
      if (!topic?.trim()) return;

      const msg = `Run a Veto council debate using veto_council_debate. Topic: "${topic.trim()}"`;
      const terminal = vscode.window.createTerminal({ name: 'Veto Council', hideFromUser: false });
      terminal.show(false);
      terminal.sendText(`claude -p "${msg.replace(/"/g, '\\"')}"`, true);
    }),

    vscode.commands.registerCommand('veto.reviewFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Veto: no active file to review');
        return;
      }
      const filePath = editor.document.uri.fsPath;
      const msg = `Run veto_code_review on this file: ${filePath}`;
      const terminal = vscode.window.createTerminal({ name: 'Veto Review', hideFromUser: false });
      terminal.show(false);
      terminal.sendText(`claude -p "${msg.replace(/"/g, '\\"')}"`, true);
    }),

    // Search memory entries directly from VS Code
    vscode.commands.registerCommand('veto.searchMemory', async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'Search Veto memory',
        placeHolder: 'keyword or tag…',
      });
      if (!query?.trim()) return;

      const results = searchMemoryEntries(query.trim());
      if (!results?.length) {
        vscode.window.showInformationMessage(`Veto: no memory entries matching "${query}"`);
        return;
      }

      const items = results.map(r => ({
        label:       r.title,
        description: r.tags.length ? r.tags.join(', ') : r.type,
        detail:      r.project_dir ?? 'global',
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `${results.length} result(s) for "${query}"`,
        matchOnDescription: true,
      });

      if (picked) {
        vscode.env.clipboard.writeText(picked.label).then(() => {
          vscode.window.showInformationMessage(`Copied: ${picked.label}`);
        });
      }
    }),
  );

  // Log startup state
  if (!existsSync(getDbPath())) {
    outputChannel.appendLine(`[startup] Veto DB not found at ${getDbPath()}. Install: npm i -g @jigyasudham/veto`);
  } else {
    outputChannel.appendLine(`[startup] Veto DB found at ${getDbPath()}. Watching for changes.`);
  }

  refresh();
}

export function deactivate(): void {}
