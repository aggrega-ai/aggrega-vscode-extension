// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { STEP_IDS, StepId, WELCOME_OPEN_COMMAND, WELCOME_SHOW_SETTING } from '../../src/get-started-steps';
import { runCompiler, ScratchHome } from './cli';
import { Box, WebviewDocument } from './drivers';
import { FixtureError, FixtureProof } from './fixtures';
import { coveredBy, putAwayNotifications } from './graph-panel';
import { CHOOSER_SETTLE_MS, chooser, Chooser, waitChooser } from './levels';
import { commandTitle, run, SuiteContext } from './suite-context';
import { centre, documentWith, evaluateWithin, holds, hoverAt, pressConfirmed, PressSite, Reading, RUNNING, selectorTarget, statusLog, treeRows, until } from './workbench';

// Reading the welcome page and pressing what a reader presses on it: its four
// steps with their marks, standings, values and ways through; the checkbox at its
// foot; the two version readings and the line beneath them; its tab; and the house
// on the Commands panel that opens it.
//
// 🔴 A PRESS ON THE PAGE LANDS WHEREVER THE WORKBENCH DRAWS AT THAT POINT. The page
// is a document inside the workbench, so a press made while another tab covers it,
// or while a notification sits over the control, reaches that instead and runs
// nothing. Every press here brings the page's own tab to the front first and reads
// what the workbench draws at the point before pressing it.

export { STEP_IDS, WELCOME_OPEN_COMMAND, WELCOME_SHOW_SETTING };
export type { StepId };

// ---- the words a reader is to meet ---------------------------------------------
//
// Held here as the steps quote them, so a change of wording on the page is a change
// these checks report rather than follow. A command's title is read from the
// manifest wherever a step names a command.

export const PAGE_TITLE = 'Welcome to Aggrega';
export const PAGE_HEADING = 'Welcome to Aggrega!';
export const STANDING_MET = 'MET';
export const STANDING_TO_DO = 'TO DO';
// WORD_NO_STANDING_READS is the one word no standing and no description of one
// may read: it also means excellent, so on a list of standings it can read as
// praise rather than as work left.
export const WORD_NO_STANDING_READS = 'OUTSTANDING';
export const SELECTED_LEAD = 'Selected: ';
export const NONE_SELECTED = 'None selected.';
export const NONE_AVAILABLE = 'None available.';
export const NOT_READ_YET = 'Not read yet.';
export const VERSION_NOT_REPORTED = 'version not reported';
export const FOOT_WORDS = 'Show Aggrega welcome page on startup';
// FOOT_WORDS_NO_FOOT_CARRIES are the words of a control that offered the act
// rather than reporting the state, which the foot is not to carry.
export const FOOT_WORDS_NO_FOOT_CARRIES: readonly string[] = ['Stop opening this panel with the editor', 'Open this panel with the editor'];
export const EXTENSION_READING = 'Extension';
export const COMPILER_READING = 'Compiler';

// WAYS_THROUGH are the controls each step draws, in the order the page lists them.
export const WAYS_THROUGH: Readonly<Record<StepId, readonly string[]>> = {
  workspace: ['Create a workspace configuration', 'Use a folder that already has one'],
  compiler: ['Use the compiler on my PATH', 'Point at a compiler I have', 'Download the compiler'],
  release: ['Draft a Release', 'Choose a Release I already have'],
  registry: ['Seed the official hub', 'Seed a registry I name', 'Add a registry to what I have'],
};

// dismissedNotice is what a reader is told once the page will not open on startup,
// naming the palette's way back by the manifest's own title for it.
export function dismissedNotice(getStartedTitle: string): string {
  return `Aggrega: the welcome page will not open on startup again. Run "${getStartedTitle}" from the Command Palette to bring it back.`;
}

// ---- the page's document --------------------------------------------------------

// WELCOME_PAGE is what identifies the page's document among the webviews.
export const WELCOME_PAGE = `!!document.querySelector('main.welcome')`;

export function welcomePage(ctx: SuiteContext, boundMs = 20000): Promise<WebviewDocument> {
  return documentWith(ctx.d, 'the welcome page being drawn', WELCOME_PAGE, boundMs);
}

// PagesHeld is how many of the page's documents the workbench holds now, and how
// many webview documents gave no answer when asked whether they are one.
//
// 🔴 A DOCUMENT THAT DOES NOT ANSWER IS NOT A DOCUMENT THAT IS NO PAGE. It may be
// the page itself, being drawn or replaced, so a reading that counted it as no
// page would let an absence hold over a page that is there.
export interface PagesHeld { pages: number; unanswered: number }

export async function welcomePages(ctx: SuiteContext): Promise<PagesHeld> {
  let pages = 0;
  let unanswered = 0;
  for (const d of await ctx.d.webviews()) {
    try { if (await evaluateWithin<boolean>(d, WELCOME_PAGE, 2000)) { pages++; } } catch { unanswered++; }
  }
  return { pages, unanswered };
}

// noPage says a reading found no page and left no document unread.
export function noPage(h: PagesHeld): boolean {
  return h.pages === 0 && h.unanswered === 0;
}

// ValueSeen is one of the two places a step draws what it stands at.
export interface ValueSeen { position: 'open' | 'folded'; drawn: boolean; text: string; lead: string | null; absent: boolean }

// ActionSeen is one way through a step, as drawn.
export interface ActionSeen { label: string; command: string; drawn: boolean; borderStyle: string; borderWidth: number; borderAlpha: number }

