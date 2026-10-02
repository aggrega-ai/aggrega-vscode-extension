// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { CACHE_OPERATIONS } from '../../src/operation-groups';
import { need } from './checks';
import {
  ABSENCE_MS, chooseLayout, describeMenu, drawnPanel, DrawnPanel, FOCUS_LOG, focusLog, inWindow, MENU_CONTROLS, menuCommand, MenuOpened, moveContainer, openEverySection, openMenu, openMenuOf,
  PanesAt, placement, pointerOff, restoring, rgb, sameColour, seen, waitMenuClosed, waitMenuOpen,
} from './commands-panel';
import { WebviewDocument } from './drivers';
import { dragSash } from './suite-above';
import { capture, closeAllEditors, ready, SuiteContext } from './suite-context';
import { centre, commandsPanel, holds, pressIn, until } from './workbench';

// The checks run in the gateway folder on the menus a Commands panel button opens
// beside itself: where each menu stands against its button in a panel wide enough
// for a menu to hang from its button's left edge, and with the container docked in
// the secondary side bar a few hundred pixels wide; the mark the button the menu
// belongs to is drawn with while it stands, and every way that mark clears; that
// opening a menu moves nothing; and the same in the section shape.

export const DOCKED_MENUS_CHECKS = [
  'commands-panel.menu-hangs-from-its-buttons-left-edge-where-there-is-room',
  'commands-panel.menus-open-against-their-button-docked-a-few-hundred-pixels-wide',
  'commands-panel.held-button-marked-alone-and-cleared-by-every-close',
  'commands-panel.opening-a-menu-moves-nothing',
  'commands-panel.held-mark-reads-strongly-enough',
  'commands-panel.held-row-marked-in-the-section-shape',
] as const;

// How much wider the side bar is dragged for a panel with room, and what a panel
// "a few hundred pixels wide" is taken to be.
const WIDE_PX = 800;
const DOCKED = { least: 200, most: 400 };

// The part of the window the container is docked in, and the entry under the
// activity bar menu's "Move To" that docks it there, by the words it reads.
const DOCK_PART = 'workbench.parts.auxiliarybar';
const DOCK_ENTRY = 'Secondary Side Bar';

// moved compares where every control stands in two readings of the panel, in the
// document's own coordinates, and names each that moved or changed its border's
// width.
function moved(before: DrawnPanel, after: DrawnPanel): string[] {
  return before.controls.flatMap((b, i) => {
    const a = after.controls[i];
    if (a === undefined || a.command !== b.command) { return [`${b.label || b.command}: not drawn after`]; }
    const shift = Math.max(Math.abs(a.box.x - b.box.x), Math.abs(a.box.y - b.box.y), Math.abs(a.box.width - b.box.width), Math.abs(a.box.height - b.box.height));
    return [
      ...(shift > 0.5 ? [`${b.label || b.command} by ${Math.round(shift * 10) / 10} px`] : []),
      ...(a.borderWidth !== b.borderWidth ? [`${b.label || b.command}'s border ${b.borderWidth} → ${a.borderWidth} px`] : []),
    ];
  });
}

// markIs reads, in one drawing, whether exactly one control is drawn held open —
// the one named — and how it and the rest are drawn.
function markIs(p: DrawnPanel, command: string, background: number[]): { ok: boolean; note: string } {
  const held = p.controls.filter((c) => c.expanded === 'true');
  const opener = p.controls.find((c) => c.command === command);
  const others = p.controls.filter((c) => c.command !== command && c.expanded !== 'true');
  const othersBare = others.every((c) => !seen(c.borderColour) || !sameColour(c.borderColour, p.tokens.focusBorder));
  const ok = held.length === 1 && held[0].command === command && opener !== undefined && sameColour(opener.borderColour, p.tokens.focusBorder) && sameColour(opener.background, background) && othersBare;
  return { ok, note: `held ${JSON.stringify(held.map((c) => c.label || c.command))}; its border ${opener ? rgb(opener.borderColour) : 'none'} against the focus colour ${rgb(p.tokens.focusBorder)}, its ground ${opener ? rgb(opener.background) : 'none'} against ${rgb(background)}; the others' borders ${othersBare ? 'none in the focus colour' : 'some in the focus colour'}` };
}

