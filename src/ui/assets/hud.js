const vscode = acquireVsCodeApi();
const $ = (id) => (typeof document !== 'undefined' && document.getElementById ? document.getElementById(id) : null);

function queryAll(sel) {
  return typeof document !== 'undefined' && typeof document.querySelectorAll === 'function'
    ? Array.from(document.querySelectorAll(sel))
    : [];
}

function safeOn(id, event, handler) {
  const elem = $(id);
  if (elem && elem.addEventListener) elem.addEventListener(event, handler);
}

let uiState = (typeof vscode !== 'undefined' && vscode.getState ? vscode.getState() : {}) || {};
function setUiState(key, val) {
  uiState[key] = val;
  if (vscode && vscode.setState) vscode.setState(uiState);
}
function getUiState(key, defaultVal) {
  return uiState[key] !== undefined ? uiState[key] : defaultVal;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function row(k, v, mono) {
  const r = el('div', 'row');
  r.appendChild(el('span', 'k', k));
  r.appendChild(el('span', 'v' + (mono ? ' mono' : ''), v));
  return r;
}

function card(title, id) {
  const c = el('section', 'card');
  if (title) {
    const header = el('header', 'card-header');
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.appendChild(el('h3', null, title));
    const chevron = el('span', 'chevron', '▼');
    header.appendChild(chevron);
    c.appendChild(header);

    const body = el('div', 'card-body');
    c.appendChild(body);
    makeCollapsible(header, body, chevron, id);
    c.appendTarget = body;
  } else {
    c.appendTarget = c;
  }
  return c;
}

/** Wire a card header (role=button) to collapse its body; state persists per id. */
function makeCollapsible(header, body, chevron, id) {
  const bodyId = 'card-body-' + id;
  body.id = bodyId;
  header.setAttribute('aria-controls', bodyId);

  const isCollapsed = getUiState('collapse_' + id, false);
  header.setAttribute('aria-expanded', String(!isCollapsed));
  if (isCollapsed) {
    body.classList.add('collapsed');
    if (chevron) chevron.classList.add('collapsed');
  }

  const toggle = () => {
    const collapsedNow = body.classList.toggle('collapsed');
    if (chevron) chevron.classList.toggle('collapsed', collapsedNow);
    header.setAttribute('aria-expanded', String(!collapsedNow));
    setUiState('collapse_' + id, collapsedNow);
  };

  header.addEventListener('click', toggle);
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });
}

/** Activate a role=button element with Enter or Space, like a native button. */
function keyActivate(node, onActivate) {
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  });
}

/** Arrow/Home/End navigation across a tablist with a roving tabindex. */
function rovingTabs(container, selector, activate) {
  if (!container || typeof container.addEventListener !== 'function') return;
  container.addEventListener('keydown', (e) => {
    const items = queryAll(selector);
    const index = items.indexOf(document.activeElement);
    if (index < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    activate(items[next]);
    items[next].focus();
  });
}

function btn(label, onClick, sec) {
  const b = el('button', 'btn' + (sec ? ' sec' : ''), label);
  b.addEventListener('click', onClick);
  return b;
}

function bar(pct) {
  const p = Math.max(0, Math.min(100, pct | 0));
  const w = 10;
  const f = Math.round((p / 100) * w);
  return '▓'.repeat(f) + '░'.repeat(w - f);
}

function rel(iso) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (isNaN(m)) return '';
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

const AGENTS = [
  ['lead_dev', 'Lead'],
  ['pm', 'PM'],
  ['architect', 'Arch'],
  ['ux', 'UX'],
  ['devil', 'Devil'],
  ['legal', 'Legal'],
  ['security', 'Sec']
];

function parseAgentVote(raw) {
  if (!raw) return { state: 'none', icon: '', reason: '' };
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') {
      const v = (parsed.verdict || '').toLowerCase();
      const reason = parsed.reason || parsed.recommendation || '';
      if (v === 'approve' || v === 'green' || v === 'ok') return { state: 'ok', icon: '✓ ', reason };
      if (v === 'block' || v === 'red' || v === 'reject' || v === 'veto') return { state: 'block', icon: '✕ ', reason };
      if (v === 'warn' || v === 'yellow') return { state: 'warn', icon: '⚠ ', reason };
      return { state: 'warn', icon: '⚠ ', reason };
    }
  } catch {}
  const str = String(raw).trim();
  const lower = str.toLowerCase();
  if (/^(block|red|reject|veto)\b/.test(lower)) return { state: 'block', icon: '✕ ', reason: str };
  if (/^(warn|yellow)\b/.test(lower)) return { state: 'warn', icon: '⚠ ', reason: str };
  if (/^(approve|green|ok)\b/.test(lower)) return { state: 'ok', icon: '✓ ', reason: str };
  if (/\b(block|reject|veto)\b/.test(lower)) return { state: 'block', icon: '✕ ', reason: str };
  if (/\b(warn)\b/.test(lower)) return { state: 'warn', icon: '⚠ ', reason: str };
  if (/\b(approve)\b/.test(lower)) return { state: 'ok', icon: '✓ ', reason: str };
  return { state: 'warn', icon: '⚠ ', reason: str };
}

// ── State Variables ──────────────────────────────────────────────────────────
let currentTab = getUiState('activeTab', 'dashboard');
let explorerKind = 'sessions';
let explorerScope = 'project';
let explorerSearchQuery = '';
let explorerSearchTimer;
// Every list or detail request gets a new id; only the latest reply is rendered (F05).
let explorerRequestId = 0;
let latestListRequestId = null;
let pendingDetailRequestId = null;
let explorerItemsShown = [];

let activeProgressTimerInterval = null;
let activeProgressStartTime = null;

// One HUD action runs at a time; replies for other request ids are ignored.
let actionSeq = 0;
let currentAction = null;
let provenanceRequestId = null;
let detectSeq = 0;
const pendingDetections = { cli: null, pr: null };

const MAX_COPY_TEXT = 1000000;

let pendingResumeSession = null;
let drawerOpen = false;
let drawerReturnFocus = null;
let allLogs = [];

// ── Tab Management ───────────────────────────────────────────────────────────
function switchTab(tabId) {
  currentTab = tabId;
  setUiState('activeTab', tabId);
  closeDetailDrawer();

  queryAll('.tab-btn').forEach((b) => {
    const isTarget = b.dataset.tab === tabId;
    b.classList.toggle('active', isTarget);
    b.setAttribute('aria-selected', String(isTarget));
    b.setAttribute('tabindex', isTarget ? '0' : '-1');
    if (isTarget && typeof b.scrollIntoView === 'function') {
      try { b.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' }); } catch {}
    }
  });

  queryAll('.tab-panel').forEach((p) => {
    const isTarget = p.id === 'panel-' + tabId;
    p.classList.toggle('active', isTarget);
    p.hidden = !isTarget;
  });

  if (tabId === 'explorer') {
    loadExplorerData();
  } else if (tabId === 'settings') {
    vscode.postMessage({ type: 'getSettings' });
  } else if (tabId === 'console') {
    const b = $('consoleBadge');
    if (b) b.hidden = true;
  }
}

queryAll('.tab-btn').forEach((b) => {
  b.addEventListener('click', () => switchTab(b.dataset.tab));
});
rovingTabs($('tabsNav'), '.tab-btn', (b) => switchTab(b.dataset.tab));

// Static cards in the Workflows and Settings panels collapse like rendered cards.
queryAll('.tab-panel > .card > .card-header[role="button"], .wf-cards > .card > .card-header[role="button"]').forEach((header, i) => {
  const body = header.parentElement && header.parentElement.querySelector('.card-body');
  if (!body) return;
  const title = header.querySelector('h3');
  const slug = (title ? title.textContent : String(i)).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  makeCollapsible(header, body, header.querySelector('.chevron'), 'static-' + slug);
});

// Buttons that name a command in data-cmd (e.g. Install docs) dispatch it (F11).
queryAll('[data-cmd]').forEach((b) => {
  b.addEventListener('click', () => vscode.postMessage({ type: 'command', command: b.dataset.cmd }));
});

safeOn('tabScrollPrev', 'click', () => {
  const nav = $('tabsNav');
  if (nav && typeof nav.scrollBy === 'function') {
    try { nav.scrollBy({ left: -75, behavior: 'smooth' }); } catch { nav.scrollLeft -= 75; }
  }
});
safeOn('tabScrollNext', 'click', () => {
  const nav = $('tabsNav');
  if (nav && typeof nav.scrollBy === 'function') {
    try { nav.scrollBy({ left: 75, behavior: 'smooth' }); } catch { nav.scrollLeft += 75; }
  }
});

const tabsNavEl = $('tabsNav');
if (tabsNavEl && typeof tabsNavEl.addEventListener === 'function') {
  tabsNavEl.addEventListener('wheel', (e) => {
    if (e && e.deltaY) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      tabsNavEl.scrollLeft += e.deltaY;
    }
  }, { passive: false });
}

