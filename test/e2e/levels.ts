// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { SWITCH_ANCHOR_COMMAND } from '../../src/anchor-picker';
import { CHOOSE_PROJECT_FOLDER_COMMAND } from '../../src/project-folder';
import { SELECT_RELEASE_COMMAND } from '../../src/release-selection';
import { need } from './checks';
import { UiDriver, WebviewDocument } from './drivers';
import { Hello } from './probe-client';
import { languageServers, run, send, Server, serverNow, SuiteContext } from './suite-context';
import {
  answersIn, commandsPanel, Dialog, dialog, documentWith, guard, holds, hoverAt, observeWorkbench, pickQuickInputRow, pressDialogButton, pressIn, statusItems, StatusItem,
  toasts, toastsSince, Toast, until, workbenchText,
} from './workbench';

// Reading the three rows that say which folder, which Aggrega workspace and which
// Release the editor works on, the choosers each one opens, the folder dialogs and
// the interruption those lead to, and what a window does when its folders change.
//
// 🔴 A WINDOW THAT RELOADS REPLACES THE DOCUMENT EVERY OBSERVER LIVES IN. So every
// window change here goes through one helper that waits for the probe to answer
// from its new start and installs the observers again, and the notifications drawn
// before the change are kept by the ledger below rather than lost with the document
// they were recorded in.

// RowKey names the three rows by the level each reports, in the order drawn.
export type RowKey = 'project' | 'workspace' | 'release';
export const ROW_KEYS: readonly RowKey[] = ['project', 'workspace', 'release'];

// ROW_COMMAND is the command each row's choosing control runs, read from the
// modules that own each choice, so a press finds its row by what it does.
export const ROW_COMMAND: Record<RowKey, string> = {
  project: CHOOSE_PROJECT_FOLDER_COMMAND,
  workspace: SWITCH_ANCHOR_COMMAND,
  release: SELECT_RELEASE_COMMAND,
};

// Box is a drawn rectangle in the panel's own coordinates.
export interface PanelBox { x: number; y: number; width: number; height: number }

// RowControl is a control drawn beside a row's choosing control.
export interface RowControl { name: string; title: string; command: string; box: PanelBox; insideChooser: boolean }

// LevelRow is one row as drawn: its words, its hover, its controls and marks, and
// where each sits.
//
// 🔴 A DELIBERATE SECOND READER OF THE ROWS `selectorRows` (workbench.ts) READS.
// These checks judge where each part of a row is drawn — whether the values start
// and end in line, whether a control sits outside the choosing control, whether
// the mark stands after the value — and that needs every box taken in the one
// reading its words are taken in; `selectorRows` reads the words alone. Widening
// it would change a reader every other scenario judges by, so the geometry is read
// here beside it, from the same elements.
export interface LevelRow {
  label: string;
  value: string;
  // title is the hover the choosing control carries.
  title: string;
  command: string;
  row: PanelBox;
  chooser: PanelBox;
  valueBox: PanelBox;
  // valueLines is how many lines the value is drawn on, and valueClipped whether
  // any of it is cut off.
  valueLines: number;
  valueClipped: boolean;
  mark: { name: string; role: string; box: PanelBox; insideValue: boolean } | null;
  create: RowControl | null;
  createGap: PanelBox | null;
  offer: RowControl | null;
  offerGap: PanelBox | null;
}

const LEVEL_ROWS = `(() => {
  const box = (e) => { if (!e) { return null; } const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  const control = (e) => e ? { name: e.getAttribute('aria-label') || '', title: e.title || '', command: e.dataset.command || '', box: box(e), insideChooser: !!e.closest('button.selector') } : null;
  return [...document.querySelectorAll('.selector-row')].map((r) => {
    const b = r.querySelector('button.selector');
    const v = r.querySelector('.selector-value');
    const m = r.querySelector('.selector-warning');
    return {
      label: ((r.querySelector('.selector-label') || {}).innerText || '').trim(),
      value: v ? (v.innerText || '').trim() : '',
      title: b ? b.title || '' : '',
      command: b ? b.dataset.command || '' : '',
      row: box(r),
      chooser: box(b),
      valueBox: box(v),
      valueLines: v ? v.getClientRects().length : 0,
      valueClipped: v ? v.scrollWidth > v.clientWidth + 0.5 : false,
      mark: m ? { name: m.getAttribute('aria-label') || '', role: m.getAttribute('role') || '', box: box(m), insideValue: !!m.closest('.selector-value') } : null,
      create: control(r.querySelector('button.selector-create')),
      createGap: box(r.querySelector('.selector-create-gap')),
      offer: control(r.querySelector('button.selector-offer')),
      offerGap: box(r.querySelector('.selector-offer-gap')),
    };
  });
})()`;

export function levelRows(doc: WebviewDocument): Promise<LevelRow[]> {
  return doc.evaluate<LevelRow[]>(LEVEL_ROWS);
}

// rowsNow reads the rows off the Commands panel as it is drawn now.
export async function rowsNow(ctx: SuiteContext): Promise<LevelRow[]> {
  return levelRows(await commandsPanel(ctx.d));
}

// describeRows words the rows for a check's report.
export function describeRows(rows: readonly LevelRow[]): string {
  return rows.map((r) => `${r.label}: ${r.value}${r.mark ? ' (marked)' : ''}`).join(' | ');
}

// waitRows reads the rows until `done` holds of them, and answers with the last
// reading either way, so a check reports what it saw rather than a timeout.
export async function waitRows(ctx: SuiteContext, what: string, done: (rows: LevelRow[]) => boolean, boundMs = 20000): Promise<LevelRow[]> {
  const panel = await commandsPanel(ctx.d, boundMs);
  return until(what, boundMs, () => levelRows(panel), done).catch(() => levelRows(panel));
}

