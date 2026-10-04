// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { need } from './checks';
import { UiDriver, WebviewDocument } from './drivers';
import { run, SuiteContext } from './suite-context';
import { Bound, commandsPanel, documentNow, evaluateWithin, pressConfirmed, PressSite, pressOperation, toastsGone, until } from './workbench';

// The topology graph panel as a reader meets it: the graph drawn, a node
// pressed, what is attached to that node and what may attach to it, and the
// Attach control on a row of the second list.
//
// 🔴 A NODE IS PRESSED WHERE IT IS DRAWN, AND NEVER WHERE THE ATTACHMENTS PANEL
// COVERS IT. The panel overlays the right of the canvas once a node is selected,
// so a node drawn beneath it cannot be pressed there: the canvas is dragged until
// the node is clear of the panel, as a person pans, and the press lands only on a
// point where the node itself is what the document finds under the pointer.
//
// 🔴 A RENDER IS READ AS A RENDER, NOT AS A DRAWING BEING THERE. Pressing Graph
// again over a panel that already shows a graph leaves a drawing in place whether
// or not the new one ever arrives, so an observer installed in the panel's
// document counts the drawings the canvas is given, and a check waits for that
// count to move. And a press's own drawing is told from one nobody asked for —
// the redraw a save sends — by what the extension says of each: every drawing it
// sends the panel says whether the reader asked for it, and the observer keeps
// the count of the drawings asked for beside the count of the drawings made.

// graphCouldNotBeDrawn is the channel's line for a drawing the extension could
// not make, held here as written so a change of wording is a change the checks
// report rather than follow: the Release named, then the language server's own
// words for why.
export const graphCouldNotBeDrawn = (release: string, words: string): string => `The topology of ${release} could not be drawn: ${words}`;

// GRAPH_PANEL identifies the graph panel's document: its canvas and the panel
// the selection opens.
export const GRAPH_PANEL = `!!document.getElementById('canvas') && !!document.getElementById('panel-body')`;

// GRAPH_OBSERVER is installed in the graph panel's document, once. It counts the
// drawings the canvas is given, and records every change of what the attachments
// panel shows — which node it names, what its list of what may attach reads, and
// the line a press on Attach ends in — so a reading that lasts a moment, the
// list's waiting sentence, is caught as it is drawn rather than hoped for later.
const GRAPH_OBSERVER = `(() => {
  if (window.__editorSuiteGraph) { return true; }
  const canvas = document.getElementById('canvas');
  const panel = document.getElementById('panel');
  if (!canvas || !panel) { return false; }
  const state = { renders: 0, asked: 0, rendersWhenAsked: 0, readings: [] };
  new MutationObserver(() => { state.renders++; }).observe(canvas, { childList: true });
  window.addEventListener('message', (event) => {
    const m = event.data;
    if (m && m.type === 'render' && m.asked) { state.asked++; state.rendersWhenAsked = state.renders; }
  });
  let last = null;
  const sample = () => {
    const shown = !panel.classList.contains('hidden');
    const body = panel.querySelector('.candidates-body');
    const outcome = panel.querySelector('.attach-outcome');
    const reading = {
      title: shown ? ((document.getElementById('panel-title') || {}).textContent || '') : '',
      candidates: shown && body ? (body.textContent || '') : null,
      outcome: shown && outcome && !outcome.classList.contains('hidden') ? (outcome.textContent || '') : null,
    };
    const key = JSON.stringify(reading);
    if (key !== last) { last = key; state.readings.push(Object.assign({ at: Date.now() }, reading)); }
  };
  sample();
  new MutationObserver(sample).observe(panel, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  window.__editorSuiteGraph = state;
  return true;
})()`;

// PanelReading is one change the observer recorded.
export interface PanelReading { at: number; title: string; candidates: string | null; outcome: string | null }

// GraphState is the panel's document as it stands: how many drawings the canvas
// was given since the observer went in, how many of the drawings sent were asked
// for and how many drawings the canvas had been given when the last of those
// arrived, the nodes drawn, the notice at its top where one is shown, and whether
// the drawing is dimmed as out of date.
export interface GraphState { renders: number; asked: number; rendersWhenAsked: number; nodes: string[]; status: string; outOfDate: boolean }