safeOn('btnQuickConsole', 'click', () => switchTab('console'));
safeOn('btnRefresh', 'click', () => vscode.postMessage({ type: 'command', command: 'veto.refresh' }));

// ── Project Selector ─────────────────────────────────────────────────────────
safeOn('projectSelect', 'change', () => {
  const sel = $('projectSelect');
  if (sel) vscode.postMessage({ type: 'selectProject', projectDir: sel.value || undefined });
});

function updateProjectsList(projects) {
  const sel = $('projectSelect');
  if (!sel || !projects || !Array.isArray(projects)) return;
  sel.textContent = '';
  for (const p of projects) {
    const opt = el('option', null, p.name);
    opt.value = p.path || '';
    if (p.isPinned || p.isActive) opt.selected = true;
    sel.appendChild(opt);
  }
}

// ── Resume Choice Modal ──────────────────────────────────────────────────────
let resumeReturnFocus = null;
function openResumeModal(sessionId, platform) {
  pendingResumeSession = { id: sessionId, platform: platform || 'claude' };
  const desc = $('resumeSessionDesc');
  if (desc) desc.textContent = 'Session: ' + (sessionId.length > 24 ? sessionId.slice(0, 24) + '…' : sessionId);
  const modal = $('resumeChoiceModal');
  if (!modal) return;
  resumeReturnFocus = document.activeElement;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  setBackgroundInert(true);
  const first = $('btnResumeConsole');
  if (first && typeof first.focus === 'function') first.focus();
}
function closeResumeModal() {
  pendingResumeSession = null;
  const modal = $('resumeChoiceModal');
  if (!modal || modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  if (!drawerOpen) setBackgroundInert(false);
  restoreFocus(resumeReturnFocus);
  resumeReturnFocus = null;
}
safeOn('btnCancelResume', 'click', closeResumeModal);
safeOn('resumeChoiceModal', 'click', (e) => {
  if (e.target === $('resumeChoiceModal')) closeResumeModal();
});
safeOn('resumeChoiceModal', 'keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeResumeModal(); return; }
  trapFocus(e, $('resumeChoiceModal'));
});
safeOn('btnResumeConsole', 'click', () => {
  if (pendingResumeSession) {
    const { id, platform } = pendingResumeSession;
    closeResumeModal();
    closeDetailDrawer();
    switchTab('workflows');
    beginAction('Resuming Session', { type: 'resume', id, platform, target: 'console' });
  }
});
safeOn('btnResumeTerminal', 'click', () => {
  if (pendingResumeSession) {
    vscode.postMessage({ type: 'resume', id: pendingResumeSession.id, platform: pendingResumeSession.platform, target: 'terminal' });
    closeResumeModal();
  }
});

