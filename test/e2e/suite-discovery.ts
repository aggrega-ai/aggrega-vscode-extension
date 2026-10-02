// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { CONFIG_FILENAME } from '../../src/workspace';
import { need } from './checks';
import { WORKSPACE_ANCHOR_ONLY } from './fixtures';
import { Layout } from './layouts';
import {
  CONFIG_CREATED, closeChooser, describePending, describeRows, dialogsSeen, droppedAnchor, LevelRow, LOCAL_ADD_COST, NO_WORKSPACE, NO_WORKSPACE_HOVER,
  noChoicePending, NOTHING_TO_CHOOSE, nowWorkingIn, openFolderHere, PENDING_CHOICE_ACTION, pendingChoiceNotice, pickersSeen, pressRow, pressRowControl, readyAnyway,
  reloadWindow, rowChooser, rowsNow, serverIn, serversWorking, statusItem, takeChooserRow, ToastLedger, waitChooser, waitRows, WIDEN_ANOTHER, WIDEN_DETAIL, WIDEN_FIRST, WindowChange,
} from './levels';
import { capture, languageServers, SuiteContext } from './suite-context';
import { holds, NOT_RUNNING, pressToastButton, RUNNING, toasts, toastsSince, until, waitStatus, waitToast } from './workbench';

// The checks run over folder layouts that each place a workspace marker
// somewhere different relative to the folder opened, each opened alone in turn:
// none at all, where both rows still send the reader somewhere and the Aggrega
// workspace row's create control makes the folder a root; one marker beneath
// another; markers only below the folder opened, two and then one, a choice of
// one of them kept through a reload and dropped, and said to be, once its marker
// is gone; and the spellings that mark a root, each read on the row as the folder
// opens and again after a reload.

export const DISCOVERY_CHECKS = [
  'workspace-row.nothing-reachable-reads-none-available-and-the-ways-out',
  'release-row.no-workspace-in-use-answers-with-the-ways-out',
  'workspace-row.nothing-reachable-offers-only-the-first-folder-entry',
  'workspace-row.create-control-makes-the-folder-the-root',
  'workspace-discovery.a-marker-below-the-folder-is-offered-beside-it',
  'workspace-discovery.choosing-the-workspace-below-moves-there',
  'workspace-discovery.two-below-wait-for-a-choice',
  'workspace-discovery.a-choice-below-survives-a-reload-unsaid',
  'workspace-discovery.one-below-is-taken-without-a-press',
  'workspace-discovery.one-below-read-as-outside-the-folder',
  'workspace-discovery.one-below-survives-a-reload-unsaid',
  'workspace-discovery.a-remembered-workspace-whose-marker-is-gone-is-dropped-and-said',
  'workspace-discovery.root-marker-spellings-read-as-roots',
] as const;

// The layouts, each named by where its markers sit relative to the folder opened:
// none at all; one in the folder and one in sub/ below it; one in each of a/ and
// b/ below it and none in it; and one in sub/ below it alone.
const UNMARKED = 'unmarked';
const NESTED_ROOTS = 'nested-roots';
const TWO_BELOW = 'two-below';
const ONE_BELOW = 'one-below';

// Spelling is a layout whose one marker is spelled differently, with the value
// the Aggrega workspace row is to read for the folder named. `files` are written
// with the other layouts; `write` just before its folder is opened, since a
// Release beneath a folder read earlier would otherwise be found by the look
// inside that folder and change what its row reads.
export interface Spelling { folder: string; expect: string; says: string; files?: Readonly<Record<string, string>>; write?: Readonly<Record<string, string>> }

// YML_RELEASE is the folder holding only a Release named with the .yml spelling,
// which is also a folder holding nothing configured at all.
export const YML_RELEASE: Spelling = { folder: 'yml-release', expect: 'yml-release', says: 'a Release named with the .yml spelling', files: { 'release.yml': 'kind: Release\n' } };

