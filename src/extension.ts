// Veto HUD — extension entry point. Wiring only: build the store, the status-bar pulse,
// the HUD, and the commands, then connect them. All real logic lives in core/ ui/ commands/.

import * as vscode from 'vscode';
import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { VetoStore } from './core/VetoStore';
import type { VetoSnapshot, DetailScope } from './core/snapshot';
import { parseApiEnvelope, requireCompatibleBackend, type ApiEnvelope } from './core/backend';
import { StatusBar } from './ui/StatusBar';
import {
  HudView,
  type HudMessage,
  type SettingsPayload,
  type ProjectItem,
  type ActionStatusMessage,
} from './ui/HudView';
import { registerCommands } from './commands';
import { cancelAllProcesses, spawnProcess, detectPrUrl, type ToolOutcome } from './commands/process';
import { runStructuredTool } from './commands/veto';
import { parseCatalog } from './core/catalog';
import { vetoInvocation } from './core/cli';
import { selectedProject } from './core/projects';
import { registerBackendCommands } from './commands/backend';
import { pathsEqual, isCustomDbPath } from './core/paths';
import { visibilityReport } from './core/visibility';

type RunActionMessage = Extract<HudMessage, { type: 'runAction' }>;
type ActionResult = Omit<ActionStatusMessage, 'action' | 'requestId'>;

