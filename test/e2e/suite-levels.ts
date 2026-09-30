// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { RESTART_COMMAND } from '../../src/daemon-status';
import { CONFIG_FILENAME } from '../../src/workspace';
import { need } from './checks';
import {
  ADD_ENTRY, closeChooser, CREATE_RELEASE, CREATE_WORKSPACE, describeRows, droppedRelease, HOVER_LINES_NO_ROW_CARRIES, LEVEL_OBSERVERS, LevelRow, linesOf, NAME_PROMPT, needRows,
  OPEN_ENTRY, PLACEHOLDER, pickersSeen, pressRowControl, projectHover, releaseHover, reloadWindow, ROW_LABELS, rowChooser, rowsNow, rowValues, SENTENCES_NO_SURFACE_DRAWS,
  serverStarts, statusHover, takeChooserRow, ToastLedger, waitRows, WIDEN_ANOTHER, workspaceHover,
} from './levels';
import { capture, languageServers, ready, reopen, send, SuiteContext, theServer } from './suite-context';
import { setBinaryPath } from './suite-killed';
import { holds, NOT_RUNNING, RUNNING, STARTING, statusItems, statusLog, toasts, toastsSince, until, waitStatus, waitToast } from './workbench';

// The checks run in a folder that is its own Aggrega workspace and holds two
// Releases with no default: the three rows that say which folder, which Aggrega
// workspace and which Release the editor works on, as drawn, as hovered and as
// pressed; that a level with one candidate is taken with no chooser, and that
// choosing where the editor already is restarts nothing; and that the Release
// chosen is remembered for the window through a reload and a reopen, and said to
// be dropped when it stops being offered.

export const LEVELS_CHECKS = [
  'context-rows.sole-candidates-taken-without-a-chooser',
  'context-rows.three-rows-on-lines-of-their-own',
  'context-rows.values-read-whole-at-the-default-width',
  'context-rows.create-controls-beside-the-workspace-and-release-rows',
  'context-rows.values-start-in-line',
  'context-rows.each-row-opens-its-own-chooser',
  'release-row.create-control-asks-only-for-the-name',
  'context-rows.choosing-where-you-are-restarts-nothing',
  'context-rows.hovers-promise-a-choice',
  'release-selection.survives-a-window-reload',
  'release-selection.survives-closing-and-reopening-the-window',
  'release-selection.one-no-longer-offered-falls-back-and-says-so',
  'release-row.reads-unavailable-with-the-server-stopped',
  'context-rows.no-surface-refuses-a-sole-candidate-or-promises-a-switch',
] as const;

const LOCAL = 'release-local.yaml';
const STAGING = 'release-staging.yaml';

// How long a choice of where the editor already is, is watched for anything
// being stopped or started.
const QUIET_MS = 5000;

