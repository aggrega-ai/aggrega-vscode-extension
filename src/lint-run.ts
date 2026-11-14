// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as path from 'node:path';

import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';
import { CancellationSignal } from './cancellation';
import { ConvertedShape, shapeForDaemonDiagnostic } from './diagnostics-shape';
import * as l10n from './l10n';
import { withSubject } from './operation-groups';
import { outcomeOf, terminalLine } from './operation-outcome';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from './workspace';

// --- the aggrega/lint answer, as the compiler publishes it ----------------

// LintFileFindings is one document's publishing-conventions findings, as the
// answer groups them.
//
// The file is carried beside the entries rather than on each one, because a
// diagnostic locates a position inside a document and says nothing about which
// document. It is spelled relative to the workspace root for a document inside
// it and absolutely for one outside — a catalog directory need not sit under the
// root — so a consumer resolves it against the root rather than using it as a
// path directly.
export type LintFileFindings = wire.LintFileFindings;

// LintAnswer is what the compiler answers a publishing-conventions request
// with.
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
//
// Every count is present on the published answer, so a clause composed from one
// reports the compiler's figure rather than an invented zero. The subject names
// — the entity and the Release — are the members that may genuinely be absent,
// and each arm of the subject union below says which of them it expects.
export type LintAnswer = wire.LintResult;

// LintPass is one pass of a whole-catalog check in a workspace whose Releases
// read catalog directories of their own: the Releases it ran for, the
// directories it read, and what it found there, counted and grouped as the
// answer around it counts and groups the whole run.
//
// Releases reading the same directories share one pass, so a pass names one
// Release or several. A pass naming no directory read nothing, and its counts
// say so.
export type LintPass = wire.LintPass;

// passesOf returns the answer's passes, or null for an answer that carries none.
//
// 🔴 THE PRESENCE OF THE PASSES SELECTS THE READING, NEVER HOW MANY THERE ARE. The
// compiler carries them exactly when the workspace's Releases read catalog
// directories of their own, so an answer with one pass — every Release reading
// the same directories — still says which Releases were checked, and reads per
// Release. An answer without them reads as every other whole-catalog answer
// does.
//
// Under the passes, everything a reader is shown is composed from them and
// nothing from the answer's top-level findings: those regroup every pass's
// findings by document, so a document two passes read carries each finding once
// per pass with nothing saying which, and reading both would show each twice.
function passesOf(answer: LintAnswer): readonly LintPass[] | null {
  return Array.isArray(answer.passes) && answer.passes.length > 0 ? answer.passes : null;
}

// releasesNamed names the Releases one pass ran for, as the command line's own
// heading for a pass names them. It is the heading's, so it is not translated;
// a sentence of this surface's own that names the Releases writes "Release" or
// "Releases" inside its own message instead, as releasesClause does.
function releasesNamed(releases: readonly string[] | null): string {
  const named = releases ?? [];
  return `${named.length === 1 ? 'Release' : 'Releases'} ${named.join(', ')}`;
}

// releasesClause is the phrase a sentence of this surface's own names one pass's
// Releases with — "for Release a.yaml", "for Releases a.yaml, b.yaml" — joined
// to what stands before it by a message of its own, so a translation places the
// Releases where its language puts them.
function releasesClause(before: string, releases: readonly string[] | null): string {
  const named = releases ?? [];
  return named.length === 1
    ? l10n.t('{0} for Release {1}', before, l10n.series(named))
    : l10n.t('{0} for Releases {1}', before, l10n.series(named));
}

