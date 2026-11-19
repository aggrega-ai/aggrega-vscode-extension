// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as vscode from 'vscode';
import { postAttachCandidates, postConnectionCandidates } from './attach-candidates';
import {
  GraphRedactor,
  IrGraphRequest,
  createConnectionSiteReader,
  createGraphRedactor,
  irGraphRequest,
} from './graph-payload';
import { ConnectionNames, PanelDelivery, holdUntilListening, makeGraphMessageHandler } from './graph-messages';
import {
  AttachCandidatesRequest,
  AttachmentContainerRequest,
  AttachmentSite,
  ConnectionSite,
  ConnectionSites,
  NO_CONNECTION_SITES,
  attachFailureLine,
  attachRefusal,
  attachmentContainerRequest,
  attachmentEntryLines,
  attachmentSites,
  composeInsertionText,
  connectionContainerRequest,
  connectionNotDrawn,
  fillSlot,
  insertionPositionInDocument,
  nameAttachment,
  readAttachmentContainer,
  readInsertion,
  refusesEntryShape,
} from './attachment-edit';
import {
  ATTACH_TO_CONNECTION_AT_CURSOR_COMMAND,
  ConnectionAtCursor,
  ConnectionAtPositionRequest,
  UNREADABLE_ANSWER,
  connectionAtPositionRequest,
  documentSelections,
  loadNoSlotNote,
  noConnectionSentence,
  readConnectionAtPosition,
  selectConnectionMessage,
} from './connection-at-cursor';
import { DaemonErrorRouting, WhoAsked, describeError } from './error-surfaces';
import { reportGraphFailure } from './graph-failure';
import * as l10n from './l10n';
import { graphDocumentHtml } from './graph-render';
import { RendersOnReady } from './readiness';
import { CancellationSignal } from './cancellation';
import { withCancellableProgress } from './progress';
import { CatalogIndexParams, ServerEncoding } from './types';
import { NO_ANCHORED_WORKSPACE_MESSAGE, fromWorkspaceRelative, toWorkspaceRelative } from './workspace';
import { CatalogIndexDoc } from './workspace-catalog-run';

