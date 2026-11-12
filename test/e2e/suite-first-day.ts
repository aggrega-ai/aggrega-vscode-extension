// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { IN_EFFECT_SENTENCE } from '../../src/config-change-watch';
import { need } from './checks';
import { readTree, sameTree, Tree } from './fixtures';
import { continueHere } from './suite-above';
import { closeAllEditors, languageServers, ready, reopen, run, send, SuiteContext } from './suite-context';
import { HOVER_NOT_RUNNING_UNANCHORED, LIFECYCLE_PLACEHOLDER, RESTART_ACTION, START_ACTION } from './suite-readiness';
import {
  commandsPanel, documentWith, holds, hoverAt, NOT_RUNNING, paletteRows, pickQuickInputRow, pressIn, QuickInput, quickInput, RUNNING, selectorRows, stated, statusItems,
  toasts, Toast, treeRows, until, waitQuickInput, waitStatus, waitToast,
} from './workbench';

// The checks run in a folder that no workspace marker reaches, on three repairs a
// reader meets on their first day: the command that starts the language server is
// there when nothing is running, and says why it starts none; the command that
// cannot run without a language server is left out of the palette until one
// answers, while one that works without a server is listed; the status bar says
// what is wrong and offers the way out; and the welcome page's control that
// creates a workspace configuration writes one the folder is anchored by, now and
// after the window is opened again, and never overwrites it.
// Beside them, in a folder beneath a workspace root, the command that opens the
// Release configuration opens the root's file and writes nothing where the reader
// stands.

export const NO_WORKSPACE_CHECKS = [
  'palette.restart-command-is-there-with-no-workspace',
  'language-server.restart-with-no-workspace-says-there-is-none',
  'palette.status-bar-menu-is-left-out-with-no-server',
  'palette.build-analysis-toggle-works-with-no-server',
  'status-bar.lifecycle-item-says-there-is-nothing-to-attach-to',
  'workspace-config.authoring-release-with-no-workspace-says-so-and-writes-nothing',
  'welcome-page.create-workspace-configuration-anchors-the-folder',
  'palette.status-bar-menu-is-listed-once-a-server-answers',
  'welcome-page.created-configuration-still-anchors-after-a-reopen',
  'welcome-page.create-workspace-configuration-again-opens-it-unchanged',
] as const;

export const AUTHORING_RELEASE_CHECKS = [
  'workspace-config.authoring-release-opens-the-roots-configuration',
] as const;

// The words a reader is to meet, held as the playbook quotes them.
const NO_WORKSPACE = 'Aggrega: no Aggrega workspace is available in this project. Open a Project folder holding .aggrega-config.yaml or a Release file, or create an Aggrega workspace.';
const CREATED = 'Aggrega: .aggrega-config.yaml created; this folder is now the workspace root.';
const ALREADY = 'Aggrega: .aggrega-config.yaml already exists here, so it was opened rather than replaced.';
const TOGGLE_OPENING = 'Aggrega: the artifact-rendering stage';
const toggleSentence = (on: boolean): string => `${TOGGLE_OPENING} ${on ? 'will run' : 'will not run'} while inspecting a graph. The language server reads this setting when it starts, so restart it to apply the change.`;
const RESTART_SERVER = 'Restart server';
const NO_ENTITIES = 'No entities in this workspace.';
const CREATE_CONTROL = 'button.step-action[data-command="aggrega.getStarted.createWorkspace"]';
const CONFIG = '.aggrega-config.yaml';

// MENU_WINDOW_MS is how long the palette is watched for the status bar menu it is
// to leave out, and MENU_LISTED_MS how long it is given to list the command once a
// language server answers.
const MENU_WINDOW_MS = 3000;
const MENU_LISTED_MS = 10000;

