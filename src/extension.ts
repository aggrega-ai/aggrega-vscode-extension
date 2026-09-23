// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AttachmentContainerRequest } from './attachment-edit';
import { buildParams, buildPreviewParams } from './build-dials';
import { CancellationSignal } from './cancellation';
import type { RegistrySearchParams, SearchDoc } from './catalog-search-run';
import type { ConfigInitParams, ConfigInitResult } from './config-seeding';
import type { ImportParams, ImportResult } from './import-request';
import type { PluginAddParams, PluginAddResult } from './plugin-attachment';
import type { PluginRemoveParams, PluginRemoveResult } from './plugin-removal';
import type {
  DeprecateArtifactParams,
  DeprecateArtifactResult,
  PublishEntityParams,
  PublishEntityResult,
  SignArtifactsParams,
  SignArtifactsResult,
} from './publication-request';
import type {
  LogoutParams,
  LogoutResult,
  RegistryAddParams,
  RegistryAddResult,
  RegistryRemoveParams,
  RegistryRemoveResult,
} from './registry-configure';
import type {
  RegistryUpdateParams,
  RegistryUpdateResult,
} from './registry-index-request';
import type { RegistryListDoc } from './registries-run';
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
import {
  COMPILER_ANSWERABLE_CONTEXT_KEY,
  Readiness,
  createReadiness,
} from './readiness';
import {
  DAEMON_ACTION_DETAIL,
  DAEMON_ACTION_LABEL,
  DAEMON_ACTION_PLACEHOLDER,
  DaemonStatusBar,
  LIFECYCLE_ACTIONS_COMMAND,
  RESTART_COMMAND,
  STATUS_BAR_MENU_COMMAND,
  TOGGLE_BUILD_ON_INSPECT_COMMAND,
  createDaemonStatusBar,
  daemonStanding,
  daemonStandingAction,
} from './daemon-status';
import {
  SHOW_OUTPUT_ACTION,
  countReport,
  outcomeOf,
  terminalLine,
} from './operation-outcome';
import { withCancellableProgress } from './progress';
import { getSettings } from './settings-vscode';
import {
  BUILD_ON_INSPECT_KEY,
  BUILD_ON_INSPECT_MENU_LABEL,
  DEFAULT_SETTINGS,
  EXTENSION_ID,
  OPERATIONS_CONFIG_SECTION,
  OPERATIONS_LAYOUT_KEY,
  SERVER_CONFIG_SECTION,
  buildOnInspectConfirmation,
  buildOnInspectMenuDescription,
} from './settings';
import {
  createAggregaStatusBar,
  createLifecycleStatusBarItem,
  createPendingChoiceStatusBar,
} from './status-bar';
import { scheduleBinaryRestart, RestartHandle } from './binary-restart';
import { checkDaemonVersion, readDaemonVersion } from './version-check';
import { VersionStandings } from './welcome-render';
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
  CacheClearResponse,
  CacheEvictResponse,
  CachePruneResponse,
  CacheStatusResponse,
  DaemonLocation,
  ERR_FILE_NOT_VALIDATED,
  PublishDiagnosticsParams,
  ReleaseCandidatesResponse,
  RequestMethod,
  ScaffoldEntityResponse,
  ValidateParams,
  ValidateResponse,
} from './types';
import {
  ACTIVE_RELEASE_MARKER_GLOB,
  AnchoredFolder,
  NO_ANCHORED_WORKSPACE_MESSAGE,
  findAllAnchoredFolders,
  outputParentFor,
  windowAnchoring,
  workspacesReachedFromAll,
} from './workspace';
import { candidateFilesUnder } from './workspace-search';
import { openAuthoringReleaseConfig, createActiveReleaseMarker } from './release-actions';
import { activateOperations, OperationsView } from './operations';
import { activateLint, LintRunner } from './lint';
import { LintAnswer, LintSubject, lintRequestParams } from './lint-run';
import { activateGraphView, GraphView } from './graph-view';
import { activateCatalogViews } from './catalog-views';
import { activateGetStarted } from './get-started';
import { CHOOSE_WORKSPACE_COMMAND } from './get-started-steps';
import { activatePluginsView } from './plugins-view';
import { activateRegistriesView } from './registries-view';
import { activateConfigPanel } from './config-view';
import { activateWorkspaceCatalogView } from './workspace-catalog-view';
import { CatalogIndexDoc } from './workspace-catalog-run';
import {
  SELECTED_RELEASE_STATE_KEY,
  SELECT_RELEASE_COMMAND,
  ReleaseSelection,
  createReleaseSelection,
} from './release-selection';
import { buildValidateParams } from './validate-request';
import { activateReleaseStatus, ReleaseStatus } from './release-status';
import {
  CHOOSE_ANCHOR_ACTION,
  CHOOSE_ANCHOR_PLACEHOLDER,
  SWITCH_ANCHOR_COMMAND,
  anchorOffers,
  anchorSwitchMessage,
  anchorsAvailableSentence,
  classifyActivation,
  readSavedAnchor,
  rememberAnchorChoice,
} from './anchor-picker';
import { SELECTOR_ROW_LABELS } from './selector-levels';
import { OPEN_ANOTHER_FOLDER_COMMAND, openWorkspaceRootInvocation } from './selector-rows';
import { FoldersTold, tellWorkspaceAboveIfDue } from './workspace-above';
import {
  CHOOSE_PROJECT_FOLDER_COMMAND,
  CHOOSE_PROJECT_FOLDER_PLACEHOLDER,
  isSavedProjectFolderValid,
  projectFolderInForce,
  projectFolderOffers,
  projectFolderSwitchMessage,
  readSavedProjectFolder,
  rememberProjectFolderChoice,
} from './project-folder';

let daemon: Daemon | null = null;
let outputChannel: vscode.OutputChannel | null = null;
// diagnosticCollections holds one collection per compiler layer, so each layer
// publishes and clears its own findings independently. Created on first anchor.
let diagnosticCollections: SourcedCollections | null = null;
// workspaceRootForCommands is the Aggrega workspace root the language server
// was started at, or null when none is in use.
//
// It is the root the marker sits in, climbed to from the folder the editor
// opened, and it is the value the handshake declares. The server pins to what
// it is handed, so this is what every request resolves a path against and what
// the workspace's own declared settings and catalog locations are read from —
// which is why every surface here that converts a relative path, writes into
// the workspace, or names the workspace to a reader takes this one.
//
// 🔴 IT IS CLEARED WHENEVER THE SERVER IS TAKEN DOWN DELIBERATELY, AND LEFT
// STANDING WHEN ONE STOPS ON ITS OWN, AND THAT ASYMMETRY IS THE POINT. A
// deliberate teardown happens exactly where the evaluation of the open folders
// has concluded that nothing is in use — no workspace reachable, or several
// with none chosen — so retaining the root there would leave every surface
// naming a workspace the editor is no longer working in. A server that crashes,
// exits, or fails to start changes none of that: the reader's workspace is
// still chosen and it is the SERVER that is absent, which the lifecycle
// indicator reports and this value must not pretend to. Clearing it there
// would make a dozen commands refuse with "no Aggrega workspace is available"
// when one plainly is.
let workspaceRootForCommands: string | null = null;
// openedProjectFolder is the folder the editor has open that the workspace
// above was reached from, or null when none is in use.
//
// 🔴 IT IS A SECOND FACT AND NOT A SECOND COPY. It differs from the root
// whenever the marker sits above the folder, which is the ordinary case for a
// window opened on a subdirectory, and the Project folder row is the one
// surface that wants it: a reader asking which folder this window has open is
// asking about the editor, not about Aggrega. Nothing resolves a path against
// it — a request's paths are the server's, and the server resolves them against
// the root it was handed.
//
// Its lifetime is the root's, assigned and cleared in the same two places for
// the same reasons, so the two rows cannot come to describe different moments.
let openedProjectFolder: string | null = null;
// chosenProjectFolder is the open folder the reader works FROM, or null where
// they have not chosen and no sole candidate settled it.
//
// 🔴 IT IS A DECISION AND openedProjectFolder ABOVE IS AN OUTCOME, WHICH IS WHY
// THEY ARE TWO VALUES AND HAVE DIFFERENT LIFETIMES. That one is settled by the
// anchoring and is dropped with the server it was settled for. This one is the
// reader's answer, it is what the middle level's candidates are computed from,
// and it survives the server stopping — a choice cleared because a language
// server went down would be an answer the reader gave being thrown away by
// something that has nothing to do with it.
//
// It holds the path in force rather than the remembered path: the two differ
// while a window remembers a folder it no longer has open, and every surface
// wants the first.
let chosenProjectFolder: string | null = null;
// foldersTold is which folders this window has already interrupted the reader
// about, because the Aggrega workspace sits above them.
//
// 🔴 IT IS MADE ONCE, HERE, AND DIES WITH THE WINDOW. It is held in memory by the
// extension host, which a reload and a relaunch both replace, so a new window
// tells the reader again unless they asked it not to — and their asking is the
// one part that is kept, in the window's store. Made anywhere a folder change
// reaches instead, it would be emptied every time the reader opened another
// folder, and the same account would interrupt them again inside one window.
const foldersTold = new FoldersTold();
// folderEvaluation counts re-evaluations of the open folders, so an answer that
// arrives from the editor's file search can tell whether it is still about the
// window it was asked for. The search outlives the evaluation that started it,
// and a stale answer applied over a newer one would report a population the
// window no longer has.
let folderEvaluation = 0;
const toastDebounce = new Map<number, true | number>();
let pendingRestart: RestartHandle | null = null;
let pendingRestartRemaining = 0;
let statusBarItem: vscode.StatusBarItem | null = null;
let baseStatusBarText = '';
let pendingChoiceItem: vscode.StatusBarItem | null = null;
// daemonStatusBar reports whether the language server is running at all. It is
// created at activation and outlives every daemon, because the state it exists
// to report is the one in which there is no daemon to hang it off.
let daemonStatusBar: DaemonStatusBar | null = null;
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
let operationsView: OperationsView | null = null;
// refreshGetStarted re-reads the conditions the welcome panel reports. It is
// called at the end of every re-evaluation of the open folders, because the
// readiness signal the other views render from announces itself only when a
// workspace root and an answerable language server are both in hand — so a
// workspace that is anchored but whose compiler will not start would otherwise
// never publish the one condition it has met.
let refreshGetStarted: (() => void) | null = null;

