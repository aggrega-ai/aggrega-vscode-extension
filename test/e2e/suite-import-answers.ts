// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as fs from 'fs';
import * as path from 'path';

import {
  IMPORT_DESTINATION_TITLE, IMPORT_OPTIONS_TITLE, IMPORT_OWED_ACTION, IMPORT_SUBJECT, IMPORT_TARGET_TITLE, importOpeningLine, keyPath, owedOffer, owedQuestion,
} from '../../src/import-request';
import { need } from './checks';
import { IMPORT_ANSWERS_FILE, IMPORT_DIFY_SOURCE } from './fixtures';
import { importersAhead, Inputs } from './inputs';
import { OFFLINE_IN_THE_ENVIRONMENT } from './suite-configuration-report';
import { closeAllEditors, importClickedFile, ready, SuiteContext } from './suite-context';
import { dig, yamlOf } from './suite-graph-panel';
import { asTheEditorDraws, holds, pressToastButton, quickInput, Toast, toasts, toastsSince, waitQuickInput, waitToast } from './workbench';

// The checks run in a folder holding the documentation's Dify example source and
// nothing else but the workspace marker, an import of which leaves three values
// empty that the source cannot hold, one of them a secret's. The source is
// imported from the explorer's own entry, as a reader imports a file they clicked,
// every question answered as a reader answers it; the offer to answer what the
// import still owes is taken, each value is typed into the box it is asked in,
// and what the compiler kept and drafted is read back from disk.
//
// 🔴 THE IMPORTER COMES FROM A CATALOG FOLDER THE RUN IS GIVEN. The compiler
// carries each core importer's entity but not its module, which it fetches from a
// registry — the workspace's default one, at its release's version — or reads
// from beside the importer's Plugin entity in a catalog folder. A compiler built between releases has a version no registry holds, and
// the suite reaches no registry for it anyway, so the scenario runs offline and
// reads the importers from the folder --importer-catalog names, ahead of the
// standard-library catalog. Which importer an import runs is the compiler's to
// choose, so it is asked rather than predicted: before the scenario starts, the
// compiler under test imports a copy of the source once, offline, as a preview,
// with the catalogs the scenario reads, and the fixture is refused unless the Dify
// importer runs. A run given no such folder, or one holding no Dify importer, more
// than one version of it or one the compiler does not run, builds no fixture, and
// both checks report not run naming it.
//
// 🔴 WHAT THE EDITOR DOES FAILS A CHECK; ONLY WHAT THE RUN WAS GIVEN LEAVES ONE NOT
// RUN. The offer's words, its button, a box naming no owed value and the ending's
// place on the channel are the editor's own behaviour, so each is a failure, never
// a precondition: a precondition reports a broken editor as a check not run.

export const IMPORT_ANSWERS_SCENARIO = 'dify-import-answers';

// IMPORT_ANSWERS_FIXTURE is the folder fixture the scenario opens, and
// IMPORT_ANSWERS_IMPORTER the importer its import runs.
export const IMPORT_ANSWERS_FIXTURE = 'dify-owing-values';
export const IMPORT_ANSWERS_IMPORTER = 'dify';

export const IMPORT_ANSWERS_CHECKS = [
  'import.owed-values-answered-in-the-editor-are-kept-in-the-answers-file',
  'import.the-import-sent-with-the-answers-owes-nothing',
] as const;

// IMPORT_ANSWERS_TARGET is the provider capability the scenario's import drafts a
// Manifest for, and the one the importer's proof imports with.
export const IMPORT_ANSWERS_TARGET = 'helm';
const DRAFTED = 'release.yaml';

// STILL_EMPTY is what each of the compiler's findings about a value the drafts
// still owe carries, in the compiler's words, after the drafted file and the key
// path: "<file>: <key path> is still empty: <question>". It is only trusted where
// the first import's lines name each owed value once in that form.
export const STILL_EMPTY = ' is still empty: ';

// formatOpening is how the compiler opens the line naming the format it read an
// import's source as, in the compiler's words, up to the root the drafted paths
// are relative to: "read as the <format> format, with drafted paths relative to
// <root>". It is matched at the start of a line.
export function formatOpening(format: string): string {
  return `read as the ${format} format, `;
}

// OwedValue is one value the import of the source leaves empty: the keys leading
// to it in the drafted Release, as the import's answer names them, the answer the
// check gives it, and whether it is a secret's, whose answer names where the
// secret comes from.
interface OwedValue { key: string[]; answer: string; secret: boolean }

const OWED: readonly OwedValue[] = [
  { key: ['spec', 'parameters', 'secret_key'], answer: 'dify-credentials', secret: false },
  { key: ['spec', 'boundaries', 'platform', 'aggregates', 'dify', 'components', 'api', 'infra', 'owner_email'], answer: 'owner@example.com', secret: false },
  { key: ['spec', 'boundaries', 'platform', 'aggregates', 'dify', 'components', 'api', 'features', 'owner_password', 'infra', 'origin'], answer: 'dify-owner', secret: true },
];

