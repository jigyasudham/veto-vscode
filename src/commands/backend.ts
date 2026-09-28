import * as vscode from 'vscode';
import { spawnProcess } from './process';
import { parseApiEnvelope, requireCompatibleBackend, type ApiCommand, type ApiEnvelope } from '../core/backend';
import { join } from 'node:path';
import { vetoInvocation } from '../core/cli';
import { homedir } from 'node:os';
import { pathsEqual, isCustomDbPath } from '../core/paths';

export function registerBackendCommands(context: vscode.ExtensionContext, deps: {
  getProjectDir: () => string | undefined; getDbPath: () => string;
  showSnapshot: (envelope: ApiEnvelope) => void;
  onSnapshotFetched?: (envelope: ApiEnvelope) => void;
}): { refreshSnapshot: (silent?: boolean) => Promise<ApiEnvelope | undefined>; callApi: (command: ApiCommand, input: Record<string, unknown>, project?: string) => Promise<ApiEnvelope> } {
  let request = 0;
  let callSeq = 0;
  async function call(command: ApiCommand, input: Record<string, unknown>, project?: string): Promise<ApiEnvelope> {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before calling the Veto backend.');
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Veto: ${command}`, cancellable: true }, async (_, token) => {
      const configuredCli = vscode.workspace.getConfiguration('veto').get<string>('cliPath', '').trim();
      const { command: initialExec, prefix: initialPrefix } = vetoInvocation(configuredCli);
      // API calls are read-only and short; overlapping calls (e.g. a newer Explorer search)
      // must not reject each other, so each call gets its own job key.
      const seq = ++callSeq;
      const options = {
        cwd: project, input: JSON.stringify(input), cancellationToken: token, timeoutMs: 60000,
        jobKey: `api:${command}:${project ?? ''}:${seq}`,
      };

      // 1. Version gate: Call api version first.
      let versionRaw: string;
      try {
        versionRaw = await spawnProcess(initialExec, [...initialPrefix, 'api', 'version', '--stdin'], undefined, {
          ...options, input: '{}', jobKey: `api:version:${project ?? ''}:${seq}`
        });
      } catch (error) {
        // Only a missing CLI or one without `api` means an old/absent install; keep other causes.
        const message = error instanceof Error ? error.message : String(error);
        if (/ENOENT|not recognized|not found|exited with code|Cannot safely launch|Native Node executable/i.test(message)) {
          throw new Error('Veto 3.8.0 or later required. Run: npm i -g @jigyasudham/veto@latest');
        }
        throw error;
      }

      let versionEnv: ApiEnvelope;
      try {
        versionEnv = parseApiEnvelope(versionRaw, 'version');
      } catch {
        throw new Error('Veto 3.8.0 or later required. Run: npm i -g @jigyasudham/veto@latest');
      }
      requireCompatibleBackend(versionEnv, command);

      // 2. Call command: Run node <cli_path> api <command> --stdin with argument array and no shell.
      const resolvedCliPath = (versionEnv.data?.cli_path && typeof versionEnv.data.cli_path === 'string')
        ? versionEnv.data.cli_path
        : configuredCli;
      const [cmdExec, cmdPrefix] = resolvedCliPath ? ['node', [resolvedCliPath]] : ['veto', []];

      const raw = await spawnProcess(cmdExec, [...cmdPrefix, 'api', ...command.split(' '), '--stdin'], undefined, options);
      const envelope = parseApiEnvelope(raw, command, project);

      // 3. Handle states and notifications
      if (envelope.state === 'db_mismatch') {
        const msg = envelope.message || 'Veto backend database does not match the extension database configuration.';
        const action = envelope.next_action ? ` ${envelope.next_action}` : '';
        void vscode.window.showWarningMessage(`Veto database mismatch: ${msg}.${action}`);
      } else if (envelope.state !== 'ok') {
        const msg = envelope.message || `Operation returned state ${envelope.state}`;
        const action = envelope.next_action ? ` ${envelope.next_action}` : '';
        void vscode.window.showErrorMessage(`Veto ${command} (${envelope.state}): ${msg}.${action}`);
      }
      return envelope;
    });
  }

  async function show(envelope: ApiEnvelope, project?: string): Promise<void> {
    const content = `Veto ${envelope.command}\nBackend: ${envelope.backend_version} | Contract: ${envelope.contract}\nGenerated: ${envelope.generated_at}\nProject: ${project ?? 'Host diagnostics'}\n\n${JSON.stringify(envelope, null, 2)}`;
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content, language: 'plaintext' }), { preview: true });
  }

  function isCustomDb(db: string): boolean {
    return isCustomDbPath() || !pathsEqual(db, join(homedir(), '.veto', 'veto.db'));
  }

  async function fetchSnapshot(silent = false): Promise<ApiEnvelope | undefined> {
    const project = deps.getProjectDir(), db = deps.getDbPath();
    if (!project) {
      if (!silent) throw new Error('Select a project before reading backend visibility.');
      return undefined;
    }
    const input: Record<string, unknown> = { project };
    if (isCustomDb(db)) {
      input.db = db;
    }
    const envelope = await call('snapshot', input, project);
    if (!pathsEqual(project, deps.getProjectDir()) || db !== deps.getDbPath()) return envelope;
    deps.showSnapshot(envelope);
    deps.onSnapshotFetched?.(envelope);
    if (!silent) {
      await show(envelope, project);
    }
    return envelope;
  }

  const register = (id: string, action: () => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, async () => {
    if (!vscode.workspace.isTrusted) { void vscode.window.showWarningMessage('Veto: trust this workspace before calling the backend.'); return; }
    try { await action(); } catch (error) { void vscode.window.showErrorMessage(`Veto backend: ${error instanceof Error ? error.message : String(error)}`); }
  }));

  register('veto.backendVisibility', async () => {
    await fetchSnapshot(false);
  });

  register('veto.backendDiagnostics', async () => {
    // Passive configuration checks only; no server launch, provider login, or network probe.
    const db = deps.getDbPath();
    const input: Record<string, unknown> = { checks: [] };
    if (isCustomDb(db)) {
      input.db = db;
    }
    await show(await call('diagnostics', input, deps.getProjectDir()));
  });

  register('veto.searchTranscripts', async () => {
    const current = ++request;
    const project = deps.getProjectDir(), db = deps.getDbPath();
    if (!project) throw new Error('Select a project before searching transcripts.');
    const query = await vscode.window.showInputBox({
      prompt: 'Search masked archives in the selected project. Search may build the local index; retained archives remain searchable when capture is off.',
      validateInput: value => value.trim().length > 500 ? 'Use at most 500 characters' : null
    });
    if (!query?.trim()) return;
    const source = await vscode.window.showQuickPick(['All sources', 'claude', 'codex', 'gemini', 'antigravity'], { placeHolder: 'Filter archived conversation source' });
    if (!source) return;
    const input: Record<string, unknown> = { project, query: query.trim(), limit: 20, ...(source === 'All sources' ? {} : { source }) };
    if (isCustomDb(db)) {
      input.db = db;
    }
    const envelope = await call('recall search', input, project);
    const stale = () => current !== request || !pathsEqual(project, deps.getProjectDir()) || db !== deps.getDbPath();
    if (stale()) return;
    if (envelope.state !== 'ok') { await show(envelope, project); return; }
    const data = envelope.data!;
    const pick = await vscode.window.showQuickPick(data.hits.map((hit: any) => ({
      label: hit.snippet, description: `${hit.source} | ${hit.ts ?? 'time unknown'}`, detail: `${hit.source_session_id} | capture ${data.capture}`, eventId: hit.event_id
    })), {
      title: `Veto transcript results — capture ${data.capture}`, placeHolder: data.disclaimer, matchOnDescription: true, matchOnDetail: true,
    }) as (vscode.QuickPickItem & { eventId: string }) | undefined;
    if (!pick || stale()) return;
    const expandInput: Record<string, unknown> = { project, event_id: pick.eventId };
    if (isCustomDb(db)) {
      expandInput.db = db;
    }
    const expanded = await call('recall expand', expandInput, project);
    if (!stale()) await show(expanded, project);
  });

  return { refreshSnapshot: fetchSnapshot, callApi: call };
}