// anchoredWorkspaceRoot is the folder the language server reported having
// anchored to, or null before it has reported one.
//
// It is read from the server's own handshake answer rather than derived here,
// and that is the whole point of keeping it: workspaceRootForCommands above is
// what this extension COMPUTED and declared, while this is what the server
// REPORTED back having anchored at. The server pins to what it is handed, so
// the two name one directory — and reading the answer rather than assuming it
// is what would let a disagreement be seen instead of hidden. It is this one
// that every Release path is converted against, because it is the root the
// server both enumerates over and resolves requests against.
function anchoredWorkspaceRoot(): string | null {
  return daemon?.getServerInitMetadata()?.workspaceRoot ?? null;
}

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

// refreshGraphView re-renders an open topology graph after a document it could
// have been drawn from changes on disk. A save touching several files produces a
// burst; the same window the editor already uses to collapse a burst of edits
// into one validation collapses this into one re-render, and reads the setting
// on each call so a change to it takes effect without a restart. When no graph
// is open the callback finds nothing to do.
//
// 🔴 WHAT MAY CALL THIS IS PART OF ITS CONTRACT, and the rule is causal rather
// than about cost. A refresh asks the compiler for a graph, and that request
// makes the compiler report what it found — so anything driven BY such a report
// must not call this, or the panel becomes both the cause and the consumer of
// its own refresh and recompiles the workspace until it is closed. Disk is the
// right trigger because the compiler reads the graph off disk: the drawing goes
// stale exactly when a document there changes, and never because the compiler
// said something about a compile this panel asked for.
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

  // THE ONE PUBLISHER OF THE READINESS CONDITION, and it computes nothing. It
  // hands the editor the answer the readiness state already holds, so a
  // command's availability is decided by the same fact every view renders from
  // rather than by a second reading taken in a manifest clause's own terms.
  // Both edges are published: a condition left true after the compiler stops
  // being answerable leaves a command enabled that cannot run, which is the
  // enabled-but-inert control this whole arrangement exists to remove.
  ready.onChange((answerable) => {
    void vscode.commands.executeCommand(
      'setContext',
      COMPILER_ANSWERABLE_CONTEXT_KEY,
      answerable,
    );
  });

  // Registered here rather than when a language server attaches, which is the
  // defect this replaces: the command that starts one is needed precisely in
  // the workspace where none has attached, and a command that does not exist is
  // not in the palette to be found. What decides whether a reader may run one
  // is the condition above, declared in the manifest — so an unavailable
  // command is greyed where they can see it rather than absent where they
  // cannot.
  registerRestartCommand(context);
  registerLifecycleActionsCommand(context);
  registerBuildOnInspectToggle(context);
  registerStatusBarMenu(context);

  // The lifecycle indicator is created before any daemon and is never taken
  // down, because the state it reports most usefully is the one with no daemon
  // in it. It reads the lifecycle through the getter the client already exposes
  // and keeps no copy of it.
  daemonStatusBar = createDaemonStatusBar({
    getDaemonState: () => daemon?.getState() ?? null,
    // 🔴 WHETHER ANYTHING IS REACHABLE, NOT WHETHER ANYTHING IS IN USE. The two
    // readings this decides between are "no folder here is one Aggrega
    // recognises" and "one is and the server is not attached to it", so the
    // question is about the population and not about the current choice.
    // Reading the root in use answers the second question and prints the
    // first: a window reaching several workspaces with none chosen is told
    // there are none, and so is one whose server was stopped.
    isWorkspaceAnchored: () => currentAnchored.length > 0,
    createStatusBarItem: () => createLifecycleStatusBarItem(context),
    alarmBackground: () => new vscode.ThemeColor('statusBarItem.errorBackground'),
  });

  // The selection is built before any surface that reads it. It contacts
  // nothing here: the default is adopted once the language server connects, and
  // an explicit selection replaces it at any time after that.
  releaseSelection = createReleaseSelection({
    getWorkspaceRoot: () => workspaceRootForCommands,
    getDaemonWorkspaceRoot: anchoredWorkspaceRoot,
    // The choice is remembered per editor window and nothing about it is
    // written into the workspace. Recording what a workspace starts on for
    // everyone who opens it is a separate, explicit command with its own file.
    store: {
      read: () => {
        const v = context.workspaceState.get<unknown>(SELECTED_RELEASE_STATE_KEY);
        return typeof v === 'string' && v.length > 0 ? v : null;
      },
      write: (release) => {
        void context.workspaceState.update(
          SELECTED_RELEASE_STATE_KEY,
          release ?? undefined,
        );
      },
    },
    requestActiveRelease,
    listReleases: requestReleaseCandidates,
    pickRelease: async (candidates, placeHolder) => {
      // The path shown beside each candidate is relative to the anchored
      // folder, which is the folder the candidate list is computed against —
      // so what the reader reads is the value the request will carry.
      const root = anchoredWorkspaceRoot();
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
  registerChooseProjectFolderCommand(context);
  registerReleaseActionCommands(context);
  registerSelectReleaseCommand(context);

  // The conventions linter owns its own diagnostic collection, separate from
  // the language server's, so a validate never drops a lint finding and a lint
  // run never erases a validation result. Created before the operation surface
  // because the lint operation invokes it.
  lintRunner = activateLint(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    lint: requestLint,
    output: outputChannel,
  });

  // The operation surface (activity-bar Commands view + commands) is
  // available regardless of daemon state: each entry reports when the server is
  // not answering, and validate reports when there is no file. The getters read
  // live state so the surface tracks the root the daemon later attaches to.
  //
  // The binary path is passed for exactly one entry — the dependency resolution,
  // which stays a command because it is the one operation whose stop the request
  // surface cannot match. The reason is measured and written at its call site.
  operationsView = activateOperations(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    getAnchoredWorkspaceRoot: anchoredWorkspaceRoot,
    // The third getter is the Project folder row's, and it is separate from the
    // two above because the row's subject is separate: which folder the editor
    // has open is a question about the editor, and the rows above it answer
    // about Aggrega.
    getOpenedProjectFolder: () => openedProjectFolder,
    // The fourth getter is the reader's answer at the outer level, and it is
    // separate from the third because that one is an outcome and this one is a
    // decision. The row draws this; the row beneath it draws that.
    getChosenProjectFolder: () => chosenProjectFolder,
    selectionState: () => releaseSelection?.state() ?? { kind: 'unknown' },
    // Every number here is already maintained for other reasons and is read
    // rather than recomputed: the editor keeps the open folders,
    // currentAnchored is what every activation decision is already made from,
    // and the selection holds what the last enumeration of the workspace could
    // offer. Re-deriving any of them would be a second answer to a question
    // that already has one, and the second would be the one that went stale.
    selectorCandidates: () => ({
      projectFolders: vscode.workspace.workspaceFolders?.length ?? 0,
      aggregaWorkspaces: currentAnchored.length,
      releases: releaseSelection?.offerableCount() ?? null,
    }),
    onSelectionChange: (listener) => releaseSelection?.onChange(listener),
    onReady: ready.onReady,
    getBinaryPath: () => getSettings().binaryPath,
    output: outputChannel,
    validateActiveDocument,
    selectedRelease,
    requireSelectedRelease,
    runLint: () => lintRunner?.run() ?? Promise.resolve(),
    build: requestBuild,
    previewBuild: requestBuildPreview,
    importSource: requestImport,
    publishEntity: requestPublishEntity,
    signArtifacts: requestSignArtifacts,
    deprecateArtifact: requestDeprecateArtifact,
    reportDaemonError,
    requestCatalogIndex,
    // Asked with no kind named, which is the request that answers with the kinds
    // rather than with one kind's schema.
    entityKinds: () => requestSchema(),
    scaffoldEntity: requestScaffoldEntity,
    entityDefinition: requestEntityDefinition,
    cacheStatus: requestCacheStatus,
    cachePrune: requestCachePrune,
    cacheEvict: requestCacheEvict,
    cacheClear: requestCacheClear,
    layout: () => getSettings().operationsLayout,
    // The listener is narrowed to the one section, so an unrelated setting
    // change does not redraw a panel whose shape has not moved.
    onLayoutChange: (listener) => {
      context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
          if (event.affectsConfiguration(
            `${OPERATIONS_CONFIG_SECTION}.${OPERATIONS_LAYOUT_KEY}`,
          )) {
            listener();
          }
        }),
      );
    },
  });

  // The topology-graph view renders the compiled IR of a chosen Release. It is
  // daemon-backed (irGraph + releaseCandidates); the getters read live state.
  graphView = activateGraphView(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    selectedRelease,
    requireSelectedRelease,
    // Drawing the graph compiles the Release to its topology, so the request
    // takes the reader's signal: stopping it cancels the request at the language
    // server rather than leaving the compiler building a graph nobody is waiting
    // for. Whether an indicator is drawn is the view's decision, not this one —
    // it refreshes itself quietly on recompile, and an indicator there would be
    // a notification for something already on screen.
    requestIrGraph: async (release: string, signal?: CancellationSignal) => {
      if (!daemon || daemon.getState() !== DaemonState.Running) {
        throw new Error('the Aggrega language server is not running');
      }
      const result = await daemon.request<{ graph: unknown }>(
        'aggrega/irGraph',
        { release },
        signal,
      );
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
    // Which document an attachment for a drawn node belongs in, and the path to
    // the container inside it. The request is composed where its answer is read
    // and is sent exactly as composed, so the coordinate on the wire is the one
    // that side can be held to.
    //
    // It is the compiler that answers, and that is the whole point of the
    // request: how an Aggregate nests its components, and how a node reached
    // through a sub-aggregate is identified, are its knowledge — and a copy of
    // either here would agree until the document that mattered.
    requestAttachmentContainer: async (request: AttachmentContainerRequest) => {
      if (!daemon || daemon.getState() !== DaemonState.Running) {
        throw new Error('the Aggrega language server is not running');
      }
      return await daemon.request<unknown>('aggrega/attachmentContainer', request);
    },
    // Where an entry under a named container belongs in one authored document.
    // The request reports a position and writes nothing; the view composes the
    // text and applies it through the editor, which owns the buffer the answer
    // is computed against — the session reads what the editor is holding, so an
    // unsaved change is already part of the answer.
    requestInsertionPoint: async (file: string, container: string[]) => {
      if (!daemon || daemon.getState() !== DaemonState.Running) {
        throw new Error('the Aggrega language server is not running');
      }
      return await daemon.request<unknown>('aggrega/insertionPoint', { file, container });
    },
    showsSensitiveValues: () => getSettings().showSensitiveValues,
    reportDaemonError,
    onReady: ready.onReady,
    output: outputChannel,
  });

  // The published-catalog search is language-server-backed (search), so the
  // snapshot it reads is the one the compiler resolved for this workspace rather
  // than one this extension located. The anchored root is still read when a
  // reader runs a search rather than when the command is registered, because a
  // search that cannot be composed is reported instead of attempted.
  activateCatalogViews(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    runSearch: requestRegistrySearch,
    output: outputChannel,
  });

  // The plugins tree reads over the command line (plugin list -o json), and it
  // stays there: the compiler declines to serve that listing, because its subject
  // is the toolchain — this binary and the guest modules it can load — rather than
  // the workspace every request is about. The attachment and the removal reach the
  // language server; the one operation that remains command-backed keeps the
  // binary path.
  //
  // The anchored root is not known when the tree is registered, so it renders from
  // the readiness signal like every other view.
  activatePluginsView(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    getBinaryPath: () => getSettings().binaryPath,
    addPlugin: requestPluginAdd,
    removePlugin: requestPluginRemove,
    onReady: ready.onReady,
    output: outputChannel,
  });

  // The registries tree is language-server-backed throughout, and so is every
  // operation on it: the enumeration, the two writes to the configured set, the
  // credential removal and the index build. The enumeration reads the resolved
  // configuration and contacts no registry, so re-reading the tree costs nothing
  // over the network; the index build is the one entry here that does go out to
  // the registries, and it carries the reader's stop into that walk.
  //
  // No binary path is passed, because nothing on this surface starts a process.
  activateRegistriesView(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    runRegistryList: requestRegistryList,
    addRegistry: requestRegistryAdd,
    removeRegistry: requestRegistryRemove,
    logOutOfRegistry: requestLogout,
    updateRegistryIndex: requestRegistryUpdate,
    onReady: ready.onReady,
    output: outputChannel,
  });

  // The configuration surface is generated from the configuration schema the
  // running binary holds, joined against the configuration that binary resolved.
  // Both halves are asked for rather than read here: the schema so the surface
  // matches the contract in force, and the resolution so the reported origins
  // are the ones the compiler is acting on.
  activateConfigPanel(context, {
    getSchema: requestSchema,
    effectiveConfiguration: requestEffectiveConfiguration,
    output: outputChannel,
  });

  // The workspace-catalog tree lists the entities in the open workspace,
  // grouped by kind. It is language-server-backed (catalogIndex), so it reports
  // the workspace the compiler reads rather than a set the extension walked for
  // itself; the getters read live state so the tree tracks the root the server
  // later attaches to.
  activateWorkspaceCatalogView(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    getBinaryPath: () => getSettings().binaryPath,
    isLanguageServerRunning,
    requestCatalogIndex,
    entityDefinition: requestEntityDefinition,
    publishEntity: requestPublishEntity,
    // The conventions check on a row runs through the same runner the Commands
    // panel's whole-catalog entry uses, so both write into one collection and a
    // row press refreshes its own entity instead of standing up a second layer.
    lintEntity: (entityPath) => lintRunner?.runEntity(entityPath) ?? Promise.resolve(),
    onReady: ready.onReady,
    output: outputChannel,
  });

  // The welcome panel says what Aggrega is, then names what the extension still
  // needs in this workspace and what it already has. The editor draws it from
  // the manifest and starts this extension when it is opened, so it reaches a
  // reader whose workspace has started nothing at all; what is registered here
  // is the reading of the four conditions, the controls that satisfy them, and
  // the opening of the panel itself.
  refreshGetStarted = activateGetStarted(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    getBinaryPath: () => getSettings().binaryPath,
    isCompilerAnswering: isLanguageServerRunning,
    selectedRelease,
    // Read from the selection rather than recomputed, the same way the
    // Commands panel's rows and the status-bar indicator read it: the
    // enumeration has one owner, and a second walk would be a second answer to
    // a question that already has one.
    offerableReleases: () => releaseSelection?.offerableCount() ?? null,
    // Two of the controls change a fact the editor raises no event for — a
    // configuration file written into a folder that is already open, and a
    // binary path changed while no language server exists to watch it — so both
    // re-run the activation path rather than waiting for something that will
    // not happen.
    reanchor: () => reactivate(context),
    // A control through which the reader NAMES a folder records that answer before
    // re-attaching, so the activation path settles on the folder they chose rather
    // than on the one this window last remembered.
    rememberAnchorChoice: (anchorPath) =>
      rememberAnchorChoice(context.workspaceState, anchorPath),
    onReady: ready.onReady,
    onSelectionChange: (listener) => releaseSelection?.onChange(listener),
    seedConfiguration: requestConfigInit,
    listRegistries: requestRegistryList,
    readVersions: readRunningVersions,
    output: outputChannel,
  });

  // The status-bar indicator renders the editor's selected Release — the value
  // every request carries — so what the operator reads is the Release the
  // compiler is being asked about.
  releaseStatus = activateReleaseStatus(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    selectionState: () => releaseSelection?.state() ?? { kind: 'unknown' },
    offerableReleases: () => releaseSelection?.offerableCount() ?? null,
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
  const generation = (folderEvaluation += 1);
  const folders = [...(vscode.workspace.workspaceFolders ?? [])];

  const scope = await settleProjectFolder(context, folders);

  // 🔴 THE IMMEDIATE ANSWER IS THE WALK'S, AND NOTHING HERE WAITS ON THE
  // EDITOR'S FILE SEARCH. The walk reads a handful of directories on the way to
  // the filesystem root; the search is a glob across everything the window
  // holds. Blocking attachment on the second would make every start pay for a
  // candidate list that only a panel reads, in a window where the answer is
  // usually one. So the walk settles where the language server goes, and the
  // fuller population is completed afterwards.
  const anchored = await findAllAnchoredFolders(scope);
  currentAnchored = anchored;

  const savedAnchor = readSavedAnchor(context.workspaceState);
  if (savedAnchor !== null && !anchored.some(a => a.anchorPath === savedAnchor)) {
    // Stale saved choice — folder removed or marker deleted. Forget it
    // so the multi-prompt branch can re-fire when appropriate.
    await rememberAnchorChoice(context.workspaceState, null);
    // And say so. A remembered choice that quietly stops applying is
    // indistinguishable from one that was never remembered, and the reader
    // meets the difference at a moment they cannot connect to a previous
    // session.
    void vscode.window.showInformationMessage(
      `Aggrega: ${savedAnchor} no longer marks an ${SELECTOR_ROW_LABELS.workspace} in this project, `
      + `so the remembered choice was dropped.`,
    );
  }

  await applyActivationDecision(context, anchored);

  // Every branch above settles what the workspace root and the language server
  // now are, including the branch where the server failed to start, so this is
  // the one place from which the get-started conditions are true of all of them.
  refreshGetStarted?.();
  // And the same for the lifecycle indicator. Two of the four branches build no
  // client at all, so nothing there fires the lifecycle listener and the
  // indicator would otherwise go on reporting whatever it last saw — in the
  // workspace where what it reports matters most.
  daemonStatusBar?.refresh();
  // And the same again for the Commands panel, whose rows report how many
  // folders the window has open and how many of them Aggrega resolved a root
  // for. Both numbers are settled here and by nothing else. The branch that
  // attaches returns early when the language server is already where it
  // belongs, so a reader adding a second marker-carrying folder to a window
  // that already has a remembered choice reaches no other refresh — and the
  // panel would go on saying there was nothing else to choose between.
  operationsView?.refresh();

  // Not awaited, which is the whole point of it being a separate step.
  void completeReachableWorkspaces(context, scope, generation);

  // And the interruption last of all, because everything above has to be true of
  // the window standing behind it. It is not awaited either, and for a reason of
  // its own: a dialogue stands until the reader dismisses it, so waiting here
  // would leave every surface this function refreshes unrefreshed for as long as
  // they took to read it.
  void tellWorkspaceSitsAbove(context);
}