// answersFileKey is the key path the answers file keeps an answer under, joined
// here by full stops on purpose rather than through the extension's key
// rendering: it is a cross-check of the compiler's own rendering of the file, and
// none of the source's keys holds a character either would quote.
function answersFileKey(v: OwedValue): string {
  return v.key.join('.');
}

// titleOf is the title the box asking for one owed value carries, as the
// extension composes it for that value.
function titleOf(v: OwedValue): string {
  return owedQuestion({ file: DRAFTED, key: v.key, question: '', sensitive: v.secret }).title;
}

// stillEmptyLine is the start of the compiler's finding that one value is still
// empty, as the channel carries it.
function stillEmptyLine(v: OwedValue): string {
  return `${DRAFTED}: ${keyPath(v.key)}${STILL_EMPTY}`;
}

// OFFERS are the offers to answer owed values, as the editor draws them, for every
// count the source's owed values can come to; isOffer recognises any of them.
const OFFERS: readonly string[] = OWED.map((_, i) => asTheEditorDraws(owedOffer(i + 1)));

function isOffer(t: Toast): boolean {
  return OFFERS.includes(t.message);
}

// IMPORT_ENDING_MS is how long an import is waited for on an idle machine: it
// reads the importer from the catalog folder and prepares it before it runs it.
// It bounds the importer's proof too, whose one import does the same work, so
// the two cannot come to disagree on how long that work may take.
export const IMPORT_ENDING_MS = 60000;

// NO_SECOND_OFFER_MS is how long, after the import sent with the answers has
// ended, no further offer to answer owed values must be drawn: the offer follows
// the ending at once where the answer still owes anything.
const NO_SECOND_OFFER_MS = 5000;

// NO_FOURTH_BOX_MS is how long, after the last owed value's box is accepted, no
// further box of any kind must be drawn: the next box follows at once where there
// is one.
const NO_FOURTH_BOX_MS = 2000;

// importAnswersEnvironment is what the scenario adds to the editor's environment:
// the offline posture, so nothing is fetched and nothing is pulled, and the
// catalogs it reads — the importer catalog, where the run was given one, ahead of
// the standard-library catalog.
export function importAnswersEnvironment(inputs: Inputs): Readonly<Record<string, string>> {
  const dirs = inputs.importerCatalog === null ? inputs.catalog.dir : importersAhead(inputs.importerCatalog.dir, inputs.catalog.dir);
  return { ...OFFLINE_IN_THE_ENVIRONMENT, AGGREGA_CATALOG_DIRS: dirs };
}

// Asked is one box the answering asked in: its title, and whether it hid what was
// typed into it.
interface Asked { title: string; hidden: boolean }

// SecondOffer is an offer drawn after the first one was taken: where it stands
// among every notification drawn, and when.
interface SecondOffer { index: number; toast: Toast }

// Round is what one import and the answering of what it owed left behind.
interface Round {
  first: Toast[];
  offer: Toast;
  // firstChannel is what the first import put on the channel, up to its offer.
  firstChannel: string;
  asked: Asked[];
  // extraBox is the title of a box drawn after the last owed value's box was
  // accepted, other than that box still closing, or null where none was.
  extraBox: string | null;
  ending: Toast;
  secondOffer: SecondOffer | null;
  // channel is what the channel was written after the offer was taken.
  channel: string;
}

function stillEmptyLines(channel: string): string[] {
  return channel.split('\n').filter((l) => l.includes(STILL_EMPTY));
}

