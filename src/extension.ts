// Veto HUD — extension entry point. Wiring only: build the store, the status-bar pulse,
// the HUD, and the commands, then connect them. All real logic lives in core/ ui/ commands/.

import * as vscode from 'vscode';
import { VetoStore } from './core/VetoStore';
import type { VetoSnapshot } from './core/snapshot';
import { StatusBar } from './ui/StatusBar';
import { HudView, type HudMessage } from './ui/HudView';
import { registerCommands } from './commands';

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
  store.setProjectDir(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);

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
        hud.postMemoryResults(results);
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

  // ── Single render path: one snapshot drives status bar, HUD, and diagnostics ──
  let lastRedVerdictId: string | null = null;
  context.subscriptions.push(
    store.onChange((snap: VetoSnapshot) => {
      statusBar.render(snap);
      hud.render(snap);
      updateDiagnostics(diagnostics, snap);

      // One-time toast when a new RED council verdict appears.
      const c = snap.council;
      if (c && c.verdict === 'RED' && c.id !== lastRedVerdictId) {
        vscode.window.showWarningMessage(`Veto Council: RED — ${c.recommended ?? 'no recommendation'}`, 'Open HUD')
          .then(a => { if (a === 'Open HUD') openHud(); });
      }
      if (c) lastRedVerdictId = c.id;
    }),
  );

  // ── Live config + workspace reactions ────────────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('veto')) return;
      store.setDbPath(cfg().get<string>('dbPath', '') || undefined);
      store.setPollInterval(cfg().get<number>('pollInterval', 5000));
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      store.setProjectDir(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
    }),
  );

  registerCommands(context, { store, outputChannel, openHud });

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
    const range = new vscode.Range(row.line, row.col_start, row.line, row.col_start + 999);
    const d = new vscode.Diagnostic(range, `[veto/${row.source}] ${row.message}`, sev);
    d.source = 'veto';
    if (!byFile.has(row.file_path)) byFile.set(row.file_path, []);
    byFile.get(row.file_path)!.push(d);
  }
  for (const [fp, diags] of byFile) collection.set(vscode.Uri.file(fp), diags);
}

export function deactivate(): void {}
