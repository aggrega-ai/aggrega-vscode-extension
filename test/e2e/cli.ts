// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// The compiler run as a command by the runner itself, to build a fixture or to
// read what the compiler says about an input the editor is shown.
//
// 🔴 EVERY RUN IS CONTAINED IN THE SCENARIO'S SCRATCH HOME. HOME, every XDG
// directory and TMPDIR are the scenario's, and nothing else is inherited, so a
// run can write neither the developer's cache, configuration or credential store
// nor anything outside the scratch root. A run that inherited the developer's
// environment would also read the developer's global configuration, and the
// fixture it built would then depend on the machine.

// ScratchHome is the home directory a scenario's processes are given.
export interface ScratchHome {
  home: string;
  tmp: string;
}

// cliEnvironment is the whole environment a runner-started compiler runs with.
export function cliEnvironment(h: ScratchHome, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: '/usr/bin:/bin',
    HOME: h.home,
    XDG_CONFIG_HOME: path.join(h.home, '.config'),
    XDG_CACHE_HOME: path.join(h.home, '.cache'),
    XDG_DATA_HOME: path.join(h.home, '.local', 'share'),
    XDG_STATE_HOME: path.join(h.home, '.local', 'state'),
    TMPDIR: h.tmp,
    LANG: 'C.UTF-8',
    NO_COLOR: '1',
    TZ: 'UTC',
    ...extra,
  };
}

// CliRun is one finished invocation.
export interface CliRun {
  args: string[];
  cwd: string;
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}

// endingOf words how one invocation ended and after how long: its exit status,
// or the signal that ended it — the one a run killed at its bound gets is SIGKILL —
// or, where it could not be started, that it has neither.
export function endingOf(run: CliRun): string {
  const how = run.status !== null ? `exit ${run.status}` : run.signal !== null ? `ended by ${run.signal}` : 'ended with no exit status and no signal';
  return `${how} after ${run.elapsedMs} ms`;
}

// runCompiler runs the compiler once, bounded, in `cwd`, and records the
// invocation in `log`. It never throws for a non-zero exit: what the compiler
// said is the result, and the caller decides what it means.
export function runCompiler(
  binary: string,
  args: string[],
  opts: { cwd: string; home: ScratchHome; boundMs: number; log: string; env?: Record<string, string> },
): Promise<CliRun> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(binary, args, { cwd: opts.cwd, env: cliEnvironment(opts.home, opts.env), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, opts.boundMs);
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      const run: CliRun = { args, cwd: opts.cwd, status, signal, stdout, stderr, elapsedMs: Date.now() - t0 };
      fs.appendFileSync(opts.log, `$ aggrega ${args.join(' ')}   (cwd: ${opts.cwd})\n${stdout}${stderr}-- ${endingOf(run)}\n\n`);
      resolve(run);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ args, cwd: opts.cwd, status: null, signal: null, stdout, stderr: `${stderr}${err.message}`, elapsedMs: Date.now() - t0 });
    });
  });
}

// makeScratchHome lays out a home directory with its XDG directories.
export function makeScratchHome(dir: string): ScratchHome {
  const home = path.join(dir, 'home');
  const tmp = path.join(home, 'tmp');
  for (const d of [
    path.join(home, '.config'), path.join(home, '.cache'), path.join(home, '.local', 'share'),
    path.join(home, '.local', 'state'), tmp,
  ]) {
    fs.mkdirSync(d, { recursive: true });
  }
  return { home, tmp };
}