// importAndAnswer imports the source as a reader imports a file they clicked —
// the destination left empty, neither option ticked, the target typed — takes
// the offer to answer what the import still owes, types each value into the box
// it is asked in, and waits for the import sent again with the answers to end.
async function importAndAnswer(ctx: SuiteContext, source: string): Promise<Round> {
  await closeAllEditors(ctx);
  const offerText = asTheEditorDraws(owedOffer(OWED.length));
  const mark = (await toasts(ctx.d)).length;
  const firstOut = ctx.out.mark();
  await importClickedFile(ctx, source, {
    outputDir: '', target: IMPORT_ANSWERS_TARGET,
    asked: {
      destination: (q) => q.title === IMPORT_DESTINATION_TITLE,
      options: (q) => q.title === IMPORT_OPTIONS_TITLE && q.rows.length > 0,
      target: (q) => q.title === IMPORT_TARGET_TITLE,
    },
  });
  const offer = await waitToast(ctx.d, 'the offer to answer what the import still owes', mark, isOffer, IMPORT_ENDING_MS);
  const first = (await toastsSince(ctx.d, mark)).filter((t) => t.message.startsWith(IMPORT_SUBJECT));
  if (offer.message !== offerText) { throw new Error(`the offer reads "${offer.message}", not "${offerText}"`); }
  // The first import's lines are written before its ending and its offer; the
  // channel's file is read once they have all reached it, or as it stands.
  const firstChannel = await ctx.out.waitFor('the first import\'s findings on the channel', firstOut, (t) => stillEmptyLines(t).length >= OWED.length, 10000)
    .catch(() => ctx.out.since(firstOut));
  const outMark = ctx.out.mark();
  // Every notification below roundMark was drawn before the offer was taken, the
  // offer among them; an offer at or above it is a later one.
  const roundMark = (await toasts(ctx.d)).length;
  if (!(await pressToastButton(ctx.d, offerText, IMPORT_OWED_ACTION))) { throw new Error(`the offer draws no "${IMPORT_OWED_ACTION}" button: ${JSON.stringify(offer.buttons)}`); }
  const asked: Asked[] = [];
  for (let i = 0; i < OWED.length; i++) {
    const before = asked.map((a) => a.title);
    const q = await waitQuickInput(ctx.d, `the box asking for owed value ${i + 1} of ${OWED.length}`, (x) => x.title.startsWith(`${DRAFTED} `) && !before.includes(x.title) && x.value === '', 30000);
    asked.push({ title: q.title, hidden: q.hidden });
    const owed = OWED.find((v) => titleOf(v) === q.title);
    if (owed === undefined) { throw new Error(`a box is titled "${q.title}", which names none of the values the import of ${IMPORT_DIFY_SOURCE} owes: ${OWED.map(titleOf).join('; ')}`); }
    await ctx.d.type(owed.answer);
    await ctx.d.press('Enter');
  }
  // Only the last box, still closing with what was typed into it, is tolerated:
  // any other box drawn, whatever its title, is a further box.
  const last = asked[asked.length - 1].title;
  const fourth = await holds(NO_FOURTH_BOX_MS, () => quickInput(ctx.d), (q) => q === null || (q.title === last && q.value !== ''));
  const extraBox = fourth.held ? null : fourth.broke?.title ?? null;
  const ending = await waitToast(ctx.d, 'the ending of the import sent again with the answers', roundMark, (t) => t.message.startsWith(IMPORT_SUBJECT), IMPORT_ENDING_MS);
  // The offer follows the ending within moments, and may already be drawn when
  // the ending is found, so it is looked for from roundMark, never from the count
  // the ending was found at, and watched for a while after the ending.
  const laterOffer = async (): Promise<SecondOffer | null> => {
    const since = await toastsSince(ctx.d, roundMark);
    const i = since.findIndex(isOffer);
    return i === -1 ? null : { index: roundMark + i, toast: since[i] };
  };
  const watched = await holds(NO_SECOND_OFFER_MS, laterOffer, (o) => o === null);
  return { first, offer, firstChannel, asked, extraBox, ending, secondOffer: watched.held ? null : watched.broke ?? null, channel: ctx.out.since(outMark) };
}

// readYaml reads the YAML document a file holds, or null where there is no file.
function readYaml(file: string): unknown {
  return fs.existsSync(file) ? yamlOf(fs.readFileSync(file, 'utf8')) : null;
}

