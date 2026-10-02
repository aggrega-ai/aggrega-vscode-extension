// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { RESTART_COMMAND } from '../../src/daemon-status';
import { FAILURE_LABEL as REGISTRIES_FAILURE_LABEL } from '../../src/registries-run';
import { SERVER_STOPPED_LABEL } from '../../src/workspace-catalog-run';
import { NO_ANCHORED_WORKSPACE_TREE_LABEL } from '../../src/workspace';
import { need } from './checks';
import { findGraphPanel, graphState, showGraph } from './graph-panel';
import { readCmdline } from './processes';
import { closeAllEditors, open, ready, reopen, run, send, SuiteContext, theServer } from './suite-context';
import { contextRowsCheck } from './suite-gateway';
import { pressViewAction } from './suite-storefront';
import {
  Bound, commandsPanel, holds, hoverAt, LIST_PANELS, ListPanel, pickQuickInputRow, RUNNING, selectorRows, sleep, STARTING, standsStill, stated, statusItems, statusLog,
  toasts, toastsSince, treeRows, until, viewReadings, VIEWS_OBSERVER, waitQuickInput, waitStatus,
} from './workbench';

// The checks run in the gateway folder on what a reader meets as the editor
// comes up and the language server comes and goes: every panel filling on its
// own after the editor is closed and opened again, a restart refilling them and
// redrawing an open graph, each list panel's Refresh asking again, an entity
// resolved from a configured catalog directory marked as such and opening
// nothing, and the status bar's reading of the language server beside the
// Release it is asked about.

export const READINESS_CHECKS = [
  'commands-panel.context-rows-name-the-opened-folder',
  'readiness.cold-open-fills-every-panel-with-no-press',
  'catalog-view.catalog-resolved-entity-is-marked-and-opens-nothing',
  'list-panels.refresh-asks-again-and-leaves-the-content-as-it-was',
  'status-bar.lifecycle-item-reads-running-beside-the-release-and-offers-a-restart',
  'readiness.restart-refills-every-panel-and-redraws-the-open-graph',
] as const;

const RELEASE = 'release-compose.yaml';

// STALE_ROWS are the rows a panel draws while nobody has asked the compiler yet:
// the language server not running, the registry list that could not be read
// without it, and no workspace resolved. Each is the product's own sentence, so a
// reworded row is still recognised as the state it names.
const STALE_ROWS = [SERVER_STOPPED_LABEL, REGISTRIES_FAILURE_LABEL, NO_ANCHORED_WORKSPACE_TREE_LABEL];

// How long after the language server first reads running each panel may still
// draw a row of the state before it, and how long the filled panels are then
// watched for one coming back. The first is the time a panel takes to ask the
// server and draw its answer, which on this host is well under a second.
const STALE_BOUND_MS = 15000;
const SETTLED_WATCH_MS = 3000;

// The rows each panel draws once it has asked and been answered, in this folder,
// which configures no registry and resolves the standard library's entities.
const KIND_HEADING = /^[A-Z][A-Za-z]+ \(\d+\)$/;
const NO_REGISTRIES = 'No registries configured.';
const EMBEDDED_HEADING = /^Embedded \(\d+\)$/;

// filled reports whether a panel's drawn rows are its answer in this folder.
function filled(panel: ListPanel, rows: string[] | undefined): boolean {
  if (rows === undefined) { return false; }
  switch (panel) {
    case 'Catalog': return rows.some((r) => KIND_HEADING.test(r));
    case 'Registries': return rows.includes(NO_REGISTRIES);
    case 'Plugins': return rows.some((r) => EMBEDDED_HEADING.test(r));
  }
}

// staleIn names the rows of the state before an answer a reading draws.
function staleIn(panes: Partial<Record<ListPanel, string[]>>): string[] {
  return LIST_PANELS.flatMap((p) => (panes[p] ?? []).filter((r) => STALE_ROWS.includes(r)).map((r) => `${p}: ${r}`));
}

