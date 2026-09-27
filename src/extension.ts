// Veto HUD — extension entry point. Wiring only: build the store, the status-bar pulse,
// the HUD, and the commands, then connect them. All real logic lives in core/ ui/ commands/.

import * as vscode from 'vscode';
import { VetoStore } from './core/VetoStore';
import type { VetoSnapshot } from './core/snapshot';
import type { ApiEnvelope } from './core/backend';
import { StatusBar } from './ui/StatusBar';
import { HudView, type HudMessage } from './ui/HudView';
import { registerCommands } from './commands';
import { cancelAllProcesses } from './commands/process';
import { selectedProject } from './core/projects';
import { registerBackendCommands } from './commands/backend';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('Veto');
  const version = vscode.extensions.getExtension('jigyasudham.veto-vscode')?.packageJSON?.version ?? '?';
  context.subscriptions.push(outputChannel);

  const cfg = () => vscode.workspace.getConfiguration('veto');
  const store = new VetoStore({
    dbPath: cfg().get<string>('dbPath', '') || undefined,
    pollIntervalMs: cfg().get<number>('pollInterval', 5000),
    log: msg => outputChannel.appendLine(`[${new Date().toISOString()}] ${msg}`),
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
  }), { dispose: cancelAllProcesses });

  store.setProjectDir(getActiveProjectDir());

  const statusBar = new StatusBar(version);
  const diagnostics = vscode.languages.createDiagnosticCollection('veto');

  // ── HUD message routing ──────────────────────────────────────────────────────
  const handleHudMessage = (msg: HudMessage): void => {
    switch (msg.type) {
      case 'resume':       vscode.commands.executeCommand('veto.continueSession', msg.id, msg.platform); break;
      case 'copyId':       vscode.commands.executeCommand('veto.copySessionId', msg.id); break;
      case 'command':      vscode.commands.executeCommand(msg.command); break;
      case 'searchMemory': {
        const results = store.searchMemory(msg.query).map(r => ({ title: r.title, type: r.type, project_dir: r.project_dir }));
        hud.postMemoryResults(results, msg.requestId);
        break;
      }
    }
  };
  const hud = new HudView(handleHudMessage, () => store.getSnapshot());
  const openHud = () => vscode.commands.executeCommand(`${HudView.viewType}.focus`);

  context.subscriptions.push(
    store, statusBar, diagnostics,
    vscode.window.registerWebviewViewProvider(HudView.viewType, hud, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  let cachedBackendSnapshot: ApiEnvelope | undefined;
  const backendCmds = registerBackendCommands(context, {
    getProjectDir: getActiveProjectDir,
    getDbPath: () => store.getDbPath(),
    showSnapshot: envelope => hud.setBackendSnapshot(envelope),
    onSnapshotFetched: envelope => { cachedBackendSnapshot = envelope; },
  });

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
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      cachedBackendSnapshot = undefined;
      hud.setBackendSnapshot();
      store.setProjectDir(getActiveProjectDir());
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      const oldProj = store.getSnapshot().projectDir;
      const newProj = getActiveProjectDir();
      if (oldProj !== newProj) {
        cachedBackendSnapshot = undefined;
        hud.setBackendSnapshot();
      }
      store.setProjectDir(newProj);
    }),
  );

  registerCommands(context, { store, outputChannel, openHud, getProjectDir: getActiveProjectDir });

  store.start();
  outputChannel.appendLine(`[startup] Veto HUD v${version} active. DB: ${store.getDbPath()}`);
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
