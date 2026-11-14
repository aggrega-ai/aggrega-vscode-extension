// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { reportOutcome } from './cli-operation';
import { PUBLISHED_RELEASES, installedFileName, targetWords } from './compiler-download';
import {
  CompilerMemory,
  DownloadPrompts,
  HostFacts,
  compilerSituation,
  downloadCompiler,
  namesAPath,
  noteNewerRelease,
  samePath,
  situationLine,
} from './compiler-provision';
import {
  SELECT_COMPILER_VERSION_COMMAND,
  ServerStart,
  VersionPrompts,
  selectCompilerVersion,
  versionDescription,
} from './compiler-version';
import { RESTART_COMMAND } from './daemon-status';
import { SpawnFn, readDaemonVersion } from './version-check';
import { describeError } from './error-surfaces';
import { makeNonce } from './html';
import * as l10n from './l10n';
import { panelControlCommand } from './panel-control';
import { RendersOnReady } from './readiness';
import { RegistryListDoc } from './registries-run';
import { SELECTOR_ROW_LABELS } from './selector-levels';
import { DEFAULT_SETTINGS, SERVER_CONFIG_SECTION } from './settings';
import {
  ConfigInitParams,
  ConfigInitResult,
  SEEDING_SUBJECT,
  runSeeding,
  seedingOpeningLine,
} from './config-seeding';
import {
  CONFIG_FILENAME,
  WORKSPACE_ANCHOR_CONFIG,
  findAggregaWorkspaceAnchor,
} from './workspace';
import { candidateFilesAcrossWindow } from './workspace-search';
import { appendFolderToWindow } from './window-folders';
import { AddingWindow, addFolderWithAnswer } from './project-folder';
import {
  CHOOSE_WORKSPACE_COMMAND,
  CREATE_WORKSPACE_COMMAND,
  DISMISSED_CONFIRMATION,
  DISMISS_COMMAND,
  DOWNLOAD_COMPILER_COMMAND,
  DRAFT_RELEASE_COMMAND,
  GetStartedFacts,
  LOCATE_COMPILER_COMMAND,
  OPEN_ON_STARTUP_COMMAND,
  SEED_NAMED_REGISTRY_COMMAND,
  SEED_REGISTRY_COMMAND,
  StepId,
  StepReading,
  USE_COMPILER_ON_PATH_COMMAND,
  WELCOME_OPEN_COMMAND,
  WELCOME_PANEL_TITLE,
  WELCOME_SHOW_COMMAND,
  WELCOME_SHOW_SETTING,
  WELCOME_VIEW_TYPE,
  isWelcomePageTab,
  panelControlCommands,
  readCollapsedSteps,
  stepReadings,
} from './get-started-steps';
import { AppliedWrite, ConfigurationWriter, endingInEffect } from './config-change-watch';
import { ServerListing, configurationOpening } from './configuration-leading-out';
import {
  ServerReading,
  VersionStandings,
  dismissHtml,
  initiallyCollapsedStepIds,
  serverHtml,
  stepsHtml,
  versionsHtml,
  welcomeDocumentHtml,
} from './welcome-render';

// This module is the whole editor-coupled boundary of the welcome panel. What
// the panel MEANS — which conditions exist and when one is met — is in
// get-started-steps.ts, and how it is COMPOSED is in welcome-render.ts; neither
// imports an editor type. What is left here is the wiring: reading the four
// facts, drawing them into the panel, running the controls, and opening it.
//
// THE PANEL IS AGGREGA'S OWN, IN ITS OWN TAB, AND IT IS DRAWN BY THIS CODE.
// That is what lets a step go back to still-to-do when its condition lapses:
// every refresh re-composes the list from freshly read facts, so a mark follows
// its condition in both directions rather than only ticking forward.
//
// BECAUSE THIS EXTENSION DRAWS THE PANEL, THE PANEL CANNOT OPEN BEFORE THIS
// EXTENSION RUNS — and the reader it exists for is precisely the one whose
// folder holds no Aggrega YAML and no configuration file, so neither the
// language-related nor the workspace-contains activation event fires for them.
// The manifest therefore declares a startup activation event with no workspace
// precondition. Without it the panel would be registered, every assertion here
// would pass, and the reader it is for would never see it.

// BINARY_PATH_KEY is the preference a compiler step writes. It is spelled from
// the section and key the settings reader already uses, so the two cannot come
// to name different preferences.
const BINARY_PATH_KEY = 'binaryPath';

// PanelReading is everything one pass over the live state read: the four steps
// as they now stand, and what the two pieces of software report about
// themselves.
//
// The two travel together because they are taken together and used together —
// a path that draws the panel needs both, and a second pass for the versions
// alone would ask the compiler twice for one drawing.
interface PanelReading {
  steps: Record<StepId, StepReading>;
  versions: VersionsReading;
  // lifecycleAt is how many lifecycle moves had been reported when the pass
  // began, so a panel created from it can tell whether the language server
  // moved while it was being read.
  lifecycleAt: number;
}

// VersionsReading is one reading of the versions, and whether it is still the
// most recent one asked for.
interface VersionsReading {
  versions: VersionStandings;
  current(): boolean;
}

// WelcomePage is the handle the extension holds to the welcome page.
export interface WelcomePage {
  // refresh re-reads the four conditions and redraws the steps and the
  // versions; its first invocation also settles and opens the page, for the
  // reason activateGetStarted states.
  refresh(): void;
  // followLifecycle redraws the page's foot readings that follow the language
  // server — the line saying whether it is running, and the versions beside it —
  // and nothing else. The extension calls it from every point that refreshes
  // the lifecycle indicator.
  followLifecycle(): void;
}

