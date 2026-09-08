// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

import { runCliJson } from './cli-json';
import { runCliProcess } from './cli-run';
import { makeNonce } from './html';
import { panelControlCommand } from './panel-control';
import { RendersOnReady } from './readiness';
import { RegistryListDoc } from './registries-run';
import { DEFAULT_SETTINGS, SERVER_CONFIG_SECTION } from './settings';
import {
  ANCHOR_CANDIDATE_GLOB,
  CONFIG_FILENAME,
  WORKSPACE_ANCHOR_CONFIG,
  findAggregaWorkspaceAnchor,
} from './workspace';
import {
  CHOOSE_WORKSPACE_COMMAND,
  CREATE_WORKSPACE_COMMAND,
  DISMISSED_CONFIRMATION,
  DISMISS_COMMAND,
  DRAFT_RELEASE_COMMAND,
  GET_STARTED_SHOW_SETTING,
  GetStartedFacts,
  LOCATE_COMPILER_COMMAND,
  SEED_NAMED_REGISTRY_COMMAND,
  SEED_REGISTRY_COMMAND,
  SHOW_COMMAND,
  StepId,
  USE_COMPILER_ON_PATH_COMMAND,
  WELCOME_PANEL_TITLE,
  panelControlCommands,
  readCollapsedSteps,
  stepStandings,
} from './get-started-steps';
import {
  dismissHtml,
  initiallyCollapsedStepIds,
  stepsHtml,
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

// GetStartedDeps is the live state the panel reads. Every field is a fact some
// other part of the extension already owns; nothing here keeps a copy, so the
// panel cannot come to disagree with the surfaces reporting the same facts.
export interface GetStartedDeps extends RendersOnReady {
  getWorkspaceRoot(): string | null;
  getBinaryPath(): string;
  isCompilerAnswering(): boolean;
  selectedRelease(): string | null;
  // reanchor re-evaluates the open folders and attaches the language server.
  //
  // It is a dependency rather than something reached through a command because
  // two of the controls need it in a state where nothing else will do it: a
  // freshly written configuration file changes no folder, so the editor raises
  // no event; and the automatic restart that follows a binary-path change is
  // registered only once a language server has been established, so in the very
  // state the compiler step is for there is nothing listening.
  reanchor(): Promise<void>;
  onSelectionChange(listener: () => void): void;
  output: vscode.OutputChannel;
}

// activateGetStarted publishes the four conditions, registers the controls, and
// hands back the one call that re-reads the conditions.
//
// The caller invokes it after re-evaluating the open folders, and that is not
// optional: the readiness signal every other view renders from announces itself
// only when a workspace root AND an answerable language server are both in
// hand, so a workspace that is anchored but whose compiler will not start
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
): () => void {
  // The one panel, reused. A second press reveals the one already open rather
  // than stacking tabs, and closing it clears this so a later refresh has
  // nothing to draw into.
  let panel: vscode.WebviewPanel | null = null;

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
  const reread = async (): Promise<Record<StepId, boolean>> => {
    const read = stepStandings(await readFacts(deps));
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
    return read;
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
  const createPanel = (read: Record<StepId, boolean>): void => {
    collapsed = initiallyCollapsedStepIds(read);
    panel = vscode.window.createWebviewPanel(
      'aggrega.welcome',
      WELCOME_PANEL_TITLE,
      vscode.ViewColumn.Active,
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
      read,
      collapsed,
      opensWithEditor(),
    );
  };

  // openPanel is what a reader asking for the panel reaches.
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
  const openPanel = async (): Promise<void> => {
    if (panel) {
      panel.reveal(vscode.ViewColumn.Active);
      refresh();
      return;
    }
    createPanel(await reread());
  };

  // settle is where the panel opens by itself, from the first reading of the
  // four conditions taken at a moment all of them are established.
  //
  // Three outcomes, and each reads the conditions exactly as much as it needs.
  // A panel the reader already asked for before this point is refreshed and
  // left arranged as it is — the same rule the reveal path follows, and through
  // the coalescer rather than around it, since there is a panel to draw into. A
  // reader who has said not to open it gets no panel and no reading, because
  // nothing would draw the answer. Otherwise the panel is created from one
  // reading taken here, which is the case the whole arrangement rule exists for.
  const settle = async (): Promise<void> => {
    if (panel !== null) { refresh(); return; }
    // What the preference gates is whether the panel OPENS BY ITSELF, not
    // whether it exists — the command that brings it back is in the palette
    // either way, which is what makes the dismissal safe to offer at all.
    if (!opensWithEditor()) { return; }
    createPanel(await reread());
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
      if (!event.affectsConfiguration(GET_STARTED_SHOW_SETTING)) { return; }
      panel?.webview.postMessage({
        type: 'dismiss',
        html: dismissHtml(opensWithEditor()),
      });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(SHOW_COMMAND, () => bringBack(openPanel)),
    vscode.commands.registerCommand(DISMISS_COMMAND, () => putAway()),
    vscode.commands.registerCommand(CREATE_WORKSPACE_COMMAND, () => createWorkspace(deps, refresh)),
    vscode.commands.registerCommand(CHOOSE_WORKSPACE_COMMAND, () => chooseWorkspace(deps, refresh)),
    vscode.commands.registerCommand(USE_COMPILER_ON_PATH_COMMAND, () => useCompilerOnPath(deps, refresh)),
    vscode.commands.registerCommand(LOCATE_COMPILER_COMMAND, () => locateCompiler(deps, refresh)),
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
  return (): void => {
    if (settled) {
      refresh();
      return;
    }
    settled = true;
    void settle();
  };
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
    'get started',
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
  standings: Record<StepId, boolean>,
  collapsed: readonly StepId[],
  opensWithEditor: boolean,
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
    standings,
    collapsed,
    opensWithEditor,
  });
}