// GraphDeps supplies the live state the graph view needs without importing
// extension.ts (which would form an import cycle): the anchored workspace root
// (source-file clicks resolve against it), the editor's selected Release, the
// irGraph request (daemon-backed), and the shared output channel.
export interface GraphDeps extends RendersOnReady {
  getWorkspaceRoot(): string | null;
  // selectedRelease is the editor's one selected Release, workspace-relative,
  // or null when none is selected. The view graphs that Release rather than
  // prompting for one of its own: a prompt here would be a second answer to
  // "which Release are we talking about", so the graph could draw one Release
  // while validation reported on another.
  selectedRelease(): string | null;
  // requireSelectedRelease reports that nothing is selected, and offers the
  // reader the way to select one. Supplied rather than spelled out here so
  // every surface that needs a selection says the same thing.
  requireSelectedRelease(): void;
  // requestIrGraph sends the irGraph request and returns the serialized IRGraph
  // object (the daemon's irGraph result `graph` field).
  //
  // The request is composed here, where its answer is read, and is sent exactly
  // as composed: it names the workspace-relative Release, and asks for the values
  // a Feature declares sensitive only while the reader has asked to see them.
  //
  // The signal is how a reader stops the compile the drawing needs. It is
  // supplied only for a render the reader asked for; a quiet refresh passes
  // none, because there is no indicator to press cancel on.
  requestIrGraph(request: IrGraphRequest, signal?: CancellationSignal): Promise<unknown>;
  // requestAttachCandidates reports which Features declare an applicability
  // that one drawn node's labels satisfy.
  //
  // THE SUBJECT IS A GRAPH NODE AND THE RELEASE ITS GRAPH WAS BUILT FROM, the
  // same coordinate the container question below is asked with. The labels
  // matched are the node's finalised set on that Release's compiled graph,
  // which is what the build evaluates applicability against, and the Features
  // matched include those the catalog directories that Release builds against
  // hold. A label set sent on its own would be matched against the workspace's
  // own directories instead, which a Release given directories of its own does
  // not build against.
  //
  // Where the request also names one of the connections the node's component
  // draws, the answer carries that connection's slots, each with the Features
  // that may fill it, or the reason none may be filled.
  requestAttachCandidates(request: AttachCandidatesRequest): Promise<unknown>;
  // requestCatalogIndex asks for the entity index in the terms the parameters
  // name. The list of what may attach asks it in the terms of the Release its
  // graph was drawn from, for the links leading out of the workspace the index
  // names beside its entities: a Feature declared behind one is not offered, and
  // the answer about what may attach does not say which links those are.
  requestCatalogIndex(params: CatalogIndexParams): Promise<CatalogIndexDoc>;
  // requestAttachmentContainer reports which document an attachment for one
  // drawn node belongs in, and the structural path to the container inside it.
  //
  // THE SUBJECT IS A GRAPH NODE AND THE RELEASE ITS GRAPH WAS BUILT FROM, which
  // is what the canvas holds and is why the question is answerable from one.
  // The whole request is composed where its answer is read, and is passed on the
  // wire exactly as composed — this side supplies a coordinate and nothing
  // structural, because how an Aggregate nests its components is the compiler's
  // knowledge and a second copy of it here would be free to disagree. For an
  // attachment on a connection the request also names the connection and the
  // document that drew it, and the answer is that connection's own container in
  // that document.
  requestAttachmentContainer(request: AttachmentContainerRequest): Promise<unknown>;
  // requestInsertionPoint reports where a new entry under the named container
  // belongs in one authored document.
  //
  // It is the compiler's answer and it is read-only: it reports a position and
  // writes nothing. Composing the entry's text and applying it belongs on this
  // side, because this side owns the buffer, the undo history and whatever the
  // reader has typed and not yet saved.
  requestInsertionPoint(file: string, container: string[]): Promise<unknown>;
  // requestConnectionAtPosition reports which connection's entry a position in
  // an Aggregate or a Release falls inside — the graph node and the connection,
  // with the document the position was read in — or why there is none. It is
  // read-only, and answered on the compiled graph of the Release it names.
  requestConnectionAtPosition(request: ConnectionAtPositionRequest): Promise<unknown>;
  // validationsAnswered sends at once every open document's validation still
  // waiting out a pause in typing, and settles once every validation sent so far
  // has been answered. The language server learns an unsaved buffer's text from
  // its validation alone, so a position asked about after it settles is a
  // position in the text the reader sees.
  validationsAnswered(): Promise<void>;
  // serverEncoding is the units the session settled on for a position's offset.
  serverEncoding(): ServerEncoding;
  // showsSensitiveValues reports whether the reader has asked to see the values
  // a Feature declares sensitive. Read on each render rather than captured, so
  // changing the setting takes effect on the next render of an open panel.
  showsSensitiveValues(): boolean;
  // reportDaemonError routes a failed request's error envelope to the per-code
  // surfaces the extension already has for it — a diagnostic on the document
  // the envelope names, or the notice that offers the act resolving it — and
  // reports what it did.
  //
  // A refusal reaching this view is about an authored document, and the
  // envelope carries which one plus, where the fault is attributable to a
  // single key, that key's span. The diagnostic is filed as the request's
  // answer arrives, where requestIrGraph sends it, so it stays until the Release
  // is answered again without it; this reports it as surfaced. fallbackPath is
  // the document the envelope is about when it names no artifact of its own;
  // whoAsked is whether the reader asked for the drawing the refusal answers.
  reportDaemonError(err: unknown, fallbackPath: string, whoAsked: WhoAsked): DaemonErrorRouting;
  output: vscode.OutputChannel;
}

// GraphView is the handle the extension holds to re-render the open panel on
// events the panel cannot see for itself — a file it was drawn from changing on
// disk.
export interface GraphView {
  refresh(): void;
  // shownRelease is the Release the open panel is showing, which is the Release
  // refresh redraws, or null where no panel is open and refresh draws nothing.
  // A panel keeps the Release it was shown with when the selection moves, so
  // this can name a Release other than the selected one.
  shownRelease(): string | null;
}

// NO_RELEASE_SHOWN_REASON and NO_RELEASE_SHOWN_SENTENCE say that the panel is
// showing no Release yet, so nothing about its graph can be asked. The reason is
// the lower-case clause a candidate list's failure is reported with; the sentence
// stands on its own as an attachment's outcome. Each is written once here and
// reached from every question the panel can be asked before it shows a Release.
const NO_RELEASE_SHOWN_REASON = l10n.t('this panel is not showing a Release yet.');
const NO_RELEASE_SHOWN_SENTENCE = l10n.t('This panel is not showing a Release yet.');

