// Domain types read from the Veto SQLite DB, plus the aggregate VetoSnapshot
// that the whole UI renders from. One snapshot = one consistent view of Veto state.

export interface VetoSession {
  id: string;
  platform: string;
  active_client: string | null;
  last_resumed_at: string | null;
  connection_type: string;
  started_at: string;
  summary: string | null;
  project_dir: string | null;
  token_count: number;
}

export interface VetoSessionSummary {
  id: string;
  platform: string;
  active_client: string | null;
  started_at: string;
  summary: string | null;
  token_count: number;
  project_dir: string | null;
}

export interface VetoMemoryEntry {
  id: string;
  title: string;
  tags: string[];
  project_dir: string | null;
  type: string;
  created_at: string;
}

export interface VetoMemoryData {
  totalCount: number;
  entries: VetoMemoryEntry[];
  scoped: boolean;
}

export interface VetoCouncilOutcome {
  id: string;
  verdict: string;
  task: string | null;
  lead_dev: string | null;
  pm: string | null;
  architect: string | null;
  ux: string | null;
  devil: string | null;
  legal: string | null;
  security: string | null;
  recommended: string | null;
  debated_at: string;
}

export interface VetoPattern {
  pattern_key: string;
  pattern_val: string;
  confidence: number;
  seen_count: number;
  updated_at: string;
}

export interface VetoRateEntry {
  platform: string;
  request_count: number;
  token_count: number;
  daily_token_budget: number;
}

export interface VetoUsageSummary {
  totalSessions: number;
  totalTokens: number;
  byPlatform: Array<{ platform: string; tokens: number }>;
}

export interface VetoHealthStats {
  sessionCount: number;
  memoryCount: number;
  patternCount: number;
  learningCount: number;
  dbSizeMb: number;
}

export interface VetoLearningStats {
  totalOutcomes: number;
  avgQuality: number | null;
  tierBreakdown: { tier: number; count: number; avgQuality: number | null }[];
  topAgents: { agent: string; count: number; avgQuality: number | null }[];
}

export interface ScanDiagnosticRow {
  id: string;
  file_path: string;
  line: number;
  col_start: number;
  message: string;
  severity: string;
  source: string;
  created_at: string;
}

/** One consistent snapshot of Veto state — everything the UI needs in a single object. */
export interface VetoSnapshot {
  installed: boolean;            // Veto DB exists on disk
  session: VetoSession | null;   // session scoped to the active workspace
  sessions: VetoSessionSummary[];
  council: VetoCouncilOutcome | null;
  patterns: VetoPattern[];
  rate: VetoRateEntry[];
  usage: VetoUsageSummary | null;
  health: VetoHealthStats | null;
  learning: VetoLearningStats | null;
  memory: VetoMemoryData | null;
  diagnostics: ScanDiagnosticRow[];
  generatedAt: number;           // Date.now() when this snapshot was built
  stale: boolean;                // true if returned from last-good cache (DB was locked/unreadable)
}

/** The empty snapshot used before any data is read or when Veto is not installed. */
export function emptySnapshot(installed = false): VetoSnapshot {
  return {
    installed,
    session: null,
    sessions: [],
    council: null,
    patterns: [],
    rate: [],
    usage: null,
    health: null,
    learning: null,
    memory: null,
    diagnostics: [],
    generatedAt: Date.now(),
    stale: false,
  };
}

/** Highest token-budget usage across all platforms today, as a 0–100 percent (or null). */
export function maxRatePct(snap: VetoSnapshot): number | null {
  if (!snap.rate.length) return null;
  return Math.max(
    ...snap.rate.map(r => Math.round((r.token_count / Math.max(1, r.daily_token_budget)) * 100)),
  );
}

/** The strongest learned routing pattern, used to surface router confidence in the HUD. */
export function topPattern(snap: VetoSnapshot): VetoPattern | null {
  return snap.patterns[0] ?? null;
}
