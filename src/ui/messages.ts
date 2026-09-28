// Webview message contracts and runtime validation (F08).
// Decoupled from VS Code APIs to allow full unit testability under Node.js test runner.

export type HudMessage =
  | { type: 'resume'; id: string; platform: string; target?: 'terminal' | 'console' }
  | { type: 'copyId'; id: string }
  | { type: 'searchMemory'; query: string; requestId?: number }
  | { type: 'command'; command: string }
  | { type: 'getSettings' }
  | { type: 'saveSettings'; settings: { cliPath?: string; dbPath?: string; pollInterval?: number; actionTimeoutMs?: number } }
  | { type: 'getProjects' }
  | { type: 'selectProject'; projectDir?: string }
  | {
      type: 'queryExplorer';
      kind: 'sessions' | 'memory' | 'council' | 'decisions' | 'constraints' | 'reviews' | 'learning' | 'tools' | 'agents' | 'transcripts';
      scope?: 'project' | 'all';
      search?: string;
      offset?: number;
      source?: string;
      requestId?: number;
    }
  | { type: 'getMemoryDetail'; id: string; scope?: 'project' | 'all'; requestId?: number }
  | { type: 'expandTranscript'; eventId: string; requestId?: number }
  | {
      type: 'runAction';
      action: 'debate' | 'saveCheckpoint' | 'reviewFile' | 'reviewPR' | 'scanSecrets' | 'draftCommit' | 'draftPR' | 'backendDiagnostics' | 'setupDiagnostics';
      params?: Record<string, unknown>;
      requestId?: number;
    }
  | { type: 'cancelAction' }
  | { type: 'clearLog' };

export interface MemoryResult {
  title: string;
  type: string;
  project_dir: string | null;
}

export interface SettingsPayload {
  cliPath: string;
  dbPath: string;
  pollInterval: number;
  actionTimeoutMs: number;
  isCustomDb: boolean;
  defaultDbPath: string;
  nodeVersion: string;
  isSqliteSupported: boolean;
  isTrusted: boolean;
}

export interface ProjectItem {
  name: string;
  path?: string;
  isPinned: boolean;
  isActive: boolean;
}

export interface LogEntry {
  id: number;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  text: string;
}

export interface ActionStatusMessage {
  action: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  verdict?: string;
  message?: string;
  result?: unknown;
  requestId?: number;
}

export interface ExplorerResponse {
  kind: string;
  items: unknown[];
  hasMore?: boolean;
  total?: number;
  offset?: number;
  requestId?: number;
  error?: string;
}

export interface ExplorerDetailResponse {
  kind: string;
  id: string;
  detail: unknown;
  requestId?: number;
  error?: string;
}

export const ALLOWED_HUD_COMMANDS = new Set([
  'veto.backendVisibility',
  'veto.backendDiagnostics',
  'veto.searchTranscripts',
  'veto.selectProject',
  'veto.browseSessions',
  'veto.browseMemory',
  'veto.councilHistory',
  'veto.decisionHistory',
  'veto.decisionConstraints',
  'veto.reviewDetails',
  'veto.learningDetails',
  'veto.browseTools',
  'veto.browseAgents',
  'veto.draftCommitMessage',
  'veto.draftPrDescription',
  'veto.setupDiagnostics',
  'veto.saveSession',
  'veto.councilDebate',
  'veto.reviewFile',
  'veto.reviewPR',
  'veto.scanSecrets',
  'veto.searchMemory',
  'veto.refresh',
  'veto.openLog',
  'veto.openInstallDocs',
  'veto.openHud',
  'veto.openTerminal',
]);

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const ALLOWED_EXPLORER_KINDS = new Set([
  'sessions', 'memory', 'council', 'decisions', 'constraints', 'reviews', 'learning', 'tools', 'agents', 'transcripts'
]);
const ALLOWED_ACTIONS = new Set([
  'debate', 'saveCheckpoint', 'reviewFile', 'reviewPR', 'scanSecrets', 'draftCommit', 'draftPR', 'backendDiagnostics', 'setupDiagnostics'
]);

