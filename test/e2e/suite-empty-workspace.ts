// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { need } from './checks';
import { capture, closeAllEditors, open, ready, run, serverNow, SuiteContext } from './suite-context';
import { settingsScreen, SettingsScreen } from './suite-gateway';
import { BINARY_PATH_SEARCH, notFoundAt, setBinaryPath, START_FAILED_OPENING } from './suite-killed';
import { HOVER_NOT_RUNNING_ANCHORED, LIFECYCLE_PLACEHOLDER, lifecycleReadings, RESTART_ACTION, START_ACTION } from './suite-readiness';
import { killServer, pressViewAction, STOPPED_RESPONDING } from './suite-storefront';
import {
  commandsPanel, drawnTreeRows, holds, hoverAt, NOT_RUNNING, pickQuickInputRow, quickInput, revealTreeRow, RUNNING, selectorRows, sleep, StatusItem, statusItems, statusNow, Toast, toasts,
  toastsSince, treeRowCentre, treeRows, until, waitQuickInput, waitStatus, waitToast,
} from './workbench';

// The checks run in a folder that is a workspace root and holds nothing else:
// that each list panel's empty answer reads as an answer, and differently from
// the row it draws when the language server is not running — reached first by
// pointing the binary setting at a file that does not exist, as a reader stops
// it, and then, with the binary given back, by the server ending more often
// than the respawn bound allows — and what the status bar's language-server
// item says and offers in that state, and does when its Start is taken.

export const EMPTY_WORKSPACE_CHECKS = [
  'catalog-view.empty-workspace-reads-no-entities',
  'list-panels.empty-answers-read-as-answers',
  'list-panels.stopped-server-reads-apart-from-an-empty-answer',
  'registries-panel.stopped-server-row-reads-as-a-fault-to-chase',
  'status-bar.lifecycle-item-reads-not-running-in-red-and-says-why',
  'plugins-panel.answers-with-the-language-server-stopped',
  'status-bar.lifecycle-item-starts-the-server-and-drops-the-red',
] as const;

// The rows held as the playbook quotes them.
const NO_ENTITIES = 'No entities in this workspace.';
const SERVER_STOPPED = 'The Aggrega language server is not running.';
const NO_REGISTRIES = 'No registries configured.';
const CATALOG_HEAD = ['Search catalog', 'Draft entity'];
const REGISTRIES_HEAD = ['Add registry', 'Update index'];
const EMBEDDED = /^Embedded \(\d+\)$/;
const CONFIGURED_NONE = 'Configured (0)';

// beneathHead is what a list panel draws below the operations at its head.
async function beneathHead(ctx: SuiteContext, panel: string, head: string[]): Promise<string[]> {
  const rows = ((await treeRows(ctx.d, panel)) ?? []).map((r) => r.label);
  return rows.slice(0, head.length).join('\n') === head.join('\n') ? rows.slice(head.length) : rows;
}

// pluginHeadings reads the Plugins panel's two group headings, scrolling to the
// second: the first group's rows push it below the part of the panel in sight.
async function pluginHeadings(ctx: SuiteContext): Promise<{ embedded: string | null; configured: string | null; drawn: string[] }> {
  await run(ctx, 'aggrega.plugins.focus');
  const embedded = await until('the Plugins panel\'s first heading', 15000, async () => ((await treeRows(ctx.d, 'Plugins')) ?? []).map((r) => r.label).find((l) => EMBEDDED.test(l)) ?? null, (v) => v !== null).catch(() => null);
  const configured = await revealTreeRow(ctx.d, 'Plugins', CONFIGURED_NONE, 10000).then(() => CONFIGURED_NONE, () => null);
  const drawn = ((await drawnTreeRows(ctx.d, 'Plugins')) ?? []).map((r) => r.label);
  return { embedded, configured, drawn };
}

