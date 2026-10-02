// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';

import { need } from './checks';
import { readTree, sameTree, Tree } from './fixtures';
import { readStat } from './processes';
import { referenceAnswer } from './reference';
import { ScratchRegistry } from './registry';
import { closeAllEditors, open, ready, run, SuiteContext, theServer } from './suite-context';
import { CONTEXT_ROW_LABELS, contextRowsCheck } from './suite-gateway';
import {
  commandsPanel, guard, notificationReadings, pickQuickInputRow, pressIn, pressOperation, pressPanelAction, pressToastButton, selectorRows, sleep, statusItems,
  stopWatchingNotification, Toast, toasts, toastsGone, toastsSince, holds, until, waitQuickInput, waitToast, watchNotification,
} from './workbench';

// The checks run where an operation's ending is what a reader is told: a
// drafted document ending open and unsaved, a publication ending in what others
// now resolve from the registry it reached — the suite's own scratch registry —
// and, in a documentation example with two Releases, a Release chosen without a
// notification and a build and a pull each watched, stopped, and seen to stop in
// the compiler as well as in the editor.

export const ENDINGS_CHECKS = [
  'commands-panel.context-rows-name-the-opened-folder',
  'draft-entity.ends-with-the-draft-open-unsaved-and-nothing-written',
  'publication.ends-naming-what-others-now-resolve',
  'publication.identical-bytes-again-publish-nothing',
] as const;

export const WATCH_AND_STOP_CHECKS = [
  'commands-panel.context-rows-name-the-folder-and-no-release',
  'release-selection.choosing-a-release-updates-the-indicator-and-raises-no-notification',
  'operations.build-can-be-watched-and-stopped',
  'operations.pull-can-be-watched-and-stopped',
] as const;

// The words a reader is to meet, held as written.
const DRAFT_KIND_PLACEHOLDER = 'Aggrega: choose the kind of entity to draft';
const DRAFT_NAME_TITLE = 'Aggrega: draft an entity';
const DRAFTED_KIND = 'Component';
const DRAFTED_NAME = 'drafts/example';
const published = (ref: string, tag: string, digest: string, host: string): string => `The publication published ${ref}:${tag} as ${digest}. Anyone resolving from ${host} now sees it.`;
const republished = (ref: string, tag: string, digest: string, host: string): string => `The publication found ${ref}:${tag} already published as ${digest} and published nothing. Anyone resolving from ${host} now sees it.`;
const BUILD_STOPPED = 'The build stopped at your request.';
const PULL_STOPPED = 'The pull stopped at your request.';
const buildProgress = (release: string): string => `Aggrega: building ${release}`;
const pullProgress = (release: string): string => `Aggrega: pulling dependencies for ${release}`;

// The entity a publication from the gateway folder publishes — the folder's own
// Recipe — its repository in the registry it reaches, and the version it is
// published under, which is the one the Recipe declares.
export const PUBLISHED = 'nginx-probed';
export const PUBLISHED_REPOSITORY = `recipe/compose/${PUBLISHED}`;
export const PUBLISHED_TAG = '1.0.0';

// registryDigest asks the registry itself which manifest a tag points at, as
// anyone resolving from it would be told.
export async function registryDigest(host: string, repository: string, tag: string): Promise<string> {
  const res = await fetch(`http://${host}/v2/${repository}/manifests/${tag}`, {
    method: 'HEAD',
    headers: { accept: 'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' },
    signal: AbortSignal.timeout(5000),
  });
  return res.status === 200 ? res.headers.get('docker-content-digest') ?? '' : `HTTP ${res.status}`;
}

