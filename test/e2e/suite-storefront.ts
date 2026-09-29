// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { RESTART_COMMAND, RESTART_SERVER_ACTION } from '../../src/daemon-status';
import { buildValidateParams } from '../../src/validate-request';
import { need } from './checks';
import { runCompiler } from './cli';
import { UNREACHABLE_HOST } from './fixtures';
import { referenceAnswer } from './reference';
import { CACHE_MISS_CHECKS, cacheMissChecks } from './suite-cache-miss';
import { CONFIG_PANEL_CHECKS, configPanelChecks } from './suite-config-panel';
import {
  capture, closeAllEditors, deleteLine, describeDiagnostics, diagnostics, lineOf, open, putBack, ready, run, save, send, SuiteContext, theServer,
} from './suite-context';
import { contextRowsCheck } from './suite-gateway';
import { INSPECTION_CHECKS, inspectionChecks } from './suite-inspection';
import {
  commandsPanel, documentWith, holds, NOT_RUNNING, operationButtons, paneState, pickQuickInputRow, pressIn, pressOperation, pressPaneHeader, pressPanelAction,
  pressToastButton, QuickInput, quickInput, RUNNING, sleep, statusLog, STARTING, toasts, toastsSince, TreeRow, treeRowCentre, treeRows, until, waitQuickInput,
  waitStatus, waitToast,
} from './workbench';

// The checks run in the storefront folder: the capabilities walked end to end —
// the configuration panel's resizable columns, the language server recovering
// from a kill, diagnostics on a real mistake and across a cascade, an inspection
// refused because of the document declaring the entity, completion and hover,
// a hover answered after its document changed on disk, the published-catalog
// search with no registry and the filter it keeps from one search to the next,
// the workspace catalog panel, the operations heading the Catalog, Registries and
// Plugins panels and the Commands panel that holds none of them, the operations
// that end in words, and what the extension says about settings that are wrong.

export const STOREFRONT_CHECKS = [
  'commands-panel.context-rows-name-the-opened-folder',
  ...CONFIG_PANEL_CHECKS,
  'language-server.restarts-after-a-kill',
  'problems.authoring-mistake-lands-on-its-line-in-the-compilers-words',
  'problems.authoring-mistake-reads-as-actionable',
  'problems.cascade-names-the-entity-that-broke',
  ...INSPECTION_CHECKS,
  'language-features.completion-offers-the-workspace-and-catalog-entities',
  'language-features.hover-names-the-resolved-entity',
  ...CACHE_MISS_CHECKS,
  'catalog-search.palette-shows-its-facets',
  'catalog-search.no-registry-answer-says-so',
  'catalog-search.no-registry-sentence-directs-the-reader',
  'catalog-search.filter-is-kept-until-reset',
  'catalog-view.lists-the-workspace-entities-by-kind',
  'catalog-view.created-file-appears-without-a-press',
  'catalog-view.deleted-closed-file-row-leaves-without-a-press',
  'catalog-view.new-entity-appears-after-refresh',
  'catalog-view.deleted-entity-row-leaves-at-once',
  'catalog-panel.head-reads-search-catalog-then-draft-entity-and-folds-with-the-panel',
  'catalog-panel.draft-entity-asks-for-the-kind',
  'registries-panel.head-leads-no-registries-configured-and-folds-with-the-panel',
  'registries-panel.add-registry-asks-for-the-host',
  'registries-panel.update-index-starts-the-update',
  'plugins-panel.head-reads-add-plugin-then-generate-entities-and-folds-with-the-panel',
  'commands-panel.holds-none-of-the-list-panels-operations-and-keeps-its-order-and-walk',
  'operations.validate-ends-in-a-sentence',
  'operations.lint-ends-in-a-sentence',
  'operations.build-ends-in-words-and-writes-its-files',
  'settings-that-are-wrong.missing-catalog-and-unreachable-registry-are-named',
  'settings-that-are-wrong.missing-compiler-is-named',
  'settings-that-are-wrong.what-the-extension-says-is-enough',
] as const;

const RELEASE = 'release-compose.yaml';

// The words a reader is to meet are held here as written, so a change of wording
// in the extension is a change these checks report rather than follow: the
// opening of the answer when no registry is configured, and the search
// palette's title, placeholder, facet rows in order, the row that clears them,
// what each facet reads when it narrows nothing, and the last row.
const NO_REGISTRY_OPENING = 'Aggrega: No registries configured.';
const SEARCH_FACETS = ['Query', 'Kind', 'Label selector', 'Capability', 'Plugin type', 'Limit'];
const RESET_ROW = 'Reset search filter';
const UNSET_READINGS = ['any', 'any', 'any', 'any', 'any', 'no cap'];
const NOTHING_SET = 'nothing is set';
const SEARCH_ROW = 'Search';
const SEARCH_TITLE = 'Aggrega: search published catalog';
const SEARCH_PLACEHOLDER = 'Narrow the search, then choose Search';

// The rows at the head of the Catalog panel, by the words each reads, in the
// order the panel draws them; the first opens the search.
const CATALOG_HEAD = ['Search catalog', 'Draft entity'];

// The rows at the head of the Registries and Plugins panels, the row the
// Registries panel draws beneath its head with no registry configured, and what
// pressing a head row asks or writes first, held as written for the same reason.
const REGISTRIES_HEAD = ['Add registry', 'Update index'];
const PLUGINS_HEAD = ['Add plugin', 'Generate entities'];
const NO_REGISTRIES_ROW = 'No registries configured.';
const DRAFT_PLACEHOLDER = 'Aggrega: choose the kind of entity to draft';
const ADD_REGISTRY_TITLE = 'Aggrega: add a registry';
const INDEX_BUILD_OPENING = 'Index build for every configured registry.';

// The Commands panel's buttons in the order it draws them, and the stops its
// arrow keys walk from Validate — the Build options chevron beside Build among
// them — held as written. None of the operations heading a list panel is among
// either, by label or by command.
const COMMANDS_PANEL_LABELS = [
  'Validate', 'Lint', 'Build', 'Preview', 'Graph', 'Pull', 'Import', 'Inspect', 'Push', 'Sign', 'Deprecate', 'Show config', 'Cache…',
];
const COMMANDS_PANEL_WALK = [
  'aggrega.op.validate', 'aggrega.op.lint', 'aggrega.op.build', 'caret:build', 'aggrega.op.preview', 'aggrega.graph.show', 'aggrega.op.pull',
  'aggrega.op.import', 'aggrega.op.inspect', 'aggrega.op.push', 'aggrega.op.sign', 'aggrega.op.deprecate', 'aggrega.config.open', 'aggrega.op.cache',
];
const LIST_PANEL_OPERATIONS = [...CATALOG_HEAD, ...REGISTRIES_HEAD, ...PLUGINS_HEAD];
const LIST_PANEL_COMMANDS = [
  'aggrega.catalog.searchPublished', 'aggrega.op.scaffold', 'aggrega.registries.add', 'aggrega.registries.update', 'aggrega.plugins.add', 'aggrega.plugins.genCatalog',
];

// The stopped-responding notification, held as written for the same reason.
export const STOPPED_RESPONDING = 'Aggrega language server has stopped responding. Run "Aggrega: Start or restart the language server" to recover.';

// entityNames reads the metadata.name of every document of `kind` under a
// catalog directory, as the compiler's catalog would list them.
export function entityNames(dir: string, kind: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const f = path.join(d, e.name);
      if (e.isDirectory() && !e.name.startsWith('.')) { walk(f); continue; }
      if (!/\.ya?ml$/.test(e.name)) { continue; }
      const text = fs.readFileSync(f, 'utf8');
      if (!new RegExp(`^kind:\\s*${kind}\\s*$`, 'm').test(text)) { continue; }
      const m = /^metadata:\s*\n(?:[ \t]+.*\n)*?[ \t]+name:\s*(\S+)/m.exec(text);
      if (m) { out.push(m[1]); }
    }
  };
  walk(dir);
  return [...new Set(out)].sort();
}

