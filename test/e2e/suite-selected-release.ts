// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { featuresNotOfferedLine } from '../../src/attach-candidates';
import { CatalogIndexDoc, linksLeadingOutRow } from '../../src/workspace-catalog-run';
import { need, NotRun } from './checks';
import { runCompiler } from './cli';
import { CHART_ONLY, SIZED_VOLUME, SIZING_LIBRARY } from './fixtures';
import { pressNode, settledPanel, showGraph } from './graph-panel';
import { referenceAnswer, ReferenceRequest } from './reference';
import { closeAllEditors, commandTitle, lineOf, Line, open, ready, run, SuiteContext } from './suite-context';
import { drawnAsAnswered, PENDING } from './suite-graph-panel';
import { shownOptions } from './suite-inspection';
import { selectRelease } from './suite-own-catalogs';
import { pressViewAction } from './suite-storefront';
import {
  commandsPanel, describeRowMenu, pressMenuItem, pressOperation, pressTreeRowAction, revealTreeRow, rowMenu, selectorRows, sleep, treeRows, until,
} from './workbench';

// The checks run in a copy of the documentation example whose Releases each read
// a catalog variant of their own, with two entities added so a request answered
// in one Release's terms reads differently in another's (fixtures.ts says which
// and why). Each surface drawn from such a request is read with no Release
// selected, then with each of two Releases selected in turn, and each reading is
// held against the language server's own answer to the same request naming the
// same Release — or none — asked outside the editor over a second copy. The
// Catalog panel and the list of what may attach read no word about links leading
// out of the workspace while the folder holds none; the last two checks place one
// at the top of the folder, leading to a Feature document outside it, and read
// what each says about it against the language server's own answer over the
// folder itself.