const DEFAULT_DB = join(homedir(), '.veto', 'veto.db');
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const PR_URL = /^https:\/\/github\.com\/[^/?#\s]+\/[^/?#\s]+\/pull\/\d+\/?$/;
const errorText = (err: unknown) => err instanceof Error ? err.message : String(err);
const matches = (search: string | undefined, ...fields: unknown[]) => {
  const q = (search ?? '').trim().toLowerCase();
  return !q || fields.some(f => typeof f === 'string' && f.toLowerCase().includes(q));
};

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

  const isCustomDb = (db: string) => isCustomDbPath() || !pathsEqual(db, DEFAULT_DB);
  /** Name the HUD database in backend requests whenever it is not the default. */
  const withDb = (input: Record<string, unknown>) => {
    const db = store.getDbPath();
    if (isCustomDb(db)) input.db = db;
    return input;
  };

  const getSettingsPayload = (): SettingsPayload => {
    const c = cfg();
    const dbPath = c.get<string>('dbPath', '');
    return {
      cliPath: c.get<string>('cliPath', ''),
      dbPath,
      pollInterval: c.get<number>('pollInterval', 5000),
      actionTimeoutMs: c.get<number>('actionTimeoutMs', 120000),
      isCustomDb: !!dbPath && !pathsEqual(dbPath, DEFAULT_DB),
      defaultDbPath: DEFAULT_DB,
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

  /** Project or database changed: drop cached backend state and stale Explorer results (F05). */
  const onScopeChanged = () => {
    cachedBackendSnapshot = undefined;
    hud.setBackendSnapshot();
    hud.postScopeChanged();
  };

  const pinProject = async (projectDir: string | undefined) => {
    pinnedProject = projectDir;
    await context.workspaceState.update('veto.selectedProject', pinnedProject);
    onScopeChanged();
    store.setProjectDir(getActiveProjectDir());
    store.refresh(true);
    hud.postProjects(getProjectsList());
  };

  context.subscriptions.push(vscode.commands.registerCommand('veto.selectProject', async () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const choice = await vscode.window.showQuickPick([
      { label: 'Follow active editor', description: 'Use the editor folder, falling back to the first workspace folder', path: undefined as string | undefined },
      ...folders.map(f => ({ label: f.name, description: f.uri.fsPath, path: f.uri.fsPath })),
    ], { placeHolder: 'Select the project for Veto data and actions' });
    if (!choice) return;
    await pinProject(choice.path);
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

  /**
   * AI workflows run through the Veto MCP server, which writes to its own database. Refuse
   * to start one when that database is not the one the HUD shows (F18).
   */
  const ensureWorkflowDatabase = async (projectDir?: string): Promise<void> => {
    const db = store.getDbPath();
    if (!isCustomDb(db)) return;
    const env = await backendCmds.callApi('diagnostics', { checks: [], db }, projectDir);
    if (env.state === 'ok') return;
    throw new Error(`AI workflows write to the Veto backend's database, but the HUD is reading ${db}. ` +
      `${env.message ?? `Backend state: ${env.state}.`} Clear the database override in Settings, or configure Veto to use the same database.`);
  };

  // ── HUD actions: one at a time, each with its own cancellation (F01) ─────────
  let activeAction: { requestId?: number; source: vscode.CancellationTokenSource } | undefined;

  const fromOutcome = (label: string, outcome: ToolOutcome): ActionResult => {
    switch (outcome.status) {
      case 'completed': {
        const v = outcome.verdict;
        appendLog(`[${label}] Finished${v ? `. Verdict: ${v}` : '.'}`, v === 'RED' || v === 'DEADLOCK' ? 'error' : v === 'YELLOW' ? 'warn' : 'success');
        return { status: 'done', verdict: v, result: outcome.output };
      }
      case 'cancelled':
        appendLog(`[${label}] Cancelled.`, 'warn');
        return { status: 'cancelled', message: 'Cancelled.' };
      case 'pending':
        appendLog(`[${label}] ${outcome.message}`, 'warn');
        return { status: 'error', message: outcome.message, result: outcome.output };
      case 'error':
        appendLog(`[${label}] ${outcome.message}`, 'error');
        return { status: 'error', message: outcome.message, result: outcome.output };
    }
  };

  const runTool = async (label: string, tool: string, input: Record<string, unknown>, title: string,
    token: vscode.CancellationToken, cwd = getActiveProjectDir()): Promise<ActionResult> => {
    await ensureWorkflowDatabase(cwd);
    if (token.isCancellationRequested) return fromOutcome(label, { status: 'cancelled', message: 'Cancelled.' });
    const outcome = await runStructuredTool(outputChannel, {
      title, cwd, tool, input, cancellationToken: token,
      onProgress: line => appendLog(`[${label}] ${line}`, 'info'),
    });
    store.refresh(true);
    return fromOutcome(label, outcome);
  };

  const runHudAction = async (action: string, requestId: number | undefined,
    perform: (token: vscode.CancellationToken) => Promise<ActionResult>, opts: { exclusive?: boolean } = {}) => {
    const post = (result: ActionResult) => hud.postActionStatus({ action, requestId, ...result });
    const exclusive = opts.exclusive ?? true;
    if (exclusive && !vscode.workspace.isTrusted) {
      vscode.window.showWarningMessage('Veto: trust this workspace before launching an action.');
      post({ status: 'error', message: 'Workspace untrusted. Trust this workspace to run actions.' });
      return;
    }
    if (exclusive && activeAction) {
      post({ status: 'error', message: 'Another action is already running. Cancel it or wait for it to finish.' });
      return;
    }
    const source = new vscode.CancellationTokenSource();
    if (exclusive) activeAction = { requestId, source };
    post({ status: 'running' });
    try {
      post(await perform(source.token));
    } catch (err) {
      const message = errorText(err);
      if (/cancelled/i.test(message)) {
        appendLog(`[${action}] Cancelled.`, 'warn');
        post({ status: 'cancelled', message: 'Cancelled.' });
      } else {
        appendLog(`[Action Error] ${message}`, 'error');
        post({ status: 'error', message });
      }
    } finally {
      if (activeAction?.source === source) activeAction = undefined;
      source.dispose();
    }
  };

  const performAction = async (msg: RunActionMessage, token: vscode.CancellationToken): Promise<ActionResult> => {
    const projectDir = getActiveProjectDir();
    const param = (key: string) => typeof msg.params?.[key] === 'string' ? (msg.params[key] as string).trim() : '';
    switch (msg.action) {
      case 'debate': {
        const topic = param('task');
        if (!topic) throw new Error('Debate topic is required.');
        appendLog(`[Council Debate] Starting debate: "${topic}"...`, 'info');
        return runTool('Council Debate', 'veto_council_debate', { task: topic, project_dir: projectDir }, 'Veto: Council Debate', token);
      }
      case 'saveCheckpoint': {
        const summary = param('summary');
        if (!summary) throw new Error('Checkpoint summary is required.');
        if (!projectDir) throw new Error('Select a project before saving a checkpoint.');
        appendLog(`[Checkpoint] Saving summary: "${summary}"...`, 'info');
        return runTool('Checkpoint', 'veto_session_save', { summary, project_dir: projectDir, platform: 'claude', auto_summarize: false }, 'Veto: save summary checkpoint', token);
      }
      case 'reviewFile': {
        const editor = vscode.window.activeTextEditor;
        if (!editor) throw new Error('Open a file in the editor to review.');
        const code = bounded(editor.document.getText());
        if (!code.trim()) throw new Error('Active file is empty.');
        const filePath = editor.document.uri.fsPath;
        appendLog(`[Review File] Reviewing ${filePath}...`, 'info');
        return runTool('Review File', 'veto_code_review', { code, file_path: filePath }, 'Veto: review editor buffer', token);
      }
      case 'reviewPR': {
        const prUrl = param('prUrl');
        if (!PR_URL.test(prUrl)) throw new Error('Valid GitHub pull request URL is required.');
        appendLog(`[Review PR] Reviewing PR: ${prUrl}...`, 'info');
        return runTool('Review PR', 'veto_pr_review', { pr_url: prUrl }, 'Veto: review PR', token);
      }
      case 'scanSecrets': {
        const scope = param('scope') || 'working';
        const editor = vscode.window.activeTextEditor;
        appendLog(`[Scan Secrets] Scanning secrets with scope: ${scope}...`, 'info');
        let text: string;
        let filePath: string | undefined;
        if (scope === 'active') {
          if (!editor) throw new Error('Open an editor to scan active file.');
          text = bounded(editor.document.getText());
          filePath = editor.document.uri.fsPath;
        } else {
          if (!projectDir) throw new Error('Select a project to scan git changes.');
          const args = scope === 'staged' ? ['diff', '--cached', '--no-ext-diff', '--no-textconv'] : ['diff', 'HEAD', '--no-ext-diff', '--no-textconv'];
          text = bounded(await spawnProcess('git', args, undefined, { cwd: projectDir, cancellationToken: token }));
        }
        if (!text.trim()) {
          appendLog('[Scan Secrets] No content to scan.', 'info');
          return { status: 'done', message: 'No content to scan in chosen scope.' };
        }
        return runTool('Scan Secrets', 'veto_secrets_scan', { text, ...(filePath ? { file_path: filePath } : {}) }, 'Veto: scan secrets', token);
      }
      case 'draftCommit': {
        if (!projectDir) throw new Error('Select a project before generating commit draft.');
        appendLog('[Draft Commit] Generating draft commit message...', 'info');
        return runTool('Draft Commit', 'veto_commit_message', { project_dir: projectDir }, 'Veto: drafting commit message', token);
      }
      case 'draftPR': {
        if (!projectDir) throw new Error('Select a project before generating PR draft.');
        const baseBranch = param('baseBranch') || 'main';
        if (!BRANCH.test(baseBranch) || baseBranch.includes('..')) throw new Error('Enter a valid base branch name.');
        appendLog(`[Draft PR] Generating draft PR description against ${baseBranch}...`, 'info');
        return runTool('Draft PR', 'veto_pr_description', { project_dir: projectDir, base_branch: baseBranch }, 'Veto: drafting PR description', token);
      }
      case 'backendDiagnostics': {
        appendLog('[Diagnostics] Running backend diagnostics...', 'info');
        const env = await backendCmds.callApi('diagnostics', withDb({ checks: [] }), projectDir);
        if (env.state !== 'ok') {
          const message = env.message ?? `Backend state: ${env.state}`;
          appendLog(`[Diagnostics] ${env.state}: ${message}`, 'error');
          return { status: 'error', message, result: env };
        }
        appendLog('[Diagnostics] Backend diagnostics completed.', 'success');
        return { status: 'done', result: env };
      }
      case 'setupDiagnostics': {
        const report = visibilityReport(store.getSnapshot(), {
          extensionVersion: context.extension.packageJSON.version ?? 'Unknown',
          runtimeVersion: process.versions.node,
          trusted: vscode.workspace.isTrusted,
          remoteName: vscode.env.remoteName,
          projectDir,
        });
        return { status: 'done', result: report };
      }
    }
  };

  // ── Explorer queries ─────────────────────────────────────────────────────────
  const queryExplorer = async (msg: Extract<HudMessage, { type: 'queryExplorer' }>) => {
    const offset = msg.offset ?? 0;
    const reply = (items: unknown[], extra: { hasMore?: boolean; notice?: string } = {}) =>
      hud.postExplorerData({ kind: msg.kind, items, hasMore: extra.hasMore ?? false, total: items.length, offset, requestId: msg.requestId, notice: extra.notice });
    try {
      const projectDir = getActiveProjectDir();
      const scope: DetailScope = msg.scope === 'all' ? { all: true } : (projectDir ? { projectDir } : { all: true });
      const search = msg.search ?? '';
      switch (msg.kind) {
        case 'sessions': { const page = store.sessionPage(scope, offset, search); reply(page.items, page); break; }
        case 'memory': { const page = store.memoryPage(scope, offset, search); reply(page.items, page); break; }
        case 'council': { const page = store.councilPage(scope, offset, search); reply(page.items, page); break; }
        case 'decisions': { const page = store.decisionPage(scope, offset, search); reply(page.items, page); break; }
        case 'constraints': { const page = store.constraintPage(scope, offset, search); reply(page.items, page); break; }
        case 'reviews': {
          reply(store.reviewDetails(scope).filter(r => matches(search, r.message, r.source, r.file_path, r.severity)));
          break;
        }
        case 'learning': reply([store.learningDetails()]); break;
        case 'tools':
        case 'agents': {
          // Listing the catalog runs the installed CLI, so it needs trust like other CLI routes (F02).
          if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace to load the Veto CLI catalog.');
          const cli = vetoInvocation(cfg().get<string>('cliPath', ''));
          const raw = await spawnProcess(cli.command, [...cli.prefix, msg.kind, '--json'], undefined, { cwd: projectDir, timeoutMs: 15000 });
          reply(parseCatalog(raw, msg.kind).filter(e => matches(search, e.name, e.description, e.category)));
          break;
        }
        case 'transcripts': {
          if (!projectDir) throw new Error('Select a project before searching transcripts.');
          if (!search.trim()) {
            reply([], { notice: 'Type a search to find events in this project\'s masked transcript archives.' });
            break;
          }
          const input = withDb({
            project: projectDir,
            query: search.trim(),
            limit: 20,
            ...(msg.source && msg.source !== 'All sources' ? { source: msg.source } : {}),
          });
          const env = await backendCmds.callApi('recall search', input, projectDir);
          if (env.state === 'ok') reply(env.data?.hits ?? []);
          else if (env.state === 'no_match' || env.state === 'no_archive') reply([], { notice: env.message });
          else throw new Error(`Transcript search failed (${env.state}): ${env.message ?? 'no details'}`);
          break;
        }
      }
    } catch (err) {
      hud.postExplorerData({ kind: msg.kind, items: [], error: errorText(err), offset, requestId: msg.requestId });
    }
  };

  const detectCli = async (requestId?: number) => {
    try {
      if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before detecting the Veto CLI.');
      let raw: string;
      try {
        raw = await spawnProcess('veto', ['api', 'version', '--stdin'], undefined, { cwd: getActiveProjectDir(), input: '{}', timeoutMs: 15000, jobKey: 'detect:cli' });
      } catch {
        throw new Error('Veto was not found on PATH. Install Veto 3.8.0 or later, or enter the absolute path to its cli.js.');
      }
      const env = parseApiEnvelope(raw, 'version');
      requireCompatibleBackend(env, 'version');
      const cliPath = env.data?.cli_path;
      if (typeof cliPath !== 'string' || !isAbsolute(cliPath) || !/\.js$/i.test(cliPath)) {
        throw new Error('The Veto on PATH did not report its cli.js location. Leave the field empty to use Veto from PATH.');
      }
      hud.postDetection('cli', { value: cliPath }, requestId);
    } catch (err) {
      hud.postDetection('cli', { error: errorText(err) }, requestId);
    }
  };

  const detectPr = async (requestId?: number) => {
    try {
      if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before detecting pull requests.');
      const cwd = getActiveProjectDir();
      if (!cwd) throw new Error('Select a project first.');
      const url = await detectPrUrl(cwd);
      if (!url) throw new Error('No open pull request found for the current branch. Detection uses the GitHub CLI (gh); check that it is installed and signed in.');
      hud.postDetection('pr', { value: url }, requestId);
    } catch (err) {
      hud.postDetection('pr', { error: errorText(err) }, requestId);
    }
  };

  // ── HUD message routing ──────────────────────────────────────────────────────
  const handleHudMessage = (msg: HudMessage): void => {
    switch (msg.type) {
      case 'ready': {
        // Webview handshake (F10): send everything it needs once it is listening.
        hud.postProjects(getProjectsList());
        hud.postSettings(getSettingsPayload());
        hud.render(store.getSnapshot());
        hud.replayLogs();
        break;
      }
      case 'resume': {
        if (msg.target === 'console') {
          void runHudAction('resume', msg.requestId, token => {
            appendLog(`[Resume] Resuming session ${msg.id} via veto_continue in Console...`, 'info');
            // The console route runs Claude, so Claude is the resuming client (F07).
            return runTool('Resume', 'veto_continue', { session_id: msg.id, resuming_as: 'claude' }, 'Veto: resume session', token);
          });
        } else {
          vscode.commands.executeCommand('veto.continueSession', msg.id, msg.platform);
        }
        break;
      }
      case 'copyId': {
        vscode.commands.executeCommand('veto.copySessionId', msg.id);
        break;
      }
      case 'copyText': {
        void vscode.env.clipboard.writeText(msg.text).then(
          () => vscode.window.showInformationMessage(`Veto: copied ${msg.text.length.toLocaleString()} characters to the clipboard.`),
          err => vscode.window.showErrorMessage(`Veto: copy failed: ${errorText(err)}`));
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
            if (msg.settings.cliPath !== undefined) {
              const cliPath = msg.settings.cliPath.trim();
              vetoInvocation(cliPath); // reject values the backend would refuse (F03)
              await c.update('cliPath', cliPath, vscode.ConfigurationTarget.Global);
            }
            if (msg.settings.dbPath !== undefined) await c.update('dbPath', msg.settings.dbPath.trim(), vscode.ConfigurationTarget.Global);
            if (msg.settings.pollInterval !== undefined) await c.update('pollInterval', msg.settings.pollInterval, vscode.ConfigurationTarget.Global);
            if (msg.settings.actionTimeoutMs !== undefined) await c.update('actionTimeoutMs', msg.settings.actionTimeoutMs, vscode.ConfigurationTarget.Global);
            appendLog('Settings updated.', 'success');
            hud.postSettings(getSettingsPayload());
            vscode.window.showInformationMessage('Veto: settings saved.');
          } catch (err) {
            const errMsg = errorText(err);
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
        void pinProject(msg.projectDir);
        break;
      }
      case 'queryExplorer': {
        void queryExplorer(msg);
        break;
      }
      case 'getMemoryDetail': {
        try {
          const projectDir = getActiveProjectDir();
          const scope: DetailScope = msg.scope === 'all' ? { all: true } : (projectDir ? { projectDir } : { all: true });
          const detail = store.memoryDetail(scope, msg.id);
          hud.postExplorerDetail({ kind: 'memory', id: msg.id, detail, requestId: msg.requestId, error: detail ? undefined : 'Memory record not found in this scope.' });
        } catch (err) {
          hud.postExplorerDetail({ kind: 'memory', id: msg.id, detail: null, error: errorText(err), requestId: msg.requestId });
        }
        break;
      }
      case 'expandTranscript': {
        void (async () => {
          try {
            const projectDir = getActiveProjectDir();
            if (!projectDir) throw new Error('No active project.');
            const env = await backendCmds.callApi('recall expand', withDb({ project: projectDir, event_id: msg.eventId }), projectDir);
            if (env.state !== 'ok') throw new Error(`Transcript expansion failed (${env.state}): ${env.message ?? 'no details'}`);
            hud.postExplorerDetail({ kind: 'transcripts', id: msg.eventId, detail: env.data, requestId: msg.requestId });
          } catch (err) {
            hud.postExplorerDetail({ kind: 'transcripts', id: msg.eventId, detail: null, error: errorText(err), requestId: msg.requestId });
          }
        })();
        break;
      }
      case 'runAction': {
        void runHudAction(msg.action, msg.requestId, token => performAction(msg, token),
          { exclusive: msg.action !== 'setupDiagnostics' });
        break;
      }
      case 'cancelAction': {
        if (activeAction && (msg.requestId === undefined || msg.requestId === activeAction.requestId)) {
          appendLog('Cancelling the active action...', 'warn');
          activeAction.source.cancel();
        }
        break;
      }
      case 'detectCli': {
        void detectCli(msg.requestId);
        break;
      }
      case 'detectPr': {
        void detectPr(msg.requestId);
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
      onScopeChanged();
      store.setDbPath(cfg().get<string>('dbPath', '') || undefined);
      store.setPollInterval(cfg().get<number>('pollInterval', 5000));
      hud.postSettings(getSettingsPayload());
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      onScopeChanged();
      store.setProjectDir(getActiveProjectDir());
      hud.postProjects(getProjectsList());
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      const oldProj = store.getSnapshot().projectDir;
      const newProj = getActiveProjectDir();
      if (!pathsEqual(oldProj, newProj)) onScopeChanged();
      store.setProjectDir(newProj);
      hud.postProjects(getProjectsList());
    }),
  );

  registerCommands(context, { store, outputChannel, openHud, getProjectDir: getActiveProjectDir, beforeWorkflow: ensureWorkflowDatabase });

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
