// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Checks } from './checks';
import { runCompiler } from './cli';
import { Box } from './drivers';
import { createScenarioRoot, ScenarioRoot, scratchHomeOf } from './editor';
import { pressNode, putAwayNotifications, showGraph, graphState } from './graph-panel';
import { catalogGiven, Inputs } from './inputs';
import { bringUp, tearDown } from './scenario';
import { closeAllEditors, makeContext, open, ready, run, send, SuiteContext } from './suite-context';
import { openMenuOf } from './commands-panel';
import {
  commandsPanel, drawnTreeRows, paneByTitle, paneState, pickQuickInputRow, pressPaneHeader, quickInput, quietReading, sleep, stated, toasts, until, waitQuickInput, waitStatus, waitToast, NOT_RUNNING,
} from './workbench';
import { clearForCapture, describeSteps, frontPage, pageNow, PageSeen, pressCaret, registerWithNoTrust, welcomePage } from './welcome';

// The screenshots the documentation shows of the editor, taken from the real
// editor by driving it the way a reader does.
//
// 🔴 EVERY FRAME IS DRAWN BY THE EDITOR AND THE EXTENSION AS THEY ARE, AND NONE
// IS STAGED. A frame is taken once the editor has reached the state its name
// says — the welcome page with every step met, the import's own ending — read
// from what the editor draws, and a state the editor does not reach is reported
// as a frame not taken, with why, rather than taken anyway.
//
// 🔴 NO FRAME SHOWS A PATH OF THE MACHINE IT WAS TAKEN ON. Every folder the
// editor opens, its home directory, its profile and the compiler it runs sit
// under the scratch directory, which is meant to be a neutral path such as
// /tmp/aggrega-screens; and before each frame is written, the text the window
// draws is read for the home directory of whoever runs this and for the
// checkouts it reads from, and a frame drawing either is refused.

// WINDOW is the size of every frame: the editor's window, drawn whole.
export const WINDOW = { width: 1280, height: 800 };

// GROUPS are the sets of frames, each written under a directory of its own.
export const GROUPS = ['manual', 'quickstart', 'import'] as const;
export type Group = (typeof GROUPS)[number];

// importFormats are the formats the documentation has an import page for, read
// from the checkout: each page at authoring/import/<format>.md, other than the
// section's README, with its example at language-reference/examples/import-<format>/.
// A page added there gets its frames, or a frame not taken saying why, with
// nothing to list here.
function importFormats(docs: string): string[] {
  return fs.readdirSync(path.join(docs, 'authoring', 'import'))
    .filter((n) => n.endsWith('.md') && n !== 'README.md')
    .map((n) => n.slice(0, -'.md'.length))
    .sort();
}

