import type { VetoSnapshot } from './snapshot';

export interface VisibilityEnvironment {
  extensionVersion: string;
  runtimeVersion: string;
  trusted: boolean;
  remoteName?: string;
  projectDir?: string;
}

/** Passive diagnostics describe only evidence already available to the extension. */
export function visibilityReport(snapshot: VetoSnapshot, env: VisibilityEnvironment): string {
  const database = snapshot.compatibilityWarning && !snapshot.installed
    ? 'Runtime unavailable'
    : !snapshot.installed ? 'Database not found'
    : snapshot.stale ? 'Read failed; cached data may be shown' : 'Readable (read-only)';
  return [
    'Veto setup and data provenance',
    '',
    `Extension version: ${env.extensionVersion}`,
    `Extension host Node: ${env.runtimeVersion}`,
    `Location: ${env.remoteName ? `Remote extension host (${env.remoteName})` : 'Local extension host'}`,
    `Workspace trust: ${env.trusted ? 'Trusted' : 'Restricted'}`,
    `Selected project: ${env.projectDir ?? 'No project selected'}`,
    `Database: ${database}`,
    `Database schema: ${snapshot.schemaVersion ?? 'Unknown'}`,
    `Last successful database read: ${snapshot.lastSuccessfulRead ? new Date(snapshot.lastSuccessfulRead).toISOString() : 'Unknown'}`,
    ...(snapshot.compatibilityWarning ? [`Compatibility: ${snapshot.compatibilityWarning}`] : []),
    ...(snapshot.staleReason ? [`Read failure: ${snapshot.staleReason}`] : []),
    '',
    'Server version: Unknown (database schema is not a server version)',
    'MCP registration / server health: Not checked',
    'Provider CLI availability / authentication: Not checked',
    'Run veto doctor in your own terminal for backend setup diagnostics.',
    '',
    'Context source: Saved session record in the Veto database',
    `Recorded provider: ${snapshot.session?.active_client ?? snapshot.session?.platform ?? 'Unknown'}`,
    `Recorded tokens: ${snapshot.session?.token_count ?? 'Unknown'}`,
    'Live provider activity / context capacity: Unknown',
    'A database refresh does not make the saved token count a live measurement.',
    '',
    'Transcript recall: Use Veto: Search Transcripts (requires backend API v1).',
    'Lessons / trial: Use Veto: Load Backend Visibility for a passive API v1 snapshot.',
    'Consent and trial progress: Unknown; historical consent is not current authorization.',
    'The extension does not harvest or deliver lessons; explicit recall is served masked by the backend.',
  ].join('\n');
}
