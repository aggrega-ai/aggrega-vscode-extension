// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as path from 'path';

import { CONFIG_FILENAME } from '../../src/workspace';
import { Judgement, need } from './checks';
import { WORKSPACE_ANCHOR_ONLY } from './fixtures';
import { Layout } from './layouts';
import {
  ABOVE_BUTTONS, ABOVE_CONTINUE, ABOVE_MESSAGE, ABOVE_OPEN, ABOVE_SILENCE, aboveDetail, ADD_DIALOG, ADD_ENTRY, answerFolderDialog, answerWorkspaceSaveIfAsked, changeWindow, closeChooser,
  describeRows, DialogSeen, dialogsSeen, DrawnDialog, drawnDialog, EDITOR_DONT_SAVE, LevelRow, OPEN_ROOT, openFolderHere, openFolders, pressRowControl, reloadWindow, rowChooser, rowsNow,
  statusHover, takeChooserRow, takeToFolderDialog, ToastLedger, waitRows, workspaceHover,
} from './levels';
import { capture, ready, SuiteContext } from './suite-context';
import { guard, holds, pressDialogButton, until } from './workbench';

// The checks run in a folder beneath a workspace root it carries no marker of its
// own for, and follow the interruption that says so and the mark it leaves: the
// dialog raised unprompted with the two paths and three actions, dismissed while
// the mark stays; raised again in each new window until the reader asks not to be
// told about that folder, which silences that folder alone; the two ways to open
// the workspace itself, each only when pressed; and the dialog drawn by the editor
// in its own theme.

export const ABOVE_DIALOG_CHECKS = [
  'workspace-above.dialog-says-only-the-two-paths',
  'workspace-above.continue-here-closes-the-dialog-and-leaves-the-mark',
  'workspace-above.dialog-returns-in-a-new-window-until-silenced',
  'workspace-above.escape-on-the-dialog-is-continue-here',
  'workspace-above.silencing-one-folder-leaves-another-warning',
  'workspace-above.open-control-opens-the-workspace-when-pressed',
  'workspace-above.dialog-open-action-opens-the-workspace-when-pressed',
  'workspace-above.dialog-drawn-in-the-editors-own-drawing',
  'workspace-above.dialog-in-the-editors-theme',
] as const;

// The layouts, each a workspace root marked by its configuration with an empty
// folder beneath it that carries none, named by the check that opens its root:
// the folder the scenario starts on, services/docs beneath its root; and three
// roots with sub/ beneath, opened by the dialog's own action, by the row's open
// control, and drawn with the editor's own dialog style.
const ROOT_ABOVE_DOCS = 'root-above-docs';
const ROOT_FOR_ITS_DIALOG = 'root-for-its-dialog';
const ROOT_FOR_ITS_CONTROL = 'root-for-its-control';
const ROOT_FOR_CUSTOM_STYLE = 'root-for-custom-style';
const DOCS = path.join('services', 'docs');

export const ABOVE_DIALOG_FIRST = path.join(ROOT_ABOVE_DOCS, DOCS);
export const ABOVE_DIALOG_LAYOUTS: readonly Layout[] = [ROOT_ABOVE_DOCS, ROOT_FOR_ITS_DIALOG, ROOT_FOR_ITS_CONTROL, ROOT_FOR_CUSTOM_STYLE].map((folder) => ({
  folder, files: { [CONFIG_FILENAME]: WORKSPACE_ANCHOR_ONLY }, dirs: [folder === ROOT_ABOVE_DOCS ? DOCS : 'sub'],
}));

// How long a raised dialog is left unanswered to show nothing opens without a
// press, and how long a window is watched for a dialog it must not raise.
const UNPRESSED_MS = 3000;
const NO_DIALOG_MS = 5000;

// DISTANCE words a dialog would use to count how far above the folder the
// workspace sits.
const DISTANCE = /levels? up|directories? up|folders? up|\bparent\b/i;

// waitDialog waits for the interruption to be drawn, or answers null.
function waitDialog(ctx: SuiteContext, boundMs = 20000): Promise<DrawnDialog | null> {
  return until('the interruption being drawn', boundMs, () => drawnDialog(ctx.d), (v) => v !== null).catch(() => null);
}