// quickstartSteps are the quickstarts' steps, read from the checkout: each
// directory language-reference/examples/quickstart-<track>/<step>/ whose name is a
// number, tracks by name and steps in number order.
function quickstartSteps(docs: string): { track: string; step: number }[] {
  const examples = path.join(docs, 'language-reference', 'examples');
  const steps: { track: string; step: number }[] = [];
  for (const dir of fs.readdirSync(examples, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith('quickstart-')).map((e) => e.name).sort()) {
    const numbered = fs.readdirSync(path.join(examples, dir), { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d+$/.test(e.name)).map((e) => Number(e.name)).sort((a, b) => a - b);
    for (const step of numbered) { steps.push({ track: dir.slice('quickstart-'.length), step }); }
  }
  return steps;
}

// EXAMPLES_REGISTRY is the registry the documentation's examples name as their
// default.
const EXAMPLES_REGISTRY = 'hub.aggrega.ai';

// CaptureOptions is what one capture run is handed.
export interface CaptureOptions {
  inputs: Inputs;
  // scratch is the neutral directory every folder, home and profile goes under.
  scratch: string;
  // out is where the frames are written, one directory per group.
  out: string;
  // docs is the documentation checkout the examples and pages are read from.
  docs: string;
  groups: readonly Group[];
  // importerCatalog is a catalog folder holding the importers at the compiler's
  // own version, for a compiler built between releases, whose importers no
  // registry holds; the import frames read the importers from a copy of it, ahead
  // of the standard catalog.
  importerCatalog?: string;
  // pageQuotes is the file naming what each import page quotes (PageQuotes),
  // which the import frames need.
  pageQuotes?: string;
  // dockerConfig is a Docker configuration directory a registry credential is read
  // from, handed on as DOCKER_CONFIG to every compiler run and every editor the
  // capture starts. It is a path only: nothing here opens it.
  dockerConfig?: string;
}

// Where the catalog is given (inputs.catalog), every editor and every compiler run
// reads the standard-library catalog from a copy of what its commit holds, laid
// out under the scratch directory, rather than from the registry the examples
// name: for a machine that registry does not serve, and so that a frame showing
// where an entity was read from shows a path under the scratch directory.

// Frame is one frame the run set out to take: where it went, and how it ended.
export interface Frame {
  file: string;
  what: string;
  written: boolean;
  bytes?: number;
  // how says where a frame's folder came from, where that is a choice the run made.
  how?: string;
  error?: string;
}

// CaptureReport is what a capture run took.
export interface CaptureReport {
  frames: Frame[];
  elapsedMs: number;
}

interface Run {
  opts: CaptureOptions;
  profiles: string;
  frames: Frame[];
  forbidden: string[];
  log: string;
  // catalogDirs is the standard catalog's copy, or empty where no catalog was
  // given; importerDir is the importer catalog's copy, or empty where none was.
  catalogDirs: string;
  importerDir: string;
}

// captureDocs takes every frame of the groups asked for.
export async function captureDocs(opts: CaptureOptions): Promise<CaptureReport> {
  const t0 = Date.now();
  const profiles = path.join(opts.scratch, 'editors');
  fs.mkdirSync(profiles, { recursive: true });
  fs.mkdirSync(opts.out, { recursive: true });
  let catalogDirs = '';
  if (catalogGiven(opts.inputs)) {
    catalogDirs = path.join(opts.scratch, 'catalog');
    committedCopy(opts.inputs.catalog.dir, catalogDirs);
  }
  let importerDir = '';
  if (opts.importerCatalog !== undefined) {
    importerDir = path.join(opts.scratch, 'importers');
    fs.cpSync(opts.importerCatalog, importerDir, { recursive: true });
  }
  const r: Run = { opts, profiles, frames: [], forbidden: forbiddenText(opts), log: path.join(opts.scratch, 'compiler.log'), catalogDirs, importerDir };
  if (opts.groups.includes('manual')) { await manualFrames(r); }
  if (opts.groups.includes('quickstart')) { await quickstartFrames(r); }
  if (opts.groups.includes('import')) { await importFrames(r); }
  return { frames: r.frames, elapsedMs: Date.now() - t0 };
}

// forbiddenText is what no frame may draw: the home directory of whoever runs the
// capture, the checkouts it reads, which sit beside the extension's, and the
// Docker configuration directory a credential is read from, where one is given —
// a compiler's message about a credential it could not read may name it, and a
// frame drawing that message is not taken.
function forbiddenText(opts: CaptureOptions): string[] {
  const words = [os.homedir(), path.dirname(opts.inputs.extension.dir), opts.docs, opts.dockerConfig ?? ''];
  return [...new Set(words.filter((w) => w.length > 1 && !opts.scratch.startsWith(w)))];
}

// ---- one editor, one folder -------------------------------------------------------

interface EditorOptions {
  settings?: Record<string, unknown>;
  environment?: Record<string, string>;
  // prepare runs before the editor starts, with the home its compiler runs see.
  prepare?: (root: ScenarioRoot) => Promise<void>;
  afterProfile?: (root: ScenarioRoot) => void;
}

// withEditor opens `folder` in an editor of its own and runs `body` against it,
// then closes it, stopping everything it started. A body that throws has taken
// no frame past the one it was taking.
async function withEditor(r: Run, name: string, folder: string, eo: EditorOptions, body: (ctx: SuiteContext) => Promise<void>): Promise<void> {
  const root = createScenarioRoot(r.profiles, name);
  if (eo.prepare) { await eo.prepare(root); }
  const s = await bringUp(name, r.opts.inputs, r.profiles, 'playwright-devtools', {
    root, folder, screen: WINDOW, installed: true, settings: eo.settings, environment: eo.environment ?? captureEnvironment(r, 'standard'), afterProfile: eo.afterProfile,
  });
  try {
    await body(makeContext(s, r.opts.inputs, new Checks(name)));
  } finally {
    await tearDown(s);
  }
}

// takeFrame writes one frame, or records why it was not taken. `take` brings the
// editor to the state the frame shows and answers with the part of the window to
// keep, or with nothing for the whole window.
async function takeFrame(r: Run, ctx: SuiteContext | null, file: string, what: string, take: () => Promise<Box | void>, how?: string): Promise<boolean> {
  const out = path.join(r.opts.out, file);
  try {
    if (ctx === null) { throw new Error('the editor this frame is taken in did not start'); }
    const clip = await take();
    const leak = await drawnLeak(ctx, r.forbidden);
    if (leak !== null) { throw new Error(`the window draws ${leak}, a path of the machine the capture runs on`); }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const bytes = await ctx.d.screenshot(out, clip ? clipToWindow(clip) : undefined);
    r.frames.push({ file, what, written: true, bytes, how });
    process.stdout.write(`  wrote ${file} (${bytes} bytes)\n`);
    return true;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    r.frames.push({ file, what, written: false, how, error });
    process.stdout.write(`  NOT TAKEN ${file}: ${error}\n`);
    return false;
  }
}

// notTaken records frames a session could not reach at all.
function notTaken(r: Run, files: readonly [string, string][], err: unknown): void {
  const error = err instanceof Error ? err.message : String(err);
  for (const [file, what] of files) {
    if (r.frames.some((f) => f.file === file)) { continue; }
    r.frames.push({ file, what, written: false, error });
    process.stdout.write(`  NOT TAKEN ${file}: ${error}\n`);
  }
}

// clipToWindow keeps a clip inside the window, on whole pixels.
function clipToWindow(b: Box): Box {
  const x = Math.max(0, Math.floor(b.x));
  const y = Math.max(0, Math.floor(b.y));
  const right = Math.min(WINDOW.width, Math.ceil(b.x + b.width));
  const bottom = Math.min(WINDOW.height, Math.ceil(b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

// drawnLeak reads the text the workbench and each panel document draw for any of
// `words`, and answers with the first found, or null.
async function drawnLeak(ctx: SuiteContext, words: readonly string[]): Promise<string | null> {
  const texts = [await ctx.d.workbench<string>('document.body.innerText || ""')];
  for (const doc of await ctx.d.webviews()) {
    texts.push(await doc.evaluate<string>('document.body ? document.body.innerText || "" : ""').catch(() => ''));
  }
  for (const w of words) {
    if (texts.some((t) => t.includes(w))) { return w; }
  }
  return null;
}

// partBox is the rectangle, in the window, of the workbench element `selector`
// finds, widened by `pad` on each side.
async function partBox(ctx: SuiteContext, expression: string, what: string, pad = 0): Promise<Box> {
  const b = await until(`${what} drawn`, 10000, () => ctx.d.workbench<Box | null>(`(() => {
    const e = ${expression};
    if (!e) { return null; }
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  })()`), (v) => v !== null);
  if (b === null) { throw new Error(`unreachable: ${what}`); }
  return { x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad };
}

const SIDE_BAR = `document.getElementById('workbench.parts.sidebar')`;
const paneNamed = (title: string): string => `(${paneByTitle()})(${JSON.stringify(title)})`;

// setPaneOpen folds or unfolds the side-bar view titled `title` by pressing its
// header, where it is not already as asked.
async function setPaneOpen(ctx: SuiteContext, title: string, open: boolean): Promise<void> {
  const want = open ? 'true' : 'false';
  if ((await paneState(ctx.d, title)).expanded === want) { return; }
  await pressPaneHeader(ctx.d, title);
  await until(`the ${title} view ${open ? 'unfolded' : 'folded'}`, 5000, () => paneState(ctx.d, title), (s) => s.expanded === want);
}

// WINDOW_QUIET answers how long it is since the workbench last drew an element or
// a text, watching the whole window from the first time it is asked. Attribute
// changes are left out: a focused input's caret and a progress mark change
// attributes for as long as they are drawn, and neither is what a frame waits on.
const WINDOW_QUIET = quietReading('document.body', '__captureQuiet', false);

// settleWindow waits for the window to draw nothing new for `quietMs`, so a frame
// is not taken in the middle of an animation or a list filling in. A window that
// never stops drawing within the stated wait throws, and the frame is recorded as
// not taken.
async function settleWindow(ctx: SuiteContext, quietMs = 600): Promise<void> {
  try {
    await until(`the window drawing nothing new for ${quietMs} ms`, stated(20000), () => ctx.d.workbench<number>(WINDOW_QUIET), (ms) => ms >= quietMs, 100);
  } catch (err) {
    const what = await ctx.d.workbench<string>('(window.__captureQuiet || {}).what || ""').catch(() => '');
    throw new Error(`${err instanceof Error ? err.message : String(err)}; the last change drawn: ${what}`);
  }
}

// pointerAway rests the pointer where it raises no hover: the middle of the
// editor area's lower edge.
async function pointerAway(ctx: SuiteContext): Promise<void> {
  await ctx.d.moveTo({ x: Math.round(WINDOW.width * 0.66), y: WINDOW.height - 60 });
}

// ---- folders laid out the way a reader has them -----------------------------------

// trackedFiles lists the files the documentation checkout tracks under `rel`, so
// a copy holds what a fresh checkout or the published documentation holds and
// none of what a local run left beside it.
//
// 🔴 A DELIBERATE NEAR-DUPLICATE of the copy placeDocsExample (fixtures.ts) makes,
// which leaves a local run's output behind by name patterns and then rewrites the
// copy's configuration to list a catalog directory. A frame shows the example's
// files as a reader has them, so this copy changes no file, reads the catalog
// through the environment instead, and takes its file list from the checkout
// itself rather than from patterns of what to leave out. Routing the suite's copy
// through this one would change what every suite scenario opens.
function trackedFiles(docs: string, rel: string): string[] {
  const r = spawnSync('git', ['-C', docs, 'ls-files', '-z', '--', rel], { encoding: 'utf8' });
  if (r.status !== 0) { throw new Error(`git ls-files ${rel} in ${docs} exited ${r.status}: ${r.stderr}`); }
  return r.stdout.split('\0').filter((f) => f !== '');
}

// copyTracked copies the tracked files under `rel` into `dest`, keeping their
// layout below `rel` and their executable bits.
function copyTracked(docs: string, rel: string, dest: string): void {
  const files = trackedFiles(docs, rel);
  if (files.length === 0) { throw new Error(`the documentation checkout tracks nothing under ${rel}`); }
  for (const f of files) {
    const to = path.join(dest, path.relative(rel, f));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(docs, f), to);
    fs.chmodSync(to, fs.statSync(path.join(docs, f)).mode & 0o777);
  }
}

// committedCopy lays out in `dest` what the commit checked out at `dir` holds
// under `dir`: the catalog as its commit has it, whatever a working tree beside it
// has changed since.
function committedCopy(dir: string, dest: string): void {
  const where = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel', '--show-prefix'], { encoding: 'utf8' });
  if (where.status !== 0) { throw new Error(`${dir} is in no git checkout`); }
  const [top, prefix = ''] = where.stdout.split('\n').map((l) => l.trim());
  const tree = prefix === '' ? 'HEAD' : `HEAD:${prefix.replace(/\/$/, '')}`;
  // Run from the checkout's top: run from below it, an archive holds only what is
  // beneath the directory it was run in, and a subtree named from there is empty.
  const archive = spawnSync('git', ['-C', top, 'archive', '--format=tar', tree], { maxBuffer: 1 << 30 });
  if (archive.status !== 0) { throw new Error(`git archive ${tree} in ${dir} exited ${archive.status}`); }
  fs.mkdirSync(dest, { recursive: true });
  const untar = spawnSync('tar', ['-x', '-C', dest], { input: archive.stdout });
  if (untar.status !== 0) { throw new Error(`unpacking ${tree} of ${dir} exited ${untar.status}`); }
  if (fs.readdirSync(dest).length === 0) { throw new Error(`${tree} of ${dir} holds nothing`); }
}

// CatalogRead is which catalogs a run reads: the standard catalog's copy alone, or
// the importer catalog ahead of it, as an import reads them.
type CatalogRead = 'standard' | 'importers-first';

// captureEnvironment is what an editor or a compiler run is given beyond its
// stated environment: the catalogs it reads, where a catalog was given, and, where
// the capture was given a Docker configuration directory, its path as
// DOCKER_CONFIG, so a compiler run and the language server read a registry
// credential from it. The path is passed on and never read here.
function captureEnvironment(r: Run, catalog: CatalogRead): Record<string, string> {
  const env: Record<string, string> = {};
  if (catalog === 'importers-first' && r.importerDir !== '') {
    if (r.catalogDirs === '') { throw new Error('an importer catalog is read ahead of the standard catalog, and no catalog was given'); }
    env.AGGREGA_CATALOG_DIRS = `${r.importerDir}:${r.catalogDirs}`;
  } else if (r.catalogDirs !== '') {
    env.AGGREGA_CATALOG_DIRS = r.catalogDirs;
  }
  const dockerConfig = r.opts.dockerConfig ?? '';
  if (dockerConfig !== '') { env.DOCKER_CONFIG = dockerConfig; }
  return env;
}

// compiler runs the compiler under test as a reader runs it at a terminal, with
// the editor's own home, and refuses where it does not complete.
async function compiler(r: Run, root: ScenarioRoot, args: string[], cwd: string): Promise<string> {
  const ran = await runCompiler(r.opts.inputs.compiler.path, args, { cwd, home: scratchHomeOf(root), boundMs: 600000, log: r.log, env: captureEnvironment(r, 'standard') });
  if (ran.status !== 0) {
    throw new Error(`aggrega ${args.join(' ')} exited ${ran.status ?? ran.signal}: ${(ran.stderr || ran.stdout).trim().split('\n').slice(-3).join(' / ')}`);
  }
  return ran.stdout;
}

// ENDING_MS is how long an operation's ending notification is waited for: an
// import fetches its importer and pulls what its drafts depend on, so it is
// stated rather than guarded.
const ENDING_MS = 300000;

// answerInput types `text` into the open question and accepts it.
async function answerInput(ctx: SuiteContext, what: string, text: string): Promise<void> {
  await waitQuickInput(ctx.d, what, (q) => q.title.length > 0 || q.placeholder.length > 0, 30000);
  if (text !== '') { await ctx.d.type(text); }
  await ctx.d.press('Enter');
}

// ---- the manual's frames ---------------------------------------------------------

async function manualFrames(r: Run): Promise<void> {
  process.stdout.write('manual\n');
  const frames = r.opts.scratch;

  // A folder that still needs everything, in an editor that finds no compiler.
  const setupFiles: [string, string][] = [
    ['manual/welcome-page.png', 'the welcome page in a folder that still needs setting up'],
    ['manual/install-compiler-step.png', 'the welcome page\'s compiler step where no compiler is found'],
  ];
  const project = path.join(frames, 'my-project');
  fs.mkdirSync(project, { recursive: true });
  await withEditor(r, 'manual-setup', project, noCompiler(), async (ctx) => {
    const page = await welcomePage(ctx, 60000);
    await until('the compiler step reading To do', 60000, () => pageNow(ctx), (p) => p.steps.some((s) => s.id === 'compiler' && !s.met));
    await takeFrame(r, ctx, setupFiles[0][0], setupFiles[0][1], async () => {
      await frontPage(ctx);
      await page.evaluate('window.scrollTo(0, 0)');
      await clearForCapture(ctx);
      await settleWindow(ctx);
    });
    await takeFrame(r, ctx, setupFiles[1][0], setupFiles[1][1], async () => {
      // Folded, as a reader folds a step they have read: its title, its standing,
      // its value and its three ways through, without the explanation above them.
      await pressCaret(ctx, 'compiler');
      await until('the compiler step folded', 10000, () => pageNow(ctx), (p) => p.steps.some((s) => s.id === 'compiler' && !s.open));
      await page.evaluate(`document.querySelector('section.step[data-step="compiler"]').scrollIntoView({ block: 'center' })`);
      await clearForCapture(ctx);
      await settleWindow(ctx);
      const b = await ctx.d.box(page, 'section.step[data-step="compiler"]');
      if (b === null) { throw new Error('the welcome page draws no compiler step'); }
      return { x: b.x - 16, y: b.y - 12, width: b.width + 32, height: b.height + 24 };
    });
  }).catch((err) => notTaken(r, setupFiles, err));

  // A workspace whose language server is not running, because no compiler is found.
  const stoppedFiles: [string, string][] = [['manual/language-server-stopped.png', 'the status bar reading not running, with its menu']];
  const stopped = path.join(frames, 'stopped', 'quickstart-web');
  copyTracked(r.opts.docs, path.join('language-reference', 'examples', 'quickstart-web', '1'), stopped);
  await withEditor(r, 'manual-stopped', stopped, noCompiler(), async (ctx) => {
    await waitStatus(ctx.d, NOT_RUNNING, 60000);
    await takeFrame(r, ctx, stoppedFiles[0][0], stoppedFiles[0][1], async () => {
      await closeAllEditors(ctx);
      await open(ctx, path.join(stopped, 'aggregate.yaml'));
      await clearForCapture(ctx);
      await send(ctx, 'aggrega.server.lifecycleActions');
      await waitQuickInput(ctx.d, 'the language server\'s menu', (q) => q.rows.length > 0, 10000);
      await settleWindow(ctx);
    });
    await ctx.d.press('Escape');
  }).catch((err) => notTaken(r, stoppedFiles, err));

  // A configured workspace: the quickstart's last step, its dependencies pulled.
  const configured: [string, string][] = [
    ['manual/welcome-page-met.png', 'the welcome page with every step met'],
    ['manual/overview.png', 'a workspace open, with the Aggrega view and the status bar'],
    ['manual/commands-panel.png', 'the Commands panel'],
    ['manual/list-panels.png', 'the Registries, Catalog and Plugins panels'],
    ['manual/operation-menu.png', 'the Inspect button\'s menu'],
    ['manual/topology-graph.png', 'the topology graph with its legend'],
    ['manual/topology-graph-selected.png', 'a node selected, with the attachments panel'],
    ['manual/command-palette.png', 'the Command Palette narrowed to Aggrega'],
    ['manual/import.png', 'the Import command\'s first question'],
    ['manual/settings.png', 'the settings the Commands panel\'s cog opens'],
  ];
  const ws = path.join(frames, 'quickstart-web');
  copyTracked(r.opts.docs, path.join('language-reference', 'examples', 'quickstart-web', '4'), ws);
  // Configured as a reader's machine is once the welcome page has been followed:
  // the dependencies pulled, and the registry the example names registered in the
  // global configuration, as the page's registry step registers it.
  const configure = async (root: ScenarioRoot): Promise<void> => {
    await compiler(r, root, ['pull', '--release', 'release.yaml'], ws);
    await registerWithNoTrust(r.opts.inputs.compiler.path, EXAMPLES_REGISTRY, ws, scratchHomeOf(root), r.log);
  };
  await withEditor(r, 'manual-configured', ws, { prepare: configure }, async (ctx) => {
    await ready(ctx);
    const [met, overview, panel, lists, menu, graph, selected, palette, imp, settings] = configured;
    await takeFrame(r, ctx, met[0], met[1], async () => {
      const allMet = (p: PageSeen): boolean => p.steps.length > 0 && p.steps.every((s) => s.met);
      const seen = await until('every step of the welcome page met', stated(90000), () => pageNow(ctx), allMet).catch(() => null);
      if (seen === null) { throw new Error(`the welcome page does not read every step met: ${describeSteps(await pageNow(ctx))}`); }
      await frontPage(ctx);
      // Scrolled to its foot, as a reader scrolls down to it: the steps met and
      // folded above it, and the versions and the language server's line in it.
      const doc = await welcomePage(ctx);
      await doc.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)');
      await clearForCapture(ctx);
      await settleWindow(ctx);
    });
    await takeFrame(r, ctx, overview[0], overview[1], async () => {
      await closeAllEditors(ctx);
      await open(ctx, path.join(ws, 'aggregate.yaml'));
      await run(ctx, 'workbench.view.extension.aggrega');
      await commandsPanel(ctx.d);
      await clearForCapture(ctx);
      await pointerAway(ctx);
      await settleWindow(ctx);
    });
    await takeFrame(r, ctx, panel[0], panel[1], async () => {
      await clearForCapture(ctx);
      await settleWindow(ctx);
      return partBox(ctx, paneNamed('Commands'), 'the Commands panel');
    });
    await takeFrame(r, ctx, lists[0], lists[1], async () => {
      // The Commands panel folded, as a reader folds it to give the lists below
      // it the room.
      await setPaneOpen(ctx, 'Commands', false);
      for (const [view, title] of [['aggrega.registries', 'Registries'], ['aggrega.workspaceCatalog', 'Catalog'], ['aggrega.plugins', 'Plugins']]) {
        await run(ctx, `${view}.focus`);
        await until(`the ${title} panel listing its rows`, stated(60000), () => drawnTreeRows(ctx.d, title), (v) => v !== null && v.length > 0);
      }
      await clearForCapture(ctx);
      await pointerAway(ctx);
      await settleWindow(ctx);
      return partBox(ctx, SIDE_BAR, 'the side bar');
    });
    await setPaneOpen(ctx, 'Commands', true).catch(() => undefined);
    await takeFrame(r, ctx, menu[0], menu[1], async () => {
      await run(ctx, 'aggrega.operations.focus');
      const doc = await commandsPanel(ctx.d);
      await clearForCapture(ctx);
      await openMenuOf(ctx, doc, 'inspect');
      await settleWindow(ctx);
      return partBox(ctx, SIDE_BAR, 'the side bar');
    });
    await ctx.d.press('Escape');
    await takeFrame(r, ctx, palette[0], palette[1], async () => {
      await clearForCapture(ctx);
      await send(ctx, 'workbench.action.showCommands');
      await waitQuickInput(ctx.d, 'the Command Palette', () => true, 10000);
      await ctx.d.type('Aggrega:');
      await until('the Command Palette listing Aggrega\'s commands', 10000, () => quickInput(ctx.d), (q) => q !== null && q.rows.length > 3 && q.rows.every((x) => x.label.startsWith('Aggrega')));
      await settleWindow(ctx);
    });
    await ctx.d.press('Escape');
    await takeFrame(r, ctx, imp[0], imp[1], async () => {
      await clearForCapture(ctx);
      await send(ctx, 'aggrega.op.import');
      await waitQuickInput(ctx.d, 'the import\'s first question', (q) => q.rows.some((x) => x.label.startsWith('File')), 10000);
      await settleWindow(ctx);
    });
    await ctx.d.press('Escape');
    let graphDoc: Awaited<ReturnType<typeof showGraph>> | null = null;
    await takeFrame(r, ctx, graph[0], graph[1], async () => {
      await closeAllEditors(ctx);
      graphDoc = await showGraph(ctx, stated(120000));
      await clearForCapture(ctx);
      await pointerAway(ctx);
      await settleWindow(ctx, 1000);
    });
    await takeFrame(r, ctx, selected[0], selected[1], async () => {
      if (graphDoc === null) { throw new Error('the topology graph was not drawn'); }
      const state = await graphState(graphDoc);
      const node = state.nodes.find((n) => n !== '') ?? null;
      if (node === null) { throw new Error('the topology graph draws no node to select'); }
      await pressNode(ctx, graphDoc, node);
      await sleep(3000);
      await pointerAway(ctx);
      await settleWindow(ctx, 1000);
    });
    await takeFrame(r, ctx, settings[0], settings[1], async () => {
      await closeAllEditors(ctx);
      await run(ctx, 'aggrega.settings.open');
      await partBox(ctx, `document.querySelector('.settings-editor')`, 'the settings editor');
      await clearForCapture(ctx);
      await pointerAway(ctx);
      await settleWindow(ctx, 1000);
    });
  }).catch((err) => notTaken(r, configured, err));

  // A workspace holding several Releases, for the Release chooser.
  const pickerFiles: [string, string][] = [['manual/release-picker.png', 'Select Release listing the workspace\'s Releases']];
  const several = path.join(frames, 'postgres-three-realizations');
  copyTracked(r.opts.docs, path.join('language-reference', 'examples', 'postgres-three-realizations'), several);
  await withEditor(r, 'manual-releases', several, {}, async (ctx) => {
    await ready(ctx);
    await takeFrame(r, ctx, pickerFiles[0][0], pickerFiles[0][1], async () => {
      await closeAllEditors(ctx);
      await open(ctx, path.join(several, 'aggregate.yaml'));
      await clearForCapture(ctx);
      await send(ctx, 'aggrega.release.select');
      await waitQuickInput(ctx.d, 'the Release chooser listing two Releases or more', (q) => q.rows.length >= 2, 30000);
      await settleWindow(ctx);
    });
    await ctx.d.press('Escape');
  }).catch((err) => notTaken(r, pickerFiles, err));
}

// noCompiler is an editor that finds no compiler: the setting at its default,
// the plain name looked up on the editor's PATH, and nothing of that name there.
function noCompiler(): EditorOptions {
  return {
    settings: { 'aggrega.server.binaryPath': 'aggrega' },
    afterProfile: (root) => { fs.rmSync(path.join(root.bin, 'aggrega')); },
  };
}

// ---- the quickstarts' frames --------------------------------------------------------

async function quickstartFrames(r: Run): Promise<void> {
  process.stdout.write('quickstart\n');
  for (const { track, step } of quickstartSteps(r.opts.docs)) {
    const file = `quickstart-${track}/step-${step}.png`;
    const what = `step ${step} of the ${track} quickstart: its Aggregate and its topology graph`;
    const folder = path.join(r.opts.scratch, `quickstart-${track}-step-${step}`, `quickstart-${track}`);
    copyTracked(r.opts.docs, path.join('language-reference', 'examples', `quickstart-${track}`, String(step)), folder);
    // The step's dependencies are pulled first, as the quickstart has the reader
    // do. A pull that does not complete is said beside the frame, and the frame
    // is taken only where the graph is drawn all the same.
    let how = 'its dependencies pulled with aggrega pull';
    let pulled = true;
    const prepare = async (root: ScenarioRoot): Promise<void> => {
      await compiler(r, root, ['pull', '--release', 'release.yaml'], folder).catch((err: unknown) => {
        pulled = false;
        how = `no pull completed (${err instanceof Error ? err.message : String(err)})`;
      });
    };
    await withEditor(r, `quickstart-${track}-${step}`, folder, { prepare }, async (ctx) => {
      await ready(ctx);
      await takeFrame(r, ctx, file, what, async () => {
        await closeAllEditors(ctx);
        await open(ctx, path.join(folder, 'aggregate.yaml'));
        await run(ctx, 'workbench.action.focusSecondEditorGroup');
        // The graph's column widened, as a reader drags the line between the two,
        // so the graph fits its first drawing to more than half the editor area.
        for (let i = 0; i < 3; i++) { await run(ctx, 'workbench.action.increaseViewWidth'); }
        await showGraph(ctx, stated(pulled ? 120000 : 30000));
        await run(ctx, 'workbench.view.explorer');
        await clearForCapture(ctx);
        await pointerAway(ctx);
        await settleWindow(ctx, 1000);
      }, how);
    }).catch((err) => notTaken(r, [[file, what]], err));
  }
}

// ---- the import pages' frames -------------------------------------------------------

// PageQuotes is what one import page marks, as the documentation's own block
// reader read it: the command its import ran, and the example's files it quotes,
// in the page's order. The capture parses no page itself: the command that runs
// it hands it these, one line each, as `<format> TAB command TAB <the command>`,
// `<format> TAB quote TAB <path inside the example>`, and, for a marker with no
// fenced block on the line below it, `<format> TAB unfenced TAB <its target>`.
interface PageQuotes { command: string; quotes: string[]; unfenced: string[] }

const PAGE_QUOTE_KINDS = ['command', 'quote', 'unfenced'];

// readPageQuotes reads that file into each format's PageQuotes.
function readPageQuotes(file: string): Map<string, PageQuotes> {
  const pages = new Map<string, PageQuotes>();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line === '') { continue; }
    const [format, kind, value] = line.split('\t');
    if (value === undefined || !PAGE_QUOTE_KINDS.includes(kind)) { throw new Error(`${file} holds a line that is no page quote: ${JSON.stringify(line)}`); }
    const p = pages.get(format) ?? { command: '', quotes: [], unfenced: [] };
    if (kind === 'command') { p.command = value; } else if (kind === 'quote') { p.quotes.push(value); } else { p.unfenced.push(value); }
    pages.set(format, p);
  }
  return pages;
}

