// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { need } from './checks';
import { runCompiler } from './cli';
import { MAPPED_RELEASES, readTree, sameTree, Tree, UNMAPPED_COPY_OF, UNMAPPED_RELEASE, WORKSPACE_CATALOG_DIR } from './fixtures';
import { referenceAnswer } from './reference';
import { capture, ready, SuiteContext } from './suite-context';
import {
  answersIn, commandsPanel, pickQuickInputRow, pressIn, pressOperation, selectorRows, sleep, toasts, toastsSince, toastWindowPassed, until, waitQuickInput, waitToast,
} from './workbench';

// The checks run in a copy of a documentation example whose workspace
// configuration gives each of its Releases catalog directories of its own: Lint
// on the Commands panel checks the catalog once for each Release, over the
// directories that Release reads, and says so pass by pass; each Release built
// from the Build button writes what the command line writes for it, a Release
// the configuration does not name builds against the directories listed for the
// whole workspace, and the graph shown after the selection moves is drawn from
// the Release then selected.

export const OWN_CATALOGS_CHECKS = [
  'lint.reports-each-release-pass-with-the-directories-it-read',
  'lint.reads-no-variant-beside-another',
  'build.each-release-matches-the-command-line-from-its-own-catalog',
  'build.managed-chart-release-matches-the-command-line-from-its-own-catalog',
  'build.unmapped-release-matches-the-command-line-from-the-workspace-list',
  'graph.shown-after-the-selection-moves-draws-the-selected-release',
] as const;

// MANAGED_CHART_RELEASE is the one mapped Release whose Recipe sources its chart
// from a registry on the network. Its lockfile is written by its own check, with
// the network allowed, so no other check rests on the network.
const MANAGED_CHART_RELEASE = 'release-helm-bitnami.yaml';
const SELF_CONTAINED_RELEASES = MAPPED_RELEASES.filter((r) => r !== MANAGED_CHART_RELEASE);

// OFFLINE_RELEASES are the Releases whose lockfiles the scenario writes before
// the editor starts, each with no network.
export const OFFLINE_RELEASES: readonly string[] = [...SELF_CONTAINED_RELEASES, UNMAPPED_RELEASE];

// The two Releases the graph check moves the selection between, and the node it
// reads. Their graphs are drawn from different Aggregates, which each node's
// hover names on its last line; the check takes which Aggregate each is from the
// language server's own graph of that Release rather than from here.
const GRAPH_FROM = 'release-compose.yaml';
const GRAPH_TO = 'release-helm-chart.yaml';
const GRAPH_NODE = 'db';

// GraphPanel is one graph panel's document as drawn: how much its canvas holds,
// the line its status reads where one is shown, and the last line of the hover
// of the node the check reads.
interface GraphPanel { drawn: number; status: string; hoverEnds: string }

// GraphReading is the graph as the editor shows it: the titles of the tabs
// holding a graph, and each graph panel's document.
interface GraphReading { tabs: string[]; panels: GraphPanel[] }

const GRAPH_PANEL = `(() => {
  const canvas = document.getElementById('canvas');
  if (!canvas) { return null; }
  const status = document.getElementById('status');
  let hover = '';
  for (const g of canvas.querySelectorAll('g')) {
    const l = g.querySelector(':scope > text.node-label');
    if (l && l.textContent === ${JSON.stringify(GRAPH_NODE)}) { const t = g.querySelector(':scope > title'); hover = t ? t.textContent : ''; break; }
  }
  return {
    drawn: canvas.querySelectorAll('g, rect').length,
    status: status && !status.classList.contains('hidden') ? (status.innerText || '').trim() : '',
    hoverEnds: hover.split('\\n').pop() || '',
  };
})()`;

// graphPanels reads every webview document that is a graph panel.
async function graphPanels(ctx: SuiteContext): Promise<GraphPanel[]> {
  return (await answersIn<GraphPanel | null>(ctx.d, GRAPH_PANEL)).map((a) => a.value).filter((p): p is GraphPanel => p !== null);
}