// Filling is how the panels came to their answers after one moment: when each
// first drew its answer, when each last drew a row of the state before one, and
// what the Commands panel's rows read.
interface Filling { runningAt: number; firstFilled: Record<string, number | null>; lastStale: Record<string, number | null>; staleRows: string[] }

function fillingSince(readings: { at: number; panes: Partial<Record<ListPanel, string[]>> }[], from: number, runningAt: number): Filling {
  const firstFilled: Record<string, number | null> = {};
  const lastStale: Record<string, number | null> = {};
  const staleRows = new Set<string>();
  for (const p of LIST_PANELS) { firstFilled[p] = null; lastStale[p] = null; }
  for (const r of readings.filter((x) => x.at >= from)) {
    for (const p of LIST_PANELS) {
      if (firstFilled[p] === null && filled(p, r.panes[p])) { firstFilled[p] = r.at - runningAt; }
      const stale = (r.panes[p] ?? []).filter((x) => STALE_ROWS.includes(x));
      if (stale.length > 0) { lastStale[p] = r.at - runningAt; stale.forEach((x) => staleRows.add(`${p}: ${x}`)); }
    }
  }
  return { runningAt, firstFilled, lastStale, staleRows: [...staleRows] };
}

// describeFilling says, per panel, when it drew its answer after the server first
// read running — or that it went on drawing the rows it held, where nothing it
// drew changed — and when it last drew a row of the state before an answer.
function describeFilling(f: Filling): string {
  return LIST_PANELS.map((p) => `${p} ${f.firstFilled[p] === null ? 'held the rows it drew, redrawing none' : `drew its answer ${f.firstFilled[p]} ms after running`}${f.lastStale[p] === null ? ', never drawing the state before an answer' : `, drawing the state before one last ${f.lastStale[p]} ms after running`}`).join('; ')
    + `; rows of the state before an answer drawn: ${f.staleRows.length === 0 ? 'none' : JSON.stringify(f.staleRows)}`;
}

// panelsSettle waits for every list panel to draw its answer and the Commands
// panel's rows to name the folder, then watches that no panel draws a row of
// the state before an answer for a while.
async function panelsSettle(ctx: SuiteContext, boundMs: Bound): Promise<{ reached: boolean; held: boolean; broke: string; rows: string }> {
  const base = path.basename(ctx.folder);
  const read = async (): Promise<Record<string, string[]>> => {
    const out: Record<string, string[]> = {};
    for (const p of LIST_PANELS) { out[p] = ((await treeRows(ctx.d, p)) ?? []).map((r) => r.label); }
    return out;
  };
  const allFilled = (v: Record<string, string[]>): boolean => LIST_PANELS.every((p) => filled(p, v[p]));
  const reached = await until('every list panel drawing its answer', boundMs, read, allFilled).then(() => true, () => false);
  const doc = await commandsPanel(ctx.d, boundMs);
  const want = [base, base, RELEASE];
  const rowsReached = await until('the Commands panel naming the folder and its Release', boundMs, () => selectorRows(doc), (r) => r.length >= 3 && r.slice(0, 3).every((x, i) => x.value === want[i])).then(() => true, () => false);
  const rows = (await selectorRows(doc)).slice(0, 3).map((r) => `${r.label}: ${r.value}`).join(' | ');
  const watch = await holds(SETTLED_WATCH_MS, async () => ({ panes: await read(), rows: (await selectorRows(doc)).slice(0, 3).map((r) => r.value) }),
    (v) => staleIn(v.panes as Partial<Record<ListPanel, string[]>>).length === 0 && !v.rows.includes('unavailable'));
  return { reached: reached && rowsReached, held: watch.held, broke: watch.held ? '' : JSON.stringify(watch.broke), rows };
}

