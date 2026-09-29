// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { RESTART_COMMAND, RESTART_SERVER_ACTION, TOGGLE_BUILD_ON_INSPECT_COMMAND } from '../../src/daemon-status';
import { buildValidateParams } from '../../src/validate-request';
import { need, Outcome } from './checks';
import { runCompiler } from './cli';
import { recipeAnswer } from './inputs';
import { referenceAnswer } from './reference';
import {
  capture, closeAllEditors, commandTitle, deleteLine, describeDiagnostics, diagnostics, Line, open, putBack, ready, run, save, send, SuiteContext, theServer,
} from './suite-context';
import {
  commandsPanel, documentWith, holds, pressIn, pressOperation, pressToastButton, RUNNING, selectorRows, toasts, until, waitStatus, waitToast,
} from './workbench';

// The checks run in the gateway folder: which build of the extension and of the
// compiler is under test, then the build-analysis setting — its label, where it
// is kept, what it does to the language server's command line — and the two
// layers of diagnostics it separates, with when each one moves.

// GATEWAY_CHECKS names this scenario's checks in the order they run.
export const GATEWAY_CHECKS = [
  'welcome-page.names-the-extension-build',
  'language-server.runs-the-binary-under-test',
  'commands-panel.context-rows-name-the-opened-folder',
  'settings.build-on-inspect-label-is-derived-from-its-key',
  'settings.build-on-inspect-description-states-its-three-facts',
  'settings.build-on-inspect-toggle-is-kept-in-the-user-settings',
  'settings.build-on-inspect-toggle-in-a-remote-window',
  'language-server.inspection-flag-follows-the-setting',
  'problems.authoring-complaint-and-render-advisory-under-two-sources',
  'problems.render-advisory-clears-on-save-and-not-on-an-unsaved-edit',
  'problems.lockfile-drift-clears-after-pull',
  'problems.render-advisory-does-not-return-without-the-graph',
  'problems.which-trigger-moved-the-build-layer',
  'language-server.retired-setting-key-is-inert',
] as const;

const RELEASE = 'release-compose.yaml';
const BUILD_ON_INSPECT = 'aggrega.server.buildOnInspect';
const RETIRED_KEY = 'aggrega.server.renderDiagnostics';
const INSPECTION_FLAG = '--build-on-inspect';

// TOGGLE_ON_NOTICE is the sentence the toggle raises when it turns the analysis
// on, held here as the words a reader is to meet, so a change of wording is a
// change the check reports rather than follows.
const TOGGLE_ON_NOTICE = "Aggrega: the build's analysis will run while inspecting a graph. The language server reads this setting when it starts, so restart it to apply the change.";

// CONTEXT_ROW_LABELS are the three context rows, in the order they are drawn.
export const CONTEXT_ROW_LABELS = ['Project folder', 'Aggrega workspace', 'Release'];

const GRAPH_DOCUMENT = `!!document.getElementById('canvas') && !!document.getElementById('legend')`;

