// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { loadAll } from 'js-yaml';

import { commandIdFor, PANEL_ACTIONS } from '../../src/operation-groups';
import { REMOVAL_SUBJECT } from '../../src/plugin-removal';
import { CONFIGURED_GROUP_LABEL, EMBEDDED_GROUP_LABEL, PluginListDoc, pluginRemovalConfigTarget, rowForPlugin } from '../../src/plugins-run';
import { shortUri } from '../../src/uri-display';
import { need } from './checks';
import { endingOf, runCompiler } from './cli';
import { containerViews, PANEL_ORDER, restoring } from './commands-panel';
import { EDITOR_CANCEL } from './levels';
import { closeAllEditors, commandTitle, ready, run, send, SuiteContext } from './suite-context';
import { folderRowsCheck } from './suite-endings';
import { paletteTitle } from './suite-first-day';
import { setBinaryPath } from './suite-killed';
import {
  declineDialog, describeDialog, describeReads, leftOpen, markSaid, nothingSaid, offered, panelLabels, QUIET_MS, quietSince, REMOVE_BUTTON, rowOperationCommands, rowOperationTitles, rowsOffering, saidSince,
  statusReadsSince, takeFromRowMenu, waitDialog,
} from './suite-list-panels';
import { ROW_NONE_AVAILABLE } from './suite-welcome-empty-folder';
import { runningAgain, statusMark } from './welcome';
import {
  describeRowMenu, guard, holds, hoverAt, NOT_RUNNING, paletteRows, pressDialogButton, quickInput, revealTreeRow, RowMenu, rowMenu, stated, treeRowCentre,
  TreeRow, treeRows, until, waitToast,
} from './workbench';

// The checks run in a folder whose configuration holds plugin entries and nothing
// else: a Helm provider binding the compiler describes, and a linter at a file
// that does not exist, which it cannot. They read what the Plugins panel
// draws for each beside the compiler's own listing; where the removal is offered
// and where it is not — a guest built into the compiler, an entry the compiler
// could not describe, a group heading, the row a failed listing draws — and what
// its consent names, declined and given; and that the command palette offers the
// list panels' own operations and none of their rows' operations.

export const CONFIGURED_PLUGINS_CHECKS = [
  'commands-panel.context-rows-name-the-folder-holding-no-release',
  'plugins-panel.removal-offered-only-on-a-configured-entry-the-compiler-describes',
  'plugins-panel.configured-rows-read-as-the-compilers-listing',
  'plugins-panel.removal-consents-naming-the-project-file-and-removes-only-once-given',
  'palette.offers-the-panel-operations-and-none-of-the-row-operations',
  'plugins-panel.no-removal-on-the-row-a-failed-listing-draws',
] as const;

// checkNamed is one of these checks by its name, where a reason names the check
// whose reading it rests on: a name the list above does not hold does not compile.
const checkNamed = (name: (typeof CONFIGURED_PLUGINS_CHECKS)[number]): string => name;

// The sentence the removal's consent closes its detail with, held as written: the
// reach it promises is what a reader consents to.
const TEXT_ALONE = 'The removal operates on the configuration text alone, so nothing else on this machine is removed.';
const removalConsent = (type: string, reference: string): string => `Remove the ${type} plugin ${reference}?`;

// PALETTE_ANSWER_MS is how long the palette is given to answer a title typed into
// it: the bound a panel operation is waited for within, and the window a row
// operation is watched over, so an absence is watched as long as a presence is
// allowed to take.
const PALETTE_ANSWER_MS = 5000;

// rowIcons reads the icon classes one drawn row of a side-bar view carries. It is
// a second reader beside the readiness checks' reading of the Catalog panel's
// rows, which takes every row of that one panel with its geometry; this takes one
// row of any panel, and nothing but its icons.
function rowIcons(ctx: SuiteContext, title: string, label: string): Promise<string[]> {
  return ctx.d.workbench<string[]>(`((title, label) => {
    for (const pane of document.querySelectorAll('.pane')) {
      const h = pane.querySelector('.pane-header');
      const t = h ? ((h.querySelector('h3.title, .title') || {}).innerText || '').trim() : '';
      if (t.toLowerCase() !== title.toLowerCase()) { continue; }
      for (const r of pane.querySelectorAll('.pane-body .monaco-list-row')) {
        if (((r.querySelector('.label-name') || {}).innerText || '').trim() !== label) { continue; }
        return [...r.querySelectorAll('.custom-view-tree-node-item-icon')].map((i) => String(i.className));
      }
    }
    return [];
  })(${JSON.stringify(title)}, ${JSON.stringify(label)})`);
}

