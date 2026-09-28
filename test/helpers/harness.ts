// Loads real extension modules with selected dependencies replaced, plus a minimal fake
// VS Code API. Used to test message routing without an Electron extension host.

import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

export function loadModule<T = any>(file: string, mocks: Record<string, unknown>): T {
  const abs = resolve(process.cwd(), file);
  const code = ts.transpileModule(readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const req = createRequire(abs);
  const module = { exports: {} as any };
  const load = (id: string) => (id in mocks ? mocks[id] : req(id));
  new Function('exports', 'require', 'module', '__filename', '__dirname', code)(module.exports, load, module, abs, dirname(abs));
  return module.exports as T;
}

export const settle = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) await new Promise(r => setImmediate(r));
};

export interface FakeVscode {
  api: any;
  config: Record<string, unknown>;
  commands: Map<string, (...args: any[]) => unknown>;
  messages: Array<{ level: string; text: string }>;
  clipboard: string[];
  terminals: unknown[];
}

export function fakeVscode(overrides: { trusted?: boolean; config?: Record<string, unknown> } = {}): FakeVscode {
  const config: Record<string, unknown> = { ...(overrides.config ?? {}) };
  const commands = new Map<string, (...args: any[]) => unknown>();
  const messages: Array<{ level: string; text: string }> = [];
  const clipboard: string[] = [];
  const terminals: unknown[] = [];
  const disposable = () => ({ dispose() {} });
  const notify = (level: string) => (text: string) => { messages.push({ level, text }); return Promise.resolve(undefined); };
  class CancellationTokenSource {
    private listeners: Array<(e?: unknown) => void> = [];
    private cancelled = false;
    readonly token: { readonly isCancellationRequested: boolean; onCancellationRequested(l: (e?: unknown) => void): { dispose(): void } };
    constructor() {
      const source = this;
      this.token = {
        get isCancellationRequested() { return source.cancelled; },
        onCancellationRequested: l => { source.listeners.push(l); return disposable(); },
      };
    }
    cancel() { if (!this.cancelled) { this.cancelled = true; this.listeners.forEach(l => l()); } }
    dispose() {}
  }
  const api = {
    workspace: {
      isTrusted: overrides.trusted ?? true,
      workspaceFolders: [{ name: 'fixture', uri: { fsPath: 'D:/fixture' } }],
      getConfiguration: () => ({
        get: (key: string, fallback: unknown) => (key in config ? config[key] : fallback),
        update: async (key: string, value: unknown) => { config[key] = value; },
      }),
      getWorkspaceFolder: () => undefined,
      onDidChangeConfiguration: disposable,
      onDidChangeWorkspaceFolders: disposable,
      openTextDocument: async (o: unknown) => o,
    },
    window: {
      activeTextEditor: undefined as any,
      createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
      showWarningMessage: notify('warn'),
      showInformationMessage: notify('info'),
      showErrorMessage: notify('error'),
      showTextDocument: async () => undefined,
      showQuickPick: async () => undefined,
      showInputBox: async () => undefined,
      onDidChangeActiveTextEditor: disposable,
      registerWebviewViewProvider: disposable,
      createTerminal: (o: unknown) => { terminals.push(o); return { show() {} }; },
      withProgress: async (_o: unknown, fn: (p: unknown, t: unknown) => unknown) => fn({ report() {} }, new CancellationTokenSource().token),
    },
    extensions: { getExtension: () => ({ packageJSON: { version: '1.2.0' } }) },
    commands: {
      registerCommand: (name: string, fn: (...args: any[]) => unknown) => { commands.set(name, fn); return disposable(); },
      executeCommand: async (name: string, ...args: unknown[]) => commands.get(name)?.(...args),
    },
    languages: { createDiagnosticCollection: () => ({ clear() {}, set() {}, dispose() {} }) },
    env: { clipboard: { writeText: async (t: string) => { clipboard.push(t); } }, openExternal: async () => true, remoteName: undefined },
    Uri: { parse: (s: string) => s, file: (s: string) => s },
    CancellationTokenSource,
    ProgressLocation: { Notification: 15 },
    ConfigurationTarget: { Global: 1 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
  };
  return { api, config, commands, messages, clipboard, terminals };
}