// pressViewAction presses a side-bar view's title action, which is drawn once
// the pointer is over the view's header.
export async function pressViewAction(ctx: SuiteContext, viewTitle: string, actionLabel: string): Promise<void> {
  const header = await until(`the "${viewTitle}" view's header`, 10000, () => ctx.d.workbench<{ x: number; y: number } | null>(`((t) => {
    for (const h of document.querySelectorAll('#workbench\\\\.parts\\\\.sidebar .pane-header')) {
      if (((h.querySelector('h3.title') || {}).innerText || '').trim().toLowerCase() === t.toLowerCase()) {
        const r = h.getBoundingClientRect(); return { x: r.x + 40, y: r.y + r.height / 2 };
      }
    }
    return null;
  })(${JSON.stringify(viewTitle)})`), (v) => v !== null);
  if (header === null) { throw new Error('unreachable'); }
  await ctx.d.moveTo(header);
  await sleep(300);
  await pressIn(ctx.d, null, `#workbench\\.parts\\.sidebar .pane-header .action-label[aria-label="${actionLabel}"]`);
}

// killServer signals the language server this window started, by its recorded
// PID, as a person does with `kill <pid>`, and returns what it signalled.
export async function killServer(ctx: SuiteContext): Promise<{ pid: number; cwd: string }> {
  const srv = await theServer(ctx);
  need(srv.cwd === ctx.folder, `the language server runs in ${srv.cwd}, not in the folder the window opened`);
  process.kill(srv.pid, 'SIGTERM');
  return { pid: srv.pid, cwd: srv.cwd };
}