// activateGraphView registers the topology-graph command, and the attach from a
// connection's entry in a document, which ends in the same panel. A single panel
// is reused across invocations so re-running either refreshes the existing view
// rather than stacking panels.
export function activateGraphView(context: vscode.ExtensionContext, deps: GraphDeps): GraphView {
  let panel: vscode.WebviewPanel | null = null;
  // How anything reaches the open panel's document: made and cleared with the
  // panel, and the only path to it, so nothing is sent before the panel listens
  // (holdUntilListening, graph-messages.ts).
  let toPanel: PanelDelivery | null = null;
  // Built once per activation, against this installation's own files, and used
  // on every render.
  const redact = createGraphRedactor(context.extensionUri.fsPath);
  // The Release the open panel is showing. Held so a refresh re-renders the
  // same one without asking the user again, and cleared with the panel so a
  // refresh after a close does nothing.
  let shownRelease: string | null = null;
  // What the drawn graph knows about each node's authoring, rebuilt on every
  // render. It holds names and a path per node and no authored value at all, so
  // keeping it costs nothing the redaction removed.
  //
  // It is kept HERE, on the side that received the compiled graph, rather than
  // asked of the view when an edit is requested. A document path arriving back
  // from the view would be a path the extension writes to on the view's word,
  // and the view is a separate context; this way every edit lands in a document
  // the compiler itself named.
  let shownSites = new Map<string, AttachmentSite>();
  // What the drawn graph knows about each connection, kept for the same reason
  // and rebuilt at the same moment: the node whose component draws it, its
  // socket and alias, the document that drew it, and the slots already filled
  // on it. Like the node table it holds names and no authored value.
  let shownConnections: ConnectionSites = NO_CONNECTION_SITES;
  // Which attachment belongs to which connection is read through the rule the
  // view draws with, built once per activation like the redactor.
  const readConnections = createConnectionSiteReader(context.extensionUri.fsPath);
  // How a completed render hands back what it read. The render is a free
  // function so it can be reasoned about without this closure; this is the one
  // thing it has to put back. Both tables are read before either is replaced,
  // so a render that cannot read one leaves the two it had rather than one of
  // each.
  const keepSites = (graph: unknown): void => {
    const nodes = attachmentSites(graph);
    const connections = readConnections(graph);
    shownSites = nodes;
    shownConnections = connections;
  };
  // The selection this side asked the panel to make from a connection's entry in
  // a document, kept here for the reason the tables above are: an attach made
  // from it is written in the document the compiler read that entry in, and the
  // panel is told an id rather than a document, so the document is never one it
  // sent back. Cleared with the panel.
  const selections = documentSelections();
  // The sentence the panel says for a connection a Feature drew, read from the
  // shipped candidate projection on first use, so a cursor on such a connection
  // is told the same fact in the same words.
  let noSlotNoteOf: ((reason: string) => string) | null = null;
  const noSlotNote = (reason: string): string => {
    if (noSlotNoteOf === null) { noSlotNoteOf = loadNoSlotNote(context.extensionUri.fsPath); }
    return noSlotNoteOf(reason);
  };

  // openPanel is the one panel the graph is shown in: made on first use, with
  // everything that listens to it, and brought forward on every use after that.
  const openPanel = (): { shown: vscode.WebviewPanel; delivery: PanelDelivery } => {
    if (!panel || !toPanel) {
      const created = vscode.window.createWebviewPanel(
        'aggrega.graph',
        l10n.t('Aggrega Graph'),
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, 'media'),
            vscode.Uri.joinPath(context.extensionUri, 'node_modules', 'elkjs', 'lib'),
          ],
        },
      );
      panel = created;
      // The one call that posts to the panel's document, behind the hold: the
      // drawing this press asks for is often ready before the panel listens,
      // and is sent when the panel says it does.
      toPanel = holdUntilListening((message) => { void created.webview.postMessage(message); });
      panel.onDidDispose(() => {
        panel = null;
        toPanel = null;
        shownRelease = null;
        shownSites = new Map();
        shownConnections = NO_CONNECTION_SITES;
        selections.clear();
      }, null, context.subscriptions);
      // The panel keeps its context while the editor is not showing it, so it
      // goes on receiving graphs and drawing them — and a drawing has to be
      // sized against the area it will be read in. That area is not something
      // the panel can measure for itself while it is off screen, and it is
      // not something it can infer from what it measures: a panel nobody is
      // looking at reports a size like any other. So the one side that knows
      // says so, on every change, and the panel does not have to guess.
      panel.onDidChangeViewState(() => {
        if (!panel || !toPanel) { return; }
        toPanel.post({ type: 'visibility', visible: panel.visible });
      }, null, context.subscriptions);
      // The handler is registered once, with the panel, and the panel
      // outlives the anchor — so it reads the root through the getter on each
      // message rather than closing over one read for a single press. Every
      // other read in this file goes through the getter for the same reason.
      panel.webview.onDidReceiveMessage(
        makeGraphMessageHandler(deps.getWorkspaceRoot, {
          openSource: (workspaceRoot, sourceFile) => { void openSource(workspaceRoot, sourceFile); },
          reportNoWorkspace: () => {
            void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
          },
          requestAttachCandidates: (nodeId, requestId) => {
            // The panel that asked is the panel answered. There is one, it is
            // reused, and it is cleared when it closes — so a request whose
            // panel is already gone has nowhere to report and is dropped.
            if (!toPanel) { return; }
            // Asked about the Release this panel's graph was drawn from, for
            // the reason the commit below is: the node id belongs to that
            // graph, and the selection may since have moved.
            if (!shownRelease) {
              toPanel.post({
                type: 'attachCandidatesError', nodeId, requestId,
                message: NO_RELEASE_SHOWN_REASON,
              });
              return;
            }
            void postAttachCandidates(toPanel, deps, nodeId, shownRelease, requestId);
          },
          attachFeature: (nodeId, featureName) => {
            if (!toPanel) { return; }
            // The site is looked up in this render's own table rather than
            // taken from the message, so a node the current graph does not
            // hold has nowhere to attach anything and says so.
            const site = shownSites.get(nodeId);
            if (!site) {
              postAttachOutcome(toPanel, { nodeId },
                l10n.t('{0} is not on the graph this panel drew.', nodeId), false);
              return;
            }
            // The Release asked about is the one this panel's graph was drawn
            // from, not whatever is selected now: the node ids and the
            // attachments the click was made against came from that render,
            // and asking about a different Release would answer about a
            // different graph.
            if (!shownRelease) {
              postAttachOutcome(toPanel, { nodeId },
                NO_RELEASE_SHOWN_SENTENCE, false);
              return;
            }
            void attachFeature(toPanel, deps, site, featureName, shownRelease);
          },
          requestConnectionCandidates: (nodeId, connection, requestId) => {
            // Answered into the panel that asked, about the Release its graph
            // was drawn from, for the reasons a node's question is.
            if (!toPanel) { return; }
            if (!shownRelease) {
              toPanel.post({
                type: 'attachCandidatesError', nodeId, requestId,
                message: NO_RELEASE_SHOWN_REASON,
              });
              return;
            }
            void postConnectionCandidates(toPanel, deps, nodeId, connection, shownRelease, requestId);
          },
          attachToConnection: (nodeId, connection, slot, featureName, selection) => {
            if (!toPanel) { return; }
            const about = { nodeId, connection };
            // Looked up in this render's own table, as a node is: a connection
            // the current graph does not draw has nowhere to attach anything,
            // and which document an attachment on one that it does draw is
            // written in is read from this table, never from the message.
            const site = shownConnections(nodeId, connection);
            if (!site) {
              postAttachOutcome(toPanel, about, connectionNotDrawn(nodeId, connection), false);
              return;
            }
            if (!shownRelease) {
              postAttachOutcome(toPanel, about,
                NO_RELEASE_SHOWN_SENTENCE, false);
              return;
            }
            // A connection selected from its entry in a document is written in
            // the document the compiler read that entry in. The id the panel
            // echoes is looked up in what this side posted, and names a document
            // only for the connection it was minted for.
            void attachToConnection(toPanel, deps, selections.siteFor(site, selection), slot, featureName, shownRelease);
          },
          selectionNotDrawn: (selection) => {
            // The connection the compiler named at the cursor is not on the
            // drawing the panel made, so there is nothing to attach to there,
            // said in the words the panel's own attach says it in.
            const chosen = selections.named(selection);
            if (!chosen) { return; }
            void vscode.window.showWarningMessage(connectionNotDrawn(chosen.source, chosen));
          },
          // The panel's document now hears what is posted to it, so what was
          // held for it is sent.
          listening: () => { toPanel?.listening(); },
        }),
        null,
        context.subscriptions,
      );
      panel.webview.html = graphHtml(panel.webview, context.extensionUri);
    } else {
      panel.reveal(vscode.ViewColumn.Active);
    }
    return { shown: panel, delivery: toPanel };
  };

  // showRelease draws one Release in the panel, opening it where none is open,
  // and reports whether the drawing was sent to it — which it is not where the
  // graph could not be built, a failure the render has already reported.
  const showRelease = async (release: string): Promise<boolean> => {
    const { shown, delivery } = openPanel();
    shown.title = l10n.t('Aggrega Graph — {0}', release);
    shownRelease = release;
    let sent = false;
    await renderGraph(delivery, deps, redact, release, (graph) => {
      keepSites(graph);
      sent = true;
    });
    return sent;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('aggrega.graph.show', async () => {
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

      await showRelease(release);
    }),

    // The attach offered from a connection's entry in a document. The compiler
    // is asked which connection is written at the cursor, in the selected
    // Release's terms as every cursor feature is. On a connection, the graph is
    // shown on that Release with the connection selected, and the attach is the
    // panel's own from there: the slots and the Features it answers, the entry
    // written where it says. On any other position the reason is said and
    // nothing opens.
    vscode.commands.registerCommand(ATTACH_TO_CONNECTION_AT_CURSOR_COMMAND, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const root = deps.getWorkspaceRoot();
      if (!root) {
        void vscode.window.showInformationMessage(NO_ANCHORED_WORKSPACE_MESSAGE);
        return;
      }
      const selected = deps.selectedRelease();
      if (!selected) {
        deps.requireSelectedRelease();
        return;
      }

      // The position is composed from the text the reader sees at the press,
      // and asked about once every validation sent so far is answered, so the
      // text the language server holds for the document is that same text.
      const doc = editor.document;
      const request = connectionAtPositionRequest(
        toWorkspaceRelative(root, doc.uri.fsPath),
        doc.getText(),
        editor.selection.active,
        deps.serverEncoding(),
        selected,
      );
      let answer: ConnectionAtCursor | null;
      try {
        await deps.validationsAnswered();
        answer = readConnectionAtPosition(await deps.requestConnectionAtPosition(request));
      } catch (err) {
        reportConnectionAtCursorFailure(deps, err, selected);
        return;
      }
      if (answer === null) {
        void vscode.window.showWarningMessage(UNREADABLE_ANSWER);
        return;
      }
      if ('noConnectionReason' in answer) {
        void vscode.window.showInformationMessage(noConnectionSentence(answer.noConnectionReason, noSlotNote));
        return;
      }

      const { selection } = answer;
      if (!(await showRelease(selected)) || !toPanel) { return; }
      toPanel.post(selectConnectionMessage(selections.mint(selection), selection));
    }),
  );

  // refresh re-renders the Release the panel is already showing. It does
  // nothing when no panel is open or none has been chosen yet: the graph is
  // a view the user opens deliberately, so nothing here opens one on its own
  // or asks the language server for a graph nobody is looking at.
  const refresh = (): void => {
    if (!toPanel || !shownRelease) { return; }
    // Quiet: the panel keeps showing the graph it has until the new one
    // replaces it, rather than flashing a layout notice on every recompile.
    void renderGraph(toPanel, deps, redact, shownRelease, keepSites, { quiet: true });
  };

  // A panel left open across a restart is showing a topology drawn by a server
  // that has since been replaced, and the recompile notice that ordinarily
  // re-renders it need never arrive — nothing has been edited. Re-rendering
  // when the compiler becomes answerable again is what closes that gap; a panel
  // that is not open is unaffected, because refresh has nothing to draw.
  deps.onReady(refresh);

  // Read from the same two values refresh is guarded by, so the answer and what
  // a refresh would do cannot come apart.
  const releaseOnPanel = (): string | null => (toPanel && shownRelease ? shownRelease : null);

  return { refresh, shownRelease: releaseOnPanel };
}