// humanise is how the settings editor turns one segment of a key path into
// words: camel case split at each capital, each word capitalised.
function humanise(segment: string): string {
  return segment.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// settingLabel is the label the settings editor derives for a key: the
// configuration's title, each middle segment of the key, then its last segment.
export function settingLabel(title: string, key: string): string {
  const segments = key.split('.').slice(1);
  const leaf = segments.pop() ?? '';
  return `${title} › ${segments.map(humanise).join(' › ')}: ${humanise(leaf)}`;
}

export interface SettingItem { category: string; label: string; description: string; checked: string | null; html: string }

const SETTING_ITEMS = `(() => {
  const e = document.querySelector('.settings-editor');
  if (!e || e.getBoundingClientRect().height === 0) { return null; }
  return [...e.querySelectorAll('.setting-item-contents')].map((i) => {
    const c = i.querySelector('.setting-value-checkbox');
    return {
      category: ((i.querySelector('.setting-item-category') || {}).innerText || ''),
      label: ((i.querySelector('.setting-item-label') || {}).innerText || ''),
      description: ((i.querySelector('.setting-item-description, .setting-item-value-description') || {}).innerText || '').trim(),
      checked: c ? (c.getAttribute('aria-checked') || (c.classList.contains('checked') ? 'true' : 'false')) : null,
      html: i.outerHTML.slice(0, 1200),
    };
  });
})()`;

// openSettingsOn opens the settings editor on `query` and returns the setting it
// draws under `drawnLabel`.
export async function openSettingsOn(ctx: SuiteContext, query: string, drawnLabel: string): Promise<SettingItem> {
  await send(ctx, 'workbench.action.openSettings2', [{ query }]);
  const items = await until(`the settings editor drawing the setting "${drawnLabel}"`, 20000, () => ctx.d.workbench<SettingItem[] | null>(SETTING_ITEMS),
    (v) => v !== null && v.some((i) => `${i.category}${i.label}`.trim() === drawnLabel));
  return (items ?? []).find((i) => `${i.category}${i.label}`.trim() === drawnLabel) as SettingItem;
}

// commandLineFor is the language server's command line the extension composes:
// the binary, `serve`, and the inspection flag only while the setting is on.
function commandLineFor(bin: string, on: boolean): string {
  return on ? `${bin} serve ${INSPECTION_FLAG}` : `${bin} serve`;
}

async function settingValue(ctx: SuiteContext, key: string): Promise<{ value: unknown; globalValue: unknown; workspaceValue: unknown }> {
  const r = await ctx.probe.request<{ value: unknown; inspect: { globalValue?: unknown; workspaceValue?: unknown } | null }>('configuration.inspect', { key });
  return { value: r.value, globalValue: r.inspect?.globalValue, workspaceValue: r.inspect?.workspaceValue };
}

// restartAndWait restarts the language server by its command and returns the
// new one once the status bar reads running again.
async function restartAndWait(ctx: SuiteContext): Promise<{ pid: number; cmd: string }> {
  const before = await theServer(ctx);
  await send(ctx, RESTART_COMMAND);
  const next = await theServer(ctx, 30000, before.pid);
  await waitStatus(ctx.d, RUNNING, 60000);
  return next;
}

// toggleAndRestart runs the toggle command and presses the restart button on
// the notification it raises, returning the notification and the new server.
async function toggleAndRestart(ctx: SuiteContext): Promise<{ notice: string; buttons: string[]; server: { pid: number; cmd: string } }> {
  const before = await theServer(ctx);
  const mark = (await toasts(ctx.d)).length;
  await send(ctx, TOGGLE_BUILD_ON_INSPECT_COMMAND);
  const t = await waitToast(ctx.d, 'the toggle raising its notification', mark, (x) => x.buttons.includes(RESTART_SERVER_ACTION), 15000);
  need(await pressToastButton(ctx.d, t.message.slice(0, 40), RESTART_SERVER_ACTION), `the notification "${t.message}" draws no "${RESTART_SERVER_ACTION}" button to press`);
  const server = await theServer(ctx, 30000, before.pid);
  await waitStatus(ctx.d, RUNNING, 60000);
  return { notice: t.message, buttons: t.buttons, server };
}

// References are the compiler's own words for the two findings of the layer
// checks, taken outside the editor over a second copy of the folder.
interface References { complaint: string[]; advisory: string[] }

async function takeReferences(ctx: SuiteContext, referenceFolder: string): Promise<References> {
  const scratch = path.join(referenceFolder, 'scratch-component.yaml');
  const content = fs.readFileSync(scratch, 'utf8').split('\n').filter((l) => l.trim() !== 'version: 1.0.0').join('\n');
  const answer = await referenceAnswer({
    binary: ctx.inputs.compiler.path, root: referenceFolder, method: 'aggrega/validate',
    params: buildValidateParams(scratch, content, RELEASE), home: ctx.home, table: ctx.s.table, log: ctx.cliLog,
  });
  const complaint = answer.ok ? ((answer.result as { diagnostics?: { message: string }[] }).diagnostics ?? []).map((d) => d.message) : [];
  const dry = await runCompiler(ctx.inputs.compiler.path, ['--offline', 'build', '--release', RELEASE, '--dry-run', '--quiet'], { cwd: referenceFolder, home: ctx.home, boundMs: 120000, log: ctx.cliLog });
  const advisory = `${dry.stdout}\n${dry.stderr}`.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('warning: ')).map((l) => l.slice('warning: '.length));
  return { complaint, advisory };
}