// StepSeen is one step as drawn.
export interface StepSeen {
  id: StepId;
  title: string;
  met: boolean;
  // badge is the standing as drawn, and markHidden whether the mark beside it is
  // hidden from assistive technology.
  badge: string;
  markHidden: boolean;
  // open is the caret's own record of the explanation's state; drawn is whether
  // the explanation takes any room on the page.
  open: boolean;
  explanationDrawn: boolean;
  // explanation is the explanation's drawn text, and explanationText its text
  // whether drawn or not.
  explanation: string;
  explanationText: string;
  // guidance is the explanation's words alone — its summary and its detail —
  // without the value drawn at its foot, which is a path or a host of the reader's.
  guidance: string;
  values: ValueSeen[];
  // openValueLast says the explanation's own copy of the value is its last element,
  // which is what sits immediately above the ways through.
  openValueLast: boolean;
  actions: ActionSeen[];
  top: number;
  bottom: number;
}

// FootSeen is the page's foot: the checkbox, the words bound to it, and where the
// pair sits.
export interface FootSeen {
  checkboxes: number;
  checked: boolean | null;
  words: string;
  bound: boolean;
  amongSteps: boolean;
  top: number;
  pairCentre: number;
}

// VersionSeen is one reading at the foot.
export interface VersionSeen { label: string; value: string; top: number; left: number; right: number; valueFont: string; italic: boolean }

// PageSeen is the whole page as drawn now.
export interface PageSeen {
  title: string;
  heading: string;
  steps: StepSeen[];
  foot: FootSeen;
  pageCentre: number;
  stepsBottom: number;
  versions: VersionSeen[];
  server: string;
  // controls lists every control the page draws, links among them, each by what it
  // runs or the step it opens and closes; links counts those that are links. The
  // two come from one reading, so the controls it finds are what shows it read a
  // drawn page when it finds no link.
  links: number;
  controls: { tag: string; command: string; toggle: string; text: string; link: boolean }[];
  text: string;
}

// PAGE_READING reads the whole page in one evaluation, so every fact a check here
// judges comes from one drawing of it.
//
// 🔴 A DELIBERATE THIRD READER OF THE PAGE, beside `welcomeWorkspaceValues`
// (levels.ts), which reads the workspace step's first value in every page drawn,
// and the readings of the foot's `.version-entry` that `ready` (suite-context.ts),
// `readyAnyway` (levels.ts) and the gateway scenario take. Each of those reads one
// fact for its own checks; none reads a step's mark, caret, explanation, values or
// ways through, and widening one would change a reader other scenarios judge by.
const PAGE_READING = `(() => {
  const drawn = (e) => { if (!e) { return false; } const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const text = (e) => ((e && e.innerText) || '').trim();
  const alpha = (c) => { const m = /rgba?\\(([^)]*)\\)/.exec(c || ''); if (!m) { return 0; } const p = m[1].split(',').map((x) => x.trim()); return p.length === 4 ? Number(p[3]) : 1; };
  const steps = [...document.querySelectorAll('section.step')].map((s) => {
    const prose = s.querySelector('.step-prose');
    const toggle = s.querySelector('.step-toggle');
    const mark = s.querySelector('.step-mark');
    const r = s.getBoundingClientRect();
    return {
      id: s.dataset.step || '',
      title: text(s.querySelector('.step-title')),
      met: s.classList.contains('step-met'),
      badge: text(s.querySelector('.step-standing')),
      markHidden: !!mark && mark.getAttribute('aria-hidden') === 'true',
      open: !!toggle && toggle.getAttribute('aria-expanded') === 'true',
      explanationDrawn: drawn(prose),
      explanation: drawn(prose) ? text(prose) : '',
      explanationText: prose ? (prose.textContent || '').replace(/\\s+/g, ' ').trim() : '',
      guidance: [...s.querySelectorAll('.step-summary, .step-detail')].map((e) => e.textContent || '').join(' ').replace(/\\s+/g, ' ').trim(),
      values: [...s.querySelectorAll('.step-value')].map((v) => {
        const lead = v.querySelector('.step-value-lead');
        return { position: v.classList.contains('step-value-folded') ? 'folded' : 'open', drawn: drawn(v), text: (v.textContent || '').trim(), lead: lead ? lead.textContent : null, absent: v.classList.contains('step-value-absent') };
      }),
      openValueLast: !!prose && !!prose.lastElementChild && prose.lastElementChild.classList.contains('step-value-open'),
      actions: [...s.querySelectorAll('button.step-action')].map((b) => {
        const cs = getComputedStyle(b);
        return { label: text(b), command: b.dataset.command || '', drawn: drawn(b), borderStyle: cs.borderTopStyle, borderWidth: parseFloat(cs.borderTopWidth) || 0, borderAlpha: alpha(cs.borderTopColor) };
      }),
      top: r.top,
      bottom: r.bottom,
    };
  });
  const foot = document.getElementById('dismiss');
  const boxes = foot ? [...foot.querySelectorAll('input[type=checkbox]')] : [];
  const box = boxes[0] || null;
  const words = box && box.labels && box.labels.length > 0 ? box.labels[0] : null;
  const main = document.querySelector('main.welcome');
  const m = main ? main.getBoundingClientRect() : { left: 0, width: 0 };
  const b = box ? box.getBoundingClientRect() : null;
  const w = words ? words.getBoundingClientRect() : null;
  const list = document.getElementById('steps');
  const lr = list ? list.getBoundingClientRect() : null;
  const controls = [...document.body.querySelectorAll('button, input, select, textarea, a, [href], [role=button], [role=link], [tabindex]')].map((e) => ({ tag: e.tagName.toLowerCase(), command: e.dataset.command || '', toggle: e.dataset.toggle || '', text: text(e), link: e.tagName === 'A' || e.hasAttribute('href') || e.getAttribute('role') === 'link' }));
  return {
    title: document.title,
    heading: text(document.querySelector('h1')),
    steps,
    foot: {
      checkboxes: boxes.length,
      checked: box ? box.checked : null,
      words: text(words),
      bound: !!words && words.tagName === 'LABEL',
      amongSteps: !!box && !!box.closest('#steps'),
      top: b ? b.top : 0,
      pairCentre: b && w ? (Math.min(b.left, w.left) + Math.max(b.right, w.right)) / 2 : 0,
    },
    pageCentre: m.left + m.width / 2,
    stepsBottom: lr ? lr.bottom : 0,
    versions: [...document.querySelectorAll('#versions .version-entry')].map((e) => {
      const v = e.querySelector('.version-value');
      const cs = v ? getComputedStyle(v) : null;
      const all = (e.textContent || '').trim();
      const value = v ? (v.textContent || '').trim() : '';
      const r = e.getBoundingClientRect();
      return { label: all.slice(0, all.length - value.length).trim(), value, top: r.top, left: r.left, right: r.right, valueFont: cs ? cs.fontFamily : '', italic: !!cs && cs.fontStyle === 'italic' };
    }),
    server: text(document.getElementById('server')),
    links: controls.filter((c) => c.link).length,
    controls,
    text: text(document.body),
  };
})()`;