export async function levelsChecks(ctx: SuiteContext, missing: string): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  const base = path.basename(ctx.folder);
  const ledger = new ToastLedger();
  // Every hover and value a row drew during the scenario, for the last check.
  const drawn: string[] = [];
  const keep = (rows: readonly LevelRow[]): LevelRow[] => { drawn.push(...rows.flatMap((r) => [r.value, r.title])); return [...rows]; };
  await ready(ctx);

  await c.run('context-rows.sole-candidates-taken-without-a-chooser', {
    expected: `with one folder open and one Aggrega workspace reached, the window comes up with the Project folder and Aggrega workspace rows naming "${base}" and the language server running, and no chooser is drawn between the window's first drawing and the first press; the same observer records the chooser the Project folder row opens when it is pressed`,
    plant: 'in the scratch copy, out/src/project-folder.js with a window\'s sole open folder left unchosen',
  }, async () => {
    const rows = keep(await waitRows(ctx, 'the two rows naming the folder', (r) => r.length >= 3 && r[0].value === base && r[1].value === base));
    const running = (await statusLog(ctx.d)).some((r) => r.reading === RUNNING);
    const before = await pickersSeen(ctx.d);
    const opened = await rowChooser(ctx, 'project', { done: () => true }).then(() => true, () => false);
    await closeChooser(ctx.d);
    const after = await pickersSeen(ctx.d);
    need(opened && after.length > before.length, `its positive control did not fire: pressing the Project folder row drew ${opened ? 'its chooser, but the observer recorded nothing' : 'no chooser'}, so the reading is not shown to see one`);
    return {
      passed: rows[0].value === base && rows[1].value === base && running && before.length === 0,
      seen: `the rows ${describeRows(rows)}; the language server ${running ? 'running' : 'not running'}; choosers drawn before the first press: ${before.length === 0 ? 'none' : JSON.stringify(before)}; the press drew ${JSON.stringify(after.slice(before.length).map((p) => p.placeholder))}`,
    };
  });

  await c.run('context-rows.three-rows-on-lines-of-their-own', {
    expected: `the Commands panel's first three rows read ${ROW_LABELS.map((l) => `"${l}"`).join(', ')}, in that order, each on a line of its own with its value on one line, the Project folder and Aggrega workspace rows both naming "${base}" — the folder opened is its own root — and the Release row reading "none selected" with two Releases and no default; no row is labelled "Workspace" alone`,
    plant: 'in the scratch copy, out/src/selector-levels.js with the first context row\'s label changed',
  }, async () => {
    const rows = keep(await rowsNow(ctx));
    needRows(rows);
    const three = rows.slice(0, 3);
    const labels = three.map((r) => r.label);
    const stacked = three.every((r, i) => i === 0 || three[i - 1].row.y + three[i - 1].row.height <= r.row.y + 1);
    const oneLine = three.every((r) => r.valueLines === 1);
    const values = rowValues(rows);
    return {
      passed: JSON.stringify(labels) === JSON.stringify(ROW_LABELS) && stacked && oneLine && JSON.stringify(values) === JSON.stringify([base, base, 'none selected']) && !labels.includes('Workspace'),
      seen: `${describeRows(three)}; ${stacked ? 'each on a line of its own' : `drawn at ${JSON.stringify(three.map((r) => r.row))}`}; values ${oneLine ? 'each on one line' : `drawn on ${JSON.stringify(three.map((r) => r.valueLines))} lines`}`,
    };
  });

  await c.forPerson('context-rows.values-read-whole-at-the-default-width', {
    expected: 'at the side bar\'s default width each row\'s value can be read without pressing the row; where the panel cuts a value off, its hover carries it whole',
    plant: 'none: whether a value cut off still says what is selected is a judgement of the drawing',
    question: 'The capture shows the three rows at the side bar\'s default width, and the text below says, for each row, its whole value and whether the panel cuts it off. Does any row cut its value off to the point where you would have to press it to find out what is selected?',
  }, async () => {
    const rows = keep(await rowsNow(ctx));
    needRows(rows);
    return {
      screenshot: await capture(ctx, 'context-rows-at-the-default-width'),
      drawnText: rows.slice(0, 3).map((r) => `${r.label}: "${r.value}" — ${r.valueClipped ? `cut off in ${Math.round(r.valueBox.width)} px` : 'drawn whole'}; hover ${JSON.stringify(r.title)}`).join('\n'),
    };
  });

  await c.run('context-rows.create-controls-beside-the-workspace-and-release-rows', {
    expected: `the Aggrega workspace and Release rows each carry a control of their own beside the choosing control and outside it, whose hover and accessible name read "${CREATE_WORKSPACE}" and "${CREATE_RELEASE}"; the Project folder row carries none, and an empty space as wide as those controls holds its place, so the three choosing controls start and end in line and the three values end in line`,
    plant: 'in the scratch copy, out/src/operations-render.js with the empty space on a row without a create control left out',
  }, async () => {
    const rows = keep(await rowsNow(ctx));
    needRows(rows);
    const [p, w, r] = rows;
    const ownControl = (row: LevelRow, name: string): boolean => row.create !== null && row.create.name === name && row.create.title === name && !row.create.insideChooser && row.create.box.x >= row.chooser.x + row.chooser.width - 1;
    const gap = p.create === null && p.createGap !== null && w.create !== null && Math.abs(p.createGap.width - w.create.box.width) <= 1;
    const inLine = (f: (x: LevelRow) => number): boolean => rows.slice(0, 3).every((x) => Math.abs(f(x) - f(p)) <= 1);
    const aligned = inLine((x) => x.chooser.x) && inLine((x) => x.chooser.x + x.chooser.width) && inLine((x) => x.valueBox.x + x.valueBox.width);
    return {
      passed: ownControl(w, CREATE_WORKSPACE) && ownControl(r, CREATE_RELEASE) && gap && aligned,
      seen: `the Aggrega workspace row's control ${JSON.stringify(w.create)}; the Release row's ${JSON.stringify(r.create)}; the Project folder row's ${p.create === null ? 'none' : JSON.stringify(p.create)}, its empty space ${JSON.stringify(p.createGap)}; the choosing controls ${JSON.stringify(rows.slice(0, 3).map((x) => [Math.round(x.chooser.x), Math.round(x.chooser.x + x.chooser.width)]))}, the values end at ${JSON.stringify(rows.slice(0, 3).map((x) => Math.round(x.valueBox.x + x.valueBox.width)))}`,
    };
  });

  await c.run('context-rows.values-start-in-line', {
    expected: 'the three rows\' values start in line with one another, as they end in line, so the three answers are read down the panel as one column',
    plant: 'red on the product as it stands; a correction in the scratch copy, media/operations.css with the rows\' labels given one width, turns it green',
  }, async () => {
    const rows = keep(await rowsNow(ctx));
    needRows(rows);
    const starts = rows.slice(0, 3).map((x) => Math.round(x.valueBox.x));
    return { passed: starts.every((s) => Math.abs(s - starts[0]) <= 1), seen: `the values start at ${JSON.stringify(starts)} px across the panel, after labels ${JSON.stringify(rows.slice(0, 3).map((x) => x.label))}` };
  });

  await c.run('context-rows.each-row-opens-its-own-chooser', {
    expected: `in this one-folder window, pressing each row opens a chooser of its own and no notification: the Project folder row's placeholder reads "${PLACEHOLDER.project}", listing "${base}" with its full path beside it, then "${OPEN_ENTRY}" and "${ADD_ENTRY}"; the Aggrega workspace row's "${PLACEHOLDER.workspace}", listing "${base}" with its full path beside it and "${CONFIG_FILENAME}" beneath, then "${WIDEN_ANOTHER}"; the Release row's "${PLACEHOLDER.release}", listing ${LOCAL} and ${STAGING}; and choosing ${STAGING} there makes the Release row read it`,
    plant: 'in the scratch copy, out/src/anchor-picker.js with the Aggrega workspace chooser carrying the Release chooser\'s placeholder',
  }, async () => {
    const toastMark = (await toasts(ctx.d)).length;
    const seen: string[] = [];
    // Each chooser is read whatever placeholder it carries, since which one it
    // carries is part of what this check reads.
    const project = await rowChooser(ctx, 'project', { anyPlaceholder: true });
    await closeChooser(ctx.d);
    const workspace = await rowChooser(ctx, 'workspace', { anyPlaceholder: true });
    await closeChooser(ctx.d);
    const release = await rowChooser(ctx, 'release', { anyPlaceholder: true });
    await takeChooserRow(ctx.d, STAGING);
    const rows = keep(await waitRows(ctx, `the Release row naming ${STAGING}`, (r) => r[2]?.value === STAGING, 15000));
    const told = (await toastsSince(ctx.d, toastMark)).map((t) => t.message);
    for (const [name, q] of [['Project folder', project], ['Aggrega workspace', workspace], ['Release', release]] as const) {
      seen.push(`${name}: "${q.placeholder}" ${JSON.stringify(q.rows.map((x) => [x.label, x.description, x.detail]))}`);
    }
    const labels = (q: typeof project): string[] => q.rows.map((x) => x.label);
    const ok = project.placeholder === PLACEHOLDER.project && JSON.stringify(labels(project)) === JSON.stringify([base, OPEN_ENTRY, ADD_ENTRY]) && project.rows[0].description === ctx.folder
      && workspace.placeholder === PLACEHOLDER.workspace && JSON.stringify(labels(workspace)) === JSON.stringify([base, WIDEN_ANOTHER]) && workspace.rows[0].description === ctx.folder && workspace.rows[0].detail === CONFIG_FILENAME
      && release.placeholder === PLACEHOLDER.release && JSON.stringify([...labels(release)].sort()) === JSON.stringify([LOCAL, STAGING])
      && rows[2]?.value === STAGING && told.length === 0;
    return { passed: ok, seen: `${seen.join('; ')}; the Release row then reads "${rows[2]?.value ?? ''}"; notifications ${told.length === 0 ? 'none' : JSON.stringify(told)}` };
  });

  await c.run('release-row.create-control-asks-only-for-the-name', {
    expected: `pressing the Release row's value opens its chooser; pressing the Release row's create control instead opens the drafting flow with the kind already settled — the first quick input drawn after the press asks only for a name, its prompt reading "${NAME_PROMPT}", with no list of kinds before it; the check then closes it with Escape`,
    plant: 'in the scratch copy, out/src/get-started.js with the Release row\'s create control opening the drafting flow with no kind settled',
  }, async () => {
    const chooserOpened = await rowChooser(ctx, 'release', { done: () => true }).then(() => true, () => false);
    await closeChooser(ctx.d);
    const mark = (await pickersSeen(ctx.d)).length;
    await pressRowControl(ctx, 'release', 'create');
    const first = await until('a quick input after the press', 20000, async () => (await pickersSeen(ctx.d)).slice(mark), (v) => v.length > 0).catch(async () => (await pickersSeen(ctx.d)).slice(mark));
    await until('the flow settling', 3000, async () => (await pickersSeen(ctx.d)).slice(mark), (v) => v.some((p) => p.message.includes(NAME_PROMPT))).catch(() => undefined);
    const all = (await pickersSeen(ctx.d)).slice(mark);
    await closeChooser(ctx.d);
    // The editor appends its own instruction for confirming or cancelling after the
    // prompt, so the prompt is read as what the message opens with.
    return {
      passed: chooserOpened && first.length > 0 && first[0].message.startsWith(NAME_PROMPT) && first[0].rows === 0,
      seen: `the value's press ${chooserOpened ? 'opened the Release chooser' : 'opened no Release chooser'}; after the create control's press the quick inputs drawn were ${JSON.stringify(all)}`,
    };
  });

  await c.run('context-rows.choosing-where-you-are-restarts-nothing', {
    expected: `with the language server running and ${STAGING} selected, choosing on the Aggrega workspace row the entry it already names, and then on the Project folder row the folder it already names, each opens its chooser and then stops nothing and starts nothing — the same language server process throughout, no "starting" reading on the status bar, no language server start on the output channel, no notification, watched for ${QUIET_MS} ms — and ${STAGING} is still selected; in the same check a restart asked for with the restart command shows each of those observations firing`,
    plant: 'in the scratch copy, out/src/extension.js with a choice on the Aggrega workspace row restarting the language server, whichever workspace is chosen',
  }, async () => {
    const rowsBefore = keep(await rowsNow(ctx));
    need(rowsBefore[2]?.value === STAGING, `the Release row reads "${rowsBefore[2]?.value ?? ''}", not ${STAGING}, so there is no selection to keep`);
    const srv = await theServer(ctx);
    const statusMark = (await statusLog(ctx.d)).length;
    const chan = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    const pickMark = (await pickersSeen(ctx.d)).length;
    await rowChooser(ctx, 'workspace');
    await takeChooserRow(ctx.d, base);
    await closeChooser(ctx.d);
    await rowChooser(ctx, 'project');
    await takeChooserRow(ctx.d, base);
    await closeChooser(ctx.d);
    const reading = async (): Promise<{ pids: number[]; starting: boolean; starts: number; told: string[] }> => ({
      pids: languageServers(ctx).map((s) => s.pid),
      starting: (await statusLog(ctx.d)).slice(statusMark).some((r) => r.reading === STARTING),
      starts: serverStarts(ctx.out.since(chan)),
      told: (await toastsSince(ctx.d, toastMark)).map((t) => t.message),
    });
    const quiet = await holds(QUIET_MS, reading, (v) => v.pids.length === 1 && v.pids[0] === srv.pid && !v.starting && v.starts === 0 && v.told.length === 0);
    const pickers = (await pickersSeen(ctx.d)).slice(pickMark).map((p) => p.placeholder);
    const rows = keep(await rowsNow(ctx));
    // The control: a restart asked for, read the same way, against the process
    // running when it is asked for.
    const cBefore = await theServer(ctx);
    const cStatus = (await statusLog(ctx.d)).length;
    const cChan = ctx.out.mark();
    await send(ctx, RESTART_COMMAND);
    const next = await theServer(ctx, 30000, cBefore.pid).then((s) => s.pid, () => null);
    await waitStatus(ctx.d, RUNNING, 60000).catch(() => undefined);
    const cStarting = (await statusLog(ctx.d)).slice(cStatus).some((r) => r.reading === STARTING);
    const cStarts = await until('the restart reaching the channel', 30000, async () => serverStarts(ctx.out.since(cChan)), (n) => n > 0).catch(() => 0);
    // A restart shows as a new process, and as a "starting" reading or a start on
    // the channel; the "starting" reading can be too short to be drawn when one
    // restart follows close on another, so either of the two is enough beside the
    // new process.
    need(next !== null && (cStarting || cStarts > 0), `its positive control did not fire: the restart asked for gave ${next === null ? 'no new process' : `process ${next}`}, ${cStarting ? 'a' : 'no'} "starting" reading and ${cStarts} start(s) on the channel`);
    const bothOpened = pickers.includes(PLACEHOLDER.workspace) && pickers.includes(PLACEHOLDER.project);
    return {
      passed: quiet.held && bothOpened && rows[2]?.value === STAGING,
      seen: `${quiet.held ? `the same process ${srv.pid}, no "starting" reading, no start on the channel and no notification for ${QUIET_MS} ms` : `at ${quiet.atMs} ms: ${JSON.stringify(quiet.broke)}`}; the choosers drawn ${JSON.stringify(pickers)}; the Release row "${rows[2]?.value ?? ''}"; the control restarted into process ${next}, with ${cStarting ? 'a' : 'no'} "starting" reading and ${cStarts} start(s) on the channel`,
    };
  });

  await c.run('context-rows.hovers-promise-a-choice', {
    expected: `with ${STAGING} selected in this one-folder window, the rows' hovers read, line for line: ${JSON.stringify(projectHover(ctx.folder, true))}, ${JSON.stringify(workspaceHover(ctx.folder))} and ${JSON.stringify(releaseHover(path.join(ctx.folder, STAGING)))}; the status bar's Release indicator's hover carries the Release row's lines; no row carries ${HOVER_LINES_NO_ROW_CARRIES.map((l) => `"${l}"`).join(', ')}`,
    plant: 'in the scratch copy, out/src/release-selection.js with the Release hover\'s closing line ending in a lowercase "release."',
  }, async () => {
    const rows = keep(await waitRows(ctx, `the Release row naming ${STAGING}`, (r) => r[2]?.value === STAGING));
    needRows(rows);
    const want = [projectHover(ctx.folder, true), workspaceHover(ctx.folder), releaseHover(path.join(ctx.folder, STAGING))];
    const matches = rows.slice(0, 3).map((r, i) => r.title === want[i]);
    const indicator = await statusHover(ctx, (i) => i.side === 'left' && i.text === STAGING);
    const indicatorLines = indicator === null ? [] : linesOf(indicator.hover);
    const sameAsRow = JSON.stringify(indicatorLines) === JSON.stringify(linesOf(want[2]));
    const carried = rows.slice(0, 3).flatMap((r) => HOVER_LINES_NO_ROW_CARRIES.filter((l) => r.title.includes(l)));
    return {
      passed: matches.every((m) => m) && sameAsRow && carried.length === 0,
      seen: `the hovers ${JSON.stringify(rows.slice(0, 3).map((r) => r.title))}; the Release indicator's ${indicator === null ? 'not drawn' : JSON.stringify(indicator.hover)}; lines no row is to carry, found ${JSON.stringify(carried)}`,
    };
  });

  await c.run('release-selection.survives-a-window-reload', {
    expected: `with ${STAGING} chosen, the window reloaded (Developer: Reload Window) comes back — the probe answering from a new start in a new document — with the Release row and the status bar's Release indicator still naming ${STAGING}`,
    plant: 'in the scratch copy, out/src/release-selection.js with a chosen Release not remembered for the window',
  }, async () => {
    const change = await reloadWindow(ctx, ledger);
    await ready(ctx);
    const rows = keep(await waitRows(ctx, `the Release row naming ${STAGING}`, (r) => r[2]?.value === STAGING));
    const indicator = await until('the Release indicator', 10000, () => statusItems(ctx.d), (v) => v.some((i) => i.side === 'left' && i.text === STAGING)).then(() => true, () => false);
    return { passed: change.restarted && change.reloaded && rows[2]?.value === STAGING && indicator, seen: `the reload ${change.reloaded ? 'replaced the document' : 'left the document'} and the probe answered again after ${change.ms} ms; the rows ${describeRows(rows)}; the indicator ${indicator ? `names ${STAGING}` : `does not name ${STAGING}`}` };
  });

  await c.run('release-selection.survives-closing-and-reopening-the-window', {
    expected: `with ${STAGING} chosen, the editor closed and opened again on the same folder comes back with the Release row and the status bar's Release indicator naming ${STAGING}`,
    plant: 'in the scratch copy, out/src/release-selection.js with a chosen Release not remembered for the window',
  }, async () => {
    await ledger.beforeChange(ctx.d);
    const r = await reopen(ctx, LEVEL_OBSERVERS);
    await ledger.afterChange(ctx.d);
    need(r.closed.stillAlive.length === 0, `the editor closed with ${r.closed.stillAlive.length} process(es) still alive`);
    await ready(ctx);
    const rows = keep(await waitRows(ctx, `the Release row naming ${STAGING}`, (x) => x[2]?.value === STAGING));
    const indicator = await until('the Release indicator', 10000, () => statusItems(ctx.d), (v) => v.some((i) => i.side === 'left' && i.text === STAGING)).then(() => true, () => false);
    return { passed: rows[2]?.value === STAGING && indicator, seen: `opened again in ${r.bringUpMs} ms; the rows ${describeRows(rows)}; the indicator ${indicator ? `names ${STAGING}` : `does not name ${STAGING}`}` };
  });

  const staging = path.join(ctx.folder, STAGING);
  const aside = `${staging}.off`;
  let fallbackSeen = false;
  await c.run('release-selection.one-no-longer-offered-falls-back-and-says-so', {
    expected: `with ${STAGING} chosen and then renamed to ${path.basename(aside)}, which leaves ${LOCAL} as the folder's one Release and so its default, the editor opened again falls back to ${LOCAL} and says so: "${droppedRelease(STAGING)}"; the Release row and the status bar's Release indicator then name ${LOCAL}`,
    plant: 'in the scratch copy, out/src/release-selection.js with a remembered Release that is no longer offered dropped without a word',
  }, async () => {
    need(fs.existsSync(staging), `${staging} is not there to rename`);
    fs.renameSync(staging, aside);
    try {
      await ledger.beforeChange(ctx.d);
      const r = await reopen(ctx, LEVEL_OBSERVERS);
      await ledger.afterChange(ctx.d);
      need(r.closed.stillAlive.length === 0, `the editor closed with ${r.closed.stillAlive.length} process(es) still alive`);
      await ready(ctx);
      const told = await waitToast(ctx.d, 'the notice that the selection was dropped', 0, (t) => t.message === droppedRelease(STAGING), 20000).then(() => true, () => false);
      fallbackSeen = told;
      const rows = keep(await waitRows(ctx, `the Release row naming ${LOCAL}`, (x) => x[2]?.value === LOCAL));
      const indicator = await until('the Release indicator', 10000, () => statusItems(ctx.d), (v) => v.some((i) => i.side === 'left' && i.text === LOCAL)).then(() => true, () => false);
      const drawnNow = (await toasts(ctx.d)).map((t) => t.message);
      return { passed: told && rows[2]?.value === LOCAL && indicator, seen: `notifications on opening ${JSON.stringify(drawnNow)}; the rows ${describeRows(rows)}; the indicator ${indicator ? `names ${LOCAL}` : `does not name ${LOCAL}`}` };
    } finally {
      if (!fs.existsSync(staging) && fs.existsSync(aside)) { fs.renameSync(aside, staging); }
    }
  });

  await c.run('release-row.reads-unavailable-with-the-server-stopped', {
    expected: `with the binary setting pointed at ${missing}, which does not exist, the editor opened again on the folder has no language server to ask which Release is selected — the status bar reads "${NOT_RUNNING}" — and the Release row reads "unavailable"`,
    plant: 'in the scratch copy, out/src/release-selection.js with the reading for a language server that is not answering worded as "none selected"',
  }, async () => {
    need(!fs.existsSync(missing), `${missing} exists`);
    await setBinaryPath(ctx, bin, missing);
    const stopped = await waitStatus(ctx.d, NOT_RUNNING, 60000).then(() => true, () => false);
    need(stopped, `the status bar did not read "${NOT_RUNNING}" once the binary setting named a file that does not exist`);
    // What the rows keep once a running server stops is read beside the verdict;
    // the reading judged is the one a window opened with no server to ask draws.
    const afterStop = await rowsNow(ctx);
    await ledger.beforeChange(ctx.d);
    const r = await reopen(ctx, LEVEL_OBSERVERS);
    await ledger.afterChange(ctx.d);
    need(r.closed.stillAlive.length === 0, `the editor closed with ${r.closed.stillAlive.length} process(es) still alive`);
    const reopenedStopped = await waitStatus(ctx.d, NOT_RUNNING, 90000).then(() => true, () => false);
    need(reopenedStopped, `the editor opened again did not read "${NOT_RUNNING}"`);
    const rows = keep(await waitRows(ctx, 'the Release row reading unavailable', (x) => x[2]?.value === 'unavailable'));
    return { passed: rows[2]?.value === 'unavailable', seen: `the rows ${describeRows(rows)}; with the running server stopped, before the editor was opened again, they read ${describeRows(afterStop)}` };
  });

  await c.run('context-rows.no-surface-refuses-a-sole-candidate-or-promises-a-switch', {
    expected: `across every window of this scenario, no notification, row value or row hover drew ${SENTENCES_NO_SURFACE_DRAWS.map((s) => `"${s}"`).join(' or ')}; the same reading holds the notice the fallback raised after the editor was opened again, which shows it reaches across windows`,
    plant: 'in the scratch copy, out/src/anchor-picker.js with the Aggrega workspace row\'s closing line promising a switch',
  }, async () => {
    const all = await ledger.all(ctx.d);
    need(fallbackSeen && all.some((t) => t.message === droppedRelease(STAGING)), `its positive control did not fire: the notices kept across windows ${fallbackSeen ? 'do not hold' : 'could not hold'} the fallback's, so the reading is not shown to reach across windows`);
    keep(await rowsNow(ctx));
    const status = (await statusItems(ctx.d)).map((i) => i.text);
    const texts = [...all.map((t) => t.message), ...drawn, ...status];
    const found = SENTENCES_NO_SURFACE_DRAWS.filter((s) => texts.some((t) => t.includes(s)));
    return { passed: found.length === 0, seen: `${all.length} notification(s), ${drawn.length} row value(s) and hover(s) and ${status.length} status-bar item(s) read; sentences no surface is to draw, found ${JSON.stringify(found)}` };
  });
}
