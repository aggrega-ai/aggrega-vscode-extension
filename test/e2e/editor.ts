// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

import { Inputs } from './inputs';
import { PROBE_PORT_ENV } from './probe/protocol';
import { ProcessTable, readEnviron } from './processes';

// One editor launch: the scratch root it lives in, the environment and arguments
// it is started with, the extension copies it loads, and the profile it starts
// from.
//
// 🔴 EVERYTHING A LAUNCH WRITES LIVES UNDER ITS SCRATCH ROOT, AND ITS ENVIRONMENT
// IS STATED IN FULL. The developer's shell carries variables that change what the
// editor binary does — one makes it run as a plain script host, one points it at
// a display, several make it believe it is a child of another editor — so nothing
// is inherited: the editor starts under `env -i` with exactly the variables below.

// ScenarioRoot is the directory layout of one launch.
export interface ScenarioRoot {
  dir: string;
  // home is HOME and the editor's working directory.
  home: string;
  // runtimeDirName is XDG_RUNTIME_DIR as the editor is given it: relative to
  // `home`. The editor composes its IPC socket path inside that directory, and a
  // socket path longer than 107 bytes cannot be bound; a deep scratch path made
  // absolute would exceed it.
  runtimeDirName: string;
  tmp: string;
  userData: string;
  extensionsDir: string;
  extensionCopy: string;
  probeCopy: string;
  bin: string;
  logs: string;
  stateFile: string;
}

// createScenarioRoot lays out a fresh scratch root for one launch under `runDir`.
export function createScenarioRoot(runDir: string, name: string): ScenarioRoot {
  const dir = path.join(runDir, name);
  if (fs.existsSync(dir)) { throw new Error(`the scratch root ${dir} already exists`); }
  const home = path.join(dir, 'home');
  const root: ScenarioRoot = {
    dir,
    home,
    runtimeDirName: 'run',
    tmp: path.join(home, 'tmp'),
    userData: path.join(dir, 'profile', 'user-data'),
    extensionsDir: path.join(dir, 'profile', 'extensions'),
    extensionCopy: path.join(dir, 'extension'),
    probeCopy: path.join(dir, 'probe'),
    bin: path.join(dir, 'bin'),
    logs: path.join(dir, 'logs'),
    stateFile: path.join(dir, 'processes.json'),
  };
  for (const d of [
    path.join(home, '.config'), path.join(home, '.cache'), path.join(home, '.local', 'share'),
    path.join(home, '.local', 'state'), path.join(home, '.vscode'), path.join(home, 'no-gio-modules'),
    root.tmp, path.join(root.userData, 'User'), root.extensionsDir, root.bin, root.logs,
  ]) {
    fs.mkdirSync(d, { recursive: true });
  }
  fs.mkdirSync(path.join(home, root.runtimeDirName), { recursive: true, mode: 0o700 });
  return root;
}

// copyExtension copies the compiled extension into the scratch root, so another
// actor rebuilding the repository's output mid-run cannot change what is under
// test. It copies what the packaged extension carries from the compiled output —
// everything under out/ except the test outputs — with the manifest, the media
// and the build stamp, and links the dependencies rather than copying them.
export function copyExtension(extensionDir: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(extensionDir, 'package.json'), path.join(dest, 'package.json'));
  fs.cpSync(path.join(extensionDir, 'media'), path.join(dest, 'media'), { recursive: true });
  const out = path.join(extensionDir, 'out');
  const skipped = new Set([path.join(out, 'test'), path.join(out, 'test-fixtures')]);
  fs.cpSync(out, path.join(dest, 'out'), { recursive: true, filter: (src) => !skipped.has(src) });
  fs.symlinkSync(path.join(extensionDir, 'node_modules'), path.join(dest, 'node_modules'));
}

