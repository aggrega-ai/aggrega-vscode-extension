// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as vscode from 'vscode';
import {
  CACHE_OPERATIONS,
  CacheOperation,
  DEPRECATION_SEVERITIES,
  EntitySubject,
  OperationId,
  OperationsLayout,
  ReleaseScopedVerb,
  SurfaceFacts,
  commandsPanelOperations,
  cacheConfirmation,
  commandIdFor,
  inspectableSubjects,
  publishableSubjects,
  releaseScopedArgs,
  unavailableReason,
} from './operation-groups';
import {
  MenuOption,
  menuAnswer,
  menuFor,
  subjectMenuOptions,
} from './operation-menus';
import {
  DraftSubject,
  ENTITY_KIND_READ,
  EntityKind,
  draftNamePrompt,
  draftSubjectFor,
  readEntityKinds,
} from './entity-kinds';
import { dialsTurnedOn } from './build-dials';
import { buildReportLines } from './build-report';
import { CancellationSignal } from './cancellation';
import { reportOutcome, runWatchableCli } from './cli-operation';
import { DRAFT_COMMAND, runDraft } from './draft-chooser';
import { DaemonErrorRouting, WhoAsked } from './error-surfaces';
import {
  IMPORT_DESTINATION_PROMPT,
  IMPORT_DESTINATION_TITLE,
  IMPORT_FORMAT_PLACEHOLDER,
  IMPORT_FORMAT_TITLE,
  IMPORT_OPTIONS,
  IMPORT_OPTIONS_TITLE,
  IMPORT_SOURCE_KINDS,
  IMPORT_SOURCE_PROMPT,
  IMPORT_SOURCE_TITLE,
  IMPORT_SUBJECT,
  IMPORT_OWED_ACTION,
  IMPORT_TARGET_PROMPT,
  IMPORT_TARGET_TITLE,
  ImportParams,
  ImportQuestions,
  ImportReport,
  ImportResult,
  OwedAsks,
  answerOwedValues,
  askImport,
  chooseSource,
  clickedSource,
  importOpeningLine,
  owedOffer,
  runImport as performImport,
  switchesFrom,
} from './import-request';
import {
  DeprecateArtifactParams,
  DeprecateArtifactResult,
  PUBLICATION_SUBJECT,
  PublishEntityParams,
  PublishEntityResult,
  SIGNATURE_SUBJECT,
  SignArtifactsParams,
  SignArtifactsResult,
  WITHDRAWAL_SUBJECT,
  publicationOpeningLine,
  publishingTitle,
  runDeprecateArtifact as performDeprecateArtifact,
  runPublishEntity as performPublishEntity,
  runSignArtifacts as performSignArtifacts,
  signatureOpeningLine,
  withdrawalOpeningLine,
} from './publication-request';
import { makeNonce } from './html';
import { inspectEntity } from './inspection';
import * as l10n from './l10n';
import { outcomeOf } from './operation-outcome';
import { openDocument } from './open-document';
import {
  OperationsBody,
  operationsBodyHtml,
  operationsDocumentHtml,
} from './operations-render';
import { panelControlCommand } from './panel-control';
import { withCancellableProgress } from './progress';
import { SelectionState } from './release-selection';
import { RendersOnReady } from './readiness';
import { EXTENSION_ID, OPEN_SETTINGS_COMMAND, SETTINGS_COMMAND, extensionSettingsQuery } from './settings';
import {
  OPEN_WORKSPACE_ROOT_COMMAND,
  SelectorCandidates,
  openWorkspaceRootInvocation,
  rowCommands,
  selectorRows,
} from './selector-rows';
import {
  BuildPreviewResponse,
  BuildResponse,
  CacheClearResponse,
  CacheEvictResponse,
  CachePruneResponse,
  CacheRemoval,
  CacheScope,
  CacheStatusResponse,
  ScaffoldEntityResponse,
} from './types';
import { SpawnFn } from './version-check';
import { CatalogIndexDoc } from './workspace-catalog-run';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from './workspace';

// OperationDeps supplies the live extension state the operation surface reads
// without importing extension.ts (which would form an import cycle): the
// anchored workspace root, the configured binary path, the shared output
// channel, the requests, and the serve-backed validate of the active document.
// The root and binary path are read through getters so the surface always sees
// the current value — the root is set only once the daemon attaches, after this
// surface is registered.
//
// 🔴 THE BINARY PATH SURVIVES FOR EXACTLY ONE OPERATION, AND THE REASON IS
// MEASURED RATHER THAN INHERITED. The dependency resolution is the only entry
// here still invoked as a command, because it is the only one whose stop the
// request surface cannot match — see runReleaseScoped, where the measurement is
// written at the call site.
export interface OperationDeps extends RendersOnReady {
  // getWorkspaceRoot reports the Aggrega workspace root this extension declared
  // to the language server, or null when none is in use. Every operation here
  // gates on it, and each one that runs resolves against it.
  getWorkspaceRoot(): string | null;
  // getAnchoredWorkspaceRoot reports the root the language server answered with,
  // or null when it has reported none. The workspace row shows this one, because
  // it is what the Release list is computed against — and because reading the
  // server's own answer rather than the value handed to it is what would let a
  // disagreement between the two be seen.
  getAnchoredWorkspaceRoot(): string | null;
  // getOpenedProjectFolder reports the folder the editor has open that the
  // workspace in force was reached from, or null when none is in use.
  //
  // 🔴 IT IS A THIRD FACT, AND THE AGGREGA WORKSPACE ROW IS THE ONLY SURFACE
  // HERE THAT WANTS IT. It differs from the two roots above whenever the marker
  // sits above the folder the workspace was reached from, which is the ordinary
  // case for a window opened on a subdirectory — and that difference is the
  // subject of that row's own explanation, so a surface that answered it from
  // either root would be reporting a difference it had just erased.
  getOpenedProjectFolder(): string | null;
  // getChosenProjectFolder reports the open folder the reader chose to work
  // from, or null where they have not chosen and no sole candidate settled it.
  //
  // 🔴 IT IS A FOURTH FACT AND IS NOT THE ONE ABOVE. That one is an outcome —
  // which folder the workspace in force happened to be reached from — and this
  // one is a decision. Answering the Project folder row from the outcome would
  // make the outer level a consequence of the inner one, and it would name a
  // folder as chosen in a window where nobody chose anything. What this value
  // scopes is the middle level's candidates, which is the effect the row's own
  // explanation promises.
  getChosenProjectFolder(): string | null;
  // selectionState reports the editor's one selected Release, for the row that
  // displays it. The row renders this and derives nothing of its own.
  selectionState(): SelectionState;
  // selectorCandidates reports how many candidates each level has, for the
  // levels where the extension already holds that answer.
  //
  // 🔴 IT IS READ, NEVER DISCOVERED. The panel composes synchronously, so a
  // count that had to be looked for — a directory walk, a question to the
  // language server — would not have arrived by the time the rows are built.
  // Each number here is one the extension is already maintaining for its own
  // reasons, and the rows are re-composed on the same events that change them.
  selectorCandidates(): SelectorCandidates;
  // onSelectionChange registers a listener fired whenever the selection
  // changes, so the row re-renders without polling.
  onSelectionChange(listener: () => void): void;
  getBinaryPath(): string;
  output: vscode.OutputChannel;
  // runVersion runs the compiler with arguments and answers with what it
  // printed; the Draft button reads the compiler's version through it.
  runVersion: SpawnFn;
  validateActiveDocument(): Promise<void>;
  // selectedRelease is the editor's one selected Release, workspace-relative,
  // or null when none is selected. Build, preview build and pull each act on a
  // Release, and they act on this one: prompting per operation would let a
  // build and a graph describe two different Releases in the same session.
  selectedRelease(): string | null;
  // requireSelectedRelease reports that nothing is selected, and offers the
  // reader the way to select one. Supplied rather than spelled out here so
  // every surface that needs a selection says the same thing.
  requireSelectedRelease(): void;
  // runLint runs the conventions linter and publishes its findings as
  // navigable diagnostics. It is supplied rather than spawned here because the
  // findings land in the linter's own diagnostic collection, which the
  // extension owns; this surface only invokes it.
  runLint(): Promise<void>;
  // build compiles a Release and writes the artifacts it renders. It is
  // supplied rather than spawned here for the same reason previewBuild is: it
  // is language-server-backed, so the findings that carry a document position
  // travel on the server's diagnostic channel and land in the Problems panel,
  // which a subprocess streaming its output to a channel cannot do. The release
  // is workspace-relative, which is the form the server's request parameters
  // take.
  //
  // The signal is how a reader stops it. It reaches the language server as the
  // cancellation of the request this call was sent as, so stopping it stops the
  // compiler rather than only stopping the editor waiting for an answer.
  //
  // dials names the adjustments the reader turned on beside the Build button,
  // and it travels as data rather than as a shape this side composes: what the
  // request carries for a given set is decided in one place, so a set recorded
  // by the panel and the parameters a build runs with cannot come to disagree.
  build(release: string, dials: readonly string[], signal?: CancellationSignal): Promise<BuildResponse>;
  // previewBuild renders a Release the way a build does and reports what a
  // build would emit, without emitting any of it. It is supplied rather than
  // spawned here because it is language-server-backed: the findings that carry
  // a document position travel on the server's diagnostic channel and land in
  // the Problems panel, which a subprocess streaming its output to a channel
  // cannot do. The release is workspace-relative, which is the form the
  // server's request parameters take.
  //
  // The signal is how a reader stops it, on the same terms as the build beside
  // it.
  //
  // 🔴 IT TAKES NO ADJUSTMENTS, AND THE ABSENCE IS THE GUARANTEE. Resolving
  // dependencies writes the lockfile, and this request reports what a build
  // would write while writing none of it — so the two cannot both be honoured,
  // and the compiler refuses the pairing. With no parameter for one to arrive
  // through there is nothing for this call to forward and nothing for a later
  // change to forward by accident, which is a stronger bound than remembering
  // not to: a reader would otherwise meet a refusal for a combination they
  // never authored and cannot see.
  previewBuild(release: string, signal?: CancellationSignal): Promise<BuildPreviewResponse>;
  // importSource drafts Aggrega authoring files from a foreign source
  // description. It is supplied rather than spawned here for the reason every
  // server-backed entry is: the answer is a structured result this surface
  // reports — what the source was recognised as, where the drafts went, and the
  // importer's own findings — rather than output it would have to read back out
  // of a stream.
  //
  // The signal is how a reader stops it, and here that is more than a courtesy:
  // it reaches the language server as the cancellation of the request this call
  // was sent as, and the compiler unwinds the importer module it is running. So
  // stopping this stops the conversion rather than only stopping the editor
  // waiting for an answer, which is what distinguishes it from the entries below
  // that take no signal.
  importSource(params: ImportParams, signal?: CancellationSignal): Promise<ImportResult>;
  // The three publication requests. Each reaches past this machine — what they
  // land is what every consumer of that registry resolves — so each answer names
  // the registry it addressed and whether anything actually landed, and the
  // endings are composed from those facts rather than from an exit status.
  //
  // Each takes the reader's stop, and here that is more than a courtesy for the
  // same reason the import's is: the signal reaches the language server as the
  // cancellation of the request this call was sent as, and the shared publication
  // layer observes it at the point before anything becomes visible to anyone
  // else. So stopping one abandons the publication rather than only stopping the
  // editor waiting for an answer.
  publishEntity(
    params: PublishEntityParams,
    signal?: CancellationSignal,
  ): Promise<PublishEntityResult>;
  signArtifacts(
    params: SignArtifactsParams,
    signal?: CancellationSignal,
  ): Promise<SignArtifactsResult>;
  deprecateArtifact(
    params: DeprecateArtifactParams,
    signal?: CancellationSignal,
  ): Promise<DeprecateArtifactResult>;
  // reportDaemonError routes a failed request's error envelope to the per-code
  // surfaces the extension already has for it — a diagnostic on the document
  // the envelope names, or the notice that offers the act resolving it — and
  // reports what it did, so the ending knows whether the reader has already been
  // given a notification for the fault.
  //
  // A preview refusal is about an authored document, and the envelope carries
  // which one plus, where the fault is attributable to a single key, that key's
  // span. The diagnostic is filed as the request's answer arrives, where the
  // build's and the preview's requests are sent, so it stays until the Release
  // is answered again without it; this reports it as surfaced. fallbackPath is
  // the document the envelope is about when it names no artifact of its own.
  // whoAsked is 'reader' from every operation here: each runs because the reader
  // pressed it.
  reportDaemonError(err: unknown, fallbackPath: string, whoAsked: WhoAsked): DaemonErrorRouting;
  // requestCatalogIndex asks the language server for the workspace's entity
  // index. It is the source the entity pickers offer from: the server reports
  // the index it derives from the workspace it reads, so a picker and the
  // compiler cannot come to disagree about what the workspace contains. A picker
  // walking the workspace itself would offer a set the compiler is not using,
  // with nothing to report the disagreement.
  requestCatalogIndex(signal?: CancellationSignal): Promise<CatalogIndexDoc>;
  // entityKinds asks the language server which kinds an author may write a
  // document of. It is the source the drafting control offers from, and asking
  // is the whole point: the set of kinds belongs to the compiler, so a list held
  // here would be a second statement of it, agreeing until the day a kind was
  // declared and then leaving a reader unable to find their own.
  //
  // It takes no cancellation signal, and that is a property of the work rather
  // than an omission: the answer comes from the schemas compiled into the
  // binary, so it reaches no registry, no network and no workspace, and there is
  // nothing for a stop to stop.
  entityKinds(): Promise<unknown>;
  // scaffoldEntity asks the language server to draft a starter document for an
  // entity kind. It writes nothing: the answer is text, and where it goes is
  // this surface's decision, which is why it lands in an unsaved buffer.
  scaffoldEntity(kind: string, name: string): Promise<ScaffoldEntityResponse>;
  // entityDefinition asks the language server what an entity resolves to. The
  // answer is a structured document rather than readable output, so this surface
  // opens it rather than streaming it to a channel.
  entityDefinition(name: string, signal?: CancellationSignal): Promise<unknown>;
  // The four cache operations are language-server-backed, and they are supplied
  // here for the same reason every other server-backed entry is: the answer is
  // a structured result this surface reports, rather than output it would have
  // to read back out of a stream. Nothing is spawned, so nothing about the
  // request depends on there being a terminal for the compiler to prompt at —
  // which is what lets the confirmation belong wholly to the editor.
  //
  // None of them takes a cancellation signal, and that is a property of the
  // work rather than an omission: the operations these reach accept no
  // cancellation, so a stop could only stop this side waiting. Reporting that
  // as a stop would tell a reader the compiler stopped when it did not.
  cacheStatus(): Promise<CacheStatusResponse>;
  cachePrune(): Promise<CachePruneResponse>;
  // cacheEvict trims the shared compiled-module cache to a size cap. maxSize is
  // the reader's own text, passed through unread: the language server parses it
  // with the same parser the command line uses, so a quantity learned on one
  // surface is accepted on the other, and reading it here would put that parser
  // in a second place.
  cacheEvict(maxSize: string): Promise<CacheEvictResponse>;
  cacheClear(): Promise<CacheClearResponse>;
  // layout reports which of the two panel shapes to draw. It is read through a
  // getter so the surface always sees the current value, and re-read on every
  // render rather than captured, which is what lets the setting change take
  // effect without a restart.
  layout(): OperationsLayout;
  // onLayoutChange registers a listener fired when the shape setting changes, so
  // the open panel re-renders in the other shape with nothing to restart.
  onLayoutChange(listener: () => void): void;
}

