// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { SEEDING_SUBJECT } from '../../src/config-seeding';
import { CONFIG_WRITE_DESTINATIONS } from '../../src/config-write-scope';
import { REGISTRATION_DESTINATION_PROMPT, REGISTRATION_SUBJECT, trustByHandTitle } from '../../src/registry-configure';
import { CONFIG_FILENAME } from '../../src/workspace';
import { need } from './checks';
import { makeScratchHome, runCompiler } from './cli';
import { AGGREGA_BINARY_SETTING } from './editor';
import { WORKSPACE_ANCHOR_ONLY } from './fixtures';
import {
  changeWindow, CHOOSE_FOLDER_PLACEHOLDER, chooser, Chooser, closeChooser, LEVEL_OBSERVERS, NAME_PROMPT, NOTHING_TO_CHOOSE, pasteIntoChooser, PickerSeen, pickersSeen, pressChooserButton,
  readyAnyway, serverIn, takeChooserRow, ToastLedger, waitChooser, waitRows,
} from './levels';
import { referenceAnswer } from './reference';
import { ScratchRegistry } from './registry';
import { capture, commandTitle, languageServers, open, reopen, run, send, SuiteContext } from './suite-context';
import { closePalette, paletteTitle } from './suite-first-day';
import { manifestVersionOf, openSettingsOn, settingLabel, settingValue } from './suite-gateway';
import { ADD_REGISTRY_TITLE, entryFor, globalConfiguration } from './suite-registry';
import {
  COMPILER_READING, describeReadings, describeSteps, dismissedNotice, drawnValue, EXTENSION_READING, FOOT_BOX, FOOT_WORDS, FOOT_WORDS_NO_FOOT_CARRIES, FOOT_WORDS_SELECTOR, frontPage,
  houseHover, houseTitle, markSteps, noPage, NONE_AVAILABLE, NONE_SELECTED, NOT_READ_YET, observePage, observeStatusText, PAGE_HEADING, PAGE_TITLE, pageNow, pageReadings, PageSeen, pageTabs,
  pressHouse, pressOnPage, pressWayThrough, readPage, registriesListed, runningAgain, samePage, SecondCompiler, SELECTED_LEAD, STANDING_MET, STANDING_TO_DO, statusMark, statusTexts,
  STEP_IDS, stepOf, stepsDrawnAgain, TabSeen, tabs, VERSION_NOT_REPORTED, WAYS_THROUGH, wayThroughChooser, WELCOME_OPEN_COMMAND, WELCOME_SHOW_SETTING, welcomePage, welcomePages,
  clearForCapture, commandsTitleActions,
} from './welcome';
import {
  commandsPanel, holds, NOT_RUNNING, paletteRows, pickQuickInputRow, pressIn, quickInput, RUNNING, statusItems, statusLog, Toast, toasts, toastsSince, until, waitQuickInput, waitStatus,
  waitToast,
} from './workbench';

// The checks run in an empty folder no workspace marker reaches, the one a reader
// with nothing configured opens: the welcome page opening there by itself, in a
// tab of its own; what each of its steps says and stands at before anything is
// set up; the words of the step that anchors a workspace; that it offers no way
// back to the editor's own welcome page, and that page carries no entry of this
// extension's; each of the page's ways through pressed in turn — the configuration
// written, a Release drafted, a registry seeded, the hub's seeding refused over a
// configuration already there, a registry added beside it and the add backed out
// of, a compiler of the reader's own chosen — with the versions at the foot
// following the compiler the language server runs; the switch at the foot, the
// palette's two commands and the settings screen moving one preference; the house
// on the Commands panel; and, last, a folder recognised beneath the one open taken
// as the workspace.

export const WELCOME_EMPTY_FOLDER_CHECKS = [
  'welcome-page.opens-by-itself-on-a-fresh-profile',
  'welcome-page.is-a-tab-of-its-own',
  'empty-folder.rows-read-no-workspace-and-no-server-runs',
  'welcome-page.every-step-offers-its-ways-through',
  'welcome-page.foot-checkbox-reports-the-preference',
  'welcome-page.values-say-in-words-that-nothing-is-chosen',
  'welcome-page.compiler-version-reads-not-reported-with-no-server',
  'welcome-page.workspace-step-names-the-rows-it-points-at',
  'welcome-page.workspace-step-says-nothing-of-credentials',
  'welcome-page.workspace-step-read-by-someone-new',
  'welcome-page.offers-no-way-back',
  'editor-welcome.carries-no-aggrega-entry',
  'welcome-page.use-a-folder-with-none-recognised-says-so',
  'welcome-page.create-writes-the-file-the-step-describes',
  'welcome-page.release-step-reads-none-available-with-no-release',
  'welcome-page.draft-a-release-asks-only-for-the-name',
  'welcome-page.seed-a-named-registry-writes-the-global-file',
  'welcome-page.seeding-the-hub-over-a-file-is-refused-in-the-compilers-words',
  'welcome-page.registry-step-read-before-pressing',
  'welcome-page.add-a-registry-merges-into-the-file',
  'welcome-page.registry-step-follows-an-add-with-no-press',
  'welcome-page.add-a-registry-backed-out-writes-nothing',
  'welcome-page.foot-names-both-versions-on-one-line',
  'welcome-page.point-at-a-compiler-writes-the-setting',
  'welcome-page.compiler-version-follows-a-binary-change',
  'palette.stop-opening-says-how-to-bring-it-back',
  'welcome-page.stays-closed-on-a-reopen-when-off',
  'palette.get-started-brings-the-page-back-ticked',
  'welcome-page.foot-checkbox-untick-says-how-to-bring-it-back',
  'welcome-page.foot-checkbox-toggles-from-the-keyboard',
  'welcome-page.foot-checkbox-follows-the-settings-screen',
  'settings.screen-follows-the-foot-checkbox',
  'commands-panel.house-opens-the-page-and-leaves-the-preference',
  'commands-panel.house-brings-the-open-page-to-the-front',
  'palette.house-command-is-not-listed',
  'welcome-page.use-a-folder-takes-one-recognised-beneath',
] as const;

// The words a reader is to meet, held as written.
export const ROW_NONE_AVAILABLE = 'none available';
const SEEDING_REFUSED = `${SEEDING_SUBJECT} did not complete: `;
const SHOW_OUTPUT = 'Show output';
// HOST_PROMPT is the prompt for a host, which names the official hub as its
// example; ADD_DESTINATIONS are the files it offers next, in the order the product
// declares them, the global one first.
export const HOST_PROMPT = 'Host of the registry to register, such as hub.aggrega.ai';
const ADD_DESTINATIONS: readonly string[] = CONFIG_WRITE_DESTINATIONS.map((d) => d.label);

// SETTLE_MS is how long a reading is watched holding, or a window watched for
// something that is not to happen.
const SETTLE_MS = 3000;
const CLOSED_WINDOW_MS = 10000;

const SHOW_SETTING = WELCOME_SHOW_SETTING;
const BINARY_SETTING = AGGREGA_BINARY_SETTING;

// The hosts the add registers: loopback ports nothing listens on, so the trust
// policy each is asked for is refused on this machine and never leaves it.
const ADDED_HOST = 'localhost:1';
const BACKED_OUT_HOST = 'localhost:2';

// RECOGNISED_BENEATH is the folder written beneath the one open, marked as a
// workspace root, for the last check.
const RECOGNISED_BENEATH = 'recognised';

interface Inspected { value: unknown; defaultValue?: unknown; globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown }

// settingInEveryScope reads a setting in every scope the editor keeps, its default
// included. It sits beside `settingValue` (suite-gateway.ts), which every other
// reading here uses, because that one answers the value and two scopes and drops
// the default and the folder scope the first check reads.
async function settingInEveryScope(ctx: SuiteContext, key: string): Promise<Inspected> {
  const r = await ctx.probe.request<{ value: unknown; inspect: Inspected | null }>('configuration.inspect', { key });
  return { ...(r.inspect ?? { value: undefined }), value: r.value };
}

// PageAdd is what one add made from the page drew and ended in: the prompt for the
// host, the choice of file, whether a question for a trust policy followed (pressed
// away where it did), the ending, the quick inputs the picker observer recorded
// from the press on (none where the scenario installs no such observer), and what
// the status bar read from the press until the restarted language server read
// running again, or, where it did not within the bound, what it read until then.
export interface PageAdd {
  prompt: Chooser | null; destination: Chooser | null; question: boolean; ending: Toast | null; pickers: PickerSeen[];
  server: { back: boolean; readings: string };
}

// addFromThePage presses the page's "Add a registry to what I have", gives the host
// its prompt asks for, takes the first file the next choice offers, presses away a
// question for a trust policy where one follows the ending, waits for the language
// server the write restarts to read running again, and answers with what it met.
export async function addFromThePage(ctx: SuiteContext, host: string): Promise<PageAdd> {
  const mark = (await toasts(ctx.d)).length;
  const pickMark = (await pickersSeen(ctx.d)).length;
  const statusAt = await statusMark(ctx);
  const pickers = async (): Promise<PickerSeen[]> => (await pickersSeen(ctx.d)).slice(pickMark);
  const none = { back: false, readings: '' };
  const prompt = await wayThroughChooser(ctx, 'registry', WAYS_THROUGH.registry[2], (c) => c.title === ADD_REGISTRY_TITLE && c.rows.length === 0).then((x) => x.chooser, () => null);
  if (prompt === null) { return { prompt, destination: null, question: false, ending: null, pickers: await pickers(), server: none }; }
  await ctx.d.type(host);
  await ctx.d.press('Enter');
  const destination = await waitChooser(ctx.d, 'the choice of configuration file', (c) => c.title !== ADD_REGISTRY_TITLE && c.rows.length > 0, 10000).catch(() => null);
  if (destination === null) { return { prompt, destination, question: false, ending: null, pickers: await pickers(), server: none }; }
  await pickQuickInputRow(ctx.d, destination.rows[0].label);
  const ending = await waitToast(ctx.d, 'the registration ending', mark, (t) => t.message.startsWith(`${REGISTRATION_SUBJECT} `), 60000).catch(() => null);
  const question = await until('a question for a trust policy', 5000, () => chooser(ctx.d), (c) => c !== null && c.title === trustByHandTitle(host)).then(() => true, () => false);
  if (question) { await closeChooser(ctx.d); }
  const readSince = async (): Promise<string> => describeReadings((await statusLog(ctx.d)).slice(statusAt));
  const server = ending === null ? { back: false, readings: await readSince() } : await runningAgain(ctx, statusAt, 60000)
    .then((v) => ({ back: true, readings: describeReadings(v) }), async () => ({ back: false, readings: `${await readSince()}, not running again within 60000 ms` }));
  return { prompt, destination, question, ending, pickers: await pickers(), server };
}