// GetStartedDeps is the live state the panel reads. Every field is a fact some
// other part of the extension already owns; nothing here keeps a copy, so the
// panel cannot come to disagree with the surfaces reporting the same facts.
export interface GetStartedDeps extends RendersOnReady {
  getWorkspaceRoot(): string | null;
  getBinaryPath(): string;
  isCompilerAnswering(): boolean;
  selectedRelease(): string | null;
  // offerableReleases reports how many Releases the last enumeration could name
  // in a request, or null where no enumeration has produced an answer.
  //
  // It decides which words the Release step shows where nothing is selected:
  // telling a reader that none is selected in a workspace that offers none
  // sends them to a chooser whose only possible answer is an empty list. It is
  // a dependency for the reason every other field here is — the selection
  // already owns that count, and a second walk of the workspace would be a
  // second answer to a question that has one.
  offerableReleases(): number | null;
  // reanchor re-evaluates the open folders and attaches the language server.
  //
  // It is a dependency rather than something reached through a command because
  // two of the controls need it in a state where nothing else will do it: a
  // freshly written configuration file changes no folder, so the editor raises
  // no event; and the automatic restart that follows a binary-path change is
  // registered only once a language server has been established, so in the very
  // state the compiler step is for there is nothing listening.
  reanchor(): Promise<void>;
  // writeConfiguration runs a write of a configuration file this panel makes
  // itself, so that a language server already running where the file lands is
  // restarted to read it — and one started by the write's own re-attachment is
  // not restarted a second time. A running server reads its configuration only
  // when it starts, and the reader who pressed the control asked for the change.
  writeConfiguration: ConfigurationWriter;
  // rememberAnchorChoice records which anchored folder this window works in, and
  // answers with the path it replaced.
  //
  // It is a dependency for the same reason reanchor is, and it is needed for a
  // reason reanchor cannot cover: re-evaluating the open folders lets a still-valid
  // remembered choice outrank everything else, so a control through which the
  // reader NAMES a folder must record that answer or the re-evaluation settles on
  // the folder they asked to leave — silently, with every surface going on naming
  // it.
  rememberAnchorChoice(anchorPath: string | null): Promise<string | null>;
  // addingWindow reports the two memories a reader's answer can be kept in and
  // the kind of window this is, which decides between them when a folder is
  // added.
  //
  // A folder added to a window on one folder, or on none, turns the window into a
  // new workspace whose memory the editor opens empty, so an answer recorded
  // through rememberAnchorChoice before that add stays with the window being
  // left. It is a dependency because both memories and the window's kind are the
  // editor's, held by the surface that registers this panel.
  addingWindow(): AddingWindow;
  onSelectionChange(listener: () => void): void;
  // seedConfiguration asks the language server to seed a working configuration
  // by registering a registry and its signature trust policy.
  //
  // It is a dependency rather than something this module reaches for itself
  // because the language server is held by the surface that starts it, and
  // because passing it in is what lets the whole seeding decision — the request
  // sent, the ending reached, and the sentence a reader is left with — be read
  // back without an editor or a compiler.
  seedConfiguration(params: ConfigInitParams): Promise<AppliedWrite<ConfigInitResult>>;
  // listRegistries asks the language server which registries the resolved
  // configuration names, which is how the registry condition is read.
  //
  // It is a dependency for the same two reasons the seeding is: the language
  // server is held by the surface that starts it, and passing it in is what lets
  // the reading of that condition be exercised without a compiler.
  listRegistries(): Promise<RegistryListDoc>;
  // serverListing is how the control creating a workspace configuration asks the
  // running language server whether the configuration file it found already there
  // is a link leading out of the workspace, which only that server judges. It is a
  // dependency because the server is held by the surface that starts it.
  serverListing: ServerListing;
  // readVersions reports what this extension and the compiler in use say about
  // themselves.
  //
  // It is a dependency rather than something read here for the same reason every
  // other field is: both readings are owned elsewhere — one by the editor's
  // record of the installed extension, the other by whichever compiler the
  // language server is actually running — and a copy of either taken here would
  // be a second record of something this panel does not own. Passing it in is
  // also what lets the whole region be read back without an editor or a
  // compiler.
  readVersions(): Promise<VersionStandings>;
  // readServerStanding reports what the language server's lifecycle reads as
  // right now, and the version the running server reported about itself, for
  // the page's last line. It is a dependency because the lifecycle, the record
  // of whether the last attempt to start failed, and the server's own answer
  // are held by the surface that starts the server; it answers at once, so the
  // line is drawn from the position it names rather than from one read earlier.
  readServerStanding(): ServerReading;
  // runVersion runs a compiler with arguments and answers with what it printed.
  // It is the seam every reading of a compiler's version goes through, handed in
  // so this module starts no process of its own.
  runVersion: SpawnFn;
  // compatibilityRange is the range of compiler versions this extension works
  // with, as the installed manifest declares it, which is what a download offers
  // from.
  compatibilityRange(): string | undefined;
  // startServerOn starts the language server from one compiler file without
  // moving the setting, and restoreServer starts it again from the compiler the
  // setting names. A change of version tries the new copy through the first and
  // puts the server back through the second; both are dependencies because the
  // language server is held by the surface that starts it.
  startServerOn(file: string): Promise<ServerStart>;
  restoreServer(): Promise<void>;
  output: vscode.OutputChannel;
}