// PanelState is what the panel's own script remembers between one drawing and
// the next: which groups the reader has closed, which control they were on, and
// how far they had scrolled.
//
// The editor deallocates a hidden view's document and recreates it when the view
// becomes visible again, and it also writes this payload into a memento — so it
// survives a window reload, not merely a hide. The panel keeps its context
// rather than being retained in memory, and this is what makes that free of
// cost to the reader.
interface PanelState {
  collapsed: string[];
  focused: string | null;
  scrollTop: number;
}

const NO_PANEL_STATE: PanelState = { collapsed: [], focused: null, scrollTop: 0 };

// readPanelState takes whatever the editor hands back for this view. It is
// unknown by contract — a memento written by an earlier version of this panel,
// or by a hand-edited storage file, arrives here too — so every field is checked
// rather than trusted, and anything unreadable draws the default shape.
function readPanelState(stored: unknown): PanelState {
  if (typeof stored !== 'object' || stored === null) { return NO_PANEL_STATE; }
  const held = stored as { collapsed?: unknown; focused?: unknown; scrollTop?: unknown };
  return {
    collapsed: Array.isArray(held.collapsed)
      ? held.collapsed.filter((id): id is string => typeof id === 'string')
      : [],
    focused: typeof held.focused === 'string' ? held.focused : null,
    scrollTop: typeof held.scrollTop === 'number' ? held.scrollTop : 0,
  };
}