// stopPastTheBound ends the language server by its PID, again each time it is
// started again, until the extension leaves it stopped and says so: a server
// stopped with the binary setting untouched.
async function stopPastTheBound(ctx: SuiteContext): Promise<{ stopped: boolean; kills: number }> {
  const mark = (await toasts(ctx.d)).length;
  const aggregate = path.join(ctx.folder, '.aggrega-config.yaml');
  for (let k = 1; k <= 10; k++) {
    const killed = await killServer(ctx);
    await open(ctx, aggregate);
    const outcome = await until(`a restart or the stopped-responding notification after kill ${k}`, 20000, async () => {
      const notified = (await toastsSince(ctx.d, mark)).some((t) => t.message === STOPPED_RESPONDING);
      const restarted = serverNow(ctx, killed.pid) !== null;
      return { notified, restarted };
    }, (v) => v.notified || v.restarted).catch(() => ({ notified: false, restarted: false }));
    if (outcome.notified) {
      const stopped = await waitStatus(ctx.d, NOT_RUNNING, 20000).then(() => true, () => false);
      await closeAllEditors(ctx);
      return { stopped, kills: k };
    }
    if (!outcome.restarted) { break; }
    await waitStatus(ctx.d, RUNNING, 30000).catch(() => undefined);
    await sleep(500);
  }
  await closeAllEditors(ctx);
  return { stopped: false, kills: -1 };
}

