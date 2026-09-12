// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'node:path';

import { CancellationSignal } from './cancellation';
import { ConvertedShape, shapeForDaemonDiagnostic } from './diagnostics-shape';
import { withSubject } from './operation-groups';
import { outcomeOf, terminalLine } from './operation-outcome';
import { DaemonDiagnostic } from './types';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from './workspace';

// --- wire shapes (mirror the aggrega/lint answer) -------------------------

// LintFileFindings is one document's publishing-conventions findings, as the
// answer groups them.
//
// The file is carried beside the entries rather than on each one, because a
// diagnostic locates a position inside a document and says nothing about which
// document. It is spelled relative to the workspace root for a document inside
// it and absolutely for one outside — a catalog directory need not sit under the
// root — so a consumer resolves it against the root rather than using it as a
// path directly.
export interface LintFileFindings {
  file: string;
  diagnostics?: DaemonDiagnostic[];
}

// LintAnswer is what the compiler answers a publishing-conventions request
// with.
//
// Every field is optional here, and that is the same posture the daemon
// diagnostic shape takes: the extension mirrors a wire it does not control, and
// a consumer that reads a count it did not receive reports a number it invented.
// So an absent count omits its clause rather than defaulting to zero.
//
// checked is how many entity documents the run covered, which is what makes a
// clean answer readable as a corpus rather than only as an empty list: no
// findings over forty entities and no findings over none are different answers.
//
// The per-severity counts and the total are the run's own, derived by the
// compiler from the findings it produced. They are read rather than recounted
// here: a second derivation at this boundary would agree with the compiler's
// until one of the two was edited.
//
// halted says whether the run's own verdict refuses publication. It is false for
// every advisory run, which is what a whole-catalog check always is.
export interface LintAnswer {
  entity?: string;
  release?: string;
  checked?: number;
  findings?: number;
  errors?: number;
  warnings?: number;
  infos?: number;
  files?: LintFileFindings[];
  halted?: boolean;
}

// --- the subject one run is about -----------------------------------------

// LintSubject is what one run was asked about: every catalog entity the
// workspace configures, or one named entity.
//
// It is a union rather than a path that may be absent, because the two arms mean
// opposite things about what a published answer replaces — everything on screen,
// or one document. An absent optional path would have to stand for one of them,
// and the two readings are one keystroke apart and silently opposite: the wrong
// one erases every other document's findings with nothing saying why. A union is
// what makes the whole-catalog arm something a caller names rather than something
// it reaches by passing nothing.
export type LintSubject =
  | { readonly kind: 'catalog' }
  | { readonly kind: 'entity'; readonly entityPath: string };

// CATALOG_WIDE is the whole-catalog subject. It is a value rather than a
// constructor because it carries nothing to compose.
export const CATALOG_WIDE: LintSubject = { kind: 'catalog' };

// entityLintSubject names one entity, by the workspace-relative path the row
// carries — the spelling the compiler resolves every document parameter in.
//
// The blank refusal is REACHED rather than restated: withSubject is the one home
// for refusing an operation with nothing to act on, and a second blank check
// written here would agree with it until one of the two was changed. It matters
// on this operation in particular, because the pathless form of the check
// addresses the whole catalog — so a subject dropped on the way would not fail,
// it would silently ask the wider question.
export function entityLintSubject(entityPath: string): LintSubject {
  const [, checked] = withSubject('lint', entityPath, 'the path of the entity to check');
  return { kind: 'entity', entityPath: checked };
}

// lintRequestParams composes the request one subject asks for. The whole-catalog
// subject names nothing, which is how the request asks for every entity the
// configured catalog directories hold.
//
// 🔴 THE PRE-PUBLICATION COMPARISON IS NEVER ASKED FOR, AND THAT IS WHAT KEEPS A
// FINDING FROM BECOMING A FAILURE. It is the only mode whose verdict can refuse,
// and it is the only one that reaches a registry. Every run this surface asks for
// is advisory, so an answer carrying findings is a success and a failure means
// the check could not run at all.
export function lintRequestParams(subject: LintSubject): { entity?: string } {
  return subject.kind === 'entity' ? { entity: subject.entityPath } : {};
}

// --- conversion -----------------------------------------------------------

