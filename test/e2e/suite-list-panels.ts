// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { configurationChangedWarning } from '../../src/config-change-watch';
import { CONFIG_WRITE_DESTINATIONS } from '../../src/config-write-scope';
import { RESTART_COMMAND } from '../../src/daemon-status';
import { ListPanelId, PANEL_ACTIONS, PanelActionId, panelActionLabel } from '../../src/operation-groups';
import { ATTACHMENT_SUBJECT, attachmentProgressTitle } from '../../src/plugin-attachment';
import { GEN_CATALOG_SCOPES } from '../../src/plugins-run';
import { PUBLICATION_SUBJECT, publicationOpeningLine } from '../../src/publication-request';
import { EMPTY_LABEL as NO_REGISTRIES_ROW } from '../../src/registries-run';
import {
  CREDENTIAL_REMOVAL_SUBJECT, REGISTRATION_DESTINATION_PROMPT, REGISTRATION_SUBJECT, REGISTRY_REMOVAL_SUBJECT, REMOVAL_DESTINATION_PROMPT, removalConsentDetail, trustByHandTitle,
} from '../../src/registry-configure';
import { INDEX_BUILD_SUBJECT, indexBuildOpeningLine } from '../../src/registry-index-request';
import { SERVER_STOPPED_LABEL } from '../../src/workspace-catalog-run';
import { NO_ANCHORED_WORKSPACE_TREE_LABEL } from '../../src/workspace';
import { need } from './checks';
import { runCompiler, ScratchHome } from './cli';
import { LIST_PANEL_TITLES, restoring } from './commands-panel';
import { FixtureError, FixtureProof, readTree, sameTree } from './fixtures';
import {
  answerFolderDialog, Chooser, chooser, closeChooser, dialogsSeen, drawnDialog, DrawnDialog, EDITOR_CANCEL, enterIntoDialog, openFolderHere, pickersSeen, pressChooserButton, takeChooserRow, ToastLedger, waitChooser,
} from './levels';
import { referenceAnswer } from './reference';
import { nameTheDefault, ScratchRegistry } from './registry';
import { CompilerRuns, HEAD_ROW_QUESTIONS } from './suite-commands-panel';
import { catalogPanelAtItsHead, closeAllEditors, commandTitle, ready, run, send, SuiteContext, theServer } from './suite-context';
import { PUBLISHED, PUBLISHED_REPOSITORY, PUBLISHED_TAG, registryDigest } from './suite-endings';
import { contextRowsCheck } from './suite-gateway';
import { Ending, endsAsWanted, inspectionLead, OPEN_ACTION, readEnding } from './suite-inspection';
import { inPlaceOpening, setBinaryPath } from './suite-killed';
import { ADD_REGISTRY_TITLE, entryFor, GLOBAL_DESTINATION, globalConfiguration } from './suite-registry';
import { HOST_PROMPT } from './suite-welcome-empty-folder';
import { runningAgain, statusMark } from './welcome';
import {
  describeRowMenu, guard, holds, NOT_RUNNING, notificationReadings, OutputLog, pressDialogButton, pressMenuItem, pressPanelAction, pressTreeRowAction, Reading, RowMenu, rowMenu, RUNNING,
  stated, statusLog, stopWatchingNotification, toasts, toastsSince, treeRows, until, waitToast, watchNotification,
} from './workbench';

// The checks run in the gateway folder on the operations the Registries, Catalog
// and Plugins panels offer, each list panel's own operations heading its list and
// a row's operations on the row they act on: a registry added from the head of
// the Registries panel and the questions it asks before anything runs; what a
// registry's row offers, its index brought up to date from the row, and the
// removals it offers, each asking its consent in words naming what it reaches;
// the confirmation a publication from a Catalog row asks, and the inspection the
// row offers beside it; the questions adding a plugin asks, type by type, and
// the governance roles it offers against the ones the compiler declares; the
// dialogs generating Plugin entities opens and what it writes once confirmed;
// and no row operation on a row that names nothing to act on, in each state a
// list can be in — no registry configured, the language server stopped, and no
// workspace at all. A second scenario, in a documentation example, inspects an
// Aggregate its catalog cannot resolve, from the row that names it.

export const LIST_PANEL_OPERATIONS_CHECKS = [
  'commands-panel.context-rows-name-the-opened-folder',
  'registries-panel.add-registry-asks-the-host-then-the-file-and-registers-once-both-are-answered',
  'registries-panel.registry-row-offers-only-its-own-operations-and-updates-its-index-from-the-row',
  'registries-panel.credential-removal-asks-no-file-and-consents-naming-the-shared-store',
  'catalog-view.publication-confirms-naming-the-entity-and-a-decline-publishes-nothing',
  'catalog-view.declared-entity-row-inspects-from-the-row',
  'catalog-view.no-entity-operation-on-the-head-or-a-kind-heading',
  'plugins-panel.add-plugin-asks-type-then-its-one-answer-then-the-name-and-backing-out-attaches-nothing',
  'plugins-panel.governance-roles-are-the-ones-the-compiler-declares',
  'plugins-panel.generation-asks-scope-overlay-and-directory-and-writes-only-once-confirmed',
  'plugins-panel.generation-reads-the-plugins-again',
  'registries-panel.removal-asks-which-file-before-consent-and-names-what-each-reaches',
  'registries-panel.no-row-operation-on-the-head-or-the-empty-answer',
  'list-panels.no-row-operation-on-the-rows-a-stopped-server-draws',
  'list-panels.no-row-operation-on-the-rows-saying-no-workspace',
] as const;

export const INSPECTION_BY_NAME_CHECKS = [
  'inspect.declared-entity-the-catalog-cannot-resolve-says-why-and-what-to-change',
  'inspect.no-note-where-the-workspace-lists-no-catalog-directory',
] as const;

// checkNamed is one of these checks by its name, where a reason names the check
// whose reading it rests on: a name no list above holds does not compile, so a
// reason cannot go on naming a check that was renamed.
const checkNamed = (name: (typeof LIST_PANEL_OPERATIONS_CHECKS)[number] | (typeof INSPECTION_BY_NAME_CHECKS)[number]): string => name;

// QUIET_MS is how long the editor is watched, after a question is backed out of
// or a confirmation declined, for anything it runs. Whatever such a run starts
// shows within it — a registration's restart notification and its ending, an
// attachment's progress, a publication's opening line — and each check reads the
// run it guards against, answered for real, through the same readings in the
// same scenario.
export const QUIET_MS = 3000;

// The words a reader is to meet that the product does not declare apart from the
// sentence they sit in, held as written so a change of wording is a change these
// checks report: the consent the credential removal and the publication ask, the
// progress an index build for one registry runs behind, the button a removal's
// consent is given with, and the subject a generation's ending opens with.
const credentialConsent = (host: string): string => `Remove the stored credential for ${host}?`;
const CREDENTIAL_DETAIL = 'The credential is deleted from the shared credential store, which every command reading it uses. The registry entry itself is left in place.';
const registryConsent = (host: string): string => `Remove the registry ${host} and its trust policy?`;
const publicationConsent = (file: string): string => `Publish ${file} to a registry?`;
const PUBLICATION_DETAIL = 'The entity is bundled and pushed under its own declared version, and anyone pulling that version from that registry resolves what is published here. The checks beside this entry change nothing outside this machine; this one does.';
const oneIndexProgress = (host: string): string => `Aggrega: updating the searchable index for ${host}`;
export const REMOVE_BUTTON = 'Remove';
// A generation that completes ends on the output channel alone, in a line naming
// the directory it wrote under.
const GENERATION_SUBJECT = 'The generation';
const generationEnding = (dir: string): string => `${GENERATION_SUBJECT} wrote the entities under ${dir}.`;

// The questions adding a plugin asks, held as written for the same reason, the
// titles of the first and the last being the ones the Commands panel's checks
// hold for the head row: the list of types, the further question a type may need
// before its name, each by the title it is drawn with and what it asks, and the
// name every type then asks for. The types are the ones a reader is to be
// offered, in order, written here as the specification rather than read from the
// product's own list, so a type the product comes to offer is a change this check
// reports; and `cli` is not among them: installing one confirms its declared
// capabilities at a terminal, and a panel has none.
const PLUGIN_TYPE_QUESTION = { title: HEAD_ROW_QUESTIONS.pluginAdd ?? '', placeholder: 'Which type of plugin to add' };
const OFFERED_PLUGIN_TYPES = ['provider', 'governance', 'linter', 'importer'];
const CAPABILITY_QUESTION = { title: 'Aggrega: add a provider plugin', message: 'The capability this binding serves, such as helm or terraform.' };
const ROLE_QUESTION = { title: 'Aggrega: add a governance plugin', placeholder: 'The role this attachment is bound at' };
const NAME_QUESTION = { title: HEAD_ROW_QUESTIONS.pluginAdd ?? '', closing: 'The attachment is written to this project\'s workspace configuration.' };
const UNPUBLISHED_PLUGIN = 'no-plugin-is-published-under-this-name';

// The questions generating Plugin entities asks: the scope, each file dialog by
// its title and the one button it is accepted with, and the confirmation.
const SCOPE_QUESTION = { title: HEAD_ROW_QUESTIONS.pluginEntities ?? '', placeholder: 'Which plugins to generate an entity for' };
const ARTIFACT_DIALOG = { title: 'Aggrega: the plugin artifact to generate from', accept: 'Generate from this' };
const OVERLAY_FILE_DIALOG = { title: 'Aggrega: the authored overlay for this plugin', accept: 'Merge this overlay' };
const OVERLAY_DIRECTORY_DIALOG = { title: 'Aggrega: the directory holding the authored overlays', accept: 'Merge this overlay' };
const OUTPUT_DIALOG = { title: 'Aggrega: the directory to write the entities under', accept: 'Write here' };
const generationConsent = (dir: string): string => `Write Plugin entities under ${dir}?`;
const GENERATION_DETAIL = 'Each entity is written at a path derived from its plugin’s type, name and version, so an entity already there for that same plugin and version is replaced. Nothing else under the directory is touched.';

// The kind token the configuration panel asks the compiler's configuration schema
// under. It is held as written: the module declaring it opens the editor's own
// interface as it loads, which a check running outside the editor cannot.
export const CONFIG_SCHEMA_KIND = 'aggrega-config';

// The entity a row publishes and inspects is the one the gateway folder's own
// publication publishes (suite-endings.ts), the folder's Recipe, which its own
// catalog directory resolves; the folder's Aggregate is a row offering an
// inspection by its kind.
const INSPECTED_ROW = PUBLISHED;
const DECLARED_ROW = 'gateway';

// ---- what a reader is told, and asked ------------------------------------------------

// SaidMark is where everything a reader can be told or asked stands at one moment:
// the output channel, the notifications drawn, the quick inputs drawn and the
// modal dialogs drawn, the last two as the workbench's own observers record them.
// The Commands panel's asking check reads the first two through closures of its
// own; these read all four, because what a back-out here must not do includes
// asking a further question or raising a consent.
export interface SaidMark { out: ReturnType<OutputLog['mark']>; toasts: number; pickers: number; dialogs: number }

export async function markSaid(ctx: SuiteContext): Promise<SaidMark> {
  return { out: ctx.out.mark(), toasts: (await toasts(ctx.d)).length, pickers: (await pickersSeen(ctx.d)).length, dialogs: (await dialogsSeen(ctx.d)).length };
}