// tellWorkspaceSitsAbove interrupts the reader when the Aggrega workspace in
// force sits above the folder their window is open on.
//
// 🔴 IT IS AN INTERRUPTION AND NOT A NOTIFICATION, and the difference is the
// reason this exists at all. The reader's mental model is the folder they
// opened, and everything surprising downstream follows from the workspace being
// somewhere else — so a line in the status bar reaches nobody who needs it. The
// mark this leaves behind on the row is the other half: dismissing the dialogue
// must not dismiss the fact, which is why the two surfaces are separate and only
// this one can be silenced.
//
// Every sentence, every action, the decision about whether to raise it at all
// and what each answer does are composed on the side that needs no editor. What
// is here is which records it keeps — the window's store for what the reader
// says, and the one in-memory record above for what this window has told them —
// and the two statements that need the editor: putting the dialogue up, and
// handing a folder to the editor when the reader asks for it.
async function tellWorkspaceSitsAbove(context: vscode.ExtensionContext): Promise<void> {
  await tellWorkspaceAboveIfDue(
    context.workspaceState,
    foldersTold,
    {
      raise: (notice) => vscode.window.showWarningMessage(
        notice.message,
        { modal: true, detail: notice.detail },
        ...notice.actions,
      ),
      // The folder is composed through the same decision the row's own offer
      // composes through, rather than derived again here: the workspace may have
      // gone away between the dialogue going up and the reader pressing, and
      // what happens then is a question that has one answer already.
      openWorkspace: async () => {
        const opening = openWorkspaceRootInvocation(anchoredWorkspaceRoot());
        if (opening === null) { return; }
        await vscode.commands.executeCommand(opening.command, vscode.Uri.file(opening.location));
      },
    },
    anchoredWorkspaceRoot(),
    openedProjectFolder,
  );
}

