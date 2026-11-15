// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AttachCandidatesRequest, AttachmentContainerRequest } from './attachment-edit';
import { buildParams, buildPreviewParams } from './build-dials';
import { readBuildStamp } from './build-stamp';
import { CancellationSignal } from './cancellation';
import type { RegistrySearchParams, SearchDoc } from './catalog-search-run';
import type { ConfigInitParams, ConfigInitResult } from './config-seeding';
import {
  CONNECTION_DOCUMENTS_CONTEXT_KEY,
  ConnectionAtPositionRequest,
  connectionDocumentFiles,
} from './connection-at-cursor';
import {
  AppliedWrite,
  ConfigurationWatch,
  configurationChangedWarning,
  createConfigurationWatch,
  ownWriteRestartLine,
  ownWriteRestartTitle,
  writtenFile,
} from './config-change-watch';
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
  createSourcedCollections,
  everyLayer,
  holdsFindings,
  operationRefusalsIn,
  publishDiagnostics,
  publishShapes,
} from './diagnostics';
import { DiskChangeHandler, ON_DISK_PATTERN, createDiskChangeHandler, subscribeToWatcher } from './disk-change';
import { clearClosedDocument } from './document-close';
import { createDocumentValidations } from './document-validations';
import * as l10n from './l10n';
import { DIAGNOSTIC_SOURCE_FALLBACK } from './diagnostics-shape';
import {
  DaemonErrorContext,
  DaemonErrorRouting,
  WhoAsked,
  describeError,
  handleDaemonError,
  isJsonRpcError,
  refusalDocument,
  refusalEntry,
  resetSessionDedup,
} from './error-surfaces';
import {
  OPERATION_REFUSALS_COLLECTION,
  OperationRefusals,
  Settled,
  filingsForAnswer,
} from './operation-refusals';
import { recoverFromCacheMiss } from './cache-miss';
import {
  notifyDaemonStartupFailed,
  notifyStoppedResponding,
  warnNotRunning,
} from './notifications';
import { BINARY_PATH_SETTING, StartFailure, startFailureWords } from './start-failure';
import type { ServerStart } from './compiler-version';
import {
  COMPILER_ANSWERABLE_CONTEXT_KEY,
  Readiness,
  createReadiness,
} from './readiness';
import { ServerTurnover, createServerTurnover } from './server-turnover';
import {
  DAEMON_ACTION_DETAIL,
  DAEMON_ACTION_LABEL,
  DAEMON_ACTION_PLACEHOLDER,
  DaemonStatusBar,
  LIFECYCLE_ACTIONS_COMMAND,
  RESTART_COMMAND,
  RESTART_SERVER_ACTION,
  STATUS_BAR_MENU_COMMAND,
  TOGGLE_BUILD_ON_INSPECT_COMMAND,
  commandTitle,
  createDaemonStatusBar,
  daemonReading,
  daemonStanding,
  daemonStandingAction,
  serverInPlaceMessage,
} from './daemon-status';
import {
  SHOW_OUTPUT_ACTION,
  countReport,
  outcomeOf,
  terminalLine,
} from './operation-outcome';
import { withCancellableProgress } from './progress';
import { catalogIndexParams, entityDefinitionParams } from './release-terms';
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
import { ServerReading, VersionStandings } from './welcome-render';
import {
  completionResponseToOffers,
  hoverResponseToMarkup,
  listedLocations,
  lspCompletionToCompletion,
  lspDefinitionToResolve,
  lspHoverToHover,
  lspImplementationToFindImplementations,
  lspReferencesToFindReferences,
  locationToLspLocation,
  resolvedLocations,
} from './translator';
import {
  ActiveReleaseResponse,
  BuildPreviewResponse,
  BuildResponse,
  CacheClearResponse,
  CacheEvictResponse,
  CachePruneResponse,
  CacheStatusResponse,
  CatalogIndexParams,
  CompletionResponse,
  DaemonLocation,
  ERR_FILE_NOT_VALIDATED,
  FindImplementationsResponse,
  FindReferencesResponse,
  HoverResponse,
  IrGraphParams,
  IrGraphResponse,
  PublishDiagnosticsParams,
  ReleaseCandidatesResponse,
  RequestMethod,
  ResolveResponse,
  ScaffoldEntityResponse,
  SetActiveReleaseParams,
  ValidateParams,
  ValidateResponse,
} from './types';
import {
  ACTIVE_RELEASE_MARKER_GLOB,
  AnchoredFolder,
  NO_ANCHORED_WORKSPACE_MESSAGE,
  dedupeByWorkspaceRoot,
  findAllAnchoredFolders,
  fromWorkspaceRelative,
  outputParentFor,
  rememberedWorkspaceReached,
  windowAnchoring,
  workspacesReachedFromAll,
} from './workspace';
import { candidateFilesUnder } from './workspace-search';
import { openAuthoringReleaseConfig, createActiveReleaseMarker } from './release-actions';
import type { ServerListing } from './configuration-leading-out';
import { activateOperations, OperationsView } from './operations';
import { activateLint, LintRunner } from './lint';
import { LintAnswer, LintSubject, lintRequestParams } from './lint-run';
import type { IrGraphRequest } from './graph-payload';
import { activateGraphView, GraphView } from './graph-view';
import { activateCatalogViews } from './catalog-views';
import { activateGetStarted } from './get-started';
import { CHOOSE_WORKSPACE_COMMAND } from './get-started-steps';
import { activatePluginsView } from './plugins-view';
import { activateRegistriesView } from './registries-view';
import { activateConfigPanel } from './config-view';
import { WorkspaceCatalogView, activateWorkspaceCatalogView } from './workspace-catalog-view';
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
  AnchorChoiceOutcome,
  anchorChoiceOutcome,
  anchorOffers,
  anchorSwitchMessage,
  anchorsAvailableSentence,
  classifyActivation,
  readSavedAnchor,
  rememberAnchorChoice,
} from './anchor-picker';
import { openWorkspaceRootInvocation } from './selector-rows';
import { FoldersTold, tellWorkspaceAboveIfDue } from './workspace-above';
import {
  ADD_FOLDER_DIALOG,
  AnswerStores,
  CHOOSE_PROJECT_FOLDER_COMMAND,
  CHOOSE_PROJECT_FOLDER_PLACEHOLDER,
  OPEN_FOLDER_DIALOG,
  adoptCarriedAnswer,
  isSavedProjectFolderValid,
  pickAndAddFolder,
  pickAndOpenFolder,
  projectFolderInForce,
  projectFolderOffers,
  projectFolderSwitchMessage,
  readSavedProjectFolder,
  rememberProjectFolderChoice,
} from './project-folder';
import { appendFolderToWindow, openFolderInWindow } from './window-folders';
import { WindowKind } from './window-kind';

// LANGUAGE_SERVER_NOT_RUNNING is what a request this module sends on a reader's
// behalf rejects with while no language server is running to answer it.
const LANGUAGE_SERVER_NOT_RUNNING = l10n.t('the Aggrega language server is not running');

let daemon: Daemon | null = null;
let outputChannel: vscode.OutputChannel | null = null;
// diagnosticCollections holds one collection per compiler layer, so each layer
// publishes and clears its own findings independently. Created on first anchor.
let diagnosticCollections: SourcedCollections | null = null;
// operationRefusals holds the refusals of a build, a preview or a graph, apart
// from the per-layer collections, so a document's close and its validation do
// not take one away; each Release's next answer does. Created beside them.
let operationRefusals: OperationRefusals | null = null;
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
// workspaceCatalogView is the Catalog panel, held so it can be told to read its
// list again when a document is created, changed or deleted on disk, or closed in
// the editor. Telling it so also reads again which documents the attach at the
// cursor is offered in, since that is read off the same index at the same
// moments (readConnectionDocuments, below).
let workspaceCatalogView: WorkspaceCatalogView | null = null;
// connectionDocumentsRead counts the reads of the documents the attach at the
// cursor is offered in, so an answer arriving after a later read began is
// dropped rather than left standing over the later one.
let connectionDocumentsRead = 0;
let lintRunner: LintRunner | null = null;
// releaseSelection is the editor's one answer to "which Release are we talking
// about". Every surface that acts on a Release reads it, and it travels on
// every request the language server answers in a Release's terms — through the
// one composition in release-terms.ts — so the language server holds none of its
// own and changing the selection needs no restart.
let releaseSelection: ReleaseSelection | null = null;
// readiness is the editor's one answer to "can the compiler be asked yet", and
// every view renders from it. Built in activate() before any surface that reads
// it, and driven from the single lifecycle subscription in ensureDaemonAt.
let readiness: Readiness | null = null;
// serverTurnover forgets what a stopped language server said whenever a new one
// comes up, and has the open documents validated again once it answers. Built in
// activate() over every collection a server's findings are filed in, and handed
// each lifecycle position from the single subscription in ensureDaemonAt.
let serverTurnover: ServerTurnover | null = null;
let operationsView: OperationsView | null = null;
// refreshGetStarted re-reads the conditions the welcome panel reports. It is
// called at the end of every re-evaluation of the open folders, because the
// readiness signal the other views render from announces itself only when a
// workspace root and an answerable language server are both in hand — so a
// workspace that is anchored but whose compiler will not start would otherwise
// never publish the one condition it has met.
let refreshGetStarted: (() => void) | null = null;
// welcomeFollowsLifecycle redraws the welcome page's foot readings that follow
// the language server — the line saying whether it is running, and the versions
// — without re-reading the steps. It is called beside every refresh of the
// lifecycle indicator, which is the set of points at which what the lifecycle
// reads as can have moved: the one lifecycle subscription, and the places that
// drop or settle the client outside it.
let welcomeFollowsLifecycle: (() => void) | null = null;
// droppedStartFailure records that there is no client because the last one was
// dropped when its start failed, and what that start failed with.
//
// 🔴 IT IS A FACT ABOUT THIS EXTENSION'S OWN ACT, NOT A COPY OF THE CLIENT'S.
// While a client exists it answers for its own most recent attempt, and that is
// what is read. The one place a client is thrown away because its start failed
// is the first start, and after that there is no client left to ask — so what
// remains to be said, that the server failed to start, why, and that none has
// run since, is said by this. A new client replaces it, and a deliberate teardown
// clears it, because the extension then decided to run nothing here.
let droppedStartFailure: StartFailure | null = null;

