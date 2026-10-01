// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';

import { REGISTRY_REMOVAL_SUBJECT, REMOVAL_DESTINATION_PROMPT } from '../../src/registry-configure';
import { need } from './checks';
import { AGGREGA_BINARY_SETTING } from './editor';
import { waitChooser } from './levels';
import { capture, commandTitle, ready, reopen, SuiteContext } from './suite-context';
import { settingValue } from './suite-gateway';
import { setBinaryPath } from './suite-killed';
import { GLOBAL_DESTINATION } from './suite-registry';
import { addFromThePage } from './suite-welcome-empty-folder';
import {
  arrangementFolding, arrangementLogged, clearForCapture, describeReadings, describeSteps, drawnValue, folded, frontPage, markSteps, metSteps, NONE_SELECTED, observePage, observeStatusText,
  opened, pageFromItsArrival, PageSeen, pageReadings, pressHouse, pressWayThrough, readPage, registriesListed, runningAgain, samePage, SELECTED_LEAD, STANDING_MET, STANDING_TO_DO,
  statusMark, statusTexts, stepOf, WAYS_THROUGH, welcomePage,
} from './welcome';
import {
  describeRowMenu, dialog, holds, NOT_RUNNING, pickQuickInputRow, pressDialogButton, pressMenuItem, rowMenu, RUNNING, statusLog, toasts, until, waitStatus, waitToast,
} from './workbench';

// The checks run in a folder configured entirely before the editor opens it —
// anchored at itself by its own configuration, holding one Release, the compiler
// the binary-path setting names, and one registry in the global configuration —
// where every step of the welcome page arrives met. Then each of two conditions is
// taken away and given back without the window being reloaded: the compiler, by
// pointing the setting at a path that does not exist and then pressing the step's
// own way back; and the registry, by removing it from the Registries panel and then
// adding it again from the page. Between the two, the editor is closed and opened
// again with the setting naming a file that is not a program, to read how the page
// arrives where the workspace is recognised and the compiler will not start.

export const WELCOME_CONFIGURED_CHECKS = [
  'welcome-page.configured-workspace-arrives-with-every-step-met',
  'welcome-page.configured-workspace-way-out',
  'welcome-page.compiler-step-goes-back-to-do-when-the-compiler-stops',
  'welcome-page.arrives-with-only-the-workspace-folded-when-the-compiler-will-not-start',
  'welcome-page.compiler-step-comes-back-with-the-compiler-on-path',
  'welcome-page.registry-step-follows-a-removal-with-no-press',
  'welcome-page.registry-step-comes-back-with-an-added-registry',
] as const;

// CONFIGURED_RELEASE is the one Release the folder holds, and CONFIGURED_HOST the
// registry the global configuration names: a loopback port nothing listens on, so
// adding it again asks for its trust policy on this machine and nowhere else.
export const CONFIGURED_RELEASE = 'release-compose.yaml';
export const CONFIGURED_HOST = 'localhost:1';

const BINARY_SETTING = AGGREGA_BINARY_SETTING;

// MOVED_WINDOW_MS is how long a step is watched for moving by itself after its
// condition lapses, and SETTLE_MS how long an arrangement is watched holding.
const MOVED_WINDOW_MS = 5000;
const SETTLE_MS = 3000;
const FOLLOW_MS = 20000;

