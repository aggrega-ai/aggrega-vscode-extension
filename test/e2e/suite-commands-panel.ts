// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { exitRefusal } from '../../src/cli-run';
import { RESTART_COMMAND } from '../../src/daemon-status';
import { IMPORT_SOURCE_TITLE } from '../../src/import-request';
import {
  CACHE_OPERATIONS, commandIdFor, commandsPanelOperations, DEFAULT_OPERATIONS_LAYOUT, DEPRECATION_SEVERITIES, ListPanelId, OPERATION_GROUPS, PANEL_ACTIONS, PanelActionDef, PanelActionId,
  panelActionLabel,
} from '../../src/operation-groups';
import { EXTENSION_ID, extensionSettingsQuery, SETTINGS_COMMAND } from '../../src/settings';
import { Judgement, need } from './checks';
import { runCompiler } from './cli';
import {
  ABSENCE_MS, ACTIVE_CONTROL, activeControl, chooseLayout, COMMANDS_PANEL_GROUPS, COMMANDS_PANEL_LABELS, containerManifest, containerViews, drawnActions, drawnPanel, DrawnPanel, focusInPanel,
  iconOfCommand, LAYOUT_SETTING, LayoutChoice, lines, LIST_PANEL_TITLES, MENU_CONTROLS, MENU_STATUS_OBSERVER, menuReadings, menuWords, openEverySection, openMenu, ops, paneTitleActions, PANEL_ORDER,
  panelViewCentre, panesOf, pressHead, restoring, rgb, sameColour, seen, waitMenuClosed, waitMenuOpen, workbenchGround,
} from './commands-panel';
import { WebviewDocument } from './drivers';
import { fixturesDir } from './fixtures';
import { chooser, LevelRow, levelRows, waitChooser } from './levels';
import { dragSash } from './suite-above';
import { capture, closeAllEditors, commandTitle, IMPORT_COMMAND, languageServers, open, ready, run, send, SuiteContext, theServer } from './suite-context';
import { paletteTitle } from './suite-first-day';
import {
  codeIn, contextRowsCheck, declaredDescription, declaredMarkdown, drawnFromMarkdown, openSettingsOn, SETTING_LINK, SettingItem, settingLabel, settingsScreen, settingValue,
} from './suite-gateway';
import { BINARY_PATH_SEARCH, notExecutableAt, OPEN_BINARY_PATH_SETTING, setBinaryPath, START_FAILED_OPENING } from './suite-killed';
import { ADD_REGISTRY_TITLE } from './suite-registry';
import { DRAFT_PLACEHOLDER, SEARCH_TITLE } from './suite-storefront';
import { THEMES, writeColourTheme } from './suite-welcome-mixed';
import { pageNow, stepOf, WAYS_THROUGH, wayThroughCommand, WELCOME_OPEN_COMMAND, welcomePage } from './welcome';
import {
  commandsPanel, dialog, guard, holds, NOT_RUNNING, panelText, pickQuickInputRow, pressIn, pressOperation, pressPanelAction, pressToastButton, quickInput, RUNNING, STARTING, statusLog, statusNow, Toast, toasts,
  toastsSince, treeRows, until, waitQuickInput, waitStatus, waitToast,
} from './workbench';

// The checks run in the gateway folder, on the Commands panel and the panels
// beside it: the order the container's panels read in and what their title bars
// hold; the panel's two shapes, the groups and labels each draws, and what is
// drawn between groups at every width; the icons and the keyboard; every entry
// pressed; the theme; where the panel's own preferences are kept; and, with the
// language server stopped, which entries stay enabled.

export const COMMANDS_PANEL_CHECKS = [
  'commands-panel.context-rows-name-the-opened-folder',
  'side-bar.panels-in-order-each-list-title-bar-holding-draft-and-its-refresh',
  'commands-panel.title-bar-draws-the-house-and-the-cog-at-rest',
  'commands-panel.cog-opens-the-editors-settings-narrowed-to-this-extension',
  'commands-panel.default-shape-is-one-flow-with-no-group-titles',
  'commands-panel.groups-in-order-labels-named-and-explained-on-the-hover',
  'commands-panel.offers-no-seeding-entry-the-welcome-page-carries',
  'commands-panel.icons-drawn-from-the-font-the-extension-ships',
  'commands-panel.flow-wraps-at-every-width-cutting-nothing-short',
  'commands-panel.nothing-drawn-between-groups-at-any-width',
  'commands-panel.height-at-the-default-width',
  'commands-panel.tab-reaches-each-row-control-then-the-operations-once',
  'commands-panel.every-entry-runs-or-asks-and-none-fails-on-its-arguments',
  'commands-panel.asking-entries-ask-for-their-subject-and-backing-out-runs-nothing',
  'commands-panel.reading-entries-start-no-compiler-process',
  'commands-panel.sections-shape-keeps-the-groups-and-restarts-nothing',
  'settings.layout-values-carry-their-descriptions',
  'settings.layout-value-descriptions-read-apart',
  'commands-panel.sections-carry-group-titles-and-a-rule-above-publish',
  'commands-panel.one-button-group-and-the-palettes-longer-titles',
  'commands-panel.caret-row-reads-build-options-in-the-section-shape',
  'commands-panel.section-chevrons-turn-as-they-open',
  'commands-panel.keyboard-in-sections-opens-and-closes-with-the-arrows',
  'commands-panel.closing-a-section-hands-its-tab-stop-to-its-heading',
  'commands-panel.context-rows-stay-with-every-section-closed',
  'commands-panel.follows-the-theme-and-borders-every-control-in-high-contrast',
  'settings.preference-is-the-users-and-a-workspace-value-is-ignored',
  'settings.binary-path-description-names-the-two-files',
  'settings.binary-path-description-read-by-someone-new',
  'settings.binary-path-description-draws-its-code-as-code',
  'settings.restart-grace-names-the-binary-path-as-the-settings-screen-does',
  'commands-panel.server-only-operations-stay-enabled-with-the-server-stopped',
  'commands-panel.enabled-but-inert-with-the-server-stopped',
] as const;

const BINARY_PATH = 'aggrega.server.binaryPath';
// The setting holding how long a change to the binary path waits before the
// language server is restarted, whose description names the binary path.
const RESTART_GRACE = 'aggrega.server.restartGraceSeconds';

// The words and the icons a reader is to meet, held as written because they are
// what a reader is told to expect rather than a rule some declaration states: the
// icons the three rows draw, in the order drawn — an open folder, a root folder and
// a rocket — and the sentence Validate answers with when there is no language
// server to ask.
const ROW_ICONS = ['codicon-folder-opened', 'codicon-root-folder', 'codicon-rocket'];
const VALIDATE_WITH_NO_SERVER = 'Aggrega: the language server is not running.';
// The buttons that warning carries, in the order drawn: the output, the setting
// naming the compiler, and the start the status bar offers for a stopped server.
const WARNING_BUTTONS = ['Show output', 'Open binary path setting', 'Start'];

// The name the control beside Build draws in the section shape, held as written
// for the same reason.
const CARET_NAME = 'Build options';

// The prompts Sign and Deprecate open with, held as written for the same reason.
const SIGN_PROMPT = 'Reference of the already-published artifact to sign';
const DEPRECATE_PROMPT = 'Reference of the already-published artifact to deprecate';

// The question each row at the head of a list panel asks in the editor's own
// input, by the title or the placeholder it is drawn with — null for the one row
// that runs at once and asks nothing — held as written for the same reason, each
// beside the row it belongs to by the product's own id for that row, so a press is
// answered only by its own question and never by one a row before it left open.
// The words the suite already holds for the storefront and registry checks are
// taken from there.
export const HEAD_ROW_QUESTIONS: Readonly<Record<PanelActionId, string | null>> = {
  registryAdd: ADD_REGISTRY_TITLE,
  registryIndex: null,
  catalogSearch: SEARCH_TITLE,
  scaffold: DRAFT_PLACEHOLDER,
  pluginAdd: 'Aggrega: add a plugin',
  pluginEntities: 'Aggrega: generate Plugin entities',
};

// The entries a reader is told stay enabled with the server stopped: these buttons
// on the Commands panel, and one row at the head of the Catalog panel. They are
// held as written rather than read from the product's own table of what each
// operation needs, for the reason the panel's groups are (commands-panel.ts): that
// table is the rule which entries are greyed follow, and the check is of what a
// reader is promised.
const ENABLED_WITH_THE_SERVER_STOPPED = ['Validate', 'Inspect', 'Show config', 'Cache…'];
const DRAFT_ENTITY = panelActionLabel('scaffold');

// How long the editor is watched after backing out of a question for anything
// it runs. Longer than an absence, because what an entry runs can take seconds to
// say anything — a cache listing answers only once the language server has read
// the caches — and the check's control is read over the same window, so a window
// too short to see a run shows as its control not firing.
const QUIET_MS = 4000;

// The side bar's widths the sweep visits, as drags of its sash from where it
// stands: narrower twice, wider twice, then back where it started.
const SWEEP_PX = [-70, -60, 260, 240, -370];

// USAGE is how a command line answers an invocation it cannot read — a usage line
// and its flags, or the list of its commands; BARE_EXIT is the extension's own
// wording for a run that ended with a status and said nothing, built from the
// function that words it.
const USAGE = /\bUsage:|^Flags:\s*$|^Available Commands:\s*$/m;
const BARE_EXIT = new RegExp(`^${exitRefusal({ code: 7, stderr: '' }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('7', '\\d+')}$`, 'm');

function failsOnItsArguments(text: string): string[] {
  return [USAGE.test(text) ? 'a usage message' : '', BARE_EXIT.test(text) ? 'a bare exit status' : ''].filter((x) => x !== '');
}

// ---- readings these checks share ------------------------------------------------------

// TabStop is where one press of Tab left the focus inside the panel.
interface TabStop { control: string; operation: boolean }

const TAB_STOP = `(() => {
  const e = document.activeElement;
  if (!document.hasFocus() || !e || e === document.body) { return null; }
  const op = !!e.closest('button.op, button.op-caret, .section-head');
  return { control: (${ACTIVE_CONTROL} || e.className || e.tagName) + '', operation: op };
})()`;

// TabWalk is a walk of the panel by Tab: whether Shift+Tab from its first control
// leaves it — nothing in the panel comes before that control — and every stop from
// that control until Tab leaves the panel.
interface TabWalk { firstIsFirst: boolean; stops: TabStop[] }

// FIRST_CONTROL is the first control a reader meets in the panel: the Project
// folder row's.
const FIRST_CONTROL = '.selector-row button.selector';

// tabWalk starts on the panel's first control, and presses Tab until the focus
// leaves the panel's document, recording where each press left it.
async function tabWalk(ctx: SuiteContext, panel: WebviewDocument): Promise<TabWalk> {
  await focusInPanel(ctx, panel, FIRST_CONTROL);
  await ctx.d.press('Shift+Tab');
  const firstIsFirst = (await panel.evaluate<TabStop | null>(TAB_STOP)) === null;
  await focusInPanel(ctx, panel, FIRST_CONTROL);
  const first = await panel.evaluate<TabStop | null>(TAB_STOP);
  const stops: TabStop[] = first === null ? [] : [first];
  for (let i = 0; i < 16; i++) {
    await ctx.d.press('Tab');
    const at = await panel.evaluate<TabStop | null>(TAB_STOP);
    if (at === null) { break; }
    stops.push(at);
  }
  return { firstIsFirst, stops };
}

// rowStops is how many stops the three rows are owed: each row's choosing control,
// and each control drawn beside it.
function rowStops(rows: readonly LevelRow[]): number {
  return rows.slice(0, 3).reduce((n, r) => n + 1 + (r.create === null ? 0 : 1) + (r.offer === null ? 0 : 1), 0);
}

// SweepReading is the panel as drawn at one width of the sweep: the drawing once it
// came to rest there, and every reading taken over the absence window after it,
// each with the three rows.
interface SweepReading { width: number; panel: DrawnPanel; rows: LevelRow[]; window: { panel: DrawnPanel; rows: LevelRow[] }[] }

// sameDrawing says two readings draw the panel at one width with every control
// where it was.
function sameDrawing(a: DrawnPanel, b: DrawnPanel): boolean {
  return a.view.width === b.view.width && a.controls.length === b.controls.length
    && a.controls.every((c, i) => { const d = b.controls[i]; return d.command === c.command && Math.abs(d.box.x - c.box.x) <= 0.5 && Math.abs(d.box.y - c.box.y) <= 0.5 && Math.abs(d.box.width - c.box.width) <= 0.5; });
}

// opsDef is the product's own description of the operation a drawn control runs.
function opsDef(command: string): { label: string; detail: string; icon: string; id: string } | undefined {
  return commandsPanelOperations().find((o) => commandIdFor(o) === command);
}

// headingOf is the product's heading for a group id.
function headingOf(group: string): string {
  return OPERATION_GROUPS.find((g) => g.id === group)?.heading ?? '';
}

