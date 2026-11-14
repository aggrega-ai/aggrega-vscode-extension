// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { NeedleResult, runNeedles } from './calibration';
import { captureDocs, Group, GROUPS } from './capture-docs';
import { declaredChecks, Judgement, VERDICTS } from './checks';
import { containmentSummary, ContainmentStart, markStart, placesFor, readContainment } from './containment';
import { markRunnerEnvironment } from './editor';
import { DOCS_EXAMPLE, MYSQL_EXAMPLE, OWN_CATALOGS_EXAMPLE } from './fixtures';
import { checkInputs, EDITOR_VERSION, INPUT_NAMES, InputOptions, Inputs, REPO_ROOT } from './inputs';
import { POSTGRES_EXAMPLE } from './layouts';
import { checkLibraries, libraryRefusal, LibraryReport } from './libraries';
import { checkPlant, PLANTS, Plant, plantNamed, PlantRefused } from './plants';
import { runProbeProofs } from './probe-proofs';
import { TeardownReport } from './processes';
import { active, bringUp, Scenario, SCREEN, tearDown, waitForServer } from './scenario';
import { runSuite, SCENARIO_CHECKS } from './suite';

// The editor suite's runner: launches the real editor with no display, drives it
// from outside, and reports what it read.
//
//   node out/test/e2e/run.js <command> [options]
//
// (`npm run test:e2e -- <command> [options]` runs the same, and npm writes a
// debug log of its own under the home directory as it does.)
//
// Commands:
//   inputs          check every input and the editor's libraries, and print the
//                   identity a report would be headed with
//   fetch-editor    download the editor build into the extension's .vscode-test
//   calibrate       take the seven calibration readings with each UI driver
//   probe           prove the probe answers, matches the Problems panel and
//                   survives a window reload
//   teardown-study  signal the editor alone and watch which process outlives it
//   suite           build the fixtures and run the checks, scenario by scenario:
//                   which build is under test, the inspection toggle and the two
//                   diagnostic layers, the capabilities walked end to end, and
//                   the topology graph's attachments panel, what may attach and
//                   the attach it commits; then read whether anything was
//                   written outside the scratch directory and whether any
//                   process it started is alive
//   plants          list the plants, and check each one's replaced text occurs
//                   exactly once in the compiled extension; launches nothing
//   checklist       list what the suite leaves to a person, read from the
//                   checks' declarations: each check a run brings to a state
//                   for a person to judge, with its question, and each check
//                   no run can reach, with why; launches nothing
//   compare <a> <b> compare two suite reports (a run's directory or its
//                   suite.json), header and verdict by verdict
//   capture-docs    take the screenshots the documentation shows of the editor,
//                   driving it through each state they show, and write each
//                   frame under --out; reads the documentation checkout --docs
//                   names for the folders it opens; it is no check, and it
//                   passes or fails nothing about the extension
//
// Options (each input also reads the environment variable named beside it):
//   --scratch <dir>          where every scratch root of the run is created
//                            (AGGREGA_E2E_SCRATCH); required
//   --extension <dir>        the extension's root (AGGREGA_E2E_EXTENSION);
//                            default: this repository
//   --compiler <file>        the language-server binary (AGGREGA_E2E_COMPILER)
//   --compiler-commit <sha>  the commit it must report (AGGREGA_E2E_COMPILER_COMMIT)
//   --catalog <dir>          the standard-library catalog (AGGREGA_E2E_CATALOG)
//   --registry-server <file> the registry server binary (AGGREGA_E2E_REGISTRY_SERVER)
//   --editor <dir>           the editor build (AGGREGA_E2E_EDITOR); default: the
//                            extension's .vscode-test download
//   --driver <name>          playwright-devtools, playwright-electron or all
//                            (calibrate: all; probe and suite: playwright-devtools)
//   --only <scenarios>       suite: a comma-separated subset of its scenarios
//   --plant <name>           suite: make that plant's one edit in the scratch
//                            copy, run the scenario that holds its checks until
//                            they have reported, and report whether they moved
//                            the way the plant says
//   --out <dir>              capture-docs: where the frames are written
//   --docs <dir>             capture-docs: the documentation checkout
//   --only <groups>          capture-docs: a comma-separated subset of manual,
//                            quickstart and import
//   --importer-catalog <dir> capture-docs: a catalog folder holding the
//                            importers at the compiler's own version, read
//                            ahead of --catalog by the import frames, for a
//                            compiler built between releases
//   --page-quotes <file>     capture-docs: what each import page marks — its
//                            import command and the example files it quotes —
//                            as the documentation's own block reader read it
//
// Exit status: 0 when every reading passed (for suite: when no check failed or
// was not run, every fixture was built and no process it started outlived it, a
// check that cannot run here or is left for a person failing nothing; for a plant
// run: when every check the plant was made for moved the way it says; for
// compare: when the two reports agree; for checklist: when every check it lists
// is one a scenario runs), 1 otherwise, 2 when the run was refused before it
// launched anything.

