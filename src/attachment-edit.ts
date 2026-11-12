// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';
import { describeError } from './error-surfaces';
import { convertPosition } from './translator';
import { LspPosition, ServerEncoding } from './types';

// The document-free half of committing an attachment: what the attachment is
// called locally, the coordinate the compiler's first question is asked with,
// the readers for both its answers, and the text of the entry that goes
// wherever those answers say.
//
// It reads no document, opens no file and calls no editor API, so every
// decision it makes is exercisable on its own. graph-view.ts applies whatever
// this produces through the editor's own edit machinery.
//
// THE DIVISION OF LABOUR IS THE POINT OF THIS FILE, AND IT LEAVES NOTHING
// STRUCTURAL ON THIS SIDE. The compiler answers which document an attachment
// for a drawn node belongs in and the path to the container inside it, and then
// answers where in that document such an entry goes — which of the path the
// document already carries, the column its entries start at, the nesting step
// its author uses, and the line its block reaches. Nothing here re-derives any
// of that, nothing here parses YAML, and nothing here spells a key an Aggregate
// is written with. A path composed on this side would be a second answer to a
// question the compiler already answers, and a component's enclosing scope and
// a node's own identifier are composed with the same separator — so a path
// assembled here would not fail where it disagreed: it would name keys nobody
// authored, and the entry would be created under them.
//
// What this side supplies is what the compiler was not asked about: the name
// the attachment is written under — derived from the Feature's own name on a
// node, and the slot's own name on a connection; the refusal where that yields
// nothing, collides with a name already on the node, or fills a slot the graph
// already shows filled on the connection; for a connection, which of the two
// documents the request names, read from the compiled edge that says which one
// drew it; and the entry's own text.

// INSTANCE_NAME_PATTERN is the shape an attachment's instance name may take.
// A name outside it is refused rather than reshaped: the name decides whether
// the attachment fills a slot the Component declares or stands free, so
// quietly rewriting one would change what the attachment does.
const INSTANCE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

// EntryShape values the compiler reports for the container an entry joins.
// A container carrying entries as a sequence takes a different entry shape
// from the one composed here, so it is recognised in order to be refused.
const ENTRY_SHAPE_SEQUENCE = 'sequence';

// AttachmentSite is what the drawn graph knows about one node: the id that
// graph keys it under, and the attachments it already carries.
//
// It is built host-side from the compiled graph rather than accepted back from
// the view, so the node an edit is computed for is one the compiler drew and
// never one the view named. It holds no document path and nothing about how the
// node was authored: which document an attachment for it belongs in is an
// answer, asked for by node id.
export interface AttachmentSite {
  nodeId: string;
  // The instance names already attached to this node, so a name that would
  // collide with one is refused before anything is written.
  attached: string[];
}

// AttachmentContainerRequest is the coordinate the compiler is asked an
// attachment container with: the id the drawn graph keys the node under, the
// Release whose graph that is, and — for an attachment on one of the
// connections that node's component draws — that connection and the document
// the attachment is written in.
//
// The shape is named here rather than spelled at the call site because there is
// nothing else for this side to supply: a further field could only be something
// this side had composed.
export type AttachmentContainerRequest = Required<
  Pick<wire.AttachmentContainerParams, 'graphNode' | 'release'>
> & Pick<wire.AttachmentContainerParams, 'connection'>;

// AttachCandidatesRequest is the coordinate the compiler is asked what may attach
// with: the same as the container question, the id the drawn graph keys the node
// under and the Release whose graph that is, and — for the slots of one
// connection that node's component draws — that connection.
//
// It carries no label set. The request refuses a Release beside one, and the
// Release is what decides which catalog directories the candidates are read
// from, so a label set sent on its own is answered from the workspace's own
// directories whichever Release the graph shows.
export type AttachCandidatesRequest = Required<
  Pick<wire.AttachCandidatesParams, 'graphNode' | 'release'>
> & Pick<wire.AttachCandidatesParams, 'connection'>;

