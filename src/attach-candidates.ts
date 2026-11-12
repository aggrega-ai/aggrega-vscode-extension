// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import {
  AttachCandidatesRequest,
  ConnectionAddress,
  attachCandidatesRequest,
  connectionCandidatesRequest,
  connectionWords,
} from './attachment-edit';
import { describeError } from './error-surfaces';
import { PanelDelivery } from './graph-messages';
import { Withheld, describeLinksLeadingOut } from './links-leading-out';
import { catalogIndexParams } from './release-terms';
import { CatalogIndexParams } from './types';
import { CatalogIndexDoc, linksLeadingOutOf } from './workspace-catalog-run';

// The side of the graph panel's list of what may attach that asks the language
// server, and what it posts back to the panel. It calls no editor API, so what
// the panel is sent for each answer is exercisable on its own; graph-view.ts
// binds it to the open panel and the output channel.

// FEATURES_NOT_OFFERED is what the list withholds where the language server names
// links leading out of the workspace: the Features a document behind such a link
// declares, which the editor's file tree shows and the list does not offer.
export const FEATURES_NOT_OFFERED: Withheld = { things: 'Features', as: 'offered' };

// AttachCandidatesDeps is what asking takes: the two requests, and the channel
// the list's failures are recorded on.
export interface AttachCandidatesDeps {
  // requestAttachCandidates asks which Features declare an applicability one
  // drawn node's labels satisfy, on the graph of the Release named — and, where
  // the request names one of the connections that node's component draws, which
  // slots that connection may fill and which Features may fill each.
  requestAttachCandidates(request: AttachCandidatesRequest): Promise<unknown>;
  // requestCatalogIndex asks for the entity index in the terms the parameters
  // name. Here it is asked for the links leading out of the workspace that the
  // index names beside its entities.
  requestCatalogIndex(params: CatalogIndexParams): Promise<CatalogIndexDoc>;
  output: { appendLine(line: string): void };
}

// featuresNotOfferedLine is the line the list says under its rows about the links
// an index answer names as leading out of the workspace, or null where it names
// none. Its words are the one sentence every surface says about such links,
// naming what this list withholds.
export function featuresNotOfferedLine(doc: CatalogIndexDoc): string | null {
  return describeLinksLeadingOut(linksLeadingOutOf(doc), FEATURES_NOT_OFFERED);
}

// postAttachCandidates asks what may attach to one node and posts the answer
// back to the panel, tagged with the node it was asked about so the panel can
// tell an answer about the selected node from one that arrived late.
//
// # A refusal is reported into the panel, and NOT onto a document
//
// The extension routes a daemon refusal to a diagnostic on the document the
// refusal names, which is right for a failure that is ABOUT an authored
// document — a graph that would not compile is about the Release. This request
// builds that same Release's graph again to read the node's labels, so a
// document it could be refused over is one the drawing already reported through
// the render's own path; publishing the refusal a second time from here would
// report one fault twice, and a refusal naming no document — an id the rebuilt
// graph no longer carries, a lockfile gone since the drawing — has no document
// to be put on at all.
//
// So the answer and the refusal go to the same place the question was asked —
// the panel the reader is looking at — with the detail on the output channel
// where the rest of this view's failures are recorded. Both surfaces, because a
// reader watching the panel has to be told the list is not coming, and a
// message worth acting on is worth keeping after the panel closes.
// The request id is echoed back untouched, on the answer and on the refusal
// alike. Two requests may be in flight at once and may complete in either
// order, so a refusal that is not echoed would be as capable of overwriting a
// fresh answer as a stale answer is.
//
// # The links leading out of the workspace travel with the answer
//
// A Feature declared behind a link leading out of the workspace is not offered,
// because the language server reads nothing through such a link, while the
// editor's file tree shows the Feature as though it were the workspace's own. The
// answer about what may attach does not say which links those are; the entity
// index does, in the same terms. So the index is asked about the Release this
// list is asked about — the one the graph was drawn from — and in its terms, so
// the links named are those that Release's own answer would have read had they
// led anywhere it reads. Both questions are in flight together, since neither
// answer depends on the other.
//
// The line naming those links is composed here and posted with the answer it
// explains, so the panel draws the string it is given and composes nothing. It is
// posted only where the index names a link, so an answer with nothing to say
// about links is posted exactly as it is without one. An index the language
// server could not read leaves the answer as it is, and its reason goes to the
// channel; a refused list has no rows for a line to explain, so it is posted as
// the refusal alone, and whatever the index answered goes unsaid.
export async function postAttachCandidates(
  toPanel: Pick<PanelDelivery, 'post'>,
  deps: AttachCandidatesDeps,
  nodeId: string,
  release: string,
  requestId: number,
): Promise<void> {
  await askAndPost(toPanel, deps, nodeId, nodeId, attachCandidatesRequest(nodeId, release), requestId,
    (result, linksNote) => (linksNote === null
      ? { type: 'attachCandidates', nodeId, requestId, result }
      : { type: 'attachCandidates', nodeId, requestId, result, linksNote }));
}

