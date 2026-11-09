// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { featuresNotOfferedLine } from '../../src/attach-candidates';
import { buildParams } from '../../src/build-dials';
import type { ValidateResponse } from '../../src/types';
import { buildValidateParams } from '../../src/validate-request';
import { CatalogIndexDoc, FAILURE_LABEL, linksLeadingOutRow } from '../../src/workspace-catalog-run';
import { need, NotRun } from './checks';
import { runCompiler } from './cli';
import { WebviewDocument } from './drivers';
import { CHART_ONLY, readTree, SIZED_VOLUME, SIZING_LIBRARY, UNMAPPED_RELEASE } from './fixtures';
import { NoticeReading, noticeReadings, watchNotice } from './graph-drawing';
import { findGraphPanel, GRAPH_PANEL_OPENING, graphCouldNotBeDrawn, pressNode, settledPanel, showGraph } from './graph-panel';
import { LinkedAway, linkAway, outsideTheWorkspace, putBackLinked, untouched } from './linked-away';
import { DiagnosticEntry } from './probe-client';
import { referenceAnswer, ReferenceRequest, shortCodeOf } from './reference';
import { closeAllEditors, commandTitle, describeDiagnostics, diagnostics, lineOf, Line, open, ready, run, SuiteContext } from './suite-context';
import { drawnAsAnswered, PENDING } from './suite-graph-panel';
import { shownOptions } from './suite-inspection';
import { selectRelease } from './suite-own-catalogs';
import { pressViewAction, publishedFaults } from './suite-storefront';
import {
  asTheEditorDraws, commandsPanel, describeRowMenu, holds, hoverAt, NOTIFICATION_MESSAGE_CAP, pressMenuItem, pressOperation, pressTreeRowAction, revealTreeRow, rowMenu,
  selectorRows, sleep, toasts, treeRows, until, waitToast,
} from './workbench';

// The checks run in a copy of the documentation example whose Releases each read
// a catalog variant of their own, with two entities added so a request answered
// in one Release's terms reads differently in another's (fixtures.ts says which
// and why). Each surface drawn from such a request is read with no Release
// selected, then with each of two Releases selected in turn, and each reading is
// held against the language server's own answer to the same request naming the
// same Release — or none — asked outside the editor over a second copy. The
// Catalog panel and the list of what may attach read no word about links leading
// out of the workspace while the folder holds none; the next two checks place one
// in components/, leading to a Feature document outside the workspace, and read
// what each says about it against the language server's own answer over the
// folder itself.
//
// The checks after those each replace a path of the folder by a link leading out
// of the workspace — the build's output directory, a lockfile, a Release, a file
// beneath a catalog directory — and read the refusal it earns where the editor
// shows it, held against the language server's own answer to the same request,
// or the compiler's own run of the same command, over the folder in the same
// state. Each lists the directory its link leads to before and after and requires
// it unchanged, and each takes its link away again and selects again the Release
// it found selected, so no check after it inherits either — bar the last two,
// which share one link on purpose.

export const SELECTED_RELEASE_CHECKS = [
  'no-release.each-surface-answers-in-the-workspaces-own-terms',
  'catalog-panel.lists-what-the-selected-release-reads-and-follows-the-selection',
  'go-to-definition.opens-the-selected-releases-variant',
  'hover.renders-the-selected-releases-variant',
  'completion.offers-what-the-selected-releases-catalog-declares',
  'inspect.resolves-in-the-selected-releases-terms',
  'catalog-row.check-runs-in-the-selected-releases-terms',
  'may-attach.lists-the-selected-releases-features',
  'catalog-panel.names-the-link-leading-out-of-the-workspace',
  'may-attach.names-the-link-leading-out-of-the-workspace',
  'build.refused-for-an-output-directory-leading-out-in-the-compilers-words',
  'pull.refused-for-a-lockfile-leading-out-in-the-compilers-words',
  'catalog-panel.refused-list-shows-the-language-servers-words',
  'validation.finding-for-a-catalog-file-leading-out-is-the-language-servers-own',
  'graph.refused-for-a-catalog-file-leading-out-in-the-compilers-words',
] as const;

const COMPOSE = 'release-compose.yaml';
const CHART = 'release-helm-chart.yaml';
const SYNTH = 'release-helm-synth.yaml';

// READ_IN are the two Releases the per-surface checks select in turn. Their
// variants of the database Component hover differently, and only the second
// reads the catalog directory declaring CHART_ONLY.
const READ_IN = [COMPOSE, CHART] as const;

// GRAPH_RELEASE is the Release whose graph the check of what may attach draws,
// and the one the scenario writes a lockfile for in both copies.
export const GRAPH_RELEASE = COMPOSE;

// DRAWN_MS is the order of what the drawing a press on Graph asks for takes a
// correct editor on an idle machine for this folder's small topology, the panel's
// first opening included: a few seconds. The wait runs to its guard, so a busy
// machine is allowed for, and a drawing that never comes ends the check in that
// guard rather than in the shared default's.
const DRAWN_MS = 10000;

const MARIADB = 'core/datastore/mariadb';
const TYPE_LINE = `type: ${MARIADB}`;
const COMPONENTS = 'Component';
const DB_NODE = 'db';
const CHECK = 'The check';

// LINK is the link the two link checks place in components/, a directory of
// workspace documents under no catalog directory and apart from every Release's
// own, so every Release's terms hold its place and no Release's compile meets it:
// a link leading out beside a Release, or beneath a catalog directory a Release
// reads, halts every compile of that Release, and the requests these two checks
// read would then answer nothing. It leads to BEHIND_THE_LINK, a Feature document
// written beside the folder, outside the workspace.
const LINK = path.join('components', 'linked-feature.yaml');
const BEHIND_THE_LINK = { name: 'local/reached-through-a-link', file: 'feature-outside-the-workspace.yaml' };
const BEHIND_THE_LINK_DOCUMENT = `apiVersion: aggrega.ai/v1beta1
kind: Feature
metadata:
  name: ${BEHIND_THE_LINK.name}
  version: 1.0.0
  description: A Feature kept outside the workspace, which the workspace reaches only through a link.
`;

