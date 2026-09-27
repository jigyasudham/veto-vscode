const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);

let uiState = vscode.getState() || {};
function setUiState(key, val) {
  uiState[key] = val;
  vscode.setState(uiState);
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
    const bodyId = 'card-body-' + id;
    body.id = bodyId;
    header.setAttribute('aria-controls', bodyId);
    c.appendChild(body);

    const isCollapsed = getUiState('collapse_' + id, false);
    header.setAttribute('aria-expanded', String(!isCollapsed));
    if (isCollapsed) {
      body.classList.add('collapsed');
      chevron.classList.add('collapsed');
    }

    const toggle = () => {
      const collapsedNow = body.classList.toggle('collapsed');
      chevron.classList.toggle('collapsed', collapsedNow);
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

    c.appendTarget = body;
  } else {
    c.appendTarget = c;
  }
  return c;
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
  } catch {
    // not JSON
  }
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

let currentSearchQuery = '';
let searchRequestId = 0;
let cachedSearchResults = null;
let searchTimer;
let renderedProject;

function render(s) {
  const projectChanged = renderedProject !== s.projectDir;
  if (projectChanged) {
    renderedProject = s.projectDir;
    currentSearchQuery = '';
    cachedSearchResults = null;
    searchRequestId++;
    clearTimeout(searchTimer);
  }
  const installed = !!s.installed;
  $('notInstalled').hidden = installed;
  const verdict = ((s.council && s.council.verdict) || '').toUpperCase();
  const badge = $('verdict');
  badge.textContent = installed ? (verdict || 'no verdict') : 'offline';
  badge.className = 'badge ' + (verdict === 'GREEN' ? 'green' : verdict === 'RED' ? 'red' : verdict === 'DEADLOCK' ? 'deadlock' : verdict === 'YELLOW' ? 'yellow' : '');
  $('stale').hidden = !s.stale;
  
  // Capture active search input state before rebuilding cards to maintain user typing focus
  const existingInput = $('memSearchInput');
  const hadFocus = document.activeElement === existingInput;
  if (existingInput && !projectChanged) {
    currentSearchQuery = existingInput.value;
  }
  const selStart = existingInput ? existingInput.selectionStart : currentSearchQuery.length;
  const selEnd = existingInput ? existingInput.selectionEnd : currentSearchQuery.length;

  const cards = $('cards');
  cards.textContent = '';
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

  // Session Section
  const sc = card('Session', 'session');
  const scTarget = sc.appendTarget;
  if (s.session) {
    const ss = s.session;
    const idRow = row('ID', (ss.id || '').slice(0, 8) + '…', true);
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
    scTarget.appendChild(row('Recorded provider', ss.active_client || ss.platform || 'Unknown'));
    if (ss.connection_type) scTarget.appendChild(row('Type', ss.connection_type));
    if (ss.started_at) scTarget.appendChild(row('Started', rel(ss.started_at)));
    scTarget.appendChild(row('Saved tokens', String(ss.token_count ?? 'Unknown'), true));
    scTarget.appendChild(row('Live context / capacity', 'Unknown'));
    scTarget.appendChild(el('div', 'sub', 'Source: saved session record. Refreshing the database does not measure live provider activity.'));
    if (ss.summary) scTarget.appendChild(row('Summary', ss.summary.slice(0, 60)));
    const act = el('div', 'actions');
    act.appendChild(btn('Resume', () => vscode.postMessage({ type: 'resume', id: ss.id, platform: ss.active_client || ss.platform })));
    act.appendChild(btn('Save', () => vscode.postMessage({ type: 'command', command: 'veto.saveSession' }), true));
    scTarget.appendChild(act);
  } else {
    scTarget.appendChild(el('div', 'sub', 'No saved session for this workspace.'));
  }
  cards.appendChild(sc);

  if (s.backend && s.backend.state === 'db_mismatch') {
    const mismatch = card('Database mismatch', 'db-mismatch');
    mismatch.appendTarget.appendChild(row('Status', 'db_mismatch'));
    mismatch.appendTarget.appendChild(el('div', 'sub', s.backend.message || 'Veto backend database does not match the extension database configuration.'));
    if (s.backend.next_action) {
      mismatch.appendTarget.appendChild(el('div', 'sub', 'Next action: ' + s.backend.next_action));
    }
    cards.appendChild(mismatch);
  } else if (s.backend && s.backend.state !== 'ok') {
    const errCard = card('Backend status (' + s.backend.state + ')', 'backend-error');
    errCard.appendTarget.appendChild(row('Status', s.backend.state));
    if (s.backend.message) errCard.appendTarget.appendChild(el('div', 'sub', s.backend.message));
    if (s.backend.next_action) errCard.appendTarget.appendChild(el('div', 'sub', 'Next action: ' + s.backend.next_action));
    cards.appendChild(errCard);
  }

  const recall = card('Transcript recall', 'transcripts');
  recall.appendTarget.appendChild(el('div', 'sub', 'Search masked archives for the selected project. Requires the Veto API v1 backend; retained archives can be searched when capture is off.'));
  recall.appendTarget.appendChild(btn('Search transcripts', () => vscode.postMessage({ type: 'command', command: 'veto.searchTranscripts' }), true));
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
      if (dbSec.state !== 'ok' && dbSec.message) {
        lessons.appendTarget.appendChild(el('div', 'sub', dbSec.message));
      }
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

  // Council Section
  const cc = card('Council — verdict before code', 'council');
  const ccTarget = cc.appendTarget;
  if (s.council) {
    const c = s.council;
    ccTarget.appendChild(row('Verdict', (c.verdict || '—') + ' · ' + rel(c.debated_at)));
    if (c.task) ccTarget.appendChild(el('div', 'sub', String(c.task).slice(0, 90)));
    const votes = el('div', 'votes');
    for (const [key, label] of AGENTS) {
      const raw = c[key];
      const parsedVote = parseAgentVote(raw);
      if (parsedVote.state === 'none') continue;
      const chip = el('span', 'vote ' + parsedVote.state, parsedVote.icon + label);
      if (parsedVote.reason) {
        chip.title = parsedVote.reason;
      } else if (raw) {
        chip.title = String(raw);
      }
      votes.appendChild(chip);
    }
    ccTarget.appendChild(votes);
    if (c.recommended) ccTarget.appendChild(el('div', 'recommend', '→ ' + c.recommended));
  } else {
    ccTarget.appendChild(el('div', 'sub', 'No council verdict for this project.'));
  }
  const cact = el('div', 'actions');
  cact.appendChild(btn('Debate…', () => vscode.postMessage({ type: 'command', command: 'veto.councilDebate' })));
  cact.appendChild(btn('Review file', () => vscode.postMessage({ type: 'command', command: 'veto.reviewFile' }), true));
  cact.appendChild(btn('Review PR', () => vscode.postMessage({ type: 'command', command: 'veto.reviewPR' }), true));
  ccTarget.appendChild(cact);
  cards.appendChild(cc);

  // Router Section
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

  // Today Section
  if (s.rate && s.rate.some(r => r.token_count > 0)) {
    const ra = card('Today — token budget', 'today');
    const raTarget = ra.appendTarget;
    for (const r of s.rate) {
      if (!r.token_count) continue;
      const pct = Math.round((r.token_count / Math.max(1, r.daily_token_budget)) * 100);
      raTarget.appendChild(row(r.platform, bar(pct) + ' ' + pct + '%', true));
    }
    cards.appendChild(ra);
  }

  // Memory Section
  const mc = card('Memory', 'memory');
  const mcTarget = mc.appendTarget;
  mcTarget.appendChild(el('div', 'sub', (s.memory ? s.memory.totalCount : 0) + ' entries · ' + (s.memory && s.memory.scoped ? 'this project' : 'all projects')));
  
  const sb = el('div', 'search');
  const input = el('input');
  input.id = 'memSearchInput';
  input.placeholder = 'Search memory…';
  input.setAttribute('aria-label', 'Search Veto memory');
  input.value = currentSearchQuery;

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    currentSearchQuery = input.value;
    const reqId = ++searchRequestId;
    cachedSearchResults = null;
    searchTimer = setTimeout(() => {
      const q = currentSearchQuery.trim();
      if (q) {
        vscode.postMessage({ type: 'searchMemory', query: q, requestId: reqId });
      } else {
        cachedSearchResults = null;
        renderMemoryList(s.memory ? s.memory.entries : []);
      }
    }, 250);
  });
  sb.appendChild(input);
  mcTarget.appendChild(sb);

  const list = el('ul', 'list');
  list.id = 'memList';
  mcTarget.appendChild(list);
  cards.appendChild(mc);

  if (currentSearchQuery.trim() && cachedSearchResults) {
    renderMemoryList(cachedSearchResults);
  } else if (!currentSearchQuery.trim()) {
    renderMemoryList(s.memory ? s.memory.entries : []);
  }

  if (hadFocus) {
    requestAnimationFrame(() => {
      const liveInput = $('memSearchInput');
      if (liveInput) {
        liveInput.focus();
        try { liveInput.setSelectionRange(selStart, selEnd); } catch {}
      }
    });
  }

  // Health Section
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