export function validateHudMessage(raw: unknown): HudMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const msg = raw as Record<string, unknown>;
  if (typeof msg.type !== 'string') return null;

  switch (msg.type) {
    case 'resume': {
      if (typeof msg.id !== 'string' || !SAFE_ID.test(msg.id) || msg.id.length > 128) return null;
      const platform = typeof msg.platform === 'string' ? msg.platform.slice(0, 32) : 'claude';
      const target = msg.target === 'console' || msg.target === 'terminal' ? msg.target : undefined;
      return { type: 'resume', id: msg.id, platform, ...(target ? { target } : {}) };
    }
    case 'copyId': {
      if (typeof msg.id !== 'string' || msg.id.length > 512) return null;
      return { type: 'copyId', id: msg.id };
    }
    case 'command': {
      if (typeof msg.command !== 'string' || !ALLOWED_HUD_COMMANDS.has(msg.command)) return null;
      return { type: 'command', command: msg.command };
    }
    case 'searchMemory': {
      if (typeof msg.query !== 'string') return null;
      const requestId = typeof msg.requestId === 'number' && Number.isSafeInteger(msg.requestId) && msg.requestId >= 0 ? msg.requestId : undefined;
      return { type: 'searchMemory', query: msg.query.slice(0, 256), requestId };
    }
    case 'getSettings': {
      return { type: 'getSettings' };
    }
    case 'saveSettings': {
      if (!msg.settings || typeof msg.settings !== 'object') return null;
      const s = msg.settings as Record<string, unknown>;
      const settings: { cliPath?: string; dbPath?: string; pollInterval?: number; actionTimeoutMs?: number } = {};
      if (typeof s.cliPath === 'string') settings.cliPath = s.cliPath.slice(0, 1024);
      if (typeof s.dbPath === 'string') settings.dbPath = s.dbPath.slice(0, 1024);
      if (typeof s.pollInterval === 'number' && Number.isFinite(s.pollInterval)) {
        settings.pollInterval = Math.max(1000, Math.min(600000, Math.floor(s.pollInterval)));
      }
      if (typeof s.actionTimeoutMs === 'number' && Number.isFinite(s.actionTimeoutMs)) {
        settings.actionTimeoutMs = Math.max(1000, Math.min(600000, Math.floor(s.actionTimeoutMs)));
      }
      return { type: 'saveSettings', settings };
    }
    case 'getProjects': {
      return { type: 'getProjects' };
    }
    case 'selectProject': {
      const projectDir = typeof msg.projectDir === 'string' && msg.projectDir.length <= 1024 ? msg.projectDir : undefined;
      return { type: 'selectProject', projectDir };
    }
    case 'queryExplorer': {
      if (typeof msg.kind !== 'string' || !ALLOWED_EXPLORER_KINDS.has(msg.kind)) return null;
      const kind = msg.kind as any;
      const scope = msg.scope === 'all' ? 'all' : 'project';
      const search = typeof msg.search === 'string' ? msg.search.slice(0, 256) : undefined;
      const source = typeof msg.source === 'string' ? msg.source.slice(0, 64) : undefined;
      const offset = typeof msg.offset === 'number' && Number.isSafeInteger(msg.offset) && msg.offset >= 0 ? msg.offset : 0;
      const requestId = typeof msg.requestId === 'number' && Number.isSafeInteger(msg.requestId) && msg.requestId >= 0 ? msg.requestId : undefined;
      return { type: 'queryExplorer', kind, scope, search, source, offset, requestId };
    }
    case 'getMemoryDetail': {
      if (typeof msg.id !== 'string' || msg.id.length > 256) return null;
      const scope = msg.scope === 'all' ? 'all' : 'project';
      const requestId = typeof msg.requestId === 'number' && Number.isSafeInteger(msg.requestId) && msg.requestId >= 0 ? msg.requestId : undefined;
      return { type: 'getMemoryDetail', id: msg.id, scope, requestId };
    }
    case 'expandTranscript': {
      if (typeof msg.eventId !== 'string' || msg.eventId.length > 256) return null;
      const requestId = typeof msg.requestId === 'number' && Number.isSafeInteger(msg.requestId) && msg.requestId >= 0 ? msg.requestId : undefined;
      return { type: 'expandTranscript', eventId: msg.eventId, requestId };
    }
    case 'runAction': {
      if (typeof msg.action !== 'string' || !ALLOWED_ACTIONS.has(msg.action)) return null;
      const action = msg.action as any;
      const params = typeof msg.params === 'object' && msg.params !== null ? (msg.params as Record<string, unknown>) : undefined;
      const requestId = typeof msg.requestId === 'number' && Number.isSafeInteger(msg.requestId) && msg.requestId >= 0 ? msg.requestId : undefined;
      return { type: 'runAction', action, params, requestId };
    }
    case 'cancelAction': {
      return { type: 'cancelAction' };
    }
    case 'clearLog': {
      return { type: 'clearLog' };
    }
    default:
      return null;
  }
}