// lastStartFailure is the most recent attempt to start a language server here,
// where it failed: the client's own record while there is a client, and the
// record of the dropped one where there is not.
function lastStartFailure(): StartFailure | null {
  return daemon ? daemon.lastStartFailure() : droppedStartFailure;
}

// showOutputChannel brings the Aggrega output channel into view without taking
// the focus from where the reader is working.
function showOutputChannel(): void {
  outputChannel?.show(true);
}

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

// languageServerReading is what the welcome page's last line reports: the
// lifecycle position, refined by whether the most recent attempt to start
// failed, and the version the server reported about itself in its answer when
// the extension connected. It reads the client through its own getters and
// keeps no copy of any of them.
//
// 🔴 THE VERSION IS THE SERVER'S OWN ANSWER, NEVER A BINARY ASKED ON ITS BEHALF.
// The page draws it only while the reading is running, and while it is, the
// answer it comes from is the running server's: the lifecycle reports running
// only once the handshake that records that answer has completed. Asking the
// binary the server was started from instead would answer for the file at that
// path, which can be replaced while the process started from it runs on — and
// that is the Compiler reading's question, not this one's.
function languageServerReading(): ServerReading {
  return {
    reading: daemonReading(
      daemon?.getState() ?? null,
      lastStartFailure() !== null,
    ),
    version: daemon?.getServerInitMetadata()?.version ?? null,
  };
}

// requireSelectedRelease tells the reader that an operation needs a Release and
// offers the one way to select one. Written once here so every surface that
// needs a selection says the same thing.
function requireSelectedRelease(): void {
  const action = l10n.t('Select a Release…');
  void vscode.window.showInformationMessage(
    l10n.t('Aggrega: this operation acts on a Release, and none is selected.'),
    action,
  ).then(choice => {
    if (choice === action) {
      void vscode.commands.executeCommand(SELECT_RELEASE_COMMAND);
    }
  });
}

// refreshGraphView re-renders an open topology graph after a file it could have
// been drawn from changes on disk: an authored document, or the selected
// Release's lockfile, which the graph request reads its pins from and checks for
// drift. A save touching several files produces a burst; the same window the
// editor already uses to collapse a burst of edits into one validation collapses
// this into one re-render, and reads the setting on each call so a change to it
// takes effect without a restart. When no graph is open the callback finds
// nothing to do.
//
// 🔴 WHAT MAY CALL THIS IS PART OF ITS CONTRACT, and the rule is causal rather
// than about cost. A refresh asks the compiler for a graph, and that request
// makes the compiler report what it found — so anything driven BY such a report
// must not call this, or the panel becomes both the cause and the consumer of
// its own refresh and recompiles the workspace until it is closed. Disk is the
// right trigger because the compiler reads the graph off disk: the drawing goes
// stale exactly when a file there changes, and never because the compiler said
// something about a compile this panel asked for.
const refreshGraphView = debounce(
  () => graphView?.refresh(),
  () => getSettings().debounceMs,
);

// documentValidations sends every proactive validation, each open document's
// once its own pause in typing ends, and is what a press of the Catalog panel's
// Refresh waits on before it reads the list. When each is sent, and what the
// press waits for, is decided in document-validations.ts, which needs no editor.
const documentValidations = createDocumentValidations<vscode.TextDocument>({
  key: (doc) => doc.uri.toString(),
  validate: validateDocument,
  timer: {
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
  },
  pauseMs: () => getSettings().debounceMs,
});

// requestGraphWithoutDrawing asks the language server for the topology of a
// Release and discards the answer. It is sent for what answering does rather
// than for the answer: the graph request is the one request that checks the
// Release's lockfile against what the Release now resolves to, and as it answers
// it publishes the lockfile's drift warning, or clears it.
//
// 🔴 WHAT MAY CALL THIS IS THE REDRAW'S RULE, FOR THE REDRAW'S REASON. It makes
// the compiler report what it found, so anything driven by such a report must not
// call it, or the two turn each other for as long as the window is open. The one
// trigger is the selected Release's lockfile reaching disk while no graph panel
// shows that Release to be redrawn — none is open, or the one open shows another
// Release — and it is wired beside the redraw, in the on-disk watcher.
//
// Nobody pressed for this request, so a failure raises no notification: it is
// kept in the output channel, and the warning it could not settle stays where it
// is. Its answer still settles what the Release's refusals show, as every graph
// request's does (answeredFor): a refusal for a dependency that does not resolve
// stays filed, and an answer without it takes it away.
//
// It asks for the graph withheld whatever the setting that shows sensitive values
// says. That setting is the reader's choice about a graph they are looking at,
// and nothing is drawn from this answer, so the values it would reveal would
// cross from the language server to no reader at all.
async function requestGraphWithoutDrawing(release: string): Promise<void> {
  const client = daemon;
  if (!client || client.getState() !== DaemonState.Running) { return; }
  const params: IrGraphParams = { release };
  try {
    await answeredFor(release, client.request<unknown>('aggrega/irGraph', params));
  } catch (err) {
    outputChannel?.appendLine(
      l10n.t('the topology of {0}, asked for to settle what its lockfile reports, was not built: {1}', release, describeError(err)),
    );
  }
}

