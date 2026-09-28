// The Veto HUD — a single sidebar WebviewView replacing the old 7 tree panels.
//
// Security model (council requirements):
//  - strict nonce-based CSP; no remote origins; the only script is the nonce'd block below.
//  - the in-webview renderer uses textContent / DOM construction ONLY — never innerHTML for
//    DB-sourced strings — so nothing from the Veto DB can execute as HTML/JS.
//
// Data flow: the extension pushes { type:'snapshot' } messages; the webview posts back user
// actions ({ resume, copyId, searchMemory, command }) routed to commands by the handler.

import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { VetoSnapshot } from '../core/snapshot';
import type { ApiEnvelope } from '../core/backend';
import { pathsEqual } from '../core/paths';
import htmlTemplate from './assets/hud.html';
import styles from './assets/hud.css';
import script from './assets/hud.js';
import {
  type HudMessage,
  type MemoryResult,
  type SettingsPayload,
  type ProjectItem,
  type LogEntry,
  type ActionStatusMessage,
  type ExplorerResponse,
  type ExplorerDetailResponse,
  type DetectionResult,
  ALLOWED_HUD_COMMANDS,
  validateHudMessage,
} from './messages';

export {
  type HudMessage,
  type MemoryResult,
  type SettingsPayload,
  type ProjectItem,
  type LogEntry,
  type ActionStatusMessage,
  type ExplorerResponse,
  type ExplorerDetailResponse,
  ALLOWED_HUD_COMMANDS,
  validateHudMessage,
};

export class HudView implements vscode.WebviewViewProvider {
  static readonly viewType = 'veto-hud';
  private view: vscode.WebviewView | undefined;
  private backend: ApiEnvelope | undefined;
  private recentLogs: LogEntry[] = [];
  private static readonly MAX_RECENT_LOGS = 300;

  constructor(
    private readonly handler: (msg: HudMessage) => void,
    private readonly getSnapshot: () => VetoSnapshot,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((raw: unknown) => {
      const msg = validateHudMessage(raw);
      if (msg) this.handler(msg);
    });
    view.onDidDispose(() => { this.view = undefined; });
    // State is sent when the webview posts { type: 'ready' }; messages posted before its
    // listener exists would be lost (F10).
  }

  /** Replay buffered console lines after the webview (re)loads. */
  replayLogs(): void {
    if (this.recentLogs.length > 0) {
      void this.view?.webview.postMessage({ type: 'recentLogs', logs: this.recentLogs });
    }
  }

  /** Reply to an Auto-Detect request for the CLI path or the current branch PR. */
  postDetection(kind: 'cli' | 'pr', result: DetectionResult, requestId?: number): void {
    void this.view?.webview.postMessage({ type: 'detection', kind, ...result, requestId });
  }

  /** The selected project or database changed; cached Explorer results are stale. */
  postScopeChanged(): void {
    void this.view?.webview.postMessage({ type: 'scopeChanged' });
  }

  /** Push the latest snapshot to the webview (it diffs into the DOM). */
  render(snapshot: VetoSnapshot): void {
    const backend = this.backend && (
      (this.backend.state === 'ok' && pathsEqual(this.backend.data?.project?.dir, snapshot.projectDir)) ||
      this.backend.state === 'db_mismatch' ||
      this.backend.state === 'error'
    ) ? this.backend : undefined;
    void this.view?.webview.postMessage({ type: 'snapshot', data: { ...snapshot, backend } });
  }

  setBackendSnapshot(envelope?: ApiEnvelope): void {
    this.backend = envelope;
    this.render(this.getSnapshot());
  }

  /** Reply to a webview memory-search request. */
  postMemoryResults(results: MemoryResult[], requestId?: number): void {
    void this.view?.webview.postMessage({ type: 'memoryResults', results, requestId });
  }

  /** Push current extension settings payload. */
  postSettings(settings: SettingsPayload): void {
    void this.view?.webview.postMessage({ type: 'settings', settings });
  }

  /** Push available workspace projects list. */
  postProjects(projects: ProjectItem[]): void {
    void this.view?.webview.postMessage({ type: 'projectsList', projects });
  }

  /** Push explorer data query results (sessions, memory, council, etc.). */
  postExplorerData(data: ExplorerResponse): void {
    void this.view?.webview.postMessage({ type: 'explorerData', ...data });
  }

  /** Push explorer detailed record inspection. */
  postExplorerDetail(data: ExplorerDetailResponse): void {
    void this.view?.webview.postMessage({ type: 'explorerDetail', ...data });
  }

  /** Push action execution lifecycle update (running, completed, failed, cancelled). */
  postActionStatus(status: ActionStatusMessage): void {
    void this.view?.webview.postMessage({ type: 'actionStatus', ...status });
  }

  /** Append a live log entry to the in-extension console stream. */
  postLogEntry(entry: LogEntry): void {
    this.recentLogs.push(entry);
    if (this.recentLogs.length > HudView.MAX_RECENT_LOGS) {
      this.recentLogs.shift();
    }
    void this.view?.webview.postMessage({ type: 'logEntry', entry });
  }

  /** Clear the in-extension console log buffer. */
  clearLogs(): void {
    this.recentLogs = [];
    void this.view?.webview.postMessage({ type: 'clearLogs' });
  }

  // ── HTML shell (rendered once; data arrives via postMessage) ─────────────────
  private html(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const csp = [
      `default-src 'none'`,
      `style-src 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return htmlTemplate
      .replace(/CSP_PLACEHOLDER/g, csp)
      .replace(/NONCE_PLACEHOLDER/g, nonce)
      .replace('STYLE_PLACEHOLDER', styles)
      .replace('SCRIPT_PLACEHOLDER', script);
  }
}

function makeNonce(): string {
  return randomBytes(24).toString('base64');
}
