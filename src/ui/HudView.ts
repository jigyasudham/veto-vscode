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
import type { VetoSnapshot } from '../core/snapshot';
import htmlTemplate from './assets/hud.html';
import styles from './assets/hud.css';
import script from './assets/hud.js';
import {
  type HudMessage,
  type MemoryResult,
  ALLOWED_HUD_COMMANDS,
  validateHudMessage,
} from './messages';

export {
  type HudMessage,
  type MemoryResult,
  ALLOWED_HUD_COMMANDS,
  validateHudMessage,
};

export class HudView implements vscode.WebviewViewProvider {
  static readonly viewType = 'veto-hud';
  private view: vscode.WebviewView | undefined;

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
    this.render(this.getSnapshot());
  }

  /** Push the latest snapshot to the webview (it diffs into the DOM). */
  render(snapshot: VetoSnapshot): void {
    void this.view?.webview.postMessage({ type: 'snapshot', data: snapshot });
  }

  /** Reply to a webview memory-search request. */
  postMemoryResults(results: MemoryResult[], requestId?: number): void {
    void this.view?.webview.postMessage({ type: 'memoryResults', results, requestId });
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
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
