// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as fs from 'fs';
import * as path from 'path';

import { writeCalibrationFolder } from './calibration';
import { connectOverDevTools, launchWithElectron, UiDriver } from './drivers';
import {
  copyExtension, copyProbe, createScenarioRoot, editorArguments, editorEnvironment, freePort,
  languageServer, launchEditor, LaunchShape, readEnvironment, sameArguments, ScenarioRoot, writeProfile,
} from './editor';
import { Inputs } from './inputs';
import { Hello, ProbeClient } from './probe-client';
import { ProcessTable, readCmdline, readEnviron, TeardownReport } from './processes';
import { ResourceReport, ResourceSampler } from './resources';
import { observeWorkbench } from './workbench';

// One launched editor: bring-up from an empty scratch root to a probe that
// answers, and teardown that leaves nothing the runner started alive.

export const SCREEN = { width: 1600, height: 1000 };

// Scenario is one launched editor, with what the runner holds of it.
export interface Scenario {
  name: string;
  root: ScenarioRoot;
  table: ProcessTable;
  probe: ProbeClient;
  driver: UiDriver | null;
  hello: Hello;
  folder: string;
  settings: Record<string, unknown>;
  // environment is what the scenario adds to the editor's environment, which a
  // second launch of the same scenario is started with too.
  environment: Readonly<Record<string, string>>;
  bringUpMs: number;
  display: DisplayReading;
  resources: ResourceSampler;
  close: () => Promise<void>;
}

// DisplayReading says which display variables the editor was given and which
// reached the language server it started. The editor draws on the headless
// platform, so both lists are expected empty; a display the developer's shell
// names is not handed on.
export interface DisplayReading {
  stated: string[];
  languageServer: string[] | null;
}

const DISPLAY_VARIABLES = ['DISPLAY', 'WAYLAND_DISPLAY'];

// BringUpOptions are what a scenario chooses beyond the baseline: the folder the
// window opens (the calibration folder where none is given), the root it was
// prepared in, and the settings it changes, each named in its report. beforeLaunch
// runs once the extension has been copied into the scratch root and before the
// editor starts, so an edit made to the copy there is what the editor loads.
// observers are evaluated in the workbench as soon as it is reachable, beside the
// status and notification observers, for a scenario whose checks read what the
// editor drew while the extension was still starting. environment is what the
// scenario adds to the editor's environment.
export interface BringUpOptions {
  root?: ScenarioRoot;
  folder?: string;
  settings?: Record<string, unknown>;
  beforeLaunch?: (root: ScenarioRoot) => void;
  observers?: readonly string[];
  environment?: Readonly<Record<string, string>>;
}

// ScenarioEnd is what tearing a launch down reports: the teardown itself and what
// the launch used.
export interface ScenarioEnd extends TeardownReport {
  resources: ResourceReport;
}

// active holds the process tables of every editor still up, so an interrupted
// run stops what it started.
export const active = new Set<ProcessTable>();

