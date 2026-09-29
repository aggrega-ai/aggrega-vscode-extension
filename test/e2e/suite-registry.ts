// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { IN_EFFECT_SENTENCE } from '../../src/config-change-watch';
import { CONFIG_WRITE_DESTINATIONS } from '../../src/config-write-scope';
import { RESTART_COMMAND } from '../../src/daemon-status';
import type { TrustFetchOutcome } from '../../src/registration-outcome';
import { addRequest, REGISTRATION_DESTINATION_PROMPT, REGISTRATION_SUBJECT, REGISTRY_ADD_COMMAND } from '../../src/registry-configure';
import { need } from './checks';
import { makeScratchHome, runCompiler, ScratchHome } from './cli';
import { UNREACHABLE_HOST } from './fixtures';
import { referenceAnswer } from './reference';
import { PUBLISHED_ENTITY, ScratchRegistry, StubRegistries, WITHDRAWN_PLUGIN_LINK } from './registry';
import { capture, closeAllEditors, ready, run, send, SuiteContext, theServer } from './suite-context';
import { INDEX_BUILD_OPENING, pressViewAction, REGISTRIES_HEAD } from './suite-storefront';
import {
  holds, NotificationReading, notificationReadings, pickQuickInputRow, pressPanelAction, QuickInput, RUNNING, stopWatchingNotification, Toast, toasts, treeRows, until,
  waitQuickInput, waitStatus, waitToast, watchNotification,
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
// the entry was given, or how the refusal reads.

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
  'registration.says-the-hub-took-its-built-in-baseline-offline',
  'registration.refusal-carries-the-servers-words',
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
const ADD_REGISTRY_TITLE = 'Aggrega: add a registry';
const GLOBAL_DESTINATION = CONFIG_WRITE_DESTINATIONS.find((d) => d.value === 'global')?.label ?? '';

// The trust clauses a registration's closing line carries for the two outcomes
// the checks below reach, held as the words a reader is to meet, so a change of
// wording is a change these checks report. The reason that follows each is the
// server's own, and is read from its answer rather than written here.
const NO_POLICY_CLAUSE = 'It advertises no signature trust policy, and this registration names no identity or key, so the entry carries none.';
const BASELINE_CLAUSE = 'The built-in trust baseline was pinned instead of an advertised policy.';

// The hosts registered. The two loopback ports are ones nothing listens on: the
// first is asked for its advertised policy while the posture is online and the ask
// is refused on this machine, so it never leaves it; the second is named once the
// posture is offline, where a registry other than the hub is not asked at all.
const HUB = 'hub.aggrega.ai';
const UNLISTENED_ONLINE = 'localhost:1';
const UNLISTENED_OFFLINE = 'localhost:2';

const globalConfiguration = (h: ScratchHome): string => path.join(h.home, '.config', 'aggrega', 'config.yaml');

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
// editor: the trust outcome it reports, or its refusal.
interface Registered { trust: TrustFetchOutcome | null; refusal: { code: unknown; message: string } | null; raw: string }

async function referenceRegistration(ctx: SuiteContext, host: string, name: string): Promise<Registered> {
  const answer = await referenceAnswer({ binary: ctx.inputs.compiler.path, root: ctx.folder, method: 'aggrega/registryAdd', params: addRequest(host, 'global'), home: referenceHome(ctx, name), table: ctx.s.table, log: ctx.cliLog });
  const raw = JSON.stringify(answer).slice(0, 600);
  if (!answer.ok) { return { trust: null, refusal: { code: answer.error.code, message: answer.error.message }, raw }; }
  return { trust: (answer.result as { trust?: TrustFetchOutcome }).trust ?? null, refusal: null, raw };
}

// Ending is how a registration made in the editor ended: the channel's closing
// line and the notification raised with it.
interface Ending { line: string; toast: Toast | null }

// registerThrough runs Add registry as a person does — the command, the host typed
// into its prompt, the global file chosen from its picker — and waits for the
// ending, and for the language server the registration restarts to read running.
async function registerThrough(ctx: SuiteContext, host: string): Promise<Ending> {
  const opening = `${REGISTRATION_SUBJECT} `;
  const mark = ctx.out.mark();
  const toastMark = (await toasts(ctx.d)).length;
  await send(ctx, REGISTRY_ADD_COMMAND);
  await waitQuickInput(ctx.d, 'the prompt for the registry host', (q) => q.title === ADD_REGISTRY_TITLE);
  await ctx.d.type(host);
  await ctx.d.press('Enter');
  await waitQuickInput(ctx.d, 'the choice of configuration file', (q) => q.placeholder === REGISTRATION_DESTINATION_PROMPT && q.rows.some((r) => r.label === GLOBAL_DESTINATION));
  await pickQuickInputRow(ctx.d, GLOBAL_DESTINATION);
  const text = await ctx.out.waitFor('the registration closing its report', mark, (t) => t.split('\n').some((l) => l.startsWith(opening)), 60000);
  const line = text.split('\n').find((l) => l.startsWith(opening)) ?? '';
  const toast = await waitToast(ctx.d, 'the registration raising its notification', toastMark, (t) => t.message.startsWith(opening), 15000).catch(() => null);
  await waitStatus(ctx.d, RUNNING, 60000).catch(() => undefined);
  return { line, toast };
}

// readsCompleted says whether a completed registration's line opens by naming the
// host and the file, and carries the trust clause followed by the server's reason
// exactly once, with nothing after the reason but the sentence saying the change
// is in effect — which the ending adds after a closing stop where the reason has
// none of its own.
function readsCompleted(line: string, host: string, file: string, clause: string, reason: string): boolean {
  const opening = `${REGISTRATION_SUBJECT} registered ${host} in ${file}, `;
  const trust = ` ${clause} ${reason}`;
  const at = line.indexOf(trust);
  if (!line.startsWith(opening) || at < opening.length || line.indexOf(trust, at + 1) !== -1) { return false; }
  const after = line.slice(at + trust.length);
  return after === '' || after === ` ${IN_EFFECT_SENTENCE}` || after === `. ${IN_EFFECT_SENTENCE}`;
}

function describeEnding(e: Ending): string {
  return `the channel: "${e.line}"; the notification: ${e.toast ? `"${e.toast.message}" (${e.toast.severity})` : 'none'}`;
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
    expected: `Add registry, given ${UNLISTENED_ONLINE} (a loopback port nothing listens on) and the global file, online, ends in a channel line opening "${REGISTRATION_SUBJECT} registered ${UNLISTENED_ONLINE} in ${file}, " whose trust clause reads "${NO_POLICY_CLAUSE}" followed, unaltered, by the reason the server's own answer to the same request gives, with nothing after it but the sentence saying the change is in effect; an information notification carries the same line`,
    plant: 'in the scratch copy, out/src/registration-outcome.js made to drop the answer\'s reason from the trust clause',
  }, async () => {
    const ref = await referenceRegistration(ctx, UNLISTENED_ONLINE, 'no-policy');
    const trust = ref.trust;
    need(trust !== null && trust.notAdvertised === true && !trust.pinned && !trust.baseline && (trust.reason ?? '') !== '', `the server's own answer to the same request is not a registry asked and advertising nothing, with its reason: ${ref.raw}`);
    const ending = await registerThrough(ctx, UNLISTENED_ONLINE);
    const reason = trust.reason ?? '';
    return {
      passed: readsCompleted(ending.line, UNLISTENED_ONLINE, file, NO_POLICY_CLAUSE, reason) && ending.toast?.message === ending.line && ending.toast.severity === 'info',
      seen: `${describeEnding(ending)}; the server's reason "${reason}"`,
    };
  });

  const offline = await takeOfflinePosture(ctx);

  await c.run('registration.says-the-hub-took-its-built-in-baseline-offline', {
    expected: `with "offline: true" written into the global configuration and the language server restarted by the restart command to read it, Add registry, given ${HUB} and the global file, ends in a channel line opening "${REGISTRATION_SUBJECT} registered ${HUB} in ${file}, " whose trust clause reads "${BASELINE_CLAUSE}" followed, unaltered, by the reason the server's own answer to the same request in the same posture gives — the offline refusal that kept the hub from being asked — with nothing after it but the sentence saying the change is in effect; an information notification carries the same line`,
    plant: 'in the scratch copy, out/src/registration-outcome.js made to read an answer carrying the built-in baseline as one naming no trust outcome',
  }, async () => {
    need(offline.taken, `the offline posture was not taken: ${offline.said}`);
    const ref = await referenceRegistration(ctx, HUB, 'hub-offline');
    const trust = ref.trust;
    need(trust !== null && trust.baseline === true && !trust.pinned && !trust.notAdvertised && (trust.reason ?? '') !== '', `the server's own answer to the same request is not the hub pinned to its baseline alone, with its reason: ${ref.raw}`);
    const ending = await registerThrough(ctx, HUB);
    const reason = trust.reason ?? '';
    return {
      passed: readsCompleted(ending.line, HUB, file, BASELINE_CLAUSE, reason) && ending.toast?.message === ending.line && ending.toast.severity === 'info',
      seen: `${describeEnding(ending)}; the server's reason "${reason}"`,
    };
  });

  await c.run('registration.refusal-carries-the-servers-words', {
    expected: `with the offline posture still taken, Add registry, given ${UNLISTENED_OFFLINE} (a registry other than the hub) and the global file, is refused, and the channel's closing line is exactly "${REGISTRATION_SUBJECT} did not complete: code=<code> <message>", <code> and <message> being the code and the message of the server's own refusal of the same request in the same posture, the message opening with its short code; an error notification carries the same line`,
    plant: 'in the scratch copy, out/src/error-surfaces.js made to cut the short code off the front of a language-server refusal',
  }, async () => {
    need(offline.taken, `the offline posture was not taken: ${offline.said}`);
    const ref = await referenceRegistration(ctx, UNLISTENED_OFFLINE, 'refusal');
    const refusal = ref.refusal;
    need(refusal !== null && /^E\d{4}: /.test(refusal.message), `the server's own answer to the same request is not a refusal opening with its short code: ${ref.raw}`);
    const ending = await registerThrough(ctx, UNLISTENED_OFFLINE);
    const want = `${REGISTRATION_SUBJECT} did not complete: code=${String(refusal.code)} ${refusal.message}`;
    return {
      passed: ending.line === want && ending.toast?.message === want && ending.toast.severity === 'error',
      seen: `${describeEnding(ending)}; the server's refusal: code ${String(refusal.code)}, "${refusal.message}"`,
    };
  });
}