export const SPELLINGS: readonly Spelling[] = [
  YML_RELEASE,
  { folder: 'quoted-key', expect: 'quoted-key', says: 'a workspace key written quoted', files: { [CONFIG_FILENAME]: '"workspace": {}\n' } },
  { folder: 'flow-key', expect: 'flow-key', says: 'a workspace key written in flow style', files: { [CONFIG_FILENAME]: '{workspace: {}}\n' } },
  { folder: 'block-text', expect: 'none available', says: 'a configuration that is one block of text, so no key', files: { [CONFIG_FILENAME]: '|\nworkspace: {}\n' } },
  { folder: path.join('block-text', 'svc'), expect: 'svc', says: 'a Release written beneath that configuration afterwards', write: { 'release.yaml': 'kind: Release\n' } },
];

export const DISCOVERY_FIRST = UNMARKED;
export const DISCOVERY_LAYOUTS: readonly Layout[] = [
  { folder: UNMARKED, files: {} },
  { folder: NESTED_ROOTS, files: { [CONFIG_FILENAME]: WORKSPACE_ANCHOR_ONLY, [path.join('sub', CONFIG_FILENAME)]: WORKSPACE_ANCHOR_ONLY } },
  { folder: TWO_BELOW, files: { [path.join('a', CONFIG_FILENAME)]: WORKSPACE_ANCHOR_ONLY, [path.join('b', CONFIG_FILENAME)]: WORKSPACE_ANCHOR_ONLY } },
  { folder: ONE_BELOW, files: { [path.join('sub', CONFIG_FILENAME)]: WORKSPACE_ANCHOR_ONLY } },
  ...SPELLINGS.filter((s) => s.files !== undefined).map((s) => ({ folder: s.folder, files: s.files ?? {} })),
];

// How long a folder is watched after it is opened, or after a reload, for a
// notice or an offer it must not raise, and how long a press is watched for a
// chooser it must not open.
const WATCH_MS = 4000;

// readyWithNothingReached waits for a window whose folder no marker reaches.
async function readyWithNothingReached(ctx: SuiteContext): Promise<void> {
  await waitStatus(ctx.d, NOT_RUNNING, 90000);
  await readyAnyway(ctx);
}

// workspaceEntries opens the Aggrega workspace row's chooser, reads its entries'
// labels, and closes it.
async function workspaceEntries(ctx: SuiteContext): Promise<string[]> {
  const q = await rowChooser(ctx, 'workspace').catch(() => null);
  await closeChooser(ctx.d);
  return (q?.rows ?? []).map((r) => r.label);
}

// rootOnHover reads the full path the Aggrega workspace row's hover names, or null.
function rootOnHover(row: LevelRow | undefined): string | null {
  const m = /^Aggrega workspace: (.+)$/m.exec(row?.title ?? '');
  return m ? m[1] : null;
}