// settleProjectFolder decides which open folder the editor works from and
// answers with the folders the levels beneath it are computed over.
//
// 🔴 THE ANSWER IS WHAT SCOPES THE MIDDLE LEVEL, AND THAT IS THE ONE EFFECT
// THIS CHOICE HAS. Where the reader has chosen, the Aggrega workspaces on offer
// are the ones that folder reaches; where they have not, the offer is what the
// whole window reaches. Those are the same rule asked at two scopes rather than
// a population with a filter over it, so nothing here decides which workspaces
// belong to a folder — the discovery rule does, asked from the folder named.
//
// A remembered folder the window no longer has open is forgotten and said so.
// A choice that quietly stops applying is indistinguishable from one that was
// never made, and the reader meets the difference at a moment they cannot
// connect to a previous session.
async function settleProjectFolder(
  context: vscode.ExtensionContext,
  folders: readonly vscode.WorkspaceFolder[],
): Promise<vscode.WorkspaceFolder[]> {
  const saved = readSavedProjectFolder(context.workspaceState);
  if (saved !== null && !isSavedProjectFolderValid(saved, folders)) {
    await rememberProjectFolderChoice(context.workspaceState, null);
    void vscode.window.showInformationMessage(
      `Aggrega: ${saved} is no longer open in this window, `
      + `so the remembered ${SELECTOR_ROW_LABELS.project} was dropped.`,
    );
  }
  const inForce = projectFolderInForce(
    readSavedProjectFolder(context.workspaceState),
    folders,
  );
  chosenProjectFolder = inForce?.uri.fsPath ?? null;
  return inForce === null ? [...folders] : [inForce];
}

// applyActivationDecision drives the language server and the pending-choice
// surfaces from one population of Aggrega workspaces.
//
// It is reached twice per re-evaluation — once with the walk's immediate answer
// and once with the fuller population the search completes — and it is one
// function rather than two so the two passes cannot come to dispatch the same
// decision differently. The attaching branch returns early where the server is
// already where it belongs, so the second pass costs nothing in the ordinary
// case where the population did not move.
async function applyActivationDecision(
  context: vscode.ExtensionContext,
  anchored: AnchoredFolder<vscode.WorkspaceFolder>[],
): Promise<void> {
  const decision = classifyActivation(
    anchored,
    readSavedAnchor(context.workspaceState),
  );

  switch (decision.kind) {
    case 'none':
      await tearDownPendingChoice();
      await stopDaemon();
      break;
    case 'single':
    case 'multiSaved':
      await tearDownPendingChoice();
      await ensureDaemonAt(context, decision.target);
      break;
    case 'multiPrompt':
      await stopDaemon();
      surfacePendingChoice(context, decision.anchored);
      break;
  }
}

// completeReachableWorkspaces finishes the population the walk started, once the
// editor's file search has answered.
//
// 🔴 IT RUNS AFTER ATTACHMENT AND NEVER BEFORE IT, which is what keeps a start
// from waiting on a glob. The consequence is deliberate and is the shape to
// build for: a window can attach to the one workspace the walk found and only
// afterwards learn that a second is reachable, at which point the panel reports
// two and its chooser offers both.
//
// The generation is what keeps a late answer from overwriting a newer one. The
// search outlives the evaluation that asked for it, so a window whose folders
// changed while it ran would otherwise be told about the folders it used to
// have.
async function completeReachableWorkspaces(
  context: vscode.ExtensionContext,
  scope: readonly vscode.WorkspaceFolder[],
  generation: number,
): Promise<void> {
  const reached = await workspacesReachedFromAll(scope, candidateFilesUnder);
  if (generation !== folderEvaluation) { return; }
  // Nothing is republished where the population did not move. The ordinary
  // window reaches one workspace by both routes, and a refresh there would
  // redraw every surface to report a number none of them has changed.
  if (sameWorkspaces(reached, currentAnchored)) { return; }
  currentAnchored = reached;
  await applyActivationDecision(context, reached);
  refreshGetStarted?.();
  daemonStatusBar?.refresh();
  operationsView?.refresh();
}

// sameWorkspaces reports whether two populations name the same Aggrega
// workspaces, in the same order.
//
// It compares markers rather than the folders the entries were reached from,
// because the marker is what identifies an entry — the folder is whichever of
// those that reach it came first, and a comparison on it would report a change
// where nothing about the population moved.
function sameWorkspaces<F extends { anchorPath: string }>(
  a: readonly F[],
  b: readonly F[],
): boolean {
  return a.length === b.length
    && a.every((entry, at) => entry.anchorPath === b[at].anchorPath);
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
  const action = CHOOSE_ANCHOR_ACTION;
  const choice = await vscode.window.showInformationMessage(
    `Aggrega: ${anchorsAvailableSentence(count)} Choose one to start the language server.`,
    action,
  );
  pendingToastShown = false;
  if (choice === action) {
    void vscode.commands.executeCommand(SWITCH_ANCHOR_COMMAND);
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
  // Both facts are taken together, from the one module that owns them. The
  // server is started at the workspace root and the opened folder is kept
  // beside it, because a window opened on a subdirectory has two true answers
  // to "where are we" and every surface below has to say which it means.
  const anchoring = windowAnchoring(target);

  // The guard compares OPENED FOLDERS, not roots, and deliberately. Two open
  // folders under one marker climb to the same root, so comparing roots would
  // make choosing the other one a no-op — leaving the Project folder row naming
  // a folder the reader has just moved away from.
  if (daemon && activeAnchored?.folder.uri.fsPath === anchoring.openedFolder) {
    return;
  }

  if (daemon) {
    // The guard above has already established that this is a different folder, so
    // the language server is about to be torn down and stood back up somewhere
    // else. The reader is told before it happens rather than left to infer it from
    // a status bar that changes: performing the restart and announcing it are
    // different things, and the surfaces they are looking at all resolve against
    // the folder that is moving.
    // The workspace root is named rather than the folder it was reached from.
    // The two differ whenever the marker sits above the folder, and what the
    // reader chose — and what every request now resolves against — is the
    // root.
    void vscode.window.showInformationMessage(
      anchorSwitchMessage(anchoring.workspaceRoot),
    );
    await stopDaemon();
  }

  await rememberAnchorChoice(context.workspaceState, target.anchorPath);
  workspaceRootForCommands = anchoring.workspaceRoot;
  openedProjectFolder = anchoring.openedFolder;
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
    // The lifecycle indicator reads the position itself rather than the
    // readiness state, because it reports three standings where readiness
    // answers yes or no — a server on its way up is not the same news as one
    // that is not there. It is still the one lifecycle, read through the
    // client's own getter, and it is refreshed from this listener rather than
    // from a second one of its own.
    daemonStatusBar?.refresh();
  });
  daemon.on('notification:aggrega/publishDiagnostics', (params: PublishDiagnosticsParams) => {
    // 🔴 THIS DRIVES THE EDITOR'S PROBLEM LIST AND NOTHING ELSE. A view that
    // re-asks the compiler must not be refreshed from here, and the topology
    // graph is one: the graph's own request produces a compile, the compile
    // reports what it found, and a refresh on that report would ask for another
    // compile — a cycle with no input at either end, turning for as long as the
    // panel stays open. What the graph is drawn from is the workspace on disk,
    // so what redraws it is a document changing there; registerFileWatcher is
    // where that is wired.
    if (!diagnosticCollections) { return; }
    const uri = vscode.Uri.file(params.file);
    // An empty finding list reaches the wire as null, and it means the same
    // thing an empty array does: this file is now clean, so clear it.
    publishDiagnostics(diagnosticCollections, uri, params.diagnostics ?? []);
  });

  const anchorContext = currentAnchored.length >= 2
    ? { active: target, anchored: currentAnchored }
    : undefined;
  statusBarItem = createAggregaStatusBar(context, daemon, anchorContext);

  // What is left behind this guard registers editor providers and watchers,
  // each of which has nothing to do without a language server and returns as
  // much when asked. The commands that used to sit here are registered when the
  // extension activates instead: a command is something a reader looks for, and
  // one that does not exist yet is one they conclude is missing.
  if (!lateInitDone) {
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
    // 🔴 THE WORKSPACE ROOT, NEVER THE OPENED FOLDER. The server pins to the
    // root it is handed rather than climbing from it, so handing it the folder
    // would put this workspace's own declared settings and catalog locations
    // outside the cascade for the whole life of the connection — and a build
    // that resolves from a terminal would then fail to resolve here.
    await daemon.start(anchoring.workspaceRoot);
  } catch (err) {
    notifyDaemonStartupFailed((err as Error).message);
    daemon = null;
    activeAnchored = null;
    return;
  }

  void runCompatibilityCheck();
  // The selection is resolved once per connection: the choice remembered for
  // this editor window where the workspace still offers it, and the
  // workspace's own default where it does not. The second of the two ways the
  // selection is ever set is the reader choosing one.
  await restoreReleaseSelection();
  // The anchored folder is only known once the handshake has answered, and the
  // rows that name it were drawn before that.
  operationsView?.refresh();
}

