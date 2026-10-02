// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';

import { RESTART_COMMAND } from '../../src/daemon-status';
import { commandIdFor, commandsPanelOperations, operationHint } from '../../src/operation-groups';
import { NO_RELEASE_SELECTED_CONTROL_REASON } from '../../src/release-selection';
import { need } from './checks';
import { ABSENCE_MS, activeControl, drawnPanel, FOCUS_LOG, focusInPanel, focusLog, ops } from './commands-panel';
import { levelRows } from './levels';
import { closeAllEditors, languageServers, open, ready, send, SuiteContext, theServer } from './suite-context';
import { commandsPanel, guard, holds, RUNNING, STARTING, stated, statusLog, until, waitQuickInput, waitStatus } from './workbench';

// The checks run in a documentation example holding two Releases and naming no
// default, so no Release is selected when it opens: the operations that act on a
// Release drawn in place and greyed with their reason, the arrow keys passing over
// them, a Release chosen bringing them back with nothing restarted, and where
// the focus stands once the panel is drawn again after the choice — back on the
// panel's control for a choice made from the panel, and left in the editor for
// one made from there.

export const NO_RELEASE_CHECKS = [
  'commands-panel.release-operations-greyed-in-place-with-their-reason',
  'commands-panel.arrows-skip-greyed-controls',
  'commands-panel.choosing-a-release-enables-them-without-a-restart',
  'commands-panel.focus-comes-back-to-its-button-after-choosing-a-release',
  'commands-panel.release-chosen-from-elsewhere-leaves-the-focus-where-it-was',
] as const;

// The operations a reader is told are greyed while no Release is selected, by their
// labels, and what the Release row reads then, held as written. They are not read
// from the product's own table of what each operation needs, for the reason the
// Commands panel's groups are not (commands-panel.ts): which operations wait for a
// Release is what a reader is promised, and read from that table a change to it
// would move the expectation with it.
const GREYED = ['Build', 'Preview', 'Graph', 'Pull'];
const NO_RELEASE_ROW = 'none selected';

// The control the focus is left on before a Release is chosen.
const FOCUSED_LABEL = 'Lint';

// How long one press of an arrow key is given to move the focus.
const ARROW_MS = 3000;

// focusReading is where the panel's document has its focus, and whether it holds
// the keyboard at all, for the reading a failure reports.
const focusReading = `(() => { const e = document.activeElement; return (document.hasFocus() ? 'holding the keyboard' : 'not holding the keyboard') + ', its focus on ' + (e ? (e.dataset.command || e.dataset.focusKey || e.tagName) : 'nothing'); })()`;

// workbenchFocus is what the window outside the panel has its focus on.
const workbenchFocus = `(() => { const e = document.activeElement; return e ? e.tagName + (e.className ? '.' + String(e.className).split(' ').slice(0, 2).join('.') : '') : 'nothing'; })()`;

