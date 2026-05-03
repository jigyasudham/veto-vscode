export interface VetoSession {
  id: string;
  platform: string;
  active_client: string | null;
  last_resumed_at: string | null;
  started_at: string;
  summary: string | null;
  project_dir: string | null;
  token_count: number;
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
  date_key: string;
  request_count: number;
  updated_at: string;
}

export type CouncilNode =
  | { kind: 'verdict';     data: VetoCouncilOutcome }
  | { kind: 'agent';       name: string; raw: string | null }
  | { kind: 'recommended'; text: string }
  | { kind: 'debated';     iso: string }
  | { kind: 'empty' };