// OperationsViewProvider backs the Commands view in the Aggrega activity-bar
// container: the three selector rows first, then the operation groups in one of
// two shapes.
//
// The view is a document this extension draws rather than a tree, because the
// default shape is one row of buttons per group and a tree row cannot be several
// buttons — a row carries one whole-row command and no markup. What that costs
// is that the focus order, the arrow-key navigation, the expansion state and the
// theming are this panel's to get right rather than the editor's; what it buys
// is the shape the panel exists for.
//
// The shape, the three rows and which entries can run all change under the
// panel, so it is re-composed on each of those events. The facts it draws are read
// through the getters their owners already expose rather than copied here, so
// nothing on the panel can come to disagree with the value a request actually
// carries.
class OperationsViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;

  // The reader's place, mirrored from the panel's script. The script owns it —
  // its own recording is what the editor persists — and this copy exists for one
  // purpose: composing a re-drawing already in the shape the reader left, which
  // is the half that removes the flicker. Restoring after the fact always paints
  // the default first.
  private state: PanelState = NO_PANEL_STATE;

  // The subjects each fetched menu was last offered, held per operation.
  //
  // A choice made in a menu comes back as the position it held in the offer,
  // never as anything the reader read, so the subject it names is resolved from
  // the very list this surface composed. That is what keeps a display string
  // from becoming the value an operation acts on — and it means an entity whose
  // name another entity shares cannot resolve to the wrong one.
  private offered = new Map<OperationId, EntitySubject[]>();

  // The adjustments the reader has turned on beside a button, for this session
  // only.
  //
  // 🔴 IT IS HELD HERE AND WRITTEN NOWHERE. It is not a declared preference —
  // an adjustment to the next build is not a setting about how the tool
  // behaves, and putting it on the settings screen would leave a reader unable
  // to tell the two apart — and it is deliberately absent from the state this
  // panel persists. An adjustment that survived a window reload would hand a
  // reader a registry reach and a lockfile write on a build days later, with
  // nothing in front of them saying they had asked for it.
  //
  // Held on this side rather than only in the document because the editor
  // deallocates a hidden view's document: this is what lets the panel be
  // composed already carrying the reader's setting when it comes back, rather
  // than drawing the default and correcting itself.
  private dialsOn: string[] = [];

  // Whether the panel's document holds the keyboard, as its script last said.
  // It is the script's to say rather than this side's to work out: the editor
  // reports a view's visibility but not whether the document inside it has the
  // focus.
  private holdsFocus = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly deps: OperationDeps,
  ) {}

  resolveWebviewView(
    view: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
  ): void {
    this.view = view;
    this.state = readPanelState(context.state);
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    view.onDidDispose(() => {
      this.view = null;
      this.holdsFocus = false;
    });
    view.webview.onDidReceiveMessage((message: unknown) => this.receive(message));
    // The panel going out of sight is when its document is let go of, so the
    // document it will be drawn from on its return is composed then, from what
    // is true at that moment. compose says why a later change cannot reach it any
    // other way.
    view.onDidChangeVisibility(() => {
      if (!view.visible) { this.compose(view); }
    });
    this.compose(view);
  }

  // refresh re-composes the panel from what is true now: the open document is
  // handed the new body, and a panel out of sight is given a new document to be
  // drawn from when it comes back.
  refresh(): void {
    // Nothing is composed for a panel that is not there.
    if (this.view === null) { return; }
    if (!this.view.visible) {
      this.compose(this.view);
      return;
    }
    // Handing the open document its new body rather than a new document keeps
    // the reader's place, the menu they have open and the focus where they are;
    // a new document would draw from the top and correct itself after.
    void this.view.webview.postMessage({
      type: 'panel',
      html: operationsBodyHtml(this.body()),
      scrollTop: this.state.scrollTop,
    });
  }

  // compose assigns the panel's whole document.
  //
  // 🔴 THE DOCUMENT ASSIGNED LAST IS THE ONE THE EDITOR DRAWS EACH TIME THE PANEL
  // COMES BACK INTO SIGHT. The panel's context is not retained while it is hidden
  // (activateOperations says why), so the editor lets the document go and, on the
  // panel's return, draws a new one from the last document assigned here — it does
  // not ask this provider to resolve the view again, and a body posted while the
  // panel was out of sight reached no document. A panel composed only when the
  // view was first resolved therefore comes back showing that first moment for
  // the rest of the session: an Aggrega workspace row reading none selected and
  // a Release row reading unavailable beside a language server reported running.
  // So whatever changes while the panel is out of sight is composed into the
  // document it will be drawn from.
  private compose(view: vscode.WebviewView): void {
    view.webview.html = operationsDocumentHtml({
      nonce: makeNonce(),
      styleUri: this.resource(view.webview, 'operations.css'),
      // The icon font is a third-party asset placed under media/vendor/ by the
      // build rather than carried in this repository, so it is addressed one
      // directory deeper. The stylesheet names the font file beside itself, and
      // both sit under the one resource root below.
      codiconUri: this.resource(view.webview, 'vendor', 'codicon.css'),
      scriptUri: this.resource(view.webview, 'operations.js'),
      cspSource: view.webview.cspSource,
      // The panel's words are in the editor's language, so the document says so.
      document: l10n.documentLanguage(),
      ...this.body(),
    });
  }

  private body(): OperationsBody {
    const facts: SurfaceFacts = {
      workspaceAnchored: this.deps.getWorkspaceRoot() !== null,
      releaseSelected: this.deps.selectedRelease() !== null,
    };
    const unavailable: Partial<Record<OperationId, string | null>> = {};
    for (const op of commandsPanelOperations()) {
      unavailable[op.id] = unavailableReason(op.id, facts);
    }
    return {
      // Read on every composition rather than captured, so changing the setting
      // redraws the open panel in the other shape with nothing to restart.
      layout: this.deps.layout(),
      selectors: selectorRows(
        this.deps.getAnchoredWorkspaceRoot(),
        this.deps.getOpenedProjectFolder(),
        this.deps.getChosenProjectFolder(),
        this.deps.selectionState(),
        this.deps.selectorCandidates(),
      ),
      unavailable,
      collapsed: this.state.collapsed,
      focused: this.state.focused,
      dials: this.dialsOn,
    };
  }

  // dialState reports the adjustments a press of an adjustable button carries.
  //
  // Read at the moment of the press rather than captured when the handler was
  // registered, so the build runs with what the panel currently shows — and
  // narrowed through the one description of which adjustments exist, so a value
  // recorded by an earlier drawing cannot reach a request.
  dialState(): string[] {
    return dialsTurnedOn(this.dialsOn);
  }

  // returningFocus raises one of the editor's own choosers and answers with what
  // it answered. Where the panel's document held the keyboard as the chooser
  // opened, the panel is told once the chooser has closed — chosen from or
  // dismissed — and puts the focus back on the control the reader was on.
  //
  // 🔴 THE EDITOR GIVES THE FOCUS BACK TO THE FRAME THE PANEL IS DRAWN IN AND NOT
  // TO ANYTHING INSIDE IT, so without this a reader who opened the chooser from
  // the panel by the keyboard comes back to a panel no key reaches a control
  // of. It is decided as the chooser opens rather than as it closes, because by
  // then the chooser has taken the focus from wherever the reader was; and a
  // chooser opened while the reader was elsewhere in the editor sends nothing,
  // so the panel never takes the focus from them.
  async returningFocus<T>(open: () => Thenable<T>): Promise<T> {
    const held = this.view !== null && this.holdsFocus;
    try {
      return await open();
    } finally {
      if (held && this.view !== null) {
        void this.view.webview.postMessage({ type: 'focus-back' });
      }
    }
  }

  private receive(message: unknown): void {
    const named = typeof message === 'object' && message !== null
      ? (message as { type?: unknown; command?: unknown; set?: unknown })
      : null;
    if (named?.type === 'state') {
      this.state = readPanelState(message);
      return;
    }
    if (named?.type === 'focus') {
      this.holdsFocus = (message as { held?: unknown }).held === true;
      return;
    }
    // An adjustment the reader turned beside a button. It arrives on a message
    // of its own rather than folded into the state above, and that separation
    // is what keeps it out of the memento: the state message is the one this
    // panel persists, so an adjustment carried on it would survive a window
    // reload and change a later build with nothing saying why.
    //
    // Narrowed through the one description of which adjustments exist, so a
    // document drawn by an earlier version of this extension cannot record a
    // value no request reads.
    if (named?.type === 'dials' && Array.isArray(named.set)) {
      this.dialsOn = dialsTurnedOn(named.set);
      return;
    }
    // A menu whose options are the workspace's asks for them when it opens. The
    // command it names is checked against the same offer every press is checked
    // against, so a request cannot reach a read the panel's own content does not
    // offer a control for.
    if (named?.type === 'menu' && typeof named.command === 'string') {
      if (!this.offeredCommands().includes(named.command)) {
        this.deps.output.appendLine(
          l10n.t('{0}: the panel asked to fill a menu for {1}, which none of its controls offers.', 'commands', named.command),
        );
        return;
      }
      void this.fillMenu(named.command);
      return;
    }
    const press = panelControlCommand(
      message,
      this.offeredCommands(),
      'commands',
      this.deps.output,
    );
    if (press === null) { return; }
    // The choice travels as the command's argument, so an operation reached from
    // the editor's own index — where there is no argument at all — takes exactly
    // the path it took before any menu existed.
    void vscode.commands.executeCommand(press.command, press.option ?? undefined);
  }

  // fillMenu answers a fetched menu's request for its options.
  //
  // 🔴 A REFUSAL CLOSES THE MENU AND LEAVES THE EXISTING MESSAGE TO SPEAK. The
  // read already tells the reader why it has nothing to offer — the workspace
  // declares no entity the operation can name, or the language server refused —
  // and that sentence is the one surface for it. Standing a second wording of it
  // inside the menu would be a second statement of the same refusal, and
  // replacing the sentence with an empty menu is the shape that must not ship.
  private async fillMenu(command: string): Promise<void> {
    const entry = commandsPanelOperations().find((op) => commandIdFor(op) === command);
    const menu = entry === undefined ? null : menuFor(entry.id);
    const fill = entry === undefined ? undefined : FILLS_ITS_MENU[entry.id];
    if (entry === undefined || menu === null || menu.kind !== 'fetched' || fill === undefined) {
      return;
    }
    // Whatever offer was held for this control is dropped before the read, so a
    // choice arriving from a menu that has since been re-filled cannot resolve
    // against the list a previous opening composed.
    this.offered.delete(entry.id);
    const options = await fill(
      this.deps,
      (subjects) => this.offered.set(entry.id, subjects),
    );
    if (options === null) {
      this.post({ type: 'menu-refused', command });
      return;
    }
    this.post({ type: 'menu-options', command, options });
  }

  private post(message: { type: string; command: string; options?: MenuOption[] }): void {
    // Nothing is posted to a panel that is not there. A view whose document the
    // editor has let go of comes back with no menu open, and a menu is opened by a
    // press that has not happened yet.
    if (this.view === null) { return; }
    void this.view.webview.postMessage(message);
  }

  // chosenSubject reports the entity a menu choice named, or null where no
  // choice was made or the offer it belonged to is gone.
  //
  // Null is the ordinary case, not a fault: it is what an invocation from the
  // editor's own index looks like, and what a press looks like after the panel
  // has been re-drawn. The operation then asks its own question.
  chosenSubject(id: OperationId, chosen: unknown): EntitySubject | null {
    const value = menuAnswer(id, chosen);
    if (value === null) { return null; }
    const at = Number(value);
    if (!Number.isInteger(at)) { return null; }
    return this.offered.get(id)?.[at] ?? null;
  }

  // offeredCommands is what a press on this panel is allowed to run.
  //
  // It is DERIVED from the operation surface and from the rows themselves
  // rather than listed a second time, so a control cannot exist that this does
  // not admit, and this cannot admit one no control offers. The rows are asked
  // for their commands rather than the commands being named here, because a list
  // here would be a second statement of what the rows carry.
  //
  // A row carries as many commands as it has controls, and the walk over them
  // is the rows' own rather than one written here — for the same reason a
  // control admitted by a list written here rather than by the row that draws it
  // is a control this guard could go on admitting after the row stopped drawing
  // it, and the reverse: a control ADDED to the row shape would be drawn, would
  // be pressed, and would be refused by a guard that had never heard of it.
  private offeredCommands(): string[] {
    const rows = selectorRows(
      this.deps.getAnchoredWorkspaceRoot(),
      this.deps.getOpenedProjectFolder(),
      this.deps.getChosenProjectFolder(),
      this.deps.selectionState(),
      this.deps.selectorCandidates(),
    );
    return [
      ...commandsPanelOperations().map(commandIdFor),
      ...rows.flatMap(rowCommands),
    ];
  }

  private resource(webview: vscode.Webview, ...segments: string[]): string {
    return webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', ...segments))
      .toString();
  }
}

// OperationsView is the handle the extension holds to re-render the selector
// rows on the one event neither the selection nor the readiness signal
// announces: the anchored folder changing while the server stays as it was.
export interface OperationsView {
  refresh(): void;
  // pull runs this panel's Pull for the named Release, or for the selected one
  // where it is given none. It is the same operation the panel's button runs, so
  // a surface offering Pull elsewhere — the missing-lockfile notice — reaches
  // this one rather than a second way of pulling.
  pull(release: string | null): Promise<void>;
  // returningFocus raises one of the editor's own choosers and answers with
  // what it answered, putting the focus back on the panel's control the reader
  // was on once it closes, where the panel held the keyboard as it opened.
  returningFocus<T>(open: () => Thenable<T>): Promise<T>;
}

