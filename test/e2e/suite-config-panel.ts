// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { need } from './checks';
import { Box, WebviewDocument } from './drivers';
import { capture, closeAllEditors, run, SuiteContext } from './suite-context';
import { centre, documentWith, evaluateWithin, sleep, standsStill, until, within } from './workbench';

// The checks run on the configuration panel in its table shape: each labelled
// heading is the grip its column is resized by, drawn by the editor from style
// rules alone because the panel runs no script. The table keeps the width the
// page gives it, so a column dragged wider follows the pointer while the other
// columns have room to give, and stops once they are all at their narrowest:
// its room is the table's width less every other column's narrowest, less its
// own. Where the panel is too narrow for the table even at its narrowest —
// docked, say — the grips move nothing, so these checks drag them where the
// panel opens as an editor. A column dragged narrower stops at its floor; the
// text of the column carrying the longest paths stays inside it; and the row's
// explanation control and the switch to the per-setting shape still work with
// the grips in place.

export const CONFIG_PANEL_CHECKS = [
  'config-panel.setting-column-follows-its-grip-and-stops-at-its-floor',
  'config-panel.source-column-follows-its-grip-and-keeps-its-paths-inside',
  'config-panel.explanation-and-shape-switch-work-beside-the-grips',
] as const;

// The words the panel draws that these checks find things by, held as written
// so a change of wording is reported rather than followed: the labelled
// headings in order — each its column's grip — the heading drawn after them
// over the circle, and the switch's words in each shape.
export const HEADINGS = ['Setting', 'Name', 'Value', 'Takes', 'Source'];
export const LAST_HEADING = 'Description';
export const TO_EXPANDED = 'Show each setting in full';
export const TO_TABLE = 'Show every setting in one table';

// FIRST_SETTING_ROW selects the table's first row that draws a setting, which a
// group's heading row is not.
export const FIRST_SETTING_ROW = 'table.config-table tbody tr:not(.config-group-row)';

// How far a grip is dragged, and how near the column must answer. The first
// drag stays inside the column's room — the smaller of WIDER_PX and the room
// less ROOM_MARGIN_PX, so the room's edge cannot cut it short — and the column
// must widen by the drag within FOLLOW_TOLERANCE_PX. A column moving half as far
// as the pointer must miss that by more than the tolerance, which takes a drag
// over twice the tolerance; SHORTEST_DRAG_PX allows a margin over that, and
// where the room allows no drag that long the check says so and is not run,
// rather than passing on a drag too short to judge. The second drag reaches
// PAST_ROOM_PX beyond the room's edge, and the column must then stand at that
// edge and every other column at its narrowest, within AT_EDGE_TOLERANCE_PX.
const WIDER_PX = 150;
const ROOM_MARGIN_PX = 8;
const SHORTEST_DRAG_PX = 30;
const PAST_ROOM_PX = 60;
const FOLLOW_TOLERANCE_PX = 12;
const AT_EDGE_TOLERANCE_PX = 2;

// The edits to the scratch copy that turn both grip checks red, in words.
const GRIP_PLANTS = 'in the scratch copy, media/config.css with the resizing rule taken off the headings, so there is no grip to drag; or with the headings held to a maximum width, so a column stops short of the pointer inside its room';

// ConfigPanel is the panel's document as the runner reaches it.
//
// 🔴 IT IS READ FROM THE FRAME HOSTING IT, NEVER FROM ITS OWN. The panel runs no
// script, and an evaluation made in its own frame is not one the runner can
// rely on an answer to; the editor keeps the host frame on the panel's origin,
// so the host reaches the panel's document and answers for it. Every read is
// bounded, so a read that goes unanswered fails the check that made it rather
// than holding the scenario.
export interface ConfigPanel {
  // read evaluates `body`, an expression over `d`, the panel's document.
  read<T>(body: string): Promise<T>;
  // box is an element's rectangle in the window's coordinates.
  box(selector: string): Promise<Box | null>;
}

export const HOSTED = `((document.getElementById('active-frame') || {}).contentDocument || null)`;
const READ_BOUND_MS = 5000;