// copyProbe assembles the probe extension in the scratch root from its manifest
// and its compiled modules.
export function copyProbe(extensionDir: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(path.join(extensionDir, 'test', 'e2e', 'probe', 'package.json'), path.join(dest, 'package.json'));
  const compiled = path.join(extensionDir, 'out', 'test', 'e2e', 'probe');
  for (const f of fs.readdirSync(compiled).filter((n) => n.endsWith('.js'))) {
    fs.copyFileSync(path.join(compiled, f), path.join(dest, f));
  }
}

// BASELINE_SETTINGS is the profile every launch starts from. The two dialog
// settings draw a modal dialog and a file dialog inside the workbench, where
// they can be read and answered, instead of natively, where what the headless
// platform does with them is unknown and a dialog nobody can see would stall the
// run. Telemetry, updates, recommendations and workspace trust are off, and the
// editor opens nothing of its own at start. No Aggrega setting is set here except
// the path of the binary under test, which writeProfile adds, so a check about an
// Aggrega default reads the real default. Each value is spelled the way this
// editor build spells it: an older spelling is migrated by the editor at start,
// which rewrites the profile's settings file behind the run's back.
export const BASELINE_SETTINGS: Readonly<Record<string, unknown>> = {
  'window.dialogStyle': 'custom',
  'files.simpleDialog.enable': true,
  'telemetry.telemetryLevel': 'off',
  'update.mode': 'none',
  'update.showReleaseNotes': false,
  'extensions.autoUpdate': 'off',
  'extensions.autoCheckUpdates': false,
  'extensions.ignoreRecommendations': true,
  'security.workspace.trust.enabled': false,
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.enableExperiments': false,
  'workbench.colorTheme': 'Dark Modern',
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'window.restoreWindows': 'none',
  'window.titleBarStyle': 'custom',
  'chat.disableAIFeatures': true,
  'git.enabled': false,
  'npm.autoDetect': 'off',
};

// AGGREGA_BINARY_SETTING is the one Aggrega setting the baseline sets.
export const AGGREGA_BINARY_SETTING = 'aggrega.server.binaryPath';