const DRIVERS = ['playwright-devtools', 'playwright-electron'];

interface Options {
  command: string;
  positional: string[];
  scratch?: string;
  driver?: string;
  only?: string[];
  plant?: string;
  out?: string;
  docs?: string;
  importerCatalog?: string;
  pageQuotes?: string;
  inputs: Omit<InputOptions, 'scratch'>;
}

function parseArgs(argv: string[]): Options {
  const [command = '', ...rest] = argv;
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    if (i + 1 >= rest.length) { throw new Usage(`the option ${a} needs a value`); }
    flags[a.slice(2)] = rest[++i];
  }
  if (positional.length > 0 && command !== 'compare') { throw new Usage(`unexpected argument ${positional[0]}`); }
  const known = new Set(['scratch', 'driver', 'only', 'plant', 'extension', 'compiler', 'compiler-commit', 'catalog', 'registry-server', 'editor', 'out', 'docs', 'importer-catalog', 'page-quotes']);
  for (const k of Object.keys(flags)) { if (!known.has(k)) { throw new Usage(`unknown option --${k}`); } }
  if (flags.driver !== undefined && flags.driver !== 'all' && !DRIVERS.includes(flags.driver)) {
    throw new Usage(`unknown driver ${flags.driver}; the drivers are ${DRIVERS.join(', ')}, or all`);
  }
  if (flags.plant !== undefined && flags.only !== undefined) { throw new Usage('--plant runs the scenario its plant names, so it takes no --only'); }
  const pick = (flag: string, env: string): string | undefined => flags[flag] ?? (process.env[env] || undefined);
  return {
    command,
    positional,
    scratch: pick('scratch', 'AGGREGA_E2E_SCRATCH'),
    driver: flags.driver,
    only: flags.only === undefined ? undefined : flags.only.split(',').map((s) => s.trim()).filter((s) => s !== ''),
    plant: flags.plant,
    out: resolved(flags.out),
    docs: resolved(flags.docs),
    importerCatalog: resolved(flags['importer-catalog']),
    pageQuotes: resolved(flags['page-quotes']),
    inputs: {
      extension: path.resolve(pick('extension', INPUT_NAMES.extension.env) ?? REPO_ROOT),
      compiler: resolved(pick('compiler', INPUT_NAMES.compiler.env)),
      compilerCommit: pick('compiler-commit', INPUT_NAMES.compilerCommit.env),
      catalog: resolved(pick('catalog', INPUT_NAMES.catalog.env)),
      registryServer: resolved(pick('registry-server', INPUT_NAMES.registryServer.env)),
      editor: resolved(pick('editor', INPUT_NAMES.editor.env)),
    },
  };
}

function resolved(p: string | undefined): string | undefined {
  return p === undefined ? undefined : path.resolve(p);
}

class Usage extends Error {}