export async function configPanel(ctx: SuiteContext, shape: 'table' | 'expanded'): Promise<ConfigPanel> {
  const drawn = shape === 'table'
    ? `(!!d && !!d.querySelector('table.config-table') && !!d.querySelector('a.config-switch-control'))`
    : `(!!d && !d.querySelector('table.config-table') && d.querySelectorAll('dl.config-row').length > 0)`;
  const host: WebviewDocument = await documentWith(ctx.d, `the configuration panel drawn in its ${shape} shape`, `((d) => ${drawn})(${HOSTED})`, 20000);
  return {
    read: <T>(body: string) => evaluateWithin<T>(host, `((d) => (${body}))(${HOSTED})`, READ_BOUND_MS),
    box: async (selector: string) => {
      const frame = await ctx.d.box(host, '#active-frame');
      const r = await evaluateWithin<{ x: number; y: number; width: number; height: number } | null>(host, `((d, s) => {
        const e = d && d.querySelector(s);
        if (!e) { return null; }
        const b = e.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      })(${HOSTED}, ${JSON.stringify(selector)})`, READ_BOUND_MS);
      return frame === null || r === null ? null : { x: frame.x + r.x, y: frame.y + r.y, width: r.width, height: r.height };
    },
  };
}

// Heading is one heading of the table as drawn.
interface Heading { text: string; grip: boolean; resize: string; overflow: string }

const HEADING_STATE = `[...d.querySelectorAll('table.config-table thead th')].map((th) => ({
  text: (th.innerText || '').trim(),
  grip: th.classList.contains('config-column-grip'),
  resize: getComputedStyle(th).resize,
  overflow: getComputedStyle(th).overflowX,
}))`;

// Column is one labelled column as drawn: its heading's box, the width the
// editor wrote on the heading when it was dragged (empty until then), and the
// heading's declared minimum and padding, from which its floor is read.
interface Column { index: number; width: number; left: number; right: number; top: number; bottom: number; written: string; minWidth: number; padding: number }

function columnState(label: string): string {
  return `((label) => {
    const heads = [...d.querySelectorAll('table.config-table thead th')];
    const index = heads.findIndex((th) => (th.innerText || '').trim() === label);
    if (index === -1) { return null; }
    const th = heads[index];
    const b = th.getBoundingClientRect();
    const cs = getComputedStyle(th);
    return {
      index, width: b.width, left: b.left, right: b.right, top: b.top, bottom: b.bottom,
      written: th.style.width || '',
      minWidth: parseFloat(cs.minWidth) || 0,
      padding: (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0),
    };
  })(${JSON.stringify(label)})`;
}

async function column(panel: ConfigPanel, label: string): Promise<Column> {
  const c = await panel.read<Column | null>(columnState(label));
  if (c === null) { throw new Error(`the table draws no "${label}" heading`); }
  return c;
}

// dragGrip presses the pointer on the heading's resize control — the corner the
// editor draws at the heading's right edge — and drags it sideways to `toX`, in
// the window's coordinates. A drag that does not finish is refused with what it
// was doing, rather than holding the scenario.
async function dragGrip(ctx: SuiteContext, panel: ConfigPanel, label: string, toX: (at: Box) => number): Promise<void> {
  const c = await column(panel, label);
  const at = await panel.box(`table.config-table thead th:nth-child(${c.index + 1})`);
  if (at === null) { throw new Error(`the "${label}" heading is not drawn`); }
  const from = { x: at.x + at.width - 3, y: at.y + at.height - 3 };
  const to = { x: toX(at), y: from.y };
  step(ctx, `drag ${label} from ${JSON.stringify(from)} to ${JSON.stringify(to)}`);
  const events = await within(ctx.d.dragAtPace(from, to, 12, 40, 3000), 15000, `the drag of the "${label}" heading's grip from ${Math.round(from.x)} to ${Math.round(to.x)}`);
  step(ctx, `drag ${label} done: ${events.acknowledged} of ${events.sent} events acknowledged`);
}

// step records where the checks have got to, in the scenario's logs, so a check
// that stalls says where.
function step(ctx: SuiteContext, what: string): void {
  fs.appendFileSync(path.join(ctx.s.root.logs, 'config-panel-steps.log'), `${new Date().toISOString()} ${what}\n`);
}

const tenths = (n: number): number => Math.round(n * 10) / 10;
const px = (n: number): string => `${tenths(n)} px`;

// atRest reads a column once a drag has come to rest.
function atRest(panel: ConfigPanel, label: string): Promise<Column> {
  return standsStill(`the ${label} column at rest`, 3000, () => column(panel, label));
}