// Answer is what an entry answered a press with.
interface Answer { kind: 'asked' | 'menu' | 'dialog' | 'ended' | 'drawn'; what: string }

// answerTo watches, after a press, for the first thing the entry answers with: a
// question in the editor's own input, a menu beside its button, a dialog, an
// ending in a notification that carries no Cancel — progress carries one — or a
// panel of its own drawn.
async function answerTo(ctx: SuiteContext, panel: WebviewDocument, toastMark: number, framesBefore: number, boundMs: number): Promise<Answer> {
  return until('the entry answering', boundMs, async (): Promise<Answer | null> => {
    const q = await quickInput(ctx.d);
    if (q !== null) { return { kind: 'asked', what: q.title || q.placeholder || q.value || `${q.rows.length} rows` }; }
    const m = await openMenu(panel);
    if (m.open) { return { kind: 'menu', what: m.label }; }
    const d = await dialog(ctx.d);
    if (d !== null) { return { kind: 'dialog', what: d.message }; }
    const ended = (await toastsSince(ctx.d, toastMark)).find((t) => !t.buttons.includes('Cancel'));
    if (ended !== undefined) { return { kind: 'ended', what: `${ended.message.slice(0, 140)} (${ended.severity})` }; }
    if ((await ctx.d.webviews()).length > framesBefore) { return { kind: 'drawn', what: 'a panel of its own' }; }
    return null;
  }, (v) => v !== null) as Promise<Answer>;
}

// backOut puts away whatever an entry asked with, as a person does with Escape,
// and answers null once nothing is left asking, or the sentence saying what was
// left — a question left open would answer the next press in its place.
async function backOut(ctx: SuiteContext, panel: WebviewDocument): Promise<string | null> {
  await ctx.d.press('Escape');
  return until('the question put away', 5000, async () => ({ q: await quickInput(ctx.d), m: await openMenu(panel), d: await dialog(ctx.d) }), (v) => v.q === null && !v.m.open && v.d === null)
    .then(() => null, (err: unknown) => `Escape left its question open (${err instanceof Error ? err.message : String(err)})`);
}

// putAway closes the editor's own input with Escape, and answers null once it is
// closed or the sentence saying it was not.
async function putAway(ctx: SuiteContext): Promise<string | null> {
  await ctx.d.press('Escape');
  return until('the editor\'s input closing', 5000, () => chooser(ctx.d), (c) => c === null)
    .then(() => null, (err: unknown) => `Escape left the editor's input open (${err instanceof Error ? err.message : String(err)})`);
}

// headRows are the rows at the head of each list panel, by the product's own id
// for the panel and for each row, each with the title of the pane it heads.
function headRows(): { title: string; actions: readonly PanelActionDef[] }[] {
  return (Object.keys(PANEL_ACTIONS) as ListPanelId[]).map((id) => ({ title: LIST_PANEL_TITLES[id], actions: PANEL_ACTIONS[id] }));
}

// CompilerRuns watches, from before an action, the compiler being run as a command
// by anything in the editor's process tree: every process recorded from then on
// whose command line is the binary under test with anything but `serve`.
export class CompilerRuns {
  private readonly known: Set<string>;
  private readonly timer: NodeJS.Timeout;
  readonly seen: string[] = [];

  constructor(private readonly ctx: SuiteContext) {
    ctx.s.table.snapshot();
    this.known = new Set(ctx.s.table.all().map((r) => `${r.pid}:${r.start}`));
    this.timer = setInterval(() => { this.read(); }, 50);
  }

  read(): string[] {
    this.ctx.s.table.snapshot();
    const bin = this.ctx.inputs.compiler.path;
    for (const r of this.ctx.s.table.all()) {
      const k = `${r.pid}:${r.start}`;
      if (this.known.has(k)) { continue; }
      this.known.add(k);
      if (r.cmd.startsWith(`${bin} `) && !r.cmd.startsWith(`${bin} serve`)) { this.seen.push(r.cmd); }
    }
    return this.seen;
  }

  stop(): string[] {
    clearInterval(this.timer);
    return this.read();
  }
}

// fixtureDocuments are the entity documents the folder was copied from, by their
// paths beneath it: what the workspace holds before anything is built in it.
function fixtureDocuments(ctx: SuiteContext): string[] {
  const from = path.join(fixturesDir(ctx.inputs.extension.dir), path.basename(ctx.folder));
  return fs.readdirSync(from, { recursive: true }).map(String).filter((f) => /\.ya?ml$/.test(f) && path.basename(f) !== '.aggrega-config.yaml').sort();
}

const LAYOUT_DESCRIPTIONS_APART = Judgement.declare('settings.layout-value-descriptions-read-apart', {
  expected: 'each value of the shape setting has a description saying what you will see, and neither leaves you guessing which is which',
  plant: 'none: whether the two descriptions read apart is a judgement of the wording',
  question: 'The capture shows the shape setting\'s drop-down open on the settings screen, and the text below gives each value with the description drawn beside it. Does each say what you will see, so that you can tell which is which?',
});

const ONE_BUTTON_GROUP = Judgement.declare('commands-panel.one-button-group-and-the-palettes-longer-titles', {
  expected: 'a group holding a single button reads as a group, and the command palette\'s longer titles beside the panel\'s short labels do not confuse',
  plant: 'none: both are judgements of the reading',
  question: 'The capture shows the panel in its section shape. Does a group holding one button (listed below) read oddly? And the palette keeps longer titles than the panel\'s labels (listed below) — do any of them confuse you?',
});

const BINARY_PATH_READ = Judgement.declare('settings.binary-path-description-read-by-someone-new', {
  expected: 'the description draws the line: this is an editor preference, and Aggrega\'s own configuration is two files — the project\'s and the global file — which a reader can name from it alone',
  plant: 'none: whether it draws the line is a judgement of the wording',
  question: 'The capture shows the binary path\'s entry on the settings screen, and its description is below. From it alone, can you tell that this is an editor preference and not Aggrega\'s own configuration, and name both of Aggrega\'s files?',
});

const ENABLED_BUT_INERT = Judgement.declare('commands-panel.enabled-but-inert-with-the-server-stopped', {
  expected: 'whether the enabled-but-inert buttons bother a reader with the server stopped is recorded as observed rather than as a failure',
  plant: 'none: whether they bother a reader is the judgement asked for',
  question: 'With the language server stopped, the buttons listed below stay enabled and report that the server is not running when pressed; the status bar is where the state is named. Do the enabled-but-inert buttons bother you?',
});

