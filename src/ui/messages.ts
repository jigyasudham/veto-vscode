// Webview message contracts and runtime validation (F08).
// Decoupled from VS Code APIs to allow full unit testability under Node.js test runner.

export type HudMessage =
  | { type: 'resume'; id: string; platform: string }
  | { type: 'copyId'; id: string }
  | { type: 'searchMemory'; query: string; requestId?: number }
  | { type: 'command'; command: string };

export interface MemoryResult {
  title: string;
  type: string;
  project_dir: string | null;
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
]);

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function validateHudMessage(raw: unknown): HudMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const msg = raw as Record<string, unknown>;
  if (typeof msg.type !== 'string') return null;

  switch (msg.type) {
    case 'resume': {
      if (typeof msg.id !== 'string' || !SAFE_ID.test(msg.id) || msg.id.length > 128) return null;
      const platform = typeof msg.platform === 'string' ? msg.platform.slice(0, 32) : 'claude';
      return { type: 'resume', id: msg.id, platform };
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
    default:
      return null;
  }
}
