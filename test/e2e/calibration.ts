// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { DAEMON_STANDING_WORDS, RESTART_COMMAND } from '../../src/daemon-status';
import { UiDriver, WebviewDocument } from './drivers';
import { ProbeClient } from './probe-client';
import { statusObserver } from './workbench';

// The calibration: seven readings a UI driver must get right before any check is
// written on top of it. Each one is a thing the checks do all the time — draw
// and capture the workbench, find one panel among many by what it holds, measure
// drawn text, resize a panel by hand, send a key into a panel, watch the status
// bar through a transient state, and leave nothing running — so a driver that
// gets one wrong would turn a class of checks into noise.

// NeedleResult is one calibration reading.
export interface NeedleResult {
  needle: string;
  subject: string;
  passed: boolean;
  elapsedMs: number;
  evidence: unknown;
  error?: string;
}

// CalibrationContext is what the readings run against.
export interface CalibrationContext {
  driver: UiDriver;
  probe: ProbeClient;
  extensionDir: string;
  logs: string;
}

// writeCalibrationFolder writes the folder the calibration opens: a workspace
// marker naming the catalog, and one entity the language server reports on.
export function writeCalibrationFolder(dir: string, catalog: string): { folder: string; faulty: string } {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.aggrega-config.yaml'), `workspace:\n  catalog_dirs:\n    - ${catalog}\n`);
  const faulty = path.join(dir, 'faulty-component.yaml');
  // A Component missing two required metadata fields and carrying a key its
  // schema does not declare, so the server has three things to report.
  fs.writeFileSync(faulty, [
    'apiVersion: aggrega.ai/v1alpha1',
    'kind: Component',
    'metadata:',
    '  name: calibration-component',
    'spec:',
    '  undeclaredKey: 3',
    '',
  ].join('\n'));
  return { folder: dir, faulty };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function poll<T>(what: string, boundMs: number, read: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
  const until = Date.now() + boundMs;
  let last: T | undefined;
  let lastError = '';
  while (Date.now() < until) {
    try {
      last = await read();
      if (done(last)) { return last; }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(100);
  }
  throw new Error(`${what} did not happen within ${boundMs} ms (last reading ${JSON.stringify(last ?? null)}${lastError ? `, last error ${lastError}` : ''})`);
}

// DOCUMENT_KIND says what a webview document is, by content.
const DOCUMENT_KIND = `({
  commandButtons: document.querySelectorAll('button.op[data-command]').length,
  title: document.title,
  bodyChars: ((document.body && document.body.innerText) || '').length
})`;

// COMMAND_BUTTONS is the query the panel-finding reading asserts on: present in
// the Commands panel, absent from every other document.
const COMMAND_BUTTONS = `document.querySelectorAll('button.op[data-command]').length`;

interface DocumentKind { commandButtons: number; title: string; bodyChars: number }

// commandsPanel finds the Commands panel's document among every webview document,
// by what it holds.
export async function commandsPanel(driver: UiDriver, boundMs: number): Promise<{ doc: WebviewDocument; others: WebviewDocument[]; kinds: { url: string; kind: DocumentKind | { error: string } }[] }> {
  let found: { doc: WebviewDocument; others: WebviewDocument[]; kinds: { url: string; kind: DocumentKind | { error: string } }[] } | null = null;
  await poll('the Commands panel drawing its buttons', boundMs, async () => {
    const docs = await driver.webviews();
    const kinds: { url: string; kind: DocumentKind | { error: string } }[] = [];
    const hits: WebviewDocument[] = [];
    for (const d of docs) {
      try {
        const kind = await d.evaluate<DocumentKind>(DOCUMENT_KIND);
        kinds.push({ url: d.url.slice(0, 100), kind });
        if (kind.commandButtons > 0) { hits.push(d); }
      } catch (err) {
        kinds.push({ url: d.url.slice(0, 100), kind: { error: err instanceof Error ? err.message.slice(0, 160) : String(err) } });
      }
    }
    found = hits.length === 1 ? { doc: hits[0], others: docs.filter((d) => d !== hits[0]), kinds } : null;
    return { documents: docs.length, hits: hits.length };
  }, (v) => v.hits === 1);
  if (found === null) { throw new Error('unreachable: the poll returned without a panel'); }
  return found;
}

async function needle(name: string, subject: string, run: () => Promise<{ passed: boolean; evidence: unknown }>): Promise<NeedleResult> {
  const t0 = Date.now();
  try {
    const { passed, evidence } = await run();
    return { needle: name, subject, passed, elapsedMs: Date.now() - t0, evidence };
  } catch (err) {
    return { needle: name, subject, passed: false, elapsedMs: Date.now() - t0, evidence: null, error: err instanceof Error ? err.message : String(err) };
  }
}

const SIDEBAR = `(() => {
  const sb = document.getElementById('workbench.parts.sidebar');
  const r = sb ? sb.getBoundingClientRect() : null;
  const title = sb ? ((sb.querySelector('.composite.title') || {}).innerText || '') : '';
  return { sidebar: r && { x: r.x, width: r.width, height: r.height }, title: title.trim(),
    window: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio } };
})()`;

interface SidebarReading { sidebar: { x: number; width: number; height: number } | null; title: string; window: { width: number; height: number; dpr: number } }

function pngSize(file: string): { width: number; height: number } | null {
  const b = fs.readFileSync(file);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (b.length < 24 || !b.subarray(0, 8).equals(signature)) { return null; }
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function viewContainerTitle(extensionDir: string): string {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'package.json'), 'utf8')) as {
    contributes: { viewsContainers: { activitybar: { id: string; title: string }[] } };
  };
  const c = manifest.contributes.viewsContainers.activitybar.find((x) => x.id === 'aggrega');
  if (!c) { throw new Error('the manifest declares no aggrega view container'); }
  return c.title;
}

