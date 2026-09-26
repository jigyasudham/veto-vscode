// DB path resolution, token-budget config, and model context windows.
// Kept UI-agnostic (no vscode import) so core/ stays testable in plain Node.

import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';

let dbPath = join(homedir(), '.veto', 'veto.db');

export function isValidDbPath(p: string): boolean {
  if (!p) return true;
  try {
    const resolved = resolve(p);
    if (/[\x00-\x1f]/.test(resolved)) return false;
    return resolved.toLowerCase().endsWith('.db');
  } catch {
    return false;
  }
}

export function setDbPath(p: string): void {
  if (p && !isValidDbPath(p)) {
    dbPath = join(homedir(), '.veto', 'veto.db');
    return;
  }
  dbPath = p || join(homedir(), '.veto', 'veto.db');
}

export function getDbPath(): string {
  return dbPath;
}

/** Check if a path looks like a Windows path (drive letter, UNC, or backslashes on win32). */
export function isWindowsPath(p: string): boolean {
  if (!p) return false;
  return /^[a-zA-Z]:/.test(p) || /^(\\\\|\/\/)/.test(p) || (process.platform === 'win32' && !p.startsWith('/'));
}

/**
 * Normalize a path for cross-platform comparison:
 * - Backslashes converted to forward slashes
 * - Trailing slashes stripped (preserving root)
 * - On Windows (or Windows paths), folded to lowercase for case-insensitive matching
 * - On POSIX, case is strictly preserved
 */
export function normPath(p: string): string {
  if (!p) return '';
  const slashed = p.replace(/\\/g, '/').replace(/\/+$/, '');
  const clean = slashed === '' ? '/' : slashed;
  if (isWindowsPath(clean)) {
    return clean.toLowerCase();
  }
  return clean;
}

/** Test whether two paths point to the same directory or file under platform-specific rules. */
export function pathsEqual(p1: string | null | undefined, p2: string | null | undefined): boolean {
  if (!p1 && !p2) return true;
  if (!p1 || !p2) return false;
  return normPath(p1) === normPath(p2);
}

/**
 * Check if child is inside parent directory, with strict path boundary check.
 * (e.g. '/proj' does NOT match '/proj-other/file.ts').
 */
export function isSubpath(child: string, parent: string): boolean {
  if (!child || !parent) return false;
  const nChild = normPath(child);
  const nParent = normPath(parent);
  if (nChild === nParent) return true;
  const prefix = nParent.endsWith('/') ? nParent : `${nParent}/`;
  return nChild.startsWith(prefix);
}

/**
 * Generate a parameterized SQL WHERE snippet for matching project_dir safely
 * across Windows backslashes and case, and POSIX case-sensitive paths.
 */
export function sqlPathCondition(columnName: string, path: string): { sql: string; params: string[] } {
  const norm = normPath(path);
  if (isWindowsPath(path)) {
    return {
      sql: `LOWER(REPLACE(${columnName}, '\\', '/')) = ?`,
      params: [norm],
    };
  }
  return {
    sql: `REPLACE(${columnName}, '\\', '/') = ?`,
    params: [norm],
  };
}

// Daily token budgets per platform — overridable via ~/.veto/config.json.
const DEFAULT_BUDGETS: Record<string, number> = {
  claude:  500_000,
  gemini: 1_000_000,
  codex:   200_000,
};

export function readTokenBudgets(): Record<string, number> {
  try {
    const configPath = join(homedir(), '.veto', 'config.json');
    if (!existsSync(configPath)) return { ...DEFAULT_BUDGETS };
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as { dailyTokenBudget?: Record<string, number> };
    return {
      claude: raw.dailyTokenBudget?.claude ?? DEFAULT_BUDGETS.claude,
      gemini: raw.dailyTokenBudget?.gemini ?? DEFAULT_BUDGETS.gemini,
      codex:  raw.dailyTokenBudget?.codex  ?? DEFAULT_BUDGETS.codex,
    };
  } catch {
    return { ...DEFAULT_BUDGETS };
  }
}

export function budgetFor(platform: string, budgets: Record<string, number>): number {
  return budgets[platform] ?? DEFAULT_BUDGETS[platform] ?? 500_000;
}

// Context-window sizes used to render the session token gauge.
export const CONTEXT_WINDOWS: Record<string, number> = {
  claude: 200_000,
  gemini: 1_000_000,
  codex:  128_000,
};

export function contextWindowFor(client: string): number {
  return CONTEXT_WINDOWS[client.toLowerCase()] ?? 200_000;
}
