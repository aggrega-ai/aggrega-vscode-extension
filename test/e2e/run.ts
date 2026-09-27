// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { NeedleResult, runNeedles, writeCalibrationFolder } from './calibration';
import { connectOverDevTools, launchWithElectron, UiDriver } from './drivers';
import {
  createScenarioRoot, copyExtension, copyProbe, editorArguments, editorEnvironment, freePort,
  languageServer, launchEditor, LaunchShape, markRunnerEnvironment, readEnvironment, sameArguments, ScenarioRoot,
  writeProfile,
} from './editor';
import { checkInputs, EDITOR_VERSION, INPUT_NAMES, InputOptions, Inputs, REPO_ROOT } from './inputs';
import { checkLibraries, libraryRefusal, LibraryReport } from './libraries';
import { ProbeClient } from './probe-client';
import { runProbeProofs } from './probe-proofs';
import { ProcessTable, readCmdline, TeardownReport } from './processes';

// The editor suite's runner: launches the real editor with no display, drives it
// from outside, and reports what it read.
//
//   npm run test:e2e -- <command> [options]
//
// Commands:
//   inputs          check every input and the editor's libraries, and print the
//                   identity a report would be headed with
//   fetch-editor    download the editor build into the extension's .vscode-test
//   calibrate       take the seven calibration readings with each UI driver
//   probe           prove the probe answers, matches the Problems panel and
//                   survives a window reload
//   teardown-study  signal the editor alone and watch which process outlives it
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
//                            (calibrate: all; probe: playwright-devtools)
//
// Exit status: 0 when every reading passed, 1 when one failed, 2 when the run was
// refused before it launched anything.

const SCREEN = { width: 1600, height: 1000 };
const DRIVERS = ['playwright-devtools', 'playwright-electron'];

interface Options {
  command: string;
  scratch?: string;
  driver?: string;
  inputs: Omit<InputOptions, 'scratch'>;
}