// renderGraph requests the IR graph and posts it to the webview, surfacing any
// request failure both in the panel and the output channel. A quiet render
// skips the "laying out" notice, for a re-render the user did not ask for.
//
// The graph is redacted HERE, before it is posted, and this is the whole reason
// the redaction sits at this line rather than at the places the panel draws.
// Withholding at each drawing site has to be re-established every time a drawing
// site is added, and nothing fails when it is forgotten: the value is present,
// so new code that renders it works perfectly and discloses a credential.
// Withholding as the payload crosses is one guarantee that holds however the far
// side is later written. It stays although the language server withholds the
// same values unless the request asks for them: what crosses into the view is
// decided on this side, whatever the server that answered did.
async function renderGraph(
  toPanel: PanelDelivery,
  deps: GraphDeps,
  redact: GraphRedactor,
  release: string,
  keepSites: (graph: unknown) => void,
  opts: { quiet?: boolean } = {},
): Promise<void> {
  if (!opts.quiet) {
    toPanel.post({ type: 'loading', release });
  }
  try {
    // Read once, before the request, and that one answer decides whether the
    // request asks the language server for the values a Feature declares
    // sensitive, the redaction, and what travels with the payload it decided.
    // The server sends those values only when asked for them, and the panel
    // withholds again by the markings unless it is told the setting was on, so
    // each is told what this drawing was built with rather than left to find
    // out: a second read could disagree with the first, and the panel would then
    // withhold the very values the request asked for and this side sent for it
    // to show.
    const showsSensitiveValues = deps.showsSensitiveValues();
    const request = irGraphRequest(release, showsSensitiveValues);
    // A render the reader asked for is watched and can be stopped, on the same
    // presentation every other operation that compiles a Release uses. A quiet
    // refresh is not: it happens on recompile rather than on a press, the panel
    // goes on showing the graph it has, and an indicator for it would put a
    // notification in front of a reader for something already on screen.
    const answer = opts.quiet
      ? await deps.requestIrGraph(request)
      : await withCancellableProgress(
        l10n.t('Aggrega: building the topology of {0}', release),
        (signal) => deps.requestIrGraph(request, signal),
      );
    const graph = redact(answer, showsSensitiveValues);
    // Read from the answer rather than from the redacted payload, and only once
    // the redaction has succeeded: what this keeps is a set of names per node
    // and per connection, none of which the redaction touches, and a render that
    // posts nothing must leave no sites behind for an edit to act on.
    keepSites(answer);
    // Whether the reader asked for this drawing is one fact read at three moments
    // rather than three answers. Here it decides whether a notice was shown; in
    // the panel it decides whether the drawing is framed afresh or left where
    // the reader put it, because a redraw nobody asked for must not move what
    // they are reading and one they pressed for is how they get the whole
    // topology back; and on a refusal it decides whether the notice offering the
    // way past it may be held back.
    toPanel.post({ type: 'render', release, graph, asked: !opts.quiet, showsSensitiveValues });
  } catch (err) {
    // A redaction that cannot be performed lands here with the request
    // failures, and is reported the same way. Nothing is posted, which is the
    // safe direction: with no way to tell a value that may be shown from one
    // that may not, showing none of them is the only honest answer.
    //
    // Which surfaces hear about the failure, in which order, and in whose
    // words is decided in reportGraphFailure — over sinks, so those decisions
    // are assertable without an editor. This binds each sink to the panel and
    // the channel this render belongs to.
    const whoAsked: WhoAsked = opts.quiet ? 'nobody' : 'reader';
    reportGraphFailure(err, release, whoAsked, {
      reportDaemonError: (thrown, fallbackPath, asker) => deps.reportDaemonError(thrown, fallbackPath, asker),
      logLine: (line) => { deps.output.appendLine(line); },
      notifyPanel: (failure) => {
        toPanel.post({ type: 'error', release, message: failure.message, line: failure.line });
      },
    });
  }
}

