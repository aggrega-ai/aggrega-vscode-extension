// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

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
//
// 🔴 A WAIT'S BOUND IS A DEADLOCK GUARD, NOT A JUDGEMENT OF SPEED. A wait returns
// the moment the state it checks holds, so a busy machine makes it longer and
// never decides it. The bound a caller hands `until` or `within` is the order of
// what that state takes a correct editor on an idle machine, and the wait runs to
// `guard` of it — GUARD_FACTOR times that, never more than GUARD_CEILING_MS — so
// a correct editor slowed down by the machine reaches the state far inside the
// cap, and only a state that never comes runs to it. A check whose own
// expectation states a duration ("within 10 s") is handed `stated(ms)` instead,
// and its wait runs to that duration, compared as written.

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const GUARD_FACTOR = 10;
export const GUARD_CEILING_MS = 10 * 60 * 1000;

// guard is the cap a wait given `boundMs` runs to.
export function guard(boundMs: number): number {
  return Math.max(boundMs, Math.min(boundMs * GUARD_FACTOR, GUARD_CEILING_MS));
}

// Stated is a duration a check's own expectation states, handed to a wait in
// place of a bound so that the wait runs to it exactly.
export interface Stated { readonly statedMs: number }

export function stated(ms: number): Stated {
  return { statedMs: ms };
}

// Bound is what a wait is handed: the order of what its state takes on an idle
// machine, guarded; or a duration the check states.
export type Bound = number | Stated;

// capOf is the cap a wait handed `b` runs to.
export function capOf(b: Bound): number {
  return typeof b === 'number' ? guard(b) : b.statedMs;
}

// WaitExpired is a bounded wait that ran out, carrying what it waited for and
// the cap it ran to.
export class WaitExpired extends Error {
  constructor(readonly what: string, readonly boundMs: number, readonly last: string) {
    super(`${what} did not happen within ${boundMs} ms (last reading ${last})`);
  }
}

// RanOut is a wait that ran to its cap: what it waited for, the cap, whether that
// cap was a guard or a duration the check states, and the last thing it read.
export interface RanOut { what: string; capMs: number; guarded: boolean; last: string }

// 🔴 EVERY WAIT THAT RUNS TO ITS CAP IS RECORDED, WHETHER ITS CALLER CATCHES THE
// EXPIRY OR NOT. A caller may read an expiry as an answer, and where that answer
// is the one a correct editor gives, a passing check paid the whole cap for it —
// a guard, ten times the idle order — with nothing else showing it. The report
// lists what each check's waits ran out on.
const RAN_OUT: RanOut[] = [];

function ranOut(what: string, capMs: number, bound: Bound, last: string): void {
  RAN_OUT.push({ what, capMs, guarded: typeof bound === 'number', last: last.slice(0, 300) });
}

// ranOutMark is how many waits have run to their cap so far, and ranOutSince the
// ones that ran out after such a mark.
export function ranOutMark(): number {
  return RAN_OUT.length;
}

export function ranOutSince(mark: number): RanOut[] {
  return RAN_OUT.slice(mark);
}

// until polls `read` until `done` holds of what it returned, for at most
// capOf(bound).
export async function until<T>(what: string, bound: Bound, read: () => Promise<T>, done: (v: T) => boolean, everyMs = 150): Promise<T> {
  const boundMs = capOf(bound);
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
  const reading = `${JSON.stringify(last ?? null).slice(0, 400)}${lastError ? `; last error ${lastError.slice(0, 200)}` : ''}`;
  ranOut(what, boundMs, bound, reading);
  throw new WaitExpired(what, boundMs, reading);
}