// rowValues is the three values in order.
export function rowValues(rows: readonly LevelRow[]): string[] {
  return rows.slice(0, 3).map((r) => r.value);
}

// pressRow presses a row's choosing control where a person presses it.
export async function pressRow(ctx: SuiteContext, key: RowKey): Promise<void> {
  const panel = await commandsPanel(ctx.d);
  await pressIn(ctx.d, panel, `button.selector[data-command="${ROW_COMMAND[key]}"]`);
}

// pressRowControl presses the control drawn beside a row's choosing control: its
// create control or its offer.
export async function pressRowControl(ctx: SuiteContext, key: RowKey, which: 'create' | 'offer'): Promise<void> {
  const panel = await commandsPanel(ctx.d);
  const at = ROW_KEYS.indexOf(key) + 1;
  await pressIn(ctx.d, panel, `.selector-row:nth-of-type(${at}) button.selector-${which}`);
}

// ---- choosers ----------------------------------------------------------------

// ChooserRow is one entry of a chooser: its label, the description beside it, and
// the second line beneath it.
export interface ChooserRow { label: string; description: string; detail: string; text: string }

// Chooser is the quick input drawn now: a list, an input box or a folder dialog
// drawn as a list.
//
// 🔴 A DELIBERATE SECOND READER OF THE QUICK INPUT `quickInput` (workbench.ts)
// READS. These checks judge an entry's second line, the message beneath the box
// and the buttons a folder dialog draws, together with the entries they belong to,
// so all of them are taken in one reading of the drawing; `quickInput` reads none
// of the three, and widening it would change a reader every other scenario judges
// by.
export interface Chooser { title: string; placeholder: string; message: string; value: string; rows: ChooserRow[]; buttons: string[] }

const CHOOSER = `(() => {
  const w = [...document.querySelectorAll('.quick-input-widget')].find((e) => e.style.display !== 'none' && e.getBoundingClientRect().height > 0);
  if (!w) { return null; }
  const text = (e) => ((e && e.innerText) || '').trim();
  const input = w.querySelector('.quick-input-box input');
  const rows = [...w.querySelectorAll('.monaco-list-row')].filter((r) => r.getBoundingClientRect().height > 0).map((r) => {
    const lines = [...r.querySelectorAll('.quick-input-list-row')];
    const first = lines[0] || r;
    return {
      label: text(first.querySelector('.label-name')),
      description: text(first.querySelector('.label-description')),
      detail: lines[1] ? text(lines[1]) : '',
      text: text(r),
    };
  });
  const buttons = [...w.querySelectorAll('.monaco-button')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => text(b)).filter((t) => t !== '');
  return { title: text(w.querySelector('.quick-input-title')), placeholder: input ? input.getAttribute('placeholder') || '' : '', message: text(w.querySelector('.quick-input-message')), value: input ? input.value : '', rows, buttons };
})()`;

export function chooser(d: UiDriver): Promise<Chooser | null> {
  return d.workbench<Chooser | null>(CHOOSER);
}

// waitChooser waits for a quick input for which `done` holds.
export function waitChooser(d: UiDriver, what: string, done: (c: Chooser) => boolean, boundMs = 10000): Promise<Chooser> {
  return until(what, boundMs, () => chooser(d), (c) => c !== null && done(c)) as Promise<Chooser>;
}

// CHOOSER_SETTLE_MS is how long a chooser a row press opened is watched staying
// drawn before it is taken as opened.
export const CHOOSER_SETTLE_MS = 400;

// rowChooser presses a row's choosing control and answers with the chooser it
// opens, once that chooser has stayed drawn a moment.
//
// 🔴 A CHOOSER CAN CLOSE AGAIN AS SOON AS IT OPENS ON A LOADED MACHINE, and it is
// the editor closing it rather than the extension. The press lands in the panel's
// own document, and a chooser loses its place when the focus moves away from it,
// so a focus change from the press arriving after the chooser opened takes it down.
// Such a press is made once more; a chooser that closes again the second time is
// refused, naming that.
//
// The chooser is the one drawn with the row's own placeholder unless `anyPlaceholder`
// says otherwise, for a check whose subject is which placeholder a row's chooser
// carries.
export async function rowChooser(ctx: SuiteContext, key: RowKey, opts: { done?: (c: Chooser) => boolean; anyPlaceholder?: boolean; boundMs?: number } = {}): Promise<Chooser> {
  const done = opts.done ?? ((c: Chooser): boolean => c.rows.length > 0);
  const boundMs = opts.boundMs ?? 10000;
  const wanted = (c: Chooser): boolean => (opts.anyPlaceholder === true || c.placeholder === PLACEHOLDER[key]) && done(c);
  for (let attempt = 1; attempt <= 2; attempt++) {
    await pressRow(ctx, key);
    const opened = await waitChooser(ctx.d, `the ${key} row's chooser`, wanted, boundMs).catch((err: unknown) => {
      if (attempt === 2) { throw err; }
      return null;
    });
    if (opened === null) { continue; }
    const stayed = await holds(CHOOSER_SETTLE_MS, () => chooser(ctx.d), (c) => c !== null && wanted(c), 100);
    const still = stayed.held ? await chooser(ctx.d) : null;
    if (still !== null && wanted(still)) { return still; }
  }
  throw new Error(`the ${key} row's chooser closed again as soon as it opened, on each of two presses, watched ${CHOOSER_SETTLE_MS} ms each time`);
}