// attachFeature commits the Feature the reader chose onto the node they
// selected, by editing the Aggregate that declares it, under the name derived
// from the Feature's own. What happens after the name is settled is
// writeAttachment's, which a connection's attach goes through as well.
async function attachFeature(
  toPanel: PanelDelivery,
  deps: GraphDeps,
  site: AttachmentSite,
  featureName: string,
  release: string,
): Promise<void> {
  const about: OutcomeSubject = { nodeId: site.nodeId };
  const named = nameAttachment(site, featureName);
  if ('refusal' in named) {
    postAttachOutcome(toPanel, about, named.refusal, false);
    return;
  }
  await writeAttachment(toPanel, deps, {
    container: attachmentContainerRequest(site, release),
    entryName: named.instanceName,
    connection: null,
    about,
  }, featureName);
}

// attachToConnection commits the Feature the reader chose into one slot of the
// connection they selected, under the slot's own name, in the document the site
// names. For a pressed edge that is the document that drew the connection — the
// Release for one the Release drew, the Aggregate otherwise, read from this
// side's table of the compiled graph; for a connection selected from its entry
// in a document, it is the document the compiler read that entry in.
//
// A slot the graph already shows filled on this connection is refused before
// anything is asked. Everything else — whether the connection may carry an
// attachment at all, where its container is, whether the document holds an entry
// for it — is the compiler's answer, and a refusal is shown in its words.
async function attachToConnection(
  toPanel: PanelDelivery,
  deps: GraphDeps,
  site: ConnectionSite,
  slot: string,
  featureName: string,
  release: string,
): Promise<void> {
  const about: OutcomeSubject = {
    nodeId: site.source,
    connection: { socket: site.socket, alias: site.alias },
  };
  const named = fillSlot(site, slot);
  if ('refusal' in named) {
    postAttachOutcome(toPanel, about, named.refusal, false);
    return;
  }
  await writeAttachment(toPanel, deps, {
    container: connectionContainerRequest(site, release),
    entryName: named.instanceName,
    connection: { socket: site.socket, alias: site.alias },
    about,
  }, featureName);
}

