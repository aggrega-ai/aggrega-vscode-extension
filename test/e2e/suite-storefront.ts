// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { buildParams, buildPreviewParams } from '../../src/build-dials';
import { RESTART_COMMAND, RESTART_SERVER_ACTION } from '../../src/daemon-status';
import { buildValidateParams } from '../../src/validate-request';
import { Judgement, need } from './checks';
import { runCompiler } from './cli';
import { COMMANDS_PANEL_LABELS } from './commands-panel';
import { WebviewDocument } from './drivers';
import { UNREACHABLE_HOST } from './fixtures';
import { NoticeReading, noticeReadings, watchNotice } from './graph-drawing';
import { findGraphPanel, GRAPH_PANEL_OPENING, graphCouldNotBeDrawn } from './graph-panel';
import { DiagnosticEntry } from './probe-client';
import { Publication, referenceAnswer, ReferenceAnswer } from './reference';
import { CACHE_MISS_CHECKS, cacheMissChecks } from './suite-cache-miss';
import { CONFIG_PANEL_CHECKS, configPanelChecks } from './suite-config-panel';
import {
  capture, catalogPanelAtItsHead, closeAllEditors, commandTitle, deleteLine, describeDiagnostics, diagnostics, lineOf, open, putBack, ready, run, save,
  send, SuiteContext, theServer,
} from './suite-context';
import { contextRowsCheck, settingsScreen } from './suite-gateway';
import { INSPECTION_CHECKS, inspectionChecks } from './suite-inspection';
import { BINARY_PATH_SEARCH, notFoundAt, OPEN_BINARY_PATH_SETTING, RUNTIME_WORDS, START_FAILED_OPENING } from './suite-killed';
import {
  commandsPanel, describeRowMenu, guard, holds, NOT_RUNNING, operationButtons, paneState, pickQuickInputRow, pressIn, pressKeyIn, pressMenuItem, pressOperation, pressPaneHeader,
  pressPanelAction, pressToastButton, QuickInput, quickInput, rowMenu, RUNNING, sleep, stated, statusLog, STARTING, Toast, toasts, toastsSince, toastWindowPassed, TreeRow,
  treeRowCentre, treeRows, until, waitQuickInput, waitStatus, waitToast,
} from './workbench';

// BINARY_PATH is the setting naming the compiler, as its key.
const BINARY_PATH = 'aggrega.server.binaryPath';

// The checks run in the storefront folder: the capabilities walked end to end —
// the configuration panel's resizable columns, the language server recovering
// from a kill, diagnostics on a real mistake and across a cascade, an inspection
// refused because of the document declaring the entity, completion and hover,
// a hover answered after its document changed on disk, the published-catalog
// search with no registry and the filter it keeps from one search to the next,
// the workspace catalog panel, the operations heading the Catalog, Registries and
// Plugins panels and the Commands panel that holds none of them, the operations
// that end in words, a refusal raised while rendering filed on the Recipe it names,
// what the extension says about settings that are wrong, and a failure of the
// Release's dependencies filed on the Release and not on a YAML file that is not an
// Aggrega document.

export const STOREFRONT_CHECKS = [
  'commands-panel.context-rows-name-the-opened-folder',
  ...CONFIG_PANEL_CHECKS,
  'language-server.restarts-after-a-kill',
  'problems.authoring-mistake-lands-on-its-line-in-the-compilers-words',
  'problems.authoring-mistake-reads-as-actionable',
  'problems.findings-leave-with-the-document-the-editor-closes',
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
  'catalog-view.refused-validation-ends-in-the-compilers-words',
  'catalog-view.each-row-offers-what-the-compiler-accepts-for-its-kind',
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
  'problems.render-refusal-lands-on-its-recipe-in-the-compilers-words',
  'settings-that-are-wrong.missing-catalog-and-unreachable-registry-are-named',
  'settings-that-are-wrong.failing-dependencies-are-not-filed-on-a-ci-workflow',
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
export const SEARCH_TITLE = 'Aggrega: search published catalog';
const SEARCH_PLACEHOLDER = 'Narrow the search, then choose Search';

// The rows at the head of the Catalog panel, by the words each reads, in the
// order the panel draws them; the first opens the search.
const CATALOG_HEAD = ['Search catalog', 'Draft entity'];

// The rows at the head of the Registries and Plugins panels, the row the
// Registries panel draws beneath its head with no registry configured, and what
// pressing a head row asks or writes first, held as written for the same reason.
export const REGISTRIES_HEAD = ['Add registry', 'Update index'];
const PLUGINS_HEAD = ['Add plugin', 'Generate entities'];
const NO_REGISTRIES_ROW = 'No registries configured.';
export const DRAFT_PLACEHOLDER = 'Aggrega: choose the kind of entity to draft';
const ADD_REGISTRY_TITLE = 'Aggrega: add a registry';
export const INDEX_BUILD_OPENING = 'Index build for every configured registry.';

// The stops the Commands panel's arrow keys walk from Validate — the Build options
// chevron beside Build among them — held as written, beside the buttons in the
// order it draws them (COMMANDS_PANEL_LABELS, commands-panel.ts). None of the
// operations heading a list panel is among either, by label or by command.
const COMMANDS_PANEL_WALK = [
  'aggrega.op.validate', 'aggrega.op.lint', 'aggrega.op.build', 'caret:build', 'aggrega.op.preview', 'aggrega.graph.show', 'aggrega.op.pull',
  'aggrega.op.import', 'aggrega.op.inspect', 'aggrega.op.push', 'aggrega.op.sign', 'aggrega.op.deprecate', 'aggrega.config.open', 'aggrega.op.cache',
];
const LIST_PANEL_OPERATIONS = [...CATALOG_HEAD, ...REGISTRIES_HEAD, ...PLUGINS_HEAD];
const LIST_PANEL_COMMANDS = [
  'aggrega.catalog.searchPublished', 'aggrega.op.scaffold', 'aggrega.registries.add', 'aggrega.registries.update', 'aggrega.plugins.add', 'aggrega.plugins.genCatalog',
];

// The opening of the sentence a correctness check the compiler refused ends in,
// held as written for the same reason.
const CHECK_REFUSED_OPENING = 'The check did not complete: ';

// The stopped-responding notification, held as written for the same reason.
export const STOPPED_RESPONDING = 'Aggrega language server has stopped responding. Run "Aggrega: Start or restart the language server" to recover.';

// A continuous-integration workflow: YAML the editor sends for validation, and no
// document of Aggrega's own — it carries no apiVersion and no kind.
const CI_WORKFLOW = [
  'name: ci',
  'on:',
  '  push:',
  '    branches: [main]',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - run: npm test',
  '',
].join('\n');

// A Recipe for the cache, written into the folder's own catalog by the check that
// needs it and taken out again, so no fixture carries a Recipe that refuses. The
// refusing text's Workload names the slot UNDECLARED_SLOT, which the cache's
// Component does not declare, so the render refuses it; the corrected text is the
// same Recipe with that reference taken out, which renders. The Manifest maps the
// cache to it for as long as the check runs.
const CACHE_RECIPE = ['catalog', 'recipe', 'compose', 'storefront-cache', '1.0.0', 'recipe.yaml'];
const CACHE_MAPPING = 'core/datastore/memcached:1.0.0: compose/memcached:1.0.0';
const CACHE_MAPPED = 'core/datastore/memcached:1.0.0: compose/storefront-cache:1.0.0';
const UNDECLARED_SLOT = 'passwordd';
const CACHE_WORKLOAD_KEY = '  workload: |';
const CACHE_RECIPE_HEAD = [
  'apiVersion: aggrega.ai/v1alpha1',
  'kind: Recipe',
  'metadata:',
  '  name: storefront-cache',
  '  version: 1.0.0',
  '  description: The cache for local development.',
  'spec:',
  '  capability: compose',
  '  implements: core/datastore/memcached:1.0.0',
  '  provides:',
  '    host: "{{ .context.instance_id }}"',
  '    port: "{{ .infra.port }}"',
  '    protocol: "memcached"',
  CACHE_WORKLOAD_KEY,
  '    apiVersion: aggrega.ai/v1alpha1',
  '    kind: Workload',
  '    containers:',
  '      main:',
  '        image: "memcached:{{ .infra.engine_version }}"',
  '        ports:',
  '          memcached: {{ .infra.port }}',
];
const CACHE_SLOT_REFERENCE = [
  '        attachments:',
  '          MEMCACHED_PASSWORD:',
  `            from: ${UNDECLARED_SLOT}`,
  '            as: env',
];
const CACHE_RECIPE_TAIL = [
  '    services:',
  '      default:',
  '        type: ClusterIP',
  '        ports:',
  '          memcached: {{ .infra.port }}',
  '',
];
const CACHE_REFUSING = [...CACHE_RECIPE_HEAD, ...CACHE_SLOT_REFERENCE, ...CACHE_RECIPE_TAIL].join('\n');
const CACHE_CORRECTED = [...CACHE_RECIPE_HEAD, ...CACHE_RECIPE_TAIL].join('\n');

// The lines a build and a preview end in on the output channel, and the
// notifications they end in, refused or completed, held as written for the same
// reason as the words above.
const BUILD_ENDING = /^(The build did not complete|Build completed: |The preview did not complete|A build of this Release writes )/;
const BUILD_ENDING_NOTICE = /^(The build did not complete|The preview did not complete|Aggrega: built |Aggrega: a build of )/;

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
// the pointer is over the view's header; `pressIn` (workbench.ts) waits for it to
// be drawn and confirms the press reached it.
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
  await pressIn(ctx.d, null, `#workbench\\.parts\\.sidebar .pane-header .action-label[aria-label="${actionLabel}"]`);
}

