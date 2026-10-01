// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { loadAll } from 'js-yaml';

import { IN_EFFECT_SENTENCE } from '../../src/config-change-watch';
import { CONFIG_WRITE_DESTINATIONS } from '../../src/config-write-scope';
import { RESTART_COMMAND } from '../../src/daemon-status';
import type { TrustFetchOutcome } from '../../src/registration-outcome';
import {
  addRequest, identityPromptTitle, keyDialogTitle, REGISTRATION_DESTINATION_PROMPT, REGISTRATION_SUBJECT, REGISTRY_ADD_COMMAND, TrustByHand, trustByHandTitle,
} from '../../src/registry-configure';
import { need } from './checks';
import { makeScratchHome, runCompiler, ScratchHome } from './cli';
import { UNREACHABLE_HOST } from './fixtures';
import { referenceAnswer } from './reference';
import { makeSigningKey, PUBLISHED_ENTITY, ScratchRegistry, StubRegistries, WITHDRAWN_PLUGIN_LINK } from './registry';
import { capture, closeAllEditors, ready, run, send, SuiteContext, theServer } from './suite-context';
import { INDEX_BUILD_OPENING, pressViewAction, REGISTRIES_HEAD } from './suite-storefront';
import {
  holds, NotificationReading, notificationReadings, pickQuickInputRow, pressPanelAction, QuickInput, quickInput, RUNNING, sleep, stopWatchingNotification, Toast, toasts,
  toastsSince, treeRows, until, waitQuickInput, waitStatus, waitToast, watchNotification,
} from './workbench';

// The checks run in the storefront folder with a scratch registry configured
// beside an unreachable one: the published-catalog search over an index that
// holds a withdrawn version, what the channel says about each registry's index,
// and the withdrawal a plugin attachment would name. Then a pair of stub
// registries is registered beside those two — one whose repository listing never
// ends and a well-behaved one — and Update index is pressed over all four: its
// progress ends, and the channel and the ending name the registry whose listing
// repeats in the compiler's words and report the one beside it indexed. After
// them, registrations made through Add registry — online, and then with the
// offline posture taken — and what each one's closing line says about the trust
// the entry was given, or how the refusal reads; and, where the registry
// advertises no trust policy or is refused offline for want of one, the question
// asking for a policy to pin by hand, what each answer to it writes, and what a
// reader is shown of a file chosen as the key that is not a public key.

export const REGISTRY_CHECKS = [
  'catalog-search.lists-matches-and-copies-a-reference',
  'catalog-search.rows-carry-no-withdrawal-marking',
  'catalog-search.index-freshness-is-named-in-the-channel',
  'catalog-search.stale-index-is-named',
  'catalog-search.nothing-matched-names-the-filter',
  'catalog-search.index-sentences-direct-the-reader',
  'plugins.add-names-the-withdrawn-version-it-passed-over',
  'side-bar.plugins-and-registries-views-refresh-without-a-network',
  'registries-panel.update-index-ends-with-a-registry-whose-listing-repeats',
  'registries-panel.update-index-names-the-registry-whose-listing-repeats-in-the-compilers-words',
  'registries-panel.update-index-reports-the-registry-beside-it-indexed',
  'registration.says-an-entry-carries-no-trust-where-none-is-advertised',
  'registration.asks-for-a-trust-policy-where-the-registry-advertises-none',
  'registration.declined-writes-what-the-command-line-writes',
  'registration.refuses-a-malformed-identity-in-the-compilers-words',
  'registration.writes-the-identities-and-key-supplied',
  'registration.refuses-a-key-file-that-is-not-a-public-key-without-showing-its-content',
  'registration.says-the-hub-took-its-built-in-baseline-offline',
  'registration.asks-nothing-after-the-hubs-built-in-baseline',
  'registration.refusal-carries-the-servers-words',
  'registration.asks-for-a-trust-policy-after-the-offline-refusal',
] as const;

const SEARCH_TITLE = 'Aggrega: search published catalog';
const QUERY = 'adminer';
const NO_MATCH_QUERY = 'no-entity-is-called-this';

// The empty answer for a filter nothing matched opens with these words, and the
// channel's remediation reads so. Both are held as the words a reader is to
// meet, so a change of wording is a change these checks report.
const NO_MATCHES_OPENING = 'Aggrega: no catalog matches for ';
const REFRESH_REMEDIATION = 'Refresh with “Update index” in the Registries panel.';

// The row at the head of the Catalog panel that opens the search, by the words
// it reads.
const SEARCH_ROW_LABEL = 'Search catalog';

interface SearchRecord { uri: string; name: string; version: string; kind: string; description?: string; retracted?: string[] }

// searchFor runs one search through the palette, opened from the row at the head
// of the Catalog panel: the query facet set, then Search. It returns the drawn
// answer list, or null where the search answered with a notification instead.
async function searchFor(ctx: SuiteContext, query: string): Promise<QuickInput | null> {
  await closeAllEditors(ctx);
  await run(ctx, 'aggrega.workspaceCatalog.focus');
  await pressPanelAction(ctx.d, 'Catalog', SEARCH_ROW_LABEL);
  await waitQuickInput(ctx.d, 'the search palette', (q) => q.title === SEARCH_TITLE);
  await pickQuickInputRow(ctx.d, 'Query');
  await waitQuickInput(ctx.d, 'the query being asked for', (q) => q.rows.length === 0 || q.title !== SEARCH_TITLE);
  // The filter is kept from one search to the next, so the box opens holding the
  // last search's query; it is selected and typed over, so the query searched for
  // is the one this call was given.
  await ctx.d.press('Control+a');
  await ctx.d.type(query);
  await ctx.d.press('Enter');
  await waitQuickInput(ctx.d, 'the palette showing the query', (q) => q.title === SEARCH_TITLE && q.rows.some((r) => r.label === 'Query' && r.description.includes(query)));
  const mark = (await toasts(ctx.d)).length;
  await pickQuickInputRow(ctx.d, 'Search');
  const answer = await Promise.race([
    waitQuickInput(ctx.d, 'the match list', (q) => /match\(es\)/.test(q.placeholder), 30000).catch(() => null),
    waitToast(ctx.d, 'the search answering', mark, (t) => t.message.startsWith('Aggrega:'), 30000).then(() => null, () => null),
  ]);
  return answer;
}

// ---- registrations --------------------------------------------------------------

// The prompt Add registry asks for the host with, by its title, and the global
// file as the destination picker names it, read from the list it is drawn from.
export const ADD_REGISTRY_TITLE = 'Aggrega: add a registry';
export const GLOBAL_DESTINATION = CONFIG_WRITE_DESTINATIONS.find((d) => d.value === 'global')?.label ?? '';

// The trust clauses a registration's closing line carries for the two outcomes
// the checks below reach, held as the words a reader is to meet, so a change of
// wording is a change these checks report. The reason that follows each is the
// server's own, and is read from its answer rather than written here.
const NO_POLICY_CLAUSE = 'It advertises no signature trust policy, and this registration names no identity or key, so the entry carries none.';
const BASELINE_CLAUSE = 'The built-in trust baseline was pinned instead of an advertised policy.';
const BOTH_BY_HAND_CLAUSE = 'Its signature trust policy is the keyless identity and the public key this registration supplied, so no advertised policy was fetched.';

// The rows of the question asking for a trust policy to pin by hand, held as the
// words a reader is to meet, in the order drawn.
const TRUST_BY_HAND_ROWS = ['Keyless identities', 'A public key', 'Keyless identities and a public key', 'Neither'];

// The identities typed at that question: one the compiler reads, and one it
// refuses because it names no issuer.
const PINNED_IDENTITY = { identity: 'editor-suite@example.test', issuer: 'https://issuer.example.test' };
const MALFORMED_IDENTITY = 'not-an-identity-pair';