// activateGetStarted publishes the four conditions, registers the controls, and
// hands back two calls: the one that re-reads the conditions, and the one that
// redraws the foot readings following the language server.
//
// The caller invokes the first after re-evaluating the open folders, and that
// is not optional: the readiness signal every other view renders from announces
// itself only when a workspace root AND an answerable language server are both
// in hand, so a workspace that is anchored but whose compiler will not start
// reaches readiness never — and its met workspace condition would go
// unpublished, telling exactly the reader on the compiler step that they had
// not even got that far.
//
// 🔴 THE CALL HANDED BACK ALSO PERFORMS THE PANEL'S FIRST OPENING, ON ITS FIRST
// INVOCATION, AND THAT IS THE WHOLE REASON THE ARRANGEMENT IS RIGHT. The
// arrangement a panel opens in is decided from the conditions read when it is
// created, so the first creation has to happen at a moment those conditions are
// final — and the only such moment is the one this call is made from, after the
// open folders have been evaluated, the language server has settled into
// whatever state it reaches, and the Release selection has been restored.
//
// Opening the panel from inside this function instead reads all four conditions
// before any of them has been established: the workspace root is assigned
// during the caller's own evaluation, the language server does not exist yet,
// and the selection is restored after it starts. A panel created there is
// created from four honestly-false readings, so its arrangement is empty and a
// reader who has satisfied everything meets a fully expanded panel. The marks
// then correct themselves on the next refresh and the arrangement cannot,
// because the arrangement is deliberately not live.
//
// 🔴 READINESS IS THE WRONG MOMENT FOR THIS, THOUGH IT LOOKS LIKE THE RIGHT
// ONE, AND IT IS WRONG TWICE. It rises inside the language server's own start,
// which is before the Release selection is restored, so a Release about to be
// selected would be frozen as still-to-do. And it never rises at all for a
// workspace that is anchored whose compiler will not start — a reader who HAS
// satisfied a step — so their satisfied step would open expanded, which is the
// defect the arrangement exists to remove, arriving from the other direction.
// The caller's own settling point is true of every branch, including the two
// that start no language server and the one where starting failed.
export function activateGetStarted(
  context: vscode.ExtensionContext,
  deps: GetStartedDeps,
): WelcomePage {
  // The one panel, reused. A second press reveals the one already open rather
  // than stacking tabs, and closing it clears this so a later refresh has
  // nothing to draw into.
  let panel: vscode.WebviewPanel | null = null;

  // Where this extension downloaded a compiler on this machine, and which newer
  // versions it has already mentioned — its own record, held in its own storage
  // rather than in a setting.
  const memory = compilerMemory(context.globalState, os.hostname());

  // pagesLeftBehind answers with the tabs the editor holds a welcome page in that
  // this extension did not draw — every such tab, while it has drawn none.
  //
  // 🔴 A PAGE OUTLIVES THE EXTENSION HOST THAT DREW IT. Where the editor restarts
  // its extensions in place — the add that makes a window on one folder into a
  // workspace, for one — it keeps every page in its tab, drawn as it last was, and
  // nothing answers for it any more: its controls run nothing and it never follows
  // the workspace again. The editor does not hand it to the extension that starts
  // afterwards, a serializer included, so that extension finds it among the
  // editor's tabs. Asked while a page of this extension's own is open, the answer
  // would hold that page's tab too, so it is empty then.
  const pagesLeftBehind = (): vscode.Tab[] => {
    if (panel !== null) { return []; }
    return vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.input instanceof vscode.TabInputWebview && isWelcomePageTab(tab.input.viewType));
  };

  // 🔴 NO STANDINGS ARE HELD HERE, AND THE ABSENCE IS THE MECHANISM. Every path
  // that draws the panel or decides its arrangement reads the four conditions
  // for itself and uses the answer it got, so there is no shared field for a
  // second read — landing later, from an event nobody here initiated — to
  // overwrite between one path's read and its use of it. A held field is what
  // makes an arrangement's correctness depend on which of two concurrent reads
  // finished last, and reads genuinely do overlap: the registry condition is a
  // question put to the compiler.

  // The sections the panel is currently arranged with closed.
  //
  // 🔴 IT IS DELIBERATELY NOT DERIVED FROM THE STANDINGS, and it lives
  // out here rather than inside the composition for two reasons that both bite.
  // A composition that decided the arrangement from what is met would re-decide
  // it on every refresh — and refreshes arrive when the compiler becomes
  // answerable or the selection moves, neither of which the reader asked for —
  // so a step satisfied while it was being read would fold up under the
  // reader's cursor. And because a refresh replaces the whole list rather than
  // patching it, that same re-decision would discard whatever the reader had
  // toggled, springing a caret they pressed back on the next unrelated event.
  //
  // So it is read once, from the standings in hand at the moment the panel is
  // created, and afterwards it moves only when the reader moves it.
  let collapsed: StepId[] = [];

  // versionsAsked numbers the readings of the versions, so the region is drawn
  // only from the most recent one asked for.
  //
  // 🔴 TWO PATHS READ THE VERSIONS AND THEIR READINGS OVERLAP. The steps'
  // re-read takes one, and so does every move of the language server's
  // lifecycle — and a restart is several moves in quick succession, each asking
  // the compiler it finds. The answers arrive in whatever order the subprocesses
  // finish, so a reading taken while a server was still up could land after one
  // taken once it had gone, and draw a compiler beside a line saying nothing is
  // running. Numbering them puts the order back: a reading superseded before it
  // arrived is dropped.
  let versionsAsked = 0;
  const readVersions = async (): Promise<VersionsReading> => {
    const asked = ++versionsAsked;
    const versions = await deps.readVersions();
    return { versions, current: () => asked === versionsAsked };
  };
  const postVersions = (read: VersionsReading): void => {
    if (!read.current()) { return; }
    panel?.webview.postMessage({ type: 'versions', html: versionsHtml(read.versions) });
  };

  // lifecycleMoves counts the lifecycle moves reported, whether or not a panel
  // was there to draw them, so a panel being created can tell whether one landed
  // while its reading was being taken.
  let lifecycleMoves = 0;

  // followLifecycle redraws the foot readings that follow the language server,
  // and leaves the steps where they are.
  //
  // 🔴 THE STEPS ARE NOT RE-READ HERE, AND THAT IS THE RULE THIS KEEPS RATHER
  // THAN A SAVING. A step keeps its standing while the language server
  // restarts, which is why only the rising edge of readiness redraws the steps;
  // the line saying whether the server is running exists to follow every move,
  // falling edges included. The two regions are therefore driven apart: this is
  // called on every lifecycle move and redraws only the foot.
  //
  // The line is drawn at once, from the position the call was made in; the
  // versions follow when the compiler has answered.
  const followLifecycle = (): void => {
    lifecycleMoves += 1;
    if (panel === null) { return; }
    panel.webview.postMessage({ type: 'server', html: serverHtml(deps.readServerStanding()) });
    void readVersions().then(postVersions);
  };

  // Two events can ask for a re-read while one is still in flight, because
  // reading the registry condition asks the compiler. Coalescing means the
  // panel settles on the last answer asked for rather than on whichever
  // subprocess happened to finish last.
  let inFlight = false;
  let again = false;
  // reread answers with the standings IT read.
  //
  // 🔴 THE ANSWER IS WHAT A CALLER DECIDING AN ARRANGEMENT USES, and it is
  // returned rather than recorded for exactly that reason. Two reads can be in
  // flight at once — reading the registry condition asks the compiler, and the
  // panel-opening paths read directly rather than through the coalescer — so a
  // recorded reading would name whichever read landed last, which is not
  // necessarily the one a given caller awaited. An arrangement decided from a
  // recorded reading would therefore be decided from another read's answer,
  // intermittently and invisibly. Decided from the returned value it is decided
  // from the reading the caller actually took, whatever else lands around it.
  const reread = async (): Promise<PanelReading> => {
    const lifecycleAt = lifecycleMoves;
    const [facts, versions] = await Promise.all([readFacts(deps), readVersions()]);
    const read = stepReadings(facts);
    // 🔴 THE LIST IS RE-COMPOSED FROM THE STANDINGS JUST READ, IN BOTH
    // DIRECTIONS. A step whose condition has lapsed is composed as still to do
    // again, because nothing here accumulates a previous mark — which is the
    // defect a panel drawn by this extension does not inherit.
    //
    // The arrangement is passed alongside rather than recomputed: the mark
    // follows the condition, the arrangement follows the reader. Handing the
    // reader's arrangement to the composition is also what keeps a re-drawing
    // from painting the default shape first and correcting itself afterwards.
    panel?.webview.postMessage({ type: 'steps', html: stepsHtml(read, collapsed) });
    // The versions go in their own message rather than with the steps, for the
    // reason the foot control already has one of its own: the regions move on
    // different events, and one message carrying two regions would redraw a
    // region nothing had changed. A compiler restarted onto another binary moves
    // this one and leaves the marks where they are.
    postVersions(versions);
    return { steps: read, versions, lifecycleAt };
  };
  const refresh = (): void => {
    if (inFlight) { again = true; return; }
    inFlight = true;
    void reread().finally(() => {
      inFlight = false;
      if (!again) { return; }
      again = false;
      refresh();
    });
  };

  // createPanel brings the panel into being, arranged from the standings it is
  // handed.
  //
  // It is separate from the two paths that reach it — a reader asking for the
  // panel, and the first settled reading of the conditions — because both have
  // to arrange it from a reading of their own and neither may take a second one:
  // a second read costs another question to the compiler and reintroduces
  // exactly the ambiguity about which answer decided the arrangement. So each
  // path reads once and hands its answer here.
  //
  // This is the only place the arrangement is decided from a condition rather
  // than from the reader.
  //
  // 🔴 IT IS ALSO WHERE THE WINDOW IS KEPT TO ONE PAGE. A page left behind by the
  // extensions restarting is replaced by this one, in the tab group it stood in:
  // this page is drawn there first and the one left behind closed afterwards, so
  // that group is not emptied and closed out from under the reader on the way.
  const createPanel = (read: PanelReading): void => {
    collapsed = initiallyCollapsedStepIds(read.steps);
    const leftBehind = pagesLeftBehind();
    panel = vscode.window.createWebviewPanel(
      WELCOME_VIEW_TYPE,
      WELCOME_PANEL_TITLE,
      leftBehind[0]?.group.viewColumn ?? vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
      },
    );
    // The message handler belongs to THIS panel and is disposed with it. A
    // reader may close and reopen the panel any number of times, and a handler
    // registered for the extension's whole lifetime would accumulate one dead
    // listener per closing — each holding the webview it can no longer reach.
    const listener = panel.webview.onDidReceiveMessage((message: unknown) => {
      const named = typeof message === 'object' && message !== null
        ? (message as { type?: unknown; collapsed?: unknown })
        : null;
      // The reader pressed a caret. The panel has already rearranged itself —
      // it is the one place with a document to rearrange — and this records
      // what it now shows, so the next re-composition is drawn in the shape the
      // reader left rather than the shape the panel opened in.
      if (named?.type === 'state') {
        collapsed = readCollapsedSteps(named.collapsed);
        return;
      }
      runPanelControl(message, deps.output);
    });
    panel.onDidDispose(
      () => { listener.dispose(); panel = null; },
      null,
      context.subscriptions,
    );
    panel.webview.html = welcomeHtml(
      panel.webview,
      context.extensionUri,
      read.steps,
      collapsed,
      opensWithEditor(),
      read.versions.versions,
      deps.readServerStanding(),
    );
    // A lifecycle move reported while the reading above was being taken found
    // no panel to draw into, so the versions composed here may predate it. The
    // foot is drawn again now there is a panel for it; the steps are not, for
    // the reason followLifecycle gives.
    if (lifecycleMoves !== read.lifecycleAt) { followLifecycle(); }
    closePagesLeftBehind(leftBehind, deps.output);
  };

  // reuseOpenPanel refreshes the panel that is already open, bringing it to the
  // front where the reader asked for it, and answers whether there was one.
  //
  // Bringing it to the front also moves the keyboard focus into it, which is what
  // a reader asking for the page from somewhere else — the house on the Commands
  // panel, the palette's way back — is asking for. Nothing pressed ON the page
  // reaches this with a reveal: the box at its foot writes the preference through
  // a command of its own, because a reveal there would take the focus off the box
  // the reader is pressing.
  const reuseOpenPanel = (reveal: boolean): boolean => {
    const open = panel;
    if (open === null) { return false; }
    if (reveal) { open.reveal(vscode.ViewColumn.Active); }
    refresh();
    return true;
  };

  // openPanel is what a reader asking for the panel from somewhere else reaches:
  // the house on the Commands panel runs it alone, and the palette's way back runs
  // it after turning the startup preference back on. A page already open is
  // brought to the front with the focus, as reuseOpenPanel says.
  //
  // It draws from the standings read at the moment it opens, rather than from
  // whatever was last computed: a reader who built their configuration
  // elsewhere would otherwise meet a panel telling them they have nothing, for
  // as long as the first read takes.
  //
  // Revealing a panel that is already there leaves its arrangement alone. The
  // arrangement is decided when a panel is CREATED, and a reader pressing the
  // command again is asking to be shown the panel they have, not to have it
  // rearranged around them.
  //
  // 🔴 THE PANEL IS LOOKED FOR AGAIN ONCE THE READING HAS ARRIVED, AND THAT IS
  // WHAT KEEPS IT ONE PANEL. The reading asks the compiler, so it takes long
  // enough for the page's own opening to land in the meantime — a reader who
  // asks for the page while the editor is starting is asking at exactly that
  // moment. Creating a second panel then would leave two tabs, and the first
  // would be drawn into by nothing again: it would never follow a step or the
  // language server, and closing it would drop the panel that is still open.
  const openPanel = async (): Promise<void> => {
    if (reuseOpenPanel(true)) { return; }
    const read = await reread();
    if (reuseOpenPanel(true)) { return; }
    createPanel(read);
  };

  // settle is where the panel opens by itself, from the first reading of the
  // four conditions taken at a moment all of them are established.
  //
  // Three outcomes, and each reads the conditions exactly as much as it needs.
  // A panel the reader already asked for before this point is refreshed and
  // left arranged as it is — the same rule the reveal path follows, and through
  // the coalescer rather than around it, since there is a panel to draw into. A
  // reader who has said not to open it gets no panel and no reading, because
  // nothing would draw the answer — unless the extensions restarted under a page
  // they had open. Otherwise the panel is created from one reading taken here,
  // which is the case the whole arrangement rule exists for.
  const settle = async (): Promise<void> => {
    if (reuseOpenPanel(false)) { return; }
    // What the preference gates is whether the panel OPENS BY ITSELF, not
    // whether it exists — the command that brings it back is in the palette
    // either way, which is what makes the dismissal safe to offer at all. A page
    // left behind by the extensions restarting is one the reader already had
    // open, so it is drawn again whatever the preference says.
    if (pagesLeftBehind().length === 0 && !opensWithEditor()) { return; }
    const read = await reread();
    // A reader who asked for the page while this reading was being taken has
    // it already, arranged from their own reading; it is refreshed and left.
    if (reuseOpenPanel(false)) { return; }
    createPanel(read);
  };

  // Whenever the compiler becomes answerable, or the selection moves. Only the
  // rising edge of readiness is announced, which is the extension's one rule
  // about that signal: a step keeps its standing while the language server
  // restarts rather than flickering to unmet and back.
  deps.onReady(refresh);
  deps.onSelectionChange(refresh);

  // The control at the panel's foot is composed from the preference, so it is
  // re-composed whenever the preference moves — and that is what makes it the
  // same switch as the settings screen's rather than one sitting beside it. The
  // reader may move it from either place: the control writes through the
  // editor's own configuration, which raises this event, and so does the
  // settings screen. Narrowed to the one key, so an unrelated preference does
  // not redraw it.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(WELCOME_SHOW_SETTING)) { return; }
      panel?.webview.postMessage({
        type: 'dismiss',
        html: dismissHtml(opensWithEditor()),
      });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(WELCOME_SHOW_COMMAND, () => bringBack(openPanel)),
    // Opening and bringing back are two commands over ONE opening. This is the
    // opening on its own, which is what the title-bar affordance runs: it shows
    // the page and leaves the reader's startup preference alone.
    vscode.commands.registerCommand(WELCOME_OPEN_COMMAND, () => void openPanel()),
    // Ticking the box at the page's foot: the preference alone, written through the
    // one writer, and no opening — the page is the one being pressed on, and
    // bringing it forward would take the keyboard focus off the box.
    vscode.commands.registerCommand(OPEN_ON_STARTUP_COMMAND, () => setShown(true)),
    vscode.commands.registerCommand(DISMISS_COMMAND, () => putAway()),
    vscode.commands.registerCommand(CREATE_WORKSPACE_COMMAND, () => createWorkspace(deps, refresh)),
    vscode.commands.registerCommand(CHOOSE_WORKSPACE_COMMAND, () => chooseWorkspace(deps, refresh)),
    vscode.commands.registerCommand(USE_COMPILER_ON_PATH_COMMAND, () => useCompilerOnPath(deps, refresh)),
    vscode.commands.registerCommand(LOCATE_COMPILER_COMMAND, () => locateCompiler(deps, refresh)),
    vscode.commands.registerCommand(DOWNLOAD_COMPILER_COMMAND, () => downloadCompilerHere(deps, refresh, memory)),
    vscode.commands.registerCommand(SELECT_COMPILER_VERSION_COMMAND, () => selectCompilerVersionHere(deps, refresh, memory)),
    vscode.commands.registerCommand(DRAFT_RELEASE_COMMAND, () => draftRelease()),
    vscode.commands.registerCommand(SEED_REGISTRY_COMMAND, () => seedRegistry(deps, refresh, null)),
    vscode.commands.registerCommand(SEED_NAMED_REGISTRY_COMMAND, () => seedNamedRegistry(deps, refresh)),
  );

  // 🔴 THE FIRST INVOCATION SETTLES AND OPENS; EVERY LATER ONE IS AN ORDINARY
  // REFRESH. The caller invokes this at the end of each evaluation of the open
  // folders, so the first invocation is the one moment in a window's life at
  // which all four conditions are established for the first time — and that is
  // the moment a panel has to be created in for its arrangement to be right.
  //
  // Only the first, because a later evaluation — a folder added, a language
  // server started by hand — finds a reader who may be looking at the panel.
  // Re-opening it there would put a tab in front of them that they closed, and
  // re-arranging it would fold a step away under their cursor. So the later
  // invocations move the marks and nothing else, which is what they did before.
  let settled = false;
  return {
    refresh: (): void => {
      if (settled) {
        refresh();
        return;
      }
      settled = true;
      void settle();
      // The compiler's own standing is read once per window, at the same
      // settling point, because that is when the setting the reader named has
      // been read and nothing has yet moved it.
      void readCompilerStanding(deps, memory);
    },
    followLifecycle,
  };
}