// configurationWatch notices a change to a configuration file the running
// language server read, which that server goes on ignoring until it starts again,
// and says so with the restart beside it. A write this extension makes itself
// goes through it too, and is followed by the restart instead of by a warning.
//
// It is armed from the readiness signal's rising edge — every start, restart and
// respawn — rather than from a lifecycle listener of its own, and it asks the
// server which files it read rather than composing that list here. What it
// decides, and in which order its events may arrive, is in config-change-watch.ts.
//
// The burst window is the one the editor already collapses a burst of edits with,
// for the reason it is used for the graph: one save can reach the disk as more
// than one write, and it is one change.
const configurationWatch: ConfigurationWatch = createConfigurationWatch({
  readLayers: async () => {
    const answer = await requestEffectiveConfiguration();
    return (answer as { layers?: unknown } | null)?.layers;
  },
  // 🔴 A PATTERN ROOTED AT THE FILE'S OWN DIRECTORY, NOT THE WORKSPACE-RELATIVE
  // GLOB THE AUTHORED-DOCUMENT WATCHER USES. The global configuration sits
  // outside every folder the window has open, and a pattern given as a plain glob
  // is matched only inside those folders.
  watchFile: (file, onEvent) => {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)),
    );
    watcher.onDidChange(onEvent);
    watcher.onDidCreate(onEvent);
    watcher.onDidDelete(onEvent);
    return watcher;
  },
  readContent: async (file) => {
    try {
      return await fs.promises.readFile(file, 'utf8');
    } catch {
      return null;
    }
  },
  warn: async (file) => {
    const choice = await vscode.window.showWarningMessage(
      configurationChangedWarning(file),
      RESTART_SERVER_ACTION,
    );
    if (choice === RESTART_SERVER_ACTION) {
      void vscode.commands.executeCommand(RESTART_COMMAND);
    }
  },
  restartForWrite: async (file) => {
    const restarted = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: ownWriteRestartTitle(file) },
      () => replaceLanguageServer(),
    );
    if (restarted) {
      outputChannel?.appendLine(ownWriteRestartLine(file));
    }
    return restarted;
  },
  isServerRunning: isLanguageServerRunning,
  timer: {
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
  },
  settleMs: () => getSettings().debounceMs,
  log: (line) => outputChannel?.appendLine(line),
});

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extensionContext = context;
  outputChannel = vscode.window.createOutputChannel('Aggrega');
  context.subscriptions.push(outputChannel);

  // 🔴 FIRST, BEFORE ANYTHING THAT CAN EVALUATE THE OPEN FOLDERS IS REGISTERED.
  // Where this window was made by adding a folder to a window on one folder or
  // none, the answer the reader gave in the window they left is carried here
  // through the editor's global store, and it has to be in this window's memory
  // before the first evaluation reads that memory. That evaluation is the last
  // act below, and every control and listener registered in between can start one
  // too, so taking the answer in here is what puts it ahead of all of them.
  await adoptCarriedAnswer(answerStores(context), vscode.workspace.workspaceFolders ?? []);

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

  // The configuration files watched are the ones the server that just became
  // answerable says it read, so they are asked for on every rising edge: a restart
  // that loaded a different set is then watched over the new one.
  ready.onReady(() => { void configurationWatch.reload(); });

  // Registered here rather than when a language server attaches: the command
  // that starts one is needed precisely in the workspace where none has
  // attached, and a command that does not exist is not in the palette to be
  // found. What decides whether a reader may run one is the condition above,
  // declared in the manifest — and the editor leaves a command whose condition
  // is false out of the command palette, so the condition is declared only on
  // a command whose whole subject is a running language server.
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
      // Raised through the Commands panel, so where the panel held the keyboard
      // as it opened, the focus goes back to the control the reader was on once
      // it closes.
      const open = (): Thenable<(typeof items)[number] | undefined> => vscode.window.showQuickPick(items, {
        placeHolder,
        matchOnDescription: true,
        matchOnDetail: true,
      });
      const choice = operationsView === null ? await open() : await operationsView.returningFocus(open);
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

  // Every collection a language server's findings are filed in: each layer it
  // pushes or answers, the refusals of a document's own requests filed among
  // them, the refusals of a build, a preview or a graph, and the conventions
  // check's. Nothing the extension files there is its own computation, so a new
  // server forgets all of it. The open documents are validated again on every
  // rising edge — the first start included, since no server is answering yet when
  // the editor's documents are first seen.
  const runner = lintRunner;
  const turnover = createServerTurnover({
    holders: () => [
      ...(diagnosticCollections ? everyLayer(diagnosticCollections) : []),
      ...(operationRefusals ? [operationRefusals] : []),
      runner,
    ],
    revalidate: revalidateOpenDocuments,
  });
  serverTurnover = turnover;
  ready.onReady(() => { turnover.answerable(); });

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
    //
    // The request is composed where its answer is read and is sent exactly as
    // composed: whether it asks for the values a Feature declares sensitive is
    // decided by the same reading of the setting that decides what the view is
    // posted, so nothing here reads the setting again.
    requestIrGraph: async (request: IrGraphRequest, signal?: CancellationSignal) => {
      if (!daemon || daemon.getState() !== DaemonState.Running) {
        throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
      }
      const result = await answeredFor(request.release, daemon.request<IrGraphResponse>(
        'aggrega/irGraph',
        request,
        signal,
      ));
      return result.graph;
    },
    // What may attach to a drawn node, asked by the node's id on the graph and
    // the Release that graph was built from. The request is composed where its
    // answer is read and is sent exactly as composed. Naming the Release is what
    // has the candidates read from the catalog directories that Release builds
    // against; the request refuses a Release beside a label set, and a label set
    // alone is answered from the workspace's own directories.
    requestAttachCandidates: async (request: AttachCandidatesRequest) => {
      if (!daemon || daemon.getState() !== DaemonState.Running) {
        throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
      }
      return await daemon.request<unknown>('aggrega/attachCandidates', request);
    },
    // The entity index, asked beside what may attach in the terms of the same
    // Release, for the links leading out of the workspace it names.
    requestCatalogIndex: (params: CatalogIndexParams) => requestCatalogIndexWith(params),
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
        throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
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
        throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
      }
      return await daemon.request<unknown>('aggrega/insertionPoint', { file, container });
    },
    // Which connection's entry a position in an Aggregate or a Release falls
    // inside, on the compiled graph of the Release the request names. It is sent
    // exactly as the view composed it, and like the insertion point it is
    // answered from what the session holds for the document, which is what the
    // editor last sent it, ahead of the bytes on disk.
    requestConnectionAtPosition: async (request: ConnectionAtPositionRequest) => {
      if (!daemon || daemon.getState() !== DaemonState.Running) {
        throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
      }
      return await daemon.request<unknown>('aggrega/connectionAtPosition', request);
    },
    validationsAnswered: () => documentValidations.answered(),
    // UTF-16 where no session has settled on units, as the protocol's own
    // default; a request then sent finds no server to answer it.
    serverEncoding: () => daemon?.getServerEncoding() ?? 'utf-16',
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
  // Whether the language server is running is, because the enumeration is its
  // answer and a stopped server is a state of its own rather than a failure.
  activateRegistriesView(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    isLanguageServerRunning,
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
    getDaemonState: () => daemon?.getState() ?? null,
    output: outputChannel,
  });

  // The workspace-catalog tree lists the entities in the open workspace,
  // grouped by kind. It is language-server-backed (catalogIndex), so it reports
  // the workspace the compiler reads rather than a set the extension walked for
  // itself; the getters read live state so the tree tracks the root the server
  // later attaches to.
  const catalogPanel = activateWorkspaceCatalogView(context, {
    getWorkspaceRoot: () => workspaceRootForCommands,
    getBinaryPath: () => getSettings().binaryPath,
    isLanguageServerRunning,
    requestCatalogIndex,
    validationsAnswered: () => documentValidations.answered(),
    selectedRelease,
    // Asked with no kind named, as the drafting flow asks it: the answer names
    // the kinds, and what each row operation accepts a document of each kind for.
    entityKinds: () => requestSchema(),
    entityDefinition: requestEntityDefinition,
    publishEntity: requestPublishEntity,
    // The conventions check on a row runs through the same runner the Commands
    // panel's whole-catalog entry uses, so both write into one collection and a
    // row press refreshes its own entity instead of standing up a second layer.
    lintEntity: (entityPath) => lintRunner?.runEntity(entityPath) ?? Promise.resolve(),
    onReady: ready.onReady,
    output: outputChannel,
  });
  // Which documents the attach at the cursor is offered in is read off the same
  // index the Catalog panel lists, at every moment the panel is told to read it
  // again and as the compiler becomes answerable. It is read on its own rather
  // than taken from the panel's reading, because the editor reads a tree it is
  // not showing only once it is revealed, so a reader who never opens the panel
  // would never be offered the command. As the compiler stops being answerable
  // the command is offered nowhere, as a condition nothing can act on is not
  // left standing.
  workspaceCatalogView = {
    refresh: () => {
      catalogPanel.refresh();
      void readConnectionDocuments();
    },
  };
  ready.onChange((answerable) => {
    if (answerable) {
      void readConnectionDocuments();
    } else {
      clearConnectionDocuments();
    }
  });

  // 🔴 WHAT THE SELECTED RELEASE'S MOVE CHANGES IS ASKED FOR AGAIN HERE, ONCE PER
  // MOVE, WHICHEVER WAY THE SELECTION MOVED. The Catalog panel's list and an open
  // document's findings are the language server's answers in the selected
  // Release's terms, so when the Release in force changes — a reader's choice, the
  // remembered or default Release taken as a server connects, the default taken
  // when the workspace's marker is written, or none left as a connection ends —
  // the list is read again and the open documents are validated again. Followed
  // from the reader's choice alone, the Release taken as a server connects would
  // leave the documents already open with the findings asked for before it was
  // taken, when no Release was yet in force. Every other surface reads the
  // selection when it is next asked, and a graph panel keeps the Release it was
  // shown with.
  releaseSelection?.onMove(() => {
    workspaceCatalogView?.refresh();
    revalidateOpenDocuments();
  });

  // The welcome panel says what Aggrega is, then names what the extension still
  // needs in this workspace and what it already has. The editor draws it from
  // the manifest and starts this extension when it is opened, so it reaches a
  // reader whose workspace has started nothing at all; what is registered here
  // is the reading of the four conditions, the controls that satisfy them, and
  // the opening of the panel itself.
  const welcome = activateGetStarted(context, {
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
    // The control that writes a workspace configuration hands that write to the
    // configuration watch, so a language server already running where the file
    // lands is restarted to read it rather than left on the configuration it had.
    writeConfiguration: configurationWatch.ownWrite,
    // A control through which the reader NAMES a folder records that answer before
    // re-attaching, so the activation path settles on the folder they chose rather
    // than on the one this window last remembered.
    rememberAnchorChoice: (anchorPath) =>
      rememberAnchorChoice(context.workspaceState, anchorPath),
    // Read as the folder is added rather than when the panel is set up, because
    // which memory the answer goes into depends on the window at that moment.
    addingWindow: () => ({ ...answerStores(context), windowKind: readWindowKind() }),
    onReady: ready.onReady,
    onSelectionChange: (listener) => releaseSelection?.onChange(listener),
    seedConfiguration: requestConfigInit,
    listRegistries: requestRegistryList,
    serverListing,
    readVersions: readRunningVersions,
    readServerStanding: languageServerReading,
    // A downloaded compiler is run once with `version -o json` before anything
    // uses it, through the same seam every other version reading takes.
    runVersion: spawnForCompat,
    compatibilityRange: declaredCompatibility,
    // A change of version starts the server from the new copy before that copy
    // replaces anything, and puts it back on the configured compiler where the
    // new one does not start.
    startServerOn: startLanguageServerOn,
    restoreServer: restoreLanguageServer,
    output: outputChannel,
  });
  refreshGetStarted = welcome.refresh;
  welcomeFollowsLifecycle = welcome.followLifecycle;

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

  // 🔴 THE IMMEDIATE ANSWER IS THE WALK'S AND THE REMEMBERED WORKSPACE'S, AND
  // NOTHING HERE WAITS ON THE EDITOR'S FILE SEARCH. The walk reads a handful of
  // directories on the way to the filesystem root; the search is a glob across
  // everything the window holds. Blocking attachment on the second would make
  // every start pay for a candidate list that only a panel reads, in a window
  // where the answer is usually one. So the walk settles where the language
  // server goes, joined by the workspace this window last worked in wherever the
  // folder still reaches it, and the fuller population is completed afterwards.
  const anchored = await findAllAnchoredFolders(scope);

  // 🔴 A REMEMBERED CHOICE IS JUDGED AGAINST EVERYTHING THE FOLDER REACHES, the
  // look inside it included, because that is the population it was chosen from:
  // a workspace chosen below the folder is none the walk up finds, and judged
  // against the walk alone it would be dropped, and said to be dropped, on every
  // start. The question is put to the remembered marker itself, through
  // discovery, so answering it needs no search.
  const savedAnchor = readSavedAnchor(context.workspaceState);
  const remembered = savedAnchor === null ? null : await rememberedWorkspaceReached(savedAnchor, scope);
  if (savedAnchor !== null && remembered === null) {
    // Stale saved choice — folder removed, marker deleted, or the marker no
    // longer reached from the folders open. Forget it so the multi-prompt
    // branch can re-fire when appropriate.
    await rememberAnchorChoice(context.workspaceState, null);
    // And say so. A remembered choice that quietly stops applying is
    // indistinguishable from one that was never remembered, and the reader
    // meets the difference at a moment they cannot connect to a previous
    // session.
    // Spells SELECTOR_ROW_LABELS.workspace (selector-levels.ts) inside its own
    // message, the label being a noun after "an" there.
    void vscode.window.showInformationMessage(
      l10n.t('Aggrega: {0} no longer marks an Aggrega workspace in this project, so the remembered choice was dropped.', savedAnchor),
    );
  }

  // The remembered workspace joins the walk's answer, so the language server
  // attaches to it straight away rather than to whatever the walk found and then
  // moving, with a notice, once the search answers; where the walk found it too,
  // the walk's entry stands.
  const immediate = remembered === null ? anchored : dedupeByWorkspaceRoot([...anchored, remembered]);
  currentAnchored = immediate;

  await applyActivationDecision(context, immediate);

  // Every branch above settles what the workspace root and the language server
  // now are, including the branch where the server failed to start, so this is
  // the one place from which the get-started conditions are true of all of them.
  refreshGetStarted?.();
  // And the same for the lifecycle indicator. Two of the four branches build no
  // client at all, so nothing there fires the lifecycle listener and the
  // indicator would otherwise go on reporting whatever it last saw — in the
  // workspace where what it reports matters most. The welcome page's line saying
  // whether the server is running reads the same lifecycle, so it moves with it.
  daemonStatusBar?.refresh();
  welcomeFollowsLifecycle?.();
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
// force sits outside the folder their window is open on — neither that folder
// nor beneath it.
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
    // Spells SELECTOR_ROW_LABELS.project (selector-levels.ts) inside its own
    // message, the label being a noun after "the" there.
    void vscode.window.showInformationMessage(
      l10n.t('Aggrega: {0} is no longer open in this window, so the remembered Project folder was dropped.', saved),
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
// It is reached twice per re-evaluation — once with the immediate answer, the
// walk's joined by the remembered workspace, and once with the fuller population
// the search completes — and it is one
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
  welcomeFollowsLifecycle?.();
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
    `${l10n.t('Aggrega: {0}', anchorsAvailableSentence(count))} ${l10n.t('Choose one to start the language server.')}`,
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
//
// It answers what it decided: to stay, because the editor already works there,
// with the sentence saying so, or to move. The answer is the decision and not
// whether a move then succeeded — a start that fails reports itself. The
// decision is made once, here, so a caller that tells the reader about it tells
// them what this attach decided rather than a second reading of its own.
async function ensureDaemonAt(
  context: vscode.ExtensionContext,
  target: AnchoredFolder<vscode.WorkspaceFolder>,
): Promise<AnchorChoiceOutcome> {
  // Both facts are taken together, from the one module that owns them. The
  // server is started at the workspace root and the opened folder is kept
  // beside it, because a window opened on a subdirectory has two true answers
  // to "where are we" and every surface below has to say which it means.
  const anchoring = windowAnchoring(target);

  // The guard returns early only where the folder the workspace is reached from
  // AND the workspace itself are both the ones already in use. isAttachedTo says
  // what each half of that comparison catches that the other misses, and
  // anchorChoiceOutcome is the one home of the decision and of what it tells the
  // reader.
  const outcome = anchorChoiceOutcome(activeAnchored, daemon !== null, target);
  if (outcome.kind === 'alreadyAttached') {
    return outcome;
  }

  if (daemon) {
    // The guard above has already established that the folder or the workspace is
    // a different one, so the language server is about to be torn down and stood
    // back up somewhere else. The reader is told before it happens rather than left to infer it from
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
  if (!operationRefusals) {
    const refusals = vscode.languages.createDiagnosticCollection(OPERATION_REFUSALS_COLLECTION);
    context.subscriptions.push(refusals);
    operationRefusals = operationRefusalsIn(refusals);
  }

  daemon = new Daemon(getSettings(), msg => outputChannel?.appendLine(msg));
  droppedStartFailure = null;
  // The notification names the command that starts the server again, under the
  // title the loaded manifest declares for it; commandTitle says why the title is
  // read rather than written here.
  daemon.on('stoppedResponding', () =>
    notifyStoppedResponding(commandTitle(context.extension.packageJSON, RESTART_COMMAND)));
  daemon.on('stateChange', (next) => {
    if (next === DaemonState.Running || next === DaemonState.Restarting) {
      resetSessionDedup(toastDebounce);
    }
    // What the stopped server said is forgotten as the client begins a new one,
    // on whichever path got here — a restart and a respawn reuse this client, a
    // move and a start from stopped construct a new one under this same listener.
    if (serverTurnover) { serverTurnover.moved(next); }
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
    // The welcome page's last line reads four readings rather than three, and
    // follows every move where the page's steps follow only the rising edge; it
    // is still this one lifecycle, redrawn from this listener.
    welcomeFollowsLifecycle?.();
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
  // much when asked. The commands are registered when the extension activates
  // rather than behind this guard: a command is something a reader looks for, and
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
        if (e.affectsConfiguration(BINARY_PATH_SETTING)) {
          scheduleBinaryPathRestart();
        }
      }),
    );
    registerDocumentLifecycle(context);
    registerLanguageFeatures(context);
    registerCloseHandler(context, registerFileWatcher(context));
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
    // The client's own record names the path its attempt tried. A start refused
    // before any attempt was made has no record, and is reported against the
    // path the setting names now.
    const failure = daemon?.lastStartFailure() ?? { reason: err, binaryPath: getSettings().binaryPath };
    notifyDaemonStartupFailed(failure, showOutputChannel);
    daemon = null;
    // The client is dropped, and with it the record of its failed attempt; this
    // is what goes on saying it, for the reason droppedStartFailure states.
    droppedStartFailure = failure;
    activeAnchored = null;
    return outcome;
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
  return outcome;
}

async function stopDaemon(): Promise<void> {
  if (daemon) {
    await daemon.stop();
    daemon = null;
  }
  // Nothing is running to be out of date, so nothing is watched on its behalf.
  // The next server to become answerable re-arms the watch over what it read.
  configurationWatch.disarm();
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
  //
  // The teardown is deliberate, so whatever the last start did, what the page
  // reports now is a server the extension decided not to run.
  droppedStartFailure = null;
  daemonStatusBar?.refresh();
  welcomeFollowsLifecycle?.();
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
      const before = releaseSelection?.current() ?? null;
      const chosen = await releaseSelection?.choose();
      if (!chosen) { return; }
      // Nothing is restarted. The selection travels on the next request, so the
      // change is in force immediately.
      outputChannel?.appendLine(l10n.t('selected Release: {0}', chosen));
      // A choice that moved the selection has already had the open documents
      // validated again by the follower of its moves. Choosing the Release already
      // selected moves nothing, and is still the reader asking for the open
      // documents to be read against it, so it is answered here.
      if (chosen === before) { void revalidateOpenDocuments(); }
    }),
  );
}

