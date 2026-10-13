// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';
import { CancellationSignal } from './cancellation';
import { OperationOutcome, outcomeOf } from './operation-outcome';
import { withSubject } from './operation-groups';

// This module is the whole of what importing a foreign source means on this side:
// what the request carries, what the answer carries, the lines the reader reads on
// the channel, and the sentence the operation ends in. It holds no editor type, so
// every one of those is read back by a test exactly as an author would meet it.
//
// The compiler owns the work. Nothing here decides what an import does, nothing
// here reads the source, and nothing here re-words what the compiler says about
// it: every diagnostic reaches the channel with the importer's own text, every
// mapping decision with the importer's own values, the closing sentence is
// composed from the answer's own fields, and a refusal travels through the
// extension's one rendering home with the compiler's text intact.
//
// 🔴 THIS ONE CAN BE STOPPED, AND THAT IS READ OFF THE COMPILER RATHER THAN
// ASSUMED. A stop is offered exactly where the compiler can honour one. Here it
// can: the request's own context reaches the importer, and the runtime that runs
// the importer is configured to unwind a module that is mid-run when that context
// is cancelled — so stopping this ends the conversion rather than only ending the
// wait for an answer. That is what separates it from the operations beside it,
// whose shared work takes no cancellation at all and which therefore offer no
// stop.
//
// 🔴 AND THE ONE PART A STOP DOES NOT REACH, STATED RATHER THAN GLOSSED: once the
// importer has returned, writing the drafted files is not interruptible, so a stop
// arriving in that window withholds the answer while the files it had already
// produced are on disk. That window is a few small local writes at the end of an
// operation whose length is resolving the importer, preparing it and running it
// over the source — which is the part the stop reaches. It is written down because
// a comment claiming a total stop would be the same defect as one claiming no stop
// is possible.

// IMPORT_SOURCE_PROMPT is what the reader is asked for.
//
// A path or a reference, because the value is passed through verbatim and the
// compiler accepts either — so narrowing the question here would narrow the
// operation to less than it performs.
export const IMPORT_SOURCE_PROMPT = 'Path or reference of the source to import';

// IMPORT_SOURCE_TITLE is the heading over that question.
export const IMPORT_SOURCE_TITLE = 'Aggrega: import source';

// IMPORT_SUBJECT is the operation in the reader's terms, used for the sentence
// every ending produces. One spelling, so a completion and a failure name the
// same thing.
export const IMPORT_SUBJECT = 'The import';

// IMPORT_OUTPUT_DIR is where the drafted files go.
//
// 🔴 IT IS THE WORKSPACE ROOT, SENT AS A RELATIVE VALUE, AND SENDING IT IS
// REQUIRED. The request surface names no destination of its own: it refuses a
// request that omits one rather than choosing on the caller's behalf, because the
// drafted paths are relative to that directory and drafts belonging to nowhere
// would be the alternative. So the destination is this surface's decision to
// state, and this is it.
//
// The value reproduces what the reader gets from the command line, which drafts
// into the directory it was run in. A relative destination is resolved against the
// root of the workspace the session was opened over rather than against whatever
// directory a process happens to sit in, so "." names that root and names it
// unambiguously.
//
// It is deliberately not absolute. A destination is written to, and a written path
// is confined to the workspace whatever the request sends — so an absolute value
// would be refused even when it named the very same directory. The source is the
// other case entirely: it is read, it is a file the reader chose, and it may name
// anywhere on the machine.
export const IMPORT_OUTPUT_DIR = '.';

// --- the request and answer shapes ---------------------------------------