// closePagesLeftBehind closes the tabs of welcome pages an extension host that has
// stopped drew, keeping the keyboard focus on the page drawn in their place, and
// says in the output channel where the editor kept one.
function closePagesLeftBehind(tabs: readonly vscode.Tab[], output: vscode.OutputChannel): void {
  if (tabs.length === 0) { return; }
  vscode.window.tabGroups.close(tabs, true).then(
    (closed) => {
      if (!closed) {
        output.appendLine(l10n.t('get started: the editor kept open a welcome page drawn before the extensions restarted'));
      }
    },
    (err: unknown) => {
      output.appendLine(l10n.t('get started: could not close a welcome page drawn before the extensions restarted: {0}', describeError(err)));
    },
  );
}

// runPanelControl runs the command a press in the welcome panel names.
//
// Deciding whether to act on a press is panel-control.ts's, shared with the
// other document this extension draws; what is left here is the invocation,
// which is where the editor is.
// No control on this panel presents a choice beside itself, so the press is
// invoked by its command alone and the answer the shared guard carries is left
// unread. That is a property of this panel's controls rather than of the guard:
// every step here reaches a command that asks its own questions.
function runPanelControl(message: unknown, output: vscode.OutputChannel): void {
  const press = panelControlCommand(
    message,
    panelControlCommands(),
    l10n.t('get started'),
    output,
  );
  if (press === null) { return; }
  void vscode.commands.executeCommand(press.command);
}