// revalidateOpenDocuments re-validates every open YAML document against the
// selection and the lockfile now in force. It runs when the selection moves,
// and when the selected Release's lockfile reaches disk, because validation reads
// its pins and the withdrawal markers it reports from that lockfile. Without it
// the Problems panel would go on showing findings computed against the previous
// Release, or the previous lockfile, until each file happened to be edited, which
// reads as the change having no effect. It runs as well each time a language
// server becomes answerable, the first included: the Problems panel was emptied as
// that server began, so the open documents' own findings are asked of it afresh.
function revalidateOpenDocuments(): void {
  if (!daemon || daemon.getState() !== DaemonState.Running) { return; }
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.languageId !== 'yaml') { continue; }
    documentValidations.send(doc);
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
    // What adding a folder would cost is read here, as the choice is drawn,
    // because the last entry's second line has to be true of this window at the
    // moment the reader reads it. The add that entry ends in reads the window
    // again as it adds, through the same reader.
    const windowKind = readWindowKind();
    const offers = anchorOffers(currentAnchored, windowKind).map(o => ({
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
    // The attach answers what it decided. Choosing the workspace already in use
    // lands on its early return, so nothing is stopped or restarted, and the
    // reader is then told the editor already works there rather than left with a
    // chooser that closed on nothing.
    const outcome = await ensureDaemonAt(extensionContext, choice.offer.anchored);
    if (outcome.kind === 'alreadyAttached') {
      void vscode.window.showInformationMessage(outcome.message);
    }
  }));
}

// readWindowKind reads the two facts the editor reports about this window that
// decide what adding a folder to it does: whether it is open on a workspace file,
// and whether it works through a remote connection.
//
// It is the one place either fact is read. What an add costs is shown on the
// second line of both entries that end in one — the Project folder row's add
// entry and the Aggrega workspace row's last entry, each read as its choice is
// drawn — and where the answer given before an add is written is decided at
// both routes that add a folder; written out at each, two readings of one fact
// could come to disagree, and the line shown and the memory written would then
// describe different windows.
function readWindowKind(): WindowKind {
  return {
    onWorkspaceFile: vscode.workspace.workspaceFile !== undefined,
    remote: vscode.env.remoteName !== undefined,
  };
}

// answerStores names the two memories a reader's answer can be kept in: this
// window's own, and the editor's global store, which every window shares and
// which is kept when a window enters a new workspace.
function answerStores(context: vscode.ExtensionContext): AnswerStores {
  return { memory: context.workspaceState, global: context.globalState };
}

