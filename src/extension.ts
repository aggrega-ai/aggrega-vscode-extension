// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { Daemon, DaemonState } from './daemon';
import { debounce } from './debounce';
import { publishDiagnostics, publishShapes } from './diagnostics';
import { handleDaemonError, resetSessionDedup } from './error-surfaces';
import {
  notifyDaemonStartupFailed,
  notifyStoppedResponding,
  promptCacheMiss,
} from './notifications';
import { getSettings } from './settings-vscode';
import { createAggregaStatusBar, createPendingChoiceStatusBar } from './status-bar';
import { scheduleBinaryRestart, RestartHandle } from './binary-restart';
import { checkDaemonVersion } from './version-check';
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
  PublishDiagnosticsParams,
  ValidateParams,
  ValidateResponse,
} from './types';
import { AnchoredFolder, findAllAnchoredFolders } from './workspace';
import {
  STATE_KEY,
  buildPickerItems,
  classifyActivation,
  readSavedAnchor,
} from './anchor-picker';

let daemon: Daemon | null = null;
let outputChannel: vscode.OutputChannel | null = null;
let diagnosticCollection: vscode.DiagnosticCollection | null = null;
let workspaceRootForCommands: string | null = null;
const toastDebounce = new Map<number, true | number>();
let pendingRestart: RestartHandle | null = null;
let pendingRestartRemaining = 0;
let statusBarItem: vscode.StatusBarItem | null = null;
let baseStatusBarText = '';
let pendingChoiceItem: vscode.StatusBarItem | null = null;
let activeAnchored: AnchoredFolder<vscode.WorkspaceFolder> | null = null;
let currentAnchored: AnchoredFolder<vscode.WorkspaceFolder>[] = [];
let extensionContext: vscode.ExtensionContext | null = null;
let lateInitDone = false;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extensionContext = context;
  outputChannel = vscode.window.createOutputChannel('Aggrega');
  context.subscriptions.push(outputChannel);

  // Always register the switch-anchor command so the Command
  // Palette surfaces it regardless of the activation outcome.
  registerSwitchAnchorCommand(context);
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void reactivate(context);
    }),
  );

  await reactivate(context);
}

// reactivate evaluates the current workspaceFolders, classifies the
// activation into one of four shapes (no-op / single / multi-saved /
// multi-prompt), and drives the daemon + status bar accordingly. The
// function is idempotent — onDidChangeWorkspaceFolders invokes it
// after every folder add/remove so the daemon state always reflects
// the current workspace.
async function reactivate(context: vscode.ExtensionContext): Promise<void> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const anchored = await findAllAnchoredFolders([...folders]);
  currentAnchored = anchored;

  const savedAnchor = readSavedAnchor(context.workspaceState);
  if (savedAnchor !== null && !anchored.some(a => a.anchorPath === savedAnchor)) {
    // Stale saved choice — folder removed or marker deleted. Clear
    // so the multi-prompt branch can re-fire when appropriate.
    await context.workspaceState.update(STATE_KEY, undefined);
  }

  const decision = classifyActivation(
    anchored,
    readSavedAnchor(context.workspaceState),
  );

  switch (decision.kind) {
    case 'none':
      await tearDownPendingChoice();
      await stopDaemon();
      return;
    case 'single':
    case 'multiSaved':
      await tearDownPendingChoice();
      await ensureDaemonAt(context, decision.target);
      return;
    case 'multiPrompt':
      await stopDaemon();
      surfacePendingChoice(context, decision.anchored);
      return;
  }
}

function surfacePendingChoice(
  context: vscode.ExtensionContext,
  anchored: AnchoredFolder<vscode.WorkspaceFolder>[],
): void {
  if (!pendingChoiceItem) {
    pendingChoiceItem = createPendingChoiceStatusBar(context);
  } else {
    pendingChoiceItem.show();
  }
  void notifyMultipleAnchors(anchored.length);
}

async function tearDownPendingChoice(): Promise<void> {
  if (pendingChoiceItem) {
    pendingChoiceItem.hide();
    pendingChoiceItem.dispose();
    pendingChoiceItem = null;
  }
}