// closeChooser dismisses whatever quick input is drawn, as Escape does.
export async function closeChooser(d: UiDriver): Promise<void> {
  if ((await chooser(d)) === null) { return; }
  await d.press('Escape');
  await until('the chooser closing', 5000, () => chooser(d), (c) => c === null).catch(() => undefined);
}

// takeChooserRow presses the entry labelled `label` in the drawn chooser, and
// where no such entry is drawn within the bound refuses naming what the chooser
// drew instead. The press is `pickQuickInputRow`'s (workbench.ts), made once the
// point it presses at is shown to hold the entry.
//
// 🔴 THE POINT PRESSED IS READ BACK BEFORE IT IS PRESSED. A chooser opens under
// wherever the pointer was left, and an entry it comes to rest on whose words are
// cut short raises a hover over the entries beneath it once the pointer has rested
// there a moment; a press at an entry's point then lands on that hover and takes
// nothing. So what is drawn at the point `pickQuickInputRow` presses is read first.
// Where it is not the entry named, the pointer is moved off everything, as a
// person's pointer leaves one entry on its way to another, and the point is read
// again; the press is made only where the entry named is what is drawn there.
export async function takeChooserRow(d: UiDriver, label: string): Promise<void> {
  type Aim = { x: number; y: number; there: string };
  let last: Aim | null = null;
  const aim = async (): Promise<Aim | null> => {
    const v = await d.workbench<Aim | null>(`((label) => {
    const w = [...document.querySelectorAll('.quick-input-widget')].find((e) => e.style.display !== 'none' && e.getBoundingClientRect().height > 0);
    if (!w) { return null; }
    const nameOf = (r) => ((r.querySelector('.label-name') || {}).innerText || '').trim();
    for (const r of w.querySelectorAll('.monaco-list-row')) {
      const b = r.getBoundingClientRect();
      if (nameOf(r) !== label || b.height <= 0) { continue; }
      const x = b.x + Math.min(b.width / 2, 120);
      const y = b.y + b.height / 2;
      const hit = document.elementFromPoint(x, y);
      const row = hit ? hit.closest('.monaco-list-row') : null;
      const hover = hit ? hit.closest('.monaco-hover, .workbench-hover') : null;
      const there = row ? nameOf(row)
        : hover ? 'a hover reading ' + JSON.stringify((hover.innerText || '').trim().slice(0, 200))
        : hit ? hit.tagName.toLowerCase() + (hit.className ? '.' + String(hit.className).split(' ').join('.') : '') : 'nothing';
      return { x, y, there };
    }
    return null;
  })(${JSON.stringify(label)})`);
    last = v;
    if (v !== null && v.there !== label) { await d.moveTo({ x: 1, y: 1 }); }
    return v;
  };
  const at = await until(`an entry labelled "${label}" drawn where it is pressed`, 10000, aim, (v) => v !== null && v.there === label).catch(async () => {
    const drawn = await chooser(d).catch(() => null);
    const aimed = last as Aim | null;
    throw new Error(aimed !== null
      ? `the entry labelled "${label}" was drawn, but the point it would be pressed at shows ${JSON.stringify(aimed.there)} for ${guard(10000)} ms`
      : `no entry labelled "${label}" was drawn within ${guard(10000)} ms; the quick input drawn then: ${drawn === null ? 'none' : JSON.stringify({ placeholder: drawn.placeholder, value: drawn.value, rows: drawn.rows.map((r) => r.label) })}`);
  });
  if (at === null) { throw new Error(`unreachable: ${label}`); }
  await pickQuickInputRow(d, label);
}

// pressChooserButton presses a button the quick input draws by the words on it:
// the one a folder dialog drawn as a list accepts with.
export async function pressChooserButton(d: UiDriver, label: string): Promise<void> {
  const at = await d.workbench<{ x: number; y: number } | null>(`((label) => {
    const w = [...document.querySelectorAll('.quick-input-widget')].find((e) => e.style.display !== 'none' && e.getBoundingClientRect().height > 0);
    if (!w) { return null; }
    for (const b of w.querySelectorAll('.monaco-button')) {
      const r = b.getBoundingClientRect();
      if (((b.innerText || '').trim()) === label && r.width > 0) { return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
    }
    return null;
  })(${JSON.stringify(label)})`);
  if (at === null) { throw new Error(`the quick input draws no button "${label}"`); }
  await d.click(at);
}

// pasteIntoChooser replaces what the drawn quick input's box holds with `text`,
// as one input the way a paste arrives, rather than key by key: a folder dialog
// drawn as a list completes a path as each character is typed, and a completion
// landing between two keys leaves the box holding a folder nobody named.
export async function pasteIntoChooser(d: UiDriver, text: string): Promise<void> {
  await d.workbench(`((text) => {
    const w = [...document.querySelectorAll('.quick-input-widget')].find((e) => e.style.display !== 'none' && e.getBoundingClientRect().height > 0);
    const input = w ? w.querySelector('.quick-input-box input') : null;
    if (!input) { return false; }
    input.focus();
    input.select();
    return document.execCommand('insertText', false, text);
  })(${JSON.stringify(text)})`);
}

// enterIntoDialog enters `text` into the box of a dialog drawn as a list, and
// answers with the dialog as last read. The dialog writes the folder it starts in
// into its own box as it opens, and a path entered before that lands is
// overwritten by it; so the path is entered again until the box holds it, up to
// three times. `what` names the dialog in the wait.
export async function enterIntoDialog(d: UiDriver, text: string, what: string): Promise<Chooser | null> {
  let reading: Chooser | null = null;
  for (let attempt = 1; attempt <= 3 && (reading === null || reading.value !== text); attempt++) {
    await pasteIntoChooser(d, text);
    reading = await until(`${what} reading ${text}`, 4000, () => chooser(d), (c) => c !== null && c.value === text).catch(() => chooser(d));
  }
  return reading;
}

