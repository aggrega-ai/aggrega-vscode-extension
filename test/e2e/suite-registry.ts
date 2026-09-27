// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { need } from './checks';
import { runCompiler } from './cli';
import { UNREACHABLE_HOST } from './fixtures';
import { PUBLISHED_ENTITY, ScratchRegistry, WITHDRAWN_PLUGIN_LINK } from './registry';
import { capture, closeAllEditors, ready, run, SuiteContext } from './suite-context';
import { pressViewAction } from './suite-storefront';
import {
  commandsPanel, pickQuickInputRow, pressOperation, QuickInput, toasts, treeRows, until, waitQuickInput, waitToast,
} from './workbench';

// The checks run in the storefront folder with a scratch registry configured
// beside an unreachable one: the published-catalog search over an index that
// holds a withdrawn version, what the channel says about each registry's index,
// and the withdrawal a plugin attachment would name.

export const REGISTRY_CHECKS = [
  'catalog-search.lists-matches-and-copies-a-reference',
  'catalog-search.rows-carry-no-withdrawal-marking',
  'catalog-search.index-freshness-is-named-in-the-channel',
  'catalog-search.stale-index-is-named',
  'catalog-search.nothing-matched-names-the-filter',
  'catalog-search.index-sentences-direct-the-reader',
  'plugins.add-names-the-withdrawn-version-it-passed-over',
  'side-bar.plugins-and-registries-views-refresh-without-a-network',
] as const;

const SEARCH_TITLE = 'Aggrega: search published catalog';
const QUERY = 'adminer';
const NO_MATCH_QUERY = 'no-entity-is-called-this';

// The empty answer for a filter nothing matched opens with these words, and the
// channel's remediation reads so. Both are held as the words a reader is to
// meet, so a change of wording is a change these checks report.
const NO_MATCHES_OPENING = 'Aggrega: no catalog matches for ';
const REFRESH_REMEDIATION = 'Refresh with “Update the searchable index” in the Registries panel.';

interface SearchRecord { uri: string; name: string; version: string; kind: string; description?: string; retracted?: string[] }

// searchFor runs one search through the palette: the query facet set, then
// Search. It returns the drawn answer list, or null where the search answered
// with a notification instead.
async function searchFor(ctx: SuiteContext, query: string): Promise<QuickInput | null> {
  await closeAllEditors(ctx);
  await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.catalog.searchPublished');
  await waitQuickInput(ctx.d, 'the search palette', (q) => q.title === SEARCH_TITLE);
  await pickQuickInputRow(ctx.d, 'Query');
  await waitQuickInput(ctx.d, 'the query being asked for', (q) => q.rows.length === 0 || q.title !== SEARCH_TITLE);
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

export async function registryChecks(ctx: SuiteContext, registry: ScratchRegistry): Promise<void> {
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
    question: `The channel sends the reader to "Update the searchable index" in the Registries panel. Does that, and the empty answer below, direct the reader well?`,
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
}