async function stopDaemon(): Promise<void> {
  if (daemon) {
    await daemon.stop();
    daemon = null;
  }
  activeAnchored = null;
  // Both facts go with the server they were settled for, and they are dropped
  // together: a root cleared while the folder stood would leave the Project
  // folder row naming somewhere nothing is working in while the row below it
  // reported nothing in use. Every caller of this function has either concluded
  // that nothing is in use or is about to start a server somewhere else and
  // assign both a few lines later, so there is no path on which a reader is
  // left looking at a row that names a folder nothing is working in.
  //
  // Readiness is NOT reassessed here, and that is deliberate rather than an
  // omission: it is answerable only while a server is running, the server has
  // just been stopped, and its own lifecycle listener has already reported
  // that. Dropping the root cannot move an answer that is already no, and
  // reassess() says at its declaration that the lifecycle is the one place
  // that calls it.
  workspaceRootForCommands = null;
  openedProjectFolder = null;
  if (statusBarItem) {
    statusBarItem.hide();
  }
  // The selection is dropped with the connection it was resolved against, so a
  // daemon attaching to a different root does not inherit the previous
  // workspace's answer.
  releaseSelection?.forget();
  releaseStatus?.hide();
  // The anchored folder was the daemon's to report, and there is no daemon now.
  operationsView?.refresh();
  // The client is gone, so the last position it reported is no longer what is
  // true. Refreshing after the reference is dropped is what makes the indicator
  // read the absence rather than the memory.
  daemonStatusBar?.refresh();
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

// restoreReleaseSelection takes the Release remembered for this editor window,
// re-verified against what the workspace currently offers, and falls back to
// the workspace's own default where it no longer resolves. Run once per
// connection.
async function restoreReleaseSelection(): Promise<void> {
  await releaseSelection?.restore();
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

// registerSwitchAnchorCommand wires what the workspace row opens when clicked.
//
// IT ALWAYS OPENS A CHOICE WHERE THERE IS A WORKSPACE TO CHOOSE WITHIN, and
// that is the whole shape of it. A click is the reader asking which folder the
// editor works in; answering by declining leaves them unable to tell the
// command ran at all, which is the same reason the Release selection offers a
// sole candidate rather than taking it silently. So there is no count below
// which this reports instead of offering.
//
// The one state it answers with a sentence is the one it can settle without
// measuring anything: no folder is open, so there is nothing to search through
// and nothing to add. The wording is the shared one every surface uses for that
// state, because a reader meeting it through two commands must not be told two
// different things.
//
// 🔴 IT DELIBERATELY DOES NOT ASK HOW MANY FOLDERS ARE ATTACHED BEFORE
// OFFERING, AND THAT IS THE DEFECT IT EXISTS TO NOT HAVE. Attached folders and
// the folders in the workspace Aggrega would recognise are DIFFERENT
// POPULATIONS: a workspace can have nothing attached and still hold a folder
// that would attach if it were added. A message about the first spoken as
// though it settled the second is true of a variable and false of the reader's
// situation. The widening offer measures the second population, and reports on
// it from there.
function registerSwitchAnchorCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(SWITCH_ANCHOR_COMMAND, async () => {
    if ((vscode.workspace.workspaceFolders ?? []).length === 0) {
      void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
      return;
    }
    const offers = anchorOffers(currentAnchored).map(o => ({
      label: o.label,
      description: o.description,
      detail: o.detail,
      offer: o,
    }));
    const choice = await vscode.window.showQuickPick(offers, {
      placeHolder: CHOOSE_ANCHOR_PLACEHOLDER,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!choice) { return; }
    if (choice.offer.kind === 'widen') {
      // The widening is the welcome panel's own step, reached through its
      // command rather than reimplemented: finding the folders Aggrega
      // recognises and adding one has a single home, and this is a second way
      // in rather than a second copy. It also owns the sentence for finding
      // none, which is the only place that answer can honestly be given —
      // nothing here has measured that population.
      await vscode.commands.executeCommand(CHOOSE_WORKSPACE_COMMAND);
      return;
    }
    if (!extensionContext) { return; }
    // Choosing the folder already attached lands on ensureDaemonAt's own
    // no-op guard and returns before anything is stopped, so a reader
    // confirming where they already are does not pay for a restart.
    await ensureDaemonAt(extensionContext, choice.offer.anchored);
  }));
}

// registerChooseProjectFolderCommand wires what the Project folder row opens.
//
// 🔴 IT OFFERS THE FOLDERS THE WINDOW HAS AND, LAST, THE WAY TO REACH ONE IT
// DOES NOT. Those are different acts — choosing among what is here, and bringing
// something else in — and a reader clicking the row is asking the first while
// frequently needing the second. Presenting them as one list is what keeps the
// second from being a control they have to go and find; presenting them as one
// ACTION would take the choice away from them.
//
// The choice is recorded before anything is re-evaluated, for the reason the
// workspace chooser records its own first: the re-evaluation reads the
// remembered answer, so an answer recorded afterwards arrives after the decision
// that needed it and the reader is put back where they asked to leave.
function registerChooseProjectFolderCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(CHOOSE_PROJECT_FOLDER_COMMAND, async () => {
      const folders = [...(vscode.workspace.workspaceFolders ?? [])];
      const offers = projectFolderOffers(folders).map((o) => ({
        label: o.label,
        description: o.description,
        detail: o.kind === 'other' ? o.detail : '',
        offer: o,
      }));
      const choice = await vscode.window.showQuickPick(offers, {
        placeHolder: CHOOSE_PROJECT_FOLDER_PLACEHOLDER,
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (!choice) { return; }
      if (choice.offer.kind === 'other') {
        // The editor's own command, reached rather than reimplemented: which
        // folders a window has open is the editor's to decide, and this is a
        // second way in rather than a second door.
        await vscode.commands.executeCommand(OPEN_ANOTHER_FOLDER_COMMAND);
        return;
      }
      const chosenPath = choice.offer.folder.uri.fsPath;
      if (chosenPath === chosenProjectFolder) { return; }
      await rememberProjectFolderChoice(context.workspaceState, chosenPath);
      // The change is announced because it moves what the level beneath offers,
      // and a reader who is not told cannot tell a list computed for one folder
      // from a list computed for another.
      void vscode.window.showInformationMessage(projectFolderSwitchMessage(chosenPath));
      await reactivate(context);
    }),
  );
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
// document on demand (the Commands view's Validate action), publishing its
// diagnostics through the same collection the proactive lifecycle validate
// uses. Validate is a language-server operation, not a CLI subprocess, so it
// stays on the daemon path rather than spawning the binary.
//
// It reports its finding count, and it reports it when the count is zero. A run
// that finds nothing leaves the Problems panel exactly as it was, which is
// indistinguishable from a run that never happened — so the one case where the
// panel says nothing is the one case this has to say something. The count is
// this run's own: the diagnostics that came back for this document, which is
// what a reader is looking at when they press the entry.
//
// It carries the selected Release, so the compiler runs the full resolver and
// the semantic checks rather than the document-only half — which is work
// measured in seconds on a real document, so the run is watched and can be
// stopped. Stopping it sends the language server the cancellation of this
// request, so the compiler stops rather than the editor merely stopping
// waiting.
async function validateActiveDocument(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'yaml') {
    void vscode.window.showInformationMessage('Aggrega: open a YAML file to validate.');
    return;
  }
  const client = daemon;
  if (!client || client.getState() !== DaemonState.Running) {
    void vscode.window.showWarningMessage('Aggrega: the language server is not running.');
    return;
  }
  const doc = editor.document;
  const name = path.basename(doc.uri.fsPath);
  try {
    const response = await withCancellableProgress(
      `Aggrega: validating ${name}`,
      (signal) => client.request<ValidateResponse>(
        'aggrega/validate',
        validateParamsFor(doc),
        signal,
      ),
    );
    const findings = response.diagnostics ?? [];
    if (diagnosticCollections) {
      publishDiagnostics(diagnosticCollections, doc.uri, findings);
    }
    const report = countReport(`Aggrega: validated ${name}`, findings.length, 'Problems panel');
    outputChannel?.appendLine(report);
    void vscode.window.showInformationMessage(report);
  } catch (err) {
    const outcome = outcomeOf(err);
    const line = terminalLine('The validation', outcome);
    outputChannel?.appendLine(line);
    if (outcome.kind === 'cancelled') {
      void vscode.window.showInformationMessage(line);
      return;
    }
    // The compiler's own message reaches the reader unchanged, with the way to
    // the full output offered beside it rather than in place of it.
    void vscode.window.showErrorMessage(line, SHOW_OUTPUT_ACTION).then((choice) => {
      if (choice === SHOW_OUTPUT_ACTION) {
        outputChannel?.show(true);
      }
    });
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

// registerFileWatcher wires what an authored document changing ON DISK means to
// the two surfaces that hold something derived from it: the compiler's per-file
// caches, which are told to drop their entry, and an open topology graph, which
// is redrawn.
//
// 🔴 THE GRAPH IS REDRAWN FROM HERE AND FROM NOWHERE ELSE, and disk is the right
// coordinate rather than the buffer. A graph request names a Release and carries
// no text, so the compiler builds it from the documents as they stand on disk —
// which means an unsaved keystroke changes nothing it would draw, and a compile
// per keystroke would spend a full pipeline run to redraw the same picture. What
// does change the picture is a document reaching disk, which is exactly the event
// this watcher reports.
//
// The two calls share one handler because they answer to one fact. Splitting them
// would let a later change tell the compiler its cache is stale while leaving the
// panel showing a topology built from the entry that was just dropped.
function registerFileWatcher(context: vscode.ExtensionContext): void {
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.yaml');
  const documentChangedOnDisk = (uri: vscode.Uri) => {
    if (!daemon) { return; }
    daemon.request('aggrega/invalidate', { file: uri.fsPath }).catch(err => {
      outputChannel?.appendLine(`invalidate failed: ${describeError(err)}`);
    });
    refreshGraphView();
  };
  watcher.onDidChange(documentChangedOnDisk);
  watcher.onDidCreate(documentChangedOnDisk);
  watcher.onDidDelete(documentChangedOnDisk);
  context.subscriptions.push(watcher);
}

// registerBuildOnInspectToggle exposes the toggle in the command palette. The
// status-bar quick-action menu offers the same action; both run the one
// implementation, so the two surfaces cannot diverge.
function registerBuildOnInspectToggle(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(
    TOGGLE_BUILD_ON_INSPECT_COMMAND,
    () => toggleBuildOnInspect(),
  ));
}

// registerRestartCommand wires the one command that puts a language server
// there when there is none, and replaces the one there is when there is.
//
// It is the command a reader reaches for when nothing is working, so it is the
// one command that must never be withheld — and starting is what it does, so
// refusing to run it because nothing is running would withhold it in exactly
// the situation it is for. What it used to do there was report that the server
// is not running, which the reader could already see, and stop.
function registerRestartCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(RESTART_COMMAND, async () => {
    if (!daemon) {
      await startLanguageServer();
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

// startLanguageServer puts a language server where there is none, by running
// the same evaluation of the open folders that activation runs. It derives no
// route of its own: whether this window has a folder to attach to, which one,
// and what to do when several qualify are questions that path already answers,
// and a second answer here would disagree with it the moment either moved.
//
// It ends in something the reader can see, in every branch. Where a server
// started, it says so. Where the evaluation settled on a state that starts
// nothing, it says which — and only where nothing else already has: a window
// with several candidate folders is asked to choose one, and a server that
// failed to start reports its own failure, both from inside that path.
async function startLanguageServer(): Promise<void> {
  const context = extensionContext;
  if (!context) { return; }
  await reactivate(context);
  if (daemon) {
    void vscode.window.showInformationMessage('Aggrega language server started.');
    return;
  }
  if (currentAnchored.length === 0) {
    void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
  }
}

// registerLifecycleActionsCommand wires what the lifecycle indicator opens on
// click: the one action that applies to the standing it is reporting, named
// before it happens.
//
// Both actions run the restart command, which is the one implementation of
// putting a language server there — so the two labels are two readings of one
// act rather than two paths that could come to disagree. What the standing
// decides is which reading is honest: a reader with nothing running is offered
// a start, because that is what will happen.
//
// It is hidden from the command palette, which already carries the restart
// under its own name; a second entry differing from it only in wording would
// leave a reader choosing between two names for one thing.
function registerLifecycleActionsCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(LIFECYCLE_ACTIONS_COMMAND, async () => {
    const action = daemonStandingAction(daemonStanding(daemon?.getState() ?? null));
    const choice = await vscode.window.showQuickPick(
      [{ label: DAEMON_ACTION_LABEL[action], description: DAEMON_ACTION_DETAIL[action] }],
      { placeHolder: DAEMON_ACTION_PLACEHOLDER },
    );
    if (!choice) { return; }
    await vscode.commands.executeCommand(RESTART_COMMAND);
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
  void vscode.commands.executeCommand(RESTART_COMMAND);
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
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
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

// readRunningVersions reports what this extension and the compiler in use say
// about themselves, for the surface that shows them.
//
// 🔴 THE EXTENSION'S VERSION IS READ FROM THE EDITOR'S OWN RECORD OF THIS
// INSTALLATION, never held here. The manifest already declares it, a release
// moves it there, and a constant beside this line would be a second one somebody
// would have to remember to move in step — which is exactly the kind of copy
// that is wrong only after a release.
//
// 🔴 AND THE COMPILER IS ASKED THROUGH THE BINARY THE LANGUAGE SERVER WAS
// ACTUALLY STARTED FROM, NOT THE CONFIGURED ONE. The two diverge whenever the
// preference has moved and the restart that would apply it has not happened —
// the restart runs after a grace window the reader can cancel — and in that
// window the configured path names a compiler nothing is running. Where nothing
// is running there is no compiler in use to report on, and the absence is
// reported as an absence rather than substituted for with the configured path's
// answer.
//
// A read that fails is an absent reading rather than a message on the page: the
// reader cannot act on a spawn error and the page is not where a diagnosis
// belongs, so the detail goes to the output channel where the rest of this
// extension's diagnosis goes.
async function readRunningVersions(): Promise<VersionStandings> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  const extensionVersion = (ext?.packageJSON as { version?: string } | undefined)?.version ?? null;
  const running = daemon?.getLaunchedBinaryPath() ?? null;
  if (running === null) {
    return { extension: extensionVersion, compiler: null };
  }
  const reading = await readDaemonVersion({ binaryPath: running, spawn: spawnForCompat });
  if (reading.kind === 'unreadable') {
    outputChannel?.appendLine(`Aggrega compiler version could not be read: ${reading.err.message}`);
    return { extension: extensionVersion, compiler: null };
  }
  return { extension: extensionVersion, compiler: reading.version };
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
  context.subscriptions.push(vscode.commands.registerCommand(STATUS_BAR_MENU_COMMAND, async () => {
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
        void vscode.commands.executeCommand(RESTART_COMMAND);
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
// The write targets the reader's own settings, and there is no layer to choose
// between: every preference this extension declares is confined to the reader, so
// the workspace and folder layers hold no value for one and refuse a write of
// one. Picking among layers here would be a choice with two unreachable outcomes.
async function toggleBuildOnInspect(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(SERVER_CONFIG_SECTION);
  const current = cfg.get<boolean>(BUILD_ON_INSPECT_KEY, DEFAULT_SETTINGS.buildOnInspect);
  const next = !current;
  try {
    await cfg.update(BUILD_ON_INSPECT_KEY, next, vscode.ConfigurationTarget.Global);
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
    void vscode.commands.executeCommand(RESTART_COMMAND);
  }
}

async function navigationRequest(
  method: RequestMethod,
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

async function tryRequest<T>(method: RequestMethod, params: unknown, doc: vscode.TextDocument): Promise<T | null> {
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
  // A workspace holding no Release answers with null rather than an empty list.
  return resp.releases ?? [];
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
//
// 🔴 IT CARRIES THE RELEASE AND NOTHING ELSE, and the composition is annotated
// with the type that says so — so a parameter added here is a compile error
// rather than something a reviewer has to notice. The reason it matters is that
// this request writes nothing while resolving dependencies writes the lockfile:
// the two cannot both be honoured, and the compiler refuses the pairing. A build
// adjustment leaking into this call would put a refusal in front of a reader for
// a combination they never authored and cannot see.
async function requestBuildPreview(
  release: string,
  signal?: CancellationSignal,
): Promise<BuildPreviewResponse> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<BuildPreviewResponse>(
    'aggrega/buildPreview',
    buildPreviewParams(release),
    signal,
  );
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
//
// dials names the adjustments the reader turned beside the Build button. What a
// given set carries on the wire is composed in one place rather than here, so
// the panel that shows a setting and the request that acts on it read one
// description — and the parameter is carried at both its values, so a request
// says what the reader chose rather than leaving the off case indistinguishable
// from a client that does not know about it.
//
// 🔴 WHERE THE BUILD WRITES IS THE FOLDER THE READER WORKS FROM, AND IT IS THE
// CHOSEN ONE RATHER THAN THE ONE THE ANCHORING SETTLED ON. A build run in a
// terminal writes beneath the directory it was run in; a request carries no
// such directory, so the editor states it. What a reader is standing in is the
// folder they chose, and where they have chosen nothing the request says
// nothing — the compiler then writes where a build run at the workspace root
// writes. Answering from the anchoring's own folder instead would name a folder
// nobody picked in exactly the window where the two differ.
//
// It is converted against the root the server ANSWERED with, which is the root
// this request names and the same one the Release path is converted against, so
// the two paths in one request cannot come to be relative to two places. That
// the chosen folder sits inside that root is a property of the order the two are
// settled in rather than of either value, so the conversion judges it rather
// than relying on it, and answers with nothing where it does not hold.
async function requestBuild(
  release: string,
  dials: readonly string[],
  signal?: CancellationSignal,
): Promise<BuildResponse> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<BuildResponse>(
    'aggrega/build',
    buildParams(release, dials, outputParentFor(anchoredWorkspaceRoot(), chosenProjectFolder)),
    signal,
  );
}

// requestImport asks the language server to draft Aggrega authoring files from a
// foreign source description.
//
// The source is a file the reader chose and may sit anywhere on the machine: it is
// READ, so the request surface resolves it as a selection rather than as a
// workspace-relative path, and an absolute one naming a file outside the open
// folder is accepted and read. The destination is the other direction — it is
// WRITTEN to, and is confined to the workspace the session was opened over
// whatever the request sends — which is why the parameters carry a relative value
// for it and the two are not one rule.
//
// 🔴 IT CARRIES CANCELLATION, AND UNLIKE MOST OF THE REQUESTS HERE THE STOP
// REACHES THE WORK. The importer is a module the compiler runs, this request's
// context is what it is run under, and the runtime is configured to unwind a
// module that is mid-run when that context is cancelled. So a reader's stop ends
// the conversion, and offering one is not the decoration it would be on a request
// whose shared operation takes no context.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting an import that never ran as one that drafted nothing.
async function requestImport(
  params: ImportParams,
  signal?: CancellationSignal,
): Promise<ImportResult> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<ImportResult>('aggrega/import', params, signal);
}

// requestCatalogIndex asks the language server for the open workspace's entity
// index — kind, name, apiVersion, description, labels and source file for every
// Aggrega document under the workspace root. The extension performs no
// workspace walk of its own; this is the single source, for the same reason
// Release detection is: a second walk would report a set the compiler is not
// using whenever the two disagreed, and nothing would report the disagreement.
// Throws when the server is not running, so a caller surfaces that state rather
// than showing an empty workspace.
async function requestCatalogIndex(signal?: CancellationSignal): Promise<CatalogIndexDoc> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<CatalogIndexDoc>('aggrega/catalogIndex', {}, signal);
}

// requestScaffoldEntity asks the language server to draft a starter document for
// an entity kind. The skeleton comes from the schema set compiled into the
// binary, so the answer is the same bytes every other caller-facing surface
// produces for that kind and name; deriving one here would agree on the day it
// was written and part company later.
//
// It writes nothing, and that is the property to preserve rather than an
// incidental one: the answer is text, and where it goes is this client's
// decision. Throws when the server is not running, so a caller reports that
// state rather than presenting an empty draft.
async function requestScaffoldEntity(kind: string, name: string): Promise<ScaffoldEntityResponse> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<ScaffoldEntityResponse>('aggrega/scaffoldEntity', { kind, name });
}

// requestEntityDefinition asks the language server what one entity resolves to.
// It resolves through the session's own catalog view, so the answer is what a
// build would resolve rather than what a second reader of the workspace would.
// Throws when the server is not running, so a caller reports that state rather
// than presenting an empty answer as an entity that resolves to nothing.
async function requestEntityDefinition(
  name: string,
  signal?: CancellationSignal,
): Promise<unknown> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<unknown>('aggrega/entityDefinition', { name }, signal);
}

// requestEffectiveConfiguration asks the language server for the configuration
// it resolved at startup and the layer each setting came from. The extension
// reads no configuration file of its own for this: a second reading would
// resolve a cascade the compiler is not using, and would disagree silently in
// exactly the workspaces where the cascade is worth reporting.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting an empty report as a workspace that configures nothing.
async function requestEffectiveConfiguration(): Promise<unknown> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<unknown>('aggrega/effectiveConfiguration', {});
}

// requestSchema asks the language server for one kind's schema, or — naming no
// kind — for the kinds that can be named.
//
// One request carries both questions because that is how the language server
// takes them, and it is what lets a client learn the vocabulary it would
// otherwise have had to know before it could ask. Naming a kind answers with
// that kind's schema; naming none answers with the kinds instead, at two widths,
// and which of the two a caller wants is the caller's decision to state.
//
// The schema is asked for rather than read from a file beside the installation,
// and that is a correctness choice rather than a convenience: a path into a
// compiler checkout is a layout no installation is obliged to have, and a copy
// shipped alongside would be the contract as it stood when the extension was
// packaged rather than the contract the running binary holds. Asking the process
// that will do the work is the only way to be generated from the schema in
// force. The same reasoning is what makes the kinds worth asking for: a list of
// them on this side would be the vocabulary as it stood when the extension was
// packaged.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting an absent schema as a product that declares nothing.
async function requestSchema(kind?: string): Promise<unknown> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<unknown>(
    'aggrega/getSchema',
    kind === undefined ? {} : { kind },
  );
}

// requestCacheStatus asks the language server what the on-disk caches hold. It
// writes nothing, and it still reports how far the answer reached: two of the
// classes it describes are shared by every project on the machine, so a caller
// deciding whether to reclaim needs to know which of what it is reading about
// is not this workspace's before it acts.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting an unasked question as a machine that caches nothing.
async function requestCacheStatus(): Promise<CacheStatusResponse> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<CacheStatusResponse>('aggrega/cacheStatus', {});
}

// requestCachePrune asks the language server to reclaim the cache entries no
// workspace lockfile references. It writes, and it is sent for the same reason
// every other writing request is: a caller that sent it has asked for the
// reclamation, exactly as a caller sending a build has asked for artifacts.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting a reclamation that never ran as one that found nothing.
async function requestCachePrune(): Promise<CachePruneResponse> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<CachePruneResponse>('aggrega/cachePrune', {});
}

// requestCacheEvict asks the language server to trim the compiled-module cache
// to a size cap.
//
// maxSize is the reader's own text and travels unread. The server parses it with
// the same parser the command line uses, so a quantity learned on one surface is
// accepted on the other; it refuses a blank or unreadable one with a message
// naming what a size cap looks like, and that refusal is what a caller surfaces
// rather than a check of its own.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting a trim that never ran as a cache already within its cap.
async function requestCacheEvict(maxSize: string): Promise<CacheEvictResponse> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<CacheEvictResponse>('aggrega/cacheEvict', { maxSize });
}

// requestCacheClear asks the language server to empty every cache the session
// addresses. It is the widest of these requests and the answer is explicit about
// it, naming each subtree it removed and which of them were shared beyond this
// workspace.
//
// The server prompts for nothing: a caller that sent this has asked for it, so
// whatever confirmation a reader owes is owed to the surface that offered the
// operation. Throws when the server is not running, so a caller reports that
// state rather than presenting a wipe that never ran as a wipe that found
// nothing.
async function requestCacheClear(): Promise<CacheClearResponse> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<CacheClearResponse>('aggrega/cacheClear', {});
}

// requestConfigInit asks the language server to seed a working configuration by
// registering a registry and its signature trust policy. It writes, and it is
// sent for the same reason every other writing request is: a caller that sent it
// has asked for the configuration to be seeded, exactly as a caller sending a
// build has asked for artifacts.
//
// The answer says what was seeded and where, including whether the file it wrote
// is the one every project on this machine resolves through — so the surface that
// offered the operation can tell the reader the reach of what just changed
// instead of inferring it from a choice the request did not make.
//
// It carries no cancellation, and that is read off what the compiler does rather
// than assumed: the shared operation behind the request takes none, and the
// handler checks for a stopped caller only after its operation has returned. A
// stop sent here would stop this client waiting and not the work, so none is
// offered.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting a seeding that never ran as one that found nothing to do.
async function requestConfigInit(params: ConfigInitParams): Promise<ConfigInitResult> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<ConfigInitResult>('aggrega/configInit', params);
}

