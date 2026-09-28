const fs = require('node:fs');
const { connect, hostCommand, sleep } = require('./audit-cdp.cjs');
const scenarios = process.argv.slice(2);
const config = {
  checkpoint: { button: 'btnSaveCheckpoint', fill: ['wfCheckpointSummary', 'SYNTHETIC VETO EXTENSION AUDIT 2026-09-28: verify authenticated checkpoint end to end; disposable test project.'] },
  review: { button: 'btnReviewActiveFile', openFile: true },
  scan: { button: 'btnScanSecrets', openFile: true, setup: "document.querySelector('input[name=secretsScope][value=active]').checked=true" },
  debate: { button: 'btnStartDebate', fill: ['wfDebatePrompt', 'SYNTHETIC AUDIT ONLY: Assess adding an explicit division-by-zero error to a tiny JavaScript divide(a,b) utility in this disposable fixture. No deployment or external actions. Complete the normal council protocol.'] },
  commit: { button: 'btnDraftCommit' },
  prdraft: { button: 'btnDraftPr', fill: ['wfPrBaseBranch', 'main'] },
  prreview: { button: 'btnReviewPr', fill: ['wfPrUrl', process.env.VETO_AUDIT_PR_URL || 'https://github.com/jigyasudham/veto-vscode/pull/1'] },
  diagnostics: { button: 'btnRunDiagnostics', tab: 'settings' },
};
(async () => {
  const c = await connect();
  try {
    for (const name of scenarios) {
      const s = config[name]; if (!s) throw new Error('Unknown scenario');
      if (s.openFile) { await hostCommand({ type: 'openFile' }); await sleep(300); }
      await c.eval(`switchTab(${JSON.stringify(s.tab || 'workflows')});document.getElementById('workflowResultCard').classList.add('hidden')`);
      if (s.fill) await c.eval(`document.getElementById(${JSON.stringify(s.fill[0])}).value=${JSON.stringify(s.fill[1])}`);
      if (s.setup) await c.eval(s.setup);
      const start = Date.now();
      await c.eval(`document.getElementById(${JSON.stringify(s.button)}).click()`);
      console.log('Started authenticated HUD scenario:', name);
      let result;
      for (let i = 0; i < 155; i++) {
        await sleep(1000);
        const state = await c.eval(`({running:!document.getElementById('activeProgressCard').classList.contains('hidden'),visible:!document.getElementById('workflowResultCard').classList.contains('hidden'),action:document.getElementById('resultActionName').textContent,verdict:document.getElementById('resultVerdict').textContent,body:document.getElementById('resultBody').textContent,console:document.getElementById('consoleViewport').innerText})`);
        if (!state.running && state.visible) { result = state; break; }
      }
      const workbench = await c.main.eval("Array.from(document.querySelectorAll('.notification-list-item')).map(e=>e.innerText)");
      const record = { scenario: name, elapsedMs: Date.now() - start, result: result || { timeout: true }, notifications: workbench };
      const filename = 'docs/audit-evidence/auth-' + name + (process.env.VETO_AUDIT_SUFFIX || '') + '.json';
      fs.writeFileSync(filename, JSON.stringify(record, null, 2));
      console.log(JSON.stringify({ scenario: name, elapsedMs: record.elapsedMs, verdict: result?.verdict, bodyPreview: result?.body?.slice(0,350), notifications: workbench }));
    }
  } finally { c.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
