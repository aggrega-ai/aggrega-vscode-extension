// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';
import { CancellationSignal } from './cancellation';
import { describeError, refusalCondition } from './error-text';
import * as l10n from './l10n';
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
// The questions and sentences this side words are translated; the compiler's
// words, and the lines that repeat the command line's own (the written-file,
// mapping-decision and drift lines), are not.
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
// A file or a folder, because the path chosen is passed through verbatim and the
// compiler reads either — a folder into the files of it the importer's declared
// file patterns select — so narrowing the question here would narrow the operation
// to less than it performs.
export const IMPORT_SOURCE_PROMPT = l10n.t('The file or the folder to import');

// IMPORT_SOURCE_TITLE is the heading over that question, and over the editor's open
// dialog that follows it.
export const IMPORT_SOURCE_TITLE = l10n.t('Aggrega: import source');

// SourceKind is which of the two the reader chose to import.
export type SourceKind = 'file' | 'folder';

// IMPORT_SOURCE_KINDS are the two choices the source question offers, in order.
//
// 🔴 TWO CHOICES, AND THE REASON IS THE EDITOR'S OWN DIALOG. On Windows and Linux
// one open dialog cannot select both a file and a folder — asked for both, it
// selects folders only — so asking which comes first is what lets the dialog that
// follows choose either on every platform. A typed path is not offered beside them:
// the source is a file or a folder on the machine the language server reads from,
// and the dialog names any of those.
export const IMPORT_SOURCE_KINDS: ReadonlyArray<{ label: string; kind: SourceKind }> = [
  { label: l10n.t('File…'), kind: 'file' },
  { label: l10n.t('Folder…'), kind: 'folder' },
];

// SourceDialog is the open dialog a chosen kind is asked through: one entry, of
// that kind only.
export interface SourceDialog {
  title: string;
  canSelectFiles: boolean;
  canSelectFolders: boolean;
  canSelectMany: false;
}

// sourceDialog is the open dialog for a kind.
export function sourceDialog(kind: SourceKind): SourceDialog {
  return {
    title: IMPORT_SOURCE_TITLE,
    canSelectFiles: kind === 'file',
    canSelectFolders: kind === 'folder',
    canSelectMany: false,
  };
}

// SourceAsks asks the two halves of the source question: which kind, and then the
// one entry of that kind. Each answers undefined where the reader dismissed it.
export interface SourceAsks {
  kind(): Promise<SourceKind | undefined>;
  open(dialog: SourceDialog): Promise<unknown>;
}

// chooseSource asks for the source: the kind, then the dialog for it, read back as
// the path the dialog answered with. A dismissed question, a dismissed dialog and a
// dialog answering with nothing on this machine's file system all end the import
// with nothing sent.
export async function chooseSource(asks: SourceAsks): Promise<string | undefined> {
  const kind = await asks.kind();
  if (kind === undefined) { return undefined; }
  const chosen = await asks.open(sourceDialog(kind));
  const picked = Array.isArray(chosen) ? chosen[0] : chosen;
  return clickedSource(picked) ?? undefined;
}

// IMPORT_OPTIONS_TITLE and IMPORT_OPTIONS are the question offering the two
// options that are on or off, each with the sentence saying what it does. Neither
// is chosen until the reader chooses it, so leaving both off writes the drafts
// whole, as `aggrega import` does with neither flag.
export const IMPORT_OPTIONS_TITLE = l10n.t('Aggrega: import options');
export const IMPORT_OPTIONS: ReadonlyArray<{ label: string; detail: string; option: keyof ImportSwitches }> = [
  { label: l10n.t('Preview'), detail: l10n.t('Show the drafts without writing them'), option: 'dryRun' },
  {
    label: l10n.t('Sync'),
    detail: l10n.t('Bring what an earlier import drafted up to date with the source'),
    option: 'sync',
  },
];

// switchesFrom reads the options question's answer: the labels the reader ticked,
// or undefined where they dismissed it.
export function switchesFrom(picked: readonly string[] | undefined): ImportSwitches | undefined {
  if (picked === undefined) { return undefined; }
  const on = (option: keyof ImportSwitches): boolean =>
    IMPORT_OPTIONS.some((o) => o.option === option && picked.includes(o.label));
  return { dryRun: on('dryRun'), sync: on('sync') };
}

// IMPORT_SUBJECT is the operation in the reader's terms, used for the sentence
// every ending produces. One spelling, so a completion and a failure name the
// same thing.
export const IMPORT_SUBJECT = l10n.t('The import');

