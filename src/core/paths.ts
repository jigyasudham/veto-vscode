// DB path resolution, token-budget config, and model context windows.
// Kept UI-agnostic (no vscode import) so core/ stays testable in plain Node.

import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';

let dbPath = join(homedir(), '.veto', 'veto.db');

export function setDbPath(p: string): void {
  dbPath = p || join(homedir(), '.veto', 'veto.db');
}

export function getDbPath(): string {
  return dbPath;
}

/** Normalize a path for cross-platform comparison (backslash↔slash, trailing slash, drive-letter case). */
export function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
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
