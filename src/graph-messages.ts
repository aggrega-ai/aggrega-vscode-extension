// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// The topology panel's messages, both ways: what its webview posts back to the
// extension, and how what the extension posts reaches it.

// GraphMessage is the shape the topology webview posts back to the extension.
// An unrecognized type is ignored rather than treated as an error, so the
// webview and the host can be updated in either order — save for one message the
// host depends on: it sends a panel nothing until the panel says `listening`, so
// a webview that never says it is never drawn on.
export interface GraphMessage {
  type: string;
  sourceFile?: string;
  nodeId?: string;
  requestId?: number;
  featureName?: string;
  // The connection a message about one is about, beside the node whose
  // component draws it: its socket and its alias, read as names.
  connection?: { socket?: unknown; alias?: unknown };
  // The slot of that connection an attach fills.
  slot?: string;
}

// ConnectionNames names one connection by the socket it is wired through and the
// alias it carries there — names the reader clicked, never a location.
export interface ConnectionNames {
  socket: string;
  alias: string;
}

// GraphMessageSinks are the effects a webview message can have. Injecting them
// is what keeps the decision — which root a click resolves against, what
// happens when there is none, and which requests are worth forwarding — free of
// every editor type, and therefore directly assertable.
export interface GraphMessageSinks {
  // openSource opens the node's authoring file, resolved against the root that
  // was live at the moment of the click.
  openSource(workspaceRoot: string, sourceFile: string): void;
  // reportNoWorkspace tells the reader the click could not be served because
  // nothing is anchored.
  reportNoWorkspace(): void;
  // requestAttachCandidates asks which Features may attach to the drawn node
  // with this id, and is answered back into the panel that asked.
  //
  // The node id is the subject: it names the node on the graph the panel drew,
  // and the side holding that graph adds the Release it was drawn from. Nothing
  // the view read off the drawing is forwarded beside it, because the labels
  // matched are the ones that Release's compiled graph carries for the node.
  //
  // The request id is carried through UNREAD and echoed back with the answer.
  // Two questions about the SAME node are not the same question — a re-render
  // re-asks because the node's labels may have just changed — so the node id
  // alone cannot tell a fresh answer from a stale one, and two requests in
  // flight together may complete in either order. Only the asker knows which
  // answer it is still waiting for, so the id is its to mint and its to
  // compare; nothing here interprets it.
  requestAttachCandidates(nodeId: string, requestId: number): void;
  // attachFeature commits the Feature the reader chose onto the node they have
  // selected, by editing the Aggregate that declares it.
  //
  // BOTH ARGUMENTS ARE NAMES AND NEITHER IS A LOCATION. Which document the edit
  // lands in, and where in it, is resolved on the side that holds the compiled
  // graph — so a path is never something this side accepted from the view. What
  // arrives here is what the reader clicked: the node they are looking at, and
  // the entity named on the row.
  attachFeature(nodeId: string, featureName: string): void;
  // requestConnectionCandidates asks which slots one drawn connection may fill
  // and which Features may fill each, and is answered back into the panel that
  // asked. The connection is named by the node whose component draws it, its
  // socket and its alias; the side holding the graph adds the Release. The
  // request id is carried through unread, as for a node.
  requestConnectionCandidates(nodeId: string, connection: ConnectionNames, requestId: number): void;
  // attachToConnection commits the Feature the reader chose into one slot of the
  // connection they selected. Every argument is a name: which document the edit
  // lands in, and where, is resolved on the side that holds the compiled graph.
  attachToConnection(nodeId: string, connection: ConnectionNames, slot: string, featureName: string): void;
  // listening is the panel's document saying it now hears what is posted to it,
  // which is when what was held for it can be sent (holdUntilListening, below).
  listening(): void;
}

// makeGraphMessageHandler builds the webview's message handler over a LIVE
// reader of the anchored workspace root.
//
// The root is read inside the handler, on each message, and this is the whole
// point of the function. A handler is registered once, when the panel is first
// created, and the panel outlives the anchor: the workspace can re-anchor
// afterwards. A handler that captured the root at registration would go on
// resolving clicks against the root the panel was born with, and the failure is
// silent — the path still resolves, so the editor either opens the wrong file or
// reports one missing, with nothing naming the stale root as the cause.
//
// A click arriving while nothing is anchored resolves against nothing, so it is
// reported rather than guessed at.
export function makeGraphMessageHandler(
  getWorkspaceRoot: () => string | null,
  sinks: GraphMessageSinks,
): (msg: GraphMessage) => void {
  return (msg: GraphMessage): void => {
    if (msg.type === 'openSource') {
      dispatchOpenSource(msg, getWorkspaceRoot, sinks);
      return;
    }
    if (msg.type === 'attachCandidates') {
      dispatchAttachCandidates(msg, sinks);
      return;
    }
    if (msg.type === 'attachFeature') {
      dispatchAttachFeature(msg, sinks);
      return;
    }
    if (msg.type === 'connectionCandidates') {
      dispatchConnectionCandidates(msg, sinks);
      return;
    }
    if (msg.type === 'attachToConnection') {
      dispatchAttachToConnection(msg, sinks);
      return;
    }
    if (msg.type === 'listening') {
      sinks.listening();
      return;
    }
    // Every other type falls through in silence, which is the tolerance the
    // two halves ship independently on. A new message may reach a host that
    // does not know it yet, and a host that treated one as an error would turn
    // an ordering it is meant to survive into a fault.
  };
}