// ImportParams is what this client sends to import a source.
//
// 🔴 IT CARRIES THE SOURCE AND THE DESTINATION, AND THE ABSENCE OF THE REST IS THE
// CONTRACT RATHER THAN AN OMISSION. The operation also accepts an explicit source
// format and a switch that returns the drafts as content instead of writing them.
// This client sends neither, so neither is declared here, because a declared field
// is a field a later call site will fill.
//
// Omitting the format takes the compiler's own default, which is the default a
// reader gets from a bare command line: the format is recognised from the source's
// own shape, and a shape the compiler does not recognise is refused in its own
// words naming what to send instead. A format named here would be this surface
// guessing at something it cannot read.
//
// Omitting the second is the more consequential choice: the drafts are written.
// The operation's product is a set of authoring files an author goes on editing,
// and asking for them as content would mean this surface deciding where they land
// — which is the decision the destination above already makes once.
export type ImportParams = Required<Pick<wire.ImportParams, 'source' | 'outputDir'>>;

// ImportedFile is one drafted file as the answer carries it: the path it is for,
// relative to the destination, and its content.
//
// The content is read by nothing here: the drafts are written by the compiler, so
// this surface reports the paths rather than placing the bytes.
export type ImportedFile = wire.ImportedFile;

// ImportDiagnostic is one importer diagnostic as the answer carries it.
//
// The code is present only where the importer assigned one, which is a fact about
// the diagnostic rather than a gap — so it is optional here and rendered only when
// it is there.
export type ImportDiagnostic = wire.ImportDiagnostic;

// ImportDecision is one of the importer's mapping decisions as the answer carries
// it: the source node, the catalog Components it weighed with their scores, what
// it chose, why, and how to swap the choice — each value the importer's own.
export type ImportDecision = wire.ImportDecision;

// ImportResult is the answer an import produces.
//
// It is the reason this operation ends in something a reader can check rather than
// in a status: the format names what the source was actually recognised as, the
// destination names where the drafts went, written names what reached disk, and
// the diagnostics carry the importer's own account of anything it could not
// convert.
//
// 🔴 halted IS WHAT A COMPLETION IS BRANCHED ON, AND IT IS NOT AN ERROR ON THE
// WIRE. An import that could not convert everything still drafts what it could and
// still answers, carrying the diagnostics that explain the rest — so the answer
// arrives normally and this side decides what to tell the reader. It is reported as
// an operation that did not complete, which is what the command line reports for
// the same import, and the diagnostics are on the channel where the reader can act
// on them.
export type ImportResult = wire.ImportResult;

// ImportRequestDeps is the one thing an import needs: a way to ask the compiler,
// carrying the reader's stop.
//
// It is declared this narrowly so the surface that owns the panel passes its own
// richer dependency set here unchanged, and so a test drives the whole decision
// with a fake answer and no transport at all.
export interface ImportRequestDeps {
  importSource(params: ImportParams, signal?: CancellationSignal): Promise<ImportResult>;
}

// ImportReport is what one import leaves behind: how it ended, and the lines the
// channel gets.
//
// The two travel together because they are one account of one run and the surface
// renders both. Composing them here rather than at the surface is what keeps every
// word an author reads in a module a test can read it back from.
export interface ImportReport {
  outcome: OperationOutcome;
  lines: readonly string[];
}

// --- composing the request -----------------------------------------------

// importRequest composes the import of one source into the workspace.
//
// The source is passed through verbatim: the compiler accepts a path or a
// reference and reads whichever the reader pointed at, so a translation here would
// be a second answer to what a source is.
//
// The blank guard is REACHED rather than restated. It is the extension's one home
// for refusing an operation with nothing to act on, and a second blank check
// written here would agree with it until the day one of the two was changed. It is
// a second guard rather than the only one — the prompt that asks for a source
// invokes nothing when it is dismissed — and it is the one that holds if a later
// binding is written more loosely.
export function importRequest(source: string): ImportParams {
  const [, checked] = withSubject('import', source, 'the source to import');
  return { source: checked, outputDir: IMPORT_OUTPUT_DIR };
}

// --- running it ----------------------------------------------------------

