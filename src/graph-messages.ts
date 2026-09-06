// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// GraphMessage is the shape the topology webview posts back to the extension.
// An unrecognized type is ignored rather than treated as an error, so the
// webview and the host can be updated in either order.
export interface GraphMessage {
  type: string;
  sourceFile?: string;
  nodeId?: string;
  labels?: Record<string, string>;
  requestId?: number;
  featureName?: string;
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
  // requestAttachCandidates asks which Features may attach to a node carrying
  // this label set, and is answered back into the panel that asked.
  //
  // The node id is carried so the answer can be matched to the node it was
  // asked about. It addresses nothing: the label set is the whole subject of
  // the question, and the id is what the reader is looking at.
  //
  // The request id is carried through UNREAD and echoed back with the answer.
  // Two questions about the SAME node are not the same question — a re-render
  // re-asks because the node's labels may have just changed — so the node id
  // alone cannot tell a fresh answer from a stale one, and two requests in
  // flight together may complete in either order. Only the asker knows which
  // answer it is still waiting for, so the id is its to mint and its to
  // compare; nothing here interprets it.
  requestAttachCandidates(
    nodeId: string,
    labels: Record<string, string>,
    requestId: number,
  ): void;
  // attachFeature commits the Feature the reader chose onto the node they have
  // selected, by editing the Aggregate that declares it.
  //
  // BOTH ARGUMENTS ARE NAMES AND NEITHER IS A LOCATION. Which document the edit
  // lands in, and where in it, is resolved on the side that holds the compiled
  // graph — so a path is never something this side accepted from the view. What
  // arrives here is what the reader clicked: the node they are looking at, and
  // the entity named on the row.
  attachFeature(nodeId: string, featureName: string): void;
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
// the label set IS the subject of this question, so nothing here is resolved
// against an anchor and a request arriving while nothing is anchored has no
// anchor-shaped way to be wrong. It fails, if it fails, where the request is
// served.
//
// AN EMPTY LABEL SET IS A SUBJECT AND IS FORWARDED. A node carrying no labels
// is a node every Feature that declares no requirement admits, so reading `{}`
// as "nothing was asked" would silently refuse a legitimate question and report
// it as though no Feature matched. An ABSENT or non-object label set is a
// different case: there is no subject at all, so there is nothing to ask.
function dispatchAttachCandidates(msg: GraphMessage, sinks: GraphMessageSinks): void {
  if (!msg.nodeId) {
    return;
  }
  const labels = msg.labels;
  if (typeof labels !== 'object' || labels === null || Array.isArray(labels)) {
    return;
  }
  // A request carrying no id is still served. The id is the asker's own way of
  // recognising its latest answer, so a sender that does not mint one is asking
  // a question this side can still answer — the same tolerance that lets the
  // two halves ship in either order.
  const requestId = typeof msg.requestId === 'number' && Number.isFinite(msg.requestId)
    ? msg.requestId
    : 0;
  sinks.requestAttachCandidates(msg.nodeId, labels, requestId);
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