export async function gatewayChecks(ctx: SuiteContext, referenceFolder: string): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  const scratch = path.join(ctx.folder, 'scratch-component.yaml');
  const aggregate = path.join(ctx.folder, 'aggregate.yaml');
  const recipe = path.join(ctx.folder, 'catalog', 'recipe', 'compose', 'nginx-probed', '1.0.0', 'recipe.yaml');
  const lock = path.join(ctx.folder, 'release-compose.lock');
  await ready(ctx);

  // ---- which build is under test ----
  const houseTitle = commandTitle(ctx.manifest, 'aggrega.getStarted.open');
  const stamp = ctx.inputs.extension.buildStamp;
  const recipeNow = recipeAnswer(ctx.inputs.extension.dir);
  const now = 'failure' in recipeNow ? `unreadable: ${recipeNow.failure}` : recipeNow.version;
  const manifestVersion = (JSON.parse(fs.readFileSync(path.join(ctx.s.root.extensionCopy, 'package.json'), 'utf8')) as { version: string }).version;
  await c.run('welcome-page.names-the-extension-build', {
    expected: `pressing the Commands panel's title action "${houseTitle}" (the manifest's title for aggrega.getStarted.open) opens the welcome page, whose foot reads "Extension ${stamp}": the build stamp of the copy under test, equal to what the compiler's build-provenance recipe answers for the extension's checkout now (${now}); never the manifest's version (${manifestVersion}) or "version not reported"`,
    plant: 'in the scratch copy of the extension, out/build-version.json rewritten to name another build',
  }, async (): Promise<Outcome> => {
    await closeAllEditors(ctx);
    await run(ctx, 'workbench.view.extension.aggrega');
    await pressIn(ctx.d, null, `#workbench\\.parts\\.sidebar .pane-header .action-label[aria-label="${houseTitle}"]`);
    const page = await documentWith(ctx.d, 'the welcome page opening', `!!document.querySelector('.version-entry')`, 20000);
    const foot = await until('the welcome page drawing its foot', 10000, () => page.evaluate<string[]>(`[...document.querySelectorAll('.version-entry')].map((e) => (e.innerText || '').replace(/\\s+/g, ' ').trim())`), (v) => v.length > 0);
    return { passed: foot[0] === `Extension ${stamp}` && stamp === now, seen: `the foot reads ${JSON.stringify(foot)}; the copy's stamp ${stamp}; the recipe now ${now}`, evidence: { foot } };
  });

  await c.run('language-server.runs-the-binary-under-test', {
    expected: `aggrega.server.binaryPath holds the binary under test (${bin}) in the user settings; the running language server's executable is that file, started as "${bin} serve"; and that binary answers \`version -o json\` with commit ${ctx.inputs.compiler.commit}`,
    plant: 'in the scratch copy, out/src/daemon.js made to start the language server by the binary\'s file name alone, so the configured file is not what runs',
  }, async () => {
    const setting = await settingValue(ctx, 'aggrega.server.binaryPath');
    const srv = await theServer(ctx);
    const exe = fs.realpathSync(srv.exe);
    const v = await runCompiler(bin, ['version', '-o', 'json'], { cwd: ctx.folder, home: ctx.home, boundMs: 30000, log: ctx.cliLog });
    let commit = '';
    try { commit = (JSON.parse(v.stdout) as { commit: string }).commit; } catch { commit = `unreadable: ${v.stdout.slice(0, 100)}`; }
    const passed = setting.globalValue === bin && exe === fs.realpathSync(bin) && srv.cmd.split(' ')[0] === bin && commit === ctx.inputs.compiler.commit;
    return { passed, seen: `setting ${JSON.stringify(setting.globalValue)}; server pid ${srv.pid} executable ${exe}, command line "${srv.cmd}"; version -o json commit ${commit}` };
  });

  // ---- the folder ----
  await contextRowsCheck(ctx);

  // ---- the setting's label, and where it is kept ----
  const title = ctx.manifest.contributes.configuration.title;
  const label = settingLabel(title, BUILD_ON_INSPECT);
  const declared = ctx.manifest.contributes.configuration.properties[BUILD_ON_INSPECT]?.description ?? '';
  let drawnDescription = '';
  await c.run('settings.build-on-inspect-label-is-derived-from-its-key', {
    expected: `searching the settings editor for "buildOnInspect" draws the label "${label}" — the configuration's title "${title}" and the key path ${BUILD_ON_INSPECT} as the editor words it, with no title of the property's own — and beside it the description the manifest declares`,
    plant: 'in the scratch copy\'s package.json, a markdown description given to the property, which the settings editor draws in place of the declared one',
  }, async () => {
    const item = await openSettingsOn(ctx, 'buildOnInspect', label);
    drawnDescription = item.description;
    return { passed: item.description === declared, seen: `label "${item.category}${item.label}"; description ${item.description === declared ? 'as declared' : `"${item.description}"`}`, evidence: { item } };
  });
  await c.forPerson('settings.build-on-inspect-description-states-its-three-facts', {
    expected: 'the description states that the analysis runs while inspecting an IR graph, that inspecting costs more when it runs, and that nothing is written to disk',
    plant: 'none: this is a judgement of the wording',
    question: 'Does the drawn description convey the three facts — while inspecting an IR graph, it costs more, and nothing is written to disk?',
  }, async () => {
    need(drawnDescription !== '', 'the setting was not drawn, so there is no description to judge');
    return { screenshot: await capture(ctx, 'settings-build-on-inspect'), drawnText: drawnDescription };
  });

  const userSettings = path.join(ctx.s.root.userData, 'User', 'settings.json');
  const workspaceSettings = path.join(ctx.folder, '.vscode', 'settings.json');
  await c.run('settings.build-on-inspect-toggle-is-kept-in-the-user-settings', {
    expected: 'ticking the setting in the settings editor keeps it ticked after the editor is closed and opened again, writes it to the user settings file, and writes nothing to the folder\'s workspace settings',
    plant: 'in the scratch copy\'s package.json, the property declared on by default',
  }, async () => {
    const box = `.settings-editor .setting-item-bool .setting-value-checkbox`;
    await openSettingsOn(ctx, 'buildOnInspect', label);
    await pressIn(ctx.d, null, box);
    const after = await until('the setting reading on', 10000, () => settingValue(ctx, BUILD_ON_INSPECT), (v) => v.globalValue === true);
    await closeAllEditors(ctx);
    const reopened = await openSettingsOn(ctx, 'buildOnInspect', label);
    const inUser = /"aggrega\.server\.buildOnInspect"\s*:\s*true/.test(fs.readFileSync(userSettings, 'utf8'));
    const inWorkspace = fs.existsSync(workspaceSettings) && fs.readFileSync(workspaceSettings, 'utf8').includes(BUILD_ON_INSPECT);
    // Put it back off, the state the next check starts from.
    await pressIn(ctx.d, null, box);
    await until('the setting reading off again', 10000, () => settingValue(ctx, BUILD_ON_INSPECT), (v) => v.value === false);
    await closeAllEditors(ctx);
    const passed = reopened.checked === 'true' && inUser && !inWorkspace && after.workspaceValue === undefined;
    return { passed, seen: `after the tick: global ${JSON.stringify(after.globalValue)}, workspace ${JSON.stringify(after.workspaceValue)}; reopened checked ${reopened.checked}; in the user settings file ${inUser}; in the workspace settings ${inWorkspace}` };
  });
  await c.forPerson('settings.build-on-inspect-toggle-in-a-remote-window', {
    expected: 'in a remote window, the toggle lands in the Remote settings file',
    plant: 'none: this window is local, so the remote branch cannot be reached here',
    question: 'This editor is a local window, so its user settings file is the one checked above. In a remote window (a dev container), does the toggle land in the Remote settings file?',
  }, async () => ({ screenshot: null, drawnText: `user settings file of this local window: ${userSettings}` }));

  // ---- the setting reaches the language server ----
  await c.run('language-server.inspection-flag-follows-the-setting', {
    expected: `with the setting off, the restart command leaves one server started as "${commandLineFor(bin, false)}"; the toggle command raises "${TOGGLE_ON_NOTICE}" with a "${RESTART_SERVER_ACTION}" button; pressing it starts a server as "${commandLineFor(bin, true)}"`,
    plant: 'in the scratch copy, out/src/daemon.js made to append the flag whatever the setting says',
  }, async () => {
    need((await settingValue(ctx, BUILD_ON_INSPECT)).value === false, 'the setting is not off, the state this check starts from');
    const off = await restartAndWait(ctx);
    const on = await toggleAndRestart(ctx);
    const passed = off.cmd === commandLineFor(bin, false) && on.notice === TOGGLE_ON_NOTICE && on.buttons.includes(RESTART_SERVER_ACTION) && on.server.cmd === commandLineFor(bin, true);
    return { passed, seen: `after the restart: "${off.cmd}"; the notification "${on.notice}" with ${JSON.stringify(on.buttons)}; after its button: "${on.server.cmd}"` };
  });

  // ---- two layers of diagnostics ----
  const refs = await takeReferences(ctx, referenceFolder);
  const advisoryOn = async (): Promise<boolean> => (await diagnostics(ctx, aggregate)).some((d) => d.source === 'aggrega-build' && refs.advisory.includes(d.message));
  let layersReady = false;
  await c.run('problems.authoring-complaint-and-render-advisory-under-two-sources', {
    expected: 'with the analysis on, breaking a Component the Release does not use and showing the graph puts the authoring complaint on that file under the source "aggrega" and the render advisory on the Aggregate under "aggrega-build", each in the compiler\'s own words; turning the analysis off, restarting and showing the graph again takes the render advisory out of "aggrega-build"',
    plant: 'in the scratch copy, out/src/diagnostics.js made to file the build layer under the source "aggrega"',
  }, async () => {
    need(refs.complaint.length > 0, `the compiler gave no reference words for the complaint (validate answered no diagnostic)`);
    need(refs.advisory.length === 1, `the compiler gave ${refs.advisory.length} render warnings for the folder, not the one advisory`);
    need((await theServer(ctx)).cmd === commandLineFor(bin, true), 'the language server is not running with the analysis on');
    const removed = await deleteLine(ctx, scratch, 'version: 1.0.0');
    const panel = await commandsPanel(ctx.d);
    await pressOperation(ctx.d, panel, 'aggrega.graph.show');
    await documentWith(ctx.d, 'the graph panel opening', GRAPH_DOCUMENT, 30000);
    const both = await until('both layers being filed', 60000, async () => ({ scratch: await diagnostics(ctx, scratch), aggregate: await diagnostics(ctx, aggregate) }),
      (v) => v.scratch.some((d) => refs.complaint.includes(d.message)) && v.aggregate.some((d) => refs.advisory.includes(d.message)));
    const complaint = both.scratch.find((d) => refs.complaint.includes(d.message));
    const advisory = both.aggregate.find((d) => refs.advisory.includes(d.message));
    const twoSources = complaint?.source === 'aggrega' && advisory?.source === 'aggrega-build';
    // The control: the analysis off, restarted, the graph shown again.
    const off = await toggleAndRestart(ctx);
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.graph.show');
    const left = await until('the render advisory leaving "aggrega-build"', 30000, advisoryOn, (v) => !v).then(() => true, () => false);
    // Back on, for the checks that follow, with the graph panel still open.
    const on = await toggleAndRestart(ctx);
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.graph.show');
    layersReady = await until('the render advisory back after the analysis is on again', 60000, advisoryOn, (v) => v).then(() => true, () => false);
    await putBack(ctx, scratch, removed);
    await save(ctx, scratch);
    return {
      passed: twoSources && left && off.server.cmd === commandLineFor(bin, false),
      seen: `complaint ${describeDiagnostics(scratch, complaint ? [complaint] : [])}; advisory ${describeDiagnostics(aggregate, advisory ? [advisory] : [])}; with the analysis off (${off.server.cmd}) the advisory ${left ? 'left' : 'stayed under'} "aggrega-build"; back on (${on.server.cmd}) it ${layersReady ? 'returned' : 'did not return'}`,
      evidence: { references: refs, complaint, advisory },
    };
  });

  // ---- when the build layer moves ----
  const observations: string[] = [];
  let recipeLine: Line | null = null;
  await c.run('problems.render-advisory-clears-on-save-and-not-on-an-unsaved-edit', {
    expected: 'with the graph panel open behind another tab, deleting the Recipe\'s liveness probe without saving leaves the render advisory under "aggrega-build" (watched for 8 s), and saving takes it out within 20 s with no press on Graph',
    plant: 'in the scratch copy, out/src/extension.js made not to redraw an open graph when a document changes on disk',
  }, async () => {
    need(layersReady, 'the render advisory was not standing under "aggrega-build" with the analysis on');
    recipeLine = await deleteLine(ctx, recipe, 'live: { tcp: {{ .infra.port }} }');
    const unsaved = await holds(8000, advisoryOn, (v) => v);
    observations.push(`an unsaved edit of the Recipe ${unsaved.held ? 'left the advisory standing' : `took the advisory out after ${unsaved.atMs} ms`}`);
    const t0 = Date.now();
    await save(ctx, recipe);
    const cleared = await until('the render advisory leaving after the save', 20000, advisoryOn, (v) => !v).then(() => Date.now() - t0, () => -1);
    return { passed: unsaved.held && cleared >= 0, seen: `unsaved for 8 s: ${unsaved.held ? 'the advisory stood' : `the advisory left at ${unsaved.atMs} ms`}; after the save: ${cleared >= 0 ? `left at ${cleared} ms` : 'still standing at 20000 ms'}` };
  });

  await c.run('problems.lockfile-drift-clears-after-pull', {
    expected: 'the save that changed the Recipe files a drift warning on the lockfile under "aggrega"; pressing Pull on the Commands panel ends in its completion line, and the warning then leaves the panel within 15 s with no press on Graph',
    plant: 'in the scratch copy, out/src/disk-change.js made to leave the lockfile out of what the on-disk watcher reports',
  }, async () => {
    const changed = recipeLine;
    need(changed !== null, 'the Recipe was not changed and saved, so no drift was raised');
    const drift = await until('a drift warning on the lockfile', 30000, () => diagnostics(ctx, lock), (v) => v.some((d) => d.source === 'aggrega'));
    const warning = drift.find((d) => d.source === 'aggrega');
    const mark = ctx.out.mark();
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.pull');
    await ctx.out.waitFor('the pull ending in its completion line', mark, (t) => /^The pull (resolved|did not complete)/m.test(t), 120000);
    const pulled = ctx.out.since(mark);
    const t0 = Date.now();
    const cleared = await until('the drift warning leaving after the pull', 15000, () => diagnostics(ctx, lock), (v) => !v.some((d) => d.source === 'aggrega')).then(() => Date.now() - t0, () => -1);
    return {
      passed: /^The pull resolved/m.test(pulled) && cleared >= 0,
      seen: `drift warning "${warning?.message ?? ''}"; the pull: "${(pulled.split('\n').find((l) => l.startsWith('The pull')) ?? '').slice(0, 160)}"; the warning ${cleared >= 0 ? `left at ${cleared} ms` : 'still standing at 15000 ms'}`,
    };
  });

  await c.run('problems.render-advisory-does-not-return-without-the-graph', {
    expected: 'with the graph panel closed, putting the liveness probe back and saving leaves the render advisory out of "aggrega-build" (watched for 10 s); showing the graph again brings it back',
    plant: 'in the scratch copy, out/src/extension.js made to show the graph, and so compile the Release, whenever a document changes on disk, whether or not a graph panel is open',
  }, async () => {
    const taken = recipeLine;
    need(taken !== null, 'the Recipe\'s probe was not taken out, so there is nothing to put back');
    await closeAllEditors(ctx);
    const graphs = (await Promise.all((await ctx.d.webviews()).map((w) => w.evaluate<boolean>(GRAPH_DOCUMENT).catch(() => false)))).filter((x) => x).length;
    need(graphs === 0, 'the graph panel is still drawn after every editor was closed');
    await putBack(ctx, recipe, taken);
    await save(ctx, recipe);
    const absent = await holds(10000, advisoryOn, (v) => !v);
    observations.push(`a save with no graph panel open ${absent.held ? 'left the advisory out' : `brought the advisory back at ${absent.atMs} ms`}`);
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.graph.show');
    const back = await until('the render advisory returning with the graph', 60000, advisoryOn, (v) => v).then(() => true, () => false);
    return { passed: absent.held && back, seen: `for 10 s with no graph: ${absent.held ? 'absent' : `back at ${absent.atMs} ms`}; with the graph shown: ${back ? 'returned' : 'did not return'}`, evidence: { observations } };
  });
  await c.forPerson('problems.which-trigger-moved-the-build-layer', {
    expected: 'the build layer moves only on a request that compiles the Release: the graph shown, a save or a write of its lockfile with its panel open, a restart with its panel open, a build, a preview, or a write of its lockfile while a finding stands on that lockfile and no panel shows the Release',
    plant: 'none: this records what was observed',
    question: 'The runner recorded whether the render advisory moved on an unsaved edit, and on a save with no graph panel open. Does either contradict the reading that only a compile of the Release moves the build layer?',
  }, async () => ({ screenshot: null, drawnText: observations.join('; ') || 'nothing was observed: the checks before it did not run' }));

  // ---- the retired setting ----
  await c.run('language-server.retired-setting-key-is-inert', {
    expected: `${RETIRED_KEY} set to true in the user settings reaches nothing: after a restart the server's command line is the one the current settings compose, with no flag of the retired key; the manifest declares no such property; and the compiled extension names it nowhere`,
    plant: `in the scratch copy, out/src/daemon.js made to append --render-diagnostics when ${RETIRED_KEY} is set`,
  }, async () => {
    const doc = await open(ctx, userSettings);
    need((doc.text ?? '').startsWith('{\n'), 'the user settings file does not open with a brace on its own line');
    await ctx.probe.request('document.edit', { path: userSettings, start: { line: 1, character: 0 }, text: `  "${RETIRED_KEY}": true,\n` });
    await save(ctx, userSettings);
    const read = await until('the editor reading the retired key', 10000, () => settingValue(ctx, RETIRED_KEY), (v) => v.globalValue === true);
    const onNow = (await settingValue(ctx, BUILD_ON_INSPECT)).value === true;
    const srv = await restartAndWait(ctx);
    const declared = RETIRED_KEY in ctx.manifest.contributes.configuration.properties;
    const compiled = walkJs(path.join(ctx.s.root.extensionCopy, 'out', 'src'));
    const naming = compiled.filter((f) => fs.readFileSync(f, 'utf8').includes('renderDiagnostics'));
    const control = compiled.filter((f) => fs.readFileSync(f, 'utf8').includes('buildOnInspect'));
    // Take the key out again.
    await open(ctx, userSettings);
    await ctx.probe.request('document.edit', { path: userSettings, start: { line: 1, character: 0 }, end: { line: 2, character: 0 }, text: '' });
    await save(ctx, userSettings);
    await closeAllEditors(ctx);
    const passed = srv.cmd === commandLineFor(bin, onNow) && !srv.cmd.includes('render') && !declared && naming.length === 0 && control.length > 0;
    return { passed, seen: `the editor read ${RETIRED_KEY} = ${JSON.stringify(read.globalValue)}; after the restart "${srv.cmd}"; declared in the manifest ${declared}; compiled files naming it ${naming.length}, and ${control.length} naming buildOnInspect (the search's control)` };
  });
}