// activateOperations registers the Commands view and a command for each entry
// this surface owns. An entry naming a command of its own registers nothing
// here: the topology graph and the configuration surface are each contributed
// and handled where their subject lives. The view id and command ids mirror the
// package.json contributions.
export function activateOperations(
  context: vscode.ExtensionContext,
  deps: OperationDeps,
): OperationsView {
  const provider = new OperationsViewProvider(context.extensionUri, deps);
  context.subscriptions.push(
    // The panel's context is NOT retained while the view is hidden. The editor
    // deallocates the document of a view the reader has collapsed or navigated
    // away from, and recreates it on return from the last document assigned —
    // which costs a reload where a tree costs a redraw, and is the right trade
    // against holding a document in memory for a panel nobody is looking at. What
    // the reader would otherwise lose is carried by the state the panel records
    // instead, and what the panel shows by the document compose keeps current.
    vscode.window.registerWebviewViewProvider('aggrega.operations', provider, {
      webviewOptions: { retainContextWhenHidden: false },
    }),
  );
  // The panel takes the readiness signal as a dependency like every other
  // surface: the anchored folder is reported by the language server, so it is
  // not known when this view is registered and drawn.
  deps.onReady(() => provider.refresh());
  deps.onSelectionChange(() => provider.refresh());
  deps.onLayoutChange(() => provider.refresh());

  // The cog at the top right of this panel, and the only way in to the
  // preferences. It opens the editor's own settings narrowed to this extension
  // rather than a page of this extension's own: a second page would be a second
  // place the same preference could be written, and the two would disagree the
  // first time anyone edited a settings file by hand.
  //
  // It is registered here rather than as an entry in the operation groups
  // because it is not an operation — nothing about the workspace changes when it
  // is pressed — and a row for it beside the compiler operations would put a
  // second door on the same room.
  context.subscriptions.push(
    vscode.commands.registerCommand(SETTINGS_COMMAND, () => {
      void vscode.commands.executeCommand(
        OPEN_SETTINGS_COMMAND,
        extensionSettingsQuery(EXTENSION_ID),
      );
    }),
  );

  // The Aggrega workspace row's offer, and THE ONLY THING ON THIS SURFACE THAT
  // REACHES PAST THE WINDOW IT IS DRAWN IN. Opening a folder takes the window
  // down and stands it back up: this extension and the language server both
  // restart and anything unsaved in the window is at risk.
  //
  // 🔴 SO IT RUNS FROM A PRESS AND FROM NOTHING ELSE. Nothing composes the
  // panel's document, refreshes it, or reacts to a folder changing by invoking
  // this — a redraw that opened a folder would restart the window a reader was
  // working in because a value they never touched had settled.
  //
  // The folder is read here, at the press, from the one getter the row that
  // drew the offer is itself composed from — so the offer and the act cannot
  // name two places, and a document drawn before the workspace moved cannot
  // carry the old one into the editor. Where the workspace has gone since, there
  // is nothing to open and nothing runs.
  context.subscriptions.push(
    vscode.commands.registerCommand(OPEN_WORKSPACE_ROOT_COMMAND, () => {
      const opening = openWorkspaceRootInvocation(deps.getAnchoredWorkspaceRoot());
      if (opening === null) { return; }
      void vscode.commands.executeCommand(opening.command, vscode.Uri.file(opening.location));
    }),
  );

  // A handler takes whatever the invocation carried. It is unknown by contract:
  // the same command sits in the editor's own index, where it is invoked with no
  // argument at all, and a reader's recorded workflow may invoke one with
  // anything — so an entry that reads an answer checks it rather than trusting
  // it, and asks its own question where there is none to read.
  const reg = (id: OperationId, handler: (...args: unknown[]) => void): void => {
    context.subscriptions.push(vscode.commands.registerCommand(`aggrega.op.${id}`, handler));
  };

  reg('validate', () => { void deps.validateActiveDocument(); });
  reg('lint', () => { void deps.runLint(); });
  // The build carries whatever the reader adjusted beside its button. Read at
  // the press rather than held here, so a build runs with what the panel
  // currently shows — and an invocation from the editor's own command index
  // carries the same set, because the panel is where that set lives whether or
  // not the press came from it.
  reg('build', () => { void runBuild(deps, provider.dialState()); });
  reg('preview', () => { void runPreview(deps); });
  // The topology graph contributes its own command, so nothing is registered for
  // it here: the group entry points at that command rather than at a second one
  // wrapping it, which would be a second command that only forwards.
  reg('pull', () => { void runReleaseScoped(deps, 'pull', null); });
  // Drafting an entity offers the kinds the COMPILER answers for, and holds no
  // list of them: the set belongs to the compiler, so what a reader is offered
  // is asked for and follows the running binary. A list held here would be a
  // second statement of that set, agreeing until the day a kind was declared.
  //
  // It takes a second argument, which is the kind a caller already knows it is
  // drafting, named the way a reader reads it. That is how a control existing
  // for one kind reaches this one flow rather than growing a flow of its own.
  reg('scaffold', (chosen, drafting) => { void runScaffold(deps, chosen, drafting); });
  // The import reads its source off the invocation where one carries it — the
  // explorer passes the file or the folder it was opened on — and asks for one
  // otherwise.
  reg('import', (clicked) => { void runImport(deps, clickedSource(clicked)); });
  // The Draft button opens the list of what can be drafted. It is registered
  // apart from the entries above because it is no entry of either panel: it is
  // drawn in the title bars, including the Explorer's, and its example choices
  // run with no Aggrega folder open.
  context.subscriptions.push(
    vscode.commands.registerCommand(DRAFT_COMMAND, () => { void runDraft(deps); }),
  );
  reg('inspect', (chosen) => {
    void runInspect(deps, provider.chosenSubject('inspect', chosen));
  });
  reg('push', (chosen) => {
    void runCatalogUpload(deps, provider.chosenSubject('push', chosen));
  });
  reg('sign', () => { void runSign(deps); });
  reg('deprecate', () => { void runDeprecate(deps); });
  reg('cache', (chosen) => { void runCache(deps, chosen); });

  return {
    refresh: () => provider.refresh(),
    pull: (release) => runReleaseScoped(deps, 'pull', release),
    returningFocus: (open) => provider.returningFocus(open),
  };
}

// runReleaseScoped runs a command-line-backed operation that requires a --release
// argument: it invokes `aggrega <verb> --release <path>`. Running the bare verb
// would fail — the command marks --release required.
//
// The path is workspace-relative and the subprocess runs in the workspace root,
// so it resolves there.
//
// named is the Release to act on where the caller already knows it — the
// missing-lockfile notice passes the Release the compiler's refusal named, spelled
// as the refused request spelled it, which is the form this path takes. Given
// none, it reads the one selected Release rather than prompting for its own, so
// what runs is the Release the panel names and a reader is not asked twice about
// the same choice. Truthiness rather than ?? on purpose: an empty Release names
// nothing, so it falls through to the selection.
//
// 🔴 IT STAYS A COMMAND FOR THE STOP, AND THE REASON IS A MEASUREMENT RATHER THAN
// AN ASSUMPTION ABOUT WHAT THE COMPILER CANNOT DO. The shared resolution DOES take
// the caller's context and observes it at five points of its own — but the closure
// walk sits between the first two, and the catalog lookup that walk resolves each
// entity through takes no context at all, so the registry fetch inside it runs on
// one nothing can cancel. Measured against a registry that accepts a connection and
// never answers: a stop sent four seconds in leaves the walk still running eleven
// seconds in, while the same stop over the same wiring ends a conventions walk
// within milliseconds. Ending the process, by contrast, ends the walk — measured in
// the same run: the child is gone at 4 s where an unstopped one is still running at
// 22 s.
//
// So a request here would give a reader a button that stops this side waiting while
// the compiler carries on fetching, and reporting that as a stop would tell them
// the compiler stopped when it did not. This is the one operation on this panel
// still reached as a command, and it is why the surface carries a binary path.
async function runReleaseScoped(
  deps: OperationDeps,
  verb: ReleaseScopedVerb,
  named: string | null,
): Promise<void> {
  if (!deps.getWorkspaceRoot()) {
    void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
    return;
  }
  const release = named || deps.selectedRelease();
  if (!release) {
    deps.requireSelectedRelease();
    return;
  }
  await runWatchableCli(
    deps,
    l10n.t('Aggrega: pulling dependencies for {0}', release),
    l10n.t('The pull'),
    releaseScopedArgs(verb, release),
    l10n.t('resolved the dependencies of {0} and wrote its lockfile, recording the external inputs it renders with.', release),
  );
}

// runBuild compiles a Release and writes the artifacts it renders.
//
// It is language-server-backed, like the preview beside it and for the same
// reason: the findings the render raises carry a document position, and the
// language server publishes them on its diagnostic channel, so they reach the
// Problems panel where a reader can navigate to each one. A subprocess streaming
// its output to this channel discards that position, which would leave one of
// the two operations able to put a finding in front of a reader and the other
// not.
//
// What lands where is the same split the preview uses: the positioned findings
// arrive on the server's own channel and are published by the extension's
// diagnostic path, so nothing here handles them; the advisories that carry no
// position ride back on the answer and are written to this channel, which is the
// only surface that can show them. A refusal raised while rendering is one of the
// positioned findings, published on the document it names, and the refusal the
// request throws ends the operation here in the same words; its code is not one
// routed onto a document, so the entry is filed once. A build that resolved its
// dependencies first also carries that resolution's report, and the channel lists
// what it pinned and the lockfile it wrote ahead of everything else the build
// reports.
//
// dials names the adjustments the reader turned beside the button. They are
// passed through as data rather than composed here: what a given set carries on
// the wire is decided in one place, so what the panel shows and what the build
// actually runs with cannot come to disagree.
async function runBuild(deps: OperationDeps, dials: readonly string[]): Promise<void> {
  const root = deps.getWorkspaceRoot();
  if (!root) {
    void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
    return;
  }
  const release = deps.selectedRelease();
  if (!release) {
    deps.requireSelectedRelease();
    return;
  }

  const out = deps.output;
  out.show(true);
  out.appendLine(`\n${l10n.t('Build of {0}.', release)}`);

  let result: BuildResponse;
  try {
    result = await withCancellableProgress(
      l10n.t('Aggrega: building {0}', release),
      (signal) => deps.build(release, dials, signal),
    );
  } catch (err) {
    const outcome = outcomeOf(err);
    // The envelope is routed BEFORE the log line rather than instead of it. A
    // refusal is about an authored document and carries which one; where it is
    // an entry on that document it was filed there as the answer arrived, and
    // routing it raises what else its code calls for, such as the notice offering
    // Pull. The log line still fires either way: a reader watching this channel
    // has to be told the build did not complete, and a value that is not an
    // envelope at all has nowhere else to surface.
    const routed = outcome.kind === 'failed'
      ? deps.reportDaemonError(err, release, 'reader')
      : 'unrecognised';
    // The message is the compiler's own text, unchanged. Where it named a
    // remediation, that remediation is what the reader needs — so the action
    // button is added beside it rather than in place of it. Where the routing
    // already raised the notification for this fault, carrying the act that
    // resolves it — a missing lockfile is answered by its own notice offering
    // Pull — the ending raises no second one.
    await reportOutcome(deps, l10n.t('The build'), outcome, true, { notified: routed === 'notified' });
    return;
  }

  for (const line of buildReportLines(result)) {
    out.appendLine(line);
  }
  // A build that wrote nothing answers with null rather than an empty list, and
  // the two say the same thing.
  const files = result.files ?? [];
  // The closing line is the command line's own summary of a completed build,
  // in the same words: the two surfaces perform one operation, so a reader who
  // has seen one report should not have to work out that the other is the same —
  // which is also why it stays untranslated.
  out.appendLine(
    `Build completed: ${countOf(files.length, 'file', 'files')} written to ${result.outputDirectory}/`,
  );
  void vscode.window.showInformationMessage(
    l10n.t('Aggrega: built {0} — {1} file(s) written to {2}/.', release, files.length, result.outputDirectory),
  );
}

