// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';

import { need } from './checks';
import { open, ready, SuiteContext, theServer } from './suite-context';
import { killServer, STOPPED_RESPONDING } from './suite-storefront';
import { sleep, toasts, toastsSince, until } from './workbench';

// The checks run with the language server killed from outside, repeatedly: that
// it starts without an error notification, and what happens once it has been
// killed more often than the respawn bound allows. The scenario sets that bound
// low, and says so in its report, so the bound is reached in a few kills.

export const RESPAWN_BOUND = 2;
export const KILLED_SETTINGS = { 'aggrega.server.respawnAttempts': RESPAWN_BOUND };

export const KILLED_CHECKS = [
  'language-server.stopped-responding-after-the-respawn-bound',
  'language-server.starts-without-an-error-notification',
] as const;

// START_WINDOW_MS is how long after the server first runs the start is watched
// for an error notification.
const START_WINDOW_MS = 5000;

export async function killedChecks(ctx: SuiteContext): Promise<void> {
  const c = ctx.checks;
  const aggregate = path.join(ctx.folder, 'aggregate.yaml');
  await ready(ctx);
  // The absence is observed from the moment the observers were installed,
  // before the extension started its server, to a stated window after the
  // server first ran; its verdict waits for the positive control below.
  await sleep(START_WINDOW_MS);
  const atStart = (await toasts(ctx.d)).filter((t) => t.severity === 'error');
  const startMark = (await toasts(ctx.d)).length;

  const kills: { kill: number; pid: number; restarted: boolean; notified: boolean }[] = [];
  let control = false;
  await c.run('language-server.stopped-responding-after-the-respawn-bound', {
    expected: `with aggrega.server.respawnAttempts at ${RESPAWN_BOUND}, each of the first ${RESPAWN_BOUND} kills of the language server (signalled by its PID, then a file edited) is followed by a restart, and the kill after them raises "${STOPPED_RESPONDING}"`,
    plant: 'in the scratch copy, out/src/daemon.js made to respawn without counting the attempts',
  }, async () => {
    const read = await ctx.probe.request<{ value: unknown }>('configuration.inspect', { key: 'aggrega.server.respawnAttempts' });
    need(read.value === RESPAWN_BOUND, `the editor reads the respawn bound as ${JSON.stringify(read.value)}, not ${RESPAWN_BOUND}`);
    for (let k = 1; k <= RESPAWN_BOUND + 1; k++) {
      const killed = await killServer(ctx);
      await open(ctx, aggregate);
      await ctx.probe.request('document.edit', { path: aggregate, start: { line: 2, character: 0 }, text: '#\n' });
      await ctx.probe.request('document.undo', { path: aggregate });
      const outcome = await until(`a restart or the stopped-responding notification after kill ${k}`, 20000, async () => {
        const notified = (await toastsSince(ctx.d, startMark)).some((t) => t.message === STOPPED_RESPONDING);
        const restarted = await theServer(ctx, 200, killed.pid).then(() => true, () => false);
        return { notified, restarted };
      }, (v) => v.notified || v.restarted).catch(() => ({ notified: false, restarted: false }));
      kills.push({ kill: k, pid: killed.pid, ...outcome });
      if (outcome.notified || !outcome.restarted) { break; }
      await sleep(500);
    }
    const notice = (await toastsSince(ctx.d, startMark)).find((t) => t.message === STOPPED_RESPONDING);
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