// Said is what was told or asked since a mark.
export interface Said { channel: string; told: string[]; asked: string[]; dialogs: string[] }

export async function saidSince(ctx: SuiteContext, m: SaidMark): Promise<Said> {
  return {
    channel: ctx.out.since(m.out).trim(),
    told: (await toastsSince(ctx.d, m.toasts)).map((t) => t.message),
    asked: (await pickersSeen(ctx.d)).slice(m.pickers).map((p) => p.title || p.placeholder || p.message),
    dialogs: (await dialogsSeen(ctx.d)).slice(m.dialogs).map((d) => d.message),
  };
}

export const nothingSaid = (s: Said): boolean => s.channel === '' && s.told.length === 0 && s.asked.length === 0 && s.dialogs.length === 0;

export function describeSaid(s: Said): string {
  return `channel ${JSON.stringify(s.channel.slice(0, 300))}, notifications ${JSON.stringify(s.told.map((t) => t.slice(0, 160)))}, questions ${JSON.stringify(s.asked)}, dialogs ${JSON.stringify(s.dialogs)}`;
}

// Kept is a reading a quiet watch takes beside what is told or asked, which is to
// hold at every look, and what it is in words.
export interface Kept { holds: () => boolean; what: string }

// Quiet is a watch over QUIET_MS that nothing was told or asked since a mark and,
// where `also` names a reading, that it held at every look. Every caller says
// whether it watches anything beside, so the words reported are only what was read.
export interface Quiet { held: boolean; seen: string }

export async function quietSince(ctx: SuiteContext, m: SaidMark, also: Kept | null): Promise<Quiet> {
  const q = await holds(QUIET_MS, async () => ({ said: await saidSince(ctx, m), kept: also === null || also.holds() }), (v) => nothingSaid(v.said) && v.kept);
  const beside = also === null ? '' : `, and ${also.what},`;
  return {
    held: q.held,
    seen: q.held ? `nothing told or asked${beside} over ${q.readings} readings in ${QUIET_MS} ms`
      : `${q.atMs} ms in: ${q.broke ? describeSaid(q.broke.said) : 'no reading'}${q.broke && !q.broke.kept && also !== null ? `, and not ${also.what}` : ''}`,
  };
}

// closedAfterEscape puts away the question drawn as Escape does, through
// `closeChooser` (levels.ts), and fails where a question is still drawn after it:
// a back-out is what these checks judge, so one that leaves a question standing
// stops the check rather than being let go by, as `closeChooser` lets it.
export async function closedAfterEscape(ctx: SuiteContext, what: string): Promise<void> {
  await closeChooser(ctx.d);
  const still = await chooser(ctx.d);
  if (still !== null) { throw new Error(`${what} is still drawn after Escape: ${describeChooser(still)}`); }
}

// leftOpen puts away whatever a check left drawn — a modal dialog, a quick input,
// a context menu — as Escape does, so the check after it starts from the
// workbench at rest. It answers null where nothing was left, and otherwise what
// it found and whether Escape closed it, which fails the check that left it.
export async function leftOpen(ctx: SuiteContext): Promise<string | null> {
  const menu = (): Promise<boolean> => ctx.d.workbench<boolean>('!!document.querySelector(\'.context-view .monaco-menu\')');
  const read = async (): Promise<{ dialog: DrawnDialog | null; question: Chooser | null; menu: boolean }> => ({ dialog: await drawnDialog(ctx.d), question: await chooser(ctx.d), menu: await menu() });
  const found = await read();
  if (found.dialog === null && found.question === null && !found.menu) { return null; }
  await ctx.d.press('Escape');
  const stuck = await until('what was left open closing on Escape', 5000, read, (v) => v.dialog === null && v.question === null && !v.menu)
    .then(() => null, (err: unknown) => (err instanceof Error ? err.message : String(err)));
  const what = [found.dialog ? `the dialog ${JSON.stringify(found.dialog.message)}` : '', found.question ? `the question ${JSON.stringify(found.question.title || found.question.placeholder || found.question.message)}` : '', found.menu ? 'a context menu' : ''].filter((x) => x !== '');
  return `${what.join(', ')} left drawn${stuck === null ? ', and closed by Escape' : `, and Escape did not close it: ${stuck}`}`;
}

// declineDialog presses the editor's own button declining the modal dialog drawn,
// and waits for it to close.
export async function declineDialog(ctx: SuiteContext, what: string): Promise<void> {
  await pressDialogButton(ctx.d, EDITOR_CANCEL);
  await until(`${what} closing on ${EDITOR_CANCEL}`, 5000, () => drawnDialog(ctx.d), (d) => d === null);
}

// waitDialog waits for a modal dialog reading `message`.
export function waitDialog(ctx: SuiteContext, what: string, message: string, boundMs = 10000): Promise<DrawnDialog> {
  return until(what, boundMs, () => drawnDialog(ctx.d), (d) => d !== null && d.message === message) as Promise<DrawnDialog>;
}

export function describeDialog(d: DrawnDialog): string {
  return `${JSON.stringify(d.message)} (detail ${JSON.stringify(d.detail)}, buttons ${JSON.stringify(d.buttons)})`;
}

export function describeChooser(q: Chooser): string {
  return JSON.stringify({ title: q.title, placeholder: q.placeholder, message: q.message, rows: q.rows.map((r) => r.label), buttons: q.buttons });
}

// pressListHead presses a row at the head of a list panel, by the product's own id
// for the panel and for the row.
async function pressListHead(ctx: SuiteContext, panel: ListPanelId, id: PanelActionId): Promise<void> {
  await run(ctx, 'workbench.view.extension.aggrega');
  await pressPanelAction(ctx.d, LIST_PANEL_TITLES[panel], panelActionLabel(id));
}

// panelLabels are the labels of the rows the side-bar view titled `title` lists,
// in sight or not.
export async function panelLabels(ctx: SuiteContext, title: string): Promise<string[]> {
  return ((await treeRows(ctx.d, title)) ?? []).map((r) => r.label);
}

// statusReadsSince waits for the status bar's last reading since `mark` to be
// `reading`, and answers with the readings since the mark: a reading taken after
// the action the mark was taken before, never the one standing from before it.
// `runningAgain` (welcome.ts) asks more — another reading first — which is what a
// restart is read by; this is what a change from a running server to a stopped
// one, or back, is read by, where no reading need come between.
export function statusReadsSince(ctx: SuiteContext, mark: number, reading: string, boundMs: number): Promise<Reading[]> {
  return until(`the status bar reading "${reading}" after the binary setting changed`, boundMs, async () => (await statusLog(ctx.d)).slice(mark),
    (v) => v.length > 0 && v[v.length - 1].reading === reading);
}

// rowOperationCommands are the operations the manifest binds to the rows of one
// list panel's view, in the order the manifest lists them: what a right-click on a
// row of that panel can offer. rowOperationTitles are the same by their titles.
export function rowOperationCommands(ctx: SuiteContext, view: string): string[] {
  const menus = (ctx.manifest as unknown as { contributes: { menus: Record<string, { command: string; when?: string }[]> } }).contributes.menus['view/item/context'] ?? [];
  return [...new Set(menus.filter((e) => e.command.startsWith(`${view}.`)).map((e) => e.command))];
}

export function rowOperationTitles(ctx: SuiteContext, view: string): string[] {
  return rowOperationCommands(ctx, view).map((command) => commandTitle(ctx.manifest, command));
}

// offered is what a row's right-click offered of `titles`.
export const offered = (m: RowMenu, titles: readonly string[]): string[] => m.items.filter((i) => titles.includes(i));

// RowRead is one row's right-click as a check reports it.
export interface RowRead { row: string; menu: RowMenu }

// rowsOffering reads the right-click of each row named, and reports the ones whose
// menu offered any of `titles`, and the ones the right-click never reached.
export async function rowsOffering(ctx: SuiteContext, title: string, rows: readonly string[], titles: readonly string[]): Promise<{ reads: RowRead[]; offering: string[]; unreached: string[] }> {
  const reads: RowRead[] = [];
  for (const row of rows) {
    const menu = await rowMenu(ctx.d, title, row);
    if (menu.items.length > 0) { await ctx.d.press('Escape'); }
    reads.push({ row, menu });
  }
  return {
    reads,
    offering: reads.filter((r) => offered(r.menu, titles).length > 0).map((r) => `${r.row}: ${describeRowMenu(r.menu)}`),
    unreached: reads.filter((r) => !r.menu.reached).map((r) => `${r.row}: ${describeRowMenu(r.menu)}`),
  };
}

export function describeReads(reads: readonly RowRead[]): string {
  return reads.map((r) => `"${r.row}" ${describeRowMenu(r.menu) || 'reached, no menu'}`).join('; ');
}

// takeFromRowMenu right-clicks the row named and takes `item` from its menu, as a
// reader does. It answers null once the item is taken, and otherwise what the
// right-click read, so a check whose action it is fails on what the row offers.
export async function takeFromRowMenu(ctx: SuiteContext, title: string, row: string, item: string): Promise<string | null> {
  const menu = await rowMenu(ctx.d, title, row);
  if ((await pressMenuItem(ctx.d, item)) !== null) { return null; }
  if (menu.items.length > 0) { await ctx.d.press('Escape'); }
  return `the "${row}" row's right-click read ${describeRowMenu(menu) || 'no menu'}, with no "${item}" to take`;
}

// ---- fixtures ---------------------------------------------------------------------

// nameDefaultOnly writes a global configuration naming the scratch registry as the
// default registry and configuring none, so an operation that names no registry
// reaches it rather than the hub while the Registries panel lists nothing; and
// reads back with the compiler's own listing that no registry is configured.
export async function nameDefaultOnly(binary: string, registry: ScratchRegistry, folder: string, home: ScratchHome, log: string): Promise<FixtureProof> {
  const fixture = 'scratch registry named the default, with no registry configured';
  const file = globalConfiguration(home);
  if (fs.existsSync(file)) { throw new FixtureError(fixture, `${file} is already there`); }
  const refused = nameTheDefault(file, registry.host);
  if (refused !== null) { throw new FixtureError(fixture, refused); }
  const list = await runCompiler(binary, ['registry', 'list', '-o', 'json'], { cwd: folder, home, boundMs: 60000, log });
  let listed: unknown[] | null = null;
  try { listed = (JSON.parse(list.stdout) as { registries?: unknown[] }).registries ?? []; } catch { listed = null; }
  if (list.status !== 0 || listed === null || listed.length > 0) {
    throw new FixtureError(fixture, `\`aggrega registry list -o json\` exited ${list.status ?? list.signal} listing ${JSON.stringify(listed)}: ${(list.stderr || list.stdout).trim().slice(0, 200)}`);
  }
  return { fixture, built: true, proof: `${file} holds "default_registry: ${registry.host}" and nothing else; \`aggrega registry list -o json\` exited 0 listing no registry` };
}

// Generation is what generating Plugin entities is pointed at: a directory holding
// a plugin artifact, an overlay file, a file of neither kind, the authored overlays
// and an empty directory to write under; and a directory beside it for the
// compiler's own generation from the same overlays.
export interface Generation { dir: string; artifact: string; overlayFile: string; other: string; overlays: string; output: string; reference: string; proof: FixtureProof }

// GENERATION_OVERLAYS is the directory of authored overlays beside the
// standard-library catalog, one per plugin built into the compiler, from which
// the catalog's own Plugin entities are generated.
const GENERATION_OVERLAYS = 'plugin-overlays';