// Room is what a labelled column has to widen into: the table's width, and each
// column's width as drawn and at its narrowest; the edge, the widest the column
// can be — the table's width less every other column's narrowest; and the room,
// how far that edge is from the column's width now.
interface Room {
  table: number;
  columns: { text: string; width: number; narrowest: number }[];
  index: number;
  edge: number;
  room: number;
}

// TABLE_ROOM reads the table's width and its columns' widths as drawn, then each
// column's narrowest width from a copy of the table laid out at width 0, which
// the table's automatic layout draws with every column as narrow as its cells
// allow. The headings are named from the drawn table: the copy is hidden, and
// hidden text reads as none.
//
// 🔴 THE COPY MOVES NOTHING THE READER SEES. It is inserted, read and removed
// within this one evaluation, so no frame is drawn while it stands; it is
// hidden; and it is fixed to the view, so it adds nothing to the page's
// scrollable area and no scroll position moves with it. The drawn table is read
// before the copy goes in and is never itself changed.
const TABLE_ROOM = `(() => {
  const t = d.querySelector('table.config-table');
  const drawn = [...t.querySelectorAll('thead th')].map((th) => ({ text: (th.innerText || '').trim(), width: th.getBoundingClientRect().width }));
  const table = t.getBoundingClientRect().width;
  const copy = t.cloneNode(true);
  for (const [k, v] of [['position', 'fixed'], ['left', '0'], ['top', '0'], ['width', '0'], ['visibility', 'hidden'], ['pointer-events', 'none']]) { copy.style.setProperty(k, v, 'important'); }
  t.after(copy);
  try {
    const narrowest = [...copy.querySelectorAll('thead th')].map((th) => th.getBoundingClientRect().width);
    return { table, columns: drawn.map((c, i) => ({ ...c, narrowest: narrowest[i] })) };
  } finally {
    copy.remove();
  }
})()`;

async function roomFor(panel: ConfigPanel, label: string): Promise<Room> {
  const r = await panel.read<{ table: number; columns: Room['columns'] }>(TABLE_ROOM);
  const index = r.columns.findIndex((c) => c.text === label);
  if (index === -1) { throw new Error(`the table draws no "${label}" heading`); }
  const edge = r.table - r.columns.reduce((sum, c, i) => (i === index ? sum : sum + c.narrowest), 0);
  return { ...r, index, edge, room: edge - r.columns[index].width };
}

// Stood is the table once a drag has come to rest: its width, and each column's
// width and the width written on its heading.
interface Stood { table: number; widths: number[]; written: string[] }

const STOOD = `(() => {
  const t = d.querySelector('table.config-table');
  const heads = [...t.querySelectorAll('thead th')];
  return { table: t.getBoundingClientRect().width, widths: heads.map((th) => th.getBoundingClientRect().width), written: heads.map((th) => th.style.width || '') };
})()`;

// Widening is a grip dragged right against its column's room: the drag inside
// the room and the column after it, then the drag on past the room's edge and
// the table after that.
interface Widening { room: Room; inside: number; within: Column; past: number; stood: Stood }

async function widen(ctx: SuiteContext, panel: ConfigPanel, label: string): Promise<Widening> {
  const room = await roomFor(panel, label);
  const inside = Math.min(WIDER_PX, room.room - ROOM_MARGIN_PX);
  need(inside >= SHORTEST_DRAG_PX, `the ${label} column, ${px(room.columns[room.index].width)} wide, can widen only to ${px(room.edge)} — the table's ${px(room.table)} less the other columns at their narrowest — so its ${px(room.room)} of room allows no drag of the ${SHORTEST_DRAG_PX} px a follow is measured on`);
  await dragGrip(ctx, panel, label, (at) => at.x + at.width - 3 + inside);
  const within = await atRest(panel, label);
  const past = room.edge - within.width + PAST_ROOM_PX;
  await dragGrip(ctx, panel, label, (at) => at.x + at.width - 3 + past);
  const stood = await standsStill(`the table at rest after the ${label} grip's drag past its room`, 3000, () => panel.read<Stood>(STOOD));
  return { room, inside, within, past, stood };
}

