// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

import { WebviewDocument } from './drivers';
import { REPO_ROOT } from './inputs';
import { evaluateWithin, until } from './workbench';

// The topology drawing read as shapes: where each container, each node's card,
// each line of text and each edge is drawn in the graph panel's document, the
// legend beside them, every change of the notice at the panel's top, and each
// time the panel is told whether it is on screen.
//
// graph-panel.ts reads what the panel holds at a moment — the drawings the
// canvas was given, the nodes it names, the notice, whether the drawing is
// dimmed — and the attachments panel. What a check about legibility measures is
// geometry, which that reading does not carry, so it is read here, beside it,
// from the same document.
//
// 🔴 EVERY POSITION IS IN THE PANEL DOCUMENT'S OWN COORDINATES, the space its
// canvas is measured in, so a box, a line of text and a point of an edge can be
// compared with one another and with the canvas whatever the reader has panned
// or zoomed to. An edge's points are carried into that space by the matrix the
// document itself reports for the edge, never by a transform worked out here.

export interface Rect { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }

// ---- what the layout model declares ------------------------------------------

// LayoutModel is what media/graph-model.js declares about the words the drawing
// writes: how a container's title is composed, and the legend's heading, rows
// and note. It is read from the extension's own source, run in a context of its
// own as the unit specs run it, so a check holds the drawing to the product's
// declaration rather than to a second copy of its words; a plant edits the copy
// under test and leaves this source alone. The unit specs load the file the same
// way and are not imported here, because loading a spec file runs its specs.
interface LayoutModel {
  containerLabel(kind: 'boundary' | 'subsystem', title: string): string;
  LEGEND_TITLE: string;
  LEGEND_ROWS: { swatch: string; text: string }[];
  LEGEND_NOTE: string;
}

let declared: LayoutModel | null = null;

export function layoutModel(): LayoutModel {
  if (declared === null) {
    const file = path.join(REPO_ROOT, 'media', 'graph-model.js');
    const sandbox: Record<string, unknown> = {};
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox as vm.Context, { filename: file });
    const model = sandbox.AggregaGraphModel as LayoutModel | undefined;
    if (model === undefined) { throw new Error(`${file} declares no layout model`); }
    declared = model;
  }
  return declared;
}

// The title a container is drawn with, as the layout model composes it from the
// kind and the name of the grouping.
export const boundaryTitle = (name: string): string => layoutModel().containerLabel('boundary', name);
export const subsystemTitle = (name: string): string => layoutModel().containerLabel('subsystem', name);

// NONE_DECLARED is the name a container is to be titled with where nobody
// declared its grouping. The layout model keeps the words it writes there to
// itself, so they are held here as a reader is to meet them.
export const NONE_DECLARED = '(none declared)';

// DrawnContainer is one boundary or subsystem as drawn: its kind, read from how
// the drawing styles its box, and the title written into it.
export interface DrawnContainer { kind: 'boundary' | 'subsystem'; title: string; box: Rect; titleBox: Rect }

// DrawnNode is one node as drawn: its id, the component name written beneath it
// where one is, its card, the box of each line, and whether it is the selection.
export interface DrawnNode { id: string; component: string | null; card: Rect; idBox: Rect; componentBox: Rect | null; selected: boolean }

// DrawnEdge is one edge as drawn, its two ends named by the hover the drawing
// gives it, and the points of its line.
export interface DrawnEdge { from: string; to: string; points: Point[] }

// Drawing is everything above, the canvas it is drawn on, and what could not be
// read as one of them, so a shape the reading missed is reported rather than
// silently left out.
export interface Drawing { canvas: Rect; containers: DrawnContainer[]; nodes: DrawnNode[]; edges: DrawnEdge[]; unread: string[] }