// The hosts registered. The two loopback ports are ones nothing listens on: the
// first is asked for its advertised policy while the posture is online and the ask
// is refused on this machine, so it never leaves it; the second is named once the
// posture is offline, where a registry other than the hub is not asked at all.
const HUB = 'hub.aggrega.ai';
const UNLISTENED_ONLINE = 'localhost:1';
const UNLISTENED_OFFLINE = 'localhost:2';

export const globalConfiguration = (h: ScratchHome): string => path.join(h.home, '.config', 'aggrega', 'config.yaml');

// referenceHome is a home of its own for the server's reference answer to a
// registration, holding a copy of the scenario's global configuration as it
// stands. The reference registration writes what the editor's is about to write,
// so it is kept out of the home the editor reads.
function referenceHome(ctx: SuiteContext, name: string): ScratchHome {
  const h = makeScratchHome(path.join(ctx.s.root.dir, 'reference-homes', name));
  const from = globalConfiguration(ctx.home);
  if (fs.existsSync(from)) {
    fs.mkdirSync(path.dirname(globalConfiguration(h)), { recursive: true });
    fs.copyFileSync(from, globalConfiguration(h));
  }
  return h;
}

// Registered is the server's own answer to a registration, taken outside the
// editor: the trust outcome it reports, or its refusal; and the global
// configuration file of the home it was taken in, which a refusal naming the file
// it could not write names in place of the scenario's own.
interface Registered { trust: TrustFetchOutcome | null; refusal: { code: unknown; message: string } | null; raw: string; file: string }

async function referenceRegistration(ctx: SuiteContext, host: string, name: string, byHand: TrustByHand | null = null): Promise<Registered> {
  const home = referenceHome(ctx, name);
  const answer = await referenceAnswer({ binary: ctx.inputs.compiler.path, root: ctx.folder, method: 'aggrega/registryAdd', params: addRequest(host, 'global', byHand), home, table: ctx.s.table, log: ctx.cliLog });
  const raw = JSON.stringify(answer).slice(0, 600);
  const file = globalConfiguration(home);
  if (!answer.ok) { return { trust: null, refusal: { code: answer.error.code, message: answer.error.message }, raw, file }; }
  return { trust: (answer.result as { trust?: TrustFetchOutcome }).trust ?? null, refusal: null, raw, file };
}

// Asked is how a registration's question asking for a trust policy to pin by hand
// is met: not waited for, because none is expected; pressed away; or answered
// with identities, typed one at a time, and a key file chosen in the file dialog
// or none.
type Asked =
  | { kind: 'not-waited-for' }
  | { kind: 'pressed-away' }
  | { kind: 'answered'; identities: string[]; keyFile: string | null };
const NOT_WAITED_FOR: Asked = { kind: 'not-waited-for' };
const PRESSED_AWAY: Asked = { kind: 'pressed-away' };

// Question is the question as it was first seen drawn, and whether the channel
// already held the registration's closing line at that moment.
interface Question { title: string; placeholder: string; rows: string[]; lineFirst: boolean }

// Ending is how a registration made in the editor ended: the channel's closing
// line and the notification raised with it; the question that followed, where one
// was waited for and drawn; and, where it was answered, the second registration's
// closing line and notification.
interface Ending { line: string; toast: Toast | null; question: Question | null; second: { line: string; toast: Toast | null } | null }

// registerThrough runs Add registry as a person does — the command, the host typed
// into its prompt, the global file chosen from its picker — and waits for the
// ending, and for the language server the registration restarts to read running.
// Where a question for a trust policy is expected it is waited for, and met as
// `asked` says: pressed away, or answered as a person answers it, row, identities
// and file dialog, after which the second registration's ending is waited for.
async function registerThrough(ctx: SuiteContext, host: string, asked: Asked = NOT_WAITED_FOR): Promise<Ending> {
  const opening = `${REGISTRATION_SUBJECT} `;
  const mark = ctx.out.mark();
  const toastMark = (await toasts(ctx.d)).length;
  await send(ctx, REGISTRY_ADD_COMMAND);
  await waitQuickInput(ctx.d, 'the prompt for the registry host', (q) => q.title === ADD_REGISTRY_TITLE);
  await ctx.d.type(host);
  await ctx.d.press('Enter');
  await waitQuickInput(ctx.d, 'the choice of configuration file', (q) => q.placeholder === REGISTRATION_DESTINATION_PROMPT && q.rows.some((r) => r.label === GLOBAL_DESTINATION));
  await pickQuickInputRow(ctx.d, GLOBAL_DESTINATION);
  let question: Question | null = null;
  if (asked.kind !== 'not-waited-for') {
    // The question and the channel are read together, so whether the closing line
    // was there when the question was first seen is observed rather than assumed.
    // A registration that raises none is given 15 s past its closing line.
    const title = trustByHandTitle(host);
    let lineAt: number | null = null;
    const seen = await until('the question asking for a trust policy to pin by hand', 90000, async () => {
      const q = await quickInput(ctx.d);
      const hasLine = ctx.out.since(mark).split('\n').some((l) => l.startsWith(opening));
      if (hasLine && lineAt === null) { lineAt = Date.now(); }
      return { q, hasLine };
    }, (v) => v.q?.title === title || (lineAt !== null && Date.now() - lineAt > 15000)).catch(() => null);
    if (seen !== null && seen.q !== null && seen.q.title === title) {
      question = { title: seen.q.title, placeholder: seen.q.placeholder, rows: seen.q.rows.map((r) => r.label), lineFirst: seen.hasLine };
    }
  }
  const text = await ctx.out.waitFor('the registration closing its report', mark, (t) => t.split('\n').some((l) => l.startsWith(opening)), 60000);
  const line = text.split('\n').find((l) => l.startsWith(opening)) ?? '';
  const toast = await waitToast(ctx.d, 'the registration raising its notification', toastMark, (t) => t.message.startsWith(opening), 15000).catch(() => null);
  let second: Ending['second'] = null;
  if (question !== null && asked.kind === 'pressed-away') {
    await ctx.d.press('Escape');
    await until('the question closing', 5000, () => quickInput(ctx.d), (q) => q === null || q.title !== question?.title).catch(() => undefined);
  }
  if (question !== null && asked.kind === 'answered') {
    const secondMark = ctx.out.mark();
    const secondToastMark = (await toasts(ctx.d)).length;
    await answerTrustByHand(ctx, host, asked.identities, asked.keyFile);
    const after = await ctx.out.waitFor('the second registration closing its report', secondMark, (t) => t.split('\n').some((l) => l.startsWith(opening)), 60000).catch(() => '');
    const secondLine = after.split('\n').find((l) => l.startsWith(opening)) ?? '';
    const secondToast = secondLine === '' ? null
      : await waitToast(ctx.d, 'the second registration raising its notification', secondToastMark, (t) => t.message === secondLine, 15000).catch(() => null);
    second = { line: secondLine, toast: secondToast };
  }
  await waitStatus(ctx.d, RUNNING, 60000).catch(() => undefined);
  return { line, toast, question, second };
}

// answerTrustByHand answers the drawn question as a person does: the row naming
// what is to be pinned; where that row asks for identities, each typed into its
// own prompt and then an empty one ending the list; and the key file's path typed
// into the file dialog.
async function answerTrustByHand(ctx: SuiteContext, host: string, identities: string[], keyFile: string | null): Promise<void> {
  const row = identities.length > 0 && keyFile !== null ? TRUST_BY_HAND_ROWS[2] : identities.length > 0 ? TRUST_BY_HAND_ROWS[0] : TRUST_BY_HAND_ROWS[1];
  await pickQuickInputRow(ctx.d, row);
  const identityTitle = identityPromptTitle(host);
  for (const typed of identities.length > 0 ? [...identities, ''] : []) {
    await waitQuickInput(ctx.d, 'the prompt for a keyless identity', (q) => q.title === identityTitle && q.value === '', 15000);
    if (typed !== '') { await ctx.d.type(typed); }
    await ctx.d.press('Enter');
    await sleep(400);
  }
  if (keyFile === null) { return; }
  const keyTitle = keyDialogTitle(host);
  await waitQuickInput(ctx.d, 'the file dialog for the public key', (q) => q.title === keyTitle, 15000);
  await ctx.d.press('Control+a');
  await ctx.d.type(keyFile);
  await sleep(500);
  await ctx.d.press('Enter');
  await sleep(800);
  const still = await quickInput(ctx.d);
  if (still !== null && still.title === keyTitle) { await ctx.d.press('Enter'); await sleep(800); }
}