// ── Dashboard Rendering ──────────────────────────────────────────────────────
function renderDashboard(s) {
  const installed = !!s.installed;
  const notInst = $('notInstalled');
  if (notInst) notInst.hidden = installed;

  const verdict = ((s.council && s.council.verdict) || '').toUpperCase();
  const badge = $('verdict');
  if (badge) {
    badge.textContent = installed ? (verdict || 'no verdict') : 'offline';
    badge.className = 'badge ' + (verdict === 'GREEN' ? 'green' : verdict === 'RED' ? 'red' : verdict === 'DEADLOCK' ? 'deadlock' : verdict === 'YELLOW' ? 'yellow' : '');
  }

  const staleEl = $('stale');
  if (staleEl) staleEl.hidden = !s.stale;

  const cards = $('cards');
  if (!cards) return;
  cards.textContent = '';

  // Setup / Provenance Card
  const setup = card('Setup and provenance', 'setup');
  setup.appendTarget.appendChild(row('Selected project', s.projectDir || 'No workspace (global records)'));
  setup.appendTarget.appendChild(row('Database', !installed ? 'Unavailable' : s.stale ? 'Read failed / cached' : 'Readable'));
  setup.appendTarget.appendChild(row('Last read', s.lastSuccessfulRead ? new Date(s.lastSuccessfulRead).toLocaleString() : 'Unknown'));
  if (s.compatibilityWarning) setup.appendTarget.appendChild(el('div', 'sub', s.compatibilityWarning));
  if (s.staleReason) setup.appendTarget.appendChild(el('div', 'sub', s.staleReason));
  setup.appendTarget.appendChild(el('div', 'sub', 'MCP server health and provider availability have not been checked.'));
  setup.appendTarget.appendChild(btn('Setup details', () => vscode.postMessage({ type: 'command', command: 'veto.setupDiagnostics' }), true));
  cards.appendChild(setup);
  if (!installed) return;

  // Active Session Card
  const sc = card('Active Session', 'session');
  const scTarget = sc.appendTarget;
  if (s.session) {
    const ss = s.session;
    const idRow = row('ID', (ss.id || '').slice(0, 12) + '…', true);
    idRow.setAttribute('role', 'button');
    idRow.setAttribute('tabindex', '0');
    idRow.setAttribute('aria-label', 'Copy session ID');
    idRow.style.cursor = 'pointer';
    idRow.title = 'Click or press Enter to copy session ID';
    const copySessId = () => vscode.postMessage({ type: 'copyId', id: ss.id });
    idRow.addEventListener('click', copySessId);
    idRow.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        copySessId();
      }
    });
    scTarget.appendChild(idRow);
    scTarget.appendChild(row('Created by', ss.platform || '—'));
    scTarget.appendChild(row('Provider', ss.active_client || ss.platform || 'Unknown'));
    if (ss.started_at) scTarget.appendChild(row('Started', rel(ss.started_at)));
    scTarget.appendChild(row('Saved Tokens', String(ss.token_count ?? 'Unknown'), true));
    if (ss.summary) scTarget.appendChild(row('Summary', ss.summary.slice(0, 75)));

    const act = el('div', 'actions');
    act.appendChild(btn('Resume…', () => openResumeModal(ss.id, ss.active_client || ss.platform)));
    act.appendChild(btn('Save Checkpoint', () => switchTab('workflows'), true));
    scTarget.appendChild(act);
  } else {
    scTarget.appendChild(el('div', 'sub', 'No saved session for this project yet.'));
    const act = el('div', 'actions');
    act.appendChild(btn('Browse Saved Sessions', () => {
      switchTab('explorer');
      setExplorerKind('sessions');
    }, true));
    scTarget.appendChild(act);
  }
  cards.appendChild(sc);

  // Database Mismatch / Error Card
  if (s.backend && s.backend.state === 'db_mismatch') {
    const mismatch = card('Database mismatch', 'db-mismatch');
    mismatch.appendTarget.appendChild(row('Status', 'db_mismatch'));
    mismatch.appendTarget.appendChild(el('div', 'sub', s.backend.message || 'Veto backend database does not match the extension database configuration.'));
    if (s.backend.next_action) mismatch.appendTarget.appendChild(el('div', 'sub', 'Next action: ' + s.backend.next_action));
    cards.appendChild(mismatch);
  } else if (s.backend && s.backend.state !== 'ok') {
    const errCard = card('Backend status (' + s.backend.state + ')', 'backend-error');
    errCard.appendTarget.appendChild(row('Status', s.backend.state));
    if (s.backend.message) errCard.appendTarget.appendChild(el('div', 'sub', s.backend.message));
    if (s.backend.next_action) errCard.appendTarget.appendChild(el('div', 'sub', 'Next action: ' + s.backend.next_action));
    cards.appendChild(errCard);
  }

  // Transcripts Recall Card
  const recall = card('Transcript recall', 'transcripts');
  recall.appendTarget.appendChild(el('div', 'sub', 'Search masked archives for the selected project. Requires the Veto API v1 backend; retained archives can be searched when capture is off.'));
  recall.appendTarget.appendChild(btn('Search transcripts', () => {
    switchTab('explorer');
    setExplorerKind('transcripts');
  }, true));
  const backend = s.backend && s.backend.data;
  if (backend && backend.transcripts) {
    const tr = backend.transcripts;
    if (tr.state === 'ok') {
      recall.appendTarget.appendChild(row('Capture', tr.capture));
      recall.appendTarget.appendChild(row('Project archives', String(tr.archives_in_project)));
    } else {
      recall.appendTarget.appendChild(row('Transcripts', tr.state));
      if (tr.message) recall.appendTarget.appendChild(el('div', 'sub', tr.message));
    }
  }
  cards.appendChild(recall);

  // Lessons and Trial Card
  const lessons = card('Lessons and trial', 'lessons');
  if (!backend) lessons.appendTarget.appendChild(row('Consent / progress', 'Unknown'));
  lessons.appendTarget.appendChild(el('div', 'sub', 'Passive status requires backend support. Trial selection is shadow-only; this extension does not deliver lessons or harvest notes.'));
  lessons.appendTarget.appendChild(btn('Load status', () => vscode.postMessage({ type: 'command', command: 'veto.backendVisibility' }), true));
  if (backend) {
    lessons.appendTarget.appendChild(row('Read at', s.backend.generated_at));
    lessons.appendTarget.appendChild(row('Backend', s.backend.backend_version));
    if (backend.database) {
      const dbSec = backend.database;
      lessons.appendTarget.appendChild(row('Database', dbSec.state === 'ok' ? 'ok' : dbSec.state));
      if (dbSec.state !== 'ok' && dbSec.message) lessons.appendTarget.appendChild(el('div', 'sub', dbSec.message));
    }
    const l = backend.lessons, t = backend.trial;
    if (l) {
      lessons.appendTarget.appendChild(row('Sharing (all projects)', l.state === 'ok' ? l.sharing : l.state));
      if (l.state === 'ok') {
        lessons.appendTarget.appendChild(row('Notes / held (all projects)', l.notes + ' / ' + l.held));
      } else if (l.message) {
        lessons.appendTarget.appendChild(el('div', 'sub', l.message));
      }
    }
    if (t) {
      lessons.appendTarget.appendChild(row('Trial', t.state === 'ok' ? 'shadow-only' : t.state));
      if (t.state === 'ok') {
        lessons.appendTarget.appendChild(row('Qualifying / target', t.qualifying + ' / ' + t.target));
        lessons.appendTarget.appendChild(row('Complete / drift', String(t.complete) + ' / ' + String(t.drift)));
      } else if (t.message) {
        lessons.appendTarget.appendChild(el('div', 'sub', t.message));
      }
    }
  }
  cards.appendChild(lessons);

  // Council Verdict Card
  const cc = card('Council — verdict before code', 'council');
  const ccTarget = cc.appendTarget;
  if (s.council) {
    const c = s.council;
    ccTarget.appendChild(row('Verdict', (c.verdict || '—') + ' · ' + rel(c.debated_at)));
    if (c.task) ccTarget.appendChild(el('div', 'sub', String(c.task).slice(0, 100)));
    const votes = el('div', 'votes');
    for (const [key, label] of AGENTS) {
      const raw = c[key];
      const parsedVote = parseAgentVote(raw);
      if (parsedVote.state === 'none') continue;
      const chip = el('span', 'vote ' + parsedVote.state, parsedVote.icon + label);
      if (parsedVote.reason) chip.title = parsedVote.reason;
      else if (raw) chip.title = String(raw);
      votes.appendChild(chip);
    }
    ccTarget.appendChild(votes);
    if (c.recommended) ccTarget.appendChild(el('div', 'recommend', '→ ' + c.recommended));
  } else {
    ccTarget.appendChild(el('div', 'sub', 'No council verdict recorded for this project.'));
  }
  const cact = el('div', 'actions');
  cact.appendChild(btn('New Debate…', () => switchTab('workflows')));
  const reviewBtn = btn('Review file', () => {
    switchTab('workflows');
    beginAction('Reviewing Active File', { type: 'runAction', action: 'reviewFile' });
  }, true);
  reviewBtn.setAttribute('data-action-button', '');
  reviewBtn.disabled = !!currentAction;
  cact.appendChild(reviewBtn);
  cact.appendChild(btn('Council history', () => {
    switchTab('explorer');
    setExplorerKind('council');
  }, true));
  ccTarget.appendChild(cact);
  cards.appendChild(cc);

  // Router Learned Patterns Card
  const rc = card('Router — what Veto learned', 'router');
  const rcTarget = rc.appendTarget;
  if (s.patterns && s.patterns.length) {
    for (const p of s.patterns.slice(0, 6)) {
      const pr = el('div', 'pattern');
      pr.appendChild(el('span', 'mono', p.pattern_key));
      pr.appendChild(el('span', null, '→ ' + p.pattern_val));
      pr.appendChild(el('span', 'conf', Math.round((p.confidence || 0) * 100) + '% · ' + (p.seen_count || 0) + '×'));
      rcTarget.appendChild(pr);
    }
  } else {
    rcTarget.appendChild(el('div', 'sub', 'No routing patterns yet.'));
  }
  cards.appendChild(rc);

  // Token Budget Card
  if (s.rate && s.rate.some((r) => r.token_count > 0)) {
    const ra = card('Today — token budget', 'today');
    const raTarget = ra.appendTarget;
    for (const r of s.rate) {
      if (!r.token_count) continue;
      const pct = Math.round((r.token_count / Math.max(1, r.daily_token_budget)) * 100);
      raTarget.appendChild(row(r.platform, bar(pct) + ' ' + pct + '%', true));
    }
    cards.appendChild(ra);
  }

  // Health Stats Card
  if (s.health) {
    const h = s.health;
    const hc = card('Database statistics', 'health');
    const hcTarget = hc.appendTarget;
    hcTarget.appendChild(row('DB size', h.dbSizeMb + ' MB'));
    hcTarget.appendChild(row('Sessions', String(h.sessionCount)));
    hcTarget.appendChild(row('Patterns', String(h.patternCount)));
    hcTarget.appendChild(row('Outcomes', String(h.learningCount)));
    cards.appendChild(hc);
  }
}

// Alias for tests that call render(snapshot) directly
function render(s) {
  renderDashboard(s);
}

// ── Explorer Tab & Drawer Logic ──────────────────────────────────────────────
function setExplorerKind(kind) {
  explorerKind = kind;
  queryAll('.sub-pill').forEach((p) => {
    const isTarget = p.dataset.kind === kind;
    p.classList.toggle('active', isTarget);
    p.setAttribute('aria-selected', String(isTarget));
    p.setAttribute('tabindex', isTarget ? '0' : '-1');
  });
  const tf = $('transcriptFilter');
  if (tf) tf.classList.toggle('hidden', kind !== 'transcripts');
  loadExplorerData();
}

queryAll('.sub-pill').forEach((p) => {
  p.addEventListener('click', () => setExplorerKind(p.dataset.kind));
});
rovingTabs(typeof document !== 'undefined' && document.querySelector ? document.querySelector('.sub-nav') : null,
  '.sub-pill', (p) => setExplorerKind(p.dataset.kind));

queryAll('input[name="explorerScope"]').forEach((r) => {
  r.addEventListener('change', () => {
    explorerScope = r.value;
    loadExplorerData();
  });
});

const explorerSearchInput = $('explorerSearch');
if (explorerSearchInput) {
  explorerSearchInput.addEventListener('input', () => {
    clearTimeout(explorerSearchTimer);
    explorerSearchQuery = explorerSearchInput.value.trim();
    latestListRequestId = null; // results for the previous query are stale now
    explorerSearchTimer = setTimeout(() => loadExplorerData(), 250);
  });
}

safeOn('transcriptSource', 'change', () => loadExplorerData());

/** Request the first page, or with append=true the next page after the shown items (F04). */
function loadExplorerData(append) {
  const reqId = ++explorerRequestId;
  latestListRequestId = reqId;
  pendingDetailRequestId = null;
  const srcEl = $('transcriptSource');
  const source = srcEl ? srcEl.value : 'All sources';
  if (!append) explorerItemsShown = [];
  vscode.postMessage({
    type: 'queryExplorer',
    kind: explorerKind,
    scope: explorerScope,
    search: explorerSearchQuery,
    source,
    offset: append ? explorerItemsShown.length : 0,
    requestId: reqId
  });
}