// paletteTitle is how the palette lists a command: the manifest's category, where
// it declares one, then its title.
export function paletteTitle(ctx: SuiteContext, command: string): string {
  const c = ctx.manifest.contributes.commands.find((x) => x.command === command);
  if (!c) { throw new Error(`the manifest declares no command ${command}`); }
  return c.category ? `${c.category}: ${c.title}` : c.title;
}

// PaletteRow is one row the palette offers for a query, with whether it is drawn
// as unavailable.
interface PaletteRow { label: string; greyed: boolean; classes: string }

async function paletteLook(ctx: SuiteContext, title: string): Promise<{ q: QuickInput; rows: PaletteRow[] }> {
  const q = await paletteRows(ctx.d, (cmd) => send(ctx, cmd), title);
  const rows = await ctx.d.workbench<PaletteRow[]>(`(() => {
    const w = [...document.querySelectorAll('.quick-input-widget')].find((e) => e.style.display !== 'none' && e.getBoundingClientRect().height > 0);
    if (!w) { return []; }
    return [...w.querySelectorAll('.monaco-list-row')].filter((r) => r.getBoundingClientRect().height > 0).map((r) => ({
      label: ((r.querySelector('.label-name') || {}).innerText || '').trim(),
      greyed: r.classList.contains('disabled') || r.getAttribute('aria-disabled') === 'true' || !!r.querySelector('.disabled'),
      classes: r.className,
    }));
  })()`);
  return { q, rows };
}

export async function closePalette(ctx: SuiteContext): Promise<void> {
  await ctx.d.press('Escape');
  await until('the palette closing', 5000, () => quickInput(ctx.d), (x) => x === null).catch(() => undefined);
}

// readyUnanchored waits for the state a window on a folder no marker reaches
// starts from: the status bar reading not running, the welcome page drawn, and
// the Aggrega side bar showing the Commands panel.
async function readyUnanchored(ctx: SuiteContext): Promise<void> {
  await waitStatus(ctx.d, NOT_RUNNING, 90000);
  await documentWith(ctx.d, 'the welcome page the extension opens at start', `!!document.querySelector('.version-entry')`, 30000);
  await run(ctx, 'workbench.view.extension.aggrega');
  await commandsPanel(ctx.d);
}

// endingSince waits for the first notification after `mark` that `match` takes.
function endingSince(ctx: SuiteContext, what: string, mark: number, match: (t: Toast) => boolean): Promise<Toast | null> {
  return waitToast(ctx.d, what, mark, match, 20000).catch(() => null);
}

