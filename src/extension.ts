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
  ActiveReleaseResponse,
  DaemonLocation,
  ERR_FILE_NOT_VALIDATED,
  JsonRpcError,
  PublishDiagnosticsParams,
  ReleaseCandidatesResponse,
  ValidateParams,
  ValidateResponse,
} from './types';
import {
  ACTIVE_RELEASE_MARKER_GLOB,
  AnchoredFolder,
  NO_ANCHORED_WORKSPACE_MESSAGE,
  findAllAnchoredFolders,
} from './workspace';
import { openAuthoringReleaseConfig, createActiveReleaseMarker } from './release-actions';
import { activateOperations } from './operations';
import { activateLint, LintRunner } from './lint';
import { activateGraphView, GraphView } from './graph-view';
import { activateCatalogViews } from './catalog-views';
import { activateRegistriesView } from './registries-view';
import { resolveRelease } from './release-pick';
import { activateReleaseStatus, ReleaseStatus } from './release-status';
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
let releaseStatus: ReleaseStatus | null = null;
let graphView: GraphView | null = null;
let lintRunner: LintRunner | null = null;

// refreshGraphView re-renders an open topology graph after the language server
// reports new diagnostics. The server reports per file, so a build that touches
// several produces a burst; the same window the editor already uses to collapse
// a burst of edits into one validation collapses this into one re-render, and
// reads the setting on each call so a change to it takes effect without a
// restart. When no graph is open the callback finds nothing to do.
const refreshGraphView = debounce(
  () => graphView?.refresh(),
  () => getSettings().debounceMs,
);

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extensionContext = context;
  outputChannel = vscode.window.createOutputChannel('Aggrega');
  context.subscriptions.push(outputChannel);

  // Always register the switch-anchor command so the Command
  // Palette surfaces it regardless of the activation outcome.
  registerSwitchAnchorCommand(context);
  registerReleaseActionCommands(context);

  // The conventions linter owns its own diagnostic collection, separate from
  // the language server's, so a validate never drops a lint finding and a lint
  // run never erases a validation result. Created before the operation surface
  // because the lint operation invokes it.
  lintRunner = activateLint(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    getBinaryPath: () => getSettings().binaryPath,
    output: outputChannel,
  });

  // The operation surface (activity-bar Operations view + commands) is
  // available regardless of daemon state: CLI-backed operations scope to the
  // anchored root once it is known, and validate reports when no file or
  // daemon is available. The getters read live state so the surface tracks the
  // root the daemon later attaches to.
  activateOperations(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    getBinaryPath: () => getSettings().binaryPath,
    output: outputChannel,
    validateActiveDocument,
    listReleases: requestReleaseCandidates,
    runLint: () => lintRunner?.run() ?? Promise.resolve(),
  });

  // The topology-graph view renders the compiled IR of a chosen Release. It is
  // daemon-backed (irGraph + releaseCandidates); the getters read live state.
  graphView = activateGraphView(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    listReleases: requestReleaseCandidates,
    requestIrGraph: async (release: string) => {
      if (!daemon || daemon.getState() !== DaemonState.Running) {
        throw new Error('the Aggrega language server is not running');
      }
      const result = await daemon.request<{ graph: unknown }>('aggrega/irGraph', { release });
      return result.graph;
    },
    output: outputChannel,
  });

  // The plugins tree and published-catalog search are CLI-backed (plugin list
  // -o json, search -o json), independent of daemon state.
  activateCatalogViews(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    getBinaryPath: () => getSettings().binaryPath,
    output: outputChannel,
  });

  // The registries tree is CLI-backed (registry list -o json), independent of
  // daemon state. The command reads the resolved configuration and contacts no
  // registry, so a refresh costs nothing over the network.
  activateRegistriesView(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    getBinaryPath: () => getSettings().binaryPath,
    output: outputChannel,
  });

  // The active-Release status-bar indicator renders the daemon's own answer,
  // so it shows the Release the compiler will act on; refresh() is driven from
  // daemon (re)start below.
  releaseStatus = activateReleaseStatus(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    requestActiveRelease,
    createStatusBarItem: () =>
      vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99),
    // The marker is watched but never read: an edit to it means the daemon's
    // answer may be about to change, so the indicator re-asks the daemon.
    watchActiveReleaseMarker: (onChange) => {
      const watcher = vscode.workspace.createFileSystemWatcher(ACTIVE_RELEASE_MARKER_GLOB);
      watcher.onDidChange(onChange);
      watcher.onDidCreate(onChange);
      watcher.onDidDelete(onChange);
      return watcher;
    },
  });
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
    // The same notification drives two surfaces: the editor's diagnostics, and
    // the topology graph — the server has recompiled, so an open graph is
    // showing a topology that may no longer be the current one.
    refreshGraphView();
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
  releaseStatus?.refresh();
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
  releaseStatus?.hide();
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