// IMPORT_DESTINATION_TITLE and IMPORT_DESTINATION_PROMPT ask where the drafts go.
//
// 🔴 LEAVING IT EMPTY IS AN ANSWER, AND IT SENDS NO DESTINATION AT ALL. The
// operation drafts beneath the workspace root when it is named none, which is the
// default the command line has without --output-dir, so this side states no
// default of its own and sends nothing in its place. A folder named here is sent
// as written: the language server resolves it against the workspace root and
// refuses one that leads out of the workspace, because the destination is written
// to and a written path is held to the workspace whatever a request sends. The
// source is the other case entirely: it is read, it is a file or a directory the
// reader chose, and it may name anywhere on the machine.
export const IMPORT_DESTINATION_TITLE = l10n.t('Aggrega: import destination');
export const IMPORT_DESTINATION_PROMPT = l10n.t(
  'Folder inside the workspace to draft into, relative to its root. Leave it empty to draft beneath the workspace root',
);

// IMPORT_TARGET_TITLE and IMPORT_TARGET_PROMPT ask for the provider capability to
// draft a Manifest for.
//
// It is typed rather than chosen from a list, because nothing this side already
// holds lists the capabilities the workspace's Recipes bind to, and the target is
// matched against exactly those. A capability no Recipe binds to is refused by the
// compiler before anything runs, in words naming the ones that do. Leaving it empty
// sends no target: a plain import then drafts no Manifest, and a sync drafts for the
// target the earlier import was given, which the record beside the drafts names. It
// is asked after the sync choice whatever that answer was, so the prompt says both.
export const IMPORT_TARGET_TITLE = l10n.t('Aggrega: import target');
export const IMPORT_TARGET_PROMPT = l10n.t(
  'Provider capability to draft a Manifest for, such as compose or helm. Leave it empty to draft none, or, for a sync, to keep the target the earlier import was given',
);

// IMPORT_FORMAT_TITLE and IMPORT_FORMAT_PLACEHOLDER ask for the format, after the
// compiler refused to settle one from the source's shape. The question's prompt is
// the refusal itself, in the compiler's words, because those words name the formats
// a reader may send; the format is typed for the same reason the target is.
export const IMPORT_FORMAT_TITLE = l10n.t('Aggrega: import format');
export const IMPORT_FORMAT_PLACEHOLDER = l10n.t('The format to read the source as');

// IMPORT_RECORD_FILE is the record every import that drafts anything writes beside
// its drafts, which a later sync reads.
//
// 🔴 A DELIBERATE SECOND COPY OF A NAME THE COMPILER OWNS, ACROSS A LANGUAGE
// BOUNDARY. The published contract of the import request states it, and the
// answer carries the record among the files written, after the drafts, with this
// path, because it sits at the root of the destination. It is read here for one
// purpose: the record is not a draft, so the sentence counting what was drafted
// leaves it out, while the lines listing what reached disk still name it.
export const IMPORT_RECORD_FILE = '.aggrega-import.json';

// FORMAT_REMEDIED_REFUSALS are the conditions whose remedy is naming the format,
// read off the refusal's data and never off its message: a source the signatures
// of no format recognise, and one the signatures of more than one format do. Each
// is answered by asking for the format and sending the request again carrying it.
export const FORMAT_REMEDIED_REFUSALS: readonly string[] = ['unrecognised-import-format', 'ambiguous-import-format'];

// --- the request and answer shapes ---------------------------------------

// ImportParams is what this client sends to import a source.
//
// 🔴 THE SOURCE IS ALWAYS SENT, AND EVERY OTHER FIELD ONLY WHEN THE READER CHOSE
// IT. Each option is the command line's own, on the command line's terms: a
// destination (--output-dir), the format (--format), the target (--target), a
// preview (--dry-run), a sync (--sync) and the answers file (--answers). An option
// left unchosen is absent from the request rather than sent with a value standing
// for "none", so what the compiler does with it is its own default — the format
// recognised from the source's shape, the drafts beneath the workspace root, no
// Manifest, written whole, the answers file beside the source — exactly as for a
// command line naming none of them.
//
// answered is the one field the reader does not choose up front: it carries the
// reader's answers to values an earlier answer listed as still owed, and is sent
// only on the request that re-sends an import with them (answeredRequest).
export type ImportParams =
  Pick<wire.ImportParams, 'outputDir' | 'format' | 'target' | 'dryRun' | 'sync' | 'answers' | 'answered'>
  & { source: string };