// AttachTarget is one attach as the writer is handed it: the question asking
// where its container is, the name its entry is written under, the connection
// attached to — null for an attach to the node itself — and what the outcome is
// about.
//
// The output channel and the line reporting a made attach name the node, or the
// connection, each in whole sentences of their own, naming a connection as
// attachment-edit.ts says every sentence does.
interface AttachTarget {
  container: AttachmentContainerRequest;
  entryName: string;
  connection: ConnectionNames | null;
  about: OutcomeSubject;
}

// writeAttachment writes one attachment entry where the compiler says it goes.
//
// # THE COMPILER SAYS WHERE; THIS SIDE WRITES
//
// The requests that follow are read-only and report places. Everything that
// touches the document happens here, through the editor's own edit machinery,
// and that routing is the requirement rather than a convenience: an edit
// applied through the document model joins the undo history, lands on the
// buffer the reader is looking at rather than on the last bytes written to
// disk, and leaves every comment and every formatting choice around it as its
// author wrote them. Writing the file directly would contest all three with the
// editor that owns them.
//
// # NOTHING IS SAVED HERE, AND NOTHING IS RE-VALIDATED HERE EITHER
//
// The edit lands in the buffer, which is a document change like any other: the
// language server is told and it validates, so the attachment is reported on
// like anything else the reader types. Saving on the reader's behalf would take
// a decision that is theirs, and re-validating from here would be a second
// trigger for something the ordinary edit path already does.
//
// 🔴 SO THE PANEL DOES NOT REDRAW UNTIL THE READER SAVES, and that follows from
// the line above rather than being a separate rule. A graph is built from the
// documents as they stand on disk, so an attachment sitting unsaved in a buffer
// is not yet part of any graph the compiler would build — redrawing on it would
// show a topology no build produces. The save is what puts it there, and the
// drawing follows the save.
//
// # TWO QUESTIONS, AND NEITHER ANSWER IS COMPOSED HERE
//
// The first asks which document the attachment belongs in and the path to the
// container inside it, addressed by the node id the drawn graph carries and the
// Release that graph was built from — and, for a connection, by the connection
// and the document that drew it. The second asks where in that document such an
// entry goes. The first answer is handed to the second exactly as it arrived,
// segment for segment — which is what makes a component authored inside a
// subsystem commit by the same path as one authored at the top level, and a
// connection's entry by the same path as a node's, with none of them depending
// on this side knowing how an Aggregate or a Release spells its nesting.
async function writeAttachment(
  toPanel: PanelDelivery,
  deps: GraphDeps,
  target: AttachTarget,
  featureName: string,
): Promise<void> {
  const about = target.about;
  const root = deps.getWorkspaceRoot();
  if (root === null) {
    postAttachOutcome(toPanel, about, NO_ANCHORED_WORKSPACE_MESSAGE, false);
    return;
  }

  try {
    const located = readAttachmentContainer(
      await deps.requestAttachmentContainer(target.container),
    );
    if (located === null) {
      postAttachOutcome(toPanel, about, attachRefusal(
        l10n.t('the compiler\'s answer about which document this belongs in is in a shape this cannot apply.')), false);
      return;
    }

    // The document and the container path both come from that answer, and both
    // are passed on untouched. Reading either one back into parts is the guess
    // this request exists to remove.
    // A node whose attachment container is the document root names no path, and
    // an empty path reaches the wire as null.
    const answer = await deps.requestInsertionPoint(located.file, located.container ?? []);
    const insertion = readInsertion(answer);
    if (insertion === null) {
      postAttachOutcome(toPanel, about, attachRefusal(
        l10n.t('the compiler\'s answer about where in that document this belongs is in a shape this cannot apply.')), false);
      return;
    }
    const shapeRefusal = refusesEntryShape(insertion);
    if (shapeRefusal) {
      postAttachOutcome(toPanel, about, attachRefusal(shapeRefusal), false);
      return;
    }
    // The answer names the document workspace-relative, as every other
    // per-document answer does.
    const uri = vscode.Uri.file(fromWorkspaceRelative(root, insertion.file));
    const doc = await vscode.workspace.openTextDocument(uri);

    // The units the reported offset is measured in are read off the answer,
    // which states them. An encoding this side cannot convert from refuses
    // rather than falls back: a position applied in the wrong units lands on
    // the wrong column of the right line, which is an edit nobody asked for
    // rather than an error anybody sees.
    const at = insertionPositionInDocument(doc.getText(), insertion);
    if (at === null) {
      postAttachOutcome(toPanel, about, attachRefusal(insertion.positionEncoding
        ? l10n.t('the position is reported in {0} units, which this cannot convert from.', insertion.positionEncoding)
        : l10n.t('the position is reported in unstated units, which this cannot convert from.')), false);
      return;
    }

    const text = composeInsertionText(
      insertion,
      attachmentEntryLines(target.entryName, featureName, insertion.indentStep),
    );

    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(at.line, at.character), text);
    if (!(await vscode.workspace.applyEdit(edit))) {
      postAttachOutcome(toPanel, about, l10n.t('The editor did not apply the edit.'), false);
      return;
    }

    // Shown so the change is in front of the reader rather than in a file they
    // have to go and find. It is the same document the edit landed in.
    await vscode.window.showTextDocument(doc, { preview: false });

    // Whether the nesting step was measured from this document or stood in for
    // by a default is reported rather than smoothed over. A document with no
    // nesting of its own supplies nothing to match, and a reader whose file
    // uses a different width is owed the reason the new lines do not match it.
    const note = insertion.indentStepMeasured
      ? ''
      : ` ${l10n.t('The document exhibits no nesting to measure, so a default indentation was used.')}`;
    const { connection } = target;
    const node = about.nodeId;
    deps.output.appendLine(connection === null
      ? l10n.t('attached {0} to {1} as {2} in {3}', featureName, node, target.entryName, insertion.file)
      : l10n.t('attached {0} to the connection {1} through socket {2} of {3} as {4} in {5}',
        featureName, connection.alias, connection.socket, node, target.entryName, insertion.file));
    const made = connection === null
      ? l10n.t('Attached {0} to {1} as {2}.', featureName, node, target.entryName)
      : l10n.t('Attached {0} to the connection {1} through socket {2} of {3} as {4}.',
        featureName, connection.alias, connection.socket, node, target.entryName);
    postAttachOutcome(toPanel, about, `${made}${note}`, true);
  } catch (err) {
    const { connection } = target;
    deps.output.appendLine(connection === null
      ? l10n.t('attaching {0} to {1} failed: {2}', featureName, about.nodeId, describeError(err))
      : l10n.t('attaching {0} to the connection {1} through socket {2} of {3} failed: {4}',
        featureName, connection.alias, connection.socket, about.nodeId, describeError(err)));
    postAttachOutcome(toPanel, about, attachFailureLine(err), false);
  }
}