// readsCompleted says whether a completed registration's line opens by naming the
// host and the file, and carries the trust clause followed by the server's reason
// exactly once, with nothing after the reason but the sentence saying the change
// is in effect — which the ending adds after a closing stop where the reason has
// none of its own. A clause with no reason after it is given an empty reason.
function readsCompleted(line: string, host: string, file: string, clause: string, reason: string): boolean {
  const opening = `${REGISTRATION_SUBJECT} registered ${host} in ${file}, `;
  const trust = reason === '' ? ` ${clause}` : ` ${clause} ${reason}`;
  const at = line.indexOf(trust);
  if (!line.startsWith(opening) || at < opening.length || line.indexOf(trust, at + 1) !== -1) { return false; }
  const after = line.slice(at + trust.length);
  return after === '' || after === ` ${IN_EFFECT_SENTENCE}` || after === `. ${IN_EFFECT_SENTENCE}`;
}

function describeEnding(e: Ending): string {
  return `the channel: "${e.line}"; the notification: ${e.toast ? `"${e.toast.message}" (${e.toast.severity})` : 'none'}`;
}

function describeQuestion(q: Question | null): string {
  return q === null ? 'no question asking for a trust policy was drawn'
    : `the question "${q.title}" (placeholder "${q.placeholder}") drew the rows ${JSON.stringify(q.rows)}, first seen with the closing line ${q.lineFirst ? 'already in the channel' : 'not yet in the channel'}`;
}

function describeSecond(e: Ending): string {
  return e.second === null ? 'no second registration ended'
    : `the second registration's line: "${e.second.line}"; its notification: ${e.second.toast ? `"${e.second.toast.message}" (${e.second.toast.severity})` : 'none'}`;
}

// fileNamedBy reads the configuration file a completed registration's line names.
function fileNamedBy(line: string, host: string): string | null {
  const opening = `${REGISTRATION_SUBJECT} registered ${host} in `;
  if (!line.startsWith(opening)) { return null; }
  const rest = line.slice(opening.length);
  const at = rest.indexOf(', ');
  return at === -1 ? null : rest.slice(0, at);
}

// RegistryEntry is the part of a configuration's registry entry these checks read.
interface RegistryEntry { host?: string; trusted_identities?: Array<{ identity?: string; issuer?: string }>; public_key?: string }

// entryFor reads a configuration file's one document and the entry keyed under
// `host` in it.
export function entryFor(text: string, host: string): RegistryEntry | null {
  const [doc] = loadAll(text) as Array<{ registries?: RegistryEntry[] } | null>;
  return (doc?.registries ?? []).find((r) => r.host === host) ?? null;
}

// commandLineReference is what `aggrega registry add <host> <args…>` writes, run
// by the same compiler in the copy of the folder, into a home holding a copy of
// the scenario's global configuration as it stands — so it is asked before the
// editor's registration it is the reference for.
async function commandLineReference(ctx: SuiteContext, referenceFolder: string, name: string, host: string, args: string[]): Promise<{ text: string | null; said: string }> {
  const h = referenceHome(ctx, name);
  const r = await runCompiler(ctx.inputs.compiler.path, ['registry', 'add', host, ...args], { cwd: referenceFolder, home: h, boundMs: 60000, log: ctx.cliLog });
  const f = globalConfiguration(h);
  if (r.status !== 0 || !fs.existsSync(f)) {
    return { text: null, said: `\`aggrega registry add ${host} ${args.join(' ')}\` exited ${r.status ?? r.signal}: ${(r.stderr || r.stdout).trim().slice(0, 300)}` };
  }
  return { text: fs.readFileSync(f, 'utf8'), said: `\`aggrega registry add ${host} ${args.join(' ')}\` wrote ${f}` };
}

// firstDifference names the first line at which two texts part, for a report.
function firstDifference(a: string, b: string): string {
  const x = a.split('\n');
  const y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) { return `line ${i + 1}: ${JSON.stringify(x[i] ?? null)} against ${JSON.stringify(y[i] ?? null)}`; }
  }
  return 'none';
}

// A file chosen as the key that is not one: its lines, which of them a text
// carries, and a text with each of them withheld.
//
// 🔴 A REPORT NAMES A LINE BY ITS POSITION, NEVER BY ITS CONTENT. The file is a
// private key, so what these checks report of anything that might carry it —
// the channel, a notification, the server's own answer — passes through
// withheldFrom first, and a line found is named by its number in the file.
function keyFileLines(file: string): string[] {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '');
}

function keyLinesIn(text: string, lines: readonly string[]): number[] {
  return lines.flatMap((l, i) => (text.includes(l) ? [i + 1] : []));
}

function withheldFrom(text: string, lines: readonly string[]): string {
  return lines.reduce((t, l, i) => t.split(l).join(`<line ${i + 1} of the key file>`), text);
}

// takeOfflinePosture takes the offline posture the way a reader takes it: the
// top-level key written into the global configuration, which the server reads
// only as it starts, and the language server restarted by the restart command to
// read it. The warning the extension raises for a configuration changed under it
// is not what is waited on: which of the two a reader uses to restart is not what
// these checks are about. It answers whether a new server reads running
// afterwards, and what it found where one does not.
async function takeOfflinePosture(ctx: SuiteContext): Promise<{ taken: boolean; said: string }> {
  const file = globalConfiguration(ctx.home);
  if (!fs.existsSync(file)) { return { taken: false, said: `there is no global configuration at ${file}` }; }
  await waitStatus(ctx.d, RUNNING, 60000).catch(() => undefined);
  const before = await theServer(ctx).catch(() => null);
  if (before === null) { return { taken: false, said: 'no one language server was running before the key was written' }; }
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, `${text}${text.endsWith('\n') ? '' : '\n'}offline: true\n`);
  await send(ctx, RESTART_COMMAND);
  const next = await theServer(ctx, 30000, before.pid).catch(() => null);
  const running = await waitStatus(ctx.d, RUNNING, 60000).then(() => true, () => false);
  return next !== null && running
    ? { taken: true, said: `the server ${before.pid} was replaced by ${next.pid}, which reads running` }
    : { taken: false, said: `after the restart command ${next === null ? `no language server other than ${before.pid} was running within 30000 ms` : `the server ${next.pid} did not read running within 60000 ms`}` };
}

// ---- an index build over a registry whose listing never ends ------------------

// The words an index build meets a reader with, held as written, so a change of
// wording is a change these checks report: the progress notification's title
// while the build runs, the opening every ending shares, and the opening of the
// ending of a build that left a registry unindexed. The row pressed and the
// channel's opening line for a build over every registry are the ones the
// storefront scenario holds. What follows each opening is read off the server's
// own answer rather than written here.
const UPDATE_INDEX_ROW = REGISTRIES_HEAD[1];
const INDEX_PROGRESS_TITLE = 'Aggrega: updating the searchable index';
const INDEX_BUILD_ENDS = 'The index build ';
const INDEX_BUILD_INCOMPLETE = 'The index build did not complete: ';

// IndexHost and IndexAnswer are the part of the server's answer to an index
// build these checks read.
interface IndexHost { host: string; indexed: number; error?: string }
interface IndexAnswer { hosts: IndexHost[]; failed: string[] }