// answerFolderDialog enters a folder into a folder dialog drawn as a list and
// accepts it with the dialog's own button, as a person picks a folder there. It
// refuses to press the button unless the dialog reads exactly that folder, and
// answers with the dialog as it stood before the button was pressed.
export async function answerFolderDialog(d: UiDriver, folder: string, accept: string): Promise<Chooser | null> {
  const want = `${folder}/`;
  const reading = await enterIntoDialog(d, want, 'the folder dialog');
  if (reading === null || reading.value !== want) {
    throw new Error(`the folder dialog reads ${JSON.stringify(reading?.value ?? null)}, not ${JSON.stringify(want)}, so its button would pick a folder nobody named`);
  }
  // A completion the dialog was still working out when the box first read the
  // folder can land a moment later, so the box is watched holding it first.
  const kept = await holds(CHOOSER_SETTLE_MS, () => chooser(d), (c) => c !== null && c.value === want, 100);
  const before = kept.held ? await chooser(d) : (kept.broke ?? null);
  if (before === null || before.value !== want) {
    throw new Error(`the folder dialog moved to ${JSON.stringify(before?.value ?? null)} before its button was pressed`);
  }
  await pressChooserButton(d, accept);
  // A dialog that took the typed path as a place to go into rather than as the
  // answer is still drawn on it, and its button then accepts the folder it is on.
  const still = await until('the folder dialog closing', 3000, () => chooser(d), (c) => c === null).then(() => false, () => true);
  if (still) { await pressChooserButton(d, accept).catch(() => undefined); }
  return before;
}

// PICKER_OBSERVER records every quick input the workbench draws, the moment it is
// drawn: its title, its placeholder, the message beneath the box, and how many
// entries it lists. It is installed before the extension draws anything, so a
// chooser raised while the window comes up is recorded rather than missed.
export const PICKER_OBSERVER = `(() => {
  if (window.__levelsPickers) { return window.__levelsPickers.length; }
  const log = [];
  let last = '';
  const text = (e) => ((e && e.innerText) || '').trim();
  const read = () => {
    const w = [...document.querySelectorAll('.quick-input-widget')].find((e) => e.style.display !== 'none' && e.getBoundingClientRect().height > 0);
    if (!w) { return null; }
    const input = w.querySelector('.quick-input-box input');
    return { title: text(w.querySelector('.quick-input-title')), placeholder: input ? input.getAttribute('placeholder') || '' : '', message: text(w.querySelector('.quick-input-message')), rows: [...w.querySelectorAll('.monaco-list-row')].filter((r) => r.getBoundingClientRect().height > 0).length };
  };
  const sample = () => {
    const v = read();
    const key = v === null ? '' : [v.title, v.placeholder, v.message].join('\\u0000');
    if (key === last) { return; }
    last = key;
    if (v !== null) { log.push({ at: Date.now(), ...v }); }
  };
  sample();
  new MutationObserver(sample).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'placeholder', 'class'] });
  window.__levelsPickers = log;
  return log.length;
})()`;

// PickerSeen is one quick input the observer recorded.
export interface PickerSeen { at: number; title: string; placeholder: string; message: string; rows: number }

export function pickersSeen(d: UiDriver): Promise<PickerSeen[]> {
  return d.workbench<PickerSeen[]>('window.__levelsPickers || []');
}

// takeToFolderDialog takes the drawn chooser's entry that opens the editor's
// folder dialog, and answers with that dialog once it is drawn with `title`.
// Where it is not drawn within the bound it refuses naming every quick input the
// workbench drew since the entry was taken, and the one drawn then.
export async function takeToFolderDialog(d: UiDriver, entry: string, title: string, boundMs = 10000): Promise<Chooser> {
  const mark = (await pickersSeen(d)).length;
  await takeChooserRow(d, entry);
  return waitChooser(d, `the dialog titled "${title}"`, (x) => x.title === title, boundMs).catch(async () => {
    const since = (await pickersSeen(d).catch(() => [] as PickerSeen[])).slice(mark).map((p) => ({ title: p.title, placeholder: p.placeholder, rows: p.rows }));
    const now = await chooser(d).catch(() => null);
    throw new Error(`no dialog titled "${title}" was drawn within ${boundMs} ms of taking "${entry}"; the quick inputs drawn since ${JSON.stringify(since)}; drawn now ${now === null ? 'none' : JSON.stringify({ title: now.title, placeholder: now.placeholder, value: now.value, rows: now.rows.map((r) => r.label) })}`);
  });
}

// ---- dialogs -----------------------------------------------------------------

// DrawnDialog is a modal dialog as the workbench draws it: what `dialog`
// (workbench.ts) reads of it, the class of the icon it draws, and all its text.
export interface DrawnDialog extends Dialog { icon: string; text: string }

const DIALOG_ICON = `(() => { const i = document.querySelector('.monaco-dialog-box .dialog-icon'); return i ? String(i.className || '') : ''; })()`;

// drawnDialog reads the dialog with `dialog`, and its icon and its whole text
// beside it; a modal dialog stands still while it is drawn, so the three readings
// are of one drawing.
export async function drawnDialog(d: UiDriver): Promise<DrawnDialog | null> {
  const base = await dialog(d);
  if (base === null) { return null; }
  const icon = await d.workbench<string>(DIALOG_ICON);
  const text = await workbenchText(d, '.monaco-dialog-box');
  return { ...base, icon, text };
}