function receiveExplorerData(m) {
  if (m.requestId !== latestListRequestId || m.kind !== explorerKind) return;
  const items = Array.isArray(m.items) ? m.items : [];
  explorerItemsShown = m.offset > 0 && !m.error ? explorerItemsShown.concat(items) : items;
  renderExplorerItems(explorerItemsShown, m.kind, m.error, m.notice, !!m.hasMore && !m.error);
}

function renderExplorerItems(items, kind, error, notice, hasMore) {
  const container = $('explorerItems');
  if (!container) return;
  container.textContent = '';

  if (error) {
    container.appendChild(el('div', 'empty', 'Error: ' + error));
    return;
  }
  if (!items || !items.length) {
    container.appendChild(el('div', 'empty', notice || 'No ' + kind + ' records found.'));
    return;
  }

  for (const item of items) {
    const cardEl = el('div', 'explorer-card');
    cardEl.setAttribute('role', 'button');
    cardEl.setAttribute('tabindex', '0');
    keyActivate(cardEl, () => cardEl.click());

    const selectThisCard = () => {
      queryAll('.explorer-card').forEach((c) => c.classList.remove('selected'));
      cardEl.classList.add('selected');
    };

    if (kind === 'sessions') {
      const title = el('div', 'explorer-card-title');
      title.appendChild(el('span', null, item.summary ? item.summary.slice(0, 48) : item.id));
      if (item.platform) title.appendChild(el('span', 'badge green', item.platform));
      cardEl.appendChild(title);
      cardEl.appendChild(el('div', 'explorer-card-meta', `${rel(item.started_at || item.created_at)} · ${item.token_count || 0} tokens · ${item.id.slice(0, 10)}…`));
      cardEl.addEventListener('click', () => {
        selectThisCard();
        openDetailDrawer('Session Details', item, [
          { label: 'Resume Session…', onClick: () => openResumeModal(item.id, item.active_client || item.platform) },
          { label: 'Copy Session ID', onClick: () => vscode.postMessage({ type: 'copyId', id: item.id }) }
        ], 'sessions');
      });
    } else if (kind === 'memory') {
      const title = el('div', 'explorer-card-title');
      title.appendChild(el('span', null, item.title || item.id));
      if (item.type) title.appendChild(el('span', 'badge yellow', item.type));
      cardEl.appendChild(title);
      const tagStr = Array.isArray(item.tags) ? item.tags.join(', ') : '';
      cardEl.appendChild(el('div', 'explorer-card-meta', `${tagStr || 'No tags'} · ${item.project_dir ? 'project' : 'global'}`));
      cardEl.addEventListener('click', () => {
        selectThisCard();
        drawerReturnFocus = cardEl;
        vscode.postMessage({ type: 'getMemoryDetail', id: item.id, scope: explorerScope, requestId: requestDetail() });
      });
    } else if (kind === 'council') {
      const title = el('div', 'explorer-card-title');
      title.appendChild(el('span', null, (item.task || item.id).slice(0, 48)));
      const v = (item.verdict || '').toUpperCase();
      title.appendChild(el('span', 'badge ' + (v === 'GREEN' ? 'green' : v === 'RED' ? 'red' : 'yellow'), v || '—'));
      cardEl.appendChild(title);
      cardEl.appendChild(el('div', 'explorer-card-meta', `${rel(item.debated_at)} · ${item.recommended ? 'Rec: ' + item.recommended.slice(0, 40) : 'No recommendation'}`));
      cardEl.addEventListener('click', () => {
        selectThisCard();
        openDetailDrawer('Council Verdict', item, [], 'council');
      });
    } else if (kind === 'decisions') {
      const title = el('div', 'explorer-card-title');
      title.appendChild(el('span', null, (item.decision || item.id).slice(0, 50)));
      if (item.council_verdict) title.appendChild(el('span', 'badge green', item.council_verdict));
      cardEl.appendChild(title);
      cardEl.appendChild(el('div', 'explorer-card-meta', `${item.made_at || ''} · ${item.rationale ? item.rationale.slice(0, 40) : ''}`));
      cardEl.addEventListener('click', () => {
        selectThisCard();
        openDetailDrawer('Decision Record', item, [], 'decisions');
      });
    } else if (kind === 'constraints') {
      const title = el('div', 'explorer-card-title');
      title.appendChild(el('span', null, (item.rule || item.id).slice(0, 50)));
      title.appendChild(el('span', 'badge ' + (item.active ? 'green' : 'yellow'), item.active ? 'Active' : 'Inactive'));
      cardEl.appendChild(title);
      cardEl.appendChild(el('div', 'explorer-card-meta', `${item.severity || 'rule'} · ${item.file_scope || 'all files'}`));
      cardEl.addEventListener('click', () => {
        selectThisCard();
        openDetailDrawer('Constraint Rule', item, [], 'constraints');
      });
    } else if (kind === 'reviews') {
      const title = el('div', 'explorer-card-title');
      title.appendChild(el('span', null, item.message ? item.message.slice(0, 48) : 'Diagnostic'));
      const sev = (item.severity || 'info').toLowerCase();
      title.appendChild(el('span', 'badge ' + (sev === 'error' ? 'red' : sev === 'warning' ? 'yellow' : 'green'), sev));
      cardEl.appendChild(title);
      cardEl.appendChild(el('div', 'explorer-card-meta', `${item.source || 'scan'} · ${item.file_path ? item.file_path.split(/[\\/]/).pop() + ':' + item.line : ''}`));
      cardEl.addEventListener('click', () => {
        selectThisCard();
        openDetailDrawer('Review Diagnostic', item, [], 'reviews');
      });
    } else if (kind === 'tools') {
      const title = el('div', 'explorer-card-title');
      title.appendChild(el('span', 'mono', item.name));
      if (item.category) title.appendChild(el('span', 'badge yellow', item.category));
      cardEl.appendChild(title);
      cardEl.appendChild(el('div', 'explorer-card-meta', item.description ? item.description.slice(0, 80) + '…' : ''));
      cardEl.addEventListener('click', () => {
        selectThisCard();
        openDetailDrawer(item.name, item, [
          { label: 'Copy Tool Name', onClick: () => vscode.postMessage({ type: 'copyId', id: item.name }) }
        ], 'tools');
      });
    } else if (kind === 'agents') {
      const title = el('div', 'explorer-card-title');
      title.appendChild(el('span', null, item.name || item.id));
      if (item.category) title.appendChild(el('span', 'badge green', item.category));
      cardEl.appendChild(title);
      cardEl.appendChild(el('div', 'explorer-card-meta', item.description ? item.description.slice(0, 80) + '…' : ''));
      cardEl.addEventListener('click', () => {
        selectThisCard();
        openDetailDrawer(item.name || item.id, item, [], 'agents');
      });
    } else if (kind === 'transcripts') {
      const title = el('div', 'explorer-card-title');
      title.appendChild(el('span', null, (item.snippet || item.id).slice(0, 50)));
      if (item.source) title.appendChild(el('span', 'badge green', item.source));
      cardEl.appendChild(title);
      cardEl.appendChild(el('div', 'explorer-card-meta', `${item.ts || ''} · ${item.source_session_id ? item.source_session_id.slice(0, 10) + '…' : ''}`));
      cardEl.addEventListener('click', () => {
        selectThisCard();
        drawerReturnFocus = cardEl;
        vscode.postMessage({ type: 'expandTranscript', eventId: item.event_id || item.id, requestId: requestDetail() });
      });
    }

    container.appendChild(cardEl);
  }

  if (hasMore) {
    const more = btn('Load more', () => {
      more.disabled = true;
      more.textContent = 'Loading…';
      loadExplorerData(true);
    }, true);
    more.id = 'explorerLoadMore';
    more.classList.add('load-more');
    container.appendChild(more);
  }
}

function requestDetail() {
  pendingDetailRequestId = ++explorerRequestId;
  return pendingDetailRequestId;
}