const DRAWING = `(() => {
  const canvas = document.getElementById('canvas');
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; };
  const unread = [];
  const containers = [];
  for (const r of canvas.querySelectorAll('rect.container-boundary, rect.container-subsystem')) {
    // The drawing writes each container's title straight after its box.
    const t = r.nextElementSibling;
    if (!t || !t.classList.contains('container-title')) { unread.push('a container box with no title written after it'); continue; }
    containers.push({ kind: r.classList.contains('container-boundary') ? 'boundary' : 'subsystem', title: t.textContent || '', box: box(r), titleBox: box(t) });
  }
  const nodes = [];
  for (const g of canvas.querySelectorAll('g.node')) {
    const card = g.querySelector(':scope > rect.node-rect');
    const id = g.querySelector(':scope > text.node-label');
    const sub = g.querySelector(':scope > text.node-sub');
    if (!card || !id) { unread.push('a node drawn without its card or its id'); continue; }
    nodes.push({ id: id.textContent || '', component: sub ? sub.textContent || '' : null, card: box(card), idBox: box(id), componentBox: sub ? box(sub) : null, selected: g.classList.contains('node-selected') });
  }
  const edges = [];
  for (const p of canvas.querySelectorAll('polyline.edge')) {
    const ends = (((p.querySelector(':scope > title') || {}).textContent || '').split('\\n')[0] || '').split(' → ');
    const m = p.getScreenCTM();
    if (ends.length !== 2 || !m) { unread.push('an edge whose hover names no two ends'); continue; }
    const points = [...p.points].map((q) => ({ x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f }));
    edges.push({ from: ends[0], to: ends[1], points });
  }
  return { canvas: box(canvas), containers, nodes, edges, unread };
})()`;

// readDrawing reads the drawing on the panel's canvas. The panel must be on
// screen: a document the editor is not showing lays nothing out.
export function readDrawing(doc: WebviewDocument): Promise<Drawing> {
  return evaluateWithin<Drawing>(doc, DRAWING, 5000);
}

// shownDrawing reads the drawing once the panel draws its cards with a size,
// which a panel just brought in front does a moment after it is shown.
export function shownDrawing(doc: WebviewDocument): Promise<Drawing> {
  return until('the drawing laid out on screen', 10000, () => readDrawing(doc), (d) => d.nodes.length > 0 && d.nodes.every((n) => n.card.width > 0));
}

// DrawnText is what one node's lines read, which the document holds whether or
// not the panel is on screen, so a drawing that lands behind another tab can be
// read before the panel is brought back.
export interface DrawnText { id: string; component: string | null }

export function drawnText(doc: WebviewDocument): Promise<DrawnText[]> {
  return evaluateWithin<DrawnText[]>(doc, `[...document.querySelectorAll('#canvas g.node')].map((g) => ({
    id: ((g.querySelector(':scope > text.node-label') || {}).textContent) || '',
    component: g.querySelector(':scope > text.node-sub') ? (g.querySelector(':scope > text.node-sub').textContent || '') : null,
  }))`, 5000);
}

// ---- whether the panel is told it is on screen --------------------------------

// VISIBILITY_OBSERVER is installed in the graph panel's document before the
// panel is put behind another tab or brought back, and records each message
// telling the panel whether it is on screen. The panel frames a drawing still
// owed a frame, or puts the reader's frame back, when it is told it is on
// screen; a listener added after the panel's own is called after it for the
// same message, so once this one has recorded the panel told it is on screen,
// the panel has done that — which the drawing having a size does not show,
// since a document is laid out as soon as it is shown.
const VISIBILITY_OBSERVER = `(() => {
  if (window.__editorSuiteGraphVisibility) { return true; }
  const log = [];
  window.addEventListener('message', (event) => {
    const m = event.data;
    if (m && m.type === 'visibility') { log.push({ at: Date.now(), visible: !!m.visible }); }
  });
  window.__editorSuiteGraphVisibility = log;
  return true;
})()`;

export interface VisibilityReading { at: number; visible: boolean }

// watchVisibility installs the observer, where it is not installed already, and
// returns how many messages it has recorded, as the mark to read after.
export async function watchVisibility(doc: WebviewDocument): Promise<number> {
  await evaluateWithin<boolean>(doc, VISIBILITY_OBSERVER, 5000);
  return (await visibilityReadings(doc)).length;
}

export function visibilityReadings(doc: WebviewDocument, from = 0): Promise<VisibilityReading[]> {
  return evaluateWithin<VisibilityReading[]>(doc, `(window.__editorSuiteGraphVisibility || []).slice(${from})`, 5000);
}

// told waits for the panel to be told, after the mark, that it is on screen or
// that it is not.
export function told(doc: WebviewDocument, from: number, visible: boolean, boundMs = 10000): Promise<VisibilityReading[]> {
  return until(`the graph panel told it is ${visible ? 'on' : 'off'} screen`, boundMs, () => visibilityReadings(doc, from), (v) => v.some((x) => x.visible === visible));
}

// ---- the legend --------------------------------------------------------------

// DrawnLegend is the legend as drawn: whether it is shown, its box, its heading,
// each row's text, the swatch beside it and its box, and its note, with the
// panel's own drawing area, so a row the panel cuts off can be told.
export interface DrawnLegend {
  shown: boolean;
  box: Rect;
  title: string;
  rows: { text: string; drawn: string; swatch: string; box: Rect }[];
  note: string;
  noteBox: Rect;
  view: Rect;
}