// registerReleaseActionCommands wires the two action commands the
// release-not-resolved (1002) toast dispatches to. Registered at
// activation so the Command Palette surfaces them regardless of
// daemon state — invoking either command without an anchored
// workspace surfaces an informational toast rather than crashing.
function registerReleaseActionCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('aggrega.workspace.openAuthoringReleaseConfig', async () => {
      if (!workspaceRootForCommands) {
        void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
        return;
      }
      await openAuthoringReleaseConfig(workspaceRootForCommands);
    }),
    vscode.commands.registerCommand('aggrega.workspace.createActiveReleaseMarker', async () => {
      if (!workspaceRootForCommands) {
        void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
        return;
      }
      let candidates: string[];
      try {
        candidates = await requestReleaseCandidates();
      } catch {
        void vscode.window.showErrorMessage(
          'Aggrega: cannot list Release candidates — the language server is not running. Start it and try again.',
        );
        return;
      }
      await createActiveReleaseMarker(workspaceRootForCommands, candidates);
    }),
  );
}

export async function deactivate(): Promise<void> {
  if (daemon) {
    await daemon.stop();
    daemon = null;
  }
}

// validateActiveDocument runs the serve-backed validate on the active YAML
// document on demand (the Operations view's Validate action), publishing its
// diagnostics through the same collection the proactive lifecycle validate
// uses. Validate is a language-server operation, not a CLI subprocess, so it
// stays on the daemon path rather than spawning the binary.
async function validateActiveDocument(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'yaml') {
    void vscode.window.showInformationMessage('Aggrega: open a YAML file to validate.');
    return;
  }
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    void vscode.window.showWarningMessage('Aggrega: the language server is not running.');
    return;
  }
  const doc = editor.document;
  try {
    const response = await daemon.request<ValidateResponse>('aggrega/validate', {
      file: doc.uri.fsPath,
      content: doc.getText(),
    });
    if (diagnosticCollection) {
      publishDiagnostics(diagnosticCollection, doc.uri, response.diagnostics ?? []);
    }
    outputChannel?.appendLine(`validated ${doc.uri.fsPath}`);
  } catch (err) {
    outputChannel?.appendLine(`validate failed: ${describeError(err)}`);
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
// `version -o json` and applies the policy from version-check.ts.
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
  const root = workspaceRootForCommands;
  return {
    uri,
    workspaceRoot: root,
    publishShape: (u: vscode.Uri, shapes: Parameters<typeof publishShapes>[2]) =>
      publishShapes(collection, u, shapes),
    logLine: (line: string) => channel.appendLine(line),
    toastInfo: (message: string, ...items: string[]) =>
      vscode.window.showInformationMessage(message, ...items),
    createTerminal: (options: vscode.TerminalOptions) =>
      vscode.window.createTerminal(options),
    executeCommand: (command: string) =>
      vscode.commands.executeCommand(command),
    scanCandidateReleases: async (): Promise<boolean> => {
      // Whether the workspace has any Release the daemon would offer. The 1002
      // path that calls this already presupposes a running daemon (Release
      // resolution failed, which requires the daemon to have run), so a
      // not-running daemon means no candidates to surface — return false rather
      // than scanning by filename, which would diverge from the daemon.
      try {
        const candidates = await requestReleaseCandidates();
        return candidates.length > 0;
      } catch {
        return false;
      }
    },
    resolveRelease: () => resolveRelease(requestReleaseCandidates, {
      placeHolder: 'Aggrega: choose the Release to pull',
    }),
    toastDebounce,
    toastDebounceMode: settings.toastDebounceMode,
    toastThrottleSeconds: settings.toastThrottleSeconds,
    now: () => Date.now(),
  };
}

// requestReleaseCandidates asks the daemon for the workspace's Release set —
// the content-kind (`kind: Release`) walk. The extension performs no Release
// detection of its own; this is the single source. Throws when the daemon is
// not running so callers surface a clear message rather than silently falling
// back to a filename heuristic (which would reintroduce the very divergence
// between the editor's candidates and the daemon's resolution this removes).
async function requestReleaseCandidates(): Promise<string[]> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega daemon is not running');
  }
  const resp = await daemon.request<ReleaseCandidatesResponse>('aggrega/releaseCandidates', {});
  return resp.releases;
}

// requestActiveRelease asks the daemon which Release it resolved for the
// workspace — the answer the daemon itself acts on. The extension derives no
// answer of its own: an input to the daemon's resolution (the marker file, say)
// names a different Release whenever a higher-precedence input won, so reading
// one here would display a Release the compiler is not using. Resolves to the
// empty string when the workspace has no active Release, and throws when the
// daemon is not running so the indicator shows the answer as unknown rather
// than falling back to a local guess.
async function requestActiveRelease(): Promise<string> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega daemon is not running');
  }
  const resp = await daemon.request<ActiveReleaseResponse>('aggrega/activeRelease', {});
  return resp.release;
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
