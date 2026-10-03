// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { need } from './checks';
import { runCompiler } from './cli';
import { CHART_ONLY, SIZED_VOLUME, SIZING_LIBRARY } from './fixtures';
import { pressNode, settledPanel, showGraph } from './graph-panel';
import { referenceAnswer, ReferenceRequest } from './reference';
import { closeAllEditors, commandTitle, lineOf, Line, open, ready, run, SuiteContext } from './suite-context';
import { drawnAsAnswered, PENDING } from './suite-graph-panel';
import { shownOptions } from './suite-inspection';
import { selectRelease } from './suite-own-catalogs';
import {
  commandsPanel, describeRowMenu, pressMenuItem, pressOperation, pressTreeRowAction, revealTreeRow, rowMenu, selectorRows, sleep, treeRows, until,
} from './workbench';

// The checks run in a copy of the documentation example whose Releases each read
// a catalog variant of their own, with two entities added so a request answered
// in one Release's terms reads differently in another's (fixtures.ts says which
// and why). Each surface drawn from such a request is read with no Release
// selected, then with each of two Releases selected in turn, and each reading is
// held against the language server's own answer to the same request naming the
// same Release — or none — asked outside the editor over a second copy.

export const SELECTED_RELEASE_CHECKS = [
  'no-release.each-surface-answers-in-the-workspaces-own-terms',
  'catalog-panel.lists-what-the-selected-release-reads-and-follows-the-selection',
  'go-to-definition.opens-the-selected-releases-variant',
  'hover.renders-the-selected-releases-variant',
  'completion.offers-what-the-selected-releases-catalog-declares',
  'inspect.resolves-in-the-selected-releases-terms',
  'catalog-row.check-runs-in-the-selected-releases-terms',
  'may-attach.lists-the-selected-releases-features',
] as const;

const COMPOSE = 'release-compose.yaml';
const CHART = 'release-helm-chart.yaml';
const SYNTH = 'release-helm-synth.yaml';

// READ_IN are the two Releases the per-surface checks select in turn. Their
// variants of the database Component hover differently, and only the second
// reads the catalog directory declaring CHART_ONLY.
const READ_IN = [COMPOSE, CHART] as const;

// GRAPH_RELEASE is the Release whose graph the check of what may attach draws,
// and the one the scenario writes a lockfile for in both copies.
export const GRAPH_RELEASE = COMPOSE;

// DRAWN_MS is the order of what the drawing a press on Graph asks for takes a
// correct editor on an idle machine for this folder's small topology, the panel's
// first opening included: a few seconds. The wait runs to its guard, so a busy
// machine is allowed for, and a drawing that never comes ends the check in that
// guard rather than in the shared default's.
const DRAWN_MS = 10000;

const MARIADB = 'core/datastore/mariadb';
const TYPE_LINE = `type: ${MARIADB}`;
const COMPONENTS = 'Component';
const DB_NODE = 'db';
const CHECK = 'The check';

type Terms = string | null;
const termsName = (release: Terms): string => release ?? 'no Release';

// named is a request's parameters as the editor sends them: naming the Release
// where one is selected and carrying no release key where none is.
const named = (params: Record<string, unknown>, release: Terms): Record<string, unknown> => (release === null ? { ...params } : { ...params, release });

// Reading is one surface read in one Release's terms, held against the server.
interface Reading { release: Terms; same: boolean; seen: string }

function verdict(readings: Reading[]): { passed: boolean; seen: string } {
  return {
    passed: readings.length > 0 && readings.every((r) => r.same),
    seen: readings.map((r) => `${termsName(r.release)}: ${r.seen}`).join(' || '),
  };
}

interface Active { path: string; isUntitled?: boolean; text?: string }