let pendingToastShown = false;
async function notifyMultipleAnchors(count: number): Promise<void> {
  if (pendingToastShown) { return; }
  pendingToastShown = true;
  const action = 'Choose folder…';
  const choice = await vscode.window.showInformationMessage(
    `Aggrega: ${count} anchored folders found. Choose one to start the daemon.`,
    action,
  );
  pendingToastShown = false;
  if (choice === action) {
    void vscode.commands.executeCommand('aggrega.workspace.switchAnchor');
  }
}

// ensureDaemonAt starts (or restarts at a new root) the daemon to
// match the given anchored folder. If the daemon is already running
// at this anchor, this is a no-op. If running at a different anchor,
// the daemon is cooperatively stopped and restarted at the new root.
async function ensureDaemonAt(
  context: vscode.ExtensionContext,
  target: AnchoredFolder<vscode.WorkspaceFolder>,
): Promise<void> {
  const targetRoot = target.folder.uri.fsPath;

  if (daemon && activeAnchored?.folder.uri.fsPath === targetRoot) {
    return;
  }

  if (daemon) {
    await stopDaemon();
  }

  await context.workspaceState.update(STATE_KEY, target.anchorPath);
  workspaceRootForCommands = targetRoot;
  activeAnchored = target;

  diagnosticCollection ??= (() => {
    const dc = vscode.languages.createDiagnosticCollection('aggrega');
    context.subscriptions.push(dc);
    return dc;
  })();

  daemon = new Daemon(getSettings(), msg => outputChannel?.appendLine(msg));
  daemon.on('stoppedResponding', () => notifyStoppedResponding());
  daemon.on('stateChange', (next) => {
    if (next === DaemonState.Running || next === DaemonState.Restarting) {
      resetSessionDedup(toastDebounce);
    }
  });
  daemon.on('notification:aggrega/publishDiagnostics', (params: PublishDiagnosticsParams) => {
    if (!diagnosticCollection) { return; }
    const uri = vscode.Uri.file(params.file);
    publishDiagnostics(diagnosticCollection, uri, params.diagnostics);
  });

  const anchorContext = currentAnchored.length >= 2
    ? { active: target, anchored: currentAnchored }
    : undefined;
  statusBarItem = createAggregaStatusBar(context, daemon, anchorContext);

  if (!lateInitDone) {
    registerRestartCommand(context);
    registerStatusBarMenu(context);
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (!e.affectsConfiguration('aggrega.server') && !e.affectsConfiguration('aggrega.notifications')) {
          return;
        }
        if (!daemon) {
          return;
        }
        daemon.updateSettings(getSettings());
        if (e.affectsConfiguration('aggrega.server.binaryPath')) {
          scheduleBinaryPathRestart();
        }
      }),
    );
    registerDocumentLifecycle(context);
    registerLanguageFeatures(context);
    registerFileWatcher(context);
    registerCloseHandler(context);
    lateInitDone = true;
  }

  try {
    await daemon.start(targetRoot);
  } catch (err) {
    notifyDaemonStartupFailed((err as Error).message);
    daemon = null;
    activeAnchored = null;
    return;
  }

  void runCompatibilityCheck();
}

async function stopDaemon(): Promise<void> {
  if (daemon) {
    await daemon.stop();
    daemon = null;
  }
  activeAnchored = null;
  if (statusBarItem) {
    statusBarItem.hide();
  }
}

function registerSwitchAnchorCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('aggrega.workspace.switchAnchor', async () => {
    const anchored = currentAnchored;
    if (anchored.length === 0) {
      void vscode.window.showInformationMessage('Aggrega: no anchored folders in this workspace.');
      return;
    }
    if (anchored.length === 1) {
      void vscode.window.showInformationMessage('Aggrega: only one anchored folder; nothing to switch to.');
      return;
    }
    const items = buildPickerItems(anchored).map(i => ({
      label: i.label,
      description: i.description,
      detail: i.detail,
      anchored: i.anchored,
    }));
    const choice = await vscode.window.showQuickPick(items, {
      placeHolder: 'Aggrega: choose which folder the daemon attaches to',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!choice) { return; }
    if (!extensionContext) { return; }
    await ensureDaemonAt(extensionContext, choice.anchored);
  }));
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
    daemon.request<ValidateResponse>('aggrega/validate', params).then(
      response => {
        if (diagnosticCollection) {
          publishDiagnostics(diagnosticCollection, doc.uri, response.diagnostics ?? []);
        }
      },
      err => {
        const ctx = buildErrorContext(doc.uri);
        if (ctx && isJsonRpcError(err) && handleDaemonError(err, ctx)) {
          return;
        }
        outputChannel?.appendLine(`validate failed: ${describeError(err)}`);
      },
    );
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