export function readPage(doc: WebviewDocument): Promise<PageSeen> {
  return evaluateWithin<PageSeen>(doc, PAGE_READING, 5000);
}

// pageNow reads the page as drawn now.
export async function pageNow(ctx: SuiteContext): Promise<PageSeen> {
  return readPage(await welcomePage(ctx));
}

// stepOf is the step `id` as drawn. A step the page does not draw is what the page
// shows, so it fails the check reading it rather than leaving it unrun.
export function stepOf(page: PageSeen, id: StepId): StepSeen {
  const s = page.steps.find((x) => x.id === id);
  if (s === undefined) { throw new Error(`the welcome page draws no ${id} step; it draws ${JSON.stringify(page.steps.map((x) => x.id))}`); }
  return s;
}

// drawnValue is the one copy of a step's value that is drawn, or null where none
// or both are.
export function drawnValue(step: StepSeen): ValueSeen | null {
  const d = step.values.filter((v) => v.drawn);
  return d.length === 1 ? d[0] : null;
}

// describeSteps words the steps as drawn, for a check's report.
export function describeSteps(page: PageSeen): string {
  return page.steps.map((s) => {
    const v = s.values.filter((x) => x.drawn);
    return `${s.id} ${s.badge}${s.open ? ' open' : ' folded'}${s.explanationDrawn ? '' : ' (explanation not drawn)'}: ${v.length === 1 ? JSON.stringify(v[0].text) : `${v.length} value copies drawn`}`;
  }).join(' | ');
}

// shapeOf is how a step is arranged: open where its caret says so and its
// explanation is drawn, folded where neither, and torn where the two disagree.
function shapeOf(open: boolean, drawn: boolean): 'open' | 'folded' | 'torn' {
  return open && drawn ? 'open' : !open && !drawn ? 'folded' : 'torn';
}

export function folded(page: PageSeen, id: StepId): boolean {
  const s = stepOf(page, id);
  return shapeOf(s.open, s.explanationDrawn) === 'folded';
}

export function opened(page: PageSeen, id: StepId): boolean {
  const s = stepOf(page, id);
  return shapeOf(s.open, s.explanationDrawn) === 'open';
}

// arrangement is how each step is arranged, in step order; arrangementLogged is
// the same of a reading the page observer recorded.
export function arrangement(page: PageSeen): string {
  return page.steps.map((s) => `${s.id}:${shapeOf(s.open, s.explanationDrawn)}`).join(' ');
}

export function arrangementLogged(r: PageReadingLogged): string {
  return r.steps.map((s) => `${s.id}:${shapeOf(s.open, s.drawn)}`).join(' ');
}

// arrangementFolding is the arrangement with the steps `foldedIds` folded and
// every other open.
export function arrangementFolding(foldedIds: readonly StepId[]): string {
  return STEP_IDS.map((id) => `${id}:${foldedIds.includes(id) ? 'folded' : 'open'}`).join(' ');
}

// ValueStyle is how a step's drawn value, its lead-in and the explanation beside it
// are set.
export interface TextStyle { size: number; weight: number; colour: string; font: string; italic: boolean }
export interface ValueStyles { id: StepId; value: TextStyle | null; lead: TextStyle | null; explanation: TextStyle | null }

const VALUE_STYLES = `(() => {
  const style = (e) => { if (!e) { return null; } const cs = getComputedStyle(e); return { size: parseFloat(cs.fontSize) || 0, weight: Number(cs.fontWeight) || 0, colour: cs.color, font: cs.fontFamily, italic: cs.fontStyle === 'italic' }; };
  const drawn = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return [...document.querySelectorAll('section.step')].map((s) => {
    const v = [...s.querySelectorAll('.step-value')].find(drawn) || null;
    return { id: s.dataset.step || '', value: style(v), lead: style(v ? v.querySelector('.step-value-lead') : null), explanation: style(s.querySelector('.step-detail p')) };
  });
})()`;

export function valueStyles(doc: WebviewDocument): Promise<ValueStyles[]> {
  return evaluateWithin<ValueStyles[]>(doc, VALUE_STYLES, 5000);
}