export async function selectedReleaseChecks(ctx: SuiteContext, reference: string): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  const aggregate = path.join(ctx.folder, 'aggregate.yaml');
  const refAggregate = path.join(reference, 'aggregate.yaml');
  const refUri = `file://${refAggregate}`;
  const inspectRow = commandTitle(ctx.manifest, 'aggrega.workspaceCatalog.inspect');
  const validateItem = commandTitle(ctx.manifest, 'aggrega.workspaceCatalog.validate');
  await ready(ctx);

  // ---- the server's own answers, outside the editor ----
  const answer = async (method: string, params: Record<string, unknown>, first: ReferenceRequest[] = []): Promise<unknown> => {
    const a = await referenceAnswer({ binary: bin, root: reference, method, params, first, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(a.ok, `the language server gave no answer to ${method} ${JSON.stringify(params)} over the reference copy: ${a.ok ? '' : a.error.message}`);
    return a.result;
  };
  // A request about a position in the Aggregate is answered once the server has
  // validated it, which the editor does as the document opens.
  const validatedFirst = (release: Terms): ReferenceRequest[] => [{ method: 'aggrega/validate', params: named({ file: refAggregate, content: fs.readFileSync(refAggregate, 'utf8') }, release) }];
  const relativeTo = (root: string, uri: string): string => path.relative(root, uri.startsWith('file:') ? fileURLToPath(uri) : uri);

  let typeLine: Line | null = null;
  const atType = async (): Promise<Line> => {
    typeLine ??= await lineOf(ctx, aggregate, TYPE_LINE);
    return typeLine;
  };
  const inName = async (): Promise<{ line: number; character: number }> => {
    const l = await atType();
    return { line: l.index, character: l.text.indexOf(MARIADB) + 5 };
  };
  const atValue = async (): Promise<{ line: number; character: number }> => {
    const l = await atType();
    return { line: l.index, character: l.text.indexOf('type: ') + 'type: '.length };
  };

  // ---- the readings, each against the server's answer for the same Release ----

  // The Catalog panel: its Component heading, counting the rows under it, and the
  // document its first database row opens — read once the heading is the one the
  // answer gives, which is how a list read again after the selection moved is
  // waited for without pressing its refresh.
  //
  // 🔴 NOTHING IS CLOSED BETWEEN A MOVE OF THE SELECTION AND THIS READING WHERE THE
  // READING IS TO SHOW THE PANEL FOLLOWED THE MOVE. The editor closing a document
  // has the panel read its list again too, so a reading that closed the editors
  // first would see the list read in the new Release's terms whether or not the
  // move itself had it read — and a panel that does not follow the selection would
  // pass. Such a reading is taken with closeFirst false, after the editors were
  // closed and their reads had settled before the selection moved.
  const catalogReading = async (release: Terms, closeFirst: boolean): Promise<Reading> => {
    const index = await answer('aggrega/catalogIndex', named({}, release)) as { entities?: { kind: string; name: string; file: string }[] };
    const components = (index.entities ?? []).filter((e) => e.kind === COMPONENTS);
    const heading = `${COMPONENTS} (${components.length})`;
    const firstDb = components.find((e) => e.name === MARIADB)?.file ?? '';
    if (closeFirst) { await closeAllEditors(ctx); }
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    const rows = await until(`the Catalog panel heading its Components "${heading}"`, 20000, () => treeRows(ctx.d, 'Catalog'), (v) => (v ?? []).some((r) => r.label === heading))
      .catch(() => treeRows(ctx.d, 'Catalog'));
    const drawn = (rows ?? []).find((r) => r.label.startsWith(`${COMPONENTS} (`))?.label ?? 'no Component heading';
    // Waited for as the document the answer names, since a reading taken with the
    // editors left open can find an earlier reading's variant still in front.
    await ctx.d.click(await revealTreeRow(ctx.d, 'Catalog', MARIADB));
    const active = await until(`the first ${MARIADB} row's document, ${firstDb}, opening`, 10000, () => ctx.probe.request<Active | null>('editor.active'), (v) => v !== null && path.relative(ctx.folder, v.path) === firstDb)
      .catch(() => ctx.probe.request<Active | null>('editor.active'));
    const opened = active ? path.relative(ctx.folder, active.path) : 'nothing';
    const same = drawn === heading && opened === firstDb;
    return { release, same, seen: `the panel heads its Components "${drawn}" and its first ${MARIADB} row opens ${opened}; the answer lists ${components.length} (${components.map((e) => e.file).join(', ')}), its first ${MARIADB} in ${firstDb}` };
  };

  const definitionReading = async (release: Terms): Promise<Reading> => {
    const at = await inName();
    const ref = await answer('aggrega/resolve', named({ uri: refUri, position: at }, release), validatedFirst(release)) as { location?: { uri: string } | null };
    const want = ref.location ? relativeTo(reference, ref.location.uri) : 'no location';
    await open(ctx, aggregate);
    const locs = await run<Array<{ uri?: string; targetUri?: string }> | null>(ctx, 'vscode.executeDefinitionProvider', [{ $file: aggregate }, { $position: at }], 25000).catch(() => null);
    const got = (locs ?? []).map((l) => relativeTo(ctx.folder, l.uri ?? l.targetUri ?? ''));
    return { release, same: got.length === 1 && got[0] === want, seen: `go-to-definition opens ${JSON.stringify(got)}; the answer locates ${want}` };
  };

  const hoverReading = async (release: Terms): Promise<Reading> => {
    const at = await inName();
    const ref = await answer('aggrega/hover', named({ uri: refUri, position: at }, release), validatedFirst(release)) as { contents?: { value?: string } | null };
    const want = ref.contents?.value ?? '';
    need(want !== '', `the language server's own hover over ${MARIADB} in ${termsName(release)}'s terms is empty`);
    await open(ctx, aggregate);
    const hovers = await run<{ contents?: ({ value?: string } | string)[] }[] | null>(ctx, 'vscode.executeHoverProvider', [{ $file: aggregate }, { $position: at }], 25000).catch(() => null);
    const texts = (hovers ?? []).flatMap((h) => (h.contents ?? []).map((x) => (typeof x === 'string' ? x : x.value ?? '')));
    const same = texts.length === 1 && texts[0] === want;
    return { release, same, seen: `the hover ${same ? 'reads the answer' : `reads ${JSON.stringify(texts.map((t) => t.slice(-160)))}`}, whose excerpt ends ${JSON.stringify(want.slice(-160))}` };
  };

  const completionReading = async (release: Terms): Promise<Reading> => {
    const at = await atValue();
    const ref = await answer('aggrega/completion', named({ uri: refUri, position: at }, release), validatedFirst(release)) as { items?: { label: string }[] } | null;
    const want = (ref?.items ?? []).map((i) => i.label).sort();
    await open(ctx, aggregate);
    const list = await run<{ items?: { label: string | { label: string } }[] } | null>(ctx, 'vscode.executeCompletionItemProvider', [{ $file: aggregate }, { $position: at }], 25000).catch(() => null);
    const got = (list?.items ?? []).map((i) => (typeof i.label === 'string' ? i.label : i.label.label)).sort();
    return { release, same: JSON.stringify(got) === JSON.stringify(want), seen: `completion offers ${JSON.stringify(got)}; the answer offers ${JSON.stringify(want)}` };
  };

  // An inspection, from the Commands panel's Inspect or from the Catalog row's
  // own action, read as the new document it opens.
  const inspectionReading = async (release: Terms, from: 'commands' | 'row'): Promise<Reading> => {
    const ref = await answer('aggrega/entityDefinition', named({ name: MARIADB }, release));
    const want = JSON.stringify(ref, null, 2).split(reference).join(ctx.folder);
    await closeAllEditors(ctx);
    let how = '';
    if (from === 'commands') {
      await run(ctx, 'workbench.view.extension.aggrega');
      const panel = await commandsPanel(ctx.d);
      await pressOperation(ctx.d, panel, 'aggrega.op.inspect');
      const offered = await until(`the Inspect menu offering ${MARIADB}`, 20000, () => shownOptions(panel), (v) => v.includes(MARIADB));
      await ctx.d.type(MARIADB);
      const narrowed = await until(`the Inspect menu narrowed to ${MARIADB}`, 5000, () => shownOptions(panel), (v) => v.length > 0 && v.every((o) => o === MARIADB));
      await ctx.d.press('Enter');
      how = `the Commands panel's Inspect, its menu offering ${offered.length} entities and ${narrowed.length} ${MARIADB} once narrowed`;
    } else {
      await run(ctx, 'aggrega.workspaceCatalog.focus');
      await pressTreeRowAction(ctx.d, 'Catalog', MARIADB, inspectRow);
      how = `the Catalog row's "${inspectRow}"`;
    }
    const doc = await until('the definition opening as a new document', 20000, () => ctx.probe.request<Active | null>('editor.active'), (v) => v !== null && v.isUntitled === true)
      .catch(() => ctx.probe.request<Active | null>('editor.active'));
    const text = doc?.isUntitled ? doc.text ?? '' : null;
    if (doc?.isUntitled) { await run(ctx, 'workbench.action.revertAndCloseActiveEditor').catch(() => undefined); }
    const file = (JSON.parse(want) as { file?: string }).file ?? '';
    return { release, same: text === want, seen: `${how} opened ${text === null ? 'no new document' : text === want ? `the answer, resolving ${MARIADB} to ${file}` : `${JSON.stringify(text.slice(0, 200))} where the answer, resolving ${MARIADB} to ${file}, reads ${JSON.stringify(want.slice(0, 200))}`}` };
  };

  // The Catalog row's correctness check on the volume, read as the command line
  // the channel shows and the line the check closes on, against the compiler run
  // with the same path and the same Release over the reference copy.
  const rowCheckReading = async (release: Terms): Promise<Reading> => {
    const args = ['validate', SIZED_VOLUME.file, ...(release === null ? [] : ['--release', release])];
    const cli = await runCompiler(bin, args, { cwd: reference, home: ctx.home, boundMs: 120000, log: ctx.cliLog });
    const want = cli.status === 0 ? `${CHECK} checked ${SIZED_VOLUME.file}.` : `${CHECK} did not complete: the compiler exited with status ${cli.status}: ${cli.stderr.trim()}`;
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    const menu = await rowMenu(ctx.d, 'Catalog', SIZED_VOLUME.name);
    need(menu.reached && menu.items.includes(validateItem), `the "${SIZED_VOLUME.name}" row's context menu offers no "${validateItem}" to press: ${describeRowMenu(menu)}`);
    const mark = ctx.out.mark();
    const taken = await pressMenuItem(ctx.d, validateItem);
    need(taken !== null, `the context menu draws no "${validateItem}" item to press`);
    const text = await ctx.out.waitFor('the check closing on the channel', mark, (t) => t.split('\n').some((l) => l.startsWith(`${CHECK} `)), 60000).catch(() => ctx.out.since(mark));
    const lines = text.split('\n');
    const command = (lines.find((l) => l.startsWith('$ ')) ?? '').replace(/\s+\(cwd: .*\)$/, '');
    const at = lines.findIndex((l) => l.startsWith(`${CHECK} `));
    const closing = at === -1 ? '' : lines.slice(at, at + want.split('\n').length).join('\n');
    const invoked = `$ ${bin} ${args.join(' ')}`;
    return { release, same: command === invoked && closing === want, seen: `the channel ran ${JSON.stringify(command)} and closed ${JSON.stringify(closing.slice(0, 300))}; the compiler outside the editor, run as ${JSON.stringify(args.join(' '))}, exited ${cli.status}` };
  };

  // ---- with no Release selected ----
  await c.run('no-release.each-surface-answers-in-the-workspaces-own-terms', {
    expected: `with the Release row reading "none selected", each surface reads the language server's own answer to the request naming no Release, over a copy of the folder: the Catalog panel's Component heading and the document its first ${MARIADB} row opens, go-to-definition and hover at "${TYPE_LINE}" in aggregate.yaml, completion at that type, the Commands panel's Inspect of ${MARIADB}, and the Catalog row's check of ${SIZED_VOLUME.name}, run as \`aggrega validate ${SIZED_VOLUME.file}\` with no --release`,
    plant: 'in the scratch copy, out/src/release-terms.js with the composition naming release-compose.yaml where no Release is selected',
  }, async () => {
    const rows = await selectorRows(await commandsPanel(ctx.d));
    const row = rows.find((r) => r.label === 'Release');
    need(row !== undefined && row.value === 'none selected', `the Release row reads ${JSON.stringify(row?.value ?? 'nothing')}, so the scenario does not start with no Release selected`);
    return verdict([
      await catalogReading(null, true),
      await definitionReading(null),
      await hoverReading(null),
      await completionReading(null),
      await inspectionReading(null, 'commands'),
      await rowCheckReading(null),
    ]);
  });

  // ---- each surface with each of two Releases selected ----
  const inEach = async (read: (release: string) => Promise<Reading>): Promise<{ passed: boolean; seen: string }> => {
    const readings: Reading[] = [];
    for (const release of READ_IN) {
      await selectRelease(ctx, release);
      readings.push(await read(release));
    }
    return verdict(readings);
  };

  await c.run('catalog-panel.lists-what-the-selected-release-reads-and-follows-the-selection', {
    expected: `with ${READ_IN.join(' and then ')} selected in turn on the Release row, the Catalog panel reads its list again with nothing pressed in it, and heads its Components with the count the language server's own catalog index names for that Release, its first ${MARIADB} row opening the document that answer names — that Release's own variant`,
    plant: 'in the scratch copy, out/src/extension.js with the catalog index asked with no Release, whichever is selected; or with the Catalog panel not read again when the selection moves',
  }, async () => {
    // The editors are closed, and the reads their closing asks for given time to
    // land, before the selection first moves; nothing is closed after that.
    await closeAllEditors(ctx);
    await sleep(3000);
    return inEach((r) => catalogReading(r, false));
  });

  await c.run('go-to-definition.opens-the-selected-releases-variant', {
    expected: `with ${READ_IN.join(' and then ')} selected in turn, go-to-definition at "${TYPE_LINE}" in aggregate.yaml opens the one document the language server's own aggrega/resolve names for that Release — that Release's variant of ${MARIADB}`,
    plant: 'in the scratch copy, out/src/translator.js with go-to-definition composed with no Release',
  }, () => inEach((r) => definitionReading(r)));

  await c.run('hover.renders-the-selected-releases-variant', {
    expected: `with ${READ_IN.join(' and then ')} selected in turn, the hover at "${TYPE_LINE}" in aggregate.yaml is the one text the language server's own aggrega/hover answers for that Release, which renders that Release's variant: the two differ in the schema excerpt they show`,
    plant: 'in the scratch copy, out/src/translator.js with the hover composed with no Release',
  }, () => inEach((r) => hoverReading(r)));

  await c.run('completion.offers-what-the-selected-releases-catalog-declares', {
    expected: `with ${READ_IN.join(' and then ')} selected in turn, completion at the database's type in aggregate.yaml offers exactly the labels the language server's own aggrega/completion offers for that Release — ${CHART_ONLY.name}, which only ${CHART}'s catalog directory declares, among them in that Release's terms alone`,
    plant: 'in the scratch copy, out/src/translator.js with completion composed with no Release',
  }, () => inEach((r) => completionReading(r)));

  await c.run('inspect.resolves-in-the-selected-releases-terms', {
    expected: `with ${COMPOSE} selected, the Commands panel's Inspect of ${MARIADB}, and with ${CHART} selected, the Catalog row's "${inspectRow}" on it, each open as a new document the language server's own aggrega/entityDefinition answer for that name naming that Release, which resolves it to that Release's variant`,
    plant: 'in the scratch copy, out/src/extension.js with an inspection asked with no Release, whichever is selected',
  }, () => inEach((r) => inspectionReading(r, r === COMPOSE ? 'commands' : 'row')));

  await c.run('catalog-row.check-runs-in-the-selected-releases-terms', {
    expected: `the "${validateItem}" of the Catalog row ${SIZED_VOLUME.name} — a document under no catalog directory whose storage composes the ${SIZING_LIBRARY} library — runs \`aggrega validate ${SIZED_VOLUME.file} --release <the selected Release>\` and closes on the line the compiler's own run of that command over a copy of the folder gives: with ${SYNTH} selected the check passes, and with ${COMPOSE} selected it fails in the compiler's words, ${COMPOSE}'s catalog declaring no ${SIZING_LIBRARY}`,
    plant: 'in the scratch copy, out/src/catalog-entity-operations.js with the row\'s check composed with no --release',
  }, async () => {
    const readings: Reading[] = [];
    for (const release of [SYNTH, COMPOSE]) {
      await selectRelease(ctx, release);
      readings.push(await rowCheckReading(release));
    }
    return verdict(readings);
  });

  await c.run('may-attach.lists-the-selected-releases-features', {
    expected: `with ${GRAPH_RELEASE} selected and its graph shown, the list of what may attach to its ${DB_NODE} node draws, row for row, the language server's own aggrega/attachCandidates answer for that node of that Release's graph — each Feature declared in ${GRAPH_RELEASE}'s own catalog directory`,
    plant: 'in the scratch copy, out/src/attachment-edit.js with what may attach asked with no Release; or media/graph.js with the panel saying it listens before its listener is in place',
  }, async () => {
    const ref = await answer('aggrega/attachCandidates', { graphNode: DB_NODE, release: GRAPH_RELEASE }) as Parameters<typeof drawnAsAnswered>[1];
    await selectRelease(ctx, GRAPH_RELEASE);
    await closeAllEditors(ctx);
    const doc = await showGraph(ctx, DRAWN_MS);
    await pressNode(ctx, doc, DB_NODE);
    const p = await settledPanel(doc, DB_NODE, PENDING);
    const drawn = drawnAsAnswered(p, ref);
    return { passed: drawn.same, seen: `${drawn.seen}${p.candidates?.failed ? `; the list reads "${p.candidates.failed}"` : ''}` };
  });
}