// noDialog watches a window for the interruption over a stated window.
async function noDialog(ctx: SuiteContext, ms = NO_DIALOG_MS): Promise<boolean> {
  return (await holds(ms, () => drawnDialog(ctx.d), (v) => v === null)).held;
}

// marked reads whether the Aggrega workspace row carries the warning mark.
function marked(rows: readonly LevelRow[]): boolean {
  return rows[1]?.mark !== null && rows[1]?.mark !== undefined;
}

// sameButtons compares a dialog's buttons with the three it is to carry, as a
// set: which way round a dialog lays its buttons out is the platform's, and the
// order is not what a reader is told.
function sameButtons(buttons: readonly string[]): boolean {
  return JSON.stringify([...buttons].sort()) === JSON.stringify([...ABOVE_BUTTONS].sort());
}

const DIALOG_IN_THE_THEME = Judgement.declare('workspace-above.dialog-in-the-editors-theme', {
  expected: 'the dialog the editor draws for itself is drawn in the editor\'s own theme',
  plant: 'none: whether a drawing matches the theme is a judgement of how it looks',
  question: 'The capture shows the dialog as the editor draws it with window.dialogStyle set to "custom", under the Dark Modern theme. Is it drawn in the editor\'s own theme?',
});

export async function aboveDialogChecks(ctx: SuiteContext, layouts: string): Promise<void> {
  const c = ctx.checks;
  const docs = ctx.folder;
  const above = path.join(layouts, ROOT_ABOVE_DOCS);
  const above3 = path.join(layouts, ROOT_FOR_ITS_CONTROL);
  const above3Sub = path.join(above3, 'sub');
  const above2 = path.join(layouts, ROOT_FOR_ITS_DIALOG);
  const above2Sub = path.join(above2, 'sub');
  const above4 = path.join(layouts, ROOT_FOR_CUSTOM_STYLE);
  const above4Sub = path.join(above4, 'sub');
  const ledger = new ToastLedger();
  let first: DrawnDialog | null = null;

  await c.run('workspace-above.dialog-says-only-the-two-paths', {
    expected: `opening ${docs} alone, never opened before, raises with no press a warning dialog whose message reads "${ABOVE_MESSAGE}", beneath it the two lines ${JSON.stringify(aboveDetail(above, docs))}, each a full path, and exactly the buttons ${ABOVE_BUTTONS.map((b) => `"${b}"`).join(', ')} — no separate Cancel, no button carrying a path; the editor draws its own warning icon, and the text carries no triangle, no asterisks and no distance; left unanswered for ${UNPRESSED_MS} ms it opens nothing`,
    plant: 'in the scratch copy, out/src/workspace-above.js with the workspace\'s line labelled "Workspace:"',
  }, async () => {
    first = await waitDialog(ctx, 60000);
    if (first === null) { return { passed: false, seen: `no dialog was drawn within ${guard(60000)} ms of the folder opening` }; }
    const d = first;
    const folders = (await openFolders(ctx)).map((f) => f.path);
    const unpressed = await holds(UNPRESSED_MS, async () => ({ folders: (await openFolders(ctx)).map((f) => f.path).join('|'), drawn: (await drawnDialog(ctx.d)) !== null }), (v) => v.folders === folders.join('|') && v.drawn);
    const text = `${d.message}\n${d.detail}\n${d.buttons.join('\n')}`;
    const clean = !/⚠|\*\*/.test(text) && !DISTANCE.test(text) && !/^Workspace:/m.test(d.detail) && d.buttons.every((b) => !b.includes('/'));
    return {
      passed: d.message === ABOVE_MESSAGE && d.detail === aboveDetail(above, docs) && sameButtons(d.buttons) && /warning/.test(d.icon) && clean && unpressed.held,
      seen: `the dialog ${JSON.stringify(d)}; ${clean ? 'no triangle, asterisks, distance, bare label or path on a button' : 'text a reader should not meet'}; unanswered for ${UNPRESSED_MS} ms ${unpressed.held ? 'it opened nothing' : `something changed: ${JSON.stringify(unpressed.broke)}`}`,
    };
  });

  await c.run('workspace-above.continue-here-closes-the-dialog-and-leaves-the-mark', {
    expected: `pressing "${ABOVE_CONTINUE}" closes the dialog and changes nothing else: the Aggrega workspace row reads "${ROOT_ABOVE_DOCS}" with the warning mark drawn to the right of the value, outside it, named ${JSON.stringify(ABOVE_MESSAGE)}; the Project folder row reads "docs"; the Aggrega workspace row's hover reads ${JSON.stringify(workspaceHover(above, docs))}, the workspace's path once; beyond its create control the row carries a folder-shaped control named ${JSON.stringify(OPEN_ROOT)}; and the status bar's workspace item's hover opens with ${above}`,
    plant: 'in the scratch copy, out/src/selector-rows.js with the Aggrega workspace row drawn without its mark',
  }, async () => {
    need(first !== null, 'the dialog was not raised, so there is nothing to answer');
    const foldersBefore = (await openFolders(ctx)).map((f) => f.path);
    await pressDialogButton(ctx.d, ABOVE_CONTINUE);
    const closed = await until('the dialog closing', 5000, () => drawnDialog(ctx.d), (v) => v === null).then(() => true, () => false);
    await ready(ctx);
    const rows = await waitRows(ctx, 'the rows naming the folder and the workspace above it', (r) => r[0]?.value === 'docs' && r[1]?.value === ROOT_ABOVE_DOCS);
    const w = rows[1];
    const markOk = w?.mark !== null && w?.mark !== undefined && !w.mark.insideValue && w.mark.box.x >= w.valueBox.x + w.valueBox.width - 1 && w.mark.name === ABOVE_MESSAGE && w.mark.role === 'img' && !w.value.startsWith('⚠');
    const offerOk = w?.offer !== null && w?.offer !== undefined && w.offer.name === OPEN_ROOT && w.offer.title === OPEN_ROOT && w.create !== null && w.offer.box.x >= w.create.box.x + w.create.box.width - 1;
    const status = await until('the status bar\'s workspace item', 15000, () => statusHover(ctx, (i) => i.side === 'right' && i.text.startsWith('Aggrega')), (v) => v !== null && v.hover !== '').catch(() => null);
    const folders = (await openFolders(ctx)).map((f) => f.path);
    return {
      passed: closed && JSON.stringify(folders) === JSON.stringify(foldersBefore) && rows[0]?.value === 'docs' && w?.value === ROOT_ABOVE_DOCS && markOk && w.title === workspaceHover(above, docs) && offerOk && status !== null && status.hover.startsWith(above),
      seen: `the dialog ${closed ? 'closed' : 'still drawn'}; the rows ${describeRows(rows)}; the mark ${JSON.stringify(w?.mark ?? null)} beside a value at ${JSON.stringify(w?.valueBox ?? null)}; the hover ${JSON.stringify(w?.title ?? '')}; the open control ${JSON.stringify(w?.offer ?? null)}; the status bar item ${status ? `"${status.item.text}", hover ${JSON.stringify(status.hover)}` : 'not drawn'}; the window holds ${JSON.stringify(folders)}`,
    };
  });

  await c.run('workspace-above.dialog-returns-in-a-new-window-until-silenced', {
    expected: `the window reloaded raises the dialog again — "${ABOVE_CONTINUE}" lasts for one window — with the mark on the row; pressing "${ABOVE_SILENCE}" and reloading once more raises no dialog (watched for ${NO_DIALOG_MS} ms once the window is ready), and the mark is still on the row`,
    plant: 'in the scratch copy, out/src/workspace-above.js with "Continue here" kept for the folder as "Don\'t show again for this folder" is',
  }, async () => {
    await reloadWindow(ctx, ledger);
    // The dialog raised again is what this check is about, and it is also the
    // positive control for the absence read after the second reload.
    const again = await waitDialog(ctx, 60000);
    if (again === null) { return { passed: false, seen: `the reload after "${ABOVE_CONTINUE}" raised no dialog` }; }
    await pressDialogButton(ctx.d, ABOVE_SILENCE);
    await until('the dialog closing', 5000, () => drawnDialog(ctx.d), (v) => v === null).catch(() => undefined);
    await ready(ctx);
    const rowsSilenced = await rowsNow(ctx);
    await reloadWindow(ctx, ledger);
    await ready(ctx);
    const quiet = await noDialog(ctx);
    const rows = await waitRows(ctx, `the Aggrega workspace row naming ${ROOT_ABOVE_DOCS}`, (r) => r[1]?.value === ROOT_ABOVE_DOCS);
    return {
      passed: again.message === ABOVE_MESSAGE && marked(rowsSilenced) && quiet && marked(rows),
      seen: `after the first reload the dialog ${JSON.stringify(again)}; after "${ABOVE_SILENCE}" the row ${marked(rowsSilenced) ? 'marked' : 'unmarked'}; after the second reload ${quiet ? `no dialog for ${NO_DIALOG_MS} ms` : 'a dialog'} and the row ${marked(rows) ? 'marked' : 'unmarked'} (${describeRows(rows)})`,
    };
  });

  let subDialog: DialogSeen | null = null;
  await c.run('workspace-above.escape-on-the-dialog-is-continue-here', {
    expected: `taking the Project folder row's "${ADD_ENTRY}" and picking ${above3Sub} brings the window back working from "sub" and raises the dialog naming ${JSON.stringify(aboveDetail(above3, above3Sub))}; Escape closes it as "${ABOVE_CONTINUE}" does, leaving the mark on the row and silencing nothing: it is raised again for "sub" when the window next reloads`,
    plant: 'in the scratch copy, out/src/workspace-above.js with the dialog\'s close affordance declared on "Don\'t show again for this folder" rather than on "Continue here"',
  }, async () => {
    await changeWindow(ctx, ledger, async () => {
      await rowChooser(ctx, 'project');
      await takeToFolderDialog(ctx.d, ADD_ENTRY, ADD_DIALOG.title);
      await answerFolderDialog(ctx.d, above3Sub, ADD_DIALOG.accept);
    });
    const d = await waitDialog(ctx, 60000);
    if (d === null) { return { passed: false, seen: `no dialog was drawn within ${guard(60000)} ms of the window coming back with ${above3Sub} added` }; }
    subDialog = { at: Date.now(), message: d.message, detail: d.detail };
    await ctx.d.press('Escape');
    const closed = await until('the dialog closing', 5000, () => drawnDialog(ctx.d), (v) => v === null).then(() => true, () => false);
    await ready(ctx);
    const rows = await waitRows(ctx, `the rows naming sub and ${ROOT_FOR_ITS_CONTROL}`, (r) => r[0]?.value === 'sub' && r[1]?.value === ROOT_FOR_ITS_CONTROL);
    await reloadWindow(ctx, ledger);
    const again = await waitDialog(ctx, 60000);
    if (again !== null) { await pressDialogButton(ctx.d, ABOVE_CONTINUE); }
    await ready(ctx);
    return {
      passed: d.detail === aboveDetail(above3, above3Sub) && closed && marked(rows) && again !== null && again.detail === aboveDetail(above3, above3Sub),
      seen: `the dialog ${JSON.stringify(d)}; Escape ${closed ? 'closed it' : 'left it drawn'}; the rows ${describeRows(rows)}, ${marked(rows) ? 'marked' : 'unmarked'}; the next reload ${again ? `raised it again: ${JSON.stringify(again.detail)}` : 'raised no dialog'}`,
    };
  });

  await c.run('workspace-above.silencing-one-folder-leaves-another-warning', {
    expected: `in that window, choosing "docs" on the Project folder row raises the dialog for docs — the add made a new workspace, and the answer given in the window left behind stayed there; pressing "${ABOVE_SILENCE}" there and choosing "sub" again raises no dialog, since this window has told the reader about it; reloading raises the dialog for "sub" as the window comes back, and choosing "docs" then raises none; the Aggrega workspace row carries the mark throughout`,
    plant: 'in the scratch copy, out/src/workspace-above.js with the folders silenced kept as one answer for the window rather than one per folder',
  }, async () => {
    need(subDialog !== null, 'the dialog for the folder added was not raised');
    const seen: string[] = [];
    const choose = async (name: string): Promise<void> => {
      await rowChooser(ctx, 'project');
      await takeChooserRow(ctx.d, name);
    };
    await choose('docs');
    const forDocs = await waitDialog(ctx, 20000);
    seen.push(`choosing docs: ${forDocs ? JSON.stringify(forDocs.detail) : 'no dialog'}`);
    if (forDocs !== null) { await pressDialogButton(ctx.d, ABOVE_SILENCE); }
    await until('the dialog closing', 5000, () => drawnDialog(ctx.d), (v) => v === null).catch(() => undefined);
    const marks: boolean[] = [marked(await waitRows(ctx, 'the rows naming docs', (r) => r[0]?.value === 'docs'))];
    await choose('sub');
    const quietSub = await noDialog(ctx);
    seen.push(`choosing sub again: ${quietSub ? 'no dialog' : 'a dialog'}`);
    marks.push(marked(await waitRows(ctx, 'the rows naming sub', (r) => r[0]?.value === 'sub')));
    await reloadWindow(ctx, ledger);
    const onReload = await waitDialog(ctx, 60000);
    seen.push(`the reload: ${onReload ? JSON.stringify(onReload.detail) : 'no dialog'}`);
    if (onReload !== null) { await pressDialogButton(ctx.d, ABOVE_CONTINUE); }
    await ready(ctx);
    marks.push(marked(await rowsNow(ctx)));
    await choose('docs');
    const quietDocs = await noDialog(ctx);
    seen.push(`choosing docs after the reload: ${quietDocs ? 'no dialog' : 'a dialog'}`);
    marks.push(marked(await waitRows(ctx, 'the rows naming docs', (r) => r[0]?.value === 'docs')));
    // Back to sub, for the check after this one.
    await choose('sub');
    await noDialog(ctx, 2000);
    return {
      passed: forDocs !== null && forDocs.detail === aboveDetail(above, docs) && quietSub && onReload !== null && onReload.detail === aboveDetail(above3, above3Sub) && quietDocs && marks.every((m) => m),
      seen: `${seen.join('; ')}; the mark ${JSON.stringify(marks)}`,
    };
  });

  await c.run('workspace-above.open-control-opens-the-workspace-when-pressed', {
    expected: `with "sub" chosen, pressing the Aggrega workspace row's folder-shaped control reloads the window with ${above3} as its only folder; the Aggrega workspace row then carries no mark and no open control, an empty space keeping its other controls where they were, the Project folder row reads "${ROOT_FOR_ITS_CONTROL}", and no dialog is raised (watched for ${NO_DIALOG_MS} ms)`,
    plant: 'in the scratch copy, out/src/selector-rows.js with the open control offered whether or not the workspace is the folder opened',
  }, async () => {
    const rowsBefore = await waitRows(ctx, 'the rows naming sub with the open control drawn', (r) => r[0]?.value === 'sub' && r[1]?.offer !== null && r[1]?.offer !== undefined);
    need(rowsBefore[1]?.offer !== null && rowsBefore[1]?.offer !== undefined, 'the Aggrega workspace row carries no open control to press');
    const createBefore = rowsBefore[1].create?.box.x ?? null;
    // The window is leaving the untitled workspace the add made, so the editor asks
    // whether to keep a file of it, as it does for File > Open Folder.
    let asked: DrawnDialog | null = null;
    const change = await changeWindow(ctx, ledger, async () => {
      await pressRowControl(ctx, 'workspace', 'offer');
      asked = await answerWorkspaceSaveIfAsked(ctx.d);
    });
    await ready(ctx);
    const quiet = await noDialog(ctx);
    const folders = (await openFolders(ctx)).map((f) => f.path);
    const rows = await waitRows(ctx, `the rows naming ${ROOT_FOR_ITS_CONTROL}`, (r) => r[0]?.value === ROOT_FOR_ITS_CONTROL && r[1]?.value === ROOT_FOR_ITS_CONTROL);
    const w = rows[1];
    const kept = w?.offer === null && w.offerGap !== null && w.mark === null && w.create !== null && createBefore !== null && Math.abs(w.create.box.x - createBefore) <= 1;
    const question = asked as DrawnDialog | null;
    return { passed: change.reloaded && JSON.stringify(folders) === JSON.stringify([above3]) && rows[0]?.value === ROOT_FOR_ITS_CONTROL && kept && quiet, seen: `${question ? `the editor asked ${JSON.stringify(question.message)} and was answered "${EDITOR_DONT_SAVE}"; ` : ''}the press ${change.reloaded ? 'reloaded' : 'did not reload'} the window, which holds ${JSON.stringify(folders)}; the rows ${describeRows(rows)}; the row's mark ${JSON.stringify(w?.mark ?? null)}, open control ${JSON.stringify(w?.offer ?? null)}, empty space ${JSON.stringify(w?.offerGap ?? null)}, create control from x ${createBefore} to ${w?.create?.box.x ?? null}; ${quiet ? 'no dialog' : 'a dialog'}` };
  });

  await c.run('workspace-above.dialog-open-action-opens-the-workspace-when-pressed', {
    expected: `opening ${above2Sub} alone raises the dialog; left unanswered for ${UNPRESSED_MS} ms it opens nothing; pressing "${ABOVE_OPEN}" reloads the window onto ${above2} alone, whose Aggrega workspace row then carries no mark and no open control, with the Project folder row reading "${ROOT_FOR_ITS_DIALOG}" and no dialog raised`,
    plant: 'in the scratch copy, out/src/workspace-above.js with the dialog\'s opening action opening nothing',
  }, async () => {
    await openFolderHere(ctx, ledger, above2Sub);
    const d = await waitDialog(ctx, 60000);
    if (d === null) { return { passed: false, seen: `no dialog was drawn within ${guard(60000)} ms of ${above2Sub} opening` }; }
    const before = (await openFolders(ctx)).map((f) => f.path);
    const unpressed = await holds(UNPRESSED_MS, async () => (await openFolders(ctx)).map((f) => f.path).join('|'), (v) => v === before.join('|'));
    const change = await changeWindow(ctx, ledger, () => pressDialogButton(ctx.d, ABOVE_OPEN));
    await ready(ctx);
    const quiet = await noDialog(ctx);
    const folders = (await openFolders(ctx)).map((f) => f.path);
    const rows = await waitRows(ctx, `the rows naming ${ROOT_FOR_ITS_DIALOG}`, (r) => r[0]?.value === ROOT_FOR_ITS_DIALOG && r[1]?.value === ROOT_FOR_ITS_DIALOG);
    return {
      passed: unpressed.held && change.reloaded && JSON.stringify(folders) === JSON.stringify([above2]) && rows[1]?.mark === null && rows[1]?.offer === null && quiet,
      seen: `unanswered for ${UNPRESSED_MS} ms the window ${unpressed.held ? 'kept' : 'changed'} ${JSON.stringify(before)}; the press ${change.reloaded ? 'reloaded' : 'did not reload'} the window, which holds ${JSON.stringify(folders)}; the rows ${describeRows(rows)}, mark ${JSON.stringify(rows[1]?.mark ?? null)}, open control ${JSON.stringify(rows[1]?.offer ?? null)}; ${quiet ? 'no dialog' : 'a dialog'}`,
    };
  });

  let editorDrawn: DrawnDialog | null = null;
  await c.run('workspace-above.dialog-drawn-in-the-editors-own-drawing', {
    expected: `with the editor's window.dialogStyle set to "custom", opening ${above4Sub}, never opened before beneath ${above4}, raises the dialog drawn by the editor itself — inside the workbench's own document — with the same message, the same two lines for its paths and the same buttons as the first`,
    plant: 'in the scratch copy, out/src/workspace-above.js with the dialog raised as a notification rather than a dialog',
  }, async () => {
    const style = await ctx.probe.request<{ value: unknown }>('configuration.inspect', { key: 'window.dialogStyle' });
    need(style.value === 'custom', `window.dialogStyle reads ${JSON.stringify(style.value)}, not "custom"`);
    await openFolderHere(ctx, ledger, above4Sub);
    editorDrawn = await waitDialog(ctx, 60000);
    const d = editorDrawn;
    const seen = (await dialogsSeen(ctx.d)).length;
    return {
      passed: d !== null && d.message === ABOVE_MESSAGE && d.detail === aboveDetail(above4, above4Sub) && sameButtons(d.buttons),
      seen: `window.dialogStyle ${JSON.stringify(style.value)}; the dialog ${d ? JSON.stringify(d) : 'not drawn in the workbench'}; dialogs the workbench drew since the folder opened ${seen}`,
    };
  });

  await c.forPerson(DIALOG_IN_THE_THEME, async () => {
    need(editorDrawn !== null, 'the dialog the editor draws for itself was not raised');
    const shot = await capture(ctx, 'workspace-above-dialog-in-the-editors-theme');
    const d = editorDrawn as DrawnDialog;
    await pressDialogButton(ctx.d, ABOVE_CONTINUE).catch(() => undefined);
    return { screenshot: shot, drawnText: d.text };
  });
  await closeChooser(ctx.d);
}