export async function importAnswersChecks(ctx: SuiteContext): Promise<void> {
  const c = ctx.checks;
  const source = path.join(ctx.folder, IMPORT_DIFY_SOURCE);
  const answersFile = path.join(ctx.folder, IMPORT_ANSWERS_FILE);
  const drafted = path.join(ctx.folder, DRAFTED);
  await ready(ctx);
  let round: Round | null = null;
  await c.run('import.owed-values-answered-in-the-editor-are-kept-in-the-answers-file', {
    expected: `importing ${IMPORT_DIFY_SOURCE} from the explorer with the target ${IMPORT_ANSWERS_TARGET} ends drafting it and offers, in "${owedOffer(OWED.length)}" with a "${IMPORT_OWED_ACTION}" button, to answer the ${OWED.length} values it still owes; taking it asks each in an input box of its own titled "${DRAFTED} <key path>", the secret's box hiding what is typed and no other, and no further box after the last; and once each is typed, ${IMPORT_ANSWERS_FILE} beside the source holds every answer under ${DRAFTED} and its key path`,
    plant: 'in the scratch copy, out/src/import-request.js made to send each answer naming its value by one key more than the owed list named it by',
  }, async () => {
    need(!fs.existsSync(answersFile), `${IMPORT_ANSWERS_FILE} is in the folder before the import`);
    round = await importAndAnswer(ctx, source);
    const kept = dig(readYaml(answersFile), [DRAFTED]);
    const findings: string[] = [];
    for (const v of OWED) {
      // Every owed value was asked in a box of its own: importAndAnswer stops on a
      // box naming none of them, and asks as many boxes as there are values.
      const box = round.asked.find((a) => a.title === titleOf(v));
      if (box?.hidden !== v.secret) { findings.push(`the box "${titleOf(v)}" ${box?.hidden ? 'hid' : 'showed'} what was typed`); }
      const answer = dig(kept, [answersFileKey(v)]);
      if (answer !== v.answer) { findings.push(`${IMPORT_ANSWERS_FILE} holds ${JSON.stringify(answer)} under ${DRAFTED} ${answersFileKey(v)}, not ${JSON.stringify(v.answer)}`); }
    }
    if (round.extraBox !== null) { findings.push(`a further box, "${round.extraBox}", was drawn after the last one was accepted`); }
    const passed = round.first.length === 1 && round.first[0].severity !== 'error' && findings.length === 0;
    return {
      passed,
      seen: `the first ending: ${JSON.stringify(round.first.map((t) => `${t.severity}: ${t.message}`))}; the offer: "${round.offer.message}" with ${JSON.stringify(round.offer.buttons)}; the boxes: ${JSON.stringify(round.asked)}; ${findings.length === 0 ? `no further box; ${IMPORT_ANSWERS_FILE} holds every answer under ${DRAFTED} and its key path` : findings.join('; ')}`,
      evidence: { answersFile: fs.existsSync(answersFile) ? fs.readFileSync(answersFile, 'utf8') : null },
    };
  });
  await c.run('import.the-import-sent-with-the-answers-owes-nothing', {
    expected: `the first import's lines on the channel name each of the ${OWED.length} values still empty once, as "${DRAFTED}: <key path>${STILL_EMPTY}…"; the import sent again with the answers ends without failing, its ending on the channel too, its lines name none, no further offer to answer owed values is drawn by ${NO_SECOND_OFFER_MS} ms after its ending, and the drafted ${DRAFTED} carries every answer at its key path`,
    plant: 'in the scratch copy, out/src/import-request.js made to send each answer naming its value by one key more than the owed list named it by',
  }, async () => {
    const r = round as Round | null;
    need(r !== null, 'the import and its answers did not run: the check before this one stopped before it sent them');
    const firstEmpty = stillEmptyLines(r.firstChannel);
    const unnamed = OWED.filter((v) => firstEmpty.filter((l) => l.includes(stillEmptyLine(v))).length !== 1).map((v) => keyPath(v.key));
    need(firstEmpty.length === OWED.length && unnamed.length === 0, `the first import's lines do not name each owed value once as "${DRAFTED}: <key path>${STILL_EMPTY}…" (${unnamed.length === 0 ? `${firstEmpty.length} such lines` : `not once: ${unnamed.join(', ')}`}), so a line marking one is not recognised and none in the second round would be seen: ${JSON.stringify(firstEmpty)}`);
    // The ending reaches the channel after the import's lines, so a channel not
    // carrying it holds no complete account of that import, and a reading of it
    // naming no value still empty proves nothing: the check fails on it.
    const endingOnChannel = r.channel.includes(r.ending.message);
    const stillEmpty = stillEmptyLines(r.channel);
    const release = readYaml(drafted);
    const unset = OWED.filter((v) => dig(release, v.key) !== v.answer).map((v) => `${keyPath(v.key)} reads ${JSON.stringify(dig(release, v.key))}`);
    const opened = r.channel.split(importOpeningLine(source)).length - 1;
    const passed = r.ending.severity !== 'error' && endingOnChannel && opened === 1 && stillEmpty.length === 0 && r.secondOffer === null && unset.length === 0;
    const offerSeen = r.secondOffer === null
      ? `no further offer was drawn by ${NO_SECOND_OFFER_MS} ms after the ending`
      : `a further offer was drawn, notification ${r.secondOffer.index} at ${r.secondOffer.toast.at - r.ending.at} ms from the ending: "${r.secondOffer.toast.message}"`;
    return {
      passed,
      seen: `the first import named each of the ${OWED.length} values still empty once; the ending: ${r.ending.severity}: "${r.ending.message}", ${endingOnChannel ? 'on the channel too' : 'which its lines on the channel do not carry'}; the channel opened ${opened} import(s) after the offer was taken and names ${stillEmpty.length === 0 ? 'no value still empty' : `${stillEmpty.length} still empty: ${JSON.stringify(stillEmpty)}`}; ${offerSeen}; ${unset.length === 0 ? `${DRAFTED} carries every answer` : `in ${DRAFTED}, ${unset.join('; ')}`}`,
      evidence: { firstChannel: r.firstChannel, channel: r.channel },
    };
  });
}
