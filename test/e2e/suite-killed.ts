// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { RESTART_COMMAND } from '../../src/daemon-status';
import { need, NotRun } from './checks';
import { WebviewDocument } from './drivers';
import { referenceAnswer } from './reference';
import { closeActiveTab, closeAllEditors, languageServers, open, ready, run, save, Server, serverNow, SuiteContext, theServer } from './suite-context';
import { killServer, STOPPED_RESPONDING } from './suite-storefront';
import { documentWith, guard, NOT_RUNNING, observeWorkbench, RUNNING, sleep, statusNow, toasts, toastsSince, until, waitStatus, waitToast } from './workbench';

// The checks run with the language server killed from outside, repeatedly: that
// it starts without an error notification, that a server started in place of a
// killed one and killed in turn while its handshake is still open is started
// again, and what happens once it has been killed more often than the respawn
// bound allows. The scenario sets that bound low, and says so in its report, so
// the bound is reached in a few kills. Beside them, the notifications a restart
// and a start the reader asked for end in, and the version they name; and last,
// the welcome page's last line, read on one page left open while the server is
// restarted, stopped, started again and failing to start.

export const RESPAWN_BOUND = 2;
export const KILLED_SETTINGS = { 'aggrega.server.respawnAttempts': RESPAWN_BOUND };

export const KILLED_CHECKS = [
  'language-server.restarts-after-dying-during-its-handshake',
  'language-server.restart-notification-names-the-running-version',
  'language-server.stopped-responding-after-the-respawn-bound',
  'language-server.starts-without-an-error-notification',
  'language-server.start-notification-names-the-running-version',
  'welcome-page.server-line-follows-a-restart-and-a-stop',
  'welcome-page.server-line-names-the-version-when-started-again',
  'welcome-page.server-line-says-a-start-failed',
] as const;

// START_WINDOW_MS is how long after the server first runs the start is watched
// for an error notification.
const START_WINDOW_MS = 5000;

// The words the output channel is to carry for a server that ends unasked, held
// here as written for the reason the storefront's are: a change of wording is a
// change these checks report rather than follow. The first is the handshake
// ending on the server's exit, which the attempt to start writes whatever follows
// it — that is what lets it stand as the evidence that a kill landed inside the
// handshake. The others are what the supervision says about that end.
const HANDSHAKE_ENDED_BY_EXIT = 'initialize failed: daemon exited';
const ENDED_UNEXPECTEDLY = 'the language server stopped unexpectedly';
const RESTART_DID_NOT_COME_UP = 'the language server started again did not come up';
const STARTING_AGAIN = 'starting the language server again';

// InPlaceAct, inPlaceOpening and inPlaceSentence are the notification a restart or
// a start the reader asked for ends in. The words around the version are the
// extension's and are held here as written, for the reason the channel's words
// above are; the version is the server's own, so it is never written here: the
// checks read it from the server.
export type InPlaceAct = 'started' | 'restarted';
export const inPlaceOpening = (act: InPlaceAct): string => `Aggrega language server ${act}`;
const inPlaceSentence = (act: InPlaceAct, version: string): string => `${inPlaceOpening(act)}, version ${version}.`;