// registerChooseProjectFolderCommand wires what the Project folder row opens.
//
// 🔴 IT OFFERS THE FOLDERS THE WINDOW HAS AND, LAST, THE TWO WAYS TO REACH ONE
// IT DOES NOT: OPENING IT IN PLACE OF THEM, AND ADDING IT BESIDE THEM. Choosing
// among what is here and bringing something else in are different acts, and a
// reader clicking the row is asking the first while frequently needing the
// second. Presenting them as one list is what keeps the second from being a
// control they have to go and find; presenting them as one ACTION would take
// the choice away from them.
//
// The choice is recorded before anything is re-evaluated, for the reason the
// workspace chooser records its own first: the re-evaluation reads the
// remembered answer, so an answer recorded afterwards arrives after the decision
// that needed it and the reader is put back where they asked to leave.
function registerChooseProjectFolderCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(CHOOSE_PROJECT_FOLDER_COMMAND, async () => {
      const folders = [...(vscode.workspace.workspaceFolders ?? [])];
      // What adding a folder would cost is read here, as the choice is drawn,
      // because the add entry's second line has to be true of this window at
      // the moment the reader reads it. The add below decides from the same
      // reading where the answer goes, so it does what the line said.
      const windowKind = readWindowKind();
      const offers = projectFolderOffers(folders, windowKind).map((o) => ({
        label: o.label,
        description: o.description,
        detail: o.kind === 'open' ? '' : o.detail,
        offer: o,
      }));
      const choice = await vscode.window.showQuickPick(offers, {
        placeHolder: CHOOSE_PROJECT_FOLDER_PLACEHOLDER,
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (!choice) { return; }
      if (choice.offer.kind === 'reopen') {
        // The sequence is the pure one; what is handed to it here is the editor
        // and nothing else. The window is put on the folder picked alone.
        await pickAndOpenFolder({
          pickFolder: () => vscode.window.showOpenDialog(OPEN_FOLDER_DIALOG),
          openFolder: (folder) => openFolderInWindow(folder),
          showError: (message) => void vscode.window.showErrorMessage(message),
        });
        return;
      }
      if (choice.offer.kind === 'add') {
        // The sequence is the pure one; what is handed to it here is the editor,
        // the window's two memories and the kind of window read above. The folder
        // added becomes the one the editor works from, in whichever window the
        // reader is in once it is added.
        await pickAndAddFolder({
          pickFolder: () => vscode.window.showOpenDialog(ADD_FOLDER_DIALOG),
          openFolders: () => vscode.workspace.workspaceFolders ?? [],
          addFolder: (folder) => appendFolderToWindow(folder),
          showInformation: (message) => void vscode.window.showInformationMessage(message),
          showError: (message) => void vscode.window.showErrorMessage(message),
        }, { ...answerStores(context), windowKind });
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
// One has the language server write the workspace's local marker; the other
// opens the configuration file, which is the shared, committed default and
// outranks the marker.
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
      await openAuthoringReleaseConfig(workspaceRootForCommands, configurationWatch.ownWrite, serverListing);
    }),
    vscode.commands.registerCommand('aggrega.workspace.createActiveReleaseMarker', async () => {
      if (!workspaceRootForCommands) {
        void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
        return;
      }
      await createActiveReleaseMarker(selectedRelease(), requestSetActiveRelease);
    }),
  );
}

export async function deactivate(): Promise<void> {
  configurationWatch.disarm();
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
    void vscode.window.showInformationMessage(l10n.t('Aggrega: open a YAML file to validate.'));
    return;
  }
  const client = daemon;
  if (!client || client.getState() !== DaemonState.Running) {
    warnNotRunning(lastStartFailure(), daemonStanding(client?.getState() ?? null), showOutputChannel);
    return;
  }
  const doc = editor.document;
  const name = path.basename(doc.uri.fsPath);
  try {
    const response = await withCancellableProgress(
      l10n.t('Aggrega: validating {0}', name),
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
    const report = countReport(l10n.t('Aggrega: validated {0}', name), findings.length, 'Problems panel');
    outputChannel?.appendLine(report);
    void vscode.window.showInformationMessage(report);
  } catch (err) {
    const outcome = outcomeOf(err);
    const line = terminalLine(l10n.t('The validation'), outcome);
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
// takes — document open, the end of a pause in typing in that document, and the
// sweep of every open document that follows a server becoming answerable, a
// change of selection or a lockfile write — so none of them can drift into
// sending a different request than the others.
//
// It settles once the server has answered or refused, and at once where it sends
// nothing — no server running, or a document that is not YAML — which is what a
// press of the Catalog panel's Refresh waits on before it reads the list.
function validateDocument(doc: vscode.TextDocument): Promise<void> {
  if (!daemon || daemon.getState() !== DaemonState.Running) { return Promise.resolve(); }
  if (doc.languageId !== 'yaml') { return Promise.resolve(); }
  return daemon.request<ValidateResponse>('aggrega/validate', validateParamsFor(doc)).then(
    response => {
      if (diagnosticCollections) {
        publishDiagnostics(diagnosticCollections, doc.uri, response.diagnostics ?? []);
      }
    },
    err => {
      // A validation runs as the reader edits, not because they pressed
      // anything, so a refusal of one is work nobody asked for.
      const ctx = buildErrorContext(doc.uri, 'nobody');
      if (ctx && isJsonRpcError(err) && handleDaemonError(err, ctx) !== 'unrecognised') {
        return;
      }
      outputChannel?.appendLine(l10n.t('validate failed: {0}', describeError(err)));
    },
  );
}

// registerDocumentLifecycle validates a document as it opens and once each pause
// in typing in it ends. Each document waits out a pause of its own, so a change
// to one document never cancels or replaces the validation still waiting for
// another. The documents already open are not swept here: this runs before the
// first server is started, when nothing can answer, and the sweep that does reach
// them runs each time a server becomes answerable.
function registerDocumentLifecycle(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => documentValidations.send(doc)),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => documentValidations.changed(e.document)),
  );
}

// registerCloseHandler wires the editor closing a YAML document. The document's
// own findings are cleared first, and synchronously, so they leave with it
// whatever the language server does next; a build's findings on it, and the
// refusal of a build, a preview or a graph, stay until a build stops reporting
// them, for the reason given where the build layer's name is declared
// (DIAGNOSTIC_SOURCE_BUILD). The document then goes to disk-change.ts, which
// has the language server drop what it holds for that one file and the Catalog
// panel read its list again once that drop is answered — the same read the
// on-disk watcher asks for, so a close and a change on disk that overlap are one
// read, after both drops.
//
// The editor closes a document when it disposes of it or gives it another
// language, and it does not promise to do so at the moment the document's tab
// closes; the list is read after the close the editor reports.
function registerCloseHandler(context: vscode.ExtensionContext, disk: DiskChangeHandler): void {
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(doc => {
      if (doc.languageId !== 'yaml') { return; }
      if (diagnosticCollections) {
        clearClosedDocument(diagnosticCollections, doc.uri);
      }
      if (!daemon) { return; }
      disk.documentClosed(doc.uri.fsPath);
    }),
  );
}

// registerLanguageFeatures wires the cursor features. Each is answered in the
// selected Release's terms, read as the request is composed, so a reference
// resolves to — and completion offers — what the Release the reader is working
// on reads, rather than whatever the workspace as a whole declares first.
function registerLanguageFeatures(context: vscode.ExtensionContext): void {
  const yamlSelector: vscode.DocumentSelector = { language: 'yaml' };

  context.subscriptions.push(vscode.languages.registerDefinitionProvider(yamlSelector, {
    provideDefinition: (doc, position) => navigationRequest<ResolveResponse>(
      'aggrega/resolve',
      doc, position,
      (uri, pos, content, enc) => lspDefinitionToResolve(uri, pos, content, enc, selectedRelease()),
      resolvedLocations,
    ),
  }));

  context.subscriptions.push(vscode.languages.registerReferenceProvider(yamlSelector, {
    provideReferences: (doc, position) => navigationRequest<FindReferencesResponse>(
      'aggrega/findReferences',
      doc, position,
      (uri, pos, content, enc) => lspReferencesToFindReferences(uri, pos, content, enc, selectedRelease()),
      listedLocations,
    ),
  }));

  context.subscriptions.push(vscode.languages.registerImplementationProvider(yamlSelector, {
    provideImplementation: (doc, position) => navigationRequest<FindImplementationsResponse>(
      'aggrega/findImplementations',
      doc, position,
      (uri, pos, content, enc) => lspImplementationToFindImplementations(uri, pos, content, enc, selectedRelease()),
      listedLocations,
    ),
  }));

  context.subscriptions.push(vscode.languages.registerHoverProvider(yamlSelector, {
    provideHover: async (doc, position) => {
      if (!daemon) { return undefined; }
      const params = lspHoverToHover(doc.uri.toString(), position, doc.getText(), daemon.getServerEncoding(), selectedRelease());
      const result = await tryRequest<HoverResponse>('aggrega/hover', params, doc);
      const shown = hoverResponseToMarkup(result);
      if (!shown) { return undefined; }
      return new vscode.Hover(shown.kind === 'markdown'
        ? new vscode.MarkdownString(shown.value)
        : new vscode.MarkdownString().appendText(shown.value));
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
        selectedRelease(),
        ctx.triggerCharacter,
      );
      const result = await tryRequest<CompletionResponse>('aggrega/completion', params, doc);
      return completionResponseToOffers(result).map(offer => {
        const c = new vscode.CompletionItem(offer.label);
        if (offer.sortText !== undefined) { c.sortText = offer.sortText; }
        if (offer.detail !== undefined) { c.detail = offer.detail; }
        return c;
      });
    },
  }, '/'));
}

// registerFileWatcher wires what a file the compiler reads changing ON DISK means
// to the surfaces that hold something derived from it: the compiler's per-file
// caches, which are told to drop their entry, and an open topology graph, which
// is redrawn. The files are the authored documents and the selected Release's
// lockfile; a document additionally has the Catalog panel read its list again
// once the language server has answered, and a lockfile has the open documents
// validated again and, where no graph panel shows the selected Release, a drift
// warning standing on it settled by a graph request whose answer is discarded.
// What each event asks for is decided in disk-change.ts; what is here is the
// editor's side of each.
//
// It returns the handler it built, and the close of a document is handed the same
// one: the Catalog panel's read after a close waits on the close's drop in the
// count the watcher's reads wait in, so there is one read of the list and one
// place deciding when it happens. A close redraws nothing, since it changes
// nothing on disk.
//
// 🔴 THE GRAPH IS REDRAWN FROM HERE AND FROM NOWHERE ELSE, and disk is the right
// coordinate rather than the buffer. A graph request names a Release and carries
// no text, so the compiler builds it from the documents as they stand on disk and
// pins it against the lockfile as it stands there — which means an unsaved
// keystroke changes nothing it would draw, and a compile per keystroke would
// spend a full pipeline run to redraw the same picture. What does change the
// picture is a document or the lockfile reaching disk, which is exactly the event
// this watcher reports — and it reports a lockfile whoever wrote it, a pull on the
// Commands panel, a build with Auto pull, or a pull typed in a terminal.
//
// The calls share one handler because they answer to one fact. Splitting them
// would let a later change tell the compiler its cache is stale while leaving the
// panel showing a topology built from the entry that was just dropped.
function registerFileWatcher(context: vscode.ExtensionContext): DiskChangeHandler {
  const watcher = vscode.workspace.createFileSystemWatcher(ON_DISK_PATTERN);
  const redraw = (): void => {
    refreshGraphView();
  };
  const disk = createDiskChangeHandler({
    // Settled either way: what waits on the answer waits on a refusal too, and
    // the refusal is kept in the output channel.
    invalidate: (file) => {
      const client = daemon;
      if (!client) { return Promise.resolve(); }
      return client.request<unknown>('aggrega/invalidate', { file }).then(() => undefined, err => {
        outputChannel?.appendLine(l10n.t('invalidate failed: {0}', describeError(err)));
      });
    },
    // The file granularity drops that one file's entries and keeps the
    // compiler's catalog for the workspace, which a closed document leaves as it
    // was on disk.
    invalidateClosed: (file) => {
      const client = daemon;
      if (!client) { return Promise.resolve(); }
      return client.request<unknown>('aggrega/invalidate', { file, granularity: 'file' }).then(() => undefined, err => {
        outputChannel?.appendLine(l10n.t('invalidate (didClose) failed: {0}', describeError(err)));
      });
    },
    redraw,
    refreshCatalog: () => { workspaceCatalogView?.refresh(); },
    revalidate: revalidateOpenDocuments,
    shownRelease: () => graphView?.shownRelease() ?? null,
    findingStands: (file) =>
      (diagnosticCollections !== null && holdsFindings(diagnosticCollections, vscode.Uri.file(file)))
      || (operationRefusals !== null && operationRefusals.holds(vscode.Uri.file(file).toString())),
    selectedRelease,
    selectedLockfile: () => releaseSelection?.lockfile() ?? null,
    requestGraph: (release) => { void requestGraphWithoutDrawing(release); },
    timer: {
      setTimeout: (handler, ms) => setTimeout(handler, ms),
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    },
    settleMs: () => getSettings().debounceMs,
  });
  subscribeToWatcher(watcher, (file) => {
    if (!daemon) { return; }
    disk.changedOnDisk(file);
  });
  context.subscriptions.push(watcher);
  return disk;
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
// the situation it is for, and answer with a report that the server is not
// running, which the reader can already see.
function registerRestartCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(RESTART_COMMAND, async () => {
    if (!daemon) {
      await startLanguageServer();
      return;
    }
    if (await replaceLanguageServer()) {
      void vscode.window.showInformationMessage(
        serverInPlaceMessage('restarted', daemon?.getServerInitMetadata()?.version),
      );
    }
  }));
}

