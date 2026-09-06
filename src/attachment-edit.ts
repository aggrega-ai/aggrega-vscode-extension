// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { convertPosition } from './translator';
import { LspPosition, ServerEncoding } from './types';

// The document-free half of committing an attachment: which place in an
// Aggregate an attachment for a drawn node belongs to, and the text of the
// entry that goes there once the compiler has reported where "there" is.
//
// It reads no document, opens no file and calls no editor API, so every
// decision it makes is exercisable on its own. graph-view.ts applies whatever
// this produces through the editor's own edit machinery.
//
// THE DIVISION OF LABOUR IS THE POINT OF THIS FILE. The compiler answers where
// an entry belongs in a particular document — which of the container path that
// document already carries, the column its entries start at, the nesting step
// its author uses, and the line its block reaches. Nothing here re-derives any
// of that, and nothing here parses YAML: a position computed on this side would
// be a second answer to a question the compiler already answers, free to
// disagree with it on the document that matters.
//
// What this side supplies is the other half the request needs: the structural
// path such an entry occupies in a document of this kind, and the entry's own
// text. Both are statements about the shape of an Aggregate rather than about
// any one file, which is why they can be made without reading one.

// ATTACHMENT_KEY is the key an attachment goes under on a component, and
// COMPONENTS_KEY and SPEC_KEY are the keys above it at the surface an author
// writes components at directly.
//
// They are named rather than spelled inline because they are the whole of this
// file's claim about an Aggregate's shape, and a claim worth keeping in one
// place is worth being able to see at a glance.
const SPEC_KEY = 'spec';
const COMPONENTS_KEY = 'components';
const ATTACHMENT_KEY = 'features';

// INSTANCE_NAME_PATTERN is the shape an attachment's instance name may take.
// A name outside it is refused rather than reshaped: the name decides whether
// the attachment fills a slot the Component declares or stands free, so
// quietly rewriting one would change what the attachment does.
const INSTANCE_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

// EntryShape values the compiler reports for the container an entry joins.
// A container carrying entries as a sequence takes a different entry shape
// from the one composed here, so it is recognised in order to be refused.
const ENTRY_SHAPE_SEQUENCE = 'sequence';

// AttachmentSite is what the drawn graph knows about one node's authoring: the
// document it was authored in, whether it was authored at the surface where
// components sit directly, and the attachments it already carries.
//
// It is built host-side from the compiled graph rather than accepted back from
// the view, so a path the extension writes to is one the compiler reported and
// never one the view supplied.
export interface AttachmentSite {
  nodeId: string;
  // Workspace-relative path of the Aggregate this node was authored in.
  sourceFile: string;
  // Whether this node was authored at the top-level components surface. The
  // compiler reports it for exactly this purpose — pointing at the shape the
  // author typed rather than at the scope name it generated.
  authoredAtTopLevel: boolean;
  // The instance names already attached to this node, so a name that would
  // collide with one is refused before anything is written.
  attached: string[];
}

// Placement is where an attachment for one node belongs, or the reason no
// placement can be stated for it.
export type Placement =
  | { readonly file: string; readonly container: string[]; readonly instanceName: string }
  | { readonly refusal: string };

// Insertion is the compiler's answer about one document: where the entry goes
// and what the caller has to write to put it there.
export interface Insertion {
  file: string;
  positionEncoding: string;
  position: { line: number; character: number };
  precededByLineBreak: boolean;
  missingContainerKeys: string[];
  entryIndent: number;
  indentStep: number;
  indentStepMeasured: boolean;
  entryShape: string;
}

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

// placeAttachment states where an attachment for this node belongs, or refuses.
//
// # WHY A NODE AUTHORED INSIDE A SUBSYSTEM IS REFUSED RATHER THAN GUESSED AT
//
// The drawn graph identifies a node topologically. For a component authored at
// the top-level components surface that identity is the key the author wrote,
// and the compiler says so directly — which is what makes the path below a
// reading of the compiler's own answer rather than a rule this file invented.
//
// For a component authored inside a subsystem it is not. Recovering the keys
// the author wrote would mean splitting a scope name on a separator this side
// would have to know, and a component reached through an imported Aggregate is
// named in a way that is not distinguishable from that split. A path assembled
// on either guess addresses nothing in the document, and addressing nothing is
// not a failure that shows: the answer would report the whole path as absent
// and the entry would be written into keys nobody authored.
//
// So this refuses, and says why. A refusal costs a reader one edit they make
// themselves; a guess writes into their file.
export function placeAttachment(site: AttachmentSite, featureName: string): Placement {
  if (!site.sourceFile) {
    return { refusal: `The compiler reports no authoring file for ${site.nodeId}.` };
  }
  if (!site.authoredAtTopLevel) {
    return {
      refusal:
        `${site.nodeId} is declared inside a subsystem. Add the attachment under that `
        + `component's features: block in ${site.sourceFile}.`,
    };
  }
  const instanceName = instanceNameFor(featureName);
  if (instanceName === null) {
    return { refusal: `${featureName} has no name an attachment can be written under.` };
  }
  if (site.attached.indexOf(instanceName) >= 0) {
    return { refusal: `${site.nodeId} already carries an attachment named ${instanceName}.` };
  }
  return {
    file: site.sourceFile,
    container: [SPEC_KEY, COMPONENTS_KEY, site.nodeId, ATTACHMENT_KEY],
    instanceName,
  };
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

  const missing = insertion.missingContainerKeys;
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

// attachmentSites reads what the drawn graph knows about every node's
// authoring, so a later request addresses a document the compiler named.
//
// It is read from the compiled graph on the side that holds it, and the view is
// never asked for any of it: a file path arriving back from the view would be a
// path the extension writes to on the view's word.
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
    const node = nodes[nodeId];
    const safe = isPlainObject(node) ? node : {};
    const bucket = (mapping as Record<string, unknown>)[nodeId];
    sites.set(nodeId, {
      nodeId,
      sourceFile: text(safe.source_file),
      authoredAtTopLevel: safe.synthesized_subsystem === true,
      attached: isPlainObject(bucket) ? Object.keys(bucket) : [],
    });
  }
  return sites;
}