// DIALOG_OBSERVER records every modal dialog the workbench draws, with its message,
// from the moment it is installed.
export const DIALOG_OBSERVER = `(() => {
  if (window.__levelsDialogs) { return window.__levelsDialogs.length; }
  const log = [];
  let last = null;
  const sample = () => {
    const d = document.querySelector('.monaco-dialog-box');
    const drawn = !!d && d.getBoundingClientRect().height > 0;
    const message = drawn ? ((d.querySelector('.dialog-message-text') || {}).innerText || '').trim() : '';
    const detail = drawn ? ((d.querySelector('.dialog-message-detail') || {}).innerText || '').trim() : '';
    const key = drawn ? message + '\\u0000' + detail : '';
    if (key === last) { return; }
    last = key;
    if (drawn) { log.push({ at: Date.now(), message, detail }); }
  };
  sample();
  new MutationObserver(sample).observe(document.body, { subtree: true, childList: true, characterData: true });
  window.__levelsDialogs = log;
  return log.length;
})()`;

export interface DialogSeen { at: number; message: string; detail: string }

export function dialogsSeen(d: UiDriver): Promise<DialogSeen[]> {
  return d.workbench<DialogSeen[]>('window.__levelsDialogs || []');
}

// EDITOR_DONT_SAVE is the editor's own answer, on the question it asks before a
// window leaves an untitled workspace, that keeps no file of that workspace.
export const EDITOR_DONT_SAVE = 'Don\'t Save';

// EDITOR_CANCEL is the editor's own button declining a modal dialog an extension
// raises.
export const EDITOR_CANCEL = 'Cancel';

// answerWorkspaceSaveIfAsked answers the editor's own question about saving an
// untitled workspace — which it asks as a window leaves one, whoever asked for
// the window to change — with the answer that keeps nothing. It is called once the
// change has been asked for, and waits for whichever comes: the question drawn, or
// the window going without asking it, read as the workbench's document no longer
// being the one marked as the wait began. It answers with the question as drawn,
// or null where the window went without one.
export async function answerWorkspaceSaveIfAsked(d: UiDriver, boundMs = 5000): Promise<DrawnDialog | null> {
  const key = '__levelsSaveQuestion';
  const token = await markDocument(d, key).catch(() => null);
  if (token === null) { return null; }
  const seen = await until('the editor asking whether to save the workspace, or the window going without asking', boundMs,
    async () => ({ asked: await drawnDialog(d).catch(() => null), here: await sameDocument(d, token, key) }),
    (v) => (v.asked !== null && v.asked.buttons.includes(EDITOR_DONT_SAVE)) || !v.here);
  if (seen.asked === null || !seen.asked.buttons.includes(EDITOR_DONT_SAVE)) { return null; }
  await pressDialogButton(d, EDITOR_DONT_SAVE);
  return seen.asked;
}

// ---- the window --------------------------------------------------------------

// LEVEL_OBSERVERS are the observers every scenario of these checks installs as the
// workbench comes up, and again after every window change.
export const LEVEL_OBSERVERS: readonly string[] = [PICKER_OBSERVER, DIALOG_OBSERVER];

// installLevelObservers installs the workbench's own observers and these.
export async function installLevelObservers(d: UiDriver): Promise<void> {
  await observeWorkbench(d);
  for (const o of LEVEL_OBSERVERS) { await d.workbench(o); }
}

// markDocument writes a token into the workbench's document under `key`, so a
// later reading can tell whether the document is still the one it was, or the
// window reloaded. Each reader that keeps a token of its own keeps it under a key
// of its own, so one reader's mark never overwrites another's.
export async function markDocument(d: UiDriver, key = '__levelsDocument'): Promise<string> {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await d.workbench(`(window[${JSON.stringify(key)}] = ${JSON.stringify(token)})`);
  return token;
}

export async function sameDocument(d: UiDriver, token: string, key = '__levelsDocument'): Promise<boolean> {
  return (await d.workbench<string | null>(`window[${JSON.stringify(key)}] || null`).catch(() => null)) === token;
}

// windowTitle is the title the editor gives its window.
export function windowTitle(d: UiDriver): Promise<string> {
  return d.workbench<string>('document.title');
}

// Folder is one folder the window has open, as the probe lists it.
export interface OpenFolder { name: string; path: string }

export function openFolders(ctx: SuiteContext): Promise<OpenFolder[]> {
  return ctx.probe.request<OpenFolder[]>('workspace.folders');
}

// ToastLedger keeps every notification a scenario's windows drew, across reloads.
// The workbench's own observer records into its document, and a reload replaces
// the document, so what it held is taken here before each change. Where the
// change leaves the document in place — the extensions restarting in the same
// window, or an add in place — the observer's record goes on, and the ledger goes
// on from where it had read to.
const LEDGER_KEY = '__levelsLedgerDocument';

export class ToastLedger {
  private kept: Toast[] = [];
  private offset = 0;
  private token: string | null = null;

  async beforeChange(d: UiDriver): Promise<void> {
    const t = await toasts(d).catch(() => [] as Toast[]);
    this.kept.push(...t.slice(this.offset));
    this.offset = t.length;
    this.token = await markDocument(d, LEDGER_KEY).catch(() => null);
  }

  async afterChange(d: UiDriver): Promise<void> {
    if (this.token === null || !(await sameDocument(d, this.token, LEDGER_KEY))) { this.offset = 0; }
  }

