// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { CONFIG_FILENAME } from '../../src/workspace';
import { need } from './checks';
import { WORKSPACE_ANCHOR_ONLY } from './fixtures';
import { Layout } from './layouts';
import {
  ADD_DETAIL, ADD_DIALOG, ADD_ENTRY, addWithTheEditorsCommand, alreadyOpen, answerFolderDialog, answerWorkspaceSaveIfAsked, changeWindow, Chooser, chooser, CHOOSE_FOLDER_PLACEHOLDER,
  closeChooser, closeFolderHere, describePending, describeRows, DialogSeen, dialogsSeen, DrawnDialog, EDITOR_DONT_SAVE, LOCAL_ADD_COST, markDocument, NO_FOLDER_HOVER, NO_WORKSPACE,
  noChoicePending, nowWorkingFrom, nowWorkingIn, OPEN_DETAIL_EMPTY, OPEN_DETAIL_REPLACING, OPEN_DIALOG, OPEN_ENTRY, openFolderHere, openFolders, pasteIntoChooser, PENDING_CHOICE_ACTION,
  pendingChoice, pendingChoiceNotice, pickersSeen, pressRow, readyAnyway, rowChooser, sameDocument, serverIn, serversWorking, takeChooserRow, takeToFolderDialog, ToastLedger, waitChooser,
  waitRows, WIDEN_ANOTHER, WIDEN_DETAIL, windowTitle,
} from './levels';
import { Hello } from './probe-client';
import { continueHere } from './suite-above';
import { ready, SuiteContext } from './suite-context';
import { holds, toasts, toastsSince, until, waitToast } from './workbench';

// The checks run in a window opened on one folder that is its own Aggrega
// workspace, and follow it through what the Project folder row's chooser can do to
// it: the two ways it offers to reach a folder the window does not have, their
// dialogs, and a folder already open refused; an add from one folder that comes
// back working from the folder added, and an add in place that costs nothing;
// an open that replaces what the window had; the row in a window with no folder
// at all; and the Aggrega workspace row's last entry, which carries the workspace
// chosen into the window the add makes.

export const FOLDER_ADDS_CHECKS = [
  'project-folder.chooser-offers-two-ways-to-reach-another',
  'workspace-row.last-entry-names-what-the-add-costs-here',
  'project-folder.open-dialog-names-its-act-lists-folders-and-cancels-quietly',
  'project-folder.add-dialog-names-its-act-and-cancels-quietly',
  'project-folder.adding-a-folder-already-open-says-so',
  'project-folder.add-from-one-folder-comes-back-working-from-it',
  'project-folder.add-in-place-costs-nothing-and-says-where',
  'project-folder.open-replaces-and-leaves-nothing-behind',
  'workspace-row.no-folder-open-answers-with-the-ways-out',
  'project-folder.row-in-a-window-with-no-folder',
  'workspace-row.last-entry-carries-the-workspace-chosen',
] as const;

// The layouts the scenario opens and adds, each named by what it is: the folder
// the window opens on, its own workspace root; a root whose empty sub/ is added
// from that one folder; and a root whose empty sub/ is added in place.
const OWN_ROOT = 'own-root';
const ROOT_ABOVE_SUB = 'root-above-sub';
const IN_PLACE_ROOT = 'in-place-root';

export const FOLDER_ADDS_FIRST = OWN_ROOT;
export const FOLDER_ADDS_LAYOUTS: readonly Layout[] = [
  { folder: OWN_ROOT, files: { [CONFIG_FILENAME]: WORKSPACE_ANCHOR_ONLY } },
  { folder: ROOT_ABOVE_SUB, files: { [CONFIG_FILENAME]: WORKSPACE_ANCHOR_ONLY }, dirs: ['sub'] },
  { folder: IN_PLACE_ROOT, files: { [CONFIG_FILENAME]: WORKSPACE_ANCHOR_ONLY }, dirs: ['sub'] },
];