const GRAPH_STATE = `(() => {
  const s = window.__editorSuiteGraph || { renders: 0, asked: 0, rendersWhenAsked: 0 };
  const status = document.getElementById('status');
  const canvas = document.getElementById('canvas');
  return {
    renders: s.renders,
    asked: s.asked,
    rendersWhenAsked: s.rendersWhenAsked,
    nodes: [...canvas.querySelectorAll('g.node')].map((g) => ((g.querySelector(':scope > text.node-label') || {}).textContent || '')),
    status: status && !status.classList.contains('hidden') ? (status.innerText || '').trim() : '',
    outOfDate: canvas.classList.contains('out-of-date'),
  };
})()`;

export function graphState(doc: WebviewDocument): Promise<GraphState> {
  return evaluateWithin<GraphState>(doc, GRAPH_STATE, 5000);
}

export async function panelReadings(doc: WebviewDocument, from = 0): Promise<PanelReading[]> {
  const log = await evaluateWithin<PanelReading[] | null>(doc, '(window.__editorSuiteGraph || {}).readings || null', 5000);
  need(log !== null, 'the graph panel\'s document carries no record of what its attachments panel showed');
  return log.slice(from);
}

// findGraphPanel is the graph panel's document where one is open as the editor
// stands, with the observer in it, or null; it waits for none to be drawn.
export async function findGraphPanel(ctx: SuiteContext): Promise<WebviewDocument | null> {
  const doc = await documentNow(ctx.d, GRAPH_PANEL);
  if (doc !== null) { await evaluateWithin(doc, GRAPH_OBSERVER, 5000); }
  return doc;
}

// showGraph presses Graph on the Commands panel, as a reader shows the topology,
// and waits for the drawing that press asked for, with no notice left at its top:
// in a panel the press opens, its first drawing; in one already open, a drawing
// made after the extension sent one the reader asked for, so a redraw nobody
// asked for — a save's — landing after the press is not taken for it. A Graph
// button the workbench covers — a modal editor's blocking layer, a notification —
// is refused by name rather than pressed to no effect.
export async function showGraph(ctx: SuiteContext, boundMs: Bound = 90000): Promise<WebviewDocument> {
  const before = await findGraphPanel(ctx);
  const askedBefore = before === null ? -1 : (await graphState(before)).asked;
  const panel = await commandsPanel(ctx.d);
  const button = await ctx.d.box(panel, 'button.op[data-command="aggrega.graph.show"]');
  need(button !== null, 'the Commands panel draws no Graph button');
  const covered = await coveredBy(ctx, { x: button.x + button.width / 2, y: button.y + button.height / 2 });
  need(covered === null, `the Graph button is covered by the workbench's ${covered}, so it cannot be pressed`);
  await pressOperation(ctx.d, panel, 'aggrega.graph.show');
  const doc = before ?? await until('the graph panel opening', boundMs, () => findGraphPanel(ctx), (d) => d !== null) as WebviewDocument;
  await until('the drawing the press asked for', boundMs, () => graphState(doc),
    (s) => (askedBefore === -1 || (s.asked > askedBefore && s.renders > s.rendersWhenAsked)) && s.status === '' && s.nodes.length > 0);
  return doc;
}

// Place is where a node's box is in the panel's document, what covers its
// middle, and where the canvas and the attachments panel are.
interface Place {
  canvas: { x: number; y: number; width: number; height: number };
  node: { x: number; y: number; width: number; height: number };
  panelLeft: number | null;
  hit: { x: number; y: number } | null;
  free: { x: number; y: number } | null;
}

const place = (id: string): string => `((id) => {
  const canvas = document.getElementById('canvas');
  const c = canvas.getBoundingClientRect();
  let g = null;
  for (const n of canvas.querySelectorAll('g.node')) {
    const l = n.querySelector(':scope > text.node-label');
    if (l && l.textContent === id) { g = n; break; }
  }
  if (!g) { return null; }
  const r = g.querySelector(':scope > rect.node-rect').getBoundingClientRect();
  const panel = document.getElementById('panel');
  const panelLeft = panel.classList.contains('hidden') ? null : panel.getBoundingClientRect().left;
  const inside = (x, y) => x > c.left && y > c.top && x < c.right && y < c.bottom;
  let hit = null;
  for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7], [0.15, 0.5], [0.85, 0.5]]) {
    const x = r.left + r.width * fx;
    const y = r.top + r.height * fy;
    if (!inside(x, y)) { continue; }
    const e = document.elementFromPoint(x, y);
    if (e && g.contains(e)) { hit = { x, y }; break; }
  }
  // A point on the canvas no node and no panel covers, where a drag pans.
  let free = null;
  const right = panelLeft === null ? c.right : Math.min(c.right, panelLeft);
  for (let y = c.top + 20; y < c.bottom - 20 && free === null; y += 23) {
    for (let x = c.left + 20; x < right - 20; x += 29) {
      const e = document.elementFromPoint(x, y);
      if (e && canvas.contains(e) && !(e.closest && e.closest('g.node'))) { free = { x, y }; break; }
    }
  }
  return {
    canvas: { x: c.left, y: c.top, width: c.width, height: c.height },
    node: { x: r.left, y: r.top, width: r.width, height: r.height },
    panelLeft, hit, free,
  };
})(${JSON.stringify(id)})`;