// handshakeVersion is the version the language server reports about itself in its
// handshake, asked of the server outside the editor through the extension's own
// client, over the same folder and home; null where the answer named none.
async function handshakeVersion(ctx: SuiteContext): Promise<{ version: string | null; answer: string }> {
  const answer = await referenceAnswer({ binary: ctx.inputs.compiler.path, root: ctx.folder, method: 'aggrega/initialize', params: {}, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
  const v = answer.ok ? (answer.result as { version?: unknown } | null)?.version : undefined;
  return { version: typeof v === 'string' && v !== '' ? v : null, answer: JSON.stringify(answer).slice(0, 400) };
}

// BINARY_PATH_SETTING is the setting a start is taken away with and given back by.
const BINARY_PATH_SETTING = 'aggrega.server.binaryPath';

// setBinaryPath rewrites the user settings' one line naming the binary, in the
// editor as a person edits it, and saves it. The line is found by its key and
// value, whatever follows them, since the profile's writer ends it with a comma
// only where another setting comes after it. Afterwards every editor is closed,
// or, where `close` says so, only the settings file's own, so a page left open
// beside it stays open.
export async function setBinaryPath(ctx: SuiteContext, from: string, to: string, close: 'all' | 'its-own' = 'all'): Promise<void> {
  const userSettings = path.join(ctx.s.root.userData, 'User', 'settings.json');
  const doc = await open(ctx, userSettings);
  const naming = `"${BINARY_PATH_SETTING}": ${JSON.stringify(from)}`;
  const at = (doc.text ?? '').split('\n').map((l, i) => (l.trim().startsWith(naming) ? i : -1)).filter((i) => i !== -1);
  need(at.length === 1, `the user settings name ${from} as the binary ${at.length} times, not once`);
  const text = (doc.text ?? '').split('\n')[at[0]];
  await ctx.probe.request('document.edit', { path: userSettings, start: { line: at[0], character: 0 }, end: { line: at[0] + 1, character: 0 }, text: `${text.replace(JSON.stringify(from), JSON.stringify(to))}\n` });
  await save(ctx, userSettings);
  if (close === 'all') {
    await closeAllEditors(ctx);
    return;
  }
  await open(ctx, userSettings);
  await closeActiveTab(ctx);
}

// The welcome page's last line in each reading, held here as written for the
// reason the notification's words above are; the version is the server's own, so
// it is never written here either.
const SERVER_LINE_STARTING = 'Language server starting';
const SERVER_LINE_NOT_RUNNING = 'Language server not running';
const SERVER_LINE_FAILED = 'Language server failed to start';
const SERVER_LINE_RUNNING_OPENING = 'Language server running';
const serverLineRunning = (version: string): string => `${SERVER_LINE_RUNNING_OPENING}, ${version}`;

// WELCOME_PAGE identifies the welcome page's document: the region its last line
// is drawn in.
const WELCOME_PAGE = `!!document.getElementById('server')`;

// SERVER_LINE_OBSERVER is installed in the welcome page's document before the
// first action it watches, and records every reading of the last line as it is
// drawn, so a reading that lasts a moment — a restart's "starting" — is caught
// rather than hoped for by a later look. It lives in that one document: a page
// closed and opened again is a new document with no record, and reading the old
// one fails, which is what lets the checks say the page was never reopened.
const SERVER_LINE_OBSERVER = `(() => {
  if (window.__editorSuiteServerLine) { return window.__editorSuiteServerLine.length; }
  const line = document.getElementById('server');
  if (!line) { return -1; }
  const log = [];
  let last = null;
  const sample = () => {
    const text = (line.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text !== last) { log.push({ at: Date.now(), text }); last = text; }
  };
  sample();
  new MutationObserver(sample).observe(line, { subtree: true, childList: true, characterData: true });
  window.__editorSuiteServerLine = log;
  return log.length;
})()`;

// lineReadings is what the observer in `page` recorded, from index `from` on.
async function lineReadings(page: WebviewDocument, from = 0): Promise<string[]> {
  const log = await page.evaluate<{ at: number; text: string }[] | null>('window.__editorSuiteServerLine || null');
  if (log === null) { throw new Error('the welcome page\'s document carries no record of its last line, so it is not the document the observer was installed in'); }
  return log.slice(from).map((r) => r.text);
}

// lineAt is how many readings the observer in `page` has recorded.
async function lineAt(page: WebviewDocument): Promise<number> {
  return (await lineReadings(page)).length;
}

// untilLine waits for the last reading recorded since `from` to satisfy `done`,
// and returns the readings since then, whether or not it did.
async function untilLine(page: WebviewDocument, what: string, from: number, done: (last: string) => boolean, boundMs: number): Promise<{ reached: boolean; readings: string[] }> {
  const reached = await until(what, boundMs, () => lineReadings(page, from), (v) => v.length > 0 && done(v[v.length - 1])).then(() => true, () => false);
  return { reached, readings: await lineReadings(page, from) };
}

// onePage reports whether the welcome page is still the one document it opened
// in: that document answers with its record, and no second welcome page is drawn.
async function onePage(ctx: SuiteContext, page: WebviewDocument): Promise<string | null> {
  try { await lineReadings(page); } catch (err) { return `the page's document no longer answers: ${err instanceof Error ? err.message : String(err)}`; }
  let pages = 0;
  for (const d of await ctx.d.webviews()) {
    try { if (await d.evaluate<boolean>(WELCOME_PAGE)) { pages++; } } catch { /* a document being replaced */ }
  }
  return pages === 1 ? null : `${pages} welcome pages are drawn`;
}

// killOnSight signals, by its PID, the first language server listed that is none
// of `known`, as soon as it is listed, and returns it — or null where none is
// listed within guard(boundMs). It reads the process table every few
// milliseconds, far inside the time a server takes to answer its handshake, so
// the signal reaches a server whose handshake is still open; the caller confirms
// that from the channel rather than assuming it.
async function killOnSight(ctx: SuiteContext, known: number[], boundMs: number): Promise<Server | null> {
  const end = Date.now() + guard(boundMs);
  while (Date.now() < end) {
    const fresh = languageServers(ctx).filter((x) => !known.includes(x.pid));
    if (fresh.length > 0) {
      process.kill(fresh[0].pid, 'SIGTERM');
      return fresh[0];
    }
    await sleep(2);
  }
  return null;
}

export async function killedChecks(ctx: SuiteContext): Promise<void> {
  const c = ctx.checks;
  const aggregate = path.join(ctx.folder, 'aggregate.yaml');
  await ready(ctx);
  // The absence is observed from the moment the observers were installed,
  // before the extension started its server, to a stated window after the
  // server first ran; its verdict waits for the positive control below.
  await sleep(START_WINDOW_MS);
  const atStart = (await toasts(ctx.d)).filter((t) => t.severity === 'error');

  await c.run('language-server.restarts-after-dying-during-its-handshake', {
    expected: `the language server this window started is signalled by its PID, and the server started in its place is signalled by its PID as soon as it is listed, while its initialize handshake is still open (the channel reports the handshake ending on that exit); a third server is then started in the same folder and the status bar reads running, the channel says in words that the server stopped unexpectedly, that the one started again did not come up and that it is being started again, and no "${STOPPED_RESPONDING}" is raised`,
    plant: 'in the scratch copy, out/src/daemon.js made to take a server started again that ends before it answers for one stopped on purpose',
  }, async () => {
    const first = await theServer(ctx);
    need(first.cwd === ctx.folder, `the language server runs in ${first.cwd}, not in the folder the window opened`);
    const mark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    // Installed before the kill, so the server started in its place is caught
    // as it is listed rather than looked for afterwards.
    const watching = killOnSight(ctx, [first.pid], 20000);
    process.kill(first.pid, 'SIGTERM');
    const second = await watching;
    need(second !== null, `no language server was started in place of ${first.pid} within ${guard(20000)} ms`);
    const inHandshake = await ctx.out.waitFor('the channel reporting the handshake ending on an exit', mark, (t) => t.includes(HANDSHAKE_ENDED_BY_EXIT), 10000)
      .then(() => true, () => false);
    need(inHandshake, `the server started in place of ${first.pid} (pid ${second.pid}) was signalled after its handshake had closed, so this run did not reach the fault the check is about; the channel read ${JSON.stringify(ctx.out.since(mark).slice(0, 800))}`);
    const outcome = await until('a third language server running, or the stopped-responding notification', 30000, async () => {
      const notified = (await toastsSince(ctx.d, toastMark)).some((t) => t.message === STOPPED_RESPONDING);
      const others = languageServers(ctx).filter((x) => x.pid !== first.pid && x.pid !== second.pid);
      const running = (await statusNow(ctx.d)) === RUNNING;
      return { notified, third: others.length === 1 ? others[0] : null, running };
    }, (v) => v.notified || (v.third !== null && v.running)).catch(() => ({ notified: false, third: null as Server | null, running: false }));
    const channel = ctx.out.since(mark);
    const unsaid = [ENDED_UNEXPECTEDLY, RESTART_DID_NOT_COME_UP, STARTING_AGAIN].filter((w) => !channel.includes(w));
    const restarted = outcome.third !== null && outcome.running && outcome.third.cwd === ctx.folder;
    return {
      passed: restarted && !outcome.notified && unsaid.length === 0,
      seen: `killed ${first.pid}; killed ${second.pid}, started in its place, during its handshake; `
        + (outcome.notified ? 'the stopped-responding notification was raised' : restarted ? `a third server ${outcome.third?.pid} reads running in ${outcome.third?.cwd}` : `neither a third server running nor the notification within ${guard(30000)} ms`)
        + (unsaid.length === 0 ? '; the channel says each step' : `; the channel does not say ${JSON.stringify(unsaid)}`),
      evidence: { channel: channel.slice(0, 4000) },
    };
  });

  // The version the running server reports about itself, asked of the server
  // outside the editor; the restart below and the start at the end name it.
  const reported = await handshakeVersion(ctx);
  // The bound below is counted from a restart the reader asks for, and the check
  // relies on that: the restarts the check above used are not carried into it.
  const restartMark = (await toasts(ctx.d)).length;
  await run(ctx, RESTART_COMMAND, [], 60000).catch(() => undefined);
  const afresh = await waitStatus(ctx.d, RUNNING, 60000).then(() => true, () => false);

  await c.run('language-server.restart-notification-names-the-running-version', {
    expected: `the restart command, run while a language server runs, ends in the notification "${inPlaceOpening('restarted')}, version <v>.", <v> being the version the language server reports about itself in its handshake (${reported.version ?? 'not read'}), asked of the server outside the editor through the extension's own client`,
    plant: 'in the scratch copy, out/src/extension.js made to hand the notification a restart ends in no version',
  }, async () => {
    need(reported.version !== null, `the server's handshake, asked outside the editor, named no version: ${reported.answer}`);
    need(afresh, 'the language server did not read running after the restart command');
    const t = await waitToast(ctx.d, 'the restart ending in its notification', restartMark, (x) => x.message.startsWith(inPlaceOpening('restarted')), 15000);
    return { passed: t.message === inPlaceSentence('restarted', reported.version) && t.severity === 'info', seen: `"${t.message}" (${t.severity})` };
  });

  // A notification the checks above raised is theirs, and not the one the bound
  // below is to raise.
  const boundMark = (await toasts(ctx.d)).length;

  const kills: { kill: number; pid: number; restarted: boolean; notified: boolean }[] = [];
  let control = false;
  await c.run('language-server.stopped-responding-after-the-respawn-bound', {
    expected: `with aggrega.server.respawnAttempts at ${RESPAWN_BOUND}, and counted from a restart the reader asked for after the check above used restarts of its own, each of the first ${RESPAWN_BOUND} kills of the language server (signalled by its PID, then a file edited) is followed by a restart, and the kill after them raises "${STOPPED_RESPONDING}"`,
    plant: 'in the scratch copy, out/src/daemon.js made to allow one restart fewer than the bound, as counting the end being handled against the bound does',
  }, async () => {
    need(afresh, 'the language server did not read running after the restart command, so the bound could not be counted from it');
    const read = await ctx.probe.request<{ value: unknown }>('configuration.inspect', { key: 'aggrega.server.respawnAttempts' });
    need(read.value === RESPAWN_BOUND, `the editor reads the respawn bound as ${JSON.stringify(read.value)}, not ${RESPAWN_BOUND}`);
    for (let k = 1; k <= RESPAWN_BOUND + 1; k++) {
      const killed = await killServer(ctx);
      await open(ctx, aggregate);
      await ctx.probe.request('document.edit', { path: aggregate, start: { line: 2, character: 0 }, text: '#\n' });
      await ctx.probe.request('document.undo', { path: aggregate });
      const outcome = await until(`a restart or the stopped-responding notification after kill ${k}`, 20000, async () => {
        const notified = (await toastsSince(ctx.d, boundMark)).some((t) => t.message === STOPPED_RESPONDING);
        const restarted = serverNow(ctx, killed.pid) !== null;
        return { notified, restarted };
      }, (v) => v.notified || v.restarted).catch(() => ({ notified: false, restarted: false }));
      // A restart is a server that reads running again, not merely a new
      // process: the next kill waits for it, so it lands on a server that has
      // finished starting rather than on one still in its handshake, which is the
      // check above's fault rather than the one the bound is about.
      if (outcome.restarted && !outcome.notified) {
        outcome.restarted = await waitStatus(ctx.d, RUNNING, 30000).then(() => true, () => false);
      }
      kills.push({ kill: k, pid: killed.pid, ...outcome });
      if (outcome.notified || !outcome.restarted) { break; }
      await sleep(500);
    }
    const notice = (await toastsSince(ctx.d, boundMark)).find((t) => t.message === STOPPED_RESPONDING);
    control = notice !== undefined && notice.severity === 'error';
    const restartedBefore = kills.slice(0, RESPAWN_BOUND).every((x) => x.restarted && !x.notified);
    const notifiedAfter = kills.length === RESPAWN_BOUND + 1 && kills[RESPAWN_BOUND].notified;
    return {
      passed: restartedBefore && notifiedAfter,
      seen: kills.map((x) => `kill ${x.kill} (pid ${x.pid}): ${x.notified ? 'the stopped-responding notification' : x.restarted ? 'restarted' : `neither within ${guard(20000)} ms`}`).join('; '),
    };
  });

  await c.run('language-server.starts-without-an-error-notification', {
    expected: `from the moment the workbench was drawn until ${START_WINDOW_MS} ms after the language server first read running, no error notification is raised; the same observer, in the same scenario, does record the stopped-responding error once the bound is reached`,
    plant: 'in the scratch copy, out/src/extension.js made to raise an error notification at activation',
  }, async () => {
    need(control, 'its positive control did not fire: no stopped-responding error notification was recorded in this scenario, so the observer is not shown to catch one');
    return { passed: atStart.length === 0, seen: atStart.length === 0 ? `none at start; the control recorded the stopped-responding error` : `at start: ${JSON.stringify(atStart.map((t) => t.message))}` };
  });

  // A start is what the restart command performs where the extension holds no
  // language server at all. A restart that fails keeps the one it holds, so the
  // one way this window comes to hold none is a start that fails as the window's
  // extensions start: the window is reloaded while the binary setting names a
  // file that does not exist, and the binary is then given back.
  const bin = ctx.inputs.compiler.path;
  const missing = path.join(ctx.s.root.dir, 'no-such-compiler', 'aggrega');
  await c.run('language-server.start-notification-names-the-running-version', {
    expected: `with no language server held — the window reloaded while ${BINARY_PATH_SETTING} named a file that does not exist (${missing}), so the start as the extension activated failed, the status bar reads "${NOT_RUNNING}" and no language server runs — giving the setting back the binary under test and running the restart command ends in the notification "${inPlaceOpening('started')}, version <v>.", <v> being the version the language server reports about itself in its handshake (${reported.version ?? 'not read'}), and the status bar then reads "${RUNNING}"`,
    plant: 'in the scratch copy, out/src/extension.js made to hand the notification a start ends in no version',
  }, async () => {
    need(reported.version !== null, `the server's handshake, asked outside the editor, named no version: ${reported.answer}`);
    need(!fs.existsSync(missing), `${missing} exists`);
    await setBinaryPath(ctx, bin, missing);
    const hello = await ctx.probe.request<{ instance: string }>('hello');
    await ctx.probe.request('command.run', { command: 'workbench.action.reloadWindow' }, 3000).catch(() => undefined);
    await ctx.probe.waitHello(60000, hello.instance);
    await observeWorkbench(ctx.d);
    const detached = await waitStatus(ctx.d, NOT_RUNNING, 60000).then(() => true, () => false);
    const serving = languageServers(ctx).length;
    if (!detached || serving !== 0) {
      const reading = await statusNow(ctx.d);
      await setBinaryPath(ctx, missing, bin).catch(() => undefined);
      throw new NotRun(`after the reload the status bar reads "${reading}" and ${serving} language server(s) run, so there was no language server to start`);
    }
    await setBinaryPath(ctx, missing, bin);
    const mark = (await toasts(ctx.d)).length;
    await run(ctx, RESTART_COMMAND, [], 60000).catch(() => undefined);
    const t = await waitToast(ctx.d, 'the start ending in its notification', mark, (x) => x.message.startsWith(inPlaceOpening('started')) || x.message.startsWith(inPlaceOpening('restarted')), 30000);
    const running = await waitStatus(ctx.d, RUNNING, 30000).then(() => true, () => false);
    return {
      passed: t.message === inPlaceSentence('started', reported.version) && t.severity === 'info' && running,
      seen: `"${t.message}" (${t.severity}); the status bar ${running ? `reads "${RUNNING}"` : `reads "${await statusNow(ctx.d)}"`}`,
    };
  });

  // ---- the welcome page's last line, on one page left open ----
  // The page is opened once, by its own command, and every reading below is taken
  // from that one document. The extension offers no command that stops the
  // language server — the one lifecycle command starts or restarts it, and a
  // restart reads as starting — so the stop is the one a reader meets on a server
  // the extension holds: it ends, and the respawn bound leaves nothing to start
  // it again.
  const v = reported.version ?? '<not read>';
  let page: WebviewDocument | null = null;
  let stopped = false;
  await c.run('welcome-page.server-line-follows-a-restart-and-a-stop', {
    expected: `with the welcome page opened once by its command and never again, its last line reads "${serverLineRunning(v)}"; the restart command draws "${SERVER_LINE_STARTING}" on it and then "${serverLineRunning(v)}" again; and once the language server has been killed ${RESPAWN_BOUND + 1} times by its PID with aggrega.server.respawnAttempts at ${RESPAWN_BOUND}, each of the first ${RESPAWN_BOUND} followed by a server reading running again, it reads "${SERVER_LINE_NOT_RUNNING}" — every reading taken from the one document the page opened in, the version being the one the language server reports about itself in its handshake, asked of the server outside the editor`,
    plant: 'in the scratch copy, out/src/get-started.js made to leave the page\'s last line as it stands on a lifecycle move that reads not running',
  }, async () => {
    need(reported.version !== null, `the server's handshake, asked outside the editor, named no version: ${reported.answer}`);
    need((await statusNow(ctx.d)) === RUNNING, `the status bar reads "${await statusNow(ctx.d)}", so no language server runs to restart and stop`);
    await run(ctx, 'aggrega.getStarted.open');
    const opened = await documentWith(ctx.d, 'the welcome page opening', WELCOME_PAGE, 20000);
    page = opened;
    need((await opened.evaluate<number>(SERVER_LINE_OBSERVER)) >= 0, 'the welcome page draws no last line to watch');
    const first = await untilLine(opened, 'the last line reading running', 0, (t) => t === serverLineRunning(v), 10000);
    // The restart the reader asks for.
    const restartFrom = await lineAt(opened);
    await run(ctx, RESTART_COMMAND, [], 60000).catch(() => undefined);
    await waitStatus(ctx.d, RUNNING, 60000).catch(() => undefined);
    const restart = await untilLine(opened, 'the last line reading running after the restart', restartFrom, (t) => t.startsWith(SERVER_LINE_RUNNING_OPENING), 15000);
    const restarted = restart.readings.includes(SERVER_LINE_STARTING)
      && restart.readings.lastIndexOf(serverLineRunning(v)) > restart.readings.indexOf(SERVER_LINE_STARTING)
      && restart.readings[restart.readings.length - 1] === serverLineRunning(v);
    // The stop: a server ending with no restart left.
    const stopFrom = await lineAt(opened);
    const toastMark = (await toasts(ctx.d)).length;
    const kills: string[] = [];
    for (let k = 1; k <= RESPAWN_BOUND + 1; k++) {
      const killed = await killServer(ctx);
      if (k > RESPAWN_BOUND) { kills.push(`kill ${k} (pid ${killed.pid})`); break; }
      const again = await theServer(ctx, 20000, killed.pid).then(() => true, () => false)
        && await waitStatus(ctx.d, RUNNING, 30000).then(() => true, () => false);
      kills.push(`kill ${k} (pid ${killed.pid}): ${again ? 'a server reads running again' : 'no server read running again within the bound'}`);
      need(again, `the language server was not started again after ${kills.join('; ')}, so the stop cannot be counted from the bound`);
      await sleep(500);
    }
    const bound = await until('the stopped-responding notification', 20000, async () => (await toastsSince(ctx.d, toastMark)).some((t) => t.message === STOPPED_RESPONDING), (x) => x).then(() => true, () => false);
    const bar = await waitStatus(ctx.d, NOT_RUNNING, 20000).then(() => true, () => false);
    const stop = await untilLine(opened, 'the last line reading not running', stopFrom, (t) => t === SERVER_LINE_NOT_RUNNING, 10000);
    stopped = stop.reached && bar;
    const same = await onePage(ctx, opened);
    return {
      passed: first.reached && restarted && stopped && same === null,
      seen: `opened: ${JSON.stringify(first.readings)}; after the restart command: ${JSON.stringify(restart.readings)}; ${kills.join('; ')}, the stopped-responding notification ${bound ? 'raised' : 'not raised'}, the status bar ${bar ? `reads "${NOT_RUNNING}"` : `reads "${await statusNow(ctx.d)}"`}; the line after the kills: ${JSON.stringify(stop.readings)}; ${same ?? 'one welcome page throughout, the one opened'}`,
    };
  });

  await c.run('welcome-page.server-line-names-the-version-when-started-again', {
    expected: `on the same page, with the language server stopped, the restart command draws "${SERVER_LINE_STARTING}" and then "${serverLineRunning(v)}", the version being the one the language server reports about itself in its handshake`,
    plant: 'in the scratch copy, out/src/extension.js made to hand the page no version for the running language server',
  }, async () => {
    const opened = page;
    need(opened !== null && stopped, 'the page did not read the language server as stopped, so there is nothing to start again');
    const from = await lineAt(opened);
    await run(ctx, RESTART_COMMAND, [], 60000).catch(() => undefined);
    const running = await waitStatus(ctx.d, RUNNING, 60000).then(() => true, () => false);
    const start = await untilLine(opened, 'the last line reading running', from, (t) => t.startsWith(SERVER_LINE_RUNNING_OPENING), 15000);
    const last = start.readings[start.readings.length - 1] ?? '';
    const same = await onePage(ctx, opened);
    return {
      passed: running && start.readings.includes(SERVER_LINE_STARTING) && last === serverLineRunning(v) && same === null,
      seen: `the line after the restart command: ${JSON.stringify(start.readings)}; the status bar ${running ? `reads "${RUNNING}"` : `reads "${await statusNow(ctx.d)}"`}; ${same ?? 'the page opened above'}`,
    };
  });

  await c.run('welcome-page.server-line-says-a-start-failed', {
    expected: `on the same page, ${BINARY_PATH_SETTING} set in the user settings to a file that does not exist (${missing}) — so the start the extension makes for a changed binary fails — draws "${SERVER_LINE_FAILED}" and the status bar reads "${NOT_RUNNING}"; the setting given back the binary under test draws "${serverLineRunning(v)}" again`,
    plant: 'in the scratch copy, out/src/daemon-status.js made to read a failed start as not running',
  }, async () => {
    const opened = page;
    need(opened !== null && (await statusNow(ctx.d)) === RUNNING, 'the page is not open over a running language server, so there is no start to fail');
    need(!fs.existsSync(missing), `${missing} exists`);
    const from = await lineAt(opened);
    await setBinaryPath(ctx, bin, missing, 'its-own');
    // The start fails, and the line settles on one of the two readings that are
    // not a start under way; which one is the verdict.
    const failure = await untilLine(opened, 'the last line reading a failed start', from, (t) => t === SERVER_LINE_FAILED || t === SERVER_LINE_NOT_RUNNING, 60000);
    const bar = await waitStatus(ctx.d, NOT_RUNNING, 10000).then(() => true, () => false);
    const failedLine = failure.readings[failure.readings.length - 1] ?? '';
    // The setting given back, and the server with it.
    const backFrom = await lineAt(opened);
    await setBinaryPath(ctx, missing, bin, 'its-own');
    const back = await untilLine(opened, 'the last line reading running again', backFrom, (t) => t.startsWith(SERVER_LINE_RUNNING_OPENING), 60000);
    const running = await waitStatus(ctx.d, RUNNING, 30000).then(() => true, () => false);
    const same = await onePage(ctx, opened);
    return {
      passed: failedLine === SERVER_LINE_FAILED && bar && back.readings[back.readings.length - 1] === serverLineRunning(v) && running && same === null,
      seen: `with the binary missing: ${JSON.stringify(failure.readings)}, the status bar ${bar ? `reads "${NOT_RUNNING}"` : `reads "${await statusNow(ctx.d)}"`}; with it given back: ${JSON.stringify(back.readings)}, the status bar ${running ? `reads "${RUNNING}"` : `reads "${await statusNow(ctx.d)}"`}; ${same ?? 'the page opened above'}`,
    };
  });
}