// needleScreenshot: the workbench captured with the Aggrega side bar showing.
function needleScreenshot(ctx: CalibrationContext): Promise<NeedleResult> {
  return needle('a', 'a capture of the workbench showing the Aggrega side bar', async () => {
    const title = viewContainerTitle(ctx.extensionDir);
    await ctx.probe.request('command.run', { command: 'workbench.view.extension.aggrega' });
    const side = await poll('the Aggrega side bar opening', 15000, () => ctx.driver.workbench<SidebarReading>(SIDEBAR),
      (v) => v.sidebar !== null && v.sidebar.width > 0 && v.title.toLowerCase().includes(title.toLowerCase()));
    // The capture waits for the Commands panel to draw its buttons, so what it
    // shows includes a panel drawn by another process, composited into the page.
    await commandsPanel(ctx.driver, 30000);
    const file = path.join(ctx.logs, `${ctx.driver.name}-workbench.png`);
    const bytes = await ctx.driver.screenshot(file);
    const size = pngSize(file);
    const expected = { width: Math.round(side.window.width * side.window.dpr), height: Math.round(side.window.height * side.window.dpr) };
    const passed = size !== null && bytes > 0 && size.width === expected.width && size.height === expected.height;
    return { passed, evidence: { file, bytes, png: size, window: side.window, sidebar: side.sidebar, sidebarTitle: side.title, declaredTitle: title } };
  });
}

// needlePanelQuery: one query answered in the Commands panel's document and by
// no other document.
function needlePanelQuery(ctx: CalibrationContext): Promise<NeedleResult> {
  return needle('b', 'a query found in the Commands panel by content, and in no other document', async () => {
    // A second panel open beside the first is what makes "in no other document"
    // a control rather than a formality: the welcome page is another webview of
    // the same extension, drawn from the same kind of document.
    await ctx.probe.request('command.run', { command: 'aggrega.getStarted.open' });
    await poll('the welcome page drawing', 30000, async () => {
      const docs = await ctx.driver.webviews();
      const bodies: number[] = [];
      for (const d of docs) { try { bodies.push(await d.evaluate<number>(`((document.body && document.body.innerText) || '').length`)); } catch { bodies.push(0); } }
      return bodies.filter((n) => n > 0).length;
    }, (drawn) => drawn >= 2);
    const { doc, others, kinds } = await commandsPanel(ctx.driver, 30000);
    const inPanel = await doc.evaluate<number>(COMMAND_BUTTONS);
    const elsewhere: { url: string; value: number | string }[] = [];
    for (const o of others) {
      try { elsewhere.push({ url: o.url.slice(0, 100), value: await o.evaluate<number>(COMMAND_BUTTONS) }); } catch (err) {
        elsewhere.push({ url: o.url.slice(0, 100), value: `error: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}` });
      }
    }
    const inWorkbench = await ctx.driver.workbench<number>(COMMAND_BUTTONS);
    const drawnElsewhere = kinds.filter((k) => 'bodyChars' in k.kind && k.kind.commandButtons === 0 && k.kind.bodyChars > 0).length;
    const passed = inPanel > 0 && inWorkbench === 0 && drawnElsewhere > 0 && elsewhere.every((e) => e.value === 0);
    return { passed, evidence: { query: COMMAND_BUTTONS, inPanel, inWorkbench, otherDrawnDocuments: drawnElsewhere, otherDocuments: elsewhere, documents: kinds } };
  });
}