function describeGraph(r: GraphReading): string {
  const panels = r.panels.length === 0 ? 'no graph panel drawn' : r.panels.map((p) => `a panel holding ${p.drawn} drawn element(s)${p.status ? `, its status reading "${p.status}"` : ''}, the ${GRAPH_NODE} hover's last line "${p.hoverEnds}"`).join('; ');
  return `tabs ${JSON.stringify(r.tabs)}, ${panels}`;
}

// TreeComparison is what the editor's build wrote held against what the command
// line wrote for the same Release: the files only one of them holds, the files
// whose bytes differ once the reference copy's root is read as the editor's, and
// how many files needed that reading to agree.
interface TreeComparison { same: boolean; files: number; onlyEditor: string[]; onlyReference: string[]; differ: string[]; normalised: number }

function compareTrees(editor: Tree, reference: Tree, editorRoot: string, referenceRoot: string): TreeComparison {
  const onlyEditor = [...editor.keys()].filter((f) => !reference.has(f));
  const onlyReference = [...reference.keys()].filter((f) => !editor.has(f));
  const differ: string[] = [];
  let normalised = 0;
  for (const [f, bytes] of editor) {
    const ref = reference.get(f);
    if (ref === undefined || bytes.equals(ref)) { continue; }
    if (bytes.toString('utf8') === ref.toString('utf8').split(referenceRoot).join(editorRoot)) { normalised++; } else { differ.push(f); }
  }
  const same = editor.size > 0 && onlyEditor.length === 0 && onlyReference.length === 0 && differ.length === 0;
  return { same, files: editor.size, onlyEditor, onlyReference, differ, normalised };
}

function describeComparison(c: TreeComparison): string {
  if (c.same) { return `${c.files} file(s), each the same bytes${c.normalised > 0 ? ` (${c.normalised} once the reference copy's root is read as the editor's)` : ''}`; }
  const parts = [
    c.files === 0 ? 'the editor\'s build wrote nothing' : '',
    c.onlyEditor.length > 0 ? `only the editor's: ${c.onlyEditor.join(', ')}` : '',
    c.onlyReference.length > 0 ? `only the command line's: ${c.onlyReference.join(', ')}` : '',
    c.differ.length > 0 ? `different bytes: ${c.differ.join(', ')}` : '',
  ].filter((p) => p !== '');
  return parts.join('; ');
}

// selectRelease chooses a Release where a person does, on the Commands panel's
// Release row and the picker it opens, and waits for the row to name it.
export async function selectRelease(ctx: SuiteContext, release: string): Promise<void> {
  await pressIn(ctx.d, await commandsPanel(ctx.d), 'button.selector[data-command="aggrega.release.select"]');
  await waitQuickInput(ctx.d, 'the Release picker', (q) => q.rows.some((r) => r.label === release));
  await pickQuickInputRow(ctx.d, release);
  const panel = await commandsPanel(ctx.d);
  await until(`the Release row naming ${release}`, 15000, () => selectorRows(panel), (rows) => rows.some((r) => r.label === 'Release' && r.value === release));
}

// EditorBuild is what one press of Build said and wrote: the channel's opening
// and closing lines, the files it listed, and what is on disk in the directory
// the closing line names.
interface EditorBuild { opened: boolean; closing: string; count: number | null; directory: string; listed: string[]; tree: Tree }

// pressBuild selects the Release, empties the output directory — a build leaves
// what an earlier build wrote there in place, so what is read after it is this
// build's alone — and presses Build.
async function pressBuild(ctx: SuiteContext, release: string): Promise<EditorBuild> {
  await selectRelease(ctx, release);
  const dist = path.join(ctx.folder, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  const mark = ctx.out.mark();
  await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.build');
  const text = await ctx.out.waitFor(`the build of ${release} closing its report`, mark, (t) => /^Build completed: |^The build did not complete/m.test(t), 180000);
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === `Build of ${release}.`);
  const end = lines.findIndex((l) => l.startsWith('Build completed: '));
  const closing = end !== -1 ? lines[end] : lines.find((l) => l.startsWith('The build did not complete')) ?? '';
  const m = /^Build completed: (\d+) files written to (.+)\/$/.exec(closing);
  const count = m ? Number(m[1]) : null;
  // The files are the last lines of the report, one per file, before its closing
  // line.
  const listed = count !== null && start !== -1 && end - count > start ? lines.slice(end - count, end).map((l) => l.trim()) : [];
  return { opened: start !== -1, closing, count, directory: m ? m[2] : '', listed, tree: m ? readTree(m[2]) : new Map() };
}