export async function emptyWorkspaceChecks(ctx: SuiteContext, missing: string): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  const base = path.basename(ctx.folder);
  await ready(ctx);

  await c.run('catalog-view.empty-workspace-reads-no-entities', {
    expected: `with the language server running in a folder that is a workspace root holding no entity, the Aggrega workspace row names the folder ("${base}") and the Catalog panel draws, beneath the operations at its head, the one row "${NO_ENTITIES}" — not "${SERVER_STOPPED}", and not nothing`,
    plant: 'in the scratch copy, out/src/workspace-catalog-run.js with an empty index answered as a language server that is not running',
  }, async () => {
    const doc = await commandsPanel(ctx.d);
    const rows = await until('the Aggrega workspace row naming the folder', 20000, () => selectorRows(doc), (r) => r.length >= 2 && r[1].value === base).catch(() => selectorRows(doc));
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    const drawn = await until('the Catalog panel answering', 20000, () => beneathHead(ctx, 'Catalog', CATALOG_HEAD), (v) => v.length > 0).catch(() => [] as string[]);
    return { passed: rows[1]?.value === base && JSON.stringify(drawn) === JSON.stringify([NO_ENTITIES]) && (await statusNow(ctx.d)) === RUNNING, seen: `the Aggrega workspace row reads "${rows[1]?.value ?? ''}"; beneath its head the Catalog panel draws ${JSON.stringify(drawn)}` };
  });

  await c.run('list-panels.empty-answers-read-as-answers', {
    expected: `in the same folder, with the server running, the Registries panel draws "${NO_REGISTRIES}" beneath its head, and the Plugins panel its two headings, "Embedded (<n>)" and "${CONFIGURED_NONE}"`,
    plant: 'in the scratch copy, out/src/registries-run.js with an empty registry list answered as a failed one',
  }, async () => {
    await run(ctx, 'workbench.view.extension.aggrega');
    const registries = await until('the Registries panel answering', 20000, () => beneathHead(ctx, 'Registries', REGISTRIES_HEAD), (v) => v.length > 0).catch(() => [] as string[]);
    const plugins = await pluginHeadings(ctx);
    return {
      passed: JSON.stringify(registries) === JSON.stringify([NO_REGISTRIES]) && plugins.embedded !== null && plugins.configured !== null,
      seen: `beneath their heads the Registries panel draws ${JSON.stringify(registries)}, and the Plugins panel's headings read ${JSON.stringify([plugins.embedded, plugins.configured])}`,
    };
  });

  // ---- the language server stopped by the binary setting ----
  need(!fs.existsSync(missing), `${missing} exists`);
  await setBinaryPath(ctx, bin, missing);
  const stopped = await waitStatus(ctx.d, NOT_RUNNING, 60000).then(() => true, () => false);
  let registriesRow = '';
  let registriesHover = '';
  let registriesPress = '';
  const failedStart = `${START_FAILED_OPENING}${notFoundAt(missing)}`;
  const pluginsRow = `The plugin list could not run: the compiler at ${missing} was not found.`;
  const pluginsHover = `The plugin list could not run: ${notFoundAt(missing)} Click to open that setting.`;
  await c.run('list-panels.stopped-server-reads-apart-from-an-empty-answer', {
    expected: `with the language server stopped — the binary setting pointed at ${missing}, which does not exist, and the status bar reading "${NOT_RUNNING}" — pressing each list panel's Refresh draws a row different from its empty answer: the Catalog panel and the Registries panel each the one row "${SERVER_STOPPED}", the Registries panel at each of two presses, each row's hover reading "${HOVER_NOT_RUNNING_ANCHORED}" and each row, pressed, starting the language server — which fails again, with an error notification reading "${failedStart}"; and the Plugins panel, whose listing runs the compiler as a command, the row "${pluginsRow}", its hover reading "${pluginsHover}" and its press opening the settings screen searching "${BINARY_PATH_SEARCH}" and drawing that one setting`,
    plant: 'in the scratch copy, out/src/workspace-catalog-run.js with a stopped language server answered as an empty workspace; or out/src/registries-run.js asking a stopped language server for the listing; or out/src/workspace-catalog-run.js with the stopped row offering nothing to press; or out/src/plugins-run.js with a compiler that could not be started read as a listing that failed',
  }, async () => {
    need(stopped, `the status bar did not read "${NOT_RUNNING}" after the binary setting named a file that does not exist`);
    await closeAllEditors(ctx);
    await run(ctx, 'workbench.view.extension.aggrega');
    await pressViewAction(ctx, 'Catalog', 'Refresh workspace catalog');
    const catalog = await until('the Catalog panel redrawn', 15000, () => beneathHead(ctx, 'Catalog', CATALOG_HEAD), (v) => v.length > 0 && !v.includes(NO_ENTITIES)).catch(() => beneathHead(ctx, 'Catalog', CATALOG_HEAD));
    const readings: string[][] = [];
    for (const n of [1, 2]) {
      await pressViewAction(ctx, 'Registries', 'Refresh registries');
      readings.push(await until(`the Registries panel redrawn by press ${n}`, 10000, () => beneathHead(ctx, 'Registries', REGISTRIES_HEAD), (v) => v.length > 0 && !v.includes(NO_REGISTRIES)).catch(() => beneathHead(ctx, 'Registries', REGISTRIES_HEAD)));
    }
    const registries = readings[readings.length - 1];
    registriesRow = registries[0] ?? '';
    // Each stopped row: its hover, then a press of it, read by the start the press
    // makes — which the missing compiler ends in the failed start's own words.
    const offer = async (panel: string): Promise<{ hover: string; start: Toast | null }> => {
      const at = await treeRowCentre(ctx.d, panel, SERVER_STOPPED);
      if (at === null) { return { hover: '', start: null }; }
      const hover = await hoverAt(ctx.d, at);
      await ctx.d.moveTo({ x: 1, y: 1 });
      const mark = (await toasts(ctx.d)).length;
      await ctx.d.click(at);
      const start = await waitToast(ctx.d, `the start the ${panel} row's press made`, mark, (t) => t.severity === 'error' && t.message.startsWith(START_FAILED_OPENING), 30000).catch(() => null as Toast | null);
      return { hover, start };
    };
    const catalogOffer = await offer('Catalog');
    const registriesOffer = await offer('Registries');
    registriesHover = registriesOffer.hover;
    registriesPress = registriesOffer.start === null ? 'started nothing' : `started the language server, which answered "${registriesOffer.start.message}"`;
    // The Plugins panel: its row, its hover and what its press opens.
    await pressViewAction(ctx, 'Plugins', 'Refresh plugins');
    const plugins = await until('the Plugins panel saying why its listing could not run', 15000, async () => ((await treeRows(ctx.d, 'Plugins')) ?? []).map((r) => r.label), (v) => v.includes(pluginsRow)).catch(async () => ((await treeRows(ctx.d, 'Plugins')) ?? []).map((r) => r.label));
    const pluginsAt = await treeRowCentre(ctx.d, 'Plugins', pluginsRow);
    const pluginsHoverRead = pluginsAt === null ? '' : await hoverAt(ctx.d, pluginsAt);
    let screen: SettingsScreen | null = null;
    if (pluginsAt !== null) {
      await ctx.d.moveTo({ x: 1, y: 1 });
      await ctx.d.click(pluginsAt);
      screen = await settingsScreen(ctx);
      await closeAllEditors(ctx);
    }
    const catalogApart = JSON.stringify(catalog) === JSON.stringify([SERVER_STOPPED]);
    const registriesStopped = readings.length === 2 && readings.every((r) => JSON.stringify(r) === JSON.stringify([SERVER_STOPPED]));
    const offered = [catalogOffer, registriesOffer].every((o) => o.hover === HOVER_NOT_RUNNING_ANCHORED && o.start !== null && o.start.message === failedStart);
    const pluginsSaid = plugins.includes(pluginsRow) && pluginsHoverRead === pluginsHover
      && screen !== null && screen.search === BINARY_PATH_SEARCH && JSON.stringify(screen.keys) === JSON.stringify(['aggrega.server.binaryPath']);
    return {
      passed: catalogApart && registriesStopped && offered && pluginsSaid,
      seen: `the Catalog panel draws ${JSON.stringify(catalog)}; the Registries panel ${JSON.stringify(readings)} at its two presses; the Catalog row's hover ${JSON.stringify(catalogOffer.hover)} and its press ${catalogOffer.start === null ? 'started nothing' : `answered "${catalogOffer.start.message}"`}; the Registries row's hover ${JSON.stringify(registriesOffer.hover)} and its press ${registriesOffer.start === null ? 'started nothing' : `answered "${registriesOffer.start.message}"`}; the Plugins panel draws ${JSON.stringify(plugins)}, the row's hover ${JSON.stringify(pluginsHoverRead)}, its press ${screen === null ? 'drew no settings screen' : `opened the settings screen searching "${screen.search}" and drawing ${JSON.stringify(screen.keys)}`}`,
    };
  });
  await c.forPerson('registries-panel.stopped-server-row-reads-as-a-fault-to-chase', {
    expected: `with the language server stopped, the Registries panel draws the Catalog panel's row for that state, "${SERVER_STOPPED}", with the status bar's hover for it, and pressing the row starts the language server`,
    plant: 'none: this is a judgement of the wording',
    question: 'With the language server stopped, the Registries panel draws the row below, with the hover below it; pressing the row does what is written beneath. Does that read to you as a fault to chase?',
  }, async () => {
    need(registriesRow !== '', 'the Registries panel drew no row with the server stopped, so there is nothing to judge');
    await run(ctx, 'aggrega.registries.focus');
    return { screenshot: await capture(ctx, 'registries-with-the-server-stopped'), drawnText: `row: ${registriesRow}\nhover: ${registriesHover}\npressed: ${registriesPress}` };
  });

  // ---- the status bar's item in that state ----
  await c.run('status-bar.lifecycle-item-reads-not-running-in-red-and-says-why', {
    expected: `with the language server stopped in a folder that is a workspace root, the status bar's language-server item reads "${NOT_RUNNING}" on the left with the error glyph and in the error colour, its hover reads "${HOVER_NOT_RUNNING_ANCHORED}", and a press on it opens a list whose placeholder reads "${LIFECYCLE_PLACEHOLDER}" offering "${START_ACTION.label}" (${START_ACTION.detail}) and not "${RESTART_ACTION.label}"; Escape closes it`,
    plant: 'in the scratch copy, out/src/daemon-status.js with the not-running reading drawn without the error colour',
  }, async () => {
    need(stopped, `the status bar did not read "${NOT_RUNNING}"`);
    await closeAllEditors(ctx);
    const item = (await statusItems(ctx.d)).find((i) => i.text === NOT_RUNNING);
    need(item !== undefined, `the status bar draws no "${NOT_RUNNING}" item`);
    const hover = await hoverAt(ctx.d, item.centre);
    await ctx.d.click(item.centre);
    const q = await waitQuickInput(ctx.d, 'the language server\'s list', (x) => x.placeholder === LIFECYCLE_PLACEHOLDER && x.rows.length > 0, 10000);
    const offered = q.rows.map((r) => r.label);
    const detail = q.rows[0]?.text ?? '';
    await ctx.d.press('Escape');
    await until('the list closing', 5000, () => quickInput(ctx.d), (x) => x === null).catch(() => undefined);
    const errorGlyph = item.icons.some((i) => /codicon-error/.test(i));
    return {
      passed: item.side === 'left' && errorGlyph && item.errorKind && hover.includes(HOVER_NOT_RUNNING_ANCHORED) && JSON.stringify(offered) === JSON.stringify([START_ACTION.label]) && detail.includes(START_ACTION.detail),
      seen: `the item reads "${item.text}" on the ${item.side}, glyphs ${JSON.stringify(item.icons)}, ${item.errorKind ? 'in the error colour' : 'not in the error colour'} (${item.background}); hover ${JSON.stringify(hover)}; the list offers ${JSON.stringify(offered)} (${JSON.stringify(detail)})`,
    };
  });

  // ---- the binary given back, and the server stopped with it in place ----
  await setBinaryPath(ctx, missing, bin);
  const back = await waitStatus(ctx.d, RUNNING, 60000).then(() => true, () => false);
  const bound = back ? await stopPastTheBound(ctx) : { stopped: false, kills: -1 };
  await c.run('plugins-panel.answers-with-the-language-server-stopped', {
    expected: `with the binary under test in the setting and the language server stopped — ended by its PID each time it was started again until the extension raised "${STOPPED_RESPONDING}" — the Plugins panel's Refresh still draws its two headings, "Embedded (<n>)" and "${CONFIGURED_NONE}": its listing runs the compiler as a command, which needs no language server`,
    plant: 'in the scratch copy, out/src/plugins-view.js with the listing asked only while the language server is running',
  }, async () => {
    need(back, 'the language server did not read running again once the binary setting was given back');
    need(bound.stopped, 'the language server could not be left stopped by ending it past the respawn bound');
    await run(ctx, 'workbench.view.extension.aggrega');
    await pressViewAction(ctx, 'Plugins', 'Refresh plugins');
    await sleep(1500);
    const plugins = await pluginHeadings(ctx);
    return { passed: (await statusNow(ctx.d)) === NOT_RUNNING && plugins.embedded !== null && plugins.configured !== null, seen: `stopped after ${bound.kills} kill(s); the status bar reads "${await statusNow(ctx.d)}"; the Plugins panel's headings read ${JSON.stringify([plugins.embedded, plugins.configured])} (${JSON.stringify(plugins.drawn.slice(0, 4))})` };
  });

  await c.run('status-bar.lifecycle-item-starts-the-server-and-drops-the-red', {
    expected: `with the language server left stopped and the binary in place, the item reads "${NOT_RUNNING}" in the error colour and nothing starts it by itself (watched for 5 s); pressing it and taking "${START_ACTION.label}" from its list starts the language server, and the item then reads "${RUNNING}" with the tick and no longer in the error colour`,
    plant: 'in the scratch copy, out/src/daemon-status.js with the error colour set on the way into the not-running reading and never cleared',
  }, async () => {
    need(bound.stopped, 'the language server could not be left stopped by ending it past the respawn bound');
    await closeAllEditors(ctx);
    const stillStopped = (await holds(5000, () => statusNow(ctx.d), (v) => v === NOT_RUNNING)).held;
    const item = (await statusItems(ctx.d)).find((i) => i.text === NOT_RUNNING);
    need(item !== undefined, `the status bar draws no "${NOT_RUNNING}" item to press`);
    const mark = (await lifecycleReadings(ctx)).length;
    const toastMark = (await toasts(ctx.d)).length;
    await ctx.d.click(item.centre);
    await waitQuickInput(ctx.d, 'the language server\'s list', (x) => x.placeholder === LIFECYCLE_PLACEHOLDER && x.rows.length > 0, 10000);
    await pickQuickInputRow(ctx.d, START_ACTION.label);
    const running = await waitStatus(ctx.d, RUNNING, 60000).then(() => true, () => false);
    const runningItem = async (): Promise<StatusItem | undefined> => (await statusItems(ctx.d)).find((i) => i.text === RUNNING);
    const now = await until(`the "${RUNNING}" item drawn with the tick and out of the error colour`, 5000, runningItem, (i) => i !== undefined && !i.errorKind && i.icons.some((x) => /codicon-check/.test(x))).catch(runningItem);
    const readings = (await lifecycleReadings(ctx)).slice(mark);
    const said = (await toastsSince(ctx.d, toastMark)).map((t) => t.message);
    return {
      passed: stillStopped && item.errorKind && running && now !== undefined && !now.errorKind && now.icons.some((i) => /codicon-check/.test(i)),
      seen: `before the press the item read "${item.text}"${item.errorKind ? ' in the error colour' : ''} and ${stillStopped ? 'nothing started the server for 5 s' : 'the server had started by itself'}; the item's readings after ${JSON.stringify(readings.map((r) => `${r.text}${r.errorKind ? ' red' : ''} [${r.icons}]`))}; ${now ? `it reads "${now.text}", ${now.errorKind ? 'still in the error colour' : 'not in the error colour'} (${now.background})` : 'no running item drawn'}; notifications ${JSON.stringify(said)}`,
    };
  });
}