// registeredIn says, for each host named, whether the configuration file holds an
// entry for it.
function registeredIn(file: string, hosts: readonly string[]): Record<string, boolean> {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  return Object.fromEntries(hosts.map((h) => [h, entryFor(text, h) !== null]));
}

// editorsWelcomeTabs are the tabs of the editor's own welcome page among `t`.
function editorsWelcomeTabs(t: readonly TabSeen[]): TabSeen[] {
  return t.filter((x) => x.label !== PAGE_TITLE && /^Welcome\b/.test(x.label));
}

async function paletteOffers(ctx: SuiteContext, query: string): Promise<string[]> {
  const q = await paletteRows(ctx.d, (cmd) => send(ctx, cmd), query);
  const labels = q.rows.map((r) => r.label);
  await closePalette(ctx);
  return labels;
}

export async function welcomeEmptyFolderChecks(ctx: SuiteContext, opts: { registry: ScratchRegistry; second: SecondCompiler; beside: string }): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  const base = path.basename(ctx.folder);
  const global = globalConfiguration(ctx.home);
  const getStarted = paletteTitle(ctx, 'aggrega.getStarted.show');
  const stopOpening = paletteTitle(ctx, 'aggrega.getStarted.dismiss');

  // ---- the page arriving by itself -------------------------------------------------
  const t0 = Date.now();
  let arrivedMs = -1;
  await c.run('welcome-page.opens-by-itself-on-a-fresh-profile', {
    expected: `on a fresh profile, with nothing pressed, the welcome page is drawn in a window opened on a folder holding nothing at all; ${SHOW_SETTING} carries no value of its own in any scope and its default is true`,
    plant: 'in the scratch copy\'s package.json, the preference declared off by default',
  }, async () => {
    const page = await welcomePage(ctx, 60000);
    arrivedMs = Date.now() - t0;
    const held = fs.readdirSync(ctx.folder);
    const s = await settingInEveryScope(ctx, SHOW_SETTING);
    const unset = s.globalValue === undefined && s.workspaceValue === undefined && s.workspaceFolderValue === undefined;
    return {
      passed: held.length === 0 && s.defaultValue === true && unset && (await readPage(page)).heading !== '',
      seen: `drawn ${arrivedMs} ms after the scenario began (bring-up ${ctx.s.bringUpMs} ms), with the folder holding ${JSON.stringify(held)}; the preference reads ${JSON.stringify(s)}`,
    };
  });
  await readyAnyway(ctx);

  await c.run('welcome-page.is-a-tab-of-its-own', {
    expected: `the page is a tab of its own in the editor area, labelled "${PAGE_TITLE}", headed "${PAGE_HEADING}", and in front; a file opened while it is there becomes the active editor while the page keeps its tab, so nothing has to be dismissed to look at a file; no tab of the editor's own welcome page is drawn at first nor over ${SETTLE_MS} ms after the file opens; the same reading of the tabs finds that page's tab once it is opened, later in this scenario`,
    plant: 'in the scratch copy, out/src/get-started-steps.js with the page\'s tab titled "Welcome"',
  }, async () => {
    const page = await pageNow(ctx);
    const first = await tabs(ctx);
    const own = first.filter((t) => t.label === PAGE_TITLE);
    const opened = await open(ctx, opts.beside);
    const after = await tabs(ctx);
    const editorsOwn = await holds(SETTLE_MS, async () => editorsWelcomeTabs(await tabs(ctx)), (t) => t.length === 0);
    await run(ctx, 'workbench.action.closeActiveEditor');
    return {
      passed: own.length === 1 && own[0].active && page.heading === PAGE_HEADING && opened.path === opts.beside && after.some((t) => t.label === PAGE_TITLE && !t.active)
        && editorsWelcomeTabs(first).length === 0 && editorsOwn.held,
      seen: `tabs at first ${JSON.stringify(first.map((t) => `${t.label}${t.active ? ' (active)' : ''}`))}; heading "${page.heading}"; after opening ${path.basename(opts.beside)} the active editor is ${opened.path} and the tabs read ${JSON.stringify(after.map((t) => `${t.label}${t.active ? ' (active)' : ''}`))}; ${editorsOwn.held ? `no tab of the editor's own welcome page at any of ${editorsOwn.readings} readings over ${SETTLE_MS} ms` : `the editor's own welcome page's tab ${JSON.stringify(editorsOwn.broke)} drawn ${editorsOwn.atMs} ms in`}`,
    };
  });

  // ---- the folder, before anything is set up ----------------------------------------
  await c.run('empty-folder.rows-read-no-workspace-and-no-server-runs', {
    expected: `opened on the empty folder, the Project folder row reads "${base}", the Aggrega workspace row reads "${ROW_NONE_AVAILABLE}", the status bar reads "${NOT_RUNNING}", and the process table holds no language server started from the binary under test at any reading over ${SETTLE_MS} ms; the same reading of the process table finds one once the folder is anchored, later in this scenario`,
    plant: 'in the scratch copy, out/src/selector-rows.js with a project reaching no Aggrega workspace read as one holding several with none chosen',
  }, async () => {
    const rows = await waitRows(ctx, 'the rows naming the folder and no workspace', (r) => r.length >= 2 && r[0].value === base && r[1].value === ROW_NONE_AVAILABLE, 10000);
    const status = (await statusItems(ctx.d)).map((i) => i.text);
    const servers = await holds(SETTLE_MS, async () => languageServers(ctx).length, (n) => n === 0);
    return {
      passed: rows[0]?.value === base && rows[1]?.value === ROW_NONE_AVAILABLE && status.includes(NOT_RUNNING) && servers.held,
      seen: `rows ${JSON.stringify(rows.slice(0, 3).map((r) => `${r.label}: ${r.value}`))}; status bar ${JSON.stringify(status.filter((t) => t !== ''))}; ${servers.held ? `no language server in the process table at any of ${servers.readings} readings over ${SETTLE_MS} ms` : `${servers.broke} language server(s) in the process table ${servers.atMs} ms in`}`,
    };
  });

  // ---- the steps as drawn, before anything is set up ---------------------------------
  await c.run('welcome-page.every-step-offers-its-ways-through', {
    expected: `the page lists four steps, in the order ${STEP_IDS.join(', ')}, each drawing its ways through in this order: ${STEP_IDS.map((id) => `${id} ${JSON.stringify(WAYS_THROUGH[id])}`).join('; ')}`,
    plant: 'in the scratch copy, out/src/get-started-steps.js with the compiler step offering one way through',
  }, async () => {
    const page = await pageNow(ctx);
    const ids = page.steps.map((s) => s.id);
    const drawn = page.steps.map((s) => ({ id: s.id, labels: s.actions.map((a) => a.label), all: s.actions.every((a) => a.drawn) }));
    const passed = JSON.stringify(ids) === JSON.stringify(STEP_IDS) && drawn.every((d) => d.all && JSON.stringify(d.labels) === JSON.stringify(WAYS_THROUGH[d.id]));
    return { passed, seen: `steps ${JSON.stringify(drawn)}` };
  });

  await c.run('welcome-page.foot-checkbox-reports-the-preference', {
    expected: `below the four steps and outside their list, the foot draws one checkbox whose words, bound to it as its label, read "${FOOT_WORDS}"; ticked on a profile that has never moved the preference; the box and its words centred as a pair on the page's axis; and at no reading over ${SETTLE_MS} ms does the page draw the words ${FOOT_WORDS_NO_FOOT_CARRIES.map((w) => `"${w}"`).join(' or ')}, each of those readings finding the foot's own words`,
    plant: 'in the scratch copy, out/src/welcome-render.js with the words at the foot not bound to the checkbox',
  }, async () => {
    await frontPage(ctx);
    const page = await pageNow(ctx);
    const f = page.foot;
    const offCentre = Math.abs(f.pairCentre - page.pageCentre);
    const words = async (): Promise<{ own: boolean; offered: string[] }> => {
      const t = (await pageNow(ctx)).text;
      return { own: t.includes(FOOT_WORDS), offered: FOOT_WORDS_NO_FOOT_CARRIES.filter((w) => t.includes(w)) };
    };
    const watched = await holds(SETTLE_MS, words, (v) => v.own && v.offered.length === 0);
    return {
      passed: f.checkboxes === 1 && f.bound && f.words === FOOT_WORDS && f.checked === true && !f.amongSteps && f.top > page.stepsBottom && offCentre <= 2 && watched.held,
      seen: `${f.checkboxes} checkbox(es), words ${JSON.stringify(f.words)} ${f.bound ? 'bound as its label' : 'not bound to it'}, ${f.checked ? 'ticked' : 'not ticked'}, ${f.amongSteps ? 'among the steps' : 'outside the steps'}, its top ${f.top.toFixed(1)} against the steps' bottom ${page.stepsBottom.toFixed(1)}, the pair centred ${offCentre.toFixed(1)} px off the page's axis; ${watched.held ? `the foot's words and no word offering an act at each of ${watched.readings} readings over ${SETTLE_MS} ms` : `at ${watched.atMs} ms the page read ${JSON.stringify(watched.broke)}`}`,
    };
  });

  await c.run('welcome-page.values-say-in-words-that-nothing-is-chosen', {
    expected: `with nothing set up, each step draws what it stands at once: the workspace step "${NONE_AVAILABLE}" (no folder here is one Aggrega recognises), the Release step "${NONE_SELECTED}" (nothing has read what is on offer), the registry step "${NOT_READ_YET}" (no compiler is answering), each as a sentence in italic with no "${SELECTED_LEAD.trim()}"; and the compiler step "${SELECTED_LEAD}" followed by ${BINARY_SETTING} exactly as the setting holds it`,
    plant: 'in the scratch copy, out/src/get-started-steps.js with a level holding nothing read as one where nothing is chosen, and the other way round',
  }, async () => {
    const page = await pageNow(ctx);
    const setting = await settingValue(ctx, BINARY_SETTING);
    const want: Record<string, { text: string; absent: boolean }> = {
      workspace: { text: NONE_AVAILABLE, absent: true },
      compiler: { text: `${SELECTED_LEAD}${String(setting.value)}`, absent: false },
      release: { text: NONE_SELECTED, absent: true },
      registry: { text: NOT_READ_YET, absent: true },
    };
    const read = STEP_IDS.map((id) => ({ id, value: drawnValue(stepOf(page, id)) }));
    const ok = read.every((r) => r.value !== null && r.value.text === want[r.id].text && r.value.absent === want[r.id].absent && (r.value.absent ? r.value.lead === null : r.value.lead === SELECTED_LEAD));
    return { passed: ok, seen: describeSteps(page) };
  });

  await c.run('welcome-page.compiler-version-reads-not-reported-with-no-server', {
    expected: `with no language server running, the foot reads "${EXTENSION_READING}" followed by the build stamp of the copy under test (${ctx.inputs.extension.buildStamp}) and "${COMPILER_READING}" followed by "${VERSION_NOT_REPORTED}" in italic, the label kept; the same foot names a version once a language server runs, later in this scenario`,
    plant: 'in the scratch copy, out/src/welcome-render.js with a version not reported drawn as a value is',
  }, async () => {
    const v = (await pageNow(ctx)).versions;
    return {
      passed: v.length === 2 && v[0].label === EXTENSION_READING && v[0].value === ctx.inputs.extension.buildStamp && v[1].label === COMPILER_READING && v[1].value === VERSION_NOT_REPORTED && v[1].italic,
      seen: `the foot reads ${JSON.stringify(v.map((x) => `${x.label} ${x.value}${x.italic ? ' (italic)' : ''}`))}`,
    };
  });

  // ---- the workspace step's words ------------------------------------------------------
  await c.run('welcome-page.workspace-step-names-the-rows-it-points-at', {
    expected: 'every row of the Commands panel the workspace step\'s explanation names, in bold before the word "row", is one of the rows the panel draws, by the label it draws',
    plant: 'a correction in the scratch copy, out/src/get-started-steps.js with the row named "Aggrega workspace", turns it green',
  }, async () => {
    const doc = await welcomePage(ctx);
    const named = await doc.evaluate<string[]>(`[...document.querySelectorAll('section.step[data-step="workspace"] .step-prose strong')].filter((s) => /^\\s*row\\b/.test((s.nextSibling && s.nextSibling.textContent) || '')).map((s) => (s.textContent || '').trim())`);
    const labels = (await waitRows(ctx, 'the Commands panel\'s rows', (r) => r.length >= 3, 10000)).map((r) => r.label);
    const stray = named.filter((n) => !labels.includes(n));
    return { passed: named.length > 0 && stray.length === 0, seen: `the step names the rows ${JSON.stringify(named)}; the panel draws the rows ${JSON.stringify(labels)}${stray.length > 0 ? `; no row is labelled ${JSON.stringify(stray)}` : ''}` };
  });

  const CREDENTIAL_WORDS = /\b(credentials?|passwords?|secrets?|tokens?)\b/gi;
  await c.run('welcome-page.workspace-step-says-nothing-of-credentials', {
    expected: `the workspace step's explanation, which gives the global file on the machine its reason, names no credential, password, secret or token at any reading over ${SETTLE_MS} ms; each of those readings of the registry step's explanation finds its sentence saying a password and a token are no fields of either file`,
    plant: 'in the scratch copy, out/src/get-started-steps.js with the global file said to be there so credentials need not be committed',
  }, async () => {
    const words = async (): Promise<{ workspace: string[]; registry: string[] }> => {
      const page = await pageNow(ctx);
      return { workspace: stepOf(page, 'workspace').guidance.match(CREDENTIAL_WORDS) ?? [], registry: stepOf(page, 'registry').guidance.match(CREDENTIAL_WORDS) ?? [] };
    };
    const first = await words();
    const watched = await holds(SETTLE_MS, words, (v) => {
      const control = v.registry.map((w) => w.toLowerCase());
      return v.workspace.length === 0 && control.includes('password') && control.includes('token');
    });
    return {
      passed: watched.held,
      seen: `the workspace step names ${JSON.stringify(first.workspace)}; the registry step names ${JSON.stringify(first.registry)}; ${watched.held ? `the same at each of ${watched.readings} readings over ${SETTLE_MS} ms` : `at ${watched.atMs} ms the readings were ${JSON.stringify(watched.broke)}`}`,
    };
  });

  await c.forPerson('welcome-page.workspace-step-read-by-someone-new', {
    expected: 'from the workspace step alone a reader who has never configured Aggrega can say which file to create, where to put it and what has to be in it, and what the second, global file is called, where it lives and why it is separate',
    plant: 'none: this is a judgement of the wording',
    question: 'Reading only this step, as someone who has never configured Aggrega: can you say which file to create, where to put it and what goes in it? Can you name the global file, where it lives, and why it is separate from the project\'s? Could you have acted on the step without opening anything else?',
  }, async () => {
    await frontPage(ctx);
    const doc = await welcomePage(ctx);
    await doc.evaluate(`(() => { const s = document.querySelector('section.step[data-step="workspace"]'); if (s) { s.scrollIntoView({ block: 'start' }); } return !!s; })()`);
    const step = stepOf(await readPage(doc), 'workspace');
    const left = await clearForCapture(ctx);
    return { screenshot: await capture(ctx, 'workspace-step-read-by-someone-new'), drawnText: `${step.title}\n${step.explanation}${left}` };
  });

  await c.run('welcome-page.offers-no-way-back', {
    expected: `at every reading over ${SETTLE_MS} ms the page draws no link of any kind, and every control it draws is a step's caret, one of its steps' ways through or the checkbox at its foot, each naming a command of this extension's own — none reading "back"; each of those readings, which finds links among the controls it reads, finds the ${STEP_IDS.length} carets, the ${STEP_IDS.reduce((n, id) => n + WAYS_THROUGH[id].length, 0)} ways through and the checkbox`,
    plant: 'in the scratch copy, out/src/welcome-render.js with a link back to the editor\'s own welcome page drawn at the head of the page',
  }, async () => {
    const wantWays = STEP_IDS.reduce((n, id) => n + WAYS_THROUGH[id].length, 0);
    const look = async (): Promise<{ links: number; carets: number; ways: number; box: number; other: PageSeen['controls']; back: PageSeen['controls'] }> => {
      const page = await pageNow(ctx);
      const carets = page.controls.filter((x) => x.tag === 'button' && (STEP_IDS as readonly string[]).includes(x.toggle));
      const ways = page.controls.filter((x) => x.tag === 'button' && x.command.startsWith('aggrega.'));
      const box = page.controls.filter((x) => x.tag === 'input' && x.command.startsWith('aggrega.'));
      return {
        links: page.links, carets: carets.length, ways: ways.length, box: box.length,
        other: page.controls.filter((x) => !carets.includes(x) && !ways.includes(x) && !box.includes(x)),
        back: page.controls.filter((x) => /\bback\b/i.test(x.text)),
      };
    };
    const first = await look();
    const watched = await holds(SETTLE_MS, look, (v) => v.links === 0 && v.other.length === 0 && v.back.length === 0 && v.carets === STEP_IDS.length && v.ways === wantWays && v.box === 1);
    return {
      passed: watched.held,
      seen: `${first.links} link(s); ${first.carets} caret(s), ${first.ways} way(s) through, ${first.box} checkbox(es); anything else ${JSON.stringify(first.other)}; controls reading "back" ${JSON.stringify(first.back)}; ${watched.held ? `the same at each of ${watched.readings} readings over ${SETTLE_MS} ms` : `at ${watched.atMs} ms the page read ${JSON.stringify(watched.broke)}`}`,
    };
  });

  await c.run('editor-welcome.carries-no-aggrega-entry', {
    expected: `the editor's own welcome page, opened directly, is drawn in a tab the reading of tabs above finds, and the list of every walkthrough the editor offers holds none of Aggrega's at any reading over ${SETTLE_MS} ms; the page then names Aggrega nowhere at any reading over ${SETTLE_MS} ms, each of those readings naming every walkthrough the list offered`,
    plant: 'in the scratch copy\'s package.json, a walkthrough contributed to the editor\'s own welcome page',
  }, async () => {
    const pageText = (): Promise<string> => ctx.d.workbench<string>(`(() => { const e = document.querySelector('.gettingStartedContainer'); return e ? (e.innerText || '') : ''; })()`);
    await send(ctx, 'workbench.action.openWalkthrough');
    await until('the editor\'s own welcome page listing walkthroughs', 20000, pageText, (t) => t.includes('Walkthroughs'));
    const editors = editorsWelcomeTabs(await tabs(ctx));
    await send(ctx, 'welcome.showAllWalkthroughs');
    const list = await waitQuickInput(ctx.d, 'the list of every walkthrough', (q) => q.rows.length > 0, 10000);
    const offered = list.rows.map((r) => `${r.label} (${r.description})`);
    const listWatched = await holds(SETTLE_MS, async () => ((await quickInput(ctx.d))?.rows ?? []).map((r) => `${r.label} (${r.description})`), (rows) => rows.length > 0 && !rows.some((r) => /aggrega/i.test(r)));
    await ctx.d.press('Escape');
    await until('the list closing', 5000, () => chooser(ctx.d), (x) => x === null).catch(() => undefined);
    const names = list.rows.map((r) => r.label);
    const first = await pageText();
    const pageWatched = await holds(SETTLE_MS, pageText, (t) => !/aggrega/i.test(t) && names.every((n) => t.includes(n)));
    for (const t of editorsWelcomeTabs(await tabs(ctx))) { await ctx.d.click(t.centre); await run(ctx, 'workbench.action.closeActiveEditor'); }
    return {
      passed: editors.length > 0 && offered.length > 0 && listWatched.held && pageWatched.held,
      seen: `the editor's own welcome page's tab ${editors.length > 0 ? JSON.stringify(editors.map((t) => t.label)) : 'not found by the reading of tabs'}; every walkthrough offered: ${JSON.stringify(offered)}${listWatched.held ? `, the same at each of ${listWatched.readings} readings over ${SETTLE_MS} ms` : `, and at ${listWatched.atMs} ms ${JSON.stringify(listWatched.broke)}`}; the editor's welcome page reads ${JSON.stringify(first.replace(/\s+/g, ' ').slice(0, 400))}${pageWatched.held ? `, naming every walkthrough offered and not Aggrega at each of ${pageWatched.readings} readings over ${SETTLE_MS} ms` : `, and at ${pageWatched.atMs} ms ${JSON.stringify(String(pageWatched.broke).replace(/\s+/g, ' ').slice(0, 300))}`}`,
    };
  });

  // ---- the workspace step's two ways through ---------------------------------------------
  await c.run('welcome-page.use-a-folder-with-none-recognised-says-so', {
    expected: `in a window whose folders hold nothing Aggrega recognises, pressing "${WAYS_THROUGH.workspace[1]}" raises "${NOTHING_TO_CHOOSE}", which names the other way through, and draws no quick input at any reading over ${SETTLE_MS} ms; the same reading of the quick input finds the chooser this press draws once a folder beneath is recognised, last in this scenario`,
    plant: 'in the scratch copy, out/src/get-started.js with a search that recognised nothing offered as an empty chooser',
  }, async () => {
    await closeChooser(ctx.d);
    const mark = (await toasts(ctx.d)).length;
    await pressWayThrough(ctx, 'workspace', WAYS_THROUGH.workspace[1]);
    const told = await waitToast(ctx.d, 'the control answering', mark, (t) => t.message.startsWith('Aggrega:'), 15000).catch(() => null);
    const none = await holds(SETTLE_MS, () => chooser(ctx.d), (x) => x === null);
    await closeChooser(ctx.d);
    const drawn = none.broke ?? null;
    return { passed: told?.message === NOTHING_TO_CHOOSE && none.held, seen: `${told === null ? 'no notification within 15000 ms' : `"${told.message}"`}; ${none.held ? `no quick input at any of ${none.readings} readings over ${SETTLE_MS} ms` : `a quick input drawn ${none.atMs} ms in: ${JSON.stringify(drawn === null ? null : { placeholder: drawn.placeholder, rows: drawn.rows.length })}`}` };
  });

  const config = path.join(ctx.folder, CONFIG_FILENAME);
  let anchored = false;
  await c.run('welcome-page.create-writes-the-file-the-step-describes', {
    expected: `pressing "${WAYS_THROUGH.workspace[0]}" writes, into the folder open, the file the step's explanation names (${CONFIG_FILENAME}) holding three comment lines and then the block the explanation names (workspace: {}) and nothing else; on the same page, with the window not reloaded, the workspace step then reads "${STANDING_MET}" and "${SELECTED_LEAD}${ctx.folder}"; and the process table holds one language server`,
    plant: 'in the scratch copy, out/src/workspace.js with the configuration written carrying a list beneath the workspace key',
  }, async () => {
    need(!fs.existsSync(config), `${config} is already there`);
    const doc = await welcomePage(ctx);
    const token = await markSteps(doc);
    const hello = await ctx.probe.request<{ instance: string }>('hello');
    await pressWayThrough(ctx, 'workspace', WAYS_THROUGH.workspace[0]);
    await until('the configuration being written', 20000, async () => fs.existsSync(config), (v) => v);
    const running = await waitStatus(ctx.d, RUNNING, 60000).then(() => true, () => false);
    const page = await until('the workspace step reading met', 20000, () => readPage(doc), (p) => stepOf(p, 'workspace').met).catch(() => readPage(doc));
    const step = stepOf(page, 'workspace');
    const text = fs.readFileSync(config, 'utf8');
    const lines = text.split('\n');
    const shaped = lines.length === 5 && lines.slice(0, 3).every((l) => l.startsWith('#')) && lines[3] === 'workspace: {}' && lines[4] === '';
    const named = step.guidance.includes(CONFIG_FILENAME) && step.guidance.includes('workspace: {}');
    const same = (await samePage(doc, token)) && (await ctx.probe.request<{ instance: string }>('hello')).instance === hello.instance;
    const servers = languageServers(ctx).length;
    anchored = running;
    return {
      passed: shaped && named && step.badge === STANDING_MET && drawnValue(step)?.text === `${SELECTED_LEAD}${ctx.folder}` && same && running && servers === 1,
      seen: `the file holds ${JSON.stringify(text)}; the explanation ${named ? 'names' : 'does not name'} that file and block; the workspace step reads ${step.badge} with ${JSON.stringify(drawnValue(step)?.text ?? null)}; ${same ? 'the same page, no reload' : 'the page or the window was replaced'}; the status bar ${running ? 'reads running' : 'never read running'}; ${servers} language server(s)`,
    };
  });

  await c.run('welcome-page.release-step-reads-none-available-with-no-release', {
    expected: `in an Aggrega workspace holding no Release, once what is on offer has been read — the Release row reading "${ROW_NONE_AVAILABLE}" — the Release step reads "${STANDING_TO_DO}" and "${NONE_AVAILABLE}" in italic, which is nothing to choose from rather than nothing chosen, its value holding still over ${SETTLE_MS} ms`,
    plant: 'in the scratch copy, out/src/get-started-steps.js with a level holding nothing read as one where nothing is chosen, and the other way round',
  }, async () => {
    need(anchored, 'the folder was not anchored, so there is no Aggrega workspace for the Release step to read');
    const rows = await waitRows(ctx, 'the Release row reading what is on offer', (r) => r.length >= 3 && r[2].value === ROW_NONE_AVAILABLE, 15000);
    if (rows[2]?.value !== ROW_NONE_AVAILABLE) {
      return { passed: false, seen: `the Release row read "${rows[2]?.value ?? ''}" when 15000 ms had passed, never "${ROW_NONE_AVAILABLE}", so nothing came to read what is on offer` };
    }
    const doc = await welcomePage(ctx);
    const value = async (): Promise<string> => drawnValue(stepOf(await readPage(doc), 'release'))?.text ?? '';
    const settled = await until('the Release step\'s value holding still', 15000, async () => {
      const first = await value();
      const kept = await holds(SETTLE_MS, value, (v) => v === first);
      return kept.held ? first : null;
    }, (v) => v !== null).catch(() => null);
    const page = await readPage(doc);
    const step = stepOf(page, 'release');
    const v = drawnValue(step);
    return { passed: settled === NONE_AVAILABLE && step.badge === STANDING_TO_DO && v?.text === NONE_AVAILABLE && v.absent && v.lead === null, seen: `the Release row reads "${rows[2]?.value ?? ''}"; the step's value ${settled === null ? 'never held still' : `held still at ${JSON.stringify(settled)}`}; ${describeSteps(page)}` };
  });

  await c.run('welcome-page.draft-a-release-asks-only-for-the-name', {
    expected: `pressing "${WAYS_THROUGH.release[0]}" opens the drafting flow with the kind already settled: the first quick input drawn after the press asks only for a name, its prompt reading "${NAME_PROMPT}", with no list of kinds before it; the check then closes it with Escape`,
    plant: 'in the scratch copy, out/src/get-started.js with the drafting of a Release opened with no kind settled',
  }, async () => {
    need(anchored, 'the folder was not anchored, so no language server answers the drafting');
    await closeChooser(ctx.d);
    const mark = (await pickersSeen(ctx.d)).length;
    // The press accepts either of the two quick inputs the drafting can open first
    // — the prompt for a name, or a list of kinds awaiting a choice, which carries
    // its placeholder from the moment it is drawn and its entries only once they
    // are read — because which one opens first is the verdict: filtering on the
    // name prompt here would wait past a list of kinds instead of reporting it. No
    // quick input is drawn before the press, so the one accepted is the press's.
    const opened = await wayThroughChooser(ctx, 'release', WAYS_THROUGH.release[0], (x) => x.message.startsWith(NAME_PROMPT) || x.placeholder !== '');
    const since = async (): Promise<PickerSeen[]> => (await pickersSeen(ctx.d)).slice(mark);
    const first = await until('a quick input recorded since the press', 10000, since, (v) => v.length > 0);
    const named = await until('the name prompt among the quick inputs recorded since the press', 3000, since, (v) => v.some((p) => p.message.includes(NAME_PROMPT))).then(() => true, () => false);
    const all = await since();
    await closeChooser(ctx.d);
    return {
      passed: first[0].message.startsWith(NAME_PROMPT) && first[0].rows === 0,
      seen: `the quick inputs drawn after ${opened.presses} press(es): ${JSON.stringify(all)}; ${named ? 'the name prompt among them' : 'no name prompt among them within 3000 ms of the first'}`,
    };
  });

  // ---- the registry step's three ways through ------------------------------------------
  const host = opts.registry.host;
  let seeded = false;
  await c.run('welcome-page.seed-a-named-registry-writes-the-global-file', {
    expected: `on a machine with no global configuration file, pressing "${WAYS_THROUGH.registry[1]}" and giving it the suite's scratch registry (${host}) ends in a notification opening "${SEEDING_SUBJECT} registered ${host} in ${global}", the file it wrote; that file names the host; and the registry step reads "${STANDING_MET}" and "${SELECTED_LEAD}${host}"`,
    plant: 'in the scratch copy, out/src/get-started.js with the seeding registering another host than the one named',
  }, async () => {
    need(anchored, 'the folder was not anchored, so no language server answers the seeding');
    need(!fs.existsSync(global), `${global} is already there`);
    const mark = (await toasts(ctx.d)).length;
    const pickMark = (await pickersSeen(ctx.d)).length;
    const asked = await wayThroughChooser(ctx, 'registry', WAYS_THROUGH.registry[1], (x) => x.rows.length === 0 && x.title !== '').catch(async (err: unknown) => {
      throw new Error(`${err instanceof Error ? err.message : String(err)}; the quick inputs drawn since the press ${JSON.stringify((await pickersSeen(ctx.d)).slice(pickMark))}`);
    });
    const prompt = asked.chooser;
    await ctx.d.type(host);
    await ctx.d.press('Enter');
    const ending = await waitToast(ctx.d, 'the seeding ending', mark, (t) => t.message.startsWith(`${SEEDING_SUBJECT} `), 60000).catch(() => null);
    const page = await until('the registry step reading met', 20000, () => pageNow(ctx), (p) => stepOf(p, 'registry').met).catch(() => pageNow(ctx));
    const step = stepOf(page, 'registry');
    const held = registeredIn(global, [host]);
    seeded = held[host];
    return {
      passed: ending !== null && ending.message.startsWith(`${SEEDING_SUBJECT} registered ${host} in ${global}`) && seeded && step.badge === STANDING_MET && drawnValue(step)?.text === `${SELECTED_LEAD}${host}`,
      seen: `the prompt ${JSON.stringify({ title: prompt.title, placeholder: prompt.placeholder })}, opened by ${asked.presses} press(es); ${ending === null ? 'no ending within 60000 ms' : `"${ending.message}"`}; ${global} holds an entry for ${JSON.stringify(held)}; the registry step reads ${step.badge} with ${JSON.stringify(drawnValue(step)?.text ?? null)}`,
    };
  });

  await c.run('welcome-page.seeding-the-hub-over-a-file-is-refused-in-the-compilers-words', {
    expected: `with that global file there, pressing "${WAYS_THROUGH.registry[0]}" ends in an error notification reading "${SEEDING_REFUSED}" followed by the server's own refusal of the same request, taken outside the editor over a copy of the same file, with a "${SHOW_OUTPUT}" button; and the file is left byte for byte as it was`,
    plant: 'in the scratch copy, out/src/operation-outcome.js with a refusal ending in the subject alone and none of the compiler\'s words',
  }, async () => {
    need(seeded, 'no global configuration file was written, so there is nothing for the seeding to be refused over');
    const before = fs.readFileSync(global);
    const refHome = makeScratchHome(path.join(ctx.s.root.dir, 'reference-homes', 'seed-the-hub'));
    const refFile = globalConfiguration(refHome);
    fs.mkdirSync(path.dirname(refFile), { recursive: true });
    fs.copyFileSync(global, refFile);
    const answer = await referenceAnswer({ binary: bin, root: ctx.folder, method: 'aggrega/configInit', params: {}, home: refHome, table: ctx.s.table, log: ctx.cliLog });
    if (answer.ok) {
      // A refusal is what the step expects, so a server that seeds instead fails
      // the check rather than leaving it unrun; the page is then not pressed,
      // because seeding the hub would reach it over the network.
      return { passed: false, seen: `the server seeded the hub over a copy of the file rather than refusing, so the page was not pressed: ${JSON.stringify(answer).slice(0, 300)}` };
    }
    const expected = `${SEEDING_REFUSED}code=${String(answer.error.code)} ${answer.error.message.split(refFile).join(global)}`;
    const mark = (await toasts(ctx.d)).length;
    await pressWayThrough(ctx, 'registry', WAYS_THROUGH.registry[0]);
    const told = await waitToast(ctx.d, 'the seeding ending', mark, (t) => t.message.startsWith(`${SEEDING_SUBJECT} `), 60000).catch(() => null);
    const kept = fs.readFileSync(global).equals(before);
    return {
      passed: told !== null && told.message === expected && told.severity === 'error' && told.buttons.includes(SHOW_OUTPUT) && kept,
      seen: `${told === null ? 'no ending' : `"${told.message}" (${told.severity}, buttons ${JSON.stringify(told.buttons)})`}; the server's own refusal, with the copy's path written as the file's: "${expected}"; the file ${kept ? 'unchanged' : 'changed'}`,
    };
  });

  await c.forPerson('welcome-page.registry-step-read-before-pressing', {
    expected: 'from the registry step\'s words a reader can tell which of its three ways through is theirs: seeding is for a machine with no configuration file yet, and declines where one is there; the add is the one for a machine that has one, and merges into it',
    plant: 'none: this is a judgement of the wording',
    question: 'Reading this step before pressing anything, on a machine that already has a configuration file: can you tell which of the three buttons is yours? Does any sentence say seeding replaces a file, or that the way past its refusal is at the command line?',
  }, async () => {
    await frontPage(ctx);
    const doc = await welcomePage(ctx);
    await doc.evaluate(`(() => { const s = document.querySelector('section.step[data-step="registry"]'); if (s) { s.scrollIntoView({ block: 'start' }); } return !!s; })()`);
    const step = stepOf(await readPage(doc), 'registry');
    const left = await clearForCapture(ctx);
    return { screenshot: await capture(ctx, 'registry-step-read-before-pressing'), drawnText: `${step.title}\n${step.explanation}${left}` };
  });

  let added: PageAdd | null = null;
  let addedAt = 0;
  let addWatch = '';
  await c.run('welcome-page.add-a-registry-merges-into-the-file', {
    expected: `pressing "${WAYS_THROUGH.registry[2]}" opens a prompt titled "${ADD_REGISTRY_TITLE}" reading "${HOST_PROMPT}"; given ${ADDED_HOST}, a choice whose placeholder reads "${REGISTRATION_DESTINATION_PROMPT}" offering ${ADD_DESTINATIONS.map((d) => `"${d}"`).join(' then ')}; taking the first ends in a registration naming ${global}; the Registries panel then lists ${ADDED_HOST} with nothing pressed there; and the file holds ${ADDED_HOST} beside ${host}`,
    plant: 'in the scratch copy, out/src/config-write-scope.js with the project\'s own file offered first',
  }, async () => {
    need(seeded, 'no global configuration file was written, so there is nothing for the add to merge into');
    addWatch = await observePage(await welcomePage(ctx));
    added = await addFromThePage(ctx, ADDED_HOST);
    addedAt = added.ending?.at ?? Date.now();
    const listed = await until(`the Registries panel listing ${ADDED_HOST}`, 20000, () => registriesListed(ctx), (v) => v.includes(ADDED_HOST)).catch(() => registriesListed(ctx));
    const held = registeredIn(global, [ADDED_HOST, host]);
    const a = added;
    return {
      passed: a.prompt !== null && a.prompt.message.startsWith(HOST_PROMPT) && a.destination !== null && a.destination.placeholder === REGISTRATION_DESTINATION_PROMPT
        && JSON.stringify(a.destination.rows.map((r) => r.label)) === JSON.stringify(ADD_DESTINATIONS)
        && a.ending !== null && a.ending.message.startsWith(`${REGISTRATION_SUBJECT} registered ${ADDED_HOST} in ${global}`) && listed.includes(ADDED_HOST) && held[ADDED_HOST] && held[host],
      seen: `the prompt ${a.prompt === null ? 'not drawn' : JSON.stringify({ title: a.prompt.title, message: a.prompt.message })}; the choice ${a.destination === null ? 'not drawn' : JSON.stringify({ placeholder: a.destination.placeholder, rows: a.destination.rows.map((r) => r.label) })}; ${a.question ? 'a question for a trust policy followed and was pressed away' : 'no question followed'}; ${a.ending === null ? 'no ending within 60000 ms' : `"${a.ending.message}"`}; the status bar read ${a.server.readings} from the press; the Registries panel lists ${JSON.stringify(listed)}; the file holds an entry for ${JSON.stringify(held)}`,
    };
  });

  await c.run('welcome-page.registry-step-follows-an-add-with-no-press', {
    expected: `within 20000 ms of the add's ending, with nothing pressed on the page, the registry step reads "${STANDING_MET}" and "${SELECTED_LEAD}" followed by every host the configuration names, in the order the compiler lists them, joined by ", "`,
    plant: 'in the scratch copy, out/src/get-started.js with the page left unread when the language server comes back up',
  }, async () => {
    need(added !== null && (added as PageAdd).ending !== null, 'the add did not end, so there is nothing for the step to follow');
    const listing = await runCompiler(bin, ['registry', 'list'], { cwd: ctx.folder, home: ctx.home, boundMs: 30000, log: ctx.cliLog });
    const order = [host, ADDED_HOST].filter((h) => listing.stdout.includes(h)).sort((a, b) => listing.stdout.indexOf(a) - listing.stdout.indexOf(b));
    const want = `${SELECTED_LEAD}${order.join(', ')}`;
    const doc = await welcomePage(ctx);
    await until('the registry step naming every host', Math.max(0, addedAt + 20000 - Date.now()), async () => stepOf(await readPage(doc), 'registry'), (s) => drawnValue(s)?.text === want).catch(() => undefined);
    const log = await pageReadings(doc, addWatch);
    const moved = log.find((r) => r.at >= addedAt - 5000 && (r.steps.find((s) => s.id === 'registry')?.value ?? '') === want);
    const now = stepOf(await readPage(doc), 'registry');
    return {
      passed: order.length === 2 && moved !== undefined && moved.at - addedAt <= 20000 && now.badge === STANDING_MET && drawnValue(now)?.text === want,
      seen: `the compiler lists ${JSON.stringify(order)}; ${moved === undefined ? `the step did not come to read ${JSON.stringify(want)} by itself` : `it read ${JSON.stringify(want)} ${moved.at - addedAt} ms after the ending`}; now ${now.badge} with ${JSON.stringify(drawnValue(now)?.text ?? null)}; the status bar read ${(added as PageAdd).server.readings} from the add's press`,
    };
  });

  await c.run('welcome-page.add-a-registry-backed-out-writes-nothing', {
    expected: `pressing "${WAYS_THROUGH.registry[2]}" and pressing Escape at its prompt draws no choice of file; pressing it again, giving ${BACKED_OUT_HOST} and pressing Escape at the choice of file ends in no registration; watched ${SETTLE_MS} ms after each, the global file is left byte for byte as it was; the add before this check drew the choice of file and its ending, read through the same two records`,
    plant: 'in the scratch copy, out/src/registries-view.js with an Escape at the choice of file read as the global file',
  }, async () => {
    const earlier = added as PageAdd | null;
    need(earlier !== null && earlier.pickers.some((p) => p.placeholder === REGISTRATION_DESTINATION_PROMPT) && earlier.ending !== null,
      'the add before this check left no choice of file in the record of quick inputs, or no ending in the record of notifications, so the readings of those records here have no control');
    const before = fs.readFileSync(global);
    const pickMark = (await pickersSeen(ctx.d)).length;
    await wayThroughChooser(ctx, 'registry', WAYS_THROUGH.registry[2], (x) => x.title === ADD_REGISTRY_TITLE);
    await ctx.d.press('Escape');
    const first = await holds(SETTLE_MS, async () => ({ pickers: (await pickersSeen(ctx.d)).slice(pickMark).filter((p) => p.placeholder === REGISTRATION_DESTINATION_PROMPT).length, same: fs.readFileSync(global).equals(before) }), (v) => v.pickers === 0 && v.same);
    const mark = (await toasts(ctx.d)).length;
    await wayThroughChooser(ctx, 'registry', WAYS_THROUGH.registry[2], (x) => x.title === ADD_REGISTRY_TITLE);
    await ctx.d.type(BACKED_OUT_HOST);
    await ctx.d.press('Enter');
    await waitChooser(ctx.d, 'the choice of configuration file', (x) => x.placeholder === REGISTRATION_DESTINATION_PROMPT, 10000);
    await ctx.d.press('Escape');
    const second = await holds(SETTLE_MS, async () => ({ endings: (await toastsSince(ctx.d, mark)).filter((t) => t.message.startsWith(`${REGISTRATION_SUBJECT} `)).length, same: fs.readFileSync(global).equals(before) }), (v) => v.endings === 0 && v.same);
    await closeChooser(ctx.d);
    const held = registeredIn(global, [BACKED_OUT_HOST]);
    return {
      passed: first.held && second.held && !held[BACKED_OUT_HOST],
      seen: `after Escape at the prompt: ${first.held ? `no choice of file and the file unchanged over ${SETTLE_MS} ms` : `broke at ${first.atMs} ms: ${JSON.stringify(first.broke)}`}; after Escape at the choice: ${second.held ? `no ending and the file unchanged over ${SETTLE_MS} ms` : `broke at ${second.atMs} ms: ${JSON.stringify(second.broke)}`}; the file holds an entry for ${JSON.stringify(held)}`,
    };
  });

  // ---- the versions at the foot, and a compiler of the reader's own ----------------------
  // The version the binary under test answers to `version -o json`, read once by
  // the runner's inputs; the second compiler's, read back by its fixture.
  const pinVersion = ctx.inputs.compiler.version;
  const manifestVersion = manifestVersionOf(ctx);
  await c.run('welcome-page.foot-names-both-versions-on-one-line', {
    expected: `with a language server running, the foot reads "${EXTENSION_READING}" then "${COMPILER_READING}" on one line centred on the page's axis, each value in the editor's fixed-width face: the build stamp of the copy under test (${ctx.inputs.extension.buildStamp}), and what the binary the language server was started from answers to \`version -o json\`, its version field (${pinVersion}); neither reads the manifest's number (${manifestVersion}), which differs from both`,
    plant: 'in the scratch copy, out/src/extension.js with the compiler reading taken from the manifest\'s number',
  }, async () => {
    need(anchored, 'no language server was started, so there is no compiler to read');
    need(manifestVersion !== ctx.inputs.extension.buildStamp && manifestVersion !== pinVersion, `the manifest's number (${manifestVersion}) equals the build stamp (${ctx.inputs.extension.buildStamp}) or the compiler's version (${pinVersion}), so a reading of it could not be told apart from either`);
    await frontPage(ctx);
    const v = await until('the compiler reading naming a version', 20000, async () => (await pageNow(ctx)).versions, (x) => x.length === 2 && x[1].value !== VERSION_NOT_REPORTED).catch(async () => (await pageNow(ctx)).versions);
    const page = await pageNow(ctx);
    const centred = v.length === 2 ? Math.abs((Math.min(v[0].left, v[1].left) + Math.max(v[0].right, v[1].right)) / 2 - page.pageCentre) : 99;
    const mono = v.every((x) => /monospace/i.test(x.valueFont));
    return {
      passed: v.length === 2 && v[0].label === EXTENSION_READING && v[0].value === ctx.inputs.extension.buildStamp && v[1].label === COMPILER_READING && v[1].value === pinVersion
        && Math.abs(v[0].top - v[1].top) < 1 && centred <= 2 && mono && !v.some((x) => x.value === manifestVersion),
      seen: `the foot reads ${JSON.stringify(v.map((x) => `${x.label} ${x.value} (${x.valueFont})`))}, their tops ${v.map((x) => x.top.toFixed(1)).join(' and ')}, the line centred ${centred.toFixed(1)} px off the page's axis`,
    };
  });

  let pointed = false;
  let pageWatch = '';
  let pointedAt = 0;
  await c.run('welcome-page.point-at-a-compiler-writes-the-setting', {
    expected: `pressing "${WAYS_THROUGH.compiler[1]}" opens a file dialog; answered with ${opts.second.path}, a second compiler reporting a version of its own, ${BINARY_SETTING} reads that path in the user settings and the compiler step's value reads "${SELECTED_LEAD}${opts.second.path}"`,
    plant: 'in the scratch copy, out/src/get-started.js with the compiler chosen written as another path',
  }, async () => {
    need(anchored, 'no language server runs, so there is no restart for the compiler reading to follow');
    await observeStatusText(ctx);
    pageWatch = await observePage(await welcomePage(ctx));
    const mark = (await pickersSeen(ctx.d)).length;
    await pressWayThrough(ctx, 'compiler', WAYS_THROUGH.compiler[1]);
    const dialog = await until('the file dialog', 10000, async () => (await pickersSeen(ctx.d)).slice(mark), (v) => v.length > 0).then((v) => v[0]);
    await pasteIntoChooser(ctx.d, opts.second.path);
    const reading = await until(`the dialog reading ${opts.second.path}`, 5000, () => chooser(ctx.d), (x) => x !== null && x.value === opts.second.path).catch(() => chooser(ctx.d));
    pointedAt = Date.now();
    await pressChooserButton(ctx.d, (reading?.buttons ?? [])[0] ?? '');
    const setting = await until('the setting naming the chosen compiler', 10000, () => settingValue(ctx, BINARY_SETTING), (s) => s.globalValue === opts.second.path).catch(() => settingValue(ctx, BINARY_SETTING));
    const step = await until('the compiler step naming it', 10000, async () => stepOf(await pageNow(ctx), 'compiler'), (s) => drawnValue(s)?.text === `${SELECTED_LEAD}${opts.second.path}`).catch(async () => stepOf(await pageNow(ctx), 'compiler'));
    pointed = setting.globalValue === opts.second.path;
    return {
      passed: pointed && drawnValue(step)?.text === `${SELECTED_LEAD}${opts.second.path}`,
      seen: `the dialog ${JSON.stringify({ title: dialog.title, buttons: reading?.buttons ?? [] })}; the setting reads ${JSON.stringify(setting.globalValue)}; the compiler step reads ${JSON.stringify(drawnValue(step)?.text ?? null)}`,
    };
  });

  await c.run('welcome-page.compiler-version-follows-a-binary-change', {
    expected: `while the status bar counts down "Aggrega: restarting in <n>s" after that choice, every reading the page draws of "${COMPILER_READING}" names the binary still running (${pinVersion}); once the status bar reads "${RUNNING}" again, within 20000 ms the reading names what the chosen binary answers to \`version -o json\` (${opts.second.version}), on the same page and with nothing pressed`,
    plant: 'in the scratch copy, out/src/extension.js with the compiler reading taken from the binary the setting names rather than the one the language server was started from',
  }, async () => {
    need(pointed, 'the compiler was not pointed at another binary, so there is no change to follow');
    const theirs = opts.second.version;
    await until('the status bar counting down and then reading running', 60000, () => statusTexts(ctx), (v) => {
      const i = v.findIndex((r) => /restarting in/.test(r.reading));
      return i >= 0 && v.slice(i + 1).some((r) => r.reading === RUNNING);
    }).catch(() => undefined);
    const doc = await welcomePage(ctx);
    await until('the compiler reading naming the chosen binary', 20000, async () => (await readPage(doc)).versions, (x) => x.length === 2 && x[1].value === theirs).catch(() => undefined);
    const status = await statusTexts(ctx);
    const countdown = status.filter((r) => /restarting in/.test(r.reading));
    const back = status.find((r) => countdown.length > 0 && r.at > countdown[countdown.length - 1].at && r.reading === RUNNING);
    const log = await pageReadings(doc, pageWatch);
    const during = countdown.length === 0 ? [] : log.filter((r) => r.at >= countdown[0].at && (back === undefined || r.at < back.at));
    const early = during.filter((r) => r.versions[1] !== `${COMPILER_READING} ${pinVersion}`);
    const after = log.find((r) => back !== undefined && r.at >= back.at && r.versions[1] === `${COMPILER_READING} ${theirs}`);
    return {
      passed: countdown.length > 0 && during.length > 0 && early.length === 0 && back !== undefined && after !== undefined && after.at - back.at <= 20000,
      seen: `the status bar read ${JSON.stringify(status.slice(-8).map((r) => r.reading))}; ${during.length} page reading(s) during the countdown, ${early.length} naming anything but ${pinVersion} (${JSON.stringify(early.map((r) => r.versions[1]))}); ${after === undefined ? `no reading named ${theirs} after the restart` : `${theirs} named ${after.at - (back?.at ?? 0)} ms after running again`}; the choice was made ${pointedAt === 0 ? '-' : `${(countdown[0]?.at ?? pointedAt) - pointedAt} ms`} before the countdown began`,
    };
  });

  // ---- the preference, from the palette ------------------------------------------------
  await c.run('palette.stop-opening-says-how-to-bring-it-back', {
    expected: `the command palette searched for "${stopOpening}" offers it; taking it raises "${dismissedNotice(getStarted)}", turns ${SHOW_SETTING} off in the user settings, and the open page's checkbox unticks`,
    plant: 'in the scratch copy\'s package.json, the command left out of the command palette',
  }, async () => {
    const offered = await paletteRows(ctx.d, (cmd) => send(ctx, cmd), stopOpening);
    const listed = offered.rows.some((r) => r.label === stopOpening);
    if (!listed) { await closePalette(ctx); }
    const mark = (await toasts(ctx.d)).length;
    if (listed) { await pickQuickInputRow(ctx.d, stopOpening); }
    const told = listed ? await waitToast(ctx.d, 'the command answering', mark, (t) => t.message.startsWith('Aggrega: the welcome page'), 15000).catch(() => null) : null;
    const s = await until('the preference reading off', 10000, () => settingValue(ctx, SHOW_SETTING), (v) => v.globalValue === false).catch(() => settingValue(ctx, SHOW_SETTING));
    const foot = await until('the checkbox unticking', 10000, async () => (await pageNow(ctx)).foot.checked, (v) => v === false).catch(async () => (await pageNow(ctx)).foot.checked);
    return {
      passed: listed && told?.message === dismissedNotice(getStarted) && s.globalValue === false && foot === false,
      seen: `the palette offers ${JSON.stringify(offered.rows.map((r) => r.label))}; ${told === null ? 'no notification' : `"${told.message}"`}; the preference ${JSON.stringify(s.globalValue)}; the checkbox ${foot ? 'ticked' : 'unticked'}`,
    };
  });

  await c.run('welcome-page.stays-closed-on-a-reopen-when-off', {
    expected: `with the preference off, the editor closed and opened again on the same folder comes up — the status bar reading "${RUNNING}" and the Commands panel drawn — and draws no welcome page over ${CLOSED_WINDOW_MS} ms, every webview document answering at each reading; the same reading found the page this scenario opened with`,
    plant: 'in the scratch copy, out/src/get-started.js with the page opened on startup whatever the preference says',
  }, async () => {
    need((await settingValue(ctx, SHOW_SETTING)).globalValue === false, 'the preference is not off');
    need(arrivedMs >= 0, 'the page did not open by itself when the scenario began, so its absence here has no control');
    const r = await reopen(ctx, LEVEL_OBSERVERS);
    await waitStatus(ctx.d, RUNNING, 90000);
    await run(ctx, 'workbench.view.extension.aggrega');
    await commandsPanel(ctx.d);
    const watched = await holds(CLOSED_WINDOW_MS, () => welcomePages(ctx), noPage, 500);
    return { passed: r.closed.stillAlive.length === 0 && watched.held, seen: `opened again in ${r.bringUpMs} ms; ${watched.held ? `no welcome page, and every document answering, at each of ${watched.readings} readings over ${CLOSED_WINDOW_MS} ms` : `${JSON.stringify(watched.broke)} ${watched.atMs} ms in`}` };
  });

  await c.run('palette.get-started-brings-the-page-back-ticked', {
    expected: `taking "${getStarted}" from the command palette opens the page, turns ${SHOW_SETTING} back on, and the page's checkbox is ticked`,
    plant: 'in the scratch copy, out/src/get-started.js with the command opening the page and leaving the preference off',
  }, async () => {
    const offered = await paletteRows(ctx.d, (cmd) => send(ctx, cmd), getStarted);
    const listed = offered.rows.some((r) => r.label === getStarted);
    if (!listed) {
      await closePalette(ctx);
      return { passed: false, seen: `the palette searched for "${getStarted}" offers ${JSON.stringify(offered.rows.map((r) => r.label))}, so there is no way back from it` };
    }
    await pickQuickInputRow(ctx.d, getStarted);
    await welcomePage(ctx, 30000);
    const s = await until('the preference reading on', 10000, () => settingValue(ctx, SHOW_SETTING), (v) => v.globalValue === true).catch(() => settingValue(ctx, SHOW_SETTING));
    const foot = await until('the checkbox ticked', 10000, async () => (await pageNow(ctx)).foot.checked, (v) => v === true).catch(async () => (await pageNow(ctx)).foot.checked);
    return { passed: s.globalValue === true && foot === true, seen: `the preference ${JSON.stringify(s.globalValue)}; the checkbox ${foot ? 'ticked' : 'unticked'}` };
  });

  // ---- the checkbox at the foot ----------------------------------------------------------
  await c.run('welcome-page.foot-checkbox-untick-says-how-to-bring-it-back', {
    expected: `pressing the words beside the ticked checkbox unticks it, raises "${dismissedNotice(getStarted)}" and turns the preference off; pressing the box then ticks it, turns the preference on and raises nothing over ${SETTLE_MS} ms; the words read "${FOOT_WORDS}" throughout, on the same page`,
    plant: 'in the scratch copy, out/src/get-started.js with the dismissal raising no notification',
  }, async () => {
    const doc = await welcomePage(ctx);
    const token = await markSteps(doc);
    need((await readPage(doc)).foot.checked === true, 'the checkbox is not ticked, the state this check starts from');
    const mark = (await toasts(ctx.d)).length;
    await pressOnPage(ctx, FOOT_WORDS_SELECTOR);
    const off = await until('the checkbox unticking', 10000, async () => (await readPage(doc)).foot, (f) => f.checked === false).catch(async () => (await readPage(doc)).foot);
    const told = await waitToast(ctx.d, 'the dismissal answering', mark, (t) => t.message.startsWith('Aggrega: the welcome page'), 15000).catch(() => null);
    const offSetting = (await until('the preference reading off', 10000, () => settingValue(ctx, SHOW_SETTING), (v) => v.globalValue === false).catch(() => settingValue(ctx, SHOW_SETTING))).globalValue;
    const mark2 = (await toasts(ctx.d)).length;
    await pressOnPage(ctx, FOOT_BOX);
    const on = await until('the checkbox ticked', 10000, async () => (await readPage(doc)).foot, (f) => f.checked === true).catch(async () => (await readPage(doc)).foot);
    const onSetting = (await until('the preference reading on', 10000, () => settingValue(ctx, SHOW_SETTING), (v) => v.globalValue === true).catch(() => settingValue(ctx, SHOW_SETTING))).globalValue;
    const quiet = await holds(SETTLE_MS, async () => (await toastsSince(ctx.d, mark2)).filter((t) => t.message.startsWith('Aggrega:')).length, (n) => n === 0);
    const same = await samePage(doc, token);
    return {
      passed: off.checked === false && told?.message === dismissedNotice(getStarted) && offSetting === false && on.checked === true && onSetting === true && quiet.held && off.words === FOOT_WORDS && on.words === FOOT_WORDS && same,
      seen: `after the words: ${off.checked ? 'ticked' : 'unticked'}, ${told === null ? 'no notification' : `"${told.message}"`}, the preference ${JSON.stringify(offSetting)}, the words ${JSON.stringify(off.words)}; after the box: ${on.checked ? 'ticked' : 'unticked'}, the preference ${JSON.stringify(onSetting)}, ${quiet.held ? 'nothing raised' : 'a notification raised'}, the words ${JSON.stringify(on.words)}; ${same ? 'the same page' : 'the page was replaced'}`,
    };
  });

  await c.run('welcome-page.foot-checkbox-toggles-from-the-keyboard', {
    expected: 'with the checkbox pressed once so it holds the focus, Space toggles it, and again, and again, the focus staying on it after each while the foot is drawn again around it',
    plant: 'a correction in the scratch copy, out/src/get-started.js with a page already open brought forward leaving the focus where it is, turns it green',
  }, async () => {
    const doc = await welcomePage(ctx);
    const focusOnBox = (): Promise<boolean> => doc.evaluate<boolean>(`(() => { const b = document.querySelector(${JSON.stringify(FOOT_BOX)}); return !!b && document.activeElement === b; })()`);
    // The foot is drawn again each time the preference moves, which replaces the
    // box; a token written on the box before a key tells the drawing apart from the
    // box the key toggled, so the focus is read on the box drawn afterwards.
    const markBox = (): Promise<string> => doc.evaluate<string>(`(() => { const b = document.querySelector(${JSON.stringify(FOOT_BOX)}); const t = String(Math.random()); if (b) { b.dataset.suiteFoot = t; } return t; })()`);
    const redrawn = (token: string): Promise<boolean> => doc.evaluate<boolean>(`(() => { const b = document.querySelector(${JSON.stringify(FOOT_BOX)}); return !b || b.dataset.suiteFoot !== ${JSON.stringify(token)}; })()`);
    let t = await markBox();
    await pressOnPage(ctx, FOOT_BOX);
    await until('the foot drawn again after the press', 10000, () => redrawn(t), (v) => v).catch(() => undefined);
    let state = (await readPage(doc)).foot.checked;
    const readings: string[] = [`pressed: ${state ? 'ticked' : 'unticked'}, focus ${await focusOnBox() ? 'on the box' : 'elsewhere'}`];
    let all = state === false;
    for (let i = 0; i < 3; i++) {
      const want = !state;
      t = await markBox();
      await ctx.d.press('Space');
      const again = await until('the foot drawn again after the key', 10000, () => redrawn(t), (v) => v).then(() => true, () => false);
      const settled = await holds(1000, async () => (await readPage(doc)).foot.checked, (v) => v === want, 100);
      const now = (await readPage(doc)).foot.checked;
      const focused = await focusOnBox();
      readings.push(`Space ${i + 1}: ${now ? 'ticked' : 'unticked'}${again ? '' : ', the foot not drawn again'}, focus ${focused ? 'on the box' : 'elsewhere'}`);
      all = all && now === want && settled.held && focused;
      state = now ?? state;
    }
    // Leave it ticked, the state the checks after this one start from.
    if ((await readPage(doc)).foot.checked !== true) { await pressOnPage(ctx, FOOT_BOX); await until('the checkbox ticked', 10000, async () => (await readPage(doc)).foot.checked, (v) => v === true).catch(() => undefined); }
    return { passed: all, seen: readings.join('; ') };
  });

  const showLabel = settingLabel(ctx.manifest.contributes.configuration.title, SHOW_SETTING);
  const SETTINGS_BOX = '.settings-editor .setting-item-bool .setting-value-checkbox';
  await c.run('welcome-page.foot-checkbox-follows-the-settings-screen', {
    expected: `with the page open and its checkbox ticked, turning "${showLabel}" off in the settings screen unticks the page's checkbox with nothing pressed on the page, and turning it back on ticks it again`,
    plant: 'in the scratch copy, out/src/get-started.js with the foot deaf to the preference moving',
  }, async () => {
    const doc = await welcomePage(ctx);
    need((await readPage(doc)).foot.checked === true, 'the checkbox is not ticked, the state this check starts from');
    await openSettingsOn(ctx, 'getStarted', showLabel);
    await pressIn(ctx.d, null, SETTINGS_BOX);
    const off = await until('the page\'s checkbox unticking', 10000, async () => (await readPage(doc)).foot.checked, (v) => v === false).catch(async () => (await readPage(doc)).foot.checked);
    await pressIn(ctx.d, null, SETTINGS_BOX);
    const on = await until('the page\'s checkbox ticked again', 10000, async () => (await readPage(doc)).foot.checked, (v) => v === true).catch(async () => (await readPage(doc)).foot.checked);
    await run(ctx, 'workbench.action.closeActiveEditor');
    return { passed: off === false && on === true, seen: `after the settings screen turned it off the page's checkbox reads ${off ? 'ticked' : 'unticked'}; after it turned it on, ${on ? 'ticked' : 'unticked'}` };
  });

  await c.run('settings.screen-follows-the-foot-checkbox', {
    expected: `unticking the page's checkbox leaves "${showLabel}" unticked in the settings screen`,
    plant: 'in the scratch copy, out/src/welcome-render.js with the checkbox at the foot running the command for the state it is not in',
  }, async () => {
    const doc = await welcomePage(ctx);
    need((await readPage(doc)).foot.checked === true, 'the checkbox is not ticked, the state this check starts from');
    await pressOnPage(ctx, FOOT_BOX);
    await until('the page\'s checkbox unticking', 10000, async () => (await readPage(doc)).foot.checked, (v) => v === false).catch(() => undefined);
    await until('the preference moving', 10000, () => settingValue(ctx, SHOW_SETTING), (v) => v.value === false).catch(() => undefined);
    const item = await openSettingsOn(ctx, 'getStarted', showLabel);
    const s = await settingValue(ctx, SHOW_SETTING);
    await run(ctx, 'workbench.action.closeActiveEditor');
    return { passed: item.checked === 'false' && s.globalValue === false, seen: `the settings screen's checkbox reads ${JSON.stringify(item.checked)}; the preference ${JSON.stringify(s)}` };
  });

  // ---- the house -------------------------------------------------------------------------
  const house = houseTitle(ctx);
  const housePalette = paletteTitle(ctx, WELCOME_OPEN_COMMAND);
  const cog = commandTitle(ctx.manifest, 'aggrega.settings.open');
  await c.run('commands-panel.house-opens-the-page-and-leaves-the-preference', {
    expected: `with the preference off and the page's tab closed, the Commands panel's title bar draws a house beside its "${cog}" cog whose tooltip reads "${house}"; pressing it opens the page in one tab of its own, its checkbox still unticked and the preference still off`,
    plant: 'in the scratch copy, out/src/get-started.js with the house turning the preference back on as it opens the page',
  }, async () => {
    need((await settingValue(ctx, SHOW_SETTING)).globalValue === false, 'the preference is not off, the state this check starts from');
    await frontPage(ctx);
    await run(ctx, 'workbench.action.closeActiveEditor');
    await until('the page closing', 10000, () => welcomePages(ctx), noPage);
    const actions = await commandsTitleActions(ctx);
    const hi = actions.findIndex((a) => a.label === house);
    const ci = actions.findIndex((a) => a.label === cog);
    const beside = hi >= 0 && ci >= 0 && Math.abs(hi - ci) === 1 && Math.abs(actions[hi].box.y - actions[ci].box.y) < 2;
    if (hi < 0) {
      return { passed: false, seen: `the title bar draws ${JSON.stringify(actions.map((a) => a.label))}, with no "${house}" to press` };
    }
    const tip = await houseHover(ctx);
    await pressHouse(ctx);
    const doc = await welcomePage(ctx, 30000);
    const ownTabs = await until('the page\'s tab', 10000, () => pageTabs(ctx), (v) => v.length > 0);
    const foot = (await readPage(doc)).foot.checked;
    const s = await settingValue(ctx, SHOW_SETTING);
    return {
      passed: beside && actions[hi].icon === 'codicon-home' && tip.includes(house) && ownTabs.length === 1 && foot === false && s.globalValue === false,
      seen: `the title bar draws ${JSON.stringify(actions.map((a) => `${a.label} (${a.icon})`))}; the tooltip reads ${JSON.stringify(tip)}; after the press ${ownTabs.length} tab(s) labelled "${PAGE_TITLE}", the checkbox ${foot ? 'ticked' : 'unticked'}, the preference ${JSON.stringify(s.globalValue)}`,
    };
  });

  await c.run('commands-panel.house-brings-the-open-page-to-the-front', {
    expected: 'with the page open behind a file\'s tab, pressing the house brings the page\'s own tab to the front — still one tab and one page, the same document — and the page reads its steps again',
    plant: 'in the scratch copy, out/src/get-started.js with an open page refreshed and left behind the tab in front',
  }, async () => {
    const doc = await welcomePage(ctx);
    const token = await markSteps(doc);
    await open(ctx, opts.beside);
    const behind = await pageTabs(ctx);
    await pressHouse(ctx);
    const front = await until('the page\'s tab coming to the front', 10000, () => pageTabs(ctx), (v) => v.length > 0 && v[0].active).catch(() => pageTabs(ctx));
    const again = await until('the steps read again', 10000, () => stepsDrawnAgain(doc, token), (v) => v).catch(() => false);
    const pages = await welcomePages(ctx);
    const same = await samePage(doc, token);
    return {
      passed: behind.length === 1 && !behind[0].active && front.length === 1 && front[0].active && pages.pages === 1 && pages.unanswered === 0 && same && again,
      seen: `before the press the page's tab ${behind.length === 1 && !behind[0].active ? 'behind' : JSON.stringify(behind)}; after it ${JSON.stringify(front.map((t) => (t.active ? 'in front' : 'behind')))}; ${pages.pages} page document(s) and ${pages.unanswered} not answering, ${same ? 'the same one' : 'not the same one'}; the steps ${again ? 'drawn again' : 'not drawn again'}`,
    };
  });

  await c.run('palette.house-command-is-not-listed', {
    expected: `the command palette searched for "${house}" offers no "${housePalette}"; the same search for "${getStarted}" offers that command`,
    plant: 'in the scratch copy\'s package.json, the house\'s command listed in the command palette',
  }, async () => {
    const forHouse = await paletteOffers(ctx, house);
    const forGetStarted = await paletteOffers(ctx, getStarted);
    return { passed: !forHouse.includes(housePalette) && forGetStarted.includes(getStarted), seen: `for "${house}" the palette offers ${JSON.stringify(forHouse)}; for "${getStarted}" ${JSON.stringify(forGetStarted)}` };
  });

  // ---- a folder recognised beneath the one open ------------------------------------------
  await c.run('welcome-page.use-a-folder-takes-one-recognised-beneath', {
    expected: `with a folder beneath the one open marked as a workspace root (${RECOGNISED_BENEATH}/${CONFIG_FILENAME}), pressing "${WAYS_THROUGH.workspace[1]}" offers, under "${CHOOSE_FOLDER_PLACEHOLDER}", the folder open and ${RECOGNISED_BENEATH}, each with its marker on its second line; taking ${RECOGNISED_BENEATH} adds it to the window, which comes back working from it — the Aggrega workspace row naming it and a language server working there — the same end state creating a configuration reaches`,
    plant: 'in the scratch copy, out/src/get-started.js with a folder chosen beneath the one open treated as one the window already has open',
  }, async () => {
    const beneath = path.join(ctx.folder, RECOGNISED_BENEATH);
    fs.mkdirSync(beneath, { recursive: true });
    fs.writeFileSync(path.join(beneath, CONFIG_FILENAME), WORKSPACE_ANCHOR_ONLY);
    const ledger = new ToastLedger();
    await pressWayThrough(ctx, 'workspace', WAYS_THROUGH.workspace[1]);
    const offered = await waitChooser(ctx.d, 'the folders Aggrega recognises', (x) => x.placeholder === CHOOSE_FOLDER_PLACEHOLDER && x.rows.length > 0, 15000);
    // The window is read whether or not it changes: one that never changes is the
    // failure this check names, read off the rows and the language server rather
    // than off the wait for the change.
    const change = await changeWindow(ctx, ledger, () => takeChooserRow(ctx.d, RECOGNISED_BENEATH), { boundMs: 30000 }).catch(() => null);
    const rows = await waitRows(ctx, `the Aggrega workspace row naming ${RECOGNISED_BENEATH}`, (r) => r.length >= 2 && r[1].value === RECOGNISED_BENEATH, 30000);
    const srv = await serverIn(ctx, beneath, 30000);
    const labels = offered.rows.map((r) => `${r.label} / ${r.detail}`);
    return {
      passed: offered.rows.some((r) => r.label === base && r.detail === CONFIG_FILENAME) && offered.rows.some((r) => r.label === RECOGNISED_BENEATH && r.detail === CONFIG_FILENAME) && rows[1]?.value === RECOGNISED_BENEATH && srv !== null,
      seen: `offered ${JSON.stringify(labels)}; the window ${change === null ? 'did not change within 30000 ms' : `${change.restarted ? 'restarted its extensions' : 'did not restart its extensions'}${change.reloaded ? ' and reloaded' : ''}`}; the rows ${JSON.stringify(rows.slice(0, 3).map((r) => `${r.label}: ${r.value}`))}; ${srv === null ? `no language server works in ${RECOGNISED_BENEATH}` : `a language server works in ${srv.cwd}`}`,
    };
  });
}
