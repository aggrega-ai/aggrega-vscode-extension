// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { buildParams } from '../../src/build-dials';
import { outputParentFor } from '../../src/workspace';
import { need } from './checks';
import { WebviewDocument } from './drivers';
import { referenceAnswer } from './reference';
import { capture, closeAllEditors, open, ready, run, SuiteContext } from './suite-context';
import { pressViewAction } from './suite-storefront';
import {
  centre, commandsPanel, dialog, holds, observeWorkbench, operationButtons, pickQuickInputRow, pressDialogButton, pressIn,
  pressOperation, pressPanelAction, quickInput, selectorRows, sleep, toasts, toastsSince, treeRowCentre, treeRows, until,
  waitQuickInput, waitToast,
} from './workbench';

// The checks run in a folder whose Aggrega workspace is the folder above it:
// where a build writes and says it writes, the control that holds the build's
// options, the lockfile a build needs and the option that fills it, and which
// operations still run the compiler as a command.

export const ABOVE_CHECKS = [
  'build-options.control-is-absent-while-build-cannot-run',
  'build-options.removal-moves-nothing-under-the-pointer',
  'build.writes-beneath-the-opened-folder-and-says-where',
  'build-options.control-is-named-build-options',
  'build-options.menu-opens-below-the-chevron-aligned-right',
  'build-options.row-ticks-without-building-and-keeps-the-menu-open',
  'build-options.name-carries-no-count',
  'build-options.menu-closes-on-each-gesture',
  'build-options.keyboard-reaches-the-chevron-after-build',
  'build-options.tick-is-not-kept-across-a-reload',
  'build.missing-lockfile-refusal-offers-the-remedy',
  'build.auto-pull-fills-the-lockfile-then-builds',
  'preview.never-carries-auto-pull',
  'output-channel.command-run-operations-write-a-dollar-line',
  'output-channel.server-operations-write-no-dollar-line',
  'output-channel.prompted-operations-write-no-dollar-line',
] as const;

const RELEASE_FILE = 'release-compose.yaml';

// The control's name, its menu's name, its one row and that row's hover. Each is
// held here as the words a reader is to meet, so a change of wording in the
// extension is a change these checks report rather than follow.
const CONTROL_NAME = 'Build options';
const MENU_NAME = 'Options for the next build';
const ROW_LABEL = 'Auto pull';
const ROW_HOVER = "Auto pull — Resolve the Release's dependencies into the lockfile before rendering, then build against them";

// The remedy notification opens with these words and carries this button.
const LOCKFILE_REMEDY_OPENING = 'Aggrega: lockfile missing.';
const LOCKFILE_REMEDY_BUTTON = 'Generate Lockfile';

const BUILD = 'button.op[data-command="aggrega.op.build"]';
const CARET = '.op-pair button.op-caret';
const MENU = '.op-menu.op-menu-dials';
const ROW = '.op-menu.op-menu-dials button.op-menu-dial';

interface MenuState { open: boolean; label: string; rows: { checked: string | null; icon: string; label: string; text: string; title: string }[]; caret: { title: string; aria: string } | null }

const MENU_STATE = `(() => {
  const m = document.querySelector(${JSON.stringify(MENU)});
  const c = document.querySelector(${JSON.stringify(CARET)});
  return {
    open: !!m && !m.hidden,
    label: m ? m.getAttribute('aria-label') || '' : '',
    rows: m ? [...m.querySelectorAll('button.op-menu-dial')].map((r) => ({
      checked: r.getAttribute('aria-checked'),
      icon: ((r.querySelector('.codicon') || {}).className || ''),
      label: ((r.querySelector('.op-menu-label') || {}).innerText || '').trim(),
      text: (r.innerText || '').trim(),
      title: r.title || '',
    })) : [],
    caret: c ? { title: c.title || '', aria: c.getAttribute('aria-label') || '' } : null,
  };
})()`;

function menuState(doc: WebviewDocument): Promise<MenuState> {
  return doc.evaluate<MenuState>(MENU_STATE);
}

// continueHere answers the dialog the extension raises when the Aggrega
// workspace is a folder above the one opened, if it is raised, and returns it.
async function continueHere(ctx: SuiteContext): Promise<{ message: string; detail: string; buttons: string[] } | null> {
  const d = await until('the workspace-above dialog', 20000, () => dialog(ctx.d), (v) => v !== null).catch(() => null);
  if (d !== null && d.buttons.includes('Continue here')) { await pressDialogButton(ctx.d, 'Continue here'); }
  return d;
}