const LABEL_METRICS = `[...document.querySelectorAll('button.op .op-label')].map((e) => {
  const r = e.getBoundingClientRect();
  return { text: (e.textContent || '').trim(), width: r.width, height: r.height };
})`;

// needleTextMetrics: drawn text has real widths, ordered as its length is, in a
// font that is not the fallback.
function needleTextMetrics(ctx: CalibrationContext): Promise<NeedleResult> {
  return needle('c', 'text drawn with real metrics, ordered by label length', async () => {
    const { doc } = await commandsPanel(ctx.driver, 30000);
    const labels = await doc.evaluate<{ text: string; width: number; height: number }[]>(LABEL_METRICS);
    const disordered: string[] = [];
    let compared = 0;
    for (const a of labels) {
      for (const b of labels) {
        if (b.text.length >= 1.5 * a.text.length && b.text.length - a.text.length >= 3) {
          compared++;
          if (!(b.width > a.width)) { disordered.push(`"${b.text}" (${b.width}px) is not wider than "${a.text}" (${a.width}px)`); }
        }
      }
    }
    const fonts = await ctx.driver.platformFonts(doc, 'button.op .op-label');
    const fallback = fonts.fonts.some((f) => /freeserif/i.test(f.familyName));
    const passed = labels.length >= 3 && labels.every((l) => l.width > 0 && l.height > 0) && compared > 0 && disordered.length === 0 && fonts.fonts.length > 0 && !fallback;
    return { passed, evidence: { labels, comparedPairs: compared, disordered, fonts } };
  });
}

const SASH = `(() => {
  const sb = document.getElementById('workbench.parts.sidebar').getBoundingClientRect();
  const sashes = [...document.querySelectorAll('.monaco-sash.vertical')].map((s) => s.getBoundingClientRect())
    .filter((r) => r.height > 100 && Math.abs((r.x + r.width / 2) - sb.right) < 6);
  return { width: sb.width, right: sb.right, sash: sashes[0] ? { x: sashes[0].x + sashes[0].width / 2, y: sashes[0].y + sashes[0].height / 2 } : null };
})()`;

interface SashReading { width: number; right: number; sash: { x: number; y: number } | null }

async function dragSideBarTo(driver: UiDriver, want: number): Promise<number> {
  const geo = await driver.workbench<SashReading>(SASH);
  if (geo.sash === null) { throw new Error(`no vertical sash at the side bar's edge: ${JSON.stringify(geo)}`); }
  await driver.drag(geo.sash, { x: geo.sash.x + (want - geo.width), y: geo.sash.y }, 8);
  // Settled is two equal readings in a row.
  let last = -1;
  const settled = await poll(`the side bar settling at ${want}px`, 5000, async () => {
    const w = (await driver.workbench<SashReading>(SASH)).width;
    const same = w === last;
    last = w;
    return { w, same };
  }, (v) => v.same);
  return settled.w;
}

// needleSashWidths: two side bar widths set by dragging, each read back inside
// the panel.
function needleSashWidths(ctx: CalibrationContext): Promise<NeedleResult> {
  return needle('d', 'two side bar widths set by dragging the sash, read back inside the panel', async () => {
    const { doc } = await commandsPanel(ctx.driver, 30000);
    const readings: { requested: number; sidebar: number; panelInnerWidth: number }[] = [];
    for (const want of [320, 520]) {
      const sidebar = await dragSideBarTo(ctx.driver, want);
      const inner = await poll('the panel resizing', 5000, () => doc.evaluate<number>('innerWidth'), () => true);
      readings.push({ requested: want, sidebar, panelInnerWidth: inner });
    }
    const [a, b] = readings;
    const passed = readings.every((r) => Math.abs(r.sidebar - r.requested) <= 2) &&
      a.panelInnerWidth !== b.panelInnerWidth &&
      Math.abs((b.panelInnerWidth - a.panelInnerWidth) - (b.sidebar - a.sidebar)) <= 2;
    return { passed, evidence: { readings } };
  });
}