// readFacts reads the four conditions from the parts of the extension that
// already own them.
async function readFacts(deps: GetStartedDeps): Promise<GetStartedFacts> {
  const compilerAnswering = deps.isCompilerAnswering();
  return {
    workspaceAnchored: deps.getWorkspaceRoot() !== null,
    compilerAnswering,
    releaseSelected: deps.selectedRelease() !== null,
    // The registry question is asked of the compiler, so it is asked only once
    // the compiler is answerable. Before then the answer would be a failed
    // spawn rather than a fact, and the step above this one is the one the
    // reader is being asked to act on anyway.
    registryConfigured: compilerAnswering ? await hasConfiguredRegistry(deps) : false,
  };
}

// hasConfiguredRegistry asks the compiler what registries the resolved
// configuration names. An empty list is a successful answer meaning none are
// configured, which is a different fact from the question failing — and both
// read as the step being unmet, because in neither case can the reader be told
// they have one.
//
// The command is re-run here rather than shared with the registries panel: that
// panel computes its rows inside the editor's request for them, so it produces
// a result only while a reader has it open, and a step whose standing depended
// on that would report differently according to which panel somebody had
// expanded. The command reads the resolved configuration and contacts no
// registry, so asking it again costs nothing over the network.
async function hasConfiguredRegistry(deps: GetStartedDeps): Promise<boolean> {
  try {
    const { doc } = await runCliJson<RegistryListDoc>(
      deps,
      ['registry', 'list', '-o', 'json'],
    );
    return (doc.registries ?? []).length > 0;
  } catch (err) {
    deps.output.appendLine(
      `get started: could not read the configured registries: ${messageOf(err)}`,
    );
    return false;
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
  const [section, key] = splitSetting(GET_STARTED_SHOW_SETTING);
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
      `Aggrega: the welcome panel is back; it will open with the editor. ${messageOf(err)}`,
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
  const [section, key] = splitSetting(GET_STARTED_SHOW_SETTING);
  // The reader's own layer, because a preference confined to the reader has no
  // other layer it can live in: the editor refuses a write of one into a
  // project's settings outright.
  await vscode.workspace
    .getConfiguration(section)
    .update(key, shown, vscode.ConfigurationTarget.Global);
}

// createWorkspace writes the smallest configuration that makes a directory the
// root of an Aggrega workspace, then re-attaches so the step reports itself met
// without the window being reloaded.
async function createWorkspace(deps: GetStartedDeps, refresh: () => void): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showInformationMessage(
      'Aggrega: no folder is open, so there is nowhere to write a workspace configuration. Open a folder first.',
    );
    return;
  }
  const target = path.join(folder.uri.fsPath, CONFIG_FILENAME);
  let created = false;
  try {
    // Exclusive creation, so an existing configuration is never overwritten by a
    // control a reader pressed to make one.
    await fs.writeFile(target, WORKSPACE_ANCHOR_CONFIG, { flag: 'wx' });
    created = true;
  } catch (err) {
    if (!isAlreadyExists(err)) {
      void vscode.window.showErrorMessage(
        `Aggrega: could not create ${CONFIG_FILENAME}: ${messageOf(err)}`,
      );
      return;
    }
  }

  await deps.reanchor();
  refresh();

  const doc = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(doc);
  void vscode.window.showInformationMessage(
    created
      ? `Aggrega: ${CONFIG_FILENAME} created; this folder is now the workspace root.`
      : `Aggrega: ${CONFIG_FILENAME} already exists here, so it was opened rather than replaced.`,
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
      'Aggrega: no folder in this workspace carries anything Aggrega recognises as a workspace root, so there is none to choose. Create a workspace configuration instead.',
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
  }));
  const choice = await vscode.window.showQuickPick(items, {
    placeHolder: 'Aggrega: choose the folder to work in',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!choice) { return; }

  if (opened.has(choice.directory)) {
    await deps.reanchor();
    refresh();
    return;
  }
  // Adding the folder is what makes the language server anchor there. The
  // editor raises its own folders-changed event, which the extension already
  // re-attaches on, so nothing is re-attached here.
  const added = vscode.workspace.updateWorkspaceFolders(
    vscode.workspace.workspaceFolders?.length ?? 0,
    null,
    { uri: vscode.Uri.file(choice.directory) },
  );
  if (!added) {
    void vscode.window.showErrorMessage(
      `Aggrega: the editor declined to add ${choice.directory} to this workspace.`,
    );
    return;
  }
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
  const hits = await vscode.workspace.findFiles(ANCHOR_CANDIDATE_GLOB);
  const directories = new Set<string>();
  for (const uri of hits) {
    directories.add(path.dirname(uri.fsPath));
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
    openLabel: 'Use this compiler',
    title: 'Aggrega: select the aggrega binary',
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

// draftRelease opens the one place a document is drafted from. The kind and the
// name are asked for there rather than fixed here, so this control is a route
// into the existing drafting rather than a second door to the same room.
async function draftRelease(): Promise<void> {
  await vscode.commands.executeCommand('aggrega.op.scaffold');
}

// seedRegistry registers a registry and its signature trust policy through the
// compiler's own seeding, so what a reader gets from this control and what they
// would get from the command line are the same configuration.
async function seedRegistry(
  deps: GetStartedDeps,
  refresh: () => void,
  host: string | null,
): Promise<void> {
  const args = host === null
    ? ['config', 'init']
    : ['config', 'init', '--registry', host];
  const root = deps.getWorkspaceRoot();
  const bin = deps.getBinaryPath();
  const what = `aggrega ${args.join(' ')}`;
  deps.output.appendLine(`$ ${what}`);
  let code: number | null;
  try {
    code = await runCliProcess({
      spawn: () => spawn(bin, args, { cwd: root ?? undefined }),
      append: (text) => deps.output.append(text),
      appendLine: (text) => deps.output.appendLine(text),
    }, what);
  } catch (err) {
    void vscode.window.showErrorMessage(`Aggrega: ${messageOf(err)}`);
    return;
  }
  // A non-zero status is the compiler declining, and its own message — which
  // says what it declined and what to do about it, including that an existing
  // configuration is not overwritten — is already on the channel. It is not
  // re-worded here; the channel is named instead.
  if (code !== 0) {
    void vscode.window.showErrorMessage(
      `Aggrega: ${what} exited with status ${code ?? 'unknown'} — see the Aggrega output channel.`,
    );
    return;
  }
  refresh();
  void vscode.window.showInformationMessage(
    host === null
      ? 'Aggrega: the official hub is configured, with its signature trust policy.'
      : `Aggrega: ${host} is configured, with its signature trust policy.`,
  );
}

// seedNamedRegistry seeds a registry the reader names, which is the path for an
// air-gapped or private hub.
async function seedNamedRegistry(deps: GetStartedDeps, refresh: () => void): Promise<void> {
  const host = await vscode.window.showInputBox({
    title: 'Aggrega: seed a registry',
    prompt: 'The registry host to register, with its signature trust policy.',
    placeHolder: 'registry.example.com',
    validateInput: (value) =>
      value.trim().length === 0 ? 'Name a registry host.' : undefined,
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

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