function parseArgs(argv: string[]): Options {
  const [command = '', ...rest] = argv;
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--') || i + 1 >= rest.length) { throw new Usage(`unexpected argument ${a}`); }
    flags[a.slice(2)] = rest[++i];
  }
  const known = new Set(['scratch', 'driver', 'extension', 'compiler', 'compiler-commit', 'catalog', 'registry-server', 'editor']);
  for (const k of Object.keys(flags)) { if (!known.has(k)) { throw new Usage(`unknown option --${k}`); } }
  if (flags.driver !== undefined && flags.driver !== 'all' && !DRIVERS.includes(flags.driver)) {
    throw new Usage(`unknown driver ${flags.driver}; the drivers are ${DRIVERS.join(', ')}, or all`);
  }
  const pick = (flag: string, env: string): string | undefined => flags[flag] ?? (process.env[env] || undefined);
  return {
    command,
    scratch: pick('scratch', 'AGGREGA_E2E_SCRATCH'),
    driver: flags.driver,
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
function prepareRun(opts: Options): { inputs: Inputs; runDir: string; libraries: LibraryReport } {
  if (!opts.scratch) {
    throw new Refused(['refused: no scratch directory was given (--scratch or AGGREGA_E2E_SCRATCH); the runner writes nowhere else']);
  }
  const runDir = path.join(path.resolve(opts.scratch), stamp());
  fs.mkdirSync(runDir, { recursive: true });
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
  return { inputs: checked.inputs, runDir, libraries: libs };
}

function header(inputs: Inputs): Record<string, string> {
  return {
    extensionBuild: inputs.extension.buildStamp,
    compiler: `${inputs.compiler.version} (commit ${inputs.compiler.commit})`,
    editor: `${inputs.editor.version} (commit ${inputs.editor.commit})`,
    catalog: `${inputs.catalog.commit}${inputs.catalog.uncommitted ? ', in a checkout with uncommitted changes' : ''}`,
    registryServer: inputs.registryServer.version,
  };
}

// Scenario is one launched editor, with what the runner holds of it.
interface Scenario {
  root: ScenarioRoot;
  table: ProcessTable;
  probe: ProbeClient;
  driver: UiDriver | null;
  bringUpMs: number;
  close: () => Promise<void>;
}

async function bringUp(name: string, inputs: Inputs, runDir: string, driverName: string | null): Promise<Scenario> {
  const t0 = Date.now();
  const root = createScenarioRoot(runDir, name);
  copyExtension(inputs.extension.dir, root.extensionCopy);
  copyProbe(inputs.extension.dir, root.probeCopy);
  writeProfile(root, inputs);
  const { folder } = writeCalibrationFolder(path.join(root.dir, 'folder'), inputs.catalog.dir);
  const shape: LaunchShape = { folder, screen: SCREEN };
  let table: ProcessTable;
  let probe: ProbeClient;
  let driver: UiDriver | null = null;
  let electronClose: (() => Promise<void>) | null = null;
  let stated: { env: Record<string, string>; args: string[]; pid: number };
  let debugPort = 0;
  if (driverName === 'playwright-electron') {
    const probePort = await freePort();
    const env = editorEnvironment(root, probePort);
    const args = editorArguments(root, shape);
    const launched = await launchWithElectron({ executable: inputs.editor.executable, args, env, cwd: root.home, log: path.join(root.logs, 'editor.log'), boundMs: 60000 });
    table = new ProcessTable(root.stateFile);
    table.addRoot('editor', launched.pid);
    table.snapshot();
    probe = new ProbeClient(probePort);
    driver = launched.driver;
    electronClose = async () => { await launched.app.close().catch(() => undefined); };
    stated = { env, args, pid: launched.pid };
  } else {
    const launch = await launchEditor(root, inputs, shape);
    table = launch.table;
    probe = new ProbeClient(launch.probePort);
    stated = { env: launch.env, args: launch.args, pid: launch.pid };
    debugPort = launch.debugPort;
  }
  active.add(table);
  let hello: Awaited<ReturnType<ProbeClient['waitHello']>>;
  try {
    if (driverName === 'playwright-devtools') { driver = await connectOverDevTools(debugPort, 30000); }
    hello = await probe.waitHello(60000);
  } catch (err) {
    // A launch that never became drivable is still stopped by identity.
    await table.teardown({ closeBoundMs: 0, termBoundMs: 3000, killBoundMs: 2000 });
    active.delete(table);
    await driver?.detach().catch(() => undefined);
    if (electronClose) { await electronClose(); }
    throw err;
  }
  table.snapshot();
  const commandLine = readCmdline(stated.pid);
  const server = await waitForServer(table, inputs.compiler.path, 30000);
  fs.writeFileSync(path.join(root.logs, 'launch.json'), `${JSON.stringify({
    rootPid: stated.pid,
    executable: inputs.editor.executable,
    cwd: root.home,
    statedEnvironment: stated.env,
    environmentOfTheLanguageServer: server ? readEnvironment(server.pid, stated.env) : 'the language server did not start within 30000 ms',
    statedArguments: stated.args,
    commandLineAsStarted: commandLine,
    commandLineIsTheStatedOne: sameArguments(commandLine, inputs.editor.executable, stated.args),
    probe: hello,
  }, null, 2)}\n`);
  const bringUpMs = Date.now() - t0;
  return {
    root, table, probe, driver, bringUpMs,
    close: async () => {
      await driver?.detach().catch(() => undefined);
      if (electronClose) { await electronClose(); }
    },
  };
}

// active holds the process tables of every editor still up, so an interrupted
// run stops what it started.
const active = new Set<ProcessTable>();

async function tearDown(s: Scenario): Promise<TeardownReport> {
  const report = await s.table.teardown({
    // The clean close is the editor's own quit, asked through the probe: it
    // deactivates every extension, which stops the language server the Aggrega
    // extension started, and then exits the processes the editor started.
    close: async () => {
      await s.probe.request('command.run', { command: 'workbench.action.quit' }, 3000).catch(() => undefined);
    },
    closeBoundMs: 8000,
    termBoundMs: 3000,
    killBoundMs: 2000,
  });
  await s.close();
  active.delete(s.table);
  return report;
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

async function waitForServer(table: ProcessTable, compiler: string, boundMs: number): Promise<{ pid: number; cmd: string } | null> {
  const until = Date.now() + boundMs;
  while (Date.now() < until) {
    const hit = languageServer(table, compiler);
    if (hit) { return hit; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
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
    default: throw new Usage(`unknown command ${JSON.stringify(opts.command)}; the commands are inputs, fetch-editor, calibrate, probe and teardown-study`);
  }
}

main().then((rc) => process.exit(rc), (err: unknown) => {
  if (err instanceof Refused) {
    process.stderr.write(`${err.lines.join('\n')}\n`);
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