function registerCloseHandler(context: vscode.ExtensionContext): void {
  // On document close: clear the per-URI diagnostic-collection entry
  // synchronously so squiggles disappear immediately; then
  // fire-and-forget aggrega/invalidate with granularity: "file" to
  // drop the daemon's per-file parse + diagnostic caches. The two
  // operations are independent — the local clear precedes the daemon
  // call so UX latency is bounded by VS Code's own dispatch. A
  // missed invalidate is harmless: the daemon's cache stays slightly
  // populated; the next aggrega/validate refreshes the entry via
  // mtime-on-access eviction.
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(doc => {
      if (doc.languageId !== 'yaml') { return; }
      diagnosticCollection?.delete(doc.uri);
      if (!daemon) { return; }
      daemon.request('aggrega/invalidate', {
        file: doc.uri.fsPath,
        granularity: 'file',
      }).catch(err => {
        outputChannel?.appendLine(`invalidate (didClose) failed: ${describeError(err)}`);
      });
    }),
  );
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

// scheduleBinaryPathRestart kicks off a deferred restart after the
// configured grace window. Mid-grace, the status bar shows a
// countdown; the quick-action menu surfaces Restart now and Cancel
// restart entries so the operator can adjust the decision without
// waiting for the timer to expire. A previously-pending restart is
// cancelled before a new one is scheduled so rapid binaryPath edits
// (e.g., during a typo correction) don't double-schedule.
function scheduleBinaryPathRestart(): void {
  if (pendingRestart) {
    pendingRestart.cancel();
    pendingRestart = null;
  }
  const graceSeconds = getSettings().restartGraceSeconds;
  if (graceSeconds <= 0) {
    triggerRestart();
    return;
  }
  pendingRestartRemaining = graceSeconds;
  updateStatusBarForPendingRestart();
  outputChannel?.appendLine(`binary path changed; restarting in ${graceSeconds}s`);
  pendingRestart = scheduleBinaryRestart({
    graceSeconds,
    timer: {
      setTimeout: (handler, ms) => setTimeout(handler, ms),
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
      now: () => Date.now(),
    },
    restartFn: triggerRestart,
    onTick: (remaining) => {
      pendingRestartRemaining = remaining;
      updateStatusBarForPendingRestart();
    },
    onCancel: () => {
      pendingRestart = null;
      pendingRestartRemaining = 0;
      restoreStatusBar();
      outputChannel?.appendLine('binary path restart cancelled');
    },
    onComplete: () => {
      pendingRestart = null;
      pendingRestartRemaining = 0;
      restoreStatusBar();
    },
  });
}

function triggerRestart(): void {
  void vscode.commands.executeCommand('aggrega.server.restart');
}

function updateStatusBarForPendingRestart(): void {
  if (!statusBarItem) { return; }
  if (!baseStatusBarText) {
    baseStatusBarText = statusBarItem.text;
  }
  statusBarItem.text = `Aggrega: restarting in ${pendingRestartRemaining}s`;
}

function restoreStatusBar(): void {
  if (!statusBarItem || !baseStatusBarText) { return; }
  statusBarItem.text = baseStatusBarText;
  baseStatusBarText = '';
}

