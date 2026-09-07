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
  NOTHING_MET,
  SEED_NAMED_REGISTRY_COMMAND,
  SEED_REGISTRY_COMMAND,
  SHOW_COMMAND,
  StepId,
  USE_COMPILER_ON_PATH_COMMAND,
  WELCOME_PANEL_TITLE,
  panelControlCommands,
  stepStandings,
} from './get-started-steps';
import { stepsHtml, welcomeDocumentHtml } from './welcome-render';

// This module is the whole editor-coupled boundary of the welcome panel. What
// the panel MEANS — which conditions exist and when one is met — is in
// get-started-steps.ts, and how it is COMPOSED is in welcome-render.ts; neither
// imports an editor type. What is left here is the wiring: reading the four
// facts, drawing them into the panel, running the controls, and opening it.
//
// THE PANEL IS AGGREGA'S OWN, IN ITS OWN TAB, AND IT IS DRAWN BY THIS CODE.
// That is what lets a step go back to outstanding when its condition lapses:
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
export function activateGetStarted(
  context: vscode.ExtensionContext,
  deps: GetStartedDeps,
): () => void {
  // The one panel, reused. A second press reveals the one already open rather
  // than stacking tabs, and closing it clears this so a later refresh has
  // nothing to draw into.
  let panel: vscode.WebviewPanel | null = null;

  // The standings the panel is currently drawn from. Held so the panel can be
  // opened from what is already known, and so a refresh that arrives while no
  // panel is open still leaves the next opening drawing the truth.
  let standings: Record<StepId, boolean> = stepStandings(NOTHING_MET);

  // Two events can ask for a re-read while one is still in flight, because
  // reading the registry condition asks the compiler. Coalescing means the
  // panel settles on the last answer asked for rather than on whichever
  // subprocess happened to finish last.
  let inFlight = false;
  let again = false;
  const reread = async (): Promise<void> => {
    standings = stepStandings(await readFacts(deps));
    // 🔴 THE LIST IS RE-COMPOSED FROM THE STANDINGS JUST READ, IN BOTH
    // DIRECTIONS. A step whose condition has lapsed is composed as outstanding
    // again, because nothing here accumulates a previous mark — which is the
    // defect a panel drawn by this extension does not inherit.
    panel?.webview.postMessage({ type: 'steps', html: stepsHtml(standings) });
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

  // openPanel draws the panel from the standings read at the moment it opens,
  // rather than from whatever was last computed: a reader who built their
  // configuration elsewhere would otherwise meet a panel telling them they have
  // nothing, for as long as the first read takes.
  const openPanel = async (): Promise<void> => {
    if (panel) {
      panel.reveal(vscode.ViewColumn.Active);
      refresh();
      return;
    }
    await reread();
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
    const listener = panel.webview.onDidReceiveMessage(
      (message: unknown) => { runPanelControl(message, deps.output); },
    );
    panel.onDidDispose(
      () => { listener.dispose(); panel = null; },
      null,
      context.subscriptions,
    );
    panel.webview.html = welcomeHtml(panel.webview, context.extensionUri, standings);
  };

  // Read once from what is true now, so a panel opened a moment later has the
  // answer in hand.
  refresh();
  // And again whenever the compiler becomes answerable, or the selection moves.
  // Only the rising edge of readiness is announced, which is the extension's
  // one rule about that signal: a step keeps its standing while the language
  // server restarts rather than flickering to unmet and back.
  deps.onReady(refresh);
  deps.onSelectionChange(refresh);

  // Opened where the reader has not said otherwise. This is what the preference
  // gates: whether the panel opens, not whether it exists — the command that
  // brings it back is in the palette either way.
  void openIfWanted(openPanel);

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

  return refresh;
}

// runPanelControl runs the command a press in the welcome panel names.
//
// Deciding whether to act on a press is panel-control.ts's, shared with the
// other document this extension draws; what is left here is the invocation,
// which is where the editor is.
function runPanelControl(message: unknown, output: vscode.OutputChannel): void {
  const command = panelControlCommand(
    message,
    panelControlCommands(),
    'get started',
    output,
  );
  if (command === null) { return; }
  void vscode.commands.executeCommand(command);
}

// welcomeHtml resolves this installation's own panel resources and composes the
// document. What it composes is decided in welcome-render.ts, which holds no
// editor types, so the panel's body is assertable without an extension host.
function welcomeHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  standings: Record<StepId, boolean>,
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

// openIfWanted opens the panel unless the reader has turned it off.
//
// The preference is read rather than assumed, and what it gates is whether the
// panel OPENS BY ITSELF — not whether it exists. A reader who dismissed it
// still finds the way back in the command palette, which is why the dismissal
// is safe to offer at all.
async function openIfWanted(openPanel: () => Promise<void>): Promise<void> {
  const [section, key] = splitSetting(GET_STARTED_SHOW_SETTING);
  if (vscode.workspace.getConfiguration(section).get<boolean>(key) !== true) { return; }
  await openPanel();
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
