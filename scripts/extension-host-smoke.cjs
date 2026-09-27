// Runs the actual packaged extension with an isolated profile and synthetic data.
// VSCODE_EXECUTABLE_PATH can select an installed host; otherwise downloads the
// declared minimum (VSCODE_VERSION=minimum) or current stable host.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');
const root = path.resolve(__dirname, '..');
const manifest = require('../package.json');

async function main() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'veto-host-'));
  const profile = path.join(fixtureRoot, 'profile');
  const workspace = path.join(fixtureRoot, 'workspace');
  const unpacked = path.join(fixtureRoot, 'package');
  const dbPath = path.join(fixtureRoot, 'fixture.db');
  fs.mkdirSync(path.join(profile, 'User'), { recursive: true });
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'example.txt'), 'Synthetic Veto smoke fixture.\n');
  const restricted = process.env.VETO_SMOKE_TRUST === 'restricted';
  fs.writeFileSync(path.join(profile, 'User', 'settings.json'), JSON.stringify({
    'veto.dbPath': dbPath,
    'security.workspace.trust.enabled': restricted,
    'security.workspace.trust.startupPrompt': 'never',
    'security.workspace.trust.emptyWindow': false,
    'workbench.startupEditor': 'none',
    'update.mode': 'none',
    'extensions.autoUpdate': false,
  }));
  const vsix = path.join(root, `${manifest.name}-${manifest.version}.vsix`);
  if (!fs.existsSync(vsix)) throw new Error('Run npm run package before test:host.');
  let extraction;
  if (process.platform === 'win32') {
    const zip = path.join(fixtureRoot, 'extension.zip');
    fs.copyFileSync(vsix, zip);
    extraction = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Expand-Archive -LiteralPath $env:VETO_SMOKE_ZIP -DestinationPath $env:VETO_SMOKE_UNPACK'], {
      env: { ...process.env, VETO_SMOKE_ZIP: zip, VETO_SMOKE_UNPACK: unpacked }, stdio: 'inherit', windowsHide: true,
    });
  } else {
    extraction = spawnSync('unzip', ['-q', vsix, '-d', unpacked], { stdio: 'inherit' });
  }
  if (extraction.error || extraction.status !== 0) throw extraction.error ?? new Error('VSIX extraction failed');
  const version = process.env.VSCODE_VERSION === 'minimum'
    ? manifest.engines.vscode.replace(/^\^/, '') : (process.env.VSCODE_VERSION || 'stable');
  // Deliberately retain failed fixture/profile directories for diagnosis. Successful
  // runs are cleaned only after checking the generated directory stays in tmpdir.
  console.log(`Host smoke: ${version}, trust=${restricted ? 'restricted' : 'trusted'}, fixture=${fixtureRoot}`);
  // test-electron.runTests unconditionally adds --disable-workspace-trust.
  // Use its supported downloader, then launch the real host without that flag.
  const executable = process.env.VSCODE_EXECUTABLE_PATH || await downloadAndUnzipVSCode({ version });
  await new Promise((resolve, reject) => {
    const child = spawn(executable, [workspace, '--user-data-dir', profile, '--extensions-dir', path.join(fixtureRoot, 'extensions'),
      '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--disable-gpu', '--disable-updates',
      `--extensionDevelopmentPath=${path.join(unpacked, 'extension')}`,
      `--extensionTestsPath=${path.join(root, 'test', 'host', 'suite.cjs')}`,
    ], { shell: false, windowsHide: true, stdio: 'inherit', env: {
      ...process.env, VETO_SMOKE_DB: dbPath, VETO_SMOKE_WORKSPACE: workspace,
      VETO_SMOKE_TRUST: restricted ? 'restricted' : 'trusted',
    }});
    const timer = setTimeout(() => { child.kill(); reject(new Error('Extension host smoke timed out')); }, 120000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Extension host exited ${code}`)); });
  });
  if (path.dirname(fixtureRoot) !== path.resolve(os.tmpdir()) || !path.basename(fixtureRoot).startsWith('veto-host-')) {
    throw new Error('Refusing cleanup outside the generated temporary fixture');
  }
  fs.rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