export async function bringUp(name: string, inputs: Inputs, runDir: string, driverName: string | null, opts: BringUpOptions = {}): Promise<Scenario> {
  const t0 = Date.now();
  const root = opts.root ?? createScenarioRoot(runDir, name);
  copyExtension(inputs.extension.dir, root.extensionCopy);
  copyProbe(inputs.extension.dir, root.probeCopy);
  if (opts.beforeLaunch) { opts.beforeLaunch(root); }
  const settings = writeProfile(root, inputs, opts.settings ?? {});
  const folder = opts.folder ?? writeCalibrationFolder(path.join(root.dir, 'folder'), inputs.catalog.dir).folder;
  const added = opts.environment ?? {};
  const shape: LaunchShape = { folder, screen: SCREEN };
  let table: ProcessTable;
  let probe: ProbeClient;
  let driver: UiDriver | null = null;
  let electronClose: (() => Promise<void>) | null = null;
  let stated: { env: Record<string, string>; args: string[]; pid: number };
  let debugPort = 0;
  if (driverName === 'playwright-electron') {
    const probePort = await freePort();
    const env = editorEnvironment(root, probePort, added);
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
    const launch = await launchEditor(root, inputs, shape, 60000, undefined, added);
    table = launch.table;
    probe = new ProbeClient(launch.probePort);
    stated = { env: launch.env, args: launch.args, pid: launch.pid };
    debugPort = launch.debugPort;
  }
  active.add(table);
  const resources = new ResourceSampler(table, inputs.compiler.path);
  resources.start();
  let hello: Hello;
  try {
    if (driverName === 'playwright-devtools') { driver = await connectOverDevTools(debugPort, 30000); }
    // The observers go in as soon as the workbench is reachable, so a
    // notification or a status reading drawn while the extension starts is
    // recorded rather than missed.
    if (driver !== null) {
      await observeWorkbench(driver);
      for (const o of opts.observers ?? []) { await driver.workbench(o); }
    }
    hello = await probe.waitHello(60000);
  } catch (err) {
    // A launch that never became drivable is still stopped by identity.
    await table.teardown({ closeBoundMs: 0, termBoundMs: 3000, killBoundMs: 2000 });
    resources.stop();
    active.delete(table);
    await driver?.detach().catch(() => undefined);
    if (electronClose) { await electronClose(); }
    throw err;
  }
  table.snapshot();
  const commandLine = readCmdline(stated.pid);
  const server = await waitForServer(table, inputs.compiler.path, 30000);
  const serverEnvironment = server ? readEnviron(server.pid) : null;
  const display: DisplayReading = {
    stated: DISPLAY_VARIABLES.filter((k) => k in stated.env),
    languageServer: serverEnvironment === null ? null : DISPLAY_VARIABLES.filter((k) => k in serverEnvironment),
  };
  fs.writeFileSync(path.join(root.logs, 'launch.json'), `${JSON.stringify({
    rootPid: stated.pid,
    executable: inputs.editor.executable,
    cwd: root.home,
    folder,
    settings,
    statedEnvironment: stated.env,
    environmentOfTheLanguageServer: server ? readEnvironment(server.pid, stated.env) : 'the language server did not start within 30000 ms',
    statedArguments: stated.args,
    commandLineAsStarted: commandLine,
    commandLineIsTheStatedOne: sameArguments(commandLine, inputs.editor.executable, stated.args),
    display,
    probe: hello,
  }, null, 2)}\n`);
  return {
    name, root, table, probe, driver, hello, folder, settings, environment: added, display, resources,
    bringUpMs: Date.now() - t0,
    close: async () => {
      await driver?.detach().catch(() => undefined);
      if (electronClose) { await electronClose(); }
    },
  };
}

// Relaunched is what closing the editor and starting it again took.
export interface Relaunched {
  // closed is the close: how long the editor took to leave, and what it left
  // alive, which is nothing where the close was clean.
  closed: TeardownReport;
  bringUpMs: number;
}

// relaunch closes the editor a scenario holds, as a person closes the window,
// and starts it again on the same profile, folder and extension copy, as a
// person opens it again: whatever the editor keeps between two starts — which
// views were revealed, the settings, what a window remembers — is kept. Both
// launches are recorded in the scenario's one process table and sampled by its
// one resource reading, so the report covers them together and the scenario's
// teardown stops the second.
//
// 🔴 THE OBSERVERS GO IN AS SOON AS THE NEW WORKBENCH IS REACHABLE, AND BEFORE
// THE EXTENSION HAS DRAWN ANYTHING. A reading that lasts only while the editor
// comes up is exactly what a reopened window is walked for, so `observers` are
// evaluated in the workbench beside the status and notification observers, and
// the extension host is still starting when they are.
export async function relaunch(s: Scenario, inputs: Inputs, observers: readonly string[] = []): Promise<Relaunched> {
  const closed = await s.table.teardown({
    close: async () => {
      await s.probe.request('command.run', { command: 'workbench.action.quit' }, 3000).catch(() => undefined);
    },
    closeBoundMs: 8000,
    termBoundMs: 3000,
    killBoundMs: 2000,
  });
  await s.close();
  const t0 = Date.now();
  const launch = await launchEditor(s.root, inputs, { folder: s.folder, screen: SCREEN }, 60000, s.table, s.environment);
  const driver = await connectOverDevTools(launch.debugPort, 30000);
  await observeWorkbench(driver);
  for (const o of observers) { await driver.workbench(o); }
  const probe = new ProbeClient(launch.probePort);
  s.hello = await probe.waitHello(60000);
  s.probe = probe;
  s.driver = driver;
  s.close = async () => { await driver.detach().catch(() => undefined); };
  s.table.snapshot();
  return { closed, bringUpMs: Date.now() - t0 };
}

export async function tearDown(s: Scenario): Promise<ScenarioEnd> {
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
  return { ...report, resources: s.resources.stop() };
}

export async function waitForServer(table: ProcessTable, compiler: string, boundMs: number): Promise<{ pid: number; cmd: string } | null> {
  const until = Date.now() + boundMs;
  while (Date.now() < until) {
    const hit = languageServer(table, compiler);
    if (hit) { return hit; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}