// markHolds watches the panel over the absence window and reads, at every reading,
// that the control named is the one drawn held and it alone.
async function markHolds(panel: WebviewDocument, command: string, ground: (p: DrawnPanel) => number[]): Promise<{ held: boolean; note: string }> {
  const kept = await holds(ABSENCE_MS, () => drawnPanel(panel), (p) => markIs(p, command, ground(p)).ok);
  return { held: kept.held, note: kept.held ? `the same for ${ABSENCE_MS} ms` : `at ${kept.atMs} ms ${kept.broke === undefined ? '' : markIs(kept.broke, command, ground(kept.broke)).note}` };
}

// cleared reads that no control is drawn held open and none carries the focus
// colour on its border.
function cleared(p: DrawnPanel): boolean {
  return p.controls.every((c) => c.expanded !== 'true' && !(seen(c.borderColour) && sameColour(c.borderColour, p.tokens.focusBorder)));
}

// emptyPoint is a point of the panel, in the window's coordinates, where a press
// lands on no control and not on the open menu — the panel's own ground — or null
// where its view shows none.
async function emptyPoint(ctx: SuiteContext, doc: WebviewDocument): Promise<{ x: number; y: number } | null> {
  const at = await doc.evaluate<{ x: number; y: number } | null>(`(() => {
    const w = document.documentElement.clientWidth;
    const h = window.innerHeight;
    for (let y = h - 4; y > 0; y -= 6) {
      for (let x = w - 4; x > 0; x -= 6) {
        const e = document.elementFromPoint(x, y);
        if (e === null || e.closest('button, a, input, select, summary, [data-focus-key], [data-command], [data-toggle], [data-dials], [data-option], .op-menu')) { continue; }
        return { x, y };
      }
    }
    return null;
  })()`);
  return at === null ? null : inWindow(ctx, doc, at);
}

// focusedEntry is what the panel's document has its focus on, by the choice or the
// command it carries, or its tag where it carries neither.
function focusedEntry(doc: WebviewDocument): Promise<string> {
  return doc.evaluate<string>('(() => { const e = document.activeElement; return e ? (e.dataset.option || e.dataset.command || e.tagName) : ""; })()');
}

// pressable reads whether a person could press a control where it stands now: the
// whole of it inside the panel's view, so reaching it scrolls nothing — a scroll
// puts an open menu away — and nothing drawn over its middle, as an open menu can
// be over a neighbour in a short panel.
async function pressable(doc: WebviewDocument, selector: string): Promise<boolean> {
  return doc.evaluate<boolean>(`((s) => {
    const e = document.querySelector(s);
    if (!e) { return false; }
    const r = e.getBoundingClientRect();
    if (r.top < 0 || r.left < 0 || r.bottom > window.innerHeight || r.right > document.documentElement.clientWidth) { return false; }
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return at !== null && e.contains(at);
  })(${JSON.stringify(selector)})`);
}