const LEGEND = `(() => {
  const l = document.getElementById('legend');
  const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; };
  const none = { x: 0, y: 0, width: 0, height: 0 };
  const note = l.querySelector('.legend-note');
  return {
    shown: !l.classList.contains('hidden') && l.getBoundingClientRect().height > 0,
    box: box(l),
    title: ((l.querySelector('.legend-title') || {}).textContent) || '',
    rows: [...l.querySelectorAll('.legend-row')].map((r) => {
      const t = r.querySelector('.legend-text');
      const s = r.querySelector('.legend-swatch');
      return {
        text: t ? t.textContent || '' : '',
        drawn: t ? (t.innerText || '').trim() : '',
        swatch: s ? ([...s.classList].find((c) => c.startsWith('legend-swatch-')) || '').slice('legend-swatch-'.length) : '',
        box: t ? box(t) : none,
      };
    }),
    note: note ? note.textContent || '' : '',
    noteBox: note ? box(note) : none,
    view: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
  };
})()`;

export function readLegend(doc: WebviewDocument): Promise<DrawnLegend> {
  return evaluateWithin<DrawnLegend>(doc, LEGEND, 5000);
}

// ---- the notice at the panel's top, as it changes ------------------------------

// NOTICE_OBSERVER is installed in the graph panel's document before the action
// it watches. It records every change of the notice at the panel's top, of
// whether the drawing is dimmed, and of how many nodes the drawing holds — so
// the notice a press puts up for a moment before the answer replaces it is
// caught as it is drawn. graphState reads the same three at one moment; this
// keeps every change between two moments.
const NOTICE_OBSERVER = `(() => {
  if (window.__editorSuiteGraphNotice) { return true; }
  const status = document.getElementById('status');
  const canvas = document.getElementById('canvas');
  if (!status || !canvas) { return false; }
  const log = [];
  let last = null;
  const sample = () => {
    const r = {
      text: status.classList.contains('hidden') ? '' : (status.textContent || '').trim(),
      outOfDate: canvas.classList.contains('out-of-date'),
      nodes: canvas.querySelectorAll('g.node').length,
    };
    const k = JSON.stringify(r);
    if (k !== last) { last = k; log.push(Object.assign({ at: Date.now() }, r)); }
  };
  sample();
  new MutationObserver(sample).observe(status, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  new MutationObserver(sample).observe(canvas, { childList: true, attributes: true, attributeFilter: ['class'] });
  window.__editorSuiteGraphNotice = log;
  return true;
})()`;

export interface NoticeReading { at: number; text: string; outOfDate: boolean; nodes: number }

// watchNotice installs the observer, where it is not installed already, and
// returns how many changes it has recorded, as the mark to read after.
export async function watchNotice(doc: WebviewDocument): Promise<number> {
  const installed = await evaluateWithin<boolean>(doc, NOTICE_OBSERVER, 5000);
  if (!installed) { throw new Error('the graph panel\'s document holds no notice and no canvas to watch'); }
  return (await noticeReadings(doc)).length;
}

export function noticeReadings(doc: WebviewDocument, from = 0): Promise<NoticeReading[]> {
  return evaluateWithin<NoticeReading[]>(doc, `(window.__editorSuiteGraphNotice || []).slice(${from})`, 5000);
}

// ---- geometry --------------------------------------------------------------

// The half-pixel the comparisons below allow is the rounding a box picks up on
// its way to the document's coordinates, and nothing more: a shape that spills
// by more than that spills.
const ROUNDING = 0.5;

// contains reports whether `inner` lies wholly inside `outer`.
export function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x - ROUNDING && inner.y >= outer.y - ROUNDING
    && inner.x + inner.width <= outer.x + outer.width + ROUNDING && inner.y + inner.height <= outer.y + outer.height + ROUNDING;
}

// overlaps reports whether two boxes share more than the rounding in both
// directions — an area, not a touching edge.
export function overlaps(a: Rect, b: Rect): boolean {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > ROUNDING && h > ROUNDING;
}

// containsPoint reports whether a point lies inside a box.
export function containsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x - ROUNDING && p.y >= r.y - ROUNDING && p.x <= r.x + r.width + ROUNDING && p.y <= r.y + r.height + ROUNDING;
}