// CommandLineBuild is what `aggrega build --release` wrote for the same Release
// over the reference copy, and its own summary line.
interface CommandLineBuild { status: number | null; summary: string; tree: Tree }

async function buildAtTheCommandLine(ctx: SuiteContext, reference: string, release: string): Promise<CommandLineBuild> {
  const dist = path.join(reference, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  const run = await runCompiler(ctx.inputs.compiler.path, ['--offline', 'build', '--release', release, '--quiet'], { cwd: reference, home: ctx.home, boundMs: 180000, log: ctx.cliLog });
  const summary = `${run.stdout}\n${run.stderr}`.split('\n').find((l) => l.startsWith('Build completed:'))
    ?? `exit ${run.status ?? run.signal}: ${(run.stderr || run.stdout).trim().split('\n').slice(-2).join(' | ')}`;
  return { status: run.status, summary, tree: readTree(dist) };
}

// keep copies both builds of a Release beside the scenario's copies, for whoever
// reads the report.
function keep(ctx: SuiteContext, release: string, editor: EditorBuild, reference: string): void {
  const stem = release.replace(/\.ya?ml$/, '');
  const builds = path.join(ctx.s.root.dir, 'builds');
  if (editor.directory !== '' && fs.existsSync(editor.directory)) { fs.cpSync(editor.directory, path.join(builds, 'editor', stem), { recursive: true }); }
  if (fs.existsSync(path.join(reference, 'dist'))) { fs.cpSync(path.join(reference, 'dist'), path.join(builds, 'command-line', stem), { recursive: true }); }
}

// ReleaseBuilt is one Release built both ways and held against each other.
interface ReleaseBuilt { release: string; passed: boolean; seen: string; tree: Tree }

// ---- the conventions check, once for each Release ----

// AnsweredPass is one pass of the language server's answer to the whole-catalog
// conventions check, as much of it as the checks read.
interface AnsweredPass { releases: string[]; catalogDirs: string[]; checked: number; findings: number }

// PASS_HEADING matches the line a pass is opened with, and takes from it the
// directories it names as read.
const PASS_HEADING = /^Releases? .+? reads? (.+)$/;

// LintPress is what one press of Lint said: every line the channel gained from
// the press to a moment after its ending, and the ending.
interface LintPress { lines: string[]; ending: string }

// pressLint presses Lint on the Commands panel and reads what it said.
async function pressLint(ctx: SuiteContext): Promise<LintPress> {
  await toastWindowPassed(ctx.d);
  const mark = ctx.out.mark();
  const toastMark = (await toasts(ctx.d)).length;
  await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.op.lint');
  const ending = await waitToast(ctx.d, 'the lint\'s ending', toastMark, (t) => t.message.startsWith('Aggrega lint:'), 120000);
  // The channel is read from the file the editor writes it to, which can trail
  // what the extension appended, and the language server's own lines reach it on
  // a stream of their own beside its answer: both are given a moment.
  await ctx.out.waitFor('the lint\'s lines reaching the channel', mark, (t) => t.split('\n').some((l) => PASS_HEADING.test(l)), 2000).catch(() => '');
  await sleep(1000);
  return { lines: ctx.out.since(mark).split('\n'), ending: ending.message };
}

// releaseFiles names the Release files the folder holds, as the copy was made.
function releaseFiles(folder: string): string[] {
  return fs.readdirSync(folder).filter((f) => /^release[^/]*\.ya?ml$/.test(f)).sort();
}

// releasesNamed and the heading below are this check's own statement of the
// command line's wording, held against what the command line printed before
// anything rests on them.
function releasesNamed(releases: readonly string[]): string {
  return `${releases.length === 1 ? 'Release' : 'Releases'} ${releases.join(', ')}`;
}

function headingFor(pass: AnsweredPass): string {
  return `${releasesNamed(pass.releases)} ${pass.releases.length === 1 ? 'reads' : 'read'} ${pass.catalogDirs.join(', ')}`;
}

async function lintChecks(ctx: SuiteContext, reference: string): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;

  await c.run('lint.reports-each-release-pass-with-the-directories-it-read', {
    expected: 'pressing Lint on the Commands panel writes to the channel, for each pass of the language server\'s own answer to the same whole-catalog request over a reference copy — asked through the extension\'s own client — and in its order, the line `aggrega lint` opens that pass with over the reference copy, naming its Releases and the directories they read, the passes parted by an empty line and none named twice; the passes name every Release file the folder holds, each once; and the ending reads "Aggrega lint: " followed by each pass\'s own count for its own Releases — "no findings across <n> entities checked for Release <file>" or "… for Releases <file>, <file>" — parted by "; ", and a full stop',
    plant: 'in the scratch copy, out/src/lint-run.js made to read every answer as one catalog, setting its per-Release passes aside',
  }, async () => {
    const answer = await referenceAnswer({ binary: bin, root: reference, method: 'aggrega/lint', params: {}, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
    need(answer.ok, `the language server gave no answer to the whole-catalog check over the reference copy: ${answer.ok ? '' : answer.error.message}`);
    const passes = ((answer.result as { passes?: AnsweredPass[] | null }).passes ?? []);
    need(passes.length > 0, 'the language server\'s answer over the reference copy carries no pass per Release, so there is nothing to hold the channel against');
    // Written for the example's catalogs, which carry no conventions finding: an
    // answer that does is one this check does not compose, and it says so rather
    // than passing over lines it never read.
    const uncomposed = passes.filter((p) => p.findings > 0 || p.catalogDirs.length === 0);
    need(uncomposed.length === 0, `the reference answer carries a pass this check does not compose — one with findings, or one that read nothing: ${JSON.stringify(uncomposed)}`);
    const cli = await runCompiler(bin, ['--offline', 'lint'], { cwd: reference, home: ctx.home, boundMs: 120000, log: ctx.cliLog });
    const cliHeadings = cli.stdout.split('\n').filter((l) => PASS_HEADING.test(l));
    const headings = passes.map(headingFor);
    need(JSON.stringify(cliHeadings) === JSON.stringify(headings), `\`aggrega lint\` over the reference copy opens its passes with ${JSON.stringify(cliHeadings)}, not with the lines the language server's passes compose to (${JSON.stringify(headings)}), so the wording this check holds the channel to has moved`);
    const expected = headings.flatMap((h, i) => (i === 0 ? [h] : ['', h]));
    const named = passes.flatMap((p) => p.releases).sort();
    const files = releaseFiles(ctx.folder);
    const want = `Aggrega lint: ${passes.map((p) => `no findings across ${p.checked} entities checked for ${releasesNamed(p.releases)}`).join('; ')}.`;

    const r = await pressLint(ctx);
    const at = r.lines.indexOf(expected[0]);
    const block = at === -1 ? [] : r.lines.slice(at, at + expected.length);
    const opened = r.lines.filter((l) => PASS_HEADING.test(l));
    const passed = JSON.stringify(block) === JSON.stringify(expected) && opened.length === headings.length
      && JSON.stringify(named) === JSON.stringify(files) && r.ending === want;
    return {
      passed,
      seen: `the channel from the press: ${JSON.stringify(r.lines.filter((l) => l.trim() !== ''))}; the ending "${r.ending}"; the language server's passes over the reference copy: ${passes.map((p) => `${p.releases.join(' + ')} over ${p.catalogDirs.join(', ')} (${p.checked} checked, ${p.findings} finding(s))`).join('; ')}; \`aggrega lint\` opens them ${JSON.stringify(cliHeadings)}; Release files in the folder ${JSON.stringify(files)}, named by the passes ${JSON.stringify(named)}`,
    };
  });

  await c.run('lint.reads-no-variant-beside-another', {
    expected: 'pressing Lint on the Commands panel, each of the example\'s catalog variant directories — the folder\'s directories named catalog-<variant>, each holding its own core/datastore/mariadb — is named as read by exactly one of the passes the channel names, and nothing the channel carries from the press to a moment after the ending says core/datastore/mariadb is shadowed, in the extension\'s words or relayed from the language server',
    plant: 'in the scratch copy of the folder, .aggrega-config.yaml with release-helm-synth.yaml reading catalog-compose beside its own directory',
  }, async () => {
    const variants = fs.readdirSync(ctx.folder).filter((f) => /^catalog-/.test(f) && fs.statSync(path.join(ctx.folder, f)).isDirectory()).sort();
    need(variants.length > 1, `the folder holds ${variants.length} catalog variant director(ies), so no variant could be read beside another`);
    const r = await pressLint(ctx);
    const opened = r.lines.filter((l) => PASS_HEADING.test(l));
    const readIn = variants.map((v) => ({ v, passes: opened.filter((l) => (PASS_HEADING.exec(l)?.[1] ?? '').split(', ').includes(v)).length }));
    const shadowed = r.lines.filter((l) => l.includes('"core/datastore/mariadb"') && l.includes('is shadowed'));
    return {
      passed: opened.length > 0 && readIn.every((x) => x.passes === 1) && shadowed.length === 0,
      seen: `the passes the channel names ${JSON.stringify(opened)}; each variant read by ${readIn.map((x) => `${x.v}: ${x.passes} pass(es)`).join(', ')}; lines saying core/datastore/mariadb is shadowed ${shadowed.length === 0 ? 'none' : JSON.stringify(shadowed)}; the ending "${r.ending}"`,
    };
  });
}

// buildBothWays builds a Release at the command line over the reference copy and
// from the Build button in the editor, and holds the two against each other: the
// same files, the same bytes, and a closing line that names the output directory
// beneath the folder opened, counts what is there and lists it.
async function buildBothWays(ctx: SuiteContext, reference: string, release: string): Promise<ReleaseBuilt> {
  const cli = await buildAtTheCommandLine(ctx, reference, release);
  need(cli.status === 0 && cli.tree.size > 0, `the command line did not build ${release} over the reference copy: ${cli.summary}`);
  const editor = await pressBuild(ctx, release);
  keep(ctx, release, editor, reference);
  const dist = path.join(ctx.folder, 'dist');
  const c = compareTrees(editor.tree, cli.tree, ctx.folder, reference);
  const listedAsWritten = JSON.stringify([...editor.listed].sort()) === JSON.stringify([...editor.tree.keys()]);
  const passed = editor.opened && c.same && editor.directory === dist && editor.count === editor.tree.size && listedAsWritten;
  const seen = `${release}: the channel ${editor.opened ? `opened on "Build of ${release}."` : `did not open on "Build of ${release}."`} and closed "${editor.closing}"${editor.directory !== '' && editor.directory !== dist ? ` (not ${dist})` : ''}; ${listedAsWritten ? 'the files it listed are the files on disk' : `it listed ${JSON.stringify(editor.listed)} against ${JSON.stringify([...editor.tree.keys()])} on disk`}; against the command line's "${cli.summary}": ${describeComparison(c)}`;
  return { release, passed, seen, tree: editor.tree };
}

export async function ownCatalogsChecks(ctx: SuiteContext, reference: string): Promise<void> {
  const c = ctx.checks;
  const bin = ctx.inputs.compiler.path;
  await ready(ctx);
  // First, because a plant run ends once its checks have reported, and these
  // two build nothing the checks after them read.
  await lintChecks(ctx, reference);
  const built = new Map<string, Tree>();

  // ---- each Release against its own catalog directories ----
  await c.run('build.each-release-matches-the-command-line-from-its-own-catalog', {
    expected: `in one window, each of ${SELF_CONTAINED_RELEASES.join(', ')} selected in turn and built from the Build button writes to ${path.join(ctx.folder, 'dist')} exactly the files, byte for byte, that \`aggrega build --release <file>\` writes for it over a reference copy, reading the catalog directories the workspace configuration maps it to; its report lists those files and closes "Build completed: <n> files written to <directory>/"; and no two of them write the same`,
    plant: 'in the scratch copy, out/src/build-dials.js made to send every build for release-compose.yaml whichever Release is selected',
  }, async () => {
    const results: ReleaseBuilt[] = [];
    for (const release of SELF_CONTAINED_RELEASES) {
      const r = await buildBothWays(ctx, reference, release);
      results.push(r);
      built.set(release, r.tree);
    }
    const alike = results.flatMap((a, i) => results.slice(i + 1).filter((b) => sameTree(a.tree, b.tree)).map((b) => `${a.release} and ${b.release}`));
    return {
      passed: results.every((r) => r.passed) && alike.length === 0,
      seen: `${results.map((r) => r.seen).join(' || ')}; built alike: ${alike.length === 0 ? 'none' : alike.join(', ')}`,
    };
  });

  // ---- the Release whose chart comes from a registry on the network ----
  await c.run('build.managed-chart-release-matches-the-command-line-from-its-own-catalog', {
    expected: `${MANAGED_CHART_RELEASE}, whose Recipe sources its chart from a registry on the network, pulled with the network allowed into each copy, selected and built from the Build button writes exactly what \`aggrega build --release ${MANAGED_CHART_RELEASE}\` writes over the reference copy, and not what any other Release writes`,
    plant: 'in the scratch copy, out/src/build-dials.js made to send every build for release-helm-synth.yaml whichever Release is selected',
  }, async () => {
    // A pull into each copy: the chart is fetched into the workspace's own
    // cache, which each copy keeps beneath its root, so one pull does not serve
    // the other copy.
    const pulled: string[] = [];
    for (const [where, dir] of [['the copy the editor opened', ctx.folder], ['the reference copy', reference]] as const) {
      const pull = await runCompiler(bin, ['--offline=false', 'pull', '--release', MANAGED_CHART_RELEASE, '--quiet'], { cwd: dir, home: ctx.home, boundMs: 180000, log: ctx.cliLog });
      need(pull.status === 0, `the chart could not be fetched into ${where}, so there is nothing to build it from: \`aggrega --offline=false pull --release ${MANAGED_CHART_RELEASE}\` exited ${pull.status ?? pull.signal}: ${(pull.stderr || pull.stdout).trim().split('\n').slice(-2).join(' | ')}`);
      pulled.push(`${where}: ${pull.stdout.trim().split('\n').find((l) => l.startsWith('Pull complete:')) ?? 'exit 0'} in ${pull.elapsedMs} ms`);
    }
    const r = await buildBothWays(ctx, reference, MANAGED_CHART_RELEASE);
    const alike = [...built].filter(([, tree]) => sameTree(tree, r.tree)).map(([name]) => name);
    return { passed: r.passed && alike.length === 0, seen: `the pulls: ${pulled.join('; ')}; ${r.seen}; built alike to it: ${alike.length === 0 ? `none of ${[...built.keys()].join(', ') || 'the Releases built before it'}` : alike.join(', ')}` };
  });

  // ---- a Release the map does not name ----
  await c.run('build.unmapped-release-matches-the-command-line-from-the-workspace-list', {
    expected: `${UNMAPPED_RELEASE}, a copy of ${UNMAPPED_COPY_OF} the workspace configuration's map does not name, selected and built from the Build button writes exactly what \`aggrega build --release ${UNMAPPED_RELEASE}\` writes over the reference copy, reading ${WORKSPACE_CATALOG_DIR}, the catalog directory the configuration lists for the whole workspace`,
    plant: `in the scratch copy of the folder, .aggrega-config.yaml with the workspace-level list of catalog directories removed`,
  }, async () => {
    const r = await buildBothWays(ctx, reference, UNMAPPED_RELEASE);
    const copied = built.get(UNMAPPED_COPY_OF);
    const likeItsOriginal = copied === undefined ? `${UNMAPPED_COPY_OF} was not built before it` : sameTree(copied, r.tree) ? `the same files as ${UNMAPPED_COPY_OF}'s build, whose own directory the workspace list names` : `not the same files as ${UNMAPPED_COPY_OF}'s build`;
    return { passed: r.passed, seen: `${r.seen}; ${likeItsOriginal}` };
  });

  // ---- the graph shown after the selection moves ----
  await c.run('graph.shown-after-the-selection-moves-draws-the-selected-release', {
    expected: `the graph shown for ${GRAPH_FROM} is titled "Aggrega Graph — ${GRAPH_FROM}" and its ${GRAPH_NODE} node's hover ends on the Aggregate the language server's own graph of that Release names; with the selection then moved to ${GRAPH_TO}, showing the graph again redraws the same panel from ${GRAPH_TO}: titled "Aggrega Graph — ${GRAPH_TO}", its ${GRAPH_NODE} node's hover ending on that Release's Aggregate`,
    plant: 'in the scratch copy, out/src/graph-view.js made to show again the Release a panel already shows, whichever is selected',
  }, async () => {
    const aggregateOf = async (release: string): Promise<string> => {
      const a = await referenceAnswer({ binary: bin, root: reference, method: 'aggrega/irGraph', params: { release }, home: ctx.home, table: ctx.s.table, log: ctx.cliLog });
      need(a.ok, `the language server gave no graph of ${release} over the reference copy: ${a.ok ? '' : a.error.message}`);
      const node = (a.result as { graph?: { spec?: { nodes?: Record<string, { source_file?: string }> } } }).graph?.spec?.nodes?.[GRAPH_NODE];
      need(typeof node?.source_file === 'string' && node.source_file !== '', `the language server's graph of ${release} names no document for ${GRAPH_NODE}`);
      return node.source_file;
    };
    const fromAggregate = await aggregateOf(GRAPH_FROM);
    const toAggregate = await aggregateOf(GRAPH_TO);
    need(fromAggregate !== toAggregate, `the two Releases' graphs name the same document for ${GRAPH_NODE} (${fromAggregate}), so the drawing cannot tell them apart`);
    const tabs = (): Promise<string[]> => ctx.d.workbench<string[]>(`[...document.querySelectorAll('.tabs-container .tab')].map((t) => ((t.querySelector('.label-name') || {}).innerText || t.getAttribute('aria-label') || '').trim()).filter((l) => l.startsWith('Aggrega Graph'))`);
    const reading = async (): Promise<GraphReading> => ({ tabs: await tabs(), panels: await graphPanels(ctx) });
    const shows = (r: GraphReading, release: string, aggregate: string): boolean =>
      r.tabs.length === 1 && r.tabs[0] === `Aggrega Graph — ${release}` && r.panels.length === 1 && r.panels[0].drawn > 0 && r.panels[0].hoverEnds === `↪ ${aggregate}`;

    await selectRelease(ctx, GRAPH_FROM);
    const toastMark = (await toasts(ctx.d)).length;
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.graph.show');
    const first = await until(`the graph drawn from ${GRAPH_FROM}`, 90000, reading, (r) => shows(r, GRAPH_FROM, fromAggregate)).catch(() => reading());
    await selectRelease(ctx, GRAPH_TO);
    // What the open panel shows once the selection has moved and before it is
    // shown again, recorded as it stands: the panel keeps the Release it was
    // shown with until it is shown again.
    await sleep(2000);
    const between = await reading();
    await pressOperation(ctx.d, await commandsPanel(ctx.d), 'aggrega.graph.show');
    const second = await until(`the graph redrawn from ${GRAPH_TO}`, 90000, reading, (r) => shows(r, GRAPH_TO, toAggregate)).catch(() => reading());
    const passed = shows(first, GRAPH_FROM, fromAggregate) && shows(second, GRAPH_TO, toAggregate);
    const drawnNotices = passed ? '' : `; notifications since the first press ${JSON.stringify((await toastsSince(ctx.d, toastMark)).map((t) => `${t.message.slice(0, 160)} (${t.severity})`))}; capture ${await capture(ctx, 'graph-after-the-selection-moved')}`;
    return {
      passed,
      seen: `shown for ${GRAPH_FROM}: ${describeGraph(first)}; the selection moved to ${GRAPH_TO}, before showing again: ${describeGraph(between)}; shown again: ${describeGraph(second)}; the language server's graphs name ${fromAggregate} and ${toAggregate}${drawnNotices}`,
    };
  });
}