// markSteps writes a token onto the step list's first section, so a later reading
// can tell whether the list was drawn again: a list drawn again is new sections.
export async function markSteps(doc: WebviewDocument): Promise<string> {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await evaluateWithin(doc, `((t) => { const s = document.querySelector('section.step'); if (s) { s.dataset.suiteMark = t; } window.__welcomeSuitePage = t; return !!s; })(${JSON.stringify(token)})`, 5000);
  return token;
}

// stepsDrawnAgain reports whether the list no longer carries the token, and
// samePage whether the document is still the one that was marked.
export async function stepsDrawnAgain(doc: WebviewDocument, token: string): Promise<boolean> {
  return evaluateWithin<boolean>(doc, `((t) => { const s = document.querySelector('section.step'); return !s || s.dataset.suiteMark !== t; })(${JSON.stringify(token)})`, 5000);
}

export async function samePage(doc: WebviewDocument, token: string): Promise<boolean> {
  return evaluateWithin<boolean>(doc, `window.__welcomeSuitePage === ${JSON.stringify(token)}`, 5000).catch(() => false);
}

// clearForCapture puts away the notifications drawn over the editor area and moves
// the pointer off everything, so a capture left for a person shows the page whole,
// and answers with a line for the drawn text beside the capture where a
// notification is still drawn there, and with nothing where none is.
//
// The count is the one `putAwayNotifications` (graph-panel.ts) waits on, read once
// more here: that helper ends whether or not the notifications went, and what a
// person is shown must say which.
export async function clearForCapture(ctx: SuiteContext): Promise<string> {
  await putAwayNotifications(ctx);
  await ctx.d.moveTo({ x: 1, y: 1 });
  const left = await ctx.d.workbench<number>(`[...document.querySelectorAll('.notification-toast-container, .notification-toast')].filter((e) => e.getBoundingClientRect().height > 0).length`);
  return left === 0 ? '' : `\n(${left} notification(s) still drawn over the editor area when this was captured)`;
}

// ---- the page's tab --------------------------------------------------------------

export interface TabSeen { label: string; active: boolean; centre: { x: number; y: number } }

const TABS = `[...document.querySelectorAll('.tabs-container .tab')].map((t) => { const r = t.getBoundingClientRect(); return { label: t.getAttribute('aria-label') || '', active: t.classList.contains('active'), centre: { x: r.x + r.width / 2, y: r.y + r.height / 2 } }; })`;

export function tabs(ctx: SuiteContext): Promise<TabSeen[]> {
  return ctx.d.workbench<TabSeen[]>(TABS);
}

export async function pageTabs(ctx: SuiteContext): Promise<TabSeen[]> {
  return (await tabs(ctx)).filter((t) => t.label === PAGE_TITLE);
}

// frontPage brings the page's tab to the front where another is in front of it,
// as a person clicks the tab; it refreshes nothing on the page.
export async function frontPage(ctx: SuiteContext): Promise<void> {
  const t = await until('the welcome page\'s tab being drawn', 10000, () => pageTabs(ctx), (v) => v.length > 0);
  if (t[0].active) { return; }
  await ctx.d.click(t[0].centre);
  await until('the welcome page\'s tab coming to the front', 5000, () => pageTabs(ctx), (v) => v.length > 0 && v[0].active);
}

// QUIET_READING answers how long it is since the page last drew anything, watching
// from the first time it is asked.
const QUIET_READING = `(() => {
  if (!window.__welcomeSuiteQuiet) {
    window.__welcomeSuiteQuiet = { at: Date.now() };
    const main = document.querySelector('main.welcome');
    if (main) { new MutationObserver(() => { window.__welcomeSuiteQuiet.at = Date.now(); }).observe(main, { subtree: true, childList: true, characterData: true, attributes: true }); }
  }
  return Date.now() - window.__welcomeSuiteQuiet.at;
})()`;

// QUIET_MS is how long the page is to have drawn nothing before a press is made on it.
const QUIET_MS = 300;

// pressOnPage presses the element `selector` matches on the page, where a person
// presses it: the page's tab in front, the element scrolled to the middle of the
// page, and the point shown to be the page's own frame before the press — read
// with `coveredBy` (graph-panel.ts). Where something else is drawn over the point,
// the notifications are put away and the pointer moved off, and the point is read
// again. The press is made through `pressConfirmed` (workbench.ts), so a press
// that focuses the page's frame without reaching its document — as a press made
// as the tab comes to the front can — is made again rather than read as made. A
// control the page does not draw is what the page shows, so it fails the check
// pressing it.
//
// 🔴 THE PRESS WAITS FOR THE PAGE TO STOP BEING DRAWN AGAIN. The page redraws its
// step list whole whenever what the steps stand at may have moved — the language
// server coming up, a Release enumerated — and a press whose down and up land on
// two drawings of the same control is no click at all, so it would run nothing.
// A page that never stops being drawn fails the check, naming the bound.
export async function pressOnPage(ctx: SuiteContext, selector: string): Promise<void> {
  await frontPage(ctx);
  const page = await welcomePage(ctx);
  const there = await evaluateWithin<boolean>(page, `((s) => { const e = document.querySelector(s); if (e) { e.scrollIntoView({ block: 'center', inline: 'nearest' }); } return !!e; })(${JSON.stringify(selector)})`, 5000);
  if (!there) { throw new Error(`the welcome page draws nothing matching ${selector}`); }
  await until(`the page drawing nothing for ${QUIET_MS} ms`, 10000, () => evaluateWithin<number>(page, QUIET_READING, 2000), (ms) => ms >= QUIET_MS);
  await pressConfirmed(ctx.d, { doc: page, target: selectorTarget(selector), what: `${selector} on the welcome page` }, async (): Promise<PressSite> => {
    const b = await ctx.d.box(page, selector);
    if (b === null || b.width <= 0 || b.height <= 0) { return null; }
    const at = centre(b);
    const over = await coveredBy(ctx, at);
    if (over === null) { return at; }
    await putAwayNotifications(ctx);
    await ctx.d.moveTo({ x: 1, y: 1 });
    return { blocked: `the workbench's ${over} is drawn over it` };
  });
}