// standsStill reads `read` until two readings in a row are the same, and answers
// with that reading: the state of something an action set moving — a drag, a
// scroll, a zoom — once it has come to rest.
export async function standsStill<T>(what: string, bound: Bound, read: () => Promise<T>): Promise<T> {
  let before: string | null = null;
  const last: { v?: T } = {};
  await until(what, bound, async () => {
    const v = await read();
    const key = JSON.stringify(v);
    const same = key === before;
    before = key;
    last.v = v;
    return same;
  }, (same) => same, 100);
  return last.v as T;
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

export function waitStatus(driver: UiDriver, reading: string, bound: Bound): Promise<string> {
  return until(`the status bar reading "${reading}"`, bound, () => statusNow(driver), (v) => v === reading);
}

// ---- notifications -----------------------------------------------------------

// Toast is one notification as it was drawn.
export interface Toast { at: number; message: string; severity: 'error' | 'warning' | 'info'; buttons: string[] }

// NOTIFICATION_MESSAGE_CAP is how many characters of a message the editor draws in
// a notification: a longer one is cut there and followed by "...", and every line
// break in it is drawn as a space. It is the editor's own rule — the editor build
// the suite runs declares the cap beside the line that applies it — and no
// extension can change it, which is why a refusal's notification carries a button
// to the output channel, where the whole message stands.
export const NOTIFICATION_MESSAGE_CAP = 1000;

// asTheEditorDraws is a message as the editor draws it in a notification, for a
// check that holds a notification against the message an extension raised it
// with.
export function asTheEditorDraws(message: string): string {
  const cut = message.length > NOTIFICATION_MESSAGE_CAP ? `${message.slice(0, NOTIFICATION_MESSAGE_CAP)}...` : message;
  return cut.replace(/(\r\n|\n|\r)/g, ' ').trim();
}

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

export function waitToast(driver: UiDriver, what: string, mark: number, match: (t: Toast) => boolean, bound: Bound): Promise<Toast> {
  return until(what, bound, async () => (await toastsSince(driver, mark)).find(match) ?? null, (t) => t !== null) as Promise<Toast>;
}

// TOAST_WINDOW_MS is the window the editor counts notifications in: of those
// added within it, counted from the first, it draws three as toasts and lists the
// rest in the notification centre only.
export const TOAST_WINDOW_MS = 800;

// toastWindowPassed waits until no notification has been drawn for
// TOAST_WINDOW_MS.
//
// 🔴 AN ACTION WHOSE NOTIFICATION A CHECK READS IS MADE ONLY ONCE THE EDITOR'S
// WINDOW HAS PASSED SINCE THE LAST ONE DRAWN. An operation can raise three in a
// moment — a progress notification for what it reads, one for what it does, and
// its ending — and where the one before it is still inside the window, the ending
// is the fourth and the editor lists it without drawing it. A runner that acts
// faster would then read a notification the editor gave as one it did not. The
// stage most checks act from, `closeAllEditors` (suite-context.ts), waits for it.
export function toastWindowPassed(driver: UiDriver): Promise<number> {
  return until(`${TOAST_WINDOW_MS} ms with no notification drawn`, 5000, async () => {
    const ts = await toasts(driver);
    return ts.length === 0 ? TOAST_WINDOW_MS : Date.now() - ts[ts.length - 1].at;
  }, (quietMs) => quietMs >= TOAST_WINDOW_MS, 50);
}

// NotificationReading is one change of whether a notification is drawn.
export interface NotificationReading { at: number; drawn: boolean }

// watchNotification installs, before the action it watches, an observer that
// records every change of whether a notification whose message reads exactly
// `message` is drawn — one that stays up while its work runs, such as a progress
// notification, and goes when the work ends. The first reading is taken as it is
// installed, so a log that opens with it drawn says it was already up. It returns
// the key its readings are kept under.
export async function watchNotification(driver: UiDriver, message: string): Promise<string> {
  const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await driver.workbench(`((message, key) => {
    const logs = window.__editorSuiteNotificationWatch || (window.__editorSuiteNotificationWatch = {});
    const log = [];
    logs[key] = log;
    let last = null;
    const read = () => [...document.querySelectorAll('.notification-list-item')].some((item) => {
      const m = item.querySelector('.notification-list-item-message');
      return ((m && m.innerText) || '').trim() === message && item.getBoundingClientRect().height > 0;
    });
    const sample = () => { const v = read(); if (v !== last) { log.push({ at: Date.now(), drawn: v }); last = v; } };
    sample();
    const observer = new MutationObserver(sample);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });
    log.stop = () => observer.disconnect();
    return log.length;
  })(${JSON.stringify(message)}, ${JSON.stringify(key)})`);
  return key;
}

// notificationReadings returns what the observer installed under `key` has
// recorded so far.
export function notificationReadings(driver: UiDriver, key: string): Promise<NotificationReading[]> {
  return driver.workbench<NotificationReading[]>(`((key) => {
    const log = (window.__editorSuiteNotificationWatch || {})[key];
    return log ? log.map((r) => ({ at: r.at, drawn: r.drawn })) : [];
  })(${JSON.stringify(key)})`);
}

// stopWatchingNotification disconnects the observer installed under `key`.
export async function stopWatchingNotification(driver: UiDriver, key: string): Promise<void> {
  await driver.workbench(`((key) => {
    const log = (window.__editorSuiteNotificationWatch || {})[key];
    if (log && log.stop) { log.stop(); }
    return true;
  })(${JSON.stringify(key)})`);
}

// pressToastButton presses the button labelled `label` on the notification whose
// message starts with `prefix`, once it stands still, and reports false where no
// such button is drawn. A press that never reaches the button is refused by
// `pressConfirmed`, so true always means the press reached it.
export async function pressToastButton(driver: UiDriver, prefix: string, label: string): Promise<boolean> {
  const target = `((prefix, label) => {
    for (const item of document.querySelectorAll('.notification-list-item')) {
      const m = item.querySelector('.notification-list-item-message');
      if (!(((m && m.innerText) || '').trim().startsWith(prefix))) { continue; }
      for (const b of item.querySelectorAll('.monaco-button')) {
        if ((b.innerText || '').trim() !== label) { continue; }
        const r = b.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { return b; }
      }
    }
    return null;
  })(${JSON.stringify(prefix)}, ${JSON.stringify(label)})`;
  const middle = `(() => { const b = ${target}; if (!b) { return null; } const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`;
  if ((await driver.workbench<{ x: number; y: number } | null>(middle)) === null) { return false; }
  await pressConfirmed(driver, { doc: null, target, what: `the "${label}" button of the notification "${prefix}"` }, () => driver.workbench<{ x: number; y: number } | null>(middle));
  return true;
}

// panelText is the text the workbench's panel draws — the area under the editors
// that the output channel is shown in — or null while no panel is drawn.
export function panelText(driver: UiDriver): Promise<string | null> {
  return driver.workbench<string | null>(`(() => {
    const p = document.getElementById('workbench.parts.panel');
    if (!p || p.getBoundingClientRect().height === 0) { return null; }
    return (p.innerText || '').replace(/\\u00a0/g, ' ');
  })()`);
}

// TOASTS_DRAWN counts the notifications drawn over the editor area.
const TOASTS_DRAWN = `[...document.querySelectorAll('.notification-toast-container, .notification-toast')].filter((e) => e.getBoundingClientRect().height > 0).length`;

// toastsGone waits for no notification to be drawn over the editor area — the
// state a press is made from where a notification leaving would slide the others
// under it.
export function toastsGone(driver: UiDriver, bound: Bound = 5000): Promise<number> {
  return until('no notification drawn over the editor area', bound, () => driver.workbench<number>(TOASTS_DRAWN), (n) => n === 0);
}

// openTabs is how many editor tabs the workbench draws.
export function openTabs(driver: UiDriver): Promise<number> {
  return driver.workbench<number>(`[...document.querySelectorAll('.tabs-container .tab')].filter((t) => t.getBoundingClientRect().width > 0).length`);
}

// KEYS_SEEN counts the key presses a document has been dispatched, from the first
// time it is asked; a capture listener on the window sees each before the
// document's own handlers do, and they all run in that one dispatch.
const KEYS_SEEN = `(() => {
  if (!window.__editorSuiteKeys) {
    const k = { downs: 0 };
    window.addEventListener('keydown', () => { k.downs++; }, true);
    window.__editorSuiteKeys = k;
  }
  return window.__editorSuiteKeys.downs;
})()`;

// pressKeyIn presses `key` and waits for that key's own event to reach `doc`, so
// a reading taken next is of what the document did with it, not of the moment
// before it arrived.
export async function pressKeyIn(driver: UiDriver, doc: WebviewDocument, key: string): Promise<void> {
  const before = await evaluateWithin<number>(doc, KEYS_SEEN, 5000);
  await driver.press(key);
  await until(`${key} reaching the document at ${doc.url.slice(0, 60)}`, 3000, () => evaluateWithin<number>(doc, KEYS_SEEN, 5000), (n) => n > before);
}

// ---- a press, confirmed by its own event ---------------------------------------

// 🔴 A PRESS IS MADE ONCE ITS TARGET STANDS STILL, AND IT COUNTS ONLY WHERE ITS
// OWN EVENT REACHED THAT TARGET. A control still sliding in, still being scrolled
// to or drawn again is pressed where it was rather than where it is, and a press
// on a document that has just come forward can focus its frame without reaching
// the document at all. So the target is read until two readings in a row put it at
// the same point with no animation running on it or on anything holding it; an
// observer goes into its document just before the press; and the press counts
// only where that observer saw its pointer-down land on the target. A press that
// landed elsewhere — on something drawn over it, or in no part of that document —
// is made again, as a person presses again, at most PRESS_ATTEMPTS times, and one
// that never lands is refused, naming where each landed. Before a press is made
// again, the observer is read once more, so a press whose event arrived late is
// the press made rather than a reason to make a second.

const PRESS_ATTEMPTS = 3;

// Aim is a press's target: the document it is drawn in (the workbench where
// null), an expression that finds it there as an element, and the words a report
// names it by.
export interface Aim { doc: WebviewDocument | null; target: string; what: string }

// Blocked is a point read for a press that cannot be pressed yet, and why.
export interface Blocked { blocked: string }

// PressSite is a point a target is pressed at, in the window, or why there is
// none to press yet.
export type PressSite = { x: number; y: number } | Blocked | null;

interface Landed { landed: string | null; hit: boolean }

// pressWatch is installed in a document just before one press: it keeps what that
// press's pointer-down landed on there, and whether it is the target `find`
// answers — the element itself or something inside it.
function pressWatch(target: string): string {
  return `((find) => {
    const prior = window.__editorSuitePress;
    if (prior && prior.stop) { prior.stop(); }
    const w = { landed: null, hit: false };
    const describe = (e) => (e ? e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() !== '' ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') : 'nothing');
    const on = (ev) => {
      if (w.landed !== null) { return; }
      const t = find();
      const e = ev.target && ev.target.nodeType === 1 ? ev.target : (ev.target && ev.target.parentElement) || null;
      w.hit = !!t && !!e && (e === t || t.contains(e));
      w.landed = describe(e);
    };
    window.addEventListener('pointerdown', on, true);
    w.stop = () => window.removeEventListener('pointerdown', on, true);
    window.__editorSuitePress = w;
    return true;
  })(() => (${target}))`;
}

const PRESS_LANDED = `(() => { const w = window.__editorSuitePress || {}; return { landed: w.landed === undefined ? null : w.landed, hit: !!w.hit }; })()`;

// stillness reads whether an animation runs on the target or on anything holding
// it, or null where the target is not drawn.
function stillness(target: string): string {
  return `(() => {
    const t = (${target});
    if (!t) { return null; }
    for (let e = t; e; e = e.parentElement) {
      if (typeof e.getAnimations === 'function' && e.getAnimations().some((a) => a.playState === 'running')) { return false; }
    }
    return true;
  })()`;
}

// pressConfirmed presses the target `aim` names at the point `site` reads, once
// that point stands still, and answers with the point pressed.
export async function pressConfirmed(driver: UiDriver, aim: Aim, site: () => Promise<PressSite>): Promise<{ x: number; y: number }> {
  const inDoc = <T>(expression: string): Promise<T> => (aim.doc === null ? driver.workbench<T>(expression) : evaluateWithin<T>(aim.doc, expression, 5000));
  const misses: string[] = [];
  let pressed: { x: number; y: number } | null = null;
  for (let attempt = 1; attempt <= PRESS_ATTEMPTS; attempt++) {
    if (pressed !== null && (await inDoc<Landed>(PRESS_LANDED)).hit) { return pressed; }
    let before: string | null = null;
    const reading = await until(`${aim.what} drawn and standing still where it is pressed`, 10000, async () => {
      const s = await site();
      const still = s === null || 'blocked' in s ? null : await inDoc<boolean | null>(stillness(aim.target));
      const key = s !== null && !('blocked' in s) && still === true ? `${Math.round(s.x * 2)},${Math.round(s.y * 2)}` : null;
      const same = key !== null && key === before;
      before = key;
      return { s, still, same };
    }, (v) => v.same, 100);
    const at = reading.s as { x: number; y: number };
    await inDoc(pressWatch(aim.target));
    if (aim.doc !== null) { await driver.workbench(pressWatch('null')); }
    await driver.click(at);
    pressed = at;
    const w = await inDoc<Landed>(PRESS_LANDED);
    if (w.hit) { return at; }
    if (w.landed !== null) {
      misses.push(w.landed);
    } else {
      const outside = aim.doc === null ? null : await driver.workbench<Landed>(PRESS_LANDED);
      misses.push(outside !== null && outside.landed !== null ? `the workbench's ${outside.landed}` : 'nothing in the document it is drawn in');
    }
  }
  if (pressed !== null && (await inDoc<Landed>(PRESS_LANDED)).hit) { return pressed; }
  throw new Error(`the press on ${aim.what} landed on ${misses.join(', then on ')}, and never on it`);
}

// selectorTarget is the target expression for the first element `selector`
// matches.
export function selectorTarget(selector: string): string {
  return `document.querySelector(${JSON.stringify(selector)})`;
}

// ---- webview panels ----------------------------------------------------------

// within settles as `p` does, or refuses once capOf(bound) has passed without it
// settling, naming `what` did not finish.
export function within<T>(p: Promise<T>, bound: Bound, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const capMs = capOf(bound);
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { ranOut(what, capMs, bound, 'no answer'); reject(new Error(`${what} did not finish within ${capMs} ms`)); }, capMs);
  });
  return Promise.race([p, expired]).finally(() => clearTimeout(timer));
}