// requestRegistryList asks the language server which registries this workspace's
// resolved configuration reaches, and the signature trust posture of each.
//
// It reads: the subject is the merged configuration the session already resolved,
// so the answer is what the compiler is acting on rather than a set this
// extension assembled. It contacts no registry.
//
// It carries no cancellation, and that is read off what the compiler does rather
// than assumed: the shared operation behind the request takes none, so a stop
// sent here would stop this client waiting and not the work.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting an unasked question as an empty answer.
async function requestRegistryList(): Promise<RegistryListDoc> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<RegistryListDoc>('aggrega/registryList', {});
}

// requestRegistryAdd asks the language server to register a registry and its
// signature trust policy.
//
// 🔴 IT WRITES, AND THE FILE IT WRITES IS THE READER'S CHOICE carried on the
// request. The answer names the file the write actually resolved to and whether
// that file is the global one, so the surface reports the reach of what changed
// instead of restating the choice it asked for.
//
// Where the registration takes the registry's advertised trust policy it makes
// one unauthenticated request to that registry's own origin. Nothing is prompted
// for: a registry advertising nothing is reported as advertising nothing and the
// registration proceeds.
//
// It carries no cancellation, and that is read off what the compiler does rather
// than assumed: the shared operation behind the request is reached with none, and
// the handler checks for a stopped caller only after that operation has returned.
// A stop sent here would stop this client waiting and not the work, so none is
// offered.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting a registration that never ran as one that changed nothing.
async function requestRegistryAdd(params: RegistryAddParams): Promise<RegistryAddResult> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<RegistryAddResult>('aggrega/registryAdd', params);
}