// CatalogRow is one drawn row of the Catalog panel with its icon and its actions.
interface CatalogRow { label: string; description: string; level: number; icons: string[]; centre: { x: number; y: number }; inside: boolean }

function catalogRows(ctx: SuiteContext): Promise<CatalogRow[]> {
  return ctx.d.workbench<CatalogRow[]>(`(() => {
    for (const pane of document.querySelectorAll('.pane')) {
      const h = pane.querySelector('.pane-header');
      const t = h ? ((h.querySelector('h3.title, .title') || {}).innerText || '').trim() : '';
      if (t.toLowerCase() !== 'catalog') { continue; }
      const body = pane.querySelector('.pane-body');
      const b = body ? body.getBoundingClientRect() : null;
      return [...pane.querySelectorAll('.pane-body .monaco-list-row')].filter((r) => r.getBoundingClientRect().height > 0).map((r) => {
        const x = r.getBoundingClientRect();
        return {
          label: ((r.querySelector('.label-name') || {}).innerText || '').trim(),
          description: ((r.querySelector('.label-description') || {}).innerText || '').trim(),
          level: Number(r.getAttribute('aria-level') || 0),
          icons: [...r.querySelectorAll('.custom-view-tree-node-item-icon, .codicon')].map((i) => i.className),
          centre: { x: x.x + Math.min(x.width / 2, 120), y: x.y + x.height / 2 },
          inside: !!b && x.top >= b.top - 0.5 && x.bottom <= b.bottom + 0.5,
        };
      });
    }
    return [];
  })()`);
}

// CATALOG_ORIGIN is how a row resolved from a configured catalog directory says
// where it came from, held as the playbook quotes it.
const CATALOG_ORIGIN = 'from a configured catalog directory';

// What the status bar's language-server item offers and says, held as the
// playbook quotes it, so a change of wording is a change these checks report.
export const LIFECYCLE_PLACEHOLDER = 'Aggrega: the language server';
export const START_ACTION = { label: 'Start', detail: 'Start the Aggrega language server' };
export const RESTART_ACTION = { label: 'Restart', detail: 'Stop the Aggrega language server and start a fresh one' };
export const HOVER_NOT_RUNNING_ANCHORED = 'The Aggrega language server is not running, so the operations that ask it a question are unavailable. Click to start it.';
export const HOVER_NOT_RUNNING_UNANCHORED = 'No folder in this window is one Aggrega recognises as a workspace, so there is nothing for the language server to attach to. Click to look again.';

// LIFECYCLE_OBSERVER records every change of the status bar's language-server
// item — its words, its glyph and whether it is drawn in the error colour — so a
// reading that lasts a moment is caught as it is drawn.
const LIFECYCLE_OBSERVER = `(() => {
  if (window.__editorSuiteLifecycle) { return window.__editorSuiteLifecycle.length; }
  const bar = document.getElementById('workbench.parts.statusbar');
  const log = [];
  let last = null;
  const read = () => {
    const e = [...bar.querySelectorAll('.left-items .statusbar-item')].find((x) => /^Aggrega: (running|starting|not running)$/.test((x.innerText || '').trim()));
    if (!e) { return null; }
    return { text: (e.innerText || '').trim(), icons: [...e.querySelectorAll('.codicon')].map((i) => i.className).join(' '), errorKind: e.classList.contains('error-kind') };
  };
  const sample = () => { const v = read(); const k = JSON.stringify(v); if (k !== last) { last = k; log.push(Object.assign({ at: Date.now() }, v || { text: '', icons: '', errorKind: false })); } };
  sample();
  new MutationObserver(sample).observe(bar, { subtree: true, childList: true, characterData: true, attributes: true });
  window.__editorSuiteLifecycle = log;
  return log.length;
})()`;

export interface LifecycleReading { at: number; text: string; icons: string; errorKind: boolean }