// absolutePathFor resolves the document one group of findings concerns.
//
// The answer spells a contained document relative to the workspace root and one
// outside it absolutely, so resolution against the root covers both: an already
// absolute path resolves to itself. This is the single place the two spellings
// are reconciled, so nothing downstream has to know which of them it holds.
function absolutePathFor(workspaceRoot: string, file: string): string {
  return path.resolve(workspaceRoot, file);
}

// findingsByFile groups the answer's findings by the absolute path of the
// document each concerns, preserving the compiler's own order within a group so
// a second run over unchanged content produces the same reading order.
//
// Each entry converts through the extension's one home for a compiler
// diagnostic, so a conventions finding and a validation result reach the
// Problems panel by the same position, severity and code rules. The source
// stays whatever the compiler stamped, which is what keeps the Problems panel's
// grouping a property of the answer rather than of this module.
//
// A group naming no document names no entity to navigate to, so it is left out;
// countUnlocatable reports how many entries were dropped, and the caller
// surfaces them in the log rather than discarding them silently.
export function findingsByFile(
  answer: LintAnswer,
  workspaceRoot: string,
): Map<string, ConvertedShape[]> {
  const byFile = new Map<string, ConvertedShape[]>();
  for (const group of answer.files ?? []) {
    if (!group.file) { continue; }
    const shapes = (group.diagnostics ?? []).map(shapeForDaemonDiagnostic);
    if (shapes.length === 0) { continue; }
    const file = absolutePathFor(workspaceRoot, group.file);
    const existing = byFile.get(file);
    if (existing) {
      existing.push(...shapes);
    } else {
      byFile.set(file, shapes);
    }
  }
  return byFile;
}

// countUnlocatable reports how many findings named no document. Such a finding
// cannot be published against any file, so the count is what keeps it from
// vanishing without trace.
export function countUnlocatable(answer: LintAnswer): number {
  let n = 0;
  for (const group of answer.files ?? []) {
    if (group.file) { continue; }
    n += (group.diagnostics ?? []).length;
  }
  return n;
}

// unlocatableNote explains, in one sentence, why the run's own count can exceed
// what the Problems panel shows.
//
// It has one home because it reaches two surfaces — the log and the reader's
// notification — and a reader meeting the same fact worded two ways has to work
// out whether they are the same fact. The count behind it is countUnlocatable's,
// never a second walk.
//
// It names the channel rather than "this log", because the surface a reader most
// often meets it on is the notification, where "this" points at nothing.
export function unlocatableNote(answer: LintAnswer): string {
  const dropped = countUnlocatable(answer);
  if (dropped === 0) {
    return '';
  }
  return `${dropped} finding(s) named no entity file, so they appear only in the Aggrega output channel.`;
}

// --- what one answer does to the published set ----------------------------

// LintPublication is what one answer does to the conventions findings already on
// screen: what to drop, and then what to set.
//
// 🔴 THE TWO SETS ARE DIFFERENT, AND CONFLATING THEM REINTRODUCES THE SAME DEFECT
// FROM EITHER SIDE. Dropping only what the answer carries leaves a finding the
// author has since fixed standing forever, because a document that is now clean
// appears in no answer. Dropping everything on a run about one entity erases
// every other document's findings, and that costs a reader a result they were
// reading with nothing saying why.
//
// clearAll is a member of its own rather than a clear list that happens to name
// every document, because the whole-catalog arm cannot enumerate what it
// replaces: it replaces whatever is there, entries for documents this answer
// never mentions included.
export interface LintPublication {
  clearAll: boolean;
  // clear names the documents to drop, by absolute path, when clearAll is false.
  clear: readonly string[];
  // set is the answer's own findings, keyed by absolute path.
  set: Map<string, ConvertedShape[]>;
}

// lintPublication decides what one answer replaces, from the subject the request
// named and the documents the answer carries.
//
// A whole-catalog run replaces everything: its subject is every document, so
// there is nothing it could leave standing.
//
// A run about one entity clears the UNION of that entity and every document the
// answer names. The union rather than the subject alone, because findings are
// grouped by their own location: an answer about one entity may name another
// document, and a group arriving with nothing in it says that document is now
// clean — which only a drop expresses, since setting nothing leaves the previous
// run's entries where they were.
export function lintPublication(
  subject: LintSubject,
  answer: LintAnswer,
  workspaceRoot: string,
): LintPublication {
  const set = findingsByFile(answer, workspaceRoot);
  if (subject.kind === 'catalog') {
    return { clearAll: true, clear: [], set };
  }
  const clear = new Set<string>([absolutePathFor(workspaceRoot, subject.entityPath)]);
  for (const group of answer.files ?? []) {
    if (group.file) {
      clear.add(absolutePathFor(workspaceRoot, group.file));
    }
  }
  return { clearAll: false, clear: [...clear], set };
}