// ImportOwed is one value the drafts still leave empty that no source can hold, as
// the answer lists it: the drafted file, relative to the destination, the keys
// leading to the value inside it, the compiler's own question for it, whether it
// is a secret's, and, for a secret, a sentence of the compiler's own (secretAdvice)
// saying what the answer must be — or, where an answer sent for it was refused,
// why it was refused. Either way that sentence is shown as written.
export type ImportOwed = wire.ImportOwed;

// ImportAnswered is one answer the reader gave to an owed value, as the request
// carries it: the drafted file and the keys the answer names the value by, exactly
// as the owed list named them, and the answer. The compiler judges each answer —
// a secret's included — keeps it in the answers file, and writes it into the
// drafts; nothing here decides whether an answer is acceptable.
export type ImportAnswered = wire.ImportAnswered;

// ImportChoices is what the reader answered: the source, and each option they
// chose. A text left blank and a switch left off are both unchosen.
export interface ImportChoices {
  source: string;
  outputDir?: string;
  format?: string;
  target?: string;
  dryRun?: boolean;
  sync?: boolean;
  answers?: string;
}

// ImportSwitches is the reader's answer to the two options that are on or off: a
// preview, which answers with the drafts without writing them, and a sync, which
// brings what an earlier import drafted up to date with the source. They compose,
// as on the command line: together they answer with what the sync would write.
export interface ImportSwitches {
  dryRun: boolean;
  sync: boolean;
}

// ImportQuestions asks the reader for each part of an import, in order. Each
// answers undefined where the reader dismissed the question, which ends the
// import with nothing sent; an empty text is an answer, choosing none.
//
// It is declared free of editor types so the order and what each answer sends are
// driven by a test with no editor at all.
export interface ImportQuestions {
  source(): Promise<string | undefined>;
  destination(): Promise<string | undefined>;
  switches(): Promise<ImportSwitches | undefined>;
  target(): Promise<string | undefined>;
}

// ImportedFile is one drafted file as the answer carries it: the path it is for,
// relative to the destination, and its content.
//
// The drafts are written by the compiler, so this surface never places the bytes.
// It shows them only for a preview, where nothing reaches disk and the content is
// the whole of what the reader asked to see.
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
//
// owed lists the values the drafts still owe, in the drafts' order, and is read
// through owedValues, where an absent list reads as the empty one.
export type ImportResult = wire.ImportResult;

// ImportRequestDeps is what an import needs: a way to ask the compiler, carrying
// the reader's stop, and a way to ask the reader for the format where the
// compiler's refusal says naming one is the remedy.
//
// It is declared this narrowly so a test drives the whole decision with a fake
// answer and no transport at all. nameFormat answers undefined, or an empty text,
// where the reader names none; without it a refusal is reported as it arrived.
export interface ImportRequestDeps {
  importSource(params: ImportParams, signal?: CancellationSignal): Promise<ImportResult>;
  nameFormat?(refusal: string): Promise<string | undefined>;
}

// ImportReport is what one import leaves behind: how it ended, and the lines the
// channel gets.
//
// The two travel together because they are one account of one run and the surface
// renders both. Composing them here rather than at the surface is what keeps every
// word an author reads in a module a test can read it back from.
//
// sent is the request the compiler answered, exactly as it was last sent — a
// format the reader named after a refusal included — and owed is what that answer
// lists as still owed. Both are what answering those values needs: the answers are
// sent on that same request (answeredRequest). A run the compiler did not answer
// carries no request and owes nothing.
export interface ImportReport {
  outcome: OperationOutcome;
  lines: readonly string[];
  sent?: ImportParams;
  owed: readonly ImportOwed[];
}

// --- composing the request -----------------------------------------------