// LanguageMode is a language as the editor's Change Language Mode lists it, and
// the identifier the editor reports for a document given it.
interface LanguageMode { name: string; id: string }
const PLAIN_TEXT: LanguageMode = { name: 'Plain Text', id: 'plaintext' };
const YAML_MODE: LanguageMode = { name: 'YAML', id: 'yaml' };

// CLOSED_WATCH_MS is how long a closed document is watched carrying no finding.
const CLOSED_WATCH_MS = 3000;

// giveLanguage gives an open document another language as a person does — the
// document in front, the editor's own Change Language Mode, the language's name
// typed and its row pressed — and answers with the language the editor then
// reports for the document.
async function giveLanguage(ctx: SuiteContext, file: string, mode: LanguageMode): Promise<string> {
  await open(ctx, file);
  await send(ctx, 'workbench.action.editor.changeLanguageMode');
  await waitQuickInput(ctx.d, 'the editor\'s list of languages', (q) => q.rows.length > 0);
  await ctx.d.type(mode.name);
  await waitQuickInput(ctx.d, `the list of languages offering ${mode.name}`, (q) => q.rows.some((r) => r.label === mode.name));
  await pickQuickInputRow(ctx.d, mode.name);
  const active = (): Promise<{ path: string; languageId: string } | null> => ctx.probe.request<{ path: string; languageId: string } | null>('editor.active');
  const doc = await until(`the document reading as ${mode.id}`, 5000, active, (v) => v !== null && v.path === file && v.languageId === mode.id).catch(active);
  return doc === null ? 'no active editor' : doc.languageId;
}

// killServer signals the language server this window started, by its recorded
// PID, as a person does with `kill <pid>`, and returns what it signalled.
export async function killServer(ctx: SuiteContext): Promise<{ pid: number; cwd: string }> {
  const srv = await theServer(ctx);
  need(srv.cwd === ctx.folder, `the language server runs in ${srv.cwd}, not in the folder the window opened`);
  process.kill(srv.pid, 'SIGTERM');
  return { pid: srv.pid, cwd: srv.cwd };
}

const MISTAKE_ACTIONABLE = Judgement.declare('problems.authoring-mistake-reads-as-actionable', {
  expected: 'the complaint reads as something a person can act on',
  plant: 'none: this is a judgement of the wording',
  question: 'Does the complaint tell a person what to fix in the Feature?',
});

const NO_REGISTRY_SENTENCE = Judgement.declare('catalog-search.no-registry-sentence-directs-the-reader', {
  expected: 'the remediation sentence sends the reader where the control is',
  plant: 'none: this is a judgement of the wording',
  question: 'The sentence sends the reader to "Add registry" and then "Update index", the two rows at the head of the Registries panel. Does that direct the reader well?',
});