// runImport asks the compiler to draft authoring files from the source and reports
// how it ended.
//
// It returns the ending rather than announcing it, because the words a reader reads
// and the place they read them belong to the surface. What is decided here is
// whether the import completed, the lines the channel gets, and the sentence naming
// what was actually drafted, from what, and where.
//
// 🔴 IT TAKES A STOP, AND THAT IS THE POINT RATHER THAN A CONVENIENCE. The signal
// reaches the compiler as the cancellation of the request this call was sent as,
// and the compiler unwinds the importer it is running — so a reader who stops this
// stops the conversion. The operations beside it take none, for the opposite reason
// read off their own handlers.
export async function runImport(
  deps: ImportRequestDeps,
  source: string,
  signal?: CancellationSignal,
): Promise<ImportReport> {
  let result: ImportResult;
  try {
    result = await deps.importSource(importRequest(source), signal);
  } catch (err) {
    // Nothing reached the channel, because nothing was answered. The refusal's own
    // text is the whole of what the reader gets, and it travels unaltered.
    return { outcome: outcomeOf(err), lines: [] };
  }
  return { outcome: importOutcome(result), lines: importLines(result) };
}

// --- what the reader reads -----------------------------------------------

// importOpeningLine is what the channel says an import is about to do.
//
// It names the source the reader gave, which is the one fact the answer does not
// carry back and the one a reader scrolling this channel needs in order to tell one
// import from another. The leading blank line separates this run from the last, the
// way every operation that writes here does.
export function importOpeningLine(source: string): string {
  return `\nImport of ${source}.`;
}

// diagnosticLine renders one importer diagnostic for the channel.
//
// The importer's own severity and message, in the order and the wording the
// command line prints them in, so a reader who has seen one surface's account of an
// import recognises the other's. The code is ADDITIVE where the importer assigned
// one: it sits with the severity and leaves the message following it unaltered,
// which is the same shape the extension's failure rendering uses for a code the
// command line does not print.
export function diagnosticLine(diagnostic: ImportDiagnostic): string {
  const label = diagnostic.code
    ? `${diagnostic.severity} (${diagnostic.code})`
    : diagnostic.severity;
  return `  ${label}: ${diagnostic.message}`;
}

// writtenLine renders one drafted file's path for the channel, in the command
// line's own words for the same fact.
export function writtenLine(path: string): string {
  return `  wrote ${path}`;
}

// decisionLine renders one mapping decision for the channel, in the sentence the
// command line prints for it on its error stream:
//
//   mapped <node id> (<node type>) to <target> as a <mode>, <tier> at <score>
//
// Every value is the importer's own and none is re-worded: the node's identifier
// and type, the target it chose, how it emitted it, the tier of the choice, and
// the score of its top candidate — the highest among the candidates it weighed —
// written as the shortest decimal that reads back as the same number, so the line
// shows the digits the importer computed and no others. A decision the importer
// weighed no candidate for ends at its tier, because there is no score to show;
// one that records no choice reads "made no choice for <node id> (<node type>)".
//
// 🔴 A DELIBERATE SECOND COPY OF THE COMMAND LINE'S SENTENCE, ACROSS A LANGUAGE
// BOUNDARY, AND HELD TO IT RATHER THAN TRUSTED TO AGREE. The compiler composes the
// sentence in Go for its own surfaces and this side cannot call that, so the two
// are kept in step by a case manifest the compiler's tree owns, which both sides'
// specs read and both pin to one revision: the compiler's spec renders every case
// with its formatter and this side's spec renders every case with this one, each
// against the same written line.
export function decisionLine(decision: ImportDecision): string {
  const node = `${decision.sourceNode.id} (${decision.sourceNode.type})`;
  const chosen = decision.chosen;
  if (chosen === undefined) {
    return `  made no choice for ${node}`;
  }
  const line = `  mapped ${node} to ${chosen.target} as a ${chosen.mode}, ${chosen.tier}`;
  const candidates = decision.candidates ?? [];
  if (candidates.length === 0) {
    return line;
  }
  const top = Math.max(...candidates.map((c) => c.score));
  return `${line} at ${String(top)}`;
}