// offsetOf is where the panel's document sits in the window: the difference
// between where the window draws its canvas and where the document measures it.
async function offsetOf(ctx: SuiteContext, doc: WebviewDocument): Promise<{ dx: number; dy: number }> {
  const inWindow = await ctx.d.box(doc, '#canvas');
  need(inWindow !== null, 'the graph panel\'s canvas is not drawn in the window');
  const inDoc = await evaluateWithin<{ x: number; y: number }>(doc, `(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left, y: r.top }; })()`, 5000);
  return { dx: inWindow.x - inDoc.x, dy: inWindow.y - inDoc.y };
}

// putAwayNotifications hides the notifications the workbench draws over the
// editor area, as a person puts them away to reach what is beneath: they stay in
// the notification centre, and the record of every notification drawn is kept.
export async function putAwayNotifications(ctx: SuiteContext): Promise<void> {
  await run(ctx, 'notifications.hideToasts');
  await toastsGone(ctx.d).catch(() => undefined);
}

// coveredBy names what the workbench draws over a point of the window where a
// panel's document should be under the pointer — a notification, a hover — or
// is null where the point reaches a panel's frame. A panel's document cannot
// see what the workbench lays over it, so a point it finds clear may still be
// covered there.
export async function coveredBy(ctx: SuiteContext, at: { x: number; y: number }): Promise<string | null> {
  return ctx.d.workbench<string | null>(`((x, y) => {
    const e = document.elementFromPoint(x, y);
    if (e && e.tagName === 'IFRAME') { return null; }
    return e ? e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') : 'nothing';
  })(${at.x}, ${at.y})`);
}

// bringIntoReach drags the canvas until the node's middle is where nothing but
// the node is under the pointer — in the panel's document and in the window,
// where the workbench may draw a notification over the panel — and returns that
// point in the window.
async function bringIntoReach(ctx: SuiteContext, doc: WebviewDocument, id: string): Promise<{ x: number; y: number }> {
  let covered: string | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const p = await evaluateWithin<Place | null>(doc, place(id), 5000);
    need(p !== null, `the graph draws no node ${id}`);
    const off = await offsetOf(ctx, doc);
    if (p.hit !== null) {
      const at = { x: p.hit.x + off.dx, y: p.hit.y + off.dy };
      covered = await coveredBy(ctx, at);
      if (covered !== null && /notification/.test(covered)) {
        await putAwayNotifications(ctx);
        covered = await coveredBy(ctx, at);
      }
      if (covered === null) { return at; }
    }
    need(p.free !== null, `the graph leaves no point clear of its nodes and its panel to drag the canvas by, so ${id} cannot be brought out from under the panel`);
    const right = p.panelLeft ?? p.canvas.x + p.canvas.width;
    // The middle of the canvas the panel leaves clear first, then higher and
    // further left, away from where the workbench draws its notifications.
    const target = attempt % 2 === 0
      ? { x: p.canvas.x + (right - p.canvas.x) / 2, y: p.canvas.y + p.canvas.height / 2 }
      : { x: p.canvas.x + (right - p.canvas.x) / 3, y: p.canvas.y + p.canvas.height / 3 };
    const move = { x: target.x - (p.node.x + p.node.width / 2), y: target.y - (p.node.y + p.node.height / 2) };
    const to = {
      x: Math.max(p.canvas.x + 5, Math.min(right - 5, p.free.x + move.x)),
      y: Math.max(p.canvas.y + 5, Math.min(p.canvas.y + p.canvas.height - 5, p.free.y + move.y)),
    };
    await ctx.d.drag({ x: p.free.x + off.dx, y: p.free.y + off.dy }, { x: to.x + off.dx, y: to.y + off.dy }, 12);
    // The node is read where it comes to rest, not where the drag left it passing.
    let before: string | null = null;
    await until(`the node ${id} standing still after the drag`, 5000, async () => {
      const q = await evaluateWithin<Place | null>(doc, place(id), 5000);
      const key = q === null ? null : `${Math.round(q.node.x * 2)},${Math.round(q.node.y * 2)}`;
      const same = key !== null && key === before;
      before = key;
      return same;
    }, (same) => same, 100);
  }
  throw new Error(`the node ${id} could not be brought out from under the attachments panel${covered === null ? '' : ` and the workbench's ${covered}`}`);
}

