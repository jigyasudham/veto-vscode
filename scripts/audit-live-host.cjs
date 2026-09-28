// Isolated VS Code host controller for the 1.2.0 visual/authenticated audit.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veto-live-audit-'));
const workspace = path.join(dir, 'workspace');
fs.mkdirSync(workspace);
fs.mkdirSync(path.join(dir, 'profile', 'User'), { recursive: true });
fs.writeFileSync(path.join(workspace, 'example.js'), 'export function divide(a, b) { return a / b; }\n');
fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'veto-audit-fixture', version: '1.0.0', private: true }));
for (const args of [['init', '-b', 'main'], ['add', '.'], ['-c', 'user.name=Veto Audit', '-c', 'user.email=audit@example.invalid', 'commit', '-m', 'Synthetic audit baseline']]) {
  const r = spawnSync('git', args, { cwd: workspace, windowsHide: true });
  if (r.status) throw new Error('Fixture git setup failed');
}
fs.writeFileSync(path.join(workspace, 'example.js'), 'export function divide(a, b) {\n  if (b === 0) throw new Error("Cannot divide by zero");\n  return a / b;\n}\n');
fs.writeFileSync(path.join(dir, 'profile', 'User', 'settings.json'), JSON.stringify({
  'veto.dbPath': path.join(dir, 'fixture.db'), 'security.workspace.trust.enabled': false,
  'workbench.startupEditor': 'none', 'update.mode': 'none', 'extensions.autoUpdate': false,
  'workbench.colorTheme': 'Default Dark Modern', 'window.zoomLevel': 0,
}));
const zip = path.join(dir, 'extension.zip');
fs.copyFileSync(path.join(root, 'veto-vscode-1.2.0.vsix'), zip);
const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $env:VETO_AUDIT_ZIP -DestinationPath $env:VETO_AUDIT_UNPACK'], {
  windowsHide: true, env: { ...process.env, VETO_AUDIT_ZIP: zip, VETO_AUDIT_UNPACK: path.join(dir, 'package') },
});
if (r.status) throw new Error('Unpack failed');
const log = fs.openSync(path.join(dir, 'host.log'), 'a');
const child = spawn(path.join(root, '.vscode-test', 'vscode-win32-x64-archive-1.139.1', 'Code.exe'), [
  workspace, '--user-data-dir', path.join(dir, 'profile'), '--extensions-dir', path.join(dir, 'extensions'),
  '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-updates', '--disable-gpu',
  '--remote-debugging-port=9337', '--remote-debugging-address=127.0.0.1',
  '--extensionDevelopmentPath=' + path.join(dir, 'package', 'extension'),
  '--extensionTestsPath=' + path.join(root, 'scripts', 'audit-live-suite.cjs'),
], { windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, VETO_AUDIT_DIR: dir } });
fs.mkdirSync(path.join(root, 'docs', 'audit-evidence'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'audit-evidence', 'live-host.json'), JSON.stringify({ dir, workspace, pid: child.pid, port: 9337 }, null, 2));
console.log(JSON.stringify({ dir, workspace, pid: child.pid, port: 9337 }));
child.on('exit', code => { fs.closeSync(log); console.log('Audit host exited:', code); });