export const SELECTED_RELEASE_CHECKS = [
  'no-release.each-surface-answers-in-the-workspaces-own-terms',
  'catalog-panel.lists-what-the-selected-release-reads-and-follows-the-selection',
  'go-to-definition.opens-the-selected-releases-variant',
  'hover.renders-the-selected-releases-variant',
  'completion.offers-what-the-selected-releases-catalog-declares',
  'inspect.resolves-in-the-selected-releases-terms',
  'catalog-row.check-runs-in-the-selected-releases-terms',
  'may-attach.lists-the-selected-releases-features',
  'catalog-panel.names-the-link-leading-out-of-the-workspace',
  'may-attach.names-the-link-leading-out-of-the-workspace',
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

// LINK is the link the last two checks place at the top of the folder, under no
// catalog directory, so every Release's terms hold its place; it leads to
// BEHIND_THE_LINK, a Feature document written beside the folder, outside the
// workspace.
const LINK = 'linked-feature.yaml';
const BEHIND_THE_LINK = { name: 'local/reached-through-a-link', file: 'feature-outside-the-workspace.yaml' };
const BEHIND_THE_LINK_DOCUMENT = `apiVersion: aggrega.ai/v1alpha1
kind: Feature
metadata:
  name: ${BEHIND_THE_LINK.name}
  version: 1.0.0
  description: A Feature kept outside the workspace, which the workspace reaches only through a link.
`;

// placeLinkLeadingOut writes BEHIND_THE_LINK beside the folder and places LINK in
// the folder leading to it, refusing as not run where either cannot be placed or
// the link does not read the file through. It answers with the link's name
// relative to the folder, in the form the language server names a path.
function placeLinkLeadingOut(folder: string): { link: string; rel: string } {
  const outside = path.join(path.dirname(folder), 'outside-the-workspace', BEHIND_THE_LINK.file);
  const link = path.join(folder, LINK);
  try {
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, BEHIND_THE_LINK_DOCUMENT);
    fs.symlinkSync(outside, link, 'file');
  } catch (err) {
    throw new NotRun(`the link to a Feature outside the workspace could not be placed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!path.relative(folder, outside).startsWith('..') || fs.readFileSync(link, 'utf8') !== BEHIND_THE_LINK_DOCUMENT) {
    throw new NotRun(`${outside} is not outside ${folder}, or ${link} does not read it through the link`);
  }
  return { link, rel: path.relative(folder, link).split(path.sep).join('/') };
}

// LINKS_ROW_HEADS are the words the Catalog panel's row naming links leading out
// of the workspace opens with, for one link and for several, read off the
// extension's own composition of the row rather than typed here: a row opening
// with either is that row, whatever links it names.
const LINKS_ROW_HEADS = [['\u0000'], ['\u0000', '\u0000']].map((names) => {
  const label = linksLeadingOutRow({ entities: [], unreadLinkedDirs: names, unreadLinkedFiles: [] })?.label ?? '';
  return label.slice(0, label.indexOf('\u0000')).trimEnd();
});

function isLinksRow(label: string): boolean {
  return LINKS_ROW_HEADS.some((head) => head !== '' && label.startsWith(head));
}

// namesNoLink reads whether an index answer carries both lists of links leading
// out of the workspace, and names none in either.
function namesNoLink(index: Partial<CatalogIndexDoc>): boolean {
  return Array.isArray(index.unreadLinkedDirs) && index.unreadLinkedDirs.length === 0
    && Array.isArray(index.unreadLinkedFiles) && index.unreadLinkedFiles.length === 0;
}

function describeLinks(index: Partial<CatalogIndexDoc>): string {
  return `links to directories ${JSON.stringify(index.unreadLinkedDirs ?? null)} and to files ${JSON.stringify(index.unreadLinkedFiles ?? null)}`;
}

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
  //
  // The folder holds no link leading out of the workspace while these readings
  // are taken, so each also requires the answer to name none and the panel to
  // draw no row naming one.
  const catalogReading = async (release: Terms, closeFirst: boolean): Promise<Reading> => {
    const index = await answer('aggrega/catalogIndex', named({}, release)) as Partial<CatalogIndexDoc>;
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
    const linkRows = (rows ?? []).map((r) => r.label).filter(isLinksRow);
    const same = drawn === heading && opened === firstDb && namesNoLink(index) && linkRows.length === 0;
    return { release, same, seen: `the panel heads its Components "${drawn}" and its first ${MARIADB} row opens ${opened}; the answer lists ${components.length} (${components.map((e) => e.file).join(', ')}), its first ${MARIADB} in ${firstDb}; the answer names ${describeLinks(index)}, and the panel draws ${linkRows.length === 0 ? 'no row naming a link leading out' : `rows naming links leading out: ${JSON.stringify(linkRows)}`}` };
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
    expected: `with the Release row reading "none selected", each surface reads the language server's own answer to the request naming no Release, over a copy of the folder: the Catalog panel's Component heading and the document its first ${MARIADB} row opens — that answer naming no link leading out of the workspace, and the panel drawing no row naming one — go-to-definition and hover at "${TYPE_LINE}" in aggregate.yaml, completion at that type, the Commands panel's Inspect of ${MARIADB}, and the Catalog row's check of ${SIZED_VOLUME.name}, run as \`aggrega validate ${SIZED_VOLUME.file}\` with no --release`,
    plant: 'in the scratch copy, out/src/release-terms.js with the composition naming release-compose.yaml where no Release is selected; or out/src/workspace-catalog-run.js with the index answer read as naming a link to a file it does not name',
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
    expected: `with ${READ_IN.join(' and then ')} selected in turn on the Release row, the Catalog panel reads its list again with nothing pressed in it, and heads its Components with the count the language server's own catalog index names for that Release, its first ${MARIADB} row opening the document that answer names — that Release's own variant — and, that answer naming no link leading out of the workspace, draws no row naming one`,
    plant: 'in the scratch copy, out/src/extension.js with the catalog index asked with no Release, whichever is selected; or with the Catalog panel not read again when the selection moves; or out/src/workspace-catalog-run.js with the index answer read as naming a link to a file it does not name',
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
    expected: `with ${GRAPH_RELEASE} selected and its graph shown, the list of what may attach to its ${DB_NODE} node draws, row for row, the language server's own aggrega/attachCandidates answer for that node of that Release's graph — each Feature declared in ${GRAPH_RELEASE}'s own catalog directory — and, the language server's own aggrega/catalogIndex answer in that Release's terms naming no link leading out of the workspace, no line naming one`,
    plant: 'in the scratch copy, out/src/attachment-edit.js with what may attach asked with no Release; or media/graph.js with the panel saying it listens before its listener is in place; or out/src/workspace-catalog-run.js with the index answer read as naming a link to a file it does not name',
  }, async () => {
    const ref = await answer('aggrega/attachCandidates', { graphNode: DB_NODE, release: GRAPH_RELEASE }) as Parameters<typeof drawnAsAnswered>[1];
    const index = await answer('aggrega/catalogIndex', named({}, GRAPH_RELEASE)) as Partial<CatalogIndexDoc>;
    await selectRelease(ctx, GRAPH_RELEASE);
    await closeAllEditors(ctx);
    const doc = await showGraph(ctx, DRAWN_MS);
    await pressNode(ctx, doc, DB_NODE);
    const p = await settledPanel(doc, DB_NODE, PENDING);
    const drawn = drawnAsAnswered(p, ref);
    const lines = p.candidates?.links ?? [];
    return {
      passed: drawn.same && namesNoLink(index) && lines.length === 0,
      seen: `${drawn.seen}${p.candidates?.failed ? `; the list reads "${p.candidates.failed}"` : ''}; the index answer names ${describeLinks(index)}, and the list draws ${lines.length === 0 ? 'no line naming a link leading out' : `lines naming links leading out: ${JSON.stringify(lines)}`}`,
    };
  });

  // ---- a link leading out of the workspace, placed at the top of the folder ----

  // The link is placed once, by whichever of the two checks below runs first, and
  // the language server's own answer about it is asked over the folder the editor
  // reads, in the terms of the Release whose graph the second check draws.
  let placed: { link: string; rel: string } | null = null;
  const linkPlaced = (): { link: string; rel: string } => (placed ??= placeLinkLeadingOut(ctx.folder));
  const indexOverTheFolder = async (): Promise<Partial<CatalogIndexDoc>> => {
    const a = await referenceAnswer({ binary: bin, root: ctx.folder, method: 'aggrega/catalogIndex', params: { release: GRAPH_RELEASE }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(a.ok, `the language server gave no answer to aggrega/catalogIndex in ${GRAPH_RELEASE}'s terms over the folder: ${a.ok ? '' : a.error.message}`);
    return a.result as Partial<CatalogIndexDoc>;
  };
  const namesTheLinkAlone = (index: Partial<CatalogIndexDoc>, rel: string): boolean =>
    JSON.stringify(index.unreadLinkedDirs ?? null) === '[]' && JSON.stringify(index.unreadLinkedFiles ?? null) === JSON.stringify([rel]);

  await c.run('catalog-panel.names-the-link-leading-out-of-the-workspace', {
    expected: `with ${GRAPH_RELEASE} selected and ${LINK} placed at the top of the folder as a link to a Feature document outside the workspace, the language server's own aggrega/catalogIndex answer over the folder in that Release's terms names that link alone, among the links to files and by its path relative to the folder, and lists nothing the document behind it declares; once the Catalog panel's refresh is pressed, the panel's last row — after its kind headings — is the extension's own row for exactly the links that answer names, drawn once, and no row names ${BEHIND_THE_LINK.name}`,
    plant: 'in the scratch copy, out/src/workspace-catalog-run.js with the row naming the links never drawn',
  }, async () => {
    // Selected before the link is placed: the Release chooser names a link like
    // this one too, and this check reads the Catalog panel, not the chooser.
    await selectRelease(ctx, GRAPH_RELEASE);
    const link = linkPlaced();
    const index = await indexOverTheFolder();
    const row = linksLeadingOutRow(index as CatalogIndexDoc);
    const listsNothingBehind = !(index.entities ?? []).some((e) => e.name === BEHIND_THE_LINK.name);
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    await pressViewAction(ctx, 'Catalog', 'Refresh workspace catalog');
    const rows = (await until('the Catalog panel drawing the row naming the link', 20000, () => treeRows(ctx.d, 'Catalog'), (v) => row !== null && (v ?? []).some((r) => r.label === row.label))
      .catch(() => treeRows(ctx.d, 'Catalog'))) ?? [];
    const labels = rows.map((r) => r.label);
    const at = row === null ? -1 : labels.indexOf(row.label);
    const once = row !== null && labels.filter((l) => l === row.label).length === 1;
    const last = at >= 0 && at === labels.length - 1;
    const headings = labels.filter((l) => /^\S+ \(\d+\)$/.test(l));
    const rowForBehind = labels.includes(BEHIND_THE_LINK.name);
    return {
      passed: namesTheLinkAlone(index, link.rel) && listsNothingBehind && row !== null && once && last && headings.length > 0 && !rowForBehind,
      seen: `${link.link} reads the Feature outside through the link; the language server names ${describeLinks(index)} (the link placed is ${link.rel}) and lists ${listsNothingBehind ? 'nothing' : 'an entity'} behind it; the panel's rows ${JSON.stringify(labels)}${row === null ? '; the answer yields no row to look for' : `; the row ${JSON.stringify(row.label)} ${at < 0 ? 'not drawn' : `drawn at ${at} of ${labels.length}, level ${rows[at].level}`}`}${rowForBehind ? `; a row names ${BEHIND_THE_LINK.name}` : ''}`,
    };
  });

  await c.run('may-attach.names-the-link-leading-out-of-the-workspace', {
    expected: `with ${LINK} in place and ${GRAPH_RELEASE}'s graph shown, pressing its ${DB_NODE} node draws, under the list of what may attach, once, the extension's own line for exactly the links the language server's own aggrega/catalogIndex answer over the folder in that Release's terms names — that link alone; the list's rows are still the language server's own aggrega/attachCandidates answer for that node over the folder, row for row, and none names ${BEHIND_THE_LINK.name}`,
    plant: 'in the scratch copy, out/src/attach-candidates.js with the line naming the links never posted',
  }, async () => {
    const link = linkPlaced();
    const index = await indexOverTheFolder();
    const line = featuresNotOfferedLine(index as CatalogIndexDoc);
    const a = await referenceAnswer({ binary: bin, root: ctx.folder, method: 'aggrega/attachCandidates', params: { graphNode: DB_NODE, release: GRAPH_RELEASE }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(a.ok, `the language server gave no answer about what may attach to ${DB_NODE} over the folder: ${a.ok ? '' : a.error.message}`);
    await closeAllEditors(ctx);
    const doc = await showGraph(ctx, DRAWN_MS);
    await pressNode(ctx, doc, DB_NODE);
    const p = await settledPanel(doc, DB_NODE, PENDING);
    const drawn = drawnAsAnswered(p, a.result as Parameters<typeof drawnAsAnswered>[1]);
    const lines = p.candidates?.links ?? [];
    const offeredBehind = (p.candidates?.rows ?? []).some((r) => r.name === BEHIND_THE_LINK.name);
    return {
      passed: namesTheLinkAlone(index, link.rel) && line !== null && lines.length === 1 && lines[0] === line && drawn.same && !offeredBehind,
      seen: `the language server names ${describeLinks(index)} (the link placed is ${link.rel}); the line ${line === null ? 'the answer yields none' : JSON.stringify(line)}; the list draws ${lines.length === 0 ? 'no line naming a link' : `the lines ${JSON.stringify(lines)}`}; ${drawn.seen}${offeredBehind ? `; a row names ${BEHIND_THE_LINK.name}` : ''}`,
    };
  });
}