// onBorder reports whether a point lies on a box's edge rather than inside it or
// away from it, which is where an edge meets the card it starts or ends at.
export function onBorder(r: Rect, p: Point): boolean {
  const slack = 2;
  const nearX = p.x >= r.x - slack && p.x <= r.x + r.width + slack;
  const nearY = p.y >= r.y - slack && p.y <= r.y + r.height + slack;
  const atSide = Math.abs(p.x - r.x) <= slack || Math.abs(p.x - (r.x + r.width)) <= slack;
  const atTopOrBottom = Math.abs(p.y - r.y) <= slack || Math.abs(p.y - (r.y + r.height)) <= slack;
  return nearX && nearY && (atSide || atTopOrBottom);
}

// segmentEnters reports whether the segment from p to q runs through the inside
// of a box drawn `inset` in from its border, so a line running along a border or
// meeting a box at its edge does not count as entering it.
export function segmentEnters(p: Point, q: Point, r: Rect, inset = 1): boolean {
  const x0 = r.x + inset;
  const x1 = r.x + r.width - inset;
  const y0 = r.y + inset;
  const y1 = r.y + r.height - inset;
  if (x1 <= x0 || y1 <= y0) { return false; }
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  for (const [along, room] of [[-dx, p.x - x0], [dx, x1 - p.x], [-dy, p.y - y0], [dy, y1 - p.y]]) {
    if (along === 0) {
      if (room < 0) { return false; }
      continue;
    }
    const t = room / along;
    if (along < 0) {
      if (t > t1) { return false; }
      if (t > t0) { t0 = t; }
    } else {
      if (t < t0) { return false; }
      if (t < t1) { t1 = t; }
    }
  }
  return t1 - t0 > 1e-6;
}

// lineEnters reports whether any segment of a drawn line runs through a box.
export function lineEnters(points: readonly Point[], r: Rect, inset = 1): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    if (segmentEnters(points[i], points[i + 1], r, inset)) { return true; }
  }
  return false;
}

// union is the smallest box holding every box given.
export function union(boxes: readonly Rect[]): Rect {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
}

// Framing is how a drawing sits in the canvas: whether every card is inside it,
// the margins its drawn shapes leave on each side, and whether those margins are
// even, which is what a drawing framed whole to the panel shows.
export interface Framing { whole: boolean; outside: string[]; margins: { left: number; right: number; top: number; bottom: number }; centred: boolean }

// CENTRED_WITHIN is how far apart two opposite margins may be for a drawing to
// read as centred: a pixel of rounding on each side.
const CENTRED_WITHIN = 2;

export function framingOf(d: Drawing): Framing {
  const outside = d.nodes.filter((n) => !contains(d.canvas, n.card)).map((n) => n.id);
  const drawn = union([...d.containers.map((c) => c.box), ...d.nodes.map((n) => n.card)]);
  const margins = {
    left: drawn.x - d.canvas.x,
    right: d.canvas.x + d.canvas.width - (drawn.x + drawn.width),
    top: drawn.y - d.canvas.y,
    bottom: d.canvas.y + d.canvas.height - (drawn.y + drawn.height),
  };
  const centred = Math.abs(margins.left - margins.right) <= CENTRED_WITHIN && Math.abs(margins.top - margins.bottom) <= CENTRED_WITHIN;
  return { whole: d.nodes.length > 0 && outside.length === 0, outside, margins, centred };
}

// describeFraming words a framing for a check's report.
export function describeFraming(f: Framing): string {
  const m = f.margins;
  return `${f.whole ? 'every card inside the canvas' : `cards outside the canvas: ${JSON.stringify(f.outside)}`}; margins left ${m.left.toFixed(1)}, right ${m.right.toFixed(1)}, top ${m.top.toFixed(1)}, bottom ${m.bottom.toFixed(1)} (${f.centred ? 'centred' : 'not centred'})`;
}

// rect words a box for a check's report, and the box of a shape the drawing
// does not hold as not drawn.
export function rect(r: Rect | undefined): string {
  return r === undefined ? 'not drawn' : `(${r.x.toFixed(1)}, ${r.y.toFixed(1)}) ${r.width.toFixed(1)}×${r.height.toFixed(1)}`;
}

// sameRect reports whether two boxes are drawn in one place at one size.
export function sameRect(a: Rect, b: Rect): boolean {
  return Math.abs(a.x - b.x) <= ROUNDING && Math.abs(a.y - b.y) <= ROUNDING && Math.abs(a.width - b.width) <= ROUNDING && Math.abs(a.height - b.height) <= ROUNDING;
}
