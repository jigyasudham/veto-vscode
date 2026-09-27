import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseApiEnvelope, requireCompatibleBackend, type ApiCommand } from '../src/core/backend';
const fixture = (name: string) => readFileSync(`test/fixtures/api-v1/${name}.json`, 'utf8');

test('backend handshake rejects old/prerelease backends, wrong contract, and missing commands', () => {
  const value = { contract: 1 as const, command: 'version' as const, backend_version: '3.8.0', generated_at: new Date().toISOString(), state: 'ok', data: { contract: 1, commands: ['snapshot'], request_via: ['stdin'] } };
  requireCompatibleBackend(value, 'snapshot');
  for (const version of ['3.7.9', '2.99.0', '3.8.0-rc.1', 'unknown']) {
    assert.throws(() => requireCompatibleBackend({ ...value, backend_version: version }, 'snapshot'), /3.8.0 or later/);
  }
  assert.throws(() => requireCompatibleBackend(value, 'recall search'), /3.8.0 or later/);
  assert.throws(() => requireCompatibleBackend({ ...value, data: { ...value.data, contract: 2 } }, 'snapshot'), /3.8.0 or later/);
  assert.throws(() => requireCompatibleBackend({ ...value, data: { commands: ['snapshot'], request_via: ['stdin'] } as any }, 'snapshot'), /3.8.0 or later/);
  requireCompatibleBackend({ ...value, backend_version: '3.9.0' }, 'snapshot');
});

test('published backend fixtures validate and preserve masking/provenance', () => {
  const versionEnv = parseApiEnvelope(fixture('version.ok'), 'version');
  assert.equal(versionEnv.state, 'ok');
  assert.equal(versionEnv.backend_version, '3.8.0');
  assert.equal(versionEnv.data?.contract, 1);
  requireCompatibleBackend(versionEnv, 'snapshot');

  const snapshot = parseApiEnvelope(fixture('snapshot.ok'), 'snapshot', 'D:/Api Codex');
  assert.equal(snapshot.data?.trial.state, 'unavailable');
  for (const [name, command] of [['recall-search.ok','recall search'],['recall-expand.ok','recall expand']] as const) {
    const result = parseApiEnvelope(fixture(name), command);
    assert.equal(result.state, 'ok');
    assert.ok(result.data?.disclaimer);
  }
  assert.equal(parseApiEnvelope(fixture('snapshot.db_mismatch'), 'snapshot').state, 'db_mismatch');
  assert.equal(parseApiEnvelope(fixture('recall-expand.not_found'), 'recall expand').state, 'not_found');
  assert.equal(parseApiEnvelope(fixture('recall-search.no_archive'), 'recall search').state, 'no_archive');
});

test('unrecognized states are treated as errors with message and next_action', () => {
  const custom = {
    contract: 1,
    command: 'snapshot',
    backend_version: '3.8.0',
    generated_at: new Date().toISOString(),
    state: 'future_unrecognized_state',
    message: 'Something new happened',
    next_action: 'Upgrade extension',
  };
  const parsed = parseApiEnvelope(JSON.stringify(custom), 'snapshot', 'D:/Api Codex');
  assert.equal(parsed.state, 'error');
  assert.equal(parsed.message, 'Something new happened');
  assert.equal(parsed.next_action, 'Upgrade extension');
});

test('API rejects wrong contract, command, scope, malformed trial and excessive recall', () => {
  assert.throws(() => parseApiEnvelope('old CLI usage text','version'), /3.8.0 or later required/);
  assert.throws(() => parseApiEnvelope('Unknown command: api','version'), /3.8.0 or later required/);
  const snap = JSON.parse(fixture('snapshot.ok'));
  assert.throws(() => parseApiEnvelope(JSON.stringify(snap),'snapshot','D:/Other'));
  for (const change of [(v:any) => v.contract=2, (v:any) => v.command='diagnostics', (v:any) => v.data.trial={state:'ok',mode:'delivery',qualifying:0,target:20,complete:false,drift:false}]) {
    const value = structuredClone(snap); change(value);
    assert.throws(() => parseApiEnvelope(JSON.stringify(value),'snapshot','D:/Api Codex'));
  }
  const recall = JSON.parse(fixture('recall-search.ok'));
  recall.data.hits = Array(21).fill(recall.data.hits[0]);
  assert.throws(() => parseApiEnvelope(JSON.stringify(recall),'recall search'));
});