// welcomeHtml resolves this installation's own panel resources and composes the
// document. What it composes is decided in welcome-render.ts, which holds no
// editor types, so the panel's body is assertable without an extension host.
function welcomeHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  readings: Record<StepId, StepReading>,
  collapsed: readonly StepId[],
  opensWithEditor: boolean,
  versions: VersionStandings,
  server: ServerReading,
): string {
  return welcomeDocumentHtml({
    nonce: makeNonce(),
    styleUri: webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'welcome.css'),
    ).toString(),
    scriptUri: webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'welcome.js'),
    ).toString(),
    cspSource: webview.cspSource,
    readings,
    collapsed,
    opensWithEditor,
    versions,
    server,
  });
}

// readFacts reads the four steps from the parts of the extension that already
// own them.
//
// 🔴 EACH FACT IS READ ONCE AND BOTH WHAT IT DECIDES AND WHAT IT SHOWS COME OUT
// OF THAT ONE READING. The condition and the value a step draws are never asked
// for separately, so the panel cannot tick a step against one reading and name
// a value from another — which is the shape a second call would have, on
// surfaces that genuinely move between two calls.
async function readFacts(deps: GetStartedDeps): Promise<GetStartedFacts> {
  const compilerAnswering = deps.isCompilerAnswering();
  const workspaceRoot = deps.getWorkspaceRoot();
  return {
    workspaceRoot,
    // What the workspace step's own chooser would offer, and it is looked for
    // only while there is no root — which is the only state the answer decides
    // anything in, because a step with a root to name draws the root. Asking
    // otherwise would walk the whole open workspace on every refresh to
    // produce a number nothing reads. Unasked is reported as unasked, and the
    // step then says nothing is selected rather than claiming there is nothing
    // to select, which is the safe direction to be wrong in.
    workspaceCandidates: workspaceRoot === null ? await offerableFolders(deps) : null,
    compilerAnswering,
    // The compiler the READER NAMED, which is the preference the step's own two
    // ways through write. It is deliberately not the binary a running language
    // server was started from: those diverge while a preference change waits
    // out the window in which its restart can still be cancelled, and in that
    // window the launched one would not move when the reader pressed a control
    // right beside it. It is also absent wherever nothing is running, which is
    // exactly the state the step exists for — so the reader who most needs to
    // see what they named would be shown nothing.
    compilerPath: deps.getBinaryPath(),
    release: deps.selectedRelease(),
    releaseCandidates: deps.offerableReleases(),
    // The registry question is asked of the compiler, so it is asked only once
    // the compiler is answerable. Before then the answer would be a failed
    // spawn rather than a fact, and the step above this one is the one the
    // reader is being asked to act on anyway.
    registries: compilerAnswering ? await configuredRegistries(deps) : null,
  };
}

// offerableFolders counts the folders the workspace step's own chooser would
// offer, and answers null where the search could not be made.
//
// 🔴 IT RUNS THE CHOOSER'S OWN SEARCH RATHER THAN A CHEAPER ONE, AND THE
// CHEAPER ONE IS WRONG. The count of open folders that are themselves anchored
// is already kept elsewhere and looks like the same fact, but discovery CLIMBS:
// a reader who opened a folder above the one carrying the configuration has
// none of those and one of these — and they are exactly the reader the chooser
// exists for. Reporting the cheap number would tell them nothing is available
// while the control beside those words had a folder to offer.
//
// A failure answers null rather than zero, for the reason the registry
// enumeration does: nobody having looked is not the same statement as there
// being none, and only one of them is something a reader can act on. It is
// caught here rather than left to propagate because the paths that re-read
// these facts do not await the result, so a rejection would surface as an
// unhandled one and take the whole reading with it.
async function offerableFolders(deps: GetStartedDeps): Promise<number | null> {
  try {
    return (await anchoredDirectories()).length;
  } catch (err) {
    deps.output.appendLine(
      l10n.t('get started: could not look for folders Aggrega recognises: {0}', describeError(err)),
    );
    return null;
  }
}

// configuredRegistries asks the compiler what registries the resolved
// configuration names, and answers with their hosts in the order it answered
// in. An empty list is a successful answer meaning none are configured, and
// null is a question that produced no answer. Both read as the step being
// unmet, because in neither case can the reader be told they have one; they
// read as different values, because only the first is about what the reader
// has done.
//
// The question is asked again here rather than shared with the registries panel:
// that panel computes its rows inside the editor's request for them, so it
// produces a result only while a reader has it open, and a step whose standing
// depended on that would report differently according to which panel somebody
// had expanded. The enumeration reads the resolved configuration and contacts no
// registry, so asking it again costs nothing over the network.
async function configuredRegistries(
  deps: GetStartedDeps,
): Promise<readonly string[] | null> {
  try {
    const doc = await deps.listRegistries();
    return (doc.registries ?? []).map((entry) => entry.host);
  } catch (err) {
    deps.output.appendLine(
      l10n.t('get started: could not read the configured registries: {0}', describeError(err)),
    );
    return null;
  }
}

