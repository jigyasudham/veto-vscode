// Safe runtime loader for node:sqlite.
// Protects the extension from crashing at module evaluation time when run on
// older VS Code / Electron runtimes that lack node:sqlite support (Node < 22.13).

import type { DatabaseSync } from 'node:sqlite';

let sqliteResolved: typeof import('node:sqlite') | null = null;
let resolved = false;

export function loadSqlite(): typeof import('node:sqlite') | null {
  if (resolved) return sqliteResolved;
  resolved = true;
  try {
    // Dynamic require so esbuild does not fail module loading if node:sqlite is absent
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('node:sqlite') as typeof import('node:sqlite');
    if (mod && typeof mod.DatabaseSync === 'function') {
      sqliteResolved = mod;
    }
  } catch {
    sqliteResolved = null;
  }
  return sqliteResolved;
}

export function isSqliteSupported(): boolean {
  return loadSqlite() !== null;
}

export type { DatabaseSync };