export async function noWorkspaceChecks(ctx: SuiteContext): Promise<void> {
  const c = ctx.checks;
  await readyUnanchored(ctx);
  const restartTitle = paletteTitle(ctx, 'aggrega.server.restart');
  const menuTitle = paletteTitle(ctx, 'aggrega.statusBar.openMenu');
  const toggleTitle = paletteTitle(ctx, 'aggrega.server.toggleBuildOnInspect');
  const authoringTitle = paletteTitle(ctx, 'aggrega.workspace.openAuthoringReleaseConfig');

  // ---- the restart command, with nothing to attach to ----
  let offered = false;
  await c.run('palette.restart-command-is-there-with-no-workspace', {
    expected: `in a window on a folder no workspace marker reaches, the command palette searched for "${restartTitle}" (the manifest's title for aggrega.server.restart) offers it`,
    plant: 'in the scratch copy\'s package.json, the restart command hidden from the palette while nothing is answerable',
  }, async () => {
    const { rows } = await paletteLook(ctx, restartTitle);
    offered = rows.some((r) => r.label === restartTitle);
    return { passed: offered, seen: `the palette offers ${JSON.stringify(rows.map((r) => r.label))}` };
  });
  await c.run('language-server.restart-with-no-workspace-says-there-is-none', {
    expected: `taking "${restartTitle}" from the palette there raises "${NO_WORKSPACE}", and starts no language server`,
    plant: 'in the scratch copy, out/src/extension.js with the restart command returning without a word where nothing is anchored',
  }, async () => {
    need(offered, 'the palette did not offer the command, so it cannot be taken from it');
    const mark = (await toasts(ctx.d)).length;
    await pickQuickInputRow(ctx.d, restartTitle);
    const told = await endingSince(ctx, 'the command answering', mark, (t) => t.message.startsWith('Aggrega'));
    const none = await holds(2000, async () => languageServers(ctx).length, (n) => n === 0);
    const servers = none.held ? 0 : none.broke as number;
    return { passed: told !== null && told.message === NO_WORKSPACE && none.held, seen: `${told === null ? 'no notification' : `"${told.message}" (${told.severity})`}; language servers running: ${servers}${none.held ? ' at every reading over 2000 ms' : ` at ${none.atMs} ms`}` };
  });

  // ---- the command left out with no server, and the one that is not ----
  // menuReading is the one observation both checks of the status bar menu make,
  // here with no server and again once one answers: the palette opened, the
  // command's title typed into it, and the row it draws for the command, if any.
  const menuReading = async (): Promise<{ query: boolean; row: PaletteRow | undefined; labels: string[] }> => {
    const { q, rows } = await paletteLook(ctx, menuTitle);
    await closePalette(ctx);
    return { query: q.value === `>${menuTitle}`, row: rows.find((r) => r.label === menuTitle), labels: rows.map((r) => r.label) };
  };
  await c.run('palette.status-bar-menu-is-left-out-with-no-server', {
    expected: `with no language server answering, the palette searched for "${menuTitle}" (the manifest's title for aggrega.statusBar.openMenu) does not list it, at any reading over ${MENU_WINDOW_MS} ms`,
    plant: 'in the scratch copy\'s package.json, the command\'s enablement condition removed, so the palette lists it with no server',
  }, async () => {
    const servers = languageServers(ctx).length;
    need(servers === 0, `${servers} language server(s) running, so there is no window without one to read the palette in`);
    const first = await menuReading();
    need(first.query, `the palette did not hold the typed title "${menuTitle}", so what it lists says nothing about the command`);
    const watch = first.row === undefined
      ? await holds(MENU_WINDOW_MS, menuReading, (v) => v.query && v.row === undefined)
      : { held: false, readings: 0, broke: first, atMs: 0 };
    const broke = watch.broke;
    return {
      passed: watch.held,
      seen: watch.held
        ? `the palette held the typed title and did not list the command at any of ${1 + watch.readings} readings over ${MENU_WINDOW_MS} ms; for "${menuTitle}" it offers ${JSON.stringify(first.labels)}`
        : broke === undefined || !broke.query
          ? `at a reading ${watch.atMs ?? 0} ms in, the palette did not hold the typed title`
          : `listed ${watch.atMs ?? 0} ms in, drawn ${broke.row?.greyed ? `unavailable (${broke.row.classes})` : 'available'}`,
    };
  });
  await c.run('palette.build-analysis-toggle-works-with-no-server', {
    expected: `with no language server, the palette lists "${toggleTitle}" available; taking it turns aggrega.server.buildOnInspect on in the user settings and raises "${toggleSentence(true)}" with a "${RESTART_SERVER}" button; taking it again turns the setting off and raises "${toggleSentence(false)}"`,
    plant: 'in the scratch copy\'s package.json, the toggle made unavailable while nothing is answerable',
  }, async () => {
    const setting = async (): Promise<unknown> => (await ctx.probe.request<{ inspect: { globalValue?: unknown } | null }>('configuration.inspect', { key: 'aggrega.server.buildOnInspect' })).inspect?.globalValue;
    const seen: string[] = [];
    let all = true;
    for (const on of [true, false]) {
      const { rows } = await paletteLook(ctx, toggleTitle);
      const row = rows.find((r) => r.label === toggleTitle);
      if (row === undefined || row.greyed) {
        await closePalette(ctx);
        seen.push(`the palette ${row === undefined ? 'does not list it' : 'draws it unavailable'}`);
        all = false;
        break;
      }
      const mark = (await toasts(ctx.d)).length;
      await pickQuickInputRow(ctx.d, toggleTitle);
      const told = await endingSince(ctx, 'the toggle answering', mark, (t) => t.message.startsWith(TOGGLE_OPENING));
      const value = await until('the setting written', 10000, setting, (v) => v === on).catch(setting);
      const ok = told !== null && told.message === toggleSentence(on) && told.buttons.includes(RESTART_SERVER) && value === on;
      all = all && ok;
      seen.push(`${on ? 'on' : 'off'}: ${told === null ? 'no notification' : `"${told.message}" with ${JSON.stringify(told.buttons)}`}; the setting reads ${JSON.stringify(value)}`);
    }
    return { passed: all, seen: seen.join('; ') };
  });

  // ---- the status bar ----
  await c.run('status-bar.lifecycle-item-says-there-is-nothing-to-attach-to', {
    expected: `with no folder a workspace marker reaches, the status bar's language-server item reads "${NOT_RUNNING}" on the left, with the error glyph and in the error colour; its hover reads "${HOVER_NOT_RUNNING_UNANCHORED}"; a press on it opens a list whose placeholder reads "${LIFECYCLE_PLACEHOLDER}" offering "${START_ACTION.label}" (${START_ACTION.detail}) and not "${RESTART_ACTION.label}"; and taking it is answered by "${NO_WORKSPACE}"`,
    plant: 'in the scratch copy, out/src/daemon-status.js with the reading for a window no workspace marker reaches worded as the reading for one that is anchored',
  }, async () => {
    await closeAllEditors(ctx);
    const item = (await statusItems(ctx.d)).find((i) => i.text === NOT_RUNNING);
    need(item !== undefined, `the status bar draws no "${NOT_RUNNING}" item: ${JSON.stringify((await statusItems(ctx.d)).map((i) => i.text))}`);
    const hover = await hoverAt(ctx.d, item.centre);
    await ctx.d.click(item.centre);
    const q = await waitQuickInput(ctx.d, 'the language server\'s list', (x) => x.placeholder === LIFECYCLE_PLACEHOLDER && x.rows.length > 0, 10000);
    const labels = q.rows.map((r) => r.label);
    const detail = q.rows[0]?.text ?? '';
    const mark = (await toasts(ctx.d)).length;
    await pickQuickInputRow(ctx.d, START_ACTION.label);
    const told = await endingSince(ctx, 'the start answering', mark, (t) => t.message.startsWith('Aggrega'));
    const errorGlyph = item.icons.some((i) => /codicon-error/.test(i));
    return {
      passed: item.side === 'left' && errorGlyph && item.errorKind && hover.includes(HOVER_NOT_RUNNING_UNANCHORED) && JSON.stringify(labels) === JSON.stringify([START_ACTION.label]) && detail.includes(START_ACTION.detail) && told?.message === NO_WORKSPACE,
      seen: `the item "${item.text}" on the ${item.side}, glyphs ${JSON.stringify(item.icons)}, ${item.errorKind ? 'in the error colour' : 'not in the error colour'}; hover ${JSON.stringify(hover)}; the list offers ${JSON.stringify(labels)} (${JSON.stringify(detail)}); taking it: ${told === null ? 'no notification' : `"${told.message}"`}`,
    };
  });

  // ---- the Release configuration, with no workspace ----
  await c.run('workspace-config.authoring-release-with-no-workspace-says-so-and-writes-nothing', {
    expected: `in the folder no marker reaches, "${authoringTitle}" taken from the palette answers "${NO_WORKSPACE}" and writes nothing: the folder is empty afterwards and no editor opens`,
    plant: 'in the scratch copy, out/src/extension.js with the command writing a configuration into the folder opened where nothing is anchored',
  }, async () => {
    const before = readTree(ctx.folder);
    const { rows } = await paletteLook(ctx, authoringTitle);
    need(rows.some((r) => r.label === authoringTitle), `the palette does not offer "${authoringTitle}"`);
    const mark = (await toasts(ctx.d)).length;
    await pickQuickInputRow(ctx.d, authoringTitle);
    const told = await endingSince(ctx, 'the command answering', mark, (t) => t.message.startsWith('Aggrega'));
    const untouched = await holds(1500, async () => ({ tree: readTree(ctx.folder), active: await ctx.probe.request<{ path: string } | null>('editor.active') }), (v) => sameTree(before, v.tree) && v.tree.size === 0 && v.active === null);
    const after = untouched.held ? readTree(ctx.folder) : (untouched.broke as { tree: Tree }).tree;
    const active = untouched.held ? await ctx.probe.request<{ path: string } | null>('editor.active') : (untouched.broke as { active: { path: string } | null }).active;
    return { passed: told?.message === NO_WORKSPACE && untouched.held && sameTree(before, after) && after.size === 0 && active === null, seen: `${told === null ? 'no notification' : `"${told.message}"`}; the folder holds ${JSON.stringify([...after.keys()])}; the active editor ${active?.path ?? 'none'}` };
  });

  // ---- the welcome page creates the configuration ----
  const config = path.join(ctx.folder, CONFIG);
  let created: Buffer | null = null;
  const pressCreate = async (): Promise<void> => {
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.getStarted.open');
    const page = await documentWith(ctx.d, 'the welcome page drawing its workspace step', `!!document.querySelector(${JSON.stringify(CREATE_CONTROL)})`, 20000);
    await pressIn(ctx.d, page, CREATE_CONTROL);
  };
  const panelsAnswer = async (): Promise<{ workspace: string; catalog: string[] }> => {
    const doc = await commandsPanel(ctx.d);
    const rows = await until('the Aggrega workspace row naming the folder', 30000, () => selectorRows(doc), (r) => r.length >= 2 && r[1].value === path.basename(ctx.folder)).catch(() => selectorRows(doc));
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    const catalog = await until('the Catalog panel answering', 30000, async () => ((await treeRows(ctx.d, 'Catalog')) ?? []).map((r) => r.label), (v) => v.includes(NO_ENTITIES)).catch(async () => ((await treeRows(ctx.d, 'Catalog')) ?? []).map((r) => r.label));
    return { workspace: rows[1]?.value ?? '', catalog };
  };
  await c.run('welcome-page.create-workspace-configuration-anchors-the-folder', {
    expected: `pressing "Create a workspace configuration" on the welcome page's workspace step writes ${CONFIG} into the folder, opens it in a tab and raises a notification opening "${CREATED}" (followed, where the language server that started has read it, by "${IN_EFFECT_SENTENCE}"); the language server starts and the status bar reads "${RUNNING}"; the Aggrega workspace row names the folder and the Catalog panel answers "${NO_ENTITIES}" — all without the window reloading`,
    plant: 'in the scratch copy, out/src/get-started.js with the control writing a configuration that carries no workspace key',
  }, async () => {
    need(!fs.existsSync(config), `${config} is already there`);
    const hello = await ctx.probe.request<{ instance: string }>('hello');
    const mark = (await toasts(ctx.d)).length;
    await pressCreate();
    const told = await endingSince(ctx, 'the control answering', mark, (t) => t.message.startsWith('Aggrega: .aggrega-config.yaml'));
    const running = await waitStatus(ctx.d, RUNNING, 60000).then(() => true, () => false);
    const active = await ctx.probe.request<{ path: string } | null>('editor.active');
    const answered = await panelsAnswer();
    const same = (await ctx.probe.request<{ instance: string }>('hello')).instance === hello.instance;
    created = fs.existsSync(config) ? fs.readFileSync(config) : null;
    const words = told?.message ?? '';
    const sentence = words === CREATED || words === `${CREATED} ${IN_EFFECT_SENTENCE}`;
    return {
      passed: created !== null && sentence && active?.path === config && running && answered.workspace === path.basename(ctx.folder) && answered.catalog.includes(NO_ENTITIES) && same,
      seen: `${told === null ? 'no notification' : `"${words}"`}; ${CONFIG} ${created === null ? 'not written' : `written (${JSON.stringify(created.toString('utf8'))})`}; the tab in front ${active?.path ?? 'none'}; the status bar ${running ? `reads "${RUNNING}"` : 'never read running'}; the Aggrega workspace row "${answered.workspace}", the Catalog panel ${JSON.stringify(answered.catalog)}; the window ${same ? 'was not reloaded' : 'was reloaded'}`,
    };
  });
  // The positive control for the status bar menu's absence: the same reading, in
  // the same window, once the folder is anchored and its language server answers.
  await c.run('palette.status-bar-menu-is-listed-once-a-server-answers', {
    expected: `once the folder is anchored and its language server answers — the status bar reading "${RUNNING}" — the same palette search for "${menuTitle}" lists it, drawn available, within ${MENU_LISTED_MS} ms`,
    plant: 'in the scratch copy\'s package.json, the command\'s enablement condition naming an editor condition the extension never publishes, so it stays unavailable once a server answers',
  }, async () => {
    need(created !== null, 'the control wrote no configuration, so nothing anchors the folder for a language server to answer in');
    const running = await waitStatus(ctx.d, RUNNING, 20000).then(() => true, () => false);
    need(running, `the status bar does not read "${RUNNING}", so no language server answers`);
    const last = await until(`the palette listing "${menuTitle}"`, stated(MENU_LISTED_MS), menuReading, (v) => v.query && v.row !== undefined).catch(() => menuReading());
    return {
      passed: last.query && last.row !== undefined && !last.row.greyed,
      seen: !last.query
        ? 'the palette did not hold the typed title'
        : last.row === undefined
          ? `the palette does not list it; for "${menuTitle}" it offers ${JSON.stringify(last.labels)}`
          : `listed, drawn ${last.row.greyed ? `unavailable (${last.row.classes})` : 'available'}`,
    };
  });
  await c.run('welcome-page.created-configuration-still-anchors-after-a-reopen', {
    expected: `with the editor closed and opened again on the same folder, the folder comes back anchored by the file the control wrote: the language server starts, the status bar reads "${RUNNING}", the Aggrega workspace row names the folder and the Catalog panel answers "${NO_ENTITIES}"`,
    plant: 'in the scratch copy, out/src/get-started.js with the control writing a configuration that carries no workspace key',
  }, async () => {
    need(created !== null, 'the control wrote no configuration, so there is nothing for a reopened window to be anchored by');
    const r = await reopen(ctx);
    need(r.closed.stillAlive.length === 0, `the editor closed with ${r.closed.stillAlive.length} process(es) still alive`);
    const running = await waitStatus(ctx.d, RUNNING, 90000).then(() => true, () => false);
    await documentWith(ctx.d, 'the welcome page the extension opens at start', `!!document.querySelector('.version-entry')`, 30000).catch(() => undefined);
    await run(ctx, 'workbench.view.extension.aggrega');
    const answered = await panelsAnswer();
    return { passed: running && answered.workspace === path.basename(ctx.folder) && answered.catalog.includes(NO_ENTITIES), seen: `opened again in ${r.bringUpMs} ms; the status bar ${running ? `reads "${RUNNING}"` : 'never read running'}; the Aggrega workspace row "${answered.workspace}", the Catalog panel ${JSON.stringify(answered.catalog)}` };
  });
  await c.run('welcome-page.create-workspace-configuration-again-opens-it-unchanged', {
    expected: `pressing the same control once more raises "${ALREADY}", opens ${CONFIG} in a tab, and leaves its bytes as the first press wrote them`,
    plant: 'in the scratch copy, out/src/get-started.js with the control overwriting a configuration that is already there',
  }, async () => {
    need(created !== null, 'the control wrote no configuration, so there is nothing to press it over');
    const mark = (await toasts(ctx.d)).length;
    await pressCreate();
    const told = await endingSince(ctx, 'the control answering', mark, (t) => t.message.startsWith('Aggrega: .aggrega-config.yaml'));
    const active = await until('the configuration opening', 10000, () => ctx.probe.request<{ path: string } | null>('editor.active'), (v) => v !== null && v.path === config).catch(() => null);
    const kept = await holds(1000, async () => fs.readFileSync(config), (b) => created !== null && b.equals(created));
    const now = kept.held ? fs.readFileSync(config) : kept.broke as Buffer;
    return { passed: told?.message === ALREADY && active?.path === config && kept.held && now.equals(created), seen: `${told === null ? 'no notification' : `"${told.message}"`}; the tab in front ${active?.path ?? 'none'}; the file ${now.equals(created) ? 'unchanged' : `now ${JSON.stringify(now.toString('utf8'))}`}` };
  });
}

