const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');
exports.run = async () => {
  const dir = process.env.VETO_AUDIT_DIR;
  const workspace = path.join(dir, 'workspace');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(dir, 'fixture.db'));
  db.exec(`CREATE TABLE sessions (id TEXT, started_at TEXT, platform TEXT, project_dir TEXT, summary TEXT, token_count INTEGER, created_at TEXT, active_client TEXT, last_resumed_at TEXT, connection_type TEXT);
    CREATE TABLE knowledge_base (id TEXT, type TEXT, title TEXT, content TEXT, tags TEXT, project_dir TEXT, created_at TEXT);
    CREATE TABLE council_outcomes (id TEXT, session_id TEXT, task TEXT, verdict TEXT, lead_dev TEXT, pm TEXT, architect TEXT, ux TEXT, devil TEXT, recommended TEXT, debated_at TEXT, legal TEXT, security TEXT);`);
  const now = new Date().toISOString();
  for (let i = 0; i < 35; i++) db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    'audit-session-' + i, now, 'codex', workspace,
    'Synthetic UI audit session ' + i + ' — long summary for wrapping, keyboard navigation and sidebar layout checks.',
    16000, now, 'codex', null, 'subscription');
  db.prepare('INSERT INTO knowledge_base VALUES (?,?,?,?,?,?,?)').run('audit-memory', 'note', 'Synthetic readable detail and long text',
    'This is synthetic audit content. '.repeat(80), '["audit","layout"]', workspace, now);
  db.prepare('INSERT INTO council_outcomes (id,session_id,task,verdict,recommended,debated_at) VALUES (?,?,?,?,?,?)').run(
    'audit-council', 'audit-session-0', 'Synthetic yellow warning for theme contrast testing', 'YELLOW', 'Verify the rendered HUD before release.', now);
  db.close();
  const extension = vscode.extensions.getExtension('jigyasudham.veto-vscode');
  await extension.activate();
  await vscode.commands.executeCommand('veto.openHud');
  fs.writeFileSync(path.join(dir, 'ready.json'), JSON.stringify({ version: vscode.version, node: process.versions.node }));
  const input = path.join(dir, 'command.json'), output = path.join(dir, 'response.json');
  let previous;
  while (!fs.existsSync(path.join(dir, 'stop'))) {
    if (fs.existsSync(input)) {
      try {
        const c = JSON.parse(fs.readFileSync(input, 'utf8'));
        if (c.id !== previous) {
          previous = c.id;
          let result;
          if (c.type === 'theme') result = await vscode.workspace.getConfiguration('workbench').update('colorTheme', c.value, vscode.ConfigurationTarget.Global);
          if (c.type === 'zoom') result = await vscode.workspace.getConfiguration('window').update('zoomLevel', c.value, vscode.ConfigurationTarget.Global);
          if (c.type === 'setting') result = await vscode.workspace.getConfiguration('veto').update(c.key, c.value, vscode.ConfigurationTarget.Global);
          if (c.type === 'openFile') result = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(path.join(workspace, 'example.js')));
          if (c.type === 'command') result = await vscode.commands.executeCommand(c.command, ...(c.args || []));
          fs.writeFileSync(output, JSON.stringify({ id: c.id, ok: true }));
        }
      } catch (error) { fs.writeFileSync(output, JSON.stringify({ id: previous, error: String(error) })); }
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
};