// importLines is everything one import puts on the channel, in order: what the
// importer objected to, then how it mapped each source node, then what reached
// disk.
//
// The diagnostics come first because they are what a reader acts on, and an import
// that objected to nothing contributes none — so a clean import's channel is the
// list of what it decided and drafted and nothing else. The decisions follow them,
// as they follow them on the command line's error stream, because they say where
// the import guessed: the Component each node was mapped to, and how sure the
// importer was. An importer that reports no decisions contributes no line.
//
// These findings carry no document position. The importer's subject is a foreign
// source file rather than a place in an authored document, so there is no span to
// navigate to and the channel is the only surface that can show them — which is
// the same reason a build's positionless advisories are written here.
export function importLines(result: ImportResult): readonly string[] {
  return [
    ...draftingDiagnostics(result).map(diagnosticLine),
    ...result.decisions.map(decisionLine),
    ...draftedPaths(result).map(writtenLine),
  ];
}

// An empty collection reaches the wire as null rather than as an empty list, and
// the two say the same thing — so each is coalesced in one place here and read
// through that rather than defended against at every use.
function draftedPaths(result: ImportResult): readonly string[] {
  return result.written ?? [];
}

function draftingDiagnostics(result: ImportResult): readonly ImportDiagnostic[] {
  return result.diagnostics ?? [];
}

// importOutcome decides what the reader is told an import did.
//
// A halted import is reported as one that did not complete, which is what the
// command line reports for the same run: it exits non-zero when the importer
// raised a halt-severity diagnostic. Reporting it as done would tell a reader a
// source was converted when part of it was not.
export function importOutcome(result: ImportResult): OperationOutcome {
  if (result.halted) {
    return { kind: 'failed', message: haltedMessage(result) };
  }
  return { kind: 'ok', detail: importDetail(result) };
}

// fileCount renders a count of drafted files as a phrase, so the zero case is a
// sentence rather than an absence: an import that drafted nothing is a result, and
// leaving it unsaid makes it read exactly like an import that never ran.
function fileCount(count: number): string {
  if (count === 0) { return 'no files'; }
  if (count === 1) { return '1 file'; }
  return `${count} files`;
}

// problemCount renders a count of importer diagnostics as a phrase.
function problemCount(count: number): string {
  return count === 1 ? '1 problem' : `${count} problems`;
}

// importDetail is the sentence a completed import ends in.
//
// 🔴 EVERY FACT IN IT IS READ OFF THE ANSWER RATHER THAN OFF THE REQUEST. What was
// drafted, what the source was recognised as, and where the drafts went are all
// things the compiler measured; the source the reader typed is named on the opening
// line instead, because that one is the request and this sentence is the result.
//
// All three are strictly more than the command line's own account of the same
// import: that one lists the files it wrote and never names the format it
// recognised, so a reader whose source was read as something other than they
// expected learns it from the drafts rather than from the report.
//
// The destination is named only when something reached it. Naming a directory
// nothing was written to would answer a question the reader did not ask, and the
// count already says nothing arrived.
export function importDetail(result: ImportResult): string {
  const written = draftedPaths(result);
  const drafted = `drafted ${fileCount(written.length)}, recognised as ${result.format}`;
  if (written.length === 0) {
    return `${drafted}, and nothing was written.`;
  }
  return `${drafted}, in ${result.outputDir}.`;
}

// haltedMessage is what a reader is told when the importer could not convert all
// of the source.
//
// It points at the diagnostics rather than repeating them: they are already on the
// channel in the importer's own words, and the button a failure offers reaches
// them. What is said here is the part the diagnostics do not say — that the run was
// partial, and what was nonetheless written, because those files are on disk and a
// reader needs to know before they run it again.
export function haltedMessage(result: ImportResult): string {
  const written = draftedPaths(result);
  const problems = `${problemCount(draftingDiagnostics(result).length)} listed above`;
  if (written.length === 0) {
    return `the importer could not convert the source, recognised as ${result.format}`
      + ` — ${problems}. Nothing was written.`;
  }
  return `the importer could not convert all of the source, recognised as ${result.format}`
    + ` — ${problems}. The ${fileCount(written.length)} it could draft`
    + ` ${written.length === 1 ? 'was' : 'were'} written to ${result.outputDir}.`;
}