export async function storefrontChecks(ctx: SuiteContext, referenceFolder: string): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  const aggregate = path.join(ctx.folder, 'aggregate.yaml');
  const feature = path.join(ctx.folder, 'catalog', 'feature', 'local', 'nightly-backup', '1.0.0', 'feature.yaml');
  const moduleFile = path.join(ctx.folder, 'catalog', 'aggregate', 'local', 'sessions', '1.0.0', 'aggregate.yaml');
  const config = path.join(ctx.folder, '.aggrega-config.yaml');
  await ready(ctx);
  await contextRowsCheck(ctx);

  // ---- the configuration panel's columns ----
  await configPanelChecks(ctx);

  // ---- the daemon starts, and recovers ----
  await c.run('language-server.restarts-after-a-kill', {
    expected: 'the language server this window started (the one working in the opened folder), signalled by its PID, is started again after an edit: the status bar passes through "starting" back to "running" and a new server works in the same folder',
    plant: 'in the scratch copy, out/src/daemon.js made not to respawn after an unexpected exit',
  }, async () => {
    const mark = (await statusLog(ctx.d)).length;
    const killed = await killServer(ctx);
    await open(ctx, aggregate);
    await ctx.probe.request('document.edit', { path: aggregate, start: { line: 0, character: 0 }, text: '' });
    await ctx.probe.request('document.edit', { path: aggregate, start: { line: 2, character: 0 }, text: '#\n' });
    const next = await theServer(ctx, 30000, killed.pid);
    await waitStatus(ctx.d, RUNNING, 60000);
    const readings = (await statusLog(ctx.d)).slice(mark).map((r) => r.reading);
    await ctx.probe.request('document.undo', { path: aggregate });
    await save(ctx, aggregate).catch(() => undefined);
    const through = readings.indexOf(STARTING) !== -1 && readings.lastIndexOf(RUNNING) > readings.indexOf(STARTING);
    return { passed: through && next.cwd === ctx.folder, seen: `killed ${killed.pid}; readings after: ${JSON.stringify(readings)}; new server ${next.pid} in ${next.cwd}` };
  });

  // ---- diagnostics on a real authoring mistake ----
  const referenceFeature = path.join(referenceFolder, path.relative(ctx.folder, feature));
  let mistakeText = '';
  let mistakeShot: string | null = null;
  await c.run('problems.authoring-mistake-lands-on-its-line-in-the-compilers-words', {
    expected: 'deleting the Feature\'s metadata.version files a complaint under "aggrega" on the line of the metadata block it is missing from, in the words the compiler answers for the same document, and putting the line back clears it',
    plant: 'in the scratch copy, out/src/diagnostics-shape.js made to move every range one line down',
  }, async () => {
    const removed = await deleteLine(ctx, feature, 'version: 1.0.0');
    const content = (await open(ctx, feature)).text ?? '';
    const answer = await referenceAnswer({ binary: bin, root: referenceFolder, method: 'aggrega/validate', params: buildValidateParams(referenceFeature, content, RELEASE), home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(answer.ok, `the compiler gave no reference answer: ${answer.ok ? '' : answer.error.message}`);
    const ref = ((answer.result as { diagnostics?: { message: string; range: { start: { line: number } } }[] }).diagnostics ?? []);
    need(ref.length > 0, 'the compiler reports nothing for the broken Feature');
    const metadataLine = (await lineOf(ctx, feature, 'metadata:')).index;
    const got = await until('the complaint being filed', 20000, () => diagnostics(ctx, feature), (v) => v.some((d) => d.source === 'aggrega'));
    const complaint = got.find((d) => d.source === 'aggrega');
    mistakeText = complaint?.message ?? '';
    const words = ref.some((r) => r.message === complaint?.message);
    const onLine = complaint?.range.start.line === metadataLine;
    // The complaint as a person meets it, captured while it stands, with the
    // Problems panel open, for the judgement that follows.
    await run(ctx, 'workbench.actions.view.problems');
    await until('the Problems panel drawing the complaint', 10000, () => ctx.d.workbench<string>(`((document.querySelector('.markers-panel') || {}).innerText || '')`), (t) => t.includes(mistakeText.split('\n')[0].slice(0, 40))).catch(() => undefined);
    mistakeShot = await capture(ctx, 'authoring-mistake');
    await putBack(ctx, feature, removed);
    const cleared = await until('the complaint clearing once the line is back', 20000, () => diagnostics(ctx, feature), (v) => !v.some((d) => d.source === 'aggrega')).then(() => true, () => false);
    await save(ctx, feature);
    return { passed: words && onLine && cleared, seen: `${describeDiagnostics(feature, complaint ? [complaint] : [])} (metadata: is line ${metadataLine + 1}); the compiler's words ${words ? 'carried unchanged' : `differ: ${JSON.stringify(ref.map((r) => r.message))}`}; after the line was put back it ${cleared ? 'cleared' : 'stayed'}` };
  });
  await c.forPerson('problems.authoring-mistake-reads-as-actionable', {
    expected: 'the complaint reads as something a person can act on',
    plant: 'none: this is a judgement of the wording',
    question: 'Does the complaint tell a person what to fix in the Feature?',
  }, async () => {
    need(mistakeText !== '', 'no complaint was filed, so there is nothing to judge');
    return { screenshot: mistakeShot, drawnText: mistakeText };
  });

  // ---- diagnostics across a cascade ----
  const referenceModule = path.join(referenceFolder, path.relative(ctx.folder, moduleFile));
  const referenceAggregate = path.join(referenceFolder, 'aggregate.yaml');
  await c.run('problems.cascade-names-the-entity-that-broke', {
    expected: 'with the Aggregate open, deleting metadata.version from the module it imports and saving that file, then pressing Validate with the Aggregate in front, files on the Aggregate the compiler\'s answer for it, which names the module\'s file and its missing metadata.version',
    plant: 'in the scratch copy, out/src/diagnostics-shape.js made to cut a message at its note, which drops the part naming the file that broke',
  }, async () => {
    await open(ctx, aggregate);
    const removed = await deleteLine(ctx, moduleFile, 'version: 1.0.0');
    await save(ctx, moduleFile);
    // Whether the cascade reaches the Aggregate without asking is recorded, not
    // judged: either answer is a behaviour a reader may meet, and the check's
    // verdict rests on what Validate reports.
    await open(ctx, aggregate);
    const unasked = await until('the cascade reaching the Aggregate unasked', 10000, () => diagnostics(ctx, aggregate), (v) => v.some((d) => d.message.includes(moduleFile))).then(() => true, () => false);
    // The reference: the same document against the same broken module on disk.
    fs.writeFileSync(referenceModule, fs.readFileSync(moduleFile, 'utf8'));
    const answer = await referenceAnswer({ binary: bin, root: referenceFolder, method: 'aggrega/validate', params: buildValidateParams(referenceAggregate, fs.readFileSync(aggregate, 'utf8'), RELEASE), home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    const ref = answer.ok ? ((answer.result as { diagnostics?: { message: string }[] }).diagnostics ?? []).map((d) => d.message.split(referenceFolder).join(ctx.folder)) : [];
    const mark = (await toasts(ctx.d)).length;
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.validate');
    const report = await waitToast(ctx.d, 'the validation ending in a sentence', mark, (t) => t.message.startsWith('Aggrega: validated aggregate.yaml'), 30000).then((t) => t.message, () => '');
    const after = await until('the Aggregate\'s entries after Validate', 20000, () => diagnostics(ctx, aggregate), (v) => v.some((d) => d.message.includes(moduleFile)));
    const naming = after.find((d) => d.message.includes(moduleFile));
    const words = naming !== undefined && ref.includes(naming.message);
    const namesField = naming !== undefined && naming.message.includes('metadata.version');
    await putBack(ctx, moduleFile, removed);
    await save(ctx, moduleFile);
    // Recorded, not judged: the module's component type broken instead, a second
    // kind of fault in an imported module, kept as evidence beside the verdict.
    const typed = await lineOf(ctx, moduleFile, 'type: core/datastore/valkey');
    await ctx.probe.request('document.edit', { path: moduleFile, start: { line: typed.index, character: 0 }, end: { line: typed.index + 1, character: 0 }, text: `${typed.text}x\n` });
    await save(ctx, moduleFile);
    await open(ctx, aggregate);
    const typeMark = (await toasts(ctx.d)).length;
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.validate');
    await waitToast(ctx.d, 'the second validation ending', typeMark, (t) => t.message.startsWith('Aggrega: validated aggregate.yaml'), 30000).catch(() => undefined);
    const typeEntries = (await diagnostics(ctx, aggregate)).map((d) => d.message.split('\n')[0]);
    await open(ctx, moduleFile);
    await ctx.probe.request('document.edit', { path: moduleFile, start: { line: typed.index, character: 0 }, end: { line: typed.index + 1, character: 0 }, text: `${typed.text}\n` });
    await save(ctx, moduleFile);
    fs.writeFileSync(referenceModule, fs.readFileSync(moduleFile, 'utf8'));
    // Validate once more with the module whole, so no entry of this check stays
    // on the Aggregate for the checks after it.
    await open(ctx, aggregate);
    const cleanMark = (await toasts(ctx.d)).length;
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.validate');
    await waitToast(ctx.d, 'the validation with the module whole', cleanMark, (t) => t.message.startsWith('Aggrega: validated aggregate.yaml'), 30000).catch(() => undefined);
    await until('the Aggregate clear of this check\'s entries', 20000, () => diagnostics(ctx, aggregate), (v) => !v.some((d) => d.message.includes('valkeyx') || d.message.includes(moduleFile))).catch(() => undefined);
    return {
      passed: words && namesField,
      seen: `unasked, the cascade ${unasked ? 'reached' : 'did not reach'} the Aggregate within 10 s; Validate said "${report}"; the entry naming the module: ${naming ? JSON.stringify(naming.message.split('\n').slice(0, 3).join(' / ')) : 'none'}; the compiler's words ${words ? 'carried unchanged' : 'differ'}; with the module's type broken instead, the Aggregate reads ${JSON.stringify(typeEntries)}`,
      evidence: { reference: ref, entries: after, typeBroken: typeEntries },
    };
  });

  // ---- an inspection refused because of the document declaring the entity ----
  await inspectionChecks(ctx, referenceFolder);

  // ---- completion and hover ----
  const features = [...entityNames(path.join(ctx.folder, 'catalog'), 'Feature'), ...entityNames(ctx.inputs.catalog.dir, 'Feature')];
  const localFeatures = entityNames(path.join(ctx.folder, 'catalog'), 'Feature');
  const typeLine = await lineOf(ctx, aggregate, 'type: core/secret-value');
  const postgresLine = await lineOf(ctx, aggregate, 'type: core/datastore/postgres');
  // languageAnswer runs one of the editor's language requests and records, beside
  // its answer, whether it answered and what the editor showed and the output
  // channel said while it ran. Where the language server holds no parse of the
  // document, the extension validates it and sends the request again without
  // asking the reader anything, so a notification raised here is news rather than
  // a step to answer.
  const languageAnswer = async <T>(command: string, args: unknown[]): Promise<{ result: T | null; note: string }> => {
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    const result = await run<T>(ctx, command, args, 25000).then((r) => r, () => null);
    await sleep(1000);
    const shown = (await toastsSince(ctx.d, toastMark)).map((t) => t.message);
    const channel = ctx.out.since(mark).split('\n').filter((l) => l.trim() !== '').slice(0, 3);
    return { result, note: `the request ${result !== null ? 'answered' : 'gave no answer within 25000 ms'}; notifications while it ran: ${shown.length === 0 ? 'none' : JSON.stringify(shown)}; channel: ${JSON.stringify(channel)}` };
  };
  await c.run('language-features.completion-offers-the-workspace-and-catalog-entities', {
    expected: `completion just after "type: " on the password attachment (line ${typeLine.index + 1}) offers Feature references drawn from the folder's own catalog (${localFeatures.join(', ')}) and from the standard library, and nothing that is not one`,
    plant: 'in the scratch copy, out/src/extension.js made to return a fixed list of items',
  }, async () => {
    await open(ctx, aggregate);
    const character = typeLine.text.indexOf('type: ') + 'type: '.length;
    const { result: list, note } = await languageAnswer<{ items?: { label: string | { label: string } }[] } | null>('vscode.executeCompletionItemProvider', [{ $file: aggregate }, { $position: { line: typeLine.index, character } }]);
    const labels = (list?.items ?? []).map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
    const fromWorkspace = labels.filter((l) => localFeatures.includes(l));
    const fromCatalog = labels.filter((l) => features.includes(l) && !localFeatures.includes(l));
    const other = labels.filter((l) => !features.includes(l));
    return { passed: fromWorkspace.length > 0 && fromCatalog.length > 0 && other.length === 0, seen: `${labels.length} offered: ${JSON.stringify(labels.slice(0, 12))}; from the folder ${fromWorkspace.length}, from the standard library ${fromCatalog.length}, neither ${JSON.stringify(other.slice(0, 6))}; ${note}` };
  });
  const postgresVersions = fs.readdirSync(path.join(ctx.inputs.catalog.dir, 'component', 'core', 'datastore', 'postgres')).filter((v) => /^\d+\.\d+\.\d+/.test(v));
  await c.run('language-features.hover-names-the-resolved-entity', {
    expected: `hovering core/datastore/postgres (line ${postgresLine.index + 1}) shows its resolved identity: the entity's name and the version the catalog holds (${postgresVersions.join(', ')})`,
    plant: 'in the scratch copy, out/src/extension.js made to return no hover',
  }, async () => {
    await open(ctx, aggregate);
    const character = postgresLine.text.indexOf('core/datastore/postgres') + 5;
    const { result: hovers, note } = await languageAnswer<{ contents?: ({ value?: string } | string)[] }[] | null>('vscode.executeHoverProvider', [{ $file: aggregate }, { $position: { line: postgresLine.index, character } }]);
    const text = (hovers ?? []).flatMap((h) => (h.contents ?? []).map((x) => (typeof x === 'string' ? x : x.value ?? ''))).join('\n');
    return { passed: text.includes('core/datastore/postgres') && postgresVersions.some((v) => text.includes(v)), seen: `hover: ${JSON.stringify(text.slice(0, 300))}; ${note}` };
  });

  // ---- a hover answered after its document changed on disk ----
  await cacheMissChecks(ctx);

  // ---- the published-catalog palette, with no registry ----
  let noRegistry = '';
  await c.run('catalog-search.palette-shows-its-facets', {
    expected: `the Catalog panel's first row, "${CATALOG_HEAD[0]}", opens a list titled "${SEARCH_TITLE}", placeholder "${SEARCH_PLACEHOLDER}", with one row per facet (${SEARCH_FACETS.join(', ')}) each showing its current value, then "${RESET_ROW}", and a last row "${SEARCH_ROW}"`,
    plant: 'in the scratch copy, out/src/catalog-search-run.js with the Plugin type row dropped',
  }, async () => {
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    const drawn = await until('the Catalog view drawing its head', 20000, () => treeRows(ctx.d, 'Catalog'), (v) => v !== null && v.length > 0);
    const head = (drawn ?? []).slice(0, CATALOG_HEAD.length).map((r) => r.label);
    await pressPanelAction(ctx.d, 'Catalog', CATALOG_HEAD[0]);
    const q = await waitQuickInput(ctx.d, 'the search palette', (x) => x.title === SEARCH_TITLE);
    const labels = q.rows.map((r) => r.label);
    const valued = q.rows.slice(0, SEARCH_FACETS.length).every((r) => r.description !== '');
    const passed = JSON.stringify(head) === JSON.stringify(CATALOG_HEAD) && q.placeholder === SEARCH_PLACEHOLDER && JSON.stringify(labels) === JSON.stringify([...SEARCH_FACETS, RESET_ROW, SEARCH_ROW]) && valued;
    return { passed, seen: `the Catalog panel opens with ${JSON.stringify(head)}; title "${q.title}", placeholder "${q.placeholder}", rows ${JSON.stringify(q.rows.map((r) => `${r.label}: ${r.description}`))}` };
  });
  await c.run('catalog-search.no-registry-answer-says-so', {
    expected: `with no registry configured, choosing ${SEARCH_ROW} is answered by a sentence opening "${NO_REGISTRY_OPENING}"`,
    plant: 'in the scratch copy, out/src/catalog-search-run.js made to answer a missing registry as no matches',
  }, async () => {
    const mark = (await toasts(ctx.d)).length;
    await pickQuickInputRow(ctx.d, SEARCH_ROW);
    const t = await waitToast(ctx.d, 'the search answering', mark, (x) => x.message.startsWith('Aggrega:'), 30000);
    noRegistry = t.message;
    return { passed: t.message.startsWith(NO_REGISTRY_OPENING), seen: `"${t.message}" (${t.severity})` };
  });
  await c.forPerson('catalog-search.no-registry-sentence-directs-the-reader', {
    expected: 'the remediation sentence sends the reader where the control is',
    plant: 'none: this is a judgement of the wording',
    question: 'The sentence sends the reader to "Add registry" and then "Update index", the two rows at the head of the Registries panel. Does that direct the reader well?',
  }, async () => {
    need(noRegistry !== '', 'the search gave no answer, so there is no sentence to judge');
    return { screenshot: await capture(ctx, 'search-no-registry'), drawnText: noRegistry };
  });

  // ---- the filter kept from one search to the next, until it is reset ----
  const KEPT_KIND = 'component';
  const KEPT_QUERY = 'postgres';
  const KEPT_RESET = 'clears Query, Kind';
  await c.run('catalog-search.filter-is-kept-until-reset', {
    expected: `with Kind set to ${KEPT_KIND} and Query to "${KEPT_QUERY}", choosing ${SEARCH_ROW} and then opening the search again from "${CATALOG_HEAD[0]}" shows both facets as they were set and "${RESET_ROW}" reading "${KEPT_RESET}"; choosing "${RESET_ROW}" leaves a list titled "${SEARCH_TITLE}" drawn, runs no search, and every facet reads as narrowing nothing (${SEARCH_FACETS.map((f, i) => `${f}: ${UNSET_READINGS[i]}`).join(', ')}) with "${RESET_ROW}" reading "${NOTHING_SET}"`,
    plant: 'in the scratch copy, out/src/catalog-views.js made to open every search on an empty filter',
  }, async () => {
    const rowsOf = (q: QuickInput | null): string[] => (q?.rows ?? []).map((r) => `${r.label}: ${r.description}`);
    const reading = (q: QuickInput, label: string): string | undefined => q.rows.find((r) => r.label === label)?.description;
    const isPalette = (q: QuickInput): boolean => q.title === SEARCH_TITLE && q.rows.length === SEARCH_FACETS.length + 2;
    const openSearch = async (): Promise<QuickInput> => {
      await closeAllEditors(ctx);
      await run(ctx, 'aggrega.workspaceCatalog.focus');
      await pressPanelAction(ctx.d, 'Catalog', CATALOG_HEAD[0]);
      return waitQuickInput(ctx.d, 'the search palette', isPalette);
    };

    // Setting the two facets is this check's precondition, so a facet that
    // cannot be set here stops it as not run rather than failing it.
    await openSearch();
    await pickQuickInputRow(ctx.d, 'Kind');
    await waitQuickInput(ctx.d, 'the choice of kinds', (q) => q.title !== SEARCH_TITLE && q.rows.some((r) => r.label === KEPT_KIND));
    await pickQuickInputRow(ctx.d, KEPT_KIND);
    await sleep(300);
    await ctx.d.press('Enter');
    const withKind = await waitQuickInput(ctx.d, 'the palette reading the kind chosen', (q) => isPalette(q) && reading(q, 'Kind') === KEPT_KIND).catch(() => null);
    need(withKind !== null, `the Kind facet could not be set to ${KEPT_KIND} from its choice, so its keeping cannot be observed: ${JSON.stringify(rowsOf(await quickInput(ctx.d)))}`);
    await pickQuickInputRow(ctx.d, 'Query');
    await waitQuickInput(ctx.d, 'the query being asked for', (q) => q.rows.length === 0 || q.title !== SEARCH_TITLE);
    await ctx.d.press('Control+a');
    await ctx.d.type(KEPT_QUERY);
    await ctx.d.press('Enter');
    const withBoth = await waitQuickInput(ctx.d, 'the palette reading both facets', (q) => isPalette(q) && reading(q, 'Query') === KEPT_QUERY && reading(q, 'Kind') === KEPT_KIND).catch(() => null);
    need(withBoth !== null, `the Query facet could not be set to "${KEPT_QUERY}", so its keeping cannot be observed: ${JSON.stringify(rowsOf(await quickInput(ctx.d)))}`);
    const searchMark = (await toasts(ctx.d)).length;
    await pickQuickInputRow(ctx.d, SEARCH_ROW);
    const answered = await waitToast(ctx.d, 'the search answering', searchMark, (t) => t.message.startsWith(NO_REGISTRY_OPENING), 30000).then(() => true, () => false);
    need(answered, 'the search with both facets set gave no answer, so there is no next search to open');

    // The verdict: what the next search opens with, and what the reset leaves.
    const before = await openSearch();
    const kept = reading(before, 'Kind') === KEPT_KIND && reading(before, 'Query') === KEPT_QUERY && reading(before, RESET_ROW) === KEPT_RESET;
    const resetMark = (await toasts(ctx.d)).length;
    await pickQuickInputRow(ctx.d, RESET_ROW);
    const after = await waitQuickInput(ctx.d, 'the palette drawn again after the reset', (q) => isPalette(q) && JSON.stringify(rowsOf(q)) !== JSON.stringify(rowsOf(before))).catch(() => null);
    const quiet = await holds(2000, async () => toastsSince(ctx.d, resetMark), (ts) => !ts.some((t) => t.message.startsWith(NO_REGISTRY_OPENING)));
    const cleared = after !== null
      && JSON.stringify(after.rows.map((r) => r.label)) === JSON.stringify([...SEARCH_FACETS, RESET_ROW, SEARCH_ROW])
      && JSON.stringify(after.rows.slice(0, SEARCH_FACETS.length).map((r) => r.description)) === JSON.stringify(UNSET_READINGS)
      && reading(after, RESET_ROW) === NOTHING_SET;
    await ctx.d.press('Escape');
    return {
      passed: kept && cleared && quiet.held,
      seen: `opened again after the search, the list reads ${JSON.stringify(rowsOf(before))}; after "${RESET_ROW}" ${after === null ? `no list titled "${SEARCH_TITLE}" with other rows was drawn` : `it reads ${JSON.stringify(rowsOf(after))}`}; ${quiet.held ? 'no search answered in the 2 s after the reset' : 'a search answered after the reset'}`,
    };
  });

  // ---- the workspace catalog panel ----
  const aggregates = entityNames(ctx.folder, 'Aggregate');
  await c.run('catalog-view.lists-the-workspace-entities-by-kind', {
    expected: `the Catalog view lists the open workspace's entities under kind headings carrying a count, among them "Aggregate (${aggregates.length})" holding ${aggregates.join(', ')}, and clicking the storefront row opens its file`,
    plant: 'in the scratch copy, out/src/workspace-catalog-view.js made to drop the count from the headings',
  }, async () => {
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    const rows = await until('the Catalog view drawing its rows', 20000, () => treeRows(ctx.d, 'Catalog'), (v) => v !== null && v.some((r) => /^Aggregate \(\d+\)$/.test(r.label)));
    // The rows at the panel's head are its operations rather than its list, so
    // the kind headings are the top-level rows after them.
    const headings = (rows ?? []).filter((r) => r.level === 1).slice(CATALOG_HEAD.length).map((r) => r.label);
    const counted = headings.every((h) => /^[A-Z][A-Za-z]+ \(\d+\)$/.test(h));
    const at = await treeRowCentre(ctx.d, 'Catalog', 'storefront');
    need(at !== null, 'the storefront row is not drawn');
    await ctx.d.click(at);
    const active = await until('the storefront row opening its file', 10000, () => ctx.probe.request<{ path: string } | null>('editor.active'), (v) => v !== null && v.path === aggregate).catch(async () => ctx.probe.request<{ path: string } | null>('editor.active'));
    return { passed: headings.includes(`Aggregate (${aggregates.length})`) && counted && active?.path === aggregate, seen: `headings ${JSON.stringify(headings)}; the storefront row opened ${active?.path ?? 'nothing'}` };
  });
  const copyPath = path.join(ctx.folder, 'scratch-component.yaml');
  const copySource = path.join(ctx.inputs.extension.dir, 'test', 'e2e', 'fixtures', 'gateway', 'scratch-component.yaml');
  const copyName = entityNames(path.dirname(copySource), 'Component')[0];
  // The copy, never opened in the editor, first: created and deleted from outside
  // it with nothing pressed, so what brings the row and takes it away is the panel
  // following the disk and nothing else. They come before the checks below that
  // write the same copy again, so neither rests on how those ended.
  let created = false;
  await c.run('catalog-view.created-file-appears-without-a-press', {
    expected: `with no "${copyName}" row drawn, a copy of the gateway folder's scratch Component written to the folder's root from outside the editor appears as "${copyName}" in the Catalog view within 10 s, with no press on refresh and no editor opening it`,
    plant: 'in the scratch copy, out/src/disk-change.js made to leave a file created on disk unreported',
  }, async () => {
    const before = await until('the Catalog view drawing its rows', 10000, () => treeRows(ctx.d, 'Catalog'), (v) => v !== null && v.length > 0);
    need(!(before ?? []).some((r) => r.label === copyName) && !fs.existsSync(copyPath), `the "${copyName}" row or its file is already there, so its appearing cannot be observed`);
    fs.copyFileSync(copySource, copyPath);
    const t0 = Date.now();
    created = await until(`the "${copyName}" row appearing`, 10000, () => treeRows(ctx.d, 'Catalog'), (v) => v !== null && v.some((r) => r.label === copyName)).then(() => true, () => false);
    const after = Date.now() - t0;
    const editor = await ctx.probe.request<{ path: string } | null>('editor.active');
    return { passed: created && editor?.path !== copyPath, seen: created ? `the row appeared ${after} ms after the file was written; the active editor ${editor?.path ?? 'none'}` : `no "${copyName}" row within 10000 ms; rows ${JSON.stringify(((await treeRows(ctx.d, 'Catalog')) ?? []).map((r) => r.label).slice(0, 10))}` };
  });
  await c.run('catalog-view.deleted-closed-file-row-leaves-without-a-press', {
    expected: `the "${copyName}" copy, never opened in the editor, deleted from outside it, takes its row out of the Catalog view within 10 s with no press on refresh, and it stays out (watched for 5 s); the same reading drew the row before the deletion`,
    plant: 'in the scratch copy, out/src/disk-change.js made to leave a file deleted on disk unreported',
  }, async () => {
    need(created && (await treeRows(ctx.d, 'Catalog'))?.some((r) => r.label === copyName), `the "${copyName}" row is not drawn, so its leaving cannot be observed`);
    need((await ctx.probe.request<{ path: string } | null>('editor.active'))?.path !== copyPath, 'the copy is open in the editor, so its deletion is not the one this check is about');
    fs.unlinkSync(copyPath);
    const t0 = Date.now();
    const gone = await until(`the "${copyName}" row leaving`, 10000, () => treeRows(ctx.d, 'Catalog'), (v) => v !== null && !v.some((r) => r.label === copyName)).then(() => true, () => false);
    const left = Date.now() - t0;
    const out = gone ? await holds(5000, () => treeRows(ctx.d, 'Catalog'), (v) => v !== null && !v.some((r) => r.label === copyName)) : null;
    return { passed: gone && out !== null && out.held, seen: gone ? `the row left ${left} ms after the file was deleted, and ${out?.held ? 'stayed out' : `came back at ${out?.atMs} ms`}` : `the row is still drawn 10000 ms after the file was deleted` };
  });
  await c.run('catalog-view.new-entity-appears-after-refresh', {
    expected: `a Component file saved at the folder's root (a copy of the gateway folder's scratch Component) appears as "${copyName}" once "Refresh workspace catalog" is pressed, with no restart`,
    plant: 'in the scratch copy, out/src/workspace-catalog-view.js made to redraw nothing on refresh, so it keeps the rows it first read',
  }, async () => {
    fs.copyFileSync(copySource, copyPath);
    await pressViewAction(ctx, 'Catalog', 'Refresh workspace catalog');
    const rows = await until(`"${copyName}" appearing in the Catalog view`, 20000, () => treeRows(ctx.d, 'Catalog'), (v) => v !== null && v.some((r) => r.label === copyName));
    return { passed: true, seen: `rows ${JSON.stringify((rows ?? []).map((r) => r.label).slice(0, 10))}` };
  });
  await c.run('catalog-view.deleted-entity-row-leaves-at-once', {
    expected: `with the copy open, deleting it from outside the editor and closing its tab takes the "${copyName}" row out of the Catalog view within 5 s with no press on refresh, and it stays out (watched for 5 s after the tab closed)`,
    plant: 'in the scratch copy, out/src/disk-change.js made to read the list again after no drop, neither a deletion on disk nor a close in the editor',
  }, async () => {
    need((await treeRows(ctx.d, 'Catalog'))?.some((r) => r.label === copyName), `the "${copyName}" row is not drawn, so its leaving cannot be observed`);
    await open(ctx, copyPath);
    fs.unlinkSync(copyPath);
    await sleep(500);
    await run(ctx, 'workbench.action.closeActiveEditor');
    const gone = await until(`the "${copyName}" row leaving`, 5000, () => treeRows(ctx.d, 'Catalog'), (v) => v !== null && !v.some((r) => r.label === copyName)).then(() => true, () => false);
    let stayed = false;
    if (gone) {
      const t0 = Date.now();
      stayed = true;
      while (Date.now() - t0 < 5000) {
        if ((await treeRows(ctx.d, 'Catalog'))?.some((r) => r.label === copyName)) { stayed = false; break; }
        await sleep(250);
      }
    }
    const rows = await treeRows(ctx.d, 'Catalog');
    const row = rows?.find((r) => r.label === copyName);
    return { passed: gone && stayed, seen: gone ? (stayed ? 'the row left and stayed out' : 'the row left, then came back') : `the row is still drawn 5 s after the tab closed${row ? ` (${row.decorations})` : ''}` };
  });

  // ---- the operations heading each list panel, and the Commands panel without them ----
  // headAndFold reads a list panel as drawn once it has settled, leaves a capture
  // of it, then folds the panel by its header and watches that none of its head
  // rows is drawn for 1.5 s, and unfolds it and waits for the head to be drawn
  // again — the positive control showing the same reading sees the rows when
  // they are there.
  const headAndFold = async (title: string, focus: string, head: readonly string[], settled: (rows: TreeRow[]) => boolean, shot: string) => {
    await closeAllEditors(ctx);
    await run(ctx, focus);
    const drawn = await until(`the ${title} view drawing its rows`, 20000, () => treeRows(ctx.d, title), (v) => v !== null && settled(v)) ?? [];
    const first = drawn.slice(0, head.length);
    const inOrder = JSON.stringify(first.map((r) => r.label)) === JSON.stringify(head);
    const runnable = first.every((r) => r.level === 1 && r.description === '');
    const beneath = drawn[head.length];
    const captured = await capture(ctx, shot);
    const open = await paneState(ctx.d, title);
    need(open.found && open.expanded === 'true', `the ${title} view is not drawn unfolded, so folding it cannot be observed: ${JSON.stringify(open)}`);
    await pressPaneHeader(ctx.d, title);
    const folded = await until(`the ${title} view folding`, 5000, () => paneState(ctx.d, title), (s) => s.expanded === 'false').then(() => true, () => false);
    const hidden = folded ? await holds(1500, () => paneState(ctx.d, title), (s) => s.expanded === 'false' && !s.rows.some((l) => head.includes(l))) : null;
    await pressPaneHeader(ctx.d, title);
    const unfolded = await until(`the ${title} view unfolding with its head drawn`, 10000, () => paneState(ctx.d, title), (s) => s.expanded === 'true' && head.every((l) => s.rows.includes(l))).then(() => true, () => false);
    const folds = folded && hidden !== null && hidden.held && unfolded;
    const seen = `the panel reads ${JSON.stringify(drawn.slice(0, head.length + 2).map((r) => `${r.label}${r.description ? ` (${r.description})` : ''} at level ${r.level}`))}; `
      + `folded by its header ${folded ? (hidden?.held ? 'it drew none of the head rows for 1.5 s' : `it drew ${JSON.stringify(hidden?.broke)} at ${hidden?.atMs} ms`) : 'it did not fold'}; `
      + `unfolded, ${unfolded ? 'the head was drawn again' : 'the head was not drawn again within 10 s'}; capture ${captured}`;
    return { inOrder, runnable, beneath, folds, seen };
  };
  await c.run('catalog-panel.head-reads-search-catalog-then-draft-entity-and-folds-with-the-panel', {
    expected: `the Catalog panel's first rows are "${CATALOG_HEAD[0]}" then "${CATALOG_HEAD[1]}", each at the panel's top level and able to run, above the first kind heading; folding the panel by its header hides them with the list (watched for 1.5 s), and unfolding it draws them again`,
    plant: 'in the scratch copy, out/src/panel-actions.js made to draw every list panel\'s head in the reverse order',
  }, async () => {
    const r = await headAndFold('Catalog', 'aggrega.workspaceCatalog.focus', CATALOG_HEAD, (v) => v.some((x) => /^Aggregate \(\d+\)$/.test(x.label)), 'catalog-panel-head');
    const heading = r.beneath !== undefined && /^[A-Z][A-Za-z]+ \(\d+\)$/.test(r.beneath.label);
    return { passed: r.inOrder && r.runnable && heading && r.folds, seen: r.seen };
  });
  await c.run('catalog-panel.draft-entity-asks-for-the-kind', {
    expected: `pressing "${CATALOG_HEAD[1]}" at the head of the Catalog panel opens a list whose placeholder reads "${DRAFT_PLACEHOLDER}", offering, in order, the value each kind's document carries for every kind the compiler's own answer to the same request names; Escape closes it having drafted nothing`,
    plant: 'in the scratch copy, out/src/panel-actions.js made to bind no command to the Draft entity row',
  }, async () => {
    const answer = await referenceAnswer({ binary: bin, root: referenceFolder, method: 'aggrega/getSchema', params: {}, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(answer.ok, `the compiler gave no reference answer for the kinds: ${answer.ok ? '' : answer.error.message}`);
    const kinds = ((answer.result as { entityKinds?: { documentKind?: string }[] }).entityKinds ?? []).map((k) => k.documentKind ?? '');
    need(kinds.length > 0, 'the compiler names no kind an author may draft, so there is nothing for the question to offer');
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    await pressPanelAction(ctx.d, 'Catalog', CATALOG_HEAD[1]);
    const q = await waitQuickInput(ctx.d, 'the kind being asked for', (x) => x.placeholder === DRAFT_PLACEHOLDER && x.rows.length > 0, 15000);
    const offered = q.rows.map((row) => row.label);
    await ctx.d.press('Escape');
    const closed = await until('the kind question closing', 5000, () => quickInput(ctx.d), (x) => x === null).then(() => true, () => false);
    const active = await ctx.probe.request<{ path: string } | null>('editor.active');
    return {
      passed: JSON.stringify(offered) === JSON.stringify(kinds) && closed && active === null,
      seen: `the list's placeholder "${q.placeholder}", rows ${JSON.stringify(offered)}; the compiler's own answer names ${JSON.stringify(kinds)}; Escape ${closed ? 'closed it' : 'left it open'}; the active editor after it ${active?.path ?? 'none'}`,
    };
  });
  await c.run('registries-panel.head-leads-no-registries-configured-and-folds-with-the-panel', {
    expected: `with no registry configured, the Registries panel's first rows are "${REGISTRIES_HEAD[0]}" then "${REGISTRIES_HEAD[1]}", each at the panel's top level and able to run, and the row beneath them reads "${NO_REGISTRIES_ROW}"; folding the panel by its header hides them with the list (watched for 1.5 s), and unfolding it draws them again`,
    plant: 'in the scratch copy, out/src/panel-actions.js made to draw no head above a list that reads a message; or to draw every list panel\'s head in the reverse order',
  }, async () => {
    const r = await headAndFold('Registries', 'aggrega.registries.focus', REGISTRIES_HEAD, (v) => v.some((x) => x.label === NO_REGISTRIES_ROW), 'registries-panel-head');
    return { passed: r.inOrder && r.runnable && r.beneath?.label === NO_REGISTRIES_ROW && r.folds, seen: r.seen };
  });
  await c.run('registries-panel.add-registry-asks-for-the-host', {
    expected: `pressing "${REGISTRIES_HEAD[0]}" at the head of the Registries panel opens an input titled "${ADD_REGISTRY_TITLE}" asking for the registry's host; Escape closes it, and the panel still reads "${NO_REGISTRIES_ROW}"`,
    plant: 'in the scratch copy, out/src/panel-actions.js made to bind no command to the Add registry row',
  }, async () => {
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.registries.focus');
    await pressPanelAction(ctx.d, 'Registries', REGISTRIES_HEAD[0]);
    const q = await waitQuickInput(ctx.d, 'the host being asked for', (x) => x.title === ADD_REGISTRY_TITLE, 10000);
    await ctx.d.press('Escape');
    const closed = await until('the input closing', 5000, () => quickInput(ctx.d), (x) => x === null).then(() => true, () => false);
    const rows = ((await treeRows(ctx.d, 'Registries')) ?? []).map((r) => r.label);
    return { passed: closed && rows.includes(NO_REGISTRIES_ROW), seen: `an input titled "${q.title}" (placeholder "${q.placeholder}"); Escape ${closed ? 'closed it' : 'left it open'}; the panel then reads ${JSON.stringify(rows)}` };
  });
  await c.run('registries-panel.update-index-starts-the-update', {
    expected: `pressing "${REGISTRIES_HEAD[1]}" at the head of the Registries panel starts the index build: the output channel opens it with "${INDEX_BUILD_OPENING}" within 10 s`,
    plant: 'in the scratch copy, out/src/panel-actions.js made to bind no command to the Update index row',
  }, async () => {
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.registries.focus');
    await pressPanelAction(ctx.d, 'Registries', REGISTRIES_HEAD[1]);
    const text = await ctx.out.waitFor('the index build opening in the channel', mark, (t) => t.split('\n').includes(INDEX_BUILD_OPENING), 10000).catch(() => ctx.out.since(mark));
    const opened = text.split('\n').includes(INDEX_BUILD_OPENING);
    await sleep(2000);
    const channel = ctx.out.since(mark).split('\n').filter((l) => l.trim() !== '').slice(0, 6);
    const drawn = (await toastsSince(ctx.d, toastMark)).map((t) => `${t.message.slice(0, 120)} (${t.severity})`);
    return { passed: opened, seen: `the channel after the press: ${JSON.stringify(channel)}; notifications drawn since: ${JSON.stringify(drawn)}` };
  });
  await c.run('plugins-panel.head-reads-add-plugin-then-generate-entities-and-folds-with-the-panel', {
    expected: `the Plugins panel's first rows are "${PLUGINS_HEAD[0]}" then "${PLUGINS_HEAD[1]}", each at the panel's top level and able to run, above the first group of plugins; folding the panel by its header hides them with the list (watched for 1.5 s), and unfolding it draws them again`,
    plant: 'in the scratch copy, out/src/panel-actions.js made to draw every list panel\'s head in the reverse order',
  }, async () => {
    const r = await headAndFold('Plugins', 'aggrega.plugins.focus', PLUGINS_HEAD, (v) => v.length > PLUGINS_HEAD.length && !PLUGINS_HEAD.includes(v[v.length - 1].label), 'plugins-panel-head');
    const group = r.beneath !== undefined && !PLUGINS_HEAD.includes(r.beneath.label) && r.beneath.level === 1;
    return { passed: r.inOrder && r.runnable && group && r.folds, seen: r.seen };
  });
  await c.run('commands-panel.holds-none-of-the-list-panels-operations-and-keeps-its-order-and-walk', {
    expected: `the Commands panel's buttons read, in order, ${COMMANDS_PANEL_LABELS.join(', ')}: none of ${LIST_PANEL_OPERATIONS.join(', ')}, and no button runs one of their commands, while each of those is drawn at the head of its own panel in the same scenario; and from Validate the arrow keys walk ${COMMANDS_PANEL_WALK.join(' → ')}, and stay on the last`,
    plant: 'in the scratch copy, out/src/operation-groups.js with Draft entity put back at the top of the Author group',
  }, async () => {
    await closeAllEditors(ctx);
    await run(ctx, 'workbench.view.extension.aggrega');
    const panel = await commandsPanel(ctx.d);
    const buttons = await operationButtons(panel);
    need(buttons.find((b) => b.command === 'aggrega.op.build')?.disabled === false, 'Build cannot run here, so the chevron its walk passes through is not drawn');
    const labels = buttons.map((b) => b.label);
    const leaked = [...labels.filter((l) => LIST_PANEL_OPERATIONS.includes(l)), ...buttons.map((b) => b.command).filter((x) => LIST_PANEL_COMMANDS.includes(x))];
    // The positive control for that absence: every one of those operations is
    // drawn, at the head of its own panel, read in the same scenario.
    const heads = [
      ...((await treeRows(ctx.d, 'Catalog')) ?? []).slice(0, CATALOG_HEAD.length),
      ...((await treeRows(ctx.d, 'Registries')) ?? []).slice(0, REGISTRIES_HEAD.length),
      ...((await treeRows(ctx.d, 'Plugins')) ?? []).slice(0, PLUGINS_HEAD.length),
    ].map((r) => r.label);
    const drawnAtHeads = JSON.stringify(heads) === JSON.stringify(LIST_PANEL_OPERATIONS);
    await run(ctx, 'aggrega.operations.focus');
    await sleep(300);
    const focused = await panel.evaluate<boolean>(`(() => { const b = document.querySelector('button.op[data-command="aggrega.op.validate"]'); if (!b) { return false; } b.focus(); return document.activeElement === b; })()`);
    need(focused, 'Validate could not be given the focus, so the walk has nowhere to start');
    const stop = `(() => { const e = document.activeElement; if (!e) { return 'nothing'; } return e.dataset.command || (e.dataset.dials ? 'caret:' + e.dataset.dials : e.tagName); })()`;
    const walk = [await panel.evaluate<string>(stop)];
    // One press more than the walk has stops, so the last reading shows it stays
    // on the last stop rather than leaving the panel.
    for (let i = 0; i < COMMANDS_PANEL_WALK.length; i++) {
      await ctx.d.press('ArrowRight');
      await sleep(100);
      walk.push(await panel.evaluate<string>(stop));
    }
    const walked = JSON.stringify(walk) === JSON.stringify([...COMMANDS_PANEL_WALK, COMMANDS_PANEL_WALK[COMMANDS_PANEL_WALK.length - 1]]);
    const shot = await capture(ctx, 'commands-panel');
    return {
      passed: JSON.stringify(labels) === JSON.stringify(COMMANDS_PANEL_LABELS) && leaked.length === 0 && drawnAtHeads && walked,
      seen: `the buttons read ${JSON.stringify(labels)}; of the list panels' operations ${leaked.length === 0 ? 'none' : JSON.stringify(leaked)} on this panel; the list panels' heads read ${JSON.stringify(heads)}; the walk from Validate ${JSON.stringify(walk)}; capture ${shot}`,
    };
  });

  // ---- operations end in words ----
  const referenceRelease = path.join(referenceFolder, RELEASE);
  await c.run('operations.validate-ends-in-a-sentence', {
    expected: 'Validate with the Release in front ends in "Aggrega: validated release-compose.yaml: " followed by the count the compiler answers for it — "no problems found." for none, "<n> problems — see the Problems panel." otherwise',
    plant: 'in the scratch copy, out/src/extension.js made to raise no notification after a validation',
  }, async () => {
    const answer = await referenceAnswer({ binary: bin, root: referenceFolder, method: 'aggrega/validate', params: buildValidateParams(referenceRelease, fs.readFileSync(path.join(ctx.folder, RELEASE), 'utf8'), RELEASE), home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(answer.ok, 'the compiler gave no reference answer for the Release');
    const n = ((answer.result as { diagnostics?: unknown[] }).diagnostics ?? []).length;
    const want = `Aggrega: validated ${RELEASE}: ${n === 0 ? 'no problems found.' : n === 1 ? '1 problem — see the Problems panel.' : `${n} problems — see the Problems panel.`}`;
    await open(ctx, path.join(ctx.folder, RELEASE));
    const mark = (await toasts(ctx.d)).length;
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.validate');
    const t = await waitToast(ctx.d, 'the validation ending', mark, (x) => x.message.startsWith('Aggrega: validated'), 30000);
    return { passed: t.message === want, seen: `"${t.message}" (the compiler answers ${n} for it)` };
  });
  await c.run('operations.lint-ends-in-a-sentence', {
    expected: 'Lint ends in "Aggrega lint: no findings across <n> entities checked." (or the finding count), <n> being the count the compiler reports for the same workspace',
    plant: 'in the scratch copy, out/src/lint-run.js made to omit the count',
  }, async () => {
    const cli = await runCompiler(bin, ['--offline', 'lint'], { cwd: referenceFolder, home: ctx.home, boundMs: 120000, log: ctx.cliLog });
    const m = /conventions checked: (\d+) entities, (\d+) advisory finding/.exec(cli.stdout);
    need(m !== null, `the compiler's own lint gave no count: ${cli.stdout.slice(0, 200)}`);
    const want = Number(m[2]) === 0 ? `Aggrega lint: no findings across ${m[1]} entities checked.` : `Aggrega lint: ${m[2]} finding(s) across ${m[1]} entities checked — see the Problems panel.`;
    const mark = (await toasts(ctx.d)).length;
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.lint');
    const t = await waitToast(ctx.d, 'the lint ending', mark, (x) => x.message.startsWith('Aggrega lint:'), 120000);
    return { passed: t.message === want, seen: `"${t.message}" (the compiler's own lint: "${m[0]}")` };
  });
  await c.run('operations.build-ends-in-words-and-writes-its-files', {
    expected: 'Build opens the channel on "Build of release-compose.yaml.", lists each file it wrote, closes with the command line\'s own summary "Build completed: <n> files written to <directory>/", and raises "Aggrega: built release-compose.yaml — <n> file(s) written to <directory>/."; every listed file is on disk under <directory>',
    plant: 'in the scratch copy, out/src/operations.js made to count one file more in the build\'s notification than the build wrote',
  }, async () => {
    const cli = await runCompiler(bin, ['--offline', 'build', '--release', RELEASE, '--quiet'], { cwd: referenceFolder, home: ctx.home, boundMs: 180000, log: ctx.cliLog });
    const cliSummary = `${cli.stdout}\n${cli.stderr}`.split('\n').find((l) => l.startsWith('Build completed:')) ?? '';
    need(cliSummary !== '', `the command line's own build gave no summary: exit ${cli.status}`);
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.build');
    const text = await ctx.out.waitFor('the build closing its report', mark, (t) => /^Build completed: /m.test(t) || /^The build did not complete/m.test(t), 180000);
    const lines = text.split('\n');
    const start = lines.findIndex((l) => l === `Build of ${RELEASE}.`);
    const end = lines.findIndex((l) => l.startsWith('Build completed: '));
    need(end !== -1, `the build did not complete: ${lines.find((l) => l.startsWith('The build')) ?? ''}`);
    const m = /^Build completed: (\d+) files written to (.+)\/$/.exec(lines[end]);
    const files = lines.slice(start + 1, end).filter((l) => l.startsWith('  ')).map((l) => l.trim()).filter((l) => !l.includes(': '));
    const dir = m ? m[2] : '';
    const onDisk = files.filter((f) => fs.existsSync(path.join(dir, f)));
    const cliShape = /^Build completed: (\d+) files written to /.exec(cliSummary);
    const t = await waitToast(ctx.d, 'the build\'s notification', toastMark, (x) => x.message.startsWith('Aggrega: built'), 30000);
    const wantToast = `Aggrega: built ${RELEASE} — ${m?.[1]} file(s) written to ${dir}/.`;
    const passed = start !== -1 && m !== null && Number(m[1]) === files.length && onDisk.length === files.length && files.length > 0 &&
      cliShape !== null && cliShape[1] === m[1] && t.message === wantToast;
    return { passed, seen: `channel: "${lines[start] ?? ''}" … ${JSON.stringify(files)} … "${lines[end]}"; on disk ${onDisk.length} of ${files.length}; the command line's own: "${cliSummary}"; notification "${t.message}"` };
  });

  // ---- settings that are wrong ----
  const said: string[] = [];
  const original = fs.readFileSync(config, 'utf8');
  await c.run('settings-that-are-wrong.missing-catalog-and-unreachable-registry-are-named', {
    expected: `with "- ./no-such-catalog" under catalog_dirs and a top-level registries list holding "${UNREACHABLE_HOST}", the extension says so: something it draws or writes to its channel names the missing catalog directory, and something names ${UNREACHABLE_HOST}; the language server still runs and the graph still draws`,
    plant: 'in the scratch copy, out/src/extension.js made to write nothing to the channel',
  }, async () => {
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    const catalogLine = await lineOf(ctx, config, '- ./catalog');
    await ctx.probe.request('document.edit', { path: config, start: { line: catalogLine.index + 1, character: 0 }, text: `    - ./no-such-catalog\nregistries:\n  - host: ${UNREACHABLE_HOST}\n` });
    await save(ctx, config);
    // A changed configuration is read by the server when it starts; the
    // extension offers the restart, which is pressed where offered.
    const before = await theServer(ctx);
    const offer = await waitToast(ctx.d, 'the change being noticed', toastMark, (x) => x.buttons.includes(RESTART_SERVER_ACTION), 15000).catch(() => null);
    if (offer) { await pressToastButton(ctx.d, offer.message.slice(0, 40), RESTART_SERVER_ACTION); } else { await send(ctx, RESTART_COMMAND); }
    await theServer(ctx, 30000, before.pid).catch(() => undefined);
    await waitStatus(ctx.d, RUNNING, 60000).catch(() => undefined);
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.graph.show').catch(() => undefined);
    const graph = await documentWith(ctx.d, 'the graph drawing', `!!document.getElementById('canvas') && document.querySelectorAll('#canvas g, #canvas rect').length > 0`, 30000).then(() => true, () => false);
    await run(ctx, 'workbench.view.extension.aggrega');
    await pressViewAction(ctx, 'Registries', 'Refresh registries').catch(() => undefined);
    const views = async (title: string): Promise<string[]> => ((await treeRows(ctx.d, title)) ?? []).map((r) => `${title} view: ${r.label}${r.description ? ` ${r.description}` : ''}${r.aria && r.aria !== r.label ? ` (${r.aria.replace(/\s+/g, ' ')})` : ''}`);
    const everything = async (): Promise<string[]> => [
      ...(await toastsSince(ctx.d, toastMark)).map((t) => `notification: ${t.message}`),
      ...ctx.out.since(mark).split('\n').filter((l) => l.trim() !== '').map((l) => `channel: ${l}`),
      ...(await ctx.probe.request<{ path: string; diagnostics: { message: string }[] }[]>('diagnostics.list')).flatMap((e) => e.diagnostics.map((d) => `problem in ${path.basename(e.path)}: ${d.message}`)),
      ...(await views('Registries')),
    ];
    const named = (l: string[]): boolean => l.some((x) => x.includes('no-such-catalog')) && l.some((x) => x.includes(UNREACHABLE_HOST));
    const lines = await until('the extension naming the missing catalog and the unreachable registry', 10000, everything, named).catch(() => everything());
    said.push(...lines);
    const catalogNamed = lines.some((l) => l.includes('no-such-catalog'));
    const hostNamed = lines.some((l) => l.includes(UNREACHABLE_HOST));
    const running = (await statusLog(ctx.d)).slice(-1)[0]?.reading === RUNNING;
    return { passed: catalogNamed && hostNamed && running && graph, seen: `the missing catalog named ${catalogNamed}; ${UNREACHABLE_HOST} named ${hostNamed}; the server ${running ? 'running' : 'not running'}; the graph ${graph ? 'drew' : 'did not draw'}`, evidence: { said: lines } };
  });
  // Put the configuration back and let the server read it.
  fs.writeFileSync(config, original);
  await closeAllEditors(ctx);
  const beforeRestore = await theServer(ctx).catch(() => null);
  await send(ctx, RESTART_COMMAND);
  if (beforeRestore) { await theServer(ctx, 30000, beforeRestore.pid).catch(() => undefined); }
  await waitStatus(ctx.d, RUNNING, 60000).catch(() => undefined);

  const missing = path.join(ctx.s.root.dir, 'no-such-compiler', 'aggrega');
  const userSettings = path.join(ctx.s.root.userData, 'User', 'settings.json');
  let errorToasts = 0;
  await c.run('settings-that-are-wrong.missing-compiler-is-named', {
    expected: `aggrega.server.binaryPath pointed at a file that does not exist (${missing}) is said: the status bar reads "${NOT_RUNNING}" and something the extension draws or writes names that path`,
    plant: 'in the scratch copy, out/src/daemon.js made to swallow the spawn error, reporting a failure to start in a sentence naming no path',
  }, async () => {
    need(!fs.existsSync(missing), `${missing} exists`);
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    const text = fs.readFileSync(userSettings, 'utf8');
    const settingLine = `  "aggrega.server.binaryPath": ${JSON.stringify(bin)}`;
    need(text.split(settingLine).length === 2, 'the user settings do not state the binary path once');
    await open(ctx, userSettings);
    const at = await lineOf(ctx, userSettings, settingLine);
    await ctx.probe.request('document.edit', { path: userSettings, start: { line: at.index, character: 0 }, end: { line: at.index + 1, character: 0 }, text: `${at.text.replace(JSON.stringify(bin), JSON.stringify(missing))}\n` });
    await save(ctx, userSettings);
    const stopped = await waitStatus(ctx.d, NOT_RUNNING, 60000).then(() => true, () => false);
    const read = async (): Promise<string[]> => [
      ...(await toastsSince(ctx.d, toastMark)).map((t) => `notification (${t.severity}): ${t.message}`),
      ...ctx.out.since(mark).split('\n').filter((l) => l.trim() !== '').map((l) => `channel: ${l}`),
    ];
    const lines = await until('the extension naming the missing compiler', 10000, read, (l) => l.some((x) => x.includes(missing))).catch(() => read());
    said.push(...lines);
    errorToasts = (await toastsSince(ctx.d, toastMark)).filter((t) => t.severity === 'error').length;
    const named = lines.some((l) => l.includes(missing));
    // Put the binary back.
    await open(ctx, userSettings);
    const back = await lineOf(ctx, userSettings, at.text.replace(JSON.stringify(bin), JSON.stringify(missing)));
    await ctx.probe.request('document.edit', { path: userSettings, start: { line: back.index, character: 0 }, end: { line: back.index + 1, character: 0 }, text: `${at.text}\n` });
    await save(ctx, userSettings);
    await closeAllEditors(ctx);
    return { passed: stopped && named, seen: `status ${stopped ? `read "${NOT_RUNNING}"` : 'did not read not running'}; the path named ${named}; ${errorToasts} error notification(s)`, evidence: { said: lines } };
  });
  await c.forPerson('settings-that-are-wrong.what-the-extension-says-is-enough', {
    expected: 'what the extension says about a missing catalog, an unreachable registry and a missing compiler is enough for a new user to act on',
    plant: 'none: this is a judgement of the wording',
    question: 'Is what the extension said, below, enough for a person to see what is wrong and put it right?',
  }, async () => ({ screenshot: await capture(ctx, 'settings-that-are-wrong'), drawnText: said.join('\n') }));
}