// OutcomeSubject is what an attach's outcome is about: a node, or one of the
// connections a node's component draws, named by its socket and alias.
interface OutcomeSubject {
  nodeId: string;
  connection?: ConnectionNames;
}

// postAttachOutcome tells the panel what became of the reader's click.
//
// It is reported into the panel the click came from rather than onto the
// document, for the reason a candidate refusal is: what failed is a request
// about a place in a file, and nothing it can be refused for is a fault of the
// file the reader would be sent to. It names the subject it is about, so the
// panel draws it only under that subject — a node, or a connection.
function postAttachOutcome(
  toPanel: PanelDelivery,
  about: OutcomeSubject,
  message: string,
  attached: boolean,
): void {
  const { nodeId, connection } = about;
  toPanel.post(connection === undefined
    ? { type: 'attachOutcome', nodeId, message, attached }
    : { type: 'attachOutcome', nodeId, connection, message, attached });
}

// reportConnectionAtCursorFailure says why the connection at the cursor could
// not be asked about, in the compiler's words. The refusal is routed first to the
// surface the extension keeps for its code — filed on the document it names, or
// the notice offering the act that resolves it — then written to the channel, and
// raised as a notification of its own unless that routing raised one: the reader
// pressed for this, so a refusal of it is put in front of them.
function reportConnectionAtCursorFailure(deps: GraphDeps, err: unknown, release: string): void {
  const routed = deps.reportDaemonError(err, release, 'reader');
  const message = describeError(err);
  deps.output.appendLine(l10n.t('aggrega/connectionAtPosition failed: {0}', message));
  if (routed !== 'notified') {
    void vscode.window.showErrorMessage(message);
  }
}