export async function noReleaseChecks(ctx: SuiteContext, releases: readonly string[]): Promise<void> {
  const c = ctx.checks;
  await ready(ctx);
  const panel = await commandsPanel(ctx.d);
  const declared = commandsPanelOperations();

  await c.run('commands-panel.release-operations-greyed-in-place-with-their-reason', {
    expected: `with ${releases.join(' and ')} and no default, the Release row reads "${NO_RELEASE_ROW}", every one of the panel's ${declared.length} operations is still drawn, and ${GREYED.join(', ')} are greyed in place, each one's hover its explanation followed by "— ${NO_RELEASE_SELECTED_CONTROL_REASON}", while every other operation can run`,
    plant: 'in the scratch copy, out/src/operations-render.js with an operation that cannot run left out of the flow rather than greyed in it',
  }, async () => {
    const rows = await until(`the Release row reading "${NO_RELEASE_ROW}"`, 20000, () => levelRows(panel), (r) => r.length >= 3 && r[2].value === NO_RELEASE_ROW).catch(() => levelRows(panel));
    const drawn = ops(await drawnPanel(panel));
    const commands = drawn.map((o) => o.command);
    const all = declared.every((o) => commands.includes(commandIdFor(o))) && drawn.length === declared.length;
    const wrong = drawn.flatMap((o) => {
      const def = declared.find((x) => commandIdFor(x) === o.command);
      if (def === undefined) { return [`${o.label}: not an operation the panel declares`]; }
      if (GREYED.includes(o.label)) {
        const want = operationHint(def, NO_RELEASE_SELECTED_CONTROL_REASON);
        return o.disabled && o.title === want ? [] : [`${o.label}: ${o.disabled ? 'greyed' : 'enabled'}, hover "${o.title}"`];
      }
      return o.disabled ? [`${o.label}: greyed, hover "${o.title}"`] : [];
    });
    return { passed: rows[2]?.value === NO_RELEASE_ROW && all && wrong.length === 0, seen: `the Release row "${rows[2]?.value ?? ''}"; ${drawn.length} operations drawn, ${drawn.filter((o) => o.disabled).map((o) => o.label).join(', ') || 'none'} greyed${wrong.length > 0 ? `; drawn other than expected: ${wrong.join('; ')}` : ''}` };
  });

  await c.run('commands-panel.arrows-skip-greyed-controls', {
    expected: `from the first operation, ArrowRight walks every operation that can run, in the order drawn, passing over each greyed one — each press read once the focus has moved, or after ${ARROW_MS} ms where it has not — and from the last it stays there, at every reading over ${ABSENCE_MS} ms`,
    plant: 'in the scratch copy, media/operations.js with the arrow keys counting a greyed control among the ones they move between',
  }, async () => {
    const drawn = ops(await drawnPanel(panel));
    const runnable = drawn.filter((o) => !o.disabled).map((o) => o.command);
    need(runnable.length > 1 && drawn.some((o) => o.disabled), 'the panel draws no greyed operation beside the runnable ones above');
    await focusInPanel(ctx, panel, `button.op[data-command="${runnable[0]}"]`);
    const walk = [await activeControl(panel)];
    // Every press but the last is owed a move, and the walk records where the focus
    // went, or that it stayed where the press left it.
    for (let i = 1; i < runnable.length; i++) {
      const from = walk[walk.length - 1];
      await ctx.d.press('ArrowRight');
      walk.push(await until('ArrowRight moving the focus', ARROW_MS, () => activeControl(panel), (v) => v !== from).catch(() => activeControl(panel)));
    }
    // From the last, a press is owed no move: watched over the window.
    const last = walk[walk.length - 1];
    await ctx.d.press('ArrowRight');
    const stays = await holds(ABSENCE_MS, () => activeControl(panel), (v) => v === last);
    const passed = JSON.stringify(walk) === JSON.stringify(runnable) && stays.held;
    return { passed, seen: `the walk ${JSON.stringify(walk)}; the operations that can run ${JSON.stringify(runnable)}; from ${JSON.stringify(last)} ArrowRight ${stays.held ? `left the focus there for ${ABSENCE_MS} ms` : `moved it to ${JSON.stringify(stays.broke)} at ${stays.atMs} ms`}` };
  });

  // Where the focus stood once the panel was drawn again after the choice below,
  // for the check after it.
  let afterChoice: { focused: string; want: string; where: string } | null = null;
  await c.run('commands-panel.choosing-a-release-enables-them-without-a-restart', {
    expected: `with the focus on ${FOCUSED_LABEL}, choosing ${releases[0]} from the Release chooser makes ${GREYED.join(', ')} runnable with the same language server process, no "starting" reading and the same window, watched for 2 s; in the same check a restart asked for shows the reading of the process fire`,
    plant: 'in the scratch copy, out/src/release-selection.js with a Release chosen restarting the language server',
  }, async () => {
    const lint = ops(await drawnPanel(panel)).find((o) => o.label === FOCUSED_LABEL);
    if (lint === undefined) { throw new Error(`the panel draws no ${FOCUSED_LABEL} operation`); }
    await focusInPanel(ctx, panel, `button.op[data-command="${lint.command}"]`);
    const srv = await theServer(ctx);
    const statusMark = (await statusLog(ctx.d)).length;
    const hello = await ctx.probe.request<{ instance: string }>('hello');
    // The Release is changed the way a reader whose focus is on a button does it
    // without leaving the keyboard: the chooser opened over the panel, the Release
    // typed into it and taken with Enter.
    await panel.evaluate<boolean>(FOCUS_LOG);
    await send(ctx, 'aggrega.release.select');
    await waitQuickInput(ctx.d, 'the Release chooser', (q) => q.rows.some((r) => r.label === releases[0]), 10000);
    await ctx.d.type(releases[0]);
    // The chooser read once it holds what was typed: its first row is that Release
    // before anything is typed as well.
    await waitQuickInput(ctx.d, `the Release chooser narrowed to ${releases[0]}`, (q) => q.value === releases[0] && q.rows.length > 0 && q.rows[0].label === releases[0], 5000);
    await ctx.d.press('Enter');
    const enabled = await until('the Release operations runnable', 15000, () => drawnPanel(panel), (p) => ops(p).filter((o) => GREYED.includes(o.label)).every((o) => !o.disabled)).then(() => true, () => false);
    const read = async (): Promise<{ pids: number[]; starting: boolean; instance: string }> => ({ pids: languageServers(ctx).map((x) => x.pid), starting: (await statusLog(ctx.d)).slice(statusMark).some((r) => r.reading === STARTING), instance: (await ctx.probe.request<{ instance: string }>('hello')).instance });
    const quiet = await holds(2000, read, (v) => v.pids.length === 1 && v.pids[0] === srv.pid && !v.starting && v.instance === hello.instance);
    const focused = await until(`the focus back on ${FOCUSED_LABEL}`, stated(5000), () => activeControl(panel), (v) => v === lint.command).catch(() => activeControl(panel));
    const where = `the panel ${await panel.evaluate<string>(focusReading)}; the window's focus on ${await ctx.d.workbench<string>(workbenchFocus)}; the panel's focus over the choice: ${(await focusLog(panel)).join(' → ')}`;
    afterChoice = { focused, want: lint.command, where };
    // The control: a restart asked for, read the same way. The server is then owed
    // its running reading back, since every check after this one starts from it.
    await send(ctx, RESTART_COMMAND);
    const next = await theServer(ctx, 30000, srv.pid).then((x) => x.pid, () => null);
    const back = await waitStatus(ctx.d, RUNNING, 60000).then(() => true, () => false);
    need(next !== null, 'its positive control did not fire: the restart asked for gave no new process');
    return { passed: enabled && quiet.held && back, seen: `${GREYED.join(', ')} ${enabled ? 'runnable' : 'still greyed'} after the choice; ${quiet.held ? `process ${srv.pid}, no "starting" reading and the same window for 2 s` : `at ${quiet.atMs} ms ${JSON.stringify(quiet.broke)}`}; the control restarted into process ${next}${back ? ', the status bar reading running again' : `, and the status bar did not read "${RUNNING}" again within ${guard(60000) / 1000} s, so the checks after this one start with no running server`}` };
  });

  await c.run('commands-panel.focus-comes-back-to-its-button-after-choosing-a-release', {
    expected: `with the focus put on ${FOCUSED_LABEL} before the Release was chosen above, the focus is on ${FOCUSED_LABEL} again, in the panel's document holding the keyboard, within 5 s of the panel being drawn again`,
    plant: 'in the scratch copy, out/src/operations.js with the panel never told that the chooser it was under has closed',
  }, async () => {
    const got = afterChoice as { focused: string; want: string; where: string } | null;
    need(got !== null, 'the Release was not chosen above, so the panel was not drawn again under the focus');
    return { passed: got.focused === got.want, seen: `the focus on ${JSON.stringify(got.focused)}, where ${JSON.stringify(got.want)} is owed (${got.where})` };
  });

  await c.run('commands-panel.release-chosen-from-elsewhere-leaves-the-focus-where-it-was', {
    expected: `with ${releases[1]} opened in an editor and the focus in its text, choosing ${releases[1]} from the Release chooser draws the panel again naming it, and the focus is back in that editor's text while the panel's document does not hold the keyboard, at every reading over ${ABSENCE_MS} ms once the panel is drawn again; the same reading of the panel found it holding the keyboard on ${FOCUSED_LABEL} after the choice above, made from the panel`,
    plant: 'in the scratch copy, out/src/operations.js with the panel told to take the focus back after the chooser closes wherever the reader was when it opened',
  }, async () => {
    const back = afterChoice as { focused: string; want: string } | null;
    need(back !== null && back.focused === back.want, `its positive control did not fire: after the choice made from the panel the same reading found the focus on ${JSON.stringify(back?.focused ?? null)}, so it is not shown to see the panel holding the keyboard`);
    const file = path.join(ctx.folder, releases[1]);
    await open(ctx, file);
    const inEditor = `(() => { const e = document.activeElement; return !!e && !!e.closest('.monaco-editor') && !!e.closest('#workbench\\\\.parts\\\\.editor'); })()`;
    await until('the focus in the editor\'s text', 5000, () => ctx.d.workbench<boolean>(inEditor), (v) => v);
    await panel.evaluate<boolean>(FOCUS_LOG);
    await send(ctx, 'aggrega.release.select');
    await waitQuickInput(ctx.d, 'the Release chooser', (q) => q.rows.some((r) => r.label === releases[1]), 10000);
    await ctx.d.type(releases[1]);
    await waitQuickInput(ctx.d, `the Release chooser narrowed to ${releases[1]}`, (q) => q.value === releases[1] && q.rows.length > 0 && q.rows[0].label === releases[1], 5000);
    await ctx.d.press('Enter');
    const rows = await until(`the Release row naming ${releases[1]}`, 15000, () => levelRows(panel), (r) => r[2]?.value === releases[1]).catch(() => levelRows(panel));
    const read = async (): Promise<{ panelHolds: boolean; editorHolds: boolean }> => ({ panelHolds: await panel.evaluate<boolean>('document.hasFocus()'), editorHolds: await ctx.d.workbench<boolean>(inEditor) });
    const kept = await holds(ABSENCE_MS, read, (v) => !v.panelHolds && v.editorHolds);
    const log = await focusLog(panel);
    await closeAllEditors(ctx);
    return {
      passed: rows[2]?.value === releases[1] && kept.held,
      seen: `the Release row "${rows[2]?.value ?? ''}"; ${kept.held ? `the focus in the editor's text and the panel not holding the keyboard for ${ABSENCE_MS} ms` : `at ${kept.atMs} ms ${JSON.stringify(kept.broke)}`}; the panel's focus over the choice: ${log.length === 0 ? 'nothing recorded' : log.join(' → ')}`,
    };
  });
}
