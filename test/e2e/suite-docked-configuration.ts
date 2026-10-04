// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { need } from './checks';
import { framePoint } from './commands-panel';
import { Box } from './drivers';
import { capture, closeAllEditors, ready, run, SuiteContext } from './suite-context';
import { ConfigPanel, configPanel, FIRST_SETTING_ROW } from './suite-config-panel';
import { clearForCapture } from './welcome';
import { centre, guard, until } from './workbench';

// The checks run in the gateway folder on the configuration panel's table, drawn in
// an editor group as narrow as the side bar a panel docks in: the setting column
// held at the left edge as the rest of each row scrolls under it, solid while it
// does, the corner holding in both directions, a setting's description fully in
// view beside the held column, every setting path breaking only after `_` or `.`
// in a column held to its measure under a caption that wraps inside the view, and
// the table scrolling sideways at that width while it fits a wide editor pane.

export const DOCKED_CONFIGURATION_CHECKS = [
  'config-panel.setting-column-stays-at-the-left-edge-scrolling-fully-right',
  'config-panel.setting-column-is-solid-over-the-row-passing-under-it',
  'config-panel.header-and-corner-hold-scrolling-right-and-down',
  'config-panel.description-fully-visible-beside-the-setting-column',
  'config-panel.setting-column-reads-at-its-measure',
  'config-panel.table-scrolls-sideways-docked-and-fits-an-editor-pane',
] as const;

// How far apart two readings of a scroll are taken, and how many steps a full
// scroll is allowed.
const STEP_PX = 60;
const MOST_STEPS = 40;

// TableView is the table as drawn now in the panel's own view: how far the page is
// scrolled and how far it can be, the table's box, the setting column's cells in
// view, the corner, and the heading row.
interface TableView {
  view: { width: number; height: number; scrollLeft: number; scrollTop: number; scrollWidth: number; scrollHeight: number };
  table: { left: number; right: number; top: number; width: number };
  keys: { left: number; right: number; top: number; bottom: number }[];
  corner: { left: number; top: number; right: number; bottom: number };
  headTop: number;
  // widest names what reaches furthest right on the page, and where.
  widest: { what: string; right: number };
}

const TABLE_VIEW = `(() => {
  const se = d.scrollingElement;
  const v = d.defaultView;
  const t = d.querySelector('table.config-table');
  const tb = t.getBoundingClientRect();
  const keys = [...t.querySelectorAll('tbody tr td:first-child')].map((td) => td.getBoundingClientRect())
    .filter((r) => r.bottom > 0 && r.top < v.innerHeight).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
  const c = t.querySelector('thead th:first-child').getBoundingClientRect();
  const h = t.querySelector('thead th:nth-child(2)').getBoundingClientRect();
  let widest = { what: '', right: 0 };
  for (const e of d.querySelectorAll('.config *')) {
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.right > widest.right) { widest = { what: (e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : '')), right: r.right + se.scrollLeft }; }
  }
  return {
    view: { width: se.clientWidth, height: se.clientHeight, scrollLeft: se.scrollLeft, scrollTop: se.scrollTop, scrollWidth: se.scrollWidth, scrollHeight: se.scrollHeight },
    table: { left: tb.left, right: tb.right, top: tb.top, width: tb.width },
    keys,
    corner: { left: c.left, top: c.top, right: c.right, bottom: c.bottom },
    headTop: h.top,
    widest,
  };
})()`;

function tableView(p: ConfigPanel): Promise<TableView> {
  return p.read<TableView>(TABLE_VIEW);
}

// what is at one point of the panel's view: whether the element drawn there is
// inside `selector`'s first match, and what it is.
function drawnAt(p: ConfigPanel, x: number, y: number, selector: string): Promise<{ inside: boolean; what: string }> {
  return p.read<{ inside: boolean; what: string }>(`((x, y, s) => {
    const e = d.elementFromPoint(x, y);
    const target = d.querySelector(s);
    return { inside: !!e && !!target && (e === target || target.contains(e)), what: e ? e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).split(' ')[0] : '') + (e.closest('td, th') ? ' in ' + e.closest('td, th').tagName.toLowerCase() + ':nth-child(' + ([...e.closest('tr').children].indexOf(e.closest('td, th')) + 1) + ')' : '') : 'nothing' };
  })(${x}, ${y}, ${JSON.stringify(selector)})`);
}

