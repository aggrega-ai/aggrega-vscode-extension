// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';
import * as vscode from 'vscode';
import { Daemon, DaemonState } from './daemon';
import { debounce } from './debounce';
import {
  notifyDaemonStartupFailed,
  notifyStoppedResponding,
  promptCacheMiss,
} from './notifications';
import { getSettings } from './settings-vscode';
import {
  lspCompletionToCompletion,
  lspDefinitionToResolve,
  lspHoverToHover,
  lspImplementationToFindImplementations,
  lspReferencesToFindReferences,
  locationToLspLocation,
} from './translator';
import {
  DaemonLocation,
  ERR_FILE_NOT_VALIDATED,
  JsonRpcError,
  ValidateParams,
} from './types';
import { findAggregaConfigUpward } from './workspace';

let daemon: Daemon | null = null;
let outputChannel: vscode.OutputChannel | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('Aggrega');
  context.subscriptions.push(outputChannel);

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return;
  }

  const configFound = await findAggregaConfigUpward(workspaceRoot);
  if (!configFound) {
    return;
  }

  daemon = new Daemon(getSettings(), msg => outputChannel?.appendLine(msg));
  daemon.on('stoppedResponding', () => notifyStoppedResponding());

  try {
    await daemon.start(workspaceRoot);
  } catch (err) {
    notifyDaemonStartupFailed((err as Error).message);
    daemon = null;
    return;
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('aggrega.server') && daemon) {
        daemon.updateSettings(getSettings());
      }
    }),
  );

  registerDocumentLifecycle(context);
  registerLanguageFeatures(context);
  registerFileWatcher(context);
  registerRestartCommand(context);
}

export async function deactivate(): Promise<void> {
  if (daemon) {
    await daemon.stop();
    daemon = null;
  }
}

function registerDocumentLifecycle(context: vscode.ExtensionContext): void {
  const validate = (doc: vscode.TextDocument) => {
    if (!daemon || daemon.getState() !== DaemonState.Running) { return; }
    if (doc.languageId !== 'yaml') { return; }
    const params: ValidateParams = { file: doc.uri.fsPath, content: doc.getText() };
    daemon.request('aggrega/validate', params).catch(err => {
      outputChannel?.appendLine(`validate failed: ${describeError(err)}`);
    });
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(validate),
  );

  const debouncedValidate = debounce(
    (doc: vscode.TextDocument) => validate(doc),
    () => getSettings().debounceMs,
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => debouncedValidate(e.document)),
  );

  for (const doc of vscode.workspace.textDocuments) {
    validate(doc);
  }
}

function registerLanguageFeatures(context: vscode.ExtensionContext): void {
  const yamlSelector: vscode.DocumentSelector = { language: 'yaml' };

  context.subscriptions.push(vscode.languages.registerDefinitionProvider(yamlSelector, {
    provideDefinition: (doc, position) => navigationRequest(
      'aggrega/resolve',
      doc, position,
      (uri, pos, content, enc) => lspDefinitionToResolve(uri, pos, content, enc),
    ),
  }));

  context.subscriptions.push(vscode.languages.registerReferenceProvider(yamlSelector, {
    provideReferences: (doc, position) => navigationRequest(
      'aggrega/findReferences',
      doc, position,
      (uri, pos, content, enc) => lspReferencesToFindReferences(uri, pos, content, enc),
    ),
  }));

  context.subscriptions.push(vscode.languages.registerImplementationProvider(yamlSelector, {
    provideImplementation: (doc, position) => navigationRequest(
      'aggrega/findImplementations',
      doc, position,
      (uri, pos, content, enc) => lspImplementationToFindImplementations(uri, pos, content, enc),
    ),
  }));

  context.subscriptions.push(vscode.languages.registerHoverProvider(yamlSelector, {
    provideHover: async (doc, position) => {
      if (!daemon) { return undefined; }
      const params = lspHoverToHover(doc.uri.toString(), position, doc.getText(), daemon.getServerEncoding());
      const result = await tryRequest<{ contents: string } | null>('aggrega/hover', params, doc);
      if (!result || !result.contents) { return undefined; }
      return new vscode.Hover(new vscode.MarkdownString(result.contents));
    },
  }));

  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(yamlSelector, {
    provideCompletionItems: async (doc, position, _token, ctx) => {
      if (!daemon) { return undefined; }
      const params = lspCompletionToCompletion(
        doc.uri.toString(),
        position,
        doc.getText(),
        daemon.getServerEncoding(),
        ctx.triggerCharacter,
      );
      const result = await tryRequest<{ items: Array<{ label: string; sortText?: string; detail?: string }> } | null>(
        'aggrega/completion', params, doc,
      );
      if (!result) { return undefined; }
      return result.items.map(it => {
        const c = new vscode.CompletionItem(it.label);
        if (it.sortText) { c.sortText = it.sortText; }
        if (it.detail) { c.detail = it.detail; }
        return c;
      });
    },
  }, '/'));
}