class Refused extends Error {
  constructor(readonly lines: string[]) { super(lines.join('\n')); }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// prepareRun checks the inputs and the libraries and creates the run's directory.
// Nothing is launched until both pass.
function prepareRun(opts: Options): { inputs: Inputs; runDir: string; libraries: LibraryReport; start: ContainmentStart } {
  if (!opts.scratch) {
    throw new Refused(['refused: no scratch directory was given (--scratch or AGGREGA_E2E_SCRATCH); the runner writes nowhere else']);
  }
  const runDir = path.join(path.resolve(opts.scratch), stamp());
  fs.mkdirSync(runDir, { recursive: true });
  // The run's start, marked before anything else is done, so that anything
  // written outside the scratch directory afterwards is newer than the marker.
  const start = markStart(runDir);
  // Everything the runner's own process writes, a driver library's temporary
  // files included, goes under the run's directory.
  const runnerTmp = path.join(runDir, 'runner-tmp');
  fs.mkdirSync(runnerTmp, { recursive: true });
  process.env.TMPDIR = runnerTmp;
  markRunnerEnvironment();
  const checked = checkInputs({ ...opts.inputs, scratch: runDir });
  if ('refusals' in checked) {
    throw new Refused(checked.refusals.map((r) => `refused: ${r.input} (${r.option}): ${r.reason}; ${r.remedy}`));
  }
  const libs = checkLibraries(checked.inputs.editor.executable);
  const refusal = libraryRefusal(libs);
  if (refusal !== null) { throw new Refused([`refused: ${refusal}`]); }
  return { inputs: checked.inputs, runDir, libraries: libs, start };
}

export function header(inputs: Inputs): Record<string, string> {
  return {
    extensionBuild: inputs.extension.buildStamp,
    compiler: `${inputs.compiler.version} (commit ${inputs.compiler.commit})`,
    editor: `${inputs.editor.version} (commit ${inputs.editor.commit})`,
    catalog: `${inputs.catalog.commit}${inputs.catalog.uncommitted ? ', in a checkout with uncommitted changes' : ''}`,
    registryServer: inputs.registryServer.version,
  };
}

function writeReport(runDir: string, name: string, data: unknown, summary: string[]): void {
  fs.writeFileSync(path.join(runDir, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
  fs.writeFileSync(path.join(runDir, `${name}.txt`), `${summary.join('\n')}\n`);
  process.stdout.write(`${summary.join('\n')}\n`);
  process.stdout.write(`report: ${path.join(runDir, `${name}.json`)}\n`);
}

async function commandInputs(opts: Options): Promise<number> {
  const { inputs, runDir, libraries: libs } = prepareRun(opts);
  writeReport(runDir, 'inputs', { header: header(inputs), inputs, libraries: libs }, [
    'inputs: every input accepted',
    ...Object.entries(header(inputs)).map(([k, v]) => `  ${k}: ${v}`),
    `  editor libraries: ${libs.resolved} resolved, ${libs.missing.length} missing`,
  ]);
  return 0;
}

async function commandFetchEditor(opts: Options): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { downloadAndUnzipVSCode } = require('@vscode/test-electron') as typeof import('@vscode/test-electron');
  const cachePath = path.join(opts.inputs.extension, '.vscode-test');
  const executable = await downloadAndUnzipVSCode({ version: EDITOR_VERSION, cachePath });
  process.stdout.write(`editor ${EDITOR_VERSION}: ${executable}\n`);
  return 0;
}

async function commandCalibrate(opts: Options): Promise<number> {
  const { inputs, runDir } = prepareRun(opts);
  const candidates = opts.driver === undefined || opts.driver === 'all' ? DRIVERS : [opts.driver];
  const results: { driver: string; bringUpMs: number | null; needles: NeedleResult[]; teardown: TeardownReport | null; error?: string }[] = [];
  for (const driverName of candidates) {
    let s: Scenario | null = null;
    const entry: (typeof results)[number] = { driver: driverName, bringUpMs: null, needles: [], teardown: null };
    try {
      s = await bringUp(`calibrate-${driverName}`, inputs, runDir, driverName);
      entry.bringUpMs = s.bringUpMs;
      if (s.driver === null) { throw new Error(`no driver named ${driverName}`); }
      entry.needles = await runNeedles({ driver: s.driver, probe: s.probe, extensionDir: inputs.extension.dir, logs: s.root.logs });
    } catch (err) {
      entry.error = err instanceof Error ? err.message : String(err);
    }
    if (s !== null) {
      entry.teardown = await tearDown(s);
      entry.needles.push({
        needle: 'g', subject: 'teardown leaving no recorded process alive', passed: entry.teardown.stillAlive.length === 0,
        elapsedMs: entry.teardown.elapsedMs, evidence: { recorded: entry.teardown.recorded, stillAlive: entry.teardown.stillAlive, closeMs: entry.teardown.closeMs, signals: entry.teardown.signals.length },
      });
    }
    results.push(entry);
  }
  const summary = ['calibration', ...Object.entries(header(inputs)).map(([k, v]) => `  ${k}: ${v}`)];
  for (const r of results) {
    summary.push(`driver ${r.driver}: bring-up ${r.bringUpMs ?? '-'} ms${r.error ? `; stopped: ${r.error}` : ''}`);
    for (const n of r.needles) {
      summary.push(`  (${n.needle}) ${n.passed ? 'passed' : 'FAILED'} ${n.elapsedMs} ms — ${n.subject}${n.error ? `: ${n.error}` : ''}`);
    }
    if (r.teardown) {
      summary.push(`  teardown ${r.teardown.elapsedMs} ms: clean close ${r.teardown.closeMs === null ? 'did not finish' : `${r.teardown.closeMs} ms`}, ${r.teardown.signals.length} signal(s), ${r.teardown.stillAlive.length} still alive of ${r.teardown.recorded} recorded`);
    }
  }
  writeReport(runDir, 'calibration', { header: header(inputs), screen: SCREEN, results }, summary);
  const allPassed = results.every((r) => !r.error && r.needles.length === 7 && r.needles.every((n) => n.passed));
  return allPassed ? 0 : 1;
}

async function commandProbe(opts: Options): Promise<number> {
  const { inputs, runDir } = prepareRun(opts);
  const driverName = opts.driver === undefined || opts.driver === 'all' ? DRIVERS[0] : opts.driver;
  const s = await bringUp(`probe-${driverName}`, inputs, runDir, driverName);
  let proofs: Awaited<ReturnType<typeof runProbeProofs>> | null = null;
  let error: string | undefined;
  try {
    if (s.driver === null) { throw new Error(`no driver named ${driverName}`); }
    proofs = await runProbeProofs({ driver: s.driver, probe: s.probe, folder: path.join(s.root.dir, 'folder'), table: s.table, compiler: inputs.compiler.path });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const teardown = await tearDown(s);
  const summary = ['probe', `  bring-up ${s.bringUpMs} ms${error ? `; stopped: ${error}` : ''}`];
  for (const p of proofs?.proofs ?? []) { summary.push(`  ${p.passed ? 'passed' : 'FAILED'} ${p.elapsedMs} ms — ${p.subject}${p.error ? `: ${p.error}` : ''}`); }
  summary.push(`  teardown ${teardown.elapsedMs} ms, ${teardown.stillAlive.length} still alive of ${teardown.recorded} recorded`);
  writeReport(runDir, 'probe', { header: header(inputs), proofs, teardown, error }, summary);
  return !error && proofs !== null && proofs.proofs.every((p) => p.passed) && teardown.stillAlive.length === 0 ? 0 : 1;
}

async function commandTeardownStudy(opts: Options): Promise<number> {
  const { inputs, runDir } = prepareRun(opts);
  const s = await bringUp('teardown-study', inputs, runDir, null);
  const server = await waitForServer(s.table, inputs.compiler.path, 60000);
  s.table.snapshot();
  const before = s.table.alive();
  const signalled = s.table.signalRoots('SIGTERM');
  const watched = await s.table.observe(20000);
  const rest = await s.table.teardown({ closeBoundMs: 0, termBoundMs: 3000, killBoundMs: 2000 });
  s.resources.stop();
  active.delete(s.table);
  const summary = [
    'teardown study: SIGTERM to the editor alone, then watch',
    `  language server: ${server ? `pid ${server.pid}` : 'not found'}`,
    `  alive before: ${before.length}; signalled: ${signalled.map((r) => `${r.pid} ${r.comm}`).join(', ')}`,
    ...watched.deaths.map((d) => `  gone at ${d.goneMs} ms: ${d.pid} ${d.comm} — ${d.cmd.slice(0, 110)}`),
    ...watched.survivors.map((r) => `  STILL ALIVE at ${watched.elapsedMs} ms: ${r.pid} ${r.comm} (${r.via}) — ${r.cmd.slice(0, 110)}`),
    `  afterwards: ${rest.signals.length} signal(s) sent, ${rest.stillAlive.length} still alive`,
  ];
  writeReport(runDir, 'teardown-study', { before, signalled, watched, rest }, summary);
  return rest.stillAlive.length === 0 ? 0 : 1;
}

async function commandSuite(opts: Options): Promise<number> {
  let plant: Plant | undefined;
  if (opts.plant !== undefined) {
    try { plant = plantNamed(opts.plant); } catch (err) { throw new Refused([`refused: ${err instanceof Error ? err.message : String(err)}`]); }
  }
  const { inputs, runDir, start } = prepareRun(opts);
  if (plant !== undefined && plant.target === 'extension') {
    const { file, found } = checkPlant(plant, inputs.extension.dir);
    if (found !== 1) {
      throw new Refused([`refused: the plant ${plant.name} replaces text that occurs ${found === -1 ? 'nowhere, the file being absent,' : `${found} times`} in ${file}, not once; it was written against a compiled extension that has since changed`]);
    }
  }
  const driverName = opts.driver === undefined || opts.driver === 'all' ? DRIVERS[0] : opts.driver;
  const report = await runSuite({ inputs, runDir, driverName, only: opts.only, plant, header: header(inputs) });
  const scratch = path.resolve(opts.scratch as string);
  const containment = readContainment(start, scratch, placesFor(start, {
    extension: inputs.extension.dir,
    catalog: inputs.catalog.dir,
    compiler: inputs.compiler.path,
    registryServer: inputs.registryServer.path,
    editor: inputs.editor.dir,
    docsExamples: [DOCS_EXAMPLE, OWN_CATALOGS_EXAMPLE, MYSQL_EXAMPLE, POSTGRES_EXAMPLE].map((e) => path.join(REPO_ROOT, '..', e)),
  }));
  const summary = [...report.summary, ...containmentSummary(containment)];
  writeReport(runDir, 'suite', { ...(report.data as Record<string, unknown>), containment }, summary);
  const contained = containment.processes.alive.length === 0;
  return report.allPassed && contained ? 0 : 1;
}

// commandPlants lists the plants and checks each against the compiled extension
// and the scenarios' check lists, launching nothing.
function commandPlants(opts: Options): number {
  const extension = opts.inputs.extension;
  const lines: string[] = [`plants: ${PLANTS.length}, checked against ${extension}`];
  let sound = true;
  for (const p of PLANTS) {
    const names = SCENARIO_CHECKS[p.scenario];
    const unknown = names === undefined ? p.checks : p.checks.filter((c) => !names.includes(c));
    const at = p.target === 'extension' ? checkPlant(p, extension) : null;
    const where = at === null ? 'checked when its folder is placed' : at.found === 1 ? 'its replaced text occurs once' : `its replaced text occurs ${at.found === -1 ? 'nowhere (no such file)' : `${at.found} times`}, not once`;
    const ok = unknown.length === 0 && (at === null || at.found === 1);
    sound = sound && ok;
    lines.push(`  ${ok ? 'ok' : 'REFUSED'} ${p.name} [${p.scenario}] turns ${p.checks.join(', ')} ${p.moves} — ${p.says}; ${p.file}: ${where}${unknown.length > 0 ? `; names no check of that scenario: ${unknown.join(', ')}` : ''}`);
  }
  const planted = new Set(PLANTS.flatMap((p) => p.checks.map((c) => `${p.scenario}/${c}`)));
  const without = Object.entries(SCENARIO_CHECKS).flatMap(([s, cs]) => cs.filter((c) => !planted.has(`${s}/${c}`)).map((c) => `${s}/${c}`));
  lines.push(`checks no plant is made for (each is left for a person, or cannot be run, or fails on the product as it stands with no one-edit correction): ${without.join(', ')}`);
  process.stdout.write(`${lines.join('\n')}\n`);
  return sound ? 0 : 1;
}

// commandChecklist lists, from the checks' declarations and launching nothing,
// what the suite leaves to a person, in the order the scenarios run it: each
// check a run brings to a state for a person to judge, with the question it
// asks, and each check whose state no run can build, with why.
function commandChecklist(): number {
  const byName = new Map(declaredChecks().map((d) => [d.name, d]));
  const judged: string[] = [];
  const unreached: string[] = [];
  let judgedCount = 0;
  let unreachedCount = 0;
  const listed = new Set<string>();
  for (const [scenario, names] of Object.entries(SCENARIO_CHECKS)) {
    for (const name of names) {
      const d = byName.get(name);
      if (d === undefined) { continue; }
      listed.add(name);
      if (d instanceof Judgement) {
        judgedCount++;
        judged.push(`  ${scenario} / ${name}`, `      expected: ${d.expected}`, `      question: ${d.question}`);
      } else {
        unreachedCount++;
        unreached.push(`  ${scenario} / ${name}`, `      expected: ${d.expected}`, `      cannot run here: ${d.reason}`);
      }
    }
  }
  const stray = [...byName.keys()].filter((n) => !listed.has(n));
  const lines = [
    'checklist: what the suite leaves to a person, read from the checks\' declarations; nothing is launched',
    `left for a person: ${judgedCount} — a run brings the editor to each state and leaves it there, with what it captured, for a person to judge`,
    ...judged,
    `cannot run here: ${unreachedCount} — no run can build the state each needs, so every run reports it as one that cannot run here, with this reason, and does not fail on it; where you can build the state, walk it by hand`,
    ...unreached,
  ];
  if (stray.length > 0) { lines.push(`declared but run by no scenario: ${stray.join(', ')}`); }
  process.stdout.write(`${lines.join('\n')}\n`);
  return stray.length === 0 ? 0 : 1;
}

interface ReportShape { header?: Record<string, string>; scenarios?: { name: string; results: { name: string; verdict: string }[] }[] }

function loadReport(p: string): ReportShape {
  const file = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'suite.json') : p;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as ReportShape;
  } catch (err) {
    throw new Refused([`refused: ${file} is not a suite report: ${err instanceof Error ? err.message : String(err)}`]);
  }
}

// commandCompare compares two suite reports: whether they were taken over the
// same inputs, and whether every check has the same verdict in both.
function commandCompare(opts: Options): number {
  if (opts.positional.length !== 2) { throw new Usage('compare takes two reports: a run\'s directory or its suite.json, twice'); }
  const [a, b] = opts.positional.map(loadReport);
  const lines: string[] = [`compare ${opts.positional[0]} with ${opts.positional[1]}`];
  const keys = new Set([...Object.keys(a.header ?? {}), ...Object.keys(b.header ?? {})]);
  const headerDiffers = [...keys].filter((k) => (a.header ?? {})[k] !== (b.header ?? {})[k]);
  for (const k of keys) {
    lines.push(`  ${k}: ${(a.header ?? {})[k] ?? '-'}${headerDiffers.includes(k) ? ` | ${(b.header ?? {})[k] ?? '-'} — DIFFERS` : ' — the same'}`);
  }
  const verdicts = (r: ReportShape): Map<string, string> => new Map((r.scenarios ?? []).flatMap((s) => s.results.map((x) => [`${s.name}/${x.name}`, x.verdict] as [string, string])));
  const va = verdicts(a);
  const vb = verdicts(b);
  const all = [...new Set([...va.keys(), ...vb.keys()])];
  const differ = all.filter((k) => va.get(k) !== vb.get(k));
  for (const k of differ) { lines.push(`  ${k}: ${va.get(k) ?? 'absent'} | ${vb.get(k) ?? 'absent'} — DIFFERS`); }
  const count = (m: Map<string, string>, v: string): number => [...m.values()].filter((x) => x === v).length;
  const tally = (m: Map<string, string>): string => VERDICTS.map((v) => `${count(m, v)} ${v}`).join(', ');
  lines.push(`checks compared: ${all.length}; ${differ.length === 0 ? 'every verdict the same' : `${differ.length} verdict(s) differ`}; first ${tally(va)}; second ${tally(vb)}`);
  lines.push(`inputs: ${headerDiffers.length === 0 ? 'the same header in both' : `the headers differ in ${headerDiffers.join(', ')}`}`);
  process.stdout.write(`${lines.join('\n')}\n`);
  return differ.length === 0 && headerDiffers.length === 0 ? 0 : 1;
}

// commandCaptureDocs takes the documentation's screenshots of the editor. Its
// scratch directory is where every folder the editor opens sits, so the paths a
// frame can show are under it: it is to be a neutral path, absent or empty, and
// the compiler is copied into it before anything is launched, so the path the
// editor shows for the compiler is under it too.
async function commandCaptureDocs(opts: Options): Promise<number> {
  const refusals: string[] = [];
  if (!opts.scratch) { refusals.push('refused: no scratch directory was given (--scratch); the capture writes nowhere else'); }
  if (!opts.out) { refusals.push('refused: no output directory was given (--out)'); }
  if (!opts.docs || !fs.existsSync(path.join(opts.docs, 'authoring', 'import'))) { refusals.push('refused: --docs names no documentation checkout (it holds no authoring/import)'); }
  if (!opts.inputs.compiler) { refusals.push(`refused: no compiler was given (${INPUT_NAMES.compiler.option})`); }
  const groups = opts.only ?? [...GROUPS];
  const unknown = groups.filter((g) => !(GROUPS as readonly string[]).includes(g));
  if (unknown.length > 0) { refusals.push(`refused: --only names ${unknown.join(', ')}; the groups are ${GROUPS.join(', ')}`); }
  if (opts.importerCatalog !== undefined && !fs.existsSync(path.join(opts.importerCatalog, 'plugin', 'importer'))) {
    refusals.push('refused: --importer-catalog names no catalog folder holding importers (it holds no plugin/importer)');
  }
  if (groups.includes('import') && (opts.pageQuotes === undefined || !fs.existsSync(opts.pageQuotes))) {
    refusals.push('refused: the import frames need the page quotes (--page-quotes), naming a file that exists');
  }
  if (refusals.length > 0) { throw new Refused(refusals); }
  const scratch = path.resolve(opts.scratch as string);
  if (fs.existsSync(scratch) && fs.readdirSync(scratch).length > 0) {
    throw new Refused([`refused: the scratch directory ${scratch} is not empty; the capture lays every folder it opens out afresh`]);
  }
  fs.mkdirSync(path.join(scratch, 'runner-tmp'), { recursive: true });
  process.env.TMPDIR = path.join(scratch, 'runner-tmp');
  markRunnerEnvironment();
  const bin = path.join(scratch, 'bin', 'aggrega');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.copyFileSync(opts.inputs.compiler as string, bin);
  fs.chmodSync(bin, 0o755);
  const checked = checkInputs({ ...opts.inputs, compiler: bin, scratch }, { catalog: 'optional', registryServer: false });
  if ('refusals' in checked) {
    throw new Refused(checked.refusals.map((r) => `refused: ${r.input} (${r.option}): ${r.reason}; ${r.remedy}`));
  }
  const libs = checkLibraries(checked.inputs.editor.executable);
  const refusal = libraryRefusal(libs);
  if (refusal !== null) { throw new Refused([`refused: ${refusal}`]); }
  const report = await captureDocs({
    inputs: checked.inputs, scratch, out: path.resolve(opts.out as string), docs: path.resolve(opts.docs as string),
    groups: groups as Group[], importerCatalog: opts.importerCatalog, pageQuotes: opts.pageQuotes,
  });
  const taken = report.frames.filter((f) => f.written);
  const { extensionBuild, compiler, editor, catalog } = header(checked.inputs);
  const summary = [
    `capture-docs: ${taken.length} of ${report.frames.length} frames written in ${Math.round(report.elapsedMs / 1000)} s`,
    `  extension ${extensionBuild}; compiler ${compiler}; editor ${editor}; catalog ${catalog}`,
    ...report.frames.map((f) => `  ${f.written ? 'written' : 'NOT TAKEN'} ${f.file} — ${f.what}${f.how ? ` (${f.how})` : ''}${f.error ? `: ${f.error}` : ''}`),
  ];
  fs.writeFileSync(path.join(scratch, 'capture.json'), `${JSON.stringify({ header: header(checked.inputs), ...report }, null, 2)}\n`);
  process.stdout.write(`${summary.join('\n')}\n`);
  return taken.length === report.frames.length ? 0 : 1;
}

function stopEverything(signal: NodeJS.Signals): void {
  for (const t of active) {
    for (const r of t.alive()) { try { process.kill(r.pid, 'SIGKILL'); } catch { /* gone */ } }
  }
  process.stderr.write(`interrupted by ${signal}; every recorded process was sent SIGKILL\n`);
  process.exit(130);
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  process.on('SIGINT', () => stopEverything('SIGINT'));
  process.on('SIGTERM', () => stopEverything('SIGTERM'));
  switch (opts.command) {
    case 'inputs': return commandInputs(opts);
    case 'fetch-editor': return commandFetchEditor(opts);
    case 'calibrate': return commandCalibrate(opts);
    case 'probe': return commandProbe(opts);
    case 'teardown-study': return commandTeardownStudy(opts);
    case 'suite': return commandSuite(opts);
    case 'plants': return commandPlants(opts);
    case 'checklist': return commandChecklist();
    case 'compare': return commandCompare(opts);
    case 'capture-docs': return commandCaptureDocs(opts);
    default: throw new Usage(`unknown command ${JSON.stringify(opts.command)}; the commands are inputs, fetch-editor, calibrate, probe, teardown-study, suite, plants, checklist, compare and capture-docs`);
  }
}

main().then((rc) => process.exit(rc), (err: unknown) => {
  if (err instanceof Refused) {
    process.stderr.write(`${err.lines.join('\n')}\n`);
    process.exit(2);
  }
  if (err instanceof PlantRefused) {
    // A plant refused inside a scenario is reported by the scenario; one that
    // reaches here was refused before anything launched.
    process.stderr.write(`refused: ${err.message}\n`);
    process.exit(2);
  }
  if (err instanceof Usage) {
    process.stderr.write(`${err.message}\nsee the header of test/e2e/run.ts for the commands and options\n`);
    process.exit(2);
  }
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  for (const t of active) {
    for (const r of t.alive()) { try { process.kill(r.pid, 'SIGKILL'); } catch { /* gone */ } }
  }
  process.exit(1);
});
