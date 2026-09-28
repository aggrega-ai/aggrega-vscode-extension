// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

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
// the attachment is written under, derived from the Feature's own name; the
// refusal where that yields nothing or collides with a name already on the
// node; and the entry's own text.

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

// AttachmentContainerRequest is the coordinate the compiler is asked a node's
// attachment container with: the id the drawn graph keys the node under, and
// the Release whose graph that is.
//
// The whole request is those two, and that is why the shape is named here
// rather than spelled at the call site: there is nothing else for this side to
// supply, so a third field could only be something this side had composed.
export type AttachmentContainerRequest = Required<
  Pick<wire.AttachmentContainerParams, 'graphNode' | 'release'>
>;

// AttachCandidatesRequest is the coordinate the compiler is asked what may attach
// to one drawn node with: the same two as the container question, the id the
// drawn graph keys the node under and the Release whose graph that is.
//
// It carries no label set. The request refuses a Release beside one, and the
// Release is what decides which catalog directories the candidates are read
// from, so a label set sent on its own is answered from the workspace's own
// directories whichever Release the graph shows.
export type AttachCandidatesRequest = Required<
  Pick<wire.AttachCandidatesParams, 'graphNode' | 'release'>
>;

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
// and its candidates are the Features declared by documents in the workspace
// together with those held by the catalog directories that Release builds
// against — its own, where the workspace configuration gives it some. So a Feature
// held only by such a directory outside the workspace is offered on that
// Release's graph and on no other, while one a document inside the workspace
// declares is offered on every graph, whichever directory the document sits in.
export function attachCandidatesRequest(
  nodeId: string,
  release: string,
): AttachCandidatesRequest {
  return { graphNode: nodeId, release };
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