// replaceLanguageServer is the one implementation of replacing the running
// language server with a fresh one, which resolves the workspace's configuration
// again as it starts. It answers whether a server is running afterwards.
//
// It reports a failure to start itself and says nothing about a success, because
// what is worth saying then depends on why the restart happened: the command a
// reader ran says the server restarted, while a restart following a write the
// extension made says which file it is reading while it does it — one statement
// for one act rather than two notifications stacked for it. Both reach it, so the
// two can never come to restart differently.
async function replaceLanguageServer(): Promise<boolean> {
  if (!daemon) { return false; }
  const client = daemon;
  try {
    await client.restart();
    return true;
  } catch (err) {
    notifyDaemonStartupFailed(
      client.lastStartFailure() ?? { reason: err, binaryPath: getSettings().binaryPath },
      showOutputChannel,
    );
    return false;
  }
}

// startLanguageServerOn starts the language server from one compiler file and
// answers whether it came up, leaving the setting naming the compiler where it
// is.
//
// 🔴 IT IS A TRIAL, NOT A CHANGE OF COMPILER, AND IT REPORTS RATHER THAN
// NOTIFIES. The file is a new version not yet put in place, so a failure here is
// the caller's to explain — it deletes that copy and puts the server back — and
// a notification that the language server failed to start, naming a file about
// to be deleted, would send the reader after the wrong thing. Where no language
// server runs in the window there is nothing to start, and the answer says so.
async function startLanguageServerOn(file: string): Promise<ServerStart> {
  if (!daemon) { return { kind: 'noServer' }; }
  daemon.updateSettings({ ...getSettings(), binaryPath: file });
  try {
    await daemon.restart();
    return { kind: 'started' };
  } catch (err) {
    return { kind: 'failed', reason: startFailureWords(daemon?.lastStartFailure() ?? { reason: err, binaryPath: file }) };
  }
}

// restoreLanguageServer starts the language server again from the compiler the
// setting names, through the one restart the restart command takes, so a failure
// here is reported as any failed restart is.
async function restoreLanguageServer(): Promise<void> {
  if (!daemon) { return; }
  daemon.updateSettings(getSettings());
  await replaceLanguageServer();
}

// startLanguageServer puts a language server where there is none, by running
// the same evaluation of the open folders that activation runs. It derives no
// route of its own: whether this window has a folder to attach to, which one,
// and what to do when several qualify are questions that path already answers,
// and a second answer here would disagree with it the moment either moved.
//
// It ends in something the reader can see, in every branch. Where a server
// started, it says so, and which build that server reports itself to be. Where
// the evaluation settled on a state that starts nothing, it says which — and
// only where nothing else already has: a window with several candidate folders
// is asked to choose one, and a server that failed to start reports its own
// failure, both from inside that path.
async function startLanguageServer(): Promise<void> {
  const context = extensionContext;
  if (!context) { return; }
  await reactivate(context);
  if (daemon) {
    void vscode.window.showInformationMessage(
      serverInPlaceMessage('started', daemon?.getServerInitMetadata()?.version),
    );
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
  outputChannel?.appendLine(l10n.t('binary path changed; restarting in {0}s', graceSeconds));
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
      outputChannel?.appendLine(l10n.t('binary path restart cancelled'));
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
  statusBarItem.text = l10n.t('Aggrega: restarting in {0}s', pendingRestartRemaining);
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
  const result = await checkDaemonVersion({
    binaryPath: settings.binaryPath,
    compatibilityRange: declaredCompatibility(),
    spawn: spawnForCompat,
  });
  switch (result.kind) {
    case 'match':
      outputChannel?.appendLine(l10n.t('Aggrega daemon version {0} matches the declared compatibility range.', result.version));
      return;
    case 'mismatch':
      void vscode.window.showWarningMessage(
        l10n.t("Aggrega daemon version {0} is outside the extension's declared compatibility range ({1}). Behavior may be unstable; switch the daemon to a version inside that range, or the extension to one that drives this daemon.", result.version, result.range),
      );
      outputChannel?.appendLine(l10n.t('Aggrega daemon version {0} outside compatibility range {1}.', result.version, result.range));
      return;
    case 'skipped':
      outputChannel?.appendLine(l10n.t('Aggrega version check skipped: {0}', result.reason));
      return;
    case 'error':
      outputChannel?.appendLine(l10n.t('Aggrega version check failed: {0}', result.err.message));
      return;
  }
}

// declaredCompatibility reads the range of compiler versions the installed
// manifest declares this extension works with. It is the one read of that field:
// the compatibility check compares the compiler in use against it, and a
// download offers only releases inside it.
function declaredCompatibility(): string | undefined {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  return (ext?.packageJSON as { aggregaCompatibility?: string } | undefined)?.aggregaCompatibility;
}

// readRunningVersions reports what this extension and the compiler in use say
// about themselves, for the surface that shows them.
//
// 🔴 THE EXTENSION'S VERSION IS THE BUILD STAMP THIS INSTALLATION CARRIES, READ
// FROM WHERE THE EDITOR LOADED IT, NEVER THE MANIFEST'S VERSION. The manifest's
// number is the same for every build made between two releases, so a development
// window, an installed copy and a copy packaged from an edited tree would all
// report one value and a reader could not tell which of them is running. The
// stamp is written by the compile from the compiler's own build-provenance
// recipe, so it names the commit a build came from and whether its tree had
// uncommitted changes. Where the copy carries no stamp the reading is absent,
// rather than the manifest's number standing in for a provenance nobody
// established.
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
// A compiler read that fails is an absent reading rather than a message on the
// page: the reader cannot act on a spawn error and the page is not where a
// diagnosis belongs, so the detail goes to the output channel where the rest of
// this extension's diagnosis goes.
async function readRunningVersions(): Promise<VersionStandings> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  const extensionVersion = ext
    ? readBuildStamp(ext.extensionPath, (file) => fs.readFileSync(file, 'utf8'))
    : null;
  const running = daemon?.getLaunchedBinaryPath() ?? null;
  if (running === null) {
    return { extension: extensionVersion, compiler: null };
  }
  const reading = await readDaemonVersion({ binaryPath: running, spawn: spawnForCompat });
  if (reading.kind === 'unreadable') {
    outputChannel?.appendLine(l10n.t('Aggrega compiler version could not be read: {0}', reading.err.message));
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
    // The menu dispatches on the label the reader picked, so each label is read
    // once here and both the entry and the dispatch use that one value.
    const restartNow = l10n.t('Restart now');
    const cancelRestart = l10n.t('Cancel restart');
    const restartServer = RESTART_SERVER_ACTION;
    const viewOutput = l10n.t('View output');
    const revealRoot = l10n.t('Reveal workspace root');
    const showServerLog = l10n.t('Show server log');
    const items: vscode.QuickPickItem[] = [];
    if (pendingRestart) {
      items.push({ label: restartNow, description: l10n.t('Run the pending restart immediately') });
      items.push({ label: cancelRestart, description: l10n.t('Abort the pending restart ({0}s remaining)', pendingRestartRemaining) });
    }
    items.push(
      { label: restartServer, description: l10n.t('Restart the Aggrega language server') },
      {
        label: BUILD_ON_INSPECT_MENU_LABEL,
        description: buildOnInspectMenuDescription(getSettings().buildOnInspect),
      },
      { label: viewOutput, description: l10n.t('Open the Aggrega output channel') },
      { label: revealRoot, description: workspaceRootForCommands ?? l10n.t('Workspace not yet known') },
      { label: showServerLog, description: l10n.t('Focus the daemon log') },
    );
    const choice = await vscode.window.showQuickPick(items, { placeHolder: l10n.t('Aggrega: choose an action') });
    if (!choice) { return; }
    switch (choice.label) {
      case restartNow:
        pendingRestart?.restartNow();
        return;
      case cancelRestart:
        pendingRestart?.cancel();
        return;
      case restartServer:
        void vscode.commands.executeCommand(RESTART_COMMAND);
        return;
      case BUILD_ON_INSPECT_MENU_LABEL:
        await toggleBuildOnInspect();
        return;
      case viewOutput:
      case showServerLog:
        outputChannel?.show();
        return;
      case revealRoot:
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
      `${l10n.t('Aggrega: the setting could not be changed.')} ${describeError(err)}`,
    );
    return;
  }
  const choice = await vscode.window.showInformationMessage(
    buildOnInspectConfirmation(next),
    RESTART_SERVER_ACTION,
  );
  if (choice === RESTART_SERVER_ACTION) {
    void vscode.commands.executeCommand(RESTART_COMMAND);
  }
}

// navigationRequest sends one of the three navigation requests and converts the
// locations its answer names. Each answer carries its locations under a member of
// its own — one under location for a definition, a list under locations for the
// two others — so the reading is handed in beside the request it reads.
async function navigationRequest<A>(
  method: RequestMethod,
  doc: vscode.TextDocument,
  position: vscode.Position,
  buildParams: (uri: string, pos: { line: number; character: number }, content: string, enc: 'utf-8' | 'utf-16') => unknown,
  locationsOf: (answer: A | null) => DaemonLocation[],
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
  const result = await tryRequest<A>(method, params, doc);
  if (!result) { return undefined; }
  const locations = locationsOf(result);
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
      // A completion or a hover is asked for, but not the build or the graph a
      // refusal of it is about, so the refusal is treated as work nobody asked
      // for.
      const ctx = buildErrorContext(doc.uri, 'nobody');
      if (ctx && handleDaemonError(err, ctx) !== 'unrecognised') {
        return null;
      }
    }
    outputChannel?.appendLine(l10n.t('{0} failed: {1}', method, describeError(err)));
    return null;
  }
}

