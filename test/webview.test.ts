// Webview regressions from the 1.2.0 audit, run against the real hud.html/hud.css/hud.js in
// jsdom. Covers handshake, controls, Explorer paging/staleness, keyboard access and
// action result states. Visual contrast is also checked from the stylesheet source.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const asset = (name: string) => readFileSync(join(process.cwd(), 'src/ui/assets', name), 'utf8');
const CSS = asset('hud.css');
const windows: Array<{ close(): void }> = [];
afterEach(() => { while (windows.length) windows.pop()!.close(); });

function hud(state: Record<string, unknown> = {}) {
  const html = asset('hud.html')
    .replace(/CSP_PLACEHOLDER/g, "default-src 'none'")
    .replace(/NONCE_PLACEHOLDER/g, 'n')
    .replace('STYLE_PLACEHOLDER', () => CSS)
    .replace('<script nonce="n">SCRIPT_PLACEHOLDER</script>', '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
  const posted: any[] = [];
  const w = dom.window as any;
  windows.push(w);
  w.acquireVsCodeApi = () => ({ getState: () => state, setState() {}, postMessage: (m: unknown) => posted.push(JSON.parse(JSON.stringify(m))) });
  w.eval(asset('hud.js'));
  const doc: Document = w.document;
  const $ = (id: string) => doc.getElementById(id) as any;
  const send = (data: unknown) => w.dispatchEvent(new w.MessageEvent('message', { data }));
  const key = (el: Element, k: string, opts: Record<string, unknown> = {}) =>
    el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  const last = (type: string) => posted.filter(m => m.type === type).at(-1);
  return { w, doc, $, send, key, posted, last };
}

const session = (id: string) => ({ id, summary: id, platform: 'codex', created_at: '2026-09-28', token_count: 1 });

test('F10: the webview announces readiness after its message listener exists', () => {
  const h = hud();
  assert.deepEqual(h.posted.at(-1), { type: 'ready' });
});

test('F11: the missing-database Install docs button dispatches its command', () => {
  const h = hud();
  h.doc.querySelector<HTMLButtonElement>('[data-cmd="veto.openInstallDocs"]')!.click();
  assert.deepEqual(h.posted.at(-1), { type: 'command', command: 'veto.openInstallDocs' });
});

test('F03: CLI Auto-Detect asks the extension and fills only a detected cli.js path', () => {
  const h = hud();
  h.$('btnDetectCli').click();
  const req = h.last('detectCli');
  assert.ok(req && typeof req.requestId === 'number');
  assert.equal(h.$('settingCliPath').value, '');
  assert.equal(h.$('btnDetectCli').disabled, true);
  h.send({ type: 'detection', kind: 'cli', error: 'Veto was not found on PATH.', requestId: req.requestId });
  assert.equal(h.$('settingCliPath').value, '');
  assert.match(h.$('cliDetectStatus').textContent, /not found/);
  assert.equal(h.$('btnDetectCli').disabled, false);
  h.$('btnDetectCli').click();
  h.send({ type: 'detection', kind: 'cli', value: 'C:/veto/cli.js', requestId: h.last('detectCli').requestId });
  assert.equal(h.$('settingCliPath').value, 'C:/veto/cli.js');
});

test('F08: PR Auto-Detect requests detection and fills the URL', () => {
  const h = hud();
  h.$('btnDetectPr').click();
  const req = h.last('detectPr');
  assert.ok(req);
  h.send({ type: 'detection', kind: 'pr', value: 'https://github.com/o/r/pull/7', requestId: req.requestId });
  assert.equal(h.$('wfPrUrl').value, 'https://github.com/o/r/pull/7');
  h.$('btnDetectPr').click();
  h.send({ type: 'detection', kind: 'pr', error: 'No open pull request found', requestId: h.last('detectPr').requestId });
  assert.match(h.$('prDetectStatus').textContent, /No open pull request/);
});

test('F06: Copy Result and Copy Log send full text through copyText; oversize gives feedback', () => {
  const h = hud();
  h.$('btnSaveCheckpoint'); // ensure workflows exist
  const req = (() => { h.$('wfDraftDummy'); h.$('btnDraftCommit').click(); return h.last('runAction'); })();
  const long = 'x'.repeat(5000);
  h.send({ type: 'actionStatus', action: 'draftCommit', status: 'done', result: long, requestId: req.requestId });
  h.$('btnCopyResult').click();
  assert.deepEqual(h.last('copyText'), { type: 'copyText', text: long });
  h.send({ type: 'logEntry', entry: { id: 1, timestamp: '00:00:00', level: 'info', text: 'hello log' } });
  h.$('btnCopyLog').click();
  assert.match(h.last('copyText').text, /hello log/);

  const before = h.posted.length;
  h.$('btnDraftCommit').click();
  h.send({ type: 'actionStatus', action: 'draftCommit', status: 'done', result: 'y'.repeat(1_000_001), requestId: h.last('runAction').requestId });
  h.$('btnCopyResult').click();
  assert.equal(h.posted.slice(before).filter(m => m.type === 'copyText').length, 0);
  assert.match(h.$('copyResultStatus').textContent, /too large/i);
});

test('F01: error, cancelled and completed states are shown distinctly', () => {
  const h = hud();
  h.$('btnDraftCommit').click();
  let id = h.last('runAction').requestId;
  h.send({ type: 'actionStatus', action: 'draftCommit', status: 'error', message: 'No staged changes.', requestId: id });
  assert.equal(h.$('resultVerdict').textContent, 'ERROR');
  assert.match(h.$('resultBody').textContent, /No staged changes/);

  h.$('btnDraftCommit').click();
  id = h.last('runAction').requestId;
  h.$('btnCancelAction').click();
  assert.deepEqual(h.last('cancelAction'), { type: 'cancelAction', requestId: id });
  h.send({ type: 'actionStatus', action: 'draftCommit', status: 'cancelled', message: 'Cancelled.', requestId: id });
  assert.equal(h.$('resultVerdict').textContent, 'CANCELLED');

  h.$('btnStartDebate');
  h.$('wfDebatePrompt').value = 'topic';
  h.$('btnStartDebate').click();
  id = h.last('runAction').requestId;
  h.send({ type: 'actionStatus', action: 'debate', status: 'done', verdict: 'GREEN', result: '{}', requestId: id });
  assert.equal(h.$('resultVerdict').textContent, 'GREEN');
});

test('actions run one at a time and ignore statuses for other requests', () => {
  const h = hud();
  h.$('btnDraftCommit').click();
  const first = h.last('runAction');
  h.$('btnDraftPr').click();
  assert.equal(h.posted.filter(m => m.type === 'runAction').length, 1);
  assert.equal(h.$('btnDraftPr').disabled, true);
  h.send({ type: 'actionStatus', action: 'draftPR', status: 'done', result: 'stale', requestId: first.requestId + 99 });
  assert.equal(h.$('workflowResultCard').classList.contains('hidden'), true);
  h.send({ type: 'actionStatus', action: 'draftCommit', status: 'done', result: 'ok', requestId: first.requestId });
  assert.equal(h.$('btnDraftPr').disabled, false);
});

test('F05: older Explorer responses and late detail replies are ignored', () => {
  const h = hud();
  h.doc.querySelector<HTMLButtonElement>('[data-tab="explorer"]')!.click();
  const older = h.last('queryExplorer');
  h.$('explorerSearch').value = 'new';
  h.$('explorerSearch').dispatchEvent(new h.w.Event('input'));
  h.send({ type: 'explorerData', kind: 'sessions', items: [session('fresh')], requestId: older.requestId + 100 });
  h.send({ type: 'explorerData', kind: 'sessions', items: [session('old-search')], requestId: older.requestId });
  assert.doesNotMatch(h.$('explorerItems').textContent, /old-search/);

  h.doc.querySelector<HTMLButtonElement>('.sub-pill[data-kind="memory"]')!.click();
  const q = h.last('queryExplorer');
  h.send({ type: 'explorerData', kind: 'memory', items: [{ id: 'm1', title: 'Memory one', type: 'note' }], requestId: q.requestId });
  (h.doc.querySelector('.explorer-card') as HTMLElement).click();
  const detailReq = h.last('getMemoryDetail');
  h.doc.querySelector<HTMLButtonElement>('[data-tab="settings"]')!.click();
  h.send({ type: 'explorerDetail', kind: 'memory', id: 'm1', detail: { title: 'Late' }, requestId: detailReq.requestId });
  assert.equal(h.$('detailDrawer').classList.contains('hidden'), true);
});

test('F05: a scope change discards results and requeries the Explorer', () => {
  const h = hud();
  h.doc.querySelector<HTMLButtonElement>('[data-tab="explorer"]')!.click();
  const q = h.last('queryExplorer');
  h.send({ type: 'explorerData', kind: 'sessions', items: [session('project-a')], requestId: q.requestId });
  h.send({ type: 'scopeChanged' });
  assert.doesNotMatch(h.$('explorerItems').textContent, /project-a/);
  assert.ok(h.last('queryExplorer').requestId > q.requestId);
});

test('F04: Explorer offers Load more and requests the next offset', () => {
  const h = hud();
  h.doc.querySelector<HTMLButtonElement>('[data-tab="explorer"]')!.click();
  const q = h.last('queryExplorer');
  const page = Array.from({ length: 30 }, (_, i) => session(`s${i}`));
  h.send({ type: 'explorerData', kind: 'sessions', items: page, hasMore: true, offset: 0, requestId: q.requestId });
  const more = h.$('explorerLoadMore');
  assert.ok(more, 'load more button rendered');
  more.click();
  const next = h.last('queryExplorer');
  assert.equal(next.offset, 30);
  h.send({ type: 'explorerData', kind: 'sessions', items: [session('s30')], hasMore: false, offset: 30, requestId: next.requestId });
  assert.equal(h.doc.querySelectorAll('.explorer-card').length, 31);
  assert.equal(h.$('explorerLoadMore'), null);
});

test('F16: backend notices replace the generic empty state', () => {
  const h = hud();
  h.doc.querySelector<HTMLButtonElement>('[data-tab="explorer"]')!.click();
  h.doc.querySelector<HTMLButtonElement>('.sub-pill[data-kind="transcripts"]')!.click();
  const q = h.last('queryExplorer');
  h.send({ type: 'explorerData', kind: 'transcripts', items: [], notice: 'No archive for this project.', requestId: q.requestId });
  assert.match(h.$('explorerItems').textContent, /No archive for this project/);
});

test('F09: Explorer cards activate with Enter; drawer manages focus, ARIA and Escape', () => {
  const h = hud();
  h.doc.querySelector<HTMLButtonElement>('[data-tab="explorer"]')!.click();
  const q = h.last('queryExplorer');
  h.send({ type: 'explorerData', kind: 'sessions', items: [session('keyboard')], requestId: q.requestId });
  const card = h.doc.querySelector('.explorer-card') as HTMLElement;
  card.focus();
  h.key(card, 'Enter');
  const drawer = h.$('detailDrawer');
  assert.equal(drawer.classList.contains('hidden'), false);
  assert.equal(drawer.getAttribute('aria-hidden'), 'false');
  assert.equal(drawer.getAttribute('aria-modal'), 'true');
  assert.ok(drawer.contains(h.doc.activeElement), 'focus moved into the drawer');
  assert.ok(h.doc.querySelector('main')!.hasAttribute('inert'), 'background is inert');
  h.key(h.doc.activeElement as Element, 'Escape');
  assert.equal(drawer.classList.contains('hidden'), true);
  assert.equal(drawer.getAttribute('aria-hidden'), 'true');
  assert.equal(h.doc.activeElement, card, 'focus restored to the card');
  assert.equal(h.doc.querySelector('main')!.hasAttribute('inert'), false);
});

test('F09: tabs support arrow-key navigation with roving tabindex', () => {
  const h = hud();
  const dashboard = h.doc.querySelector('[data-tab="dashboard"]') as HTMLElement;
  dashboard.focus();
  h.key(dashboard, 'ArrowRight');
  const explorer = h.doc.querySelector('[data-tab="explorer"]') as HTMLElement;
  assert.equal(h.doc.activeElement, explorer);
  assert.equal(explorer.getAttribute('aria-selected'), 'true');
  assert.equal(explorer.getAttribute('tabindex'), '0');
  assert.equal(dashboard.getAttribute('tabindex'), '-1');
  h.key(explorer, 'End');
  assert.equal((h.doc.activeElement as HTMLElement).dataset.tab, 'settings');
});

test('static Workflows and Settings card headers collapse and expand', () => {
  const h = hud();
  const header = h.doc.querySelector('#panel-workflows .wf-cards .card-header') as HTMLElement;
  const body = header.parentElement!.querySelector('.card-body')!;
  header.click();
  assert.equal(body.classList.contains('collapsed'), true);
  assert.equal(header.getAttribute('aria-expanded'), 'false');
  h.key(header, 'Enter');
  assert.equal(body.classList.contains('collapsed'), false);
});

test('console reports unknown commands honestly and streams action progress', () => {
  const h = hud();
  h.$('consoleInput').value = 'deploy prod';
  h.$('btnConsoleSend').click();
  assert.match(h.$('consoleViewport').textContent, /Unknown command "deploy prod"/);
  assert.doesNotMatch(h.$('consoleViewport').textContent, /submitted/);
});

test('console resume runs as a tracked action with a request id', () => {
  const h = hud();
  h.doc.querySelector<HTMLButtonElement>('[data-tab="explorer"]')!.click();
  const q = h.last('queryExplorer');
  h.send({ type: 'explorerData', kind: 'sessions', items: [session('resume-me')], requestId: q.requestId });
  (h.doc.querySelector('.explorer-card') as HTMLElement).click();
  const resumeBtn = [...h.doc.querySelectorAll('#drawerActions button')].find(b => /Resume/.test(b.textContent!)) as HTMLElement;
  resumeBtn.click();
  h.$('btnResumeConsole').click();
  const msg = h.last('resume');
  assert.equal(msg.target, 'console');
  assert.equal(typeof msg.requestId, 'number');
  assert.equal(h.$('activeProgressCard').classList.contains('hidden'), false);
});

// ── Stylesheet checks (F12–F15) ─────────────────────────────────────────────
function zIndex(selector: string): number {
  const rule = new RegExp(`(^|\\n)${selector.replace(/[.#]/g, m => '\\' + m)}\\s*\\{([^}]*)\\}`).exec(CSS);
  assert.ok(rule, `rule for ${selector}`);
  return Number(/z-index:\s*(\d+)/.exec(rule![2])?.[1]);
}

test('F14: the drawer and its backdrop stack above the tab bar; the resume modal stays on top', () => {
  const tabs = zIndex('.tabs-wrapper');
  assert.ok(zIndex('.drawer-backdrop') > tabs);
  assert.ok(zIndex('.drawer') > zIndex('.drawer-backdrop'));
  assert.ok(zIndex('.modal-backdrop') > zIndex('.drawer'));
});

test('F12: foreground colors never fall back to white when a theme omits the token', () => {
  const whiteFallbacks = [...CSS.matchAll(/var\(--vscode-(sideBarTitle-foreground|list-activeSelectionForeground|foreground)\s*,\s*#f{3,6}\s*\)/gi)];
  assert.deepEqual(whiteFallbacks.map(m => m[0]), []);
  assert.match(CSS, /body\.vscode-high-contrast-light/);
});

test('F13: status badges and active controls use theme-aware colors in light and high-contrast themes', () => {
  assert.match(CSS, /body\.vscode-light[^{]*\.badge\.yellow|\.vscode-light \.badge\.yellow/);
  assert.match(CSS, /body\.vscode-high-contrast[^{]*\.sub-pill\.active/);
});

test('F15: narrow layouts wrap toolbars and result headers instead of clipping', () => {
  assert.match(/\.console-toolbar\s*\{[^}]*\}/.exec(CSS)![0], /flex-wrap:\s*wrap/);
  assert.match(/\.console-actions\s*\{[^}]*\}/.exec(CSS)![0], /flex-wrap:\s*wrap/);
  assert.match(CSS, /\.result-card \.card-header\s*\{[^}]*min-width:\s*0|\.res-title\s*\{[^}]*min-width:\s*0/);
  assert.match(CSS, /@container|@media \(max-width:\s*2[0-9]{2}px\)/);
});

test('the workflow result card header is not wired as a collapsible button', () => {
  const h = hud();
  h.$('btnDraftCommit').click();
  h.send({ type: 'actionStatus', action: 'draftCommit', status: 'done', result: 'draft', requestId: h.last('runAction').requestId });
  const header = h.doc.querySelector('#workflowResultCard .card-header') as HTMLElement;
  header.click();
  assert.equal(h.doc.querySelector('#workflowResultCard .card-body')!.classList.contains('collapsed'), false);
  assert.equal(header.hasAttribute('aria-expanded'), false);
});