// opensWithEditor reads the preference that decides whether the panel opens by
// itself.
//
// 🔴 IT IS THE ONE READER OF THAT PREFERENCE, AND EVERYTHING THAT DEPENDS ON IT
// GOES THROUGH HERE — whether to open the panel at all, and which way round to
// compose the control at its foot. That is what makes the control synced with
// the settings screen rather than a second switch beside it: there is one place
// the answer is read and one place it is written, so the two surfaces cannot
// come to disagree. A control holding its own copy would be a second record of
// one fact, and the failure would be a panel offering to turn something off
// that is already off.
//
// Anything other than true reads as false, including a value that is not a
// boolean at all: a preference nobody can parse is not an instruction to open a
// tab unasked.
function opensWithEditor(): boolean {
  const [section, key] = splitSetting(WELCOME_SHOW_SETTING);
  return vscode.workspace.getConfiguration(section).get<boolean>(key) === true;
}

// bringBack turns the panel back on and opens it. It is the way back from the
// dismissal, so that dismissing is a decision a reader can undo rather than a
// door that locks behind them.
async function bringBack(openPanel: () => Promise<void>): Promise<void> {
  await setShown(true);
  try {
    await openPanel();
  } catch (err) {
    // The preference is the substantive effect and it has landed; opening the
    // panel is on top of it. Where the editor declines, the reader is told the
    // panel is back rather than left to wonder whether anything happened.
    void vscode.window.showInformationMessage(
      l10n.t('Aggrega: the welcome page is back; it will open on startup. {0}', describeError(err)),
    );
  }
}

// putAway stops the panel opening. The preference is the reader's own and is
// never written into a project, so one person's dismissal never travels to
// whoever else opens the repository.
async function putAway(): Promise<void> {
  await setShown(false);
  void vscode.window.showInformationMessage(DISMISSED_CONFIRMATION);
}

async function setShown(shown: boolean): Promise<void> {
  const [section, key] = splitSetting(WELCOME_SHOW_SETTING);
  // The reader's own layer, because a preference confined to the reader has no
  // other layer it can live in: the editor refuses a write of one into a
  // project's settings outright.
  await vscode.workspace
    .getConfiguration(section)
    .update(key, shown, vscode.ConfigurationTarget.Global);
}

// createWorkspace writes the smallest configuration that makes a directory the
// root of an Aggrega workspace, then re-attaches so the step reports itself met
// without the window being reloaded. Where a language server has read the file
// once that is over, its ending says the change is in effect.
//
// A configuration file already there is opened rather than replaced, except
// where the language server attached by the re-attachment names it as a link
// leading out of the workspace: then it is left unopened, and the one ending is
// the error saying why, in place of the sentence saying it was opened.
async function createWorkspace(deps: GetStartedDeps, refresh: () => void): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showInformationMessage(
      l10n.t('Aggrega: no folder is open, so there is nowhere to write a workspace configuration. Open a folder first.'),
    );
    return;
  }
  const target = path.join(folder.uri.fsPath, CONFIG_FILENAME);
  let created = false;
  // 🔴 THE RE-ATTACHMENT IS PART OF THE WRITE HANDED TO THE WATCH, AND THAT IS
  // WHAT KEEPS THE RESTART TO ONE. Re-attaching starts a server where none was
  // running and moves one that ran somewhere else, and either of those reads the
  // file just written, so nothing more is owed. Where the folder was already the
  // one attached — anchored by a Release or an Aggregate in the same folder rather
  // than by a configuration file — re-attaching changes nothing, the running
  // server never read the new file, and it is the watch that restarts it.
  const { answer: attached, inEffect } = await deps.writeConfiguration(async () => {
    try {
      // Exclusive creation, so an existing configuration is never overwritten by
      // a control a reader pressed to make one.
      await fs.writeFile(target, WORKSPACE_ANCHOR_CONFIG, { flag: 'wx' });
      created = true;
    } catch (err) {
      if (!isAlreadyExists(err)) {
        void vscode.window.showErrorMessage(
          l10n.t('Aggrega: could not create {0}: {1}', CONFIG_FILENAME, describeError(err)),
        );
        return false;
      }
    }

    // The sentence below tells the reader this folder is now the workspace root,
    // and recording the choice is what makes that true. A window with another
    // folder already anchored and remembered would otherwise go on working there,
    // leaving a message that names one folder beside surfaces that name another.
    //
    // The marker is looked for rather than assumed to be the file just written:
    // which marker anchors a folder is one rule with one home, and a configuration
    // higher up can be the one that answers.
    const anchorPath = await findAggregaWorkspaceAnchor(folder.uri.fsPath);
    if (anchorPath !== null) {
      await deps.rememberAnchorChoice(anchorPath);
    }

    await deps.reanchor();
    return true;
  }, () => (created ? target : null));
  if (!attached) { return; }
  refresh();

  const opening = await configurationOpening(deps.serverListing, target, created ? 'created' : 'found');
  if (!opening.open) {
    void vscode.window.showErrorMessage(opening.message);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(doc);
  void vscode.window.showInformationMessage(
    created
      ? endingInEffect(l10n.t('Aggrega: {0} created; this folder is now the workspace root.', CONFIG_FILENAME), inEffect)
      : l10n.t('Aggrega: {0} already exists here, so it was opened rather than replaced.', CONFIG_FILENAME),
  );
}

// chooseWorkspace offers the folders inside the open workspace that Aggrega
// already recognises, and attaches to the one chosen.
//
// It reaches the same state the create path does rather than stopping at a file
// dialog: the chosen folder becomes one the editor has open, which is what the
// language server anchors from. That matters because the reader this path is
// for already has a working configuration somewhere below the folder they
// opened, and discovery climbs from an opened folder rather than descending
// into it.
async function chooseWorkspace(deps: GetStartedDeps, refresh: () => void): Promise<void> {
  const candidates = await anchoredDirectories();
  if (candidates.length === 0) {
    void vscode.window.showInformationMessage(
      l10n.t('Aggrega: no folder in this workspace carries anything Aggrega recognises as a workspace root, so there is none to choose. Create a workspace configuration instead.'),
    );
    return;
  }

  const opened = new Set(
    (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath),
  );
  const items = candidates.map((c) => ({
    label: path.basename(c.directory),
    description: c.directory,
    detail: path.basename(c.anchorPath),
    directory: c.directory,
    // Carried through the pick so the choice can be recorded as the window's
    // answer without the marker being looked for a second time — the first look
    // is what confirmed the folder was offerable at all, and a second one could
    // answer differently.
    anchorPath: c.anchorPath,
  }));
  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: l10n.t('Aggrega: choose the folder to work in'),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!choice) { return; }

  // 🔴 THE CHOICE IS RECORDED BEFORE ANYTHING RE-ATTACHES, AND THE ORDER IS THE
  // WHOLE FIX. The reader has named the folder they want, which is an answer that
  // outranks whatever this window last remembered; re-evaluating the open folders
  // without recording it first lets the earlier choice win, and the editor goes on
  // working in the folder they asked to leave while every surface names it.
  if (opened.has(choice.directory)) {
    await deps.rememberAnchorChoice(choice.anchorPath);
    await deps.reanchor();
    refresh();
    return;
  }
  // Adding the folder is what makes the language server anchor there. The
  // editor raises its own folders-changed event, which the extension already
  // re-attaches on, so nothing is re-attached here. The add records the answer
  // first, where the window the reader is in afterwards reads it — this window's
  // memory where the add happens in place, and the answer carried into the new
  // workspace where it makes one — and takes it back if the editor refuses.
  const outcome = await addFolderWithAnswer(
    {
      addFolder: (folder) => appendFolderToWindow(folder),
      showError: (message) => void vscode.window.showErrorMessage(message),
    },
    deps.addingWindow(),
    vscode.workspace.workspaceFolders ?? [],
    vscode.Uri.file(choice.directory),
    { level: 'workspace', path: choice.anchorPath },
  );
  if (outcome === 'declined') { return; }
  refresh();
}