export async function welcomeConfiguredChecks(ctx: SuiteContext, opts: { missing: string; notABinary: string }): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  // onPath is the plain name the binary-path setting defaults to, as the manifest
  // declares it; a manifest declaring none leaves it empty, which no check here
  // passes on.
  const onPath = String(ctx.manifest.contributes.configuration.properties[BINARY_SETTING]?.default ?? '');
  const binarySetting = async (): Promise<unknown> => (await settingValue(ctx, BINARY_SETTING)).globalValue;

  // ---- every step met ------------------------------------------------------------------
  const t0 = Date.now();
  let arrived: PageSeen | null = null;
  await c.run('welcome-page.configured-workspace-arrives-with-every-step-met', {
    expected: `opened on a folder configured entirely beforehand, the page arrives by itself with every step reading "${STANDING_MET}", folded, and its ways through drawn: the workspace "${SELECTED_LEAD}${ctx.folder}", the compiler "${SELECTED_LEAD}${bin}", the Release "${SELECTED_LEAD}${CONFIGURED_RELEASE}" — the folder's one Release, taken without a choice — and the registry "${SELECTED_LEAD}${CONFIGURED_HOST}"`,
    plant: 'in the scratch copy, out/src/get-started-steps.js with the registry step met only where two registries are named',
  }, async () => {
    const doc = await welcomePage(ctx, 60000);
    const page = await until('every step reading met', 30000, () => readPage(doc), (p) => p.steps.every((s) => s.met)).catch(() => readPage(doc));
    arrived = page;
    const want: Record<string, string> = {
      workspace: `${SELECTED_LEAD}${ctx.folder}`,
      compiler: `${SELECTED_LEAD}${bin}`,
      release: `${SELECTED_LEAD}${CONFIGURED_RELEASE}`,
      registry: `${SELECTED_LEAD}${CONFIGURED_HOST}`,
    };
    const ok = page.steps.every((s) => s.met && s.badge === STANDING_MET && folded(page, s.id) && drawnValue(s)?.text === want[s.id] && s.actions.every((a) => a.drawn));
    return { passed: ok, seen: `drawn ${Date.now() - t0} ms after the scenario began (bring-up ${ctx.s.bringUpMs} ms): ${describeSteps(page)}` };
  });
  await ready(ctx);

  await c.forPerson('welcome-page.configured-workspace-way-out', {
    expected: 'a reader who configured everything beforehand is asked nothing, and getting out of the page takes two clicks',
    plant: 'none: counting the clicks out is the reader\'s own reading of the page',
    question: 'Every step reads MET on this page. How many clicks does it take you to get out of it and on with your work? The step expects two.',
  }, async () => {
    need(arrived !== null, 'the page did not arrive, so there is nothing to count the way out of');
    await frontPage(ctx);
    const left = await clearForCapture(ctx);
    return { screenshot: await capture(ctx, 'configured-workspace-way-out'), drawnText: `${describeSteps(arrived as PageSeen)}${left}` };
  });

  // ---- the compiler taken away ------------------------------------------------------------
  await c.run('welcome-page.compiler-step-goes-back-to-do-when-the-compiler-stops', {
    expected: `with ${BINARY_SETTING} pointed at a path that does not exist, the status bar counts down "Aggrega: restarting in <n>s" and then reads "${NOT_RUNNING}"; the compiler step, watched ${MOVED_WINDOW_MS} ms for whether it moves by itself, reads "${STANDING_TO_DO}" once the house on the Commands panel has been pressed, on the same page with the window not reloaded`,
    plant: 'in the scratch copy, out/src/get-started-steps.js with the compiler step met whether or not the compiler answers',
  }, async () => {
    await observeStatusText(ctx);
    const doc = await welcomePage(ctx);
    const token = await markSteps(doc);
    const hello = await ctx.probe.request<{ instance: string }>('hello');
    await setBinaryPath(ctx, bin, opts.missing, 'its-own');
    const stopped = await waitStatus(ctx.d, NOT_RUNNING, 60000).then(() => true, () => false);
    const byItself = await holds(MOVED_WINDOW_MS, async () => stepOf(await readPage(doc), 'compiler').badge, (b) => b === STANDING_MET);
    await pressHouse(ctx);
    const after = await until('the compiler step reading to do', 10000, async () => stepOf(await readPage(doc), 'compiler'), (s) => s.badge === STANDING_TO_DO).catch(async () => stepOf(await readPage(doc), 'compiler'));
    const countdown = (await statusTexts(ctx)).some((r) => /restarting in/.test(r.reading));
    const same = (await samePage(doc, token)) && (await ctx.probe.request<{ instance: string }>('hello')).instance === hello.instance;
    return {
      passed: stopped && countdown && after.badge === STANDING_TO_DO && same,
      seen: `the status bar ${countdown ? 'counted down' : 'did not count down'} and ${stopped ? `read "${NOT_RUNNING}"` : 'never read not running'}; the compiler step ${byItself.held ? `did not move by itself over ${MOVED_WINDOW_MS} ms` : `moved by itself ${byItself.atMs} ms after the stop, to ${JSON.stringify(byItself.broke)}`}; after the house it reads ${after.badge} with ${JSON.stringify(drawnValue(after)?.text ?? null)}; ${same ? 'the same page, no reload' : 'the page or the window was replaced'}`,
    };
  });

  // ---- a cold window with a compiler that will not start ------------------------------------
  await c.run('welcome-page.arrives-with-only-the-workspace-folded-when-the-compiler-will-not-start', {
    expected: `with ${BINARY_SETTING} naming a file that is not a program (${opts.notABinary}), the editor closed and opened again draws the page by itself; at every reading an observer installed in the page's document as it is first found records, from then and over ${SETTLE_MS} ms, the workspace step is folded while the compiler, Release and registry steps are open, and the workspace step is met`,
    plant: 'in the scratch copy, out/src/welcome-render.js with a panel arranged with nothing folded',
  }, async () => {
    await setBinaryPath(ctx, opts.missing, opts.notABinary, 'its-own');
    const r = await reopen(ctx);
    const t1 = Date.now();
    const arrival = await pageFromItsArrival(ctx, 60000);
    const arrivedMs = Date.now() - t1;
    const first = await readPage(arrival.doc);
    const want = arrangementFolding(['workspace']);
    const kept = await holds(SETTLE_MS, () => pageReadings(arrival.doc, arrival.key), (log) => log.length > 0 && log.every((x) => arrangementLogged(x) === want));
    const log = await pageReadings(arrival.doc, arrival.key);
    const seenShapes = [...new Set(log.map(arrangementLogged))];
    const ok = stepOf(first, 'workspace').met && folded(first, 'workspace') && opened(first, 'compiler') && opened(first, 'release') && opened(first, 'registry');
    return {
      passed: ok && kept.held,
      seen: `opened again in ${r.bringUpMs} ms and the page found ${arrivedMs} ms after that, its document ${arrival.documentAgeMs} ms old when the observer went in; ${metSteps(first)}: ${describeSteps(first)}; ${log.length} reading(s) recorded from then, arranged ${JSON.stringify(seenShapes)}${kept.held ? `, over ${SETTLE_MS} ms` : `, one of them other than ${JSON.stringify(want)} ${kept.atMs} ms in`}`,
    };
  });

  // ---- the compiler given back ------------------------------------------------------------
  await c.run('welcome-page.compiler-step-comes-back-with-the-compiler-on-path', {
    expected: `pressing "${WAYS_THROUGH.compiler[0]}" writes the plain name "${onPath}" to ${BINARY_SETTING}; a language server starts from it — its command line "${onPath} serve", its executable the binary under test, which the editor's PATH carries under that name — the status bar reads "${RUNNING}", and the compiler step reads "${STANDING_MET}" and "${SELECTED_LEAD}${onPath}" within ${FOLLOW_MS} ms, with nothing else pressed and on the same page`,
    plant: 'in the scratch copy, out/src/get-started.js with the step\'s way back writing a name nothing on the PATH carries',
  }, async () => {
    const doc = await welcomePage(ctx);
    const token = await markSteps(doc);
    await pressWayThrough(ctx, 'compiler', WAYS_THROUGH.compiler[0]);
    const setting = await until('the setting naming the plain name', 10000, binarySetting, (v) => v === onPath).catch(binarySetting);
    const running = await waitStatus(ctx.d, RUNNING, 60000).then(() => true, () => false);
    ctx.s.table.snapshot();
    const server = ctx.s.table.alive().find((p) => p.cmd === `${onPath} serve`);
    let exe = '';
    try { exe = server ? fs.realpathSync(`/proc/${server.pid}/exe`) : ''; } catch { exe = ''; }
    const step = await until('the compiler step reading met', FOLLOW_MS, async () => stepOf(await readPage(doc), 'compiler'), (s) => s.badge === STANDING_MET).catch(async () => stepOf(await readPage(doc), 'compiler'));
    const same = await samePage(doc, token);
    return {
      passed: setting === onPath && running && server !== undefined && exe === fs.realpathSync(bin) && step.badge === STANDING_MET && drawnValue(step)?.text === `${SELECTED_LEAD}${onPath}` && same,
      seen: `the setting reads ${JSON.stringify(setting)}; the status bar ${running ? 'reads running' : 'never read running'}; ${server === undefined ? `no process started as "${onPath} serve"` : `pid ${server.pid} "${server.cmd}", its executable ${exe}`}; the compiler step reads ${step.badge} with ${JSON.stringify(drawnValue(step)?.text ?? null)}; ${same ? 'the same page' : 'the page was replaced'}`,
    };
  });

  // ---- the registry taken away and given back ------------------------------------------------
  const removeTitle = commandTitle(ctx.manifest, 'aggrega.registries.remove');
  let removed = false;
  await c.run('welcome-page.registry-step-follows-a-removal-with-no-press', {
    expected: `removing ${CONFIGURED_HOST}, the only registry, with the Registries panel's "${removeTitle}" — the global file chosen, the removal confirmed — ends in the removal's notification; within ${FOLLOW_MS} ms, with nothing pressed on the page, its registry step reads "${STANDING_TO_DO}" and "${NONE_SELECTED}"; the panel no longer lists the host`,
    plant: 'in the scratch copy, out/src/get-started.js with the page left unread when the language server comes back up',
  }, async () => {
    const doc = await welcomePage(ctx);
    const watch = await observePage(doc);
    const menu = await rowMenu(ctx.d, 'Registries', CONFIGURED_HOST);
    // The removal is this check's means rather than its subject, but a row that
    // offers no Remove is what the panel shows, so it fails the check.
    if (!menu.reached || !menu.items.includes(removeTitle)) {
      return { passed: false, seen: `the ${CONFIGURED_HOST} row's right-click read ${describeRowMenu(menu)}, with no "${removeTitle}" to press, so no removal was made for the step to follow` };
    }
    const mark = (await toasts(ctx.d)).length;
    const statusAt = await statusMark(ctx);
    await pressMenuItem(ctx.d, removeTitle);
    await waitChooser(ctx.d, 'the choice of configuration file', (x) => x.placeholder === REMOVAL_DESTINATION_PROMPT && x.rows.length > 0, 10000);
    await pickQuickInputRow(ctx.d, GLOBAL_DESTINATION);
    const asked = await until('the removal asking to confirm', 10000, () => dialog(ctx.d), (d) => d !== null);
    await pressDialogButton(ctx.d, 'Remove');
    const ending = await waitToast(ctx.d, 'the removal ending', mark, (t) => t.message.startsWith(`${REGISTRY_REMOVAL_SUBJECT} `), 60000).catch(() => null);
    const endedAt = ending?.at ?? Date.now();
    const step = await until('the registry step reading to do', FOLLOW_MS, async () => stepOf(await readPage(doc), 'registry'), (s) => s.badge === STANDING_TO_DO && drawnValue(s)?.text === NONE_SELECTED).catch(async () => stepOf(await readPage(doc), 'registry'));
    const moved = (await pageReadings(doc, watch)).find((r) => (r.steps.find((s) => s.id === 'registry')?.value ?? '') === NONE_SELECTED);
    const server = ending === null ? `${describeReadings((await statusLog(ctx.d)).slice(statusAt))}, no removal having ended` : await runningAgain(ctx, statusAt, 60000)
      .then((v) => describeReadings(v), async () => `${describeReadings((await statusLog(ctx.d)).slice(statusAt))}, not running again within 60000 ms`);
    const listed = await until(`the Registries panel dropping ${CONFIGURED_HOST}`, 10000, () => registriesListed(ctx), (v) => !v.includes(CONFIGURED_HOST)).catch(() => registriesListed(ctx));
    removed = ending !== null;
    return {
      passed: ending !== null && step.badge === STANDING_TO_DO && drawnValue(step)?.text === NONE_SELECTED && moved !== undefined && moved.at - endedAt <= FOLLOW_MS && !listed.includes(CONFIGURED_HOST),
      seen: `the confirmation ${JSON.stringify(asked)}; ${ending === null ? 'no ending within 60000 ms' : `"${ending.message}"`}; the registry step reads ${step.badge} with ${JSON.stringify(drawnValue(step)?.text ?? null)}${moved === undefined ? '' : `, ${moved.at - endedAt} ms after the ending`}; the status bar read ${server} from the press; the Registries panel lists ${JSON.stringify(listed)}`,
    };
  });

  await c.run('welcome-page.registry-step-comes-back-with-an-added-registry', {
    expected: `adding ${CONFIGURED_HOST} again with the page's "${WAYS_THROUGH.registry[2]}" into the global file ends in the registration's notification, and the registry step reads "${STANDING_MET}" and "${SELECTED_LEAD}${CONFIGURED_HOST}" — by itself within ${FOLLOW_MS} ms or, where it does not move by itself, once the house has been pressed`,
    plant: 'in the scratch copy, out/src/registries-view.js with the add registering another host than the one given',
  }, async () => {
    need(removed, 'the registry was not removed, so there is nothing to add back');
    const doc = await welcomePage(ctx);
    const add = await addFromThePage(ctx, CONFIGURED_HOST);
    const want = `${SELECTED_LEAD}${CONFIGURED_HOST}`;
    const byItself = await until('the registry step reading met by itself', FOLLOW_MS, async () => stepOf(await readPage(doc), 'registry'), (s) => s.badge === STANDING_MET && drawnValue(s)?.text === want).then(() => true, () => false);
    if (!byItself) { await pressHouse(ctx); }
    const step = await until('the registry step reading met', 10000, async () => stepOf(await readPage(doc), 'registry'), (s) => s.badge === STANDING_MET && drawnValue(s)?.text === want).catch(async () => stepOf(await readPage(doc), 'registry'));
    return {
      passed: add.ending !== null && step.badge === STANDING_MET && drawnValue(step)?.text === want,
      seen: `${add.ending === null ? 'no ending' : `"${add.ending.message}"`}${add.question ? '; a question for a trust policy followed and was pressed away' : ''}; the registry step ${byItself ? 'moved by itself' : 'did not move by itself, and the house was pressed'}, and reads ${step.badge} with ${JSON.stringify(drawnValue(step)?.text ?? null)}`,
    };
  });
}