// postConnectionCandidates asks which slots one connection may fill, and which
// Features may fill each, and posts the answer back to the panel tagged with the
// connection it was asked about and the request id it was asked with.
//
// It is the node's question asked about a connection: the same request, naming
// the connection beside the node whose component draws it, answered and refused
// by the same path — the links leading out of the workspace travel with it for
// the same reason, since the Features that may fill a slot are read from the
// same places as those that may attach to the node. A refusal is posted as the
// node's is, matched by its request id.
export async function postConnectionCandidates(
  toPanel: Pick<PanelDelivery, 'post'>,
  deps: AttachCandidatesDeps,
  nodeId: string,
  connection: ConnectionAddress,
  release: string,
  requestId: number,
): Promise<void> {
  await askAndPost(toPanel, deps, nodeId, `the ${connectionWords(nodeId, connection)}`,
    connectionCandidatesRequest(nodeId, connection, release), requestId,
    (result, linksNote) => (linksNote === null
      ? { type: 'connectionCandidates', nodeId, connection, requestId, result }
      : { type: 'connectionCandidates', nodeId, connection, requestId, result, linksNote }));
}

// askAndPost is the one path both questions take: the index asked beside the
// question, the answer posted as `answered` words it, and a refusal posted and
// recorded. `subject` names what was asked about on the output channel.
async function askAndPost(
  toPanel: Pick<PanelDelivery, 'post'>,
  deps: AttachCandidatesDeps,
  nodeId: string,
  subject: string,
  request: AttachCandidatesRequest,
  requestId: number,
  answered: (result: unknown, linksNote: string | null) => unknown,
): Promise<void> {
  const links = readLinksLine(deps, request.release);
  try {
    const result = await deps.requestAttachCandidates(request);
    const read = await links;
    if ('failure' in read) {
      deps.output.appendLine(`catalogIndex failed for ${subject}, so the list of what may attach names no link leading out of the workspace: ${read.failure}`);
    }
    const linksNote = 'line' in read ? read.line : null;
    toPanel.post(answered(result, linksNote));
  } catch (err) {
    // describeError is the extension's one home for rendering a thrown value as
    // a line for a reader, so a transport refusal and a language server that is
    // not running are worded here by the same rule they are worded everywhere.
    const message = describeError(err);
    deps.output.appendLine(`attachCandidates failed for ${subject}: ${message}`);
    toPanel.post({ type: 'attachCandidatesError', nodeId, requestId, message });
  }
}

// readLinksLine asks the index in the named Release's terms and reads the line
// its links make, or the reason it could not be read. It never rejects, so it can
// be in flight beside the list without a refusal of its own going unobserved.
async function readLinksLine(
  deps: AttachCandidatesDeps,
  release: string,
): Promise<{ line: string | null } | { failure: string }> {
  try {
    return { line: featuresNotOfferedLine(await deps.requestCatalogIndex(catalogIndexParams(release))) };
  } catch (err) {
    return { failure: describeError(err) };
  }
}