// reportDaemonError routes a thrown value to the per-code error surfaces when
// it is a daemon error envelope, and reports whether it did. It is the entry
// point for a surface that has no document of its own to hang a failure on —
// the topology graph, whose subject is a Release rather than the file in the
// active editor.
//
// Which document a refusal is about is refusalDocument's answer, read off the
// envelope; fallbackPath is the caller's own subject, for an envelope that names
// no artifact at all. A relative value resolves against the anchored root,
// matching the form the daemon accepts and returns.
//
// 🔴 A REFUSAL WHOSE SURFACE IS AN ENTRY ON A DOCUMENT IS NOT FILED HERE. Every
// caller of this one reports the refusal of a build, a preview or a graph, and
// such a refusal was filed as its answer arrived (answeredFor), kept apart from
// the documents' own findings. Filing it here as well would put a second copy in
// the document's own collection, which that document's close and its next
// validation take away while the first stays.
//
// whoAsked is the caller's: every caller of this one is an operation the reader
// pressed or a drawing that says for itself whether it was asked for.
function reportDaemonError(err: unknown, fallbackPath: string, whoAsked: WhoAsked): DaemonErrorRouting {
  if (!isJsonRpcError(err) || !workspaceRootForCommands) {
    return 'unrecognised';
  }
  if (refusalEntry(err)) {
    return 'surfaced';
  }
  const named = refusalDocument(err, fallbackPath);
  if (!named) {
    return 'unrecognised';
  }
  const absolute = fromWorkspaceRelative(workspaceRootForCommands, named);
  const ctx = buildErrorContext(vscode.Uri.file(absolute), whoAsked);
  return ctx === null ? 'unrecognised' : handleDaemonError(err, ctx);
}

// answeredFor waits on one build, preview or graph request for release, and has
// its ending replace what that Release's earlier answers filed among the
// operations' refusals, before handing the answer — or the refusal — on to the
// caller unchanged.
//
// 🔴 EVERY REQUEST OF THOSE THREE METHODS IS SENT THROUGH HERE, because this is
// where an answer arrives whoever sent it: a press of Build or Preview, a graph
// drawn or redrawn, and the graph asked for without drawing. A refusal for a
// dependency that does not resolve then stays in the Problems panel until the
// next answer for the same Release comes without it — whichever of the three
// gives that answer — and a request that never answered changes nothing. What
// each ending files is decided in operation-refusals.ts.
function answeredFor<T>(release: string, sent: Promise<T>): Promise<T> {
  return sent.then(
    (answer) => {
      fileOperationAnswer(release, { answered: answer });
      return answer;
    },
    (err: unknown) => {
      fileOperationAnswer(release, { thrown: err });
      throw err;
    },
  );
}

// fileOperationAnswer files one ending's entries for release, each on the
// document it names, resolved against the anchored root as every request's
// paths are, and addressed by the URI the collection files it under.
function fileOperationAnswer(release: string, settled: Settled): void {
  const filings = filingsForAnswer(settled, release);
  const root = workspaceRootForCommands;
  if (filings === undefined || !operationRefusals || !root) { return; }
  operationRefusals.replace(release, filings.map((f) => ({
    document: vscode.Uri.file(fromWorkspaceRelative(root, f.document)).toString(),
    entry: f.entry,
  })));
}

function buildErrorContext(uri: vscode.Uri, whoAsked: WhoAsked): DaemonErrorContext | null {
  if (!diagnosticCollections || !outputChannel || !workspaceRootForCommands) {
    return null;
  }
  // A refusal of a document's own request — its validation, a hover, a
  // completion — is filed in the document-validation layer's collection, beside
  // that layer's own findings, so the document's next validation replaces it and
  // its close takes it away. A build's, a preview's or a graph's never reaches
  // this collection (reportDaemonError).
  const collection = diagnosticCollections.for(DIAGNOSTIC_SOURCE_FALLBACK);
  const channel = outputChannel;
  const settings = getSettings();
  return {
    uri,
    whoAsked,
    publishShape: (u: vscode.Uri, shapes: Parameters<typeof publishShapes>[2]) =>
      publishShapes(collection, u, shapes),
    logLine: (line: string) => channel.appendLine(line),
    notify: (kind: 'error' | 'info', message: string, ...items: string[]) => (kind === 'error'
      ? vscode.window.showErrorMessage(message, ...items)
      : vscode.window.showInformationMessage(message, ...items)),
    // The notice's Pull is the Commands panel's Pull, reached through the handle
    // that panel returns, so there is one way of pulling and it ends the same way
    // wherever it was pressed. Before that panel exists there is nothing to run.
    pull: (release: string | null) => { void operationsView?.pull(release); },
    selectedRelease,
    toastDebounce,
    toastDebounceMode: settings.toastDebounceMode,
    toastThrottleSeconds: settings.toastThrottleSeconds,
    now: () => Date.now(),
  };
}

// requestReleaseCandidates asks the daemon for the workspace's Release set —
// the content-kind (`kind: Release`) walk — and the lockfile of each. The
// extension performs no Release detection of its own; this is the single
// source. Throws when the daemon is not running so callers surface a clear
// message rather than silently falling back to a filename heuristic (which
// would reintroduce the very divergence between the editor's candidates and
// the daemon's resolution this removes).
async function requestReleaseCandidates(): Promise<ReleaseCandidatesResponse> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error(l10n.t('the Aggrega daemon is not running'));
  }
  return await daemon.request<ReleaseCandidatesResponse>('aggrega/releaseCandidates', {});
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
    throw new Error(l10n.t('the Aggrega daemon is not running'));
  }
  return await daemon.request<ActiveReleaseResponse>('aggrega/activeRelease', {});
}

// requestSetActiveRelease asks the language server to record a Release as this
// workspace's default by writing the active-release marker, and answers with
// what requestActiveRelease reads once it is written.
//
// The server writes the marker rather than this extension, so the one judgement
// every write inside the workspace is held to holds this one too: a marker or a
// `.aggrega` directory that is a link leading out of the workspace is refused,
// in the compiler's words, with nothing written.
//
// Throws when the server is not running, so a caller reports that the marker was
// not written rather than reporting it recorded.
async function requestSetActiveRelease(params: SetActiveReleaseParams): Promise<ActiveReleaseResponse> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
  }
  return await daemon.request<ActiveReleaseResponse>('aggrega/setActiveRelease', params);
}

// serverListing is how an action that opens the workspace's configuration file
// asks the running language server whether that file is a link leading out of the
// workspace: its Release listing, and the root it answers for, which the names in
// that listing are relative to.
const serverListing: ServerListing = {
  listReleases: requestReleaseCandidates,
  answeredRoot: anchoredWorkspaceRoot,
};

// requestBuildPreview asks the language server what a build of the given
// Release would emit. The server runs the same computation a build runs, with
// every gate on, and writes none of the result — so a refusal here is a refusal
// a build would reach, and the answer names the artifacts a build would write.
//
// The findings that carry a document position do not come back through this
// call's answer: the server publishes them on its diagnostic channel, so they
// land in the Problems panel through the same path every other server finding
// takes. What returns is the artifact list and the advisories that name no
// position. A refusal raised while rendering is published the same way, on the
// document it names, and the refusal this call throws carries the same words and
// position.
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
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
  }
  return await answeredFor(release, daemon.request<BuildPreviewResponse>(
    'aggrega/buildPreview',
    buildPreviewParams(release),
    signal,
  ));
}

// requestBuild asks the language server to build the given Release and write
// the artifacts it renders. The server runs the same computation the preview
// runs, with every gate on, and writes the result into an output directory
// inside the workspace, placed as described below — so a refusal here is a
// refusal a command-line build would reach, and a success writes the same files
// that one would.
//
// The findings that carry a document position do not come back through this
// call's answer: the server publishes them on its diagnostic channel, so they
// land in the Problems panel through the same path every other server finding
// takes. What returns is where the build wrote, what it wrote there, and the
// advisories that name no position. A refusal raised while rendering is
// published the same way, on the document it names, and the refusal this call
// throws carries the same words and position.
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
// CHOSEN ONE RATHER THAN THE ONE THE ANCHORING SETTLED ON. The request names
// that folder so the artifacts arrive beside the work the reader is looking at,
// rather than at the workspace root however deep inside it they are working.
// Where they have chosen nothing the request says nothing, and the compiler then
// writes beneath the workspace root. A build run at a terminal writes beneath the
// workspace root wherever it is run, so for a folder below the root this build
// and that one write different trees, by design. Answering from the anchoring's
// own folder instead would name a folder nobody picked in exactly the window
// where the two folders differ.
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
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
  }
  return await answeredFor(release, daemon.request<BuildResponse>(
    'aggrega/build',
    buildParams(release, dials, outputParentFor(anchoredWorkspaceRoot(), chosenProjectFolder)),
    signal,
  ));
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
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
  }
  return await daemon.request<ImportResult>('aggrega/import', params, signal);
}

// requestCatalogIndex asks the language server for the open workspace's entity
// index — kind, name, apiVersion, description, labels and source file for every
// Aggrega document under the workspace root. The extension performs no
// workspace walk of its own; this is the single source, for the same reason
// Release detection is: a second walk would report a set the compiler is not
// using whenever the two disagreed, and nothing would report the disagreement.
// It is asked in the selected Release's terms, so where the workspace gives its
// Releases catalog directories of their own it names what that Release reads,
// and every surface offering the workspace's entities — the Catalog panel and the
// Commands panel's choosers alike — offers the same set.
// Throws when the server is not running, so a caller surfaces that state rather
// than showing an empty workspace.
async function requestCatalogIndex(signal?: CancellationSignal): Promise<CatalogIndexDoc> {
  return await requestCatalogIndexWith(catalogIndexParams(selectedRelease()), signal);
}

// requestCatalogIndexWith asks for the entity index in the terms the parameters
// name. The surfaces offering the workspace's entities ask it through the
// selected Release, above; the graph panel's list of what may attach asks it
// through the Release its graph was drawn from, which can be another once the
// selection has moved.
async function requestCatalogIndexWith(params: CatalogIndexParams, signal?: CancellationSignal): Promise<CatalogIndexDoc> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
  }
  return await daemon.request<CatalogIndexDoc>('aggrega/catalogIndex', params, signal);
}

