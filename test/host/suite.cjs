const assert = require('node:assert/strict');
const fs = require('node:fs');
const vscode = require('vscode');

exports.run = async function () {
  const extension = vscode.extensions.getExtension('jigyasudham.veto-vscode');
  assert.ok(extension, 'packaged Veto extension discovered');
  assert.equal(vscode.workspace.getConfiguration('veto').get('dbPath'), process.env.VETO_SMOKE_DB,
    'isolated DB configured before activation; never access the user database');
  const restricted = process.env.VETO_SMOKE_TRUST === 'restricted';
  assert.equal(vscode.workspace.isTrusted, !restricted, 'workspace trust matches test scenario');
  // Loading node:sqlite here asserts runtime compatibility inside Electron, rather
  // than mistakenly checking the developer/CI machine Node installation.
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(process.env.VETO_SMOKE_DB);
  db.exec('CREATE TABLE smoke_fixture (value TEXT); INSERT INTO smoke_fixture VALUES (\'synthetic\')');
  db.close();
  const before = fs.readFileSync(process.env.VETO_SMOKE_DB);
  await extension.activate();
  assert.equal(extension.isActive, true);
  const registered = new Set(await vscode.commands.getCommands(true));
  for (const contribution of extension.packageJSON.contributes.commands) {
    assert.ok(registered.has(contribution.command), `command registered: ${contribution.command}`);
  }
  await vscode.commands.executeCommand('veto.refresh');
  await vscode.commands.executeCommand('veto.setupDiagnostics');
  const report = vscode.window.activeTextEditor?.document.getText();
  assert.ok(report?.includes('Veto setup and data provenance'), 'diagnostics document opened');
  assert.ok(report.includes(`Workspace trust: ${restricted ? 'Restricted' : 'Trusted'}`));
  assert.ok(report.includes('Database: Readable (read-only)'), report);
  assert.ok(!report.includes('Runtime unavailable'), report);
  await vscode.commands.executeCommand('veto.openHud');
  if (restricted) {
    const terminals = vscode.window.terminals.length;
    for (const command of ['veto.reviewFile','veto.saveSession','veto.councilDebate','veto.continueSession','veto.backendVisibility','veto.searchTranscripts','veto.draftCommitMessage']) {
      await vscode.commands.executeCommand(command);
    }
    assert.equal(vscode.window.terminals.length, terminals, 'restricted actions cannot launch a terminal');
  }
  assert.deepEqual(fs.readFileSync(process.env.VETO_SMOKE_DB), before, 'extension never mutates fixture DB');
  await vscode.workspace.getConfiguration('veto').update('dbPath', `${process.env.VETO_SMOKE_DB}.missing.db`, vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('veto.refresh');
  await vscode.commands.executeCommand('veto.setupDiagnostics');
  assert.ok(vscode.window.activeTextEditor?.document.getText().includes('Database: Database not found'),
    'missing database has an actionable state and does not crash the host');
  assert.equal(fs.existsSync(`${process.env.VETO_SMOKE_DB}.missing.db`), false, 'missing DB is never created');
  console.log(`PASS packaged host smoke: VS Code ${vscode.version}; Node ${process.versions.node}; trust=${vscode.workspace.isTrusted}`);
};
