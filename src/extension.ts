// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { Daemon, DaemonState } from './daemon';
import { debounce } from './debounce';
import {
  SourcedCollections,
  clearUriInEverySource,
  createSourcedCollections,
  publishDiagnostics,
  publishShapes,
} from './diagnostics';
import { DIAGNOSTIC_SOURCE_FALLBACK } from './diagnostics-shape';
import {
  describeError,
  handleDaemonError,
  isJsonRpcError,
  resetSessionDedup,
} from './error-surfaces';
import {
  notifyDaemonStartupFailed,
  notifyStoppedResponding,
  promptCacheMiss,
} from './notifications';
import { Readiness, createReadiness } from './readiness';
import { getSettings } from './settings-vscode';
import {
  BUILD_ON_INSPECT_KEY,
  BUILD_ON_INSPECT_MENU_LABEL,
  ConfigScope,
  DEFAULT_SETTINGS,
  SERVER_CONFIG_SECTION,
  buildOnInspectConfirmation,
  buildOnInspectMenuDescription,
  scopeForSettingWrite,
} from './settings';
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
  BuildPreviewResponse,
  BuildResponse,
  DaemonLocation,
  ERR_FILE_NOT_VALIDATED,
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
import { activateWorkspaceCatalogView } from './workspace-catalog-view';
import { CatalogIndexDoc } from './workspace-catalog-run';
import { ReleaseSelection, createReleaseSelection } from './release-selection';
import { buildValidateParams } from './validate-request';
import { SELECT_RELEASE_COMMAND, activateReleaseStatus, ReleaseStatus } from './release-status';
import {
  STATE_KEY,
  buildPickerItems,
  classifyActivation,
  readSavedAnchor,
} from './anchor-picker';

let daemon: Daemon | null = null;
let outputChannel: vscode.OutputChannel | null = null;
// diagnosticCollections holds one collection per compiler layer, so each layer
// publishes and clears its own findings independently. Created on first anchor.
let diagnosticCollections: SourcedCollections | null = null;
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
// releaseSelection is the editor's one answer to "which Release are we talking
// about". Every surface that acts on a Release reads it, and it travels on
// every request, so the language server holds none of its own and changing the
// selection needs no restart.
let releaseSelection: ReleaseSelection | null = null;
// readiness is the editor's one answer to "can the compiler be asked yet", and
// every view renders from it. Built in activate() before any surface that reads
// it, and driven from the single lifecycle subscription in ensureDaemonAt.
let readiness: Readiness | null = null;

// selectedRelease is the workspace-relative Release every request carries, or
// null when none is selected.
function selectedRelease(): string | null {
  return releaseSelection?.current() ?? null;
}

// isLanguageServerRunning reports whether the server can be asked right now.
// Written once so the surfaces that gate on it and the readiness state cannot
// come to disagree about what "running" means.
function isLanguageServerRunning(): boolean {
  return daemon?.getState() === DaemonState.Running;
}