// nodeTarget finds, in the panel's document, the drawn node labelled `id`.
function nodeTarget(id: string): string {
  return `(() => {
    for (const n of document.getElementById('canvas').querySelectorAll('g.node')) {
      const l = n.querySelector(':scope > text.node-label');
      if (l && l.textContent === ${JSON.stringify(id)}) { return n; }
    }
    return null;
  })()`;
}

// nodeSite is where the node labelled `id` is pressed in the window, or why it
// cannot be pressed there yet.
async function nodeSite(ctx: SuiteContext, doc: WebviewDocument, id: string): Promise<PressSite> {
  const p = await evaluateWithin<Place | null>(doc, place(id), 5000);
  if (p === null) { return { blocked: `the graph draws no node ${id}` }; }
  if (p.hit === null) { return { blocked: `no point of the node ${id} is clear of the attachments panel` }; }
  const off = await offsetOf(ctx, doc);
  const at = { x: p.hit.x + off.dx, y: p.hit.y + off.dy };
  const over = await coveredBy(ctx, at);
  return over === null ? at : { blocked: `the workbench's ${over} is drawn over it` };
}

// pressNode presses a node where a person presses it, through `pressConfirmed`
// (workbench.ts), and waits for the attachments panel to be drawn for it after
// the press — a panel already naming the node before the press is not evidence
// that this press selected it. A press that reached the node and that the panel
// does not follow means the node was not selected.
export async function pressNode(ctx: SuiteContext, doc: WebviewDocument, id: string): Promise<void> {
  await bringIntoReach(ctx, doc, id);
  const from = (await panelReadings(doc)).length;
  await pressConfirmed(ctx.d, { doc, target: nodeTarget(id), what: `the node ${id}` }, () => nodeSite(ctx, doc, id));
  await until(`the attachments panel drawn for ${id}`, 10000, () => panelReadings(doc, from), (r) => r.some((x) => x.title === id));
}

// pointAtNode is where a node can be pressed, in the window, for a check that
// presses several nodes in quick succession without waiting on the panel between
// presses. The node is brought into reach first.
export async function pointAtNode(ctx: SuiteContext, doc: WebviewDocument, id: string): Promise<{ x: number; y: number }> {
  return bringIntoReach(ctx, doc, id);
}

export function panelTitle(doc: WebviewDocument): Promise<string> {
  return evaluateWithin<string>(doc, `(() => { const p = document.getElementById('panel'); return p && !p.classList.contains('hidden') ? (document.getElementById('panel-title').textContent || '') : ''; })()`, 5000);
}

// Pair is one key and its value as a facts list draws them.
export interface Pair { key: string; value: string; withheld: boolean; drawn: boolean }

// Candidate is one row of the list of what may attach.
export interface Candidate { name: string; button: string; facts: Pair[] }

// Panel is the attachments panel as drawn: the node it names, each attachment
// with its facts and its configuration, the sentence standing for none, and the
// list of what may attach with its heading, its captions and either its rows or
// the sentence standing in for them, and the line a press on Attach ended in.
export interface Panel {
  title: string;
  attachments: { name: string; sensitive: boolean; facts: Pair[]; config: Pair[] }[];
  nothingAttached: string | null;
  candidates: { title: string; captions: string[]; rows: Candidate[]; note: string | null; failed: string | null; body: string } | null;
  outcome: { text: string; failed: boolean } | null;
}