// placeLinkLeadingOut writes BEHIND_THE_LINK beside the folder and places LINK in
// the folder leading to it, refusing as not run where either cannot be placed or
// the link does not read the file through. It answers with the link's name
// relative to the folder, in the form the language server names a path.
function placeLinkLeadingOut(folder: string): { link: string; rel: string } {
  const outside = path.join(path.dirname(folder), 'outside-the-workspace', BEHIND_THE_LINK.file);
  const link = path.join(folder, LINK);
  try {
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, BEHIND_THE_LINK_DOCUMENT);
    fs.symlinkSync(outside, link, 'file');
  } catch (err) {
    throw new NotRun(`the link to a Feature outside the workspace could not be placed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!path.relative(folder, outside).startsWith('..') || fs.readFileSync(link, 'utf8') !== BEHIND_THE_LINK_DOCUMENT) {
    throw new NotRun(`${outside} is not outside ${folder}, or ${link} does not read it through the link`);
  }
  return { link, rel: path.relative(folder, link).split(path.sep).join('/') };
}

// LINKS_ROW_HEADS are the words the Catalog panel's row naming links leading out
// of the workspace opens with, for one link and for several, read off the
// extension's own composition of the row rather than typed here: a row opening
// with either is that row, whatever links it names.
const LINKS_ROW_HEADS = [['\u0000'], ['\u0000', '\u0000']].map((names) => {
  const label = linksLeadingOutRow({ entities: [], unreadLinkedDirs: names, unreadLinkedFiles: [] })?.label ?? '';
  return label.slice(0, label.indexOf('\u0000')).trimEnd();
});

function isLinksRow(label: string): boolean {
  return LINKS_ROW_HEADS.some((head) => head !== '' && label.startsWith(head));
}

// namesNoLink reads whether an index answer carries both lists of links leading
// out of the workspace, and names none in either.
function namesNoLink(index: Partial<CatalogIndexDoc>): boolean {
  return Array.isArray(index.unreadLinkedDirs) && index.unreadLinkedDirs.length === 0
    && Array.isArray(index.unreadLinkedFiles) && index.unreadLinkedFiles.length === 0;
}

function describeLinks(index: Partial<CatalogIndexDoc>): string {
  return `links to directories ${JSON.stringify(index.unreadLinkedDirs ?? null)} and to files ${JSON.stringify(index.unreadLinkedFiles ?? null)}`;
}

// The words a refused operation's ending opens with, held as written so a change
// of wording in the extension is a change these checks report rather than follow;
// the words after them are the compiler's, read off its own answer.
const BUILD_REFUSED = 'The build did not complete: ';
const PULL_REFUSED = 'The pull did not complete: ';
const isBuildEnding = (l: string): boolean => l.startsWith('Build completed: ') || l.startsWith(BUILD_REFUSED);

// NONE_SELECTED is what the Release row reads with no Release selected.
const NONE_SELECTED = 'none selected';

// KEPT_OUTSIDE is the text of the file a check keeps behind its link, outside the
// workspace, which nothing the editor does may change.
const KEPT_OUTSIDE = 'Kept outside the workspace, behind a link no operation may write or delete through.\n';

// CATALOG_LINK is the link the last two checks share, beneath catalog-compose/, the
// catalog directory release-compose.yaml reads, so every compile of that Release
// meets it; it leads to BEHIND_THE_CATALOG_LINK, a Feature document written beside
// the folder, outside the workspace.
const CATALOG_LINK = path.join('catalog-compose', 'linked-catalog-feature.yaml');
const BEHIND_THE_CATALOG_LINK = { name: 'local/reached-through-a-catalog-link', file: 'feature-outside-the-catalog.yaml' };
const BEHIND_THE_CATALOG_LINK_DOCUMENT = `apiVersion: aggrega.ai/v1beta1
kind: Feature
metadata:
  name: ${BEHIND_THE_CATALOG_LINK.name}
  version: 1.0.0
  description: A Feature kept outside the workspace, which a catalog directory reaches only through a link.
`;

// THE_HEAD is the range of an entry filed at a document's head, as the probe lists
// it.
const THE_HEAD = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

// namesADocument reads whether a refusal's envelope names a document of its own,
// which the editor files the refusal on in place of the Release.
function namesADocument(data: unknown): boolean {
  const named = data as { file?: string; lockfile?: string } | null;
  return !!named?.file || !!named?.lockfile;
}

// refusalFaults holds the entries carrying a refusal's words against the one
// entry the editor files for a refusal that names no document of its own: an
// Error at the head of the Release the request named, under "aggrega", whose code
// is the short code the refusal's data names — none where it names none — and
// those words on no other document.
function refusalFaults(on: DiagnosticEntry[], elsewhere: string[], shortCode: string | null): string[] {
  const faults: string[] = [];
  if (on.length !== 1) { faults.push(`${on.length} entries carry the refusal's words`); }
  const e = on[0];
  if (e !== undefined) {
    if (e.source !== 'aggrega') { faults.push(`its source is ${e.source}`); }
    if (e.severity !== 'Error') { faults.push(`its severity is ${e.severity}`); }
    if (JSON.stringify(e.range) !== JSON.stringify(THE_HEAD)) { faults.push(`it spans ${JSON.stringify(e.range)}, not the head of the Release`); }
    if (e.code !== shortCode) { faults.push(`its code is ${e.code ?? 'none'}, the refusal's data naming ${shortCode ?? 'none'}`); }
  }
  if (elsewhere.length > 0) { faults.push(`the same words are filed on ${JSON.stringify(elsewhere)} as well`); }
  return faults;
}

// flat reads a text with each run of blank space as one, as the editor draws a
// notification.
const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();

// drawnAsNotified reads whether a notification draws `message` as the editor draws
// a message it is given: its words, each run of blank space read as one, cut where
// the editor cuts a long one.
export const drawnAsNotified = (drawn: string, message: string): boolean => flat(drawn) === flat(asTheEditorDraws(message));

// stderrWords is a command's standard error with the blank lines around it
// dropped and nothing else, which is what a refused run's ending is promised to
// carry: the compiler's words unchanged, the indentation of its first line
// included.
const stderrWords = (stderr: string): string => stderr.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/(?:\r?\n[ \t]*)+$/, '');

type Terms = string | null;
const termsName = (release: Terms): string => release ?? 'no Release';

// named is a request's parameters as the editor sends them: naming the Release
// where one is selected and carrying no release key where none is.
const named = (params: Record<string, unknown>, release: Terms): Record<string, unknown> => (release === null ? { ...params } : { ...params, release });

// Reading is one surface read in one Release's terms, held against the server.
interface Reading { release: Terms; same: boolean; seen: string }

function verdict(readings: Reading[]): { passed: boolean; seen: string } {
  return {
    passed: readings.length > 0 && readings.every((r) => r.same),
    seen: readings.map((r) => `${termsName(r.release)}: ${r.seen}`).join(' || '),
  };
}

interface Active { path: string; isUntitled?: boolean; text?: string }