// follows is whether the column widened by the drag inside its room.
function follows(w: Widening): boolean {
  return Math.abs(w.within.width - w.room.columns[w.room.index].width - w.inside) <= FOLLOW_TOLERANCE_PX;
}

// stops is whether, dragged past its room, the column stands at the room's edge
// and every other column at its narrowest.
function stops(w: Widening): boolean {
  return w.stood.widths.every((x, i) => Math.abs(x - (i === w.room.index ? w.room.edge : w.room.columns[i].narrowest)) <= AT_EDGE_TOLERANCE_PX);
}

// widening says what a widening read and did, for a check's seen line.
function widening(label: string, w: Widening): string {
  const before = w.room.columns[w.room.index].width;
  const grew = w.within.width - before;
  return `the table ${px(w.room.table)} wide, its columns at their narrowest ${JSON.stringify(w.room.columns.map((c) => tenths(c.narrowest)))}, so the ${label} column, ${px(before)} wide, has ${px(w.room.room)} of room, to ${px(w.room.edge)}; dragged ${px(w.inside)} right inside it, it is ${px(w.within.width)} (${grew >= 0 ? '+' : ''}${px(grew)}, the width written on the heading "${w.within.written}"); dragged on ${px(w.past)}, ${PAST_ROOM_PX} px past the room's edge, it is ${px(w.stood.widths[w.room.index])} (written "${w.stood.written[w.room.index]}"), the columns ${JSON.stringify(w.stood.widths.map(tenths))} and the table ${px(w.stood.table)}`;
}

// SourceCell is one cell of the Source column as drawn: its box, the box of what
// it holds, the line boxes its text takes, and whether it overflows.
interface SourceCell { text: string; right: number; contentRight: number; lines: number; scrollWidth: number; clientWidth: number; nextLeft: number | null }

const SOURCE_CELLS = `[...d.querySelectorAll('table.config-table tbody td.config-cell-source')].map((td) => {
  const r = td.getBoundingClientRect();
  const range = d.createRange();
  range.selectNodeContents(td);
  const boxes = [...range.getClientRects()];
  const content = range.getBoundingClientRect();
  const next = td.nextElementSibling ? td.nextElementSibling.getBoundingClientRect().left : null;
  return {
    text: (td.innerText || '').trim(),
    right: r.right,
    contentRight: boxes.length === 0 ? r.left : content.right,
    lines: new Set(boxes.map((b) => Math.round(b.top))).size,
    scrollWidth: td.scrollWidth,
    clientWidth: td.clientWidth,
    nextLeft: next,
  };
})`;

