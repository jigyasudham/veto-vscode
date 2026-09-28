// Veto HUD — extension entry point. Wiring only: build the store, the status-bar pulse,
// the HUD, and the commands, then connect them. All real logic lives in core/ ui/ commands/.

import * as vscode from 'vscode';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { VetoStore } from './core/VetoStore';
import type { VetoSnapshot, DetailScope } from './core/snapshot';
import type { ApiEnvelope } from './core/backend';
import { StatusBar } from './ui/StatusBar';
import {
  HudView,
  type HudMessage,
  type SettingsPayload,
  type ProjectItem,
} from './ui/HudView';
import { registerCommands } from './commands';
import { cancelAllProcesses, spawnProcess, parseToolOutput } from './commands/process';
import { runStructuredTool } from './commands/veto';
import { parseCatalog } from './core/catalog';
import { selectedProject } from './core/projects';
import { registerBackendCommands } from './commands/backend';
import { pathsEqual, isCustomDbPath } from './core/paths';
import { visibilityReport } from './core/visibility';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('Veto');
  const version = vscode.extensions.getExtension('jigyasudham.veto-vscode')?.packageJSON?.version ?? '?';
  context.subscriptions.push(outputChannel);

  let logId = 0;
  let hud: HudView;

  const appendLog = (text: string, level: 'info' | 'warn' | 'error' | 'success' = 'info') => {
    const timestamp = new Date().toISOString();
    outputChannel.appendLine(`[${timestamp}] ${text}`);
    if (hud) {
      hud.postLogEntry({
        id: ++logId,
        timestamp: timestamp.slice(11, 19),
        level,
        text,
      });
    }
  };

  const cfg = () => vscode.workspace.getConfiguration('veto');
  const store = new VetoStore({
    dbPath: cfg().get<string>('dbPath', '') || undefined,
    pollIntervalMs: cfg().get<number>('pollInterval', 5000),
    log: msg => appendLog(msg, 'info'),
  });

  if (!store.isSupported()) {
    const msg = 'Veto HUD requires Node 22.13+ (node:sqlite) in the VS Code extension host. Please update VS Code.';
    outputChannel.appendLine(`[runtime error] ${msg}`);
    vscode.window.showErrorMessage(msg);
  }

  let pinnedProject = context.workspaceState.get<string>('veto.selectedProject');
  const getActiveProjectDir = (): string | undefined => {
    const editor = vscode.window.activeTextEditor;
    const editorFolder = editor ? vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath : undefined;
    return selectedProject((vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath), pinnedProject, editorFolder);
  };

  const getSettingsPayload = (): SettingsPayload => {
    const c = cfg();
    const dbPath = c.get<string>('dbPath', '');
    return {
      cliPath: c.get<string>('cliPath', ''),
      dbPath,
      pollInterval: c.get<number>('pollInterval', 5000),
      actionTimeoutMs: c.get<number>('actionTimeoutMs', 120000),
      isCustomDb: !!dbPath && !pathsEqual(dbPath, join(homedir(), '.veto', 'veto.db')),
      defaultDbPath: join(homedir(), '.veto', 'veto.db'),
      nodeVersion: process.versions.node,
      isSqliteSupported: store.isSupported(),
      isTrusted: vscode.workspace.isTrusted,
    };
  };

  const getProjectsList = (): ProjectItem[] => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const activeDir = getActiveProjectDir();
    return [
      { name: 'Follow active editor', path: undefined, isPinned: pinnedProject === undefined, isActive: pinnedProject === undefined },
      ...folders.map(f => ({
        name: f.name,
        path: f.uri.fsPath,
        isPinned: pinnedProject === f.uri.fsPath,
        isActive: pathsEqual(activeDir, f.uri.fsPath),
      })),
    ];
  };

  const bounded = (text: string) => {
    if (text.length > 200_000) throw new Error('Input exceeds 200,000 characters. Select a smaller file or change set; no partial scan was submitted.');
    return text;
  };

  const callTool = async (tool: string, input: Record<string, unknown>, title: string, cwd = getActiveProjectDir()) => {
    const result = await runStructuredTool(outputChannel, { title, cwd, tool, input });
    store.refresh(true);
    return result;
  };

  context.subscriptions.push(vscode.commands.registerCommand('veto.selectProject', async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const choice = await vscode.window.showQuickPick([
      { label: 'Follow active editor', description: 'Use the editor folder, falling back to the first workspace folder', path: undefined as string | undefined },
      ...folders.map(f => ({ label: f.name, description: f.uri.fsPath, path: f.uri.fsPath })),
    ], { placeHolder: 'Select the project for Veto data and actions' });
    if (!choice) return;
    pinnedProject = choice.path;
    await context.workspaceState.update('veto.selectedProject', pinnedProject);
    cachedBackendSnapshot = undefined;
    hud.setBackendSnapshot();
    store.setProjectDir(getActiveProjectDir());
    store.refresh(true);
    hud.postProjects(getProjectsList());
  }), { dispose: cancelAllProcesses });

  store.setProjectDir(getActiveProjectDir());

  const statusBar = new StatusBar(version);
  const diagnostics = vscode.languages.createDiagnosticCollection('veto');

  let cachedBackendSnapshot: ApiEnvelope | undefined;
  const backendCmds = registerBackendCommands(context, {
    getProjectDir: getActiveProjectDir,
    getDbPath: () => store.getDbPath(),
    showSnapshot: envelope => hud.setBackendSnapshot(envelope),
    onSnapshotFetched: envelope => { cachedBackendSnapshot = envelope; },
  });

  // ── HUD message routing ──────────────────────────────────────────────────────
  const handleHudMessage = (msg: HudMessage): void => {
    switch (msg.type) {
      case 'resume': {
        if (msg.target === 'console') {
          void (async () => {
            if (!vscode.workspace.isTrusted) {
              vscode.window.showWarningMessage('Veto: trust this workspace before resuming in Console.');
              return;
            }
            hud.postActionStatus({ action: 'resume', status: 'running' });
            appendLog(`[Resume] Resuming session ${msg.id} via veto_continue in Console...`, 'info');
            try {
              const res = await callTool('veto_continue', { session_id: msg.id, resuming_as: 'antigravity' }, 'Veto: resume session');
              appendLog(`[Resume] Session ${msg.id} resumed successfully.`, 'success');
              hud.postActionStatus({ action: 'resume', status: 'done', message: 'Session restored in Console.', result: res });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              appendLog(`[Resume Error] ${errMsg}`, 'error');
              hud.postActionStatus({ action: 'resume', status: 'error', message: errMsg });
            }
          })();
        } else {
          vscode.commands.executeCommand('veto.continueSession', msg.id, msg.platform);
        }
        break;
      }
      case 'copyId': {
        vscode.commands.executeCommand('veto.copySessionId', msg.id);
        break;
      }
      case 'command': {
        vscode.commands.executeCommand(msg.command);
        break;
      }
      case 'searchMemory': {
        const results = store.searchMemory(msg.query).map(r => ({ title: r.title, type: r.type, project_dir: r.project_dir }));
        hud.postMemoryResults(results, msg.requestId);
        break;
      }
      case 'getSettings': {
        hud.postSettings(getSettingsPayload());
        break;
      }
      case 'saveSettings': {
        void (async () => {
          const c = cfg();
          try {
            if (msg.settings.cliPath !== undefined) await c.update('cliPath', msg.settings.cliPath.trim(), vscode.ConfigurationTarget.Global);
            if (msg.settings.dbPath !== undefined) await c.update('dbPath', msg.settings.dbPath.trim(), vscode.ConfigurationTarget.Global);
            if (msg.settings.pollInterval !== undefined) await c.update('pollInterval', msg.settings.pollInterval, vscode.ConfigurationTarget.Global);
            if (msg.settings.actionTimeoutMs !== undefined) await c.update('actionTimeoutMs', msg.settings.actionTimeoutMs, vscode.ConfigurationTarget.Global);
            appendLog('Settings updated.', 'success');
            hud.postSettings(getSettingsPayload());
            vscode.window.showInformationMessage('Veto: settings saved.');
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            appendLog(`Failed to save settings: ${errMsg}`, 'error');
            vscode.window.showErrorMessage(`Veto: ${errMsg}`);
          }
        })();
        break;
      }
      case 'getProjects': {
        hud.postProjects(getProjectsList());
        break;
      }
      case 'selectProject': {
        void (async () => {
          pinnedProject = msg.projectDir;
          await context.workspaceState.update('veto.selectedProject', pinnedProject);
          cachedBackendSnapshot = undefined;
          hud.setBackendSnapshot();
          store.setProjectDir(getActiveProjectDir());
          store.refresh(true);
          hud.postProjects(getProjectsList());
        })();
        break;
      }
      case 'queryExplorer': {
        void (async () => {
          try {
            const projectDir = getActiveProjectDir();
            const scope: DetailScope = msg.scope === 'all' ? { all: true } : (projectDir ? { projectDir } : { all: true });
            switch (msg.kind) {
              case 'sessions': {
                const page = store.sessionPage(scope, msg.offset ?? 0, msg.search ?? '');
                hud.postExplorerData({ kind: 'sessions', items: page.items, hasMore: page.hasMore, total: page.items.length, offset: msg.offset, requestId: msg.requestId });
                break;
              }
              case 'memory': {
                const page = store.memoryPage(scope, msg.offset ?? 0, msg.search ?? '');
                hud.postExplorerData({ kind: 'memory', items: page.items, hasMore: page.hasMore, total: page.items.length, offset: msg.offset, requestId: msg.requestId });
                break;
              }
              case 'council': {
                const page = store.councilPage(scope, msg.offset ?? 0);
                hud.postExplorerData({ kind: 'council', items: page.items, hasMore: page.hasMore, total: page.items.length, offset: msg.offset, requestId: msg.requestId });
                break;
              }
              case 'decisions': {
                const page = store.decisionPage(scope, msg.offset ?? 0);
                hud.postExplorerData({ kind: 'decisions', items: page.items, hasMore: page.hasMore, total: page.items.length, offset: msg.offset, requestId: msg.requestId });
                break;
              }
              case 'constraints': {
                const page = store.constraintPage(scope, msg.offset ?? 0);
                hud.postExplorerData({ kind: 'constraints', items: page.items, hasMore: page.hasMore, total: page.items.length, offset: msg.offset, requestId: msg.requestId });
                break;
              }
              case 'reviews': {
                const items = store.reviewDetails(scope);
                hud.postExplorerData({ kind: 'reviews', items, hasMore: false, total: items.length, requestId: msg.requestId });
                break;
              }
              case 'learning': {
                const details = store.learningDetails();
                hud.postExplorerData({ kind: 'learning', items: [details], hasMore: false, total: 1, requestId: msg.requestId });
                break;
              }
              case 'tools': {
                let items: any[] = [];
                try {
                  const raw = await spawnProcess('veto', ['tools', '--json'], undefined, { cwd: projectDir, timeoutMs: 15000 });
                  items = parseCatalog(raw, 'tools');
                } catch {
                  items = [];
                }
                hud.postExplorerData({ kind: 'tools', items, hasMore: false, total: items.length, requestId: msg.requestId });
                break;
              }
              case 'agents': {
                let items: any[] = [];
                try {
                  const raw = await spawnProcess('veto', ['agents', '--json'], undefined, { cwd: projectDir, timeoutMs: 15000 });
                  items = parseCatalog(raw, 'agents');
                } catch {
                  items = [];
                }
                hud.postExplorerData({ kind: 'agents', items, hasMore: false, total: items.length, requestId: msg.requestId });
                break;
              }
              case 'transcripts': {
                if (!projectDir) throw new Error('Select a project before searching transcripts.');
                const db = store.getDbPath();
                const input: Record<string, unknown> = {
                  project: projectDir,
                  query: (msg.search ?? '').trim(),
                  limit: 25,
                  ...(msg.source && msg.source !== 'All sources' ? { source: msg.source } : {}),
                };
                if (isCustomDbPath() || !pathsEqual(db, join(homedir(), '.veto', 'veto.db'))) {
                  input.db = db;
                }
                const env = await backendCmds.callApi('recall search', input, projectDir);
                const hits = env?.data?.hits ?? [];
                hud.postExplorerData({ kind: 'transcripts', items: hits, hasMore: false, total: hits.length, requestId: msg.requestId });
                break;
              }
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            hud.postExplorerData({ kind: msg.kind, items: [], error: errMsg, requestId: msg.requestId });
          }
        })();
        break;
      }
      case 'getMemoryDetail': {
        try {
          const projectDir = getActiveProjectDir();
          const scope: DetailScope = msg.scope === 'all' ? { all: true } : (projectDir ? { projectDir } : { all: true });
          const detail = store.memoryDetail(scope, msg.id);
          hud.postExplorerDetail({ kind: 'memory', id: msg.id, detail, requestId: msg.requestId });
        } catch (err) {
          hud.postExplorerDetail({ kind: 'memory', id: msg.id, detail: null, error: String(err), requestId: msg.requestId });
        }
        break;
      }
      case 'expandTranscript': {
        void (async () => {
          try {
            const projectDir = getActiveProjectDir();
            if (!projectDir) throw new Error('No active project.');
            const db = store.getDbPath();
            const input: Record<string, unknown> = { project: projectDir, event_id: msg.eventId };
            if (isCustomDbPath() || !pathsEqual(db, join(homedir(), '.veto', 'veto.db'))) {
              input.db = db;
            }
            const env = await backendCmds.callApi('recall expand', input, projectDir);
            hud.postExplorerDetail({ kind: 'transcripts', id: msg.eventId, detail: env?.data ?? env, requestId: msg.requestId });
          } catch (err) {
            hud.postExplorerDetail({ kind: 'transcripts', id: msg.eventId, detail: null, error: String(err), requestId: msg.requestId });
          }
        })();
        break;
      }
      case 'runAction': {
        void (async () => {
          if (!vscode.workspace.isTrusted) {
            vscode.window.showWarningMessage('Veto: trust this workspace before launching an action.');
            hud.postActionStatus({ action: msg.action, status: 'error', message: 'Workspace untrusted.', requestId: msg.requestId });
            return;
          }
          hud.postActionStatus({ action: msg.action, status: 'running', requestId: msg.requestId });
          const projectDir = getActiveProjectDir();
          try {
            switch (msg.action) {
              case 'debate': {
                const topic = typeof msg.params?.task === 'string' ? msg.params.task.trim() : '';
                if (!topic) throw new Error('Debate topic is required.');
                appendLog(`[Council Debate] Starting debate: "${topic}"...`, 'info');
                const out = await callTool('veto_council_debate', { task: topic, project_dir: projectDir }, 'Veto: Council Debate');
                const parsed = out ? parseToolOutput(out) : undefined;
                appendLog(`[Council Debate] Finished. Verdict: ${parsed?.verdict ?? 'Completed'}`, parsed?.verdict === 'RED' ? 'error' : parsed?.verdict === 'YELLOW' ? 'warn' : 'success');
                hud.postActionStatus({ action: 'debate', status: 'done', verdict: parsed?.verdict, result: parsed?.raw ?? out, requestId: msg.requestId });
                break;
              }
              case 'saveCheckpoint': {
                const summary = typeof msg.params?.summary === 'string' ? msg.params.summary.trim() : '';
                if (!summary) throw new Error('Checkpoint summary is required.');
                if (!projectDir) throw new Error('Select a project before saving a checkpoint.');
                appendLog(`[Checkpoint] Saving summary: "${summary}"...`, 'info');
                const out = await callTool('veto_session_save', { summary, project_dir: projectDir, platform: 'claude', auto_summarize: false }, 'Veto: save summary checkpoint');
                appendLog('[Checkpoint] Saved successfully.', 'success');
                hud.postActionStatus({ action: 'saveCheckpoint', status: 'done', result: out, requestId: msg.requestId });
                break;
              }
              case 'reviewFile': {
                const editor = vscode.window.activeTextEditor;
                if (!editor) throw new Error('Open a file in the editor to review.');
                const code = bounded(editor.document.getText());
                if (!code.trim()) throw new Error('Active file is empty.');
                const filePath = editor.document.uri.fsPath;
                appendLog(`[Review File] Reviewing ${filePath}...`, 'info');
                const out = await callTool('veto_code_review', { code, file_path: filePath }, 'Veto: review editor buffer');
                const parsed = out ? parseToolOutput(out) : undefined;
                appendLog(`[Review File] Review finished. Verdict: ${parsed?.verdict ?? 'Completed'}`, parsed?.verdict === 'RED' ? 'error' : 'success');
                hud.postActionStatus({ action: 'reviewFile', status: 'done', verdict: parsed?.verdict, result: parsed?.raw ?? out, requestId: msg.requestId });
                break;
              }
              case 'reviewPR': {
                const prUrl = typeof msg.params?.prUrl === 'string' ? msg.params.prUrl.trim() : '';
                if (!prUrl || !/^https:\/\/github\.com\/[^/?#\s]+\/[^/?#\s]+\/pull\/\d+\/?$/.test(prUrl)) {
                  throw new Error('Valid GitHub pull request URL is required.');
                }
                appendLog(`[Review PR] Reviewing PR: ${prUrl}...`, 'info');
                const out = await callTool('veto_pr_review', { pr_url: prUrl }, 'Veto: review PR');
                const parsed = out ? parseToolOutput(out) : undefined;
                appendLog(`[Review PR] Finished. Verdict: ${parsed?.verdict ?? 'Completed'}`, parsed?.verdict === 'RED' ? 'error' : 'success');
                hud.postActionStatus({ action: 'reviewPR', status: 'done', verdict: parsed?.verdict, result: parsed?.raw ?? out, requestId: msg.requestId });
                break;
              }
              case 'scanSecrets': {
                const scope = typeof msg.params?.scope === 'string' ? msg.params.scope : 'working';
                const editor = vscode.window.activeTextEditor;
                appendLog(`[Scan Secrets] Scanning secrets with scope: ${scope}...`, 'info');
                let text = '';
                let filePath: string | undefined;
                if (scope === 'active') {
                  if (!editor) throw new Error('Open an editor to scan active file.');
                  text = bounded(editor.document.getText());
                  filePath = editor.document.uri.fsPath;
                } else {
                  if (!projectDir) throw new Error('Select a project to scan git changes.');
                  const args = scope === 'staged' ? ['diff', '--cached', '--no-ext-diff', '--no-textconv'] : ['diff', 'HEAD', '--no-ext-diff', '--no-textconv'];
                  text = bounded(await spawnProcess('git', args, undefined, { cwd: projectDir }));
                }
                if (!text.trim()) {
                  appendLog('[Scan Secrets] No content to scan.', 'info');
                  hud.postActionStatus({ action: 'scanSecrets', status: 'done', message: 'No content to scan in chosen scope.', requestId: msg.requestId });
                  return;
                }
                const out = await callTool('veto_secrets_scan', { text, ...(filePath ? { file_path: filePath } : {}) }, 'Veto: scan secrets');
                const parsed = out ? parseToolOutput(out) : undefined;
                appendLog(`[Scan Secrets] Scan complete. Verdict: ${parsed?.verdict ?? 'Completed'}`, parsed?.verdict === 'RED' ? 'error' : 'success');
                hud.postActionStatus({ action: 'scanSecrets', status: 'done', verdict: parsed?.verdict, result: parsed?.raw ?? out, requestId: msg.requestId });
                break;
              }
              case 'draftCommit': {
                if (!projectDir) throw new Error('Select a project before generating commit draft.');
                appendLog('[Draft Commit] Generating draft commit message...', 'info');
                const out = await callTool('veto_commit_message', { project_dir: projectDir }, 'Veto: drafting commit message');
                appendLog('[Draft Commit] Finished.', 'success');
                hud.postActionStatus({ action: 'draftCommit', status: 'done', result: out, requestId: msg.requestId });
                break;
              }
              case 'draftPR': {
                if (!projectDir) throw new Error('Select a project before generating PR draft.');
                const baseBranch = typeof msg.params?.baseBranch === 'string' ? msg.params.baseBranch.trim() : 'main';
                appendLog(`[Draft PR] Generating draft PR description against ${baseBranch}...`, 'info');
                const out = await callTool('veto_pr_description', { project_dir: projectDir, base_branch: baseBranch }, 'Veto: drafting PR description');
                appendLog('[Draft PR] Finished.', 'success');
                hud.postActionStatus({ action: 'draftPR', status: 'done', result: out, requestId: msg.requestId });
                break;
              }
              case 'backendDiagnostics': {
                appendLog('[Diagnostics] Running backend diagnostics...', 'info');
                const db = store.getDbPath();
                const input: Record<string, unknown> = { checks: [] };
                if (isCustomDbPath() || !pathsEqual(db, join(homedir(), '.veto', 'veto.db'))) {
                  input.db = db;
                }
                const env = await backendCmds.callApi('diagnostics', input, projectDir);
                appendLog('[Diagnostics] Backend diagnostics completed.', 'success');
                hud.postActionStatus({ action: 'backendDiagnostics', status: 'done', result: env, requestId: msg.requestId });
                break;
              }
              case 'setupDiagnostics': {
                const report = visibilityReport(store.getSnapshot(), {
                  extensionVersion: context.extension.packageJSON.version ?? 'Unknown',
                  runtimeVersion: process.versions.node,
                  trusted: vscode.workspace.isTrusted,
                  remoteName: vscode.env.remoteName,
                  projectDir,
                });
                hud.postActionStatus({ action: 'setupDiagnostics', status: 'done', result: report, requestId: msg.requestId });
                break;
              }
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            appendLog(`[Action Error] ${errMsg}`, 'error');
            hud.postActionStatus({ action: msg.action, status: 'error', message: errMsg, requestId: msg.requestId });
          }
        })();
        break;
      }
      case 'cancelAction': {
        cancelAllProcesses();
        appendLog('Active action cancelled.', 'warn');
        hud.postActionStatus({ action: 'cancel', status: 'cancelled' });
        break;
      }
      case 'clearLog': {
        hud.clearLogs();
        break;
      }
    }
  };

  hud = new HudView(handleHudMessage, () => store.getSnapshot());
  const openHud = () => vscode.commands.executeCommand(`${HudView.viewType}.focus`);

  context.subscriptions.push(
    store, statusBar, diagnostics,
    vscode.window.registerWebviewViewProvider(HudView.viewType, hud, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // ── Single render path: one snapshot drives status bar, HUD, and diagnostics ──
  const observedProjects = new Set<string>();
  context.subscriptions.push(
    store.onChange((snap: VetoSnapshot) => {
      statusBar.render(snap);
      hud.render(snap);
      updateDiagnostics(diagnostics, snap);

      // Refresh cached snapshot when database changes or on explicit refresh
      if (cachedBackendSnapshot && vscode.workspace.isTrusted && getActiveProjectDir()) {
        void backendCmds.refreshSnapshot(true);
      }

      // One-time toast when a new RED council verdict appears.
      const c = snap.council;
      const project = getActiveProjectDir() ?? '';
      const noticeKey = `veto.lastCouncil.${project}`;
      const lastId = context.workspaceState.get<string>(noticeKey);
      if (observedProjects.has(project) && c && c.verdict === 'RED' && c.id !== lastId) {
        vscode.window.showWarningMessage(`Veto Council: RED — ${c.recommended ?? 'no recommendation'}`, 'Open HUD')
          .then(a => { if (a === 'Open HUD') openHud(); });
      }
      if (!snap.stale) {
        observedProjects.add(project);
        if (c) void context.workspaceState.update(noticeKey, c.id);
      }
    }),
  );

  // ── Live config + workspace reactions ────────────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('veto')) return;
      cachedBackendSnapshot = undefined;
      hud.setBackendSnapshot();
      store.setDbPath(cfg().get<string>('dbPath', '') || undefined);
      store.setPollInterval(cfg().get<number>('pollInterval', 5000));
      hud.postSettings(getSettingsPayload());
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      cachedBackendSnapshot = undefined;
      hud.setBackendSnapshot();
      store.setProjectDir(getActiveProjectDir());
      hud.postProjects(getProjectsList());
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      const oldProj = store.getSnapshot().projectDir;
      const newProj = getActiveProjectDir();
      if (oldProj !== newProj) {
        cachedBackendSnapshot = undefined;
        hud.setBackendSnapshot();
      }
      store.setProjectDir(newProj);
      hud.postProjects(getProjectsList());
    }),
  );

  registerCommands(context, { store, outputChannel, openHud, getProjectDir: getActiveProjectDir });

  store.start();
  appendLog(`Veto HUD v${version} active. DB: ${store.getDbPath()}`, 'info');
}

/** Convert scan_diagnostics rows from the snapshot into editor squiggles, grouped by file. */
function updateDiagnostics(collection: vscode.DiagnosticCollection, snap: VetoSnapshot): void {
  collection.clear();
  if (!snap.diagnostics.length) return;
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const row of snap.diagnostics) {
    const sev = row.severity === 'error'   ? vscode.DiagnosticSeverity.Error
              : row.severity === 'warning' ? vscode.DiagnosticSeverity.Warning
              : vscode.DiagnosticSeverity.Information;
    const line = Number.isFinite(row.line) ? Math.max(0, Math.floor(row.line)) : 0;
    const column = Number.isFinite(row.col_start) ? Math.max(0, Math.floor(row.col_start)) : 0;
    const range = new vscode.Range(line, column, line, column + 1);
    const d = new vscode.Diagnostic(range, `[veto/${row.source}] ${row.message}`, sev);
    d.source = 'veto';
    if (!byFile.has(row.file_path)) byFile.set(row.file_path, []);
    byFile.get(row.file_path)!.push(d);
  }
  for (const [fp, diags] of byFile) collection.set(vscode.Uri.file(fp), diags);
}

export function deactivate(): void {}