// configurePair registers the stub's two registries in the global configuration,
// beside the two the scenario registered as it was prepared, with the compiler's
// own registration and no trust policy asked for, and restarts the language
// server by the restart command so it reads them: the server reads its
// configuration once, as it starts. It answers whether a new server reads running
// afterwards with the Registries panel listing both, and what it found where not.
async function configurePair(ctx: SuiteContext, stubs: StubRegistries): Promise<{ taken: boolean; said: string }> {
  await waitStatus(ctx.d, RUNNING, 60000).catch(() => undefined);
  const before = await theServer(ctx).catch(() => null);
  if (before === null) { return { taken: false, said: 'no one language server was running before the registrations' }; }
  for (const host of [stubs.repeating, stubs.wellBehaved]) {
    const r = await runCompiler(ctx.inputs.compiler.path, ['registry', 'add', host, '--fetch-trust=false'], { cwd: ctx.folder, home: ctx.home, boundMs: 60000, log: ctx.cliLog });
    if (r.status !== 0) { return { taken: false, said: `\`aggrega registry add ${host} --fetch-trust=false\` exited ${r.status ?? r.signal}: ${(r.stderr || r.stdout).trim().slice(0, 300)}` }; }
  }
  const file = globalConfiguration(ctx.home);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (![stubs.repeating, stubs.wellBehaved].every((h) => text.includes(h))) { return { taken: false, said: `the global configuration at ${file} does not name both after the registrations` }; }
  await send(ctx, RESTART_COMMAND);
  const next = await theServer(ctx, 30000, before.pid).catch(() => null);
  const running = await waitStatus(ctx.d, RUNNING, 60000).then(() => true, () => false);
  if (next === null || !running) {
    return { taken: false, said: `after the restart command ${next === null ? `no language server other than ${before.pid} was running within 30000 ms` : `the server ${next.pid} did not read running within 60000 ms`}` };
  }
  await run(ctx, 'aggrega.registries.focus');
  const listed = await until('the Registries panel listing both registries', 20000, async () => ((await treeRows(ctx.d, 'Registries')) ?? []).map((r) => `${r.label} ${r.description} ${r.aria}`),
    (rows) => [stubs.repeating, stubs.wellBehaved].every((h) => rows.some((r) => r.includes(h)))).then(() => true, () => false);
  return listed
    ? { taken: true, said: `both registered in ${file}; the server ${before.pid} was replaced by ${next.pid}, which reads running, and the Registries panel lists both` }
    : { taken: false, said: `the server ${next.pid} reads running, and the Registries panel does not list both within 20000 ms` };
}

// endingOf is the line a build's run on the channel closes with, read from its
// opening line on, or null where it has not closed yet.
function endingOf(channel: string): string | null {
  const lines = channel.split('\n');
  const at = lines.indexOf(INDEX_BUILD_OPENING);
  if (at === -1) { return null; }
  return lines.slice(at + 1).find((l) => l.startsWith(INDEX_BUILD_ENDS)) ?? null;
}

// runLines is the channel's lines from a build's opening line to its ending.
function runLines(channel: string): string[] {
  const lines = channel.split('\n');
  const at = lines.indexOf(INDEX_BUILD_OPENING);
  if (at === -1) { return []; }
  const rest = lines.slice(at + 1);
  const end = rest.findIndex((l) => l.startsWith(INDEX_BUILD_ENDS));
  return end === -1 ? rest : rest.slice(0, end);
}

// notIndexedIn reads the registries an ending names as not indexed: the hosts
// listed between its first pair of parentheses.
function notIndexedIn(ending: string): string[] {
  const m = /\(([^)]*)\)/.exec(ending);
  return m ? m[1].split(', ').filter((h) => h !== '') : [];
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// drawnThenGone says whether an observer's readings show the notification drawn
// and, after that, gone.
function drawnThenGone(rs: NotificationReading[]): boolean {
  const i = rs.findIndex((r) => r.drawn);
  return i !== -1 && rs.slice(i + 1).some((r) => !r.drawn);
}

// describeReadings states an observer's readings, each at its time after `from`.
function describeReadings(rs: NotificationReading[], from: number): string {
  if (rs.length === 0) { return 'no reading'; }
  return rs.map((r) => `${r.drawn ? 'drawn' : 'not drawn'} at ${r.at - from} ms`).join(', ');
}