const PANEL = `(() => {
  const panel = document.getElementById('panel');
  if (!panel || panel.classList.contains('hidden')) { return null; }
  const body = document.getElementById('panel-body');
  const text = (e) => (e ? (e.innerText || '') : '');
  const pairs = (dl) => {
    const out = [];
    if (!dl) { return out; }
    const kids = [...dl.children];
    for (let i = 0; i + 1 < kids.length; i += 2) {
      const dd = kids[i + 1];
      out.push({ key: text(kids[i]), value: text(dd), withheld: dd.classList.contains('withheld'), drawn: dd.getBoundingClientRect().height > 0 });
    }
    return out;
  };
  const cand = body.querySelector(':scope > section.candidates');
  const candBody = cand ? cand.querySelector('.candidates-body') : null;
  const outcome = cand ? cand.querySelector(':scope > .attach-outcome') : null;
  return {
    title: document.getElementById('panel-title').textContent || '',
    attachments: [...body.querySelectorAll(':scope > section.attachment')].map((s) => ({
      name: text(s.querySelector('.attachment-name')),
      sensitive: !!s.querySelector('.attachment-sensitive'),
      facts: pairs(s.querySelector(':scope > dl.facts:not(.config)')),
      config: pairs(s.querySelector(':scope > dl.facts.config')),
    })),
    nothingAttached: body.querySelector(':scope > p.panel-empty') ? text(body.querySelector(':scope > p.panel-empty')) : null,
    candidates: cand ? {
      title: text(cand.querySelector('.candidates-title')),
      captions: [...cand.querySelectorAll(':scope > p.candidates-caption')].map(text),
      rows: [...candBody.querySelectorAll(':scope > section.candidate')].map((r) => ({
        name: text(r.querySelector('.candidate-name')),
        button: text(r.querySelector('.candidate-attach')),
        facts: pairs(r.querySelector('dl.facts')),
      })),
      note: candBody.querySelector(':scope > p.panel-empty') ? text(candBody.querySelector(':scope > p.panel-empty')) : null,
      failed: candBody.querySelector(':scope > p.candidates-failed') ? text(candBody.querySelector(':scope > p.candidates-failed')) : null,
      body: text(candBody),
    } : null,
    outcome: outcome && !outcome.classList.contains('hidden') ? { text: outcome.textContent || '', failed: outcome.classList.contains('attach-failed') } : null,
  };
})()`;

export function readPanel(doc: WebviewDocument): Promise<Panel | null> {
  return evaluateWithin<Panel | null>(doc, PANEL, 5000);
}

// settledPanel waits for the list of what may attach to stop waiting — rows
// drawn, a sentence standing in for them, or a refusal — and returns the panel.
export function settledPanel(doc: WebviewDocument, node: string, pending: string, boundMs = 30000): Promise<Panel> {
  return until(`the list of what may attach to ${node} settling`, boundMs, () => readPanel(doc),
    (p) => p !== null && p.title === node && p.candidates !== null && p.candidates.body !== pending && (p.candidates.rows.length > 0 || p.candidates.note !== null || p.candidates.failed !== null)) as Promise<Panel>;
}

// attachTarget finds, in the panel's document, the Attach button on the row
// naming `feature`.
function attachTarget(feature: string): string {
  return `(() => {
    for (const row of document.querySelectorAll('#panel-body section.candidate')) {
      if (((row.querySelector('.candidate-name') || {}).textContent || '') === ${JSON.stringify(feature)}) { return row.querySelector('.candidate-attach'); }
    }
    return null;
  })()`;
}

// attachSite is where that button is pressed in the window, as the list stands
// scrolled, or why it cannot be pressed there.
async function attachSite(ctx: SuiteContext, doc: WebviewDocument, feature: string): Promise<PressSite> {
  const at = await evaluateWithin<{ x: number; y: number } | null>(doc, `(() => {
    const b = ${attachTarget(feature)};
    if (!b) { return null; }
    const r = b.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const e = document.elementFromPoint(x, y);
    return e === b || b.contains(e) ? { x, y } : null;
  })()`, 5000);
  if (at === null) { return { blocked: `the row naming ${feature} draws no Attach button where it can be pressed` }; }
  const off = await offsetOf(ctx, doc);
  const inWindow = { x: at.x + off.dx, y: at.y + off.dy };
  const over = await coveredBy(ctx, inWindow);
  return over === null ? inWindow : { blocked: `the workbench's ${over} is drawn over it` };
}