export async function configPanelChecks(ctx: SuiteContext): Promise<void> {
  const c = ctx.checks;
  let panel: ConfigPanel | null = null;
  let headings: Heading[] = [];
  await c.run('config-panel.setting-column-follows-its-grip-and-stops-at-its-floor', {
    expected: `Show config draws the table whose labelled headings read ${HEADINGS.join(', ')}, each carrying the resizing rule; the Setting column's room is read — the table's width less every other column's narrowest width, less its own — and allows a drag of at least ${SHORTEST_DRAG_PX} px, or the check is not run; dragging the Setting heading's resize control right inside that room, by the smaller of ${WIDER_PX} px and the room less ${ROOM_MARGIN_PX} px, widens the column by the drag (within ${FOLLOW_TOLERANCE_PX} px); dragging it on to ${PAST_ROOM_PX} px past the room's edge leaves the column at that edge and every other column at its narrowest (within ${AT_EDGE_TOLERANCE_PX} px); dragging it back past the column's own left edge narrows it to its narrowest (within ${AT_EDGE_TOLERANCE_PX} px), no smaller than its declared minimum, and a second drag further left moves it no more`,
    plant: GRIP_PLANTS,
  }, async () => {
    await closeAllEditors(ctx);
    step(ctx, 'open the panel');
    await run(ctx, 'aggrega.config.open');
    step(ctx, 'find its document');
    panel = await configPanel(ctx, 'table');
    step(ctx, 'read its headings');
    headings = await panel.read<Heading[]>(HEADING_STATE);
    const labelled = headings.filter((h) => h.grip).map((h) => h.text);
    need(JSON.stringify(labelled) === JSON.stringify(HEADINGS), `the table's headings carrying the grip read ${JSON.stringify(labelled)}, not ${JSON.stringify(HEADINGS)}, so there is no Setting grip to drag`);
    const p = panel;
    // The grip is pressed where it is drawn, so the table is first let settle:
    // the Setting heading's box read the same twice, 300 ms apart.
    await until('the table\'s layout settling', 10000, async () => {
      const a = await p.box('table.config-table thead th:first-child');
      await sleep(300);
      const b = await p.box('table.config-table thead th:first-child');
      return JSON.stringify(a) === JSON.stringify(b) && a !== null;
    }, (v) => v);
    const w = await widen(ctx, p, 'Setting');
    const shotWider = await capture(ctx, 'config-setting-column-wider');
    await dragGrip(ctx, p, 'Setting', (at) => at.x + 10);
    const floor = await atRest(p, 'Setting');
    await dragGrip(ctx, p, 'Setting', (at) => at.x + 5);
    const again = await atRest(p, 'Setting');
    const shotFloor = await capture(ctx, 'config-setting-column-at-its-floor');
    const narrowest = w.room.columns[w.room.index].narrowest;
    const atNarrowest = Math.abs(floor.width - narrowest) <= AT_EDGE_TOLERANCE_PX;
    const holds = Math.abs(again.width - floor.width) <= 1;
    const declared = floor.minWidth + floor.padding;
    const aboveMinimum = floor.width >= declared - 1;
    const rule = headings.filter((h) => h.grip).every((h) => h.resize === 'horizontal' && h.overflow === 'hidden');
    return {
      passed: rule && follows(w) && stops(w) && atNarrowest && holds && aboveMinimum,
      seen: `the labelled headings' computed resize ${JSON.stringify([...new Set(headings.filter((h) => h.grip).map((h) => `${h.resize}/${h.overflow}`))])}; ${widening('Setting', w)}; dragged past its left edge ${px(floor.width)} ("${floor.written}"), its narrowest ${px(narrowest)}, its declared minimum ${px(floor.minWidth)} plus ${px(floor.padding)} of padding; dragged further ${px(again.width)} ("${again.written}"); captures ${shotWider}, ${shotFloor}`,
      evidence: { widening: w, floor, again, headings },
    };
  });

  await c.run('config-panel.source-column-follows-its-grip-and-keeps-its-paths-inside', {
    expected: `on the same table, the Source column's room is read the same way and allows a drag of at least ${SHORTEST_DRAG_PX} px, or the check is not run; dragging the Source heading's resize control right inside that room widens the column by the drag (within ${FOLLOW_TOLERANCE_PX} px), dragging it on past the room's edge leaves the column at that edge and every other column at its narrowest (within ${AT_EDGE_TOLERANCE_PX} px), and dragging it back past its own left edge narrows it to its narrowest (within ${AT_EDGE_TOLERANCE_PX} px); at that width every Source cell's text stays inside its own cell — its content ends at or before the cell's right edge, the cell does not overflow, and the next column starts at or after that edge — wrapping where it is longer than the column`,
    plant: GRIP_PLANTS,
  }, async () => {
    need(panel !== null, 'the configuration panel was not reached above, so there is no Source grip to drag');
    const p = panel as ConfigPanel;
    const cells0 = await p.read<SourceCell[]>(SOURCE_CELLS);
    need(cells0.some((x) => x.text !== ''), 'no row of the table names a source, so there is no path to keep inside the column');
    const longest = cells0.reduce((a, b) => (b.text.length > a.text.length ? b : a)).text;
    const w = await widen(ctx, p, 'Source');
    await dragGrip(ctx, p, 'Source', (at) => at.x + 10);
    const narrow = await atRest(p, 'Source');
    const cells = await p.read<SourceCell[]>(SOURCE_CELLS);
    const shot = await capture(ctx, 'config-source-column-narrowed');
    const narrowest = w.room.columns[w.room.index].narrowest;
    const atNarrowest = Math.abs(narrow.width - narrowest) <= AT_EDGE_TOLERANCE_PX;
    const outside = cells.filter((x) => x.contentRight > x.right + 0.5 || x.scrollWidth > x.clientWidth + 1 || (x.nextLeft !== null && x.nextLeft < x.right - 0.5));
    const wrapped = cells.filter((x) => x.lines > 1).length;
    return {
      passed: follows(w) && stops(w) && atNarrowest && outside.length === 0,
      seen: `the longest source reads ${JSON.stringify(longest)}; ${widening('Source', w)}; dragged past its left edge ${px(narrow.width)} (written "${narrow.written}"), its narrowest ${px(narrowest)}; at that width ${outside.length === 0 ? 'every one' : `${cells.length - outside.length}`} of ${cells.length} Source cells keeps its text inside, ${wrapped} of them wrapped onto more than one line${outside.length > 0 ? `; outside: ${JSON.stringify(outside.slice(0, 3))}` : ''}; capture ${shot}`,
      evidence: { widening: w, narrow, cells },
    };
  });

  await c.run('config-panel.explanation-and-shape-switch-work-beside-the-grips', {
    expected: `with the widths the reader dragged still standing, pressing the first row's explanation control opens its description, which reads the words the control carries on hover; pressing "${TO_EXPANDED}" redraws the settings in the per-setting shape, with no table; and pressing "${TO_TABLE}" there draws the table again`,
    plant: 'in the scratch copy, out/src/config-view.js with the switch\'s command no longer allowed to run from the panel',
  }, async () => {
    need(panel !== null, 'the configuration panel was not reached above');
    const p = panel as ConfigPanel;
    const control = `${FIRST_SETTING_ROW} td.config-cell-info summary`;
    const summary = await p.box(control);
    need(summary !== null && summary.width > 0, 'the first row draws no explanation control to press');
    await ctx.d.click(centre(summary));
    const opened = await until('the description opening', 5000, () => p.read<{ open: boolean; height: number; text: string; title: string }>(`(() => {
      const det = d.querySelector(${JSON.stringify(`${FIRST_SETTING_ROW} details.config-info`)});
      const para = det ? det.querySelector('.config-description') : null;
      return { open: !!det && det.open, height: para ? para.getBoundingClientRect().height : 0, text: para ? (para.innerText || '').trim() : '', title: det ? (det.querySelector('summary').title || '').trim() : '' };
    })()`), (x) => x.open && x.height > 0).catch(() => null);
    const shotOpen = await capture(ctx, 'config-explanation-open');
    const written = await p.read<string[]>(`[...d.querySelectorAll('table.config-table thead th')].map((th) => th.style.width || '')`);
    const words = await p.read<string>(`((d.querySelector('a.config-switch-control') || {}).innerText || '').trim()`);
    const link = await p.box('a.config-switch-control');
    need(link !== null, 'the panel draws no switch to press');
    await ctx.d.click(centre(link));
    const expanded = await configPanel(ctx, 'expanded').catch(() => null);
    const rows = expanded === null ? 0 : await expanded.read<number>(`d.querySelectorAll('dl.config-row').length`);
    const back = expanded === null ? '' : await expanded.read<string>(`((d.querySelector('a.config-switch-control') || {}).innerText || '').trim()`);
    const shotExpanded = await capture(ctx, 'config-per-setting-shape');
    let table: ConfigPanel | null = null;
    let lost: string[] = [];
    if (expanded !== null) {
      const backLink = await expanded.box('a.config-switch-control');
      if (backLink !== null) { await ctx.d.click(centre(backLink)); }
      table = await configPanel(ctx, 'table').catch(() => null);
      lost = table === null ? [] : await table.read<string[]>(`[...d.querySelectorAll('table.config-table thead th')].map((th) => th.style.width || '')`);
    }
    panel = table;
    const explained = opened !== null && opened.text !== '' && opened.text === opened.title;
    const switched = words === TO_EXPANDED && expanded !== null && rows > 0 && back === TO_TABLE && table !== null;
    return {
      passed: explained && switched,
      seen: `the description ${opened === null ? 'did not open' : `opened, ${px(opened.height)} tall, reading ${JSON.stringify(opened.text.slice(0, 120))} (${opened.text === opened.title ? 'the words the control carries' : `the control carries ${JSON.stringify(opened.title.slice(0, 120))}`})`}, with the widths written on the headings ${JSON.stringify(written)}; the switch read "${words}" and ${expanded === null ? 'pressing it drew no per-setting shape' : `drew the per-setting shape with ${rows} settings and the switch "${back}"`}; ${table === null ? 'the table was not drawn again' : `pressed again, the table was drawn again with the widths written on its headings ${JSON.stringify(lost)}`}; captures ${shotOpen}, ${shotExpanded}`,
    };
  });
  await closeAllEditors(ctx);
}
