import { isAbsolute } from 'node:path';

/** How to launch the Veto CLI: `veto` from PATH, or `node <cliPath>` when configured. */
export function vetoInvocation(cliPath: string | undefined): { command: string; prefix: string[] } {
  const configured = (cliPath ?? '').trim();
  if (!configured) return { command: 'veto', prefix: [] };
  if (!isAbsolute(configured) || !/\.js$/i.test(configured)) {
    throw new Error('veto.cliPath must be an absolute path to Veto cli.js. Leave it empty to use Veto from PATH.');
  }
  return { command: 'node', prefix: [configured] };
}
