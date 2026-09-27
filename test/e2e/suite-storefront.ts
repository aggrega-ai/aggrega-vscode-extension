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
import {
  capture, closeAllEditors, deleteLine, describeDiagnostics, diagnostics, lineOf, open, putBack, ready, run, save, send, SuiteContext, theServer,
} from './suite-context';
import { contextRowsCheck } from './suite-gateway';
import {
  commandsPanel, documentWith, NOT_RUNNING, pickQuickInputRow, pressIn, pressOperation, pressToastButton, RUNNING,
  sleep, statusLog, STARTING, toasts, toastsSince, treeRowCentre, treeRows, until, waitQuickInput, waitStatus, waitToast,
} from './workbench';

// The checks run in the storefront folder: the capabilities walked end to end —
// the language server recovering from a kill, diagnostics on a real mistake and
// across a cascade, completion and hover, the published-catalog search with no
// registry, the workspace catalog panel, the operations that end in words, and
// what the extension says about settings that are wrong.

export const STOREFRONT_CHECKS = [
  'commands-panel.context-rows-name-the-opened-folder',
  'language-server.restarts-after-a-kill',
  'problems.authoring-mistake-lands-on-its-line-in-the-compilers-words',
  'problems.authoring-mistake-reads-as-actionable',
  'problems.cascade-names-the-entity-that-broke',
  'language-features.completion-offers-the-workspace-and-catalog-entities',
  'language-features.hover-names-the-resolved-entity',
  'catalog-search.palette-shows-its-facets',
  'catalog-search.no-registry-answer-says-so',
  'catalog-search.no-registry-sentence-directs-the-reader',
  'catalog-view.lists-the-workspace-entities-by-kind',
  'catalog-view.new-entity-appears-after-refresh',
  'catalog-view.deleted-entity-row-leaves-at-once',
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
// palette's title, placeholder, facet rows in order and last row.
const NO_REGISTRY_OPENING = 'Aggrega: No registries configured.';
const SEARCH_FACETS = ['Query', 'Kind', 'Label selector', 'Capability', 'Plugin type', 'Limit'];
const SEARCH_ROW = 'Search';
const SEARCH_TITLE = 'Aggrega: search published catalog';
const SEARCH_PLACEHOLDER = 'Narrow the search, then choose Search';

// The stopped-responding notification, held as written for the same reason.
export const STOPPED_RESPONDING = 'Aggrega language server has stopped responding. Run "Aggrega: Restart language server" to recover.';

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

  // ---- completion and hover ----
  const features = [...entityNames(path.join(ctx.folder, 'catalog'), 'Feature'), ...entityNames(ctx.inputs.catalog.dir, 'Feature')];
  const localFeatures = entityNames(path.join(ctx.folder, 'catalog'), 'Feature');
  const typeLine = await lineOf(ctx, aggregate, 'type: core/secret-value');
  const postgresLine = await lineOf(ctx, aggregate, 'type: core/datastore/postgres');
  // askAnswering runs one of the editor's language requests. The extension's
  // provider may stop to ask the reader whether to revalidate a file it holds no
  // state for, and the request finishes only once that is answered, so the
  // question is answered as a reader answers it who wants the request to go on —
  // Revalidate — and what the channel said about it is recorded.
  const askAnswering = async <T>(command: string, args: unknown[]): Promise<{ result: T | null; note: string }> => {
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    let settled = false;
    const pending = run<T>(ctx, command, args, 25000).then((r) => { settled = true; return r; }, () => { settled = true; return null; });
    const first = await Promise.race([
      pending.then(() => 'answered'),
      waitToast(ctx.d, 'a question about the cache', toastMark, (t) => t.message.includes('no cached state'), 15000).then(() => 'asked', () => 'none'),
    ]);
    let asked = '';
    if (first === 'asked') {
      asked = (await toastsSince(ctx.d, toastMark)).find((t) => t.message.includes('no cached state'))?.message ?? '';
      await pressToastButton(ctx.d, asked.slice(0, 30), 'Revalidate');
    }
    const result = await pending;
    const answeredInTime = settled && result !== null;
    await sleep(1000);
    const questions = (await toastsSince(ctx.d, toastMark)).filter((t) => t.message.includes('no cached state')).length;
    const channel = ctx.out.since(mark).split('\n').filter((l) => l.trim() !== '').slice(0, 3);
    return { result, note: `asked ${asked === '' ? 'nothing' : `"${asked}" (${questions} time(s)) and was answered Revalidate`}; the request ${answeredInTime ? 'answered' : 'gave no answer within 25000 ms'}; channel: ${JSON.stringify(channel)}` };
  };
  await c.run('language-features.completion-offers-the-workspace-and-catalog-entities', {
    expected: `completion just after "type: " on the password attachment (line ${typeLine.index + 1}) offers Feature references drawn from the folder's own catalog (${localFeatures.join(', ')}) and from the standard library, and nothing that is not one`,
    plant: 'in the scratch copy, out/src/extension.js made to return a fixed list of items',
  }, async () => {
    await open(ctx, aggregate);
    const character = typeLine.text.indexOf('type: ') + 'type: '.length;
    const { result: list, note } = await askAnswering<{ items?: { label: string | { label: string } }[] } | null>('vscode.executeCompletionItemProvider', [{ $file: aggregate }, { $position: { line: typeLine.index, character } }]);
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
    const { result: hovers, note } = await askAnswering<{ contents?: ({ value?: string } | string)[] }[] | null>('vscode.executeHoverProvider', [{ $file: aggregate }, { $position: { line: postgresLine.index, character } }]);
    const text = (hovers ?? []).flatMap((h) => (h.contents ?? []).map((x) => (typeof x === 'string' ? x : x.value ?? ''))).join('\n');
    return { passed: text.includes('core/datastore/postgres') && postgresVersions.some((v) => text.includes(v)), seen: `hover: ${JSON.stringify(text.slice(0, 300))}; ${note}` };
  });

  // ---- the published-catalog palette, with no registry ----
  let noRegistry = '';
  await c.run('catalog-search.palette-shows-its-facets', {
    expected: `Search catalog on the Commands panel opens a list titled "${SEARCH_TITLE}", placeholder "${SEARCH_PLACEHOLDER}", with one row per facet (${SEARCH_FACETS.join(', ')}) each showing its current value, and a last row "${SEARCH_ROW}"`,
    plant: 'in the scratch copy, out/src/catalog-search-run.js with the Plugin type row dropped',
  }, async () => {
    await closeAllEditors(ctx);
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.catalog.searchPublished');
    const q = await waitQuickInput(ctx.d, 'the search palette', (x) => x.title === SEARCH_TITLE);
    const labels = q.rows.map((r) => r.label);
    const valued = q.rows.slice(0, SEARCH_FACETS.length).every((r) => r.description !== '');
    const passed = q.placeholder === SEARCH_PLACEHOLDER && JSON.stringify(labels) === JSON.stringify([...SEARCH_FACETS, SEARCH_ROW]) && valued;
    return { passed, seen: `title "${q.title}", placeholder "${q.placeholder}", rows ${JSON.stringify(q.rows.map((r) => `${r.label}: ${r.description}`))}` };
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
    question: 'The sentence sends the reader to the Registries panel for "Add registry", which is a Commands-panel button. Does that misdirect?',
  }, async () => {
    need(noRegistry !== '', 'the search gave no answer, so there is no sentence to judge');
    return { screenshot: await capture(ctx, 'search-no-registry'), drawnText: noRegistry };
  });

  // ---- the workspace catalog panel ----
  const aggregates = entityNames(ctx.folder, 'Aggregate');
  await c.run('catalog-view.lists-the-workspace-entities-by-kind', {
    expected: `the Catalog view lists the open workspace's entities under kind headings carrying a count, among them "Aggregate (${aggregates.length})" holding ${aggregates.join(', ')}, and clicking the storefront row opens its file`,
    plant: 'in the scratch copy, out/src/workspace-catalog-view.js made to drop the count from the headings',
  }, async () => {
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    const rows = await until('the Catalog view drawing its rows', 20000, () => treeRows(ctx.d, 'Catalog'), (v) => v !== null && v.some((r) => /^Aggregate \(\d+\)$/.test(r.label)));
    const headings = (rows ?? []).filter((r) => r.level === 1).map((r) => r.label);
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
    plant: 'in the scratch copy, out/src/workspace-catalog-view.js made to ignore a deleted file',
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