  async all(d: UiDriver): Promise<Toast[]> {
    const t = await toasts(d).catch(() => [] as Toast[]);
    return [...this.kept, ...t.slice(this.offset)];
  }
}

// WindowChange is what one change of the window came to: whether the extension
// host started again, whether the workbench's document was replaced, and how long
// the probe took to answer again.
export interface WindowChange { restarted: boolean; reloaded: boolean; ms: number; before: Hello }

// changeWindow runs `act`, which changes the window, and waits for what it does:
// for the probe to answer from a new start where the extensions restart, and the
// observers put back where the document was replaced. `expectRestart` false
// watches the probe over `quietMs` instead, and reports whether it stopped
// answering from the start it answered from before `act`.
export async function changeWindow(ctx: SuiteContext, ledger: ToastLedger, act: () => Promise<void>, opts: { expectRestart?: boolean; boundMs?: number; quietMs?: number } = {}): Promise<WindowChange> {
  const before = await ctx.probe.request<Hello>('hello');
  await ledger.beforeChange(ctx.d);
  const token = await markDocument(ctx.d);
  const t0 = Date.now();
  await act();
  let restarted = false;
  if (opts.expectRestart === false) {
    const hello = (): Promise<Hello | null> => ctx.probe.request<Hello>('hello', {}, 2000).catch(() => null);
    const quiet = await holds(opts.quietMs ?? 3000, hello, (v) => v !== null && v.instance === before.instance);
    restarted = !quiet.held;
    // A probe that stopped answering is a host being replaced; one that answered
    // from another start has already been replaced.
    if (!quiet.held && (quiet.broke ?? null) === null) { await ctx.probe.waitHello(opts.boundMs ?? 60000, before.instance); }
  } else {
    await ctx.probe.waitHello(opts.boundMs ?? 60000, before.instance);
    restarted = true;
  }
  // The workbench's own mark, read once it answers an evaluation again: a document
  // being replaced answers none, so any answer is the state waited for.
  const mark = await until('the workbench answering', 30000, () => ctx.d.workbench<string | null>('window.__levelsDocument || null'), (answer) => answer === null || typeof answer === 'string');
  const reloaded = mark !== token;
  await installLevelObservers(ctx.d);
  await ledger.afterChange(ctx.d);
  return { restarted, reloaded, ms: Date.now() - t0, before };
}

// reloadWindow reloads the window, as Developer: Reload Window does.
export function reloadWindow(ctx: SuiteContext, ledger: ToastLedger): Promise<WindowChange> {
  return changeWindow(ctx, ledger, () => send(ctx, 'workbench.action.reloadWindow'));
}

// openFolderHere puts the window on one folder alone, as File > Open Folder does,
// answering the editor's own question about saving the workspace where the window
// is leaving an untitled one.
export function openFolderHere(ctx: SuiteContext, ledger: ToastLedger, folder: string): Promise<WindowChange> {
  return changeWindow(ctx, ledger, async () => {
    await send(ctx, 'vscode.openFolder', [{ $file: folder }]);
    await answerWorkspaceSaveIfAsked(ctx.d, 3000);
  });
}

// closeFolderHere leaves the window open on no folder at all, as File > Close
// Folder does.
export function closeFolderHere(ctx: SuiteContext, ledger: ToastLedger): Promise<WindowChange> {
  return changeWindow(ctx, ledger, () => send(ctx, 'workbench.action.closeFolder'));
}

// addWithTheEditorsCommand adds `folder` to the window with the editor's own Add
// Folder to Workspace, which carries no answer of Aggrega's across, answering the
// folder dialog it draws.
export function addWithTheEditorsCommand(ctx: SuiteContext, ledger: ToastLedger, folder: string): Promise<WindowChange> {
  return changeWindow(ctx, ledger, async () => {
    await send(ctx, 'workbench.action.addRootFolder');
    await waitChooser(ctx.d, 'the editor\'s folder dialog', (q) => q.buttons.includes(EDITOR_ADD) || q.value !== '', 15000);
    await answerFolderDialog(ctx.d, folder, EDITOR_ADD);
  });
}

// EDITOR_ADD is the button the editor's own folder dialog for an add accepts with.
export const EDITOR_ADD = 'Add';

// ---- the language server and the status bar ------------------------------------

// SERVER_STARTED is the line the Aggrega output channel carries each time a
// language server starts: the files it read, which it watches from then on.
export const SERVER_STARTED = /^watching the configuration files the language server read/m;

export function serverStarts(text: string): number {
  return text.split('\n').filter((l) => SERVER_STARTED.test(l)).length;
}

// statusItem finds the status-bar item whose words `match` takes.
export async function statusItem(ctx: SuiteContext, match: (i: StatusItem) => boolean): Promise<StatusItem | undefined> {
  return (await statusItems(ctx.d)).find(match);
}

// statusHover rests the pointer on the status-bar item `match` takes and answers
// with the words of the hover drawn for it, or null where no such item is drawn.
export async function statusHover(ctx: SuiteContext, match: (i: StatusItem) => boolean): Promise<{ item: StatusItem; hover: string } | null> {
  const item = await statusItem(ctx, match);
  if (item === undefined) { return null; }
  return { item, hover: await hoverAt(ctx.d, item.centre) };
}

// WELCOME_WORKSPACE_VALUE reads, in one welcome page's document, the text its
// workspace step stands at, or null where the document draws no such step.
export const WELCOME_WORKSPACE_VALUE = `(() => { const e = document.querySelector('section.step[data-step="workspace"] .step-value'); return e ? (e.innerText || '').trim() : null; })()`;