// AnchoredDirectory pairs a directory with the marker that anchors it.
interface AnchoredDirectory {
  directory: string;
  anchorPath: string;
}

// anchoredDirectories finds the directories in the open workspace that Aggrega
// would recognise as a workspace root.
//
// The search pattern only narrows the walk; every candidate is then confirmed
// through the same discovery the language server's own anchoring agrees with,
// so this offers no folder that would not actually anchor. Results are
// de-duplicated by directory and returned in path order, so the list a reader
// reads is stable between invocations.
async function anchoredDirectories(): Promise<AnchoredDirectory[]> {
  // The search itself is read from the one place it is issued, so this list and
  // the population a chosen folder reaches cannot come to be computed by two
  // different patterns.
  const hits = await candidateFilesAcrossWindow(vscode.workspace.workspaceFolders ?? []);
  const directories = new Set<string>();
  for (const file of hits) {
    directories.add(path.dirname(file));
  }
  const confirmed: AnchoredDirectory[] = [];
  for (const directory of [...directories].sort()) {
    const anchorPath = await findAggregaWorkspaceAnchor(directory);
    if (anchorPath === null) { continue; }
    confirmed.push({ directory, anchorPath });
  }
  return confirmed;
}

// useCompilerOnPath restores the plain binary name, which the runtime resolves
// through PATH. It is the path for a reader who installed the compiler after
// opening the editor: nothing about their settings is wrong, the editor simply
// looked before the binary was there.
async function useCompilerOnPath(deps: GetStartedDeps, refresh: () => void): Promise<void> {
  await writeBinaryPath(DEFAULT_SETTINGS.binaryPath);
  await reattachIfSilent(deps, refresh);
}

// locateCompiler points the preference at a compiler the reader already has.
async function locateCompiler(deps: GetStartedDeps, refresh: () => void): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: l10n.t('Use this compiler'),
    title: l10n.t('Aggrega: select the aggrega binary'),
  });
  const chosen = picked?.[0];
  if (!chosen) { return; }
  await writeBinaryPath(chosen.fsPath);
  await reattachIfSilent(deps, refresh);
}

async function writeBinaryPath(value: string): Promise<void> {
  await vscode.workspace
    .getConfiguration(SERVER_CONFIG_SECTION)
    .update(BINARY_PATH_KEY, value, vscode.ConfigurationTarget.Global);
}

// reattachIfSilent starts the language server when there is none.
//
// Where one is already running, the extension's own binary-path watcher owns
// the restart and re-attaching here would be a second one; where none is
// running that watcher does not exist yet, and this is the only thing that will
// pick the new path up.
async function reattachIfSilent(deps: GetStartedDeps, refresh: () => void): Promise<void> {
  if (!deps.isCompilerAnswering()) {
    await deps.reanchor();
  }
  refresh();
}

// DOWNLOADED_INTO_KEY and MENTIONED_KEY are where the extension keeps its own
// record of the compilers it downloaded and the versions it has mentioned. Each
// is suffixed with the name of the machine the extension runs on, because that
// storage can be shared by windows working on different machines, and a path
// remembered on one says nothing about the same path on another.
const DOWNLOADED_INTO_KEY = 'aggrega.compiler.downloadedInto';
const MENTIONED_KEY = 'aggrega.compiler.mentionedVersions';

// compilerMemory reads and writes that record. Anything stored there that is not
// a list of strings reads as an empty list, which is the direction that replaces
// nothing.
function compilerMemory(store: vscode.Memento, machine: string): CompilerMemory {
  const downloadedKey = `${DOWNLOADED_INTO_KEY}:${machine}`;
  const mentionedKey = `${MENTIONED_KEY}:${machine}`;
  const list = (key: string): string[] => {
    const stored = store.get<unknown>(key);
    return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string') : [];
  };
  const add = (key: string, value: string): Thenable<void> =>
    store.update(key, [...list(key).filter((entry) => entry !== value), value]);
  return {
    downloadedInto: () => list(downloadedKey),
    rememberDownload: (file) => add(downloadedKey, file),
    mentioned: () => list(mentionedKey),
    rememberMention: (version) => add(mentionedKey, version),
  };
}

// hostFacts reads the machine this extension runs on — the machine the
// workspace is on, which in a window opened on a remote machine is that machine.
function hostFacts(): HostFacts {
  return {
    platform: process.platform,
    arch: process.arch,
    home: os.homedir(),
    env: { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT, LOCALAPPDATA: process.env.LOCALAPPDATA },
  };
}

// downloadPrompts is every question a download puts to the reader, in the
// editor's own dialogs.
//
// The folder is asked for in an input box holding the proposed folder, so
// keeping it is one key and changing it is editing a path, and the version being
// downloaded is in its title. The confirmation is modal because it is consent to
// write a file and change a setting, which a notification that can be missed
// should not stand in for.
function downloadPrompts(): DownloadPrompts {
  return {
    askFolder: (proposed, version, target) => vscode.window.showInputBox({
      title: l10n.t('Aggrega: download aggrega {0} for {1}', version, targetWords(target)),
      prompt: l10n.t('The folder to save the compiler in, as {0}. Keep the proposed folder or change it.', installedFileName(target)),
      value: proposed,
      ignoreFocusOut: true,
      validateInput: (value) => (path.isAbsolute(value.trim()) ? undefined : l10n.t('Name the folder by its full path.')),
    }),
    confirm: async (question, go) =>
      (await vscode.window.showInformationMessage(question, { modal: true }, go)) === go,
    withProgress: (title, work) => vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: true },
      (_progress, token) => {
        const stop = new AbortController();
        const listening = token.onCancellationRequested(() => stop.abort());
        return work(stop.signal).finally(() => listening.dispose());
      },
    ),
    inform: (message) => void vscode.window.showInformationMessage(message),
    warn: (message) => void vscode.window.showWarningMessage(message),
  };
}