// ConnectionAddress names one connection a drawn node's component draws: the
// socket it is wired through and the alias it carries there. Together with the
// node it is the whole address; nothing else about the connection is a name the
// reader clicked.
export type ConnectionAddress = Pick<wire.ConnectionCoordinate, 'socket' | 'alias'>;

// ConnectionDocument is which document an attachment on a connection is
// written in: the Aggregate, or the Release. The set is the request's own, and
// closed.
export type ConnectionDocument = 'aggregate' | 'release';

// ConnectionSite is what the drawn graph knows about one connection: the node
// whose component draws it, the socket and the alias, the document that drew it,
// and the slots the graph already shows filled on it.
//
// Like AttachmentSite it is built host-side from the compiled graph, never
// accepted back from the view, and it holds no authored value.
export interface ConnectionSite extends ConnectionAddress {
  source: string;
  // The document an attachment on this connection is written in: the one that
  // drew it. The compiled edge marks a connection the Release drew; every other
  // connection is written in the Aggregate. A connection a Feature drew takes
  // the Aggregate here too, and the compiler refuses an attachment on it in its
  // own words — whether it may carry one is its answer, not this side's.
  document: ConnectionDocument;
  // The slots an attachment on this connection already fills, read from the
  // entries the graph places on it, so a second fill of one is refused before
  // anything is written.
  filled: string[];
}

// ConnectionPlacement is the one decision of which attachment belongs to which
// connection, as the drawing makes it. It is the shared attachment model's, run
// on this side as the view runs it, so the side that refuses a filled slot and
// the side that draws the connection's attachments read one placement rather
// than two that agree.
export interface ConnectionPlacement {
  // connectionAttachmentsFor reports, for one node, a row per connection its
  // component draws that carries an attachment, with each attachment's binding.
  connectionAttachmentsFor(
    graph: unknown,
    nodeId: string,
    showsSensitiveValues: boolean,
  ): Array<{ source: string; socket: string; alias: string; attachments: Array<{ binding: string }> }>;
  // connectionKey is the one spelling of a connection's identity.
  connectionKey(source: string, socket: string, alias: string): string;
}

// LocatedContainer is the compiler's answer about where an attachment for one
// node belongs: the document it was authored in, and the structural path to the
// container the attachment goes inside.
//
// The path is carried as the segments the answer arrived as, and is never
// joined, split or read into. A component's enclosing scope and a node's own
// identifier are composed with the same separator, so any joined form is
// ambiguous the moment something tries to read structure back out of it —
// handing the segments straight on leaves nothing to split.
export type LocatedContainer = Pick<wire.AttachmentContainerResult, 'file' | 'container'>;

// AttachmentName is the name an attachment for one node is written under, or
// the reason it cannot be written at all.
export type AttachmentName =
  | { readonly instanceName: string }
  | { readonly refusal: string };

// Insertion is the compiler's answer about one document: where the entry goes
// and what the caller has to write to put it there.
export type Insertion = Pick<
  wire.InsertionPointResult,
  | 'file'
  | 'positionEncoding'
  | 'position'
  | 'precededByLineBreak'
  | 'missingContainerKeys'
  | 'entryIndent'
  | 'indentStep'
  | 'indentStepMeasured'
  | 'entryShape'