// pushFromPanel presses Push on the Commands panel and chooses `label` from the
// menu of the workspace's entities it opens beside the button, narrowing the menu
// by typing as a reader does and taking the one entry left with Enter — the
// menu fills in when the language server answers, and a press on an entry drawn
// before that answer lands on one that is then replaced. A push raises three
// notifications, its ending the one the checks read, so it is made from the stage
// `closeAllEditors` leaves: the editor's notification window passed.
async function pushFromPanel(ctx: SuiteContext, label: string): Promise<void> {
  await closeAllEditors(ctx);
  await run(ctx, 'workbench.view.extension.aggrega');
  const panel = await commandsPanel(ctx.d);
  await pressOperation(ctx.d, panel, 'aggrega.op.push');
  const shown = (): Promise<string[]> => panel.evaluate<string[]>(`[...document.querySelectorAll('.op-menu[data-menu-command="aggrega.op.push"]:not([hidden]) .op-menu-option')]
    .filter((o) => !o.hidden).map((o) => ((o.querySelector('.op-menu-label') || {}).innerText || '').trim())`);
  await until(`the Push menu offering ${label}`, 20000, shown, (v) => v.includes(label));
  await ctx.d.type(label);
  await until(`the Push menu narrowed to ${label}`, 5000, shown, (v) => v.length === 1 && v[0] === label);
  await ctx.d.press('Enter');
}