// headingOf is the Plugins panel's heading for one group as drawn, its count
// beside its label.
const headingOf = (rows: readonly TreeRow[], group: string): TreeRow | undefined => rows.find((r) => r.level === 1 && r.label.startsWith(`${group} (`));

// foldEmbedded folds the Plugins panel's group of guests built into the compiler,
// as a reader does by pressing its heading, so the rows beneath the configured
// group are the ones drawn: two rows in the two groups can read alike.
async function foldEmbedded(ctx: SuiteContext): Promise<string> {
  const rows = (await treeRows(ctx.d, 'Plugins')) ?? [];
  const heading = headingOf(rows, EMBEDDED_GROUP_LABEL);
  if (heading === undefined) { throw new Error(`the Plugins panel draws no "${EMBEDDED_GROUP_LABEL} (<n>)" heading: ${JSON.stringify(rows.map((r) => r.label))}`); }
  if (heading.expanded === 'false') { return heading.label; }
  await revealTreeRow(ctx.d, 'Plugins', heading.label);
  const at = await treeRowCentre(ctx.d, 'Plugins', heading.label);
  if (at === null) { throw new Error(`the "${heading.label}" heading is not drawn where it can be pressed`); }
  await ctx.d.click(at);
  await until(`the "${heading.label}" heading folding`, 5000, async () => headingOf((await treeRows(ctx.d, 'Plugins')) ?? [], EMBEDDED_GROUP_LABEL), (h) => h !== undefined && h.expanded === 'false');
  return heading.label;
}