export async function aboveChecks(ctx: SuiteContext, layout: { root: string; referenceRoot: string }): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  const releaseRel = path.relative(layout.root, path.join(ctx.folder, RELEASE_FILE));
  const lock = path.join(ctx.folder, RELEASE_FILE.replace(/\.yaml$/, '.lock'));
  const aside = `${lock}.aside`;
  const raised = await continueHere(ctx);
  await ready(ctx);
  let panel = await commandsPanel(ctx.d);

  // ---- the control is removed while Build cannot run ----
  let flowBefore: string[] = [];
  let before = '';
  await c.run('build-options.control-is-absent-while-build-cannot-run', {
    expected: 'with no Release selected, Build is greyed and no Build options control is drawn beside it',
    plant: 'in the scratch copy, out/src/operations-render.js made to draw the control whatever Build\'s state',
  }, async () => {
    const rows = await selectorRows(panel);
    const release = rows.find((r) => r.label === 'Release');
    need(release !== undefined && !release.value.endsWith('.yaml'), `a Release is selected at open (${release?.value ?? '?'}), so Build can run from the start`);
    const build = (await operationButtons(panel)).find((b) => b.command === 'aggrega.op.build');
    const caret = await panel.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(CARET)})`);
    flowBefore = (await operationButtons(panel)).map((b) => b.label);
    before = await capture(ctx, 'flow-before-a-release');
    return { passed: build?.disabled === true && !caret, seen: `Release row "${release.value}"; Build ${build?.disabled ? 'greyed' : 'enabled'}; the control ${caret ? 'drawn' : 'absent'}` };
  });

  // Choose this folder's Release, from the workspace above's candidates.
  await pressIn(ctx.d, panel, 'button.selector[data-command="aggrega.release.select"]');
  const picker = await waitQuickInput(ctx.d, 'the Release picker', (q) => q.rows.length > 0);
  await pickQuickInputRow(ctx.d, picker.rows.find((r) => r.text.includes(releaseRel))?.label ?? RELEASE_FILE);
  panel = await commandsPanel(ctx.d);
  await until('the Release row naming this folder\'s Release', 15000, () => selectorRows(panel), (r) => r.some((x) => x.label === 'Release' && x.value === releaseRel)).catch(() => undefined);
  await until('the Build options control being drawn', 10000, () => panel.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(CARET)})`), (v) => v).catch(() => undefined);

  await c.forPerson('build-options.removal-moves-nothing-under-the-pointer', {
    expected: 'removing the control while Build cannot run moves nothing a person is about to press',
    plant: 'none: this is a judgement of the layout',
    question: 'Compare the two captures: before a Release was selected (path below) and after. Did removing the control move anything under the pointer?',
  }, async () => {
    need(before !== '', 'no capture was taken before a Release was selected');
    const after = await operationButtons(panel);
    return { screenshot: await capture(ctx, 'flow-after-a-release'), drawnText: `before (${before}): ${flowBefore.join(' · ')}\nafter: ${after.map((b) => b.label).join(' · ')}` };
  });

  // ---- a build writes beneath the folder opened, and says where ----
  const dist = path.join(ctx.folder, 'dist');
  await c.run('build.writes-beneath-the-opened-folder-and-says-where', {
    expected: `with this folder's Release selected from the Aggrega workspace above (${layout.root}), Build's two closing sentences name ${dist} as the directory, the files are there, and no dist/ appears at the workspace root`,
    plant: 'in the scratch copy, out/src/workspace.js made to send no output parent',
  }, async () => {
    const rows = await selectorRows(panel);
    need(rows.some((r) => r.label === 'Release' && r.value === releaseRel), `the Release row does not name ${releaseRel}`);
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    await pressOperation(ctx.d, panel, 'aggrega.op.build');
    const text = await ctx.out.waitFor('the build closing its report', mark, (t) => /^Build completed: /m.test(t) || /^The build did not complete/m.test(t), 180000);
    const summary = text.split('\n').find((l) => l.startsWith('Build completed: ')) ?? '';
    const t = await waitToast(ctx.d, 'the build\'s notification', toastMark, (x) => x.message.startsWith('Aggrega: built') || x.message.startsWith('The build'), 30000);
    const saysDist = summary.endsWith(` written to ${dist}/`) && t.message.endsWith(` written to ${dist}/.`);
    const files = fs.existsSync(dist) ? fs.readdirSync(dist, { recursive: true }).length : 0;
    const atRoot = fs.existsSync(path.join(layout.root, 'dist'));
    return { passed: saysDist && files > 0 && !atRoot, seen: `the channel: "${summary || text.split('\n').find((l) => l.startsWith('The build')) || ''}"; the notification: "${t.message}"; ${files} entries under ${dist}; dist/ at the root ${atRoot}; the dialog on opening: ${raised ? JSON.stringify(raised.message) : 'not raised'}` };
  });

  // ---- the control and its menu ----
  const menuOpen = async (): Promise<MenuState> => until('the menu opening', 5000, () => menuState(panel), (m) => m.open);
  const menuClosed = async (): Promise<boolean> => until('the menu closing', 3000, () => menuState(panel), (m) => !m.open).then(() => true, () => false);
  await c.run('build-options.control-is-named-build-options', {
    expected: `immediately right of Build, a chevron whose hover and accessible name read "${CONTROL_NAME}"`,
    plant: 'in the scratch copy, out/src/operations-render.js with the control renamed',
  }, async () => {
    const m = await menuState(panel);
    need(m.caret !== null, 'no control is drawn beside Build');
    const b = await ctx.d.box(panel, BUILD);
    const k = await ctx.d.box(panel, CARET);
    const rightOf = b !== null && k !== null && k.x >= b.x + b.width - 1 && Math.abs((k.y + k.height / 2) - (b.y + b.height / 2)) < 4;
    return { passed: m.caret.title === CONTROL_NAME && m.caret.aria === CONTROL_NAME && rightOf, seen: `hover "${m.caret.title}", accessible name "${m.caret.aria}"; ${rightOf ? 'right of Build' : 'not beside Build'}` };
  });
  await c.run('build-options.menu-opens-below-the-chevron-aligned-right', {
    expected: `pressing the chevron opens a menu below it with its right edge in line with the chevron's, named "${MENU_NAME}", holding one row: an empty box and the words "${ROW_LABEL}" and nothing else, whose hover reads "${ROW_HOVER}"; the menu ends just after the words`,
    plant: 'in the scratch copy, media/operations.css with the menu anchored to the chevron\'s left edge',
  }, async () => {
    await pressIn(ctx.d, panel, CARET);
    const m = await menuOpen();
    const k = await ctx.d.box(panel, CARET);
    const box = await ctx.d.box(panel, MENU);
    const label = await ctx.d.box(panel, `${ROW} .op-menu-label`);
    const body = await ctx.d.box(panel, 'body');
    const viewport = await panel.evaluate<number>('innerHeight');
    need(k !== null && box !== null && label !== null && body !== null, 'the menu or the chevron is not drawn');
    // Below the chevron, or above it where the panel leaves no room below.
    const roomBelow = (body.y + viewport) - (k.y + k.height);
    const below = box.y >= k.y + k.height - 1 || (roomBelow < box.height && box.y + box.height <= k.y + 1);
    const aligned = Math.abs((box.x + box.width) - (k.x + k.width)) <= 1;
    const tail = (box.x + box.width) - (label.x + label.width);
    const row = m.rows[0];
    const passed = below && aligned && tail <= 32 && m.label === MENU_NAME && m.rows.length === 1 && row.checked === 'false' && /codicon-blank/.test(row.icon) &&
      row.label === ROW_LABEL && row.text === ROW_LABEL && row.title === ROW_HOVER;
    await ctx.d.press('Escape');
    await menuClosed();
    return { passed, seen: `menu ${below ? 'below (or above, with no room below)' : 'neither below nor above for want of room'} the chevron (menu top ${Math.round(box.y)}, chevron ${Math.round(k.y)}–${Math.round(k.y + k.height)}, room below ${Math.round(roomBelow)} px for a ${Math.round(box.height)} px menu), right edges ${aligned ? 'in line' : `${Math.round(box.x + box.width - k.x - k.width)} px apart`}, ${Math.round(tail)} px after the words; named "${m.label}"; rows ${JSON.stringify(m.rows)}` };
  });
  await c.run('build-options.row-ticks-without-building-and-keeps-the-menu-open', {
    expected: 'pressing the row ticks the box, keeps the menu open, builds nothing (watched for 2 s) and leaves the words where they were; pressing it again empties the box',
    plant: 'in the scratch copy, media/operations.js made to close the menu when a row is pressed',
  }, async () => {
    await pressIn(ctx.d, panel, CARET);
    await menuOpen();
    const labelBefore = await ctx.d.box(panel, `${ROW} .op-menu-label`);
    const mark = ctx.out.mark();
    await pressIn(ctx.d, panel, ROW);
    const ticked = await until('the box ticking', 3000, () => menuState(panel), (m) => m.rows[0]?.checked === 'true');
    const labelAfter = await ctx.d.box(panel, `${ROW} .op-menu-label`);
    const quiet = await holds(2000, async () => ctx.out.since(mark), (t) => !/^Build of /m.test(t));
    await pressIn(ctx.d, panel, ROW);
    const emptied = await until('the box emptying', 3000, () => menuState(panel), (m) => m.rows[0]?.checked === 'false');
    await ctx.d.press('Escape');
    await menuClosed();
    const still = labelBefore !== null && labelAfter !== null && Math.abs(labelBefore.x - labelAfter.x) < 0.5;
    return { passed: ticked.open && /codicon-check/.test(ticked.rows[0].icon) && quiet.held && still && emptied.rows[0].checked === 'false', seen: `ticked: open ${ticked.open}, icon ${ticked.rows[0]?.icon}; nothing built for 2 s ${quiet.held}; the words ${still ? 'stayed' : `moved from ${labelBefore?.x} to ${labelAfter?.x}`}; pressed again: ${emptied.rows[0]?.checked}` };
  });
  await c.run('build-options.name-carries-no-count', {
    expected: `with the box ticked and the menu closed, the chevron's hover still reads "${CONTROL_NAME}", with no count of how many are on`,
    plant: 'in the scratch copy, out/src/operations-render.js with the count appended to the name',
  }, async () => {
    await pressIn(ctx.d, panel, CARET);
    await menuOpen();
    await pressIn(ctx.d, panel, ROW);
    await until('the box ticking', 3000, () => menuState(panel), (m) => m.rows[0]?.checked === 'true');
    await ctx.d.press('Escape');
    await menuClosed();
    const m = await until('the control being drawn again', 5000, () => menuState(panel), (x) => x.caret !== null);
    // Untick, for the checks that follow.
    await pressIn(ctx.d, panel, CARET);
    await menuOpen();
    await pressIn(ctx.d, panel, ROW);
    await until('the box emptying', 3000, () => menuState(panel), (x) => x.rows[0]?.checked === 'false');
    await ctx.d.press('Escape');
    await menuClosed();
    return { passed: m.caret?.title === CONTROL_NAME && m.caret.aria === CONTROL_NAME, seen: `with one ticked: hover "${m.caret?.title}", accessible name "${m.caret?.aria}"` };
  });
  await c.run('build-options.menu-closes-on-each-gesture', {
    expected: 'the open menu closes on a second press of the chevron, on Escape, on Tab, on a click elsewhere — in the panel and outside it — on a resize of the panel, and on a press of Build, which then builds',
    plant: 'in the scratch copy, media/operations.js with the Escape handler removed',
  }, async () => {
    const gestures: [string, () => Promise<void>][] = [
      ['a second press of the chevron', async () => { await pressIn(ctx.d, panel, CARET); }],
      ['Escape', async () => { await ctx.d.press('Escape'); }],
      ['Tab', async () => { await ctx.d.press('Tab'); }],
      ['a click elsewhere in the panel', async () => {
        const rows = await ctx.d.box(panel, '.selectors');
        need(rows !== null, 'the panel\'s context rows are not drawn');
        await ctx.d.click({ x: rows.x + rows.width - 4, y: rows.y + 2 });
      }],
      ['a click outside the panel', async () => {
        const e = await ctx.d.box(null, '#workbench\\.parts\\.editor');
        need(e !== null, 'the editor area is not drawn');
        await ctx.d.click(centre(e));
      }],
      ['a press of Build', async () => { await pressIn(ctx.d, panel, BUILD); }],
      ['a resize of the panel', async () => { await dragSash(ctx, 40); }],
    ];
    const seen: string[] = [];
    let all = true;
    for (const [name, gesture] of gestures) {
      await pressIn(ctx.d, panel, CARET);
      const opened = await menuOpen().then(() => true, () => false);
      const mark = ctx.out.mark();
      await gesture();
      const closed = opened && await menuClosed();
      let note = '';
      if (name === 'a press of Build') {
        const built = await ctx.out.waitFor('the build starting', mark, (t) => /^Build of /m.test(t), 10000).then(() => true, () => false);
        note = built ? ', and it built' : ', and nothing was built';
        all = all && built;
        await ctx.out.waitFor('the build ending', mark, (t) => /^Build completed: |^The build did not complete/m.test(t), 180000).catch(() => undefined);
      }
      seen.push(`${name}: ${opened ? (closed ? 'closed' : 'stayed open') : 'the menu did not open'}${note}`);
      all = all && closed;
      // A menu a gesture left open is closed by its own chevron before the next
      // gesture, so one failure is not carried into the next reading.
      if ((await menuState(panel)).open) {
        await pressIn(ctx.d, panel, CARET);
        await menuClosed();
      }
    }
    // The side bar back to the width it had.
    await dragSash(ctx, -40).catch(() => undefined);
    return { passed: all, seen: seen.join('; ') };
  });
  await c.run('build-options.keyboard-reaches-the-chevron-after-build', {
    expected: 'with the keyboard, the chevron is the next stop after Build in the arrow-key walk, Enter opens its menu, and the arrows move within the open menu',
    plant: 'in the scratch copy, out/src/operations-render.js with the chevron taken out of the walk',
  }, async () => {
    await run(ctx, 'aggrega.operations.focus');
    await sleep(300);
    const focused = await panel.evaluate<boolean>(`(() => { const b = document.querySelector(${JSON.stringify(BUILD)}); if (!b) { return false; } b.focus(); return document.activeElement === b; })()`);
    need(focused, 'Build could not be given the focus');
    await ctx.d.press('ArrowRight');
    const onCaret = await until('the focus reaching the chevron', 3000, () => panel.evaluate<boolean>(`document.activeElement === document.querySelector(${JSON.stringify(CARET)})`), (v) => v).then(() => true, () => false);
    await ctx.d.press('Enter');
    const opened = await menuOpen().then(() => true, () => false);
    await ctx.d.press('ArrowDown');
    const inMenu = await panel.evaluate<boolean>(`!!document.activeElement && !!document.activeElement.closest(${JSON.stringify(MENU)})`);
    await ctx.d.press('Escape');
    await menuClosed();
    return { passed: onCaret && opened && inMenu, seen: `ArrowRight from Build ${onCaret ? 'reached' : 'did not reach'} the chevron; Enter ${opened ? 'opened' : 'did not open'} the menu; after ArrowDown the focus is ${inMenu ? 'in' : 'outside'} the menu` };
  });
  await c.run('build-options.tick-is-not-kept-across-a-reload', {
    expected: 'a ticked option is not kept across a window reload: the box is empty again afterwards',
    plant: 'in the scratch copy, out/src/operations.js made to start every window with Auto pull ticked, as a tick kept across the reload would leave it',
  }, async () => {
    await pressIn(ctx.d, panel, CARET);
    await menuOpen();
    await pressIn(ctx.d, panel, ROW);
    await until('the box ticking', 3000, () => menuState(panel), (m) => m.rows[0]?.checked === 'true');
    await ctx.d.press('Escape');
    const hello = await ctx.probe.request<{ instance: string }>('hello');
    await ctx.probe.request('command.run', { command: 'workbench.action.reloadWindow' }, 3000).catch(() => undefined);
    await ctx.probe.waitHello(60000, hello.instance);
    await observeWorkbench(ctx.d);
    await continueHere(ctx);
    await ready(ctx);
    panel = await commandsPanel(ctx.d);
    await until('the Build options control after the reload', 15000, () => panel.evaluate<boolean>(`!!document.querySelector(${JSON.stringify(CARET)})`), (v) => v);
    await pressIn(ctx.d, panel, CARET);
    const m = await menuOpen();
    await ctx.d.press('Escape');
    await menuClosed();
    return { passed: m.rows[0]?.checked === 'false', seen: `after the reload the box reads ${m.rows[0]?.checked}` };
  });

  // ---- auto pull reaches the build, and never the preview ----
  let refusal = '';
  await c.run('build.missing-lockfile-refusal-offers-the-remedy', {
    expected: `with the lockfile moved aside and the box empty, Build is refused in the compiler's own words for the same request ("The build did not complete: code=<code> <message>") with "Show output", and beside it a notification opening "${LOCKFILE_REMEDY_OPENING}" with a "${LOCKFILE_REMEDY_BUTTON}" button`,
    plant: 'in the scratch copy, out/src/error-surfaces.js made to drop the remedy notification',
  }, async () => {
    need(fs.existsSync(lock), 'the Release has no lockfile to move aside');
    fs.renameSync(lock, aside);
    const params = buildParams(path.relative(layout.referenceRoot, path.join(layout.referenceRoot, releaseRel)), [], outputParentFor(layout.referenceRoot, path.join(layout.referenceRoot, path.relative(layout.root, ctx.folder))));
    const ref = await referenceAnswer({ binary: bin, root: layout.referenceRoot, method: 'aggrega/build', params, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(!ref.ok, 'the compiler built the reference copy although it has no lockfile');
    const words = `code=${ref.error.code} ${ref.error.message}`.split(layout.referenceRoot).join(layout.root);
    const toastMark = (await toasts(ctx.d)).length;
    await pressOperation(ctx.d, panel, 'aggrega.op.build');
    const failed = await waitToast(ctx.d, 'the build\'s refusal', toastMark, (t) => t.message.startsWith('The build did not complete'), 60000);
    refusal = failed.message;
    const remedy = await waitToast(ctx.d, 'the remedy notification', toastMark, (t) => t.message.startsWith(LOCKFILE_REMEDY_OPENING), 5000).catch(() => undefined);
    const channel = ctx.out.text().split('\n').filter((l) => l.includes('[lockfile absent]')).slice(-1)[0] ?? '';
    const passed = failed.message === `The build did not complete: ${words}` && failed.buttons.includes('Show output') && remedy !== undefined && remedy.buttons.includes(LOCKFILE_REMEDY_BUTTON);
    return { passed, seen: `refusal "${failed.message}" with ${JSON.stringify(failed.buttons)}; the compiler's words "${words}"; remedy ${remedy ? `"${remedy.message}" with ${JSON.stringify(remedy.buttons)}` : `not raised${channel ? `; the channel: "${channel}"` : ''}`}` };
  });
  await c.run('build.auto-pull-fills-the-lockfile-then-builds', {
    expected: 'with the box ticked, Build resolves the dependencies first — the channel lists what the resolution did before the files — completes, and the lockfile is back beside the Release',
    plant: 'in the scratch copy, out/src/build-dials.js made to send the option as false',
  }, async () => {
    need(!fs.existsSync(lock), 'the lockfile is not aside, so there is nothing for the option to fill');
    await pressIn(ctx.d, panel, CARET);
    await menuOpen();
    await pressIn(ctx.d, panel, ROW);
    await until('the box ticking', 3000, () => menuState(panel), (m) => m.rows[0]?.checked === 'true');
    await ctx.d.press('Escape');
    const mark = ctx.out.mark();
    await pressOperation(ctx.d, panel, 'aggrega.op.build');
    const text = await ctx.out.waitFor('the build closing its report', mark, (t) => /^Build completed: |^The build did not complete/m.test(t), 180000);
    const lines = text.split('\n');
    const start = lines.findIndex((l) => l.startsWith('Build of '));
    const end = lines.findIndex((l) => l.startsWith('Build completed: '));
    const between = end > start ? lines.slice(start + 1, end) : [];
    const resolution = between.filter((l) => !/^\s+\S+\.ya?ml$/.test(l) && l.trim() !== '');
    return { passed: end !== -1 && fs.existsSync(lock) && resolution.length > 0, seen: `${end !== -1 ? lines[end] : lines.find((l) => l.startsWith('The build')) ?? 'no ending'}; the lockfile ${fs.existsSync(lock) ? 'is back' : 'is not back'}; before the files: ${JSON.stringify(resolution.slice(0, 4))}` };
  });
  await c.run('preview.never-carries-auto-pull', {
    expected: 'with the box still ticked and the lockfile moved aside again, Preview is refused with the same lockfile refusal an unticked build gets, and nothing refuses the combination of a preview and a pull',
    plant: 'in the scratch copy, out/src/build-dials.js made to send Auto pull with the preview',
  }, async () => {
    need(refusal !== '', 'the unticked build gave no refusal to compare with');
    need(fs.existsSync(lock), 'the lockfile is not back after the ticked build');
    fs.renameSync(lock, aside);
    const toastMark = (await toasts(ctx.d)).length;
    await pressOperation(ctx.d, panel, 'aggrega.op.preview');
    const failed = await waitToast(ctx.d, 'the preview\'s refusal', toastMark, (t) => t.message.startsWith('The preview'), 60000);
    const same = failed.message.replace(/^The preview/, 'The build') === refusal;
    const combination = (await toastsSince(ctx.d, toastMark)).some((t) => /dry.?run|combin|auto.?pull/i.test(t.message));
    return { passed: same && !combination, seen: `"${failed.message}"; ${same ? 'the same words as the build\'s refusal' : `the build's was "${refusal}"`}; a refusal about the combination ${combination}` };
  });
  // The lockfile back, as a person puts it back.
  if (!fs.existsSync(lock) && fs.existsSync(aside)) { fs.renameSync(aside, lock); }
  await pressIn(ctx.d, panel, CARET).catch(() => undefined);
  const st = await menuState(panel);
  if (st.open && st.rows[0]?.checked === 'true') { await pressIn(ctx.d, panel, ROW); }
  await ctx.d.press('Escape');

  // ---- which operations still run the compiler as a command ----
  const dollar = (text: string): string[] => text.split('\n').filter((l) => l.startsWith('$ '));
  const dollarShape = (l: string): boolean => l.startsWith(`$ ${bin} `) && l.trimEnd().endsWith(`(cwd: ${layout.root})`);
  let control = false;
  await c.run('output-channel.command-run-operations-write-a-dollar-line', {
    expected: `Pull, a catalog row's "Validate this entity" and Generate entities each write a line beginning "$" — the binary, the arguments and "(cwd: ${layout.root})" — before their output; the plugin list behind the Plugins panel writes none`,
    plant: 'in the scratch copy, out/src/cli-operation.js with the command line no longer written',
  }, async () => {
    const seen: string[] = [];
    let all = true;
    const mark1 = ctx.out.mark();
    await pressOperation(ctx.d, panel, 'aggrega.op.pull');
    const pulled = await ctx.out.waitFor('the pull ending', mark1, (t) => /^The pull /m.test(t), 120000).catch(() => ctx.out.since(mark1));
    const pullLine = dollar(pulled).find((l) => l.includes(' pull '));
    seen.push(`Pull: ${pullLine ?? 'no $ line'}`);
    all = all && pullLine !== undefined && dollarShape(pullLine);
    control = pullLine !== undefined;
    // A catalog row's context menu.
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    const rows = await until('the Catalog view drawing an entity row', 20000, () => treeRows(ctx.d, 'Catalog'), (v) => v !== null && v.some((r) => r.level === 2));
    // The first entity row whose context menu offers the operation: it is
    // offered on a row whose entity has a document of its own.
    const item = '.context-view .action-label[aria-label="Validate this entity"]';
    let entity: { label: string } | undefined;
    const tried: string[] = [];
    for (const r of (rows ?? []).filter((x) => x.level === 2).slice(0, 6)) {
      const at = await treeRowCentre(ctx.d, 'Catalog', r.label);
      if (at === null) { continue; }
      await ctx.d.click(at, 'right');
      const offered = await until('the row\'s context menu', 3000, () => ctx.d.workbench<string[]>(`[...document.querySelectorAll('.context-view .action-label[aria-label]')].map((e) => e.getAttribute('aria-label'))`), (v) => v.length > 0).catch(() => [] as string[]);
      tried.push(`${r.label}: ${JSON.stringify(offered)}`);
      if (offered.includes('Validate this entity')) { entity = r; break; }
      await ctx.d.press('Escape');
    }
    need(entity !== undefined, `no Catalog row's context menu offers "Validate this entity": ${tried.join('; ')}`);
    const mark2 = ctx.out.mark();
    const toastMark2 = (await toasts(ctx.d)).length;
    // The editor's context menu can let a click that lands as it finishes
    // opening go by, and then nothing runs at all. So the pointer rests on the
    // item first, and a menu still open after the click is taken by Enter, as a
    // reader takes it from the keyboard; what the check judges is what the
    // operation writes, not whether one click landed.
    const itemBox = await ctx.d.box(null, item);
    need(itemBox !== null, 'the context menu draws no "Validate this entity" item to press');
    await ctx.d.moveTo(centre(itemBox));
    await sleep(300);
    await ctx.d.click(centre(itemBox));
    const menuGone = (): Promise<boolean> => ctx.d.workbench<boolean>(`!document.querySelector('.context-view .monaco-menu')`);
    const tookByPointer = await until('the context menu closing on the press', 3000, menuGone, (v) => v).then(() => true, () => false);
    if (!tookByPointer) { await ctx.d.press('Enter'); }
    const validated = await ctx.out.waitFor('the entity validation writing to the channel', mark2, (t) => dollar(t).length > 0, 20000).catch(() => ctx.out.since(mark2));
    const validateLine = dollar(validated)[0];
    const told = (await toastsSince(ctx.d, toastMark2)).map((t) => t.message);
    const wrote = validated.split('\n').filter((l) => l.trim() !== '').slice(0, 4);
    seen.push(`Validate this entity (${entity.label}, taken ${tookByPointer ? 'by the pointer' : 'by Enter, the pointer\'s press having left the menu open'}): ${validateLine ?? `no $ line; the channel ${JSON.stringify(wrote)}; notifications ${JSON.stringify(told)}`}`);
    all = all && validateLine !== undefined && dollarShape(validateLine);
    // Generate entities, for real, into an empty directory.
    const overlays = path.join(ctx.s.root.dir, 'generate', 'overlays');
    const outDir = path.join(ctx.s.root.dir, 'generate', 'out');
    fs.mkdirSync(overlays, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });
    const generated = await generateEntities(ctx, overlays, outDir).catch((err: unknown) => `stopped: ${err instanceof Error ? err.message : String(err)}`);
    seen.push(`Generate entities: ${generated}`);
    all = all && generated.startsWith('$ ') && dollarShape(generated);
    // The plugin list.
    await run(ctx, 'workbench.view.extension.aggrega');
    const mark3 = ctx.out.mark();
    await pressViewAction(ctx, 'Plugins', 'Refresh plugins');
    const quiet = await holds(4000, async () => ctx.out.since(mark3), (t) => dollar(t).length === 0);
    seen.push(`the plugin list: ${quiet.held ? 'no $ line (watched 4 s)' : 'a $ line'}`);
    all = all && quiet.held;
    return { passed: all, seen: seen.join('; ') };
  });
  await c.run('output-channel.server-operations-write-no-dollar-line', {
    expected: 'Build, Preview, Lint, Validate, Show config and Search catalog each write no line beginning "$" (each watched to its ending, or for 5 s); the Pull line in the same scenario shows the observation fires',
    plant: 'in the scratch copy, out/src/operations.js made to write a command line before a build\'s report, as an operation run as a command does',
  }, async () => {
    need(control, 'its positive control did not fire: no $ line was recorded for Pull in this scenario');
    await open(ctx, path.join(ctx.folder, RELEASE_FILE));
    const seen: string[] = [];
    let all = true;
    // Each operation's ending is the notification it closes on; the two with
    // none are watched for 5 s. Each is pressed where it is drawn: the first
    // five on the Commands panel, the search at the head of the Catalog panel.
    const ops: [string, string, RegExp | null][] = [
      ['Build', 'aggrega.op.build', /^Aggrega: built |^The build /],
      ['Preview', 'aggrega.op.preview', /^Aggrega: a build of |^The preview /],
      ['Lint', 'aggrega.op.lint', /^Aggrega lint: /],
      ['Validate', 'aggrega.op.validate', /^Aggrega: validated |^The validation /],
      ['Show config', 'aggrega.config.open', null],
      ['Search catalog', 'aggrega.catalog.searchPublished', null],
    ];
    for (const [name, command, ending] of ops) {
      const mark = ctx.out.mark();
      const toastMark = (await toasts(ctx.d)).length;
      if (command === 'aggrega.catalog.searchPublished') {
        await run(ctx, 'aggrega.workspaceCatalog.focus');
        await pressPanelAction(ctx.d, 'Catalog', name);
        await waitQuickInput(ctx.d, 'the search palette', (q) => q.rows.length > 0).then(() => pickQuickInputRow(ctx.d, 'Search')).catch(() => undefined);
      } else {
        panel = await commandsPanel(ctx.d);
        await pressOperation(ctx.d, panel, command);
      }
      if (ending !== null) { await waitToast(ctx.d, `${name} ending`, toastMark, (t) => ending.test(t.message), 60000).catch(() => undefined); }
      await sleep(ending === null ? 5000 : 500);
      const lines = dollar(ctx.out.since(mark));
      seen.push(`${name}: ${lines.length === 0 ? 'none' : lines.join(' | ')}`);
      all = all && lines.length === 0;
      await closeAllEditors(ctx);
      await ctx.d.press('Escape');
    }
    return { passed: all, seen: seen.join('; ') };
  });
  c.notRun('output-channel.prompted-operations-write-no-dollar-line', {
    expected: 'Draft entity, Import, Inspect, Push, Sign, Deprecate, the cache operations, Add registry, Update index, Add plugin and the list panels\' row operations other than Validate this entity each write no line beginning "$"',
    plant: 'in the scratch copy, out/src/operations.js with Inspect run as a command instead of a request',
  }, 'each of them asks for an answer — a kind, a source, an entity, a reference, a registry or a confirmation — before it sends anything, and answering each so that it runs is a walk of its own these checks do not make');
}

// dragSash resizes the side bar by dragging the sash at its edge by `dx`.
async function dragSash(ctx: SuiteContext, dx: number): Promise<void> {
  const sash = await ctx.d.workbench<{ x: number; y: number } | null>(`(() => {
    const sb = document.getElementById('workbench.parts.sidebar').getBoundingClientRect();
    const s = [...document.querySelectorAll('.monaco-sash.vertical')].map((e) => e.getBoundingClientRect()).find((r) => r.height > 100 && Math.abs((r.x + r.width / 2) - sb.right) < 6);
    return s ? { x: s.x + s.width / 2, y: s.y + s.height / 2 } : null;
  })()`);
  need(sash !== null, 'no sash at the side bar\'s edge');
  await ctx.d.drag(sash, { x: sash.x + dx, y: sash.y }, 6);
  await sleep(500);
}

// The row at the head of the Plugins panel that generates Plugin entities, and
// the choice of what a run covers, by the words each reads.
const GENERATE_ROW_LABEL = 'Generate entities';
const EVERY_EMBEDDED_PLUGIN = 'Every plugin built into the compiler';

// generateEntities runs Generate entities for real, pressed where it is drawn —
// the head of the Plugins panel: every plugin built into the compiler, chosen
// from the list the press opens, the given overlay directory, the given output
// directory, and the confirmation answered Write. It returns the $ line it
// wrote.
async function generateEntities(ctx: SuiteContext, overlays: string, outDir: string): Promise<string> {
  const mark = ctx.out.mark();
  await run(ctx, 'aggrega.plugins.focus');
  await pressPanelAction(ctx.d, 'Plugins', GENERATE_ROW_LABEL);
  await waitQuickInput(ctx.d, 'the choice of what the generation covers', (q) => q.rows.some((r) => r.label === EVERY_EMBEDDED_PLUGIN), 15000);
  await pickQuickInputRow(ctx.d, EVERY_EMBEDDED_PLUGIN);
  // The choice is itself a list titled as the dialogs after it are, so it is
  // seen to close before the first dialog is looked for — otherwise the wait
  // below could take the closing list for the dialog and type into it.
  await until('the choice of what the generation covers closing', 5000, () => quickInput(ctx.d),
    (q) => q === null || !q.rows.some((r) => r.label === EVERY_EMBEDDED_PLUGIN));
  for (const [what, dir] of [['the overlay directory', overlays], ['the output directory', outDir]] as const) {
    await waitQuickInput(ctx.d, `the dialog for ${what}`, (q) => q.title !== '' && q.title.startsWith('Aggrega:'), 15000);
    await ctx.d.press('Control+a');
    await ctx.d.type(`${dir}/`);
    await sleep(500);
    await ctx.d.press('Enter');
    await sleep(800);
    const q = await ctx.d.workbench<boolean>(`(() => { const w = [...document.querySelectorAll('.quick-input-widget')].find((e) => e.style.display !== 'none' && e.getBoundingClientRect().height > 0); return !!w && ((w.querySelector('.quick-input-title') || {}).innerText || '').includes(${JSON.stringify(what === 'the overlay directory' ? 'overlay' : 'write')}); })()`);
    if (q) { await ctx.d.press('Enter'); await sleep(800); }
  }
  const d = await until('the confirmation', 15000, () => dialog(ctx.d), (v) => v !== null);
  need(d !== null && d.buttons.includes('Write'), `the confirmation draws no Write button: ${JSON.stringify(d)}`);
  await pressDialogButton(ctx.d, 'Write');
  const text = await ctx.out.waitFor('the generation writing its command line', mark, (t) => t.split('\n').some((l) => l.startsWith('$ ')), 60000);
  return text.split('\n').find((l) => l.startsWith('$ ')) ?? '';
}