function walkJs(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { out.push(...walkJs(f)); } else if (e.name.endsWith('.js')) { out.push(f); }
  }
  return out;
}

// contextRowsCheck: the three context rows name the folder the window opened,
// the root the language server anchored to (the same folder here) and the one
// Release it holds.
export async function contextRowsCheck(ctx: SuiteContext): Promise<void> {
  const base = path.basename(ctx.folder);
  const releases = fs.readdirSync(ctx.folder).filter((f) => /^release.*\.ya?ml$/.test(f));
  const want = [
    { label: CONTEXT_ROW_LABELS[0], value: base },
    { label: CONTEXT_ROW_LABELS[1], value: base },
    { label: CONTEXT_ROW_LABELS[2], value: releases[0] ?? '' },
  ];
  await ctx.checks.run('commands-panel.context-rows-name-the-opened-folder', {
    expected: `the first three rows read ${CONTEXT_ROW_LABELS.join(', ')} in that order; the first two name the folder opened ("${base}"), and the Release row names its only Release ("${releases[0] ?? ''}") with nothing chosen`,
    plant: 'in the scratch copy, out/src/selector-levels.js with the first context row\'s label changed',
  }, async () => {
    need(releases.length === 1, `the folder holds ${releases.length} Release files, not one`);
    const doc = await commandsPanel(ctx.d);
    const rows = await until('the three context rows naming the folder', 20000, () => selectorRows(doc),
      (r) => r.length >= 3 && want.every((w, i) => r[i].label === w.label && r[i].value === w.value)).catch(async () => selectorRows(doc));
    const seen = rows.slice(0, 3).map((r) => `${r.label}: ${r.value}${r.warning ? ' (marked)' : ''}`).join(' | ');
    return { passed: rows.length >= 3 && want.every((w, i) => rows[i].label === w.label && rows[i].value === w.value), seen, evidence: { rows } };
  });
}