// evaluateWithin evaluates `expression` in a webview document, refusing once
// capOf(bound) has passed without an answer. A document that runs no script may
// never answer an evaluation made in it, and an unbounded one would hold the
// whole scenario on it.
export function evaluateWithin<T>(doc: WebviewDocument, expression: string, bound: Bound): Promise<T> {
  return within(doc.evaluate<T>(expression), bound, `an evaluation in the document at ${doc.url.slice(0, 80)}`);
}

// DOCUMENT_ANSWER_MS is how long each webview document is given to answer an
// evaluation made in every document drawn.
//
// 🔴 IT IS A STATED WINDOW, NOT A GUARD, BECAUSE A DOCUMENT THAT RUNS NO SCRIPT
// NEVER ANSWERS. Such a document is part of what the editor draws, so a guard on
// it would be paid in full on every look a correct editor answers; a document
// silent for the window counts as answering nothing for that look, and a wait
// built on the look reads again.
export const DOCUMENT_ANSWER_MS = 2000;

// answersIn evaluates `expression` in every webview document drawn now and lists
// each document with its answer, leaving out a document being replaced and one
// that gave no answer within DOCUMENT_ANSWER_MS.
export async function answersIn<T>(driver: UiDriver, expression: string): Promise<{ doc: WebviewDocument; value: T }[]> {
  const out: { doc: WebviewDocument; value: T }[] = [];
  for (const doc of await driver.webviews()) {
    try { out.push({ doc, value: await evaluateWithin<T>(doc, expression, stated(DOCUMENT_ANSWER_MS)) }); } catch { /* a document being replaced, or one that does not answer */ }
  }
  return out;
}

// documentsAnswering lists the webview documents drawn now for which `probe`
// evaluates true.
async function documentsAnswering(driver: UiDriver, probe: string): Promise<WebviewDocument[]> {
  return (await answersIn<boolean>(driver, probe)).filter((a) => a.value).map((a) => a.doc);
}

// documentNow is the one webview document for which `probe` evaluates true as the
// editor stands, or null where there is none, or more than one; it waits for
// nothing to be drawn, so it is the reading behind "is one open".
export async function documentNow(driver: UiDriver, probe: string): Promise<WebviewDocument | null> {
  const hits = await documentsAnswering(driver, probe);
  return hits.length === 1 ? hits[0] : null;
}

// documentWith finds the one webview document for which `probe` evaluates true,
// waiting for it to be drawn.
export async function documentWith(driver: UiDriver, what: string, probe: string, bound: Bound): Promise<WebviewDocument> {
  let found: WebviewDocument | null = null;
  await until(what, bound, async () => {
    const hits = await documentsAnswering(driver, probe);
    found = hits.length === 1 ? hits[0] : null;
    return hits.length;
  }, (n) => n === 1);
  if (found === null) { throw new Error(`unreachable: ${what}`); }
  return found;
}