// runPreview renders a Release the way a build does and reports what a build
// would emit, without emitting any of it.
//
// It is language-server-backed, like the Build operation beside it and for the
// same reason: the findings the render raises carry a document position, and the
// language server publishes them on its diagnostic channel, so they reach the
// Problems panel where a reader can navigate to each one. A subprocess streaming
// its output to this channel discards that position.
//
// What separates it from Build is only what happens to the render: this one
// reports the artifacts and writes none of them.
//
// What lands where: the positioned findings arrive on the server's own channel
// and are published by the extension's diagnostic path, so nothing here handles
// them. The advisories that carry no position ride back on the answer and are
// written to this channel, which is the only surface that can show them. A
// refusal raised while rendering lands as the build's does.
async function runPreview(deps: OperationDeps): Promise<void> {
  const root = deps.getWorkspaceRoot();
  if (!root) {
    void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
    return;
  }
  const release = deps.selectedRelease();
  if (!release) {
    deps.requireSelectedRelease();
    return;
  }

  const out = deps.output;
  out.show(true);
  out.appendLine(`\n${l10n.t('Preview of a build of {0}. Nothing is written to disk.', release)}`);

  let result: BuildPreviewResponse;
  try {
    result = await withCancellableProgress(
      l10n.t('Aggrega: previewing a build of {0}', release),
      (signal) => deps.previewBuild(release, signal),
    );
  } catch (err) {
    const outcome = outcomeOf(err);
    // The envelope is routed BEFORE the log line rather than instead of it. A
    // refusal is about an authored document and carries which one; where it is
    // an entry on that document it was filed there as the answer arrived, and
    // routing it raises what else its code calls for, such as the notice offering
    // Pull. The log line still fires either way: a reader watching this channel
    // has to be told the preview did not complete, and a value that is not an
    // envelope at all has nowhere else to surface.
    const routed = outcome.kind === 'failed'
      ? deps.reportDaemonError(err, release, 'reader')
      : 'unrecognised';
    // The message is the compiler's own text, unchanged. Where it named a
    // remediation, that remediation is what the reader needs — so the action
    // button is added beside it rather than in place of it, and where the routing
    // already raised the notification carrying that act, no second one follows.
    await reportOutcome(deps, l10n.t('The preview'), outcome, true, { notified: routed === 'notified' });
    return;
  }

  for (const line of buildReportLines(result)) {
    out.appendLine(line);
  }
  // A build that would write nothing answers with null rather than an empty
  // list, and the two say the same thing.
  const files = result.files ?? [];
  // The count is followed by where the files go, because the names above are
  // names and not paths: each one is relative to the output directory the build
  // is given, so a reader comparing this list against a build's output finds the
  // same names one level down rather than at the workspace root.
  out.appendLine(
    files.length === 1
      ? l10n.t('A build of this Release writes 1 file, under the output directory it is given.')
      : l10n.t('A build of this Release writes {0} files, under the output directory it is given.', files.length),
  );
  void vscode.window.showInformationMessage(
    l10n.t('Aggrega: a build of {0} writes {1} file(s). Nothing was written.', release, files.length),
  );
}

// runImport asks for the file or the directory to import, unless the invocation
// carried one, then for each option the import takes, then asks the language
// server to draft authoring files from it. What is asked, in what order, and what
// each answer sends is decided in import-request.ts; this binds each question to
// the editor's own input. The source is passed through verbatim; the compiler
// reads it and reports on it.
//
// It is watched and it can be stopped, and both follow from what the compiler
// does with it. The importer is a module the compiler resolves, prepares and runs
// over the source, so there is a wait worth showing; and the request's own
// context reaches that module, with the runtime set to unwind one that is mid-run
// when the context is cancelled — so the stop offered here ends the conversion
// rather than only ending this side's wait for an answer.
//
// What lands where: the importer's findings carry no document position, because
// its subject is a foreign source file rather than a place in an authored
// document, so they are written to this channel — the same surface a build's
// positionless advisories reach, and for the same reason. The ending is composed
// from the answer's own fields.
//
// Where the answer to an import that is not a preview lists values the drafts
// still owe, the reader is offered to answer them here, one input box each; the
// answers go back on the same request as a sync and the compiler keeps them. When
// to offer, when to stop and what is sent are decided in import-request.ts
// (answerOwedValues); this binds the offer, the boxes, the watch and the report.
async function runImport(deps: OperationDeps, clicked: string | null): Promise<void> {
  const choices = await askImport(IMPORT_QUESTIONS, clicked);
  if (choices === null) { return; }
  const source = choices.source;

  const out = deps.output;
  out.show(true);

  const importSource = (params: ImportParams, s?: CancellationSignal): Promise<ImportResult> =>
    deps.importSource(params, s);
  // Every request this import sends — the first, and each sent again with answers —
  // opens its lines on the channel and runs under the same progress and stop.
  const watched = (work: (signal: CancellationSignal) => Promise<ImportReport>): Promise<ImportReport> => {
    out.appendLine(importOpeningLine(source));
    return withCancellableProgress(l10n.t('Aggrega: importing {0}', source), work);
  };
  const show = (report: ImportReport): Promise<void> => showImportReport(deps, report);

  const report = await watched(
    (signal) => performImport({ importSource, nameFormat: askImportFormat }, choices, signal),
  );
  await show(report);
  await answerOwedValues({ offer: offerOwed, asks: OWED_ASKS, importSource, watched, show }, report);
}

// showImportReport puts one import's lines on the channel, then its ending.
async function showImportReport(deps: OperationDeps, report: ImportReport): Promise<void> {
  for (const line of report.lines) {
    deps.output.appendLine(line);
  }
  await reportOutcome(deps, IMPORT_SUBJECT, report.outcome, true);
}

// offerOwed offers to answer the values an import still owes, naming how many,
// with one button. Dismissing it is declining it, and changes nothing: the values
// stay owed in the answers file the compiler keeps.
async function offerOwed(count: number): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(owedOffer(count), IMPORT_OWED_ACTION);
  return choice === IMPORT_OWED_ACTION;
}

// OWED_ASKS asks each owed value in an input box of its own, titled and prompted
// as owedQuestion composes it, hiding what is typed for a secret. Escape answers
// undefined, which ends the questions with nothing sent.
const OWED_ASKS: OwedAsks = {
  ask: (question) => Promise.resolve(vscode.window.showInputBox({
    title: question.title,
    prompt: question.prompt,
    password: question.password,
    ignoreFocusOut: true,
  })),
};

// IMPORT_QUESTIONS binds each of the import's questions to the editor's own input.
// A dismissed question answers undefined, which ends the import with nothing sent.
//
// The source is chosen with the editor's own open dialog, after a choice between a
// file and a folder (chooseSource). The destination and the target are typed, and
// an empty answer chooses none of either. The options are one list in which
// several may be ticked, and ticking none writes the drafts whole.
const IMPORT_QUESTIONS: ImportQuestions = {
  source: () => chooseSource({
    kind: async () => (await vscode.window.showQuickPick(
      IMPORT_SOURCE_KINDS.map((k) => ({ label: k.label, sourceKind: k.kind })),
      { title: IMPORT_SOURCE_TITLE, placeHolder: IMPORT_SOURCE_PROMPT, ignoreFocusOut: true },
    ))?.sourceKind,
    open: (dialog) => Promise.resolve(vscode.window.showOpenDialog(dialog)),
  }),
  destination: () => Promise.resolve(vscode.window.showInputBox({
    title: IMPORT_DESTINATION_TITLE,
    prompt: IMPORT_DESTINATION_PROMPT,
    ignoreFocusOut: true,
  })),
  switches: async () => {
    const picked = await vscode.window.showQuickPick(
      IMPORT_OPTIONS.map((o) => ({ label: o.label, detail: o.detail })),
      { title: IMPORT_OPTIONS_TITLE, canPickMany: true, ignoreFocusOut: true },
    );
    return switchesFrom(picked?.map((p) => p.label));
  },
  target: () => Promise.resolve(vscode.window.showInputBox({
    title: IMPORT_TARGET_TITLE,
    prompt: IMPORT_TARGET_PROMPT,
    ignoreFocusOut: true,
  })),
};

// askImportFormat asks for the format after the compiler refused to settle one,
// showing the refusal in the compiler's own words as the question, because those
// words name the formats the reader may send.
function askImportFormat(refusal: string): Promise<string | undefined> {
  return Promise.resolve(vscode.window.showInputBox({
    title: IMPORT_FORMAT_TITLE,
    prompt: refusal,
    placeHolder: IMPORT_FORMAT_PLACEHOLDER,
    ignoreFocusOut: true,
  }));
}