export async function configuredPluginsChecks(ctx: SuiteContext, opts: { reference: string; missing: string }): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  const config = path.join(ctx.folder, '.aggrega-config.yaml');
  const removeTitle = commandTitle(ctx.manifest, 'aggrega.plugins.remove');
  const pluginOps = rowOperationTitles(ctx, 'aggrega.plugins');
  await ready(ctx);

  // ---- the folder ----
  await folderRowsCheck(ctx, 'commands-panel.context-rows-name-the-folder-holding-no-release', 'with no Release in it', ROW_NONE_AVAILABLE);

  // The compiler's own listing, asked outside the editor in a copy of the folder;
  // a path it names in that copy is read as the folder's own. A listing that does
  // not name what the folder declares fails each check built on it.
  // It is bounded as a cold pull or build is, at 180000 ms: the scenario's home
  // starts with an empty compiled-module cache, so this listing may have to
  // compile every guest built into the compiler before it can describe one, and on
  // a loaded machine that takes far longer than it does alone.
  const listing = await runCompiler(bin, ['plugin', 'list', '-o', 'json'], { cwd: opts.reference, home: ctx.home, boundMs: 180000, log: ctx.cliLog });
  let doc: PluginListDoc = {};
  try { doc = JSON.parse(listing.stdout.split(opts.reference).join(ctx.folder)) as PluginListDoc; } catch { doc = {}; }
  const configured = doc.configured ?? [];
  const described = configured.find((e) => e.type !== undefined && e.error === undefined);
  const undescribed = configured.find((e) => e.type === undefined && e.error !== undefined);
  const embedded = (doc.embedded ?? [])[0];
  const unlisted = (what: string): string => `the compiler's own listing outside the editor does not name ${what}: ${endingOf(listing)}, ${listing.stdout.slice(0, 300)}`;

  // ---- where the removal is offered, and where it is not ----
  let describedRow: RowMenu | null = null;
  await c.run('plugins-panel.removal-offered-only-on-a-configured-entry-the-compiler-describes', {
    expected: `a right-click on a row under the "${EMBEDDED_GROUP_LABEL} (<n>)" heading (the first guest the compiler's own listing names), on that heading, on the "${CONFIGURED_GROUP_LABEL} (<n>)" heading and on the configured entry the compiler could not describe reaches the row and offers no "${removeTitle}", while the same reading of the configured entry it describes offers "${removeTitle}" — the counts and the entries being the compiler's own \`aggrega plugin list -o json\` over a copy of the folder`,
    plant: 'in the scratch copy, out/src/plugins-run.js with a guest built into the compiler carrying the value a configured entry carries',
  }, () => restoring(async () => {
    if (listing.status !== 0 || described === undefined || undescribed === undefined || embedded === undefined) { return { passed: false, seen: unlisted('a guest built into it, one configured entry it describes and one it does not') }; }
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.plugins.focus');
    // A guest built in, read while its group is open. The panel draws the rows in
    // sight, so with that group open the configured group may lie below them.
    const first = await until('the Plugins panel drawing its built-in guests', 30000, async () => (await treeRows(ctx.d, 'Plugins')) ?? [], (v) => headingOf(v, EMBEDDED_GROUP_LABEL) !== undefined && v.some((r) => r.level === 2 && r.label === shortUri(embedded.uri)));
    const embeddedHeading = headingOf(first, EMBEDDED_GROUP_LABEL)?.label ?? '';
    const inEmbedded = await rowsOffering(ctx, 'Plugins', [shortUri(embedded.uri), embeddedHeading], [removeTitle]);
    // The configured group's rows, read with the other folded.
    await foldEmbedded(ctx);
    const folded = await until('the Plugins panel drawing its configured group', 10000, async () => (await treeRows(ctx.d, 'Plugins')) ?? [], (v) => headingOf(v, CONFIGURED_GROUP_LABEL) !== undefined);
    const configuredHeading = headingOf(folded, CONFIGURED_GROUP_LABEL)?.label ?? '';
    const inConfigured = await rowsOffering(ctx, 'Plugins', [configuredHeading, shortUri(undescribed.uri)], [removeTitle]);
    const control = await rowMenu(ctx.d, 'Plugins', shortUri(described.uri));
    if (control.items.length > 0) { await ctx.d.press('Escape'); }
    need(control.reached, `the right-click never reached the configured "${shortUri(described.uri)}" row: ${describeRowMenu(control)}`);
    describedRow = control;
    if (offered(control, [removeTitle]).length !== 1) { return { passed: false, seen: `its positive control did not fire: the configured "${shortUri(described.uri)}" row's right-click read ${describeRowMenu(control)}, so the reading is not shown to see the removal offered` }; }
    const offering = [...inEmbedded.offering, ...inConfigured.offering];
    if (offering.length === 0) { need([...inEmbedded.unreached, ...inConfigured.unreached].length === 0, `the right-click never reached ${[...inEmbedded.unreached, ...inConfigured.unreached].join('; ')}`); }
    return { passed: offering.length === 0, seen: `${describeReads([...inEmbedded.reads, ...inConfigured.reads])}; the control, the configured "${shortUri(described.uri)}": ${describeRowMenu(control)}` };
  }, () => leftOpen(ctx)));

  // ---- the configured rows, beside the compiler's listing ----
  await c.run('plugins-panel.configured-rows-read-as-the-compilers-listing', {
    expected: `beneath "${CONFIGURED_GROUP_LABEL} (<n>)", each configured entry \`aggrega plugin list -o json\` reports over a copy of the folder is drawn as the extension's own shaping of that entry gives it: the entry the compiler describes as "${described ? shortUri(described.uri) : '<its name>'}" with ${described ? `"${rowForPlugin(described).description}"` : 'its type and version'} beside it and the theme icon ${described ? `"${rowForPlugin(described).icon}"` : '<its icon>'}; the entry it could not describe as "${undescribed ? shortUri(undescribed.uri) : '<its name>'}" with ${undescribed ? `"${rowForPlugin(undescribed).description}"` : 'nothing'} beside it, the theme icon ${undescribed ? `"${rowForPlugin(undescribed).icon}"` : '<its icon>'}, and a hover carrying every line of the tooltip that shaping gives it, the compiler's error among them`,
    plant: 'in the scratch copy, out/src/plugins-run.js with an entry nothing could describe drawn with the icon of one it could',
  }, () => restoring(async () => {
    if (described === undefined || undescribed === undefined) { return { passed: false, seen: unlisted('both configured entries') }; }
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.plugins.focus');
    await foldEmbedded(ctx);
    // What each row is to draw is the extension's own shaping of the compiler's
    // entry for it, read here rather than written again: which icon and which words
    // an entry of each kind is shaped with is the unit specification's to hold, and
    // this check holds the panel to drawing what that shaping gives.
    const shaped = { good: rowForPlugin(described), bad: rowForPlugin(undescribed) };
    const rows = await until('the configured rows drawn', 20000, async () => (await treeRows(ctx.d, 'Plugins')) ?? [], (v) => [shaped.good, shaped.bad].every((s) => v.some((r) => r.level === 2 && r.label === s.label)));
    const at = rows.findIndex((r) => r.label === headingOf(rows, CONFIGURED_GROUP_LABEL)?.label);
    const under = rows.slice(at + 1).filter((r) => r.level === 2);
    const good = under.find((r) => r.label === shaped.good.label);
    const bad = under.find((r) => r.label === shaped.bad.label);
    const goodIcons = await rowIcons(ctx, 'Plugins', shaped.good.label);
    const badIcons = await rowIcons(ctx, 'Plugins', shaped.bad.label);
    const centre = await revealTreeRow(ctx.d, 'Plugins', shaped.bad.label);
    const hover = await hoverAt(ctx.d, centre);
    const unhovered = shaped.bad.tooltip.split('\n').filter((l) => !hover.includes(l));
    const passed = good !== undefined && good.description === shaped.good.description && goodIcons.some((i) => i.includes(`codicon-${shaped.good.icon}`))
      && bad !== undefined && bad.description === shaped.bad.description && badIcons.some((i) => i.includes(`codicon-${shaped.bad.icon}`)) && unhovered.length === 0;
    return {
      passed,
      seen: `under "${headingOf(rows, CONFIGURED_GROUP_LABEL)?.label ?? 'no configured heading'}": ${JSON.stringify(under.map((r) => `${r.label} | ${r.description}`))}; icons ${JSON.stringify({ [shaped.good.label]: goodIcons, [shaped.bad.label]: badIcons })}; the hover on "${shaped.bad.label}" ${JSON.stringify(hover.slice(0, 400))}${unhovered.length > 0 ? `, missing ${JSON.stringify(unhovered)}` : ''}; shaped from the compiler's entries ${JSON.stringify({ described: { label: shaped.good.label, description: shaped.good.description, icon: shaped.good.icon }, undescribed: { label: shaped.bad.label, description: shaped.bad.description, icon: shaped.bad.icon, tooltip: shaped.bad.tooltip } })}`,
    };
  }, () => leftOpen(ctx)));

  // ---- the removal's consent, declined and given ----
  await c.run('plugins-panel.removal-consents-naming-the-project-file-and-removes-only-once-given', {
    expected: `"${removeTitle}" on the configured "${described ? shortUri(described.uri) : '<its name>'}" row asks in a modal dialog "${described ? removalConsent(described.type ?? '', described.uri) : '<its consent>'}" whose detail names "${pluginRemovalConfigTarget(described?.type ?? '')}" and closes "${TEXT_ALONE}", with a "${REMOVE_BUTTON}" button; "${EDITOR_CANCEL}" closes it, and over ${QUIET_MS} ms nothing is told or written to the channel and the folder's configuration is left byte for byte as it was; taken a second time with "${REMOVE_BUTTON}" pressed, the same readings see the removal end in a notification opening "${REMOVAL_SUBJECT} ", the configuration then binding no provider while its linter entry stands, and the configured group listing one entry`,
    plant: 'in the scratch copy, out/src/plugins-run.js with the removal of a socket plugin said to write the global configuration',
  }, () => restoring(async () => {
    if (described === undefined) { return { passed: false, seen: unlisted('the configured entry it describes') }; }
    need(describedRow !== null, `${checkNamed('plugins-panel.removal-offered-only-on-a-configured-entry-the-compiler-describes')} did not read the configured "${shortUri(described.uri)}" row, so its removal is not shown offered there`);
    const before = fs.readFileSync(config);
    const unchanged = { holds: (): boolean => fs.readFileSync(config).equals(before), what: 'the configuration unchanged' };
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.plugins.focus');
    await foldEmbedded(ctx);
    const row = shortUri(described.uri);
    const consentWords = removalConsent(described.type ?? '', described.uri);
    const unoffered = await takeFromRowMenu(ctx, 'Plugins', row, removeTitle);
    if (unoffered !== null) { return { passed: false, seen: unoffered }; }
    const consent = await waitDialog(ctx, 'the removal asking for consent', consentWords);
    const declined = await markSaid(ctx);
    await declineDialog(ctx, 'the removal\'s consent');
    const quiet = await quietSince(ctx, declined, unchanged);
    // A decline that acted fails here: the control would act on what it changed.
    if (!quiet.held) { return { passed: false, seen: `the consent ${describeDialog(consent)}; after "${EDITOR_CANCEL}": ${quiet.seen}` }; }
    // The control: the same consent given.
    const unofferedAgain = await takeFromRowMenu(ctx, 'Plugins', row, removeTitle);
    if (unofferedAgain !== null) { return { passed: false, seen: `the second time, ${unofferedAgain}` }; }
    await waitDialog(ctx, 'the removal asking again', consentWords);
    const given = await markSaid(ctx);
    const statusAt = await statusMark(ctx);
    await pressDialogButton(ctx.d, REMOVE_BUTTON);
    const ending = await waitToast(ctx.d, 'the removal ending', given.toasts, (t) => t.message.startsWith(`${REMOVAL_SUBJECT} `), 60000);
    const control = await saidSince(ctx, given);
    const [after] = loadAll(fs.readFileSync(config, 'utf8')) as Array<{ plugins?: { providers?: unknown[]; linter?: { uri?: string }[] } } | null>;
    const providers = after?.plugins?.providers ?? [];
    const linter = after?.plugins?.linter ?? [];
    const back = await runningAgain(ctx, statusAt, 60000).then(() => 'read running again', () => `did not read running again within ${guard(60000)} ms`);
    const listed = await until('the configured group listing one entry', 30000, async () => headingOf((await treeRows(ctx.d, 'Plugins')) ?? [], CONFIGURED_GROUP_LABEL)?.label ?? '', (l) => l === `${CONFIGURED_GROUP_LABEL} (1)`).then(() => true, () => false);
    const detail = consent.detail;
    return {
      passed: detail.includes(pluginRemovalConfigTarget(described.type ?? '')) && detail.endsWith(TEXT_ALONE) && consent.buttons.includes(REMOVE_BUTTON)
        && !nothingSaid(control) && providers.length === 0 && linter.length === 1 && listed,
      seen: `the consent ${describeDialog(consent)}; after "${EDITOR_CANCEL}": ${quiet.seen}; consent given, "${ending.message}" (${ending.severity}); the configuration then binds ${providers.length} provider(s) and ${linter.length} linter(s); the configured group ${listed ? 'lists one entry' : `does not come to list one entry within ${guard(30000)} ms`}; the language server ${back}`,
    };
  }, () => leftOpen(ctx)));

  // ---- the command palette ----
  const listViews = containerViews(ctx).filter((v) => v.name !== PANEL_ORDER[0]);
  const panelCommands = [
    ...Object.values(PANEL_ACTIONS).flatMap((actions) => actions.map(commandIdFor)),
    ...listViews.map((v) => `${v.id}.refresh`),
  ];
  const rowCommands = listViews.flatMap((v) => rowOperationCommands(ctx, v.id));
  await c.run('palette.offers-the-panel-operations-and-none-of-the-row-operations', {
    expected: `the command palette, given each one's title, offers every operation heading a list panel and each list panel's refresh (${panelCommands.map((x) => `"${paletteTitle(ctx, x)}"`).join(', ')}) within ${PALETTE_ANSWER_MS} ms, and offers none of the operations the manifest binds to a list panel's rows (${rowCommands.map((x) => `"${paletteTitle(ctx, x)}"`).join(', ')}), each watched for the same ${PALETTE_ANSWER_MS} ms after the palette holds its title`,
    plant: 'in the scratch copy\'s package.json, the plugin removal offered in the command palette',
  }, () => restoring(async () => {
    await closeAllEditors(ctx);
    const query = (title: string): string => title.replace(/^Aggrega: /, '').replace(/…$/, '');
    const labelsNow = async (): Promise<string[]> => ((await quickInput(ctx.d))?.rows ?? []).map((r) => r.label);
    const close = async (): Promise<void> => {
      await ctx.d.press('Escape');
      await until('the palette closing', 5000, () => quickInput(ctx.d), (q) => q === null);
    };
    const missing: string[] = [];
    const present: string[] = [];
    for (const command of panelCommands) {
      const title = paletteTitle(ctx, command);
      const q = await paletteRows(ctx.d, (x) => send(ctx, x), query(title));
      const unlistedFor = await until(`the palette offering "${title}"`, stated(PALETTE_ANSWER_MS), labelsNow, (v) => v.includes(title))
        .then(() => null, (err: unknown) => (err instanceof Error ? err.message : String(err)));
      if (unlistedFor === null) { present.push(`${title} (for "${q.value}")`); } else { missing.push(`${title} (for "${q.value}": ${unlistedFor})`); }
      await close();
    }
    const offeredRows: string[] = [];
    const absent: string[] = [];
    for (const command of rowCommands) {
      const title = paletteTitle(ctx, command);
      const q = await paletteRows(ctx.d, (x) => send(ctx, x), query(title));
      need(q.value === `>${query(title)}`, `the palette did not hold the typed title "${query(title)}", so what it offers says nothing about the command`);
      const watch = await holds(PALETTE_ANSWER_MS, labelsNow, (v) => !v.includes(title));
      (watch.held ? absent : offeredRows).push(watch.held ? title : `${title} at ${watch.atMs} ms`);
      await close();
    }
    return {
      passed: missing.length === 0 && offeredRows.length === 0,
      seen: `offered, as they should be: ${JSON.stringify(present)}${missing.length > 0 ? `; not offered: ${JSON.stringify(missing)}` : ''}; row operations not offered: ${JSON.stringify(absent)}${offeredRows.length > 0 ? `; row operations offered: ${JSON.stringify(offeredRows)}` : ''}`,
    };
  }, () => leftOpen(ctx)));

  // ---- the row a failed listing draws ----
  // The status bar's readings are marked before the setting changes, so the
  // reading waited for is one taken after it, never the one standing before.
  const beforeStop = await statusMark(ctx);
  await setBinaryPath(ctx, bin, opts.missing);
  // The row a listing draws when its command could not be started, held as
  // written: what is wrong with the path the setting names.
  const PLUGIN_LIST_FAILED_ROW = `The plugin list could not run: the compiler at ${opts.missing} was not found.`;
  await c.run('plugins-panel.no-removal-on-the-row-a-failed-listing-draws', {
    expected: `with the binary setting pointed at ${opts.missing}, which does not exist, and the status bar reading "${NOT_RUNNING}" after it changed, the Plugins panel's Refresh draws "${PLUGIN_LIST_FAILED_ROW}" — its listing being the compiler run as a command — where it was not drawn before the press, and a right-click on it reaches the row and offers none of ${pluginOps.map((t) => `"${t}"`).join(', ')}, the reading of the configured entry the compiler describes, earlier in this scenario, having offered "${removeTitle}"`,
    plant: 'in the scratch copy, out/src/plugins-view.js with the row a failed listing draws carrying the value a configured entry carries',
  }, () => restoring(async () => {
    const control = describedRow as RowMenu | null;
    need(control !== null, `${checkNamed('plugins-panel.removal-offered-only-on-a-configured-entry-the-compiler-describes')} did not read the configured entry's row, so there is no reading to hold an absence of its removal against`);
    if (offered(control, [removeTitle]).length !== 1) { return { passed: false, seen: `its positive control did not fire: the configured entry's row read ${describeRowMenu(control)}, so an absence of "${removeTitle}" here would prove nothing` }; }
    await statusReadsSince(ctx, beforeStop, NOT_RUNNING, 60000);
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.plugins.focus');
    // The panel is read before its Refresh is pressed, so the row then waited for is
    // shown drawn by the press rather than standing from before it.
    const before = await panelLabels(ctx, 'Plugins');
    await run(ctx, 'aggrega.plugins.refresh');
    await until(`the Plugins panel reading "${PLUGIN_LIST_FAILED_ROW}"`, 30000, () => panelLabels(ctx, 'Plugins'), (v) => v.includes(PLUGIN_LIST_FAILED_ROW));
    const standing = before.includes(PLUGIN_LIST_FAILED_ROW);
    const r = await rowsOffering(ctx, 'Plugins', [PLUGIN_LIST_FAILED_ROW], pluginOps);
    if (r.offering.length === 0 && !standing) { need(r.unreached.length === 0, `the right-click never reached ${r.unreached.join('; ')}`); }
    return { passed: r.offering.length === 0 && !standing, seen: `${standing ? `"${PLUGIN_LIST_FAILED_ROW}" drawn before the Refresh was pressed, so the press is not shown to draw it` : 'not drawn before the Refresh was pressed'}; ${describeReads(r.reads)}` };
  }, () => leftOpen(ctx)));
}