function renderMemoryList(entries) {
  const list = $('memList');
  if (!list) return;
  list.textContent = '';
  if (!entries || !entries.length) {
    list.appendChild(el('div', 'empty', 'No matching memory entries.'));
    return;
  }
  for (const e of entries) {
    const li = el('li');
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');
    li.setAttribute('aria-label', 'Copy ' + (e.title || 'entry'));
    li.title = 'Click or press Enter to copy title: ' + (e.title || '');

    const titleSpan = el('span', 'mem-title', e.title);
    li.appendChild(titleSpan);

    const meta = el('span', 'meta');
    if (e.tags && Array.isArray(e.tags) && e.tags.length) {
      for (const t of e.tags.slice(0, 3)) {
        meta.appendChild(el('span', 'tag', t));
      }
    }
    const typeLabel = e.type || '';
    const projLabel = e.project_dir ? ' · ' + e.project_dir.split(/[\\/]/).pop() : ' · global';
    meta.appendChild(document.createTextNode(' ' + typeLabel + projLabel));
    li.appendChild(meta);

    const copyAction = () => vscode.postMessage({ type: 'copyId', id: e.title });
    li.addEventListener('click', copyAction);
    li.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        copyAction();
      }
    });
    list.appendChild(li);
  }
}

document.addEventListener('click', (ev) => {
  const t = ev.target;
  if (t && t.dataset && t.dataset.cmd) {
    vscode.postMessage({ type: 'command', command: t.dataset.cmd });
  }
});

window.addEventListener('message', (ev) => {
  const m = ev.data;
  if (!m || typeof m !== 'object') return;
  if (m.type === 'snapshot') {
    render(m.data);
  } else if (m.type === 'memoryResults') {
    if (m.requestId !== searchRequestId) {
      return; // Ignore stale out-of-order response
    }
    cachedSearchResults = m.results;
    renderMemoryList(m.results);
  }
});