// downloadCompilerHere downloads a compiler where the reader agrees to, points
// the setting at it, and brings the language server onto it.
//
// 🔴 WHERE THE SETTING ALREADY NAMED THE FILE THAT WAS REPLACED, WRITING IT
// CHANGES NOTHING, SO NOTHING WATCHING THE SETTING RESTARTS THE SERVER. A
// language server running the replaced file is then restarted here, so the
// compiler the reader just agreed to is the one answering.
async function downloadCompilerHere(
  deps: GetStartedDeps,
  refresh: () => void,
  memory: CompilerMemory,
): Promise<void> {
  const before = deps.getBinaryPath();
  const outcome = await downloadCompiler({
    source: PUBLISHED_RELEASES,
    host: hostFacts(),
    compatibilityRange: deps.compatibilityRange(),
    configuredPath: before,
    memory,
    runVersion: deps.runVersion,
    writeBinaryPath,
    prompts: downloadPrompts(),
  });
  if (outcome.kind !== 'installed') { return; }
  if (namesAPath(before) && samePath(before, outcome.path, process.platform) && deps.isCompilerAnswering()) {
    await vscode.commands.executeCommand(RESTART_COMMAND);
    refresh();
    return;
  }
  await reattachIfSilent(deps, refresh);
}

// versionPrompts is every question a change of version puts to the reader: the
// download's own dialogs, and the list the version is chosen from.
function versionPrompts(): VersionPrompts {
  return {
    ...downloadPrompts(),
    pickVersion: async (versions, current) => {
      const picked = await vscode.window.showQuickPick(
        versions.map((version, at) => ({
          label: version,
          description: versionDescription(version, current, at === 0),
        })),
        {
          title: l10n.t('Aggrega: choose the compiler version'),
          placeHolder: l10n.t('The version every workspace on this machine runs'),
          ignoreFocusOut: true,
        },
      );
      return picked?.label;
    },
  };
}

// selectCompilerVersionHere changes the version of the compiler in use, and
// redraws the welcome page once the change has settled.
async function selectCompilerVersionHere(
  deps: GetStartedDeps,
  refresh: () => void,
  memory: CompilerMemory,
): Promise<void> {
  const outcome = await selectCompilerVersion({
    source: PUBLISHED_RELEASES,
    host: hostFacts(),
    compatibilityRange: deps.compatibilityRange(),
    configuredPath: deps.getBinaryPath(),
    memory,
    runVersion: deps.runVersion,
    writeBinaryPath,
    startServerOn: deps.startServerOn,
    restoreServer: deps.restoreServer,
    prompts: versionPrompts(),
  });
  if (outcome.kind === 'switched' || outcome.kind === 'kept') { refresh(); }
}

// readCompilerStanding writes down which compiler a plain name found on PATH,
// with its version, and says once per version when a newer release exists for a
// compiler the extension may replace. Neither changes anything, and a failure of
// either is a line in the output channel rather than an interruption.
async function readCompilerStanding(deps: GetStartedDeps, memory: CompilerMemory): Promise<void> {
  const host = hostFacts();
  const configured = deps.getBinaryPath();
  try {
    const situation = await compilerSituation(configured, host);
    if (situation.kind === 'onPath') {
      const reading = await readDaemonVersion({ binaryPath: situation.path, spawn: deps.runVersion });
      const line = situationLine(situation, reading.kind === 'reported' ? reading.version : null);
      if (line !== null) { deps.output.appendLine(line); }
    }
    await noteNewerRelease({
      source: PUBLISHED_RELEASES,
      host,
      compatibilityRange: deps.compatibilityRange(),
      configuredPath: configured,
      memory,
      runVersion: deps.runVersion,
      inform: (message) => void vscode.window.showInformationMessage(message),
      log: (line) => deps.output.appendLine(line),
    });
  } catch (err) {
    deps.output.appendLine(l10n.t('Aggrega: could not read which compiler is in use: {0}', describeError(err)));
  }
}

// draftRelease opens the one place a document is drafted from, with the kind
// already settled.
//
// Every control that reaches this exists on a Release surface — the Release
// row's create control, and the button beside the welcome page's Release step —
// so a reader pressing one has already said which kind they mean, and asking
// again would be the flow forgetting what it was told. The name is still asked
// for there rather than here.
//
// 🔴 IT NAMES THE LEVEL AND NEVER A TOKEN. The kinds are the compiler's, so what
// travels is the name a reader reads and the drafting flow resolves it in the
// compiler's own answer; a token written here would be a second statement of a
// set this side does not own. Where that answer holds no such kind the ordinary
// chooser opens, which is what keeps this a pre-set argument to one flow rather
// than a second way to draft.
async function draftRelease(): Promise<void> {
  await vscode.commands.executeCommand(
    'aggrega.op.scaffold',
    undefined,
    SELECTOR_ROW_LABELS.release,
  );
}

// seedRegistry registers a registry and its signature trust policy through the
// compiler's own seeding, so what a reader gets from this control and what they
// would get from the command line are the same configuration.
//
// 🔴 NOTHING OFFERS TO INTERRUPT IT, AND THAT IS THE DECISION RATHER THAN AN
// OMISSION. The work reaches the registry to read the trust policy it advertises,
// which is the reading under which an operation is watched and stoppable — but
// there is nothing here to interrupt: the shared operation behind the request
// takes no cancellation, and the request handler checks for a stopped caller only
// after its operation has returned. A stop offered here would stop the editor
// waiting and not the work, and presenting that as a stop would break the rule
// that stopping means the compiler stopped.
//
// So the channel is told what is being done, and the ending lands under it with a
// notification. That is what the rule against a silent success asks for, and it
// is what a reader gets from every other operation the compiler cannot interrupt.
//
// 🔴 THE CONDITIONS ARE RE-READ WHATEVER THE ENDING WAS, and that is deliberate
// rather than incidental. A seeding that was refused may still have changed what
// this machine resolves through — the work is the compiler's and it is not this
// surface's to say how far it got — and the panel's marks follow their conditions
// in both directions. So re-reading is what keeps the panel describing the world
// rather than describing the press.
//
// Nothing about the ending is worded here. The ending carries the compiler's own
// text where the compiler produced it, including the refusal that says an
// existing configuration was left untouched and names the file it found.
async function seedRegistry(
  deps: GetStartedDeps,
  refresh: () => void,
  host: string | null,
): Promise<void> {
  deps.output.appendLine(seedingOpeningLine(host));
  const outcome = await runSeeding(deps, host);
  refresh();
  await reportOutcome(deps, SEEDING_SUBJECT, outcome, true);
}

// seedNamedRegistry seeds a registry the reader names, which is the path for an
// air-gapped or private hub.
async function seedNamedRegistry(deps: GetStartedDeps, refresh: () => void): Promise<void> {
  const host = await vscode.window.showInputBox({
    title: l10n.t('Aggrega: seed a registry'),
    prompt: l10n.t('The registry host to register, with its signature trust policy.'),
    placeHolder: 'registry.example.com',
    validateInput: (value) =>
      value.trim().length === 0 ? l10n.t('Name a registry host.') : undefined,
  });
  if (host === undefined) { return; }
  await seedRegistry(deps, refresh, host.trim());
}

// splitSetting divides a fully qualified preference into the section the editor
// reads it from and the key within it.
function splitSetting(setting: string): [string, string] {
  const cut = setting.lastIndexOf('.');
  return [setting.slice(0, cut), setting.slice(cut + 1)];
}

function isAlreadyExists(err: unknown): boolean {
  return typeof err === 'object'
    && err !== null
    && (err as { code?: unknown }).code === 'EEXIST';
}

