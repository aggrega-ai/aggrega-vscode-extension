// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';

import { RESTART_COMMAND } from '../../src/daemon-status';
import { need } from './checks';
import { languageServers, open, ready, run, Server, SuiteContext, theServer } from './suite-context';
import { killServer, STOPPED_RESPONDING } from './suite-storefront';
import { RUNNING, sleep, statusNow, toasts, toastsSince, until, waitStatus } from './workbench';

// The checks run with the language server killed from outside, repeatedly: that
// it starts without an error notification, that a server started in place of a
// killed one and killed in turn while its handshake is still open is started
// again, and what happens once it has been killed more often than the respawn
// bound allows. The scenario sets that bound low, and says so in its report, so
// the bound is reached in a few kills.

export const RESPAWN_BOUND = 2;
export const KILLED_SETTINGS = { 'aggrega.server.respawnAttempts': RESPAWN_BOUND };

export const KILLED_CHECKS = [
  'language-server.restarts-after-dying-during-its-handshake',
  'language-server.stopped-responding-after-the-respawn-bound',
  'language-server.starts-without-an-error-notification',
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

// killOnSight signals, by its PID, the first language server listed that is none
// of `known`, as soon as it is listed, and returns it — or null where none is
// listed within the bound. It reads the process table every few milliseconds,
// far inside the time a server takes to answer its handshake, so the signal
// reaches a server whose handshake is still open; the caller confirms that from
// the channel rather than assuming it.
async function killOnSight(ctx: SuiteContext, known: number[], boundMs: number): Promise<Server | null> {
  const end = Date.now() + boundMs;
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
    need(second !== null, `no language server was started in place of ${first.pid} within 20000 ms`);
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
        + (outcome.notified ? 'the stopped-responding notification was raised' : restarted ? `a third server ${outcome.third?.pid} reads running in ${outcome.third?.cwd}` : 'neither a third server running nor the notification within 30000 ms')
        + (unsaid.length === 0 ? '; the channel says each step' : `; the channel does not say ${JSON.stringify(unsaid)}`),
      evidence: { channel: channel.slice(0, 4000) },
    };
  });

  // The bound below is counted from a restart the reader asks for, and the check
  // relies on that: the restarts the check above used are not carried into it.
  await run(ctx, RESTART_COMMAND, [], 60000).catch(() => undefined);
  const afresh = await waitStatus(ctx.d, RUNNING, 60000).then(() => true, () => false);
  // A notification the check above raised is its own, and not the one the bound
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
        const restarted = await theServer(ctx, 200, killed.pid).then(() => true, () => false);
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
      seen: kills.map((x) => `kill ${x.kill} (pid ${x.pid}): ${x.notified ? 'the stopped-responding notification' : x.restarted ? 'restarted' : 'neither within 20000 ms'}`).join('; '),
    };
  });

  await c.run('language-server.starts-without-an-error-notification', {
    expected: `from the moment the workbench was drawn until ${START_WINDOW_MS} ms after the language server first read running, no error notification is raised; the same observer, in the same scenario, does record the stopped-responding error once the bound is reached`,
    plant: 'in the scratch copy, out/src/extension.js made to raise an error notification at activation',
  }, async () => {
    need(control, 'its positive control did not fire: no stopped-responding error notification was recorded in this scenario, so the observer is not shown to catch one');
    return { passed: atStart.length === 0, seen: atStart.length === 0 ? `none at start; the control recorded the stopped-responding error` : `at start: ${JSON.stringify(atStart.map((t) => t.message))}` };
  });
}
