// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { need } from './checks';
import { Box, WebviewDocument } from './drivers';
import { capture, closeAllEditors, run, SuiteContext } from './suite-context';
import { centre, documentWith, evaluateWithin, sleep, until, within } from './workbench';

// The checks run on the configuration panel in its table shape: each labelled
// heading is the grip its column is resized by, drawn by the editor from style
// rules alone because the panel runs no script; a column dragged wider follows
// the pointer, and dragged narrower stops at its floor; the text of the column
// carrying the longest paths stays inside it; and the row's explanation control
// and the switch to the per-setting shape still work with the grips in place.

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

// How far a grip is dragged wider, and how close to it the column must follow.
const WIDER_PX = 150;
const FOLLOW_TOLERANCE_PX = 12;

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

const px = (n: number): string => `${Math.round(n * 10) / 10} px`;

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
    expected: `Show config draws the table whose labelled headings read ${HEADINGS.join(', ')}, each carrying the resizing rule; dragging the Setting heading's resize control ${WIDER_PX} px to the right widens the column by that much (within ${FOLLOW_TOLERANCE_PX} px), dragging it back past the column's own left edge narrows it to a floor no smaller than its declared minimum, and a second drag further left moves it no more`,
    plant: 'in the scratch copy, media/config.css with the resizing rule taken off the headings',
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
    const before = await column(p, 'Setting');
    await dragGrip(ctx, p, 'Setting', (at) => at.x + at.width - 3 + WIDER_PX);
    const wider = await until('the Setting column widening', 3000, () => column(p, 'Setting'), (x) => x.width > before.width + 1).catch(() => column(p, 'Setting'));
    const shotWider = await capture(ctx, 'config-setting-column-wider');
    await dragGrip(ctx, p, 'Setting', (at) => at.x + 10);
    const floor = await until('the Setting column narrowing', 3000, () => column(p, 'Setting'), (x) => x.width < wider.width - 1).catch(() => column(p, 'Setting'));
    await dragGrip(ctx, p, 'Setting', (at) => at.x + 5);
    const again = await column(p, 'Setting');
    const shotFloor = await capture(ctx, 'config-setting-column-at-its-floor');
    const grew = wider.width - before.width;
    const follows = Math.abs(grew - WIDER_PX) <= FOLLOW_TOLERANCE_PX;
    const narrowed = floor.width < wider.width - WIDER_PX / 2;
    const stops = Math.abs(again.width - floor.width) <= 1;
    const declared = floor.minWidth + floor.padding;
    const aboveMinimum = floor.width >= declared - 1;
    const rule = headings.filter((h) => h.grip).every((h) => h.resize === 'horizontal' && h.overflow === 'hidden');
    return {
      passed: rule && follows && narrowed && stops && aboveMinimum,
      seen: `the labelled headings' computed resize ${JSON.stringify([...new Set(headings.filter((h) => h.grip).map((h) => `${h.resize}/${h.overflow}`))])}; the Setting column ${px(before.width)} with nothing written; dragged ${WIDER_PX} px right it is ${px(wider.width)} (${grew >= 0 ? '+' : ''}${px(grew)}), the width written on the heading "${wider.written}"; dragged past its left edge ${px(floor.width)} ("${floor.written}"), its declared minimum ${px(floor.minWidth)} plus ${px(floor.padding)} of padding; dragged further ${px(again.width)} ("${again.written}"); captures ${shotWider}, ${shotFloor}`,
      evidence: { before, wider, floor, again, headings },
    };
  });

  await c.run('config-panel.source-column-follows-its-grip-and-keeps-its-paths-inside', {
    expected: `on the same table, dragging the Source heading's resize control ${WIDER_PX} px to the right widens the column by that much (within ${FOLLOW_TOLERANCE_PX} px), and dragging it back past its own left edge narrows it; at that width every Source cell's text stays inside its own cell — its content ends at or before the cell's right edge, the cell does not overflow, and the next column starts at or after that edge — wrapping where it is longer than the column`,
    plant: 'in the scratch copy, media/config.css with the resizing rule taken off the headings',
  }, async () => {
    need(panel !== null, 'the configuration panel was not reached above, so there is no Source grip to drag');
    const p = panel as ConfigPanel;
    const cells0 = await p.read<SourceCell[]>(SOURCE_CELLS);
    need(cells0.some((x) => x.text !== ''), 'no row of the table names a source, so there is no path to keep inside the column');
    const longest = cells0.reduce((a, b) => (b.text.length > a.text.length ? b : a)).text;
    const before = await column(p, 'Source');
    await dragGrip(ctx, p, 'Source', (at) => at.x + at.width - 3 + WIDER_PX);
    const wider = await until('the Source column widening', 3000, () => column(p, 'Source'), (x) => x.width > before.width + 1).catch(() => column(p, 'Source'));
    await dragGrip(ctx, p, 'Source', (at) => at.x + 10);
    const narrow = await until('the Source column narrowing', 3000, () => column(p, 'Source'), (x) => x.width < wider.width - 1).catch(() => column(p, 'Source'));
    const cells = await p.read<SourceCell[]>(SOURCE_CELLS);
    const shot = await capture(ctx, 'config-source-column-narrowed');
    const grew = wider.width - before.width;
    const follows = Math.abs(grew - WIDER_PX) <= FOLLOW_TOLERANCE_PX;
    const narrowed = narrow.width < wider.width - WIDER_PX / 2;
    const outside = cells.filter((x) => x.contentRight > x.right + 0.5 || x.scrollWidth > x.clientWidth + 1 || (x.nextLeft !== null && x.nextLeft < x.right - 0.5));
    const wrapped = cells.filter((x) => x.lines > 1).length;
    return {
      passed: follows && narrowed && outside.length === 0,
      seen: `the longest source reads ${JSON.stringify(longest)}; the Source column ${px(before.width)}, dragged ${WIDER_PX} px right ${px(wider.width)} (${grew >= 0 ? '+' : ''}${px(grew)}, written "${wider.written}"), dragged past its left edge ${px(narrow.width)} (written "${narrow.written}"); at that width ${outside.length === 0 ? 'every one' : `${cells.length - outside.length}`} of ${cells.length} Source cells keeps its text inside, ${wrapped} of them wrapped onto more than one line${outside.length > 0 ? `; outside: ${JSON.stringify(outside.slice(0, 3))}` : ''}; capture ${shot}`,
      evidence: { before, wider, narrow, cells },
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