// runCache offers the cache operations as a quick-pick, then asks the language
// server to perform the chosen one. The set offered is the set the server
// serves.
//
// The three that remove something confirm first, and the confirmation names
// which caches the operation reaches — the ones belonging to this workspace,
// the ones every project on this machine shares, or both, whichever is true of
// that one. That distinction is real for these operations and it is not
// guessable from the entry's label, so it is put in front of the reader before
// anything happens rather than explained afterwards.
//
// The confirmation is wholly the editor's own gate, and it is asked because the
// operation is destructive rather than to satisfy anything on the other side.
// The server performs what it is asked and prompts for nothing, so declining
// here is what keeps the request from being sent, and there is no invocation
// for an answer to be carried into.
//
// No progress indicator and no cancel button, and that follows from what these
// operations are rather than from their being quick. The operations the server
// reaches accept no cancellation, so a stop here could only stop this side
// waiting — and reporting that as a stop would tell a reader the compiler
// stopped when it did not. What the reader gets instead is the confirmation
// beforehand, which is the affordance a destructive operation owes.
// 🔴 THE CHOICE MAY ARRIVE ALREADY MADE, FROM THE MENU THE PANEL OFFERS BESIDE
// THE CONTROL, AND THAT CHANGES ONLY WHERE THE CHOICE COMES FROM. Everything
// after it is untouched: the trim still asks how far to trim, and each of the
// three removals still puts its modal confirmation in front of the reader. A
// selection and a consent gate are different things — a selection is a question
// the operation was going to ask, and moving it beside the button costs nothing,
// while a confirmation's whole value is that it INTERRUPTS. Folding one into a
// menu would let a stray click on an inline list empty a cache, which is the one
// outcome the gate exists to prevent.
async function runCache(deps: OperationDeps, chosen?: unknown): Promise<void> {
  const answered = menuAnswer('cache', chosen);
  const choice = answered ?? (await vscode.window.showQuickPick(
    CACHE_OPERATIONS.map((o) => ({ label: o.value, description: o.detail, value: o.value })),
    { placeHolder: l10n.t('Aggrega: choose a cache operation') },
  ))?.value;
  if (!choice) { return; }
  // Resolved against the one set rather than asserted to belong to it, so a
  // value from either route is the set's own member or nothing at all.
  const operation = CACHE_OPERATIONS.find((o) => o.value === choice)?.value;
  if (operation === undefined) { return; }

  // The trim is the only operation taking a subject, and it is collected before
  // the confirmation: a reader who has not yet said how far to trim has not
  // been asked the question the confirmation asks.
  //
  // Dismissing the prompt does nothing at all. An empty answer is a different
  // act — the reader gave one — so it is sent, and the server's own refusal
  // names what a size cap looks like. Nothing is parsed, checked or normalised
  // here: the server reads it with the same parser the command line uses, so a
  // quantity learned on one surface is accepted on the other, and a reading
  // here would be a second answer to what a size means.
  let maxSize = '';
  if (operation === 'evict') {
    const answer = await vscode.window.showInputBox({
      title: l10n.t('Aggrega: trim the compiled-module cache'),
      prompt: l10n.t('Size cap to trim down to — a byte quantity such as 5GiB or 512MiB, or a byte count'),
      ignoreFocusOut: true,
    });
    if (answer === undefined) { return; }
    maxSize = answer;
  }

  const confirmation = cacheConfirmation(operation);
  if (confirmation) {
    const consented = await vscode.window.showWarningMessage(
      confirmation.question,
      { modal: true, detail: confirmation.scope },
      confirmation.confirmLabel,
    );
    if (consented !== confirmation.confirmLabel) {
      // Declining is an answer, and the reader is told their answer was taken:
      // a confirmation that closes with nothing said is indistinguishable from
      // one that was dismissed by accident.
      void vscode.window.showInformationMessage(l10n.t('Aggrega: {0} cancelled. Nothing was removed.', operation));
      return;
    }
  }

  const out = deps.output;
  out.show(true);

  try {
    const detail = await performCacheOperation(deps, operation, maxSize);
    await reportOutcome(deps, cacheWhat(operation), { kind: 'ok', detail }, confirmation !== null);
  } catch (err) {
    // The server's own message reaches the reader unchanged. A refused size cap
    // arrives here, and the refusal names what a size cap looks like — which a
    // composed message would discard for a wording of this surface's own.
    await reportOutcome(deps, cacheWhat(operation), outcomeOf(err), true);
  }
}

// performCacheOperation sends one cache request, writes what came back to the
// channel, and returns the sentence the operation ends in.
//
// Each answer is a structured result rather than text, which is what the move
// off a spawned command line buys: the surface reports the compiler's own
// figures instead of reading them back out of a stream it cannot parse
// reliably.
//
// Every size below is printed as the *Text member the answer carries, exactly as
// it arrived. Scaling, rounding or re-spelling one here would put a second
// statement of how a quantity of bytes is written next to the compiler's own —
// and the two would agree until the day either rounded differently, which is
// precisely the divergence nothing on this side would notice. The size cap this
// surface asks for is read by the compiler with the same vocabulary it writes,
// so a figure copied out of a report and typed into the trim prompt has to stay
// one the compiler accepts.
export async function performCacheOperation(
  deps: OperationDeps,
  operation: CacheOperation,
  maxSize: string,
): Promise<string> {
  const out = deps.output;
  switch (operation) {
    case 'status': {
      const result = await deps.cacheStatus();
      out.appendLine(`\n${l10n.t('Cache report. Nothing is removed.')}`);
      // Every collection in a cache answer is declared nullable, so an empty one
      // may arrive as null, which says the same thing an empty list does. Each is
      // coalesced where it is read rather than defended against at every use.
      for (const cacheClass of result.classes ?? []) {
        const elements = cacheClass.elements ?? [];
        const entries = entryCount(elements.length);
        out.appendLine(`  ${cacheClass.prunable
          ? l10n.t('{0} ({1}, reclaimable by prune) — {2}', cacheClass.name, cacheClass.reach, entries)
          : l10n.t('{0} ({1}) — {2}', cacheClass.name, cacheClass.reach, entries)}`);
        for (const element of elements) {
          const note = element.note ? ` — ${element.note}` : '';
          out.appendLine(`    ${element.label}  ${element.sizeText}${note}`);
        }
      }
      for (const record of result.provenance ?? []) {
        const identities = l10n.series(record.identities ?? []);
        out.appendLine(`  ${record.sharedBy
          ? l10n.t('recorded plugin identities: {0} (shared by {1})', identities, record.sharedBy)
          : l10n.t('recorded plugin identities: {0}', identities)}`);
      }
      appendCacheScope(out, result.scope);
      return result.totalCount === 1
        ? l10n.t('listed 1 entry holding {0}.', result.totalSizeText)
        : l10n.t('listed {0} entries holding {1}.', result.totalCount, result.totalSizeText);
    }
    case 'prune': {
      const result = await deps.cachePrune();
      out.appendLine(`\n${l10n.t('Removing cache entries no lockfile references.')}`);
      const pruned = result.removed ?? [];
      appendCacheRemovals(out, pruned);
      const prunedHeld = result.heldOpen ?? [];
      appendHeldOpen(out, prunedHeld);
      out.appendLine(`  ${l10n.t('kept, still referenced: {0}', entryCount(result.retainedCount))}`);
      if (result.unattributedCount > 0) {
        out.appendLine(
          `  ${l10n.t('attributed to no lockfile either way: {0}, {1}', entryCount(result.unattributedCount), result.unattributedSizeText)}`,
        );
      }
      // The compiler names, per shortfall, the operations that would reclaim
      // what a prune has no basis to touch. That is its own guidance about what
      // to run next, so it is passed on rather than summarised away.
      for (const shortfall of result.notPruneEligible ?? []) {
        out.appendLine(
          `  ${l10n.t('left in {0} ({1}): {2}, {3} — reclaimed by {4}', shortfall.class, shortfall.reach, entryCount(shortfall.count), shortfall.sizeText, l10n.series(shortfall.reclaimedBy ?? []))}`,
        );
      }
      appendCacheScope(out, result.scope);
      return `${removedEntries(pruned.length, result.reclaimedBytesText)}${heldOpenSentence(operation, prunedHeld.length)}`;
    }
    case 'evict': {
      const result = await deps.cacheEvict(maxSize);
      out.appendLine(`\n${l10n.t('Trimming the compiled-module cache to the size cap.')}`);
      // Already under the cap is the case a reader most needs told apart from a
      // failure: nothing was removed and nothing went wrong.
      if (result.withinCapBefore) {
        appendCacheScope(out, result.scope);
        return l10n.t('removed nothing: the cache held {0}, already within the {1} cap.', result.totalBeforeText, result.capBytesText);
      }
      const evicted = result.removed ?? [];
      appendCacheRemovals(out, evicted);
      const evictedHeld = result.heldOpen ?? [];
      appendHeldOpen(out, evictedHeld);
      out.appendLine(`  ${l10n.t('held before: {0}', result.totalBeforeText)}`);
      out.appendLine(`  ${l10n.t('holds now: {0}, under a cap of {1}', result.remainingBytesText, result.capBytesText)}`);
      appendCacheScope(out, result.scope);
      return `${removedEntries(evicted.length, result.reclaimedBytesText)}${heldOpenSentence(operation, evictedHeld.length)}`;
    }
    case 'clear': {
      const result = await deps.cacheClear();
      out.appendLine(`\n${l10n.t('Emptying every cache this session addresses.')}`);
      const cleared = result.cleared ?? [];
      // A wipe leaves whole files rather than entries, and counts them per cache
      // instead of naming them, so what it left is said under the cache it is in.
      let heldFiles = 0;
      for (const subtree of cleared) {
        out.appendLine(`  ${l10n.t('emptied {0} ({1})  {2}', subtree.class, subtree.reach, subtree.sizeText)}`);
        const held = subtree.heldOpenFiles ?? 0;
        if (held > 0) {
          heldFiles += held;
          out.appendLine(`    ${l10n.t('left in place: {0}, {1} — open in another process', fileCount(held), subtree.heldOpenBytesText)}`);
        }
      }
      appendCacheScope(out, result.scope);
      const emptied = cleared.length === 1
        ? l10n.t('emptied 1 cache and reclaimed {0}. They repopulate on the next build.', result.reclaimedBytesText)
        : l10n.t('emptied {0} caches and reclaimed {1}. They repopulate on the next build.', cleared.length, result.reclaimedBytesText);
      return `${emptied}${heldOpenSentence(operation, heldFiles)}`;
    }
  }
}

// removedEntries is the ending of a prune or a trim that removed something: how
// many entries, and how much that reclaimed.
function removedEntries(count: number, reclaimed: string): string {
  return count === 1
    ? l10n.t('removed 1 entry and reclaimed {0}.', reclaimed)
    : l10n.t('removed {0} entries and reclaimed {1}.', count, reclaimed);
}

// appendCacheRemovals writes what an operation removed, and says so when it
// removed nothing.
//
// The empty case is a sentence rather than an absence, for the same reason a
// finding count reports its zero: an operation that removed nothing and one
// that never ran look identical when both write nothing.
function appendCacheRemovals(out: vscode.OutputChannel, removed: CacheRemoval[]): void {
  if (removed.length === 0) {
    out.appendLine(`  ${l10n.t('nothing was removed.')}`);
    return;
  }
  for (const removal of removed) {
    out.appendLine(`  ${l10n.t('removed {0}: {1} ({2})  {3}', removal.class, removal.label, removal.reach, removal.sizeText)}`);
  }
}

// appendHeldOpen writes each entry an operation left in place because another
// process has it open, in the shape of a removal, so a reader sees which entries
// the platform refused to remove and how much each still holds.
//
// Where there are none it writes nothing, unlike the removals: an entry left in
// place is the exception, and only a platform that refuses to remove an open
// file produces one at all.
function appendHeldOpen(out: vscode.OutputChannel, held: CacheRemoval[]): void {
  for (const entry of held) {
    out.appendLine(`  ${l10n.t('left in place {0}: {1} ({2})  {3} — open in another process', entry.class, entry.label, entry.reach, entry.sizeText)}`);
  }
}