// ImportCommand is the import a page runs at a terminal.
interface ImportCommand { source: string; target: string; outputDir: string }

// importCommand takes apart the command the page marks as the one its import ran,
// so the editor is driven through the same import the page shows.
function importCommand(format: string, quoted: PageQuotes | undefined): ImportCommand {
  if (quoted === undefined || quoted.command === '') { throw new Error(`the ${format} page marks no import command`); }
  const words = quoted.command.trim().split(/\s+/);
  if (words[0] !== 'aggrega' || words[1] !== 'import') { throw new Error(`the ${format} page marks "${quoted.command}" as its import command`); }
  const cmd: ImportCommand = { source: '', target: '', outputDir: '' };
  for (let i = 2; i < words.length; i++) {
    if (words[i] === '--target') { cmd.target = words[++i] ?? ''; } else if (words[i] === '--output-dir') { cmd.outputDir = words[++i] ?? ''; } else if (words[i].startsWith('--')) {
      throw new Error(`the ${format} page runs its import with ${words[i]}, which this capture does not answer`);
    } else { cmd.source = words[i]; }
  }
  if (cmd.source === '') { throw new Error(`the ${format} page imports no source`); }
  return cmd;
}

// shownFile is the file the scaffold frame opens: the source where it is a
// file; otherwise the first file of the project the page quotes, in the source
// folder, other than the workspace's configuration and the answers file; and
// failing both, the first file directly in the source folder, by name.
function shownFile(quotes: readonly string[], top: string, source: string): string {
  if (fs.statSync(source).isFile()) { return source; }
  for (const q of quotes.filter((x) => x.startsWith('source/'))) {
    const quoted = path.join(top, q);
    const name = path.basename(quoted);
    if (name !== '.aggrega-config.yaml' && name !== 'import-answers.yaml' && fs.existsSync(quoted)) { return quoted; }
  }
  const files = fs.readdirSync(source, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name).sort();
  if (files.length === 0) { throw new Error(`${source} holds no file to show`); }
  return path.join(source, files[0]);
}