// wayThroughCommand is the command the control labelled `label` on the step runs,
// read off the page, so a press finds the control by the words a reader reads, and
// a step that draws no such control fails the check pressing it.
export async function wayThroughCommand(ctx: SuiteContext, id: StepId, label: string): Promise<string> {
  const page = await pageNow(ctx);
  const a = stepOf(page, id).actions.find((x) => x.label === label);
  if (a === undefined) { throw new Error(`the ${id} step draws no control labelled "${label}"; it draws ${JSON.stringify(stepOf(page, id).actions.map((x) => x.label))}`); }
  return a.command;
}

// pressWayThrough presses one of a step's controls by its words.
export async function pressWayThrough(ctx: SuiteContext, id: StepId, label: string): Promise<void> {
  const command = await wayThroughCommand(ctx, id, label);
  await pressOnPage(ctx, `section.step[data-step="${id}"] button.step-action[data-command="${command}"]`);
}

// wayThroughChooser presses one of a step's controls and answers with the quick
// input it opens, once that has stayed drawn a moment, and how many presses it took.
//
// 🔴 A PRESS ON THE PAGE CAN OPEN NOTHING, AND THE PROMPT IT WAS FOR THEN OPENS ON
// A SECOND ONE. A press made as the page's tab is brought to the front can focus
// the page's frame in the workbench while no press reaches the page's own
// document, so it runs nothing — and a prompt that holds itself open on focus loss
// takes two presses that way as readily as one that does not. So the press is made
// once more where no prompt stayed drawn, as `rowChooser` (levels.ts) does for a
// row's chooser, over the same settle; that helper presses a row by the command it
// runs and cannot be handed a press on the page. `watchPromptPress` records what
// each press reached, so a check that took two can say why.
export async function wayThroughChooser(ctx: SuiteContext, id: StepId, label: string, wanted: (c: Chooser) => boolean, boundMs = 10000): Promise<{ chooser: Chooser; presses: number }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await pressWayThrough(ctx, id, label);
    const opened = await waitChooser(ctx.d, `the quick input "${label}" opens`, wanted, boundMs).catch((err: unknown) => {
      if (attempt === 2) { throw err; }
      return null;
    });
    if (opened === null) { continue; }
    const stayed = await holds(CHOOSER_SETTLE_MS, () => chooser(ctx.d), (c) => c !== null && wanted(c), 100);
    const still = stayed.held ? await chooser(ctx.d) : null;
    if (still !== null && wanted(still)) { return { chooser: still, presses: attempt }; }
  }
  throw new Error(`the quick input "${label}" opens closed again within ${CHOOSER_SETTLE_MS} ms of opening on the second press, the first having left none drawn that stayed`);
}

// pressCaret presses the caret that opens and closes a step's explanation.
export function pressCaret(ctx: SuiteContext, id: StepId): Promise<void> {
  return pressOnPage(ctx, `section.step[data-step="${id}"] button.step-toggle`);
}

// FOOT_BOX and FOOT_WORDS_SELECTOR are the checkbox at the foot and the words
// bound to it.
export const FOOT_BOX = '#dismiss input[type=checkbox]';
export const FOOT_WORDS_SELECTOR = '#dismiss label';

// ---- the house on the Commands panel ---------------------------------------------

export interface TitleAction { label: string; icon: string; box: Box }

const COMMANDS_TITLE_ACTIONS = `(() => {
  for (const pane of document.querySelectorAll('#workbench\\\\.parts\\\\.sidebar .pane')) {
    const h = pane.querySelector('.pane-header');
    const t = h ? ((h.querySelector('h3.title, .title') || {}).innerText || '').trim().toLowerCase() : '';
    if (t !== 'commands') { continue; }
    return [...h.querySelectorAll('.action-label')].map((a) => { const r = a.getBoundingClientRect(); return { label: a.getAttribute('aria-label') || '', icon: (String(a.className).match(/codicon-[a-z-]+/) || [''])[0], box: { x: r.x, y: r.y, width: r.width, height: r.height } }; });
  }
  return [];
})()`;

// commandsTitleActions reads the actions the Commands panel's title bar draws, in
// the order drawn.
export async function commandsTitleActions(ctx: SuiteContext): Promise<TitleAction[]> {
  await run(ctx, 'workbench.view.extension.aggrega');
  return until('the Commands panel\'s title actions being drawn', 10000, () => ctx.d.workbench<TitleAction[]>(COMMANDS_TITLE_ACTIONS), (v) => v.length > 0);
}

export function houseTitle(ctx: SuiteContext): string {
  return commandTitle(ctx.manifest, WELCOME_OPEN_COMMAND);
}

// theHouse is the house as the Commands panel's title bar draws it. A title bar
// that draws none fails the check reaching for it.
async function theHouse(ctx: SuiteContext): Promise<TitleAction> {
  const title = houseTitle(ctx);
  const actions = await commandsTitleActions(ctx);
  const house = actions.find((a) => a.label === title);
  if (house === undefined) { throw new Error(`the Commands panel's title bar draws no action "${title}"; it draws ${JSON.stringify(actions.map((a) => a.label))}`); }
  return house;
}

// pressHouse presses the house on the Commands panel's title bar.
export async function pressHouse(ctx: SuiteContext): Promise<void> {
  await ctx.d.click(centre((await theHouse(ctx)).box));
}