// importRequest composes the import of one source into the workspace, carrying
// each option the reader chose and no other.
//
// The source and every named text are passed through as written, trimmed: the
// compiler reads the file or the directory the reader pointed at, resolves the
// destination, and settles the format and the target, so a translation here would
// be a second answer to any of them. A text left blank is unchosen rather than an
// empty value, and a switch is sent only when it is on.
//
// The blank guard on the source is REACHED rather than restated. It is the
// extension's one home for refusing an operation with nothing to act on, and a
// second blank check written here would agree with it until the day one of the two
// was changed. It is a second guard rather than the only one — the question that
// asks for a source invokes nothing when it is dismissed — and it is the one that
// holds if a later binding is written more loosely.
export function importRequest(choices: ImportChoices): ImportParams {
  const [, source] = withSubject('import', choices.source, l10n.t('the source to import'));
  const params: ImportParams = { source };
  const outputDir = chosenText(choices.outputDir);
  if (outputDir !== undefined) { params.outputDir = outputDir; }
  const format = chosenText(choices.format);
  if (format !== undefined) { params.format = format; }
  const target = chosenText(choices.target);
  if (target !== undefined) { params.target = target; }
  if (choices.dryRun === true) { params.dryRun = true; }
  if (choices.sync === true) { params.sync = true; }
  const answers = chosenText(choices.answers);
  if (answers !== undefined) { params.answers = answers; }
  return params;
}

// chosenText reads one typed option: its trimmed text, or undefined where the
// reader left it blank.
function chosenText(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? undefined : trimmed;
}

// clickedSource reads the source an invocation carried, or null where it carried
// none.
//
// The explorer runs the import command with the file or the folder it was opened
// on as the first argument, so the source is the clicked path and is not asked for
// again. Every other invocation — the panel's button, the command palette —
// carries nothing a source can be read from, and the import asks for one. The
// argument is read by its shape rather than by the editor's type, so this module
// stays free of the editor. A location the editor names under the file scheme, or
// under the scheme it gives a remote window's files, carries the path on the file
// system the language server reads from; any other location — an unsaved
// document, a virtual file — names nothing the compiler could read.
export function clickedSource(arg: unknown): string | null {
  if (typeof arg !== 'object' || arg === null) { return null; }
  const { scheme, fsPath } = arg as { scheme?: unknown; fsPath?: unknown };
  if (!FILE_SYSTEM_SCHEMES.includes(scheme as string) || typeof fsPath !== 'string' || fsPath === '') {
    return null;
  }
  return fsPath;
}

const FILE_SYSTEM_SCHEMES: readonly string[] = ['file', 'vscode-remote'];

