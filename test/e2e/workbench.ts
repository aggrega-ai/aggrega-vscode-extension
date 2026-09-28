// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { DAEMON_STANDING_WORDS } from '../../src/daemon-status';
import { Box, UiDriver, WebviewDocument } from './drivers';

// Reading what the editor draws, and pressing what a person presses.
//
// 🔴 EVERY WAIT HERE IS A BOUNDED POLL ON A NAMED CONDITION, AND A TRANSIENT
// READING IS CAUGHT BY AN OBSERVER INSTALLED BEFORE THE ACTION. A notification
// the editor hides after a few seconds, or a status reading that lasts a moment,
// is recorded as it is drawn rather than hoped for by a later look; a wait that
// expires names what it waited for and the last thing it read.

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// WaitExpired is a bounded wait that ran out, carrying what it waited for.
export class WaitExpired extends Error {
  constructor(readonly what: string, readonly boundMs: number, readonly last: string) {
    super(`${what} did not happen within ${boundMs} ms (last reading ${last})`);
  }
}

// until polls `read` until `done` holds of what it returned, for at most `boundMs`.
export async function until<T>(what: string, boundMs: number, read: () => Promise<T>, done: (v: T) => boolean, everyMs = 150): Promise<T> {
  const end = Date.now() + boundMs;
  let last: T | undefined;
  let lastError = '';
  for (;;) {
    try {
      last = await read();
      if (done(last)) { return last; }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (Date.now() >= end) { break; }
    await sleep(everyMs);
  }
  throw new WaitExpired(what, boundMs, `${JSON.stringify(last ?? null).slice(0, 400)}${lastError ? `; last error ${lastError.slice(0, 200)}` : ''}`);
}

// holds watches `read` over a stated window and reports whether `ok` held at
// every reading — the observation behind an absence. The caller pairs it with a
// positive control in the same scenario.
export async function holds<T>(windowMs: number, read: () => Promise<T>, ok: (v: T) => boolean, everyMs = 250): Promise<{ held: boolean; readings: number; broke?: T; atMs?: number }> {
  const t0 = Date.now();
  let readings = 0;
  while (Date.now() - t0 < windowMs) {
    const v = await read();
    readings++;
    if (!ok(v)) { return { held: false, readings, broke: v, atMs: Date.now() - t0 }; }
    await sleep(everyMs);
  }
  return { held: true, readings };
}

// ---- the status bar ----------------------------------------------------------

// statusObserver is installed in the workbench before the action it watches, so
// a reading that lasts a moment is caught as it is drawn rather than hoped for by
// a later poll. It records every change of the language server's reading on the
// status bar, in the extension's own words.
export function statusObserver(words: string[]): string {
  return `(() => {
    if (window.__editorSuiteStatus) { return window.__editorSuiteStatus.length; }
    const words = ${JSON.stringify(words)};
    const bar = document.getElementById('workbench.parts.statusbar');
    const read = () => [...bar.querySelectorAll('.statusbar-item')].map((e) => (e.innerText || '').trim())
      .filter((t) => words.some((w) => t === 'Aggrega: ' + w)).join(' | ');
    const log = [];
    let last = null;
    const sample = () => { const v = read(); if (v !== last) { log.push({ at: Date.now(), reading: v }); last = v; } };
    sample();
    new MutationObserver(sample).observe(bar, { subtree: true, childList: true, characterData: true, attributes: true });
    window.__editorSuiteStatus = log;
    return log.length;
  })()`;
}

export const STATUS_WORDS = Object.values(DAEMON_STANDING_WORDS);
export const RUNNING = `Aggrega: ${DAEMON_STANDING_WORDS.running}`;
export const STARTING = `Aggrega: ${DAEMON_STANDING_WORDS.starting}`;
export const NOT_RUNNING = `Aggrega: ${DAEMON_STANDING_WORDS.notRunning}`;

export interface Reading { at: number; reading: string }

export function statusLog(driver: UiDriver): Promise<Reading[]> {
  return driver.workbench<Reading[]>('window.__editorSuiteStatus || []');
}

export async function statusNow(driver: UiDriver): Promise<string> {
  const log = await statusLog(driver);
  return log.length === 0 ? '' : log[log.length - 1].reading;
}

export function waitStatus(driver: UiDriver, reading: string, boundMs: number): Promise<string> {
  return until(`the status bar reading "${reading}"`, boundMs, () => statusNow(driver), (v) => v === reading);
}

// ---- notifications -----------------------------------------------------------

// Toast is one notification as it was drawn.
export interface Toast { at: number; message: string; severity: 'error' | 'warning' | 'info'; buttons: string[] }

// TOAST_OBSERVER records every notification the workbench draws, as a toast or
// in the notification list, the moment it appears.
const TOAST_OBSERVER = `(() => {
  if (window.__editorSuiteToasts) { return window.__editorSuiteToasts.length; }
  const log = [];
  const seen = new WeakMap();
  const scan = () => {
    for (const item of document.querySelectorAll('.notification-list-item')) {
      const m = item.querySelector('.notification-list-item-message');
      const text = ((m && m.innerText) || '').trim();
      if (text === '' || seen.get(item) === text) { continue; }
      seen.set(item, text);
      const icon = item.querySelector('.notification-list-item-icon');
      const cls = icon ? icon.className : '';
      const severity = /codicon-error/.test(cls) ? 'error' : /codicon-warning/.test(cls) ? 'warning' : 'info';
      const buttons = [...item.querySelectorAll('.monaco-button')].map((b) => (b.innerText || '').trim()).filter((t) => t !== '');
      log.push({ at: Date.now(), message: text, severity, buttons });
    }
  };
  scan();
  new MutationObserver(scan).observe(document.body, { subtree: true, childList: true, characterData: true });
  window.__editorSuiteToasts = log;
  return log.length;
})()`;

// observeWorkbench installs the status and notification observers as soon as
// the workbench has drawn its status bar. Installing twice is harmless; after a
// window reload they are installed again.
export async function observeWorkbench(driver: UiDriver): Promise<void> {
  await until('the workbench drawing its status bar', 30000,
    () => driver.workbench<boolean>(`!!document.getElementById('workbench.parts.statusbar') && !!document.body`), (v) => v, 50);
  await driver.workbench(statusObserver(STATUS_WORDS));
  await driver.workbench(TOAST_OBSERVER);
}

export function toasts(driver: UiDriver): Promise<Toast[]> {
  return driver.workbench<Toast[]>('window.__editorSuiteToasts || []');
}

// toastsSince returns the notifications drawn after `mark`, a count taken
// earlier from toasts().
export async function toastsSince(driver: UiDriver, mark: number): Promise<Toast[]> {
  return (await toasts(driver)).slice(mark);
}

export function waitToast(driver: UiDriver, what: string, mark: number, match: (t: Toast) => boolean, boundMs: number): Promise<Toast> {
  return until(what, boundMs, async () => (await toastsSince(driver, mark)).find(match) ?? null, (t) => t !== null) as Promise<Toast>;
}

// pressToastButton presses the button labelled `label` on the notification whose
// message starts with `prefix`, as drawn now, and reports false where no such
// button is drawn.
export async function pressToastButton(driver: UiDriver, prefix: string, label: string): Promise<boolean> {
  const find = `((prefix, label) => {
    for (const item of document.querySelectorAll('.notification-list-item')) {
      const m = item.querySelector('.notification-list-item-message');
      if (!(((m && m.innerText) || '').trim().startsWith(prefix))) { continue; }
      for (const b of item.querySelectorAll('.monaco-button')) {
        if ((b.innerText || '').trim() !== label) { continue; }
        const r = b.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
      }
    }
    return null;
  })(${JSON.stringify(prefix)}, ${JSON.stringify(label)})`;
  const at = await driver.workbench<{ x: number; y: number } | null>(find);
  if (at === null) { return false; }
  await driver.click(at);
  return true;
}

// ---- webview panels ----------------------------------------------------------

// documentWith finds the one webview document for which `probe` evaluates true,
// waiting for it to be drawn.
export async function documentWith(driver: UiDriver, what: string, probe: string, boundMs: number): Promise<WebviewDocument> {
  let found: WebviewDocument | null = null;
  await until(what, boundMs, async () => {
    const hits: WebviewDocument[] = [];
    for (const d of await driver.webviews()) {
      try { if (await d.evaluate<boolean>(probe)) { hits.push(d); } } catch { /* a document being replaced */ }
    }
    found = hits.length === 1 ? hits[0] : null;
    return hits.length;
  }, (n) => n === 1);
  if (found === null) { throw new Error(`unreachable: ${what}`); }
  return found;
}

// COMMANDS_PANEL is what identifies the Commands panel's document: its buttons.
export const COMMANDS_PANEL = `document.querySelectorAll('button.op[data-command]').length > 0`;

export function commandsPanel(driver: UiDriver, boundMs = 30000): Promise<WebviewDocument> {
  return documentWith(driver, 'the Commands panel drawing its buttons', COMMANDS_PANEL, boundMs);
}

// SelectorRow is one of the Commands panel's context rows as drawn.
export interface SelectorRow { label: string; value: string; warning: boolean; command: string; title: string }

export function selectorRows(doc: WebviewDocument): Promise<SelectorRow[]> {
  return doc.evaluate<SelectorRow[]>(`[...document.querySelectorAll('.selector-row')].map((r) => {
    const b = r.querySelector('button.selector');
    return {
      label: ((r.querySelector('.selector-label') || {}).innerText || '').trim(),
      value: ((r.querySelector('.selector-value') || {}).innerText || '').trim(),
      warning: !!r.querySelector('.selector-warning'),
      command: b ? b.dataset.command || '' : '',
      title: b ? b.title || '' : '',
    };
  })`);
}

// OperationButton is one operation as drawn on the Commands panel.
export interface OperationButton { command: string; label: string; disabled: boolean; title: string }

export function operationButtons(doc: WebviewDocument): Promise<OperationButton[]> {
  return doc.evaluate<OperationButton[]>(`[...document.querySelectorAll('button.op[data-command]')].map((b) => ({
    command: b.dataset.command || '',
    label: ((b.querySelector('.op-label') || {}).innerText || '').trim(),
    disabled: b.disabled,
    title: b.title || '',
  }))`);
}

// centre is the middle of a box, where a person presses it.
export function centre(b: Box): { x: number; y: number } {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// pressIn presses the element `selector` matches in `doc` (the workbench where
// null) where a person would, and refuses where it is not drawn. An element a
// panel has scrolled out of sight is scrolled into it first, as a person scrolls
// to a button before pressing it: a press at the coordinates of a hidden element
// lands on whatever is drawn there instead.
export async function pressIn(driver: UiDriver, doc: WebviewDocument | null, selector: string): Promise<Box> {
  if (doc !== null) {
    await doc.evaluate(`((s) => { const e = document.querySelector(s); if (e) { e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } return !!e; })(${JSON.stringify(selector)})`);
  }
  const b = await until(`${selector} being drawn`, 10000, () => driver.box(doc, selector), (v) => v !== null && v.width > 0 && v.height > 0);
  if (b === null) { throw new Error(`unreachable: ${selector}`); }
  await driver.click(centre(b));
  return b;
}

export async function hoverIn(driver: UiDriver, doc: WebviewDocument | null, selector: string): Promise<Box> {
  const b = await until(`${selector} being drawn`, 10000, () => driver.box(doc, selector), (v) => v !== null && v.width > 0 && v.height > 0);
  if (b === null) { throw new Error(`unreachable: ${selector}`); }
  await driver.moveTo(centre(b));
  return b;
}

// pressOperation presses one operation's button on the Commands panel.
export async function pressOperation(driver: UiDriver, doc: WebviewDocument, command: string): Promise<void> {
  const buttons = await operationButtons(doc);
  const b = buttons.find((x) => x.command === command);
  if (!b) { throw new Error(`the Commands panel draws no button for ${command}; it draws ${buttons.map((x) => x.command).join(', ')}`); }
  if (b.disabled) { throw new Error(`the Commands panel's button for ${command} is greyed: ${b.title}`); }
  await pressIn(driver, doc, `button.op[data-command="${command}"]`);
}

// ---- the output channel ------------------------------------------------------

// OutputLog reads the Aggrega output channel from the file the editor writes it
// to. The editor starts a new file at every start of the extension host, so the
// newest one is the channel as it stands.
export class OutputLog {
  constructor(private readonly userData: string) {}

  file(): string | null {
    const logs = path.join(this.userData, 'logs');
    if (!fs.existsSync(logs)) { return null; }
    const candidates: string[] = [];
    for (const stamp of fs.readdirSync(logs)) {
      const exthost = path.join(logs, stamp, 'window1', 'exthost');
      if (!fs.existsSync(exthost)) { continue; }
      for (const d of fs.readdirSync(exthost).filter((n) => n.startsWith('output_logging_'))) {
        for (const f of fs.readdirSync(path.join(exthost, d)).filter((n) => /^\d+-Aggrega\.log$/.test(n))) {
          candidates.push(path.join(exthost, d, f));
        }
      }
    }
    candidates.sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
    return candidates.length === 0 ? null : candidates[candidates.length - 1];
  }

  text(): string {
    const f = this.file();
    return f === null ? '' : fs.readFileSync(f, 'utf8');
  }

  // mark is where the channel stands now; since(mark) is what was written after.
  mark(): { file: string | null; length: number } {
    const f = this.file();
    return { file: f, length: f === null ? 0 : fs.readFileSync(f, 'utf8').length };
  }

  since(mark: { file: string | null; length: number }): string {
    const f = this.file();
    if (f === null) { return ''; }
    const text = fs.readFileSync(f, 'utf8');
    return f === mark.file ? text.slice(mark.length) : text;
  }

  waitFor(what: string, mark: { file: string | null; length: number }, done: (text: string) => boolean, boundMs: number): Promise<string> {
    return until(what, boundMs, async () => this.since(mark), done, 200);
  }
}

// ---- quick input, dialogs, tree views ----------------------------------------

export interface QuickInputRow { label: string; description: string; aria: string; text: string }
export interface QuickInput { title: string; placeholder: string; value: string; rows: QuickInputRow[] }

const QUICK_INPUT = `(() => {
  const w = [...document.querySelectorAll('.quick-input-widget')].find((e) => e.style.display !== 'none' && e.getBoundingClientRect().height > 0);
  if (!w) { return null; }
  const input = w.querySelector('.quick-input-box input');
  const rows = [...w.querySelectorAll('.monaco-list-row')].filter((r) => r.getBoundingClientRect().height > 0).map((r) => ({
    label: ((r.querySelector('.label-name') || {}).innerText || '').trim(),
    description: ((r.querySelector('.label-description') || {}).innerText || '').trim(),
    aria: r.getAttribute('aria-label') || '',
    text: (r.innerText || '').trim(),
  }));
  return { title: ((w.querySelector('.quick-input-title') || {}).innerText || '').trim(),
    placeholder: input ? input.getAttribute('placeholder') || '' : '', value: input ? input.value : '', rows };
})()`;

export function quickInput(driver: UiDriver): Promise<QuickInput | null> {
  return driver.workbench<QuickInput | null>(QUICK_INPUT);
}

export function waitQuickInput(driver: UiDriver, what: string, done: (q: QuickInput) => boolean, boundMs = 10000): Promise<QuickInput> {
  return until(what, boundMs, () => quickInput(driver), (q) => q !== null && done(q)) as Promise<QuickInput>;
}

// pickQuickInputRow presses the drawn row whose label is `label`.
export async function pickQuickInputRow(driver: UiDriver, label: string): Promise<void> {
  const at = await until(`a quick-input row labelled "${label}"`, 10000, () => driver.workbench<{ x: number; y: number } | null>(`((label) => {
    const w = [...document.querySelectorAll('.quick-input-widget')].find((e) => e.style.display !== 'none' && e.getBoundingClientRect().height > 0);
    if (!w) { return null; }
    for (const r of w.querySelectorAll('.monaco-list-row')) {
      const l = ((r.querySelector('.label-name') || {}).innerText || '').trim();
      const b = r.getBoundingClientRect();
      if (l === label && b.height > 0) { return { x: b.x + Math.min(b.width / 2, 120), y: b.y + b.height / 2 }; }
    }
    return null;
  })(${JSON.stringify(label)})`), (v) => v !== null);
  if (at === null) { throw new Error(`unreachable: ${label}`); }
  await driver.click(at);
}

export interface Dialog { message: string; detail: string; buttons: string[] }

export function dialog(driver: UiDriver): Promise<Dialog | null> {
  return driver.workbench<Dialog | null>(`(() => {
    const d = document.querySelector('.monaco-dialog-box');
    if (!d || d.getBoundingClientRect().height === 0) { return null; }
    return { message: ((d.querySelector('.dialog-message-text') || {}).innerText || '').trim(),
      detail: ((d.querySelector('.dialog-message-detail') || {}).innerText || '').trim(),
      buttons: [...d.querySelectorAll('.dialog-buttons .monaco-button')].map((b) => (b.innerText || '').trim()) };
  })()`);
}

export async function pressDialogButton(driver: UiDriver, label: string): Promise<void> {
  const at = await driver.workbench<{ x: number; y: number } | null>(`((label) => {
    for (const b of document.querySelectorAll('.monaco-dialog-box .dialog-buttons .monaco-button')) {
      if ((b.innerText || '').trim() === label) { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
    }
    return null;
  })(${JSON.stringify(label)})`);
  if (at === null) { throw new Error(`the dialog draws no button "${label}"`); }
  await driver.click(at);
}

// TreeRow is one row of a tree view as drawn.
export interface TreeRow { label: string; description: string; aria: string; level: number; expanded: string | null; decorations: string }

// treeRows reads the drawn rows of the side-bar view titled `title`.
export function treeRows(driver: UiDriver, title: string): Promise<TreeRow[] | null> {
  return driver.workbench<TreeRow[] | null>(`((title) => {
    for (const pane of document.querySelectorAll('.pane')) {
      const h = pane.querySelector('.pane-header');
      const t = h ? ((h.querySelector('h3.title, .title') || {}).innerText || '').trim() : '';
      if (t.toLowerCase() !== title.toLowerCase()) { continue; }
      return [...pane.querySelectorAll('.pane-body .monaco-list-row')].map((r) => ({
        label: ((r.querySelector('.label-name') || {}).innerText || '').trim(),
        description: ((r.querySelector('.label-description') || {}).innerText || '').trim(),
        aria: r.getAttribute('aria-label') || '',
        level: Number(r.getAttribute('aria-level') || 0),
        expanded: r.getAttribute('aria-expanded'),
        decorations: [...r.querySelectorAll('.monaco-icon-label, .label-name')].map((e) => e.className).join(' '),
      }));
    }
    return null;
  })(${JSON.stringify(title)})`);
}

// treeRowBox finds a drawn tree row by its label in the view titled `title`.
export function treeRowCentre(driver: UiDriver, title: string, label: string): Promise<{ x: number; y: number } | null> {
  return driver.workbench<{ x: number; y: number } | null>(`((title, label) => {
    for (const pane of document.querySelectorAll('.pane')) {
      const h = pane.querySelector('.pane-header');
      const t = h ? ((h.querySelector('h3.title, .title') || {}).innerText || '').trim() : '';
      if (t.toLowerCase() !== title.toLowerCase()) { continue; }
      for (const r of pane.querySelectorAll('.pane-body .monaco-list-row')) {
        const l = ((r.querySelector('.label-name') || {}).innerText || '').trim();
        const b = r.getBoundingClientRect();
        if (l === label && b.height > 0) { return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
      }
    }
    return null;
  })(${JSON.stringify(title)}, ${JSON.stringify(label)})`);
}

// pressPanelAction presses one of the operations drawn at the head of the
// side-bar view titled `title`, by the label its row reads, where a person
// presses it. It refuses a row that is not drawn at the head, and one drawn with
// a reason beside its label — the sign such a row gives that it cannot run, as
// the Commands panel greys a button — so a press that could only run nothing is
// reported as what it is rather than waited on.
export async function pressPanelAction(driver: UiDriver, title: string, label: string, boundMs = 20000): Promise<void> {
  const rows = await until(`the "${label}" row at the head of the ${title} view`, boundMs, () => treeRows(driver, title),
    (v) => v !== null && v.some((r) => r.label === label));
  const row = (rows ?? []).find((r) => r.label === label);
  if (!row) { throw new Error(`the ${title} view draws no "${label}" row`); }
  if (row.level !== 1) { throw new Error(`the ${title} view draws "${label}" at level ${row.level}, not at its head`); }
  if (row.description !== '') { throw new Error(`the ${title} view's "${label}" row cannot run: ${row.description}`); }
  const at = await treeRowCentre(driver, title, label);
  if (at === null) { throw new Error(`the ${title} view's "${label}" row is not drawn where it can be pressed`); }
  await driver.click(at);
}

// visibleText is a workbench element's drawn text, for a person to read.
export function workbenchText(driver: UiDriver, selector: string): Promise<string> {
  return driver.workbench<string>(`((s) => { const e = document.querySelector(s); return e ? (e.innerText || '').trim() : ''; })(${JSON.stringify(selector)})`);
}