// heldOpenSentence is what an operation's ending sentence gains when it left
// entries or files in place because another process has them open: how many,
// that running the same operation again once that process has finished removes
// them, and where the channel says which. It is empty when nothing was left, so
// an ending naming none reads exactly as it would without it.
//
// The operation is named the way its ending is, so the sentence asks the reader
// to run again the thing the notification just said finished. Each operation and
// each count is a whole sentence of its own rather than the ending's subject
// spliced in, so a translation gives the operation the case "run … again" needs.
// A prune and a trim leave entries, which the channel names one by one; a wipe
// leaves files, which the channel counts per cache — so the pointer after the
// sentence says which of the two the reader will find there.
function heldOpenSentence(operation: 'prune' | 'evict' | 'clear', count: number): string {
  if (count <= 0) { return ''; }
  const single = count === 1;
  let left: string;
  switch (operation) {
    case 'prune':
      left = single
        ? l10n.t('1 entry was left in place because another process has it open; run the prune again once that process has finished.')
        : l10n.t('{0} entries were left in place because another process has them open; run the prune again once that process has finished.', count);
      break;
    case 'evict':
      left = single
        ? l10n.t('1 entry was left in place because another process has it open; run the trim again once that process has finished.')
        : l10n.t('{0} entries were left in place because another process has them open; run the trim again once that process has finished.', count);
      break;
    case 'clear':
      left = single
        ? l10n.t('1 file was left in place because another process has it open; run the cache wipe again once that process has finished.')
        : l10n.t('{0} files were left in place because another process has them open; run the cache wipe again once that process has finished.', count);
      break;
  }
  let where: string;
  if (operation === 'clear') {
    where = l10n.t('The Aggrega output channel gives the count for each cache.');
  } else {
    where = single
      ? l10n.t('The Aggrega output channel names it.')
      : l10n.t('The Aggrega output channel names them.');
  }
  return ` ${left} ${where}`;
}

// appendCacheScope writes how far the answer reached.
//
// It always writes a line, including where nothing beyond this workspace was
// touched: that is the reassurance a reader who has just emptied something
// wants, and leaving it out would make the widest case and the narrowest case
// look the same on the channel.
function appendCacheScope(out: vscode.OutputChannel, scope: CacheScope): void {
  const machineWide = scope.machineWideClasses ?? [];
  out.appendLine(
    `  ${machineWide.length === 0
      ? l10n.t('Nothing shared with other projects on this machine was reached.')
      : l10n.t('Reached beyond this workspace, shared by every project on this machine: {0}.', l10n.series(machineWide))}`,
  );
  if (scope.workspaceRoot !== '') {
    out.appendLine(`  ${l10n.t('Workspace: {0}', scope.workspaceRoot)}`);
  }
}

// countOf renders a count with the noun agreeing with it, so an ending sentence
// reads as prose rather than as a figure with a bracketed plural. It writes the
// command line's own words, untranslated, for the one line that repeats them.
function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

// entryCount and fileCount render a count of cache entries or files as a piece
// standing on its own — after a colon or a dash, where no word of the line
// around it agrees with it — so it can fill a placeholder of a line's message.
function entryCount(count: number): string {
  return count === 1 ? l10n.t('1 entry') : l10n.t('{0} entries', count);
}

function fileCount(count: number): string {
  return count === 1 ? l10n.t('1 file') : l10n.t('{0} files', count);
}

// cacheWhat names a cache operation the way the ending sentence needs it.
function cacheWhat(operation: CacheOperation): string {
  switch (operation) {
    case 'status': return l10n.t('The cache report');
    case 'prune': return l10n.t('The prune');
    case 'evict': return l10n.t('The trim');
    case 'clear': return l10n.t('The cache wipe');
  }
}

// --- the subjects an operation is given ----------------------------------

// NO_ENTITY_TO_OFFER is what a reader is told when the workspace holds no entity
// the chosen operation can name. It says the workspace declares none rather than
// showing an empty picker, because an empty list of choices reads as a surface
// that failed to load.
const NO_ENTITY_TO_OFFER = l10n.t('Aggrega: this workspace declares no entity to offer here.');

// NO_KIND_TO_OFFER is what a reader is told when the compiler answered with no
// kind an author may write a document of. It says so rather than showing an
// empty list of choices, on the same terms as the sentence above: an empty list
// reads as a surface that failed to load.
const NO_KIND_TO_OFFER = l10n.t('Aggrega: the compiler reports no entity kind to draft.');

// MenuFill reads one control's choices where the compiler is what holds them,
// and reports null where there are none to offer — having already told the
// reader why.
//
// remember is how a fill records the offer its answers index into: each choice
// composes its POSITION in that offer, so the offer is kept to resolve a choice
// against.
type MenuFill = (
  deps: OperationDeps,
  remember: (subjects: EntitySubject[]) => void,
) => Promise<MenuOption[] | null>;

// FILLS_ITS_MENU pairs each control whose choices the compiler holds with the
// read that fills them.
//
// It is the one home for that pairing, so the panel asks this rather than asking
// which control it is dealing with — and a menu declared as fetched with no
// entry here fills with nothing rather than filling from whichever read happened
// to be written last. Each fill routes through the same helper the chooser uses,
// so a menu cannot come to offer a set the chooser does not.
const FILLS_ITS_MENU: Partial<Record<OperationId, MenuFill>> = {
  inspect: (deps, remember) => subjectChoices(deps, inspectableSubjects, remember),
  push: (deps, remember) => subjectChoices(deps, publishableSubjects, remember),
};

// subjectChoices offers the workspace's own entities, recording the offer a
// choice will be resolved against.
async function subjectChoices(
  deps: OperationDeps,
  subjectsFor: (entities: CatalogIndexDoc['entities']) => EntitySubject[],
  remember: (subjects: EntitySubject[]) => void,
): Promise<MenuOption[] | null> {
  const subjects = await readSubjects(deps, subjectsFor);
  if (subjects === null) { return null; }
  remember(subjects);
  return subjectMenuOptions(subjects);
}

// askEntityKinds reads the kinds an author may write a document of, and reports
// null where there are none to offer — having already told the reader why.
//
// 🔴 THE REFUSAL HAS ONE HOME AND IT IS HERE, on the same terms as the entity
// index below: every way into the drafting flow routes through this, so no two
// of them can come to say different things. A failed request surfaces the
// language server's own message, which is where the remediation is named.
//
// 🔴 IT READS THE NARROW SET THE ANSWER CARRIES AND NEVER THE WIDE ONE. The wide
// one is every token the compiler answers for, contracts and generated documents
// included, so a choice built from it would offer a reader a document no
// authoring schema accepts. Narrowing the wide one on this side is refused as
// well: nothing in the answer separates a kind an author writes a file of from
// one whose content lives inside another kind's document.
async function askEntityKinds(deps: OperationDeps): Promise<EntityKind[] | null> {
  let answer: unknown;
  try {
    answer = await deps.entityKinds();
  } catch (err) {
    await reportOutcome(deps, ENTITY_KIND_READ, outcomeOf(err), true);
    return null;
  }
  const kinds = readEntityKinds(answer);
  if (kinds.length === 0) {
    void vscode.window.showInformationMessage(NO_KIND_TO_OFFER);
    return null;
  }
  return kinds;
}

// pickEntityKind offers kinds already read as a chooser and returns the one
// chosen, in both of its registers.
//
// This is the path a press on the Catalog panel's row and a command invoked from
// the editor's own index both take: neither carries a kind. It offers the kinds
// from the read above rather than asking for text, because a reader naming a
// kind from memory is exactly what asking the compiler removes.
//
// 🔴 A READER READS THE VALUE THE DOCUMENT CARRIES AND THE REQUEST TAKES THE
// TOKEN, AND NEITHER IS DERIVED FROM THE OTHER. The two are different words for
// a kind whose name is more than one word, so taking either for the other would
// compose a request the compiler refuses or show a reader a word their own
// document never carries. The whole entry is returned rather than the token
// alone because the flow that asked has a reader to address afterwards, and it
// can only name the kind to them in the register they read.
async function pickEntityKind(
  kinds: readonly EntityKind[],
): Promise<EntityKind | null> {
  // The entry is carried under a name of its own rather than under `kind`: the
  // editor's own quick-pick item declares a `kind` field of its own, and a
  // choice that overwrote it would be silently reshaping the control.
  const choice = await vscode.window.showQuickPick(
    kinds.map((entityKind) => ({ label: entityKind.documentKind, entityKind })),
    { placeHolder: l10n.t('Aggrega: choose the kind of entity to draft') },
  );
  return choice?.entityKind ?? null;
}

// readSubjects reads the entities an operation can name, and reports null where
// there is nothing to offer — having already told the reader why.
//
// The offer comes from the language server's index rather than from a walk of
// this extension's own: the server reports the index it derives from the
// workspace it reads, so what is offered and what the compiler resolves against
// cannot disagree. A failed request surfaces the server's own message, which is
// where the remediation is already named.
//
// 🔴 THE REFUSAL HAS ONE HOME AND IT IS HERE. An empty answer is reported as a
// sentence saying the workspace declares nothing to offer, because an empty list
// of choices reads as a surface that failed to load. Both surfaces route through
// this, so a menu cannot come to open empty where the chooser refused — which is
// exactly the divergence that would make the menu worse than what it replaced.
async function readSubjects(
  deps: OperationDeps,
  subjectsFor: (entities: CatalogIndexDoc['entities']) => EntitySubject[],
): Promise<EntitySubject[] | null> {
  // Reading the index walks the workspace's entities, which is the same kind of
  // work every other watched operation does — so it is watched too, rather than
  // being the one catalog walk a reader cannot see or stop merely because it
  // happens before a choice rather than after one.
  let doc: CatalogIndexDoc;
  try {
    doc = await withCancellableProgress(
      l10n.t('Aggrega: reading the workspace entity index'),
      (signal) => deps.requestCatalogIndex(signal),
    );
  } catch (err) {
    await reportOutcome(deps, l10n.t('The workspace entity index'), outcomeOf(err), true);
    return null;
  }
  const subjects = subjectsFor(doc.entities);
  if (subjects.length === 0) {
    void vscode.window.showInformationMessage(NO_ENTITY_TO_OFFER);
    return null;
  }
  return subjects;
}