// ── In-Place Detail Drawer & Human-Readable Rendering ────────────────────────
function renderDetailContent(kind, data, container) {
  if (!data || typeof data !== 'object') {
    const box = el('div', 'detail-callout', String(data ?? 'No data'));
    container.appendChild(box);
    return;
  }

  if (kind === 'sessions') {
    const banner = el('div', 'detail-banner');
    banner.appendChild(el('span', null, 'AI Session'));
    banner.appendChild(el('span', 'badge green', String(data.platform || 'claude').toUpperCase()));
    container.appendChild(banner);

    const grid = el('div', 'detail-grid');
    const statTokens = el('div', 'detail-stat');
    statTokens.appendChild(el('div', 'stat-label', 'Tokens Used'));
    statTokens.appendChild(el('div', 'stat-value', String(data.token_count ?? 0)));
    grid.appendChild(statTokens);

    const statStarted = el('div', 'detail-stat');
    statStarted.appendChild(el('div', 'stat-label', 'Started'));
    statStarted.appendChild(el('div', 'stat-value', rel(data.started_at || data.created_at)));
    grid.appendChild(statStarted);
    container.appendChild(grid);

    if (data.summary) {
      const sec = el('div', 'detail-section');
      sec.appendChild(el('div', 'detail-section-title', 'Summary'));
      sec.appendChild(el('div', 'detail-callout', String(data.summary)));
      container.appendChild(sec);
    }
    if (data.task_state) {
      const sec = el('div', 'detail-section');
      sec.appendChild(el('div', 'detail-section-title', 'Current Task State'));
      sec.appendChild(el('div', 'detail-callout', String(data.task_state)));
      container.appendChild(sec);
    }
    const idSec = el('div', 'detail-section');
    idSec.appendChild(el('div', 'detail-section-title', 'Session ID'));
    idSec.appendChild(el('div', 'mono sub', String(data.id || '—')));
    container.appendChild(idSec);
  } else if (kind === 'council') {
    const v = String(data.verdict || 'GREEN').toUpperCase();
    const vCls = v === 'GREEN' ? 'green' : v === 'RED' ? 'red' : 'yellow';
    const banner = el('div', 'detail-banner');
    banner.appendChild(el('span', null, 'Council Verdict'));
    banner.appendChild(el('span', 'badge ' + vCls, v));
    container.appendChild(banner);

    if (data.task) {
      const sec = el('div', 'detail-section');
      sec.appendChild(el('div', 'detail-section-title', 'Debate Topic'));
      sec.appendChild(el('div', 'detail-callout', String(data.task)));
      container.appendChild(sec);
    }
    if (data.recommended) {
      const sec = el('div', 'detail-section');
      sec.appendChild(el('div', 'detail-section-title', 'Recommendation'));
      sec.appendChild(el('div', 'detail-callout recommend', String(data.recommended)));
      container.appendChild(sec);
    }
    const votes = data.votes;
    if (votes && typeof votes === 'object') {
      const vSec = el('div', 'detail-section');
      vSec.appendChild(el('div', 'detail-section-title', 'Specialist Agent Votes'));
      const entries = Array.isArray(votes)
        ? votes
        : Object.entries(votes).map(([k, val]) => ({ agent: k, ...(typeof val === 'object' && val !== null ? val : { reason: String(val) }) }));
      for (const item of entries) {
        const vRow = el('div', 'vote-row');
        const agName = item.agent || item.name || 'Agent';
        const voteVal = String(item.vote || item.verdict || 'OK').toUpperCase();
        const vIcon = voteVal === 'OK' || voteVal === 'APPROVE' || voteVal === 'PASS' ? '✓' : voteVal === 'WARN' ? '⚠' : '✕';
        const vIconCls = vIcon === '✓' ? 'ok' : vIcon === '⚠' ? 'warn' : 'block';
        vRow.appendChild(el('div', 'vote-agent ' + vIconCls, `${vIcon} ${agName}`));
        vRow.appendChild(el('div', 'vote-reason', String(item.reason || item.rationale || item.vote || 'Approved')));
        vSec.appendChild(vRow);
      }
      container.appendChild(vSec);
    }
  } else if (kind === 'memory') {
    const banner = el('div', 'detail-banner');
    banner.appendChild(el('span', null, String(data.title || 'Memory Record')));
    if (data.type) banner.appendChild(el('span', 'badge yellow', String(data.type)));
    container.appendChild(banner);

    const mContent = data.content || data.detail || data.summary || data.text;
    if (mContent) {
      const sec = el('div', 'detail-section');
      sec.appendChild(el('div', 'detail-section-title', 'Content & Insights'));
      sec.appendChild(el('div', 'detail-callout', typeof mContent === 'string' ? mContent : JSON.stringify(mContent, null, 2)));
      container.appendChild(sec);
    }
    const grid = el('div', 'detail-grid');
    const statScope = el('div', 'detail-stat');
    statScope.appendChild(el('div', 'stat-label', 'Scope'));
    statScope.appendChild(el('div', 'stat-value', data.project_dir ? 'Project Scoped' : 'Global'));
    grid.appendChild(statScope);

    const statDate = el('div', 'detail-stat');
    statDate.appendChild(el('div', 'stat-label', 'Recorded'));
    statDate.appendChild(el('div', 'stat-value', data.created_at ? new Date(data.created_at).toLocaleDateString() : 'Active'));
    grid.appendChild(statDate);
    container.appendChild(grid);
  } else if (kind === 'decisions') {
    const banner = el('div', 'detail-banner');
    banner.appendChild(el('span', null, 'Decision Record'));
    if (data.council_verdict) banner.appendChild(el('span', 'badge green', String(data.council_verdict)));
    container.appendChild(banner);

    const dSec = el('div', 'detail-section');
    dSec.appendChild(el('div', 'detail-section-title', 'Decision'));
    dSec.appendChild(el('div', 'detail-callout', String(data.decision || data.title || '—')));
    container.appendChild(dSec);

    if (data.rationale) {
      const rSec = el('div', 'detail-section');
      rSec.appendChild(el('div', 'detail-section-title', 'Rationale'));
      rSec.appendChild(el('div', 'detail-callout', String(data.rationale)));
      container.appendChild(rSec);
    }
    if (data.alternatives) {
      const aSec = el('div', 'detail-section');
      aSec.appendChild(el('div', 'detail-section-title', 'Alternatives Considered'));
      aSec.appendChild(el('div', 'detail-callout', typeof data.alternatives === 'string' ? data.alternatives : JSON.stringify(data.alternatives)));
      container.appendChild(aSec);
    }
  } else if (kind === 'constraints') {
    const banner = el('div', 'detail-banner');
    banner.appendChild(el('span', null, 'Constraint Rule'));
    banner.appendChild(el('span', 'badge ' + (data.active ? 'green' : 'yellow'), data.active ? 'Active' : 'Inactive'));
    container.appendChild(banner);

    const cSec = el('div', 'detail-section');
    cSec.appendChild(el('div', 'detail-section-title', 'Rule'));
    cSec.appendChild(el('div', 'detail-callout warn', String(data.rule || data.description || '—')));
    container.appendChild(cSec);

    const grid = el('div', 'detail-grid');
    const statSev = el('div', 'detail-stat');
    statSev.appendChild(el('div', 'stat-label', 'Severity'));
    statSev.appendChild(el('div', 'stat-value', String(data.severity || 'rule').toUpperCase()));
    grid.appendChild(statSev);

    const statScope = el('div', 'detail-stat');
    statScope.appendChild(el('div', 'stat-label', 'Scope'));
    statScope.appendChild(el('div', 'stat-value', String(data.file_scope || 'All files')));
    grid.appendChild(statScope);
    container.appendChild(grid);
  } else if (kind === 'reviews') {
    const sev = String(data.severity || 'info').toLowerCase();
    const sevClass = sev === 'error' ? 'red' : sev === 'warning' ? 'yellow' : 'green';
    const banner = el('div', 'detail-banner');
    banner.appendChild(el('span', null, String(data.category || 'Diagnostic Finding')));
    banner.appendChild(el('span', 'badge ' + sevClass, sev.toUpperCase()));
    container.appendChild(banner);

    const msgSec = el('div', 'detail-section');
    msgSec.appendChild(el('div', 'detail-section-title', 'Issue Description'));
    msgSec.appendChild(el('div', 'detail-callout warn', String(data.message || data.description || '—')));
    container.appendChild(msgSec);

    if (data.file_path) {
      const locSec = el('div', 'detail-section');
      locSec.appendChild(el('div', 'detail-section-title', 'Location'));
      locSec.appendChild(el('div', 'mono sub', `${data.file_path}:${data.line || 1}`));
      container.appendChild(locSec);
    }
    if (data.fix) {
      const fixSec = el('div', 'detail-section');
      fixSec.appendChild(el('div', 'detail-section-title', 'Suggested Fix'));
      fixSec.appendChild(el('div', 'detail-callout recommend', String(data.fix)));
      container.appendChild(fixSec);
    }
  } else if (kind === 'tools') {
    const banner = el('div', 'detail-banner');
    banner.appendChild(el('span', 'mono', String(data.name || 'Veto Tool')));
    if (data.category) banner.appendChild(el('span', 'badge yellow', String(data.category)));
    container.appendChild(banner);

    const descSec = el('div', 'detail-section');
    descSec.appendChild(el('div', 'detail-section-title', 'Description'));
    descSec.appendChild(el('div', 'detail-callout', String(data.description || 'No description available.')));
    container.appendChild(descSec);

    const params = data.parameters || data.params;
    const props = params && params.properties;
    if (props && typeof props === 'object') {
      const pSec = el('div', 'detail-section');
      pSec.appendChild(el('div', 'detail-section-title', 'Parameters'));
      const req = new Set(Array.isArray(params.required) ? params.required : []);
      const tbl = el('table', 'param-table');
      const thead = el('tr');
      thead.appendChild(el('th', null, 'Parameter'));
      thead.appendChild(el('th', null, 'Type'));
      thead.appendChild(el('th', null, 'Description'));
      tbl.appendChild(thead);
      for (const [pName, pDef] of Object.entries(props)) {
        const rowEl = el('tr');
        const nTd = el('td', 'mono', pName + (req.has(pName) ? ' *' : ''));
        if (req.has(pName)) nTd.style.fontWeight = 'bold';
        rowEl.appendChild(nTd);
        rowEl.appendChild(el('td', 'sub', String((pDef && pDef.type) || 'any')));
        rowEl.appendChild(el('td', null, String((pDef && pDef.description) || '—')));
        tbl.appendChild(rowEl);
      }
      pSec.appendChild(tbl);
      container.appendChild(pSec);
    }
  } else if (kind === 'agents') {
    const banner = el('div', 'detail-banner');
    banner.appendChild(el('span', null, String(data.name || data.id || 'Specialist Agent')));
    if (data.category) banner.appendChild(el('span', 'badge green', String(data.category)));
    container.appendChild(banner);

    const rSec = el('div', 'detail-section');
    rSec.appendChild(el('div', 'detail-section-title', 'Role & Specialization'));
    rSec.appendChild(el('div', 'detail-callout', String(data.role || data.description || 'Specialist member of the Veto agent system.')));
    container.appendChild(rSec);
  } else if (kind === 'transcripts') {
    const banner = el('div', 'detail-banner');
    banner.appendChild(el('span', null, 'Transcript Event'));
    banner.appendChild(el('span', 'badge green', String(data.source || 'Session')));
    container.appendChild(banner);

    if (data.snippet) {
      const sSec = el('div', 'detail-section');
      sSec.appendChild(el('div', 'detail-section-title', 'Masked Archive Snippet'));
      sSec.appendChild(el('div', 'detail-callout', String(data.snippet)));
      container.appendChild(sSec);
    }
    const text = data.text || data.content;
    if (text) {
      const tSec = el('div', 'detail-section');
      tSec.appendChild(el('div', 'detail-section-title', 'Event Text'));
      tSec.appendChild(el('div', 'chat-turn', String(text)));
      container.appendChild(tSec);
    }
    const metaSec = el('div', 'detail-section');
    metaSec.appendChild(el('div', 'detail-section-title', 'Provenance'));
    metaSec.appendChild(el('div', 'mono sub', `Event: ${data.event_id || data.id || '—'}\nTime: ${data.ts || data.timestamp || '—'}`));
    container.appendChild(metaSec);
  } else {
    const sec = el('div', 'detail-section');
    sec.appendChild(el('div', 'detail-callout', typeof data === 'string' ? data : JSON.stringify(data, null, 2)));
    container.appendChild(sec);
  }

  // Always append collapsible raw JSON for power inspection
  const rawDetails = el('details', 'raw-json-details');
  const sumEl = el('summary', null, '🔍 View Raw JSON');
  rawDetails.appendChild(sumEl);
  const pre = el('pre', 'code-box');
  pre.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  rawDetails.appendChild(pre);
  container.appendChild(rawDetails);
}