// dispatchOpenSource resolves a source-file click against the live root.
function dispatchOpenSource(
  msg: GraphMessage,
  getWorkspaceRoot: () => string | null,
  sinks: GraphMessageSinks,
): void {
  if (!msg.sourceFile) {
    return;
  }
  const root = getWorkspaceRoot();
  if (root === null) {
    sinks.reportNoWorkspace();
    return;
  }
  sinks.openSource(root, msg.sourceFile);
}

// dispatchAttachCandidates forwards a request for what may attach to the node
// the reader selected.
//
// It reads no workspace root, and that is deliberate rather than an omission:
// the node is addressed on the graph the panel drew, whose Release is known to
// the side that drew it, so nothing here is resolved against an anchor and a
// request arriving while nothing is anchored has no anchor-shaped way to be
// wrong. It fails, if it fails, where the request is served.
//
// A message naming no node names no subject, so there is nothing to ask. Any
// other field it carries is not read: a view sending the node's labels beside
// its id is served by the id alone, the same tolerance that lets the two halves
// ship in either order.
function dispatchAttachCandidates(msg: GraphMessage, sinks: GraphMessageSinks): void {
  if (!msg.nodeId) {
    return;
  }
  // A request carrying no id is still served. The id is the asker's own way of
  // recognising its latest answer, so a sender that does not mint one is asking
  // a question this side can still answer — the same tolerance that lets the
  // two halves ship in either order.
  const requestId = typeof msg.requestId === 'number' && Number.isFinite(msg.requestId)
    ? msg.requestId
    : 0;
  sinks.requestAttachCandidates(msg.nodeId, requestId);
}

// dispatchAttachFeature forwards the reader's choice of what to attach.
//
// Both names must be there and neither is interpreted. An absent one names no
// subject — there is either no node to attach to or nothing to attach — so the
// message is dropped rather than completed with a default, which would commit
// an edit the reader did not ask for.
function dispatchAttachFeature(msg: GraphMessage, sinks: GraphMessageSinks): void {
  if (!msg.nodeId || !msg.featureName) {
    return;
  }
  sinks.attachFeature(msg.nodeId, msg.featureName);
}

// connectionNamed reads the connection a message names, or null where it names
// none: a socket and an alias that are both non-empty strings, and nothing else.
// A connection named in any other shape names no subject, and is not completed
// with a default — that would be asking about, or editing, a connection nobody
// clicked.
function connectionNamed(msg: GraphMessage): ConnectionNames | null {
  const c = msg.connection;
  if (typeof c !== 'object' || c === null) { return null; }
  if (typeof c.socket !== 'string' || !c.socket) { return null; }
  if (typeof c.alias !== 'string' || !c.alias) { return null; }
  return { socket: c.socket, alias: c.alias };
}

// dispatchConnectionCandidates forwards a request for the slots one connection
// may fill. Like a node's, it reads no workspace root, and a request with no id
// is still served; one naming no node or no readable connection names no subject
// and is dropped.
function dispatchConnectionCandidates(msg: GraphMessage, sinks: GraphMessageSinks): void {
  const connection = connectionNamed(msg);
  if (!msg.nodeId || connection === null) {
    return;
  }
  const requestId = typeof msg.requestId === 'number' && Number.isFinite(msg.requestId)
    ? msg.requestId
    : 0;
  sinks.requestConnectionCandidates(msg.nodeId, connection, requestId);
}

// dispatchAttachToConnection forwards the reader's choice of what to attach into
// a slot of a connection. Every name must be there and none is interpreted; an
// absent one is dropped rather than defaulted, for the reason a node's is.
function dispatchAttachToConnection(msg: GraphMessage, sinks: GraphMessageSinks): void {
  const connection = connectionNamed(msg);
  if (!msg.nodeId || connection === null || !msg.slot || !msg.featureName) {
    return;
  }
  sinks.attachToConnection(msg.nodeId, connection, msg.slot, msg.featureName);
}

// PanelDelivery is the one way a message reaches the graph panel's document.
export interface PanelDelivery {
  // post sends one message to the panel, or holds it while the panel has not yet
  // said it listens. Messages arrive in the order they were posted either way.
  post(message: unknown): void;
  // listening sends everything held, in order, and every later message at once.
  // A second call sends nothing twice.
  listening(): void;
}

// holdUntilListening builds the delivery for one panel over the function that
// actually posts to it.
//
// 🔴 NOTHING IS POSTED TO A PANEL BEFORE IT HAS SAID IT LISTENS, BECAUSE WHAT IS
// POSTED BEFORE THAT IS LOST. The editor hands a message to a new panel's
// document as soon as the document is written, whether or not the document's
// script has started — and the graph panel's script starts only once its layout
// library has loaded. The drawing a press asks for is usually ready before then,
// so on a busy machine it reached a document with nobody listening, was dropped,
// and the panel went on showing the sentence it opens with although a Release was
// selected. Nothing re-sends a lost message, so the only remedy is not to send it
// early: the panel says when it listens, and this holds everything until then.
export function holdUntilListening(deliver: (message: unknown) => void): PanelDelivery {
  let held: unknown[] | null = [];
  return {
    post: (message: unknown): void => {
      if (held !== null) {
        held.push(message);
        return;
      }
      deliver(message);
    },
    listening: (): void => {
      if (held === null) {
        return;
      }
      const waiting = held;
      held = null;
      for (const message of waiting) {
        deliver(message);
      }
    },
  };
}