// requestRegistryRemove asks the language server to drop a registry's entry.
//
// It reaches no registry: a removal operates on the configuration text alone.
// The answer names the host the compiler resolved the token to and the file the
// removal wrote, so the reader is told what was removed and from where rather
// than that something finished.
//
// It carries no cancellation, for the same measured reason as the registration
// above.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting a removal that never ran as one that found nothing to remove.
async function requestRegistryRemove(
  params: RegistryRemoveParams,
): Promise<RegistryRemoveResult> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<RegistryRemoveResult>('aggrega/registryRemove', params);
}

// requestLogout asks the language server to remove a registry's stored
// credential.
//
// 🔴 IT CHANGES MACHINE-WIDE STATE AND CARRIES NO CHOICE OF WHERE. The credential
// store is shared by every project on the machine and by every other tool
// speaking to the same registries, so the operation has no project-scoped form
// and the request surface offers no override to send.
//
// The credential is never read. The store is asked to delete the host's entry,
// and no part of what that entry held reaches the answer, an error or a log line.
//
// It carries no cancellation, for the same measured reason as the two above.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting a removal that never ran as one that found nothing.
async function requestLogout(params: LogoutParams): Promise<LogoutResult> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<LogoutResult>('aggrega/logout', params);
}

// requestRegistrySearch asks the language server to search the published
// catalog.
//
// The search is answered from the offline snapshot under this workspace's own
// configured cache directory, so it reaches no network and needs no credential.
// The answer names which registries were consulted and how current each snapshot
// was, which is what makes a thin result attributable to a stale snapshot rather
// than to the catalog.
//
// It carries no cancellation, for the same measured reason: the shared operation
// behind the request takes none, and the handler checks for a stopped caller only
// after that operation has returned.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting a search that never ran as one that found nothing.
async function requestRegistrySearch(params: RegistrySearchParams): Promise<SearchDoc> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<SearchDoc>('aggrega/search', params);
}