// requireSelectedRelease tells the reader that an operation needs a Release and
// offers the one way to select one. Written once here so every surface that
// needs a selection says the same thing.
function requireSelectedRelease(): void {
  const action = 'Select a Release…';
  void vscode.window.showInformationMessage(
    'Aggrega: this operation acts on a Release, and none is selected.',
    action,
  ).then(choice => {
    if (choice === action) {
      void vscode.commands.executeCommand(SELECT_RELEASE_COMMAND);
    }
  });
}

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

  // Built before any view, because a view takes the signal as a dependency and
  // subscribes as it is registered. It reads both facts through the getters
  // their owners already expose, so it holds no copy of either and cannot come
  // to disagree with what a view sees.
  const ready = createReadiness({
    getWorkspaceRoot: () => workspaceRootForCommands,
    isLanguageServerRunning,
  });
  readiness = ready;

  // The selection is built before any surface that reads it. It contacts
  // nothing here: the default is adopted once the language server connects, and
  // an explicit selection replaces it at any time after that.
  releaseSelection = createReleaseSelection({
    getWorkspaceRoot: () => workspaceRootForCommands,
    requestActiveRelease,
    listReleases: requestReleaseCandidates,
    pickRelease: async (candidates, placeHolder) => {
      const root = workspaceRootForCommands;
      const items = candidates.map(p => ({
        label: path.basename(p),
        description: root ? path.relative(root, p) : p,
        detail: p,
        absolutePath: p,
      }));
      const choice = await vscode.window.showQuickPick(items, {
        placeHolder,
        matchOnDescription: true,
        matchOnDetail: true,
      });
      return choice?.absolutePath;
    },
    reportInfo: (message) => { void vscode.window.showInformationMessage(message); },
    reportError: (message) => { void vscode.window.showErrorMessage(message); },
    logLine: (line) => outputChannel?.appendLine(line),
  });

  // Always register the switch-anchor command so the Command
  // Palette surfaces it regardless of the activation outcome.
  registerSwitchAnchorCommand(context);
  registerReleaseActionCommands(context);
  registerSelectReleaseCommand(context);

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
    selectedRelease,
    requireSelectedRelease,
    runLint: () => lintRunner?.run() ?? Promise.resolve(),
    build: requestBuild,
    previewBuild: requestBuildPreview,
    reportDaemonError,
  });

  // The topology-graph view renders the compiled IR of a chosen Release. It is
  // daemon-backed (irGraph + releaseCandidates); the getters read live state.
  graphView = activateGraphView(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    selectedRelease,
    requireSelectedRelease,
    requestIrGraph: async (release: string) => {
      if (!daemon || daemon.getState() !== DaemonState.Running) {
        throw new Error('the Aggrega language server is not running');
      }
      const result = await daemon.request<{ graph: unknown }>('aggrega/irGraph', { release });
      return result.graph;
    },
    // The label set is sent as the request's ONLY subject. The request takes
    // one subject and refuses two, and the labels the drawn graph carries are
    // the strongest of the ones it accepts — they are the finalised set, and
    // they came from this same graph, so the answer is computed over exactly
    // what the reader is looking at. Naming the node instead would have the
    // Release's graph rebuilt to look those labels back up.
    requestAttachCandidates: async (labels: Record<string, string>) => {
      if (!daemon || daemon.getState() !== DaemonState.Running) {
        throw new Error('the Aggrega language server is not running');
      }
      return await daemon.request<unknown>('aggrega/attachCandidates', { labels });
    },
    showsSensitiveValues: () => getSettings().showSensitiveValues,
    reportDaemonError,
    onReady: ready.onReady,
    output: outputChannel,
  });

  // The plugins tree and published-catalog search are CLI-backed (plugin list
  // -o json, search -o json), so they need no language server — but they do
  // need the anchored root the CLI runs in, which is not known when they are
  // registered, so they render from the readiness signal like every other view.
  activateCatalogViews(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    getBinaryPath: () => getSettings().binaryPath,
    onReady: ready.onReady,
    output: outputChannel,
  });

  // The registries tree is CLI-backed (registry list -o json). The command
  // reads the resolved configuration and contacts no registry, so a refresh
  // costs nothing over the network.
  activateRegistriesView(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    getBinaryPath: () => getSettings().binaryPath,
    onReady: ready.onReady,
    output: outputChannel,
  });

  // The workspace-catalog tree lists the entities in the open workspace,
  // grouped by kind. It is language-server-backed (catalogIndex), so it reports
  // the workspace the compiler reads rather than a set the extension walked for
  // itself; the getters read live state so the tree tracks the root the server
  // later attaches to.
  activateWorkspaceCatalogView(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    isLanguageServerRunning,
    requestCatalogIndex,
    onReady: ready.onReady,
    output: outputChannel,
  });

  // The status-bar indicator renders the editor's selected Release — the value
  // every request carries — so what the operator reads is the Release the
  // compiler is being asked about.
  releaseStatus = activateReleaseStatus(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    selectionState: () => releaseSelection?.state() ?? { kind: 'unknown' },
    createStatusBarItem: () =>
      vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99),
    onSelectionChange: (listener) => releaseSelection?.onChange(listener),
  });

  // The marker is watched but never read. It is this workspace's persisted
  // default, so an edit to it changes what a session STARTS on and not what
  // this one is acting on: a selection already in force is left alone, because
  // moving it under the reader would be a third way for the selection to
  // change. The one case worth reacting to is a workspace that offered nothing
  // at connect time and now has a default to offer — there is no selection to
  // disturb, so the default is adopted.
  context.subscriptions.push(
    watchActiveReleaseMarker(() => {
      if (releaseSelection?.current()) { return; }
      void adoptDefaultRelease();
    }),
  );

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
  // The root is one of the two facts readiness is made of, so it is reported as
  // it changes. Today it always settles before the server can reach a state
  // where anything is answerable, which makes this quiet; reporting it anyway
  // is what keeps that ordering from being load-bearing.
  readiness?.reassess();

  diagnosticCollections ??= createSourcedCollections(
    disposable => context.subscriptions.push(disposable),
  );

  daemon = new Daemon(getSettings(), msg => outputChannel?.appendLine(msg));
  daemon.on('stoppedResponding', () => notifyStoppedResponding());
  daemon.on('stateChange', (next) => {
    if (next === DaemonState.Running || next === DaemonState.Restarting) {
      resetSessionDedup(toastDebounce);
    }
    // THE EXTENSION'S ONE SUBSCRIPTION TO THE SERVER'S LIFECYCLE. Every surface
    // that needs to know whether the compiler can be asked reads the readiness
    // state this drives, so a second listener is not to be added here or
    // anywhere else: it would be a second answer to one question, and the
    // surface written after it would derive a third.
    readiness?.reassess();
  });
  daemon.on('notification:aggrega/publishDiagnostics', (params: PublishDiagnosticsParams) => {
    // The same notification drives two surfaces: the editor's diagnostics, and
    // the topology graph — the server has recompiled, so an open graph is
    // showing a topology that may no longer be the current one.
    refreshGraphView();
    if (!diagnosticCollections) { return; }
    const uri = vscode.Uri.file(params.file);
    publishDiagnostics(diagnosticCollections, uri, params.diagnostics);
  });

  const anchorContext = currentAnchored.length >= 2
    ? { active: target, anchored: currentAnchored }
    : undefined;
  statusBarItem = createAggregaStatusBar(context, daemon, anchorContext);

  if (!lateInitDone) {
    registerRestartCommand(context);
    registerBuildOnInspectToggle(context);
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
  // The default is adopted once per connection, which is the first of the two
  // ways the selection is ever set. The second is the reader choosing one.
  await adoptDefaultRelease();
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
  // The selection is dropped with the connection it was resolved against, so a
  // daemon attaching to a different root does not inherit the previous
  // workspace's answer.
  releaseSelection?.forget();
  releaseStatus?.hide();
}