function openDetailDrawer(title, data, actionButtons, kind) {
  const dTitle = $('drawerTitle');
  const dActions = $('drawerActions');
  const dContent = $('drawerContent');
  const drawer = $('detailDrawer');
  const backdrop = $('drawerBackdrop');

  if (dTitle) dTitle.textContent = title;
  if (dActions) {
    dActions.textContent = '';
    if (actionButtons && actionButtons.length) {
      for (const ab of actionButtons) {
        dActions.appendChild(btn(ab.label, ab.onClick, false));
      }
    }
  }
  if (dContent) {
    dContent.textContent = '';
    renderDetailContent(kind, data, dContent);
  }

  if (!drawer) return;
  if (!drawerOpen && !drawerReturnFocus) drawerReturnFocus = document.activeElement;
  drawerOpen = true;
  drawer.classList.remove('hidden');
  drawer.setAttribute('aria-hidden', 'false');
  drawer.setAttribute('aria-modal', 'true');
  if (backdrop) backdrop.classList.remove('hidden');
  setBackgroundInert(true);
  const close = $('closeDrawer');
  if (close && typeof close.focus === 'function') close.focus();
}

function closeDetailDrawer() {
  pendingDetailRequestId = null;
  const drawer = $('detailDrawer');
  const backdrop = $('drawerBackdrop');
  if (drawer) {
    drawer.classList.add('hidden');
    drawer.setAttribute('aria-hidden', 'true');
  }
  if (backdrop) backdrop.classList.add('hidden');
  if (!drawerOpen) {
    drawerReturnFocus = null;
    return;
  }
  drawerOpen = false;
  const modal = $('resumeChoiceModal');
  const modalOpen = modal && !modal.classList.contains('hidden');
  if (!modalOpen) setBackgroundInert(false);
  restoreFocus(drawerReturnFocus);
  drawerReturnFocus = null;
}

/** While a dialog is open, the page behind it cannot be clicked or focused (F14). */
function setBackgroundInert(on) {
  for (const node of [$('hdr'), $('tabsWrapper'), $('tabPanels')]) {
    if (!node) continue;
    if (on) node.setAttribute('inert', '');
    else if (typeof node.removeAttribute === 'function') node.removeAttribute('inert');
  }
}

function restoreFocus(target) {
  if (target && typeof target.focus === 'function' && target.isConnected !== false) {
    try { target.focus(); } catch {}
  }
}

/** Keep Tab / Shift+Tab inside an open dialog. */
function trapFocus(e, container) {
  if (e.key !== 'Tab' || !container || typeof container.querySelectorAll !== 'function') return;
  const focusable = Array.from(container.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'))
    .filter((n) => !n.disabled && !n.hidden);
  if (!focusable.length) return;
  const first = focusable[0];
  const lastEl = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
  else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
}

safeOn('closeDrawer', 'click', closeDetailDrawer);
safeOn('drawerBackdrop', 'click', closeDetailDrawer);
safeOn('detailDrawer', 'keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeDetailDrawer(); return; }
  trapFocus(e, $('detailDrawer'));
});

// ── Workflows Tab & Active Progress Management ──────────────────────────────
let lastActionResultText = '';

const nowTs = () => new Date().toISOString().slice(11, 19);

function setActionButtonsDisabled(disabled) {
  queryAll('[data-action-button]').forEach((b) => { b.disabled = disabled; });
}

/** Start one tracked action; refuses while another action is still running. */
function beginAction(label, message) {
  if (currentAction) {
    appendLogLine({ id: Date.now(), timestamp: nowTs(), level: 'warn', text: `"${label}" was not started: ${currentAction.label} is still running.` });
    return false;
  }
  const requestId = ++actionSeq;
  currentAction = { requestId, label };
  setActionButtonsDisabled(true);
  startProgress(label);
  vscode.postMessage(Object.assign({}, message, { requestId }));
  return true;
}