>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function whole(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

// instanceNameFor is the name an attachment is written under, derived from the
// Feature's own name.
//
// The last segment is taken because a Feature is named in a namespace and the
// namespace is not part of the attachment's local name. The result is checked
// rather than trusted: a name the surface cannot carry is reported as one this
// side will not invent a substitute for.
export function instanceNameFor(featureName: string): string | null {
  const segments = text(featureName).split('/');
  const last = segments[segments.length - 1] ?? '';
  // A version suffix names which Feature is requested and is carried on the
  // attachment's own type, not on the name it sits under.
  const withoutVersion = last.split(':')[0] ?? '';
  return INSTANCE_NAME_PATTERN.test(withoutVersion) ? withoutVersion : null;
}

// nameAttachment reports the name an attachment for this node is written
// under, or the reason no attachment can be written for it.
//
// Both refusals are this side's own, and neither was asked of the compiler: the
// local name is derived from the Feature's name, and the names already on the
// node are read from the graph this panel drew. Nothing here says anything
// about a document — where the entry goes is answered elsewhere, and that
// answer is the same whether the component was authored at the top level or
// inside a subsystem.
export function nameAttachment(site: AttachmentSite, featureName: string): AttachmentName {
  const instanceName = instanceNameFor(featureName);
  if (instanceName === null) {
    return { refusal: `${featureName} has no name an attachment can be written under.` };
  }
  if (site.attached.indexOf(instanceName) >= 0) {
    return { refusal: `${site.nodeId} already carries an attachment named ${instanceName}.` };
  }
  return { instanceName };
}

// attachmentContainerRequest is the question asking which document an
// attachment for this node belongs in, and where inside it.
//
// It is composed in one place so the request that goes on the wire is the
// request this side can be held to — and so a field this side would have had to
// invent cannot be added quietly. The node is addressed by the id the drawn
// graph keys it under, which is what the canvas holds; there is deliberately no
// name-addressed form, because a document's own name names an entity rather
// than an instance of one and the same entity may be instantiated at several
// places in one Aggregate.
export function attachmentContainerRequest(
  site: AttachmentSite,
  release: string,
): AttachmentContainerRequest {
  return { graphNode: site.nodeId, release };
}

// attachCandidatesRequest is the question asking which Features may attach to
// one node of the drawn graph.
//
// The answer is computed over the node's labels on that Release's compiled graph,
// and its candidates are the Features declared by the workspace documents that
// Release's terms hold — every one but those under a catalog directory only other
// Releases read — together with those held by the catalog directories that
// Release builds against: its own, where the workspace configuration gives it
// some. So a Feature in a directory only another Release reads, inside the
// workspace or outside it, is offered on that Release's graph and on no other.
export function attachCandidatesRequest(
  nodeId: string,
  release: string,
): AttachCandidatesRequest {
  return { graphNode: nodeId, release };
}

// connectionCandidatesRequest is the question asking which slots one connection
// may fill and which Features may fill each: the node whose component draws it,
// the Release that graph was built from, and the connection.
//
// It names no document. The answer is the socket's slots and the Features that
// match them, the same whichever document an attachment is written in.
export function connectionCandidatesRequest(
  nodeId: string,
  connection: ConnectionAddress,
  release: string,
): AttachCandidatesRequest {
  return {
    graphNode: nodeId,
    release,
    connection: { socket: connection.socket, alias: connection.alias },
  };
}

// connectionContainerRequest is the question asking where an attachment on one
// connection belongs: the node whose component draws it, the Release, and the
// connection with the document that drew it — read from this side's own table
// of the compiled graph, never from the view.
export function connectionContainerRequest(
  site: ConnectionSite,
  release: string,
): AttachmentContainerRequest {
  return {
    graphNode: site.source,
    release,
    connection: { socket: site.socket, alias: site.alias, document: site.document },
  };
}

// connectionWords names one connection in a sentence, in the order the
// compiler's own refusals name it — the alias, the socket, the node — for the
// caller to open with an article.
export function connectionWords(source: string, connection: ConnectionAddress): string {
  return `connection ${connection.alias} through socket ${connection.socket} of ${source}`;
}

// fillSlot reports the name an attachment filling one slot of a connection is
// written under — the slot's own name — or the reason it cannot be written.
//
// Both refusals are this side's own. A slot the graph already shows filled on
// this connection would be a second fill of it, so it is refused before anything
// is asked, as a name already on a node is. And a slot whose name is not one the
// entry can be written under as a plain key is refused rather than reshaped:
// which slot a fill binds is decided by that name alone.
//
// Whether the slot is one the socket declares, and whether the Feature may fill
// it, are not judged here. The panel offers only what the language server
// answered for this connection, and the build judges what is written.
export function fillSlot(site: ConnectionSite, slot: string): AttachmentName {
  if (!INSTANCE_NAME_PATTERN.test(text(slot))) {
    return { refusal: `The slot ${slot} is not a name an attachment can be written under.` };
  }
  if (site.filled.indexOf(slot) >= 0) {
    return {
      refusal: `The slot ${slot} of the ${connectionWords(site.source, site)} is already filled.`,
    };
  }
  return { instanceName: slot };
}

// connectionNotDrawn is the refusal for an attach to a connection this side's
// table of the drawn graph does not hold — said as a node's is, since nothing
// can be attached to a connection the graph does not draw.
export function connectionNotDrawn(source: string, connection: ConnectionAddress): string {
  return `The ${connectionWords(source, connection)} is not on the graph this panel drew.`;
}

// ConnectionSites looks one connection of the drawn graph up by the names a
// message carries: the node whose component draws it, its socket and its alias.
export type ConnectionSites = (source: string, connection: ConnectionAddress) => ConnectionSite | undefined;

// NO_CONNECTION_SITES is the table of a panel that has drawn nothing.
export const NO_CONNECTION_SITES: ConnectionSites = () => undefined;

// connectionSites reads what the drawn graph knows about every connection, so
// an attach to one is computed for a connection the compiler drew rather than
// for one the view named.
//
// A connection is a site where exactly one edge of the graph is drawn from that
// node through that socket under that alias — the pair is how an attachment
// names its connection, and a pair two edges share names neither. An edge whose
// socket or alias is not a name is no site: no connection can be asked about by
// it.
//
// Which slots are filled is read through the shared placement, which puts each
// attachment of a node on the connection its mark names; this side reads the
// binding of each entry placed there and nothing else. The placement is asked
// with the sensitive values withheld, and of what it projects only the bindings
// are kept.
//
// The table is looked up through the same placement's spelling of a
// connection, so the names a message carries meet the graph's edges through
// one function.
export function connectionSites(
  graph: unknown,
  placement: ConnectionPlacement,
): ConnectionSites {
  const sites = readConnectionSites(graph, placement);
  return (source, connection) => sites.get(
    placement.connectionKey(source, connection.socket, connection.alias),
  );
}

function readConnectionSites(
  graph: unknown,
  placement: ConnectionPlacement,
): Map<string, ConnectionSite> {
  const sites = new Map<string, ConnectionSite>();
  if (!isPlainObject(graph)) { return sites; }
  const spec = graph.spec;
  if (!isPlainObject(spec) || !Array.isArray(spec.edges)) { return sites; }

  const shared = new Set<string>();
  for (const edge of spec.edges) {
    if (!isPlainObject(edge)) { continue; }
    const source = text(edge.source);
    const socket = text(edge.socket);
    const alias = text(edge.alias);
    if (!source || !socket || !alias) { continue; }
    const key = placement.connectionKey(source, socket, alias);
    if (sites.has(key)) { shared.add(key); }
    sites.set(key, {
      source,
      socket,
      alias,
      document: edge.origin_release === true ? 'release' : 'aggregate',
      filled: [],
    });
  }
  for (const key of shared) { sites.delete(key); }

  const sources = new Set(Array.from(sites.values(), (site) => site.source));
  for (const source of sources) {
    for (const row of placement.connectionAttachmentsFor(graph, source, false)) {
      const site = sites.get(placement.connectionKey(row.source, row.socket, row.alias));
      if (!site) { continue; }
      for (const a of row.attachments) {
        if (a.binding) { site.filled.push(a.binding); }
      }
    }
  }
  return sites;
}

// readAttachmentContainer reads the answer about where an attachment belongs,
// or reports that it arrived in a shape this side cannot pass on.
//
// The segments are checked for being segments and for nothing else. What they
// spell is not this side's business: it has no rule to judge them against, and
// a check written here would be that rule re-appearing in the one place this
// whole request exists to keep it out of.
export function readAttachmentContainer(value: unknown): LocatedContainer | null {
  if (!isPlainObject(value)) { return null; }
  if (typeof value.file !== 'string') { return null; }
  const container = value.container;
  if (!Array.isArray(container) || !container.every((s) => typeof s === 'string')) {
    return null;
  }
  return { file: value.file, container: container as string[] };
}

// readInsertion reads the compiler's answer, or reports that it arrived in a
// shape this side cannot apply.
//
// Every field is required, and a missing one refuses the whole answer rather
// than standing in a default. Each of them decides part of where bytes land: a
// defaulted indentation writes a well-formed entry into the wrong block, and a
// defaulted position writes it into the wrong line — neither of which fails
// loudly, and both of which land in a document its author wrote.
export function readInsertion(value: unknown): Insertion | null {
  if (!isPlainObject(value)) { return null; }
  const position = value.position;
  if (!isPlainObject(position)) { return null; }

  const line = whole(position.line);
  const character = whole(position.character);
  const entryIndent = whole(value.entryIndent);
  const indentStep = whole(value.indentStep);
  if (line === null || character === null || entryIndent === null || indentStep === null) {
    return null;
  }
  if (line < 0 || character < 0 || entryIndent < 0 || indentStep <= 0) { return null; }
  if (typeof value.precededByLineBreak !== 'boolean') { return null; }
  if (typeof value.indentStepMeasured !== 'boolean') { return null; }

  // An absent list of missing keys is the compiler's own finding that the whole
  // container path is already there, and it is reported as an absent list
  // rather than an empty one. A list carrying anything but strings is a shape
  // this side cannot write lines from, which refuses the answer.
  const missingRaw = value.missingContainerKeys;
  let missing: string[] = [];
  if (missingRaw !== undefined && missingRaw !== null) {
    if (!Array.isArray(missingRaw) || !missingRaw.every((k) => typeof k === 'string')) {
      return null;
    }
    missing = missingRaw as string[];
  }

  return {
    file: text(value.file),
    positionEncoding: text(value.positionEncoding),
    position: { line, character },
    precededByLineBreak: value.precededByLineBreak,
    missingContainerKeys: missing,
    entryIndent,
    indentStep,
    indentStepMeasured: value.indentStepMeasured,
    entryShape: text(value.entryShape),
  };
}

// insertionEncoding names the units the reported character offset is measured
// in, or reports null for units this side cannot convert from.
//
// It is read off the answer rather than off the session, because the answer
// states it and a position whose units a caller guesses is a position it cannot
// apply. Guessing the commoner of the two would be wrong exactly on the
// documents where the two differ, which are the ones carrying text outside the
// range where they agree.
export function insertionEncoding(insertion: Insertion): ServerEncoding | null {
  if (insertion.positionEncoding === 'utf-8') { return 'utf-8'; }
  if (insertion.positionEncoding === 'utf-16') { return 'utf-16'; }
  return null;
}

// insertionPositionInDocument is the reported position in the units the editor
// measures a column in, or null where the answer states units this side cannot
// convert from.
//
// The conversion itself is the extension's existing one, which is the only
// place either direction is implemented — a second conversion written here
// would agree on the documents where the two encodings agree, which is every
// document until one carries text outside them.
export function insertionPositionInDocument(
  documentContent: string,
  insertion: Insertion,
): LspPosition | null {
  const encoding = insertionEncoding(insertion);
  if (encoding === null) { return null; }
  return convertPosition(documentContent, insertion.position, encoding, 'utf-16');
}

// attachmentEntryLines is the text of the attachment itself, as lines that are
// each indented by the caller.
//
// The nested line is indented by the document's own nesting step, so the entry
// reads like the rest of the file rather than like this file's own habits.
export function attachmentEntryLines(
  instanceName: string,
  featureType: string,
  indentStep: number,
): string[] {
  return [`${instanceName}:`, `${' '.repeat(indentStep)}type: ${featureType}`];
}

// composeInsertionText builds the text that goes in at the reported position.
//
// The shape is the one the answer describes: a leading break where the position
// sits at the end of an existing line, then one line per container key the
// document does not carry yet — outermost first, each a step further in than
// the one before, the first of them as far in as the entry is minus one step
// per missing key — and then the entry itself at the entry indent.
//
// Nothing here is conditional on what the entry says. The container keys are
// written whether there is one or several, and a document already carrying the
// whole path writes none of them.
export function composeInsertionText(insertion: Insertion, entryLines: string[]): string {
  const parts: string[] = [];
  if (insertion.precededByLineBreak) {
    parts.push('\n');
  }

  // A document already carrying the whole path names no missing key, and an
  // empty list of them reaches the wire as null.
  const missing = insertion.missingContainerKeys ?? [];
  const outermost = insertion.entryIndent - missing.length * insertion.indentStep;
  for (let i = 0; i < missing.length; i++) {
    parts.push(' '.repeat(outermost + i * insertion.indentStep));
    parts.push(missing[i]);
    parts.push(':\n');
  }

  for (let i = 0; i < entryLines.length; i++) {
    if (i > 0) { parts.push('\n'); }
    parts.push(' '.repeat(insertion.entryIndent));
    parts.push(entryLines[i]);
  }
  return parts.join('');
}

// refusesEntryShape reports the reason an answer's container cannot carry the
// entry composed here, or the empty string where it can.
//
// A container the document already carries as a sequence takes entries
// introduced by a dash. Writing a key into one produces a document that no
// longer parses, so the shape the compiler read off the document is checked
// rather than assumed from what the container is called.
export function refusesEntryShape(insertion: Insertion): string {
  if (insertion.entryShape === ENTRY_SHAPE_SEQUENCE) {
    return 'the attachments in this document are written as a list, which this cannot add to.';
  }
  return '';
}

// ATTACH_REFUSAL_PREFIX opens the sentence a refused attach reports, so a
// clause is introduced the same way wherever the refusal came from.
const ATTACH_REFUSAL_PREFIX = 'Cannot attach: ';

// attachRefusal is the sentence reported for a clause this side holds.
export function attachRefusal(clause: string): string {
  return ATTACH_REFUSAL_PREFIX + clause;
}

// attachFailureLine is the sentence reported for a request the compiler or the
// transport declined.
//
// The clause is the declined request's own text and is never re-worded here.
// Where the compiler declines to report a container for a node — an id no graph
// carries, a node it records no document for, a component whose own block
// cannot be named in the document it was authored in — it words the reason
// itself, and that wording has a single home on its side precisely so two
// callers reporting the same refusal cannot describe it differently. So this
// reports what arrived.
export function attachFailureLine(err: unknown): string {
  return attachRefusal(describeError(err));
}

// attachmentSites reads what the drawn graph knows about every node, so an edit
// is computed for a node the compiler drew rather than for one the view named.
//
// It is read from the compiled graph on the side that holds it, and the view is
// never asked for any of it: a node id arriving back from the view is looked up
// in this table before anything is asked about it, and the table belongs to the
// render.
export function attachmentSites(graph: unknown): Map<string, AttachmentSite> {
  const sites = new Map<string, AttachmentSite>();
  if (!isPlainObject(graph)) { return sites; }
  const spec = graph.spec;
  if (!isPlainObject(spec)) { return sites; }
  const nodes = spec.nodes;
  if (!isPlainObject(nodes)) { return sites; }
  const mapping = isPlainObject(spec.feature_values_mapping)
    ? spec.feature_values_mapping
    : {};

  for (const nodeId of Object.keys(nodes)) {
    const bucket = (mapping as Record<string, unknown>)[nodeId];
    sites.set(nodeId, {
      nodeId,
      attached: isPlainObject(bucket) ? Object.keys(bucket) : [],
    });
  }
  return sites;
}
