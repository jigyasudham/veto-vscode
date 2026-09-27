import * as vscode from 'vscode';
import type { VetoStore } from '../core/VetoStore';
import type { DetailScope, DetailPage } from '../core/snapshot';

export interface DetailDeps { store: VetoStore; getProjectDir: () => string | undefined; }

async function showDetail(title: string, value: unknown, scope: string): Promise<void> {
  // Plain text deliberately prevents stored Markdown/command links from becoming executable UI.
  const content = `${title}\nScope: ${scope}\nSource: saved Veto database records (not live telemetry)\nRead: ${new Date().toISOString()}\n\n${JSON.stringify(value, null, 2)}`;
  const document = await vscode.workspace.openTextDocument({ content, language: 'plaintext' });
  await vscode.window.showTextDocument(document, { preview: true });
}

async function chooseScope(getProjectDir: DetailDeps['getProjectDir']): Promise<DetailScope | undefined> {
  const projectDir = getProjectDir();
  const items = projectDir
    ? [{ label: 'Selected project', description: projectDir, scope: { projectDir } as DetailScope },
      { label: 'All projects', description: 'Explicitly include records from every project', scope: { all: true } as DetailScope }]
    : [{ label: 'All projects', description: 'No selected project. Explicitly include every project.', scope: { all: true } as DetailScope }];
  return (await vscode.window.showQuickPick(items, { title: 'Veto: Choose record scope', ignoreFocusOut: true }))?.scope;
}

const scopeLabel = (scope: DetailScope) => 'projectDir' in scope ? scope.projectDir : 'All projects';

async function browse<T>(title: string, read: (offset: number) => DetailPage<T>, label: (row: T) => vscode.QuickPickItem,
  open: (row: T) => Promise<void>): Promise<void> {
  let offset = 0;
  while (true) {
    const result = read(offset);
    const items: Array<vscode.QuickPickItem & { row?: T; direction?: number }> = result.items.map(row => ({ ...label(row), row }));
    if (offset > 0) items.push({ label: '$(arrow-left) Previous page', direction: -1 });
    if (result.hasMore) items.push({ label: '$(arrow-right) Next page', direction: 1 });
    if (!items.length) { await vscode.window.showInformationMessage(`${title}: no saved records in this scope.`); return; }
    const selected = await vscode.window.showQuickPick(items, { title: `${title} — page ${offset / 30 + 1}`, matchOnDescription: true, matchOnDetail: true, ignoreFocusOut: true });
    if (!selected) return;
    if (selected.direction) { offset += selected.direction * 30; continue; }
    if (selected.row !== undefined) { await open(selected.row); return; }
  }
}

export function registerDetailCommands(context: vscode.ExtensionContext, deps: DetailDeps): void {
  const { store } = deps;
  const register = (name: string, action: () => Promise<void>) => context.subscriptions.push(
    vscode.commands.registerCommand(name, async () => {
      try { await action(); }
      catch (error) { await vscode.window.showErrorMessage(`Veto: ${error instanceof Error ? error.message : String(error)}`); }
    }));
  const scoped = (action: (scope: DetailScope) => Promise<void>) => async () => {
    const scope = await chooseScope(deps.getProjectDir);
    if (scope) await action(scope);
  };

  register('veto.browseSessions', scoped(async scope => {
    const search = await vscode.window.showInputBox({ title: 'Veto: Search saved sessions', prompt: 'Search summary, ID, or provider across all pages; leave blank for all sessions.' });
    if (search === undefined) return;
    await browse('Veto sessions', offset => store.sessionPage(scope, offset, search), row => ({
      label: row.summary || row.id, description: `${row.platform} · ${row.started_at}`, detail: `${row.id} · ${row.project_dir ?? 'No project'}`,
    }), async row => {
      const action = await vscode.window.showQuickPick(['Open saved details', 'Copy session ID', 'Resume session'], { title: row.id });
      if (action === 'Open saved details') await showDetail('Saved session', row, scopeLabel(scope));
      if (action === 'Copy session ID') await vscode.env.clipboard.writeText(row.id);
      if (action === 'Resume session') await vscode.commands.executeCommand('veto.continueSession', row.id, row.active_client ?? row.platform, row.project_dir);
    });
  }));
  register('veto.browseMemory', scoped(async scope => {
    const search = await vscode.window.showInputBox({ title: 'Veto: Search memory', prompt: 'Search title or tags across all pages; leave blank for all entries.' });
    if (search === undefined) return;
    await browse('Veto memory', offset => store.memoryPage(scope, offset, search), row => ({ label: row.title, description: row.tags.join(', '), detail: row.project_dir ?? 'No project' }), async row => {
      const detail = store.memoryDetail(scope, row.id);
      if (!detail) throw new Error('Memory entry was removed or no longer belongs to this scope.');
      await showDetail('Memory entry', detail, scopeLabel(scope));
    });
  }));
  register('veto.councilHistory', scoped(async scope => {
    await browse('Veto council history', offset => store.councilPage(scope, offset), row => ({ label: `${row.verdict}: ${row.task ?? row.id}`, description: row.debated_at }), row => showDetail('Council votes and recommendation', row, scopeLabel(scope)));
  }));
  register('veto.decisionHistory', scoped(async scope => {
    await browse('Veto decisions', offset => store.decisionPage(scope, offset), row => ({ label: row.decision, description: `${row.council_verdict ?? 'No verdict'} · ${row.made_at}` }), row => showDetail('Saved decision', row, scopeLabel(scope)));
  }));
  register('veto.decisionConstraints', scoped(async scope => {
    await browse('Veto decision constraints', offset => store.constraintPage(scope, offset), row => ({ label: row.rule, description: `${row.active ? 'Active' : 'Inactive'} · ${row.severity}`, detail: row.file_scope ?? 'All files' }), row => showDetail('Decision constraint (read-only)', row, scopeLabel(scope)));
  }));
  register('veto.reviewDetails', scoped(async scope => {
    await showDetail('Saved review and scan diagnostics', store.reviewDetails(scope), scopeLabel(scope));
  }));
  register('veto.learningDetails', async () => {
    await showDetail('Learning outcomes and top routing patterns', store.learningDetails(), 'Global database aggregates; no project attribution in the current read contract');
  });
}