// LintCollection is the slice of a diagnostic collection a publication drives:
// dropping everything, dropping one document, and setting one document's
// entries.
//
// Declaring it this narrowly is what makes a publication applicable without an
// editor runtime, so a test drives a recorder and reads back exactly the entries
// an author would have seen in the Problems panel.
export interface LintCollection {
  clearAll(): void;
  clearFile(file: string): void;
  setFile(file: string, shapes: ConvertedShape[]): void;
}

// applyLintPublication carries one publication onto a collection: the drops
// first, then the sets.
//
// It decides nothing. Every choice was made where the publication was composed,
// which is what keeps the decision assertable apart from whichever collection it
// ends up applied to.
export function applyLintPublication(
  into: LintCollection,
  publication: LintPublication,
): void {
  if (publication.clearAll) {
    into.clearAll();
  } else {
    for (const file of publication.clear) {
      into.clearFile(file);
    }
  }
  for (const [file, shapes] of publication.set) {
    into.setFile(file, shapes);
  }
}

// reportLines renders the run's findings in the compiler's own report format:
// the document, then one line per finding carrying its severity, the rule that
// produced it, and the rule's own text.
//
// It is composed from the answer's values rather than from a rendering the
// compiler wrote, because the request surface answers with the facts and leaves
// the human formatting to whichever surface a reader is looking at. Every value
// in it is the compiler's own and none is re-worded — in particular the message
// is carried through byte for byte, so the remediation the rule named is never
// replaced by a friendlier sentence.
//
// The document is named by its absolute path, which is the path a reader can
// open and the one the rules' own message text already quotes.
//
// A finding whose producer assigned no rule identity is rendered without one
// rather than with an empty identifier, since an empty name states nothing.
export function reportLines(answer: LintAnswer, workspaceRoot: string): string[] {
  const lines: string[] = [];
  for (const group of answer.files ?? []) {
    const diagnostics = group.diagnostics ?? [];
    if (diagnostics.length === 0) { continue; }
    lines.push(`${group.file ? absolutePathFor(workspaceRoot, group.file) : '(no entity file)'}:`);
    for (const d of diagnostics) {
      lines.push(d.code ? `[${d.severity}] ${d.code}: ${d.message}` : `[${d.severity}] ${d.message}`);
    }
  }
  return lines;
}

// summaryLine renders the run's outcome for the reader, from the compiler's own
// counts and the subject the answer says it was about.
//
// 🔴 THE SUBJECT CLAUSE IS DECIDED BY WHETHER THE ANSWER CARRIES AN ENTITY, NEVER
// BY THE CORPUS SIZE. A whole-catalog run over a one-entity catalog reports the
// same count as a run about that one entity, so a count cannot tell the two
// apart — and a reader who pressed a row needs to know which entity was checked,
// which is the one fact a count with no subject cannot give them.
//
// The entity is named by its absolute path, the same spelling the report lines
// beside it use, so the notification and the log name one document one way.
//
// Every clause is omitted when what stands behind it is absent, rather than
// showing a zero the compiler never sent — a run that reported no corpus size and
// a run that checked nothing are different answers.
//
// The finding count is the run's own total, which includes any finding that named
// no document. Those are explained by the note rather than subtracted here: the
// count belongs to the compiler, and recounting it at this boundary would be a
// second derivation that agrees with the first until one of them is edited.
export function summaryLine(answer: LintAnswer, workspaceRoot: string): string {
  const checked = answer.checked;
  const scope = answer.entity
    ? ` in ${absolutePathFor(workspaceRoot, answer.entity)}`
    : (typeof checked === 'number' ? ` across ${checked} entities checked` : '');
  const note = unlocatableNote(answer);
  const trailer = note === '' ? '' : ` ${note}`;
  const found = answer.findings;
  if (typeof found !== 'number') {
    return `Aggrega lint: run complete${scope}.${trailer}`;
  }
  if (found === 0) {
    return `Aggrega lint: no findings${scope}.${trailer}`;
  }
  return `Aggrega lint: ${found} finding(s)${scope} — see the Problems panel.${trailer}`;
}