function registerFileWatcher(context: vscode.ExtensionContext): void {
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.yaml');
  const invalidate = (uri: vscode.Uri) => {
    if (!daemon) { return; }
    daemon.request('aggrega/invalidate', { file: uri.fsPath }).catch(err => {
      outputChannel?.appendLine(`invalidate failed: ${describeError(err)}`);
    });
  };
  watcher.onDidChange(invalidate);
  watcher.onDidCreate(invalidate);
  watcher.onDidDelete(invalidate);
  context.subscriptions.push(watcher);
}

function registerRestartCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('aggrega.server.restart', async () => {
    if (!daemon) {
      vscode.window.showWarningMessage('Aggrega language server is not running.');
      return;
    }
    try {
      await daemon.restart();
      vscode.window.showInformationMessage('Aggrega language server restarted.');
    } catch (err) {
      notifyDaemonStartupFailed((err as Error).message);
    }
  }));
}

async function navigationRequest(
  method: string,
  doc: vscode.TextDocument,
  position: vscode.Position,
  buildParams: (uri: string, pos: { line: number; character: number }, content: string, enc: 'utf-8' | 'utf-16') => unknown,
): Promise<vscode.Location[] | undefined> {
  // Capture the daemon reference and its negotiated encoding up
  // front. Subsequent awaits cross deactivate-safe boundaries — VS
  // Code may call deactivate() between awaits, dropping the module-
  // level daemon to null. Locals stay valid.
  const activeDaemon = daemon;
  if (!activeDaemon) { return undefined; }
  const encoding = activeDaemon.getServerEncoding();

  const params = buildParams(
    doc.uri.toString(),
    { line: position.line, character: position.character },
    doc.getText(),
    encoding,
  );
  const result = await tryRequest<DaemonLocation[] | DaemonLocation | null>(method, params, doc);
  if (!result) { return undefined; }
  const locations = Array.isArray(result) ? result : [result];
  return Promise.all(locations.map(async loc => {
    const targetContent = await loadTargetContent(loc.uri, encoding);
    const lspLoc = locationToLspLocation(loc, targetContent, encoding);
    return new vscode.Location(
      vscode.Uri.parse(lspLoc.uri),
      new vscode.Range(
        new vscode.Position(lspLoc.range.start.line, lspLoc.range.start.character),
        new vscode.Position(lspLoc.range.end.line, lspLoc.range.end.character),
      ),
    );
  }));
}

async function loadTargetContent(uri: string, encoding: 'utf-8' | 'utf-16'): Promise<string> {
  if (encoding === 'utf-16') {
    return '';
  }
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
    return doc.getText();
  } catch {
    return '';
  }
}

async function tryRequest<T>(method: string, params: unknown, doc: vscode.TextDocument): Promise<T | null> {
  if (!daemon) { return null; }
  try {
    return await daemon.request<T>(method, params);
  } catch (err) {
    if (isJsonRpcError(err) && err.code === ERR_FILE_NOT_VALIDATED) {
      return await handleCacheMiss<T>(method, params, doc);
    }
    outputChannel?.appendLine(`${method} failed: ${describeError(err)}`);
    return null;
  }
}

async function handleCacheMiss<T>(method: string, params: unknown, doc: vscode.TextDocument): Promise<T | null> {
  if (!daemon) { return null; }
  const settings = getSettings();
  if (!settings.autoRevalidate) {
    const decision = await promptCacheMiss(path.basename(doc.uri.fsPath));
    if (decision !== 'revalidate') { return null; }
  }
  try {
    await daemon.request<void>('aggrega/validate', {
      file: doc.uri.fsPath,
      content: doc.getText(),
    });
    return await daemon.request<T>(method, params);
  } catch (err) {
    outputChannel?.appendLine(`cache-miss retry failed: ${describeError(err)}`);
    return null;
  }
}

function isJsonRpcError(v: unknown): v is JsonRpcError {
  return !!v && typeof v === 'object' && typeof (v as JsonRpcError).code === 'number';
}

function describeError(err: unknown): string {
  if (isJsonRpcError(err)) {
    return `code=${err.code} ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