// authoringReleaseChecks run in an empty folder beneath a workspace root.
export async function authoringReleaseChecks(ctx: SuiteContext, root: string): Promise<void> {
  const c = ctx.checks;
  await continueHere(ctx);
  await ready(ctx);
  const title = paletteTitle(ctx, 'aggrega.workspace.openAuthoringReleaseConfig');
  const rootConfig = path.join(root, CONFIG);
  await c.run('workspace-config.authoring-release-opens-the-roots-configuration', {
    expected: `in ${path.relative(path.dirname(root), ctx.folder)}, whose Aggrega workspace is ${path.basename(root)} above it, "${title}" taken from the palette opens ${rootConfig} in a tab — the root's file, left as it was — writes nothing into the folder opened, and leaves the Aggrega workspace row naming ${path.basename(root)}`,
    plant: 'in the scratch copy, out/src/extension.js with the command opening the configuration of the folder opened rather than of the workspace root',
  }, async () => {
    const before = fs.readFileSync(rootConfig);
    const doc = await commandsPanel(ctx.d);
    const rowsBefore = await until('the Aggrega workspace row naming the root', 20000, () => selectorRows(doc), (r) => r.length >= 2 && r[1].value === path.basename(root)).catch(() => selectorRows(doc));
    const { rows } = await paletteLook(ctx, title);
    need(rows.some((r) => r.label === title), `the palette does not offer "${title}"`);
    await pickQuickInputRow(ctx.d, title);
    const active = await until('a configuration opening', 15000, () => ctx.probe.request<{ path: string } | null>('editor.active'), (v) => v !== null && v.path.endsWith(CONFIG)).catch(() => null);
    // Nothing written beneath and the root's file left as it was, at every reading
    // over a stated window from the opening.
    const untouched = await holds(1500, async () => ({ beneath: readTree(ctx.folder).size, kept: fs.readFileSync(rootConfig).equals(before) }), (v) => v.beneath === 0 && v.kept);
    const beneath = readTree(ctx.folder);
    const rowsAfter = await selectorRows(await commandsPanel(ctx.d));
    const kept = untouched.held && fs.readFileSync(rootConfig).equals(before);
    await closeAllEditors(ctx);
    return {
      passed: rowsBefore[1]?.value === path.basename(root) && active?.path === rootConfig && beneath.size === 0 && rowsAfter[1]?.value === path.basename(root) && kept,
      seen: `the Aggrega workspace row read "${rowsBefore[1]?.value ?? ''}" before and "${rowsAfter[1]?.value ?? ''}" after; the tab opened ${active?.path ?? 'none'}; the folder opened holds ${JSON.stringify([...beneath.keys()])}; the root's file ${kept ? 'unchanged' : 'changed'}`,
    };
  });
}