// commandsPanelChecks runs the checks with `release` the folder's own Release, as
// the scenario's plan names it.
export async function commandsPanelChecks(ctx: SuiteContext, notABinary: string, release: string): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  const manifest = containerManifest(ctx);
  await ready(ctx);
  let panel = await commandsPanel(ctx.d);

  // ---- the folder ----
  await contextRowsCheck(ctx);

  // ---- the container's panels, and their title bars ----
  const views = containerViews(ctx);
  const listViews = views.filter((v) => v.name !== PANEL_ORDER[0]);
  const draft = commandTitle(ctx.manifest, 'aggrega.op.draft');
  await c.run('side-bar.panels-in-order-each-list-title-bar-holding-draft-and-its-refresh', {
    expected: `the container's panels read, top to bottom, ${PANEL_ORDER.join(' · ')}; and each list panel's title bar, drawn once its header is pointed at, holds exactly two actions, in this order, the "${draft}" button and its own refresh (${listViews.map((v) => `"${commandTitle(ctx.manifest, `${v.id}.refresh`)}"`).join(', ')}), watched for ${ABSENCE_MS} ms each — no operation among them`,
    plant: 'in the scratch copy\'s package.json, the published-catalog search added to the Catalog panel\'s title bar',
  }, async () => {
    const at = await panesOf(ctx);
    const order = at.titles.map((t) => t.toLowerCase());
    const bars: string[] = [];
    let only = true;
    for (const v of listViews) {
      const want = [draft, commandTitle(ctx.manifest, `${v.id}.refresh`)];
      const exact = (a: string[]): boolean => JSON.stringify(a) === JSON.stringify(want);
      const first = await until(`the ${v.name} panel's header`, 10000, () => paneTitleActions(ctx, v.name), (t) => t !== null);
      if (first === null) { throw new Error(`unreachable: the ${v.name} panel's header`); }
      await ctx.d.moveTo({ x: first.header.x + 40, y: first.header.y + first.header.height / 2 });
      const drawn = await until(`the ${v.name} panel's title bar drawn under the pointer`, 5000, async () => drawnActions(await paneTitleActions(ctx, v.name)), (a) => a.length > 0).catch(() => [] as string[]);
      const kept = await holds(ABSENCE_MS, async () => drawnActions(await paneTitleActions(ctx, v.name)), exact, 150);
      only = only && kept.held && exact(drawn);
      bars.push(`${v.name}: ${JSON.stringify(kept.held ? drawn : kept.broke)}`);
    }
    await ctx.d.moveTo({ x: 1, y: 1 });
    const inOrder = JSON.stringify(order) === JSON.stringify(PANEL_ORDER.map((p) => p.toLowerCase()));
    return { passed: inOrder && only, seen: `the panels read ${JSON.stringify(at.titles)} in ${at.part}; title bars under the pointer: ${bars.join('; ')}` };
  });

  // ---- the house and the cog ----
  const house = commandTitle(ctx.manifest, 'aggrega.getStarted.open');
  const cog = commandTitle(ctx.manifest, SETTINGS_COMMAND);
  const wantIcons: Record<string, string> = { [draft]: iconOfCommand(ctx, 'aggrega.op.draft'), [house]: iconOfCommand(ctx, 'aggrega.getStarted.open'), [cog]: iconOfCommand(ctx, SETTINGS_COMMAND) };
  const wantBar = [draft, cog, house];
  await c.run('commands-panel.title-bar-draws-the-house-and-the-cog-at-rest', {
    expected: `with the pointer away from the side bar, the Commands panel's title bar draws exactly three actions, in this order, ${wantBar.map((l) => `"${l}" (${wantIcons[l]})`).join(', ')}, each with a width, over ${ABSENCE_MS} ms; while the same reading of the ${listViews[0]?.name ?? 'first list'} panel's title bar draws nothing at rest and draws the "${draft}" button and its refresh once its header is pointed at`,
    plant: 'in the scratch copy\'s package.json, the cog taken off the Commands panel\'s title bar',
  }, async () => {
    await ctx.d.moveTo({ x: 1, y: 1 });
    const read = async (): Promise<{ label: string; icon: string; width: number }[]> => ((await paneTitleActions(ctx, PANEL_ORDER[0]))?.actions ?? []).map((a) => ({ label: a.label, icon: a.icon, width: a.box.width }));
    const first = await until('the Commands panel\'s title bar', 10000, read, (a) => a.length > 0);
    const ok = (a: { label: string; icon: string; width: number }[]): boolean => a.length === wantBar.length && wantBar.every((l, i) => a[i].label === l && a[i].icon === wantIcons[l] && a[i].width > 0);
    const kept = await holds(ABSENCE_MS, read, ok, 150);
    // The control: a tree panel's bar, read the same way, at rest and pointed at.
    const list = listViews[0];
    const rest = drawnActions(await paneTitleActions(ctx, list.name));
    const header = await paneTitleActions(ctx, list.name);
    if (header !== null) { await ctx.d.moveTo({ x: header.header.x + 40, y: header.header.y + header.header.height / 2 }); }
    const pointed = await until(`the ${list.name} panel's bar under the pointer`, 5000, async () => drawnActions(await paneTitleActions(ctx, list.name)), (a) => a.length > 0).catch(() => [] as string[]);
    await ctx.d.moveTo({ x: 1, y: 1 });
    need(rest.length === 0 && pointed.length > 0, `its control did not show the reading tells at rest from pointed at: the ${list.name} panel's bar drew ${JSON.stringify(rest)} at rest and ${JSON.stringify(pointed)} pointed at`);
    return { passed: kept.held && ok(first), seen: `the Commands panel's bar at rest: ${JSON.stringify(first)}${kept.held ? `, the same for ${ABSENCE_MS} ms` : `; at ${kept.atMs} ms ${JSON.stringify(kept.broke)}`}; the ${list.name} panel's bar at rest ${JSON.stringify(rest)}, pointed at ${JSON.stringify(pointed)}` };
  });

  const declared = Object.keys(manifest.contributes.configuration.properties);
  const query = extensionSettingsQuery(EXTENSION_ID);
  await c.run('commands-panel.cog-opens-the-editors-settings-narrowed-to-this-extension', {
    expected: `pressing "${cog}" opens the editor's own settings screen with its search reading "${query}" — the manifest's publisher and name being "${manifest.publisher}.${manifest.name}" — and counting the ${declared.length} settings the manifest declares, every one it draws being one of them`,
    plant: 'in the scratch copy, out/src/settings.js with the filter the cog opens the settings with left empty',
  }, async () => {
    await closeAllEditors(ctx);
    await ctx.d.moveTo({ x: 1, y: 1 });
    await pressIn(ctx.d, null, `#workbench\\.parts\\.sidebar .pane-header .action-label[aria-label="${cog}"]`);
    const s = await settingsScreen(ctx);
    await closeAllEditors(ctx);
    const counted = Number(/(\d+)/.exec(s?.count ?? '')?.[1] ?? NaN);
    const strangers = (s?.keys ?? []).filter((k) => !declared.includes(k));
    const passed = s !== null && s.search === query && EXTENSION_ID === `${manifest.publisher}.${manifest.name}` && counted === declared.length && strangers.length === 0 && s.keys.length > 0;
    return { passed, seen: s === null ? 'no settings screen was drawn' : `the search reads "${s.search}", the count "${s.count}"; drawn ${JSON.stringify(s.keys)}${strangers.length > 0 ? `, of which not this extension's: ${JSON.stringify(strangers)}` : ''}` };
  });

  // ---- the default shape ----
  const allOps = commandsPanelOperations();
  await c.run('commands-panel.default-shape-is-one-flow-with-no-group-titles', {
    expected: `on a profile where ${LAYOUT_SETTING} carries no value in any scope, its declared default being "${DEFAULT_OPERATIONS_LAYOUT}", the panel draws one flow holding all ${allOps.length} operations over more than one line and fewer lines than operations, and no group title, watched for ${ABSENCE_MS} ms; the same reading finds the titles once the shape is changed below`,
    plant: 'in the scratch copy\'s package.json, the shape setting declared with the other shape as its default',
  }, async () => {
    const inspected = await ctx.probe.request<{ inspect: Record<string, unknown> | null }>('configuration.inspect', { key: LAYOUT_SETTING });
    const written = Object.entries(inspected.inspect ?? {}).filter(([k, v]) => k !== 'key' && k !== 'defaultValue' && v !== undefined && v !== null);
    need(written.length === 0, `the profile already carries a value for ${LAYOUT_SETTING} (${JSON.stringify(written)}), so the default is not what it draws`);
    const declaredDefault = manifest.contributes.configuration.properties[LAYOUT_SETTING]?.default;
    const first = await drawnPanel(panel);
    const kept = await holds(ABSENCE_MS, () => drawnPanel(panel), (p) => p.shape === 'buttons' && p.heads.length === 0, 250);
    const n = ops(first).length;
    const ls = lines(first).length;
    return {
      passed: declaredDefault === DEFAULT_OPERATIONS_LAYOUT && first.shape === 'buttons' && kept.held && n === allOps.length && ls > 1 && ls < n,
      seen: `declared default "${String(declaredDefault)}"; drawn as ${first.shape}, ${n} operations on ${ls} lines, ${first.heads.length} group titles${kept.held ? `, the same for ${ABSENCE_MS} ms` : `; at ${kept.atMs} ms drawn as ${kept.broke?.shape} with ${kept.broke?.heads.length} titles`}`,
    };
  });

  await c.run('commands-panel.groups-in-order-labels-named-and-explained-on-the-hover', {
    expected: `the buttons read ${COMMANDS_PANEL_LABELS.join(' · ')}, grouped ${COMMANDS_PANEL_GROUPS.map((g) => `${g.heading} (${g.labels.join(' · ')})`).join(' · ')}, Show config first in its group and Cache… the one label carrying a trailing ellipsis; each label is the operation's name alone, and its hover the explanation the product declares for it`,
    plant: 'in the scratch copy, out/src/operation-groups.js with Show config\'s label carrying an ellipsis and an explanation of its own',
  }, async () => {
    const drawn = ops(await drawnPanel(panel));
    const labels = drawn.map((o) => o.label);
    const groupsOk = COMMANDS_PANEL_GROUPS.every((g) => {
      const members = drawn.filter((o) => g.labels.includes(o.label));
      return members.length === g.labels.length && new Set(members.map((o) => o.group)).size === 1 && headingOf(members[0]?.group ?? '') === g.heading;
    });
    const runs = drawn.map((o) => o.group).filter((x, i, a) => i === 0 || a[i - 1] !== x);
    const ellipses = labels.filter((l) => l.endsWith('…'));
    const hovers = drawn.filter((o) => o.title !== (opsDef(o.command)?.detail ?? '')).map((o) => `${o.label}: "${o.title}"`);
    const want = COMMANDS_PANEL_LABELS.filter((l) => l.endsWith('…'));
    return {
      passed: JSON.stringify(labels) === JSON.stringify(COMMANDS_PANEL_LABELS) && groupsOk && runs.length === COMMANDS_PANEL_GROUPS.length && JSON.stringify(ellipses) === JSON.stringify(want) && hovers.length === 0,
      seen: `the buttons read ${JSON.stringify(labels)}; their groups run ${JSON.stringify(runs.map(headingOf))}; labels ending in an ellipsis ${JSON.stringify(ellipses)}; hovers other than declared ${hovers.length === 0 ? 'none' : JSON.stringify(hovers)}`,
    };
  });

  await c.run('commands-panel.offers-no-seeding-entry-the-welcome-page-carries', {
    expected: `no operation on the Commands panel runs the command the welcome page's "${WAYS_THROUGH.workspace[0]}" runs, and no operation's label is that one's or names seeding or "config init", watched for ${ABSENCE_MS} ms; the same reading of the welcome page's steps finds that control there, by its command and by its label`,
    plant: 'in the scratch copy, out/src/operation-groups.js with the Configuration group\'s Show config made to run the welcome page\'s seeding',
  }, async () => {
    await run(ctx, WELCOME_OPEN_COMMAND);
    const label = WAYS_THROUGH.workspace[0];
    const seeding = await wayThroughCommand(ctx, 'workspace', label);
    // One reading of a region of a document: the controls inside it running the
    // seeding, and the labels inside it that are the seeding control's own or name
    // seeding.
    const count = (doc: WebviewDocument, region: string): Promise<{ running: number; labels: string[] }> => doc.evaluate(`((c, region, label) => {
      const r = document.querySelector(region);
      const inside = r ? [...r.querySelectorAll('[data-command]')] : [];
      return {
        running: inside.filter((e) => e.dataset.command === c && e.getBoundingClientRect().width > 0).length,
        labels: (r ? [...r.querySelectorAll('button')] : []).map((b) => (b.innerText || '').trim()).filter((t) => t === label || /config init|seed/i.test(t)),
      };
    })(${JSON.stringify(seeding)}, ${JSON.stringify(region)}, ${JSON.stringify(label)})`);
    const kept = await holds(ABSENCE_MS, () => count(panel, '.groups'), (v) => v.running === 0 && v.labels.length === 0);
    const onPage = await count(await welcomePage(ctx), '#steps');
    await closeAllEditors(ctx);
    need(onPage.running > 0 && onPage.labels.includes(label), `its positive control did not fire: the welcome page's steps draw ${onPage.running} control(s) running ${seeding} and the labels ${JSON.stringify(onPage.labels)}, so the reading is not shown to find that control by both`);
    return { passed: kept.held, seen: `${seeding}: among the Commands panel's operations ${kept.held ? `no control, and no seeding label, for ${ABSENCE_MS} ms` : JSON.stringify(kept.broke)}; among the welcome page's steps ${onPage.running} control(s), labelled ${JSON.stringify(onPage.labels)}` };
  });

  // ---- the icons ----
  await c.run('commands-panel.icons-drawn-from-the-font-the-extension-ships', {
    expected: `the panel's icon font is loaded; every operation's button draws the icon the product declares for it and the caret beside Build its chevron, each a glyph of that font; and the three rows draw ${ROW_ICONS.join(', ')}, each control beside them its own icon, all glyphs of that font`,
    plant: 'in the scratch copy, out/src/operation-groups.js with Import\'s icon named as one the shipped font carries no rule for',
  }, async () => {
    const p = await drawnPanel(panel);
    const wrongOps = p.controls.filter((o) => o.kind === 'op' && (o.icon !== `codicon-${opsDef(o.command)?.icon ?? ''}` || !o.glyph)).map((o) => `${o.label}: ${o.icon}${o.glyph ? '' : ' (no glyph)'}`);
    const carets = p.controls.filter((o) => o.kind === 'caret');
    const rowIcons = p.rows.slice(0, 3).map((r) => r.icons.find((i) => i.control === 'choosing')?.icon ?? '');
    const blank = p.rows.flatMap((r) => r.icons.filter((i) => !i.glyph).map((i) => `${i.control} ${i.icon}`));
    const passed = p.iconFont.loaded && wrongOps.length === 0 && carets.length > 0 && carets.every((k) => k.glyph) && JSON.stringify(rowIcons) === JSON.stringify(ROW_ICONS) && blank.length === 0;
    return { passed, seen: `font ${JSON.stringify(p.iconFont.faces)}; operations off their declared icon or drawing none: ${wrongOps.length === 0 ? 'none' : JSON.stringify(wrongOps)}; carets ${JSON.stringify(carets.map((k) => `${k.icon}${k.glyph ? '' : ' (no glyph)'}`))}; the rows ${JSON.stringify(p.rows.map((r) => r.icons.map((i) => `${i.control}:${i.icon}${i.glyph ? '' : ' (no glyph)'}`)))}` };
  });

  // ---- widths ----
  const sweep: SweepReading[] = [];
  await c.run('commands-panel.flow-wraps-at-every-width-cutting-nothing-short', {
    expected: `with the side bar dragged ${SWEEP_PX.map((x) => `${x > 0 ? '+' : ''}${x}`).join(', ')} px in turn, at every width — at every reading over ${ABSENCE_MS} ms once the drawing has come to rest there — no button's label is cut short, no button is drawn past the panel's edge and the panel does not scroll sideways; the flow takes more lines the narrower it is and fewer again when it is widened; and each of the three rows stays one line as tall as it started, cut short with an ellipsis where it does not fit, its create control as far from the row's right edge as it started, and the folder's full path on the Project folder and Aggrega workspace rows' hovers; the three values start in line at every width; and a row's label is drawn whole, or cut short with an ellipsis only once the value beside it has no room left, with the row's hover naming its level`,
    plant: 'in the scratch copy, media/operations.css with the rows\' labels forbidden to give way',
  }, async () => {
    const take = async (): Promise<SweepReading> => {
      let last: DrawnPanel | null = null;
      const rest = await until('the panel coming to rest at its width', 5000, async () => {
        const p = await drawnPanel(panel);
        const still = last !== null && sameDrawing(last, p);
        last = p;
        return { p, still };
      }, (r) => r.still);
      const rows = await levelRows(panel);
      // Every reading over the window is kept, and each is judged below.
      const window: { panel: DrawnPanel; rows: LevelRow[] }[] = [];
      await holds(ABSENCE_MS, async () => { window.push({ panel: await drawnPanel(panel), rows: await levelRows(panel) }); }, () => true);
      return { width: rest.p.view.width, panel: rest.p, rows, window };
    };
    sweep.push(await take());
    for (const dx of SWEEP_PX) {
      const before = sweep[sweep.length - 1].width;
      await dragSash(ctx, dx);
      await until(`the panel's width moving from ${before} px`, 5000, async () => (await drawnPanel(panel)).view.width, (w) => Math.abs(w - before) > 5);
      sweep.push(await take());
    }
    const start = sweep[0];
    const faults = new Set<string>();
    // Each row's level as its hover names it: in the long form, whatever the row draws
    // as its label, held as written.
    const levelNames = ['Project folder', 'Aggrega workspace', 'Release'];
    // Where a label gave way, for the report: the narrowest widths are where one
    // is owed to.
    const labelsCut = new Set<string>();
    const rightGap = (r: LevelRow): number | null => (r.create === null ? null : (r.row.x + r.row.width) - (r.create.box.x + r.create.box.width));
    for (const s of sweep) {
      for (const w of [{ panel: s.panel, rows: s.rows }, ...s.window]) {
        const clipped = ops(w.panel).filter((o) => o.labelClipped).map((o) => o.label);
        const past = w.panel.controls.filter((o) => o.box.x < -0.5 || o.box.x + o.box.width > s.width + 0.5).map((o) => o.label || o.command);
        if (clipped.length > 0) { faults.add(`at ${s.width} px labels cut short: ${clipped.join(', ')}`); }
        if (past.length > 0 || w.panel.view.scrollWidth > s.width + 1) { faults.add(`at ${s.width} px the panel scrolls sideways, the document ${w.panel.view.scrollWidth} px wide${past.length > 0 ? `, buttons past the edge ${past.join(', ')}` : ''}, drawn past the edge ${JSON.stringify(w.panel.overflowing)}`); }
        w.rows.slice(0, 3).forEach((r, i) => {
          const r0 = start.rows[i];
          if (r.valueLines !== 1 || Math.abs(r.row.height - r0.row.height) > 0.5) { faults.add(`at ${s.width} px the ${r.label} row takes ${r.valueLines} lines, ${Math.round(r.row.height)} px tall against ${Math.round(r0.row.height)}`); }
          if (r.valueClipped && w.panel.rows[i]?.valueOverflow !== 'ellipsis') { faults.add(`at ${s.width} px the ${r.label} row is cut short without an ellipsis`); }
          const g = rightGap(r);
          const g0 = rightGap(r0);
          if (g !== null && g0 !== null && Math.abs(g - g0) > 1) { faults.add(`at ${s.width} px the ${r.label} row's create control sits ${Math.round(g)} px from its right edge, against ${Math.round(g0)}`); }
          const l = w.panel.rows[i]?.label ?? null;
          if (l !== null && l.clipped && l.overflow !== 'ellipsis') { faults.add(`at ${s.width} px the ${r.label} row's label is cut short without an ellipsis`); }
          if (l !== null && l.clipped && r.valueBox.width > 1) { faults.add(`at ${s.width} px the ${r.label} row's label is cut short while its value is drawn ${Math.round(r.valueBox.width)} px wide`); }
          if (!r.title.includes(levelNames[i])) { faults.add(`at ${s.width} px the ${r.label} row's hover does not name its level, ${levelNames[i]}`); }
        });
        const starts = w.rows.slice(0, 3).map((r) => Math.round(r.valueBox.x));
        if (starts.some((x) => Math.abs(x - starts[0]) > 1)) { faults.add(`at ${s.width} px the values start at ${JSON.stringify(starts)} px`); }
        const cut = w.panel.rows.slice(0, 3).filter((r) => r.label !== null && r.label.clipped).map((r) => r.label?.text ?? '');
        if (cut.length > 0) { labelsCut.add(`${s.width} px: ${cut.join(', ')}`); }
        if (!w.rows[0]?.title.includes(ctx.folder) || !w.rows[1]?.title.includes(ctx.folder)) { faults.add(`at ${s.width} px the folder's path is not on the first two rows' hovers`); }
      }
    }
    const byWidth = [...sweep].sort((a, b) => a.width - b.width);
    const counts = byWidth.map((s) => lines(s.panel).length);
    const monotonic = counts.every((n, i) => i === 0 || n <= counts[i - 1]);
    const repacks = counts[0] > counts[counts.length - 1];
    if (!monotonic || !repacks) { faults.add(`the lines by width ${JSON.stringify(byWidth.map((s, i) => `${s.width}px:${counts[i]}`))} do not fall as the panel widens`); }
    return { passed: faults.size === 0, seen: `widths visited ${JSON.stringify(sweep.map((s) => `${s.width}px:${lines(s.panel).length} lines, ${s.window.length} readings`))}${faults.size > 0 ? `; ${[...faults].join('; ')}` : '; no button cut short, nothing past the edge, the rows one line each with their values in line'}; labels given way ${labelsCut.size === 0 ? 'at no width' : [...labelsCut].join('; ')}` };
  });

  await c.run('commands-panel.nothing-drawn-between-groups-at-any-width', {
    expected: `at every width of the sweep above, at every reading over ${ABSENCE_MS} ms once the drawing has come to rest there, the panel draws no group title and no rule, the flow holds nothing but operations' buttons and the one button held with its caret, and every two neighbours on a line — the caret beside Build included — stand exactly the flow's own gap apart; the same reading finds the group titles and the rule above the publish group once the shape is changed below`,
    plant: 'in the scratch copy, out/src/operations-render.js with a mark drawn after each group\'s last button in the flow',
  }, async () => {
    need(sweep.length > 1, 'the sweep of widths above did not run');
    const faults = new Set<string>();
    let pairs = 0;
    for (const s of sweep) {
      for (const [n, p] of [s.panel, ...s.window.map((w) => w.panel)].entries()) {
        const gap = p.flowGap ?? 0;
        if (p.heads.length > 0 || p.rules.length > 0) { faults.add(`at ${s.width} px the panel draws group titles ${JSON.stringify(p.heads.map((h) => h.title))} and ${p.rules.length} rule(s)`); }
        const others = p.flow.filter((f) => f.kind === 'other').map((f) => f.className);
        if (others.length > 0) { faults.add(`at ${s.width} px the flow holds ${JSON.stringify(others)}`); }
        const items = [...p.flow].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
        for (let i = 1; i < items.length; i++) {
          const a = items[i - 1];
          const b = items[i];
          if (Math.abs((a.box.y + a.box.height / 2) - (b.box.y + b.box.height / 2)) > 4) { continue; }
          if (n === 0) { pairs++; }
          const between = b.box.x - (a.box.x + a.box.width);
          if (Math.abs(between - gap) > 0.6) { faults.add(`at ${s.width} px ${Math.round(between * 10) / 10} px between two neighbours where the gap is ${gap} px`); }
        }
        const build = p.controls.find((o) => o.command === 'aggrega.op.build');
        const caret = p.controls.find((o) => o.kind === 'caret');
        if (build && caret && Math.abs(caret.box.x - (build.box.x + build.box.width) - gap) > 0.6) { faults.add(`at ${s.width} px the caret stands ${Math.round((caret.box.x - build.box.x - build.box.width) * 10) / 10} px from Build`); }
      }
    }
    return { passed: faults.size === 0 && pairs > 0, seen: `${sweep.length} widths, ${pairs} neighbouring pairs measured at rest and read again over each window${faults.size > 0 ? `; ${[...faults].join('; ')}` : ', each the flow\'s gap apart, nothing but buttons in the flow and no group title or rule'}` };
  });

  await c.run('commands-panel.height-at-the-default-width', {
    expected: 'at the side bar\'s default width, with the container laid out as the window first lays it out — read as the sweep above started — the Commands panel\'s pane is at least as tall as its document, so every line of the flow is in view and none is cut through by the pane\'s edge; each pane\'s height is reported beside it, and a capture is taken',
    plant: 'in the scratch copy\'s package.json, the Commands view declared with no initial size',
  }, async () => {
    const s = sweep[0];
    need(s !== undefined, 'the sweep of widths above did not run, so the panel was not read at its default width');
    const ls = lines(s.panel);
    const top = Math.min(...s.panel.controls.map((o) => o.box.y));
    const bottom = Math.max(...s.panel.controls.map((o) => o.box.y + o.box.height));
    const panes = await panesOf(ctx);
    const win = await ctx.d.workbench<{ width: number; height: number }>('({ width: window.innerWidth, height: window.innerHeight })');
    const shot = await capture(ctx, 'commands-panel-default-width');
    return {
      passed: s.panel.view.height >= s.panel.view.scrollHeight,
      seen: `in a ${win.width} × ${win.height} window, width ${s.width} px; the operations on ${ls.length} lines (${ls.map((l) => l.map((o) => o.label || 'caret').join(' · ')).join(' / ')}), ${Math.round(bottom - top)} px from the first button's top to the last one's bottom; the three rows end ${Math.round(s.panel.rowsBottom)} px down; the document ${s.panel.view.scrollHeight} px tall in a pane ${s.panel.view.height} px tall; the container's panes ${JSON.stringify(panes.titles)} ${JSON.stringify(panes.heights)} px tall, headers included; capture ${shot}`,
      evidence: { screenshot: shot },
    };
  });

  // ---- the keyboard ----
  await c.run('commands-panel.tab-reaches-each-row-control-then-the-operations-once', {
    expected: `the panel's first stop is the Project folder row (Shift+Tab from it leaves the panel); from it Tab visits each row's own controls, one stop each, then the operations as one stop, then leaves the panel; on a row the arrow keys move nothing, watched for ${ABSENCE_MS} ms, while on the operations ArrowRight moves the focus off the first one, read the same way over the same window`,
    plant: 'in the scratch copy, out/src/operations-render.js with every operation\'s button a stop of its own',
  }, async () => {
    const rows = await levelRows(panel);
    const owed = rowStops(rows) + 1;
    const walk = await tabWalk(ctx, panel);
    const opStops = walk.stops.filter((s) => s.operation).length;
    const lastIsOp = walk.stops.length > 0 && walk.stops[walk.stops.length - 1].operation;
    // The arrows on a row.
    const project = rows[0];
    await focusInPanel(ctx, panel, `button.selector[data-command="${project.command}"]`);
    await ctx.d.press('ArrowRight');
    await ctx.d.press('ArrowDown');
    const stayed = await holds(ABSENCE_MS, () => activeControl(panel), (v) => v === project.command, 100);
    // The control: the arrows on the operations move the focus, read the same way.
    const first = ops(await drawnPanel(panel))[0];
    await focusInPanel(ctx, panel, `button.op[data-command="${first.command}"]`);
    await ctx.d.press('ArrowRight');
    const kept = await holds(ABSENCE_MS, () => activeControl(panel), (v) => v === first.command, 100);
    need(!kept.held, `its positive control did not fire: ArrowRight on the operations left the focus on the first one for ${ABSENCE_MS} ms, so the reading is not shown to see the arrows move the focus`);
    return { passed: walk.firstIsFirst && walk.stops.length === owed && opStops === 1 && lastIsOp && stayed.held, seen: `Shift+Tab from the Project folder row ${walk.firstIsFirst ? 'left the panel' : 'stayed in it'}; the stops ${JSON.stringify(walk.stops.map((s) => s.control))}, ${owed} owed (the rows' ${rowStops(rows)} and the operations' one); on the Project folder row the arrows ${stayed.held ? 'moved nothing' : `moved the focus to ${JSON.stringify(stayed.broke)}`}` };
  });

  // ---- every entry pressed ----
  const panelHeads = headRows();
  await c.run('commands-panel.every-entry-runs-or-asks-and-none-fails-on-its-arguments', {
    expected: `every button on the Commands panel and every row at the head of the ${panelHeads.map((h) => h.title).join(', ')} panels, pressed in turn with ${release} in front, answers — by running to an ending, drawing a panel of its own, opening a menu beside itself or asking in the editor's own input, which Escape then puts away — and nothing written to the channel or drawn as a notification after any press is a usage message, a help listing or a bare exit status; the same detector flags the command line's own answer to a pull named no Release`,
    plant: 'in the scratch copy, out/src/operations.js with the Release left out of the pull it runs',
  }, async () => {
    const bare = await runCompiler(bin, ['pull'], { cwd: ctx.folder, home: ctx.home, boundMs: 30000, log: ctx.cliLog });
    need(failsOnItsArguments(`${bare.stdout}\n${bare.stderr}`).length > 0, `its positive control did not fire: the command line's answer to a pull named no Release (exit ${bare.status}) is not flagged, so the detector is not shown to see a usage message`);
    await open(ctx, path.join(ctx.folder, release));
    const seenEntries: string[] = [];
    const failed: string[] = [];
    const press = async (name: string, act: () => Promise<void>, boundMs: number): Promise<void> => {
      const mark = ctx.out.mark();
      const toastMark = (await toasts(ctx.d)).length;
      const frames = (await ctx.d.webviews()).length;
      await act();
      const answer = await answerTo(ctx, panel, toastMark, frames, boundMs).catch((err: unknown) => ({ kind: 'none', what: err instanceof Error ? err.message : String(err) }));
      const left = answer.kind === 'asked' || answer.kind === 'menu' || answer.kind === 'dialog' ? await backOut(ctx, panel) : null;
      if (left !== null) { failed.push(`${name}: ${left}`); }
      const said = [ctx.out.since(mark), ...(await toastsSince(ctx.d, toastMark)).map((t) => t.message)].join('\n');
      const bad = failsOnItsArguments(said);
      if (answer.kind === 'none' || bad.length > 0) { failed.push(`${name}: ${answer.kind === 'none' ? `no answer (${answer.what})` : bad.join(', ')}`); }
      seenEntries.push(`${name} → ${answer.kind}: ${answer.what}`);
      await ctx.d.moveTo({ x: 1, y: 1 });
    };
    for (const o of ops(await drawnPanel(panel))) {
      panel = await commandsPanel(ctx.d);
      await press(o.label, () => pressOperation(ctx.d, panel, o.command), 180000);
      // A panel of its own drawn in front is put away, with every notification, so
      // the next press starts from the editor as the first did.
      await run(ctx, 'notifications.clearAll').catch(() => undefined);
      await closeAllEditors(ctx);
      await open(ctx, path.join(ctx.folder, release));
    }
    for (const h of panelHeads) {
      for (const a of h.actions) {
        await press(`${h.title} ▸ ${a.label}`, async () => {
          await run(ctx, 'workbench.view.extension.aggrega');
          await pressPanelAction(ctx.d, h.title, a.label);
        }, 60000);
        await closeAllEditors(ctx);
      }
    }
    await closeAllEditors(ctx);
    return { passed: failed.length === 0, seen: `${seenEntries.join('; ')}${failed.length > 0 ? `; failing: ${failed.join('; ')}` : ''}; the detector's control flagged the bare pull's ${failsOnItsArguments(`${bare.stdout}\n${bare.stderr}`).join(' and ')}` };
  });

  await c.run('commands-panel.asking-entries-ask-for-their-subject-and-backing-out-runs-nothing', {
    expected: `Push opens a menu beside itself saying "${menuWords('push').pending}" while it reads and then listing every entity document the folder holds; Inspect opens a menu of the workspace's entities and Cache… one of ${CACHE_OPERATIONS.map((o) => o.value).join(', ')}; Sign asks "${SIGN_PROMPT}"; Deprecate asks "${DEPRECATE_PROMPT}", then how severe (${DEPRECATION_SEVERITIES.map((s) => s.value).join(', ')}), then why; Import asks for its source; and at the head of the list panels each row asking a question asks it in the editor's own input. Backing out of each with Escape runs nothing — no notification and nothing on the channel over ${QUIET_MS} ms — while taking a choice in the same Cache… menu is seen running by the same reading over the same window`,
    plant: 'in the scratch copy, media/operations.js with Escape running a cache listing as it closes a menu',
  }, async () => {
    await closeAllEditors(ctx);
    panel = await commandsPanel(ctx.d);
    const faults: string[] = [];
    const notes: string[] = [];
    // One reading of what the editor says after a mark: the channel since it, and
    // the notifications drawn since it.
    const saidSince = async (mark: ReturnType<typeof ctx.out.mark>, toastMark: number): Promise<{ channel: string; told: string[] }> => ({ channel: ctx.out.since(mark).trim(), told: (await toastsSince(ctx.d, toastMark)).map((t) => t.message) });
    const nothingSaid = (v: { channel: string; told: string[] }): boolean => v.channel === '' && v.told.length === 0;
    // Where the channel and the notifications stand, taken just before the Escape
    // that backs out — as the control's is taken just before its choice — so
    // whatever the back-out runs is read from the press itself.
    const quietMark = async (): Promise<{ out: ReturnType<typeof ctx.out.mark>; toasts: number }> => ({ out: ctx.out.mark(), toasts: (await toasts(ctx.d)).length });
    const quietSince = async (name: string, m: { out: ReturnType<typeof ctx.out.mark>; toasts: number }): Promise<void> => {
      const q = await holds(QUIET_MS, () => saidSince(m.out, m.toasts), nothingSaid);
      if (!q.held) { faults.push(`backing out of ${name} ran something: ${JSON.stringify(q.broke)}`); }
    };
    // backOutOf presses Escape on a question in the editor's own input, reports
    // where it is left open, and reads what the back-out ran.
    const backOutOf = async (name: string): Promise<void> => {
      const m = await quietMark();
      const left = await putAway(ctx);
      if (left !== null) { faults.push(`backing out of ${name}: ${left}`); }
      await quietSince(name, m);
    };
    // Push, with an observer in the panel before the press.
    await panel.evaluate(MENU_STATUS_OBSERVER);
    await pressOperation(ctx.d, panel, 'aggrega.op.push');
    const push = await waitMenuOpen(panel, 'the Push menu listing the entities');
    const log = await menuReadings(panel);
    const pending = menuWords('push').pending;
    const saidReading = log.some((r) => r.open && r.status === pending && r.choices === 0) && log.findIndex((r) => r.open && r.status === pending) < log.findIndex((r) => r.choices > 0);
    const documents = fixtureDocuments(ctx);
    const missing = documents.filter((f) => !push.rows.some((r) => r.text.endsWith(`· ${f}`)));
    if (!saidReading) { faults.push(`the Push menu's line ${JSON.stringify(log)} never read "${pending}" before its choices`); }
    if (missing.length > 0) { faults.push(`the Push menu lists ${JSON.stringify(push.rows.map((r) => r.text))}, missing ${JSON.stringify(missing)}`); }
    notes.push(`Push: ${push.rows.length} entities`);
    const pushMark = await quietMark();
    await ctx.d.press('Escape');
    await waitMenuClosed(panel, 'the Push menu closing');
    await quietSince('Push', pushMark);
    // Inspect and Cache….
    for (const id of MENU_CONTROLS.filter((m) => m !== 'push')) {
      const command = commandsPanelOperations().find((o) => o.id === id);
      if (command === undefined) { faults.push(`no operation ${id} is described`); continue; }
      await pressOperation(ctx.d, panel, commandIdFor(command));
      const m = await waitMenuOpen(panel, `the ${command.label} menu`);
      if (m.label !== menuWords(id).label) { faults.push(`the ${command.label} menu is named "${m.label}"`); }
      if (id === 'cache' && JSON.stringify(m.rows.map((r) => r.label)) !== JSON.stringify(CACHE_OPERATIONS.map((o) => o.value))) { faults.push(`the Cache… menu offers ${JSON.stringify(m.rows.map((r) => r.label))}`); }
      notes.push(`${command.label}: "${m.label}", ${m.rows.length} choices`);
      const menuMark = await quietMark();
      await ctx.d.press('Escape');
      await waitMenuClosed(panel, `the ${command.label} menu closing`);
      await quietSince(command.label, menuMark);
    }
    // Sign, Deprecate and Import, in the editor's own input: each press answered by
    // its own question, read by its own words.
    const ask = async (command: string, label: string, words: string, own: (q: { title: string; message: string }) => boolean): Promise<boolean> => {
      await pressOperation(ctx.d, panel, command);
      const q = await waitChooser(ctx.d, `${label}'s question`, own, 10000).catch(() => null);
      if (q === null) { faults.push(`${label} did not ask ${words} in the editor's own input within ${guard(10000) / 1000} s; it reads ${JSON.stringify(await chooser(ctx.d))}`); return false; }
      notes.push(`${label}: ${JSON.stringify(`${q.message} | ${q.title}`)}`);
      return true;
    };
    await ask('aggrega.op.sign', 'Sign', `"${SIGN_PROMPT}"`, (q) => q.message.startsWith(SIGN_PROMPT));
    await backOutOf('Sign');
    if (await ask('aggrega.op.deprecate', 'Deprecate', `"${DEPRECATE_PROMPT}"`, (q) => q.message.startsWith(DEPRECATE_PROMPT))) {
      await ctx.d.type('registry.invalid/example/component:1.0.0');
      await ctx.d.press('Enter');
      const severity = await waitQuickInput(ctx.d, 'Deprecate asking how severe', (q) => q.rows.length > 0, 10000).catch(() => null);
      if (severity === null || JSON.stringify(severity.rows.map((r) => r.label)) !== JSON.stringify(DEPRECATION_SEVERITIES.map((s) => s.value))) { faults.push(`Deprecate's severities read ${JSON.stringify(severity?.rows.map((r) => r.label) ?? null)}`); }
      if (severity !== null) {
        await pickQuickInputRow(ctx.d, DEPRECATION_SEVERITIES[0].value);
        const why = await waitQuickInput(ctx.d, 'Deprecate asking why', (q) => q.rows.length === 0, 10000).catch(() => null);
        if (why === null) { faults.push('Deprecate did not ask why'); }
        notes.push(`Deprecate: severities ${JSON.stringify(severity.rows.map((r) => r.label))}, then ${why === null ? 'nothing' : JSON.stringify(why.title || why.placeholder)}`);
      }
    }
    await backOutOf('Deprecate');
    await ask(IMPORT_COMMAND, 'Import', `for its source ("${IMPORT_SOURCE_TITLE}")`, (q) => q.title === IMPORT_SOURCE_TITLE);
    await backOutOf('Import');
    // The rows at the head of the list panels that ask, each answered by its own
    // question.
    for (const h of panelHeads) {
      for (const a of h.actions) {
        const own = HEAD_ROW_QUESTIONS[a.id];
        if (own === null) { continue; }
        const name = `${h.title} ▸ ${a.label}`;
        await run(ctx, 'workbench.view.extension.aggrega');
        await pressPanelAction(ctx.d, h.title, a.label);
        const q = await waitChooser(ctx.d, `${a.label}'s question`, (x) => x.title === own || x.placeholder === own, 8000).catch(() => null);
        if (q === null) { faults.push(`${name} did not ask "${own}" in the editor's own input within ${guard(8000) / 1000} s; it reads ${JSON.stringify(await chooser(ctx.d))}`); }
        else { notes.push(`${name}: asked ${JSON.stringify(q.title || q.placeholder)}`); }
        await backOutOf(name);
      }
    }
    // The control: a choice taken in the same Cache… menu runs, read the same way
    // over the same window.
    panel = await commandsPanel(ctx.d);
    await pressOperation(ctx.d, panel, 'aggrega.op.cache');
    await waitMenuOpen(panel, 'the Cache… menu');
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    await pressIn(ctx.d, panel, `.op-menu:not([hidden]) .op-menu-option[data-option="${CACHE_OPERATIONS[0].value}"]`);
    const control = await holds(QUIET_MS, () => saidSince(mark, toastMark), nothingSaid);
    need(!control.held, `its positive control did not fire: taking a choice in the Cache… menu showed nothing on the channel or as a notification within ${QUIET_MS} ms, so the reading is not shown to see an entry run in that window`);
    return { passed: faults.length === 0, seen: `${notes.join('; ')}${faults.length > 0 ? `; ${faults.join('; ')}` : ''}; the control's cache listing seen ${control.atMs} ms after the choice` };
  });

  await c.run('commands-panel.reading-entries-start-no-compiler-process', {
    expected: `pressing ${DRAFT_ENTITY} (at the head of the Catalog panel) and backing out, Inspect and backing out once its choices arrive, and Show config until its panel is drawn starts no process running the compiler as a command — every process the editor's tree records from before the first press read every 50 ms, then over ${ABSENCE_MS} ms — while the same reading sees Pull start one`,
    plant: 'in the scratch copy, out/src/operations.js with the Inspect menu\'s reading running the compiler as a command',
  }, async () => {
    await closeAllEditors(ctx);
    panel = await commandsPanel(ctx.d);
    const runs = new CompilerRuns(ctx);
    try {
      await run(ctx, 'workbench.view.extension.aggrega');
      await pressPanelAction(ctx.d, LIST_PANEL_TITLES.catalog, DRAFT_ENTITY);
      await waitChooser(ctx.d, 'the kind being asked for', (q) => q.placeholder === HEAD_ROW_QUESTIONS.scaffold && q.rows.length > 0, 15000);
      await ctx.d.press('Escape');
      await until('the kind question closing', 5000, () => quickInput(ctx.d), (q) => q === null);
      await pressOperation(ctx.d, panel, 'aggrega.op.inspect');
      await waitMenuOpen(panel, 'the Inspect menu');
      await ctx.d.press('Escape');
      await waitMenuClosed(panel, 'the Inspect menu closing');
      const frames = (await ctx.d.webviews()).length;
      await pressOperation(ctx.d, panel, 'aggrega.config.open');
      await until('the configuration panel being drawn', 20000, async () => (await ctx.d.webviews()).length, (n) => n > frames);
      const quiet = await holds(ABSENCE_MS, async () => runs.read().length, (n) => n === 0, 100);
      const during = [...runs.seen];
      await closeAllEditors(ctx);
      // The control: Pull, read the same way.
      const mark = ctx.out.mark();
      await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.pull');
      const pulled = await until('Pull starting the compiler', 60000, async () => runs.read().length, (n) => n > during.length).then(() => true, () => false);
      // The pull is owed its ending before this check reports: a pull still running
      // would run beside the checks after this one.
      const ended = await ctx.out.waitFor('the pull ending', mark, (t) => /^The pull /m.test(t), 120000).then(() => true, () => false);
      need(pulled, 'its positive control did not fire: Pull was not seen running the compiler as a command, so the reading is not shown to see one');
      return { passed: quiet.held && during.length === 0 && ended, seen: `while asking, reading and drawing: ${during.length === 0 ? 'no compiler process' : JSON.stringify(during)}; Pull started ${JSON.stringify(runs.seen.slice(during.length))}${ended ? ' and ended' : `, and had not ended within ${guard(120000) / 1000} s, so the checks after this one run beside it`}` };
    } finally {
      runs.stop();
    }
  });

  // ---- the other shape ----
  let choice: LayoutChoice | null = null;
  let buttonsSequence: string[] = [];
  await c.run('commands-panel.sections-shape-keeps-the-groups-and-restarts-nothing', {
    expected: `choosing "sections" for ${LAYOUT_SETTING} on the settings screen redraws the panel as sections holding the same operations in the same groups in the same order, with the same language server process, no "starting" reading and the same window throughout, watched for 3 s; in the same check a restart asked for shows that reading fire`,
    plant: 'in the scratch copy, out/src/operations-render.js with each section drawn without its first operation',
  }, async () => {
    await closeAllEditors(ctx);
    panel = await commandsPanel(ctx.d);
    buttonsSequence = ops(await drawnPanel(panel)).map((o) => `${o.group}:${o.command}`);
    const srv = await theServer(ctx);
    const statusMark = (await statusLog(ctx.d)).length;
    const hello = await ctx.probe.request<{ instance: string }>('hello');
    choice = await chooseLayout(ctx, 'sections', 'layout-drop-down');
    const p = await until('the panel drawn as sections', 10000, () => drawnPanel(panel), (v) => v.shape === 'sections');
    const after = ops(p).map((o) => `${o.group}:${o.command}`);
    const read = async (): Promise<{ pids: number[]; starting: boolean; instance: string }> => ({ pids: languageServers(ctx).map((x) => x.pid), starting: (await statusLog(ctx.d)).slice(statusMark).some((r) => r.reading === STARTING), instance: (await ctx.probe.request<{ instance: string }>('hello')).instance });
    const quiet = await holds(3000, read, (v) => v.pids.length === 1 && v.pids[0] === srv.pid && !v.starting && v.instance === hello.instance);
    await closeAllEditors(ctx);
    // The control: a restart asked for, read the same way. The server is then owed
    // its running reading back, since every check after this one starts from it.
    const cStatus = (await statusLog(ctx.d)).length;
    await send(ctx, RESTART_COMMAND);
    const next = await theServer(ctx, 30000, srv.pid).then((x) => x.pid, () => null);
    const back = await waitStatus(ctx.d, RUNNING, 60000).then(() => true, () => false);
    const cStarting = (await statusLog(ctx.d)).slice(cStatus).some((r) => r.reading === STARTING);
    need(next !== null, `its positive control did not fire: the restart asked for gave no new process (${cStarting ? 'a' : 'no'} "starting" reading)`);
    return { passed: JSON.stringify(after) === JSON.stringify(buttonsSequence) && quiet.held && back, seen: `in buttons ${JSON.stringify(buttonsSequence)}; in sections ${JSON.stringify(after)}; ${quiet.held ? `process ${srv.pid}, no "starting" reading and the same window for 3 s` : `at ${quiet.atMs} ms ${JSON.stringify(quiet.broke)}`}; the control restarted into process ${next}${back ? ', the status bar reading running again' : `, and the status bar did not read "${RUNNING}" again within ${guard(60000) / 1000} s, so the checks after this one start with no running server`}` };
  });

  const enumValues = manifest.contributes.configuration.properties[LAYOUT_SETTING]?.enum ?? [];
  const enumDescriptions = manifest.contributes.configuration.properties[LAYOUT_SETTING]?.enumDescriptions ?? [];
  await c.run('settings.layout-values-carry-their-descriptions', {
    expected: `the shape setting's drop-down on the settings screen lists ${JSON.stringify(enumValues)}, each row announcing the description the manifest declares for it and the drop-down drawing that description beside the row the keys rest on`,
    plant: 'in the scratch copy\'s package.json, the sections value\'s description left empty',
  }, async () => {
    const got = choice as LayoutChoice | null;
    need(got !== null, 'the shape was not chosen on the settings screen above, so its drop-down was not read');
    const rowsOk = JSON.stringify(got.rows.map((r) => r.value)) === JSON.stringify(enumValues) && got.rows.every((r, i) => enumDescriptions[i] !== '' && r.aria.includes(enumDescriptions[i]));
    const detailsOk = JSON.stringify(got.details) === JSON.stringify(enumDescriptions);
    return { passed: rowsOk && detailsOk, seen: `rows ${JSON.stringify(got.rows)}; drawn beside each in turn ${JSON.stringify(got.details)}` };
  });

  await c.forPerson(LAYOUT_DESCRIPTIONS_APART, async () => {
    const got = choice as LayoutChoice | null;
    need(got !== null, 'the shape was not chosen on the settings screen above, so there is no capture of its drop-down');
    return { screenshot: got.shot, drawnText: got.rows.map((r, i) => `${r.value}: ${got.details[i] ?? ''}`).join('\n') };
  });

  await c.run('commands-panel.sections-carry-group-titles-and-a-rule-above-publish', {
    expected: `in the section shape the panel's sections are titled ${COMMANDS_PANEL_GROUPS.map((g) => g.heading).join(', ')}, in that order, each holding its group's operations; the Publish section alone carries a visible rule above it; the same, read again over ${ABSENCE_MS} ms`,
    plant: 'in the scratch copy, media/operations.css with no rule drawn above the publish section',
  }, async () => {
    const read = async (): Promise<{ ok: boolean; titles: string[]; rules: string[]; members: string[] }> => {
      const p = await drawnPanel(panel);
      const titles = p.heads.map((h) => h.title);
      const rules = p.rules.map((r) => `${headingOf(r.group)}:${r.width}px ${rgb(r.colour)}`);
      const members = p.heads.map((h) => `${h.title}: ${ops(p).filter((o) => o.group === h.group).map((o) => o.label).join(' · ')}`);
      const ok = p.shape === 'sections' && JSON.stringify(titles) === JSON.stringify(COMMANDS_PANEL_GROUPS.map((g) => g.heading))
        && p.rules.every((r) => (headingOf(r.group) === 'Publish' ? r.width >= 1 && seen(r.colour) : r.width === 0))
        && COMMANDS_PANEL_GROUPS.every((g) => JSON.stringify(ops(p).filter((o) => headingOf(o.group) === g.heading).map((o) => o.label)) === JSON.stringify(g.labels));
      return { ok, titles, rules, members };
    };
    const first = await read();
    const kept = await holds(ABSENCE_MS, read, (v) => v.ok);
    return { passed: first.ok && kept.held, seen: `titles ${JSON.stringify(first.titles)}; rules ${JSON.stringify(first.rules)}; ${JSON.stringify(first.members)}` };
  });

  await c.forPerson(ONE_BUTTON_GROUP, async () => {
    const p = await drawnPanel(panel);
    const groups = p.heads.map((h) => ({ title: h.title, labels: ops(p).filter((o) => o.group === h.group).map((o) => o.label) }));
    const palette = ops(p).map((o) => `${o.label} — palette: ${paletteTitle(ctx, o.command)}`);
    return { screenshot: await capture(ctx, 'commands-panel-sections'), drawnText: `${groups.map((g) => `${g.title}: ${g.labels.join(' · ')}${g.labels.length === 1 ? ' (one button)' : ''}`).join('\n')}\n\n${palette.join('\n')}` };
  });

  await c.run('commands-panel.caret-row-reads-build-options-in-the-section-shape', {
    expected: `in the section shape, with every section open, the control beside Build is a row of its own beneath Build that draws its name, "${CARET_NAME}", as text beside its chevron glyph — the whole name, not cut short, inside the panel's width — at every reading over ${ABSENCE_MS} ms; the same reading of the flow, taken at the default width above, finds no name drawn on it`,
    plant: 'in the scratch copy, out/src/operations-render.js with the control\'s name left undrawn in the section shape',
  }, async () => {
    const flow = sweep[0];
    need(flow !== undefined, 'the flow was not read at its default width above, so the reading is not shown to tell a drawn name from none');
    const inFlow = flow.panel.controls.find((o) => o.kind === 'caret');
    need(inFlow !== undefined && inFlow.named === null, `its control did not show the reading tells a drawn name from none: in the flow the control ${inFlow === undefined ? 'is not drawn' : `draws ${JSON.stringify(inFlow.named)}`}`);
    await openEverySection(ctx, panel);
    const read = async (): Promise<{ ok: boolean; note: string }> => {
      const p = await drawnPanel(panel);
      const k = p.controls.find((o) => o.kind === 'caret');
      const b = p.controls.find((o) => o.command === 'aggrega.op.build');
      if (k === undefined || b === undefined) { return { ok: false, note: `drawn as ${p.shape}; the control ${k === undefined ? 'not drawn' : 'drawn'}, Build ${b === undefined ? 'not drawn' : 'drawn'}` }; }
      const n = k.named;
      const beneath = k.box.y >= b.box.y + b.box.height - 0.5;
      const inside = n !== null && n.box.x >= -0.5 && n.box.x + n.box.width <= p.view.width + 0.5;
      const ok = p.shape === 'sections' && n !== null && n.text === CARET_NAME && !n.clipped && inside && k.glyph && k.icon === 'codicon-chevron-down' && beneath;
      return { ok, note: `drawn as ${p.shape}; the control ${beneath ? 'a row beneath Build' : 'not beneath Build'}, its name ${n === null ? 'not drawn' : `"${n.text}"${n.clipped ? ' cut short' : ''} at ${Math.round(n.box.x)}–${Math.round(n.box.x + n.box.width)} px in a ${p.view.width} px panel`}, its glyph ${k.icon}${k.glyph ? '' : ' (no glyph)'}` };
    };
    const first = await read();
    const kept = await holds(ABSENCE_MS, read, (v) => v.ok);
    return { passed: first.ok && kept.held, seen: `${first.note}${kept.held ? `, the same for ${ABSENCE_MS} ms` : `; at ${kept.atMs} ms ${kept.broke?.note ?? ''}`}; in the flow the control draws no name` };
  });

  await c.run('commands-panel.section-chevrons-turn-as-they-open', {
    expected: 'each open section\'s heading draws a downward chevron glyph; pressing the Build section\'s heading closes it and turns its chevron to point right, and pressing it again opens it and turns it back down',
    plant: 'in the scratch copy, media/operations.js with a section\'s chevron left as it was drawn when the section opens or closes',
  }, async () => {
    const open0 = await openEverySection(ctx, panel);
    const down = open0.heads.every((h) => h.chevron === 'codicon-chevron-down' && h.glyph);
    const build = open0.heads[0].group;
    await pressHead(ctx, panel, build);
    const closed = await until('the first section closing', 5000, () => drawnPanel(panel), (p) => p.heads[0]?.expanded === false).catch(() => drawnPanel(panel));
    const right = closed.heads[0]?.chevron === 'codicon-chevron-right' && closed.heads[0].glyph;
    await pressHead(ctx, panel, build);
    const again = await until('the first section opening', 5000, () => drawnPanel(panel), (p) => p.heads[0]?.expanded === true).catch(() => drawnPanel(panel));
    const back = again.heads[0]?.chevron === 'codicon-chevron-down' && again.heads[0].glyph;
    return { passed: down && right && back, seen: `open: ${JSON.stringify(open0.heads.map((h) => `${h.title} ${h.chevron}${h.glyph ? '' : ' (no glyph)'}`))}; closed ${closed.heads[0]?.chevron}; opened again ${again.heads[0]?.chevron}` };
  });

  await c.run('commands-panel.keyboard-in-sections-opens-and-closes-with-the-arrows', {
    expected: 'in the section shape, with every section open, Tab visits each row\'s own controls, then the sections as one stop, then leaves; with the focus on a heading ArrowLeft closes its section and ArrowRight opens it again, and from the closed heading ArrowDown moves to the next heading rather than staying put',
    plant: 'in the scratch copy, media/operations.js with the arrow keys walking into the controls of a closed section',
  }, async () => {
    const rows = await levelRows(panel);
    await openEverySection(ctx, panel);
    const walk = await tabWalk(ctx, panel);
    const owed = rowStops(rows) + 1;
    const p = await drawnPanel(panel);
    const [first, second] = p.heads;
    if (first === undefined || second === undefined) { throw new Error(`the section shape draws ${p.heads.length} heading(s), not two or more`); }
    await focusInPanel(ctx, panel, `.section-head[data-toggle="${first.group}"]`);
    const expandedNow = (want: boolean): Promise<boolean> => until(`the first section reading ${want ? 'open' : 'closed'}`, 3000, () => drawnPanel(panel), (x) => x.heads[0]?.expanded === want).then(() => true, () => false);
    await ctx.d.press('ArrowLeft');
    const closed = await expandedNow(false);
    await ctx.d.press('ArrowRight');
    const opened = await expandedNow(true);
    await ctx.d.press('ArrowLeft');
    await expandedNow(false);
    await ctx.d.press('ArrowDown');
    const focused = await until('ArrowDown reaching the next heading', 3000, () => activeControl(panel), (v) => v === second.group).catch(() => activeControl(panel));
    const moved = focused === second.group;
    return { passed: walk.firstIsFirst && walk.stops.length === owed && walk.stops.filter((s) => s.operation).length === 1 && closed && opened && moved, seen: `Shift+Tab from the Project folder row ${walk.firstIsFirst ? 'left the panel' : 'stayed in it'}; the stops ${JSON.stringify(walk.stops.map((s) => s.control))}, ${owed} owed; on ${first.title} ArrowLeft ${closed ? 'closed' : 'did not close'} it and ArrowRight ${opened ? 'opened' : 'did not open'} it; from it closed, ArrowDown left the focus on ${JSON.stringify(focused)}${moved ? '' : `, not on ${second.title}`}` };
  });

  await c.run('commands-panel.closing-a-section-hands-its-tab-stop-to-its-heading', {
    expected: 'in the section shape, with every section open and the tab stop walked by ArrowDown from the Build heading onto its first operation, pressing the Build heading with the pointer closes the section and leaves exactly one tab stop in the list, on that heading, so Tab from the rows reaches the list there; the same walk by Tab, taken before the press, reaches the list on the operation the stop was on',
    plant: 'in the scratch copy, media/operations.js with a closing section leaving the tab stop where it was',
  }, async () => {
    const open0 = await openEverySection(ctx, panel);
    const build = open0.heads[0];
    if (build === undefined) { throw new Error('the section shape draws no heading'); }
    await focusInPanel(ctx, panel, `.section-head[data-toggle="${build.group}"]`);
    await ctx.d.press('ArrowDown');
    const onFirst = await until('ArrowDown reaching the section\'s first operation', 3000, () => activeControl(panel), (v) => v !== build.group && v !== '').catch(() => activeControl(panel));
    const before = (await tabWalk(ctx, panel)).stops.filter((s) => s.operation).map((s) => s.control);
    need(before.length === 1 && before[0] === onFirst && onFirst !== '', `its positive control did not fire: with the stop walked onto ${JSON.stringify(onFirst)}, Tab reached the list on ${JSON.stringify(before)}, so the walk is not shown to find the list where its stop is`);
    await pressHead(ctx, panel, build.group);
    await until(`the ${build.title} section closing`, 5000, () => drawnPanel(panel), (p) => p.heads[0]?.expanded === false);
    const stops = await panel.evaluate<{ control: string; shown: boolean }[]>(`[...document.querySelectorAll('[data-roving] [tabindex="0"]')].map((e) => ({ control: e.dataset.command || e.dataset.toggle || ('caret:' + (e.dataset.dials || '')), shown: !e.closest('[hidden]') }))`);
    const after = (await tabWalk(ctx, panel)).stops.filter((s) => s.operation).map((s) => s.control);
    const passed = stops.length === 1 && stops[0].control === build.group && stops[0].shown && after.length === 1 && after[0] === build.group;
    return { passed, seen: `before the press the stop on ${JSON.stringify(onFirst)} and Tab reached the list on ${JSON.stringify(before)}; with ${build.title} closed by the pointer, the list's stops ${JSON.stringify(stops)}, and Tab reached the list on ${after.length === 0 ? 'nothing — it passed the list by' : JSON.stringify(after)}` };
  });

  await c.run('commands-panel.context-rows-stay-with-every-section-closed', {
    expected: 'with every section closed by its heading and the panel scrolled back to its top, the three rows are drawn whole inside the panel\'s view, above every heading, one line each, reading what they read before; watched for 1 s',
    plant: 'in the scratch copy, media/operations.js with the rows put away whenever a section closes',
  }, async () => {
    const before = await levelRows(panel);
    for (const h of (await drawnPanel(panel)).heads.filter((x) => x.expanded)) { await pressHead(ctx, panel, h.group); }
    const closed = await until('every section closed', 5000, () => drawnPanel(panel), (p) => p.heads.length > 0 && p.heads.every((h) => !h.expanded));
    // Back to the panel's top, as a person scrolls up to read it.
    await ctx.d.moveTo(await panelViewCentre(ctx, panel));
    await ctx.d.wheel(0, -2000);
    await until('the panel scrolled to its top', 3000, () => panel.evaluate<number>('window.scrollY'), (y) => y === 0);
    const read = async (): Promise<{ ok: boolean; rows: string[] }> => {
      const rows = await levelRows(panel);
      const p = await drawnPanel(panel);
      const firstHead = Math.min(...p.heads.map((h) => h.box.y - p.view.scrollY));
      const ok = rows.length >= 3 && rows.slice(0, 3).every((r, i) => r.row.height > 0 && r.row.y >= 0 && r.row.y + r.row.height <= Math.min(p.view.height, firstHead) + 0.5 && r.valueLines === 1 && r.value === before[i]?.value);
      return { ok, rows: rows.slice(0, 3).map((r) => `${r.label}: ${r.value} at ${Math.round(r.row.y)}–${Math.round(r.row.y + r.row.height)}`) };
    };
    const first = await read();
    const kept = await holds(1000, read, (v) => v.ok);
    return { passed: first.ok && kept.held, seen: `${closed.heads.length} sections closed; the rows ${JSON.stringify(first.rows)}, the first heading at ${Math.round(Math.min(...closed.heads.map((h) => h.box.y)))} px${kept.held ? '' : `; at ${kept.atMs} ms ${JSON.stringify(kept.broke)}`}` };
  });

  await c.run('commands-panel.follows-the-theme-and-borders-every-control-in-high-contrast', {
    expected: `in each of ${THEMES.map((t) => t.name).join(', ')}, with every section open, the panel is drawn in that theme on the side bar's own ground; and in the high-contrast one every operation's row, every section heading and every control on the three rows draws a border at least 1 px wide in a colour that is seen; the panel is then drawn in ${THEMES[0].name} again`,
    plant: 'in the scratch copy, media/operations.css with an operation\'s button given no border in the dark high-contrast theme',
  }, async () => {
    await openEverySection(ctx, panel);
    let from = THEMES[0].name;
    return restoring(async () => {
      const faults: string[] = [];
      const notes: string[] = [];
      for (const theme of THEMES) {
        if (theme.name !== from) {
          writeColourTheme(ctx, from, theme.name);
          from = theme.name;
        }
        const p = await until(`the panel drawn in ${theme.name}`, 15000, () => drawnPanel(panel), (x) => x.bodyClass.split(/\s+/).includes(theme.bodyClass));
        const g = await workbenchGround(ctx);
        if (!sameColour(p.ground, g.sideBar)) { faults.push(`in ${theme.name} the panel's ground ${rgb(p.ground)} is not the side bar's ${rgb(g.sideBar)}`); }
        notes.push(`${theme.name}: ground ${rgb(p.ground)}, side bar ${rgb(g.sideBar)}, editor area ${rgb(g.editor)}`);
        if (/high-contrast/.test(theme.bodyClass)) {
          const bare = [
            ...p.controls.filter((o) => o.box.height > 0 && (o.borderWidth < 1 || !seen(o.borderColour))).map((o) => o.label || o.command),
            ...p.heads.filter((h) => h.borderWidth < 1 || !seen(h.borderColour)).map((h) => `heading ${h.title}`),
            ...p.rows.flatMap((r, i) => r.borders.filter((b) => b.width < 1 || !seen(b.colour)).map((b) => `row ${i + 1} ${b.control}`)),
          ];
          if (bare.length > 0) { faults.push(`in ${theme.name} drawn without a border that is seen: ${bare.join(', ')}`); }
          notes.push(`${p.controls.filter((o) => o.box.height > 0).length} controls, ${p.heads.length} headings and ${p.rows.reduce((n, r) => n + r.borders.length, 0)} row controls read for a border`);
        }
      }
      return { passed: faults.length === 0, seen: `${notes.join('; ')}${faults.length > 0 ? `; ${faults.join('; ')}` : ''}` };
    }, async () => {
      if (from === THEMES[0].name) { return null; }
      const left = from;
      writeColourTheme(ctx, from, THEMES[0].name);
      from = THEMES[0].name;
      const back = await until(`the panel drawn in ${THEMES[0].name} again`, 15000, () => drawnPanel(panel), (x) => x.bodyClass.split(/\s+/).includes(THEMES[0].bodyClass)).then(() => true, () => false);
      return back ? null : `the panel was not drawn in ${THEMES[0].name} again within ${guard(15000) / 1000} s of the user settings naming it, so the checks after this one may read it in ${left}`;
    });
  });

  // ---- where the preference is kept ----
  const userSettings = path.join(ctx.s.root.userData, 'User', 'settings.json');
  const workspaceSettings = path.join(ctx.folder, '.vscode', 'settings.json');
  await c.run('settings.preference-is-the-users-and-a-workspace-value-is-ignored', {
    expected: `the shape chosen on the settings screen above lands in the user settings file and in no workspace value; written by hand into the folder's workspace settings as "buttons", the same key is marked there by the editor and changes nothing — the panel stays in sections and the value in force stays "sections", watched for 3 s — while choosing "buttons" on the settings screen redraws the panel, read the same way`,
    plant: 'in the scratch copy\'s package.json, the shape setting declared with a scope a workspace may set',
  }, async () => {
    need(choice !== null, 'the shape was not chosen on the settings screen above');
    const v = await settingValue(ctx, LAYOUT_SETTING);
    const inUser = fs.readFileSync(userSettings, 'utf8').includes(`"${LAYOUT_SETTING}": "sections"`);
    need(!fs.existsSync(workspaceSettings), `${workspaceSettings} is already there, so writing it would overwrite something the folder holds`);
    fs.mkdirSync(path.dirname(workspaceSettings), { recursive: true });
    fs.writeFileSync(workspaceSettings, `{\n  "${LAYOUT_SETTING}": "buttons"\n}\n`);
    try {
      await open(ctx, workspaceSettings);
      const marked = await until('the editor marking the key in the workspace file', 15000, async () => (await ctx.probe.request<{ diagnostics: { message: string; range: { start: { line: number } } }[] }[]>('diagnostics.list', { path: workspaceSettings }))[0]?.diagnostics ?? [], (d) => d.some((x) => x.range.start.line === 1)).catch(() => []);
      const ignored = await holds(3000, async () => ({ shape: (await drawnPanel(panel)).shape, value: (await settingValue(ctx, LAYOUT_SETTING)).value }), (x) => x.shape === 'sections' && x.value === 'sections');
      await closeAllEditors(ctx);
      // The control: the user's own value changed, read the same way.
      await chooseLayout(ctx, 'buttons', 'layout-drop-down-back');
      const redrawn = await until('the panel redrawn as buttons', 10000, () => drawnPanel(panel), (p) => p.shape === 'buttons').then(() => true, () => false);
      await closeAllEditors(ctx);
      need(redrawn, 'its positive control did not fire: choosing "buttons" on the settings screen did not redraw the panel, so the reading is not shown to see a value that applies');
      return {
        passed: v.globalValue === 'sections' && v.workspaceValue === undefined && inUser && marked.length > 0 && ignored.held,
        seen: `the user's value ${JSON.stringify(v.globalValue)}, the workspace's ${JSON.stringify(v.workspaceValue)}, in the user settings file ${inUser}; the workspace file marked ${JSON.stringify(marked.map((d) => d.message))}; ${ignored.held ? 'the panel stayed in sections and the value in force "sections" for 3 s' : `at ${ignored.atMs} ms ${JSON.stringify(ignored.broke)}`}`,
      };
    } finally {
      fs.rmSync(workspaceSettings, { force: true });
    }
  });

  const settingsTitle = ctx.manifest.contributes.configuration.title;
  const binaryLabel = settingLabel(settingsTitle, BINARY_PATH);
  const binaryDeclared = declaredDescription(ctx, BINARY_PATH);
  let binaryDrawn = '';
  let binaryItem: SettingItem | null = null;
  await c.run('settings.binary-path-description-names-the-two-files', {
    expected: `the settings screen draws "${binaryLabel}" with the description the manifest declares, which names the project's \`.aggrega-config.yaml\` and its \`workspace:\` block, calls the file on the machine the global file and gives its location — the location the welcome page's workspace step gives — and says nothing of credentials or of a machine-wide file`,
    plant: 'in the scratch copy\'s package.nls.json, the binary path\'s description calling the file on the machine machine-wide',
  }, async () => {
    const item = await openSettingsOn(ctx, 'binaryPath', binaryLabel);
    binaryDrawn = item.description;
    binaryItem = item;
    await closeAllEditors(ctx);
    const plain = (s: string): string => s.replace(/`/g, '');
    const located = [...binaryDeclared.matchAll(/`([^`]*config\.yaml)`/g)].map((m) => m[1]).filter((f) => f !== '.aggrega-config.yaml');
    await run(ctx, WELCOME_OPEN_COMMAND);
    const step = stepOf(await pageNow(ctx), 'workspace').explanationText;
    await closeAllEditors(ctx);
    const sameLocation = located.length === 1 && step.includes(located[0]);
    const named = /`\.aggrega-config\.yaml`/.test(binaryDeclared) && /`workspace:`/.test(binaryDeclared) && /\bglobal file\b/.test(binaryDeclared);
    const wrong = /machine-wide|credential/i.test(binaryDeclared);
    return {
      passed: plain(item.description) === plain(binaryDeclared) && named && !wrong && sameLocation,
      seen: `drawn ${plain(item.description) === plain(binaryDeclared) ? 'as declared' : `"${item.description}"`}; names the two files ${named}; machine-wide or credentials ${wrong}; the global file located at ${JSON.stringify(located)}, ${sameLocation ? 'as' : 'not as'} the welcome page's workspace step gives it`,
    };
  });

  await c.forPerson(BINARY_PATH_READ, async () => {
    need(binaryDrawn !== '', 'the binary path\'s entry was not drawn above');
    await openSettingsOn(ctx, 'binaryPath', binaryLabel);
    const shot = await capture(ctx, 'settings-binary-path');
    await closeAllEditors(ctx);
    return { screenshot: shot, drawnText: binaryDrawn };
  });

  // ---- code drawn as code, and a setting named as the screen names it ----
  // The two files a reader is to recognise in the binary path's description,
  // held as written: each is drawn as code, not wrapped in backticks.
  const BINARY_PATH_FILES = ['.aggrega-config.yaml', '~/.config/aggrega/config.yaml'];
  const binaryCode = codeIn(declaredMarkdown(ctx, BINARY_PATH));
  await c.run('settings.binary-path-description-draws-its-code-as-code', {
    expected: `the settings screen draws "${binaryLabel}"'s description as Markdown: no backtick among its drawn words, and each piece of code the manifest's Markdown description declares — ${JSON.stringify(binaryCode)} — drawn as code, in that order, ${BINARY_PATH_FILES.map((f) => `"${f}"`).join(' and ')} among them`,
    plant: 'in the scratch copy\'s package.json, the binary path\'s description declared as a plain description',
  }, async () => {
    const item = binaryItem as SettingItem | null;
    need(item !== null, 'the binary path\'s entry was not drawn above');
    const asCode = binaryCode.length > 0 && JSON.stringify(item.code) === JSON.stringify(binaryCode);
    const files = BINARY_PATH_FILES.filter((f) => !item.code.includes(f));
    const ticks = item.description.includes('`');
    return {
      passed: item.markdown && !ticks && asCode && files.length === 0,
      seen: `drawn ${item.markdown ? 'as Markdown' : 'as plain text'}${ticks ? ', with a backtick among its drawn words' : ', with no backtick'}; drawn as code ${JSON.stringify(item.code)}, the manifest declaring ${JSON.stringify(binaryCode)}${files.length > 0 ? `; not drawn as code: ${files.join(', ')}` : ''}`,
    };
  });

  const graceLabel = settingLabel(settingsTitle, RESTART_GRACE);
  await c.run('settings.restart-grace-names-the-binary-path-as-the-settings-screen-does', {
    expected: `the settings screen draws "${graceLabel}" with its Markdown description, as declared, naming the setting whose change it waits on by the editor's own link: a link reading the label the screen draws for ${BINARY_PATH} — read above — and leading to that setting; no drawn word of it is that setting's id, whole or by its last segment, and none a backtick`,
    plant: 'in the scratch copy\'s package.nls.json, the restart grace\'s description naming the binary path by its id',
  }, async () => {
    const binary = binaryItem as SettingItem | null;
    need(binary !== null, 'the binary path\'s entry was not drawn above, so the label the screen gives it is not known');
    const shown = `${binary.category}${binary.label}`.trim();
    const item = await openSettingsOn(ctx, 'restartGraceSeconds', graceLabel);
    await closeAllEditors(ctx);
    const declared = declaredMarkdown(ctx, RESTART_GRACE);
    const asDeclared = declared !== '' && item.description === drawnFromMarkdown(declared, settingsTitle);
    const linked = item.links.filter((l) => l.text === shown && (l.target.endsWith(`#${BINARY_PATH}`) || l.title === BINARY_PATH));
    const byId = [BINARY_PATH, BINARY_PATH.split('.').pop() ?? BINARY_PATH].filter((id) => item.description.includes(id));
    const ticks = item.description.includes('`');
    return {
      passed: item.markdown && asDeclared && linked.length === 1 && byId.length === 0 && !ticks,
      seen: `drawn ${item.markdown ? 'as Markdown' : 'as plain text'}, ${asDeclared ? 'as declared' : `"${item.description}"${declared === '' ? ', the manifest declaring no Markdown description' : ''}`}; the screen labels the binary path "${shown}"; links drawn ${JSON.stringify(item.links)}, the manifest linking ${JSON.stringify([...declared.matchAll(SETTING_LINK)].map((m) => m[1]))}${byId.length > 0 ? `; the drawn words name ${byId.join(' and ')}` : ''}${ticks ? '; a backtick among its drawn words' : ''}`,
    };
  });

  // ---- with the language server stopped ----
  // 🔴 THE GREYED READING'S POSITIVE CONTROL IS IN ANOTHER SCENARIO, AND NO STATE
  // THIS FOLDER REACHES CAN GIVE IT ONE. The gateway folder is anchored and its
  // Release selected, and what greys an operation reads neither the server nor
  // anything else this check changes, so nothing here can be greyed; the same
  // reading of the buttons finds the Release's operations greyed in
  // mysql-commands-panel-no-release. The Draft entity row's reason is read with a
  // control here: the same reading of the Catalog panel finds the description its
  // entity rows carry.
  let stoppedNote = '';
  const failedStart = `${START_FAILED_OPENING}${notExecutableAt(notABinary)}`;
  const warning = `${VALIDATE_WITH_NO_SERVER} Its last start failed: ${notExecutableAt(notABinary)}`;
  // The channel's own line for that start, held as written: it is what the output
  // panel is read for once "Show output" is pressed.
  const channelLine = `the language server did not start: ${notExecutableAt(notABinary)}`;
  await c.run('commands-panel.server-only-operations-stay-enabled-with-the-server-stopped', {
    expected: `with ${BINARY_PATH} pointed at a file that is not a binary, the status bar reads "${NOT_RUNNING}" and an error notification reads "${failedStart}" with a "${OPEN_BINARY_PATH_SETTING}" button; the Commands panel's ${ENABLED_WITH_THE_SERVER_STOPPED.join(', ')} stay enabled and the Catalog panel's "${DRAFT_ENTITY}" row carries no reason, at every reading over ${ABSENCE_MS} ms — the same reading of that panel finding the description its entity rows carry; pressing Validate with ${release} in front answers the warning "${warning}" with the buttons ${JSON.stringify(WARNING_BUTTONS)}; and each button, pressed on a warning of its own, does what it says — "${WARNING_BUTTONS[0]}" draws the panel, put away beforehand, showing the channel's line "${channelLine}"; "${WARNING_BUTTONS[1]}" opens the settings screen searching "${BINARY_PATH_SEARCH}" and drawing that one setting; and "${WARNING_BUTTONS[2]}" starts the language server, which fails to start again in the same words`,
    plant: 'in the scratch copy, out/src/notifications.js with the warning raised without its buttons; or with its "Start" running nothing; or out/src/start-failure.js with a file that cannot be run read as any other failure',
  }, async () => {
    const toastMark = (await toasts(ctx.d)).length;
    await setBinaryPath(ctx, bin, notABinary);
    const stopped = await waitStatus(ctx.d, NOT_RUNNING, 90000).then(() => true, () => false);
    if (!stopped) { return { passed: false, seen: `with the binary path naming a file that is not a binary, the status bar did not read "${NOT_RUNNING}" within ${guard(90000) / 1000} s; it reads "${await statusNow(ctx.d)}"` }; }
    const told = await waitToast(ctx.d, 'the failed start being told', toastMark, (t) => t.severity === 'error' && t.message.startsWith(START_FAILED_OPENING), 30000).catch(() => null as Toast | null);
    panel = await commandsPanel(ctx.d);
    await run(ctx, 'workbench.view.extension.aggrega');
    const read = async (): Promise<{ enabled: string[]; greyed: string[]; draft: string | null; described: string[] }> => {
      const drawn = ops(await drawnPanel(panel));
      const rows = (await treeRows(ctx.d, LIST_PANEL_TITLES.catalog)) ?? [];
      const draft = rows.find((r) => r.label === DRAFT_ENTITY);
      return {
        enabled: ENABLED_WITH_THE_SERVER_STOPPED.filter((l) => drawn.some((x) => x.label === l && !x.disabled)),
        greyed: ENABLED_WITH_THE_SERVER_STOPPED.filter((l) => !drawn.some((x) => x.label === l && !x.disabled)),
        draft: draft === undefined ? null : draft.description,
        described: rows.filter((r) => r.label !== DRAFT_ENTITY && r.description !== '').map((r) => `${r.label}: ${r.description}`),
      };
    };
    const first = await until('the Catalog panel drawing its head', 15000, read, (v) => v.draft !== null).catch(read);
    const kept = await holds(ABSENCE_MS, read, (v) => v.greyed.length === 0 && v.draft === '');
    need(first.described.length > 0, `its positive control did not fire: no row of the Catalog panel drew a description, so the reading is not shown to see one on the ${DRAFT_ENTITY} row`);
    const releasePath = path.join(ctx.folder, release);
    // pressValidate presses Validate with the Release in front and returns what it
    // answered; each button is pressed on a warning of its own, since a press puts
    // the warning away.
    const pressValidate = async (what: string): Promise<Toast | null> => {
      await open(ctx, releasePath);
      const mark = (await toasts(ctx.d)).length;
      await pressOperation(ctx.d, panel, 'aggrega.op.validate');
      return waitToast(ctx.d, what, mark, (t) => t.message.startsWith('Aggrega:'), 15000).catch(() => null as Toast | null);
    };
    const said = await pressValidate('Validate\'s answer');

    // "Show output", with the panel put away first, so the press is what draws it.
    await run(ctx, 'workbench.action.closePanel');
    const putAway = await until('the panel put away', 5000, () => panelText(ctx.d), (t) => t === null).then(() => true, () => false);
    const squash = (s: string): string => s.replace(/\s+/g, '');
    const shown = said !== null && putAway && await pressToastButton(ctx.d, said.message.slice(0, 40), WARNING_BUTTONS[0])
      ? await until('the panel showing the channel\'s line', 10000, () => panelText(ctx.d), (t) => t !== null && squash(t).includes(squash(channelLine))).then(() => true, () => false)
      : false;

    // The setting naming the compiler.
    const again = await pressValidate('Validate\'s answer, a second time');
    const screen = again !== null && await pressToastButton(ctx.d, again.message.slice(0, 40), WARNING_BUTTONS[1]) ? await settingsScreen(ctx) : null;
    await closeAllEditors(ctx);
    const opened = screen !== null && screen.search === BINARY_PATH_SEARCH && JSON.stringify(screen.keys) === JSON.stringify([BINARY_PATH]);

    // The start, which runs the binary the setting names and so fails again in
    // the same words.
    const third = await pressValidate('Validate\'s answer, a third time');
    const startMark = (await toasts(ctx.d)).length;
    const startedAgain = third !== null && await pressToastButton(ctx.d, third.message.slice(0, 40), WARNING_BUTTONS[2])
      ? await waitToast(ctx.d, 'the start the press made failing', startMark, (t) => t.severity === 'error' && t.message.startsWith(START_FAILED_OPENING), 30000).catch(() => null as Toast | null)
      : null;
    await closeAllEditors(ctx);

    const answered = [said, again, third].every((t) => t !== null && t.message === warning && t.severity === 'warning' && JSON.stringify(t.buttons) === JSON.stringify(WARNING_BUTTONS));
    const v = kept.held ? first : (kept.broke ?? first);
    stoppedNote = `the start failed with ${told === null ? 'no error notification' : `"${told.message}" (${told.severity}, ${JSON.stringify(told.buttons)})`}; enabled with the server stopped: ${JSON.stringify(v.enabled)}, greyed ${JSON.stringify(v.greyed)}; the ${DRAFT_ENTITY} row ${v.draft === null ? 'not drawn' : v.draft === '' ? 'with no reason' : `reading "${v.draft}"`}${kept.held ? `, the same for ${ABSENCE_MS} ms` : ` at ${kept.atMs} ms`}; the Catalog panel's rows carrying a description, for the control: ${JSON.stringify(first.described.slice(0, 2))}; Validate answered ${said === null ? 'nothing' : `"${said.message}" (${said.severity}, ${JSON.stringify(said.buttons)})`}; "${WARNING_BUTTONS[0]}" ${shown ? 'drew the panel showing the channel\'s line' : putAway ? 'did not draw the panel showing the channel\'s line' : 'was not pressed, the panel not being put away first'}; "${WARNING_BUTTONS[1]}" ${screen === null ? 'drew no settings screen' : `opened the settings screen searching "${screen.search}" and drawing ${JSON.stringify(screen.keys)}`}; "${WARNING_BUTTONS[2]}" ${startedAgain === null ? 'raised no failed start' : `started the server, which answered "${startedAgain.message}"`}`;
    return {
      passed: first.greyed.length === 0 && first.draft === '' && kept.held
        && told !== null && told.message === failedStart && told.buttons.includes(OPEN_BINARY_PATH_SETTING)
        && answered && shown && opened && startedAgain !== null && startedAgain.message === failedStart,
      seen: stoppedNote,
    };
  });

  await c.forPerson(ENABLED_BUT_INERT, async () => {
    need(stoppedNote !== '', 'the server was not stopped above');
    await run(ctx, 'workbench.view.extension.aggrega');
    return { screenshot: await capture(ctx, 'commands-panel-server-stopped'), drawnText: stoppedNote };
  });
}