// welcomeWorkspaceValues reads what the welcome page's workspace step stands at in
// every welcome page drawn, opening one where none is. A window whose extensions
// restarted can hold the page it had beside the one drawn again, so every one is
// read rather than the first.
export async function welcomeWorkspaceValues(ctx: SuiteContext): Promise<string[]> {
  const read = async (): Promise<string[]> => (await answersIn<string | null>(ctx.d, WELCOME_WORKSPACE_VALUE))
    .map((a) => a.value).filter((v): v is string => v !== null);
  const drawn = await read();
  if (drawn.length > 0) { return drawn; }
  await run(ctx, 'aggrega.getStarted.open', [], 10000).catch(() => undefined);
  return until('the welcome page drawing its workspace step', 20000, read, (v) => v.length > 0).catch(() => [] as string[]);
}

// serverIn waits for the one language server this window started, as `serverNow`
// (suite-context.ts) reads it, to be working in `root`, and answers with it, or
// with null once the bound has passed.
export function serverIn(ctx: SuiteContext, root: string, boundMs = 30000, notPid?: number): Promise<Server | null> {
  return until(`a language server working in ${root}`, boundMs, async () => serverNow(ctx, notPid), (s) => s !== null && s.cwd === root).catch(() => null);
}

// serversWorking words where every language server running works, for a check's
// report.
export function serversWorking(ctx: SuiteContext): string {
  return JSON.stringify(languageServers(ctx).map((s) => s.cwd));
}

// readyAnyway waits for what `ready` (suite-context.ts) waits for save the
// language server running: the welcome page the extension opens at start, where
// one is drawn, and the Aggrega side bar showing the Commands panel. It is for a
// window whose folder reaches no workspace, or none yet, or that has no folder.
export async function readyAnyway(ctx: SuiteContext): Promise<void> {
  await documentWith(ctx.d, 'the welcome page the extension opens at start', `!!document.querySelector('.version-entry')`, 30000).catch(() => undefined);
  await run(ctx, 'workbench.view.extension.aggrega');
  await commandsPanel(ctx.d);
}

// PendingChoice is what a window offering the choice of Aggrega workspace draws:
// the status-bar item offering it, and the notifications drawn since a mark that
// ask for it.
export interface PendingChoice { item: boolean; notices: string[] }

export async function pendingChoice(ctx: SuiteContext, toastMark: number): Promise<PendingChoice> {
  return {
    item: (await statusItem(ctx, (i) => i.text === PENDING_CHOICE_ACTION)) !== undefined,
    notices: (await toastsSince(ctx.d, toastMark)).map((t) => t.message).filter((m) => m.endsWith(PENDING_CHOICE_CLOSING)),
  };
}

// noChoicePending watches a window over `windowMs` for either of the two, and
// answers whether neither was drawn at any reading, with the reading that broke it.
export async function noChoicePending(ctx: SuiteContext, toastMark: number, windowMs: number): Promise<{ held: boolean; broke?: PendingChoice }> {
  const r = await holds(windowMs, () => pendingChoice(ctx, toastMark), (v) => !v.item && v.notices.length === 0);
  return { held: r.held, broke: r.broke };
}

// describePending words a pending-choice reading for a check's report.
export function describePending(v: PendingChoice | undefined): string {
  if (v === undefined) { return 'no choice offered'; }
  return `${v.item ? `"${PENDING_CHOICE_ACTION}" on the status bar` : 'nothing on the status bar'} and the notices ${JSON.stringify(v.notices)}`;
}

// needRows stops a check whose rows are not drawn.
export function needRows(rows: readonly LevelRow[]): void {
  need(rows.length >= 3, `the Commands panel draws ${rows.length} context rows, not three`);
}

// ---- the words a reader is to meet ---------------------------------------------
//
// Held here as written, so a change of wording in the extension is a change these
// checks report rather than follow. The rows draw the three levels' names as their
// labels, the Aggrega workspace row's shortened; every sentence below is one a
// reader reads on a row, a chooser, a dialog or a notification, and names that
// level in full.

export const ROW_LABELS: readonly string[] = ['Project folder', 'Agg. worksp.', 'Release'];

// LONG_LABEL_VALUE_WIDTH is how wide each row's value was drawn, in pixels, at the
// side bar's default width while the Aggrega workspace row drew the level's whole
// name as its label. The shortened label gives the values the room the long one
// took, so each is drawn wider than this.
export const LONG_LABEL_VALUE_WIDTH = 76;

export const PLACEHOLDER: Record<RowKey, string> = {
  project: 'Aggrega: choose which Project folder the editor works from',
  workspace: 'Aggrega: choose which Aggrega workspace the editor works in',
  release: 'Aggrega: choose the Release to work on',
};

export const OPEN_ENTRY = 'Open folder…';
export const ADD_ENTRY = 'Add folder to this window…';
export const WIDEN_ANOTHER = 'Choose another folder Aggrega recognises…';
export const WIDEN_FIRST = 'Choose a folder Aggrega recognises…';
export const CREATE_WORKSPACE = 'Create an Aggrega workspace';
export const CREATE_RELEASE = 'Create a Release';
export const OPEN_ROOT = 'Open the Aggrega workspace as the Project folder. The window reloads.';

// The second lines of the entries that reach further, and the cost an add names in
// a window on one folder that is not remote, where the extensions restart rather
// than the window reloading.
export const WIDEN_DETAIL = 'Looks through the folders you have open for one Aggrega recognises, and adds it.';
export const ADD_DETAIL = 'Reaches a folder this window does not have open yet.';
export const OPEN_DETAIL_REPLACING = 'Opens the folder you pick in place of what this window has open. The window reloads.';
export const OPEN_DETAIL_EMPTY = 'Opens the folder you pick in this window. The window reloads.';
export const LOCAL_ADD_COST = ' Extensions restart.';