function startProgress(actionLabel) {
  const pTitle = $('progressTitle');
  const pTimer = $('progressTimer');
  const progressCard = $('activeProgressCard');
  const resultCard = $('workflowResultCard');
  const cStatus = $('consoleStatus');
  const cancel = $('btnCancelAction');

  if (pTitle) pTitle.textContent = actionLabel;
  if (pTimer) pTimer.textContent = '00:00';
  if (cancel) {
    cancel.disabled = false;
    cancel.textContent = 'Cancel Action';
  }
  activeProgressStartTime = Date.now();
  clearInterval(activeProgressTimerInterval);
  activeProgressTimerInterval = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - activeProgressStartTime) / 1000);
    const m = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
    const s = String(elapsedSec % 60).padStart(2, '0');
    if (pTimer) pTimer.textContent = m + ':' + s;
  }, 1000);

  if (progressCard) progressCard.classList.remove('hidden');
  if (resultCard) resultCard.classList.add('hidden');
  if (cStatus) {
    cStatus.textContent = '● Running: ' + actionLabel;
    cStatus.classList.add('active');
  }
}

/** Show the settled action: COMPLETED/verdict, ERROR, or CANCELLED — never success by default (F01). */
function finishProgress(actionName, status, verdict, result, message) {
  clearInterval(activeProgressTimerInterval);
  const progressCard = $('activeProgressCard');
  const resultCard = $('workflowResultCard');
  const rAction = $('resultActionName');
  const rVerdict = $('resultVerdict');
  const rBody = $('resultBody');
  const cStatus = $('consoleStatus');
  const copyStatus = $('copyResultStatus');

  if (progressCard) progressCard.classList.add('hidden');
  if (cStatus) {
    cStatus.textContent = '● Idle';
    cStatus.classList.remove('active');
  }

  if (resultCard) resultCard.classList.remove('hidden');
  if (rAction) rAction.textContent = actionName;

  if (rVerdict) {
    rVerdict.textContent = status === 'cancelled' ? 'CANCELLED' : status === 'error' ? 'ERROR' : (verdict || 'COMPLETED');
    rVerdict.className = 'badge ' + (status === 'cancelled' ? 'neutral'
      : status === 'error' || verdict === 'RED' ? 'red'
        : verdict === 'DEADLOCK' ? 'deadlock'
          : verdict === 'YELLOW' ? 'yellow' : 'green');
  }

  const resultText = typeof result === 'string' ? result : result ? JSON.stringify(result, null, 2) : '';
  const text = status === 'done'
    ? (resultText || message || 'Completed with no result data.')
    : ([message, resultText].filter(Boolean).join('\n\n') ||
      (status === 'cancelled' ? 'Cancelled.' : 'The action failed without details. Open the Veto log for more information.'));
  lastActionResultText = text;
  if (rBody) rBody.textContent = text;
  if (copyStatus) copyStatus.textContent = '';
}

function receiveActionStatus(m) {
  if (m.action === 'setupDiagnostics') {
    if (m.requestId === provenanceRequestId && m.status !== 'running') {
      provenanceRequestId = null;
      showDiagnosticsReport('Setup Provenance', m.status === 'error' ? m.message : m.result);
    }
    return;
  }
  if (!currentAction || (m.requestId !== undefined && m.requestId !== currentAction.requestId)) return;
  if (m.status === 'running') return;
  const label = currentAction.label;
  currentAction = null;
  setActionButtonsDisabled(false);
  finishProgress(label, m.status, m.verdict, m.result, m.message);
  if (m.action === 'backendDiagnostics') {
    showDiagnosticsReport('Backend Diagnostics', m.result || m.message || m.status);
  }
}

/** Copy through the extension; text beyond the message limit gets explicit feedback (F06). */
function copyText(text, statusEl) {
  if (!text) return;
  if (text.length > MAX_COPY_TEXT) {
    const msg = `Too large to copy (${text.length.toLocaleString()} characters; limit ${MAX_COPY_TEXT.toLocaleString()}). Open the Veto log instead.`;
    if (statusEl) statusEl.textContent = msg;
    else appendLogLine({ id: Date.now(), timestamp: nowTs(), level: 'warn', text: msg });
    return;
  }
  if (statusEl) statusEl.textContent = '';
  vscode.postMessage({ type: 'copyText', text });
}

safeOn('btnCancelAction', 'click', () => {
  if (!currentAction) return;
  vscode.postMessage({ type: 'cancelAction', requestId: currentAction.requestId });
  const b = $('btnCancelAction');
  if (b) {
    b.disabled = true;
    b.textContent = 'Cancelling…';
  }
});
safeOn('btnViewConsole', 'click', () => switchTab('console'));
safeOn('closeResult', 'click', () => {
  const rc = $('workflowResultCard');
  if (rc) rc.classList.add('hidden');
});
safeOn('btnCopyResult', 'click', () => copyText(lastActionResultText, $('copyResultStatus')));

// Interactive Form Actions
safeOn('btnStartDebate', 'click', () => {
  const elPrompt = $('wfDebatePrompt');
  const task = elPrompt ? elPrompt.value.trim() : '';
  if (!task) return;
  beginAction('Council Debate', { type: 'runAction', action: 'debate', params: { task } });
});

safeOn('btnSaveCheckpoint', 'click', () => {
  const elSummary = $('wfCheckpointSummary');
  const summary = elSummary ? elSummary.value.trim() : '';
  if (!summary) return;
  beginAction('Saving Checkpoint', { type: 'runAction', action: 'saveCheckpoint', params: { summary } });
});

safeOn('btnReviewActiveFile', 'click', () => {
  beginAction('Reviewing Active File', { type: 'runAction', action: 'reviewFile' });
});

safeOn('btnScanSecrets', 'click', () => {
  let scope = 'working';
  queryAll('input[name="secretsScope"]').forEach((r) => {
    if (r.checked) scope = r.value;
  });
  beginAction('Scanning Secrets (' + scope + ')', { type: 'runAction', action: 'scanSecrets', params: { scope } });
});

/** Ask the extension to detect the CLI path or the branch PR (F03, F08). */
function requestDetection(kind) {
  const ids = DETECTION_IDS[kind];
  const requestId = ++detectSeq;
  pendingDetections[kind] = requestId;
  const b = $(ids.button);
  if (b) b.disabled = true;
  const s = $(ids.status);
  if (s) {
    s.textContent = kind === 'cli' ? 'Detecting the Veto CLI…' : 'Detecting the pull request for this branch…';
    s.classList.remove('error');
  }
  vscode.postMessage({ type: kind === 'cli' ? 'detectCli' : 'detectPr', requestId });
}

const DETECTION_IDS = {
  cli: { button: 'btnDetectCli', status: 'cliDetectStatus', input: 'settingCliPath' },
  pr: { button: 'btnDetectPr', status: 'prDetectStatus', input: 'wfPrUrl' },
};

function receiveDetection(m) {
  const ids = DETECTION_IDS[m.kind];
  if (!ids || m.requestId !== pendingDetections[m.kind]) return;
  pendingDetections[m.kind] = null;
  const b = $(ids.button);
  if (b) b.disabled = false;
  const s = $(ids.status);
  if (m.value) {
    const input = $(ids.input);
    if (input) input.value = m.value;
    if (s) {
      s.textContent = m.kind === 'cli' ? 'Detected. Save Configuration to use this path.' : 'Detected the open pull request for this branch.';
      s.classList.remove('error');
    }
  } else if (s) {
    s.textContent = m.error || 'Detection failed.';
    s.classList.add('error');
  }
}

safeOn('btnDetectPr', 'click', () => requestDetection('pr'));

safeOn('btnReviewPr', 'click', () => {
  const prInput = $('wfPrUrl');
  const prUrl = prInput ? prInput.value.trim() : '';
  if (!prUrl) return;
  beginAction('Reviewing Pull Request', { type: 'runAction', action: 'reviewPR', params: { prUrl } });
});

safeOn('btnDraftCommit', 'click', () => {
  beginAction('Drafting Commit Message', { type: 'runAction', action: 'draftCommit' });
});

safeOn('btnDraftPr', 'click', () => {
  const baseEl = $('wfPrBaseBranch');
  const baseBranch = baseEl ? baseEl.value.trim() || 'main' : 'main';
  beginAction('Drafting PR Description', { type: 'runAction', action: 'draftPR', params: { baseBranch } });
});

// ── Console Tab Management ───────────────────────────────────────────────────
safeOn('btnOpenTerminal', 'click', () => {
  vscode.postMessage({ type: 'command', command: 'veto.openTerminal' });
});

safeOn('consoleViewport', 'click', () => {
  const inp = $('consoleInput');
  if (inp && typeof inp.focus === 'function') inp.focus();
});

