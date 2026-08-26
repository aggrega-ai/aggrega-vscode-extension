// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// GraphMessage is the shape the topology webview posts back to the extension.
// Only the source-file click is acted on today; an unrecognized type is ignored
// rather than treated as an error, so the webview and the host can be updated
// in either order.
export interface GraphMessage {
  type: string;
  sourceFile?: string;
}

// GraphMessageSinks are the effects a webview message can have. Injecting them
// is what keeps the decision — which root a click resolves against, and what
// happens when there is none — free of every editor type, and therefore
// directly assertable.
export interface GraphMessageSinks {
  // openSource opens the node's authoring file, resolved against the root that
  // was live at the moment of the click.
  openSource(workspaceRoot: string, sourceFile: string): void;
  // reportNoWorkspace tells the reader the click could not be served because
  // nothing is anchored.
  reportNoWorkspace(): void;
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
    if (msg.type !== 'openSource' || !msg.sourceFile) {
      return;
    }
    const root = getWorkspaceRoot();
    if (root === null) {
      sinks.reportNoWorkspace();
      return;
    }
    sinks.openSource(root, msg.sourceFile);
  };
}