// houseHover rests the pointer on the house and answers with its tooltip.
export async function houseHover(ctx: SuiteContext): Promise<string> {
  return hoverAt(ctx.d, centre((await theHouse(ctx)).box));
}

// ---- observers --------------------------------------------------------------------

// installPageObserver is a statement that installs, in the page's own document, an
// observer recording from that moment every change of what the steps stand at, how
// they are arranged and what the foot reads, so a change that lasts a moment is
// kept as it is drawn. The log keeps how long the document had existed when the
// observer went in. With `once`, a log already kept under the key is left as it is.
function installPageObserver(key: string, once: boolean): string {
  return `((key, once) => {
    const logs = window.__welcomeSuiteLogs || (window.__welcomeSuiteLogs = {});
    if (once && logs[key]) { return logs[key].length; }
    const log = [];
    log.documentAgeMs = performance.now();
    logs[key] = log;
    let last = '';
    const drawn = (e) => { if (!e) { return false; } const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const read = () => ({
      steps: [...document.querySelectorAll('section.step')].map((s) => {
        const t = s.querySelector('.step-toggle');
        const v = [...s.querySelectorAll('.step-value')].find(drawn);
        return { id: s.dataset.step, badge: ((s.querySelector('.step-standing') || {}).innerText || '').trim(), open: !!t && t.getAttribute('aria-expanded') === 'true', drawn: drawn(s.querySelector('.step-prose')), value: v ? (v.textContent || '').trim() : null };
      }),
      versions: [...document.querySelectorAll('#versions .version-entry')].map((e) => (e.textContent || '').replace(/\\s+/g, ' ').trim()),
    });
    const sample = () => { const v = read(); const k = JSON.stringify(v); if (k !== last) { last = k; log.push({ at: Date.now(), ...v }); } };
    sample();
    const main = document.querySelector('main.welcome');
    if (main) { new MutationObserver(sample).observe(main, { subtree: true, childList: true, characterData: true, attributes: true }); }
    return log.length;
  })(${JSON.stringify(key)}, ${once ? 'true' : 'false'})`;
}

// PageReadingLogged is one reading the page observer recorded; drawn is whether the
// step's explanation took any room on the page.
export interface PageReadingLogged { at: number; steps: { id: string; badge: string; open: boolean; drawn: boolean; value: string | null }[]; versions: string[] }

export async function observePage(doc: WebviewDocument): Promise<string> {
  const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await evaluateWithin(doc, installPageObserver(key, false), 5000);
  return key;
}

export function pageReadings(doc: WebviewDocument, key: string): Promise<PageReadingLogged[]> {
  return evaluateWithin<PageReadingLogged[]>(doc, `((window.__welcomeSuiteLogs || {})[${JSON.stringify(key)}] || [])`, 5000);
}

// PROMPT_FOCUS_OBSERVER records in the workbench's document, from the moment it is
// installed, every element the keyboard focus moves into and every quick input
// shown or hidden, each as it happens. A prompt that opens and closes again within
// a moment is kept with what the focus did around it, rather than missed between
// two readings of what is drawn.
const PROMPT_FOCUS_OBSERVER = `(() => {
  if (window.__welcomeSuitePromptFocus) { return window.__welcomeSuitePromptFocus.length; }
  const log = [];
  const where = (e) => {
    if (!e || e === document.body) { return 'the workbench itself'; }
    if (e.closest && e.closest('.quick-input-widget')) { return 'the quick input'; }
    if (e.tagName === 'IFRAME') { return 'a webview (' + (e.getAttribute('title') || e.getAttribute('name') || 'untitled').slice(0, 60) + ')'; }
    return e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).trim().split(/\\s+/).slice(0, 2).join('.') : '');
  };
  document.addEventListener('focusin', (ev) => { log.push({ at: Date.now(), focus: where(ev.target) }); }, true);
  let shown = null;
  const sample = () => {
    const w = [...document.querySelectorAll('.quick-input-widget')].find((e) => e.style.display !== 'none' && e.getBoundingClientRect().height > 0);
    const now = w ? (((w.querySelector('.quick-input-title') || {}).innerText || '').trim() || '(untitled)') : null;
    if (now === shown) { return; }
    log.push(now === null ? { at: Date.now(), hidden: shown } : { at: Date.now(), shown: now });
    shown = now;
  };
  sample();
  new MutationObserver(sample).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] });
  window.__welcomeSuitePromptFocus = log;
  return log.length;
})()`;

// PAGE_PRESS_OBSERVER records in the page's own document every pointer press, its
// release and the click they make, each with the command of the control it landed
// on — so a press whose down and up fell on two drawings of the step list, which
// makes no click and runs nothing, is told apart from a press that ran its command.
const PAGE_PRESS_OBSERVER = `(() => {
  if (window.__welcomeSuitePresses) { return window.__welcomeSuitePresses.length; }
  const log = [];
  const on = (ev) => {
    const c = ev.target && ev.target.closest ? ev.target.closest('[data-command]') : null;
    log.push({ at: Date.now(), event: ev.type, command: c ? c.dataset.command : null });
  };
  for (const type of ['pointerdown', 'pointerup', 'click']) { document.addEventListener(type, on, true); }
  window.__welcomeSuitePresses = log;
  return log.length;
})()`;

// PromptPressWatch is where the two records stood, and when, as a press that opens
// a prompt is about to be made.
export interface PromptPressWatch { doc: WebviewDocument; at: number; workbenchMark: number; pageMark: number }