export async function dockedMenusChecks(ctx: SuiteContext): Promise<void> {
  const c = ctx.checks;
  await ready(ctx);
  let panel: WebviewDocument = await commandsPanel(ctx.d);
  const close = async (label: string): Promise<void> => {
    await ctx.d.press('Escape');
    await waitMenuClosed(panel, `the ${label} menu closing`);
  };

  // What the comparison "nothing moved" is judged by found when the side bar was
  // widened below — the flow repacking onto fewer lines — for the check that reads
  // that nothing moves.
  let widened: string[] | null = null;

  // ---- a panel with room ----
  await c.run('commands-panel.menu-hangs-from-its-buttons-left-edge-where-there-is-room', {
    expected: `with the side bar dragged ${WIDE_PX} px wider, each of the ${MENU_CONTROLS.map((id) => menuCommand(id).label).join(', ')} menus stands against its button by the rule — beneath it, or above it where there is no room below; its left edge on the button's left edge, pulled in from the panel's right edge — the edge left of the panel's scroll bar — where it would run past it; never narrower than its rows need — and at least one, having the room, hangs from its button's left edge; the side bar is then dragged back where it was`,
    plant: 'in the scratch copy, media/operations.js with every menu placed at the panel\'s left margin whatever its button',
  }, async () => {
    const narrow = await drawnPanel(panel);
    const start = narrow.view.width;
    return restoring(async () => {
      await dragSash(ctx, WIDE_PX);
      await until('the side bar widening', 5000, async () => (await drawnPanel(panel)).view.width, (w) => w > start + WIDE_PX / 2);
      widened = moved(narrow, await drawnPanel(panel));
      const opened: MenuOpened[] = [];
      for (const id of MENU_CONTROLS) {
        opened.push(await openMenuOf(ctx, panel, id));
        await close(menuCommand(id).label);
      }
      const breaks = opened.flatMap((o) => placement(o.menu).breaks.map((b) => `${o.label}: ${b}`));
      const hanging = opened.filter((o) => placement(o.menu).across === 'on the control\'s left edge');
      return { passed: breaks.length === 0 && hanging.length > 0, seen: opened.map((o) => `${o.label}: ${describeMenu(o.menu)}`).join('; ') };
    }, async () => {
      await dragSash(ctx, -WIDE_PX);
      const back = await until('the side bar back where it was', 5000, async () => (await drawnPanel(panel)).view.width, (w) => Math.abs(w - start) < 6).then(() => true, () => false);
      return back ? null : `the side bar was not back at ${start} px within 5 s of being dragged back, so the checks after this one start from another width`;
    });
  });

  // ---- docked ----
  let docked: PanesAt | null = null;
  await c.run('commands-panel.menus-open-against-their-button-docked-a-few-hundred-pixels-wide', {
    expected: `with the container moved by the activity bar's "Move To" to the ${DOCK_ENTRY}, every one of its panels drawn there and the Commands panel ${DOCKED.least} to ${DOCKED.most} px wide, each of the ${MENU_CONTROLS.map((id) => menuCommand(id).label).join(', ')} menus stands against its own button by the same rule — so none runs under the panel's scroll bar — and buttons on different lines open menus at different heights`,
    plant: 'in the scratch copy, media/operations.js with a menu left where its button\'s left edge puts it, past the panel\'s right edge; and with the menu kept inside the window\'s width, the scroll bar counted in — in the script, and in the stylesheet\'s cap',
  }, async () => {
    const at = await moveContainer(ctx, DOCK_ENTRY, DOCK_PART);
    panel = await commandsPanel(ctx.d);
    need(at.width !== null && at.width >= DOCKED.least && at.width <= DOCKED.most, `the container docked in ${at.part} draws the Commands panel ${at.width} px wide, not a few hundred`);
    docked = at;
    const opened: MenuOpened[] = [];
    for (const id of MENU_CONTROLS) {
      opened.push(await openMenuOf(ctx, panel, id));
      await close(menuCommand(id).label);
    }
    const breaks = opened.flatMap((o) => placement(o.menu).breaks.map((b) => `${o.label}: ${b}`));
    // The tie to the button at this width: a menu stands against its own button's
    // line, so two buttons on different lines open at different heights.
    const tops = opened.map((o) => ({ line: Math.round(o.menu.opener?.y ?? 0), top: Math.round(o.menu.box?.y ?? 0) }));
    const distinct = tops.every((a, i) => tops.every((b, j) => i === j || a.line === b.line || a.top !== b.top));
    return { passed: breaks.length === 0 && distinct, seen: `docked in ${at.part}, the panels drawn there reading ${JSON.stringify(at.titles)} top to bottom, the Commands panel ${at.width} px wide; ${opened.map((o) => `${o.label}: ${describeMenu(o.menu)}`).join('; ')}` };
  });

  // ---- the mark ----
  const cache = menuCommand('cache');
  await c.run('commands-panel.held-button-marked-alone-and-cleared-by-every-close', {
    expected: `docked, the button whose menu stands is drawn held — its border in the editor's focus colour on the button's hover ground — and it alone: with one of the ${MENU_CONTROLS.map((id) => menuCommand(id).label).join(', ')} menus open and its button drawn held, pressing another of those buttons that stands in view and uncovered leaves that one the one held, at every reading over ${ABSENCE_MS} ms; the mark clears when the menu closes by Escape, by taking a choice (${cache.label} → ${CACHE_OPERATIONS[0].value}), by a press elsewhere in the panel, on no control, and by a press outside the panel, in the editor area — which closes the menu and leaves the focus out of the panel's document, at every reading over ${ABSENCE_MS} ms; and the panel's own window loses the focus at that press and at no moment before it while the Inspect menu opens, its choices arrive and ArrowDown moves between them, read by one observer installed before the menu opened`,
    plant: 'in the scratch copy, media/operations.js with a closing menu leaving its button drawn held; and with the panel\'s window losing the focus leaving an open menu open',
  }, async () => {
    need(docked !== null, 'the container was not docked above');
    const notes: string[] = [];
    let ok = true;
    // A second button pressed while a first one's menu stands: the first pair, in
    // the panel's order, where the second can be pressed as it stands.
    let pair: { first: string; firstHeld: boolean; second: MenuOpened; alone: { held: boolean; note: string } } | null = null;
    for (const a of MENU_CONTROLS) {
      for (const b of MENU_CONTROLS) {
        if (pair !== null || a === b) { continue; }
        const first = await openMenuOf(ctx, panel, a);
        const selector = `button.op[data-command="${menuCommand(b).command}"]`;
        if (await pressable(panel, selector)) {
          // The control: the same reading finds the first button drawn held before
          // the second is pressed — held, whatever else is, so the second press is
          // shown to have a mark to move.
          const firstHeld = first.after.controls.some((x) => x.command === menuCommand(a).command && x.expanded === 'true' && sameColour(x.borderColour, first.after.tokens.focusBorder));
          const before = await drawnPanel(panel);
          await pressIn(ctx.d, panel, selector);
          const menu = await waitMenuOpen(panel, `the ${menuCommand(b).label} menu standing open with ${first.label}'s closed`);
          await pointerOff(ctx, panel);
          const after = await drawnPanel(panel);
          const alone = await markHolds(panel, menuCommand(b).command, (p) => p.tokens.buttonHover);
          pair = { first: first.label, firstHeld, second: { id: b, label: menuCommand(b).label, before, after, menu }, alone };
        }
        await ctx.d.press('Escape');
        await waitMenuClosed(panel, 'the menu closing');
      }
    }
    if (pair === null) { throw new Error(`with any one of the ${MENU_CONTROLS.join(', ')} menus open, no other of those buttons stands in view and uncovered to be pressed`); }
    need(pair.firstHeld, `its positive control did not fire: with ${pair.first}'s menu open the same reading did not find its button drawn held, so the reading is not shown to see a mark move from one button to the other`);
    const both = markIs(pair.second.after, menuCommand(pair.second.id).command, pair.second.after.tokens.buttonHover);
    ok = ok && both.ok && pair.alone.held && pair.second.menu.marked.length === 1;
    notes.push(`with ${pair.first}'s open and drawn held, ${pair.second.label} pressed: ${both.note}, ${pair.alone.note}`);
    await openMenuOf(ctx, panel, 'inspect');
    await ctx.d.press('Escape');
    const afterEscape = await until('the mark clearing on Escape', 5000, () => drawnPanel(panel), cleared).then(() => true, () => false);
    ok = ok && afterEscape;
    notes.push(`Escape ${afterEscape ? 'cleared it' : 'left it'}`);
    await openMenuOf(ctx, panel, 'cache');
    const option = `.op-menu:not([hidden]) .op-menu-option[data-option="${CACHE_OPERATIONS[0].value}"]`;
    // Pressed where it stands: reaching it by a scroll would put the menu away
    // before the choice is taken.
    if (!(await pressable(panel, option))) { throw new Error(`the ${cache.label} menu's "${CACHE_OPERATIONS[0].value}" choice is not in view and uncovered to be taken`); }
    const choice = await ctx.d.box(panel, option);
    need(choice !== null, `the ${cache.label} menu drew no "${CACHE_OPERATIONS[0].value}" choice to read`);
    await ctx.d.click(centre(choice));
    const afterChoice = await until('the mark clearing on a choice', 5000, () => drawnPanel(panel), cleared).then(() => true, () => false);
    ok = ok && afterChoice;
    notes.push(`taking "${CACHE_OPERATIONS[0].value}" ${afterChoice ? 'cleared it' : 'left it'}`);
    const opened = await openMenuOf(ctx, panel, 'inspect');
    const empty = await emptyPoint(ctx, panel);
    if (empty === null) { throw new Error(`with the ${opened.label} menu open, the panel shows no point that is neither a control nor the menu to press`); }
    await ctx.d.click(empty);
    const afterElsewhere = await until('the mark clearing on a press elsewhere in the panel', 5000, () => drawnPanel(panel), cleared).then(() => true, () => false);
    ok = ok && afterElsewhere && !(await openMenu(panel)).open;
    notes.push(`a press elsewhere in the panel, on no control, ${afterElsewhere ? 'cleared it' : 'left it'}`);
    // A press outside the panel altogether, in the editor area. The panel's
    // document never sees that press; what it sees is its own window losing the
    // focus. So the window's focus is watched from before the menu opens: opening
    // the menu, its choices arriving and the focus moving between them must cost
    // the window nothing, and the press must.
    await panel.evaluate<boolean>(FOCUS_LOG);
    const outsideMenu = await openMenuOf(ctx, panel, 'inspect');
    const firstChoice = await focusedEntry(panel);
    await ctx.d.press('ArrowDown');
    const moved = await until('ArrowDown moving within the menu', 3000, () => focusedEntry(panel), (v) => v !== firstChoice).then(() => true, () => false);
    const beforePress = await focusLog(panel);
    const editor = await ctx.d.box(null, '#workbench\\.parts\\.editor');
    need(editor !== null, 'the editor area is not drawn to press outside the panel');
    await ctx.d.click(centre(editor));
    const shut = await until('the menu closing on a press outside the panel', 5000, () => openMenu(panel), (m) => !m.open && m.marked.length === 0).then(() => true, () => false);
    const left = await holds(ABSENCE_MS, async () => ({ menu: await openMenu(panel), holds: await panel.evaluate<boolean>('document.hasFocus()'), drawn: await drawnPanel(panel) }), (v) => !v.menu.open && !v.holds && cleared(v.drawn));
    const afterPress = (await focusLog(panel)).slice(beforePress.length);
    const lostBefore = beforePress.filter((e) => e.startsWith('blur ')).length;
    const lostAt = afterPress.filter((e) => e.startsWith('blur ')).length;
    need(moved, `the focus did not move within the ${outsideMenu.label} menu on ArrowDown, so moving between its choices was not read`);
    ok = ok && shut && left.held && lostBefore === 0 && lostAt > 0;
    notes.push(`a press in the editor area, outside the panel, ${shut ? 'closed the menu' : 'left the menu open'}${left.held ? `, cleared the mark and left the panel's document without the keyboard for ${ABSENCE_MS} ms` : ` — at ${left.atMs} ms the menu ${left.broke?.menu.open ? 'open' : 'closed'}, the panel ${left.broke?.holds ? 'holding' : 'not holding'} the keyboard, the mark ${left.broke !== undefined && cleared(left.broke.drawn) ? 'cleared' : 'still drawn'}`}; the panel's window lost the focus ${lostBefore} time(s) while the menu opened, filled and was walked (${beforePress.join(' → ') || 'nothing recorded'}) and ${lostAt} time(s) at the press (${afterPress.join(' → ') || 'nothing recorded'})`);
    if ((await openMenu(panel)).open) {
      await pressIn(ctx.d, panel, `button.op[data-command="${menuCommand('inspect').command}"]`);
      await waitMenuClosed(panel, `the ${opened.label} menu closing on its own button`);
    }
    return { passed: ok, seen: notes.join('; ') };
  });

  await c.run('commands-panel.opening-a-menu-moves-nothing', {
    expected: `docked, opening each of the ${MENU_CONTROLS.map((id) => menuCommand(id).label).join(', ')} menus, its button already in view, leaves every control of the panel where it stood and as wide as its border was, at every reading over ${ABSENCE_MS} ms: the mark only changes a colour; the same comparison found the controls moved when the side bar was widened, earlier in this scenario`,
    plant: 'in the scratch copy, media/operations.css with the held button\'s border drawn wider than the one every button keeps',
  }, async () => {
    need(docked !== null, 'the container was not docked above');
    const control = widened as string[] | null;
    need(control !== null && control.length > 0, `its positive control did not fire: the comparison found ${control === null ? 'nothing to compare, the side bar not having been widened above' : 'no control moved when the side bar was widened above'}, so it is not shown to see a control move`);
    const seenMoves: string[] = [];
    let still = true;
    for (const id of MENU_CONTROLS) {
      const o = await openMenuOf(ctx, panel, id);
      const kept = await holds(ABSENCE_MS, async () => moved(o.before, await drawnPanel(panel)), (m) => m.length === 0);
      const first = moved(o.before, o.after);
      still = still && first.length === 0 && kept.held;
      seenMoves.push(`${o.label}: ${first.length === 0 && kept.held ? `nothing moved over ${ABSENCE_MS} ms` : first.length > 0 ? first.join(', ') : `at ${kept.atMs} ms ${(kept.broke ?? []).join(', ')}`}`);
      await close(o.label);
    }
    return { passed: still, seen: `${seenMoves.join('; ')}; the control: widening the side bar moved ${control.length} control(s)` };
  });

  await c.forPerson('commands-panel.held-mark-reads-strongly-enough', {
    expected: 'the mark on the held button reads strongly enough to say which button the menu belongs to, above all where a docked panel pulls the menu to the left of its button',
    plant: 'none: whether the mark reads is the judgement asked for',
    question: 'The capture shows the Push menu open in the docked panel, pulled to the left of its button; the text below says which button is drawn held and how. Does the mark read strongly enough to tell you which button the menu belongs to?',
  }, async () => {
    need(docked !== null, 'the container was not docked above');
    const o = await openMenuOf(ctx, panel, 'push');
    const held = o.after.controls.find((x) => x.expanded === 'true');
    const shot = await capture(ctx, 'held-mark-docked');
    await close(o.label);
    return { screenshot: shot, drawnText: `${describeMenu(o.menu)}; held: ${held ? `${held.label}, border ${rgb(held.borderColour)} on ${rgb(held.background)}` : 'none'}; the other buttons' borders ${JSON.stringify([...new Set(o.after.controls.filter((x) => x !== held).map((x) => rgb(x.borderColour)))])}` };
  });

  await c.run('commands-panel.held-row-marked-in-the-section-shape', {
    expected: `docked, with the panel in its section shape (chosen on the settings screen) and every section open, each of the ${MENU_CONTROLS.map((id) => menuCommand(id).label).join(', ')} rows opens its menu by the same rule, and is drawn held the way that shape marks a row — the border in the focus colour on the list's hover ground — and it alone, at every reading over ${ABSENCE_MS} ms; Escape clears it`,
    plant: 'in the scratch copy, media/operations.css with the held row drawn on no ground of its own in the section shape',
  }, async () => {
    need(docked !== null, 'the container was not docked above');
    await chooseLayout(ctx, 'sections', 'docked-layout-drop-down');
    await closeAllEditors(ctx);
    panel = await commandsPanel(ctx.d);
    await until('the panel drawn as sections', 10000, () => drawnPanel(panel), (p) => p.shape === 'sections');
    await openEverySection(ctx, panel);
    const notes: string[] = [];
    let ok = true;
    for (const id of MENU_CONTROLS) {
      const o = await openMenuOf(ctx, panel, id);
      const breaks = placement(o.menu).breaks;
      const mark = markIs(o.after, menuCommand(id).command, o.after.tokens.listHover);
      const alone = await markHolds(panel, menuCommand(id).command, (p) => p.tokens.listHover);
      await ctx.d.press('Escape');
      const clear = await until(`the ${o.label} row's mark clearing`, 5000, () => drawnPanel(panel), cleared).then(() => true, () => false);
      ok = ok && breaks.length === 0 && mark.ok && alone.held && clear;
      notes.push(`${o.label}: ${describeMenu(o.menu)}; ${mark.note}, ${alone.note}; Escape ${clear ? 'cleared it' : 'left it'}`);
    }
    return { passed: ok, seen: notes.join('; ') };
  });
}