// Docked is the panel opened in an editor group as wide as the side bar, read once
// drawn.
interface Docked { panel: ConfigPanel; centre: { x: number; y: number }; sideBar: number; group: number; first: TableView }

// viewCentre is the middle of the panel's view in the window's coordinates.
async function viewCentre(p: ConfigPanel): Promise<{ x: number; y: number }> {
  const body = await p.box('body');
  const own = await p.read<{ x: number; y: number; width: number; height: number }>('(() => { const r = d.body.getBoundingClientRect(); return { x: r.x, y: r.y, width: d.scrollingElement.clientWidth, height: d.scrollingElement.clientHeight }; })()');
  if (body === null) { throw new Error('the configuration panel draws no body'); }
  return framePoint(body, own, { x: own.width / 2, y: own.height / 2 });
}

// scrollBy turns the pointer's wheel over the panel, as a person scrolls it, waits
// for the page to have moved — or to stand at its end, where it cannot — and then
// for it to come to rest, since one turn of the wheel can be drawn over several
// frames and a reading taken at the first of them is taken mid-scroll.
async function scrollBy(ctx: SuiteContext, d: Docked, dx: number, dy: number): Promise<TableView> {
  const before = await tableView(d.panel);
  await ctx.d.moveTo(d.centre);
  await ctx.d.wheel(dx, dy);
  const atEnd = (v: TableView): boolean => (dx > 0 ? v.view.scrollLeft >= v.view.scrollWidth - v.view.width - 0.5 : dx < 0 ? v.view.scrollLeft <= 0.5 : true)
    && (dy > 0 ? v.view.scrollTop >= v.view.scrollHeight - v.view.height - 0.5 : dy < 0 ? v.view.scrollTop <= 0.5 : true);
  await until('the page scrolling', 3000, () => tableView(d.panel), (v) => v.view.scrollLeft !== before.view.scrollLeft || v.view.scrollTop !== before.view.scrollTop || atEnd(v));
  let last: TableView | null = null;
  const rest = await until('the page coming to rest', 3000, async () => {
    const v = await tableView(d.panel);
    const still = last !== null && v.view.scrollLeft === last.view.scrollLeft && v.view.scrollTop === last.view.scrollTop;
    last = v;
    return { v, still };
  }, (r) => r.still, 100);
  return rest.v;
}