export async function lifecycleReadings(ctx: SuiteContext): Promise<LifecycleReading[]> {
  await ctx.d.workbench(LIFECYCLE_OBSERVER);
  return ctx.d.workbench<LifecycleReading[]>('window.__editorSuiteLifecycle || []');
}

// viewTransform is the graph panel's pan-and-zoom transform as it stands.
async function viewTransform(ctx: SuiteContext): Promise<string> {
  const doc = await findGraphPanel(ctx);
  need(doc !== null, 'no graph panel is open');
  return doc.evaluate<string>(`((document.getElementById('canvas') || {}).querySelector ? ((document.getElementById('canvas').querySelector(':scope > g[transform]') || { getAttribute: () => '' }).getAttribute('transform') || '') : '')`);
}

export async function readinessChecks(ctx: SuiteContext): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  await ready(ctx);
  await contextRowsCheck(ctx);

  // ---- a cold open ----
  await c.run('readiness.cold-open-fills-every-panel-with-no-press', {
    expected: `with the Aggrega container revealed, the editor closed and opened again on the same folder, and nothing pressed: the container is drawn again as the editor comes up; every list panel draws its answer — the Catalog panel a kind heading, the Registries panel "${NO_REGISTRIES}", the Plugins panel its "Embedded (<n>)" heading — and the Commands panel's rows name the folder and ${RELEASE}; a row of the state before an answer (${STALE_ROWS.map((r) => `"${r}"`).join(', ')}) drawn while the server comes up has left every panel within ${STALE_BOUND_MS} ms of the status bar first reading "${RUNNING}", and none is drawn again, nor the Release row "unavailable", over ${SETTLED_WATCH_MS} ms once all have answered — every reading taken by an observer installed before the extension drew anything`,
    plant: 'in the scratch copy, out/src/workspace-catalog-view.js made not to ask again when the compiler becomes answerable, so the Catalog panel keeps the row it drew before',
  }, async () => {
    await run(ctx, 'workbench.view.extension.aggrega');
    await commandsPanel(ctx.d);
    const r = await reopen(ctx, [VIEWS_OBSERVER]);
    need(r.closed.stillAlive.length === 0, `the editor closed with ${r.closed.stillAlive.length} process(es) still alive`);
    const opened = Date.now();
    const shown = await until('the Aggrega container drawn as the editor comes up', 30000, () => viewReadings(ctx.d), (v) => v.some((x) => LIST_PANELS.every((p) => x.panes[p] !== undefined))).then(() => true, () => false);
    need(shown, 'the editor opened again without the Aggrega container revealed, so what it draws there unasked cannot be read');
    await waitStatus(ctx.d, RUNNING, 90000);
    const runningAt = (await statusLog(ctx.d)).find((x) => x.reading === RUNNING)?.at ?? Date.now();
    const settle = await panelsSettle(ctx, STALE_BOUND_MS);
    const f = fillingSince(await viewReadings(ctx.d), opened - 60000, runningAt);
    const leftInTime = LIST_PANELS.every((p) => f.lastStale[p] === null || (f.lastStale[p] as number) <= STALE_BOUND_MS);
    return {
      passed: settle.reached && settle.held && leftInTime,
      seen: `opened again in ${r.bringUpMs} ms; ${describeFilling(f)}; the Commands panel reads ${settle.rows}; ${settle.reached ? 'every panel answered' : 'not every panel answered within the bound'}; ${settle.held ? `none drew a row of the state before an answer over ${SETTLED_WATCH_MS} ms after` : `then ${settle.broke}`}`,
      evidence: { filling: f, readings: (await viewReadings(ctx.d)).slice(0, 40) },
    };
  });

  // ---- an entity resolved from a configured catalog directory ----
  await c.run('catalog-view.catalog-resolved-entity-is-marked-and-opens-nothing', {
    expected: `the Catalog panel lists the folder's own entities, each with the file icon, and entities resolved from a configured catalog directory, each with its dimmed line opening "${CATALOG_ORIGIN}", its hover closing with the same words and the library icon; a press on such a row opens nothing — no editor and no folder — while a press on one of the folder's own rows, in the same scenario, opens its file`,
    plant: 'in the scratch copy, out/src/workspace-catalog-run.js with the note an entity from a configured catalog directory carries left empty',
  }, async () => {
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    await until('the Catalog panel drawing its kinds', 20000, () => treeRows(ctx.d, 'Catalog'), (v) => v !== null && v.some((r) => KIND_HEADING.test(r.label)));
    // The folder's own rows come first; a resolved one is further down, and a
    // list draws only the rows in sight, so the panel is scrolled until one is.
    const body = await ctx.d.workbench<{ x: number; y: number } | null>(`(() => { for (const p of document.querySelectorAll('.pane')) { const t = ((p.querySelector('.pane-header h3.title, .pane-header .title') || {}).innerText || '').trim().toLowerCase(); if (t === 'catalog') { const b = p.querySelector('.pane-body').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; } } return null; })()`);
    need(body !== null, 'the Catalog panel\'s body is not drawn');
    const own = (await catalogRows(ctx)).find((r) => r.level === 2 && r.inside && r.description === '' && r.label === 'gateway');
    let resolved: CatalogRow | undefined;
    // A resolved row is told by its note or by its icon, so a row missing one of
    // the two is still found, and judged on both.
    const isResolved = (r: CatalogRow): boolean => r.level === 2 && r.inside && (r.description.startsWith(CATALOG_ORIGIN) || r.icons.some((i) => /codicon-library/.test(i)));
    for (let i = 0; i < 40 && resolved === undefined; i++) {
      resolved = (await catalogRows(ctx)).find(isResolved);
      if (resolved === undefined) { await ctx.d.moveTo(body); await ctx.d.wheel(0, 66); await sleep(200); }
    }
    need(own !== undefined, 'the folder\'s own "gateway" row is not drawn at the head of the list');
    const subject = resolved;
    need(subject !== undefined, 'no row resolved from a configured catalog directory could be brought into sight');
    const hover = await hoverAt(ctx.d, subject.centre);
    const before = await ctx.probe.request<{ path: string } | null>('editor.active');
    const folders = await ctx.probe.request<{ path: string }[]>('workspace.folders');
    await ctx.d.click(subject.centre);
    const nothing = await holds(3000, async () => ({ active: await ctx.probe.request<{ path: string } | null>('editor.active'), folders: await ctx.probe.request<{ path: string }[]>('workspace.folders') }),
      (v) => v.active === null && JSON.stringify(v.folders) === JSON.stringify(folders));
    // The control: the folder's own row opens its file, read the same way.
    await ctx.d.moveTo(body);
    await ctx.d.wheel(0, -100000);
    const ownRow = async (): Promise<CatalogRow | undefined> => (await catalogRows(ctx)).find((r) => r.level === 2 && r.label === 'gateway' && r.inside);
    const ownNow = await until('the folder\'s own "gateway" row back in sight', 3000, ownRow, (r) => r !== undefined).catch(ownRow);
    need(ownNow !== undefined, 'the folder\'s own "gateway" row could not be brought back into sight for the control');
    await ctx.d.click(ownNow.centre);
    const control = await until('the gateway row opening its file', 10000, () => ctx.probe.request<{ path: string } | null>('editor.active'), (v) => v !== null && v.path === path.join(ctx.folder, 'aggregate.yaml')).then(() => true, () => false);
    need(control, 'its positive control did not fire: the folder\'s own row did not open its file, so the reading is not shown to see a row open one');
    await closeAllEditors(ctx);
    const libraryIcon = subject.icons.some((i) => /codicon-library/.test(i));
    const fileIcon = own.icons.some((i) => /codicon-file-code/.test(i));
    const passed = before === null && subject.description.startsWith(CATALOG_ORIGIN) && hover.trimEnd().endsWith(CATALOG_ORIGIN) && libraryIcon && fileIcon && nothing.held;
    return {
      passed,
      seen: `the resolved row "${subject.label}" reads "${subject.description}", icons ${JSON.stringify(subject.icons)}, hover ${JSON.stringify(hover.slice(-160))}; the folder's own "gateway" row icons ${JSON.stringify(own.icons)}; a press on the resolved row ${nothing.held ? 'opened nothing over 3 s' : `opened ${JSON.stringify(nothing.broke)}`}; the control opened aggregate.yaml`,
    };
  });

  // ---- each list panel's Refresh ----
  await c.run('list-panels.refresh-asks-again-and-leaves-the-content-as-it-was', {
    expected: 'pressing "Refresh registries", "Refresh workspace catalog" and "Refresh plugins" in each panel\'s title bar leaves each panel drawing what it drew before; each press asks again — the Catalog panel\'s, pressed with a Component renamed in an unsaved buffer (a change nothing else re-asks for), draws the new name, and draws the old one again when the edit is undone and it is pressed once more; the Plugins panel\'s runs the compiler\'s plugin listing as a command again',
    plant: 'in the scratch copy, out/src/workspace-catalog-view.js with the Catalog panel\'s Refresh bound to nothing',
  }, async () => {
    await closeAllEditors(ctx);
    await run(ctx, 'workbench.view.extension.aggrega');
    const rowsOf = async (p: ListPanel): Promise<string[]> => ((await treeRows(ctx.d, p)) ?? []).map((r) => r.label);
    const seen: string[] = [];
    let same = true;
    for (const [panel, action] of [['Registries', 'Refresh registries'], ['Catalog', 'Refresh workspace catalog'], ['Plugins', 'Refresh plugins']] as const) {
      const before = await rowsOf(panel);
      const mark = ctx.s.table.all().length;
      await pressViewAction(ctx, panel, action);
      // A plugin listing is a short-lived child of the editor; the table is read
      // often enough to record it while it runs.
      let listed = false;
      if (panel === 'Plugins') {
        listed = await until('the plugin listing run again', 8000, async () => { ctx.s.table.snapshot(); return ctx.s.table.all().slice(mark).some((r) => r.cmd.startsWith(`${bin} plugin list`) || readCmdline(r.pid).startsWith(`${bin} plugin list`)); }, (v) => v, 20).then(() => true, () => false);
      }
      // What it drew before, at every reading over a stated window from the press.
      const kept = await holds(1500, () => rowsOf(panel), (v) => JSON.stringify(v) === JSON.stringify(before) && v.length > 0);
      const after = kept.held ? await rowsOf(panel) : kept.broke as string[];
      const unchanged = kept.held && JSON.stringify(before) === JSON.stringify(after) && after.length > 0;
      same = same && unchanged && (panel !== 'Plugins' || listed);
      seen.push(`${panel}: ${unchanged ? 'unchanged' : `${JSON.stringify(before.slice(0, 6))} became ${JSON.stringify(after.slice(0, 6))}`}${panel === 'Plugins' ? `, the listing ${listed ? 'run again' : 'not seen run again'}` : ''}`);
    }
    // The Catalog panel's press, shown to ask: a name changed in an unsaved buffer.
    const component = path.join(ctx.folder, 'scratch-component.yaml');
    const doc = await open(ctx, component);
    const lines = (doc.text ?? '').split('\n');
    const at = lines.findIndex((l) => l.trim() === 'name: scratch/unused');
    need(at !== -1, 'the scratch Component does not name itself scratch/unused');
    await ctx.probe.request('document.edit', { path: component, start: { line: at, character: 0 }, end: { line: at + 1, character: 0 }, text: '  name: scratch/renamed-unsaved\n' });
    const unasked = await holds(3000, () => rowsOf('Catalog'), (v) => !v.includes('scratch/renamed-unsaved'));
    await pressViewAction(ctx, 'Catalog', 'Refresh workspace catalog');
    const renamed = await until('the renamed Component drawn after the press', 15000, () => rowsOf('Catalog'), (v) => v.includes('scratch/renamed-unsaved')).then(() => true, () => false);
    await ctx.probe.request('document.undo', { path: component });
    await pressViewAction(ctx, 'Catalog', 'Refresh workspace catalog');
    const back = await until('the Component\'s own name drawn again', 15000, () => rowsOf('Catalog'), (v) => v.includes('scratch/unused') && !v.includes('scratch/renamed-unsaved')).then(() => true, () => false);
    const clean = await ctx.probe.request<{ isDirty: boolean } | null>('editor.active');
    await closeAllEditors(ctx);
    const identical = fs.readFileSync(component, 'utf8') === lines.join('\n');
    return {
      passed: same && unasked.held && renamed && back && identical,
      seen: `${seen.join('; ')}; with the name changed in an unsaved buffer the panel ${unasked.held ? 'kept the old name for 3 s unasked' : 'changed unasked'}, drew the new name ${renamed ? 'after the press' : 'not even after the press'}, and ${back ? 'the old one again after the undo and a press' : 'not the old one again'}; the buffer ${clean?.isDirty ? 'dirty' : 'clean'} after the undo, the file ${identical ? 'unchanged' : 'changed'} on disk`,
    };
  });

  // ---- the status bar's reading of the language server ----
  await c.run('status-bar.lifecycle-item-reads-running-beside-the-release-and-offers-a-restart', {
    expected: `the status bar's language-server item is on its left side, immediately left of the Release indicator (${RELEASE}), reading "${RUNNING}" with a tick and not in the error colour; a press on it opens a list whose placeholder reads "${LIFECYCLE_PLACEHOLDER}", offering "${RESTART_ACTION.label}" (${RESTART_ACTION.detail}) and not "${START_ACTION.label}"; taking it restarts the server — a new server process, the item reading "${STARTING}" with a spinning glyph on the way — and the item reads running again`,
    plant: 'in the scratch copy, out/src/daemon-status.js with the click offering a start whatever the standing',
  }, async () => {
    await closeAllEditors(ctx);
    const items = await statusItems(ctx.d);
    const lifecycle = items.findIndex((i) => i.text === RUNNING);
    const release = items.findIndex((i) => i.text === RELEASE);
    need(lifecycle !== -1, `the status bar draws no "${RUNNING}" item: ${JSON.stringify(items.map((i) => i.text))}`);
    const item = items[lifecycle];
    const beside = release !== -1 && item.side === 'left' && items[release].side === 'left' && release === lifecycle + 1;
    const tick = item.icons.some((i) => /codicon-check/.test(i));
    const mark = (await lifecycleReadings(ctx)).length;
    const before = await theServer(ctx);
    await ctx.d.click(item.centre);
    const q = await waitQuickInput(ctx.d, 'the language server\'s list', (x) => x.placeholder === LIFECYCLE_PLACEHOLDER && x.rows.length > 0, 10000);
    const offered = q.rows.map((r) => r.label);
    const detail = q.rows.find((r) => r.label === RESTART_ACTION.label)?.text ?? '';
    await pickQuickInputRow(ctx.d, RESTART_ACTION.label);
    const next = await theServer(ctx, 30000, before.pid);
    await waitStatus(ctx.d, RUNNING, 60000);
    const readings = (await lifecycleReadings(ctx)).slice(mark);
    const starting = readings.find((r) => r.text === STARTING);
    const spinning = starting !== undefined && /codicon-sync/.test(starting.icons) && /spin/.test(starting.icons);
    const last = readings[readings.length - 1];
    return {
      passed: beside && tick && !item.errorKind && JSON.stringify(offered) === JSON.stringify([RESTART_ACTION.label]) && detail.includes(RESTART_ACTION.detail) && spinning && next.pid !== before.pid && last?.text === RUNNING && !last.errorKind,
      seen: `left items ${JSON.stringify(items.filter((i) => i.side === 'left').map((i) => i.text))}; the item's glyphs ${JSON.stringify(item.icons)}, ${item.errorKind ? 'in the error colour' : 'not in the error colour'} (${item.background}); the list offers ${JSON.stringify(offered)} (${JSON.stringify(detail)}); readings after the choice ${JSON.stringify(readings.map((r) => `${r.text} [${r.icons}]${r.errorKind ? ' red' : ''}`))}; server ${before.pid} → ${next.pid}`,
    };
  });

  // ---- a restart, with the graph open ----
  await c.run('readiness.restart-refills-every-panel-and-redraws-the-open-graph', {
    expected: `with the topology graph open and zoomed, running "Aggrega: Start or restart the language server" and pressing nothing else: the status bar passes through "${STARTING}" back to "${RUNNING}"; every list panel draws its answer again within ${STALE_BOUND_MS} ms, and no row of the state before an answer is drawn over ${SETTLED_WATCH_MS} ms after; the graph is drawn again by itself, with no press on Graph, and keeps the zoom it had`,
    plant: 'in the scratch copy, out/src/extension.js made not to redraw an open graph when the language server comes back',
  }, async () => {
    const graph = await showGraph(ctx);
    const canvas = await ctx.d.box(graph, '#canvas');
    need(canvas !== null, 'the graph panel draws no canvas');
    await ctx.d.moveTo({ x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 });
    await ctx.d.wheel(0, -240);
    const zoomed = await standsStill('the zoom coming to rest', 5000, () => viewTransform(ctx));
    const rendersBefore = (await graphState(graph)).renders;
    const statusMark = (await statusLog(ctx.d)).length;
    const viewsFrom = Date.now();
    await ctx.d.workbench(VIEWS_OBSERVER);
    const toastMark = (await toasts(ctx.d)).length;
    const before = await theServer(ctx);
    await send(ctx, RESTART_COMMAND);
    await theServer(ctx, 30000, before.pid);
    await waitStatus(ctx.d, RUNNING, 60000);
    const readings = (await statusLog(ctx.d)).slice(statusMark).map((r) => r.reading);
    const through = readings.indexOf(STARTING) !== -1 && readings.lastIndexOf(RUNNING) > readings.indexOf(STARTING);
    const runningAt = (await statusLog(ctx.d)).slice(statusMark).filter((r) => r.reading === RUNNING).pop()?.at ?? Date.now();
    const settle = await panelsSettle(ctx, stated(STALE_BOUND_MS));
    const redrawn = await until('the graph drawn again after the restart', 60000, () => graphState(graph), (s) => s.renders > rendersBefore && s.nodes.length > 0).then(() => true, () => false);
    const after = await standsStill('the redrawn view coming to rest', 5000, () => viewTransform(ctx));
    const f = fillingSince(await viewReadings(ctx.d), viewsFrom, runningAt);
    const leftInTime = LIST_PANELS.every((p) => f.lastStale[p] === null || (f.lastStale[p] as number) <= STALE_BOUND_MS);
    const said = (await toastsSince(ctx.d, toastMark)).map((t) => t.message);
    await closeAllEditors(ctx);
    const zoomKept = zoomed !== '' && after === zoomed;
    return {
      passed: through && settle.reached && settle.held && leftInTime && redrawn && zoomKept,
      seen: `the status bar read ${JSON.stringify(readings)}; ${describeFilling(f)}; the Commands panel reads ${settle.rows}; ${settle.held ? 'no row of the state before an answer after' : `then ${settle.broke}`}; the graph ${redrawn ? 'was drawn again by itself' : 'was not drawn again'}; its transform ${JSON.stringify(zoomed)} before, ${JSON.stringify(after)} after; notifications ${JSON.stringify(said)}`,
    };
  });
}
