import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectedProject } from '../src/core/projects';
import { parseCatalog } from '../src/core/catalog';

test('project selection pins a folder, follows focus, and drops removed folders', () => {
  const folders = ['C:\\One', 'C:\\Two'];
  assert.equal(selectedProject(folders, 'c:/two', 'C:\\One'), 'C:\\Two');
  assert.equal(selectedProject(folders, undefined, 'C:\\Two'), 'C:\\Two');
  assert.equal(selectedProject(folders, 'C:\\Removed', 'C:\\Two'), 'C:\\Two');
  assert.equal(selectedProject([], 'C:\\Two'), undefined);
  assert.equal(selectedProject(['/app', '/App'], '/App'), '/App');
});

test('catalog validates supported shapes and rejects malformed or oversized metadata', () => {
  assert.deepEqual(parseCatalog(JSON.stringify({tools: [{name:'veto_status',description:'Status'}]}), 'tools'), [{name:'veto_status',description:'Status',category:'Tool'}]);
  assert.equal(parseCatalog(JSON.stringify({worker_agents:{agents:[{id:'coder',role:'Writes code'}]},council_agents:{agents:[]}}),'agents').length,1);
  for (const payload of ['{}', '{"tools":[null]}', '{"tools":[{"name":"../../bad","description":"x"}]}']) {
    assert.throws(() => parseCatalog(payload, 'tools'));
  }
});