// The file the layouts' parent holds beside them, so a folder dialog shown that
// directory has a file it must leave out beside the folders it lists.
export const NOT_A_FOLDER = 'not-a-folder.txt';

// How long a dialog cancelled, an add in place, or a window's arrival is watched
// for anything changing.
const QUIET_MS = 3000;

// projectChooser opens the Project folder row's chooser and answers with it, left
// open.
function projectChooser(ctx: SuiteContext): Promise<Chooser> {
  return rowChooser(ctx, 'project');
}

// entries words a chooser's entries for a check's report.
const entries = (q: Chooser | null): string => JSON.stringify((q?.rows ?? []).map((r) => [r.label, r.description, r.detail]));

// dialogFor answers the interruption raised for a folder, pressing Continue here,
// and answers with what it said.
async function dialogFor(ctx: SuiteContext): Promise<DialogSeen | null> {
  const d = await continueHere(ctx);
  return d === null ? null : { at: Date.now(), message: d.message, detail: d.detail };
}

export async function folderAddsChecks(ctx: SuiteContext, layouts: string): Promise<void> {
  const c = ctx.checks;
  const home = ctx.folder;
  const above2Sub = path.join(layouts, ROOT_ABOVE_SUB, 'sub');
  const above2 = path.dirname(above2Sub);
  const addSub = path.join(layouts, IN_PLACE_ROOT, 'sub');
  const add = path.dirname(addSub);
  const ledger = new ToastLedger();
  let alreadyOpenSeen = false;
  // Whether the positive control for "no choice pending" fired: a window the
  // editor's own add makes, which carries no answer across, reaching two
  // workspaces and offering the choice.
  let pendingSeen = false;
  await ready(ctx);

  await c.run('project-folder.chooser-offers-two-ways-to-reach-another', {
    expected: `in a window on ${home} alone, the Project folder row's chooser lists "${OWN_ROOT}" with its full path beside it, then "${OPEN_ENTRY}" whose second line reads "${OPEN_DETAIL_REPLACING}", then "${ADD_ENTRY}" whose second line reads "${ADD_DETAIL}${LOCAL_ADD_COST}" — the cost an add has in a local window on one folder`,
    plant: 'in the scratch copy, out/src/project-folder.js with the add entry labelled otherwise',
  }, async () => {
    const q = await projectChooser(ctx);
    await closeChooser(ctx.d);
    const want = [[OWN_ROOT, home, ''], [OPEN_ENTRY, '', OPEN_DETAIL_REPLACING], [ADD_ENTRY, '', `${ADD_DETAIL}${LOCAL_ADD_COST}`]];
    return { passed: JSON.stringify(q.rows.map((r) => [r.label, r.description, r.detail])) === JSON.stringify(want), seen: `the chooser lists ${entries(q)}` };
  });

  await c.run('workspace-row.last-entry-names-what-the-add-costs-here', {
    expected: `in the same window, the Aggrega workspace row's chooser lists "${OWN_ROOT}" with its full path beside it and "${CONFIG_FILENAME}" beneath, then, last, "${WIDEN_ANOTHER}" whose second line reads "${WIDEN_DETAIL}${LOCAL_ADD_COST}", the same cost the Project folder chooser's add names`,
    plant: 'in the scratch copy, out/src/anchor-picker.js with the last entry\'s second line composed without the add\'s cost',
  }, async () => {
    const q = await rowChooser(ctx, 'workspace');
    await closeChooser(ctx.d);
    const want = [[OWN_ROOT, home, CONFIG_FILENAME], [WIDEN_ANOTHER, '', `${WIDEN_DETAIL}${LOCAL_ADD_COST}`]];
    return { passed: JSON.stringify(q.rows.map((r) => [r.label, r.description, r.detail])) === JSON.stringify(want), seen: `the chooser lists ${entries(q)}` };
  });

  // cancelled takes one of the two entries, reads the dialog it opens, and closes it
  // with Escape, reading whether anything changed.
  const cancelled = async (entry: string, title: string): Promise<{ dialog: Chooser | null; listing: Chooser | null; quiet: boolean; told: string[] }> => {
    const foldersBefore = await openFolders(ctx);
    const hello = await ctx.probe.request<Hello>('hello');
    const token = await markDocument(ctx.d);
    await projectChooser(ctx);
    await takeChooserRow(ctx.d, entry);
    const dialog = await waitChooser(ctx.d, 'the folder dialog', (x) => x.title === title || x.title.startsWith('Aggrega: select'), 10000).catch(() => chooser(ctx.d));
    // The dialog shown the layouts' parent, where a file stands beside the folders.
    await pasteIntoChooser(ctx.d, `${layouts}/`);
    const listing = await until('the dialog listing the layouts\' parent', 5000, () => chooser(ctx.d), (x) => x !== null && x.rows.some((r) => r.label === OWN_ROOT)).catch(() => chooser(ctx.d));
    const toastMark = (await toasts(ctx.d)).length;
    await ctx.d.press('Escape');
    await until('the dialog closing', 5000, () => chooser(ctx.d), (x) => x === null).catch(() => undefined);
    const quiet = await holds(QUIET_MS, async () => ({ folders: (await openFolders(ctx)).map((f) => f.path).join('|'), same: await sameDocument(ctx.d, token), instance: (await ctx.probe.request<Hello>('hello')).instance, told: (await toastsSince(ctx.d, toastMark)).length }),
      (v) => v.folders === foldersBefore.map((f) => f.path).join('|') && v.same && v.instance === hello.instance && v.told === 0);
    return { dialog, listing, quiet: quiet.held, told: (await toastsSince(ctx.d, toastMark)).map((t) => t.message) };
  };

  await c.run('project-folder.open-dialog-names-its-act-lists-folders-and-cancels-quietly', {
    expected: `taking "${OPEN_ENTRY}" opens the editor's folder dialog titled "${OPEN_DIALOG.title}" with a button reading exactly "${OPEN_DIALOG.accept}"; shown the directory the layouts sit in, it lists their folders and leaves out the file ${NOT_A_FOLDER} beside them; Escape closes it and for ${QUIET_MS} ms nothing changes — the same folders, the same window, the same extension host — and nothing is said`,
    plant: 'in the scratch copy, out/src/project-folder.js with the open dialog\'s button labelled as the add dialog\'s',
  }, async () => {
    need(fs.existsSync(path.join(layouts, NOT_A_FOLDER)), `${NOT_A_FOLDER} is not beside the layouts`);
    const r = await cancelled(OPEN_ENTRY, OPEN_DIALOG.title);
    const labels = (r.listing?.rows ?? []).map((x) => x.label.replace(/\/$/, ''));
    const foldersOnly = labels.includes(OWN_ROOT) && !labels.includes(NOT_A_FOLDER);
    return {
      passed: r.dialog !== null && r.dialog.title === OPEN_DIALOG.title && r.dialog.buttons.includes(OPEN_DIALOG.accept) && !r.dialog.buttons.includes(ADD_DIALOG.accept) && foldersOnly && r.quiet,
      seen: `the dialog "${r.dialog?.title ?? ''}" with buttons ${JSON.stringify(r.dialog?.buttons ?? [])}; shown ${layouts} it lists ${JSON.stringify(labels)}; after Escape ${r.quiet ? `nothing changed for ${QUIET_MS} ms` : 'something changed'}; notifications ${JSON.stringify(r.told)}`,
    };
  });

  await c.run('project-folder.add-dialog-names-its-act-and-cancels-quietly', {
    expected: `taking "${ADD_ENTRY}" opens the editor's folder dialog titled "${ADD_DIALOG.title}" with a button reading exactly "${ADD_DIALOG.accept}"; Escape closes it and for ${QUIET_MS} ms nothing changes and nothing is said`,
    plant: 'in the scratch copy, out/src/project-folder.js with the add dialog titled as the open dialog',
  }, async () => {
    const r = await cancelled(ADD_ENTRY, ADD_DIALOG.title);
    return {
      passed: r.dialog !== null && r.dialog.title === ADD_DIALOG.title && r.dialog.buttons.includes(ADD_DIALOG.accept) && !r.dialog.buttons.includes(OPEN_DIALOG.accept) && r.quiet,
      seen: `the dialog "${r.dialog?.title ?? ''}" with buttons ${JSON.stringify(r.dialog?.buttons ?? [])}; after Escape ${r.quiet ? `nothing changed for ${QUIET_MS} ms` : 'something changed'}; notifications ${JSON.stringify(r.told)}`,
    };
  });

  await c.run('project-folder.adding-a-folder-already-open-says-so', {
    expected: `taking "${ADD_ENTRY}" and picking ${home}, which the window already has open, raises "${alreadyOpen(home)}" and adds nothing: the window holds ${home} alone, watched for ${QUIET_MS} ms once the notice is drawn; the same reading of the window's folders reads the folder the next check adds`,
    plant: 'in the scratch copy, out/src/project-folder.js with a folder already open handed to the editor to add like any other',
  }, async () => {
    const toastMark = (await toasts(ctx.d)).length;
    await projectChooser(ctx);
    await takeToFolderDialog(ctx.d, ADD_ENTRY, ADD_DIALOG.title);
    await answerFolderDialog(ctx.d, home, ADD_DIALOG.accept);
    const told = await waitToast(ctx.d, 'the notice that the folder is open already', toastMark, (t) => t.message === alreadyOpen(home), 10000).then(() => true, () => false);
    alreadyOpenSeen = told;
    const alone = await holds(QUIET_MS, async () => (await openFolders(ctx)).map((f) => f.path), (v) => v.length === 1 && v[0] === home);
    const folders = await openFolders(ctx);
    const said = (await toastsSince(ctx.d, toastMark)).map((t) => t.message);
    return { passed: told && alone.held, seen: `notifications ${JSON.stringify(said)}; the window ${alone.held ? `held ${home} alone for ${QUIET_MS} ms` : `held ${JSON.stringify(alone.broke)} at ${alone.atMs} ms`}, and holds ${JSON.stringify(folders.map((f) => f.path))}` };
  });

  await c.run('project-folder.add-from-one-folder-comes-back-working-from-it', {
    expected: `taking "${ADD_ENTRY}" in this local window on one folder and picking ${above2Sub} says nothing and restarts the extensions — the window itself is not reloaded — onto an untitled workspace holding both folders; it comes back with the Project folder row reading "sub", its hover opening "Project folder: ${above2Sub}", the Aggrega workspace row naming "${ROOT_ABOVE_SUB}", and a language server working in ${above2} with no choice pending — neither "${PENDING_CHOICE_ACTION}" on the status bar nor "${pendingChoiceNotice(2)}", watched for ${QUIET_MS} ms; the interruption for a workspace above the folder is raised for it. The positive control, first: the same folder added from the same window with the editor's own Add Folder to Workspace, which carries no answer across, comes back offering that choice, read the same way`,
    plant: 'in the scratch copy, out/src/project-folder.js with the answer an add gives written into the window being left rather than carried into the one it makes',
  }, async () => {
    // The control: the editor's own add, then the window put back on the one folder.
    const controlMark = (await toasts(ctx.d)).length;
    const controlChange = await addWithTheEditorsCommand(ctx, ledger, above2Sub);
    const offered = await until('the choice offered after the editor\'s own add', 30000, () => pendingChoice(ctx, controlChange.reloaded ? 0 : controlMark), (v) => v.item && v.notices.length > 0).catch(() => pendingChoice(ctx, controlChange.reloaded ? 0 : controlMark));
    pendingSeen = offered.item && offered.notices.length > 0;
    need(pendingSeen, `its positive control did not fire: the editor's own add of ${above2Sub} came back with ${describePending(offered)}, so the reading of a pending choice is not shown to see one`);
    await openFolderHere(ctx, ledger, home);
    await ready(ctx);
    need(JSON.stringify((await openFolders(ctx)).map((f) => f.path)) === JSON.stringify([home]), `the window did not come back on ${home} alone after the control`);

    const toastMark = (await toasts(ctx.d)).length;
    const dialogMark = (await dialogsSeen(ctx.d)).length;
    const change = await changeWindow(ctx, ledger, async () => {
      await projectChooser(ctx);
      await takeToFolderDialog(ctx.d, ADD_ENTRY, ADD_DIALOG.title);
      await answerFolderDialog(ctx.d, above2Sub, ADD_DIALOG.accept);
    });
    const raised = await dialogFor(ctx);
    const folders = await openFolders(ctx);
    const title = await windowTitle(ctx.d);
    const rows = await waitRows(ctx, 'the rows naming the folder added', (r) => r[0]?.value === 'sub' && r[1]?.value === ROOT_ABOVE_SUB);
    const srv = await serverIn(ctx, above2);
    const noticeMark = change.reloaded ? 0 : toastMark;
    const none = await noChoicePending(ctx, noticeMark, QUIET_MS);
    const said = (await toastsSince(ctx.d, noticeMark)).map((t) => t.message).filter((m) => m.startsWith('Aggrega'));
    const dialogs = (await dialogsSeen(ctx.d)).slice(change.reloaded ? 0 : dialogMark);
    return {
      passed: change.restarted && !change.reloaded && folders.length === 2 && /Untitled \(Workspace\)/.test(title) && rows[0]?.value === 'sub' && rows[0].title.startsWith(`Project folder: ${above2Sub}`) && rows[1]?.value === ROOT_ABOVE_SUB
        && srv !== null && none.held && said.length === 0 && raised !== null,
      seen: `the control came back with ${describePending(offered)}; the add: the extensions ${change.restarted ? 'restarted' : 'did not restart'} and the window ${change.reloaded ? 'reloaded' : 'did not reload'} (${change.ms} ms); the window "${title}" holds ${JSON.stringify(folders.map((f) => f.path))}; the rows ${describeRows(rows)}, the Project folder hover ${JSON.stringify(rows[0]?.title ?? '')}; the language server ${srv !== null ? `works in ${above2}` : `works in ${serversWorking(ctx)}`}; ${none.held ? `no choice offered for ${QUIET_MS} ms` : describePending(none.broke)}; Aggrega notifications ${JSON.stringify(said)}; dialogs ${JSON.stringify(dialogs)}`,
    };
  });

  await c.run('project-folder.add-in-place-costs-nothing-and-says-where', {
    expected: `in that window on two folders the Project folder chooser lists both, and its add entry's second line reads "${ADD_DETAIL}" with no cost; taking it and picking ${addSub} neither reloads the window nor restarts the extensions (the extension host watched answering from the same start for ${QUIET_MS} ms), raises "${nowWorkingFrom(addSub)}" and "${nowWorkingIn(add)}", leaves the Project folder row naming "sub" with its hover opening "Project folder: ${addSub}", moves the language server to ${add}, and raises the interruption for the workspace above it`,
    plant: 'in the scratch copy, out/src/window-kind.js with a window on a workspace read as one whose add makes a new workspace',
  }, async () => {
    // The chooser is opened once, read, and its add entry taken from that same
    // opening: a second opening straight after closing one can meet the first
    // still closing on a loaded machine.
    let opened: Chooser | null = null;
    const toastMark = (await toasts(ctx.d)).length;
    const change = await changeWindow(ctx, ledger, async () => {
      opened = await projectChooser(ctx);
      await takeToFolderDialog(ctx.d, ADD_ENTRY, ADD_DIALOG.title);
      await answerFolderDialog(ctx.d, addSub, ADD_DIALOG.accept);
    }, { expectRestart: false, quietMs: QUIET_MS });
    const q = opened as Chooser | null;
    need(q !== null, 'the Project folder row\'s chooser was not read');
    const listed = q.rows.map((r) => r.description).filter((d) => d !== '');
    const addEntry = q.rows.find((r) => r.label === ADD_ENTRY);
    const from = await waitToast(ctx.d, 'the notice naming the folder', toastMark, (t) => t.message === nowWorkingFrom(addSub), 15000).then(() => true, () => false);
    const raised = await dialogFor(ctx);
    const srv = await serverIn(ctx, add);
    const rows = await waitRows(ctx, 'the Project folder row naming the folder added', (r) => r[0]?.title.startsWith(`Project folder: ${addSub}`) === true);
    const said = (await toastsSince(ctx.d, toastMark)).map((t) => t.message);
    return {
      passed: JSON.stringify(listed.sort()) === JSON.stringify([home, above2Sub].sort()) && addEntry?.detail === ADD_DETAIL && !change.restarted && !change.reloaded && from && said.includes(nowWorkingIn(add))
        && rows[0]?.value === 'sub' && srv !== null && raised !== null,
      seen: `the chooser listed ${entries(q)}; the add ${change.restarted ? 'restarted the extensions' : 'restarted nothing'} and ${change.reloaded ? 'reloaded the window' : 'kept the window'}; notifications ${JSON.stringify(said)}; the rows ${describeRows(rows)}, the Project folder hover ${JSON.stringify(rows[0]?.title ?? '')}; the language server ${srv !== null ? `works in ${add}` : `works in ${serversWorking(ctx)}`}; the interruption ${raised ? JSON.stringify(raised) : 'not raised'}`,
    };
  });

  await c.run('project-folder.open-replaces-and-leaves-nothing-behind', {
    expected: `from that window, taking "${OPEN_ENTRY}" and picking ${home} reloads the window holding ${home} alone, and no notice that a remembered choice was dropped is raised as it comes back (watched for ${QUIET_MS} ms once it is ready); the same observer read the notice a folder already open raised earlier in this scenario`,
    plant: 'in the scratch copy, out/src/project-folder.js with the open entry adding the folder picked beside the ones the window has',
  }, async () => {
    need(alreadyOpenSeen, 'its positive control did not fire: the notice for a folder already open was not read, so the notification reading is not shown to see one');
    let asked: DrawnDialog | null = null;
    const change = await changeWindow(ctx, ledger, async () => {
      await projectChooser(ctx);
      await takeToFolderDialog(ctx.d, OPEN_ENTRY, OPEN_DIALOG.title);
      await answerFolderDialog(ctx.d, home, OPEN_DIALOG.accept);
      // The window is leaving an untitled workspace, so the editor asks whether
      // to keep a file of it, as it does for File > Open Folder.
      asked = await answerWorkspaceSaveIfAsked(ctx.d);
    });
    await ready(ctx);
    const dropped = async (): Promise<string[]> => (await toasts(ctx.d)).map((t) => t.message).filter((m) => /dropped/.test(m));
    const quiet = await holds(QUIET_MS, dropped, (v) => v.length === 0);
    const folders = await openFolders(ctx);
    const question = asked as DrawnDialog | null;
    return { passed: change.reloaded && folders.length === 1 && folders[0].path === home && quiet.held, seen: `${question ? `the editor asked ${JSON.stringify(question.message)} and was answered "${EDITOR_DONT_SAVE}"; ` : ''}the window ${change.reloaded ? 'reloaded' : 'did not reload'} holding ${JSON.stringify(folders.map((f) => f.path))}; notices of a dropped choice ${quiet.held ? `none for ${QUIET_MS} ms` : JSON.stringify(quiet.broke)}` };
  });

  await c.run('workspace-row.no-folder-open-answers-with-the-ways-out', {
    expected: `in a window with no folder open at all, pressing the Aggrega workspace row raises "${NO_WORKSPACE}" and opens no chooser, watched for ${QUIET_MS} ms; in the same check the Project folder row pressed in that window opens a chooser the same observer records`,
    plant: 'in the scratch copy, out/src/extension.js with the Aggrega workspace row answering a window with no folder with a chooser',
  }, async () => {
    const change = await closeFolderHere(ctx, ledger);
    await readyAnyway(ctx);
    const folders = await openFolders(ctx);
    need(folders.length === 0, `closing the folder left the window holding ${JSON.stringify(folders.map((f) => f.path))}`);
    const toastMark = (await toasts(ctx.d)).length;
    const pickMark = (await pickersSeen(ctx.d)).length;
    await pressRow(ctx, 'workspace');
    const told = await waitToast(ctx.d, 'the answer', toastMark, (t) => t.message.startsWith('Aggrega'), 10000).catch(() => null);
    const noChooser = await holds(QUIET_MS, async () => (await pickersSeen(ctx.d)).slice(pickMark), (v) => v.length === 0);
    await closeChooser(ctx.d);
    // The control: a press that does open a chooser, recorded by the same observer.
    const controlMark = (await pickersSeen(ctx.d)).length;
    const controlled = await rowChooser(ctx, 'project', { done: () => true }).then(() => true, () => false);
    await closeChooser(ctx.d);
    const recorded = (await pickersSeen(ctx.d)).slice(controlMark);
    need(controlled && recorded.length > 0, `its positive control did not fire: pressing the Project folder row ${controlled ? 'drew its chooser, but the observer recorded nothing' : 'drew no chooser'}, so the observer is not shown to record one`);
    return { passed: told?.message === NO_WORKSPACE && noChooser.held, seen: `the window ${change.reloaded ? 'reloaded' : 'did not reload'} onto no folder; ${told ? `"${told.message}"` : 'no notification'}; ${noChooser.held ? `no chooser for ${QUIET_MS} ms` : `choosers drawn ${JSON.stringify(noChooser.broke)}`}; the control recorded ${JSON.stringify(recorded.map((p) => p.placeholder))}` };
  });

  await c.run('project-folder.row-in-a-window-with-no-folder', {
    expected: `in that window the Project folder row reads "none open" with the hover ${JSON.stringify(NO_FOLDER_HOVER)}; its chooser offers "${OPEN_ENTRY}" whose second line reads "${OPEN_DETAIL_EMPTY}", and picking ${home} there opens the window on that folder alone rather than on an untitled workspace`,
    plant: 'in the scratch copy, out/src/selector-rows.js with a window with no folder read as one with folders open and none chosen',
  }, async () => {
    const rows = await waitRows(ctx, 'the Project folder row reading none open', (r) => r[0]?.value === 'none open');
    // Opened once, read, and taken from, for the reason the add in place is.
    let opened: Chooser | null = null;
    const change = await changeWindow(ctx, ledger, async () => {
      opened = await projectChooser(ctx);
      await takeToFolderDialog(ctx.d, OPEN_ENTRY, OPEN_DIALOG.title);
      await answerFolderDialog(ctx.d, home, OPEN_DIALOG.accept);
    });
    const q = opened as Chooser | null;
    const openEntry = q?.rows.find((r) => r.label === OPEN_ENTRY);
    await ready(ctx);
    const folders = await openFolders(ctx);
    const title = await windowTitle(ctx.d);
    return {
      passed: rows[0]?.value === 'none open' && rows[0].title === NO_FOLDER_HOVER && openEntry?.detail === OPEN_DETAIL_EMPTY && folders.length === 1 && folders[0].path === home && !/Workspace\)/.test(title),
      seen: `the row read "${rows[0]?.value ?? ''}" with the hover ${JSON.stringify(rows[0]?.title ?? '')}; the chooser listed ${entries(q)}; the open ${change.reloaded ? 'reloaded' : 'did not reload'} the window "${title}" holding ${JSON.stringify(folders.map((f) => f.path))}`,
    };
  });

  const nested = path.join(home, 'nested');
  await c.run('workspace-row.last-entry-carries-the-workspace-chosen', {
    expected: `with ${path.join(nested, CONFIG_FILENAME)} written, in the window on ${home} alone, the Aggrega workspace row's last entry, "${WIDEN_ANOTHER}" with its second line ending "${LOCAL_ADD_COST.trim()}", opens a choice whose placeholder reads "${CHOOSE_FOLDER_PLACEHOLDER}", offering "nested" and "${OWN_ROOT}"; picking "nested" restarts the extensions onto an untitled workspace holding ${home} and ${nested}, which comes back with the Project folder row reading "none selected", the Aggrega workspace row naming "nested", and a language server working in ${nested} with no choice pending, watched for ${QUIET_MS} ms, although two workspaces are reached; the same reading saw the choice offered by the window the editor's own add made earlier in this scenario`,
    plant: 'in the scratch copy, out/src/get-started.js with the workspace picked through the last entry not carried into the window the add makes',
  }, async () => {
    need(pendingSeen, 'its positive control did not fire: the choice offered after the editor\'s own add was not read, so the reading of a pending choice is not shown to see one');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, CONFIG_FILENAME), WORKSPACE_ANCHOR_ONLY);
    const q = await rowChooser(ctx, 'workspace');
    const last = q.rows[q.rows.length - 1];
    let offered: Chooser | null = null;
    const toastMark = (await toasts(ctx.d)).length;
    const change = await changeWindow(ctx, ledger, async () => {
      await takeChooserRow(ctx.d, WIDEN_ANOTHER);
      offered = await waitChooser(ctx.d, 'the choice of a folder to work in', (x) => x.placeholder === CHOOSE_FOLDER_PLACEHOLDER && x.rows.length > 0, 20000);
      await takeChooserRow(ctx.d, 'nested');
    });
    const folders = await openFolders(ctx);
    const title = await windowTitle(ctx.d);
    const rows = await waitRows(ctx, 'the Aggrega workspace row naming nested', (r) => r[1]?.value === 'nested');
    const srv = await serverIn(ctx, nested);
    const none = await noChoicePending(ctx, change.reloaded ? 0 : toastMark, QUIET_MS);
    const labels = ((offered as Chooser | null)?.rows ?? []).map((r) => r.label).sort();
    return {
      passed: last.label === WIDEN_ANOTHER && last.detail.endsWith(LOCAL_ADD_COST.trim()) && JSON.stringify(labels) === JSON.stringify(['nested', OWN_ROOT].sort())
        && change.restarted && JSON.stringify(folders.map((f) => f.path).sort()) === JSON.stringify([home, nested].sort()) && /Untitled \(Workspace\)/.test(title)
        && rows[0]?.value === 'none selected' && rows[1]?.value === 'nested' && srv !== null && none.held,
      seen: `the last entry ${JSON.stringify([last.label, last.detail])}; the choice offered ${entries(offered)}; the extensions ${change.restarted ? 'restarted' : 'did not restart'} and the window ${change.reloaded ? 'reloaded' : 'did not reload'}; the window "${title}" holds ${JSON.stringify(folders.map((f) => f.path))}; the rows ${describeRows(rows)}; the language server ${srv !== null ? `works in ${nested}` : `works in ${serversWorking(ctx)}`}; ${none.held ? `no choice offered for ${QUIET_MS} ms` : describePending(none.broke)}`,
    };
  });
}
