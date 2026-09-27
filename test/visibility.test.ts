import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { emptySnapshot } from '../src/core/snapshot';
import { visibilityReport } from '../src/core/visibility';

const env = { extensionVersion: '1.0.1', runtimeVersion: '22.13.0', trusted: false };

test('setup distinguishes missing database, unsupported runtime, stale reads and unknown server state', () => {
  const snap = emptySnapshot();
  assert.match(visibilityReport(snap, env), /Database: Database not found/);
  snap.compatibilityWarning = 'SQLite unavailable';
  assert.match(visibilityReport(snap, env), /Database: Runtime unavailable/);
  snap.installed = true;
  snap.stale = true;
  snap.staleReason = 'Database locked';
  snap.lastSuccessfulRead = Date.UTC(2026, 8, 26);
  const report = visibilityReport(snap, { ...env, remoteName: 'ssh-remote', projectDir: '/project' });
  assert.match(report, /Database: Read failed/);
  assert.match(report, /2026-09-26T00:00:00.000Z/);
  assert.match(report, /Read failure: Database locked/);
  assert.match(report, /Remote extension host \(ssh-remote\)/);
  assert.match(report, /Selected project: \/project/);
  assert.match(report, /Workspace trust: Restricted/);
  assert.match(report, /Server version: Unknown/);
  assert.match(report, /Consent and trial progress: Unknown/);
});

// A small DOM fixture runs the actual renderer without an extension host.
class Element {
  children: Element[] = [];
  textContent = '';
  id = '';
  value = '';
  style = {};
  dataset = {};
  classList = { add() {}, toggle() { return false; } };
  listeners: Record<string, Function> = {};
  appendChild(child: Element) { this.children.push(child); return child; }
  setAttribute() {}
  addEventListener(name: string, listener: Function) { this.listeners[name] = listener; }
}

function renderFixture(installed: boolean) {
  const roots = new Map(['notInstalled', 'verdict', 'stale', 'cards'].map(id => [id, new Element()]));
  const messages: unknown[] = [];
  const flatten = (node: Element): Element[] => [node, ...node.children.flatMap(flatten)];
  const all = () => [...roots.values()].flatMap(flatten);
  const script = readFileSync(join(process.cwd(), 'src/ui/assets/hud.js'), 'utf8');
  const snapshot = emptySnapshot(installed);
  runInNewContext(script + '\nrender(snapshot);', {
    snapshot,
    acquireVsCodeApi: () => ({ getState: () => ({}), setState() {}, postMessage: (m: unknown) => messages.push(m) }),
    document: {
      activeElement: {},
      getElementById: (id: string) => roots.get(id) ?? all().find(n => n.id === id),
      createElement: () => new Element(),
      createTextNode: (text: string) => Object.assign(new Element(), { textContent: text }),
      addEventListener() {},
    },
    window: { addEventListener() {} },
  });
  return { all: all(), messages };
}

test('setup stays usable without a database and passive rendering emits no commands', () => {
  for (const installed of [false, true]) {
    const { all, messages } = renderFixture(installed);
    assert.equal(messages.length, 0);
    const button = all.find(n => n.textContent === 'Setup details');
    assert.ok(button);
    button.listeners.click();
    assert.equal(JSON.stringify(messages), '[{"type":"command","command":"veto.setupDiagnostics"}]');
    if (installed) {
      assert.ok(all.some(n => n.textContent === 'Consent / progress'));
      assert.ok(all.some(n => n.textContent.includes('shadow-only')));
    }
  }
});