const SAYS_ENOUGH = Judgement.declare('settings-that-are-wrong.what-the-extension-says-is-enough', {
  expected: 'what the extension says about a missing catalog, an unreachable registry and a missing compiler is enough for a new user to act on',
  plant: 'none: this is a judgement of the wording',
  question: 'Is what the extension said, below, enough for a person to see what is wrong and put it right?',
});

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
  await c.forPerson(MISTAKE_ACTIONABLE, async () => {
    need(mistakeText !== '', 'no complaint was filed, so there is nothing to judge');
    return { screenshot: mistakeShot, drawnText: mistakeText };
  });

  // ---- findings leave with a document the editor closes ----
  // The editor reports a document closed when it disposes of it or gives it
  // another language. A closed tab disposes of a document only once nothing else
  // holds it, and the editor keeps a document an extension opened — the probe's
  // own openings among them — for minutes after its last tab closes; a change of
  // language is reported at once. So the check closes the document by giving it
  // another language, with the editor's own picker.
  await c.run('problems.findings-leave-with-the-document-the-editor-closes', {
    expected: `with the Feature's metadata.version deleted and left unsaved, and its complaint filed under "aggrega", giving the document the language ${PLAIN_TEXT.name} through the editor's Change Language Mode — which the editor reports as closing the YAML document — takes every finding on it out of the Problems panel, and none is filed on it again (watched for ${CLOSED_WATCH_MS} ms); giving it ${YAML_MODE.name} again files the complaint again, so the edit still stood and what took the complaint out was the close`,
    plant: 'in the scratch copy, out/src/extension.js made to leave the findings of a YAML document the editor closes standing',
  }, async () => {
    const removed = await deleteLine(ctx, feature, 'version: 1.0.0');
    try {
      const complaintOn = (v: { source: string | null }[]): boolean => v.some((d) => d.source === 'aggrega');
      const filed = await until('the complaint being filed', 20000, () => diagnostics(ctx, feature), complaintOn).catch(() => null);
      need(filed !== null, 'no complaint was filed on the Feature with its metadata.version deleted, so there is nothing for the close to take out');
      const closedAs = await giveLanguage(ctx, feature, PLAIN_TEXT);
      const left = await until('every finding leaving the closed document', 3000, () => diagnostics(ctx, feature), (v) => v.length === 0).then(() => null, (err: unknown) => (err instanceof Error ? err.message : String(err)));
      const out = left === null ? await holds(CLOSED_WATCH_MS, () => diagnostics(ctx, feature), (v) => v.length === 0) : null;
      const reopenedAs = await giveLanguage(ctx, feature, YAML_MODE);
      const back = await until('the complaint filed again once the document reads as YAML', 20000, () => diagnostics(ctx, feature), complaintOn).catch(() => null);
      return {
        passed: closedAs === PLAIN_TEXT.id && left === null && out !== null && out.held && reopenedAs === YAML_MODE.id && back !== null,
        seen: `filed: ${describeDiagnostics(feature, filed)}; given ${PLAIN_TEXT.name}, the editor reports ${closedAs}, and ${left === null ? `no finding was left on it, ${out?.held ? `none filed again over ${CLOSED_WATCH_MS} ms` : `then ${describeDiagnostics(feature, out?.broke ?? [])} at ${out?.atMs} ms`}` : left}; given ${YAML_MODE.name} again, the editor reports ${reopenedAs}, and ${back === null ? 'no complaint was filed again' : `${describeDiagnostics(feature, back)} was filed again`}`,
      };
    } finally {
      // The Feature as it was: read as YAML, the line back, saved, its complaint
      // gone — whatever the check above saw — so the checks after it read the
      // folder the scenario opened.
      if ((await quickInput(ctx.d).catch(() => null)) !== null) { await ctx.d.press('Escape'); }
      const active = await ctx.probe.request<{ path: string; languageId: string } | null>('editor.active').catch(() => null);
      if (active === null || active.path !== feature || active.languageId !== YAML_MODE.id) { await giveLanguage(ctx, feature, YAML_MODE).catch(() => undefined); }
      await putBack(ctx, feature, removed);
      await until('the complaint clearing once the line is back', 20000, () => diagnostics(ctx, feature), (v) => !v.some((d) => d.source === 'aggrega')).catch(() => undefined);
      await save(ctx, feature);
    }
  });

  // ---- diagnostics across a cascade ----
  const referenceModule = path.join(referenceFolder, path.relative(ctx.folder, moduleFile));
  const referenceAggregate = path.join(referenceFolder, 'aggregate.yaml');
  await c.run('problems.cascade-names-the-entity-that-broke', {
    expected: 'with the Aggregate open, deleting metadata.version from the module it imports and saving that file, then pressing Validate with the Aggregate in front, files on the Aggregate the compiler\'s answer for it, which names the module\'s file and its missing metadata.version',
    plant: 'in the scratch copy, out/src/diagnostics-shape.js made to cut a message at its note, which drops the part naming the file that broke',
  }, async () => {
    await open(ctx, aggregate);
    const whole = fs.readFileSync(moduleFile, 'utf8');
    const removed = await deleteLine(ctx, moduleFile, 'version: 1.0.0');
    // 🔴 THE MODULE IS PUT BACK, IN THE FOLDER AND IN THE REFERENCE COPY, AND THE
    // AGGREGATE VALIDATED WHOLE AGAIN, WHATEVER THE WAITS BELOW DO. A wait that runs
    // out throws, and a check stopped with the module broken would leave every check
    // after it reading a workspace whose dependencies do not resolve.
    try {
      await save(ctx, moduleFile);
      // Whether the cascade reaches the Aggregate without asking is recorded, not
      // judged: either answer is a behaviour a reader may meet, and the check's
      // verdict rests on what Validate reports. So it is watched for a stated 10 s:
      // a guard would make every run where it does not arrive wait the guard out.
      await open(ctx, aggregate);
      const unasked = await until('the cascade reaching the Aggregate unasked', stated(10000), () => diagnostics(ctx, aggregate), (v) => v.some((d) => d.message.includes(moduleFile))).then(() => true, () => false);
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
      return {
        passed: words && namesField,
        seen: `unasked, the cascade ${unasked ? 'reached' : 'did not reach'} the Aggregate within 10 s; Validate said "${report}"; the entry naming the module: ${naming ? JSON.stringify(naming.message.split('\n').slice(0, 3).join(' / ')) : 'none'}; the compiler's words ${words ? 'carried unchanged' : 'differ'}; with the module's type broken instead, the Aggregate reads ${JSON.stringify(typeEntries)}`,
        evidence: { reference: ref, entries: after, typeBroken: typeEntries },
      };
    } finally {
      // The module's text as it was found, written through the editor wherever it
      // differs or is unsaved, so the editor holds no other version of it; the
      // reference copy's module from the same text.
      const now = await open(ctx, moduleFile);
      if (now.text !== whole) {
        const lines = (now.text ?? '').split('\n');
        await ctx.probe.request('document.edit', { path: moduleFile, start: { line: 0, character: 0 }, end: { line: lines.length - 1, character: lines[lines.length - 1].length }, text: whole });
      }
      if (now.text !== whole || now.isDirty) { await save(ctx, moduleFile); }
      fs.writeFileSync(referenceModule, whole);
      // Validate once more with the module whole, so no entry of this check stays
      // on the Aggregate for the checks after it.
      await open(ctx, aggregate);
      const cleanMark = (await toasts(ctx.d)).length;
      await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.validate');
      await waitToast(ctx.d, 'the validation with the module whole', cleanMark, (t) => t.message.startsWith('Aggrega: validated aggregate.yaml'), 30000).catch(() => undefined);
      await until('the Aggregate clear of this check\'s entries', 20000, () => diagnostics(ctx, aggregate), (v) => !v.some((d) => d.message.includes('valkeyx') || d.message.includes(moduleFile))).catch(() => undefined);
    }
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
    // Read once its rows are drawn: the editor can draw the title a moment before them.
    const q = await waitQuickInput(ctx.d, 'the search palette drawing its rows', (x) => x.title === SEARCH_TITLE && x.rows.length > 0);
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
  await c.forPerson(NO_REGISTRY_SENTENCE, async () => {
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
    created = await until(`the "${copyName}" row appearing`, stated(10000), () => treeRows(ctx.d, 'Catalog'), (v) => v !== null && v.some((r) => r.label === copyName)).then(() => true, () => false);
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
    const gone = await until(`the "${copyName}" row leaving`, stated(10000), () => treeRows(ctx.d, 'Catalog'), (v) => v !== null && !v.some((r) => r.label === copyName)).then(() => true, () => false);
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
    const gone = await until(`the "${copyName}" row leaving`, stated(5000), () => treeRows(ctx.d, 'Catalog'), (v) => v !== null && !v.some((r) => r.label === copyName)).then(() => true, () => false);
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
  // A correctness check the compiler refuses, pressed on a row, ends in the
  // compiler's own words. The refusal is one the compiler raises for a kind it
  // checks, over a document it cannot accept as written, so the check does not
  // rest on which kinds a row offers the operation for.
  const validateItem = commandTitle(ctx.manifest, 'aggrega.workspaceCatalog.validate');
  const featureName = 'local/nightly-backup';
  const featureWhole = fs.readFileSync(feature, 'utf8');
  await c.run('catalog-view.refused-validation-ends-in-the-compilers-words', {
    expected: `with the Feature's version line removed and the file saved, "${validateItem}" pressed in the context menu of the Catalog row "${featureName}" ends in an error notification and a closing line on the output channel that each read "${CHECK_REFUSED_OPENING}the compiler exited with status <n>: " followed by <words>, <n> and <words> being the exit status and the standard error of \`aggrega validate\` given the same path over the same bytes outside the editor — the channel's lines by equality, the notification's with each run of blank space read as one, as the editor draws it`,
    plant: 'in the scratch copy, out/src/cli-run.js with a refused run reported by its exit status alone',
  }, async () => {
    const rel = path.relative(ctx.folder, feature);
    const referenceFeature = path.join(referenceFolder, rel);
    const referenceWhole = fs.readFileSync(referenceFeature, 'utf8');
    const broken = referenceWhole.split('\n').filter((l) => l.trim() !== 'version: 1.0.0').join('\n');
    need(broken.split('\n').length === referenceWhole.split('\n').length - 1, 'the Feature does not carry its version line exactly once');
    fs.writeFileSync(referenceFeature, broken);
    const cli = await runCompiler(bin, ['validate', rel], { cwd: referenceFolder, home: ctx.home, boundMs: 120000, log: ctx.cliLog });
    fs.writeFileSync(referenceFeature, referenceWhole);
    const words = cli.stderr.trim();
    need(cli.status !== 0 && words !== '', `the compiler did not refuse the broken Feature outside the editor: exit ${cli.status ?? cli.signal}, standard error ${JSON.stringify(cli.stderr.slice(0, 200))}`);
    const want = `${CHECK_REFUSED_OPENING}the compiler exited with status ${cli.status}: ${words}`;
    const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();

    // The same break, made as an author makes it and saved. It is undone below,
    // after the check, whatever the check reached.
    await deleteLine(ctx, feature, 'version: 1.0.0');
    await save(ctx, feature);
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    const menu = await rowMenu(ctx.d, 'Catalog', featureName);
    need(menu.reached, `the "${featureName}" row's context menu could not be read: ${describeRowMenu(menu)}`);
    need(menu.items.includes(validateItem), `the "${featureName}" row's context menu offers ${JSON.stringify(menu.items)}, so "${validateItem}" cannot be pressed`);
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    const taken = await pressMenuItem(ctx.d, validateItem);
    need(taken !== null, `the context menu draws no "${validateItem}" item to press`);
    const text = await ctx.out.waitFor('the check closing on the channel', mark, (t) => t.split('\n').some((l) => l.startsWith(CHECK_REFUSED_OPENING)), 60000).catch(() => ctx.out.since(mark));
    const lines = text.split('\n');
    const at = lines.findIndex((l) => l.startsWith(CHECK_REFUSED_OPENING));
    const closing = at === -1 ? '' : lines.slice(at, at + want.split('\n').length).join('\n');
    const told = await waitToast(ctx.d, 'the check\'s notification', toastMark, (t) => t.message.startsWith(CHECK_REFUSED_OPENING), 30000).catch(() => null);
    const passed = closing === want && told !== null && told.severity === 'error' && flat(told.message) === flat(want);
    return {
      passed,
      seen: `pressed by ${taken}; the channel closes ${JSON.stringify(closing.slice(0, 400))}; the notification ${told === null ? 'none opening that way' : `${JSON.stringify(told.message.slice(0, 400))} (${told.severity}, buttons ${JSON.stringify(told.buttons)})`}; the compiler outside the editor: exit ${cli.status}, ${JSON.stringify(words.slice(0, 300))}`,
      evidence: { want, closing, told },
    };
  });
  // The Feature is left as it was found, and the Catalog panel scrolled back to
  // its head, where the checks after this one read it: the row pressed above
  // sits far enough down its list to have scrolled the panel.
  if (fs.readFileSync(feature, 'utf8') !== featureWhole) {
    await closeAllEditors(ctx);
    await run(ctx, 'workbench.action.files.revert').catch(() => undefined);
    fs.writeFileSync(feature, featureWhole);
  }
  await closeAllEditors(ctx);
  await catalogPanelAtItsHead(ctx, CATALOG_HEAD[0]).catch(() => false);

  // Which operations each row's context menu offers, held against the language
  // server's own answers: the one naming the kinds, which says what each
  // operation accepts a document of each kind for, and the index the panel is
  // drawn from, which says which rows have a document in the folder. Both are
  // asked outside the editor over the same folder, so no kind and no operation's
  // kinds are written here. One row of every kind the index lists is swept, with
  // a document and without one wherever it lists both.
  const rowItems = {
    inspect: commandTitle(ctx.manifest, 'aggrega.workspaceCatalog.inspect'),
    validate: validateItem,
    lint: commandTitle(ctx.manifest, 'aggrega.workspaceCatalog.lint'),
    push: commandTitle(ctx.manifest, 'aggrega.workspaceCatalog.push'),
  };
  const rowItemTitles: string[] = Object.values(rowItems);
  await c.run('catalog-view.each-row-offers-what-the-compiler-accepts-for-its-kind', {
    expected: `the context menu of one Catalog row of every kind the index lists — with a document in the folder, and without one wherever it lists both — holds, of "${rowItems.inspect}", "${rowItems.validate}", "${rowItems.lint}" and "${rowItems.push}", exactly those the language server's own answer to \`aggrega/getSchema\` naming no kind accepts for the row's kind, in that order: the inspection where it states \`inspectionByName\`; on a row with a document, the check where it states \`singleEntityValidation\`, the conventions check always, and the publication where it states \`publication\`; the rows and which of them have a document being the language server's own \`aggrega/catalogIndex\` answer over the same folder; and that answer withholds at least one of them from at least one row swept. Each menu is read off a right-click whose own event reached that row: a row it reached that draws no menu offers nothing, a right-click that landed elsewhere is taken again, and a row none reached leaves the check not run, naming what each landed on`,
    plant: 'in the scratch copy, out/src/catalog-entity-operations.js with the check offered on every row with a document, whatever the compiler says it accepts for the row\'s kind',
  }, async () => {
    const kindsAnswer = await referenceAnswer({ binary: bin, root: referenceFolder, method: 'aggrega/getSchema', params: {}, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(kindsAnswer.ok, `the compiler gave no reference answer for the kinds: ${kindsAnswer.ok ? '' : kindsAnswer.error.message}`);
    const indexAnswer = await referenceAnswer({ binary: bin, root: referenceFolder, method: 'aggrega/catalogIndex', params: {}, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(indexAnswer.ok, `the compiler gave no reference answer for the entity index: ${indexAnswer.ok ? '' : indexAnswer.error.message}`);
    type Stated = { singleEntityValidation?: unknown; publication?: unknown; inspectionByName?: unknown };
    const kinds = (kindsAnswer.result as { entityKinds?: { documentKind?: string; acceptedBy?: Stated }[] }).entityKinds ?? [];
    const entities = (indexAnswer.result as { entities?: { kind: string; name: string; origin: string; file: string }[] }).entities ?? [];
    need(entities.length > 0, 'the compiler lists no entity in the folder, so there is no row to sweep');
    // One row per kind and per having a document, the first the index lists.
    const swept = new Map<string, { kind: string; name: string; document: boolean }>();
    for (const e of entities) {
      const document = e.origin === 'workspace' && e.file !== '';
      const key = `${e.kind} ${document}`;
      if (!swept.has(key)) { swept.set(key, { kind: e.kind, name: e.name, document }); }
    }
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    const seen: string[] = [];
    const unread: string[] = [];
    let all = true;
    let withheld = false;
    for (const row of swept.values()) {
      const stated = kinds.find((k) => k.documentKind === row.kind)?.acceptedBy ?? {};
      const want = [
        ...(stated.inspectionByName === true ? [rowItems.inspect] : []),
        ...(row.document && stated.singleEntityValidation === true ? [rowItems.validate] : []),
        ...(row.document ? [rowItems.lint] : []),
        ...(row.document && stated.publication === true ? [rowItems.push] : []),
      ];
      withheld = withheld || want.length < (row.document ? rowItemTitles.length : 1);
      const menu = await rowMenu(ctx.d, 'Catalog', row.name);
      await ctx.d.press('Escape');
      const subject = `${row.kind} "${row.name}" ${row.document ? 'with' : 'without'} a document`;
      // A right-click that never reached the row read nothing about it, so the
      // row is left unread rather than taken for one offering nothing.
      if (!menu.reached) {
        unread.push(`${subject}: ${describeRowMenu(menu)}`);
        continue;
      }
      const offered = menu.items.filter((item) => rowItemTitles.includes(item));
      const agrees = JSON.stringify(offered) === JSON.stringify(want);
      all = all && agrees;
      seen.push(`${subject}: ${describeRowMenu(menu)}${agrees ? ', as the answer says' : `, the answer says ${JSON.stringify(want)}`}`);
    }
    // A row read offering other than the answer says is a failure whatever else
    // could not be read; with none, a row left unread leaves the check not run.
    if (all) {
      need(unread.length === 0, `${unread.length} row(s) could not be read: ${unread.join('; ')}; the rows read: ${seen.join('; ') || 'none'}`);
    }
    return { passed: all && withheld, seen: `${[...seen, ...unread.map((u) => `unread: ${u}`)].join('; ')}${withheld ? '' : '; the answer withholds nothing from any row swept, so nothing above was refused'}` };
  });
  await ctx.d.press('Escape');
  await catalogPanelAtItsHead(ctx, CATALOG_HEAD[0]).catch(() => false);

  // ---- the operations heading each list panel, and the Commands panel without them ----
  // headAndFold reads a list panel's rows once it has settled, leaves a capture
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
      + `unfolded, ${unfolded ? 'the head was drawn again' : `the head was not drawn again within ${guard(10000) / 1000} s`}; capture ${captured}`;
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
    const text = await ctx.out.waitFor('the index build opening in the channel', mark, (t) => t.split('\n').includes(INDEX_BUILD_OPENING), stated(10000)).catch(() => ctx.out.since(mark));
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
    const focused = await until('Validate holding the focus', 3000, () => panel.evaluate<boolean>(`(() => { const b = document.querySelector('button.op[data-command="aggrega.op.validate"]'); if (!b) { return false; } b.focus(); return document.activeElement === b; })()`), (v) => v).then(() => true, () => false);
    need(focused, 'Validate could not be given the focus, so the walk has nowhere to start');
    const stop = `(() => { const e = document.activeElement; if (!e) { return 'nothing'; } return e.dataset.command || (e.dataset.dials ? 'caret:' + e.dataset.dials : e.tagName); })()`;
    const walk = [await panel.evaluate<string>(stop)];
    // One press more than the walk has stops, so the last reading shows it stays
    // on the last stop rather than leaving the panel. Each stop is read once the
    // key's own event has reached the panel's document.
    for (let i = 0; i < COMMANDS_PANEL_WALK.length; i++) {
      await pressKeyIn(ctx.d, panel, 'ArrowRight');
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

  // ---- a refusal raised while rendering, filed on the Recipe it names ----
  await renderRefusalCheck(ctx, referenceFolder);

  // ---- settings that are wrong ----
  const said: string[] = [];
  const original = fs.readFileSync(config, 'utf8');
  const missingCatalog = path.join(ctx.folder, 'no-such-catalog');
  // The documents a failing dependency resolution is reported on: the Release, the
  // Aggregate and the Manifest it names, and the workspace configuration, which the
  // language server reads as an Aggrega document by its name. Every other document
  // carrying an entry in this state is an entity file, which the language server
  // checks one at a time against the catalog directories.
  const resolutionDocuments = [RELEASE, 'aggregate.yaml', 'manifest-compose.yaml', '.aggrega-config.yaml'];
  const resolutionPaths = resolutionDocuments.map((name) => path.join(ctx.folder, name));
  await c.run('settings-that-are-wrong.missing-catalog-and-unreachable-registry-are-named', {
    expected: `with "- ./no-such-catalog" under catalog_dirs and a top-level registries list holding "${UNREACHABLE_HOST}" saved, the restart the warning offers (or, where none is offered, the restart command) brings up a new language server that runs; Graph then opens a panel that draws no card and names the refusal "${graphCouldNotBeDrawn(RELEASE, '<message>')}", and the channel says the same line — <message> being the language server's own answer to the same graph request over a reference copy configured the same way, whose message names ${missingCatalog}; no line the channel or the panel draws carries "irGraph failed" or a "code=<n>"; the Registries panel names ${UNREACHABLE_HOST}; and, with the Feature opened, its Problems entry reads exactly the language server's own answer to the same document over that reference copy, and it and every other entity file's entry — every entry on a document other than ${resolutionDocuments.join(', ')} — names ${missingCatalog}, says it does not exist and names \`workspace.catalog_dirs\``,
    plant: 'in the scratch copy, out/src/graph-failure.js made to tell the panel a sentence of its own in place of the refusal; or out/src/extension.js made to restart nothing when the warning\'s restart is pressed; or out/src/error-text.js made to put the transport\'s code ahead of a refusal\'s words; or out/src/graph-failure.js made to name the request on the channel; or out/src/diagnostics-shape.js made to cut a finding at its first clause',
  }, async () => {
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    const catalogLine = await lineOf(ctx, config, '- ./catalog');
    await ctx.probe.request('document.edit', { path: config, start: { line: catalogLine.index + 1, character: 0 }, text: `    - ./no-such-catalog\nregistries:\n  - host: ${UNREACHABLE_HOST}\n` });
    await save(ctx, config);
    // A changed configuration is read by the server when it starts; the
    // extension offers the restart, which is pressed where offered. A restart
    // that brings up no new server ends the check there and says how it was
    // asked for: everything read after it would be the old configuration's.
    const before = await theServer(ctx);
    const offer = await waitToast(ctx.d, 'the change being noticed', toastMark, (x) => x.buttons.includes(RESTART_SERVER_ACTION), 15000).catch(() => null);
    let restartedBy: string;
    if (offer === null) {
      restartedBy = 'no warning offered the restart within 15 s, so the restart command was run';
      await send(ctx, RESTART_COMMAND);
    } else if (await pressToastButton(ctx.d, offer.message.slice(0, 40), RESTART_SERVER_ACTION)) {
      restartedBy = `"${RESTART_SERVER_ACTION}" pressed on the warning`;
    } else {
      restartedBy = `the warning drew no "${RESTART_SERVER_ACTION}" button to press`;
    }
    const after = await theServer(ctx, 30000, before.pid).catch((err: unknown) => {
      throw new Error(`${restartedBy}, and no language server other than ${before.pid} came up: ${err instanceof Error ? err.message : String(err)}`);
    });
    await waitStatus(ctx.d, RUNNING, 60000);
    // The graph request refuses a catalog directory the configuration lists and
    // the folder does not hold, as `aggrega inspect` refuses it, so nothing is
    // drawn: what names the directory is that refusal, which the panel shows in
    // place of a drawing. Its words are the language server's own for the same
    // request over the reference copy, given the same configuration while asked.
    // The Feature's entry is held against the language server's own answer for the
    // same document over that reference copy, asked in the same window.
    const refConfig = path.join(referenceFolder, '.aggrega-config.yaml');
    need(fs.readFileSync(refConfig, 'utf8') === original, 'the reference copy\'s configuration is not the folder\'s as it was found');
    fs.writeFileSync(refConfig, fs.readFileSync(config, 'utf8'));
    const [ref, featureRef] = await (async () => {
      try {
        return [
          await referenceAnswer({ binary: bin, root: referenceFolder, method: 'aggrega/irGraph', params: { release: RELEASE }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog }),
          await referenceAnswer({ binary: bin, root: referenceFolder, method: 'aggrega/validate', params: buildValidateParams(referenceFeature, fs.readFileSync(feature, 'utf8'), RELEASE), home: ctx.home, table: ctx.s.table, log: ctx.cliLog }),
        ] as const;
      } finally {
        fs.writeFileSync(refConfig, original);
      }
    })();
    need(!ref.ok, 'the language server drew the reference copy configured with a catalog directory it does not hold');
    need(featureRef.ok, `the language server gave no reference answer for the Feature: ${featureRef.ok ? '' : featureRef.error.message}`);
    const featureWords = ((featureRef.result as { diagnostics?: { message: string }[] | null }).diagnostics ?? []).map((d) => d.message.split(referenceFolder).join(ctx.folder));
    const words = ref.error.message.split(referenceFolder).join(ctx.folder);
    const channelLine = graphCouldNotBeDrawn(RELEASE, words);
    const refusal = channelLine;
    const directoryNamed = words.includes(missingCatalog);
    need(await findGraphPanel(ctx) === null, 'a graph panel is open before Graph is pressed, so the panel read would not be the one the press opens');
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.graph.show');
    const panel = await until('the graph panel opening', 30000, () => findGraphPanel(ctx), (x) => x !== null) as WebviewDocument;
    await watchNotice(panel);
    // The press ends in a notice other than the sentence the panel opens with and
    // the one it shows while laying out, or in a drawing; either ends the wait,
    // and the words are judged after it, so a panel ending in words other than the
    // expected ones is read at once rather than waited out.
    const ended = (x: NoticeReading): boolean => x.nodes > 0
      || (x.text !== '' && x.text !== GRAPH_PANEL_OPENING && !x.text.startsWith('Laying out '));
    await until('the graph panel ending the press', 60000, () => noticeReadings(panel), (v) => v.some(ended)).catch(() => undefined);
    const panelNamed = (await noticeReadings(panel)).some((x) => x.text === refusal);
    const drewNothing = (v: NoticeReading[]): boolean => v.every((x) => x.nodes === 0 && !x.outOfDate);
    const quiet = panelNamed ? await holds(3000, () => noticeReadings(panel), drewNothing) : null;
    const notices = await noticeReadings(panel);
    await run(ctx, 'workbench.view.extension.aggrega');
    await pressViewAction(ctx, 'Registries', 'Refresh registries').catch(() => undefined);
    const views = async (title: string): Promise<string[]> => ((await treeRows(ctx.d, title)) ?? []).map((r) => `${title} view: ${r.label}${r.description ? ` ${r.description}` : ''}${r.aria && r.aria !== r.label ? ` (${r.aria.replace(/\s+/g, ' ')})` : ''}`);
    const registries = await until(`the Registries panel naming ${UNREACHABLE_HOST}`, 10000, () => views('Registries'), (l) => l.some((x) => x.includes(UNREACHABLE_HOST))).catch(() => views('Registries'));
    const hostNamed = registries.some((x) => x.includes(UNREACHABLE_HOST));
    // The Feature, opened now, is checked by the server that reads this
    // configuration; its entries are read once they carry the server's words, or as
    // they stand when the wait runs out.
    await open(ctx, feature);
    await until('the Feature carrying the language server\'s own entry', 20000, () => diagnostics(ctx, feature), (v) => v.some((d) => featureWords.includes(d.message))).catch(() => undefined);
    const featureEntries = (await diagnostics(ctx, feature)).map((d) => d.message);
    const listed = await ctx.probe.request<{ path: string; diagnostics: { message: string }[] }[]>('diagnostics.list');
    const lines = [
      ...(await toastsSince(ctx.d, toastMark)).map((t) => `notification: ${t.message}`),
      ...ctx.out.since(mark).split('\n').filter((l) => l.trim() !== '').map((l) => `channel: ${l}`),
      ...listed.flatMap((e) => e.diagnostics.map((d) => `problem in ${path.basename(e.path)}: ${d.message}`)),
      ...notices.filter((x) => x.text !== '').map((x) => `graph panel: ${x.text}`),
      ...registries,
    ];
    said.push(...lines);
    const running = (await statusLog(ctx.d)).slice(-1)[0]?.reading === RUNNING;
    const nothingDrawn = drewNothing(notices) && quiet !== null && quiet.held;
    const shown = notices.filter((x) => x.text !== '').map((x) => x.text);
    const channelNamed = lines.includes(`channel: ${channelLine}`);
    // The labels a reader cannot act on, read on every line the channel and the
    // panel drew; the language server's own words are read here too, so a code
    // the server put in its message would show up rather than pass.
    const coded = lines.filter((l) => (l.startsWith('channel: ') || l.startsWith('graph panel: ')) && /irGraph failed|\bcode=-?\d+/.test(l));
    // The Feature's entries are the server's, carried whole: the same set of
    // messages its own answer gives. Each entity file's entry then says what is
    // wrong — the directory, that it does not exist, and the setting listing it —
    // read on every entry drawn on a document other than the ones a failing
    // dependency resolution is reported on, the Feature's among them, so the
    // reading is never over nothing.
    const featureCarried = featureWords.length > 0 && featureEntries.length > 0
      && featureEntries.every((m) => featureWords.includes(m)) && featureWords.every((w) => featureEntries.includes(w));
    const entityEntries = listed.filter((e) => !resolutionPaths.includes(e.path))
      .flatMap((e) => e.diagnostics.map((d) => ({ file: path.basename(e.path), message: d.message })));
    const saysWhatIsWrong = (m: string): boolean => m.includes(missingCatalog) && m.includes('does not exist') && m.includes('`workspace.catalog_dirs`');
    const unsaid = entityEntries.filter((e) => !saysWhatIsWrong(e.message));
    const entitiesSay = featureEntries.length > 0 && entityEntries.length > 0 && unsaid.length === 0;
    return {
      passed: running && panelNamed && nothingDrawn && directoryNamed && hostNamed && channelNamed && coded.length === 0 && featureCarried && entitiesSay,
      seen: `${restartedBy}: language server ${before.pid} replaced by ${after.pid}, the status bar ${running ? 'running' : 'not running'}; the graph panel ${panelNamed ? 'said the topology could not be drawn, in the server\'s words' : `read ${JSON.stringify(shown)}, not "${refusal}"`}, ${nothingDrawn ? 'drawing no card up to 3 s after' : `its readings ${JSON.stringify(notices.map((x) => `${x.nodes} cards${x.outOfDate ? ' [dimmed]' : ''}`))}`}; the channel ${channelNamed ? 'says the topology could not be drawn, in the server\'s words' : `does not carry "${channelLine}"`}; ${coded.length === 0 ? 'no line carries a code-facing label' : `code-facing labels on ${JSON.stringify(coded)}`}; the language server's own answer "${words}" ${directoryNamed ? 'names' : 'does not name'} ${missingCatalog}; ${UNREACHABLE_HOST} ${hostNamed ? 'named' : 'not named'} in the Registries panel; the Feature's entries ${JSON.stringify(featureEntries)} ${featureCarried ? 'are' : 'are not'} the language server's own answer for it, ${JSON.stringify(featureWords)}; ${entityEntries.length} entity-file entr${entityEntries.length === 1 ? 'y' : 'ies'} on ${JSON.stringify([...new Set(entityEntries.map((e) => e.file))])}, ${unsaid.length === 0 ? 'each naming the directory, saying it does not exist and naming `workspace.catalog_dirs`' : `of which these do not say all three: ${JSON.stringify(unsaid)}`}`,
      evidence: { said: lines, refusal, channelLine, notices, featureEntries, featureWords, entityEntries },
    };
  });

  // A failing dependency resolution is reported on the Release's own document and
  // on no YAML file that is not an Aggrega document. Its state is one edit more:
  // the Manifest's Feature mapping rewritten on disk to name an entity no catalog
  // holds, which fails the selected Release's dependencies. The Manifest is put
  // back, and the workflow file removed, whatever the check does, so the
  // configuration's restore below and every check after it read the folder as it
  // was.
  const manifest = path.join(ctx.folder, 'manifest-compose.yaml');
  const workflow = path.join(ctx.folder, '.github', 'workflows', 'ci.yml');
  const workflowDir = path.join(ctx.folder, '.github');
  const featureMapping = 'core/secret-value:1.0.0: dotenv-secret:1.0.0';
  const unheldMapping = 'core/secret-value:1.0.0: no-such-recipe:1.0.0';
  const cleanEnding = `Aggrega: validated ${path.basename(workflow)}: no problems found.`;
  await c.run('settings-that-are-wrong.failing-dependencies-are-not-filed-on-a-ci-workflow', {
    expected: `with the Manifest's Feature mapping "${featureMapping}" rewritten on disk to "${unheldMapping}", an entity no catalog holds, Validate pressed with the Release in front files on it every finding of the language server's own answer for the same document over the reference copy configured and mapped the same way, among them one opening "Dependencies:"; and Validate pressed with a continuous-integration workflow in front — ${path.relative(ctx.folder, workflow)}, a YAML file that is not an Aggrega document — ends in "${cleanEnding}" and leaves no Aggrega entry on it, watched for 3 s after`,
    plant: 'in the scratch copy, out/src/extension.js made to send, for the document Validate is pressed in front of, the selected Release\'s path as the file',
  }, async () => {
    need((await statusLog(ctx.d)).slice(-1)[0]?.reading === RUNNING, 'the language server is not running, so no document can be validated');
    const found = fs.readFileSync(manifest, 'utf8');
    need(found.split(featureMapping).length === 2, `the Manifest does not map "${featureMapping}" once`);
    need(!fs.existsSync(workflowDir), `${workflowDir} exists before the check writes it`);
    const refConfig = path.join(referenceFolder, '.aggrega-config.yaml');
    const refManifest = path.join(referenceFolder, path.basename(manifest));
    need(fs.readFileSync(refConfig, 'utf8') === original && fs.readFileSync(refManifest, 'utf8') === found, 'the reference copy\'s configuration or Manifest is not the folder\'s as it was found');
    // validated presses Validate with `file` in front and reads what it ended in:
    // the sentence counting the answer's findings, and the Aggrega entries the
    // file then carries, which are filed before that sentence is raised.
    const validated = async (file: string): Promise<{ ending: string; entries: string[] }> => {
      await open(ctx, file);
      await toastWindowPassed(ctx.d);
      const mark = (await toasts(ctx.d)).length;
      await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.validate');
      const name = path.basename(file);
      const ending = (await waitToast(ctx.d, `the validation of ${name} ending in a sentence`, mark, (t) => t.message.startsWith(`Aggrega: validated ${name}`), 30000)).message;
      return { ending, entries: (await diagnostics(ctx, file)).filter((d) => d.source === 'aggrega').map((d) => d.message) };
    };
    try {
      fs.writeFileSync(manifest, found.replace(featureMapping, unheldMapping));
      fs.mkdirSync(path.dirname(workflow), { recursive: true });
      fs.writeFileSync(workflow, CI_WORKFLOW);
      // The Release's words are the language server's own for the same document over
      // the reference copy, configured and mapped as the folder is while asked.
      fs.writeFileSync(refConfig, fs.readFileSync(config, 'utf8'));
      fs.writeFileSync(refManifest, fs.readFileSync(manifest, 'utf8'));
      const releaseRef = await (async () => {
        try {
          return await referenceAnswer({ binary: bin, root: referenceFolder, method: 'aggrega/validate', params: buildValidateParams(referenceRelease, fs.readFileSync(path.join(ctx.folder, RELEASE), 'utf8'), RELEASE), home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
        } finally {
          fs.writeFileSync(refConfig, original);
          fs.writeFileSync(refManifest, found);
        }
      })();
      need(releaseRef.ok, `the language server gave no reference answer for the Release: ${releaseRef.ok ? '' : releaseRef.error.message}`);
      const releaseWords = ((releaseRef.result as { diagnostics?: { message: string }[] | null }).diagnostics ?? []).map((d) => d.message.split(referenceFolder).join(ctx.folder));
      need(releaseWords.some((m) => m.startsWith('Dependencies: ')), `the language server's own answer for the Release over the reference copy carries no "Dependencies:" finding, so the Release's dependencies do not fail in this state: ${JSON.stringify(releaseWords)}`);
      // The positive control first, so the workflow is read in a state shown to fail
      // the Release's dependencies. The Manifest was rewritten from outside the
      // editor, so Validate is pressed again until the language server has read it.
      const release = await until('the Release carrying the language server\'s own answer', 20000, () => validated(path.join(ctx.folder, RELEASE)), (r) => releaseWords.every((w) => r.entries.includes(w)), 1000);
      await open(ctx, workflow);
      const active = await ctx.probe.request<{ languageId: string } | null>('editor.active');
      need(active?.languageId === 'yaml', `the editor reads ${path.basename(workflow)} as ${active?.languageId ?? 'nothing'}, not as YAML, so the extension sends it nowhere`);
      const read = await validated(workflow);
      // An absence is watched for a while after the answer that should carry it, so
      // an answer arriving later — the one sent as the file opened — is read too.
      const quiet = await holds(3000, async () => (await diagnostics(ctx, workflow)).filter((d) => d.source === 'aggrega').map((d) => d.message), (v) => v.length === 0);
      const filed = quiet.held ? read.entries : [...read.entries, ...(quiet.broke ?? [])];
      return {
        passed: read.ending === cleanEnding && read.entries.length === 0 && quiet.held,
        seen: `the Release's validation ended "${release.ending}", its Aggrega entries ${JSON.stringify(release.entries)} carrying the language server's own answer ${JSON.stringify(releaseWords)}; with ${path.basename(workflow)} in front Validate ended "${read.ending}", ${filed.length === 0 ? `and it carried no Aggrega entry, watched for 3 s after (${quiet.readings} readings)` : `and it carried ${JSON.stringify([...new Set(filed)])}`}`,
        evidence: { releaseWords, release, workflow: read, quiet },
      };
    } finally {
      fs.writeFileSync(manifest, found);
      fs.rmSync(workflowDir, { recursive: true, force: true });
    }
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
  const failedStart = `${START_FAILED_OPENING}${notFoundAt(missing)}`;
  await c.run('settings-that-are-wrong.missing-compiler-is-named', {
    expected: `aggrega.server.binaryPath pointed at a file that does not exist (${missing}) is said: the status bar reads "${NOT_RUNNING}"; an error notification reads "${failedStart}" with a "${OPEN_BINARY_PATH_SETTING}" button, which, pressed, opens the settings screen searching "${BINARY_PATH_SEARCH}" and drawing that one setting; and no notification or channel line the change produced carries ENOENT, EACCES, the word spawn, "subprocess error" or "falling back to UTF-16"`,
    plant: 'in the scratch copy, out/src/daemon.js made to hand a failure to start the binary on as a sentence of its own, without the fields the runtime attached to it; or out/src/settings.js made to open the settings narrowed to the extension rather than to the one setting',
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
    const told = await waitToast(ctx.d, 'the failed start being told', toastMark, (t) => t.severity === 'error' && t.message.startsWith(START_FAILED_OPENING), 30000).catch(() => null as Toast | null);
    const read = async (): Promise<string[]> => [
      ...(await toastsSince(ctx.d, toastMark)).map((t) => `notification (${t.severity}): ${t.message}`),
      ...ctx.out.since(mark).split('\n').filter((l) => l.trim() !== '').map((l) => `channel: ${l}`),
    ];
    const lines = await until('the extension naming the missing compiler', 10000, read, (l) => l.some((x) => x.includes(missing))).catch(() => read());
    said.push(...lines);
    errorToasts = (await toastsSince(ctx.d, toastMark)).filter((t) => t.severity === 'error').length;
    // The runtime's terms are read with the scenario's own paths taken out: a
    // scratch directory is named after the run, and a run's name can hold one of
    // those words without anything the extension said holding it.
    const runtimeWords = lines.filter((l) => RUNTIME_WORDS.test(l.split(ctx.s.root.dir).join('')));
    // The button is pressed with the settings file put away, so the settings
    // screen the press opens is the only editor drawn when it is read.
    await closeAllEditors(ctx);
    const pressed = told !== null && await pressToastButton(ctx.d, told.message.slice(0, 40), OPEN_BINARY_PATH_SETTING);
    const screen = pressed ? await settingsScreen(ctx) : null;
    await closeAllEditors(ctx);
    const opened = screen !== null && screen.search === BINARY_PATH_SEARCH && JSON.stringify(screen.keys) === JSON.stringify([BINARY_PATH]);
    // Put the binary back.
    await open(ctx, userSettings);
    const back = await lineOf(ctx, userSettings, at.text.replace(JSON.stringify(bin), JSON.stringify(missing)));
    await ctx.probe.request('document.edit', { path: userSettings, start: { line: back.index, character: 0 }, end: { line: back.index + 1, character: 0 }, text: `${at.text}\n` });
    await save(ctx, userSettings);
    await closeAllEditors(ctx);
    return {
      passed: stopped && told !== null && told.message === failedStart && told.buttons.includes(OPEN_BINARY_PATH_SETTING) && opened && runtimeWords.length === 0,
      seen: `status ${stopped ? `read "${NOT_RUNNING}"` : 'did not read not running'}; ${told === null ? 'no error notification opened with the failed start' : `the error notification read "${told.message}" with ${JSON.stringify(told.buttons)}`}; ${!pressed ? `no "${OPEN_BINARY_PATH_SETTING}" button was pressed` : screen === null ? 'the press drew no settings screen' : `the press opened the settings screen searching "${screen.search}" and drawing ${JSON.stringify(screen.keys)}`}; ${runtimeWords.length === 0 ? 'no line carries the runtime\'s terms' : `the runtime's terms on ${JSON.stringify(runtimeWords)}`}; ${errorToasts} error notification(s)`,
      evidence: { said: lines },
    };
  });
  await c.forPerson(SAYS_ENOUGH, async () => ({ screenshot: await capture(ctx, 'settings-that-are-wrong'), drawnText: said.join('\n') }));
}

// PublishedEntry is one finding as the language server published it, on the
// document the publication names, with that document named in the folder the
// editor opened rather than in the reference copy it was asked over.
interface PublishedEntry {
  file: string;
  entry: NonNullable<Publication['diagnostics']>[number];
}

// publishedEntries reads every finding the server published while it answered,
// each named in the folder the editor opened.
function publishedEntries(answer: ReferenceAnswer, referenceFolder: string, folder: string): PublishedEntry[] {
  return (answer.published ?? []).flatMap((p) => (p.diagnostics ?? []).map((entry) => ({
    file: p.file.split(referenceFolder).join(folder),
    entry: { ...entry, message: entry.message.split(referenceFolder).join(folder) },
  })));
}

// renderRefusalCheck holds the Problems panel against a refusal raised while a
// Release renders: what the language server publishes for a build and a preview
// that refuse, on the Recipe the refusal names, is what the panel shows, and a
// build that no longer refuses takes it away.
//
// The Recipe is the cache's, written into the folder's own catalog with the
// Manifest mapping the cache to it, and the lockfile is written again after each
// change of it — a build reads the lockfile, which records the Recipe it renders
// with, and refuses a lockfile that no longer matches before it renders. In the
// folder the editor opened that is the Commands panel's Pull; in the reference
// copy, the compiler's own pull. The expectations — the document, the position,
// the words, the codes and the address — are the language server's own
// publication for the same request over the reference copy, never written here.
//
// 🔴 THE RECIPE IS NEVER OPENED. A document the editor holds is validated as it
// opens, and the server's validation of a Recipe that refuses reports a finding of
// its own about the same condition, so the panel would then hold two entries, one
// from each source, and an entry the editor files only for a document it holds
// would pass unseen. The Recipe, the Manifest and the lockfile are put back in
// both copies whatever the check reached, so the checks after it read the folder
// as it was found.
async function renderRefusalCheck(ctx: SuiteContext, referenceFolder: string): Promise<void> {
  const bin = ctx.inputs.compiler.path;
  const copies = [ctx.folder, referenceFolder].map((root) => ({
    root,
    recipe: path.join(root, ...CACHE_RECIPE),
    recipeTree: path.join(root, CACHE_RECIPE[0], CACHE_RECIPE[1]),
    manifest: path.join(root, 'manifest-compose.yaml'),
    lock: path.join(root, RELEASE.replace(/\.ya?ml$/, '.lock')),
  }));
  const [folder, reference] = copies;
  const workloadKey = CACHE_REFUSING.split('\n').indexOf(CACHE_WORKLOAD_KEY);
  await ctx.checks.run('problems.render-refusal-lands-on-its-recipe-in-the-compilers-words', {
    expected: `with a Recipe for the cache written into the folder's own catalog — its Workload naming the slot "${UNDECLARED_SLOT}", which the cache's Component does not declare — the Manifest mapping the cache to it, and Pull pressed on the Commands panel, pressing Build there puts exactly one entry in the Problems panel, on the Recipe, which the editor does not hold open: under the source, at the position, in the words and with the short code the language server's own publication for the same build over the reference copy carries, the code leading to the address that publication names, and those words on no other entry; with the reference taken out of the Recipe and Pull pressed, Build completes and the entry leaves the panel; with the reference back and Pull pressed, Preview build puts the same one entry there, held against the server's own publication for the same preview; and with it taken out again, Build completes and the entry leaves`,
    plant: 'in the scratch copy, out/src/extension.js made to file a published finding only on a document the editor holds',
  }, async () => {
    const buildButton = (await operationButtons(await commandsPanel(ctx.d))).find((b) => b.command === 'aggrega.op.build');
    need(buildButton?.disabled === false, 'Build cannot run here, so there is nothing to press');
    need(copies.every((x) => !fs.existsSync(x.recipeTree)), `${folder.recipeTree} or its reference copy's is already there, so the Recipe this check writes would not be the only one`);
    const found = copies.map((x) => ({ manifest: fs.readFileSync(x.manifest, 'utf8'), lock: fs.readFileSync(x.lock) }));
    need(found.every((f) => f.manifest.split(CACHE_MAPPING).length === 2), `the Manifest does not map "${CACHE_MAPPING}" once`);
    try {
      // The language server's own publications, for a build and a preview of the
      // refusing Recipe over the reference copy.
      fs.mkdirSync(path.dirname(reference.recipe), { recursive: true });
      fs.writeFileSync(reference.recipe, CACHE_REFUSING);
      fs.writeFileSync(reference.manifest, found[1].manifest.replace(CACHE_MAPPING, CACHE_MAPPED));
      const pulled = await runCompiler(bin, ['--offline', 'pull', '--release', RELEASE, '--quiet'], { cwd: referenceFolder, home: ctx.home, boundMs: 120000, log: ctx.cliLog });
      need(pulled.status === 0, `the compiler's own pull of the reference copy exited ${pulled.status ?? pulled.signal}: ${(pulled.stderr || pulled.stdout).trim().slice(0, 300)}`);
      const published = async (method: string, params: unknown, what: string): Promise<{ answer: ReferenceAnswer; entry: PublishedEntry }> => {
        const answer = await referenceAnswer({ binary: bin, root: referenceFolder, method, params, published: true, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
        need(!answer.ok, `the language server answered ${what} of the reference copy without refusing it`);
        const entries = publishedEntries(answer, referenceFolder, ctx.folder);
        need(entries.length === 1 && entries[0].file === folder.recipe, `the language server's own ${what} of the reference copy published ${JSON.stringify(entries).slice(0, 600)}, not one finding on the Recipe`);
        return { answer, entry: entries[0] };
      };
      const buildRef = await published('aggrega/build', buildParams(RELEASE, [], null), 'a build');
      const previewRef = await published('aggrega/buildPreview', buildPreviewParams(RELEASE), 'a preview');

      // The same state in the folder the editor opened, made from outside it.
      fs.mkdirSync(path.dirname(folder.recipe), { recursive: true });
      fs.writeFileSync(folder.manifest, found[0].manifest.replace(CACHE_MAPPING, CACHE_MAPPED));
      // recipeAs writes the Recipe's text and presses Pull, which the build reads.
      const recipeAs = async (text: string, what: string): Promise<void> => {
        fs.writeFileSync(folder.recipe, text);
        await closeAllEditors(ctx);
        const mark = ctx.out.mark();
        await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.pull');
        const ended = await ctx.out.waitFor(`the pull ending with the Recipe ${what}`, mark, (t) => /^The pull (resolved|did not complete)/m.test(t), 120000);
        const line = ended.split('\n').find((l) => l.startsWith('The pull')) ?? '';
        need(line.startsWith('The pull resolved'), `the pull with the Recipe ${what} did not resolve the Release's dependencies: "${line.slice(0, 300)}"`);
        await toastWindowPassed(ctx.d);
      };
      // pressed presses one operation and answers with the line it ended in on the
      // channel and the notification it raised, if any.
      const pressed = async (command: string, what: string): Promise<{ ending: string; told: Toast | null }> => {
        const mark = ctx.out.mark();
        const toastMark = (await toasts(ctx.d)).length;
        await pressOperation(ctx.d, await commandsPanel(ctx.d), command);
        const text = await ctx.out.waitFor(`${what} ending`, mark, (t) => t.split('\n').some((l) => BUILD_ENDING.test(l)), 180000);
        const ending = text.split('\n').find((l) => BUILD_ENDING.test(l)) ?? '';
        const told = await waitToast(ctx.d, `${what}'s notification`, toastMark, (t) => BUILD_ENDING_NOTICE.test(t.message), 10000).catch(() => null);
        return { ending, told };
      };
      // filed reads, once the server's publication has been filed, the entries the
      // Recipe carries and every entry anywhere carrying the published words.
      const filed = async (want: PublishedEntry, what: string): Promise<string[]> => {
        const on = await until(`the refusal filed on the Recipe after ${what}`, 20000, () => diagnostics(ctx, folder.recipe), (v) => v.length > 0).catch(() => diagnostics(ctx, folder.recipe));
        const listed = await ctx.probe.request<{ path: string; diagnostics: DiagnosticEntry[] }[]>('diagnostics.list');
        const elsewhere = listed.filter((e) => e.path !== folder.recipe && e.diagnostics.some((d) => d.message === want.entry.message)).map((e) => e.path);
        const held = (await ctx.probe.request<{ path: string }[]>('documents.list')).some((d) => d.path === folder.recipe);
        need(!held, `the editor holds the Recipe open, so what was filed on it is not about a document it does not hold`);
        const e = want.entry;
        const range = { start: { line: e.line - 1, character: e.column - 1 }, end: { line: (e.end_line ?? e.line) - 1, character: (e.end_column ?? e.column) - 1 } };
        const faults: string[] = [];
        if (on.length !== 1) { faults.push(`the Recipe carries ${on.length} entries: ${describeDiagnostics(folder.recipe, on)}`); }
        const d = on[0];
        if (d !== undefined) {
          if (d.source !== e.source) { faults.push(`its source is ${d.source}, the server's ${e.source}`); }
          if (d.severity !== 'Error') { faults.push(`its severity is ${d.severity}, the server's ${e.severity}`); }
          if (JSON.stringify(d.range) !== JSON.stringify(range)) { faults.push(`it spans ${JSON.stringify(d.range)}, the server's ${e.line}:${e.column}-${e.end_line}:${e.end_column} being ${JSON.stringify(range)}`); }
          if (d.message !== e.message) { faults.push(`its words differ from the server's: ${JSON.stringify(d.message.slice(0, 200))}`); }
          if (d.code !== (e.shortCode ?? null)) { faults.push(`its code is ${d.code}, the server's short code ${e.shortCode}`); }
          if (d.codeTarget !== (e.codeDescription?.href ?? null)) { faults.push(`its code leads to ${d.codeTarget}, the server's address being ${e.codeDescription?.href}`); }
        }
        if (elsewhere.length > 0) { faults.push(`the same words are filed on ${JSON.stringify(elsewhere)} as well`); }
        return faults;
      };
      // cleared reads whether a build that completed took the entry away.
      const cleared = async (ending: string): Promise<boolean> => ending.startsWith('Build completed: ') &&
        await until('the entry leaving the Recipe', 20000, () => diagnostics(ctx, folder.recipe), (v) => v.length === 0).then(() => true, () => false);

      await recipeAs(CACHE_REFUSING, 'naming the undeclared slot');
      const build = await pressed('aggrega.op.build', 'the build');
      const buildFaults = await filed(buildRef.entry, 'Build');
      const buildEntry = (await diagnostics(ctx, folder.recipe))[0];
      // The entry as a person meets it, captured while it stands, with the
      // Problems panel open.
      await run(ctx, 'workbench.actions.view.problems');
      const drawn = await until('the Problems panel drawing the refusal', 10000, () => ctx.d.workbench<string>(`((document.querySelector('.markers-panel') || {}).innerText || '')`), (t) => t.includes(UNDECLARED_SLOT)).catch(() => '');
      const shot = await capture(ctx, 'render-refusal-on-its-recipe');
      await recipeAs(CACHE_CORRECTED, 'corrected');
      const rebuilt = await pressed('aggrega.op.build', 'the build of the corrected Recipe');
      const buildCleared = await cleared(rebuilt.ending);

      await recipeAs(CACHE_REFUSING, 'naming the undeclared slot again');
      const preview = await pressed('aggrega.op.preview', 'the preview');
      const previewFaults = await filed(previewRef.entry, 'Preview build');
      await recipeAs(CACHE_CORRECTED, 'corrected again');
      const again = await pressed('aggrega.op.build', 'the build of the Recipe corrected again');
      const previewCleared = await cleared(again.ending);

      const e = buildRef.entry.entry;
      const atKey = e.line - 1 === workloadKey && e.keyPath === '.spec.workload';
      return {
        passed: buildFaults.length === 0 && buildCleared && previewFaults.length === 0 && previewCleared,
        seen: `the server published, for a build and for a preview of the reference copy, ${path.relative(ctx.folder, buildRef.entry.file)}:${e.line}:${e.column} [${e.source} ${e.shortCode} → ${e.codeDescription?.href}] (${atKey ? `the Recipe's workload key, ${e.keyPath}` : `key ${e.keyPath}, the workload key being line ${workloadKey + 1}`}), the preview's entry ${JSON.stringify(previewRef.entry.entry) === JSON.stringify(buildRef.entry.entry) ? 'the same' : `differing: ${JSON.stringify(previewRef.entry.entry).slice(0, 300)}`}; `
          + `Build ended "${build.ending.slice(0, 120)}" and filed ${buildEntry ? describeDiagnostics(folder.recipe, [buildEntry]) : 'nothing'}${buildFaults.length === 0 ? ', as the server published it' : ` — ${buildFaults.join('; ')}`}; its notification ${build.told === null ? 'none' : `"${build.told.message.slice(0, 120)}" (${build.told.severity}, buttons ${JSON.stringify(build.told.buttons)})`}; `
          + `corrected, Build ended "${rebuilt.ending.slice(0, 120)}" and the entry ${buildCleared ? 'left' : 'stayed or the build did not complete'}; `
          + `Preview build ended "${preview.ending.slice(0, 120)}"${previewFaults.length === 0 ? ' and filed the same entry, as the server published it' : ` — ${previewFaults.join('; ')}`}; its notification ${preview.told === null ? 'none' : `"${preview.told.message.slice(0, 120)}" (${preview.told.severity}, buttons ${JSON.stringify(preview.told.buttons)})`}; `
          + `corrected again, Build ended "${again.ending.slice(0, 120)}" and the entry ${previewCleared ? 'left' : 'stayed or the build did not complete'}; capture ${shot}`,
        evidence: { buildReference: buildRef, previewReference: previewRef, build, rebuilt, preview, again, buildEntry, drawn: drawn.slice(0, 2000) },
      };
    } finally {
      // Both copies as they were found, whatever the check reached; and where an
      // entry is left on the Recipe — a check stopped with it refusing — a build of
      // the folder as found replaces the build's findings, which takes it away.
      for (const [i, x] of copies.entries()) {
        fs.writeFileSync(x.manifest, found[i].manifest);
        fs.writeFileSync(x.lock, found[i].lock);
        fs.rmSync(x.recipeTree, { recursive: true, force: true });
      }
      await closeAllEditors(ctx).catch(() => undefined);
      if ((await diagnostics(ctx, folder.recipe).catch(() => [])).length > 0) {
        const mark = ctx.out.mark();
        await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.build').catch(() => undefined);
        await ctx.out.waitFor('the build of the folder as found ending', mark, (t) => t.split('\n').some((l) => BUILD_ENDING.test(l)), 180000).catch(() => '');
      }
    }
  });
}