export async function registryChecks(ctx: SuiteContext, registry: ScratchRegistry, stubs: StubRegistries, referenceFolder: string): Promise<void> {
  const c = ctx.checks;
  await ready(ctx);
  const cli = async (args: string[]): Promise<{ stdout: string; stderr: string; status: number | null }> =>
    runCompiler(ctx.inputs.compiler.path, args, { cwd: ctx.folder, home: ctx.home, boundMs: 60000, log: ctx.cliLog });
  const reference = await cli(['search', QUERY, '-o', 'json']);
  let records: SearchRecord[] = [];
  try { records = (JSON.parse(reference.stdout) as { records?: SearchRecord[] }).records ?? []; } catch { records = []; }
  const target = records.find((r) => r.name === `${PUBLISHED_ENTITY.kind}/${PUBLISHED_ENTITY.name}`);
  let matchList: QuickInput | null = null;
  // searched says a search ran to its answer; what the channel then holds is
  // what the freshness check judges, so an empty channel after a search is a
  // finding, never a missing precondition.
  let searched = false;
  let channelAfterSearch = '';

  await c.run('catalog-search.lists-matches-and-copies-a-reference', {
    expected: `with the query "${QUERY}", Search opens a match list whose placeholder reads "<n> match(es) — select to copy the reference", <n> being the ${records.length} record(s) the compiler's own search finds in the same index; choosing ${PUBLISHED_ENTITY.name} copies its reference and says "Aggrega: copied <reference>"`,
    plant: 'in the scratch copy, out/src/catalog-views.js made to copy the entity\'s name instead of its reference',
  }, async () => {
    need(reference.status === 0 && target !== undefined, `the compiler's own search found no ${PUBLISHED_ENTITY.name} in the index (exit ${reference.status})`);
    const outMark = ctx.out.mark();
    matchList = await searchFor(ctx, QUERY);
    searched = true;
    channelAfterSearch = ctx.out.since(outMark);
    need(matchList !== null, 'the search answered with a notification instead of a match list');
    const placeholderOk = matchList.placeholder === `${records.length} match(es) — select to copy the reference`;
    const row = matchList.rows.find((r) => r.label.includes(PUBLISHED_ENTITY.name) || r.text.includes(PUBLISHED_ENTITY.name));
    need(row !== undefined, `the match list draws no row for ${PUBLISHED_ENTITY.name}`);
    const mark = (await toasts(ctx.d)).length;
    await pickQuickInputRow(ctx.d, row.label);
    const told = await waitToast(ctx.d, 'the copy being told', mark, (t) => t.message.startsWith('Aggrega: copied'), 10000);
    const clipboard = await ctx.probe.request<string>('clipboard.read');
    return { passed: placeholderOk && clipboard === target.uri && told.message === `Aggrega: copied ${target.uri}`, seen: `placeholder "${matchList.placeholder}"; the clipboard holds "${clipboard}"; told "${told.message}"` };
  });

  await c.run('catalog-search.rows-carry-no-withdrawal-marking', {
    expected: `the match list's row for ${PUBLISHED_ENTITY.name} names the entity, the version a resolution would take (${target?.version ?? '?'}, as the compiler's own search reports it), its kind and its description, and carries no withdrawal marking although ${PUBLISHED_ENTITY.newer} is withdrawn`,
    plant: 'in the scratch copy, out/src/catalog-search-run.js made to name a row\'s withdrawn versions beside the one it offers',
  }, async () => {
    const list = matchList as QuickInput | null;
    need(list !== null && target !== undefined, 'no match list was drawn');
    need((target.retracted ?? []).includes(PUBLISHED_ENTITY.newer), `the index records no withdrawal of ${PUBLISHED_ENTITY.newer}, so there is nothing for the row not to mark`);
    const row = list.rows.find((r) => r.text.includes(PUBLISHED_ENTITY.name));
    need(row !== undefined, `no row for ${PUBLISHED_ENTITY.name}`);
    const text = `${row.text} ${row.aria}`;
    const firstWords = (target.description ?? '').split(/\s+/).slice(0, 3).join(' ');
    const passed = text.includes(target.version) && new RegExp(target.kind, 'i').test(text) && text.includes(firstWords) && !/retract|withdr/i.test(text);
    return { passed, seen: `the row reads ${JSON.stringify(row.text.replace(/\s+/g, ' ').slice(0, 300))}` };
  });

  await c.run('catalog-search.index-freshness-is-named-in-the-channel', {
    expected: `after the search, the channel names each registry's index: "Index for ${registry.host} last updated <time>", <time> being the one the compiler's own search reports, and "registry ${UNREACHABLE_HOST}: no local index has been built.", followed by "${REFRESH_REMEDIATION}"`,
    plant: 'in the scratch copy, out/src/catalog-search-run.js made to write no freshness lines',
  }, async () => {
    need(searched, 'no search ran, so the channel has nothing to say about it');
    const updated = `${reference.stderr}`.split('\n').find((l) => l.startsWith(`Index for ${registry.host} last updated `)) ?? '';
    need(updated !== '', `the compiler's own search named no freshness for ${registry.host}: ${reference.stderr.slice(0, 200)}`);
    const lines = channelAfterSearch.split('\n').map((l) => l.trim());
    const at = (s: string): number => lines.findIndex((l) => l === s);
    const iUpdated = at(updated.trim());
    const iMissing = at(`registry ${UNREACHABLE_HOST}: no local index has been built.`);
    const iRemedy = at(REFRESH_REMEDIATION);
    return { passed: iUpdated !== -1 && iMissing !== -1 && iRemedy > Math.max(iUpdated, iMissing), seen: `the channel after the search: ${JSON.stringify(lines.filter((l) => l !== '').slice(0, 8))}` };
  });

  c.notRun('catalog-search.stale-index-is-named', {
    expected: 'where the compiler judges an index stale, the channel adds "One or more indexes are stale." before the remediation',
    plant: 'in the scratch copy, out/src/catalog-search-run.js made to drop the staleness line',
  }, 'every index this run can build is built fresh, and whether one is stale is the compiler\'s judgement of its age, so no stale index can be built without waiting out that age');

  let emptyAnswer = '';
  await c.run('catalog-search.nothing-matched-names-the-filter', {
    expected: `a query nothing in the index matches ("${NO_MATCH_QUERY}") is answered by a sentence opening "${NO_MATCHES_OPENING}" and naming the query`,
    plant: 'in the scratch copy, out/src/catalog-search-run.js made to answer no matches as no registries',
  }, async () => {
    const mark = (await toasts(ctx.d)).length;
    const list = await searchFor(ctx, NO_MATCH_QUERY);
    const t = await waitToast(ctx.d, 'the empty answer', mark, (x) => x.message.startsWith('Aggrega:'), 20000);
    emptyAnswer = t.message;
    return { passed: list === null && t.message.startsWith(NO_MATCHES_OPENING) && t.message.includes(NO_MATCH_QUERY), seen: `"${t.message}"${list ? `; a list was drawn: ${list.placeholder}` : ''}` };
  });

  await c.forPerson('catalog-search.index-sentences-direct-the-reader', {
    expected: 'the remediation sentences send the reader where the control is',
    plant: 'none: this is a judgement of the wording',
    question: `The channel sends the reader to "Update index" in the Registries panel, the second row at its head. Does that, and the empty answer below, direct the reader well?`,
  }, async () => ({ screenshot: await capture(ctx, 'search-answers'), drawnText: `${channelAfterSearch.trim()}\n${emptyAnswer}` }));

  c.notRun('plugins.add-names-the-withdrawn-version-it-passed-over', {
    expected: 'adding a plugin whose newest published version is withdrawn ends in a sentence naming the version it passed over, "Retracted and not selected: <version> (<reason>).", and where the withdrawal records came from',
    plant: 'in the scratch copy, out/src/plugin-attachment.js made to drop the passed-over version from its closing sentence',
  }, `its precondition cannot be built: ${WITHDRAWN_PLUGIN_LINK}`);

  await c.forPerson('side-bar.plugins-and-registries-views-refresh-without-a-network', {
    expected: 'the Plugins and Registries views refresh, with one registry unreachable, and say what they hold',
    plant: 'none: this is a judgement of what the views say',
    question: `With ${UNREACHABLE_HOST} configured beside the scratch registry, is what the Plugins and Registries views draw after their refresh a fair account of what is there?`,
  }, async () => {
    await run(ctx, 'workbench.view.extension.aggrega');
    await pressViewAction(ctx, 'Registries', 'Refresh registries');
    await pressViewAction(ctx, 'Plugins', 'Refresh plugins');
    await until('both views drawing their rows after the refresh', 15000, async () => [(await treeRows(ctx.d, 'Registries')) ?? [], (await treeRows(ctx.d, 'Plugins')) ?? []],
      ([r, p]) => r.length > 0 && p.length > 0).catch(() => undefined);
    const rows = [...((await treeRows(ctx.d, 'Registries')) ?? []).map((r) => `Registries: ${r.label} ${r.description}`), ...((await treeRows(ctx.d, 'Plugins')) ?? []).slice(0, 8).map((r) => `Plugins: ${r.label} ${r.description}`)];
    return { screenshot: await capture(ctx, 'views-after-refresh'), drawnText: rows.join('\n') };
  });

  // ---- an index build over a registry whose listing never ends ----
  // The pair is registered only now, after the checks above have read the
  // registries the scenario was prepared with, and before any registration below:
  // those end with the offline posture taken, under which an index build is
  // refused outright.
  const pair = await configurePair(ctx, stubs);
  const beside = `with ${stubs.repeating} (whose repository listing hands back the same page with a link to a next page, every time it is asked) and ${stubs.wellBehaved} (one repository at one version) registered beside the scratch registry and ${UNREACHABLE_HOST}, and the language server restarted to read them`;
  // The server's own answer to the same request, asked outside the editor over the
  // same registries — the global configuration copied into a home of its own — in
  // a copy of the folder, so the index it writes is not the one the editor's
  // build writes.
  const indexReference = pair.taken
    ? await referenceAnswer({ binary: ctx.inputs.compiler.path, root: referenceFolder, method: 'aggrega/registryUpdate', params: {}, home: referenceHome(ctx, 'index-build'), table: ctx.s.table, log: ctx.cliLog, boundMs: 120000 })
    : null;
  const answer: IndexAnswer | null = indexReference !== null && indexReference.ok ? { hosts: [], failed: [], ...(indexReference.result as Partial<IndexAnswer>) } as IndexAnswer : null;
  const answerRaw = indexReference === null ? `no answer was asked for: ${pair.said}` : JSON.stringify(indexReference).slice(0, 800);
  const hostIn = (a: IndexAnswer | null, host: string): IndexHost | undefined => (a?.hosts ?? []).find((h) => h.host === host);
  let pressed: { outMark: ReturnType<SuiteContext['out']['mark']>; toastMark: number; requestsBefore: number } | null = null;

  await c.run('registries-panel.update-index-ends-with-a-registry-whose-listing-repeats', {
    expected: `${beside}, pressing "${UPDATE_INDEX_ROW}" at the head of the Registries panel opens the build on the channel with "${INDEX_BUILD_OPENING}", and its progress notification "${INDEX_PROGRESS_TITLE}" — seen drawn by an observer installed before the press — is gone within 60 s and is not drawn again over the 3 s after`,
    plant: 'in the scratch copy, out/src/registries-view.js made to run the build behind a progress notification whose work never settles',
  }, async () => {
    need(pair.taken, `the two registries were not configured: ${pair.said}`);
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.registries.focus');
    const key = await watchNotification(ctx.d, INDEX_PROGRESS_TITLE);
    const outMark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    const requestsBefore = stubs.requests().length;
    const at = Date.now();
    await pressPanelAction(ctx.d, 'Registries', UPDATE_INDEX_ROW);
    pressed = { outMark, toastMark, requestsBefore };
    const opened = await ctx.out.waitFor('the index build opening in the channel', outMark, (t) => t.split('\n').includes(INDEX_BUILD_OPENING), 10000).then(() => true, () => false);
    const readings = await until('the progress notification drawn and then gone', 60000, () => notificationReadings(ctx.d, key), drawnThenGone)
      .catch(() => notificationReadings(ctx.d, key));
    const ended = drawnThenGone(readings);
    const after = ended ? await holds(3000, () => notificationReadings(ctx.d, key), (rs) => rs.length > 0 && !rs[rs.length - 1].drawn) : null;
    const final = await notificationReadings(ctx.d, key);
    await stopWatchingNotification(ctx.d, key);
    const asked = stubs.requests().slice(requestsBefore);
    return {
      passed: opened && ended && after !== null && after.held,
      seen: `the channel ${opened ? 'opened the build' : `did not open the build within 10 s: ${JSON.stringify(ctx.out.since(outMark).slice(0, 300))}`}; the progress notification, after the press: ${describeReadings(final, at)}${after === null ? '' : after.held ? '; not drawn again over the 3 s after' : '; drawn again after it went'}; the repeating registry was asked for its listing ${asked.filter((l) => l.startsWith('repeating GET /v2/_catalog')).length} time(s), the well-behaved one answered ${asked.filter((l) => l.startsWith('well-behaved ')).length} request(s)`,
      evidence: { readings: final, requests: asked },
    };
  });

  await c.run('registries-panel.update-index-names-the-registry-whose-listing-repeats-in-the-compilers-words', {
    expected: `in that build, the channel carries "  ${stubs.repeating}: <reason>", <reason> being, unaltered, the error the server's own answer to the same aggrega/registryUpdate request, asked outside the editor over the same registries, gives for ${stubs.repeating}; and the build ends in a line opening "${INDEX_BUILD_INCOMPLETE}" whose parentheses name exactly the registries that answer names as failed, ${stubs.repeating} among them, raised as an error notification carrying the same line`,
    plant: 'in the scratch copy, out/src/registry-index-request.js made to read a build that left registries unindexed as one that completed',
  }, async () => {
    const run0 = pressed;
    need(run0 !== null, 'Update index was not pressed');
    const reason = hostIn(answer, stubs.repeating)?.error ?? '';
    need(answer !== null && answer.failed.includes(stubs.repeating) && reason !== '', `the server's own answer to the same request is not a build naming ${stubs.repeating} as failed with its reason: ${answerRaw}`);
    const channel = await ctx.out.waitFor('the index build writing its ending', run0.outMark, (t) => endingOf(t) !== null, 30000);
    const ending = endingOf(channel) ?? '';
    const lines = runLines(channel);
    const hostLine = `  ${stubs.repeating}: ${reason}`;
    const toast = await waitToast(ctx.d, 'the index build raising its ending', run0.toastMark, (t) => t.message === ending, 15000).catch(() => null);
    const named = notIndexedIn(ending);
    return {
      passed: lines.includes(hostLine) && ending.startsWith(INDEX_BUILD_INCOMPLETE) && sameSet(named, answer.failed) && toast !== null && toast.severity === 'error',
      seen: `the channel's run: ${JSON.stringify(lines)}; its ending "${ending}"; named as not indexed ${JSON.stringify(named)}; the notification: ${toast ? `"${toast.message}" (${toast.severity})` : 'none carrying the ending'}; the server's own answer names ${JSON.stringify(answer.failed)} as failed and gives ${stubs.repeating} the reason "${reason}"`,
    };
  });

  await c.run('registries-panel.update-index-reports-the-registry-beside-it-indexed', {
    expected: `in that build, the channel carries "  ${stubs.wellBehaved}: <n> entity" ("entities" where <n> is not one), <n> being the count the server's own answer to the same request gives for ${stubs.wellBehaved}, at least one; and the ending, whose parentheses name ${stubs.repeating} as not indexed, does not name ${stubs.wellBehaved} there`,
    plant: 'in the scratch copy, out/src/registry-index-request.js made to name every registry walked as not indexed',
  }, async () => {
    const run0 = pressed;
    need(run0 !== null, 'Update index was not pressed');
    const good = hostIn(answer, stubs.wellBehaved);
    need(answer !== null && good !== undefined && !good.error && good.indexed >= 1, `the server's own answer to the same request does not report ${stubs.wellBehaved} indexed: ${answerRaw}`);
    const channel = await ctx.out.waitFor('the index build writing its ending', run0.outMark, (t) => endingOf(t) !== null, 30000);
    const ending = endingOf(channel) ?? '';
    const lines = runLines(channel);
    const hostLine = `  ${stubs.wellBehaved}: ${good.indexed} ${good.indexed === 1 ? 'entity' : 'entities'}`;
    const named = notIndexedIn(ending);
    // The reading of the ending's parentheses is shown to fire on the registry it
    // must name before its silence on the one beside it is believed.
    const readsTheList = named.includes(stubs.repeating);
    return {
      passed: lines.includes(hostLine) && readsTheList && !named.includes(stubs.wellBehaved),
      seen: `the channel's run: ${JSON.stringify(lines)}; its ending "${ending}"; named as not indexed ${JSON.stringify(named)}; the server's own answer gives ${stubs.wellBehaved} ${good.indexed} indexed`,
    };
  });

  // ---- what a registration says about the trust it took ----
  const file = globalConfiguration(ctx.home);
  await c.run('registration.says-an-entry-carries-no-trust-where-none-is-advertised', {
    expected: `Add registry, given ${UNLISTENED_ONLINE} (a loopback port nothing listens on) and the global file, online, ends in a channel line opening "${REGISTRATION_SUBJECT} registered ${UNLISTENED_ONLINE} in ${file}, " whose trust clause reads "${NO_POLICY_CLAUSE}" followed, unaltered, by the reason the server's own answer to the same request gives, with nothing after it but the sentence saying the change is in effect; an information notification carries the same line (the question for a trust policy to pin by hand that follows it is pressed away)`,
    plant: 'in the scratch copy, out/src/registration-outcome.js made to drop the answer\'s reason from the trust clause',
  }, async () => {
    const ref = await referenceRegistration(ctx, UNLISTENED_ONLINE, 'no-policy');
    const trust = ref.trust;
    need(trust !== null && trust.notAdvertised === true && !trust.pinned && !trust.baseline && (trust.reason ?? '') !== '', `the server's own answer to the same request is not a registry asked and advertising nothing, with its reason: ${ref.raw}`);
    const ending = await registerThrough(ctx, UNLISTENED_ONLINE, PRESSED_AWAY);
    const reason = trust.reason ?? '';
    return {
      passed: readsCompleted(ending.line, UNLISTENED_ONLINE, file, NO_POLICY_CLAUSE, reason) && ending.toast?.message === ending.line && ending.toast.severity === 'info',
      seen: `${describeEnding(ending)}; the server's reason "${reason}"; ${describeQuestion(ending.question)}`,
    };
  });

  // ---- a trust policy pinned by hand, for the scenario's own scratch registry ----
  // It answers its trust endpoint with 404, so it is a registry that advertises no
  // trust policy; each check below takes the server's own answer for it first.
  // The registrations replace its entry, as the command line's do, and nothing
  // after them reads from it.
  const zot = registry.host;
  let declined: Ending | null = null;
  let declinedReference: { text: string | null; said: string } = { text: null, said: 'not asked' };

  await c.run('registration.asks-for-a-trust-policy-where-the-registry-advertises-none', {
    expected: `Add registry, given the scratch registry ${zot} and the global file, ends in the line saying the entry carries no policy, and is followed by a question titled "${trustByHandTitle(zot)}" whose rows are, in order, ${TRUST_BY_HAND_ROWS.map((r) => `"${r}"`).join(', ')}, first seen with that line already in the channel`,
    plant: 'in the scratch copy, out/src/registry-configure.js made to read an answer saying a registry advertises nothing as one leaving nothing to ask',
  }, async () => {
    const ref = await referenceRegistration(ctx, zot, 'zot-advertises-none');
    const trust = ref.trust;
    need(trust !== null && trust.notAdvertised === true && !trust.pinned && !trust.baseline, `the server's own answer to the same request is not a registry asked and advertising nothing: ${ref.raw}`);
    declinedReference = await commandLineReference(ctx, referenceFolder, 'zot-declined', zot, []);
    const ending = await registerThrough(ctx, zot, PRESSED_AWAY);
    declined = ending;
    const q = ending.question;
    return {
      passed: readsCompleted(ending.line, zot, file, NO_POLICY_CLAUSE, trust.reason ?? '') && q !== null && q.lineFirst && JSON.stringify(q.rows) === JSON.stringify(TRUST_BY_HAND_ROWS),
      seen: `${describeEnding(ending)}; ${describeQuestion(q)}; the server's own answer: ${ref.raw}`,
    };
  });

  await c.run('registration.declined-writes-what-the-command-line-writes', {
    expected: `in that registration, with the question pressed away, the configuration file its line names is ${file} and reads byte for byte as the one \`aggrega registry add ${zot}\`, with no trust flag, writes — run by the same compiler in the copy of the folder, over a copy of the same configuration taken just before`,
    plant: 'in the scratch copy, out/src/registry-configure.js made to state a signature requirement on every registration it composes',
  }, async () => {
    const d = declined as Ending | null;
    need(d !== null && d.question !== null, 'the registration did not reach its question, so there is nothing that was declined');
    need(declinedReference.text !== null, `the command line's reference was not written: ${declinedReference.said}`);
    const named = fileNamedBy(d.line, zot);
    const text = named !== null && fs.existsSync(named) ? fs.readFileSync(named, 'utf8') : null;
    return {
      passed: named === file && text === declinedReference.text,
      seen: `the line names ${named === null ? 'no file' : named}; ${text === null ? 'no file there' : text === declinedReference.text ? 'it reads byte for byte as the reference' : `it parts from the reference at ${firstDifference(text, declinedReference.text)}`}; ${declinedReference.said}`,
    };
  });

  await c.run('registration.refuses-a-malformed-identity-in-the-compilers-words', {
    expected: `Add registry, given ${zot} and the global file, with "${TRUST_BY_HAND_ROWS[0]}" chosen at the question and "${MALFORMED_IDENTITY}" typed as the one identity, ends its second registration in a channel line reading exactly "${REGISTRATION_SUBJECT} did not complete: code=<code> <message>", <code> and <message> being the server's own refusal of the same request carrying that identity; an error notification carries the same line`,
    plant: 'in the scratch copy, out/src/registry-configure.js made to drop, before the request goes out, an identity this side judges malformed',
  }, async () => {
    const ref = await referenceRegistration(ctx, zot, 'zot-malformed', { identities: [MALFORMED_IDENTITY], keyPath: null });
    const refusal = ref.refusal;
    need(refusal !== null, `the server's own answer to the same request is not a refusal: ${ref.raw}`);
    const ending = await registerThrough(ctx, zot, { kind: 'answered', identities: [MALFORMED_IDENTITY], keyFile: null });
    need(ending.question !== null, `the registration did not reach its question: ${describeEnding(ending)}`);
    const want = `${REGISTRATION_SUBJECT} did not complete: code=${String(refusal.code)} ${refusal.message}`;
    return {
      passed: ending.second !== null && ending.second.line === want && ending.second.toast?.message === want && ending.second.toast.severity === 'error',
      seen: `${describeSecond(ending)}; the server's refusal: code ${String(refusal.code)}, "${refusal.message}"`,
    };
  });

  const keyDir = path.join(ctx.s.root.dir, 'trust-by-hand');
  fs.mkdirSync(keyDir, { recursive: true });
  const pinnedKey = makeSigningKey(keyDir).publicPem;
  const pinnedIdentity = `${PINNED_IDENTITY.identity}=${PINNED_IDENTITY.issuer}`;
  await c.run('registration.writes-the-identities-and-key-supplied', {
    expected: `Add registry, given ${zot} and the global file, with "${TRUST_BY_HAND_ROWS[2]}" chosen at the question, "${pinnedIdentity}" typed as the one identity and ${pinnedKey} chosen in the file dialog, ends its second registration in a channel line opening "${REGISTRATION_SUBJECT} registered ${zot} in ${file}, " whose trust clause reads "${BOTH_BY_HAND_CLAUSE}", with nothing after it but the sentence saying the change is in effect, and an information notification carrying the same line; the file that line names holds an entry for ${zot} whose trusted_identities are exactly that identity and issuer and whose public_key is the chosen file's bytes, and reads byte for byte as the one \`aggrega registry add ${zot} --identity ${pinnedIdentity} --key ${pinnedKey}\` writes over a copy of the same configuration taken just before`,
    plant: 'in the scratch copy, out/src/registry-configure.js made to leave the key path out of the registration it composes from the reader\'s answers',
  }, async () => {
    const reference = await commandLineReference(ctx, referenceFolder, 'zot-by-hand', zot, ['--identity', pinnedIdentity, '--key', pinnedKey]);
    need(reference.text !== null, `the command line's reference was not written: ${reference.said}`);
    const ending = await registerThrough(ctx, zot, { kind: 'answered', identities: [pinnedIdentity], keyFile: pinnedKey });
    need(ending.question !== null, `the registration did not reach its question: ${describeEnding(ending)}`);
    const secondLine = ending.second?.line ?? '';
    const named = fileNamedBy(secondLine, zot);
    const text = named !== null && fs.existsSync(named) ? fs.readFileSync(named, 'utf8') : null;
    const entry = text === null ? null : entryFor(text, zot);
    const key = fs.readFileSync(pinnedKey, 'utf8');
    const identitiesOk = JSON.stringify(entry?.trusted_identities ?? null) === JSON.stringify([PINNED_IDENTITY]);
    const keyOk = entry?.public_key === key;
    return {
      passed: readsCompleted(secondLine, zot, file, BOTH_BY_HAND_CLAUSE, '') && ending.second?.toast?.message === secondLine && ending.second.toast.severity === 'info'
        && named === file && identitiesOk && keyOk && text === reference.text,
      seen: `${describeSecond(ending)}; the file named: ${named ?? 'none'}; its entry for ${zot}: trusted_identities ${JSON.stringify(entry?.trusted_identities ?? null)}, public_key ${keyOk ? 'the chosen file\'s bytes' : JSON.stringify((entry?.public_key ?? null)?.slice(0, 80) ?? null)}; ${text === null ? 'no file' : text === reference.text ? 'the file reads byte for byte as the reference' : `the file parts from the reference at ${firstDifference(text, reference.text)}`}`,
    };
  });

  // A file that is not a public key, chosen as the key: a private key written
  // for this check alone, in a directory of its own under the scenario's root.
  const notAKeyDir = path.join(ctx.s.root.dir, 'not-a-public-key');
  fs.mkdirSync(notAKeyDir, { recursive: true });
  const notAKey = makeSigningKey(notAKeyDir).privatePem;
  await c.run('registration.refuses-a-key-file-that-is-not-a-public-key-without-showing-its-content', {
    expected: `Add registry, given ${zot} and the global file, with "${TRUST_BY_HAND_ROWS[1]}" chosen at the question and ${notAKey} — a private key written for this check — chosen in the file dialog, ends its second registration in a channel line reading exactly "${REGISTRATION_SUBJECT} did not complete: code=<code> <message>", <code> and <message> being the server's own refusal of the same request carrying that file, the message opening with its short code and naming ${file} where the server's names the configuration file of the home it was asked in; an error notification carries the same line; and no line of that file appears anywhere in the Aggrega output channel or in any notification drawn from that registration on — read by a search first shown to find every line of the file in the file itself`,
    plant: 'in the scratch copy, out/src/registry-configure.js made to put the chosen key file\'s content in place of the value the compiler\'s refusal withholds',
  }, async () => {
    const lines = keyFileLines(notAKey);
    need(lines.length > 0 && keyLinesIn(fs.readFileSync(notAKey, 'utf8'), lines).length === lines.length, 'the search for the key file\'s lines does not find them in the file itself, so their absence anywhere else would prove nothing');
    const ref = await referenceRegistration(ctx, zot, 'zot-not-a-public-key', { identities: [], keyPath: notAKey });
    const refusal = ref.refusal;
    need(refusal !== null && /^E\d{4}: /.test(refusal.message), `the server's own answer to the same request is not a refusal opening with its short code: ${withheldFrom(ref.raw, lines)}`);
    const toastMark = (await toasts(ctx.d)).length;
    const ending = await registerThrough(ctx, zot, { kind: 'answered', identities: [], keyFile: notAKey });
    need(ending.question !== null, `the registration did not reach its question: ${withheldFrom(describeEnding(ending), lines)}`);
    // The refusal names the configuration file whose validation it refused, which
    // for the server's own answer is the reference home's; the editor's names the
    // scenario's, so that one path is read as the scenario's and nothing else is.
    const want = `${REGISTRATION_SUBJECT} did not complete: code=${String(refusal.code)} ${refusal.message.split(ref.file).join(file)}`;
    const inChannel = keyLinesIn(ctx.out.text(), lines);
    const drawn = await toastsSince(ctx.d, toastMark);
    const inDrawn = keyLinesIn(drawn.map((t) => t.message).join('\n'), lines);
    const where = (found: number[]): string => (found.length === 0 ? 'none' : `line(s) ${found.join(', ')}`);
    return {
      passed: ending.second !== null && ending.second.line === want && ending.second.toast?.message === want && ending.second.toast.severity === 'error'
        && inChannel.length === 0 && inDrawn.length === 0,
      seen: withheldFrom(`${describeSecond(ending)}; the server's refusal: code ${String(refusal.code)}, "${refusal.message}", asked in the home whose configuration is ${ref.file}; of the key file's ${lines.length} lines, the output channel carries ${where(inChannel)} and the ${drawn.length} notification(s) drawn from the registration on carry ${where(inDrawn)}`, lines),
    };
  });

  const offline = await takeOfflinePosture(ctx);

  let hubEnded = false;
  await c.run('registration.says-the-hub-took-its-built-in-baseline-offline', {
    expected: `with "offline: true" written into the global configuration and the language server restarted by the restart command to read it, Add registry, given ${HUB} and the global file, ends in a channel line opening "${REGISTRATION_SUBJECT} registered ${HUB} in ${file}, " whose trust clause reads "${BASELINE_CLAUSE}" followed, unaltered, by the reason the server's own answer to the same request in the same posture gives — the offline refusal that kept the hub from being asked — with nothing after it but the sentence saying the change is in effect; an information notification carries the same line`,
    plant: 'in the scratch copy, out/src/registration-outcome.js made to read an answer carrying the built-in baseline as one naming no trust outcome',
  }, async () => {
    need(offline.taken, `the offline posture was not taken: ${offline.said}`);
    const ref = await referenceRegistration(ctx, HUB, 'hub-offline');
    const trust = ref.trust;
    need(trust !== null && trust.baseline === true && !trust.pinned && !trust.notAdvertised && (trust.reason ?? '') !== '', `the server's own answer to the same request is not the hub pinned to its baseline alone, with its reason: ${ref.raw}`);
    const ending = await registerThrough(ctx, HUB);
    hubEnded = true;
    const reason = trust.reason ?? '';
    return {
      passed: readsCompleted(ending.line, HUB, file, BASELINE_CLAUSE, reason) && ending.toast?.message === ending.line && ending.toast.severity === 'info',
      seen: `${describeEnding(ending)}; the server's reason "${reason}"`,
    };
  });

  await c.run('registration.asks-nothing-after-the-hubs-built-in-baseline', {
    expected: `after that registration's ending, no question titled "${trustByHandTitle(HUB)}" is drawn over the 5 s that follow — read the way the question was seen drawn for ${zot}, which is the reading's positive control`,
    plant: 'in the scratch copy, out/src/registry-configure.js made to ask after every answer that pinned no advertised policy',
  }, async () => {
    const d = declined as Ending | null;
    need(hubEnded, 'the hub was not registered');
    need(d !== null && d.question !== null, `the same reading did not see the question drawn for ${zot}, so an absence of it here would prove nothing`);
    const title = trustByHandTitle(HUB);
    const quiet = await holds(5000, () => quickInput(ctx.d), (q) => q === null || q.title !== title);
    if (!quiet.held) { await ctx.d.press('Escape'); }
    return {
      passed: quiet.held,
      seen: quiet.held ? `no question drawn over ${quiet.readings} readings in 5 s` : `the question "${title}" was drawn ${quiet.atMs} ms after the ending`,
    };
  });

  let refused: Ending | null = null;
  await c.run('registration.refusal-carries-the-servers-words', {
    expected: `with the offline posture still taken, Add registry, given ${UNLISTENED_OFFLINE} (a registry other than the hub) and the global file, is refused, and the channel's closing line is exactly "${REGISTRATION_SUBJECT} did not complete: code=<code> <message>", <code> and <message> being the code and the message of the server's own refusal of the same request in the same posture, the message opening with its short code; an error notification carries the same line`,
    plant: 'in the scratch copy, out/src/error-surfaces.js made to cut the short code off the front of a language-server refusal',
  }, async () => {
    need(offline.taken, `the offline posture was not taken: ${offline.said}`);
    const ref = await referenceRegistration(ctx, UNLISTENED_OFFLINE, 'refusal');
    const refusal = ref.refusal;
    need(refusal !== null && /^E\d{4}: /.test(refusal.message), `the server's own answer to the same request is not a refusal opening with its short code: ${ref.raw}`);
    const ending = await registerThrough(ctx, UNLISTENED_OFFLINE, PRESSED_AWAY);
    refused = ending;
    const want = `${REGISTRATION_SUBJECT} did not complete: code=${String(refusal.code)} ${refusal.message}`;
    return {
      passed: ending.line === want && ending.toast?.message === want && ending.toast.severity === 'error',
      seen: `${describeEnding(ending)}; the server's refusal: code ${String(refusal.code)}, "${refusal.message}"`,
    };
  });

  await c.run('registration.asks-for-a-trust-policy-after-the-offline-refusal', {
    expected: `in that registration, the refusal — whose message the server opens with a short code and whose sentence names --identity and --key as the remedy — is followed by the question titled "${trustByHandTitle(UNLISTENED_OFFLINE)}" with the rows ${TRUST_BY_HAND_ROWS.map((r) => `"${r}"`).join(', ')}, first seen with the refusal's line already in the channel`,
    plant: 'in the scratch copy, out/src/registry-configure.js made to recognise the offline refusal by a short code it does not carry',
  }, async () => {
    const e = refused as Ending | null;
    need(e !== null && e.line.startsWith(`${REGISTRATION_SUBJECT} did not complete: `), `the registration was not refused: ${e === null ? 'not run' : describeEnding(e)}`);
    need(e.line.includes('--identity') && e.line.includes('--key'), `the refusal does not name --identity and --key as its remedy: ${describeEnding(e)}`);
    const q = e.question;
    return {
      passed: q !== null && q.lineFirst && JSON.stringify(q.rows) === JSON.stringify(TRUST_BY_HAND_ROWS),
      seen: `${describeEnding(e)}; ${describeQuestion(q)}`,
    };
  });
}