async function importFrames(r: Run): Promise<void> {
  process.stdout.write('import\n');
  for (const format of importFormats(r.opts.docs)) {
    const files: [string, string][] = [
      [`import/${format}/scaffold.png`, `the ${format} example scaffolded and open`],
      [`import/${format}/import.png`, `the editor's import of the ${format} example, as it ends`],
      [`import/${format}/validate.png`, `validating what the ${format} import wrote`],
      [`import/${format}/build.png`, `building what the ${format} import wrote`],
    ];
    try {
      await importFormat(r, format, files);
    } catch (err) {
      notTaken(r, files, err);
    }
  }
}

async function importFormat(r: Run, format: string, files: [string, string][]): Promise<void> {
  const example = `import-${format}`;
  if (r.opts.pageQuotes === undefined) { throw new Error('no page quotes were given (--page-quotes), so the page\'s import command is not known'); }
  const quoted = readPageQuotes(r.opts.pageQuotes).get(format);
  if (quoted !== undefined && quoted.unfenced.length > 0) {
    throw new Error(`the ${format} page marks ${quoted.unfenced.join(', ')} with no fenced block on the line below the marker, so what it quotes is not known`);
  }
  const cmd = importCommand(format, quoted);
  const parent = path.join(r.opts.scratch, `${example}-walk`);
  fs.mkdirSync(parent, { recursive: true });
  const top = path.join(parent, example);
  const sourceDir = path.join(top, 'source');
  // The scaffold is given what the editor is: it reads the documentation bundle
  // from the registry, never a catalog entity, so the catalogs named change nothing
  // it reads, and the registry credential reaches it.
  const env = captureEnvironment(r, 'importers-first');
  let how = '';
  await withEditor(r, `import-${format}`, sourceDir, {
    environment: env,
    prepare: async (root) => {
      const scaffolded = await runCompiler(r.opts.inputs.compiler.path, ['scaffold', '--example', example], { cwd: parent, home: scratchHomeOf(root), boundMs: 120000, log: r.log, env });
      if (scaffolded.status === 0 && fs.existsSync(sourceDir)) {
        how = `scaffolded with aggrega scaffold --example ${example}`;
      } else {
        fs.rmSync(top, { recursive: true, force: true });
        copyTracked(r.opts.docs, path.join('language-reference', 'examples', example), top);
        const said = ((scaffolded.stderr || scaffolded.stdout).trim().split('\n').slice(-1)[0] ?? '').trim();
        how = `laid out from the documentation checkout, as the scaffold writes it: aggrega scaffold --example ${example} exited ${scaffolded.status}, ${said.length > 160 ? `${said.slice(0, 160)}…` : said}`;
      }
    },
  }, async (ctx) => {
    await ready(ctx);
    const source = path.resolve(sourceDir, cmd.source);
    const [scaffold, imported, validated, built] = files;
    await takeFrame(r, ctx, scaffold[0], scaffold[1], async () => {
      await closeAllEditors(ctx);
      await open(ctx, shownFile(quoted?.quotes ?? [], top, source));
      await run(ctx, 'workbench.view.explorer');
      await clearForCapture(ctx);
      await pointerAway(ctx);
      await settleWindow(ctx);
    }, how);
    const importOk = await takeFrame(r, ctx, imported[0], imported[1], async () => {
      const mark = (await toasts(ctx.d)).length;
      await send(ctx, 'aggrega.op.import', [{ $file: source }]);
      await answerInput(ctx, 'the import\'s destination', cmd.outputDir);
      await waitQuickInput(ctx.d, 'the import\'s options', (q) => q.rows.length > 0, 30000);
      await ctx.d.press('Enter');
      await answerInput(ctx, 'the import\'s target', cmd.target);
      const t = await waitToast(ctx.d, 'the import\'s ending', mark, (x) => x.message.startsWith('The import'), stated(ENDING_MS));
      if (t.severity === 'error') { throw new Error(`the import ended: ${t.message}`); }
      await run(ctx, 'workbench.view.explorer');
      await pointerAway(ctx);
      await settleWindow(ctx, 1000);
    }, how);
    if (!importOk) { throw new Error('the import did not end in a draft'); }
    const drafted = path.join(sourceDir, cmd.outputDir);
    await takeFrame(r, ctx, validated[0], validated[1], async () => {
      await putAwayNotifications(ctx);
      await closeAllEditors(ctx);
      await open(ctx, path.join(drafted, 'release.yaml'));
      const mark = (await toasts(ctx.d)).length;
      await send(ctx, 'aggrega.op.validate');
      // The validation ends in its count of findings, "Aggrega: validated <file>: …",
      // or, where it did not complete, in "The validation did not complete: …".
      const t = await waitToast(ctx.d, 'the validation\'s ending', mark, (x) => x.message.startsWith('Aggrega: validated ') || x.message.startsWith('The validation'), stated(ENDING_MS));
      if (t.severity === 'error') { throw new Error(`the validation ended: ${t.message}`); }
      await pointerAway(ctx);
      await settleWindow(ctx, 1000);
    }, how);
    await takeFrame(r, ctx, built[0], built[1], async () => {
      await putAwayNotifications(ctx);
      // A build acts on the selected Release, and the folder held none before the
      // import drafted one, so it is selected first, as a reader selects it with
      // Select Release; the page builds that same file.
      const release = path.relative(sourceDir, path.join(drafted, 'release.yaml'));
      await send(ctx, 'aggrega.release.select');
      await waitQuickInput(ctx.d, 'the Release chooser offering the drafted Release', (q) => q.rows.some((x) => x.label === release), 30000);
      await pickQuickInputRow(ctx.d, release);
      await until(`the status bar naming ${release} as the Release`, 30000, () => ctx.d.workbench<string>(`(document.getElementById('workbench.parts.statusbar') || {}).innerText || ''`), (t) => t.includes(release));
      // The build ends on the Aggrega output channel, which it brings forward: its
      // last line is "Build completed: …" where it wrote its output, and a line
      // opening "The build" where it did not complete.
      const channel = ctx.out.mark();
      await send(ctx, 'aggrega.op.build');
      const ended = await ctx.out.waitFor('the build\'s ending on the output channel', channel, (text) => /^(Build completed:|The build )/m.test(text), stated(ENDING_MS));
      if (!/^Build completed:/m.test(ended)) { throw new Error(`the build ended: ${ended.trim().split('\n').slice(-2).join(' / ')}`); }
      const dist = path.join(drafted, 'dist');
      if (fs.existsSync(dist)) { await run(ctx, 'revealInExplorer', [{ $file: dist }]).catch(() => undefined); }
      await pointerAway(ctx);
      await settleWindow(ctx, 1000);
    }, how);
  });
}