// askImport asks the reader for each part of an import and answers what they
// chose, or null where they dismissed a question.
//
// The order is the source, where to draft, whether to preview or sync, then the
// target. The format is not asked here: the compiler recognises it from the
// source's shape, and the reader is asked for it only where the compiler says it
// cannot (runImport). A source the invocation already carries is not asked for.
export async function askImport(
  questions: ImportQuestions,
  clicked: string | null,
): Promise<ImportChoices | null> {
  const source = clicked ?? await questions.source();
  if (source === undefined || source === '') { return null; }
  const outputDir = await questions.destination();
  if (outputDir === undefined) { return null; }
  const switches = await questions.switches();
  if (switches === undefined) { return null; }
  const target = await questions.target();
  if (target === undefined) { return null; }
  return { source, outputDir, target, dryRun: switches.dryRun, sync: switches.sync };
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
//
// 🔴 A REFUSAL WHOSE REMEDY IS NAMING THE FORMAT IS ANSWERED BY ONE MORE REQUEST,
// AND ONLY WHERE THE READER NAMES ONE. The condition is read off the refusal's data
// (FORMAT_REMEDIED_REFUSALS); the reader is shown the refusal in the compiler's
// words and asked for the format, and the same request is sent again carrying it,
// with every other choice as it was. A request that already named a format is
// never asked again, so a second refusal is the ending; a reader who names none
// gets the first refusal as the ending.
export async function runImport(
  deps: ImportRequestDeps,
  choices: ImportChoices,
  signal?: CancellationSignal,
): Promise<ImportReport> {
  let params: ImportParams;
  try {
    params = importRequest(choices);
  } catch (err) {
    return unansweredReport(err);
  }
  return sendImport(deps, params, signal, async (err) => {
    const named = remediesWithAFormat(err) && chosenText(choices.format) === undefined && deps.nameFormat
      ? chosenText(await deps.nameFormat(describeError(err)))
      : undefined;
    return named === undefined ? undefined : runImport(deps, { ...choices, format: named }, signal);
  });
}

// sendImport sends one import request and reports how it ended: the answer's
// ending, or the refusal's. It is the one place a request is sent and its answer
// composed into a report, for the first import and for every re-send with answers.
//
// remedy is offered a refusal first, and the report it answers is the ending in
// its place; where it answers undefined, or there is none, the refusal is.
async function sendImport(
  deps: Pick<ImportRequestDeps, 'importSource'>,
  params: ImportParams,
  signal?: CancellationSignal,
  remedy?: (err: unknown) => Promise<ImportReport | undefined>,
): Promise<ImportReport> {
  let result: ImportResult;
  try {
    result = await deps.importSource(params, signal);
  } catch (err) {
    return (remedy ? await remedy(err) : undefined) ?? unansweredReport(err);
  }
  return answeredReport(params, result);
}

// unansweredReport is the ending of a request the compiler did not answer. Nothing
// reached the channel, because nothing was answered: the refusal's own text is the
// whole of what the reader gets, it travels unaltered, and nothing is owed.
function unansweredReport(err: unknown): ImportReport {
  return { outcome: outcomeOf(err), lines: [], owed: [] };
}

// answeredReport is the ending of a request the compiler answered: how it ended,
// the lines the channel gets, the request as sent, and what it still owes.
function answeredReport(params: ImportParams, result: ImportResult): ImportReport {
  const preview = params.dryRun === true;
  return {
    outcome: importOutcome(result, preview),
    lines: importLines(result, preview),
    sent: params,
    owed: owedValues(result),
  };
}

// owedValues reads the values an answer lists as still owed, an absent list and a
// null one read as the empty list they stand for.
//
// 🔴 THE ABSENT LIST IS A REAL ANSWER, NOT A DEFENCE. The contract declares owed
// optional, and the compilers this extension declares itself compatible with
// include versions older than the owed list, whose answer carries no such field,
// so an import one of those answers lists nothing this side can ask for. Null is
// read the same way, as the answer's other lists are.
export function owedValues(result: ImportResult): readonly ImportOwed[] {
  return result.owed ?? [];
}

// --- the values the drafts still owe ---------------------------------------

// OwedQuestion is the input box one owed value is asked in: its title, its
// prompt, and whether what is typed is hidden.
export interface OwedQuestion {
  title: string;
  prompt: string;
  password: boolean;
}

// owedQuestion is the question for one owed value.
//
// The title is this side's own naming of the value: the drafted file, then the key
// path, written by the extension's one key rendering (keyPath). The prompt is the
// compiler's own question, verbatim; for a secret it is followed by the compiler's
// own sentence for that secret (secretAdvice), verbatim, and what is typed is
// hidden.
//
// 🔴 NO COMPILER SENTENCE IS WRITTEN HERE. The question and the secret's sentence
// both arrive on the answer, so this side places them and words neither; a secret
// whose answer carries no sentence is asked in its question alone rather than in
// words this side would supply.
export function owedQuestion(owed: ImportOwed): OwedQuestion {
  const advice = owed.sensitive ? chosenText(owed.secretAdvice) : undefined;
  return {
    title: `${owed.file} ${keyPath(owed.key)}`,
    prompt: advice === undefined ? owed.question : `${owed.question} ${advice}`,
    password: owed.sensitive,
  };
}

// OwedAsks asks the reader one owed value's question, answering what they typed,
// or undefined where they dismissed it. It is declared free of editor types so the
// asking is driven by a test with no editor at all.
export interface OwedAsks {
  ask(question: OwedQuestion): Promise<string | undefined>;
}

// askOwed asks for each owed value, in the answer's order, and answers what the
// reader gave, in the shape the request carries — or null where they dismissed a
// question.
//
// 🔴 A DISMISSED QUESTION ENDS THE ASKING AND KEEPS NOTHING. The answers typed
// before it are discarded with it, so a reader who stops part way leaves
// everything as it was rather than half-answered. A question left empty is the
// other case: it is an answer meaning "later", so that value is not sent and stays
// owed, in the answers file, while the questions go on. An answer is sent trimmed,
// as the command line reads one.
export async function askOwed(asks: OwedAsks, owed: readonly ImportOwed[]): Promise<ImportAnswered[] | null> {
  const answered: ImportAnswered[] = [];
  for (const value of owed) {
    const typed = await asks.ask(owedQuestion(value));
    if (typed === undefined) { return null; }
    const answer = chosenText(typed);
    if (answer !== undefined) {
      answered.push({ file: value.file, key: value.key, answer });
    }
  }
  return answered;
}

// answeredRequest is the request that sends the reader's answers: the request as
// it was last sent, carrying them, as a sync.
//
// 🔴 THE ANSWERS GO ON A SYNC. Only an import that was not a preview is answered
// (answerOwedValues), so its drafts are on disk, where a plain import over drafts
// already written is refused — bringing them up to date is what a sync is.
// Every other choice — the format named after a refusal among them — is sent as it
// was.
//
// Answers an earlier re-send carried travel again, with each new answer replacing
// one for the same value. The compiler applies an answer only to a value its
// drafts still leave empty, so one it already kept changes nothing.
export function answeredRequest(sent: ImportParams, answered: readonly ImportAnswered[]): ImportParams {
  const same = (a: ImportAnswered, b: ImportAnswered): boolean =>
    a.file === b.file && a.key.length === b.key.length && a.key.every((k, i) => k === b.key[i]);
  const earlier = (sent.answered ?? []).filter((a) => !answered.some((b) => same(a, b)));
  return { ...sent, answered: [...earlier, ...answered], sync: true };
}

// OwedAnsweringDeps is what answering an import's owed values needs from the
// surface: the offer, which answers whether the reader accepted it; the questions;
// a way to ask the compiler; the watch every import runs under, which shows the
// wait, carries the reader's stop and opens the import's lines on the channel; and
// a way to show a report, its lines and then its ending.
//
// It is declared free of editor types so every decision the answering makes —
// when it offers, when it stops, what it sends — is driven by a test with no
// editor at all, as the import's own questions are.
export interface OwedAnsweringDeps {
  offer(count: number): Promise<boolean>;
  asks: OwedAsks;
  importSource(params: ImportParams, signal?: CancellationSignal): Promise<ImportResult>;
  watched(work: (signal: CancellationSignal) => Promise<ImportReport>): Promise<ImportReport>;
  show(report: ImportReport): Promise<void>;
}

// answerOwedValues offers to answer what an import still owes and, round by round,
// sends the import again with the reader's answers.
//
// A round is offered only where the compiler answered a request that was not a
// preview and its answer lists owed values; the offer is made once per round,
// naming how many. Declining it, dismissing a question, and leaving every
// question empty each end the answering with nothing sent.
//
// 🔴 A PREVIEW IS OFFERED NOTHING. The compiler asks nobody under a preview and
// applies no answer sent with one, as the command line asks nothing under
// --dry-run, so an answer collected after a preview would change nothing; its
// lines on the channel still name each value still empty.
//
// Otherwise the answers go on the request that was last sent
// (answeredRequest), under the same watch the first import ran under, and the
// report is shown as the first one was. What that answer still owes — a refused
// answer among it — is offered again the same way, and the next round's answers
// go on the request this round sent, so the answers given before travel with them.
export async function answerOwedValues(deps: OwedAnsweringDeps, report: ImportReport): Promise<void> {
  let last = report;
  while (last.sent !== undefined && last.sent.dryRun !== true && last.owed.length > 0) {
    const sent = last.sent;
    if (!(await deps.offer(last.owed.length))) { return; }
    const answered = await askOwed(deps.asks, last.owed);
    if (answered === null || answered.length === 0) { return; }
    const params = answeredRequest(sent, answered);
    last = await deps.watched((signal) => sendImport(deps, params, signal));
    await deps.show(last);
  }
}

// IMPORT_OWED_ACTION is the one button the offer to answer owed values carries.
export const IMPORT_OWED_ACTION = l10n.t('Answer them');

// owedOffer is the sentence offering to answer the values an import still owes,
// naming how many. It is this side's own sentence rather than the compiler's: what
// each value is, the questions themselves say.
export function owedOffer(count: number): string {
  return count === 1
    ? l10n.t('Aggrega: the drafts still owe 1 value. Answer them here, or leave them for the answers file.')
    : l10n.t('Aggrega: the drafts still owe {0} values. Answer them here, or leave them for the answers file.', count);
}

// remediesWithAFormat says whether a refusal names a condition whose remedy is
// naming the format.
function remediesWithAFormat(err: unknown): boolean {
  const { code } = refusalCondition(err);
  return code !== undefined && FORMAT_REMEDIED_REFUSALS.includes(code);
}

// --- what the reader reads -----------------------------------------------

// importOpeningLine is what the channel says an import is about to do.
//
// It names the source the reader gave, which is the one fact the answer does not
// carry back and the one a reader scrolling this channel needs in order to tell one
// import from another. The leading blank line separates this run from the last, the
// way every operation that writes here does.
export function importOpeningLine(source: string): string {
  return `\n${l10n.t('Import of {0}.', source)}`;
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
// line's own words for the same fact — which is why it is not translated.
export function writtenLine(path: string): string {
  return `  wrote ${path}`;
}

// previewLines renders one file a preview answered with: the path it would be
// written to, then its content, each line of it indented beneath the path.
//
// A preview writes nothing, so its content is the whole of what the reader asked
// to see, and the channel is where an import's answer is shown. The trailing line
// ending a file's content closes its last line rather than opening an empty one.
export function previewLines(file: ImportedFile): readonly string[] {
  const content = file.content.endsWith('\n') ? file.content.slice(0, -1) : file.content;
  const body = content === '' ? [] : content.split('\n').map((line) => `    ${line}`);
  return [`  ${l10n.t('would write {0}:', file.path)}`, ...body];
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

// ImportDrift is one part a sync brought up to date, or under a preview would, as
// the answer carries it.
export type ImportDrift = wire.ImportDrift;

// driftLine renders one drifted part for the channel, in the sentence the command
// line prints for it:
//
//   <change> <file>                    for a whole drafted file
//   <change> <key path> in <file>      for a part inside a drafted Aggregate
//
// The key path is the keys joined by full stops, with a key holding a full stop,
// whitespace or a quotation mark, or an empty one, written quoted — so two
// different parts are never written alike.
//
// 🔴 A DELIBERATE SECOND COPY OF THE COMMAND LINE'S SENTENCE, ACROSS A LANGUAGE
// BOUNDARY, HELD TO IT BY A SHARED CASE MANIFEST rather than trusted to agree, as
// the decision line is: the compiler's tree owns the manifest, and both sides'
// specs render every case in it against the same written line. The quoting follows
// the compiler's for every character a key can hold in ASCII, named escapes and
// hexadecimal ones alike; a character beyond ASCII is written as it is.
export function driftLine(drift: ImportDrift): string {
  const key = drift.key ?? [];
  if (key.length === 0) {
    return `  ${drift.change} ${drift.file}`;
  }
  return `  ${drift.change} ${keyPath(key)} in ${drift.file}`;
}

// keyPath writes the keys leading to a part of a drafted document as one path:
// the keys joined by full stops, each quoted where the compiler quotes it. It is
// the extension's one rendering of a key path, so a drifted part and an owed value
// at the same keys are written alike.
export function keyPath(key: readonly string[]): string {
  return key.map(keySegment).join('.');
}

// keySegment writes one key of a key path: as it is, or quoted where it is empty
// or holds a full stop, whitespace or a quotation mark.
function keySegment(key: string): string {
  return key === '' || /[. \t\n\r"']/.test(key) ? quoted(key) : key;
}

// quoted writes a key between double quotation marks, escaping as the compiler's
// quoting does: a backslash and a quotation mark behind a backslash, the named
// control characters by name, every other ASCII control character in hexadecimal.
function quoted(key: string): string {
  let out = '"';
  for (const ch of key) {
    const code = ch.codePointAt(0) ?? 0;
    const named = NAMED_ESCAPES[ch];
    if (named !== undefined) {
      out += named;
    } else if (code < 0x20 || code === 0x7f) {
      out += `\\x${code.toString(16).padStart(2, '0')}`;
    } else {
      out += ch;
    }
  }
  return `${out}"`;
}

const NAMED_ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\\\', '"': '\\"', '\x07': '\\a', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\v': '\\v',
};

// importLines is everything one import puts on the channel, in order: what the
// importer objected to, then how it mapped each source node, then what reached
// disk — or, for a preview, each file it would write and its content.
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
//
// A sync's drift follows the decisions, one line per part brought up to date — or,
// for a preview, one the sync would bring — as the command line prints them under
// --sync after the decisions. An import that is not a sync carries none.
export function importLines(result: ImportResult, preview = false): readonly string[] {
  return [
    ...draftingDiagnostics(result).map(diagnosticLine),
    ...result.decisions.map(decisionLine),
    ...(result.drift ?? []).map(driftLine),
    ...(preview
      ? answeredFiles(result).flatMap(previewLines)
      : writtenPaths(result).map(writtenLine)),
  ];
}

// An empty collection reaches the wire as null rather than as an empty list, and
// the two say the same thing — so each is coalesced in one place here and read
// through that rather than defended against at every use.
function writtenPaths(result: ImportResult): readonly string[] {
  return result.written ?? [];
}

function answeredFiles(result: ImportResult): readonly ImportedFile[] {
  return result.files ?? [];
}

// draftCount counts the drafts among the paths an answer names: every one but the
// record of what the import wrote, which sits beside them and is not one of them.
function draftCount(paths: readonly string[]): number {
  return paths.filter((p) => p !== IMPORT_RECORD_FILE).length;
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
//
// preview says the request asked for the drafts as content rather than written,
// which the answer alone cannot say: a preview and a write that wrote nothing
// both answer with nothing written.
export function importOutcome(result: ImportResult, preview = false): OperationOutcome {
  if (result.halted) {
    return { kind: 'failed', message: haltedMessage(result) };
  }
  return { kind: 'ok', detail: importDetail(result, preview) };
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
// The destination is named only when something reached it, or for a preview, where
// it says where the drafts would go. Naming a directory nothing was written to
// would otherwise answer a question the reader did not ask, and the count already
// says nothing arrived.
//
// 🔴 THE COUNT IS OF DRAFTS, AND THE RECORD OF WHAT THE IMPORT WROTE IS NOT ONE.
// Every import that drafts anything writes that record beside its drafts, and the
// answer names it among the files, so counting every path would report one draft
// more than the import made. The lines above still name it, because it did reach
// disk.
//
// 🔴 THE COUNT IS A SENTENCE OF ITS OWN FOR NO FILES, ONE FILE AND SEVERAL, so the
// zero case is said rather than absent — an import that drafted nothing is a
// result, and leaving it unsaid makes it read exactly like an import that never
// ran — and so each count is worded whole in every language.
export function importDetail(result: ImportResult, preview = false): string {
  if (preview) {
    const count = draftCount(answeredFiles(result).map((f) => f.path));
    if (count === 0) {
      return l10n.t('previewed no files, recognised as {0}, for {1}, and nothing was written.', result.format, result.outputDir);
    }
    if (count === 1) {
      return l10n.t('previewed 1 file, recognised as {0}, for {1}, and nothing was written.', result.format, result.outputDir);
    }
    return l10n.t('previewed {0} files, recognised as {1}, for {2}, and nothing was written.', count, result.format, result.outputDir);
  }
  const written = writtenPaths(result);
  if (written.length === 0) {
    // Nothing written is no draft written, so the count is the zero case.
    return l10n.t('drafted no files, recognised as {0}, and nothing was written.', result.format);
  }
  const count = draftCount(written);
  if (count === 0) {
    return l10n.t('drafted no files, recognised as {0}, in {1}.', result.format, result.outputDir);
  }
  if (count === 1) {
    return l10n.t('drafted 1 file, recognised as {0}, in {1}.', result.format, result.outputDir);
  }
  return l10n.t('drafted {0} files, recognised as {1}, in {2}.', count, result.format, result.outputDir);
}

// haltedMessage is what a reader is told when the importer could not convert all
// of the source.
//
// It points at the diagnostics rather than repeating them: they are already on the
// channel in the importer's own words, and the button a failure offers reaches
// them. What is said here is the part the diagnostics do not say — that the run was
// partial, and what was nonetheless written, because those files are on disk and a
// reader needs to know before they run it again.
//
// It is two sentences, each worded whole for the count it carries: what could not
// be converted, and what was nonetheless written.
export function haltedMessage(result: ImportResult): string {
  const written = writtenPaths(result);
  const problems = draftingDiagnostics(result).length;
  if (written.length === 0) {
    const notConverted = problems === 1
      ? l10n.t('the importer could not convert the source, recognised as {0} — 1 problem listed above.', result.format)
      : l10n.t('the importer could not convert the source, recognised as {0} — {1} problems listed above.', result.format, problems);
    return `${notConverted} ${l10n.t('Nothing was written.')}`;
  }
  const notConverted = problems === 1
    ? l10n.t('the importer could not convert all of the source, recognised as {0} — 1 problem listed above.', result.format)
    : l10n.t('the importer could not convert all of the source, recognised as {0} — {1} problems listed above.', result.format, problems);
  const drafts = draftCount(written);
  const drafted = drafts === 0
    ? l10n.t('The no files it could draft were written to {0}.', result.outputDir)
    : drafts === 1
      ? l10n.t('The 1 file it could draft was written to {0}.', result.outputDir)
      : l10n.t('The {0} files it could draft were written to {1}.', drafts, result.outputDir);
  return `${notConverted} ${drafted}`;
}
