// Backend API adapter regressions found while re-verifying the 1.2.0 audit fixes live:
// overlapping read-only API calls must not reject each other, and a failure unrelated to
// the installed version must not be reported as "Veto 3.8.0 or later required".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeVscode, loadModule } from './helpers/harness';

const version = JSON.stringify({ contract: 1, command: 'version', backend_version: '3.8.0', generated_at: '2026-09-28T00:00:00Z', state: 'ok',
  data: { contract: 1, commands: ['version', 'recall search'], request_via: ['stdin'] } });
const search = JSON.stringify({ contract: 1, command: 'recall search', backend_version: '3.8.0', generated_at: '2026-09-28T00:00:00Z', state: 'ok',
  data: { capture: 'enabled', disclaimer: 'masked', hits: [] } });

function setup(spawn: (args: string[], opts: any) => Promise<string>) {
  const vs = fakeVscode();
  const running = new Set<string>();
  const mod = loadModule('src/commands/backend.ts', {
    vscode: vs.api,
    './process': {
      // Mirrors spawnProcess job-key deduplication.
      spawnProcess: async (_cmd: string, args: string[], _log: unknown, opts: any) => {
        const key = opts.jobKey;
        if (running.has(key)) throw new Error(`Operation "${key}" is already running.`);
        running.add(key);
        try { await new Promise(r => setTimeout(r, 20)); return await spawn(args, opts); } finally { running.delete(key); }
      },
    },
  });
  return mod.registerBackendCommands({ subscriptions: [] }, {
    getProjectDir: () => 'D:/fixture', getDbPath: () => 'D:/fixture/veto.db', showSnapshot() {},
  });
}

test('overlapping API calls for the same project both complete', async () => {
  const api = setup(async args => (args.includes('version') ? version : search));
  const [a, b] = await Promise.all([
    api.callApi('recall search', { project: 'D:/fixture', query: 'a', limit: 20 }, 'D:/fixture'),
    api.callApi('recall search', { project: 'D:/fixture', query: 'b', limit: 20 }, 'D:/fixture'),
  ]);
  assert.equal(a.state, 'ok');
  assert.equal(b.state, 'ok');
});

test('a missing CLI still reports the install requirement; other failures keep their message', async () => {
  const missing = setup(async () => { throw new Error('spawn veto ENOENT'); });
  await assert.rejects(missing.callApi('recall search', { project: 'D:/fixture', query: 'a' }, 'D:/fixture'), /3\.8\.0 or later required/);
  const timedOut = setup(async () => { throw new Error('Operation timed out after 60s'); });
  await assert.rejects(timedOut.callApi('recall search', { project: 'D:/fixture', query: 'a' }, 'D:/fixture'), /timed out/);
});