// pressAttach presses Attach on the row naming `feature`, where a person
// presses it: scrolled into sight inside the panel first — to the middle of the
// list, or to its top or its bottom where the workbench draws something over the
// middle — and only where the button itself is under the pointer, in the panel's
// document and in the window; the press is made through `pressConfirmed`
// (workbench.ts).
export async function pressAttach(ctx: SuiteContext, doc: WebviewDocument, feature: string): Promise<void> {
  const tried: string[] = [];
  for (const block of ['center', 'start', 'end']) {
    const at = await evaluateWithin<{ x: number; y: number } | null>(doc, `((name, block) => {
      for (const row of document.querySelectorAll('#panel-body section.candidate')) {
        if (((row.querySelector('.candidate-name') || {}).textContent || '') !== name) { continue; }
        const b = row.querySelector('.candidate-attach');
        if (!b) { return null; }
        b.scrollIntoView({ block, inline: 'nearest' });
        const r = b.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const e = document.elementFromPoint(x, y);
        return e === b || b.contains(e) ? { x, y } : null;
      }
      return null;
    })(${JSON.stringify(feature)}, ${JSON.stringify(block)})`, 5000);
    need(at !== null, `the row naming ${feature} draws no Attach button where it can be pressed`);
    const off = await offsetOf(ctx, doc);
    const inWindow = { x: at.x + off.dx, y: at.y + off.dy };
    let covered = await coveredBy(ctx, inWindow);
    if (covered !== null && /notification/.test(covered)) {
      await putAwayNotifications(ctx);
      covered = await coveredBy(ctx, inWindow);
    }
    if (covered === null) {
      await pressConfirmed(ctx.d, { doc, target: attachTarget(feature), what: `the Attach button on the row naming ${feature}` }, () => attachSite(ctx, doc, feature));
      return;
    }
    tried.push(`scrolled to its ${block}, the workbench's ${covered}`);
  }
  need(false, `the Attach button on the row naming ${feature} is covered wherever it is scrolled to: ${tried.join('; ')}`);
}

// revealGraphTab brings the graph panel's tab to the front by pressing it, as a
// person does after another document opened over it.
export async function revealGraphTab(ctx: SuiteContext): Promise<void> {
  const at = await until('the graph panel\'s tab', 10000, () => ctx.d.workbench<{ x: number; y: number } | null>(`(() => {
    for (const t of document.querySelectorAll('.tabs-container .tab')) {
      const l = ((t.querySelector('.label-name') || {}).innerText || t.getAttribute('aria-label') || '').trim();
      if (!l.startsWith('Aggrega Graph')) { continue; }
      const r = t.getBoundingClientRect();
      if (r.width > 0) { return { x: r.x + Math.min(r.width / 2, 60), y: r.y + r.height / 2 }; }
    }
    return null;
  })()`), (v) => v !== null);
  if (at === null) { throw new Error('unreachable: the graph panel\'s tab'); }
  await ctx.d.click(at);
  await until('the graph panel\'s tab in front', 10000, () => frontTabLabel(ctx.d), isGraphTab);
}

// frontTabLabel is the label of the tab in front of its group, as the workbench
// draws it, and isGraphTab whether a label is the graph panel's.
export function frontTabLabel(d: UiDriver): Promise<string> {
  return d.workbench<string>(`(((document.querySelector('.tabs-container .tab.active .label-name') || {}).innerText) || '').trim()`);
}

export const isGraphTab = (label: string): boolean => label.startsWith('Aggrega Graph');

// graphTabInFront reports whether the graph panel's tab is the one in front —
// the reading revealGraphTab ends on, for a check that puts the panel behind
// another tab and has to know it is still there.
export async function graphTabInFront(d: UiDriver): Promise<boolean> {
  return isGraphTab(await frontTabLabel(d));
}

// postFromPanel posts a message into the channel the graph panel's own
// messages travel through: the post function the editor gives the frame that
// hosts the panel's document, called as the panel's own post calls it. It is
// how the suite makes a request no press in the panel makes.
export async function postFromPanel(ctx: SuiteContext, doc: WebviewDocument, message: unknown): Promise<void> {
  const host = ctx.d.hostOf(doc);
  need(host !== null, 'the graph panel\'s document is drawn in no frame of the editor\'s');
  const posted = await evaluateWithin<boolean>(host, `((message) => {
    const post = window.__vscode_post_message__;
    if (typeof post !== 'function') { return false; }
    post('onmessage', { message, transfer: undefined });
    return true;
  })(${JSON.stringify(message)})`, 5000);
  need(posted, 'the frame hosting the graph panel\'s document carries no post channel');
}