// openSource opens the node's authoring file. The IR carries workspace-relative
// paths, so the click resolves against the anchored root.
async function openSource(workspaceRoot: string, sourceFile: string): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(fromWorkspaceRelative(workspaceRoot, sourceFile)),
    );
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch {
    void vscode.window.showWarningMessage(l10n.t('Aggrega: cannot open {0}.', sourceFile));
  }
}

// graphHtml builds the webview document from the addresses the editor resolves
// for this panel's own resources.
function graphHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const resource = (...segments: string[]): string =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...segments)).toString();
  return graphDocumentHtml({
    nonce: makeNonce(),
    cspSource: webview.cspSource,
    elkUri: resource('node_modules', 'elkjs', 'lib', 'elk.bundled.js'),
    modelUri: resource('media', 'graph-model.js'),
    attachmentsUri: resource('media', 'attachments-model.js'),
    candidatesUri: resource('media', 'candidates-model.js'),
    scriptUri: resource('media', 'graph.js'),
    styleUri: resource('media', 'graph.css'),
    document: l10n.documentLanguage(),
  });
}

// makeNonce returns a random token for the CSP script allowlist. Math.random is
// sufficient for a per-render CSP nonce — it is not a security boundary on its
// own; the CSP source restriction and local-only resource roots are.
function makeNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