// COMMANDS_PANEL is what identifies the Commands panel's document: its buttons.
export const COMMANDS_PANEL = `document.querySelectorAll('button.op[data-command]').length > 0`;

export function commandsPanel(driver: UiDriver, bound: Bound = 30000): Promise<WebviewDocument> {
  return documentWith(driver, 'the Commands panel drawing its buttons', COMMANDS_PANEL, bound);
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
// null) where a person would, through `pressConfirmed`, and refuses where it is
// not drawn. An element a panel has scrolled out of sight is scrolled into it
// first, as a person scrolls to a button before pressing it: a press at the
// coordinates of a hidden element lands on whatever is drawn there instead.
export async function pressIn(driver: UiDriver, doc: WebviewDocument | null, selector: string): Promise<Box> {
  if (doc !== null) {
    await doc.evaluate(`((s) => { const e = document.querySelector(s); if (e) { e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } return !!e; })(${JSON.stringify(selector)})`);
  }
  const read: { box: Box | null } = { box: null };
  await pressConfirmed(driver, { doc, target: selectorTarget(selector), what: selector }, async () => {
    const b = await driver.box(doc, selector);
    read.box = b;
    return b !== null && b.width > 0 && b.height > 0 ? centre(b) : null;
  });
  if (read.box === null) { throw new Error(`unreachable: ${selector}`); }
  return read.box;
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

  waitFor(what: string, mark: { file: string | null; length: number }, done: (text: string) => boolean, bound: Bound): Promise<string> {
    return until(what, bound, async () => this.since(mark), done, 200);
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

export function waitQuickInput(driver: UiDriver, what: string, done: (q: QuickInput) => boolean, bound: Bound = 10000): Promise<QuickInput> {
  return until(what, bound, () => quickInput(driver), (q) => q !== null && done(q)) as Promise<QuickInput>;
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

// TreeRow is one row of a tree view.
export interface TreeRow { label: string; description: string; aria: string; level: number; expanded: string | null; decorations: string }

// TREE_PANE and TREE_ROW are the one reading of a side-bar view and of one of its
// rows, in the workbench's own document: the pane whose header reads `title`, and
// what a row reads as. Both of the readings below are made of them, so the list
// read whole and the rows drawn now are read alike.
const TREE_PANE = `(title) => [...document.querySelectorAll('.pane')].find((pane) => {
  const h = pane.querySelector('.pane-header');
  const t = h ? ((h.querySelector('h3.title, .title') || {}).innerText || '').trim() : '';
  return t.toLowerCase() === title.toLowerCase();
}) || null`;
const TREE_ROW = `(r) => ({
  label: ((r.querySelector('.label-name') || {}).innerText || '').trim(),
  description: ((r.querySelector('.label-description') || {}).innerText || '').trim(),
  aria: r.getAttribute('aria-label') || '',
  level: Number(r.getAttribute('aria-level') || 0),
  expanded: r.getAttribute('aria-expanded'),
  decorations: [...r.querySelectorAll('.monaco-icon-label, .label-name')].map((e) => e.className).join(' '),
})`;

// treeRows reads every row the list in the side-bar view titled `title` holds,
// in its order, wherever the view stands scrolled — the rows a person finds by
// scrolling the list as well as the ones in sight — or null where no such view is
// drawn.
//
// A tree draws only the rows in sight, so a row below the view's edge is not in
// the document at all, and a reading of the rows drawn would wait in vain for a
// row the list holds, or read a row that has merely scrolled away as gone. So a
// list longer than its view is walked: turned to its start, then down by a view
// less one row at a time, each row taken by its place in the list, and turned
// back to where it stood. The walk is driven by wheel events sent to the list
// itself, so the pointer stays where it is, and it runs inside one evaluation of
// the window's script, so no frame is drawn while it moves and nothing watching
// the view sees it move. A list that does not move when turned is reported as an
// error rather than read as the rows in sight.
//
// The rows the view draws now, and only those, are `drawnTreeRows`.
export function treeRows(driver: UiDriver, title: string): Promise<TreeRow[] | null> {
  return driver.workbench<TreeRow[] | null>(`((title) => {
    const paneOf = ${TREE_PANE};
    const rowOf = ${TREE_ROW};
    const pane = paneOf(title);
    if (!pane) { return null; }
    // The list's own rows and the element that scrolls them — never the copies of
    // a parent the view pins at its top while the rows beneath it scroll, which
    // stand in a container of their own.
    const rows = pane.querySelector('.pane-body .monaco-list > .monaco-scrollable-element > .monaco-list-rows');
    const view = rows ? rows.parentElement : null;
    const drawn = () => rows ? [...rows.children].filter((r) => r.classList.contains('monaco-list-row')) : [];
    if (!rows || !view) { return [...pane.querySelectorAll('.pane-body .monaco-list-row')].map(rowOf); }
    // Each row by its place in the list; the list is whole once every place from
    // its first row to the one marked as its last has been read.
    const seen = new Map();
    let last = -1;
    const take = () => {
      for (const r of drawn()) {
        const i = Number(r.getAttribute('data-index'));
        if (!Number.isInteger(i) || i < 0) { continue; }
        if (!seen.has(i)) { seen.set(i, rowOf(r)); }
        if (r.getAttribute('data-last-element') === 'true') { last = i; }
      }
    };
    const whole = () => last >= 0 && seen.size === last + 1 && [...seen.keys()].every((i) => i <= last);
    const ordered = () => [...seen.keys()].sort((a, b) => a - b).map((i) => seen.get(i));
    take();
    if (seen.size === 0 || whole()) { return ordered(); }
    const at = () => view.getBoundingClientRect().top - rows.getBoundingClientRect().top;
    // The list reads a wheel event's legacy delta where it carries one, and an
    // event made in the page carries one of the same sign as its standard delta —
    // the opposite of what a turn of the wheel gives — so it is stated here as a
    // turn of the wheel states it, or the list would turn the other way.
    const turn = (dy) => {
      const e = new WheelEvent('wheel', { deltaY: dy, deltaMode: 0, bubbles: true, cancelable: true });
      Object.defineProperty(e, 'wheelDeltaY', { value: -dy });
      Object.defineProperty(e, 'wheelDeltaX', { value: 0 });
      view.dispatchEvent(e);
    };
    // How far one unit of the wheel turns the list is learnt from each turn that
    // moved it rather than assumed; the first turn down is half a step, so a first
    // guess as much as twice too large still leaves no row unread between two
    // readings.
    let perUnit = 1 / 2.4;
    const by = (px) => {
      const before = at();
      const units = px / perUnit;
      turn(units);
      const moved = at() - before;
      if (Math.abs(moved) > 0.5) { perUnit = moved / units; }
      return moved;
    };
    const start = at();
    const step = Math.max(1, view.clientHeight - Math.max(0, ...drawn().map((r) => r.getBoundingClientRect().height)));
    turn(-1000000);
    take();
    for (let n = 0; n < 1000 && !whole(); n++) {
      if (by(n === 0 ? step / 2 : step) <= 0.5) { break; }
      take();
    }
    const read = whole();
    // Back to where it stood: to its start, then down by the distance it stood at.
    turn(-1000000);
    for (let n = 0; n < 20 && Math.abs(at() - start) > 0.5; n++) {
      if (Math.abs(by(start - at())) <= 0.5) { break; }
    }
    if (!read) { throw new Error('the ' + title + ' view did not turn through its whole list when scrolled, so the rows beyond its view could not be read; read ' + JSON.stringify(ordered().map((r) => r.label).slice(0, 12))); }
    return ordered();
  })(${JSON.stringify(title)})`);
}

// drawnTreeRows reads the rows the side-bar view titled `title` draws now — the
// part of its list in sight, with any parent the view pins at its top — or null
// where no such view is drawn. It is the reading for a check about what the view
// shows; what the list holds is `treeRows`.
export function drawnTreeRows(driver: UiDriver, title: string): Promise<TreeRow[] | null> {
  return driver.workbench<TreeRow[] | null>(`((title) => {
    const pane = (${TREE_PANE})(title);
    return pane ? [...pane.querySelectorAll('.pane-body .monaco-list-row')].map(${TREE_ROW}) : null;
  })(${JSON.stringify(title)})`);
}

// treeRowCentre finds a drawn tree row by its label in the view titled `title`.
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

// revealTreeRow scrolls the side-bar view titled `title` with the pointer's wheel
// until its row labelled `label` is drawn whole in the part of the view a press
// reaches, as a person scrolls a list longer than its view, and returns where the
// row's middle is. A tree draws only the rows in sight, so a row further down is
// not in the document at all until then; a row the view's edge cuts through has
// the edge's sash drawn over its middle, where a press or a hover lands on the
// sash instead; and the tree pins a copy of the parent of the rows scrolled
// beneath its top over those rows, with a shadow under it, so the row standing
// just under the top — the first under a heading that has scrolled past — is
// covered, and a press or a hover aimed at it lands on the pinned copy or its
// shadow instead. So the part a press reaches begins below whatever the view pins
// at its top, and the row is the list's own, never a pinned copy.
//
// 🔴 THE LIST IS TURNED UP UNTIL IT READS AT ITS START, NOT ONCE. A single turn of
// the wheel, however far, may move the list by one step only, which would bring a
// row from above in at the top — under the pinned parent — instead of from below.
// From the start the list is turned down in short steps, so a row is met at the
// bottom edge and stops inside; a row found under the pinned parent, or cut by the
// top edge, is turned back down from under it a step at a time.
export async function revealTreeRow(driver: UiDriver, title: string, label: string, boundMs = 15000): Promise<{ x: number; y: number }> {
  type Place = { body: { x: number; y: number }; atStart: boolean; row: { x: number; y: number } | null; place: 'inside' | 'above' | 'below' | 'not drawn'; reached?: { top: number; bottom: number }; rowSpan?: { top: number; bottom: number } };
  const place = (): Promise<Place | null> => driver.workbench(`((title, label) => {
    for (const pane of document.querySelectorAll('.pane')) {
      const h = pane.querySelector('.pane-header');
      const t = h ? ((h.querySelector('h3.title, .title') || {}).innerText || '').trim() : '';
      if (t.toLowerCase() !== title.toLowerCase()) { continue; }
      const b = pane.querySelector('.pane-body');
      const r = b ? b.getBoundingClientRect() : null;
      if (!r || r.height === 0) { return null; }
      const body = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      // The list's own rows and the element that scrolls them; the pinned copies
      // stand in a container of their own beside them.
      const list = pane.querySelector('.pane-body .monaco-list > .monaco-scrollable-element > .monaco-list-rows');
      const view = list ? list.parentElement : null;
      const atStart = !list || !view || list.getBoundingClientRect().top >= view.getBoundingClientRect().top - 0.5;
      let top = r.top;
      for (const pinned of pane.querySelectorAll('.monaco-tree-sticky-container, .monaco-tree-sticky-container-shadow')) {
        const s = pinned.getBoundingClientRect();
        if (s.width > 0 && s.height > 0) { top = Math.max(top, s.bottom); }
      }
      const reached = { top: Math.round(top), bottom: Math.round(r.bottom) };
      const rows = list ? [...list.children].filter((x) => x.classList.contains('monaco-list-row')) : [...pane.querySelectorAll('.pane-body .monaco-list-row')];
      for (const row of rows) {
        if (((row.querySelector('.label-name') || {}).innerText || '').trim() !== label) { continue; }
        const x = row.getBoundingClientRect();
        if (x.height === 0) { continue; }
        const where = x.top < top - 0.5 ? 'above' : x.bottom > r.bottom + 0.5 ? 'below' : 'inside';
        return { body, atStart, row: { x: x.x + x.width / 2, y: x.y + x.height / 2 }, place: where, reached, rowSpan: { top: Math.round(x.top), bottom: Math.round(x.bottom) } };
      }
      return { body, atStart, row: null, place: 'not drawn', reached };
    }
    return null;
  })(${JSON.stringify(title)}, ${JSON.stringify(label)})`);
  const pressable = (p: Place | null): boolean => p !== null && p.row !== null && p.place === 'inside';
  const first = await until(`the ${title} view's body`, 10000, place, (v) => v !== null);
  if (first === null) { throw new Error(`unreachable: the ${title} view's body`); }
  if (pressable(first) && first.row !== null) { return first.row; }
  let fromStart = false;
  const at = await until(`the "${label}" row being drawn whole in the ${title} view, below what it pins at its top`, boundMs, async () => {
    const p = await place();
    if (p === null || pressable(p)) { return p; }
    await driver.moveTo(first.body);
    if (p.row !== null) {
      await driver.wheel(0, p.place === 'above' ? -44 : 44);
    } else if (!fromStart && !p.atStart) {
      await driver.wheel(0, -100000);
    } else {
      fromStart = true;
      await driver.wheel(0, 44);
    }
    return p;
  }, pressable);
  if (at === null || at.row === null) { throw new Error(`unreachable: the "${label}" row`); }
  return at.row;
}

// RowMenu is what a right-click on one tree row read.
//
// reached says the right-click's own event landed on that row. It is what lets an
// empty menu be read as the row offering nothing: the editor draws a row's context
// menu while it handles that event, and draws none for a row with nothing to
// offer, so once the event has reached the row, a menu not drawn is a menu the row
// does not have. A right-click that landed on anything else says nothing about the
// row, however its menu reads, and misses names what each such right-click landed
// on instead.
//
// items are the menu's entries by their accessible names, read as the menu is
// drawn, so a menu that closes again at once is still read; empty where the event
// reached the row and no menu was drawn, or where it never reached it.
export interface RowMenu { reached: boolean; items: string[]; misses: string[] }

// rowMenuWatch is installed in the workbench just before one right-click. It
// keeps what that click's context-menu event landed on, and the entries of the
// first context menu drawn after it.
function rowMenuWatch(title: string): string {
  return `((title) => {
    const prior = window.__editorSuiteRowMenu;
    if (prior && prior.stop) { prior.stop(); }
    const w = { row: null, landed: null, items: null };
    const paneTitle = (e) => {
      const pane = e.closest('.pane');
      const h = pane ? pane.querySelector('.pane-header') : null;
      return h ? ((h.querySelector('h3.title, .title') || {}).innerText || '').trim().toLowerCase() : '';
    };
    const onMenu = (e) => {
      document.removeEventListener('contextmenu', onMenu, true);
      const t = e.target && e.target.closest ? e.target : null;
      const row = t ? t.closest('.monaco-list-row') : null;
      if (row && paneTitle(row) === title.toLowerCase()) {
        w.row = ((row.querySelector('.label-name') || {}).innerText || '').trim();
        w.landed = 'the "' + w.row + '" row';
      } else if (t && t.closest('.workbench-hover, .monaco-hover, .workbench-hover-container')) {
        w.landed = 'a hover drawn over the row';
      } else if (row) {
        w.landed = 'a row of another view';
      } else {
        w.landed = t ? 'something that is not a row (' + t.tagName.toLowerCase() + ')' : 'nothing';
      }
      read();
    };
    const read = () => {
      if (w.landed === null || w.items !== null || !document.querySelector('.context-view .monaco-menu')) { return; }
      w.items = [...document.querySelectorAll('.context-view .action-label[aria-label]')].map((e) => e.getAttribute('aria-label'));
    };
    const observer = new MutationObserver(read);
    observer.observe(document.body, { subtree: true, childList: true });
    document.addEventListener('contextmenu', onMenu, true);
    w.stop = () => { observer.disconnect(); document.removeEventListener('contextmenu', onMenu, true); };
    window.__editorSuiteRowMenu = w;
    return true;
  })(${JSON.stringify(title)})`;
}

interface RowMenuWatch { row: string | null; landed: string | null; items: string[] | null }

function rowMenuWatched(driver: UiDriver): Promise<RowMenuWatch> {
  return driver.workbench<RowMenuWatch>(`(() => { const w = window.__editorSuiteRowMenu || {}; return { row: w.row ?? null, landed: w.landed ?? null, items: w.items ?? null }; })()`);
}

// rowMenu opens the context menu of the row labelled `label` in the side-bar view
// titled `title`, as a person does with a right-click on it, and reports what it
// read; it leaves an opened menu open.
//
// 🔴 A RIGHT-CLICK THAT DID NOT REACH THE ROW IS TRIED AGAIN, AND NEVER READ AS
// THE ROW OFFERING NOTHING. Revealing the row rests the pointer on the list, and a
// row under a resting pointer opens its tooltip once the hover delay has passed,
// drawn over the rows around it; a right-click aimed at a row the hover covers
// lands on the hover, which opens no menu. So before each right-click the pointer
// is taken off the list and any hover left drawn is waited out, and a click whose
// event landed elsewhere is taken again, up to `attempts` times.
export async function rowMenu(driver: UiDriver, title: string, label: string, attempts = 3): Promise<RowMenu> {
  const misses: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await revealTreeRow(driver, title, label);
    await clearHover(driver);
    const at = await treeRowCentre(driver, title, label);
    if (at === null) { misses.push('nothing: the row is not drawn'); continue; }
    await driver.workbench(rowMenuWatch(title));
    await driver.click(at, 'right');
    const landed = await until('the right-click landing', 3000, () => rowMenuWatched(driver), (w) => w.landed !== null).catch(() => rowMenuWatched(driver));
    if (landed.landed === null) { misses.push('nothing: no element received it'); continue; }
    if (landed.row !== label) {
      misses.push(landed.landed);
      if (landed.items !== null) { await driver.press('Escape'); }
      continue;
    }
    const drawn = await until('the row\'s context menu', 3000, () => rowMenuWatched(driver), (w) => w.items !== null).catch(() => rowMenuWatched(driver));
    return { reached: true, items: drawn.items ?? [], misses };
  }
  return { reached: false, items: [], misses };
}

// describeRowMenu words what rowMenu read, for a check's report: the items where
// the right-click reached the row, followed by what any earlier right-click landed
// on; and what each landed on where none reached it.
export function describeRowMenu(m: RowMenu): string {
  const missed = m.misses.length === 0 ? '' : `${m.reached ? ', ' : ''}the right-click landing on ${m.misses.join(', then ')}${m.reached ? ' before it reached the row' : ', and never on the row'}`;
  return m.reached ? `the menu ${JSON.stringify(m.items)}${missed}` : missed;
}

// pressMenuItem presses the item named `label` on the open context menu, and
// reports how it was taken: by the pointer, or by Enter where the pointer's press
// left the menu open. It reports null where the menu draws no such item.
//
// The editor's context menu can let a click that lands as it finishes opening go
// by, and then nothing runs at all. So the pointer rests on the item first, and a
// menu still open after the click is taken by Enter, as a reader takes it from the
// keyboard; what a check judges is what the operation does, not whether one click
// landed.
export async function pressMenuItem(driver: UiDriver, label: string): Promise<'pointer' | 'Enter' | null> {
  const itemBox = await driver.box(null, `.context-view .action-label[aria-label="${label}"]`);
  if (itemBox === null) { return null; }
  await driver.moveTo(centre(itemBox));
  await sleep(300);
  await driver.click(centre(itemBox));
  const menuGone = (): Promise<boolean> => driver.workbench<boolean>(`!document.querySelector('.context-view .monaco-menu')`);
  const tookByPointer = await until('the context menu closing on the press', 3000, menuGone, (v) => v).then(() => true, () => false);
  if (!tookByPointer) { await driver.press('Enter'); }
  return tookByPointer ? 'pointer' : 'Enter';
}

// pressTreeRowAction presses the action labelled `action` that the row labelled
// `label` draws at its end, where a person presses it: the pointer rests on the
// row first, which is what draws a row's own actions, and the press lands on the
// action's icon. It refuses a row that draws no such action.
export async function pressTreeRowAction(driver: UiDriver, title: string, label: string, action: string): Promise<void> {
  const row = await revealTreeRow(driver, title, label);
  await driver.moveTo(row);
  // What the row draws at its end, read with each look: the action's box where
  // it is drawn with a size, and the labels of every action the row draws, so a
  // row drawing others than the one asked for says which.
  const look = (): Promise<{ at: { x: number; y: number } | null; drawn: string[]; hovered: boolean; row: { x: number; y: number } | null; under: string; hoveredNow: string[] }> => driver.workbench(`((title, label, action) => {
    for (const pane of document.querySelectorAll('.pane')) {
      const h = pane.querySelector('.pane-header');
      const t = h ? ((h.querySelector('h3.title, .title') || {}).innerText || '').trim() : '';
      if (t.toLowerCase() !== title.toLowerCase()) { continue; }
      for (const r of pane.querySelectorAll('.pane-body .monaco-list-row')) {
        if (((r.querySelector('.label-name') || {}).innerText || '').trim() !== label) { continue; }
        const drawn = [...r.querySelectorAll('.action-label')].map((a) => (a.getAttribute('aria-label') || a.title || '') + ' ' + Math.round(a.getBoundingClientRect().width) + 'px');
        const a = [...r.querySelectorAll('.action-label')].find((x) => (x.getAttribute('aria-label') || x.title || '') === action);
        const b = a ? a.getBoundingClientRect() : null;
        const rb = r.getBoundingClientRect();
        const under = document.elementFromPoint(rb.x + rb.width / 2, rb.y + rb.height / 2);
        const chain = [];
        for (let e = under; e && chain.length < 4; e = e.parentElement) { chain.push(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '')); }
        const hoveredNow = [...document.querySelectorAll(':hover')].map((e) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/)[0] : '')).slice(-3);
        return { at: b && b.width > 0 && b.height > 0 ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null, drawn, hovered: r.matches(':hover'), row: { x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 }, under: chain.join(' < '), hoveredNow };
      }
    }
    return { at: null, drawn: [], hovered: false, row: null, under: '', hoveredNow: [] };
  })(${JSON.stringify(title)}, ${JSON.stringify(label)}, ${JSON.stringify(action)})`);
  // The row draws its actions while the pointer rests on it, so where it does
  // not read as hovered the pointer is moved onto it again, a pixel along, as a
  // person's hand settles.
  let nudge = 0;
  const seen = await until(`the "${action}" action drawn on the "${label}" row`, 5000, async () => {
    const v = await look();
    if (v.at === null && v.row !== null) { nudge = 1 - nudge; await driver.moveTo({ x: v.row.x + nudge, y: v.row.y }); }
    return v;
  }, (v) => v.at !== null).catch(look);
  if (seen.at === null) { throw new Error(`the "${label}" row in the ${title} view draws no "${action}" action to press; it draws ${JSON.stringify(seen.drawn)}, and reads as ${seen.hovered ? '' : 'not '}hovered; under its centre ${seen.under}; hovered now ${JSON.stringify(seen.hoveredNow)}`); }
  await driver.click(seen.at);
}

// scrollTreeToTop turns the pointer's wheel over the side-bar view titled
// `title` far enough to bring its list back to its start, as a person scrolls
// back up; whether it got there is for the caller to read, off the rows drawn.
export async function scrollTreeToTop(driver: UiDriver, title: string): Promise<void> {
  const body = await driver.workbench<{ x: number; y: number } | null>(`((title) => {
    for (const pane of document.querySelectorAll('.pane')) {
      const h = pane.querySelector('.pane-header');
      const t = h ? ((h.querySelector('h3.title, .title') || {}).innerText || '').trim() : '';
      if (t.toLowerCase() !== title.toLowerCase()) { continue; }
      const b = pane.querySelector('.pane-body');
      const r = b ? b.getBoundingClientRect() : null;
      return r && r.height > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    }
    return null;
  })(${JSON.stringify(title)})`);
  if (body === null) { return; }
  await driver.moveTo(body);
  await driver.wheel(0, -100000);
}

// pressPanelAction presses one of the operations drawn at the head of the
// side-bar view titled `title`, by the label its row reads, where a person
// presses it. It refuses a row that is not drawn at the head, and one drawn with
// a reason beside its label — the sign such a row gives that it cannot run, as
// the Commands panel greys a button — so a press that could only run nothing is
// reported as what it is rather than waited on.
//
// A head row scrolls away with the list beneath it in a view too short to show
// both, so the row is read wherever the list stands and then brought into sight
// before the press, as a person scrolls up to it before pressing it.
export async function pressPanelAction(driver: UiDriver, title: string, label: string, boundMs = 20000): Promise<void> {
  const rows = await until(`the "${label}" row at the head of the ${title} view`, boundMs, () => treeRows(driver, title),
    (v) => v !== null && v.some((r) => r.label === label));
  const row = (rows ?? []).find((r) => r.label === label);
  if (!row) { throw new Error(`the ${title} view draws no "${label}" row`); }
  if (row.level !== 1) { throw new Error(`the ${title} view draws "${label}" at level ${row.level}, not at its head`); }
  if (row.description !== '') { throw new Error(`the ${title} view's "${label}" row cannot run: ${row.description}`); }
  await revealTreeRow(driver, title, label);
  if ((await treeRowCentre(driver, title, label)) === null) { throw new Error(`the ${title} view's "${label}" row is not drawn where it can be pressed`); }
  const target = treeRowTarget(title, label);
  await pressConfirmed(driver, { doc: null, target, what: `the "${label}" row of the ${title} view` }, () => driver.workbench<PressSite>(uncoveredMiddle(target)));
}

// treeRowTarget is the target expression for the drawn row labelled `label` in
// the side-bar view titled `title`.
function treeRowTarget(title: string, label: string): string {
  return `((title, label) => {
    for (const pane of document.querySelectorAll('.pane')) {
      const h = pane.querySelector('.pane-header');
      const t = h ? ((h.querySelector('h3.title, .title') || {}).innerText || '').trim() : '';
      if (t.toLowerCase() !== title.toLowerCase()) { continue; }
      for (const r of pane.querySelectorAll('.pane-body .monaco-list-row')) {
        if (((r.querySelector('.label-name') || {}).innerText || '').trim() === label && r.getBoundingClientRect().height > 0) { return r; }
      }
    }
    return null;
  })(${JSON.stringify(title)}, ${JSON.stringify(label)})`;
}

// uncoveredMiddle reads where a workbench target is pressed — its middle, or the
// point `dx` in from its left edge — or why it cannot be pressed there yet: not
// drawn, or with something else drawn over that point, as a view sliding into
// place is drawn over the rows of the one above it.
function uncoveredMiddle(target: string, dx?: number): string {
  return `(() => {
    const t = (${target});
    if (!t) { return null; }
    const r = t.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) { return null; }
    const x = ${dx === undefined ? 'r.x + r.width / 2' : `r.x + ${dx}`}, y = r.y + r.height / 2;
    const top = document.elementFromPoint(x, y);
    if (top && top !== t && !t.contains(top)) { return { blocked: 'covered by ' + top.tagName.toLowerCase() + (typeof top.className === 'string' && top.className ? '.' + top.className.trim().split(/\\s+/)[0] : '') }; }
    return { x, y };
  })()`;
}

// PaneState is one side-bar view as drawn: whether it was found, whether its
// header reads expanded, and the labels of the rows drawn with a height, in
// order. A row the editor keeps in the document while the view is folded has no
// height, so it is not among them — which is what makes this the reading of
// what a person can see rather than of what the document holds.
export interface PaneState { found: boolean; expanded: string | null; rows: string[] }

export function paneState(driver: UiDriver, title: string): Promise<PaneState> {
  return driver.workbench<PaneState>(`((title) => {
    for (const pane of document.querySelectorAll('.pane')) {
      const h = pane.querySelector('.pane-header');
      const t = h ? ((h.querySelector('h3.title, .title') || {}).innerText || '').trim() : '';
      if (t.toLowerCase() !== title.toLowerCase()) { continue; }
      const rows = [...pane.querySelectorAll('.pane-body .monaco-list-row')]
        .filter((r) => r.getBoundingClientRect().height > 0)
        .map((r) => ((r.querySelector('.label-name') || {}).innerText || '').trim());
      return { found: true, expanded: h.getAttribute('aria-expanded'), rows };
    }
    return { found: false, expanded: null, rows: [] };
  })(${JSON.stringify(title)})`);
}

// pressPaneHeader presses the header of the side-bar view titled `title` where a
// person presses it to fold or unfold the view: on its title, clear of the
// actions the header draws at its right, through `pressConfirmed`.
export async function pressPaneHeader(driver: UiDriver, title: string): Promise<void> {
  const target = `((t) => {
    for (const h of document.querySelectorAll('#workbench\\\\.parts\\\\.sidebar .pane-header')) {
      if (((h.querySelector('h3.title') || {}).innerText || '').trim().toLowerCase() === t.toLowerCase()) { return h; }
    }
    return null;
  })(${JSON.stringify(title)})`;
  await pressConfirmed(driver, { doc: null, target, what: `the "${title}" view's header` }, () => driver.workbench<PressSite>(uncoveredMiddle(target, 40)));
}

// ---- the list panels as they are drawn over time -----------------------------

// LIST_PANELS are the side-bar panels that list what the compiler answers.
export const LIST_PANELS = ['Catalog', 'Registries', 'Plugins'] as const;
export type ListPanel = (typeof LIST_PANELS)[number];

// VIEWS_OBSERVER records every change of the rows the list panels draw, as a
// person sees them — the rows drawn with a height, by the words each reads — from
// the moment it is installed. It is installed with the workbench's other
// observers, before the extension has drawn anything, so a row a panel draws for
// a moment while the editor comes up is caught as it is drawn. A panel not drawn
// at a reading is absent from it.
export const VIEWS_OBSERVER = `(() => {
  if (window.__editorSuiteViews) { return window.__editorSuiteViews.length; }
  const titles = ${JSON.stringify(LIST_PANELS)};
  const log = [];
  let last = null;
  const read = () => {
    const out = {};
    for (const pane of document.querySelectorAll('.pane')) {
      const h = pane.querySelector('.pane-header');
      const t = h ? ((h.querySelector('h3.title, .title') || {}).innerText || '').trim() : '';
      const title = titles.find((x) => x.toLowerCase() === t.toLowerCase());
      if (!title) { continue; }
      out[title] = [...pane.querySelectorAll('.pane-body .monaco-list-row')]
        .filter((r) => r.getBoundingClientRect().height > 0)
        .map((r) => ((r.querySelector('.label-name') || {}).innerText || '').trim());
    }
    return out;
  };
  let queued = false;
  const sample = () => {
    queued = false;
    const v = read();
    const key = JSON.stringify(v);
    if (key !== last) { last = key; log.push({ at: Date.now(), panes: v }); }
  };
  sample();
  new MutationObserver(() => { if (!queued) { queued = true; setTimeout(sample, 0); } })
    .observe(document.body, { subtree: true, childList: true, characterData: true });
  window.__editorSuiteViews = log;
  return log.length;
})()`;

// ViewsReading is one change the views observer recorded.
export interface ViewsReading { at: number; panes: Partial<Record<ListPanel, string[]>> }

export function viewReadings(driver: UiDriver): Promise<ViewsReading[]> {
  return driver.workbench<ViewsReading[]>('window.__editorSuiteViews || []');
}

// ---- the status bar's items, one by one --------------------------------------

// StatusItem is one item drawn on the status bar: its words, the glyphs beside
// them, and how its background is drawn.
export interface StatusItem { side: 'left' | 'right'; text: string; icons: string[]; errorKind: boolean; background: string; centre: { x: number; y: number } }

// statusItems reads every item the status bar draws, in the order it draws them,
// left side first.
export function statusItems(driver: UiDriver): Promise<StatusItem[]> {
  return driver.workbench<StatusItem[]>(`(() => {
    const bar = document.getElementById('workbench.parts.statusbar');
    if (!bar) { return []; }
    const read = (side) => [...bar.querySelectorAll('.' + side + '-items .statusbar-item')]
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return {
          side,
          text: (e.innerText || '').trim(),
          icons: [...e.querySelectorAll('.codicon')].map((i) => i.className),
          errorKind: e.classList.contains('error-kind'),
          background: getComputedStyle(e).backgroundColor,
          centre: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
        };
      });
    return [...read('left'), ...read('right')];
  })()`);
}

// hoverText is the words of every hover the workbench draws now, or an empty
// string where none is drawn.
function hoverText(driver: UiDriver): Promise<string> {
  return driver.workbench<string>(`(() => {
    const hovers = [...document.querySelectorAll('.workbench-hover, .monaco-hover')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !e.classList.contains('hidden') && getComputedStyle(e).visibility !== 'hidden';
    });
    return hovers.map((e) => (e.innerText || '').trim()).filter((t) => t !== '').join('\\n');
  })()`);
}

// clearHover moves the pointer off everything and waits out a hover still drawn
// from an earlier rest, so what is read or pressed next is not the hover. Escape
// closes a hover the pointer has entered, which stays drawn otherwise.
async function clearHover(driver: UiDriver): Promise<void> {
  await driver.moveTo({ x: 1, y: 1 });
  await driver.press('Escape');
  await until('no hover left drawn', 3000, () => hoverText(driver), (t) => t === '').catch(() => undefined);
}

// hoverAt rests the pointer on a point and returns the words of the hover the
// workbench draws there, or an empty string where none is drawn within the bound.
//
// The hover left standing from an earlier rest is cleared first, so the words
// read are the hover of this point and not the last one's.
export async function hoverAt(driver: UiDriver, at: { x: number; y: number }, boundMs = 5000): Promise<string> {
  await clearHover(driver);
  await driver.moveTo({ x: at.x + 1, y: at.y });
  await driver.moveTo(at);
  return until('a hover being drawn', boundMs, () => hoverText(driver), (t) => t !== '').catch(() => '');
}

// ---- the command palette ------------------------------------------------------

// paletteRows opens the command palette, types `query` into it as a person does,
// and returns the rows it offers for it, leaving the palette open.
export async function paletteRows(driver: UiDriver, send: (command: string) => Promise<void>, query: string): Promise<QuickInput> {
  await send('workbench.action.showCommands');
  await waitQuickInput(driver, 'the command palette opening', (q) => q.value.startsWith('>'));
  await driver.type(query);
  return waitQuickInput(driver, `the palette's rows for "${query}"`, (q) => q.value === `>${query}` && q.rows.length > 0).catch(async () => {
    const q = await quickInput(driver);
    return q ?? { title: '', placeholder: '', value: '', rows: [] };
  });
}

// visibleText is a workbench element's drawn text, for a person to read.
export function workbenchText(driver: UiDriver, selector: string): Promise<string> {
  return driver.workbench<string>(`((s) => { const e = document.querySelector(s); return e ? (e.innerText || '').trim() : ''; })(${JSON.stringify(selector)})`);
}