// readConnectionDocuments reads which documents the attach at the cursor is
// offered in, and publishes them as the editor condition the manifest offers the
// command under: each document the entity index reports as an Aggregate or a
// Release, as connectionDocumentFiles decides. The index is asked in the selected
// Release's terms, as the Catalog panel asks it, so the documents are the ones
// that panel lists.
//
// A read that cannot be answered offers the command in no document — none can be
// said to be an Aggregate or a Release — and the reason is on the channel. A read
// overtaken by a later one, or by the compiler stopping, publishes nothing.
async function readConnectionDocuments(): Promise<void> {
  connectionDocumentsRead += 1;
  const read = connectionDocumentsRead;
  const root = workspaceRootForCommands;
  if (!root || !isLanguageServerRunning()) {
    publishConnectionDocuments([]);
    return;
  }
  let files: string[] = [];
  try {
    files = connectionDocumentFiles(await requestCatalogIndex());
  } catch (err) {
    outputChannel?.appendLine(l10n.t('catalogIndex failed, so the attach at the cursor is offered in no document: {0}', describeError(err)));
  }
  if (read !== connectionDocumentsRead) { return; }
  publishConnectionDocuments(files.map((file) => vscode.Uri.file(fromWorkspaceRelative(root, file)).fsPath));
}

// clearConnectionDocuments offers the command in no document, and drops the
// answer of a read still in flight.
function clearConnectionDocuments(): void {
  connectionDocumentsRead += 1;
  publishConnectionDocuments([]);
}

// publishConnectionDocuments sets the editor condition to a list of paths, which
// the manifest matches the active document's resourcePath against.
//
// Each is the path of the document's file URI as this side holds it, which is the
// spelling that matches in a local window and in a remote one alike. The editor
// writes a document's resourcePath as that same path for a document it holds as
// a file. Where the extension runs on a remote host, the editor holds the document
// under the remote's own scheme and writes the URI's path instead, which is the
// path this side holds wherever the host spells a path from its root with forward
// slashes — every host but a Windows one. A URI string would match in neither
// remote case, because the editor's URI for the document is not the one this
// side holds.
function publishConnectionDocuments(paths: string[]): void {
  void vscode.commands.executeCommand('setContext', CONNECTION_DOCUMENTS_CONTEXT_KEY, paths);
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
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
  }
  return await daemon.request<ScaffoldEntityResponse>('aggrega/scaffoldEntity', { kind, name });
}

// requestEntityDefinition asks the language server what one entity resolves to.
// It resolves through the session's own catalog view, in the selected Release's
// terms, so the answer is what a build of that Release would resolve rather than
// what a second reader of the workspace would.
// Throws when the server is not running, so a caller reports that state rather
// than presenting an empty answer as an entity that resolves to nothing.
async function requestEntityDefinition(
  name: string,
  signal?: CancellationSignal,
): Promise<unknown> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
  }
  return await daemon.request<unknown>('aggrega/entityDefinition', entityDefinitionParams(name, selectedRelease()), signal);
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
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
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
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
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
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
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
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
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
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
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
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
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
// It carries no cancellation. The compiler would honour one — the handler hands
// the request's own context to the shared operation, which ends the registry's
// trust fetch on a stop — but this surface draws no stop for the seeding, so a
// request once sent runs to its answer.
//
// A seeding that wrote is followed by a restart of the language server, which
// reads configuration only when it starts; see configurationWatch. The answer
// carries whether the restarted server has read it, for the ending to say.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting a seeding that never ran as one that found nothing to do.
async function requestConfigInit(params: ConfigInitParams): Promise<AppliedWrite<ConfigInitResult>> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
  }
  const client = daemon;
  return await configurationWatch.ownWrite(
    () => client.request<ConfigInitResult>('aggrega/configInit', params),
    (result) => (result.written ? writtenFile(result.scope) : null),
  );
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
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
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
// one unauthenticated request to that registry's own origin. The request itself
// prompts for nothing: a registry advertising nothing is reported as advertising
// nothing and the registration proceeds, except the official hub, which is
// reported as pinned to its built-in baseline — as it is when the offline posture
// keeps it from being asked. The identities and the key a reader supplies after
// such an answer travel on a second request through here; where either is given,
// no fetch is made.
//
// It carries no cancellation, and that is read off what the compiler does rather
// than assumed: the shared operation behind the request is reached with none, and
// the handler checks for a stopped caller only after that operation has returned.
// A stop sent here would stop this client waiting and not the work, so none is
// offered.
//
// The registration is followed by a restart of the language server, which reads
// configuration only when it starts, so the registry it wrote is in force the
// moment the operation ends; see configurationWatch. The answer carries whether
// the restarted server has read it, which is what the ending says.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting a registration that never ran as one that changed nothing.
async function requestRegistryAdd(params: RegistryAddParams): Promise<AppliedWrite<RegistryAddResult>> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
  }
  const client = daemon;
  return await configurationWatch.ownWrite(
    () => client.request<RegistryAddResult>('aggrega/registryAdd', params),
    (result) => writtenFile(result.scope),
  );
}

// requestRegistryRemove asks the language server to drop a registry's entry.
//
// It reaches no registry: a removal operates on the configuration text alone.
// The answer names the host the compiler resolved the token to and the file the
// removal wrote, so the reader is told what was removed and from where rather
// than that something finished.
//
// It carries no cancellation, for the same measured reason as the registration
// above, and it is followed by the same restart.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting a removal that never ran as one that found nothing to remove.
async function requestRegistryRemove(
  params: RegistryRemoveParams,
): Promise<AppliedWrite<RegistryRemoveResult>> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
  }
  const client = daemon;
  return await configurationWatch.ownWrite(
    () => client.request<RegistryRemoveResult>('aggrega/registryRemove', params),
    (result) => writtenFile(result.scope),
  );
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
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
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
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
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
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
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
// An attachment that wrote is followed by a restart of the language server, which
// reads configuration only when it starts; see configurationWatch.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting an attachment that never ran as one that found no plugin.
async function requestPluginAdd(
  params: PluginAddParams,
  signal?: CancellationSignal,
): Promise<AppliedWrite<PluginAddResult>> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
  }
  const client = daemon;
  return await configurationWatch.ownWrite(
    () => client.request<PluginAddResult>('aggrega/pluginAdd', params, signal),
    (result) => (result.written ? writtenFile(result.scope) : null),
  );
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
// The removal is followed by a restart of the language server, which reads
// configuration only when it starts; see configurationWatch.
//
// Throws when the server is not running, so a caller reports that state rather
// than presenting a removal that never ran as one that found nothing to remove.
async function requestPluginRemove(params: PluginRemoveParams): Promise<AppliedWrite<PluginRemoveResult>> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
  }
  const client = daemon;
  return await configurationWatch.ownWrite(
    () => client.request<PluginRemoveResult>('aggrega/pluginRemove', params),
    (result) => writtenFile(result.scope),
  );
}

// The three publication requests: publishing a catalog entity, signing what is
// already published, and withdrawing it.
//
// 🔴 THEY REACH FURTHER THAN ANYTHING ELSE HERE, WHICH IS WHY EACH ANSWER NAMES
// ITS REACH. Everything else on these surfaces changes this machine; these change
// what every consumer of that registry resolves, and neither published bytes nor a
// signature can be recalled from anyone who has already fetched them. Each answer
// carries every registry host it addressed and whether it attached anything, so
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
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
  }
  return await daemon.request<PublishEntityResult>('aggrega/publishEntity', params, signal);
}

async function requestSignArtifacts(
  params: SignArtifactsParams,
  signal?: CancellationSignal,
): Promise<SignArtifactsResult> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
  }
  return await daemon.request<SignArtifactsResult>('aggrega/signArtifacts', params, signal);
}

async function requestDeprecateArtifact(
  params: DeprecateArtifactParams,
  signal?: CancellationSignal,
): Promise<DeprecateArtifactResult> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
  }
  return await daemon.request<DeprecateArtifactResult>(
    'aggrega/deprecateArtifact', params, signal,
  );
}

// requestRegistryUpdate builds the searchable index of the configured
// registries.
//
// 🔴 IT REACHES THE REGISTRIES THEMSELVES, AND ITS STOP REACHES THE WALK. The
// request's own context is what the shared walk observes: ahead of each
// registry's walk, again ahead of writing that registry's index, and in every
// network call the walk makes. Measured against a registry that accepts a
// connection and never answers: a stop sent four seconds in leaves no walk
// running eleven seconds in, while an unstopped run is still inside the
// repository enumeration at the same moment. So a reader's stop ends the walk
// rather than only ending this side's wait.
//
// 🔴 WHAT A STOP LEAVES BEHIND, STATED RATHER THAN GLOSSED: the registries whose
// walks had finished have been written, because each registry's records land
// only once its own walk finishes, and the registry being walked keeps the index
// it had. A stop is not an undo. The compiler sends no answer to a stopped
// request, so the ending says the build was stopped and names no count.
//
// 🔴 NOTHING IS PROMPTED FOR. Credentials resolve from a supplied or ambient
// source, and a registry needing one the machine does not carry is refused with
// the credential named.
//
// It throws when the server is not running, so a caller reports that state rather
// than presenting an operation that never ran as one that did nothing.
async function requestRegistryUpdate(
  params: RegistryUpdateParams,
  signal?: CancellationSignal,
): Promise<RegistryUpdateResult> {
  if (!daemon || daemon.getState() !== DaemonState.Running) {
    throw new Error(LANGUAGE_SERVER_NOT_RUNNING);
  }
  return await daemon.request<RegistryUpdateResult>('aggrega/registryUpdate', params, signal);
}

// handleCacheMiss answers a language request the language server refused as
// "file not validated". What it does is decided in cache-miss.ts; what is here is
// the two requests it may send, composed as every other validation and as the
// refused request were.
async function handleCacheMiss<T>(method: RequestMethod, params: unknown, doc: vscode.TextDocument): Promise<T | null> {
  const client = daemon;
  if (!client) { return null; }
  return recoverFromCacheMiss<T>({
    // The re-seed carries the selected Release for the same reason every other
    // validate does: it repopulates the caches the retried request reads, and a
    // document-only seed would repopulate them from the narrower answer.
    validate: () => client.request<void>('aggrega/validate', validateParamsFor(doc)),
    retry: () => client.request<T>(method, params),
    failed: (err) => outputChannel?.appendLine(l10n.t('cache-miss retry failed: {0}', describeError(err))),
  });
}
