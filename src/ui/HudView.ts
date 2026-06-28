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

export type HudMessage =
  | { type: 'resume'; id: string; platform: string }
  | { type: 'copyId'; id: string }
  | { type: 'searchMemory'; query: string }
  | { type: 'command'; command: string };

export interface MemoryResult { title: string; type: string; project_dir: string | null }

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
    view.webview.onDidReceiveMessage((msg: HudMessage) => this.handler(msg));
    view.onDidDispose(() => { this.view = undefined; });
    this.render(this.getSnapshot());
  }

  /** Push the latest snapshot to the webview (it diffs into the DOM). */
  render(snapshot: VetoSnapshot): void {
    void this.view?.webview.postMessage({ type: 'snapshot', data: snapshot });
  }

  /** Reply to a webview memory-search request. */
  postMemoryResults(results: MemoryResult[]): void {
    void this.view?.webview.postMessage({ type: 'memoryResults', results });
  }

  // ── HTML shell (rendered once; data arrives via postMessage) ─────────────────
  private html(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const csp = [
      `default-src 'none'`,
      `style-src 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style nonce="${nonce}">${STYLES}</style>
<title>Veto HUD</title>
</head>
<body>
<header id="hdr">
  <span class="logo">⬡ VETO</span>
  <span id="verdict" class="badge">—</span>
  <span id="stale" class="stale" hidden>⟳</span>
</header>
<div id="notInstalled" class="empty" hidden>
  Veto not installed. Run <code>npm i -g @jigyasudham/veto</code> and use it once.
  <div class="actions"><button class="btn" data-cmd="veto.openInstallDocs">Install docs</button></div>
</div>
<main id="cards"></main>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const STYLES = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 10px 12px; font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px); color: var(--vscode-foreground); }
#hdr { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.logo { font-weight: 700; letter-spacing: 1px; }
.badge { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 10px;
  border: 1px solid var(--vscode-panel-border); }
.badge.green  { color: #1f9d55; border-color: #1f9d55; }
.badge.red    { color: var(--vscode-errorForeground, #d33); border-color: currentColor; }
.badge.yellow { color: #b58900; border-color: #b58900; }
.stale { font-size: 12px; opacity: .7; }
.card { border: 1px solid var(--vscode-panel-border); border-radius: 7px; padding: 10px 11px;
  margin-bottom: 10px; background: var(--vscode-editorWidget-background, transparent); }
.card h3 { margin: 0 0 7px; font-size: 10px; text-transform: uppercase; letter-spacing: .5px;
  opacity: .6; font-weight: 600; }
.row { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; }
.row .k { opacity: .7; }
.row .v { text-align: right; }
.mono, .gauge { font-family: var(--vscode-editor-font-family, monospace); }
.gauge { letter-spacing: -1px; }
.votes { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.vote { font-size: 11px; padding: 1px 7px; border-radius: 6px; border: 1px solid var(--vscode-panel-border); }
.vote.ok { color: #1f9d55; } .vote.warn { color: #b58900; }
.recommend { margin-top: 7px; opacity: .85; font-style: italic; font-size: 12px; }
.pattern { display: flex; align-items: center; gap: 6px; padding: 2px 0; font-size: 12px; }
.pattern .conf { margin-left: auto; opacity: .75; }
.btn { font: inherit; font-size: 12px; cursor: pointer; border: 1px solid var(--vscode-button-border, transparent);
  background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  padding: 3px 9px; border-radius: 5px; }
.btn:hover { background: var(--vscode-button-hoverBackground); }
.btn.sec { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
.search { margin: 6px 0; }
.search input { width: 100%; font: inherit; padding: 4px 7px; border-radius: 5px;
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
.list { margin: 4px 0 0; padding: 0; list-style: none; }
.list li { padding: 4px 0; border-top: 1px solid var(--vscode-panel-border); cursor: pointer; font-size: 12px; }
.list li:hover { opacity: .75; }
.list .meta { opacity: .6; font-size: 11px; }
.empty { opacity: .75; padding: 14px 4px; text-align: center; font-size: 12px; }
.sub { opacity: .55; font-size: 11px; }
code { background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 4px; }
`;

// Webview-side renderer. Builds DOM with textContent only — no innerHTML for DB data.
const SCRIPT = `
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function row(k, v, mono) { const r = el('div', 'row'); r.appendChild(el('span', 'k', k)); r.appendChild(el('span', 'v' + (mono ? ' mono' : ''), v)); return r; }
function card(title) { const c = el('section', 'card'); if (title) c.appendChild(el('h3', null, title)); return c; }
function btn(label, onClick, sec) { const b = el('button', 'btn' + (sec ? ' sec' : ''), label); b.addEventListener('click', onClick); return b; }
function bar(pct) { const p = Math.max(0, Math.min(100, pct | 0)), w = 10, f = Math.round((p / 100) * w); return '▓'.repeat(f) + '░'.repeat(w - f); }
function rel(iso) { const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000); if (isNaN(m)) return ''; if (m < 1) return 'just now'; if (m < 60) return m + 'm ago'; const h = Math.floor(m / 60); if (h < 24) return h + 'h ago'; return Math.floor(h / 24) + 'd ago'; }
const AGENTS = [['lead_dev','Lead'],['pm','PM'],['architect','Arch'],['ux','UX'],['devil','Devil'],['legal','Legal'],['security','Sec']];

function render(s) {
  const installed = !!s.installed;
  $('notInstalled').hidden = installed;
  const verdict = ((s.council && s.council.verdict) || '').toUpperCase();
  const badge = $('verdict');
  badge.textContent = installed ? (verdict || 'no verdict') : 'offline';
  badge.className = 'badge ' + (verdict === 'GREEN' ? 'green' : verdict === 'RED' ? 'red' : verdict === 'YELLOW' ? 'yellow' : '');
  $('stale').hidden = !s.stale;
  const cards = $('cards'); cards.textContent = '';
  if (!installed) return;

  const sc = card('Session');
  if (s.session) {
    const ss = s.session;
    const idRow = row('ID', (ss.id || '').slice(0, 8) + '…', true);
    idRow.style.cursor = 'pointer'; idRow.title = 'Copy session ID';
    idRow.addEventListener('click', () => vscode.postMessage({ type: 'copyId', id: ss.id }));
    sc.appendChild(idRow);
    sc.appendChild(row('Created by', ss.platform || '—'));
    sc.appendChild(row('Active in', ss.active_client || ss.platform || '—'));
    if (ss.started_at) sc.appendChild(row('Started', rel(ss.started_at)));
    const win = ({ claude: 200000, gemini: 1000000, codex: 128000 })[(ss.active_client || ss.platform || '').toLowerCase()] || 200000;
    const pct = Math.min(100, Math.round(((ss.token_count || 0) / win) * 100));
    sc.appendChild(row('Tokens', Math.round((ss.token_count || 0) / 1000) + 'K/' + Math.round(win / 1000) + 'K', true));
    sc.appendChild(row('', bar(pct) + ' ' + pct + '%', true));
    if (ss.summary) sc.appendChild(row('Summary', ss.summary.slice(0, 48)));
    const act = el('div', 'actions');
    act.appendChild(btn('Resume', () => vscode.postMessage({ type: 'resume', id: ss.id, platform: ss.active_client || ss.platform })));
    act.appendChild(btn('Save', () => vscode.postMessage({ type: 'command', command: 'veto.saveSession' }), true));
    sc.appendChild(act);
  } else { sc.appendChild(el('div', 'sub', 'No active session for this workspace.')); }
  cards.appendChild(sc);

  const cc = card('Council — verdict before code');
  if (s.council) {
    const c = s.council;
    cc.appendChild(row('Verdict', (c.verdict || '—') + ' · ' + rel(c.debated_at)));
    if (c.task) cc.appendChild(el('div', 'sub', String(c.task).slice(0, 90)));
    const votes = el('div', 'votes');
    for (const [key, label] of AGENTS) {
      const raw = c[key];
      const ok = raw && String(raw).toLowerCase().includes('approve');
      const chip = el('span', 'vote ' + (ok ? 'ok' : 'warn'), (ok ? '✓ ' : '⚠ ') + label);
      if (raw) chip.title = String(raw);
      votes.appendChild(chip);
    }
    cc.appendChild(votes);
    if (c.recommended) cc.appendChild(el('div', 'recommend', '→ ' + c.recommended));
  } else { cc.appendChild(el('div', 'sub', 'No council verdict yet.')); }
  const cact = el('div', 'actions');
  cact.appendChild(btn('Debate…', () => vscode.postMessage({ type: 'command', command: 'veto.councilDebate' })));
  cact.appendChild(btn('Review file', () => vscode.postMessage({ type: 'command', command: 'veto.reviewFile' }), true));
  cact.appendChild(btn('Review PR', () => vscode.postMessage({ type: 'command', command: 'veto.reviewPR' }), true));
  cc.appendChild(cact);
  cards.appendChild(cc);

  const rc = card('Router — what Veto learned');
  if (s.patterns && s.patterns.length) {
    for (const p of s.patterns.slice(0, 6)) {
      const pr = el('div', 'pattern');
      pr.appendChild(el('span', 'mono', p.pattern_key));
      pr.appendChild(el('span', null, '→ ' + p.pattern_val));
      pr.appendChild(el('span', 'conf', Math.round((p.confidence || 0) * 100) + '% · ' + (p.seen_count || 0) + '×'));
      rc.appendChild(pr);
    }
  } else { rc.appendChild(el('div', 'sub', 'No routing patterns yet.')); }
  cards.appendChild(rc);

  if (s.rate && s.rate.some(r => r.token_count > 0)) {
    const ra = card('Today — token budget');
    for (const r of s.rate) { if (!r.token_count) continue; const pct = Math.round((r.token_count / Math.max(1, r.daily_token_budget)) * 100); ra.appendChild(row(r.platform, bar(pct) + ' ' + pct + '%', true)); }
    cards.appendChild(ra);
  }

  const mc = card('Memory');
  mc.appendChild(el('div', 'sub', (s.memory ? s.memory.totalCount : 0) + ' entries · ' + (s.memory && s.memory.scoped ? 'this project' : 'all projects')));
  const sb = el('div', 'search'); const input = el('input'); input.placeholder = 'Search memory…';
  let t; input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { const q = input.value.trim(); if (q) vscode.postMessage({ type: 'searchMemory', query: q }); else renderMemoryList(s.memory ? s.memory.entries : []); }, 250); });
  sb.appendChild(input); mc.appendChild(sb);
  const list = el('ul', 'list'); list.id = 'memList'; mc.appendChild(list);
  cards.appendChild(mc);
  renderMemoryList(s.memory ? s.memory.entries : []);

  if (s.health) {
    const h = s.health; const hc = card('Health');
    hc.appendChild(row('DB size', h.dbSizeMb + ' MB'));
    hc.appendChild(row('Sessions', String(h.sessionCount)));
    hc.appendChild(row('Patterns', String(h.patternCount)));
    hc.appendChild(row('Outcomes', String(h.learningCount)));
    cards.appendChild(hc);
  }
}

function renderMemoryList(entries) {
  const list = $('memList'); if (!list) return; list.textContent = '';
  for (const e of (entries || [])) {
    const li = el('li');
    li.appendChild(el('span', null, e.title));
    li.appendChild(el('span', 'meta', '  ' + (e.type || '') + (e.project_dir ? ' · ' + e.project_dir.split(/[\\\\/]/).pop() : '')));
    li.title = 'Copy title';
    li.addEventListener('click', () => vscode.postMessage({ type: 'copyId', id: e.title }));
    list.appendChild(li);
  }
}

document.addEventListener('click', (ev) => { const t = ev.target; if (t && t.dataset && t.dataset.cmd) vscode.postMessage({ type: 'command', command: t.dataset.cmd }); });
window.addEventListener('message', (ev) => { const m = ev.data; if (m.type === 'snapshot') render(m.data); else if (m.type === 'memoryResults') renderMemoryList(m.results); });
`;