// requestLint asks the language server for the publishing-conventions findings
// over the subject it is given: every catalog entity the workspace's configured
// catalog directories hold, or one entity named by its workspace-relative path.
//
// The parameters are composed from the subject rather than written here, so the
// two questions the surface asks are one request with one shape — the same two
// subjects the command line addresses, one with a path and one without.
//
// It reaches no registry under either subject. Only the mode that reads local
// content runs; the comparison against a previously published version is a
// different question a request has to ask for by name, and neither of these does.
//
// 🔴 IT CARRIES CANCELLATION, AND WHAT THE STOP REACHES DIFFERS BY SUBJECT. Over
// the whole catalog this request's own context is what the tree walk and the
// per-entity rule dispatch observe, so a reader's stop abandons the entities not
// yet reached rather than only ending this side's wait — which matters because
// that walk's cost grows with the catalog. Over one entity the same context is
// observed once, immediately before the rules run, so a stop abandons the rules
// rather than the remaining corpus.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting a check that never ran as one that found nothing.
async function requestLint(
  subject: LintSubject,
  signal?: CancellationSignal,
): Promise<LintAnswer> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<LintAnswer>('aggrega/lint', lintRequestParams(subject), signal);
}

// requestPluginAdd asks the language server to resolve a search term to one
// plugin of the named type and attach it to the configuration.
//
// It reaches a registry — resolving the term to exactly one plugin, and pinning
// that plugin's latest published version, are both registry reads — which is why
// it is the one plugin operation that takes a wait worth showing. The answer
// names which plugin the search resolved to, what it was bound as, and the
// configuration file the entry landed in together with whether that file is the
// global one, so the operation reports what the compiler measured rather than
// echoing what was asked for.
//
// 🔴 IT CARRIES CANCELLATION, AND THE STOP REACHES THE WORK. This request's own
// context is what the registry enumeration runs under, and on to the registry
// client's own listing call — so a reader's stop ends the search rather than only
// ending this side's wait for an answer.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting an attachment that never ran as one that found no plugin.
async function requestPluginAdd(
  params: PluginAddParams,
  signal?: CancellationSignal,
): Promise<PluginAddResult> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<PluginAddResult>('aggrega/pluginAdd', params, signal);
}

// requestPluginRemove asks the language server to drop a configured plugin's
// entry so it no longer participates in a build.
//
// It reaches no registry: a removal operates on the configuration text alone.
// The answer names the configuration file the removal wrote and whether that file
// is the global one, so the operation can tell the reader the reach of what just
// changed instead of inferring it from a choice the request did not make.
//
// It carries no cancellation, and that is read off what the compiler does rather
// than assumed: the shared operation behind the request takes none, and the
// handler checks for a stopped caller only after that operation has returned. A
// stop sent here would stop this client waiting and not the work, so none is
// offered.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting a removal that never ran as one that found nothing to remove.
async function requestPluginRemove(params: PluginRemoveParams): Promise<PluginRemoveResult> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<PluginRemoveResult>('aggrega/pluginRemove', params);
}

// The three publication requests: publishing a catalog entity, signing what is
// already published, and withdrawing it.
//
// 🔴 THEY REACH FURTHER THAN ANYTHING ELSE HERE, WHICH IS WHY EACH ANSWER NAMES
// ITS REACH. Everything else on these surfaces changes this machine; these change
// what every consumer of that registry resolves, and neither published bytes nor a
// signature can be recalled from anyone who has already fetched them. Each answer
// carries the registry host it addressed and whether anything actually landed, so
// the ending states what became true rather than that a process exited zero.
//
// 🔴 EACH CARRIES CANCELLATION, AND THE STOP REACHES THE WORK. The request's own
// context is what the shared publication layer observes, at the point before
// anything becomes visible to anyone else — so a reader's stop abandons the
// publication rather than only ending this side's wait for an answer. Measured:
// against a registry that accepts a connection and never answers, the connection
// is dropped at the moment the stop is sent, and is held indefinitely when none
// is.
//
// 🔴 AND NOTHING IS PROMPTED FOR. The command line asks a person at a terminal for
// a withdrawal's content, and for a credential when it has none; a request surface
// has no terminal, so the content travels on the request and an unresolvable
// credential is refused in the compiler's own words naming what to send. Neither
// ask was reachable from this extension before either — a spawned subprocess has
// no terminal to be asked at — so this is the same contract, stated where it can
// be seen.
//
// Each throws when the server is not running, so a caller reports that state
// rather than presenting an operation that never ran as one that did nothing.

async function requestPublishEntity(
  params: PublishEntityParams,
  signal?: CancellationSignal,
): Promise<PublishEntityResult> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<PublishEntityResult>('aggrega/publishEntity', params, signal);
}

async function requestSignArtifacts(
  params: SignArtifactsParams,
  signal?: CancellationSignal,
): Promise<SignArtifactsResult> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<SignArtifactsResult>('aggrega/signArtifacts', params, signal);
}

async function requestDeprecateArtifact(
  params: DeprecateArtifactParams,
  signal?: CancellationSignal,
): Promise<DeprecateArtifactResult> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<DeprecateArtifactResult>(
    'aggrega/deprecateArtifact', params, signal,
  );
}

// requestRegistryUpdate builds the searchable index of the configured
// registries.
//
// 🔴 IT REACHES THE REGISTRIES THEMSELVES, AND ITS STOP REACHES THE WALK. The
// request's own context is what the shared walk observes: once per registry,
// ahead of that registry's own walk, and carried into every network call the walk
// makes. Measured against a registry that accepts a connection and never answers:
// a stop sent four seconds in leaves no walk running eleven seconds in, while an
// unstopped run is still inside the repository enumeration at the same moment. So
// a reader's stop ends the walk rather than only ending this side's wait.
//
// 🔴 WHAT A STOP LEAVES BEHIND, STATED RATHER THAN GLOSSED: the registries
// already indexed have been written, because each registry's records land as its
// own walk finishes. A stop is not an undo, which is why the ending names how
// many registries were reached.
//
// 🔴 NOTHING IS PROMPTED FOR. Credentials resolve from a supplied or ambient
// source, and a registry needing one the machine does not carry is refused with
// the credential named. That was already true of the subprocess this replaces,
// which was spawned with piped streams.
//
// It throws when the server is not running, so a caller reports that state rather
// than presenting an operation that never ran as one that did nothing.
async function requestRegistryUpdate(
  params: RegistryUpdateParams,
  signal?: CancellationSignal,
): Promise<RegistryUpdateResult> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error('the Aggrega language server is not running');
  }
  return await daemon.request<RegistryUpdateResult>('aggrega/registryUpdate', params, signal);
}

async function handleCacheMiss<T>(method: RequestMethod, params: unknown, doc: vscode.TextDocument): Promise<T | null> {
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