export const OPEN_DIALOG = { title: 'Aggrega: select a folder to open in this window', accept: 'Open' } as const;
export const ADD_DIALOG = { title: 'Aggrega: select a folder to add to this window', accept: 'Add' } as const;
export const CHOOSE_FOLDER_PLACEHOLDER = 'Aggrega: choose the folder to work in';

export const NAME_PROMPT = 'Name for the new Release — leave empty for a placeholder';

export const NO_WORKSPACE = 'Aggrega: no Aggrega workspace is available in this project. Open a Project folder holding .aggrega-config.yaml or a Release file, or create an Aggrega workspace.';
export const NO_WORKSPACE_HOVER = 'Aggrega: no Aggrega workspace is available in this project.\nOpen a Project folder holding .aggrega-config.yaml or a Release file, or create an Aggrega workspace.';
export const NOTHING_TO_CHOOSE = 'Aggrega: no folder in this workspace carries anything Aggrega recognises as a workspace root, so there is none to choose. Create a workspace configuration instead.';
export const CONFIG_CREATED = 'Aggrega: .aggrega-config.yaml created; this folder is now the workspace root.';
export const NO_FOLDER_HOVER = 'Aggrega: no Project folder is open.\nClick to open one.';
export const PENDING_CHOICE_ACTION = 'Choose Aggrega workspace…';
export const PENDING_CHOICE_CLOSING = ' Choose one to start the language server.';
export const pendingChoiceNotice = (n: number): string => `Aggrega: ${n} Aggrega workspaces are available in this project.${PENDING_CHOICE_CLOSING}`;
export const nowWorkingIn = (root: string): string => `Aggrega: now working in ${root}. The language server is restarting there.`;
export const nowWorkingFrom = (folder: string): string => `Aggrega: now working from ${folder}.`;
export const alreadyOpen = (folder: string): string => `Aggrega: ${folder} is already open in this window.`;
export const droppedRelease = (release: string): string => `Aggrega: ${release} is no longer offered in this workspace, so the previous selection was dropped. Falling back to this workspace's default.`;
export const droppedAnchor = (marker: string): string => `Aggrega: ${marker} no longer marks an Aggrega workspace in this project, so the remembered choice was dropped.`;

// Two sentences no surface is to draw: a click on a row with one candidate
// answered with a refusal instead of a chooser, and a hover promising a switch.
export const SENTENCES_NO_SURFACE_DRAWS: readonly string[] = ['Aggrega: only one anchored folder; nothing to switch to.', 'Click to switch the anchored folder.'];

// Three hover lines no row is to carry, since a row's hover says nothing about how
// many candidates a level other than the Project folder holds, nor where the
// Releases on offer sit.
export const HOVER_LINES_NO_ROW_CARRIES: readonly string[] = [
  'Only one Aggrega workspace is available, so there are no others to choose between.',
  'Only one Release is available, so there are no others to choose between.',
  'The Releases on offer are the ones inside this folder.',
];

export const SOLE_PROJECT_FOLDER = 'Only one Project folder is available, so there are no others to choose between.';

// The Project folder row's closing line: the invitation to choose between the
// folders a window has open, and, where it has only one, what a press offers
// there instead.
export const CHOOSE_PROJECT_FOLDER = 'Click to choose which Project folder the editor works from.';
export const OPEN_OR_ADD_A_FOLDER = 'Click to open a folder or add one to this window.';

export function projectHover(folder: string, sole: boolean): string {
  return [`Project folder: ${folder}`, ...(sole ? [SOLE_PROJECT_FOLDER] : []), 'The Aggrega workspaces on offer are the ones this folder reaches.', sole ? OPEN_OR_ADD_A_FOLDER : CHOOSE_PROJECT_FOLDER].join('\n');
}

// workspaceHover is the Aggrega workspace row's hover for `root`: naming the folder
// opened where that is somewhere else, beneath the warning sentence where the
// workspace sits outside that folder and with none where it sits inside it.
export function workspaceHover(root: string, openedElsewhere?: string, where: 'outside' | 'inside' = 'outside'): string {
  const warned = where === 'outside' ? '\n\n⚠️ Aggrega is using a workspace from outside the folder you opened.' : '';
  const between = openedElsewhere === undefined ? '' : `${warned}\n\nProject folder: ${openedElsewhere}`;
  return `Aggrega workspace: ${root}${between}\n\nClick to choose which Aggrega workspace the editor works in.`;
}

export function releaseHover(absolute: string): string {
  return `Aggrega selected Release: ${absolute}\n\nClick to choose a different Release.`;
}

// The interruption raised where the Aggrega workspace sits outside the folder
// opened: its message, the two lines beneath it, and its three buttons.
export const ABOVE_MESSAGE = 'Aggrega is using a workspace from outside the folder you opened.';
export const aboveDetail = (root: string, folder: string): string => `Aggrega workspace: ${root}\nProject folder: ${folder}`;
export const ABOVE_OPEN = 'Open workspace (reloads the window)';
export const ABOVE_CONTINUE = 'Continue here';
export const ABOVE_SILENCE = 'Don\'t show again for this folder';
export const ABOVE_BUTTONS: readonly string[] = [ABOVE_OPEN, ABOVE_CONTINUE, ABOVE_SILENCE];

// linesOf splits a hover into its lines with the blank ones left out, for the one
// surface — a status-bar item's hover — that draws its lines without the blank
// lines between them.
export function linesOf(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
}
