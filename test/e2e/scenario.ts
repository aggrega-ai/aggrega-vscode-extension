// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

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
import { ProcessTable, readCmdline, TeardownReport } from './processes';
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
  bringUpMs: number;
  close: () => Promise<void>;
}

// BringUpOptions are what a scenario chooses beyond the baseline: the folder the
// window opens (the calibration folder where none is given), the root it was
// prepared in, and the settings it changes, each named in its report.
export interface BringUpOptions {
  root?: ScenarioRoot;
  folder?: string;
  settings?: Record<string, unknown>;
}

// active holds the process tables of every editor still up, so an interrupted
// run stops what it started.
export const active = new Set<ProcessTable>();

export async function bringUp(name: string, inputs: Inputs, runDir: string, driverName: string | null, opts: BringUpOptions = {}): Promise<Scenario> {
  const t0 = Date.now();
  const root = opts.root ?? createScenarioRoot(runDir, name);
  copyExtension(inputs.extension.dir, root.extensionCopy);
  copyProbe(inputs.extension.dir, root.probeCopy);
  const settings = writeProfile(root, inputs, opts.settings ?? {});
  const folder = opts.folder ?? writeCalibrationFolder(path.join(root.dir, 'folder'), inputs.catalog.dir).folder;
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
  let hello: Hello;
  try {
    if (driverName === 'playwright-devtools') { driver = await connectOverDevTools(debugPort, 30000); }
    // The observers go in as soon as the workbench is reachable, so a
    // notification or a status reading drawn while the extension starts is
    // recorded rather than missed.
    if (driver !== null) { await observeWorkbench(driver); }
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
    folder,
    settings,
    statedEnvironment: stated.env,
    environmentOfTheLanguageServer: server ? readEnvironment(server.pid, stated.env) : 'the language server did not start within 30000 ms',
    statedArguments: stated.args,
    commandLineAsStarted: commandLine,
    commandLineIsTheStatedOne: sameArguments(commandLine, inputs.editor.executable, stated.args),
    probe: hello,
  }, null, 2)}\n`);
  return {
    name, root, table, probe, driver, hello, folder, settings,
    bringUpMs: Date.now() - t0,
    close: async () => {
      await driver?.detach().catch(() => undefined);
      if (electronClose) { await electronClose(); }
    },
  };
}

export async function tearDown(s: Scenario): Promise<TeardownReport> {
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

export async function waitForServer(table: ProcessTable, compiler: string, boundMs: number): Promise<{ pid: number; cmd: string } | null> {
  const until = Date.now() + boundMs;
  while (Date.now() < until) {
    const hit = languageServer(table, compiler);
    if (hit) { return hit; }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}