// runCompatibilityCheck spawns the configured binary with
// `version --json` and applies the policy from version-check.ts.
// Best-effort: a `skipped` or `error` outcome logs to the
// OutputChannel without surfacing a toast; only `mismatch` warns
// the operator.
async function runCompatibilityCheck(): Promise<void> {
  const settings = getSettings();
  const ext = vscode.extensions.getExtension('aggrega-ai.aggrega-vscode-extension');
  const compatibilityRange = (ext?.packageJSON as { aggregaCompatibility?: string } | undefined)?.aggregaCompatibility;
  const result = await checkDaemonVersion({
    binaryPath: settings.binaryPath,
    compatibilityRange,
    spawn: spawnForCompat,
  });
  switch (result.kind) {
    case 'match':
      outputChannel?.appendLine(`Aggrega daemon version ${result.version} matches the declared compatibility range.`);
      return;
    case 'mismatch':
      void vscode.window.showWarningMessage(
        `Aggrega daemon version ${result.version} is outside the extension's declared compatibility range (${result.range}). Behavior may be unstable; consider upgrading the daemon or downgrading the extension.`,
      );
      outputChannel?.appendLine(`Aggrega daemon version ${result.version} outside compatibility range ${result.range}.`);
      return;
    case 'skipped':
      outputChannel?.appendLine(`Aggrega version check skipped: ${result.reason}`);
      return;
    case 'error':
      outputChannel?.appendLine(`Aggrega version check failed: ${result.err.message}`);
      return;
  }
}

function spawnForCompat(binaryPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binaryPath, args, { timeout: 5000 }, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stdout);
    });
  });
}

// registerStatusBarMenu wires the status bar item's command to a
// quick-pick menu. During a pending restart, the menu surfaces
// Restart now / Cancel restart at the top of the list so the operator
// can adjust the timer without waiting for it to expire.
function registerStatusBarMenu(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('aggrega.statusBar.openMenu', async () => {
    const items: vscode.QuickPickItem[] = [];
    if (pendingRestart) {
      items.push({ label: 'Restart now', description: 'Run the pending restart immediately' });
      items.push({ label: 'Cancel restart', description: `Abort the pending restart (${pendingRestartRemaining}s remaining)` });
    }
    items.push(
      { label: 'Restart server', description: 'Restart the Aggrega language server' },
      { label: 'View output', description: 'Open the Aggrega output channel' },
      { label: 'Reveal workspace root', description: workspaceRootForCommands ?? 'Workspace not yet known' },
      { label: 'Show server log', description: 'Focus the daemon log' },
    );
    const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Aggrega: choose an action' });
    if (!choice) { return; }
    switch (choice.label) {
      case 'Restart now':
        pendingRestart?.restartNow();
        return;
      case 'Cancel restart':
        pendingRestart?.cancel();
        return;
      case 'Restart server':
        void vscode.commands.executeCommand('aggrega.server.restart');
        return;
      case 'View output':
      case 'Show server log':
        outputChannel?.show();
        return;
      case 'Reveal workspace root':
        if (workspaceRootForCommands) {
          void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(workspaceRootForCommands));
        }
        return;
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
    if (isJsonRpcError(err)) {
      if (err.code === ERR_FILE_NOT_VALIDATED) {
        return await handleCacheMiss<T>(method, params, doc);
      }
      const ctx = buildErrorContext(doc.uri);
      if (ctx && handleDaemonError(err, ctx)) {
        return null;
      }
    }
    outputChannel?.appendLine(`${method} failed: ${describeError(err)}`);
    return null;
  }
}

function buildErrorContext(uri: vscode.Uri) {
  if (!diagnosticCollection || !outputChannel || !workspaceRootForCommands) {
    return null;
  }
  const collection = diagnosticCollection;
  const channel = outputChannel;
  const settings = getSettings();
  return {
    uri,
    workspaceRoot: workspaceRootForCommands,
    publishShape: (u: vscode.Uri, shapes: Parameters<typeof publishShapes>[2]) =>
      publishShapes(collection, u, shapes),
    logLine: (line: string) => channel.appendLine(line),
    toastInfo: (message: string, ...items: string[]) =>
      vscode.window.showInformationMessage(message, ...items),
    createTerminal: (options: vscode.TerminalOptions) =>
      vscode.window.createTerminal(options),
    toastDebounce,
    toastDebounceMode: settings.toastDebounceMode,
    toastThrottleSeconds: settings.toastThrottleSeconds,
    now: () => Date.now(),
  };
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