export async function dockedConfigurationChecks(ctx: SuiteContext): Promise<void> {
  const c = ctx.checks;
  await ready(ctx);
  await closeAllEditors(ctx);

  // The panel is opened in a second editor group as wide as the side bar, which is
  // the width a docked panel has.
  const widths = await ctx.d.workbench<{ sideBar: number; editor: number }>(`(() => ({ sideBar: document.getElementById('workbench.parts.sidebar').getBoundingClientRect().width, editor: document.getElementById('workbench.parts.editor').getBoundingClientRect().width }))()`);
  await run(ctx, 'vscode.setEditorLayout', [{ orientation: 0, groups: [{ size: widths.editor - widths.sideBar }, { size: widths.sideBar }] }]);
  await run(ctx, 'workbench.action.focusSecondEditorGroup');
  await run(ctx, 'aggrega.config.open');
  const p = await configPanel(ctx, 'table');
  const first = await until('the table laid out', 10000, () => tableView(p), (v) => v.table.width > 0);
  const docked: Docked = { panel: p, centre: await viewCentre(p), sideBar: widths.sideBar, group: first.view.width, first };
  const narrow = docked.group <= docked.sideBar + 1 && docked.group >= docked.sideBar * 0.8;

  await c.run('config-panel.setting-column-stays-at-the-left-edge-scrolling-fully-right', {
    expected: `in a group as wide as the side bar (${Math.round(widths.sideBar)} px), scrolled right ${STEP_PX} px at a time until the page will go no further, the Setting column's cells in view and the corner above them stand where the table starts until the table's own left edge passes the view's, and at the view's left edge from then on, the last step included, so every value reached still has its setting beside it`,
    plant: 'in the scratch copy, media/config.css with the Setting column scrolling away with the rest of its row',
  }, async () => {
    need(narrow, `the panel was opened ${docked.group} px wide against a side bar of ${Math.round(widths.sideBar)} px`);
    const steps: TableView[] = [await scrollBy(ctx, docked, -10000, -10000)];
    for (let i = 0; i < MOST_STEPS; i++) {
      const v = await scrollBy(ctx, docked, STEP_PX, 0);
      steps.push(v);
      if (v.view.scrollLeft >= v.view.scrollWidth - v.view.width - 0.5) { break; }
    }
    // Where the column is to stand at one step: the table's own left edge while it
    // is still in view, the view's left edge once it has passed it.
    const owed = (v: TableView): number => Math.max(0, v.table.left);
    const off = steps.filter((v) => v.keys.some((k) => Math.abs(k.left - owed(v)) > 1) || Math.abs(v.corner.left - owed(v)) > 1);
    const last = steps[steps.length - 1];
    const held = steps.filter((v) => v.table.left < 0);
    const tableEnd = steps.find((v) => v.table.right <= v.view.width + 0.5);
    return {
      passed: off.length === 0 && held.length > 0 && last.table.left < 0 && last.view.scrollLeft >= last.view.scrollWidth - last.view.width - 0.5,
      seen: `${steps.length} readings to ${Math.round(last.view.scrollLeft)} px of ${Math.round(last.view.scrollWidth - last.view.width)} px; the table starting at ${Math.round(steps[0].table.left)} px, its left edge past the view's in ${held.length} of them; the table's own right edge met the view's at ${tableEnd ? `${Math.round(tableEnd.view.scrollLeft)} px` : 'no step'}; ${off.length === 0 ? 'the column where it is owed at every step' : `the column off its place from ${Math.round(off[0].view.scrollLeft)} px on, the corner at ${Math.round(off[0].corner.left)} px where ${Math.round(owed(off[0]))} px is owed`}; what reaches furthest right on the page: ${last.widest.what} to ${Math.round(last.widest.right)} px, the table to ${Math.round(last.table.right + last.view.scrollLeft)} px`,
    };
  });

  await c.run('config-panel.setting-column-is-solid-over-the-row-passing-under-it', {
    expected: 'scrolled right until each row\'s second cell passes under the Setting column, the column\'s cells are painted on a ground of their own — opaque, the page\'s own — and at points across one of them what is drawn is that cell, not the cell passing under it',
    plant: 'in the scratch copy, media/config.css with the Setting column\'s cells painting no ground of their own',
  }, async () => {
    need(narrow, 'the panel was not opened as narrow as the side bar');
    const top = await scrollBy(ctx, docked, -10000, -10000);
    // Down until the table's first rows stand in the view, then right until the
    // second cell of each row has passed under the column, as far again as the
    // table starts from the view's edge.
    if (top.table.top > 20) { await scrollBy(ctx, docked, 0, Math.round(top.table.top) - 20); }
    const shift = await p.read<number>(`(() => { const t = d.querySelector('table.config-table').getBoundingClientRect(); const r = d.querySelector(${JSON.stringify(`${FIRST_SETTING_ROW} td:nth-child(2)`)}).getBoundingClientRect(); const k = d.querySelector(${JSON.stringify(`${FIRST_SETTING_ROW} td:first-child`)}).getBoundingClientRect(); return Math.max(0, t.left) + r.left - k.right + 40; })()`);
    await scrollBy(ctx, docked, Math.max(STEP_PX, Math.round(shift)), 0);
    const read = await p.read<{ key: { left: number; right: number; top: number; bottom: number }; under: { left: number; right: number }; ground: string; page: string } | null>(`(() => {
      const head = d.querySelector('table.config-table thead').getBoundingClientRect();
      const row = [...d.querySelectorAll(${JSON.stringify(FIRST_SETTING_ROW)})].find((r) => { const b = r.getBoundingClientRect(); return b.top >= Math.max(0, head.bottom) && b.bottom < d.defaultView.innerHeight; });
      if (!row) { return null; }
      const k = row.children[0].getBoundingClientRect();
      const u = row.children[1].getBoundingClientRect();
      return { key: { left: k.left, right: k.right, top: k.top, bottom: k.bottom }, under: { left: u.left, right: u.right }, ground: getComputedStyle(row.children[0]).backgroundColor, page: getComputedStyle(d.body).backgroundColor };
    })()`);
    // A row standing whole below the heading row, and its second cell passing under
    // the held column, are the product's drawing at work, so where either is
    // missing the check fails on it rather than standing aside.
    if (read === null) { return { passed: false, seen: 'scrolled down to the table and right, no row of the table stood whole in the view below its heading row to look through' }; }
    if (read.under.left >= read.key.right - 5) { return { passed: false, seen: `scrolled right by ${Math.max(STEP_PX, Math.round(shift))} px, the second cell did not pass under the Setting column: it starts at ${Math.round(read.under.left)} px and the column ends at ${Math.round(read.key.right)} px` }; }
    const y = (read.key.top + read.key.bottom) / 2;
    const xs = [read.key.left + 4, (Math.max(read.key.left, read.under.left) + read.key.right) / 2, read.key.right - 4];
    const points = await Promise.all(xs.map((x) => drawnAt(p, x, y, 'table.config-table tbody')));
    const atKey = await Promise.all(xs.map((x) => p.read<boolean>(`((x, y) => { const e = d.elementFromPoint(x, y); const cell = e ? e.closest('td') : null; return !!cell && cell.cellIndex === 0; })(${x}, ${y})`)));
    const opaque = /^rgb\(/.test(read.ground) || /,\s*1\)$/.test(read.ground);
    return { passed: opaque && read.ground === read.page && atKey.every((v) => v), seen: `the column's ground ${read.ground}, the page's ${read.page}; the second cell ${Math.round(read.key.right - read.under.left)} px under it; drawn at ${xs.map((x) => Math.round(x)).join(', ')} px: ${points.map((q) => q.what).join('; ')}` };
  });

  await c.run('config-panel.header-and-corner-hold-scrolling-right-and-down', {
    expected: 'scrolled right and then down past the table\'s top, the heading row stays at the view\'s top, and the corner — the heading above the Setting column — holds the view\'s top-left corner in both directions, drawn over both the heading sliding under it and the rows',
    plant: 'in the scratch copy, media/config.css with the corner drawn beneath the headings beside it',
  }, async () => {
    need(narrow, 'the panel was not opened as narrow as the side bar');
    await scrollBy(ctx, docked, -10000, -10000);
    await scrollBy(ctx, docked, STEP_PX * 2, 0);
    const v0 = await tableView(p);
    let v = v0;
    for (let i = 0; i < MOST_STEPS && v.table.top > -200; i++) { v = await scrollBy(ctx, docked, 0, 300); }
    if (v.table.top >= -100) { return { passed: false, seen: `scrolled down ${MOST_STEPS} times at most, the page did not go past the table's top (the table at ${Math.round(v.table.top)} px)` }; }
    const cornerAt = { x: (v.corner.left + v.corner.right) / 2, y: (v.corner.top + v.corner.bottom) / 2 };
    const overHeading = await drawnAt(p, v.corner.right - 4, cornerAt.y, 'table.config-table thead th:first-child');
    const overMiddle = await drawnAt(p, cornerAt.x, cornerAt.y, 'table.config-table thead th:first-child');
    const holds = Math.abs(v.corner.left) <= 1 && Math.abs(v.corner.top) <= 1 && Math.abs(v.headTop) <= 1;
    return { passed: holds && overHeading.inside && overMiddle.inside, seen: `scrolled to ${Math.round(v.view.scrollLeft)}, ${Math.round(v.view.scrollTop)} px: the corner at ${Math.round(v.corner.left)}, ${Math.round(v.corner.top)}, the heading row's top at ${Math.round(v.headTop)}; drawn at the corner's middle: ${overMiddle.what}; at its right edge, where the next heading slides: ${overHeading.what}` };
  });

  await c.run('config-panel.description-fully-visible-beside-the-setting-column', {
    expected: 'a setting\'s description, opened with the small circle at the end of its row, can be scrolled to where it stands whole in the view right of the Setting column, with nothing drawn over any part of it',
    plant: 'in the scratch copy, media/config.css with the description held to a fixed measure wider than a docked panel',
  }, async () => {
    need(narrow, 'the panel was not opened as narrow as the side bar');
    await scrollBy(ctx, docked, -10000, -10000);
    const control = `${FIRST_SETTING_ROW} td.config-cell-info summary`;
    const details = `${FIRST_SETTING_ROW} details.config-info`;
    const keyCell = `${FIRST_SETTING_ROW} td:first-child`;
    // Down until the first setting's row stands in view, then sideways until its
    // circle stands clear of the held column and inside the view's right edge.
    const toCircle = async (): Promise<Box | null> => {
      for (let i = 0; i < MOST_STEPS; i++) {
        const at = await p.read<{ top: number; left: number; right: number; keyRight: number; h: number; w: number }>(`(() => { const s = d.querySelector(${JSON.stringify(control)}).getBoundingClientRect(); const k = d.querySelector(${JSON.stringify(keyCell)}).getBoundingClientRect(); return { top: s.top, left: s.left, right: s.right, keyRight: k.right, h: d.scrollingElement.clientHeight, w: d.scrollingElement.clientWidth }; })()`);
        const dx = at.right > at.w - 4 ? Math.ceil(at.right - at.w + 8) : at.left < at.keyRight + 4 ? -Math.ceil(at.keyRight - at.left + 8) : 0;
        const dy = at.top >= at.h - 60 ? 120 : 0;
        if (dx === 0 && dy === 0) { break; }
        await scrollBy(ctx, docked, dx, dy);
      }
      return p.box(control);
    };
    const summary = await toCircle();
    if (summary === null || summary.width === 0) { return { passed: false, seen: 'the first row draws no circle to open its description with' }; }
    await ctx.d.click(centre(summary));
    await until('the description opening', 5000, () => p.read<boolean>(`(() => { const det = d.querySelector(${JSON.stringify(details)}); const para = det ? det.querySelector('.config-description') : null; return !!det && det.open && !!para && para.getBoundingClientRect().height > 0; })()`), (v) => v);
    type Reading = { left: number; right: number; top: number; bottom: number; keyRight: number; viewWidth: number; scrollLeft: number };
    const reading = (): Promise<Reading> => p.read<Reading>(`(() => {
      const para = d.querySelector(${JSON.stringify(`${details} .config-description`)}).getBoundingClientRect();
      const key = d.querySelector(${JSON.stringify(keyCell)}).getBoundingClientRect();
      return { left: para.left, right: para.right, top: para.top, bottom: para.bottom, keyRight: key.right, viewWidth: d.scrollingElement.clientWidth, scrollLeft: d.scrollingElement.scrollLeft };
    })()`);
    // Scrolled until its right edge stands at the view's right edge — the place
    // that leaves the most room between it and the held column — and read there.
    // The room beside the column can be within a pixel of the description's own
    // width, so the scroll is the exact distance rather than a step that can pass
    // over the one place it stands whole.
    const readings: Reading[] = [await reading()];
    for (let i = 0; i < 4; i++) {
      const r = readings[readings.length - 1];
      const by = r.right > r.viewWidth + 0.5 ? Math.ceil(r.right - r.viewWidth) : r.left < r.keyRight - 1 ? -Math.ceil(r.keyRight - r.left) : 0;
      if (by === 0) { break; }
      await scrollBy(ctx, docked, by, 0);
      readings.push(await reading());
    }
    const r = readings[readings.length - 1];
    const inEdges = r.left >= r.keyRight - 1 && r.right <= r.viewWidth + 1;
    const y = (r.top + Math.min(r.bottom, r.top + 60)) / 2;
    const xs = [r.left + 2, (r.left + r.right) / 2, r.right - 2];
    const pts = await Promise.all(xs.map((x) => drawnAt(p, x, y, `${details} .config-description`)));
    const whole = inEdges && pts.every((q) => q.inside);
    // The description is put away again, so the table is read below as it opens;
    // where it stays open the checks after this one would read it open, so this one
    // fails on it.
    await ctx.d.click(centre((await toCircle()) ?? summary));
    const putAway = await until('the description closing', 5000, () => p.read<boolean>(`(() => { const det = d.querySelector(${JSON.stringify(details)}); return !!det && !det.open; })()`), (v) => v).then(() => true, () => false);
    return {
      passed: whole && putAway,
      seen: `the description ${Math.round(r.right - r.left)} px wide, the Setting column ending at ${Math.round(r.keyRight)} px in a view ${r.viewWidth} px wide; scrolled to ${Math.round(r.scrollLeft)} px it stands from ${Math.round(r.left)} to ${Math.round(r.right)} px, ${inEdges ? 'within the view right of the column' : 'not within the view right of the column'}; drawn at ${xs.map((x) => Math.round(x)).join(', ')} px: ${pts.map((q) => q.what).join('; ')}; ${putAway ? 'put away again by its circle' : `not put away again by its circle within ${guard(5000) / 1000} s, so the checks after this one read it open`}`,
    };
  });

  await c.run('config-panel.setting-column-reads-at-its-measure', {
    expected: 'scrolled to its top left, every setting path in the Setting column — a setting\'s, a companion\'s named on its list\'s row, and a group heading\'s — breaks only after `_` or `.`, never between two letters or digits, read character by character from the path\'s own text; the column stands at the measure it is held to, no wider; and the caption above the table wraps inside the view, its words ending left of the view\'s right edge',
    plant: 'in the scratch copy, media/config.css with a setting path allowed to break anywhere; out/src/config-render.js with a path marked nowhere to break; media/config.css with the caption as wide as the table',
  }, async () => {
    need(narrow, 'the panel was not opened as narrow as the side bar');
    await scrollBy(ctx, docked, -10000, -10000);
    await until('the table back at its top', 5000, () => tableView(p), (v) => v.view.scrollLeft === 0 && v.view.scrollTop === 0);
    type PathRead = { key: string; lines: number; breaks: string[] };
    const read = await p.read<{ width: number; measure: number; paths: PathRead[]; caption: { right: number; lines: number }; view: number }>(`(() => {
      const cells = [...d.querySelectorAll('table.config-table tbody tr > :first-child')];
      // Each line break in a path is read from its text alone, character by
      // character: where a character's line box stands lower than the one before
      // it, a line broke between the two, and the pair around that break is kept.
      const read = (code) => {
        const breaks = [];
        const tops = new Set();
        let before = null;
        const walk = d.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n !== null; n = walk.nextNode()) {
          for (let i = 0; i < n.data.length; i++) {
            const r = d.createRange();
            r.setStart(n, i);
            r.setEnd(n, i + 1);
            const b = [...r.getClientRects()].find((x) => x.width > 0);
            if (!b) { continue; }
            const top = Math.round(b.top);
            if (before !== null && top > before.top + 1) { breaks.push(before.ch + n.data[i]); }
            tops.add(top);
            before = { ch: n.data[i], top };
          }
        }
        return { key: (code.textContent || '').trim(), lines: tops.size, breaks };
      };
      const paths = cells.flatMap((cell) => [...cell.querySelectorAll('code')].map(read));
      const first = cells.find((cell) => cell.tagName === 'TD');
      const cs = first ? getComputedStyle(first) : null;
      const cap = d.querySelector('table.config-table caption');
      const range = d.createRange();
      if (cap) { range.selectNodeContents(cap); }
      const capRects = cap ? [...range.getClientRects()].filter((x) => x.width > 0) : [];
      return {
        width: first ? first.getBoundingClientRect().width : 0,
        measure: cs ? (parseFloat(cs.minWidth) || 0) + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0,
        paths,
        caption: { right: capRects.length > 0 ? Math.max(...capRects.map((x) => x.right)) : Infinity, lines: new Set(capRects.map((x) => Math.round(x.top))).size },
        view: d.scrollingElement.clientWidth,
      };
    })()`);
    const midWord = read.paths.flatMap((x) => x.breaks.filter((pair) => !/^[_.]/.test(pair)).map((pair) => `${x.key} at "${pair[0]}|${pair[1]}"`));
    const held = read.width > 0 && read.width <= read.measure + 1;
    const captionIn = read.caption.right <= read.view + 0.5;
    const wrapped = read.paths.filter((x) => x.lines > 1);
    const longest = [...read.paths].sort((a, b) => b.lines - a.lines)[0];
    // The capture is for a person to see the column, so it is taken with the
    // table's top in view and nothing drawn over the panel.
    const top = await tableView(p);
    await scrollBy(ctx, docked, 0, Math.max(0, Math.round(top.table.top) - 20));
    const left = await clearForCapture(ctx);
    const shot = await capture(ctx, 'config-setting-column-docked');
    return {
      passed: read.paths.length > 0 && wrapped.length > 0 && midWord.length === 0 && held && captionIn,
      seen: `the Setting column ${Math.round(read.width)} px wide against its measure of ${Math.round(read.measure)} px; ${read.paths.length} paths drawn in it, ${read.paths.length - wrapped.length} on one line, ${wrapped.filter((x) => x.lines === 2).length} on two, the most ${longest ? `${longest.lines} (${longest.key})` : 'none'}; ${midWord.length === 0 ? `every one of the ${read.paths.reduce((n, x) => n + x.breaks.length, 0)} breaks after "_" or "."` : `breaking inside a word: ${JSON.stringify(midWord.slice(0, 5))}`}; the caption on ${read.caption.lines} line(s), its words ending at ${Math.round(read.caption.right)} px in a view ${read.view} px wide; capture ${shot}${left}\n${read.paths.map((x) => `${x.key}: ${x.lines}`).join('\n')}`,
    };
  });

  await c.run('config-panel.table-scrolls-sideways-docked-and-fits-an-editor-pane', {
    expected: `as it opens, every description put away, the table is wider than a group as wide as the side bar, so it scrolls sideways there; and with the panel's group joined into one taking the whole editor area (${Math.round(widths.editor)} px), it fits, with no sideways scrolling for the table`,
    plant: 'in the scratch copy, media/config.css with the table laid out to the width it is given, squeezing its columns',
  }, async () => {
    need(narrow, 'the panel was not opened as narrow as the side bar');
    const at = docked.first;
    const scrollsDocked = at.table.width > at.view.width + 1;
    const anyOpen = await p.read<number>(`d.querySelectorAll('table.config-table details[open]').length`);
    await run(ctx, 'workbench.action.focusSecondEditorGroup');
    await run(ctx, 'workbench.action.joinAllGroups');
    const wide = await until('the panel drawn across the editor area', 10000, () => tableView(p), (v) => v.view.width > widths.editor * 0.9);
    const fits = wide.table.width <= wide.view.width - Math.max(0, wide.table.left) + 0.5;
    return { passed: scrollsDocked && anyOpen === 0 && fits, seen: `in a group ${at.view.width} px wide the table is ${Math.round(at.table.width)} px; across the editor area, ${wide.view.width} px wide with the table starting at ${Math.round(wide.table.left)} px, it is ${Math.round(wide.table.width)} px${wide.view.scrollWidth > wide.view.width + 1 ? `, the page scrolling ${wide.view.scrollWidth - wide.view.width} px for ${wide.widest.what}` : ', the page not scrolling sideways'}; ${anyOpen} descriptions open` };
  });
  await closeAllEditors(ctx);
}