// --- the run ---------------------------------------------------------------

// LintSink is the slice of a diagnostic collection the run writes into.
// Injecting it (rather than reaching for the editor runtime) is what makes the
// run's outcome directly assertable: a test passes a recorder and reads back
// exactly the findings an author would have seen in the Problems panel.
export interface LintSink {
  // replace carries one publication onto the collection: the entries the run's
  // subject and answer between them supersede are dropped, then the answer's own
  // are set.
  replace(publication: LintPublication): void;
}

// LintLog is the reader-visible log the run appends to — the compiler's own
// findings, in the compiler's own report format.
export interface LintLog {
  appendLine(text: string): void;
  show(): void;
}

// LintRunDeps supplies the run's surfaces: the anchored root that decides
// whether the check can be asked for at all and the paths in the answer are
// resolved against, the request itself, the collection findings land in, the
// log, and the reader notification.
export interface LintRunDeps {
  getWorkspaceRoot(): string | null;
  // lint asks the compiler for the publishing-conventions findings over the
  // subject given, and rejects with the compiler's own message when the check
  // could not run.
  //
  // The signal is how a reader stops it, and the stop reaches the work rather
  // than only this side's wait: the request's own context is what the walk and
  // the per-entity rule dispatch observe, so stopping abandons work that has not
  // started instead of leaving the compiler running with nobody waiting.
  lint(subject: LintSubject, signal?: CancellationSignal): Promise<LintAnswer>;
  sink: LintSink;
  log: LintLog;
  // notify surfaces one short status to the reader. The 'error' tier carries
  // the compiler's own message, so nothing re-words a failure.
  notify(message: string, tier: 'info' | 'error'): void;
}

// LINT_SUBJECT is the check in the reader's terms, used for the sentence a
// stopped run leaves behind. One spelling, so every ending names the same thing.
export const LINT_SUBJECT = 'The lint';

// runLint asks for the publishing-conventions findings over one subject and
// publishes them as navigable diagnostics.
//
// The subject is a parameter rather than a default, because it decides what the
// publish REPLACES as well as what is asked for, and the arm that replaces
// everything must be named rather than reached by omission.
//
// Two properties of the answer shape this run: findings are advisory, so an
// answer carrying them is a success and not a failure; and a check that could
// not run at all rejects with the compiler's own message, which is what the
// failure branch surfaces.
//
// A run that could not execute leaves the previous run's findings in place. It
// learned nothing, so clearing them would destroy a result the author has not
// yet acted on; the failure is surfaced instead.
//
// A run the reader stopped is reported as stopped rather than as a failure, and
// leaves the previous findings in place for the same reason a failed run does:
// it learned nothing, so there is nothing to replace them with.
export async function runLint(
  deps: LintRunDeps,
  subject: LintSubject,
  signal?: CancellationSignal,
): Promise<void> {
  const workspaceRoot = deps.getWorkspaceRoot();
  if (!workspaceRoot) {
    // The shared no-anchor message, so the reader learns the check was never
    // asked for rather than reading an empty result as a clean catalog — and
    // learns it in the same words every other surface uses.
    deps.notify(NO_ANCHORED_WORKSPACE_MESSAGE, 'info');
    return;
  }

  let answer: LintAnswer;
  try {
    answer = await deps.lint(subject, signal);
  } catch (err) {
    const outcome = outcomeOf(err);
    if (outcome.kind === 'cancelled') {
      const line = terminalLine(LINT_SUBJECT, outcome);
      deps.log.appendLine(line);
      deps.notify(line, 'info');
      return;
    }
    // The message is the compiler's own text. It is surfaced as-is: a re-worded
    // wrapper would hide the remediation the compiler already named.
    deps.log.appendLine(outcome.message);
    deps.log.show();
    deps.notify(outcome.message, 'error');
    return;
  }

  deps.sink.replace(lintPublication(subject, answer, workspaceRoot));

  for (const line of reportLines(answer, workspaceRoot)) {
    deps.log.appendLine(line);
  }

  const note = unlocatableNote(answer);
  if (note !== '') {
    // A finding naming no document cannot be published against any file, so it
    // is named rather than lost — on the channel, and again in the sentence the
    // reader is shown, because a run that succeeds does not open the channel and
    // the sentence is therefore the only surface they will look at.
    deps.log.appendLine(note);
  }

  deps.notify(summaryLine(answer, workspaceRoot), 'info');
}