// watchPromptPress installs both observers, where they are not already in, and
// marks where their records stand, before a press on the page that opens a prompt.
export async function watchPromptPress(ctx: SuiteContext): Promise<PromptPressWatch> {
  const doc = await welcomePage(ctx);
  const at = Date.now();
  const workbenchMark = await ctx.d.workbench<number>(PROMPT_FOCUS_OBSERVER);
  const pageMark = await evaluateWithin<number>(doc, PAGE_PRESS_OBSERVER, 5000);
  return { doc, at, workbenchMark, pageMark };
}

// promptPressRecord words, for a check's report, what both records hold since the
// mark: each event with how long after the mark it came.
export async function promptPressRecord(ctx: SuiteContext, w: PromptPressWatch): Promise<string> {
  type Entry = { at: number } & Record<string, unknown>;
  const since = (log: Entry[], mark: number): string[] => log.slice(mark).map((e) => {
    const { at, ...rest } = e;
    return `+${at - w.at} ms ${Object.entries(rest).map(([k, v]) => `${k} ${String(v)}`).join(', ')}`;
  });
  const workbench = since(await ctx.d.workbench<Entry[]>('window.__welcomeSuitePromptFocus || []'), w.workbenchMark);
  const page = since(await evaluateWithin<Entry[]>(w.doc, 'window.__welcomeSuitePresses || []', 5000), w.pageMark);
  return `on the page since the mark: ${JSON.stringify(page)}; in the workbench: ${JSON.stringify(workbench)}`;
}

// ARRIVAL_KEY is what the observer installed as the page is first found keeps its
// readings under.
const ARRIVAL_KEY = 'arrival';

// PageArrival is the page's document as first found, the key its observer keeps
// the readings under, and how long the document had existed when that observer
// went in.
export interface PageArrival { doc: WebviewDocument; key: string; documentAgeMs: number }

// pageFromItsArrival finds the page's document and, in the same evaluation that
// finds it, installs the page observer, so the arrangement the page arrives in and
// every change after it are recorded in the document as they are drawn rather than
// polled for afterwards.
//
// 🔴 ONE SPAN STAYS UNOBSERVED, AND IT IS MEASURED RATHER THAN ASSUMED AWAY. Nothing
// of the suite runs in the page's document before the evaluation that first finds
// it, so whatever the page drew in that span is not recorded; documentAgeMs is how
// long the span was, read in the document itself, for the report.
export async function pageFromItsArrival(ctx: SuiteContext, boundMs: number): Promise<PageArrival> {
  const probe = `(() => { if (!(${WELCOME_PAGE})) { return false; } ${installPageObserver(ARRIVAL_KEY, true)}; return true; })()`;
  const doc = await documentWith(ctx.d, 'the welcome page being drawn', probe, boundMs);
  const documentAgeMs = await evaluateWithin<number>(doc, `(((window.__welcomeSuiteLogs || {})[${JSON.stringify(ARRIVAL_KEY)}] || {}).documentAgeMs || -1)`, 5000);
  return { doc, key: ARRIVAL_KEY, documentAgeMs: Math.round(documentAgeMs) };
}

// STATUS_TEXT_OBSERVER records every change of what the language server's item on
// the status bar reads, the countdown before a restart included.
//
// 🔴 A DELIBERATE NEAR-DUPLICATE OF `statusObserver` (workbench.ts), WHICH CANNOT
// KEEP THE COUNTDOWN. That observer keeps only the readings that are exactly one of
// the standings, and it is installed once per window under one name before the
// extension draws anything, so it cannot be installed a second time to keep the
// other readings; widening it would change the record every other scenario's
// waits read.
const STATUS_TEXT_OBSERVER = `(() => {
  const bar = document.getElementById('workbench.parts.statusbar');
  const log = [];
  let last = null;
  const read = () => [...bar.querySelectorAll('.statusbar-item')].map((e) => (e.innerText || '').trim()).filter((t) => t.startsWith('Aggrega: ')).join(' | ');
  const sample = () => { const v = read(); if (v !== last) { log.push({ at: Date.now(), reading: v }); last = v; } };
  sample();
  new MutationObserver(sample).observe(bar, { subtree: true, childList: true, characterData: true, attributes: true });
  window.__welcomeSuiteStatusText = log;
  return log.length;
})()`;

export interface StatusTextReading { at: number; reading: string }

export async function observeStatusText(ctx: SuiteContext): Promise<void> {
  await ctx.d.workbench(STATUS_TEXT_OBSERVER);
}

export function statusTexts(ctx: SuiteContext): Promise<StatusTextReading[]> {
  return ctx.d.workbench<StatusTextReading[]>('window.__welcomeSuiteStatusText || []');
}

// statusMark is where the workbench's record of the language server's standings
// stands now, taken before an action that restarts the server.
export async function statusMark(ctx: SuiteContext): Promise<number> {
  return (await statusLog(ctx.d)).length;
}

// runningAgain waits until the status bar, since `mark`, has read something other
// than running and reads running now — a restart that has come back, rather than
// the reading from before it — and answers with the readings since the mark.
export function runningAgain(ctx: SuiteContext, mark: number, boundMs: number): Promise<Reading[]> {
  return until(`the status bar reading "${RUNNING}" again, after another reading, since the action`, boundMs, async () => (await statusLog(ctx.d)).slice(mark),
    (v) => v.some((r) => r.reading !== RUNNING) && v.length > 0 && v[v.length - 1].reading === RUNNING);
}

// describeReadings words the status bar's readings for a check's report.
export function describeReadings(v: readonly Reading[]): string {
  return JSON.stringify(v.map((r) => r.reading || '(no standing drawn)'));
}