export function placeGeneration(dir: string, reference: string, catalog: string): Generation {
  const fixture = 'Plugin entity generation';
  const source = path.join(path.dirname(catalog), GENERATION_OVERLAYS);
  if (!fs.existsSync(source)) { throw new FixtureError(fixture, `no authored overlays at ${source}, beside the catalog`); }
  const overlays = path.join(dir, 'overlays');
  fs.cpSync(source, overlays, { recursive: true });
  const artifact = path.join(dir, 'plugin.wasm');
  const overlayFile = path.join(dir, 'overlay.yaml');
  const other = path.join(dir, 'notes.txt');
  // The artifact and the overlay file are what the dialogs list and are given; the
  // generation is declined before anything reads them, so neither is a real one.
  fs.writeFileSync(artifact, 'a stand-in for a plugin artifact\n');
  fs.writeFileSync(overlayFile, 'kind: Plugin\n');
  fs.writeFileSync(other, 'a file that is neither an artifact nor an overlay\n');
  const output = path.join(dir, 'output');
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(reference, { recursive: true });
  const copied = readTree(overlays).size;
  if (copied === 0 || fs.readdirSync(output).length > 0) { throw new FixtureError(fixture, `${copied} overlay files copied, and ${output} holds ${fs.readdirSync(output).length} entries`); }
  return {
    dir, artifact, overlayFile, other, overlays, output, reference,
    proof: { fixture, built: true, proof: `${copied} overlay files copied from ${source} to ${overlays}; ${artifact}, ${overlayFile} and ${other} written beside them; ${output} and ${reference} empty` },
  };
}

// ---- the file dialogs, drawn as quick inputs --------------------------------------

// dialogIn waits for the file dialog titled `title`, enters `dir` into it as
// `answerFolderDialog` (levels.ts) enters a folder, and answers with the dialog
// once it lists that directory: the entries drawn once its box reads the
// directory and its list holds the directory's own `marker` entry, which no other
// directory here holds. It accepts nothing, which is why it is not that helper.
async function dialogIn(ctx: SuiteContext, title: string, dir: string, marker: string): Promise<Chooser> {
  await waitChooser(ctx.d, `the dialog titled "${title}"`, (q) => q.title === title, 15000);
  const entered = await enterIntoDialog(ctx.d, `${dir}/`, `the dialog titled "${title}"`);
  if (entered === null || entered.value !== `${dir}/`) { throw new Error(`the dialog titled "${title}" reads ${JSON.stringify(entered?.value ?? null)}, not ${JSON.stringify(`${dir}/`)}, so what it lists is not that directory`); }
  return waitChooser(ctx.d, `the dialog titled "${title}" listing ${dir}`, (q) => q.title === title && q.value === `${dir}/` && q.rows.some((r) => r.label === marker), 10000);
}

// answerFileDialog enters a file into the file dialog drawn as `answerFolderDialog`
// enters a folder, and accepts it with the dialog's own button once the box reads
// exactly that file; that helper answers a folder, whose path it ends with a
// slash.
async function answerFileDialog(ctx: SuiteContext, file: string, accept: string): Promise<void> {
  const entered = await enterIntoDialog(ctx.d, file, 'the file dialog');
  if (entered === null || entered.value !== file) { throw new Error(`the file dialog reads ${JSON.stringify(entered?.value ?? null)}, not ${JSON.stringify(file)}, so its button would take a file nobody named`); }
  await pressChooserButton(ctx.d, accept);
}

const labelsOf = (q: Chooser): string[] => q.rows.map((r) => r.label);

// ---- the gateway folder ---------------------------------------------------------------