const FOCUS_FIRST = `(() => {
  const all = [...document.querySelectorAll('[data-roving] [data-focus-key]')].filter((e) => !e.disabled);
  if (all.length < 2) { return null; }
  all[0].focus();
  const a = document.activeElement;
  return { count: all.length, first: all[0].dataset.focusKey, last: all[all.length - 1].dataset.focusKey,
    active: a && a.dataset ? a.dataset.focusKey || a.tagName : null, hasFocus: document.hasFocus() };
})()`;

const ACTIVE = `(() => { const a = document.activeElement; return { active: a && a.dataset ? a.dataset.focusKey || a.tagName : null, hasFocus: document.hasFocus() }; })()`;

// needleKey: a key sent to the editor reaches the panel and moves its focus.
function needleKey(ctx: CalibrationContext): Promise<NeedleResult> {
  return needle('e', 'a key reaching a webview and moving document.activeElement', async () => {
    const { doc } = await commandsPanel(ctx.driver, 30000);
    // The view's own focus command is what a keyboard reader uses to reach the
    // panel; focusing an element from script alone does not move the workbench's
    // focus into a cross-origin frame.
    await ctx.probe.request('command.run', { command: 'aggrega.operations.focus' });
    const before = await poll('the panel taking focus', 5000, () => doc.evaluate<{ count: number; first: string; last: string; active: string | null; hasFocus: boolean } | null>(FOCUS_FIRST),
      (v) => v !== null && v.hasFocus && v.active === v.first);
    if (before === null) { throw new Error('unreachable: the poll returned without a reading'); }
    await ctx.driver.press('End');
    const after = await poll('focus moving', 3000, () => doc.evaluate<{ active: string | null; hasFocus: boolean }>(ACTIVE), (v) => v.active !== before.first);
    const passed = after.active !== before.first && after.active === before.last;
    return { passed, evidence: { key: 'End', before, after } };
  });
}

// needleStatusRestart: the status bar reads running, then starting, then running
// again across a restart of the language server.
function needleStatusRestart(ctx: CalibrationContext): Promise<NeedleResult> {
  return needle('f', 'the status bar reading running, starting and running across a restart', async () => {
    const running = `Aggrega: ${DAEMON_STANDING_WORDS.running}`;
    const starting = `Aggrega: ${DAEMON_STANDING_WORDS.starting}`;
    await ctx.driver.workbench(statusObserver(Object.values(DAEMON_STANDING_WORDS)));
    const readLog = (): Promise<{ at: number; reading: string }[]> => ctx.driver.workbench('window.__editorSuiteStatus');
    await poll('the status bar reading running', 60000, readLog, (log) => log.length > 0 && log[log.length - 1].reading === running);
    const mark = (await readLog()).length;
    const t0 = Date.now();
    await ctx.probe.request('command.run', { command: RESTART_COMMAND });
    const after = await poll('the restart finishing', 30000, async () => (await readLog()).slice(mark - 1), (log) => {
      const i = log.findIndex((e) => e.reading === starting);
      return i !== -1 && log.slice(i + 1).some((e) => e.reading === running);
    });
    const sequence = after.map((e) => e.reading);
    const passed = sequence[0] === running && sequence.includes(starting) && sequence[sequence.length - 1] === running;
    return { passed, evidence: { sequence, readings: after.map((e) => ({ reading: e.reading, atMs: e.at - after[0].at })), commandSentAtMs: t0 - after[0].at } };
  });
}

// runNeedles runs readings (a) to (f) in order. Reading (g), that teardown leaves
// nothing alive, is taken by the caller after it stops the editor.
export async function runNeedles(ctx: CalibrationContext): Promise<NeedleResult[]> {
  const results: NeedleResult[] = [];
  for (const run of [needleScreenshot, needlePanelQuery, needleTextMetrics, needleSashWidths, needleKey, needleStatusRestart]) {
    results.push(await run(ctx));
  }
  return results;
}