// writeProfile writes the profile's user settings: the baseline and the binary
// under test.
export function writeProfile(root: ScenarioRoot, inputs: Inputs): Record<string, unknown> {
  const settings = { ...BASELINE_SETTINGS, [AGGREGA_BINARY_SETTING]: inputs.compiler.path };
  fs.writeFileSync(path.join(root.userData, 'User', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
  // The editor writes this file on first start when it is absent, with a crash
  // reporter identity in it; writing it first keeps the reporter off and the key
  // store in a plain file inside the scratch home.
  fs.writeFileSync(path.join(root.home, '.vscode', 'argv.json'), `${JSON.stringify({ 'enable-crash-reporter': false, 'password-store': 'basic' }, null, 2)}\n`);
  fs.symlinkSync(inputs.compiler.path, path.join(root.bin, 'aggrega'));
  return settings;
}

// editorEnvironment is the whole environment the editor is started with.
export function editorEnvironment(root: ScenarioRoot, probePort: number): Record<string, string> {
  const user = os.userInfo().username;
  return {
    HOME: root.home,
    USER: user,
    LOGNAME: user,
    SHELL: '/bin/bash',
    LANG: 'C.UTF-8',
    // Stated rather than inherited from the machine, so a time the editor writes
    // into its log names and its output reads the same everywhere.
    TZ: 'UTC',
    // The binary under test comes first, so a terminal the extension opens runs
    // the same compiler the language server is.
    PATH: `${root.bin}:/usr/bin:/bin`,
    XDG_CONFIG_HOME: path.join(root.home, '.config'),
    XDG_CACHE_HOME: path.join(root.home, '.cache'),
    XDG_DATA_HOME: path.join(root.home, '.local', 'share'),
    XDG_STATE_HOME: path.join(root.home, '.local', 'state'),
    XDG_RUNTIME_DIR: root.runtimeDirName,
    TMPDIR: root.tmp,
    // No settings daemon, no accessibility bus and no session bus exist here, and
    // the platform libraries would otherwise try each of them at start.
    GSETTINGS_BACKEND: 'memory',
    GIO_MODULE_DIR: path.join(root.home, 'no-gio-modules'),
    NO_AT_BRIDGE: '1',
    DBUS_SESSION_BUS_ADDRESS: 'disabled:',
    [PROBE_PORT_ENV]: String(probePort),
  };
}

// LaunchShape is the part of the command line a scenario chooses.
export interface LaunchShape {
  folder: string;
  screen: { width: number; height: number };
}

// editorArguments is the editor's command line, without the debugging port, which
// the runner adds when it launches the editor itself.
export function editorArguments(root: ScenarioRoot, shape: LaunchShape): string[] {
  return [
    '--ozone-platform=headless',
    `--ozone-override-screen-size=${shape.screen.width},${shape.screen.height}`,
    '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    // A window with no display is never visible, and a window the platform thinks
    // is hidden has its timers throttled, which turns every bounded wait into a
    // timing-dependent verdict.
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling',
    '--password-store=basic',
    // The editor otherwise starts a login shell to read "the user's environment"
    // and merges what it prints into the extension host's; the environment above
    // is the whole environment, so it is kept as stated.
    '--force-disable-user-env',
    `--user-data-dir=${root.userData}`,
    `--extensions-dir=${root.extensionsDir}`,
    `--extensionDevelopmentPath=${root.extensionCopy}`,
    `--extensionDevelopmentPath=${root.probeCopy}`,
    '--disable-extensions',
    '--disable-workspace-trust',
    '--skip-welcome', '--skip-release-notes', '--disable-telemetry', '--disable-updates', '--disable-crash-reporter',
    '--new-window', shape.folder,
  ];
}

// freePort asks the kernel for a loopback port nobody holds.
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

// Launch is one editor the runner started itself.
export interface Launch {
  root: ScenarioRoot;
  table: ProcessTable;
  debugPort: number;
  probePort: number;
  env: Record<string, string>;
  args: string[];
  pid: number;
  startedAt: number;
}

// launchEditor starts the editor under `env -i` with the stated environment,
// records it as the root of its own session, and returns once the debugging
// endpoint answers.
export async function launchEditor(root: ScenarioRoot, inputs: Inputs, shape: LaunchShape, boundMs = 60000): Promise<Launch> {
  const debugPort = await freePort();
  const probePort = await freePort();
  const env = editorEnvironment(root, probePort);
  const args = [...editorArguments(root, shape), `--remote-debugging-port=${debugPort}`];
  const log = fs.openSync(path.join(root.logs, 'editor.log'), 'a');
  const kv = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  const startedAt = Date.now();
  // A new session makes every process the editor starts findable as a member of
  // it, as well as by descent.
  const child = spawn('/usr/bin/env', ['-i', ...kv, inputs.editor.executable, ...args], {
    cwd: root.home,
    env: {},
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  fs.closeSync(log);
  if (child.pid === undefined) { throw new Error('the editor could not be started'); }
  const table = new ProcessTable(root.stateFile);
  const pid = child.pid;
  const executable = fs.realpathSync(inputs.editor.executable);
  // `env` replaces itself with the editor, keeping its PID; the root is recorded
  // once it has, so the record names the editor rather than the launcher.
  await waitFor(() => {
    if (fs.readlinkSync(`/proc/${pid}/exe`) !== executable) { throw new Error(`process ${pid} has not started the editor yet`); }
    return table.addRoot('editor', pid);
  }, 5000);
  const launch: Launch = { root, table, debugPort, probePort, env, args, pid, startedAt };
  try {
    await waitForDebugEndpoint(launch, boundMs);
  } catch (err) {
    // An editor that never became drivable is still stopped by identity.
    await table.teardown({ closeBoundMs: 0, termBoundMs: 3000, killBoundMs: 2000 });
    throw err;
  }
  table.snapshot();
  return launch;
}

async function waitFor<T>(attempt: () => T, boundMs: number): Promise<T> {
  const until = Date.now() + boundMs;
  for (;;) {
    try {
      return attempt();
    } catch (err) {
      if (Date.now() >= until) { throw err; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

// waitForDebugEndpoint polls the editor's debugging endpoint until it answers,
// and stops early if every recorded process has exited.
export async function waitForDebugEndpoint(launch: Launch, boundMs: number): Promise<void> {
  const until = Date.now() + boundMs;
  let last = 'no answer';
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://127.0.0.1:${launch.debugPort}/json/version`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) { return; }
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    launch.table.snapshot();
    if (launch.table.alive().length === 0) {
      throw new Error(`the editor exited before its debugging endpoint answered; see ${path.join(launch.root.logs, 'editor.log')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`the editor's debugging endpoint did not answer within ${boundMs} ms (${last})`);
}

// RUNNER_ONLY_ENV names a variable the runner sets in its own environment and
// never states for the editor. Finding it in a process the editor started would
// mean the runner's environment reached the editor.
export const RUNNER_ONLY_ENV = 'AGGREGA_EDITOR_SUITE_RUNNER_ONLY';

// markRunnerEnvironment sets that variable in the runner's own environment.
export function markRunnerEnvironment(): void {
  process.env[RUNNER_ONLY_ENV] = `set by the runner, process ${process.pid}`;
}

// EnvironmentReading is what one process of the editor's tree actually runs
// with, against what the runner stated.
export interface EnvironmentReading {
  pid: number;
  // statedButDifferent lists each stated variable the process lacks or holds a
  // different value for.
  statedButDifferent: string[];
  // runnerOnlyVariable says whether the runner's own marker reached the process:
  // what `env -i` exists to stop.
  runnerOnlyVariable: 'absent' | 'present';
  // added lists the variables the process holds beyond the stated ones: the ones
  // the editor sets for the processes it starts. Some of them carry the same
  // value the runner's own environment does when the runner itself runs inside
  // an editor, which is why the marker, not a comparison of values, is what
  // decides whether anything was inherited.
  added: string[];
}

// readEnvironment reads a process's environment and sorts it against the stated
// one, so "nothing inherited" is read from a running process rather than assumed
// from how the editor was spawned.
//
// The editor's own main process is not a usable subject: it writes its process
// title over the memory its environment was read from, so the kernel reports
// that memory as empty. A process the editor started, such as the language
// server, still carries the environment it was given.
export function readEnvironment(pid: number, stated: Record<string, string>): EnvironmentReading {
  const actual = readEnviron(pid);
  return {
    pid,
    statedButDifferent: Object.keys(stated).filter((k) => actual[k] !== stated[k]).sort(),
    runnerOnlyVariable: RUNNER_ONLY_ENV in actual ? 'present' : 'absent',
    added: Object.keys(actual).filter((k) => !(k in stated)).sort(),
  };
}

// sameArguments reports whether a command line, as the process reports it,
// holds exactly the stated executable and arguments. The editor reports its
// command line as one string with its options moved ahead of the folder, so
// the comparison is of the words, not of their order.
export function sameArguments(reported: string, executable: string, args: string[]): boolean {
  const a = reported.split(' ').filter((w) => w !== '').sort();
  const b = [executable, ...args].sort();
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

// languageServer finds the language server among the recorded processes: the
// descendant whose command line is the binary under test followed by `serve`.
export function languageServer(table: ProcessTable, compiler: string): { pid: number; cmd: string } | null {
  table.snapshot();
  const hit = table.alive().find((r) => r.cmd === `${compiler} serve` || r.cmd.startsWith(`${compiler} serve `));
  return hit ? { pid: hit.pid, cmd: hit.cmd } : null;
}