// passHeading is the line a pass opens with: its Releases and the directories
// they read, or that they read none.
//
// 🔴 IT IS THE COMMAND LINE'S OWN HEADING FOR A PASS, WORD FOR WORD, AND THE COPY
// IS DELIBERATE. The compiler composes that line in one place so a terminal and
// a tool reading the same pass describe it alike; this surface cannot call it
// across the language boundary, so it states the same wording and a parity spec
// holds it to a line captured from the command line. The directories are spelled
// as the answer spells them, which is the spelling the command line prints.
// Being the command line's line, it is not translated.
function passHeading(pass: LintPass): string {
  const one = (pass.releases ?? []).length === 1;
  const subject = `${releasesNamed(pass.releases)} ${one ? 'reads' : 'read'}`;
  const dirs = pass.catalogDirs ?? [];
  if (dirs.length === 0) {
    return `${subject} no catalog directory, so there is nothing to check for ${one ? 'it' : 'them'}`;
  }
  return `${subject} ${dirs.join(', ')}`;
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
  const [, checked] = withSubject('lint', entityPath, l10n.t('the path of the entity to check'));
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
//
// Where the answer reports a pass per Release, each pass's findings are entered
// on their own and each entry names the Releases its pass ran for, after the
// rule's own text. A finding two passes reported is therefore two entries, one
// per pass: the panel then tells the story the passes and their counts tell,
// and merging would need a rule of this surface's own for when two findings are
// one, which the compiler does not make. The Releases follow the rule's text
// rather than replacing any of it, so the remediation the rule named is still
// read first and word for word.
export function findingsByFile(
  answer: LintAnswer,
  workspaceRoot: string,
): Map<string, ConvertedShape[]> {
  const byFile = new Map<string, ConvertedShape[]>();
  const passes = passesOf(answer);
  if (passes === null) {
    addFindings(byFile, answer.files ?? [], workspaceRoot, '');
  } else {
    for (const pass of passes) {
      const named = pass.releases ?? [];
      const foundFor = named.length === 1
        ? l10n.t('(found for Release {0})', l10n.series(named))
        : l10n.t('(found for Releases {0})', l10n.series(named));
      addFindings(byFile, pass.files ?? [], workspaceRoot, ` ${foundFor}`);
    }
  }
  return byFile;
}

// addFindings enters one list of document groups into byFile, appending suffix
// to each entry's message.
function addFindings(
  byFile: Map<string, ConvertedShape[]>,
  groups: readonly LintFileFindings[],
  workspaceRoot: string,
  suffix: string,
): void {
  for (const group of groups) {
    if (!group.file) { continue; }
    const shapes = (group.diagnostics ?? []).map((d) => {
      const shape = shapeForDaemonDiagnostic(d);
      return suffix === '' ? shape : { ...shape, message: `${shape.message}${suffix}` };
    });
    if (shapes.length === 0) { continue; }
    const file = absolutePathFor(workspaceRoot, group.file);
    const existing = byFile.get(file);
    if (existing) {
      existing.push(...shapes);
    } else {
      byFile.set(file, shapes);
    }
  }
}

// countUnlocatable reports how many findings named no document. Such a finding
// cannot be published against any file, so the count is what keeps it from
// vanishing without trace.
//
// Under per-Release passes it counts each pass's, so a finding two passes
// reported is counted twice, as it is reported twice.
export function countUnlocatable(answer: LintAnswer): number {
  const passes = passesOf(answer);
  const groups = passes === null ? (answer.files ?? []) : passes.flatMap((pass) => pass.files ?? []);
  let n = 0;
  for (const group of groups) {
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
  return l10n.t('{0} finding(s) named no entity file, so they appear only in the Aggrega output channel.', dropped);
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

// reportLines renders the run's findings for the output channel: the document,
// then one line per finding, which is the row the command line prints for the
// same finding (findingLine).
//
// It is composed from the answer's values rather than from a rendering the
// compiler wrote, because the request surface answers with the facts and leaves
// the human formatting to whichever surface a reader is looking at. Every value
// in it is the compiler's own and none is re-worded — in particular the message
// is carried through byte for byte, so the remediation the rule named is never
// replaced by a friendlier sentence.
//
// The document is named by its absolute path, which is the path a reader can
// open, the one the rules' own message text already quotes, and the one the
// command line names it by.
//
// Where the answer reports a pass per Release, each pass is opened by the line
// the command line opens it with, naming its Releases and the directories they
// read, and its own findings follow under it; passes are parted by an empty
// line, as the command line parts them. A pass that found nothing is still named,
// so a clean run says which Releases it covered.
export function reportLines(answer: LintAnswer, workspaceRoot: string): string[] {
  const passes = passesOf(answer);
  if (passes === null) {
    return documentLines(answer.files ?? [], workspaceRoot);
  }
  const lines: string[] = [];
  passes.forEach((pass, i) => {
    if (i > 0) { lines.push(''); }
    lines.push(passHeading(pass));
    lines.push(...documentLines(pass.files ?? [], workspaceRoot));
  });
  return lines;
}

// documentLines renders one list of document groups in the report format.
function documentLines(groups: readonly LintFileFindings[], workspaceRoot: string): string[] {
  const lines: string[] = [];
  for (const group of groups) {
    const diagnostics = group.diagnostics ?? [];
    if (diagnostics.length === 0) { continue; }
    lines.push(group.file ? `${absolutePathFor(workspaceRoot, group.file)}:` : l10n.t('(no entity file):'));
    for (const d of diagnostics) {
      lines.push(findingLine(d));
    }
  }
  return lines;
}

// findingLine is the row the command line prints for one finding: the command
// line's word for the finding's severity and a colon, then the short code of the
// condition the finding's rule names and the finding's identity, each where the
// answer carries one, then a colon closing them and the finding's own text. An
// identifier the answer does not carry is left out rather than stood in for, and
// so is the colon that would close it: a finding carrying neither reads as its
// tier's word, a colon and its text.
//
// The identity is the answer's `code`: the finding's rule, or, for a finding
// naming no rule, the code of its own it was reported under. The command line
// names a finding by that same identity in the same place, so the row and the
// answer name one finding alike whichever of the two it carries.
//
// 🔴 IT IS THE COMMAND LINE'S OWN ROW, AND THE COPY IS DELIBERATE. The command
// line composes the row in one place, which this surface cannot call across the
// language boundary, so the shape is stated again here and a parity spec holds
// it to rows captured from the command line for the same findings.
function findingLine(d: wire.Diagnostic): string {
  const identifiers = [d.shortCode, d.code].filter((id): id is string => typeof id === 'string' && id !== '');
  const named = identifiers.length > 0 ? `${identifiers.map((id) => ` ${id}`).join('')}:` : '';
  return `${commandLineSeverity(d.severity)}:${named} ${d.message}`;
}

// commandLineSeverity is the word the command line opens a finding's row with,
// for the tier the answer gives the finding. The two name the advisory tier
// differently — each in the vocabulary of its own wire — and the row is the
// command line's, so it carries the command line's word.
//
// A tier the command line has no row for is written as the answer spells it.
// The command line raises a halting finding rather than writing a row for it,
// and every run this surface asks for is advisory, so no answer it receives
// carries one; were one to arrive, it is written in the answer's own word rather
// than in a word the command line never prints for it.
function commandLineSeverity(tier: string): string {
  switch (tier) {
    case 'warning':
      return 'warn';
    case 'info':
      return 'info';
    default:
      return tier;
  }
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
//
// Where the answer reports a pass per Release, the sentence states each pass's
// own counts for the Releases it ran for, in the order the answer gives them,
// rather than one total: a total over several Releases cannot say which of them a
// finding was found for, and a document every pass read is counted once in each.
// A pass that read nothing is stated in the words its heading uses.
export function summaryLine(answer: LintAnswer, workspaceRoot: string): string {
  const note = unlocatableNote(answer);
  const trailer = note === '' ? '' : ` ${note}`;
  const passes = passesOf(answer);
  const clauses = passes === null
    ? [outcomeClause(answer, workspaceRoot)]
    : passes.map((pass) => ((pass.catalogDirs ?? []).length === 0
      ? passHeading(pass)
      : releasesClause(outcomeClause(pass, workspaceRoot), pass.releases)));
  const seeProblems = passes === null
    ? (typeof answer.findings === 'number' && answer.findings > 0)
    : passes.some((pass) => pass.findings > 0);
  const stated = clauses.join('; ');
  const sentence = seeProblems
    ? l10n.t('Aggrega lint: {0} — see the Problems panel.', stated)
    : l10n.t('Aggrega lint: {0}.', stated);
  return `${sentence}${trailer}`;
}

// outcomeClause states what one run, or one pass of it, found over what it
// covered: the finding count, and the entity it was about or how many entities it
// checked. It is the one wording of that clause, so a run checked once and a run
// checked once per Release state their counts alike.
//
// Each pairing of what was found with what was covered is a whole message, so a
// translation words the count and the scope together.
function outcomeClause(
  counts: { entity?: string; checked?: number; findings?: number },
  workspaceRoot: string,
): string {
  const checked = counts.checked;
  const found = counts.findings;
  if (counts.entity) {
    const entity = absolutePathFor(workspaceRoot, counts.entity);
    if (typeof found !== 'number') { return l10n.t('run complete in {0}', entity); }
    return found === 0 ? l10n.t('no findings in {0}', entity) : l10n.t('{0} finding(s) in {1}', found, entity);
  }
  if (typeof checked === 'number') {
    if (typeof found !== 'number') { return l10n.t('run complete across {0} entities checked', checked); }
    return found === 0
      ? l10n.t('no findings across {0} entities checked', checked)
      : l10n.t('{0} finding(s) across {1} entities checked', found, checked);
  }
  if (typeof found !== 'number') { return l10n.t('run complete'); }
  return found === 0 ? l10n.t('no findings') : l10n.t('{0} finding(s)', found);
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
// findings, in the compiler's own words.
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
export const LINT_SUBJECT = l10n.t('The lint');

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