// watchActiveReleaseMarker registers a callback against edits to the
// workspace's active-release marker and returns the watcher's disposable.
function watchActiveReleaseMarker(onChange: () => void): vscode.Disposable {
  const watcher = vscode.workspace.createFileSystemWatcher(ACTIVE_RELEASE_MARKER_GLOB);
  watcher.onDidChange(onChange);
  watcher.onDidCreate(onChange);
  watcher.onDidDelete(onChange);
  return watcher;
}

// adoptDefaultRelease asks the language server what this workspace points at
// and takes that as the selection. Run once per connection, and again only when
// nothing is selected — an explicit selection is never overwritten by it.
async function adoptDefaultRelease(): Promise<void> {
  await releaseSelection?.adoptDefault();
  releaseStatus?.refresh();
}

// registerSelectReleaseCommand wires the one command that changes the
// selection. The status-bar indicator runs it on click, and the Command Palette
// surfaces it, so there is one way to choose a Release and one place the
// current choice is displayed.
function registerSelectReleaseCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(SELECT_RELEASE_COMMAND, async () => {
      if (!workspaceRootForCommands) {
        void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
        return;
      }
      const chosen = await releaseSelection?.choose();
      if (!chosen) { return; }
      // Nothing is restarted. The selection travels on the next request, so the
      // change is in force immediately.
      outputChannel?.appendLine(`selected Release: ${chosen}`);
      void revalidateOpenDocuments();
    }),
  );
}

// revalidateOpenDocuments re-validates every open YAML document against the
// selection that is now in force. Without this the Problems panel would go on
// showing findings computed against the previous Release until each file
// happened to be edited, which reads as the new selection having no effect.
function revalidateOpenDocuments(): void {
  if (!daemon || daemon.getState() !== DaemonState.Running) { return; }
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.languageId !== 'yaml') { continue; }
    void validateDocument(doc);
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

// registerReleaseActionCommands wires the two commands that record a Release as
// a workspace default. Neither selects a Release for the session in progress —
// that is the select command's job — and the split is deliberate: choosing what
// to work on now and recording what to start on next are different acts, and
// collapsing them would take away the ability to do either without the other.
//
// One writes the workspace's local marker; the other opens the configuration
// file, which is the shared, committed default and outranks the marker.
//
// Registered at activation so the Command Palette surfaces them regardless of
// language-server state — invoking either without an anchored workspace
// surfaces an informational toast rather than crashing.
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
      await createActiveReleaseMarker(workspaceRootForCommands, selectedRelease());
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
    const response = await daemon.request<ValidateResponse>(
      'aggrega/validate',
      validateParamsFor(doc),
    );
    if (diagnosticCollections) {
      publishDiagnostics(diagnosticCollections, doc.uri, response.diagnostics ?? []);
    }
    outputChannel?.appendLine(`validated ${doc.uri.fsPath}`);
  } catch (err) {
    outputChannel?.appendLine(`validate failed: ${describeError(err)}`);
  }
}

