const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);

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
    header.appendChild(el('h3', null, title));
    const chevron = el('span', 'chevron', '▼');
    header.appendChild(chevron);
    c.appendChild(header);

    const body = el('div', 'card-body');
    c.appendChild(body);

    const storageKey = 'veto-collapse-' + id;
    const isCollapsed = localStorage.getItem(storageKey) === 'true';
    if (isCollapsed) {
      body.classList.add('collapsed');
      chevron.classList.add('collapsed');
    }

    header.addEventListener('click', () => {
      const collapsedNow = body.classList.toggle('collapsed');
      chevron.classList.toggle('collapsed', collapsedNow);
      localStorage.setItem(storageKey, collapsedNow ? 'true' : 'false');
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

function render(s) {
  const installed = !!s.installed;
  $('notInstalled').hidden = installed;
  const verdict = ((s.council && s.council.verdict) || '').toUpperCase();
  const badge = $('verdict');
  badge.textContent = installed ? (verdict || 'no verdict') : 'offline';
  badge.className = 'badge ' + (verdict === 'GREEN' ? 'green' : verdict === 'RED' ? 'red' : verdict === 'DEADLOCK' ? 'deadlock' : verdict === 'YELLOW' ? 'yellow' : '');
  $('stale').hidden = !s.stale;
  const cards = $('cards');
  cards.textContent = '';
  if (!installed) return;

  // Session Section
  const sc = card('Session', 'session');
  const scTarget = sc.appendTarget;
  if (s.session) {
    const ss = s.session;
    const idRow = row('ID', (ss.id || '').slice(0, 8) + '…', true);
    idRow.style.cursor = 'pointer';
    idRow.title = 'Copy session ID';
    idRow.addEventListener('click', () => vscode.postMessage({ type: 'copyId', id: ss.id }));
    scTarget.appendChild(idRow);
    scTarget.appendChild(row('Created by', ss.platform || '—'));
    scTarget.appendChild(row('Active in', ss.active_client || ss.platform || '—'));
    if (ss.started_at) scTarget.appendChild(row('Started', rel(ss.started_at)));
    const win = ({ claude: 200000, gemini: 1000000, codex: 128000 })[(ss.active_client || ss.platform || '').toLowerCase()] || 200000;
    const pct = Math.min(100, Math.round(((ss.token_count || 0) / win) * 100));
    scTarget.appendChild(row('Tokens', Math.round((ss.token_count || 0) / 1000) + 'K/' + Math.round(win / 1000) + 'K', true));
    scTarget.appendChild(row('', bar(pct) + ' ' + pct + '%', true));
    if (ss.summary) scTarget.appendChild(row('Summary', ss.summary.slice(0, 48)));
    const act = el('div', 'actions');
    act.appendChild(btn('Resume', () => vscode.postMessage({ type: 'resume', id: ss.id, platform: ss.active_client || ss.platform })));
    act.appendChild(btn('Save', () => vscode.postMessage({ type: 'command', command: 'veto.saveSession' }), true));
    scTarget.appendChild(act);
  } else {
    scTarget.appendChild(el('div', 'sub', 'No active session for this workspace.'));
  }
  cards.appendChild(sc);

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
  input.placeholder = 'Search memory…';
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const q = input.value.trim();
      if (q) vscode.postMessage({ type: 'searchMemory', query: q });
      else renderMemoryList(s.memory ? s.memory.entries : []);
    }, 250);
  });
  sb.appendChild(input);
  mcTarget.appendChild(sb);
  const list = el('ul', 'list');
  list.id = 'memList';
  mcTarget.appendChild(list);
  cards.appendChild(mc);
  renderMemoryList(s.memory ? s.memory.entries : []);

  // Health Section
  if (s.health) {
    const h = s.health;
    const hc = card('Health', 'health');
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
  for (const e of (entries || [])) {
    const li = el('li');
    li.appendChild(el('span', null, e.title));
    li.appendChild(el('span', 'meta', '  ' + (e.type || '') + (e.project_dir ? ' · ' + e.project_dir.split(/[\\/]/).pop() : '')));
    li.title = 'Copy title';
    li.addEventListener('click', () => vscode.postMessage({ type: 'copyId', id: e.title }));
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
  if (m.type === 'snapshot') {
    render(m.data);
  } else if (m.type === 'memoryResults') {
    renderMemoryList(m.results);
  }
});