export async function listPanelOperationsChecks(ctx: SuiteContext, opts: { registry: ScratchRegistry; reference: string; missing: string; unanchored: string; generation: Generation }): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  const host = opts.registry.host;
  const global = globalConfiguration(ctx.home);
  const putAway = (): Promise<string | null> => leftOpen(ctx);
  await ready(ctx);
  await contextRowsCheck(ctx);

  const registryOps = rowOperationTitles(ctx, 'aggrega.registries');
  const catalogOps = rowOperationTitles(ctx, 'aggrega.workspaceCatalog');
  const [updateOne, logout, remove] = ['aggrega.registries.updateOne', 'aggrega.registries.logout', 'aggrega.registries.remove'].map((x) => commandTitle(ctx.manifest, x));
  const [inspect, publish] = ['aggrega.workspaceCatalog.inspect', 'aggrega.workspaceCatalog.push'].map((x) => commandTitle(ctx.manifest, x));
  const destinations = CONFIG_WRITE_DESTINATIONS.map((d) => d.label);
  const projectDestination = CONFIG_WRITE_DESTINATIONS.find((d) => d.value === 'workspace')?.label ?? '';

  // ---- a registry added from the head of the Registries panel ----
  const addRow = panelActionLabel('registryAdd');
  let added = false;
  await c.run('registries-panel.add-registry-asks-the-host-then-the-file-and-registers-once-both-are-answered', {
    expected: `pressing "${addRow}" at the head of the Registries panel asks for the host in an input titled "${ADD_REGISTRY_TITLE}" whose message opens "${HOST_PROMPT}"; Escape there asks nothing more, and over ${QUIET_MS} ms nothing is told or written to the channel and ${global} is left byte for byte as it was; pressed again and given ${host}, it asks "${REGISTRATION_DESTINATION_PROMPT}" offering ${destinations.map((d) => `"${d}"`).join(' then ')}, and Escape there leaves the same quiet; pressed a third time, given ${host} and "${GLOBAL_DESTINATION}" taken, it ends in a notification opening "${REGISTRATION_SUBJECT} registered ${host} in ${global}, ", that file then holding an entry for ${host}, and the Registries panel lists ${host} with nothing pressed there — the readings that stayed quiet after the two back-outs seeing this ending`,
    plant: 'in the scratch copy, out/src/registries-view.js with the add asking no file and writing to the global one',
  }, () => restoring(async () => {
    const before = fs.readFileSync(global);
    const unchanged: Kept = { holds: () => fs.readFileSync(global).equals(before), what: 'the global file unchanged' };
    await closeAllEditors(ctx);
    // At the host.
    await pressListHead(ctx, 'registries', 'registryAdd');
    const hostQuestion = await waitChooser(ctx.d, 'the host being asked for', (q) => q.title === ADD_REGISTRY_TITLE, 10000);
    const atHost = await markSaid(ctx);
    await closedAfterEscape(ctx, 'the host question');
    const quietAtHost = await quietSince(ctx, atHost, unchanged);
    // A back-out that acted fails here: what follows would act on what it changed.
    if (!quietAtHost.held) { return { passed: false, seen: `the host question ${describeChooser(hostQuestion)}; after Escape there: ${quietAtHost.seen}` }; }
    // At the file.
    const askFile = async (): Promise<Chooser> => {
      await pressListHead(ctx, 'registries', 'registryAdd');
      await waitChooser(ctx.d, 'the host being asked for', (q) => q.title === ADD_REGISTRY_TITLE, 10000);
      await ctx.d.type(host);
      await waitChooser(ctx.d, 'the host input reading the host', (q) => q.title === ADD_REGISTRY_TITLE && q.value === host, 5000);
      await ctx.d.press('Enter');
      return waitChooser(ctx.d, 'the file being asked for', (q) => q.placeholder === REGISTRATION_DESTINATION_PROMPT && q.rows.length > 0, 10000);
    };
    const fileQuestion = await askFile();
    const atFile = await markSaid(ctx);
    await closedAfterEscape(ctx, 'the file question');
    const quietAtFile = await quietSince(ctx, atFile, unchanged);
    if (!quietAtFile.held) { return { passed: false, seen: `the host question ${describeChooser(hostQuestion)}; after Escape there: ${quietAtHost.seen}; the file question ${describeChooser(fileQuestion)}; after Escape there: ${quietAtFile.seen}` }; }
    // Both answered.
    const statusAt = await statusMark(ctx);
    await askFile();
    const answered = await markSaid(ctx);
    await takeChooserRow(ctx.d, GLOBAL_DESTINATION);
    const ending = await waitToast(ctx.d, 'the registration ending', answered.toasts, (t) => t.message.startsWith(`${REGISTRATION_SUBJECT} `), 60000);
    const control = await saidSince(ctx, answered);
    // The registry advertises no trust policy, so the question asking for one to pin
    // by hand follows the ending; it is put away, pinning nothing.
    const trust = await waitChooser(ctx.d, 'the question for a trust policy to pin by hand', (q) => q.title === trustByHandTitle(host), 15000).then(() => 'drawn', (err: unknown) => `not drawn: ${err instanceof Error ? err.message : String(err)}`);
    if (trust === 'drawn') { await closedAfterEscape(ctx, 'the question for a trust policy'); }
    const listed = await until(`the Registries panel listing ${host}`, 20000, () => panelLabels(ctx, 'Registries'), (v) => v.includes(host)).then(() => true, () => false);
    const back = await runningAgain(ctx, statusAt, 60000).then(() => 'read running again', () => `did not read running again within ${guard(60000)} ms`);
    const text = fs.readFileSync(global, 'utf8');
    added = entryFor(text, host) !== null;
    return {
      passed: hostQuestion.message.startsWith(HOST_PROMPT) && fileQuestion.placeholder === REGISTRATION_DESTINATION_PROMPT
        && JSON.stringify(labelsOf(fileQuestion)) === JSON.stringify(destinations)
        && ending.message.startsWith(`${REGISTRATION_SUBJECT} registered ${host} in ${global}, `) && added && listed && !nothingSaid(control),
      seen: `the host question ${describeChooser(hostQuestion)}; after Escape there: ${quietAtHost.seen}; the file question ${describeChooser(fileQuestion)}; after Escape there: ${quietAtFile.seen}; both answered: "${ending.message}" (${ending.severity}), ${describeSaid(control)}; the trust question ${trust === 'drawn' ? 'drawn and put away' : trust}; ${global} ${added ? `holds an entry for ${host}` : `holds ${JSON.stringify(text.slice(0, 200))}`}; the Registries panel ${listed ? `lists ${host}` : `does not list ${host} within ${guard(20000)} ms`}; the language server ${back}`,
    };
  }, putAway));

  // ---- a registry's row ----
  // What a registry's row offers is held here as the specification, each by its
  // command's title, so an operation bound to the row beside them — a sign-in
  // among them — is a change this check reports rather than follows.
  const registryRowOffers = [updateOne, logout, remove];
  let registryRow: RowMenu | null = null;
  const registered = `${host} was not registered by ${checkNamed('registries-panel.add-registry-asks-the-host-then-the-file-and-registers-once-both-are-answered')}, so there is no row naming it`;
  await c.run('registries-panel.registry-row-offers-only-its-own-operations-and-updates-its-index-from-the-row', {
    expected: `a right-click on the row naming ${host} offers exactly ${registryRowOffers.map((t) => `"${t}"`).join(', ')}, in that order, and nothing else — no sign-in among them; and "${updateOne}", drawn at the row's end once the pointer rests on it and pressed there, opens the channel with "${indexBuildOpeningLine(host).trim()}", shows "${oneIndexProgress(host)}" while it runs — seen drawn by an observer installed before the press — and ends in a notification opening "${INDEX_BUILD_SUBJECT} "`,
    plant: 'in the scratch copy\'s package.json, the index update for one registry bound to no row\'s inline slot',
  }, () => restoring(async () => {
    need(added, registered);
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.registries.focus');
    const menu = await rowMenu(ctx.d, 'Registries', host);
    if (menu.items.length > 0) { await ctx.d.press('Escape'); }
    need(menu.reached, `the right-click never reached the ${host} row: ${describeRowMenu(menu)}`);
    registryRow = menu;
    const key = await watchNotification(ctx.d, oneIndexProgress(host));
    const outMark = ctx.out.mark();
    const toastMark = (await toasts(ctx.d)).length;
    await pressTreeRowAction(ctx.d, 'Registries', host, updateOne);
    const opening = indexBuildOpeningLine(host).trim();
    const opened = await ctx.out.waitFor('the one registry\'s build opening on the channel', outMark, (t) => t.split('\n').includes(opening), 10000).then(() => true, () => false);
    const ending = await waitToast(ctx.d, 'the index build ending', toastMark, (t) => t.message.startsWith(`${INDEX_BUILD_SUBJECT} `), 60000);
    const readings = await notificationReadings(ctx.d, key);
    await stopWatchingNotification(ctx.d, key);
    const drawn = readings.some((r) => r.drawn);
    return {
      passed: JSON.stringify(menu.items.filter((i) => i !== '')) === JSON.stringify(registryRowOffers) && opened && drawn,
      seen: `the row's ${describeRowMenu(menu)}; pressed at the row's end, the channel ${opened ? 'opened the build' : `did not open it within ${guard(10000)} ms: ${JSON.stringify(ctx.out.since(outMark).slice(0, 300))}`}, the progress ${drawn ? 'was drawn' : 'was never drawn'}, and it ended "${ending.message}" (${ending.severity})`,
    };
  }, putAway));

  // ---- the stored credential's removal ----
  await c.run('registries-panel.credential-removal-asks-no-file-and-consents-naming-the-shared-store', {
    expected: `"${logout}" on the ${host} row asks no file — no quick input recorded by the workbench's own record of them, the record holding the host question "${ADD_REGISTRY_TITLE}" the registration asked earlier in this scenario — and asks in a modal dialog "${credentialConsent(host)}" with the detail "${CREDENTIAL_DETAIL}" and a "${REMOVE_BUTTON}" button; "${EDITOR_CANCEL}" closes it, and over ${QUIET_MS} ms nothing is told, written to the channel or asked; taken a second time with "${REMOVE_BUTTON}" pressed, the same readings see the credential removal end, in a notification opening "${CREDENTIAL_REMOVAL_SUBJECT} "`,
    plant: 'in the scratch copy, out/src/registries-view.js with the credential removal asking first which file to remove it from',
  }, () => restoring(async () => {
    need(added, registered);
    await closeAllEditors(ctx);
    // The record a question's absence is read from, shown to record a question: the
    // registration's host question, asked before this check.
    const recordsQuestions = (await pickersSeen(ctx.d)).some((p) => p.title === ADD_REGISTRY_TITLE);
    const pressed = await markSaid(ctx);
    const unoffered = await takeFromRowMenu(ctx, 'Registries', host, logout);
    if (unoffered !== null) { return { passed: false, seen: unoffered }; }
    const consent = await waitDialog(ctx, 'the credential removal asking for consent', credentialConsent(host));
    const askedFirst = await saidSince(ctx, pressed);
    const declined = await markSaid(ctx);
    await declineDialog(ctx, 'the credential removal\'s consent');
    const quiet = await quietSince(ctx, declined, null);
    const beforeConsent = askedFirst.asked.length === 0 ? 'no question was drawn' : `questions ${JSON.stringify(askedFirst.asked)} were drawn`;
    const record = recordsQuestions ? `the record of questions holding the registration's "${ADD_REGISTRY_TITLE}"` : `the record of questions not holding the registration's "${ADD_REGISTRY_TITLE}", so it is not shown to record a question`;
    // A decline that acted fails here: the control would act on what it changed.
    if (!quiet.held) { return { passed: false, seen: `before the consent, ${beforeConsent}, ${record}; the consent ${describeDialog(consent)}; after "${EDITOR_CANCEL}": ${quiet.seen}` }; }
    // The control: the same consent given.
    const unofferedAgain = await takeFromRowMenu(ctx, 'Registries', host, logout);
    if (unofferedAgain !== null) { return { passed: false, seen: `the second time, ${unofferedAgain}` }; }
    await waitDialog(ctx, 'the credential removal asking again', credentialConsent(host));
    const given = await markSaid(ctx);
    await pressDialogButton(ctx.d, REMOVE_BUTTON);
    // The control is read through the readings the decline was watched by, so the
    // watch that stayed quiet is the one seen to see this ending.
    const isEnding = (t: string): boolean => t.startsWith(`${CREDENTIAL_REMOVAL_SUBJECT} `);
    const control = await until('the credential removal ending in a notification', 60000, () => saidSince(ctx, given), (s) => s.told.some(isEnding))
      .catch(() => saidSince(ctx, given));
    const ending = control.told.find(isEnding);
    return {
      passed: askedFirst.asked.length === 0 && recordsQuestions && consent.detail === CREDENTIAL_DETAIL && consent.buttons.includes(REMOVE_BUTTON) && ending !== undefined,
      seen: `before the consent, ${beforeConsent}, ${record}; the consent ${describeDialog(consent)}; after "${EDITOR_CANCEL}": ${quiet.seen}; consent given, ${ending !== undefined ? `the same readings see "${ending}"` : `the same readings see no ending within 60000 ms: ${describeSaid(control)}`}`,
    };
  }, putAway));

  // ---- a publication from a Catalog row ----
  const index = await referenceAnswer({ binary: bin, root: opts.reference, method: 'aggrega/catalogIndex', params: {}, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
  const entities = index.ok ? ((index.result as { entities?: { kind: string; name: string; file: string; origin: string }[] }).entities ?? []) : [];
  const publishedFile = entities.find((e) => e.name === PUBLISHED)?.file ?? '';
  // What the folder declares, as the language server's own index outside the editor
  // names it; an index that does not name it fails the checks built on it.
  const unindexed = (what: string): string => `the language server's catalog index outside the editor names no ${what}: ${index.ok ? JSON.stringify(entities.map((e) => `${e.kind} ${e.name}`)) : index.error.message}`;
  const publicationOpening = publicationOpeningLine(publishedFile || '<its file>').trim();
  await c.run('catalog-view.publication-confirms-naming-the-entity-and-a-decline-publishes-nothing', {
    expected: `"${publish}" on the Catalog row "${PUBLISHED}" asks in a modal dialog "${publicationConsent(publishedFile || '<its file>')}" — the file being the one the language server's own catalog index names for it — with the detail "${PUBLICATION_DETAIL}" and a "Publish" button; "${EDITOR_CANCEL}" closes it, and over ${QUIET_MS} ms nothing is told or written to the channel and the default registry (${host}) holds no ${PUBLISHED_REPOSITORY}:${PUBLISHED_TAG}; taken a second time with "Publish" pressed, the channel opens "${publicationOpening}", the publication ends in a notification opening "${PUBLICATION_SUBJECT} ", and the registry then answers the tag`,
    plant: 'in the scratch copy, out/src/workspace-catalog-view.js with a publication going ahead whatever the answer to its consent',
  }, () => restoring(async () => {
    if (publishedFile === '') { return { passed: false, seen: unindexed(`file for ${PUBLISHED}`) }; }
    need((await registryDigest(host, PUBLISHED_REPOSITORY, PUBLISHED_TAG)).startsWith('HTTP'), `${host} already holds ${PUBLISHED_REPOSITORY}:${PUBLISHED_TAG}`);
    const absent = async (): Promise<boolean> => (await registryDigest(host, PUBLISHED_REPOSITORY, PUBLISHED_TAG)).startsWith('HTTP');
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    const unoffered = await takeFromRowMenu(ctx, 'Catalog', PUBLISHED, publish);
    if (unoffered !== null) { return { passed: false, seen: unoffered }; }
    const consent = await waitDialog(ctx, 'the publication asking for consent', publicationConsent(publishedFile));
    const declined = await markSaid(ctx);
    await declineDialog(ctx, 'the publication\'s consent');
    const quiet = await holds(QUIET_MS, async () => ({ said: await saidSince(ctx, declined), absent: await absent() }), (v) => nothingSaid(v.said) && v.absent);
    const afterDecline = quiet.held ? `nothing told or asked and the registry answering no tag, over ${quiet.readings} readings in ${QUIET_MS} ms` : `${quiet.atMs} ms in: ${quiet.broke ? `${describeSaid(quiet.broke.said)}, the tag ${quiet.broke.absent ? 'absent' : 'published'}` : 'no reading'}`;
    // A decline that acted fails here: the control would act on what it changed.
    if (!quiet.held) { return { passed: false, seen: `the consent ${describeDialog(consent)}; after "${EDITOR_CANCEL}": ${afterDecline}` }; }
    // The control: the same consent given.
    const unofferedAgain = await takeFromRowMenu(ctx, 'Catalog', PUBLISHED, publish);
    if (unofferedAgain !== null) { return { passed: false, seen: `the second time, ${unofferedAgain}` }; }
    await waitDialog(ctx, 'the publication asking again', publicationConsent(publishedFile));
    const given = await markSaid(ctx);
    await pressDialogButton(ctx.d, 'Publish');
    const ending = await waitToast(ctx.d, 'the publication ending', given.toasts, (t) => t.message.startsWith(`${PUBLICATION_SUBJECT} `), 60000);
    const opened = ctx.out.since(given.out).split('\n').includes(publicationOpening);
    const digest = await registryDigest(host, PUBLISHED_REPOSITORY, PUBLISHED_TAG);
    return {
      passed: consent.detail === PUBLICATION_DETAIL && consent.buttons.includes('Publish') && opened && digest.startsWith('sha256:'),
      seen: `the consent ${describeDialog(consent)}; after "${EDITOR_CANCEL}": ${afterDecline}; consent given, the channel ${opened ? 'opened the publication' : 'did not open the publication'}, "${ending.message}" (${ending.severity}), and the registry answers the tag with ${digest}`,
    };
  }, putAway));

  // ---- the inspection a declared row offers, and no entity operation where no entity is named ----
  await c.run('catalog-view.declared-entity-row-inspects-from-the-row', {
    expected: `"${inspect}", drawn at the end of the Catalog row "${INSPECTED_ROW}" — the folder's Recipe, which its own catalog directory resolves — once the pointer rests on it and pressed there, opens as a new untitled document the language server's own answer to aggrega/entityDefinition for ${INSPECTED_ROW}, asked outside the editor over a copy of the folder, as JSON`,
    plant: 'in the scratch copy, out/src/workspace-catalog-view.js with a row\'s inspection asking for another entity than the row names',
  }, () => restoring(async () => {
    const answer = await referenceAnswer({ binary: bin, root: opts.reference, method: 'aggrega/entityDefinition', params: { name: INSPECTED_ROW }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    if (!answer.ok) { return { passed: false, seen: `the language server gave no definition of ${INSPECTED_ROW} outside the editor, so there is no answer to hold the document against: ${answer.error.message}` }; }
    const want = JSON.stringify(answer.result, null, 2).split(opts.reference).join(ctx.folder);
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    const pressed = await markSaid(ctx);
    await pressTreeRowAction(ctx.d, 'Catalog', INSPECTED_ROW, inspect);
    const doc = await until('the definition opening as a new document', 20000, () => ctx.probe.request<{ path: string; isUntitled?: boolean; text?: string } | null>('editor.active'), (v) => v !== null && v.isUntitled === true).then((d) => d, () => null);
    // No document within the bound fails the check, naming what was said instead.
    if (doc === null) { return { passed: false, seen: `no new untitled document within ${guard(20000)} ms of the press; since it, ${describeSaid(await saidSince(ctx, pressed))}` }; }
    const same = doc.text === want;
    await run(ctx, 'workbench.action.revertAndCloseActiveEditor');
    return { passed: same, seen: `a new untitled document ${same ? 'holding the language server\'s own answer' : `holding ${JSON.stringify((doc.text ?? '').slice(0, 300))} where the answer reads ${JSON.stringify(want.slice(0, 300))}`}` };
  }, putAway));

  const catalogHead = PANEL_ACTIONS.catalog.map((a) => a.label);
  const aggregates = entities.filter((e) => e.kind === 'Aggregate').length;
  const kindHeading = `Aggregate (${aggregates})`;
  let declaredRow: RowMenu | null = null;
  await c.run('catalog-view.no-entity-operation-on-the-head-or-a-kind-heading', {
    expected: `a right-click on each row at the head of the Catalog panel (${catalogHead.map((l) => `"${l}"`).join(', ')}) and on the kind heading "${kindHeading}" — the count the language server's own catalog index gives — reaches the row and offers none of ${catalogOps.map((t) => `"${t}"`).join(', ')}, while the same reading of the "${DECLARED_ROW}" row offers "${inspect}"`,
    plant: 'in the scratch copy, out/src/workspace-catalog-view.js with a kind heading carrying the value an entity row offering an inspection carries',
  }, () => restoring(async () => {
    if (aggregates === 0) { return { passed: false, seen: `${unindexed('Aggregate')}, so there is no kind heading to read` }; }
    await closeAllEditors(ctx);
    // The rows pressed before this check sit further down the list, and the panel
    // brings its focused row back into sight each time it reads its list again, so
    // it is put back at its head first, as a person does with Home in it.
    const atHead = await catalogPanelAtItsHead(ctx, catalogHead[0]);
    const control = await rowMenu(ctx.d, 'Catalog', DECLARED_ROW);
    if (control.items.length > 0) { await ctx.d.press('Escape'); }
    need(control.reached, `the right-click never reached the "${DECLARED_ROW}" row: ${describeRowMenu(control)}`);
    declaredRow = control;
    if (!offered(control, catalogOps).includes(inspect)) { return { passed: false, seen: `its positive control did not fire: the "${DECLARED_ROW}" row's right-click read ${describeRowMenu(control)}, so the reading is not shown to see an entity operation offered` }; }
    const r = await rowsOffering(ctx, 'Catalog', [...catalogHead, kindHeading], catalogOps);
    if (r.offering.length === 0) { need(r.unreached.length === 0, `the right-click never reached ${r.unreached.join('; ')}`); }
    return { passed: r.offering.length === 0, seen: `the panel ${atHead ? 'put back at its head' : 'not drawing its first row first after Home'}; ${describeReads(r.reads)}; the control, "${DECLARED_ROW}": ${describeRowMenu(control)}` };
  }, putAway));

  // ---- adding a plugin ----
  // The type question once it lists the types, and the role question governance
  // asks, by their own words.
  const isTypeQuestion = (q: Chooser): boolean => q.title === PLUGIN_TYPE_QUESTION.title && q.placeholder === PLUGIN_TYPE_QUESTION.placeholder && q.rows.length > 0;
  const isRoleQuestion = (q: Chooser): boolean => q.title === ROLE_QUESTION.title && q.placeholder === ROLE_QUESTION.placeholder;
  await c.run('plugins-panel.add-plugin-asks-type-then-its-one-answer-then-the-name-and-backing-out-attaches-nothing', {
    expected: `"${panelActionLabel('pluginAdd')}" at the head of the Plugins panel asks for the type in a list titled "${PLUGIN_TYPE_QUESTION.title}", placeholder "${PLUGIN_TYPE_QUESTION.placeholder}", offering exactly ${OFFERED_PLUGIN_TYPES.map((t) => `"${t}"`).join(', ')}; provider then asks, in an input titled "${CAPABILITY_QUESTION.title}", "${CAPABILITY_QUESTION.message}"; governance asks for the role in a list titled "${ROLE_QUESTION.title}", placeholder "${ROLE_QUESTION.placeholder}"; and every type then asks for the name in an input titled "${NAME_QUESTION.title}" whose message ends "${NAME_QUESTION.closing}". Escape at each of those questions in turn — the type, and for each type every question after it — asks nothing more, and over ${QUIET_MS} ms nothing is told or written to the channel; every question answered for linter, with a name nothing publishes, the same readings see the search run: "${attachmentProgressTitle('linter')}" drawn, and a notification opening "${ATTACHMENT_SUBJECT} "`,
    plant: 'in the scratch copy, out/src/plugins-view.js with an Escape at the name read as an empty name, so the search runs',
  }, () => restoring(async () => {
    await closeAllEditors(ctx);
    const backOuts: string[] = [];
    const askType = async (): Promise<Chooser> => {
      await pressListHead(ctx, 'plugins', 'pluginAdd');
      return waitChooser(ctx.d, 'the type being asked for', isTypeQuestion, 10000);
    };
    // backOut answers whether the back-out stayed quiet; one that acted fails the
    // check there, since what follows would act on what it changed. Nothing here
    // writes the folder's configuration, so whether a back-out wrote it has no
    // control in this scenario and is not read: an attachment that ran is seen by
    // what it tells, which the search below is seen to tell.
    const backOut = async (at: string): Promise<boolean> => {
      const m = await markSaid(ctx);
      await closedAfterEscape(ctx, at);
      const q = await quietSince(ctx, m, null);
      backOuts.push(`at ${at}: ${q.seen}`);
      return q.held;
    };
    const typeQuestion = await askType();
    if (!(await backOut('the type'))) { return { passed: false, seen: `the type question ${describeChooser(typeQuestion)}; backing out ${backOuts.join('; ')}` }; }
    // Each further question, for each type, by its own words.
    const isCapability = (q: Chooser): boolean => q.title === CAPABILITY_QUESTION.title && q.message.startsWith(CAPABILITY_QUESTION.message);
    const isRole = (q: Chooser): boolean => isRoleQuestion(q) && q.rows.length > 0;
    const isName = (q: Chooser): boolean => q.title === NAME_QUESTION.title && q.rows.length === 0 && q.message.includes(NAME_QUESTION.closing);
    let roles: string[] = [];
    const chains: Record<string, { what: string; is: (q: Chooser) => boolean; answer: () => Promise<void> }[]> = {
      provider: [
        { what: 'the capability', is: isCapability, answer: async () => { await ctx.d.type('helm'); await waitChooser(ctx.d, 'the capability reading helm', (q) => isCapability(q) && q.value === 'helm', 5000); await ctx.d.press('Enter'); } },
        { what: 'the name', is: isName, answer: async () => undefined },
      ],
      governance: [
        { what: 'the role', is: isRole, answer: async () => { await takeChooserRow(ctx.d, roles[0]); } },
        { what: 'the name', is: isName, answer: async () => undefined },
      ],
      linter: [{ what: 'the name', is: isName, answer: async () => undefined }],
      importer: [{ what: 'the name', is: isName, answer: async () => undefined }],
    };
    const drawnQuestions: string[] = [];
    for (const type of OFFERED_PLUGIN_TYPES) {
      const chain = chains[type];
      for (let k = 0; k < chain.length; k++) {
        await askType();
        await takeChooserRow(ctx.d, type);
        for (let j = 0; j < k; j++) {
          await waitChooser(ctx.d, `${type}'s ${chain[j].what}`, chain[j].is, 10000);
          await chain[j].answer();
        }
        const q = await waitChooser(ctx.d, `${type}'s ${chain[k].what} being asked for`, chain[k].is, 10000);
        if (type === 'governance' && k === 0) { roles = labelsOf(q); }
        drawnQuestions.push(`${type} › ${chain[k].what}: ${describeChooser(q)}`);
        if (!(await backOut(`${type}'s ${chain[k].what}`))) { return { passed: false, seen: `the questions drawn: ${drawnQuestions.join('; ')}; backing out ${backOuts.join('; ')}` }; }
      }
    }
    // The control: every question answered for linter.
    await askType();
    await takeChooserRow(ctx.d, 'linter');
    await waitChooser(ctx.d, 'linter\'s name being asked for', isName, 10000);
    await ctx.d.type(UNPUBLISHED_PLUGIN);
    await waitChooser(ctx.d, 'the name reading what was typed', (q) => isName(q) && q.value === UNPUBLISHED_PLUGIN, 5000);
    const answered = await markSaid(ctx);
    await ctx.d.press('Enter');
    const ending = await waitToast(ctx.d, 'the attachment ending', answered.toasts, (t) => t.message.startsWith(`${ATTACHMENT_SUBJECT} `), 60000);
    const control = await saidSince(ctx, answered);
    const progressSeen = control.told.includes(attachmentProgressTitle('linter'));
    return {
      passed: JSON.stringify(labelsOf(typeQuestion)) === JSON.stringify(OFFERED_PLUGIN_TYPES) && progressSeen,
      seen: `the type question ${describeChooser(typeQuestion)}; the questions drawn: ${drawnQuestions.join('; ')}; backing out ${backOuts.join('; ')}; every question answered for linter: ${describeSaid(control)}, ending "${ending.message}" (${ending.severity})`,
    };
  }, putAway));

  await c.run('plugins-panel.governance-roles-are-the-ones-the-compiler-declares', {
    expected: `"${panelActionLabel('pluginAdd')}" at the head of the Plugins panel, with governance taken, asks for the role in a list titled "${ROLE_QUESTION.title}" offering exactly the roles the language server's own configuration schema declares for a governance attachment (aggrega/getSchema asked for "${CONFIG_SCHEMA_KIND}", its $defs.PluginRef.properties.role.enum), in that order, annotation-transform among them — the list read once it draws its entries, or as it stands after 5000 ms; what \`aggrega plugin add --help\` says of --role is read and reported beside the verdict, not judged`,
    plant: 'in the scratch copy, out/src/plugins-run.js with the first governance role left out of the list',
  }, () => restoring(async () => {
    const schema = await referenceAnswer({ binary: bin, root: opts.reference, method: 'aggrega/getSchema', params: { kind: CONFIG_SCHEMA_KIND }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    const declared = schema.ok ? ((schema.result as { schema?: { $defs?: { PluginRef?: { properties?: { role?: { enum?: string[] } } } } } }).schema?.$defs?.PluginRef?.properties?.role?.enum ?? []) : [];
    if (declared.length === 0) { return { passed: false, seen: `the language server's configuration schema declares no governance roles, so there is no declaration to hold the list against: ${schema.ok ? 'no enum at $defs.PluginRef.properties.role' : schema.error.message}` }; }
    // The list is drawn by this check's own press, so a list drawn empty, or one
    // never drawn, is this check's failure rather than a reading it lacks.
    await closeAllEditors(ctx);
    await pressListHead(ctx, 'plugins', 'pluginAdd');
    await waitChooser(ctx.d, 'the type being asked for', isTypeQuestion, 10000);
    await takeChooserRow(ctx.d, 'governance');
    const asked = await waitChooser(ctx.d, 'governance\'s role being asked for', isRoleQuestion, 10000);
    const drawn = await until('the roles being drawn', 5000, () => chooser(ctx.d), (q) => q !== null && isRoleQuestion(q) && q.rows.length > 0).catch(() => chooser(ctx.d));
    const roles = labelsOf(drawn !== null && isRoleQuestion(drawn) ? drawn : asked);
    await closedAfterEscape(ctx, 'the role question');
    const help = await runCompiler(bin, ['plugin', 'add', '--help'], { cwd: opts.reference, home: ctx.home, boundMs: 30000, log: ctx.cliLog });
    const roleLine = help.stdout.split('\n').find((l) => l.trim().startsWith('--role')) ?? '(no --role line)';
    return { passed: JSON.stringify(roles) === JSON.stringify(declared) && roles.includes('annotation-transform'), seen: `offered ${JSON.stringify(roles)}; the schema declares ${JSON.stringify(declared)}; \`aggrega plugin add --help\` reads ${JSON.stringify(roleLine.trim())}` };
  }, putAway));

  // ---- generating Plugin entities ----
  const g = opts.generation;
  const scopes = GEN_CATALOG_SCOPES.map((s) => s.label);
  // What the editor's process tree ran as a command from "Write" on, read until the
  // plugin listing following the generation was seen or LISTING_AFTER_MS passed
  // after the generation's ending; and whether the generation itself was seen.
  const LISTING_AFTER_MS = 15000;
  const isGeneration = (cmd: string): boolean => cmd.includes(' plugin gen-catalog ');
  const listedAfter = (cmds: readonly string[]): boolean => {
    const at = cmds.findIndex(isGeneration);
    return at !== -1 && cmds.slice(at + 1).some((x) => x.includes(' plugin list '));
  };
  let fromWrite: { cmds: string[]; listed: boolean } | null = null;
  let generated = false;
  await c.run('plugins-panel.generation-asks-scope-overlay-and-directory-and-writes-only-once-confirmed', {
    expected: `"${panelActionLabel('pluginEntities')}" at the head of the Plugins panel asks in a list titled "${SCOPE_QUESTION.title}", placeholder "${SCOPE_QUESTION.placeholder}", offering ${scopes.map((s) => `"${s}"`).join(' then ')}. For "${scopes[1]}": a file dialog titled "${ARTIFACT_DIALOG.title}" accepting with "${ARTIFACT_DIALOG.accept}", which in ${g.dir} lists ${path.basename(g.artifact)} and neither ${path.basename(g.overlayFile)} nor ${path.basename(g.other)}; then "${OVERLAY_FILE_DIALOG.title}" with "${OVERLAY_FILE_DIALOG.accept}", listing the files there; then "${OUTPUT_DIALOG.title}" with "${OUTPUT_DIALOG.accept}", listing no file; then a modal dialog "${generationConsent(g.output)}" with the detail "${GENERATION_DETAIL}" and a "Write" button, whose "${EDITOR_CANCEL}" leaves ${g.output} empty, starts no compiler process and tells nothing over ${QUIET_MS} ms. For "${scopes[0]}": "${OVERLAY_DIRECTORY_DIALOG.title}" with "${OVERLAY_DIRECTORY_DIALOG.accept}", listing no file; given ${g.overlays} and ${g.output}, and "Write" pressed, the compiler's generation runs, the channel closes it with "${generationEnding(g.output)}", and ${g.output} holds byte for byte what \`aggrega plugin gen-catalog --from-embedded --overlay ${g.overlays} --output-dir <an empty directory>\` writes`,
    plant: 'in the scratch copy, out/src/plugins-view.js with the generation going ahead whatever the answer to its consent',
  }, () => restoring(async () => {
    const reference = await runCompiler(bin, ['plugin', 'gen-catalog', '--from-embedded', '--overlay', g.overlays, '--output-dir', g.reference], { cwd: opts.reference, home: ctx.home, boundMs: 120000, log: ctx.cliLog });
    const want = readTree(g.reference);
    if (reference.status !== 0 || want.size === 0) { return { passed: false, seen: `the compiler's own generation outside the editor exited ${reference.status ?? reference.signal} writing ${want.size} files, so there is nothing to hold what is written against: ${(reference.stderr || reference.stdout).trim().slice(0, 300)}` }; }
    const outputEmpty = (): boolean => fs.readdirSync(g.output).length === 0;
    await closeAllEditors(ctx);
    // One artifact, declined at the consent.
    await pressListHead(ctx, 'plugins', 'pluginEntities');
    const scopeQuestion = await waitChooser(ctx.d, 'the scope being asked for', (q) => q.title === SCOPE_QUESTION.title && q.rows.length > 0, 10000);
    await takeChooserRow(ctx.d, scopes[1]);
    const artifactDialog = await dialogIn(ctx, ARTIFACT_DIALOG.title, g.dir, 'output');
    await answerFileDialog(ctx, g.artifact, ARTIFACT_DIALOG.accept);
    const overlayFileDialog = await dialogIn(ctx, OVERLAY_FILE_DIALOG.title, g.dir, 'output');
    await answerFileDialog(ctx, g.overlayFile, OVERLAY_FILE_DIALOG.accept);
    const outputDialog = await dialogIn(ctx, OUTPUT_DIALOG.title, g.dir, 'output');
    await answerFolderDialog(ctx.d, g.output, OUTPUT_DIALOG.accept);
    const consent = await waitDialog(ctx, 'the generation asking for consent', generationConsent(g.output));
    const declined = await markSaid(ctx);
    const runsOnDecline = new CompilerRuns(ctx);
    const quiet = await (async () => {
      try {
        await declineDialog(ctx, 'the generation\'s consent');
        return await holds(QUIET_MS, async () => ({ said: await saidSince(ctx, declined), empty: outputEmpty(), runs: runsOnDecline.read().length }), (v) => nothingSaid(v.said) && v.empty && v.runs === 0);
      } finally {
        runsOnDecline.stop();
      }
    })();
    const asked = `the scope question ${describeChooser(scopeQuestion)}; ${describeChooser(artifactDialog)}; ${describeChooser(overlayFileDialog)}; ${describeChooser(outputDialog)}; the consent ${describeDialog(consent)}`;
    const afterDecline = quiet.held ? `nothing told or asked, ${g.output} empty and no compiler process, over ${quiet.readings} readings in ${QUIET_MS} ms` : `${quiet.atMs} ms in: ${quiet.broke ? `${describeSaid(quiet.broke.said)}, ${quiet.broke.empty ? 'the output empty' : 'the output written'}, ${quiet.broke.runs} compiler process(es)` : 'no reading'}`;
    // A decline that acted fails here: the control would act on what it changed.
    if (!quiet.held) { return { passed: false, seen: `${asked}; after "${EDITOR_CANCEL}": ${afterDecline}` }; }
    // Every built-in plugin, written.
    await pressListHead(ctx, 'plugins', 'pluginEntities');
    await waitChooser(ctx.d, 'the scope being asked for again', (q) => q.title === SCOPE_QUESTION.title && q.rows.length > 0, 10000);
    await takeChooserRow(ctx.d, scopes[0]);
    const overlayDirectoryDialog = await dialogIn(ctx, OVERLAY_DIRECTORY_DIALOG.title, g.dir, 'output');
    await answerFolderDialog(ctx.d, g.overlays, OVERLAY_DIRECTORY_DIALOG.accept);
    await dialogIn(ctx, OUTPUT_DIALOG.title, g.dir, 'output');
    await answerFolderDialog(ctx.d, g.output, OUTPUT_DIALOG.accept);
    await waitDialog(ctx, 'the generation asking for consent again', generationConsent(g.output));
    const written = await markSaid(ctx);
    const runs = new CompilerRuns(ctx);
    const { ending, ran } = await (async () => {
      try {
        await pressDialogButton(ctx.d, 'Write');
        const channel = await ctx.out.waitFor('the generation closing on the channel', written.out, (t) => t.split('\n').some((l) => l.startsWith(`${GENERATION_SUBJECT} `)), 120000);
        const closing = channel.split('\n').find((l) => l.startsWith(`${GENERATION_SUBJECT} `)) ?? '';
        const generations = runs.read().filter(isGeneration);
        const listed = await until('the plugin listing run after the generation', stated(LISTING_AFTER_MS), async () => runs.read(), listedAfter).then(() => true, () => false);
        fromWrite = { cmds: [...runs.read()], listed };
        return { ending: closing, ran: generations };
      } finally {
        runs.stop();
      }
    })();
    const same = sameTree(readTree(g.output), want);
    generated = ran.length > 0;
    const listsArtifact = labelsOf(artifactDialog).includes(path.basename(g.artifact)) && !labelsOf(artifactDialog).includes(path.basename(g.overlayFile)) && !labelsOf(artifactDialog).includes(path.basename(g.other));
    const listsFiles = [g.overlayFile, g.other, g.artifact].every((f) => labelsOf(overlayFileDialog).includes(path.basename(f)));
    const noFile = (q: Chooser): boolean => ![g.overlayFile, g.other, g.artifact].some((f) => labelsOf(q).includes(path.basename(f)));
    const dialogsRight = artifactDialog.buttons.includes(ARTIFACT_DIALOG.accept) && overlayFileDialog.buttons.includes(OVERLAY_FILE_DIALOG.accept) && outputDialog.buttons.includes(OUTPUT_DIALOG.accept) && overlayDirectoryDialog.buttons.includes(OVERLAY_DIRECTORY_DIALOG.accept);
    return {
      passed: scopeQuestion.placeholder === SCOPE_QUESTION.placeholder && JSON.stringify(labelsOf(scopeQuestion)) === JSON.stringify(scopes) && listsArtifact && listsFiles && noFile(outputDialog) && noFile(overlayDirectoryDialog) && dialogsRight
        && consent.detail === GENERATION_DETAIL && consent.buttons.includes('Write') && generated && ending === generationEnding(g.output) && same,
      seen: `${asked}; after "${EDITOR_CANCEL}": ${afterDecline}; the embedded scope's ${describeChooser(overlayDirectoryDialog)}; "Write" pressed: ${JSON.stringify(ran)}, the channel closing "${ending}"; ${g.output} ${same ? `holds the ${want.size} files the compiler writes, byte for byte` : `holds ${JSON.stringify([...readTree(g.output).keys()].slice(0, 6))} where the compiler writes ${JSON.stringify([...want.keys()].slice(0, 6))}`}`,
    };
  }, putAway));

  await c.run('plugins-panel.generation-reads-the-plugins-again', {
    expected: `once the generation's own compiler process has run, the Plugins panel runs the compiler's plugin listing as a command again, with nothing pressed, within ${LISTING_AFTER_MS} ms of the generation's closing line — read from every process the editor's tree recorded from before "Write" was pressed`,
    plant: 'in the scratch copy, out/src/plugins-view.js with the plugin listing left unread after a generation',
  }, async () => {
    const seen = fromWrite as { cmds: string[]; listed: boolean } | null;
    need(seen !== null && generated, `no generation ran in ${checkNamed('plugins-panel.generation-asks-scope-overlay-and-directory-and-writes-only-once-confirmed')}, so there is nothing for the listing to follow`);
    return { passed: seen.listed, seen: `the compiler processes from the press on: ${JSON.stringify(seen.cmds)}${seen.listed ? '' : `; no plugin listing after the generation within ${LISTING_AFTER_MS} ms of its closing line`}` };
  });

  // ---- removing the registry ----
  const removeRow = (): Promise<string | null> => takeFromRowMenu(ctx, 'Registries', host, remove);
  await c.run('registries-panel.removal-asks-which-file-before-consent-and-names-what-each-reaches', {
    expected: `"${remove}" on the ${host} row asks "${REMOVAL_DESTINATION_PROMPT}" over ${destinations.map((d) => `"${d}"`).join(' then ')}, with no dialog drawn before it; Escape there, over ${QUIET_MS} ms, has nothing told, written to the channel, asked or drawn, and ${global} left byte for byte as it was; "${GLOBAL_DESTINATION}" taken, it asks in a modal dialog "${registryConsent(host)}" with the detail "${removalConsentDetail('global')}" and a "${REMOVE_BUTTON}" button; "${projectDestination}" taken, the detail "${removalConsentDetail('workspace')}"; "${EDITOR_CANCEL}" on each keeps that same quiet over ${QUIET_MS} ms; and "${GLOBAL_DESTINATION}" taken with "${REMOVE_BUTTON}" pressed, the same readings see the removal end in a notification opening "${REGISTRY_REMOVAL_SUBJECT} ", the file then holding no entry for ${host} and the Registries panel no longer listing it. The questions and dialogs those absences are read from are the workbench's own records of them, which are to hold the file question and the consent this check draws`,
    plant: 'in the scratch copy, out/src/registry-configure.js with the consent saying every project is affected whichever file was chosen',
  }, () => restoring(async () => {
    need(added, registered);
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.registries.focus');
    const before = fs.readFileSync(global);
    const unchanged: Kept = { holds: () => fs.readFileSync(global).equals(before), what: 'the global file unchanged' };
    const declines: string[] = [];
    // The file question, backed out of.
    const pressed = await markSaid(ctx);
    const unoffered = await removeRow();
    if (unoffered !== null) { return { passed: false, seen: unoffered }; }
    const fileQuestion = await waitChooser(ctx.d, 'the file being asked for', (q) => q.placeholder === REMOVAL_DESTINATION_PROMPT && q.rows.length > 0, 10000);
    const beforeFile = await saidSince(ctx, pressed);
    const atFile = await markSaid(ctx);
    await closedAfterEscape(ctx, 'the file question');
    const q0 = await quietSince(ctx, atFile, unchanged);
    declines.push(`Escape at the file: ${q0.seen}`);
    // A back-out that acted fails here: what follows would act on what it changed.
    if (!q0.held) { return { passed: false, seen: `the file question ${describeChooser(fileQuestion)}; ${declines.join('; ')}` }; }
    // Each file, declined at the consent.
    const consents: Record<string, DrawnDialog> = {};
    for (const d of CONFIG_WRITE_DESTINATIONS) {
      const unofferedFor = await removeRow();
      if (unofferedFor !== null) { return { passed: false, seen: `taking "${d.label}", ${unofferedFor}` }; }
      await waitChooser(ctx.d, 'the file being asked for', (q) => q.placeholder === REMOVAL_DESTINATION_PROMPT && q.rows.length > 0, 10000);
      await takeChooserRow(ctx.d, d.label);
      consents[d.value] = await waitDialog(ctx, `the removal asking for consent with ${d.label}`, registryConsent(host));
      const declined = await markSaid(ctx);
      await declineDialog(ctx, 'the removal\'s consent');
      const q = await quietSince(ctx, declined, unchanged);
      declines.push(`"${EDITOR_CANCEL}" with "${d.label}": ${q.seen}`);
      if (!q.held) { return { passed: false, seen: `with "${d.label}" ${describeDialog(consents[d.value])}; ${declines.join('; ')}` }; }
    }
    // The control: the global file taken and the consent given.
    const unofferedLast = await removeRow();
    if (unofferedLast !== null) { return { passed: false, seen: `the last time, ${unofferedLast}` }; }
    await waitChooser(ctx.d, 'the file being asked for', (q) => q.placeholder === REMOVAL_DESTINATION_PROMPT && q.rows.length > 0, 10000);
    await takeChooserRow(ctx.d, GLOBAL_DESTINATION);
    await waitDialog(ctx, 'the removal asking for consent', registryConsent(host));
    const given = await markSaid(ctx);
    const statusAt = await statusMark(ctx);
    await pressDialogButton(ctx.d, REMOVE_BUTTON);
    const ending = await waitToast(ctx.d, 'the removal ending', given.toasts, (t) => t.message.startsWith(`${REGISTRY_REMOVAL_SUBJECT} `), 60000);
    const gone = entryFor(fs.readFileSync(global, 'utf8'), host) === null;
    const dropped = await until(`the Registries panel dropping ${host}`, 20000, () => panelLabels(ctx, 'Registries'), (v) => !v.includes(host)).then(() => true, () => false);
    const back = await runningAgain(ctx, statusAt, 60000).then(() => 'read running again', () => `did not read running again within ${guard(60000)} ms`);
    const globalDetail = consents.global?.detail ?? '';
    const projectDetail = consents.workspace?.detail ?? '';
    // The records the absences above were read from, shown to record what this
    // check drew: the file question, and the consent.
    const recordsTheQuestion = (await pickersSeen(ctx.d)).slice(pressed.pickers).some((p) => p.placeholder === REMOVAL_DESTINATION_PROMPT);
    const recordsTheConsent = (await dialogsSeen(ctx.d)).slice(pressed.dialogs).some((x) => x.message === registryConsent(host));
    return {
      passed: JSON.stringify(labelsOf(fileQuestion)) === JSON.stringify(destinations) && beforeFile.dialogs.length === 0 && globalDetail === removalConsentDetail('global') && projectDetail === removalConsentDetail('workspace')
        && (consents.global?.buttons ?? []).includes(REMOVE_BUTTON) && gone && dropped && recordsTheQuestion && recordsTheConsent,
      seen: `the file question ${describeChooser(fileQuestion)}, ${beforeFile.dialogs.length === 0 ? 'no dialog before it' : `dialogs before it ${JSON.stringify(beforeFile.dialogs)}`}; with the global file ${consents.global ? describeDialog(consents.global) : 'no consent'}; with the project's file ${consents.workspace ? describeDialog(consents.workspace) : 'no consent'}; ${declines.join('; ')}; consent given, "${ending.message}" (${ending.severity}), ${global} ${gone ? `no longer naming ${host}` : `still naming ${host}`}, the panel ${dropped ? `no longer listing ${host}` : `still listing ${host} after ${guard(20000)} ms`}; the language server ${back}; the record of questions ${recordsTheQuestion ? 'holds' : 'does not hold'} the file question, and the record of dialogs ${recordsTheConsent ? 'holds' : 'does not hold'} the consent`,
    };
  }, putAway));

  // ---- no row operation on a row naming nothing to act on ----
  // The absences below are held against the readings of a registry's row and an
  // entity's row the checks named here took; that a check took its reading is what
  // the absence needs to have run, and what the reading offered is its control.
  const registryRowCheck = checkNamed('registries-panel.registry-row-offers-only-its-own-operations-and-updates-its-index-from-the-row');
  const unreadControls = `${registryRowCheck} or ${checkNamed('catalog-view.no-entity-operation-on-the-head-or-a-kind-heading')} did not read its row, so there is no reading to hold an absence of a row operation against`;
  const controlsOffered = (registryControl: RowMenu, catalogControl: RowMenu): string | null => (offered(registryControl, registryOps).length > 0 && offered(catalogControl, catalogOps).length > 0 ? null
    : `its positive control did not fire: the ${host} row read ${describeRowMenu(registryControl)} and the "${DECLARED_ROW}" row ${describeRowMenu(catalogControl)}, so an absence of their operations here would prove nothing`);
  const registryHead = PANEL_ACTIONS.registries.map((a) => a.label);
  await c.run('registries-panel.no-row-operation-on-the-head-or-the-empty-answer', {
    expected: `with no registry configured, a right-click on each row at the head of the Registries panel (${registryHead.map((l) => `"${l}"`).join(', ')}) and on "${NO_REGISTRIES_ROW}" reaches the row and offers none of ${registryOps.map((t) => `"${t}"`).join(', ')} — the reading of the ${host} row, earlier in this scenario, having offered them`,
    plant: 'in the scratch copy, out/src/registries-view.js with the rows at the head carrying the value a registry\'s row carries',
  }, () => restoring(async () => {
    const control = registryRow as RowMenu | null;
    need(control !== null, `${registryRowCheck} did not read the ${host} row, so there is no reading to hold an absence of its operations against`);
    if (offered(control, registryOps).length !== registryOps.length) { return { passed: false, seen: `its positive control did not fire: the ${host} row read ${describeRowMenu(control)}, not offering every one of ${JSON.stringify(registryOps)}, so their absence here would prove nothing` }; }
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.registries.focus');
    await until(`the Registries panel reading "${NO_REGISTRIES_ROW}"`, 20000, () => panelLabels(ctx, 'Registries'), (v) => v.includes(NO_REGISTRIES_ROW));
    const r = await rowsOffering(ctx, 'Registries', [...registryHead, NO_REGISTRIES_ROW], registryOps);
    if (r.offering.length === 0) { need(r.unreached.length === 0, `the right-click never reached ${r.unreached.join('; ')}`); }
    return { passed: r.offering.length === 0, seen: describeReads(r.reads) };
  }, putAway));

  // The language server stopped by the binary setting, and each list panel read
  // again. The status bar's readings are marked before the setting changes, so the
  // reading waited for is one taken after it, never the one standing before.
  const beforeStop = await statusMark(ctx);
  await setBinaryPath(ctx, bin, opts.missing);
  await c.run('list-panels.no-row-operation-on-the-rows-a-stopped-server-draws', {
    expected: `with the language server stopped — the binary setting pointed at ${opts.missing}, which does not exist, and the status bar reading "${NOT_RUNNING}" after it changed — the Registries panel's Refresh and the Catalog panel's each draw "${SERVER_STOPPED_LABEL}", neither drawn before its Refresh was pressed, and a right-click on each reaches the row and offers none of its panel's row operations — the readings of the ${host} row and the "${DECLARED_ROW}" row, earlier in this scenario, having offered them`,
    plant: 'in the scratch copy, out/src/registries-view.js with a row saying why there is no registry carrying the value a registry\'s row carries',
  }, () => restoring(async () => {
    const registryControl = registryRow as RowMenu | null;
    const catalogControl = declaredRow as RowMenu | null;
    need(registryControl !== null && catalogControl !== null, unreadControls);
    const unfired = controlsOffered(registryControl, catalogControl);
    if (unfired !== null) { return { passed: false, seen: unfired }; }
    await statusReadsSince(ctx, beforeStop, NOT_RUNNING, 60000);
    await closeAllEditors(ctx);
    await run(ctx, 'workbench.view.extension.aggrega');
    // Each panel is read before its Refresh is pressed, so the row then waited for
    // is shown drawn by the press rather than standing from before it.
    const registriesBefore = await panelLabels(ctx, 'Registries');
    await run(ctx, 'aggrega.registries.refresh');
    await until(`the Registries panel reading "${SERVER_STOPPED_LABEL}"`, 20000, () => panelLabels(ctx, 'Registries'), (v) => v.includes(SERVER_STOPPED_LABEL));
    const catalogBefore = await panelLabels(ctx, 'Catalog');
    await run(ctx, 'aggrega.workspaceCatalog.refresh');
    await until(`the Catalog panel reading "${SERVER_STOPPED_LABEL}"`, 20000, () => panelLabels(ctx, 'Catalog'), (v) => v.includes(SERVER_STOPPED_LABEL));
    const standing = [registriesBefore.includes(SERVER_STOPPED_LABEL) ? `the Registries panel's "${SERVER_STOPPED_LABEL}"` : '', catalogBefore.includes(SERVER_STOPPED_LABEL) ? `the Catalog panel's "${SERVER_STOPPED_LABEL}"` : ''].filter((x) => x !== '');
    const registries = await rowsOffering(ctx, 'Registries', [SERVER_STOPPED_LABEL], registryOps);
    const catalog = await rowsOffering(ctx, 'Catalog', [SERVER_STOPPED_LABEL], catalogOps);
    const offering = [...registries.offering, ...catalog.offering];
    if (offering.length === 0 && standing.length === 0) { need([...registries.unreached, ...catalog.unreached].length === 0, `the right-click never reached ${[...registries.unreached, ...catalog.unreached].join('; ')}`); }
    return {
      passed: offering.length === 0 && standing.length === 0,
      seen: `${standing.length === 0 ? 'neither row drawn before its Refresh was pressed' : `${standing.join(' and ')} drawn before its Refresh was pressed, so the press is not shown to draw it`}; Registries ${describeReads(registries.reads)}; Catalog ${describeReads(catalog.reads)}`,
    };
  }, putAway));

  // The binary given back, its readings marked as the stop's were, and the window
  // opened on a folder no marker reaches.
  const beforeGivenBack = await statusMark(ctx);
  await setBinaryPath(ctx, opts.missing, bin);
  const ledger = new ToastLedger();
  await c.run('list-panels.no-row-operation-on-the-rows-saying-no-workspace', {
    expected: `with the binary given back and the status bar reading "${RUNNING}" after it was, the window opened in place on ${opts.unanchored}, a folder no workspace marker reaches, has the Registries and Catalog panels each draw "${NO_ANCHORED_WORKSPACE_TREE_LABEL}" beneath their head, and a right-click on each reaches the row and offers none of its panel's row operations — the readings of the ${host} row and the "${DECLARED_ROW}" row, earlier in this scenario, having offered them`,
    plant: 'in the scratch copy, out/src/registries-view.js with a row saying why there is no registry carrying the value a registry\'s row carries',
  }, () => restoring(async () => {
    const registryControl = registryRow as RowMenu | null;
    const catalogControl = declaredRow as RowMenu | null;
    need(registryControl !== null && catalogControl !== null, unreadControls);
    const unfired = controlsOffered(registryControl, catalogControl);
    if (unfired !== null) { return { passed: false, seen: unfired }; }
    await statusReadsSince(ctx, beforeGivenBack, RUNNING, 60000);
    const change = await openFolderHere(ctx, ledger, opts.unanchored);
    await run(ctx, 'workbench.view.extension.aggrega');
    for (const title of ['Registries', 'Catalog']) {
      await until(`the ${title} panel reading "${NO_ANCHORED_WORKSPACE_TREE_LABEL}"`, 30000, () => panelLabels(ctx, title), (v) => v.includes(NO_ANCHORED_WORKSPACE_TREE_LABEL));
    }
    const registries = await rowsOffering(ctx, 'Registries', [NO_ANCHORED_WORKSPACE_TREE_LABEL], registryOps);
    const catalog = await rowsOffering(ctx, 'Catalog', [NO_ANCHORED_WORKSPACE_TREE_LABEL], catalogOps);
    const offering = [...registries.offering, ...catalog.offering];
    if (offering.length === 0) { need([...registries.unreached, ...catalog.unreached].length === 0, `the right-click never reached ${[...registries.unreached, ...catalog.unreached].join('; ')}`); }
    return { passed: offering.length === 0, seen: `the window ${change.reloaded ? 'reloaded' : 'did not reload'} onto the folder in ${change.ms} ms; Registries ${describeReads(registries.reads)}; Catalog ${describeReads(catalog.reads)}` };
  }, putAway));
}

// ---- an inspection the catalog cannot answer, in a documentation example --------------

// INSPECTED_BY_NAME is the Aggregate the example declares at its root, which its
// catalog directories do not reach, and the catalog list the second check writes.
const INSPECTED_BY_NAME = 'aggregate';
const NO_CATALOG_DIRECTORY = '  catalog_dirs: []\n';

// emptyCatalogList replaces a configuration's list of catalog directories, with
// the comments written inside it, by an empty list, refusing where the file does
// not list them once.
export function emptyCatalogList(config: string): void {
  const text = fs.readFileSync(config, 'utf8');
  const listed = / {2}catalog_dirs:\n(?: {4}.*\n)+/g;
  const found = text.match(listed) ?? [];
  if (found.length !== 1) { throw new Error(`${config} lists its catalog directories ${found.length} times, not once`); }
  fs.writeFileSync(config, text.replace(listed, NO_CATALOG_DIRECTORY));
}

// refusedFor asks the language server outside the editor for the definition of
// `name` and answers the sentence the inspection's ending carries for its refusal.
async function refusedFor(ctx: SuiteContext, root: string, name: string): Promise<{ want: string; message: string; raw: string } | null> {
  const answer = await referenceAnswer({ binary: ctx.inputs.compiler.path, root, method: 'aggrega/entityDefinition', params: { name }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
  if (answer.ok || typeof (answer.error.data as { file?: unknown } | null)?.file !== 'string') { return null; }
  return { want: `${inspectionLead(name)}${answer.error.message}`, message: answer.error.message, raw: JSON.stringify(answer).slice(0, 400) };
}

// inspectRow takes the inspection from the menu of the Catalog row naming
// `name`, as a reader right-clicks the row and takes it, and answers what the
// row offered where it offers no inspection.
async function inspectRow(ctx: SuiteContext, name: string, inspect: string): Promise<string | null> {
  await closeAllEditors(ctx);
  await run(ctx, 'aggrega.workspaceCatalog.focus');
  return takeFromRowMenu(ctx, 'Catalog', name, inspect);
}

export async function inspectionByNameChecks(ctx: SuiteContext, referenceFolder: string): Promise<void> {
  const c = ctx.checks;
  const inspect = commandTitle(ctx.manifest, 'aggrega.workspaceCatalog.inspect');
  await ready(ctx);
  let first: Ending | null = null;
  await c.run('inspect.declared-entity-the-catalog-cannot-resolve-says-why-and-what-to-change', {
    expected: `"${inspect}" taken from the Catalog row "${INSPECTED_BY_NAME}" — the Aggregate the folder declares at its root, which its catalog directories do not reach — ends in one error notification reading "${inspectionLead(INSPECTED_BY_NAME)}" followed by the language server's own refusal of the same request, asked outside the editor over a copy of the folder, which carries a note after the sentence saying the catalog resolved nothing for it (its "; note:" part), offering "${OPEN_ACTION}" and nothing else; the output channel carries the same sentence`,
    plant: 'in the scratch copy, out/src/inspection-request.js with the branch that reads the declaring document taken out, so the refusal ends as an operation that did not complete',
  }, () => restoring(async () => {
    const refused = await refusedFor(ctx, referenceFolder, INSPECTED_BY_NAME);
    if (refused === null) { return { passed: false, seen: 'the language server\'s own answer outside the editor is not a refusal naming the declaring document, so there is no sentence to hold the ending against' }; }
    const toastMark = (await toasts(ctx.d)).length;
    const mark = ctx.out.mark();
    const unoffered = await inspectRow(ctx, INSPECTED_BY_NAME, inspect);
    if (unoffered !== null) { return { passed: false, seen: unoffered }; }
    const e = await readEnding(ctx, toastMark, mark, refused.want, INSPECTED_BY_NAME);
    first = e;
    return { passed: endsAsWanted(e, refused.want) && refused.message.includes('; note: '), seen: `${e.seen}; the language server's own refusal: ${refused.raw}` };
  }, () => leftOpen(ctx)));

  await c.run('inspect.no-note-where-the-workspace-lists-no-catalog-directory', {
    expected: `with the folder's catalog_dirs written as an empty list, and the language server restarted by the restart command to read it, the same inspection ends in one error notification reading "${inspectionLead(INSPECTED_BY_NAME)}" followed by the language server's own refusal of the same request over a copy of the folder written the same way, with no "; note:" part — the reading of the inspection before, read the same way, having carried one`,
    plant: 'in the scratch copy, out/src/inspection-request.js with every refusal naming the declaring document carried with a note of its own after the compiler\'s sentence',
  }, () => restoring(async () => {
    const before = first as Ending | null;
    need(before !== null, `${checkNamed('inspect.declared-entity-the-catalog-cannot-resolve-says-why-and-what-to-change')} did not read the inspection's ending, so there is no reading to hold an absence of its note against`);
    if (!(before.endings.length === 1 && before.endings[0].message.includes('; note: '))) { return { passed: false, seen: `its positive control did not fire: the inspection before did not end in one notification carrying a note (${before.seen}), so an absence of the note here would prove nothing` }; }
    emptyCatalogList(path.join(referenceFolder, '.aggrega-config.yaml'));
    const refused = await refusedFor(ctx, referenceFolder, INSPECTED_BY_NAME);
    if (refused === null) { return { passed: false, seen: 'the language server\'s own answer over the copy written the same way is not a refusal naming the declaring document, so there is no sentence to hold the ending against' }; }
    const config = path.join(ctx.folder, '.aggrega-config.yaml');
    const warnMark = (await toasts(ctx.d)).length;
    emptyCatalogList(config);
    // The extension warns that the configuration changed under the running server.
    // The warning is waited for, and so is the notification the restart command
    // ends in, so both are drawn before the inspection's own mark is taken and
    // neither is read as its ending; the server is restarted by that command to
    // read the change.
    const warned = await waitToast(ctx.d, 'the warning that the configuration changed under the language server', warnMark, (t) => t.message === configurationChangedWarning(config), 20000)
      .then((t) => `the warning "${t.message}" drawn`, (err: unknown) => `no warning drawn: ${err instanceof Error ? err.message : String(err)}`);
    const serverBefore = await theServer(ctx);
    const statusAt = await statusMark(ctx);
    const restartMark = (await toasts(ctx.d)).length;
    await send(ctx, RESTART_COMMAND);
    const next = await theServer(ctx, 30000, serverBefore.pid);
    await runningAgain(ctx, statusAt, 60000);
    await waitToast(ctx.d, 'the restart ending in its notification', restartMark, (t) => t.message.startsWith(inPlaceOpening('restarted')), 30000);
    const toastMark = (await toasts(ctx.d)).length;
    const mark = ctx.out.mark();
    const unoffered = await inspectRow(ctx, INSPECTED_BY_NAME, inspect);
    if (unoffered !== null) { return { passed: false, seen: unoffered }; }
    const e = await readEnding(ctx, toastMark, mark, refused.want, INSPECTED_BY_NAME);
    const noted = e.endings.filter((t) => t.message.includes('; note: ')).map((t) => t.message.slice(t.message.indexOf('; note: ')));
    return { passed: endsAsWanted(e, refused.want) && noted.length === 0, seen: `${warned}; the server ${serverBefore.pid} replaced by ${next.pid}; ${e.seen}; ${noted.length === 0 ? 'no ending carries a "; note:" part' : `an ending carries ${JSON.stringify(noted[0].slice(0, 200))}`}; the language server's own refusal: ${refused.raw}` };
  }, () => leftOpen(ctx)));
}