// validateParamsFor composes the aggrega/validate request for a document
// against the current selection. The composition rule itself lives in
// validate-request.ts, which needs no editor and is therefore driven directly
// against a running language server by the tests.
function validateParamsFor(doc: vscode.TextDocument): ValidateParams {
  return buildValidateParams(doc.uri.fsPath, doc.getText(), selectedRelease());
}

// validateDocument runs the language server's validate on one document and
// publishes what comes back. It is the single path every proactive validation
// takes — document open, debounced change, the startup sweep, and the sweep
// that follows a change of selection — so none of them can drift into sending a
// different request than the others.
function validateDocument(doc: vscode.TextDocument): void {
  if (!daemon || daemon.getState() !== DaemonState.Running) { return; }
  if (doc.languageId !== 'yaml') { return; }
  daemon.request<ValidateResponse>('aggrega/validate', validateParamsFor(doc)).then(
    response => {
      if (diagnosticCollections) {
        publishDiagnostics(diagnosticCollections, doc.uri, response.diagnostics ?? []);
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
}

function registerDocumentLifecycle(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(validateDocument),
  );

  const debouncedValidate = debounce(
    (doc: vscode.TextDocument) => validateDocument(doc),
    () => getSettings().debounceMs,
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => debouncedValidate(e.document)),
  );

  for (const doc of vscode.workspace.textDocuments) {
    validateDocument(doc);
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
      if (diagnosticCollections) {
        clearUriInEverySource(diagnosticCollections, doc.uri);
      }
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

// registerBuildOnInspectToggle exposes the toggle in the command palette. The
// status-bar quick-action menu offers the same action; both run the one
// implementation, so the two surfaces cannot diverge.
function registerBuildOnInspectToggle(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(
    'aggrega.server.toggleBuildOnInspect',
    () => toggleBuildOnInspect(),
  ));
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
      {
        label: BUILD_ON_INSPECT_MENU_LABEL,
        description: buildOnInspectMenuDescription(getSettings().buildOnInspect),
      },
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
      case BUILD_ON_INSPECT_MENU_LABEL:
        await toggleBuildOnInspect();
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

// toggleBuildOnInspect flips the buildOnInspect setting in place: it reads the
// effective value, writes the opposite, and says what happened. The setting is
// the only home for the choice — nothing here keeps a copy — so this toggle and
// the settings UI cannot disagree about the state.
//
// The write targets whichever configuration layer already holds an explicit
// value, innermost first, so flipping changes the value the editor is actually
// applying instead of an outer layer a nearer one keeps overriding.
// scopeForSettingWrite owns that rule and is tested without the editor.
async function toggleBuildOnInspect(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(SERVER_CONFIG_SECTION);
  const current = cfg.get<boolean>(BUILD_ON_INSPECT_KEY, DEFAULT_SETTINGS.buildOnInspect);
  const next = !current;
  const scope = scopeForSettingWrite(
    cfg.inspect<boolean>(BUILD_ON_INSPECT_KEY),
    (vscode.workspace.workspaceFolders?.length ?? 0) > 0,
  );
  try {
    await cfg.update(BUILD_ON_INSPECT_KEY, next, configurationTargetFor(scope));
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Aggrega: the setting could not be changed. ${describeError(err)}`,
    );
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    buildOnInspectConfirmation(next),
    'Restart server',
  );
  if (choice === 'Restart server') {
    void vscode.commands.executeCommand('aggrega.server.restart');
  }
}

// configurationTargetFor maps the layer the pure rule chose onto the editor's
// own enum. Kept apart from the rule so the decision stays testable and only
// this translation needs the editor.
function configurationTargetFor(scope: ConfigScope): vscode.ConfigurationTarget {
  switch (scope) {
    case 'workspaceFolder':
      return vscode.ConfigurationTarget.WorkspaceFolder;
    case 'workspace':
      return vscode.ConfigurationTarget.Workspace;
    case 'global':
      return vscode.ConfigurationTarget.Global;
  }
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

// reportDaemonError routes a thrown value to the per-code error surfaces when
// it is a daemon error envelope, and reports whether it did. It is the entry
// point for a surface that has no document of its own to hang a failure on —
// the topology graph, whose subject is a Release rather than the file in the
// active editor.
//
// Which document a diagnostic lands on is read off the envelope's own
// artifact fields and never off its code. Each of those fields names one
// artifact and only that artifact, so the first one present IS the document
// the failure is about; branching on the code to decide would re-derive, from
// a second source, something the payload already states. fallbackPath covers
// an envelope that names no artifact at all, and the caller supplies its own
// subject for it.
//
// A relative value resolves against the anchored root, matching the form the
// daemon accepts and returns.
function reportDaemonError(err: unknown, fallbackPath: string): boolean {
  if (!isJsonRpcError(err) || !workspaceRootForCommands) {
    return false;
  }
  // Truthiness rather than ?? on purpose: an empty path names no document, so
  // it must fall through to the next candidate instead of resolving to the
  // workspace root itself.
  const named = err.data?.file || err.data?.lockfile || fallbackPath;
  if (!named) {
    return false;
  }
  const absolute = path.isAbsolute(named)
    ? named
    : path.join(workspaceRootForCommands, named);
  const ctx = buildErrorContext(vscode.Uri.file(absolute));
  return ctx !== null && handleDaemonError(err, ctx);
}

function buildErrorContext(uri: vscode.Uri) {
  if (!diagnosticCollections || !outputChannel || !workspaceRootForCommands) {
    return null;
  }
  // The error surfaces report on the authored documents, so their shapes belong
  // to the document-validation layer's collection — the same one that layer's
  // own diagnostics land in.
  const collection = diagnosticCollections.for(DIAGNOSTIC_SOURCE_FALLBACK);
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
    selectedRelease,
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

// requestActiveRelease asks the language server which Release this workspace
// points at by default. The extension derives no answer of its own: an input to
// that reading (the marker file, say) names a different Release whenever a
// higher-precedence input won, so consulting one here would start the reader on
// a Release the compiler would not have chosen.
//
// The answer carries the empty path when the workspace offers none, together
// with the server's own account of why — which is where the explanation for an
// unresolved workspace now travels, on an ordinary answer rather than on a
// failed request. Throws when the server is not running, so the selection
// reports the answer as unknown rather than falling back to a local guess.
async function requestActiveRelease(): Promise<ActiveReleaseResponse> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega daemon is not running');
  }
  return await daemon.request<ActiveReleaseResponse>('aggrega/activeRelease', {});
}

// requestBuildPreview asks the language server what a build of the given
// Release would emit. The server runs the same computation a build runs, with
// every gate on, and writes none of the result — so a refusal here is a refusal
// a build would reach, and the answer names the artifacts a build would write.
//
// The findings that carry a document position do not come back through this
// call: the server publishes them on its diagnostic channel, so they land in the
// Problems panel through the same path every other server finding takes. What
// returns is the artifact list and the advisories that name no position.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting an empty preview as a Release that renders nothing.
async function requestBuildPreview(release: string): Promise<BuildPreviewResponse> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<BuildPreviewResponse>('aggrega/buildPreview', { release });
}

// requestBuild asks the language server to build the given Release and write
// the artifacts it renders. The server runs the same computation the preview
// runs, with every gate on, and writes the result into the workspace's output
// directory — so a refusal here is a refusal a command-line build would reach,
// and a success puts the same files on disk that one would.
//
// The findings that carry a document position do not come back through this
// call: the server publishes them on its diagnostic channel, so they land in the
// Problems panel through the same path every other server finding takes. What
// returns is where the build wrote, what it wrote there, and the advisories that
// name no position.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting a build that never ran as one that produced nothing.
async function requestBuild(release: string): Promise<BuildResponse> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<BuildResponse>('aggrega/build', { release });
}

// requestCatalogIndex asks the language server for the open workspace's entity
// index — kind, name, apiVersion, description, labels and source file for every
// Aggrega document under the workspace root. The extension performs no
// workspace walk of its own; this is the single source, for the same reason
// Release detection is: a second walk would report a set the compiler is not
// using whenever the two disagreed, and nothing would report the disagreement.
// Throws when the server is not running, so a caller surfaces that state rather
// than showing an empty workspace.
async function requestCatalogIndex(): Promise<CatalogIndexDoc> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<CatalogIndexDoc>('aggrega/catalogIndex', {});
}

async function handleCacheMiss<T>(method: string, params: unknown, doc: vscode.TextDocument): Promise<T | null> {
  if (!daemon) { return null; }
  const settings = getSettings();
  if (!settings.autoRevalidate) {
    const decision = await promptCacheMiss(path.basename(doc.uri.fsPath));
    if (decision !== 'revalidate') { return null; }
  }
  try {
    // The re-seed carries the selected Release for the same reason every other
    // validate does: it repopulates the caches the retried request reads, and a
    // document-only seed would repopulate them from the narrower answer.
    await daemon.request<void>('aggrega/validate', validateParamsFor(doc));
    return await daemon.request<T>(method, params);
  } catch (err) {
    outputChannel?.appendLine(`cache-miss retry failed: ${describeError(err)}`);
    return null;
  }
}
