import { pathsEqual } from './paths';

export type ApiCommand = 'version' | 'snapshot' | 'recall search' | 'recall expand' | 'diagnostics';
export interface ApiEnvelope {
  contract: 1; command: ApiCommand; backend_version: string; generated_at: string;
  state: string; message?: string; next_action?: string; data?: Record<string, any>;
}
const knownStates = new Set(['ok','invalid_request','unknown_command','db_mismatch','db_missing','sqlite_unavailable','no_archive','no_match','not_found','error']);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 64000): value is string => typeof value === 'string' && value.length <= max;
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function requireCompatibleBackend(envelope: ApiEnvelope, command: ApiCommand): void {
  const version = /^(\d+)\.(\d+)\.(\d+)$/.exec(envelope.backend_version);
  if (envelope.state !== 'ok' || !version ||
      Number(version[1]) < 3 || (Number(version[1]) === 3 && Number(version[2]) < 8) ||
      envelope.data?.contract !== 1 ||
      !envelope.data?.commands?.includes(command)) {
    throw new Error('Veto 3.8.0 or later required. Run: npm i -g @jigyasudham/veto@latest');
  }
}

/** Validate the published Veto API v1 boundary; older CLIs fail visibly. */
export function parseApiEnvelope(raw: string, command: ApiCommand, project?: string): ApiEnvelope {
  const fail = (msg = 'Veto 3.8.0 or later required. Run: npm i -g @jigyasudham/veto@latest') => {
    throw new Error(msg);
  };
  let value: any;
  try { value = JSON.parse(raw); } catch { return fail(); }
  if (!object(value) || value.contract !== 1 || value.command !== command ||
      !text(value.backend_version, 128) || !text(value.generated_at, 64) || !Number.isFinite(Date.parse(value.generated_at))) {
    return fail('Unsupported or malformed Veto API v1 response. Veto 3.8.0 or later required.');
  }

  // Treat any state you don't recognize as an error, and show its message and next_action
  if (!knownStates.has(value.state)) {
    value = {
      ...value,
      state: 'error',
      message: text(value.message) ? value.message : `Backend returned unrecognized state: ${value.state}`,
      next_action: text(value.next_action) ? value.next_action : 'Update Veto with npm i -g @jigyasudham/veto@latest',
    };
  }

  if (value.state !== 'ok') {
    if (!text(value.message)) {
      value.message = `Veto operation failed with state: ${value.state}`;
    }
    return value as ApiEnvelope;
  }
  const data = value.data;
  if (!object(data)) return fail('Malformed Veto API v1 response data.');
  if (command === 'version' && (!Array.isArray(data.commands) || !data.commands.every((v: unknown) => text(v, 128)) || !Array.isArray(data.request_via) || !data.request_via.includes('stdin'))) return fail('Malformed version response.');
  if (command === 'snapshot') {
    if (!object(data.project) || !text(data.project.dir, 1024) || !project || !pathsEqual(data.project.dir, project)) return fail('Snapshot project mismatch or malformed project.');
    for (const key of ['database', 'transcripts', 'lessons', 'trial']) {
      if (!object(data[key]) || !['ok', 'unavailable', 'error'].includes(data[key].state)) return fail(`Malformed snapshot section: ${key}`);
    }
    const t = data.transcripts, l = data.lessons, trial = data.trial;
    if (t.state === 'ok' && (!['enabled', 'disabled', 'reconsent_required'].includes(t.capture) || typeof t.recall_permitted !== 'boolean' || !count(t.archives_in_project))) return fail('Malformed transcripts section.');
    if (l.state === 'ok' && (l.scope !== 'all_projects' || !['on', 'off', 'reconsent_required'].includes(l.sharing) || !count(l.notes) || !count(l.held))) return fail('Malformed lessons section.');
    if (trial.state === 'ok' && (trial.mode !== 'shadow' || !count(trial.qualifying) || !count(trial.target) || typeof trial.complete !== 'boolean' || typeof trial.drift !== 'boolean')) return fail('Malformed trial section.');
  }
  if (command.startsWith('recall')) {
    if (!['enabled', 'disabled', 'reconsent_required'].includes(data.capture) || !text(data.disclaimer)) return fail('Malformed recall response.');
    if (command === 'recall search' && (!Array.isArray(data.hits) || data.hits.length > 20 || !data.hits.every((hit: any) => object(hit) && text(hit.event_id, 64) && text(hit.snippet) && text(hit.source, 128) && text(hit.source_session_id, 256)))) return fail('Malformed recall search hits.');
    if (command === 'recall expand' && (!text(data.text, 200000) || !text(data.source, 128) || !text(data.source_session_id, 256) || typeof data.truncated !== 'boolean' || !count(data.secrets_redacted))) return fail('Malformed recall expand data.');
  }
  if (command === 'diagnostics' && (!object(data.backend) || data.authentication !== 'not_checked' || !Array.isArray(data.hosts) || data.hosts.length > 50)) return fail('Malformed diagnostics response.');
  return value as ApiEnvelope;
}