export async function discoveryChecks(ctx: SuiteContext, layouts: string): Promise<void> {
  const c = ctx.checks;
  const none = ctx.folder;
  const ledger = new ToastLedger();
  // Whether the choice offered for two workspaces below the folder was read, which
  // is the positive control for the reading of a pending choice.
  let pendingSeen = false;
  await readyWithNothingReached(ctx);

  await c.run('workspace-row.nothing-reachable-reads-none-available-and-the-ways-out', {
    expected: `in a window on ${none}, which holds nothing and has nothing above it marking a workspace, the Aggrega workspace row reads "none available" and its hover gives the ways out rather than an instruction to choose: ${JSON.stringify(NO_WORKSPACE_HOVER)}`,
    plant: 'in the scratch copy, out/src/selector-rows.js with a project that reaches no Aggrega workspace read as one holding several with none chosen',
  }, async () => {
    const rows = await waitRows(ctx, 'the Aggrega workspace row reading none available', (r) => r[1]?.value === 'none available');
    return { passed: rows[1]?.value === 'none available' && rows[1].title === NO_WORKSPACE_HOVER, seen: `the rows ${describeRows(rows)}; the hover ${JSON.stringify(rows[1]?.title ?? '')}` };
  });

  await c.run('release-row.no-workspace-in-use-answers-with-the-ways-out', {
    expected: `with no Aggrega workspace in use, pressing the Release row raises "${NO_WORKSPACE}" and opens no chooser, watched for ${WATCH_MS} ms; in the same check the Aggrega workspace row pressed in that window opens a chooser the same observer records`,
    plant: 'in the scratch copy, out/src/extension.js with the Release row asking the selection for a chooser whether or not a workspace is in use',
  }, async () => {
    const toastMark = (await toasts(ctx.d)).length;
    const pickMark = (await pickersSeen(ctx.d)).length;
    await pressRow(ctx, 'release');
    const told = await waitToast(ctx.d, 'the answer', toastMark, (t) => t.message.startsWith('Aggrega'), 10000).catch(() => null);
    const noChooser = await holds(WATCH_MS, async () => (await pickersSeen(ctx.d)).slice(pickMark), (v) => v.length === 0);
    await closeChooser(ctx.d);
    // The control: a press that does open a chooser, recorded by the same observer.
    const controlMark = (await pickersSeen(ctx.d)).length;
    const controlled = await rowChooser(ctx, 'workspace', { done: () => true }).then(() => true, () => false);
    await closeChooser(ctx.d);
    const recorded = (await pickersSeen(ctx.d)).slice(controlMark);
    need(controlled && recorded.length > 0, `its positive control did not fire: pressing the Aggrega workspace row ${controlled ? 'drew its chooser, but the observer recorded nothing' : 'drew no chooser'}, so the observer is not shown to record one`);
    return { passed: told?.message === NO_WORKSPACE && noChooser.held, seen: `${told ? `"${told.message}"` : 'no notification'}; ${noChooser.held ? `no chooser for ${WATCH_MS} ms` : `choosers drawn ${JSON.stringify(noChooser.broke)}`}; the control recorded ${JSON.stringify(recorded.map((p) => p.placeholder))}` };
  });

  await c.run('workspace-row.nothing-reachable-offers-only-the-first-folder-entry', {
    expected: `pressing the Aggrega workspace row there opens a chooser holding only "${WIDEN_FIRST}", whose second line reads "${WIDEN_DETAIL}${LOCAL_ADD_COST}"; taking it raises "${NOTHING_TO_CHOOSE}"`,
    plant: 'in the scratch copy, out/src/anchor-picker.js with the last entry\'s label saying "another" whatever is reached',
  }, async () => {
    const q = await rowChooser(ctx, 'workspace');
    const toastMark = (await toasts(ctx.d)).length;
    await takeChooserRow(ctx.d, q.rows[0]?.label ?? WIDEN_FIRST);
    const told = await waitToast(ctx.d, 'the answer', toastMark, (t) => t.message.startsWith('Aggrega'), 15000).catch(() => null);
    return {
      passed: q.rows.length === 1 && q.rows[0].label === WIDEN_FIRST && q.rows[0].detail === `${WIDEN_DETAIL}${LOCAL_ADD_COST}` && told?.message === NOTHING_TO_CHOOSE,
      seen: `the chooser holds ${JSON.stringify(q.rows.map((r) => [r.label, r.detail]))}; taking it: ${told ? `"${told.message}"` : 'no notification'}`,
    };
  });

  await c.run('workspace-row.create-control-makes-the-folder-the-root', {
    expected: `pressing the Aggrega workspace row's create control writes ${CONFIG_FILENAME} into ${none}, opens it in a tab and raises a notification opening "${CONFIG_CREATED}"; the Aggrega workspace row then names "${UNMARKED}", a language server starts working in ${none} with no reload, and the Release row, over a workspace holding no Release, reads "none available"`,
    plant: 'in the scratch copy, out/src/selector-rows.js with the Aggrega workspace row\'s create control running the drafting of a Release',
  }, async () => {
    const config = path.join(none, CONFIG_FILENAME);
    need(!fs.existsSync(config), `${config} is already there`);
    const hello = await ctx.probe.request<{ instance: string }>('hello');
    const toastMark = (await toasts(ctx.d)).length;
    const pickMark = (await pickersSeen(ctx.d)).length;
    await pressRowControl(ctx, 'workspace', 'create');
    const told = await waitToast(ctx.d, 'the notice of the file written', toastMark, (t) => t.message.startsWith(`Aggrega: ${CONFIG_FILENAME}`), 20000).catch(() => null);
    const drawn = (await pickersSeen(ctx.d)).slice(pickMark).map((p) => p.title || p.placeholder);
    // A control that asks something rather than writing leaves its question open;
    // it is closed so the next check starts from the window as it stands.
    await closeChooser(ctx.d);
    const srv = await serverIn(ctx, none, 60000);
    const active = await ctx.probe.request<{ path: string } | null>('editor.active');
    const rows = await waitRows(ctx, 'the rows naming the folder', (r) => r[1]?.value === UNMARKED && r[2]?.value === 'none available');
    const same = (await ctx.probe.request<{ instance: string }>('hello')).instance === hello.instance;
    return {
      passed: fs.existsSync(config) && told !== null && told.message.startsWith(CONFIG_CREATED) && active?.path === config && rows[1]?.value === UNMARKED && rows[2]?.value === 'none available' && srv !== null && same,
      seen: `${told ? `"${told.message}"` : 'no notification'}; the press drew ${drawn.length === 0 ? 'no quick input' : `the quick inputs ${JSON.stringify(drawn)}`}; ${CONFIG_FILENAME} ${fs.existsSync(config) ? 'written' : 'not written'}; the tab in front ${active?.path ?? 'none'}; the rows ${describeRows(rows)}; the language server ${srv !== null ? `works in ${none}` : `works in ${serversWorking(ctx)}`}; the window ${same ? 'was not reloaded' : 'was reloaded'}`,
    };
  });

  // opened opens one layout in this window, alone, as File > Open Folder does.
  const opened = async (folder: string): Promise<WindowChange> => {
    const change = await openFolderHere(ctx, ledger, folder);
    await readyAnyway(ctx);
    return change;
  };

  const nest = path.join(layouts, NESTED_ROOTS);
  const nestSub = path.join(nest, 'sub');
  await c.run('workspace-discovery.a-marker-below-the-folder-is-offered-beside-it', {
    expected: `opening ${nest} alone, which carries a marker, as does ${nestSub} below it, starts a language server working in ${nest} straight away, and a moment later the Aggrega workspace chooser lists both "${NESTED_ROOTS}" and "sub", then "${WIDEN_ANOTHER}", without interrupting the reader about it: no choice offered — neither "${PENDING_CHOICE_ACTION}" on the status bar nor a notice asking for one — watched for ${WATCH_MS} ms; the same reading reads the choice offered in workspace-discovery.two-below-wait-for-a-choice, later in this scenario`,
    plant: 'in the scratch copy, out/src/extension.js with the look through what the folder holds never completing the workspaces on offer',
  }, async () => {
    const toastMark = (await toasts(ctx.d)).length;
    const change = await opened(nest);
    const srv = await serverIn(ctx, nest, 60000);
    const labels = await until('the chooser listing both workspaces', 30000, () => workspaceEntries(ctx), (v) => v.includes(NESTED_ROOTS) && v.includes('sub')).catch(() => workspaceEntries(ctx));
    const quiet = await noChoicePending(ctx, change.reloaded ? 0 : toastMark, WATCH_MS);
    return { passed: srv !== null && JSON.stringify(labels) === JSON.stringify([NESTED_ROOTS, 'sub', WIDEN_ANOTHER]) && quiet.held, seen: `the language server ${srv !== null ? `works in ${nest}` : `works in ${serversWorking(ctx)}`}; the chooser lists ${JSON.stringify(labels)}; ${quiet.held ? `no choice offered for ${WATCH_MS} ms` : describePending(quiet.broke)}` };
  });

  await c.run('workspace-discovery.choosing-the-workspace-below-moves-there', {
    expected: `choosing "sub" in that chooser raises "${nowWorkingIn(nestSub)}", moves the language server to ${nestSub} and leaves the Aggrega workspace row naming "sub"`,
    plant: 'in the scratch copy, out/src/anchor-picker.js with the guard against attaching again comparing the opened folders alone, so a second workspace reached from the same folder reads as the one in use',
  }, async () => {
    const toastMark = (await toasts(ctx.d)).length;
    await rowChooser(ctx, 'workspace', { done: (x) => x.rows.some((r) => r.label === 'sub') });
    await takeChooserRow(ctx.d, 'sub');
    const told = await waitToast(ctx.d, 'the notice naming the move', toastMark, (t) => t.message === nowWorkingIn(nestSub), 15000).then(() => true, () => false);
    const moved = await serverIn(ctx, nestSub, 20000);
    const rows = await waitRows(ctx, 'the Aggrega workspace row naming sub', (r) => r[1]?.value === 'sub', 10000);
    const said = (await toastsSince(ctx.d, toastMark)).map((t) => t.message);
    return { passed: told && moved !== null && rows[1]?.value === 'sub', seen: `notifications ${JSON.stringify(said)}; the language server ${moved !== null ? `works in ${nestSub}` : `works in ${serversWorking(ctx)}`}; the rows ${describeRows(rows)}` };
  });

  const below = path.join(layouts, TWO_BELOW);
  const belowA = path.join(below, 'a');
  await c.run('workspace-discovery.two-below-wait-for-a-choice', {
    expected: `opening ${below} alone, which nothing marks while both a/ and b/ beneath it carry a marker, a moment later offers the choice — "${PENDING_CHOICE_ACTION}" on the status bar and "${pendingChoiceNotice(2)}" — with no language server started; choosing "a" through the notice starts one working in ${belowA}`,
    plant: 'in the scratch copy, out/src/anchor-picker.js with a window reaching several Aggrega workspaces and remembering none attached to the first',
  }, async () => {
    await opened(below);
    const notice = await waitToast(ctx.d, 'the notice offering the choice', 0, (t) => t.message === pendingChoiceNotice(2), 30000).catch(() => null);
    const item = await until('the status bar offering the choice', 10000, () => statusItem(ctx, (i) => i.text === PENDING_CHOICE_ACTION), (v) => v !== undefined).catch(() => undefined);
    const idle = languageServers(ctx).length === 0;
    pendingSeen = notice !== null && item !== undefined;
    // A window that attaches to one of the two without asking draws no notice, and
    // that is this check failing rather than a precondition missing.
    if (notice === null) {
      return { passed: false, seen: `no notice "${pendingChoiceNotice(2)}" was drawn; the status bar ${item ? `offers "${item.text}"` : 'offers no choice'}; ${idle ? 'no language server ran' : `a language server ran, working in ${serversWorking(ctx)}`}` };
    }
    await pressToastButton(ctx.d, pendingChoiceNotice(2), PENDING_CHOICE_ACTION);
    await waitChooser(ctx.d, 'the Aggrega workspace chooser', (x) => x.rows.some((r) => r.label === 'a'), 10000);
    await takeChooserRow(ctx.d, 'a');
    const srv = await serverIn(ctx, belowA, 60000);
    return { passed: item !== undefined && idle && srv !== null, seen: `the notice drawn; the status bar ${item ? `offers "${item.text}"` : 'offers no choice'}; before the choice ${idle ? 'no language server ran' : 'a language server ran'}; after it ${srv !== null ? `one works in ${belowA}` : `none works in ${belowA}`}` };
  });

  await c.run('workspace-discovery.a-choice-below-survives-a-reload-unsaid', {
    expected: `the window reloaded comes back working in ${belowA} as chosen, and says nothing: no notice that the remembered choice was dropped and no choice offered again, watched for ${WATCH_MS} ms once a language server works there; the same reading of the notifications reads the drop raised in workspace-discovery.a-remembered-workspace-whose-marker-is-gone-is-dropped-and-said, later in this scenario`,
    plant: 'in the scratch copy, out/src/workspace.js with a remembered workspace judged on the walk up from the folder alone',
  }, async () => {
    await reloadWindow(ctx, ledger);
    await readyAnyway(ctx);
    const srv = await serverIn(ctx, belowA, 60000);
    const unsaid = (said: string[]): boolean => !said.some((m) => m === droppedAnchor(path.join(belowA, CONFIG_FILENAME)) || /no longer marks/.test(m) || m === pendingChoiceNotice(2));
    const aggrega = async (): Promise<string[]> => (await toasts(ctx.d)).map((t) => t.message).filter((m) => m.startsWith('Aggrega'));
    const quiet = await holds(WATCH_MS, aggrega, unsaid);
    const said = await aggrega();
    const rows = await rowsNow(ctx);
    return { passed: srv !== null && rows[1]?.value === 'a' && quiet.held, seen: `the language server ${srv !== null ? `works in ${belowA}` : `works in ${serversWorking(ctx)}`}; the rows ${describeRows(rows)}; Aggrega notifications ${JSON.stringify(said)}${quiet.held ? `, none of them a drop or a new offer for ${WATCH_MS} ms` : ''}` };
  });

  const inside = path.join(layouts, ONE_BELOW);
  const insideSub = path.join(inside, 'sub');
  let insideRows: LevelRow[] = [];
  let insideDialogs = 0;
  await c.run('workspace-discovery.one-below-is-taken-without-a-press', {
    expected: `opening ${inside} alone, which nothing marks while sub/ beneath it carries a marker, a moment later starts a language server working in ${insideSub} with no press, and no choice is offered — neither "${PENDING_CHOICE_ACTION}" on the status bar nor a notice asking for one — watched for ${WATCH_MS} ms; the Project folder row reads "${ONE_BELOW}" and the Aggrega workspace row "sub"; the same reading read the choice offered for the two workspaces below the folder before`,
    plant: 'in the scratch copy, out/src/anchor-picker.js with a window reaching one Aggrega workspace asking the reader to choose it',
  }, async () => {
    need(pendingSeen, 'its positive control did not fire: the choice offered for the two workspaces below the folder was not read, so the reading of a pending choice is not shown to see one');
    await opened(inside);
    const srv = await serverIn(ctx, insideSub, 60000);
    await waitStatus(ctx.d, RUNNING, 30000).catch(() => undefined);
    insideRows = await waitRows(ctx, 'the rows naming the folder and the workspace below it', (r) => r[0]?.value === ONE_BELOW && r[1]?.value === 'sub');
    const quiet = await noChoicePending(ctx, 0, WATCH_MS);
    insideDialogs = (await dialogsSeen(ctx.d)).length;
    return { passed: srv !== null && insideRows[0]?.value === ONE_BELOW && insideRows[1]?.value === 'sub' && quiet.held, seen: `the language server ${srv !== null ? `works in ${insideSub}` : `works in ${serversWorking(ctx)}`}; the rows ${describeRows(insideRows)}; ${quiet.held ? `no choice offered for ${WATCH_MS} ms` : describePending(quiet.broke)}` };
  });

  await c.forPerson('workspace-discovery.one-below-read-as-outside-the-folder', {
    expected: 'with the Aggrega workspace inside the folder opened, the Aggrega workspace row says nothing false about where it sits',
    plant: 'none: whether the row\'s sentence reads as false here is a judgement of the wording',
    question: `The workspace here sits INSIDE the folder opened (${ONE_BELOW}/sub, opened as ${ONE_BELOW}). The capture and the text below show whether the Aggrega workspace row carries the warning mark and the sentence saying the workspace is from outside the folder you opened, and whether the interruption was raised. Do you see the mark, and does the sentence read as false to you?`,
  }, async () => {
    need(insideRows.length >= 3, 'the rows for the folder with its workspace below it were not read');
    const row = insideRows[1];
    return {
      screenshot: await capture(ctx, 'workspace-inside-the-folder-opened'),
      drawnText: `Aggrega workspace row: "${row.value}"; the warning mark ${row.mark ? `drawn, named ${JSON.stringify(row.mark.name)}` : 'not drawn'}; the open control ${row.offer ? `drawn, named ${JSON.stringify(row.offer.name)}` : 'not drawn'}\nhover: ${row.title}\ninterruptions raised since the folder was opened: ${insideDialogs}`,
    };
  });

  await c.run('workspace-discovery.one-below-survives-a-reload-unsaid', {
    expected: `the window reloaded comes back working in ${insideSub} again, and says nothing: no notice that a remembered choice was dropped, watched for ${WATCH_MS} ms once a language server works there; the same reading of the notifications reads the drop raised in workspace-discovery.a-remembered-workspace-whose-marker-is-gone-is-dropped-and-said, later in this scenario`,
    plant: 'in the scratch copy, out/src/workspace.js with a remembered workspace judged on the walk up from the folder alone',
  }, async () => {
    await reloadWindow(ctx, ledger);
    await readyAnyway(ctx);
    const srv = await serverIn(ctx, insideSub, 60000);
    const aggrega = async (): Promise<string[]> => (await toasts(ctx.d)).map((t) => t.message).filter((m) => m.startsWith('Aggrega'));
    const quiet = await holds(WATCH_MS, aggrega, (said) => !said.some((m) => /no longer marks|was dropped/.test(m)));
    const said = await aggrega();
    return { passed: srv !== null && quiet.held, seen: `the language server ${srv !== null ? `works in ${insideSub}` : `works in ${serversWorking(ctx)}`}; Aggrega notifications ${JSON.stringify(said)}${quiet.held ? `, none of them a drop for ${WATCH_MS} ms` : ''}` };
  });

  // The marker is moved aside rather than deleted, so the layout is whole again
  // for anything that opens it afterwards.
  const insideMarker = path.join(insideSub, CONFIG_FILENAME);
  await c.run('workspace-discovery.a-remembered-workspace-whose-marker-is-gone-is-dropped-and-said', {
    expected: `with ${insideMarker} moved aside, the window reloaded raises "${droppedAnchor(insideMarker)}", the Aggrega workspace row reads "none available", and no language server runs, watched for ${WATCH_MS} ms once the row reads so`,
    plant: 'in the scratch copy, out/src/extension.js with a remembered choice never dropped, whether or not its marker still marks a workspace the folder reaches',
  }, async () => {
    need(fs.existsSync(insideMarker), `${insideMarker} is not there to move aside`);
    const aside = `${insideMarker}.aside`;
    fs.renameSync(insideMarker, aside);
    try {
      await reloadWindow(ctx, ledger);
      await readyAnyway(ctx);
      // Waited for by the reading the two reloads before it held an absence over,
      // so this is the drop that reading is shown to see.
      const told = await waitToast(ctx.d, 'a notice that the remembered choice was dropped', 0, (t) => /no longer marks|was dropped/.test(t.message), 20000).catch(() => null);
      const rows = await waitRows(ctx, 'the Aggrega workspace row reading none available', (r) => r[1]?.value === 'none available', 20000);
      const idle = await holds(WATCH_MS, async () => languageServers(ctx).length, (n) => n === 0);
      const said = (await toasts(ctx.d)).map((t) => t.message).filter((m) => m.startsWith('Aggrega'));
      return {
        passed: told?.message === droppedAnchor(insideMarker) && rows[1]?.value === 'none available' && idle.held,
        seen: `${told ? `"${told.message}"` : 'no notice of a drop within 20000 ms'}; Aggrega notifications ${JSON.stringify(said)}; the rows ${describeRows(rows)}; ${idle.held ? `no language server for ${WATCH_MS} ms` : `a language server working in ${serversWorking(ctx)}`}`,
      };
    } finally {
      fs.renameSync(aside, insideMarker);
    }
  });

  // Which root the compiler finds for each spelling is the compiler's own to
  // answer, and the language server pins to whatever root it is handed rather than
  // finding one, so no answer taken from it here would be its own; what is read is
  // what the editor draws, before and after a reload.
  await c.run('workspace-discovery.root-marker-spellings-read-as-roots', {
    expected: `each layout opened alone reads on the Aggrega workspace row as its spelling says — ${SPELLINGS.map((s) => `${s.folder} (${s.says}): "${s.expect}"`).join('; ')} — and reads the same after a reload`,
    plant: 'in the scratch copy, out/src/workspace.js with the .yml spelling of a Release marking no root',
  }, async () => {
    const seen: string[] = [];
    let passed = true;
    for (const s of SPELLINGS) {
      const folder = path.join(layouts, s.folder);
      for (const [rel, content] of Object.entries(s.write ?? {})) {
        fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
        fs.writeFileSync(path.join(folder, rel), content);
      }
      await opened(folder);
      if (s.expect !== 'none available') { await waitStatus(ctx.d, RUNNING, 60000).catch(() => undefined); }
      const first = await waitRows(ctx, `the Aggrega workspace row reading "${s.expect}"`, (r) => r[1]?.value === s.expect, 20000);
      await reloadWindow(ctx, ledger);
      await readyAnyway(ctx);
      if (s.expect !== 'none available') { await waitStatus(ctx.d, RUNNING, 60000).catch(() => undefined); }
      const again = await waitRows(ctx, `the Aggrega workspace row reading "${s.expect}" after the reload`, (r) => r[1]?.value === s.expect, 20000);
      const ok = first[1]?.value === s.expect && again[1]?.value === s.expect;
      passed = passed && ok;
      seen.push(`${s.folder}: "${first[1]?.value ?? ''}", after a reload "${again[1]?.value ?? ''}"; the row's hover names the root ${rootOnHover(first[1]) ?? 'none'}`);
    }
    return { passed, seen: seen.join('; ') };
  });
}