// registriesListed reads the hosts the Registries panel lists, with the Aggrega
// side bar shown.
export async function registriesListed(ctx: SuiteContext): Promise<string[]> {
  await run(ctx, 'workbench.view.extension.aggrega');
  return ((await treeRows(ctx.d, 'Registries')) ?? []).map((r) => r.label);
}

// ---- fixtures ---------------------------------------------------------------------

// SecondCompiler is an executable beside the binary under test that answers
// `version -o json` with a version of its own and runs the binary under test for
// everything else, so pointing the editor at it changes what the compiler reading
// names and nothing else.
export interface SecondCompiler { path: string; version: string; proof: FixtureProof }

// placeSecondCompiler writes the executable and reads both of its answers back: its
// own version, and the binary under test's for anything else it is asked.
export async function placeSecondCompiler(binary: string, dir: string, home: ScratchHome, log: string): Promise<SecondCompiler> {
  const fixture = 'a second compiler reporting a version of its own';
  fs.mkdirSync(dir, { recursive: true });
  const own = await runCompiler(binary, ['version', '-o', 'json'], { cwd: dir, home, boundMs: 30000, log });
  let payload: { version?: string } & Record<string, unknown>;
  try { payload = JSON.parse(own.stdout) as typeof payload; } catch { throw new FixtureError(fixture, `\`version -o json\` of ${binary} printed no JSON: ${own.stdout.slice(0, 200)}`); }
  if (typeof payload.version !== 'string' || payload.version === '') { throw new FixtureError(fixture, `\`version -o json\` of ${binary} names no version`); }
  const version = `${payload.version}.second`;
  const answer = JSON.stringify({ ...payload, version });
  if (answer.includes('\'') || binary.includes('\'')) { throw new FixtureError(fixture, 'a single quote in the binary\'s path or its answer would break the script that stands in for it'); }
  const file = path.join(dir, 'aggrega');
  fs.writeFileSync(file, [
    '#!/bin/sh',
    '# Answers `version -o json` with a version of its own, and runs the binary',
    '# under test for everything else.',
    'if [ "$#" -eq 3 ] && [ "$1" = version ] && [ "$2" = -o ] && [ "$3" = json ]; then',
    `  printf '%s\\n' '${answer}'`,
    '  exit 0',
    'fi',
    `exec '${binary}' "$@"`,
    '',
  ].join('\n'), { mode: 0o755 });
  const asked = await runCompiler(file, ['version', '-o', 'json'], { cwd: dir, home, boundMs: 30000, log });
  const passed = await runCompiler(file, ['version'], { cwd: dir, home, boundMs: 30000, log });
  const direct = await runCompiler(binary, ['version'], { cwd: dir, home, boundMs: 30000, log });
  let read = '';
  try { read = (JSON.parse(asked.stdout) as { version?: string }).version ?? ''; } catch { read = ''; }
  if (asked.status !== 0 || read !== version || passed.status !== 0 || passed.stdout !== direct.stdout) {
    throw new FixtureError(fixture, `${file} answers \`version -o json\` with ${JSON.stringify(read)} (exit ${asked.status}), and \`version\` ${passed.stdout === direct.stdout ? 'as' : 'unlike'} the binary under test (exit ${passed.status})`);
  }
  return { path: file, version, proof: { fixture, built: true, proof: `${file} answers \`version -o json\` with version ${version}, where the binary under test answers ${payload.version}, and answers \`version\` byte for byte as the binary under test does` } };
}

// registerWithNoTrust registers a registry host in the scenario's global
// configuration with the compiler's own command, fetching no trust policy, and
// reads the compiler's listing back.
export async function registerWithNoTrust(binary: string, host: string, folder: string, home: ScratchHome, log: string): Promise<FixtureProof> {
  const fixture = `${host} registered in the global configuration`;
  const add = await runCompiler(binary, ['registry', 'add', host, '--fetch-trust=false'], { cwd: folder, home, boundMs: 60000, log });
  if (add.status !== 0) { throw new FixtureError(fixture, `\`aggrega registry add ${host} --fetch-trust=false\` exited ${add.status ?? add.signal}: ${(add.stderr || add.stdout).trim().split('\n').slice(-2).join(' | ')}`); }
  const list = await runCompiler(binary, ['registry', 'list'], { cwd: folder, home, boundMs: 60000, log });
  const row = list.stdout.split('\n').find((l) => l.startsWith(`${host} `) || l.trim() === host) ?? '';
  if (list.status !== 0 || row === '') { throw new FixtureError(fixture, `\`aggrega registry list\` does not list ${host}: ${JSON.stringify(list.stdout.slice(0, 300))}`); }
  return { fixture, built: true, proof: `\`aggrega registry add ${host} --fetch-trust=false\` exited 0; \`aggrega registry list\` reads ${JSON.stringify(row.trim())}` };
}

// placeNotABinary writes a file that is there and is no program, for a compiler
// setting that names something that will not start.
export function placeNotABinary(file: string): FixtureProof {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'This file stands where a compiler is named, and is not one.\n', { mode: 0o644 });
  const st = fs.statSync(file);
  if (!st.isFile() || (st.mode & 0o111) !== 0) { throw new FixtureError('a file that is not a binary', `${file} is not a plain file without an execute bit`); }
  return { fixture: 'a file that is not a binary', built: true, proof: `${file} is a plain text file with no execute bit` };
}

// metSteps says, for a check's report, which of the four steps a page reading
// found met.
export function metSteps(page: PageSeen): string {
  const met = page.steps.filter((s) => s.met).map((s) => s.id);
  return met.length === 0 ? 'none met' : `${met.join(', ')} met`;
}