// pickEntity offers the workspace's own entities and returns the chosen one.
//
// This is the path a command invoked from the editor's own index takes, and the
// path a control takes when its menu could not be filled. It stays whole rather
// than being replaced: a menu is how the panel asks, not the only way the
// question can be asked.
async function pickEntity(
  deps: OperationDeps,
  subjectsFor: (entities: CatalogIndexDoc['entities']) => EntitySubject[],
  placeHolder: string,
): Promise<EntitySubject | null> {
  const subjects = await readSubjects(deps, subjectsFor);
  if (subjects === null) { return null; }
  const choice = await vscode.window.showQuickPick(subjects, { placeHolder });
  return choice ?? null;
}

// runCatalogUpload publishes one catalog entity the workspace holds.
//
// The entity is chosen before the request is composed, because the operation
// takes the entity's path and a request carrying none can only be refused.
// Choosing first is what makes the entry pressable at all, rather than a control
// that reports a fault the reader had no way to avoid.
//
// chosen is the entity a reader already named in the menu beside the control.
// Where it is absent the chooser is opened here, which is the path a command
// invoked from the editor's own index takes.
//
// It is watched and it can be stopped, and both follow from what the compiler
// does. The publication bundles the entity and pushes it to a registry, so there
// is a wait worth showing; and the request's own context is observed at the point
// before anything becomes visible to anyone else, so the stop offered here
// abandons the publication rather than only ending this side's wait. That is what
// makes the stop worth offering on exactly this operation: what it lands cannot
// be recalled from anyone who has already fetched it.
//
// A publication's ending says what is now true for other people, because that is
// what separates it from every operation above it on the panel: the others change
// this machine, and this one changes what anyone pulling from that registry
// resolves. Every fact in it is read off the answer — the reference the entity
// resolved to, the digest that tag now points at, and the registry addressed.
async function runCatalogUpload(
  deps: OperationDeps,
  chosen: EntitySubject | null,
): Promise<void> {
  if (!deps.getWorkspaceRoot()) {
    void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
    return;
  }
  const subject = chosen ?? await pickEntity(
    deps,
    publishableSubjects,
    l10n.t('Aggrega: choose the entity to publish'),
  );
  if (!subject) { return; }

  const out = deps.output;
  out.show(true);
  out.appendLine(publicationOpeningLine(subject.label));

  const report = await withCancellableProgress(
    publishingTitle(subject.label),
    (signal) => performPublishEntity(deps, subject.file, signal),
  );
  for (const line of report.lines) {
    out.appendLine(line);
  }
  await reportOutcome(deps, PUBLICATION_SUBJECT, report.outcome, true);
}

// runSign attaches a signature to one already-published artifact.
//
// The subject is asked for rather than offered from the workspace index, and the
// distinction is what makes the entry work at all: the index describes what is
// authored here, while this command amends what is already in a registry. It
// carries neither the version an artifact was published under nor the registry
// it went to, so a reference built from it would be a guess — and a guess that
// fails outright for an entity nobody has published.
//
// It is watched and it can be stopped. The signing walks its references one at a
// time, resolving each against the registry, and the request's own context is
// observed once per reference — before the attach rather than after it, because
// an attached signature is published and cannot be withdrawn. So a reader who
// stops a batch stops it between references rather than only stopping the wait.
//
// The ending names the digest each signature commits to, which is what makes the
// answer checkable: a signature commits to a digest string, so naming the
// reference alone would not say what was signed.
async function runSign(deps: OperationDeps): Promise<void> {
  const reference = await vscode.window.showInputBox({
    title: l10n.t('Aggrega: sign a published artifact'),
    prompt: l10n.t('Reference of the already-published artifact to sign'),
    ignoreFocusOut: true,
  });
  if (!reference) { return; }

  const out = deps.output;
  out.show(true);
  out.appendLine(signatureOpeningLine(reference));

  const report = await withCancellableProgress(
    l10n.t('Aggrega: signing {0}', reference),
    (signal) => performSignArtifacts(deps, reference, signal),
  );
  for (const line of report.lines) {
    out.appendLine(line);
  }
  await reportOutcome(deps, SIGNATURE_SUBJECT, report.outcome, true);
}

// runDeprecate attaches a signed deprecation marker to one already-published
// artifact.
//
// The severity and the reason are collected here and travel on the request. The
// compiler asks a person for them at an interactive terminal, and this surface
// has no terminal to be asked at — a request stream has nobody watching it, just
// as a spawned subprocess had no terminal — so a call carrying only the reference
// would be refused every time, whatever the reader intended. The reference is
// asked for rather than offered, for the same reason the signature above asks for
// one.
//
// It is watched and it can be stopped: the request's own context is observed
// ahead of the attach, and a marker is published content, so a withdrawal
// observed afterwards would withhold the answer while every consumer could
// already see the marker.
//
// The ending names the marker's own digest, which is its identity — a marker is
// attached as an untagged referrer of its subject, so nothing else addresses it
// and a withdrawal reported without it names nothing a reader could inspect.
async function runDeprecate(deps: OperationDeps): Promise<void> {
  const reference = await vscode.window.showInputBox({
    title: l10n.t('Aggrega: deprecate a published artifact'),
    prompt: l10n.t('Reference of the already-published artifact to deprecate'),
    ignoreFocusOut: true,
  });
  if (!reference) { return; }

  const severity = await vscode.window.showQuickPick(
    DEPRECATION_SEVERITIES.map((s) => ({ label: s.value, description: s.detail })),
    { placeHolder: l10n.t('Aggrega: how severe is this deprecation?') },
  );
  if (!severity) { return; }

  const reason = await vscode.window.showInputBox({
    title: l10n.t('Aggrega: deprecation reason'),
    prompt: l10n.t('Why it is deprecated, and what to use instead'),
    ignoreFocusOut: true,
  });
  if (!reason) { return; }

  const out = deps.output;
  out.show(true);
  out.appendLine(withdrawalOpeningLine(reference));

  const report = await withCancellableProgress(
    l10n.t('Aggrega: deprecating {0}', reference),
    (signal) => performDeprecateArtifact(deps, reference, severity.label, reason, signal),
  );
  for (const line of report.lines) {
    out.appendLine(line);
  }
  await reportOutcome(deps, WITHDRAWAL_SUBJECT, report.outcome, true);
}

// --- the language-server-backed entries ----------------------------------

// reportDaemonFailure surfaces a failed request through the channels the
// extension already has for one, then logs it. The compiler's own message is
// carried through unchanged: where it named a remediation, that remediation is
// what the reader needs, and a re-worded wrapper would discard it.
//
// An operation the reader stopped comes through here too, and is reported as
// stopped rather than as a failure. Telling a reader who pressed cancel that
// something went wrong teaches them the button breaks things.
async function reportDaemonFailure(
  deps: OperationDeps,
  err: unknown,
  what: string,
): Promise<void> {
  await reportOutcome(deps, what, outcomeOf(err), true);
}

// runScaffold drafts a starter document for an entity kind and opens it.
//
// 🔴 THE KINDS ARE THE COMPILER'S AND NO LIST OF THEM IS HELD HERE. They are
// asked for, so what a reader is offered follows the running binary rather than
// a copy on this side that would agree on the day it was written and diverge
// silently the day a kind was declared, with nothing comparing the two.
//
// 🔴 IT IS ONE FLOW WITH THREE WAYS IN AND NEVER THREE FLOWS. chosen is a kind's
// token an invocation carried outright — a reader's own keybinding or recorded
// workflow naming the kind to draft. drafting is the kind a control that exists
// for one kind already knows it is making — the Release row's create control,
// and the welcome page's button beside it — named the way a reader reads it,
// because a control on this side may not know a token. Where neither is carried
// the chooser opens here, which is the path a press on the Catalog panel's row
// and a command invoked from the editor's own index both take. A second routine
// for the pre-set case would drift from this one the first time either changed,
// so the pre-set case is an argument rather than a door.
//
// The kinds are read before any of the three is settled, because the prompt
// names the kind and only the compiler's answer can name it. That read is what
// the pre-set name is resolved through, and it is also what lets the chooser be
// offered when the answer holds no kind under that name — so a control for a
// kind this compiler does not have falls back to the ordinary question instead
// of failing.
//
// A carried token is checked for being a non-empty string and nothing more, and
// the kind it names is left to the compiler: one it does not answer to comes
// back refused with the compiler's own corrective text naming the whole valid
// set, which is a better answer than a refusal this side could word from the
// narrower view it holds.
//
// It is reachable from outside this module because WHICH QUESTION IT ASKS is the
// whole of what it decides, and that is observable only by running it: a reading
// of this file shows the chooser being reached through a fallback, and cannot
// show that a pre-set kind stops the fallback being taken.
export async function runScaffold(
  deps: OperationDeps,
  chosen?: unknown,
  drafting?: unknown,
): Promise<void> {
  const kinds = await askEntityKinds(deps);
  if (kinds === null) { return; }

  const carried = draftSubjectFor(
    kinds,
    typeof chosen === 'string' && chosen.trim() !== '' ? chosen : null,
    typeof drafting === 'string' && drafting !== '' ? drafting : null,
  );
  const subject: DraftSubject | null = carried ?? await pickEntityKind(kinds);
  if (subject === null) { return; }

  // The name is optional: the compiler fills a placeholder where none is given,
  // so an empty answer still produces a document rather than a refusal.
  const name = await vscode.window.showInputBox({
    title: l10n.t('Aggrega: draft an entity'),
    prompt: draftNamePrompt(subject.documentKind),
    ignoreFocusOut: true,
  });
  if (name === undefined) { return; }

  try {
    const result = await deps.scaffoldEntity(subject.kind, name);
    await openDocument(result.skeleton, 'yaml');
  } catch (err) {
    await reportDaemonFailure(deps, err, l10n.t('The draft'));
  }
}

// runInspect reports what one entity in the workspace resolves to.
//
// The entity is offered from the workspace's own index, which is the set the
// compiler will resolve against, and it is addressed by identity rather than by
// path — an entity the workspace holds no file for is still answerable, so it is
// still offered.
//
// chosen is the entity a reader already named in the menu beside the control.
// Where it is absent the chooser is opened here, which is the path a command
// invoked from the editor's own index takes. The inspection itself, and the way
// it ends, is the one every surface offering an inspection reaches.
async function runInspect(
  deps: OperationDeps,
  chosen: EntitySubject | null,
): Promise<void> {
  const subject = chosen ?? await pickEntity(
    deps,
    inspectableSubjects,
    l10n.t('Aggrega: choose the entity to inspect'),
  );
  if (!subject) { return; }
  await inspectEntity(deps, subject.name);
}

// The configuration is reported by the surface generated from its schema, which
// contributes its own command and asks the language server both of its
// questions. Nothing is registered for it here: a wrapper would be a second
// command that only forwards, and it would have to keep its own copy of which
// requests the surface needs.