export async function selectedReleaseChecks(ctx: SuiteContext, reference: string): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  const aggregate = path.join(ctx.folder, 'aggregate.yaml');
  const refAggregate = path.join(reference, 'aggregate.yaml');
  const refUri = `file://${refAggregate}`;
  const inspectRow = commandTitle(ctx.manifest, 'aggrega.workspaceCatalog.inspect');
  const validateItem = commandTitle(ctx.manifest, 'aggrega.workspaceCatalog.validate');
  await ready(ctx);

  // ---- the server's own answers, outside the editor ----
  const answer = async (method: string, params: Record<string, unknown>, first: ReferenceRequest[] = []): Promise<unknown> => {
    const a = await referenceAnswer({ binary: bin, root: reference, method, params, first, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(a.ok, `the language server gave no answer to ${method} ${JSON.stringify(params)} over the reference copy: ${a.ok ? '' : a.error.message}`);
    return a.result;
  };
  // A request about a position in the Aggregate is answered once the server has
  // validated it, which the editor does as the document opens.
  const validatedFirst = (release: Terms): ReferenceRequest[] => [{ method: 'aggrega/validate', params: named({ file: refAggregate, content: fs.readFileSync(refAggregate, 'utf8') }, release) }];
  const relativeTo = (root: string, uri: string): string => path.relative(root, uri.startsWith('file:') ? fileURLToPath(uri) : uri);

  let typeLine: Line | null = null;
  const atType = async (): Promise<Line> => {
    typeLine ??= await lineOf(ctx, aggregate, TYPE_LINE);
    return typeLine;
  };
  const inName = async (): Promise<{ line: number; character: number }> => {
    const l = await atType();
    return { line: l.index, character: l.text.indexOf(MARIADB) + 5 };
  };
  const atValue = async (): Promise<{ line: number; character: number }> => {
    const l = await atType();
    return { line: l.index, character: l.text.indexOf('type: ') + 'type: '.length };
  };

  // ---- the readings, each against the server's answer for the same Release ----

  // The Catalog panel: its Component heading, counting the rows under it, and the
  // document its first database row opens — read once the heading is the one the
  // answer gives, which is how a list read again after the selection moved is
  // waited for without pressing its refresh.
  //
  // 🔴 NOTHING IS CLOSED BETWEEN A MOVE OF THE SELECTION AND THIS READING WHERE THE
  // READING IS TO SHOW THE PANEL FOLLOWED THE MOVE. The editor closing a document
  // has the panel read its list again too, so a reading that closed the editors
  // first would see the list read in the new Release's terms whether or not the
  // move itself had it read — and a panel that does not follow the selection would
  // pass. Such a reading is taken with closeFirst false, after the editors were
  // closed and their reads had settled before the selection moved.
  //
  // The folder holds no link leading out of the workspace while these readings
  // are taken, so each also requires the answer to name none and the panel to
  // draw no row naming one.
  const catalogReading = async (release: Terms, closeFirst: boolean): Promise<Reading> => {
    const index = await answer('aggrega/catalogIndex', named({}, release)) as Partial<CatalogIndexDoc>;
    const components = (index.entities ?? []).filter((e) => e.kind === COMPONENTS);
    const heading = `${COMPONENTS} (${components.length})`;
    const firstDb = components.find((e) => e.name === MARIADB)?.file ?? '';
    if (closeFirst) { await closeAllEditors(ctx); }
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    const rows = await until(`the Catalog panel heading its Components "${heading}"`, 20000, () => treeRows(ctx.d, 'Catalog'), (v) => (v ?? []).some((r) => r.label === heading))
      .catch(() => treeRows(ctx.d, 'Catalog'));
    const drawn = (rows ?? []).find((r) => r.label.startsWith(`${COMPONENTS} (`))?.label ?? 'no Component heading';
    // Waited for as the document the answer names, since a reading taken with the
    // editors left open can find an earlier reading's variant still in front.
    await ctx.d.click(await revealTreeRow(ctx.d, 'Catalog', MARIADB));
    const active = await until(`the first ${MARIADB} row's document, ${firstDb}, opening`, 10000, () => ctx.probe.request<Active | null>('editor.active'), (v) => v !== null && path.relative(ctx.folder, v.path) === firstDb)
      .catch(() => ctx.probe.request<Active | null>('editor.active'));
    const opened = active ? path.relative(ctx.folder, active.path) : 'nothing';
    const linkRows = (rows ?? []).map((r) => r.label).filter(isLinksRow);
    const same = drawn === heading && opened === firstDb && namesNoLink(index) && linkRows.length === 0;
    return { release, same, seen: `the panel heads its Components "${drawn}" and its first ${MARIADB} row opens ${opened}; the answer lists ${components.length} (${components.map((e) => e.file).join(', ')}), its first ${MARIADB} in ${firstDb}; the answer names ${describeLinks(index)}, and the panel draws ${linkRows.length === 0 ? 'no row naming a link leading out' : `rows naming links leading out: ${JSON.stringify(linkRows)}`}` };
  };

  const definitionReading = async (release: Terms): Promise<Reading> => {
    const at = await inName();
    const ref = await answer('aggrega/resolve', named({ uri: refUri, position: at }, release), validatedFirst(release)) as { location?: { uri: string } | null };
    const want = ref.location ? relativeTo(reference, ref.location.uri) : 'no location';
    await open(ctx, aggregate);
    const locs = await run<Array<{ uri?: string; targetUri?: string }> | null>(ctx, 'vscode.executeDefinitionProvider', [{ $file: aggregate }, { $position: at }], 25000).catch(() => null);
    const got = (locs ?? []).map((l) => relativeTo(ctx.folder, l.uri ?? l.targetUri ?? ''));
    return { release, same: got.length === 1 && got[0] === want, seen: `go-to-definition opens ${JSON.stringify(got)}; the answer locates ${want}` };
  };

  const hoverReading = async (release: Terms): Promise<Reading> => {
    const at = await inName();
    const ref = await answer('aggrega/hover', named({ uri: refUri, position: at }, release), validatedFirst(release)) as { contents?: { value?: string } | null };
    const want = ref.contents?.value ?? '';
    need(want !== '', `the language server's own hover over ${MARIADB} in ${termsName(release)}'s terms is empty`);
    await open(ctx, aggregate);
    const hovers = await run<{ contents?: ({ value?: string } | string)[] }[] | null>(ctx, 'vscode.executeHoverProvider', [{ $file: aggregate }, { $position: at }], 25000).catch(() => null);
    const texts = (hovers ?? []).flatMap((h) => (h.contents ?? []).map((x) => (typeof x === 'string' ? x : x.value ?? '')));
    const same = texts.length === 1 && texts[0] === want;
    return { release, same, seen: `the hover ${same ? 'reads the answer' : `reads ${JSON.stringify(texts.map((t) => t.slice(-160)))}`}, whose excerpt ends ${JSON.stringify(want.slice(-160))}` };
  };

  const completionReading = async (release: Terms): Promise<Reading> => {
    const at = await atValue();
    const ref = await answer('aggrega/completion', named({ uri: refUri, position: at }, release), validatedFirst(release)) as { items?: { label: string }[] } | null;
    const want = (ref?.items ?? []).map((i) => i.label).sort();
    await open(ctx, aggregate);
    const list = await run<{ items?: { label: string | { label: string } }[] } | null>(ctx, 'vscode.executeCompletionItemProvider', [{ $file: aggregate }, { $position: at }], 25000).catch(() => null);
    const got = (list?.items ?? []).map((i) => (typeof i.label === 'string' ? i.label : i.label.label)).sort();
    return { release, same: JSON.stringify(got) === JSON.stringify(want), seen: `completion offers ${JSON.stringify(got)}; the answer offers ${JSON.stringify(want)}` };
  };

  // An inspection, from the Commands panel's Inspect or from the Catalog row's
  // own action, read as the new document it opens.
  const inspectionReading = async (release: Terms, from: 'commands' | 'row'): Promise<Reading> => {
    const ref = await answer('aggrega/entityDefinition', named({ name: MARIADB }, release));
    const want = JSON.stringify(ref, null, 2).split(reference).join(ctx.folder);
    await closeAllEditors(ctx);
    let how = '';
    if (from === 'commands') {
      await run(ctx, 'workbench.view.extension.aggrega');
      const panel = await commandsPanel(ctx.d);
      await pressOperation(ctx.d, panel, 'aggrega.op.inspect');
      const offered = await until(`the Inspect menu offering ${MARIADB}`, 20000, () => shownOptions(panel), (v) => v.includes(MARIADB));
      await ctx.d.type(MARIADB);
      const narrowed = await until(`the Inspect menu narrowed to ${MARIADB}`, 5000, () => shownOptions(panel), (v) => v.length > 0 && v.every((o) => o === MARIADB));
      await ctx.d.press('Enter');
      how = `the Commands panel's Inspect, its menu offering ${offered.length} entities and ${narrowed.length} ${MARIADB} once narrowed`;
    } else {
      await run(ctx, 'aggrega.workspaceCatalog.focus');
      await pressTreeRowAction(ctx.d, 'Catalog', MARIADB, inspectRow);
      how = `the Catalog row's "${inspectRow}"`;
    }
    const doc = await until('the definition opening as a new document', 20000, () => ctx.probe.request<Active | null>('editor.active'), (v) => v !== null && v.isUntitled === true)
      .catch(() => ctx.probe.request<Active | null>('editor.active'));
    const text = doc?.isUntitled ? doc.text ?? '' : null;
    if (doc?.isUntitled) { await run(ctx, 'workbench.action.revertAndCloseActiveEditor').catch(() => undefined); }
    const file = (JSON.parse(want) as { file?: string }).file ?? '';
    return { release, same: text === want, seen: `${how} opened ${text === null ? 'no new document' : text === want ? `the answer, resolving ${MARIADB} to ${file}` : `${JSON.stringify(text.slice(0, 200))} where the answer, resolving ${MARIADB} to ${file}, reads ${JSON.stringify(want.slice(0, 200))}`}` };
  };

  // The Catalog row's correctness check on the volume, read as the command line
  // the channel shows and the line the check closes on, against the compiler run
  // with the same path and the same Release over the reference copy.
  //
  // 🔴 THE ROW PRESSED IS ONE THE PANEL DREW FROM THE SELECTED RELEASE'S LIST, SO
  // IT IS PRESSED ONLY ONCE THE PANEL HEADS ITS COMPONENTS AS THAT LIST DOES. A
  // move of the selection has the panel read its list again, and the editor hands
  // a row's command the row by a handle composed from the labels above it — the
  // kind heading's included, which carries the count — so a row drawn from the
  // list read before the move, pressed after the new one has been read, reaches
  // the command as no row at all, and the press runs nothing.
  const rowCheckReading = async (release: Terms): Promise<Reading> => {
    const args = ['validate', SIZED_VOLUME.file, ...(release === null ? [] : ['--release', release])];
    const cli = await runCompiler(bin, args, { cwd: reference, home: ctx.home, boundMs: 120000, log: ctx.cliLog });
    const want = cli.status === 0 ? `${CHECK} checked ${SIZED_VOLUME.file}.` : `${CHECK} did not complete: the compiler exited with status ${cli.status}: ${cli.stderr.trim()}`;
    const index = await answer('aggrega/catalogIndex', named({}, release)) as Partial<CatalogIndexDoc>;
    const heading = `${COMPONENTS} (${(index.entities ?? []).filter((e) => e.kind === COMPONENTS).length})`;
    await closeAllEditors(ctx);
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    // A panel that never reads the selected Release's list fails the check here,
    // in the wait's own words: the row it would press is not that Release's.
    await until(`the Catalog panel heading its Components "${heading}", as the language server's own index in ${termsName(release)}'s terms does`, 20000, () => treeRows(ctx.d, 'Catalog'), (v) => (v ?? []).some((r) => r.label === heading));
    const menu = await rowMenu(ctx.d, 'Catalog', SIZED_VOLUME.name);
    need(menu.reached && menu.items.includes(validateItem), `the "${SIZED_VOLUME.name}" row's context menu offers no "${validateItem}" to press: ${describeRowMenu(menu)}`);
    const mark = ctx.out.mark();
    const taken = await pressMenuItem(ctx.d, validateItem);
    need(taken !== null, `the context menu draws no "${validateItem}" item to press`);
    const text = await ctx.out.waitFor('the check closing on the channel', mark, (t) => t.split('\n').some((l) => l.startsWith(`${CHECK} `)), 60000).catch(() => ctx.out.since(mark));
    const lines = text.split('\n');
    const command = (lines.find((l) => l.startsWith('$ ')) ?? '').replace(/\s+\(cwd: .*\)$/, '');
    const at = lines.findIndex((l) => l.startsWith(`${CHECK} `));
    const closing = at === -1 ? '' : lines.slice(at, at + want.split('\n').length).join('\n');
    const invoked = `$ ${bin} ${args.join(' ')}`;
    return { release, same: command === invoked && closing === want, seen: `the channel ran ${JSON.stringify(command)} and closed ${JSON.stringify(closing.slice(0, 300))}; the compiler outside the editor, run as ${JSON.stringify(args.join(' '))}, exited ${cli.status}` };
  };

  // ---- with no Release selected ----
  await c.run('no-release.each-surface-answers-in-the-workspaces-own-terms', {
    expected: `with the Release row reading "none selected", each surface reads the language server's own answer to the request naming no Release, over a copy of the folder: the Catalog panel's Component heading and the document its first ${MARIADB} row opens — that answer naming no link leading out of the workspace, and the panel drawing no row naming one — go-to-definition and hover at "${TYPE_LINE}" in aggregate.yaml, completion at that type, the Commands panel's Inspect of ${MARIADB}, and the Catalog row's check of ${SIZED_VOLUME.name}, run as \`aggrega validate ${SIZED_VOLUME.file}\` with no --release`,
    plant: 'in the scratch copy, out/src/release-terms.js with the composition naming release-compose.yaml where no Release is selected; or out/src/workspace-catalog-run.js with the index answer read as naming a link to a file it does not name',
  }, async () => {
    const rows = await selectorRows(await commandsPanel(ctx.d));
    const row = rows.find((r) => r.label === 'Release');
    need(row !== undefined && row.value === NONE_SELECTED, `the Release row reads ${JSON.stringify(row?.value ?? 'nothing')}, so the scenario does not start with no Release selected`);
    return verdict([
      await catalogReading(null, true),
      await definitionReading(null),
      await hoverReading(null),
      await completionReading(null),
      await inspectionReading(null, 'commands'),
      await rowCheckReading(null),
    ]);
  });

  // ---- each surface with each of two Releases selected ----
  const inEach = async (read: (release: string) => Promise<Reading>): Promise<{ passed: boolean; seen: string }> => {
    const readings: Reading[] = [];
    for (const release of READ_IN) {
      await selectRelease(ctx, release);
      readings.push(await read(release));
    }
    return verdict(readings);
  };

  await c.run('catalog-panel.lists-what-the-selected-release-reads-and-follows-the-selection', {
    expected: `with ${READ_IN.join(' and then ')} selected in turn on the Release row, the Catalog panel reads its list again with nothing pressed in it, and heads its Components with the count the language server's own catalog index names for that Release, its first ${MARIADB} row opening the document that answer names — that Release's own variant — and, that answer naming no link leading out of the workspace, draws no row naming one`,
    plant: 'in the scratch copy, out/src/extension.js with the catalog index asked with no Release, whichever is selected; or with the Catalog panel not read again when the selection moves; or out/src/workspace-catalog-run.js with the index answer read as naming a link to a file it does not name',
  }, async () => {
    // The editors are closed, and the reads their closing asks for given time to
    // land, before the selection first moves; nothing is closed after that.
    await closeAllEditors(ctx);
    await sleep(3000);
    return inEach((r) => catalogReading(r, false));
  });

  await c.run('go-to-definition.opens-the-selected-releases-variant', {
    expected: `with ${READ_IN.join(' and then ')} selected in turn, go-to-definition at "${TYPE_LINE}" in aggregate.yaml opens the one document the language server's own aggrega/resolve names for that Release — that Release's variant of ${MARIADB}`,
    plant: 'in the scratch copy, out/src/translator.js with go-to-definition composed with no Release',
  }, () => inEach((r) => definitionReading(r)));

  await c.run('hover.renders-the-selected-releases-variant', {
    expected: `with ${READ_IN.join(' and then ')} selected in turn, the hover at "${TYPE_LINE}" in aggregate.yaml is the one text the language server's own aggrega/hover answers for that Release, which renders that Release's variant: the two differ in the schema excerpt they show`,
    plant: 'in the scratch copy, out/src/translator.js with the hover composed with no Release',
  }, () => inEach((r) => hoverReading(r)));

  await c.run('completion.offers-what-the-selected-releases-catalog-declares', {
    expected: `with ${READ_IN.join(' and then ')} selected in turn, completion at the database's type in aggregate.yaml offers exactly the labels the language server's own aggrega/completion offers for that Release — ${CHART_ONLY.name}, which only ${CHART}'s catalog directory declares, among them in that Release's terms alone`,
    plant: 'in the scratch copy, out/src/translator.js with completion composed with no Release',
  }, () => inEach((r) => completionReading(r)));

  await c.run('inspect.resolves-in-the-selected-releases-terms', {
    expected: `with ${COMPOSE} selected, the Commands panel's Inspect of ${MARIADB}, and with ${CHART} selected, the Catalog row's "${inspectRow}" on it, each open as a new document the language server's own aggrega/entityDefinition answer for that name naming that Release, which resolves it to that Release's variant`,
    plant: 'in the scratch copy, out/src/extension.js with an inspection asked with no Release, whichever is selected',
  }, () => inEach((r) => inspectionReading(r, r === COMPOSE ? 'commands' : 'row')));

  await c.run('catalog-row.check-runs-in-the-selected-releases-terms', {
    expected: `the "${validateItem}" of the Catalog row ${SIZED_VOLUME.name} — a document under no catalog directory whose storage composes the ${SIZING_LIBRARY} library — runs \`aggrega validate ${SIZED_VOLUME.file} --release <the selected Release>\` and closes on the line the compiler's own run of that command over a copy of the folder gives: with ${SYNTH} selected the check passes, and with ${COMPOSE} selected it fails in the compiler's words, ${COMPOSE}'s catalog declaring no ${SIZING_LIBRARY}`,
    plant: 'in the scratch copy, out/src/catalog-entity-operations.js with the row\'s check composed with no --release',
  }, async () => {
    const readings: Reading[] = [];
    for (const release of [SYNTH, COMPOSE]) {
      await selectRelease(ctx, release);
      readings.push(await rowCheckReading(release));
    }
    return verdict(readings);
  });

  await c.run('may-attach.lists-the-selected-releases-features', {
    expected: `with ${GRAPH_RELEASE} selected and its graph shown, the list of what may attach to its ${DB_NODE} node draws, row for row, the language server's own aggrega/attachCandidates answer for that node of that Release's graph — each Feature declared in ${GRAPH_RELEASE}'s own catalog directory — and, the language server's own aggrega/catalogIndex answer in that Release's terms naming no link leading out of the workspace, no line naming one`,
    plant: 'in the scratch copy, out/src/attachment-edit.js with what may attach asked with no Release; or media/graph.js with the panel saying it listens before its listener is in place; or out/src/workspace-catalog-run.js with the index answer read as naming a link to a file it does not name',
  }, async () => {
    const ref = await answer('aggrega/attachCandidates', { graphNode: DB_NODE, release: GRAPH_RELEASE }) as Parameters<typeof drawnAsAnswered>[1];
    const index = await answer('aggrega/catalogIndex', named({}, GRAPH_RELEASE)) as Partial<CatalogIndexDoc>;
    await selectRelease(ctx, GRAPH_RELEASE);
    await closeAllEditors(ctx);
    const doc = await showGraph(ctx, DRAWN_MS);
    await pressNode(ctx, doc, DB_NODE);
    const p = await settledPanel(doc, DB_NODE, PENDING);
    const drawn = drawnAsAnswered(p, ref);
    const lines = p.candidates?.links ?? [];
    return {
      passed: drawn.same && namesNoLink(index) && lines.length === 0,
      seen: `${drawn.seen}${p.candidates?.failed ? `; the list reads "${p.candidates.failed}"` : ''}; the index answer names ${describeLinks(index)}, and the list draws ${lines.length === 0 ? 'no line naming a link leading out' : `lines naming links leading out: ${JSON.stringify(lines)}`}`,
    };
  });

  // ---- a link leading out of the workspace, placed in components/ ----

  // The link is placed once, by whichever of the two checks below runs first, and
  // the language server's own answer about it is asked over the folder the editor
  // reads, in the terms of the Release whose graph the second check draws. The
  // second takes it away again once it has read it, so the checks after it find
  // the folder without it.
  let placed: { link: string; rel: string } | null = null;
  const linkPlaced = (): { link: string; rel: string } => (placed ??= placeLinkLeadingOut(ctx.folder));
  const indexOverTheFolder = async (): Promise<Partial<CatalogIndexDoc>> => {
    const a = await referenceAnswer({ binary: bin, root: ctx.folder, method: 'aggrega/catalogIndex', params: { release: GRAPH_RELEASE }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(a.ok, `the language server gave no answer to aggrega/catalogIndex in ${GRAPH_RELEASE}'s terms over the folder: ${a.ok ? '' : a.error.message}`);
    return a.result as Partial<CatalogIndexDoc>;
  };
  const namesTheLinkAlone = (index: Partial<CatalogIndexDoc>, rel: string): boolean =>
    JSON.stringify(index.unreadLinkedDirs ?? null) === '[]' && JSON.stringify(index.unreadLinkedFiles ?? null) === JSON.stringify([rel]);

  await c.run('catalog-panel.names-the-link-leading-out-of-the-workspace', {
    expected: `with ${GRAPH_RELEASE} selected and ${LINK} placed as a link to a Feature document outside the workspace, the language server's own aggrega/catalogIndex answer over the folder in that Release's terms names that link alone, among the links to files and by its path relative to the folder, and lists nothing the document behind it declares; once the Catalog panel's refresh is pressed, the panel's last row — after its kind headings — is the extension's own row for exactly the links that answer names, drawn once, and no row names ${BEHIND_THE_LINK.name}`,
    plant: 'in the scratch copy, out/src/workspace-catalog-run.js with the row naming the links never drawn',
  }, async () => {
    // Selected before the link is placed: the Release chooser names a link like
    // this one too, and this check reads the Catalog panel, not the chooser.
    await selectRelease(ctx, GRAPH_RELEASE);
    const link = linkPlaced();
    const index = await indexOverTheFolder();
    const row = linksLeadingOutRow(index as CatalogIndexDoc);
    const listsNothingBehind = !(index.entities ?? []).some((e) => e.name === BEHIND_THE_LINK.name);
    await run(ctx, 'aggrega.workspaceCatalog.focus');
    await pressViewAction(ctx, 'Catalog', 'Refresh workspace catalog');
    const rows = (await until('the Catalog panel drawing the row naming the link', 20000, () => treeRows(ctx.d, 'Catalog'), (v) => row !== null && (v ?? []).some((r) => r.label === row.label))
      .catch(() => treeRows(ctx.d, 'Catalog'))) ?? [];
    const labels = rows.map((r) => r.label);
    const at = row === null ? -1 : labels.indexOf(row.label);
    const once = row !== null && labels.filter((l) => l === row.label).length === 1;
    const last = at >= 0 && at === labels.length - 1;
    const headings = labels.filter((l) => /^\S+ \(\d+\)$/.test(l));
    const rowForBehind = labels.includes(BEHIND_THE_LINK.name);
    return {
      passed: namesTheLinkAlone(index, link.rel) && listsNothingBehind && row !== null && once && last && headings.length > 0 && !rowForBehind,
      seen: `${link.link} reads the Feature outside through the link; the language server names ${describeLinks(index)} (the link placed is ${link.rel}) and lists ${listsNothingBehind ? 'nothing' : 'an entity'} behind it; the panel's rows ${JSON.stringify(labels)}${row === null ? '; the answer yields no row to look for' : `; the row ${JSON.stringify(row.label)} ${at < 0 ? 'not drawn' : `drawn at ${at} of ${labels.length}, level ${rows[at].level}`}`}${rowForBehind ? `; a row names ${BEHIND_THE_LINK.name}` : ''}`,
    };
  });

  await c.run('may-attach.names-the-link-leading-out-of-the-workspace', {
    expected: `with ${LINK} in place and ${GRAPH_RELEASE}'s graph shown, pressing its ${DB_NODE} node draws, under the list of what may attach, once, the extension's own line for exactly the links the language server's own aggrega/catalogIndex answer over the folder in that Release's terms names — that link alone; the list's rows are still the language server's own aggrega/attachCandidates answer for that node over the folder, row for row, and none names ${BEHIND_THE_LINK.name}`,
    plant: 'in the scratch copy, out/src/attach-candidates.js with the line naming the links never posted',
  }, async () => {
    try {
      const link = linkPlaced();
      const index = await indexOverTheFolder();
      const line = featuresNotOfferedLine(index as CatalogIndexDoc);
      const a = await referenceAnswer({ binary: bin, root: ctx.folder, method: 'aggrega/attachCandidates', params: { graphNode: DB_NODE, release: GRAPH_RELEASE }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
      need(a.ok, `the language server gave no answer about what may attach to ${DB_NODE} over the folder: ${a.ok ? '' : a.error.message}`);
      await closeAllEditors(ctx);
      const doc = await showGraph(ctx, DRAWN_MS);
      await pressNode(ctx, doc, DB_NODE);
      const p = await settledPanel(doc, DB_NODE, PENDING);
      const drawn = drawnAsAnswered(p, a.result as Parameters<typeof drawnAsAnswered>[1]);
      const lines = p.candidates?.links ?? [];
      const offeredBehind = (p.candidates?.rows ?? []).some((r) => r.name === BEHIND_THE_LINK.name);
      return {
        passed: namesTheLinkAlone(index, link.rel) && line !== null && lines.length === 1 && lines[0] === line && drawn.same && !offeredBehind,
        seen: `the language server names ${describeLinks(index)} (the link placed is ${link.rel}); the line ${line === null ? 'the answer yields none' : JSON.stringify(line)}; the list draws ${lines.length === 0 ? 'no line naming a link' : `the lines ${JSON.stringify(lines)}`}; ${drawn.seen}${offeredBehind ? `; a row names ${BEHIND_THE_LINK.name}` : ''}`,
      };
    } finally {
      if (placed !== null) {
        try { fs.unlinkSync(placed.link); } catch { /* already gone */ }
        placed = null;
      }
    }
  });

  // ---- a path of the folder replaced by a link leading out of the workspace ----

  // releaseRow is the value the Commands panel's Release row reads.
  const releaseRow = async (): Promise<string> => (await selectorRows(await commandsPanel(ctx.d))).find((r) => r.label === 'Release')?.value ?? '';

  // inRelease runs `body` with `release` selected, and selects again the Release it
  // found selected once the body is done — after the body has put the folder back,
  // so a Release the body replaced by a link is on offer again by then.
  const inRelease = async <T>(release: string, body: () => Promise<T>): Promise<T> => {
    const found = await releaseRow();
    if (found !== release) { await selectRelease(ctx, release); }
    try {
      return await body();
    } finally {
      if (found !== release && found !== '' && found !== NONE_SELECTED) { await selectRelease(ctx, found).catch(() => undefined); }
    }
  };

  // filedFor reads the entries a document carries once one carries `words`, or as
  // they stand when the wait runs out, and every other document carrying those
  // words.
  const filedFor = async (doc: string, words: string): Promise<{ all: DiagnosticEntry[]; on: DiagnosticEntry[]; elsewhere: string[] }> => {
    const all = await until(`the refusal filed on ${path.basename(doc)}`, 20000, () => diagnostics(ctx, doc), (v) => v.some((d) => d.message === words)).catch(() => diagnostics(ctx, doc));
    const listed = await ctx.probe.request<{ path: string; diagnostics: DiagnosticEntry[] }[]>('diagnostics.list');
    return {
      all,
      on: all.filter((d) => d.message === words),
      elsewhere: listed.filter((e) => e.path !== doc && e.diagnostics.some((d) => d.message === words)).map((e) => e.path),
    };
  };

  // stillFiled reads whether `doc` still carries an entry in `words`: a refusal
  // stays filed on its Release until a build, a preview or a graph of it is
  // answered without it, so a check that leaves one standing answers it once more
  // after taking its link away.
  const stillFiled = async (doc: string, words: string): Promise<boolean> =>
    words !== '' && (await diagnostics(ctx, doc).catch(() => [] as DiagnosticEntry[])).some((d) => d.message === words);

  const composeRelease = path.join(ctx.folder, COMPOSE);

  await c.run('build.refused-for-an-output-directory-leading-out-in-the-compilers-words', {
    expected: `with ${COMPOSE} selected and dist/ replaced by a link to a directory outside the workspace holding one file, Build pressed on the Commands panel is refused: the Problems panel carries one entry in the words of the language server's own refusal of the same build request over the folder — on ${COMPOSE}, at its head, an Error under "aggrega", its code the short code that refusal's data names for its condition — and those words on no other document; the output channel's closing line reads "${BUILD_REFUSED}" followed by those words, and an error notification draws that line as the editor draws a message — its first ${NOTIFICATION_MESSAGE_CAP} characters followed by "..." where it is longer; and the directory the link leads to holds the same files with the same bytes before and after`,
    plant: 'in the scratch copy, out/src/operation-refusals.js with a refused build, preview or graph filing nothing in the Problems panel; or out/src/error-surfaces.js with a refusal filed as an entry carrying none of the identifiers its data names',
  }, () => inRelease(COMPOSE, async () => {
    const outside = outsideTheWorkspace(ctx.folder, 'build-output');
    fs.mkdirSync(path.join(outside, 'app'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'app', 'kept.txt'), KEPT_OUTSIDE);
    const away = linkAway(ctx.folder, 'dist', outside);
    let words = '';
    try {
      const before = readTree(outside);
      // The request as the editor sends it from a window whose one folder is the
      // workspace root: no option turned on, and the root as where it writes.
      const ref = await referenceAnswer({ binary: bin, root: ctx.folder, method: 'aggrega/build', params: buildParams(COMPOSE, [], ''), home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
      need(!ref.ok, `the language server built ${COMPOSE} over the folder with dist/ leading out of the workspace, so there is no refusal to carry`);
      need(ref.error.message.includes(away.link), `the language server's refusal of the build does not name ${away.link}: ${ref.error.message.slice(0, 300)}`);
      need(!namesADocument(ref.error.data), `the language server's refusal names a document of its own, ${JSON.stringify(ref.error.data)}, so it is not about the Release this check reads`);
      const shortCode = shortCodeOf(ref.error.data);
      need(shortCode !== null, `the language server's refusal of the build names no condition in its data, ${JSON.stringify(ref.error.data)}, so there is no short code for the entry to carry`);
      words = ref.error.message;
      const want = `${BUILD_REFUSED}${words}`;
      await closeAllEditors(ctx);
      const mark = ctx.out.mark();
      const toastMark = (await toasts(ctx.d)).length;
      await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.build');
      const text = await ctx.out.waitFor('the build ending', mark, (t) => t.split('\n').some(isBuildEnding), 180000).catch(() => ctx.out.since(mark));
      const closing = text.split('\n').find(isBuildEnding) ?? '';
      const told = await waitToast(ctx.d, 'the refused build\'s notification', toastMark, (t) => t.message.startsWith(BUILD_REFUSED), 10000).catch(() => null);
      const filed = await filedFor(composeRelease, words);
      const faults = refusalFaults(filed.on, filed.elsewhere, shortCode);
      const kept = untouched(before, outside);
      return {
        passed: faults.length === 0 && closing === want && told !== null && told.severity === 'error' && drawnAsNotified(told.message, want) && kept.same,
        seen: `the language server refused the build, its data naming ${shortCode}, "${words.slice(0, 240)}"; the channel closed ${closing === want ? 'on that refusal in its words' : JSON.stringify(closing.slice(0, 300))}; the notification ${told === null ? 'none opening that way' : `${drawnAsNotified(told.message, want) ? 'draws it as the editor draws the line' : JSON.stringify(told.message.slice(-200))} (${told.severity})`}; ${describeDiagnostics(composeRelease, filed.all)}${faults.length === 0 ? '' : ` — ${faults.join('; ')}`}; ${kept.seen}`,
        evidence: { want, closing, told },
      };
    } finally {
      putBackLinked(away);
      if (await stillFiled(composeRelease, words)) {
        try {
          await closeAllEditors(ctx);
          const mark = ctx.out.mark();
          await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.build');
          await ctx.out.waitFor('the build of the folder as found', mark, (t) => t.split('\n').some(isBuildEnding), 180000);
        } catch { /* the entry stays; the checks after this one read no entry on the Release but their own */ }
        // What that build wrote is taken away again where the folder held no dist/.
        if (away.setAside === null) { fs.rmSync(path.join(ctx.folder, 'dist'), { recursive: true, force: true }); }
      }
    }
  }));

  await c.run('pull.refused-for-a-lockfile-leading-out-in-the-compilers-words', {
    expected: `with ${COMPOSE} selected and its lockfile replaced by a link to a copy outside the workspace, Pull pressed on the Commands panel runs \`aggrega pull --release ${COMPOSE}\` in the folder, and its closing lines on the output channel read "${PULL_REFUSED}the compiler exited with status <n>: " followed by <words>, <n> and <words> being the exit status and the standard error — with the blank lines around it dropped and nothing else — of the compiler's own run of that command over the folder in the same state, which name the lockfile; an error notification draws those lines as the editor draws a message — each run of blank space read as one, its first ${NOTIFICATION_MESSAGE_CAP} characters followed by "..." where it is longer; and the copy the link leads to keeps its bytes`,
    plant: 'in the scratch copy, out/src/cli-run.js with a refused run reported by its exit status alone',
  }, () => inRelease(COMPOSE, async () => {
    const lockName = COMPOSE.replace(/\.ya?ml$/, '.lock');
    const lock = path.join(ctx.folder, lockName);
    need(fs.existsSync(lock), `the folder holds no ${lockName} to replace by a link`);
    const outside = outsideTheWorkspace(ctx.folder, 'lockfile');
    fs.mkdirSync(outside, { recursive: true });
    fs.copyFileSync(lock, path.join(outside, lockName));
    const away = linkAway(ctx.folder, lockName, path.join(outside, lockName));
    try {
      const before = readTree(outside);
      const args = ['pull', '--release', COMPOSE];
      const cli = await runCompiler(bin, args, { cwd: ctx.folder, home: ctx.home, boundMs: 120000, log: ctx.cliLog });
      const words = stderrWords(cli.stderr);
      need(cli.status !== 0 && words.includes(lock), `the compiler's own pull over the folder was not refused for ${lockName}: exit ${cli.status ?? cli.signal}, standard error ${JSON.stringify(cli.stderr.slice(0, 300))}`);
      const want = `${PULL_REFUSED}the compiler exited with status ${cli.status}: ${words}`;
      await closeAllEditors(ctx);
      const mark = ctx.out.mark();
      const toastMark = (await toasts(ctx.d)).length;
      await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.pull');
      const text = await ctx.out.waitFor('the pull ending', mark, (t) => /^The pull (resolved|did not complete)/m.test(t), 120000).catch(() => ctx.out.since(mark));
      const lines = text.split('\n');
      const command = (lines.find((l) => l.startsWith('$ ')) ?? '').replace(/\s+\(cwd: .*\)$/, '');
      const invoked = `$ ${bin} ${args.join(' ')}`;
      const at = lines.findIndex((l) => l.startsWith('The pull '));
      const closing = at === -1 ? '' : lines.slice(at, at + want.split('\n').length).join('\n');
      const told = await waitToast(ctx.d, 'the refused pull\'s notification', toastMark, (t) => t.message.startsWith(PULL_REFUSED), 30000).catch(() => null);
      const kept = untouched(before, outside);
      return {
        passed: command === invoked && closing === want && told !== null && told.severity === 'error' && drawnAsNotified(told.message, want) && kept.same,
        seen: `the channel ran ${JSON.stringify(command)} and closed ${closing === want ? 'on the compiler\'s words, line for line' : JSON.stringify(closing.slice(0, 400))}; the notification ${told === null ? 'none opening that way' : `${drawnAsNotified(told.message, want) ? 'draws them as the editor draws the lines' : JSON.stringify(told.message.slice(-200))} (${told.severity})`}; the compiler outside the editor exited ${cli.status}: ${JSON.stringify(words.slice(0, 300))}; ${kept.seen}`,
        evidence: { want, closing, told },
      };
    } finally {
      putBackLinked(away);
    }
  }));

  await c.run('catalog-panel.refused-list-shows-the-language-servers-words', {
    expected: `with ${UNMAPPED_RELEASE} selected and then replaced by a link to a copy of itself outside the workspace — the Release row still naming it, read over 3 s — the Catalog panel's refresh draws in place of its list the row "${FAILURE_LABEL}", whose hover reads the language server's own refusal of the entity index asked in that Release's terms over the folder, and the output channel carries the same words as a line of their own; the copy the link leads to keeps its bytes`,
    plant: 'in the scratch copy, out/src/workspace-catalog-run.js with a refused list read rendered as the thrown value made a string, which reads "[object Object]" for a refusal the language server answered',
  }, () => inRelease(UNMAPPED_RELEASE, async () => {
    const outside = outsideTheWorkspace(ctx.folder, 'release-copy');
    fs.mkdirSync(outside, { recursive: true });
    fs.copyFileSync(path.join(ctx.folder, UNMAPPED_RELEASE), path.join(outside, UNMAPPED_RELEASE));
    const away = linkAway(ctx.folder, UNMAPPED_RELEASE, path.join(outside, UNMAPPED_RELEASE));
    try {
      const before = readTree(outside);
      // A remembered selection is checked against what is on offer once per
      // connection, so one replaced by a link while the session runs is expected
      // to stand; that it does is read first, because a list read in another
      // Release's terms would show nothing of this refusal.
      const stood = await holds(3000, releaseRow, (v) => v === UNMAPPED_RELEASE);
      need(stood.held, `the Release row stopped naming ${UNMAPPED_RELEASE} once it was replaced by a link, reading ${JSON.stringify(stood.broke ?? '')}, so the panel's list is not read in that Release's terms`);
      const ref = await referenceAnswer({ binary: bin, root: ctx.folder, method: 'aggrega/catalogIndex', params: { release: UNMAPPED_RELEASE }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
      need(!ref.ok, `the language server listed the entities in the terms of ${UNMAPPED_RELEASE} through its link, so there is no refusal to carry`);
      const words = ref.error.message;
      need(words.includes(UNMAPPED_RELEASE), `the language server's refusal of the list does not name ${UNMAPPED_RELEASE}: ${words.slice(0, 300)}`);
      const mark = ctx.out.mark();
      await run(ctx, 'aggrega.workspaceCatalog.focus');
      await pressViewAction(ctx, 'Catalog', 'Refresh workspace catalog');
      const rows = (await until('the Catalog panel drawing its failure row', 20000, () => treeRows(ctx.d, 'Catalog'), (v) => (v ?? []).some((r) => r.label === FAILURE_LABEL))
        .catch(() => treeRows(ctx.d, 'Catalog'))) ?? [];
      const drawn = rows.some((r) => r.label === FAILURE_LABEL);
      const hover = drawn ? await hoverAt(ctx.d, await revealTreeRow(ctx.d, 'Catalog', FAILURE_LABEL)) : '';
      const channel = await ctx.out.waitFor('the refusal on the channel', mark, (t) => t.split('\n').includes(words), 10000).then(() => true, () => false);
      const kept = untouched(before, outside);
      return {
        passed: drawn && flat(hover) === flat(words) && channel && kept.same,
        seen: `the language server refused the list "${words.slice(0, 240)}"; the panel's rows ${JSON.stringify(rows.map((r) => r.label))}; the failure row's hover ${JSON.stringify(hover.slice(0, 300))}; the channel ${channel ? 'carries the refusal as a line of its own' : 'does not carry the refusal as a line of its own'}; ${kept.seen}`,
      };
    } finally {
      putBackLinked(away);
    }
  }));

  // ---- a link leading out beneath the catalog directory a Release reads ----

  // 🔴 THE LAST TWO CHECKS SHARE ONE LINK, AND RUN IN THIS ORDER ON PURPOSE. The
  // validation's finding and the graph's refusal are two surfaces of the same
  // halt — a compile of the Release meeting the link — so the second reads the
  // link the first placed, and takes it away. A run that reaches the second alone
  // places it there.
  let catalogLink: LinkedAway | null = null;
  const catalogLinkPlaced = (): LinkedAway => {
    if (catalogLink === null) {
      const outside = outsideTheWorkspace(ctx.folder, 'catalog-link');
      fs.mkdirSync(outside, { recursive: true });
      fs.writeFileSync(path.join(outside, BEHIND_THE_CATALOG_LINK.file), BEHIND_THE_CATALOG_LINK_DOCUMENT);
      need(fs.existsSync(path.join(ctx.folder, path.dirname(CATALOG_LINK))), `the folder holds no ${path.dirname(CATALOG_LINK)} directory to place the link in`);
      catalogLink = linkAway(ctx.folder, CATALOG_LINK, path.join(outside, BEHIND_THE_CATALOG_LINK.file));
    }
    return catalogLink;
  };

  await c.run('validation.finding-for-a-catalog-file-leading-out-is-the-language-servers-own', {
    expected: `with ${COMPOSE} selected and ${CATALOG_LINK} placed as a link to a Feature document outside the workspace, Validate pressed on the Commands panel with aggregate.yaml in front ends, and aggregate.yaml then carries, under each layer the language server's own aggrega/validate answer for it in that Release's terms over the folder names, exactly the findings that answer gives — one of them naming the link — each at its position, an Error, in its words, with its short code leading to the address the answer names; and the directory the link leads to keeps its files and bytes`,
    plant: 'in the scratch copy, out/src/diagnostics-shape.js with a finding\'s message cut at its first sentence',
  }, () => inRelease(COMPOSE, async () => {
    await closeAllEditors(ctx);
    const placed = catalogLinkPlaced();
    const outside = path.dirname(placed.target);
    const before = readTree(outside);
    const ref = await referenceAnswer({ binary: bin, root: ctx.folder, method: 'aggrega/validate', params: buildValidateParams(aggregate, fs.readFileSync(aggregate, 'utf8'), COMPOSE), home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(ref.ok, `the language server gave no answer to the validation of aggregate.yaml over the folder: ${ref.ok ? '' : ref.error.message}`);
    const want = (ref.result as ValidateResponse).diagnostics ?? [];
    need(want.some((d) => d.message.includes(placed.link)), `the language server's own validation of aggregate.yaml names no finding about ${CATALOG_LINK}: ${JSON.stringify(want).slice(0, 400)}`);
    const layers = new Set(want.map((d) => d.source));
    const read = async (): Promise<DiagnosticEntry[]> => (await diagnostics(ctx, aggregate)).filter((d) => d.source !== null && layers.has(d.source));
    // Validated as a reader asks for it. The editor validates a document of its own
    // accord as it opens, and a document an earlier check opened can still be held
    // by the editor with its tab closed, so opening it again need not be an opening.
    await open(ctx, aggregate);
    const mark = ctx.out.mark();
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.validate');
    const ending = await ctx.out.waitFor('the validation ending', mark, (t) => /^(Aggrega: validated aggregate\.yaml|The validation )/m.test(t), 60000)
      .then((t) => t.split('\n').find((l) => l.startsWith('Aggrega: validated') || l.startsWith('The validation ')) ?? '', () => '');
    need(ending.startsWith('Aggrega: validated'), `Validate pressed with aggregate.yaml in front did not end in a validation: ${ending === '' ? 'no ending on the channel' : JSON.stringify(ending)}`);
    const filed = await until('the findings filed on aggregate.yaml', 20000, read, (v) => want.every((w) => v.some((d) => d.message === w.message))).catch(read);
    const faults = filed.length === want.length ? [] : [`aggregate.yaml carries ${filed.length} entries under ${JSON.stringify([...layers])}, the answer ${want.length}`];
    for (const w of want) {
      const d = filed.find((x) => x.message === w.message);
      faults.push(...(d === undefined ? [`no entry reads ${JSON.stringify(w.message.slice(0, 200))}`] : publishedFaults(d, w)));
    }
    const kept = untouched(before, outside);
    return {
      passed: faults.length === 0 && kept.same,
      seen: `the language server answers ${JSON.stringify(want.map((w) => `${w.line}:${w.column} [${w.source} ${w.shortCode ?? ''}] ${w.message.slice(0, 200)}`))}; Validate ended ${JSON.stringify(ending)}; ${describeDiagnostics(aggregate, filed)}${faults.length === 0 ? '' : ` — ${faults.join('; ')}`}; ${kept.seen}`,
    };
  }));

  await c.run('graph.refused-for-a-catalog-file-leading-out-in-the-compilers-words', {
    expected: `with ${CATALOG_LINK} still in place from the check before and ${COMPOSE} selected, Graph pressed on the Commands panel with no graph panel open opens a panel that draws no card and names "${graphCouldNotBeDrawn(COMPOSE, '<message>')}", the output channel carries the same line, and the Problems panel carries one entry in <message> — on ${COMPOSE}, at its head, an Error under "aggrega", its code the short code that refusal's data names, none where it names none — and <message> on no other document, <message> being the language server's own refusal of the same graph request over the folder; and the directory the link leads to keeps its files and bytes`,
    plant: 'in the scratch copy, out/src/graph-failure.js with the line for a drawing that could not be made leaving out the compiler\'s words',
  }, () => inRelease(COMPOSE, async () => {
    const placed = catalogLinkPlaced();
    const outside = path.dirname(placed.target);
    let words = '';
    try {
      const before = readTree(outside);
      const ref = await referenceAnswer({ binary: bin, root: ctx.folder, method: 'aggrega/irGraph', params: { release: COMPOSE }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
      need(!ref.ok, `the language server drew ${COMPOSE} over the folder with ${CATALOG_LINK} leading out of the workspace, so there is no refusal to carry`);
      need(ref.error.message.includes(placed.link), `the language server's refusal of the graph does not name ${placed.link}: ${ref.error.message.slice(0, 300)}`);
      need(!namesADocument(ref.error.data), `the language server's refusal names a document of its own, ${JSON.stringify(ref.error.data)}, so it is not about the Release this check reads`);
      words = ref.error.message;
      const line = graphCouldNotBeDrawn(COMPOSE, words);
      // A panel holding a drawing words a failure as that drawing gone out of date,
      // so the press is made with none open and the panel it opens is read.
      await closeAllEditors(ctx);
      need(await findGraphPanel(ctx) === null, 'a graph panel is open with every editor closed, so the panel read would not be the one the press opens');
      const mark = ctx.out.mark();
      await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.graph.show');
      const panel = await until('the graph panel opening', 30000, () => findGraphPanel(ctx), (x) => x !== null) as WebviewDocument;
      await watchNotice(panel);
      const ended = (x: NoticeReading): boolean => x.nodes > 0 || (x.text !== '' && x.text !== GRAPH_PANEL_OPENING && !x.text.startsWith('Laying out '));
      await until('the graph panel ending the press', 60000, () => noticeReadings(panel), (v) => v.some(ended)).catch(() => undefined);
      const notices = await noticeReadings(panel);
      const panelNamed = notices.some((x) => x.text === line);
      const drewNothing = notices.every((x) => x.nodes === 0);
      const channel = await ctx.out.waitFor('the refusal on the channel', mark, (t) => t.split('\n').includes(line), 10000).then(() => true, () => false);
      const filed = await filedFor(composeRelease, words);
      const shortCode = shortCodeOf(ref.error.data);
      const faults = refusalFaults(filed.on, filed.elsewhere, shortCode);
      const kept = untouched(before, outside);
      return {
        passed: panelNamed && drewNothing && channel && faults.length === 0 && kept.same,
        seen: `the language server refused the graph, its data naming ${shortCode ?? 'no condition'}, "${words.slice(0, 240)}"; the panel ${panelNamed ? 'names the refusal in the line the extension composes' : `read ${JSON.stringify(notices.filter((x) => x.text !== '').map((x) => x.text.slice(0, 300)))}`}, ${drewNothing ? 'drawing no card' : 'drawing cards'}; the channel ${channel ? 'carries the same line' : 'does not carry the line'}; ${describeDiagnostics(composeRelease, filed.all)}${faults.length === 0 ? '' : ` — ${faults.join('; ')}`}; ${kept.seen}`,
      };
    } finally {
      putBackLinked(placed);
      catalogLink = null;
      await closeAllEditors(ctx).catch(() => undefined);
      if (await stillFiled(composeRelease, words)) {
        await showGraph(ctx, DRAWN_MS).catch(() => undefined);
        await closeAllEditors(ctx).catch(() => undefined);
      }
    }
  }));
}