export async function endingsChecks(ctx: SuiteContext, reference: string, registry: ScratchRegistry): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  await ready(ctx);
  await contextRowsCheck(ctx);

  // ---- a draft ends with the document ----
  await c.run('draft-entity.ends-with-the-draft-open-unsaved-and-nothing-written', {
    expected: `"Draft entity" at the head of the Catalog panel asks for the kind ("${DRAFT_KIND_PLACEHOLDER}") and then the name ("${DRAFT_NAME_TITLE}"); answered ${DRAFTED_KIND} and "${DRAFTED_NAME}", it ends with an untitled document open in front holding exactly the language server's own draft for the same kind and name, asked outside the editor, and nothing written to the folder`,
    plant: 'in the scratch copy, out/src/operations.js with the draft saved into the folder before it is shown',
  }, async () => {
    const schema = await referenceAnswer({ binary: bin, root: reference, method: 'aggrega/getSchema', params: {}, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(schema.ok, 'the language server named no kinds outside the editor');
    const entry = ((schema.result as { entityKinds?: { kind?: string; documentKind?: string }[] }).entityKinds ?? []).find((k) => k.documentKind === DRAFTED_KIND);
    need(entry?.kind !== undefined, `the language server names no ${DRAFTED_KIND} kind to draft`);
    const drafted = await referenceAnswer({ binary: bin, root: reference, method: 'aggrega/scaffoldEntity', params: { kind: entry.kind, name: DRAFTED_NAME }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(drafted.ok, `the language server drafted nothing outside the editor: ${drafted.ok ? '' : drafted.error.message}`);
    const want = (drafted.result as { skeleton: string }).skeleton;
    const before = readTree(ctx.folder);
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    await pressPanelAction(ctx.d, 'Catalog', 'Draft entity');
    await waitQuickInput(ctx.d, 'the kind being asked for', (q) => q.placeholder === DRAFT_KIND_PLACEHOLDER && q.rows.some((r) => r.label === DRAFTED_KIND), 15000);
    await pickQuickInputRow(ctx.d, DRAFTED_KIND);
    await waitQuickInput(ctx.d, 'the name being asked for', (q) => q.title === DRAFT_NAME_TITLE, 10000);
    await ctx.d.type(DRAFTED_NAME);
    // Answered only once it reads what was typed, so a key sent before the
    // prompt held the focus is not taken for an answer.
    await waitQuickInput(ctx.d, 'the name prompt reading what was typed', (q) => q.title === DRAFT_NAME_TITLE && q.value === DRAFTED_NAME, 5000);
    await ctx.d.press('Enter');
    const active = await until('the draft opening', 15000, () => ctx.probe.request<{ path: string; isUntitled: boolean; isDirty: boolean; text: string } | null>('editor.active'), (v) => v !== null && v.isUntitled).catch(() => null);
    // Nothing written, watched for a second from the draft's opening at every
    // reading, not read once at its end.
    const watched = await holds(1000, async () => readTree(ctx.folder), (t) => sameTree(before, t));
    const after = watched.held ? readTree(ctx.folder) : watched.broke as Tree;
    const unwritten = watched.held && sameTree(before, after);
    await run(ctx, 'workbench.action.revertAndCloseActiveEditor').catch(() => undefined);
    await closeAllEditors(ctx);
    return {
      passed: active !== null && active.isUntitled && active.text === want && unwritten,
      seen: `${active === null ? 'no untitled document came to the front' : `an untitled document (${active.path}) ${active.text === want ? 'holding the language server\'s own draft' : `holding ${JSON.stringify(active.text.slice(0, 200))}`}`}; the folder ${unwritten ? 'unchanged' : `changed: ${JSON.stringify([...after.keys()].filter((k) => !before.has(k)))}`}`,
    };
  });

  // ---- a publication says what others now resolve ----
  const ref = `${registry.host}/${PUBLISHED_REPOSITORY}`;
  let first = '';
  await c.run('publication.ends-naming-what-others-now-resolve', {
    expected: `Push on the Commands panel, with ${PUBLISHED} chosen from the menu it opens, publishes to the workspace's default registry (the suite's scratch registry at ${registry.host}) and ends in the notification "${published(ref, PUBLISHED_TAG, '<digest>', registry.host)}", <digest> being what the registry itself answers the tag with afterwards`,
    plant: 'in the scratch copy, out/src/publication-request.js with the reach sentence left out of a publication\'s ending',
  }, async () => {
    need((await registryDigest(registry.host, PUBLISHED_REPOSITORY, PUBLISHED_TAG)).startsWith('HTTP'), `the registry already holds ${ref}:${PUBLISHED_TAG} before the push`);
    const mark = (await toasts(ctx.d)).length;
    await pushFromPanel(ctx, PUBLISHED);
    const told = await waitToast(ctx.d, 'the publication ending', mark, (t) => t.message.startsWith('The publication '), 60000).catch(() => null);
    const digest = await registryDigest(registry.host, PUBLISHED_REPOSITORY, PUBLISHED_TAG);
    first = digest;
    return { passed: told !== null && digest.startsWith('sha256:') && told.message === published(ref, PUBLISHED_TAG, digest, registry.host), seen: `${told === null ? await noEnding(ctx, mark) : `"${told.message}" (${told.severity})`}; the registry answers ${ref}:${PUBLISHED_TAG} with ${digest}` };
  });
  await c.run('publication.identical-bytes-again-publish-nothing', {
    expected: `the same entity pushed again ends in "${republished(ref, PUBLISHED_TAG, '<digest>', registry.host)}" with the digest the first push landed, and the registry still answers the tag with it`,
    plant: 'in the scratch copy, out/src/publication-request.js with an already-published answer read as a publication',
  }, async () => {
    need(first.startsWith('sha256:'), 'the first push landed nothing, so there are no identical bytes to push again');
    const mark = (await toasts(ctx.d)).length;
    await pushFromPanel(ctx, PUBLISHED);
    const told = await waitToast(ctx.d, 'the publication ending', mark, (t) => t.message.startsWith('The publication '), 60000).catch(() => null);
    const digest = await registryDigest(registry.host, PUBLISHED_REPOSITORY, PUBLISHED_TAG);
    return { passed: told !== null && told.message === republished(ref, PUBLISHED_TAG, first, registry.host) && digest === first, seen: `${told === null ? await noEnding(ctx, mark) : `"${told.message}"`}; the registry answers ${digest}` };
  });
}

// noEnding words a publication that ended in no notification: what was drawn
// since the press, and what the channel says it ended in.
async function noEnding(ctx: SuiteContext, mark: number): Promise<string> {
  const all = await toasts(ctx.d);
  const pressedAt = all[mark - 1]?.at ?? 0;
  const drawn = all.slice(Math.max(0, mark - 2)).map((t, i) => `${i + Math.max(0, mark - 2) < mark ? 'before the press ' : ''}"${t.message.slice(0, 80)}" at ${t.at - pressedAt} ms`);
  const now = await ctx.d.workbench<{ messages: string[]; centre: boolean }>(`({
    messages: [...document.querySelectorAll('.notification-list-item-message')].map((e) => (e.innerText || e.textContent || '').trim().slice(0, 120)),
    centre: !!document.querySelector('.notifications-center.visible'),
  })`).catch((err: unknown) => ({ messages: [`not read: ${err instanceof Error ? err.message : String(err)}`], centre: false }));
  const ending = ctx.out.since({ file: null, length: 0 }).split('\n').filter((l) => l.startsWith('The publication ')).pop() ?? '';
  await run(ctx, 'notifications.showList').catch(() => undefined);
  const listed = await until('the notification centre listing', 3000, () => ctx.d.workbench<string[]>(`[...document.querySelectorAll('.notifications-center .notification-list-item-message')].map((e) => (e.innerText || '').trim().slice(0, 120))`), (v) => v.length > 0).catch(() => [] as string[]);
  await run(ctx, 'notifications.hideList').catch(() => undefined);
  return `no ending; notifications recorded since the press ${drawn.length === 0 ? 'none' : drawn.join(', ')}; in the workbench now ${JSON.stringify(now.messages)}${now.centre ? ', the notification centre open' : ''}; the notification centre lists ${JSON.stringify(listed)}; the channel's last publication line ${ending === '' ? 'none' : JSON.stringify(ending)}`;
}

// cpuRate reads how much of one core a process used over a window, from the
// kernel's own count of its CPU time.
async function cpuRate(pid: number, windowMs: number): Promise<number | null> {
  const a = readStat(pid);
  await sleep(windowMs);
  const b = readStat(pid);
  if (a === null || b === null || a.start !== b.start) { return null; }
  return (b.cpuTicks - a.cpuTicks) / 100 / (windowMs / 1000);
}

// settledAfter reports how long after `from` a process's CPU use fell under a
// quarter of a core over a second, or null where it did not within the bound.
async function settledAfter(pid: number, from: number, boundMs: number): Promise<number | null> {
  while (Date.now() - from < boundMs) {
    const rate = await cpuRate(pid, 1000);
    if (rate === null) { return null; }
    if (rate < 0.25) { return Date.now() - from; }
  }
  return null;
}

// folderRowsCheck: the Project folder and Aggrega workspace rows name the folder
// the window opened, and the Release row reads `release`, the reading of a folder
// whose Release row names no file; `why` is the clause the expectation gives for
// it naming none.
//
// 🔴 A DELIBERATE NEAR-DUPLICATE OF `contextRowsCheck` (suite-gateway.ts), which
// reads a folder holding one Release named on its row and waits for all three rows
// to read as wanted; this waits for the two naming the folder. That one is the first
// check of every scenario opening such a folder, which is why it is not widened to
// read this kind of folder as well.
export async function folderRowsCheck(ctx: SuiteContext, name: string, why: string, release: string): Promise<void> {
  const base = path.basename(ctx.folder);
  await ctx.checks.run(name, {
    expected: `the Project folder and Aggrega workspace rows name the folder opened ("${base}"), and ${why} the Release row reads "${release}"`,
    plant: 'in the scratch copy, out/src/selector-levels.js with the first context row\'s label changed',
  }, async () => {
    const doc = await commandsPanel(ctx.d);
    const read = await until('the rows naming the folder', 20000, () => selectorRows(doc), (r) => r.length >= 3 && r[0].value === base && r[1].value === base)
      .then((rows) => ({ rows, within: true }), async () => ({ rows: await selectorRows(doc), within: false }));
    const rows = read.rows;
    return {
      passed: rows.length >= 3 && rows.slice(0, 3).every((r, i) => r.label === CONTEXT_ROW_LABELS[i]) && rows[0].value === base && rows[1].value === base && rows[2].value === release,
      seen: `${rows.slice(0, 3).map((r) => `${r.label}: ${r.value}`).join(' | ')}${read.within ? '' : `, the first two not naming the folder within ${guard(20000)} ms`}`,
    };
  });
}

export async function watchAndStopChecks(ctx: SuiteContext, releases: readonly string[]): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  await ready(ctx);
  const slow = 'release-single.yaml';

  await folderRowsCheck(ctx, 'commands-panel.context-rows-name-the-folder-and-no-release', `with two Releases (${releases.join(', ')}) and no default named,`, 'none selected');

  await c.run('release-selection.choosing-a-release-updates-the-indicator-and-raises-no-notification', {
    expected: `choosing ${slow} from the Release row's picker updates the Release row and the status bar's Release indicator to it, and raises no notification (watched for 3 s); in the same check a Validate pressed right after raises its ending, which shows the observation fires`,
    plant: 'in the scratch copy, out/src/release-selection.js with a notification raised naming the Release chosen',
  }, async () => {
    const doc = await commandsPanel(ctx.d);
    await pressIn(ctx.d, doc, 'button.selector[data-command="aggrega.release.select"]');
    const picker = await waitQuickInput(ctx.d, 'the Release picker', (q) => q.rows.some((r) => r.label === slow), 10000);
    const mark = (await toasts(ctx.d)).length;
    await pickQuickInputRow(ctx.d, slow);
    const row = await until('the Release row naming it', 15000, () => selectorRows(doc), (r) => r[2]?.value === slow).then(() => true, () => false);
    const indicator = await until('the Release indicator naming it', 15000, () => statusItems(ctx.d), (v) => v.some((i) => i.text === slow)).then(() => true, () => false);
    const quiet = await holds(3000, async () => (await toastsSince(ctx.d, mark)).map((t) => t.message), (v) => v.length === 0);
    // The control: an operation's ending, read by the same observer.
    await open(ctx, path.join(ctx.folder, slow));
    const controlMark = (await toasts(ctx.d)).length;
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.validate');
    const control = await waitToast(ctx.d, 'the validation ending', controlMark, (t) => t.message.startsWith('Aggrega: validated'), 30000).then(() => true, () => false);
    await closeAllEditors(ctx);
    need(control, 'its positive control did not fire: Validate\'s ending was not recorded, so the reading is not shown to see a notification');
    return { passed: row && indicator && quiet.held, seen: `the picker offered ${JSON.stringify(picker.rows.map((r) => r.label))}; the Release row ${row ? 'names it' : 'does not name it'}; the indicator ${indicator ? 'names it' : 'does not name it'}; notifications after the choice ${quiet.held ? 'none for 3 s' : JSON.stringify(quiet.broke)}; the control recorded Validate's ending` };
  });

  await c.run('operations.build-can-be-watched-and-stopped', {
    expected: `Build of ${slow}, with the scenario's compiled-module store empty so the build compiles the providers it renders with first, draws the progress notification "${buildProgress(slow)}" with a Cancel button; pressing Cancel ends it with "${BUILD_STOPPED}" on the channel and as a notification, not as a failure; and the compiler stops too — the language server's CPU use falls under a quarter of a core within 15 s of the stop, no "Build completed" line follows over 10 s, and the output directory gains nothing after the stop`,
    plant: 'in the scratch copy, out/src/daemon.js with a stopped request abandoned without the language server being told, so a stop ends only the wait',
  }, async () => {
    const srv = await theServer(ctx);
    const dist = path.join(ctx.folder, 'dist');
    // Every notification is put away first, so the progress drawn is not slid
    // under a press by one leaving above it.
    await run(ctx, 'notifications.clearAll').catch(() => undefined);
    await toastsGone(ctx.d);
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    const key = await watchNotification(ctx.d, buildProgress(slow));
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.build');
    const drawn = await until('the build\'s progress drawn with Cancel', 15000, async () => (await toastsSince(ctx.d, toastMark)).find((t) => t.message.startsWith(buildProgress(slow)) && t.buttons.includes('Cancel')) ?? null, (v) => v !== null).catch(() => null);
    const pressed = drawn !== null && await pressToastButton(ctx.d, buildProgress(slow), 'Cancel');
    const text = await ctx.out.waitFor('the build ending', mark, (t) => /^(The build |Build completed: )/m.test(t), 120000).catch(() => ctx.out.since(mark));
    const stoppedAt = Date.now();
    await stopWatchingNotification(ctx.d, key);
    need(!/^Build completed: /m.test(text) || text.includes(BUILD_STOPPED), `the build completed before the stop landed (its progress ${drawn === null ? 'not drawn with Cancel' : 'drawn with Cancel'}, Cancel ${pressed ? 'pressed' : 'not pressed'}), so whether the compiler stops cannot be seen`);
    const distAtStop = readTree(dist);
    const settled = await settledAfter(srv.pid, stoppedAt, 15000);
    await sleep(Math.max(0, 10000 - (Date.now() - stoppedAt)));
    const after = ctx.out.since(mark);
    const completedLater = /^Build completed: /m.test(after);
    const distAfter = readTree(dist);
    const gained = [...distAfter.keys()].filter((k) => !distAtStop.has(k));
    const told = (await toastsSince(ctx.d, toastMark)).find((t) => t.message === BUILD_STOPPED);
    const progress = await notificationReadings(ctx.d, key);
    return {
      passed: drawn !== null && pressed && after.split('\n').includes(BUILD_STOPPED) && told !== undefined && told.severity === 'info' && settled !== null && !completedLater && gained.length === 0,
      seen: `progress ${drawn === null ? 'not drawn with Cancel' : `"${drawn.message}" with ${JSON.stringify(drawn.buttons)}`} (drawn: ${JSON.stringify(progress.map((r) => r.drawn))}); Cancel ${pressed ? 'pressed' : 'not pressed'}; the channel ${after.split('\n').includes(BUILD_STOPPED) ? `says "${BUILD_STOPPED}"` : `ends ${JSON.stringify(after.split('\n').filter((l) => l.trim() !== '').slice(-2))}`}; the notification ${told ? `"${told.message}" (${told.severity})` : 'not raised'}; the language server ${settled === null ? 'did not fall idle within 15 s' : `fell idle ${settled} ms after the stop`}; ${completedLater ? 'a "Build completed" line followed' : 'no "Build completed" line followed over 10 s'}; the output directory gained ${JSON.stringify(gained)} after the stop`,
    };
  });

  await c.run('operations.pull-can-be-watched-and-stopped', {
    expected: `Pull of ${slow} draws the progress notification "${pullProgress(slow)}" with a Cancel button; pressing Cancel ends it with "${PULL_STOPPED}" on the channel and as a notification; and the pull the extension ran as a command is not running afterwards`,
    plant: 'in the scratch copy, out/src/cli-run.js with a stopped command reported stopped without the process being ended',
  }, async () => {
    await run(ctx, 'notifications.clearAll').catch(() => undefined);
    await toastsGone(ctx.d);
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    // The pull is a short-lived child of the editor; the table is read often
    // enough while it runs to record it.
    const poll = setInterval(() => { ctx.s.table.snapshot(); }, 50);
    let text = '';
    let drawn: Toast | null = null;
    let pressed = false;
    try {
      await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.pull');
      drawn = await until('the pull\'s progress drawn with Cancel', 15000, async () => (await toastsSince(ctx.d, toastMark)).find((t) => t.message.startsWith(pullProgress(slow)) && t.buttons.includes('Cancel')) ?? null, (v) => v !== null).catch(() => null);
      pressed = drawn !== null && await pressToastButton(ctx.d, pullProgress(slow), 'Cancel');
      text = await ctx.out.waitFor('the pull ending', mark, (t) => /^The pull /m.test(t), 120000).catch(() => ctx.out.since(mark));
    } finally {
      clearInterval(poll);
    }
    need(!/^The pull resolved/m.test(text), `the pull completed before the stop landed (its progress ${drawn === null ? 'not drawn with Cancel' : 'drawn with Cancel'}, Cancel ${pressed ? 'pressed' : 'not pressed'}), so whether the command stops cannot be seen`);
    // A stopped process takes its own time to exit, so its absence is waited for.
    const pullsAlive = (): Promise<string[]> => { ctx.s.table.snapshot(); return Promise.resolve(ctx.s.table.alive().filter((r) => r.cmd.startsWith(`${bin} pull `)).map((r) => `${r.pid} ${r.cmd}`)); };
    await until('every pull the extension ran exiting', 2000, pullsAlive, (v) => v.length === 0).catch(() => undefined);
    const pulls = ctx.s.table.all().filter((r) => r.cmd.startsWith(`${bin} pull `));
    const alive = ctx.s.table.alive().filter((r) => r.cmd.startsWith(`${bin} pull `));
    const told: Toast | undefined = (await toastsSince(ctx.d, toastMark)).find((t) => t.message === PULL_STOPPED);
    return {
      passed: drawn !== null && pressed && text.split('\n').includes(PULL_STOPPED) && told !== undefined && pulls.length > 0 && alive.length === 0,
      seen: `progress ${drawn === null ? 'not drawn with Cancel' : `"${drawn.message}" with ${JSON.stringify(drawn.buttons)}`}; the channel ${text.split('\n').includes(PULL_STOPPED) ? `says "${PULL_STOPPED}"` : `ends ${JSON.stringify(text.split('\n').filter((l) => l.trim() !== '').slice(-2))}`}; the notification ${told ? `"${told.message}"` : 'not raised'}; pull processes recorded ${pulls.length}, alive after the stop ${alive.length}`,
    };
  });
}