safeOn('consoleFilter', 'input', () => {
  const filterEl = $('consoleFilter');
  const q = filterEl ? filterEl.value.toLowerCase() : '';
  queryAll('.log-line').forEach((line) => {
    line.style.display = !q || line.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
});

safeOn('btnClearLog', 'click', () => {
  const vp = $('consoleViewport');
  if (vp) vp.textContent = '';
  allLogs = [];
  vscode.postMessage({ type: 'clearLog' });
});

safeOn('btnCopyLog', 'click', () => {
  const fullText = allLogs.map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.text}`).join('\n');
  copyText(fullText, null);
});

function handleConsoleCommand() {
  const inp = $('consoleInput');
  if (!inp) return;
  const raw = (inp.value || '').trim();
  if (!raw) return;
  inp.value = '';

  appendLogLine({ id: Date.now(), timestamp: nowTs(), level: 'info', text: `❯ ${raw}` });

  const cmd = raw.toLowerCase();
  if (cmd === 'clear') {
    const vp = $('consoleViewport');
    if (vp) vp.textContent = '';
    allLogs = [];
    vscode.postMessage({ type: 'clearLog' });
  } else if (cmd === 'help') {
    appendLogLine({
      id: Date.now(),
      timestamp: nowTs(),
      level: 'info',
      text: 'Available commands: status, refresh, tools, agents, terminal, clear, help. Use the Workflows tab to run Council Debates and Code Reviews.'
    });
  } else if (cmd === 'status' || cmd === 'refresh') {
    vscode.postMessage({ type: 'command', command: 'veto.refresh' });
  } else if (cmd === 'terminal') {
    vscode.postMessage({ type: 'command', command: 'veto.openTerminal' });
  } else if (cmd === 'tools') {
    switchTab('explorer');
    setExplorerKind('tools');
  } else if (cmd === 'agents') {
    switchTab('explorer');
    setExplorerKind('agents');
  } else {
    appendLogLine({
      id: Date.now(),
      timestamp: nowTs(),
      level: 'warn',
      text: `Unknown command "${raw}"; nothing was run. Type help for console commands, or click 💻 Terminal to use the Veto CLI.`
    });
  }
}

safeOn('btnConsoleSend', 'click', handleConsoleCommand);
const cInp = $('consoleInput');
if (cInp && typeof cInp.addEventListener === 'function') {
  cInp.addEventListener('keydown', (e) => {
    if (e && e.key === 'Enter') {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      handleConsoleCommand();
    }
  });
}

function appendLogLine(entry) {
  allLogs.push(entry);
  if (allLogs.length > 500) allLogs.shift();

  const vp = $('consoleViewport');
  if (!vp) return;

  const line = el('div', 'log-line');
  const meta = el('span', 'log-meta');
  meta.appendChild(el('span', 'log-ts', entry.timestamp || ''));
  meta.appendChild(el('span', 'log-tag ' + (entry.level || 'info'), `[${(entry.level || 'info').toUpperCase()}]`));
  line.appendChild(meta);
  line.appendChild(el('span', 'log-msg', entry.text || ''));

  const filterEl = $('consoleFilter');
  const q = filterEl ? filterEl.value.toLowerCase() : '';
  if (q && !line.textContent.toLowerCase().includes(q)) {
    line.style.display = 'none';
  }
  vp.appendChild(line);

  if (vp.children.length > 500) {
    vp.removeChild(vp.firstChild);
  }

  const chk = $('chkAutoScroll');
  if (chk && chk.checked) {
    vp.scrollTop = vp.scrollHeight;
  }

  if (currentTab !== 'console' && entry.level === 'error') {
    const b = $('consoleBadge');
    if (b) {
      b.textContent = '!';
      b.hidden = false;
    }
  }
}

// ── Settings & Diagnostics Tab ───────────────────────────────────────────────
function renderSettings(s) {
  const cli = $('settingCliPath');
  const db = $('settingDbPath');
  const poll = $('settingPollInterval');
  const timeout = $('settingActionTimeout');
  const dbStatus = $('settingDbStatus');
  const hr = $('settingsHealthRows');

  if (cli) cli.value = s.cliPath || '';
  if (db) db.value = s.dbPath || '';
  if (poll) poll.value = s.pollInterval || 5000;
  if (timeout) timeout.value = s.actionTimeoutMs || 120000;
  if (dbStatus) dbStatus.textContent = s.isCustomDb ? 'Using custom database override. AI workflows are blocked unless Veto uses this same database.' : `Using default: ${s.defaultDbPath}`;

  if (hr) {
    hr.textContent = '';
    hr.appendChild(row('Node Runtime', s.nodeVersion || 'Unknown'));
    hr.appendChild(row('SQLite Engine', s.isSqliteSupported ? 'node:sqlite (Ready)' : 'Unsupported'));
    hr.appendChild(row('Workspace Trust', s.isTrusted ? 'Trusted' : 'Untrusted'));
  }
}

safeOn('btnSaveSettings', 'click', () => {
  const cli = $('settingCliPath');
  const db = $('settingDbPath');
  const poll = $('settingPollInterval');
  const timeout = $('settingActionTimeout');
  vscode.postMessage({
    type: 'saveSettings',
    settings: {
      cliPath: cli ? cli.value : '',
      dbPath: db ? db.value : '',
      pollInterval: poll ? parseInt(poll.value, 10) : 5000,
      actionTimeoutMs: timeout ? parseInt(timeout.value, 10) : 120000,
    }
  });
});

safeOn('btnResetSettings', 'click', () => {
  vscode.postMessage({
    type: 'saveSettings',
    settings: { cliPath: '', dbPath: '', pollInterval: 5000, actionTimeoutMs: 120000 }
  });
});

safeOn('btnDetectCli', 'click', () => requestDetection('cli'));

safeOn('btnRunDiagnostics', 'click', () => {
  if (beginAction('Running Backend Diagnostics', { type: 'runAction', action: 'backendDiagnostics' })) {
    showDiagnosticsReport('Backend Diagnostics', 'Running…');
  }
});

safeOn('btnViewProvenance', 'click', () => {
  provenanceRequestId = ++actionSeq;
  vscode.postMessage({ type: 'runAction', action: 'setupDiagnostics', requestId: provenanceRequestId });
});

safeOn('closeDiagReport', 'click', () => {
  const cont = $('diagnosticsReportContainer');
  if (cont) cont.classList.add('hidden');
});

function showDiagnosticsReport(title, content) {
  const dTitle = $('diagReportTitle');
  const dContent = $('diagReportContent');
  const dCont = $('diagnosticsReportContainer');
  if (dTitle) dTitle.textContent = title;
  if (dContent) dContent.textContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  if (dCont) dCont.classList.remove('hidden');
}

/** The selected project or database changed: cached lists and details are stale (F05). */
function onScopeChanged() {
  explorerItemsShown = [];
  latestListRequestId = null;
  closeDetailDrawer();
  const container = $('explorerItems');
  if (container) container.textContent = '';
  if (currentTab === 'explorer') loadExplorerData();
}

// ── Global Message Dispatcher ────────────────────────────────────────────────
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || typeof m !== 'object') return;

    switch (m.type) {
      case 'snapshot':
        renderDashboard(m.data);
        break;
      case 'settings':
        renderSettings(m.settings);
        break;
      case 'projectsList':
        updateProjectsList(m.projects);
        break;
      case 'explorerData':
        receiveExplorerData(m);
        break;
      case 'explorerDetail':
        if (m.requestId !== pendingDetailRequestId) break;
        pendingDetailRequestId = null;
        openDetailDrawer(`${String(m.kind).toUpperCase()}: ${m.id}`, m.error ? 'Error: ' + m.error : m.detail, [], m.kind);
        break;
      case 'actionStatus':
        receiveActionStatus(m);
        break;
      case 'detection':
        receiveDetection(m);
        break;
      case 'scopeChanged':
        onScopeChanged();
        break;
      case 'logEntry':
        appendLogLine(m.entry);
        break;
      case 'recentLogs':
        if (Array.isArray(m.logs)) {
          for (const l of m.logs) appendLogLine(l);
        }
        break;
      case 'clearLogs': {
        const vp = $('consoleViewport');
        if (vp) vp.textContent = '';
        allLogs = [];
        break;
      }
    }
  });
}

// Restore previous tab on startup, then ask the extension for state now that the
// message listener exists (F10).
switchTab(currentTab);
vscode.postMessage({ type: 'ready' });
