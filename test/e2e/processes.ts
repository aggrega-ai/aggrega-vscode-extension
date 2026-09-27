// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';

// The process record of one editor launch.
//
// 🔴 A PROCESS IS IDENTIFIED BY ITS PID AND ITS START TIME, AND NOTHING HERE
// MATCHES A PROCESS BY ITS NAME. A PID alone is reused by the kernel once its
// process has gone, so signalling a remembered PID without its start time can stop
// a process this runner never started. Teardown signals exactly the records kept
// here; a process nobody recorded is never touched, whatever it is called.

// ProcStat is the part of /proc/<pid>/stat the record needs.
export interface ProcStat {
  pid: number;
  comm: string;
  state: string;
  ppid: number;
  session: number;
  // start is the start time in clock ticks since boot, as the kernel reports it.
  start: string;
}

// readStat reads one process's stat line, or null where the process is gone.
export function readStat(pid: number): ProcStat | null {
  let raw: string;
  try {
    raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return null;
  }
  // The command name sits in parentheses and may itself hold spaces or
  // parentheses, so the fields after it are read from the last closing one.
  const close = raw.lastIndexOf(')');
  const comm = raw.slice(raw.indexOf('(') + 1, close);
  const f = raw.slice(close + 2).split(' ');
  return { pid, comm, state: f[0], ppid: Number(f[1]), session: Number(f[3]), start: f[19] };
}

// readCmdline reads one process's command line, arguments joined by spaces.
export function readCmdline(pid: number): string {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter((s) => s !== '').join(' ');
  } catch {
    return '';
  }
}

// readEnviron reads one process's environment as it was when it started.
export function readEnviron(pid: number): Record<string, string> {
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
  } catch {
    return out;
  }
  for (const entry of raw.split('\0')) {
    if (entry === '') { continue; }
    const eq = entry.indexOf('=');
    out[eq === -1 ? entry : entry.slice(0, eq)] = eq === -1 ? '' : entry.slice(eq + 1);
  }
  return out;
}

// ProcRecord is one recorded process.
export interface ProcRecord {
  pid: number;
  start: string;
  comm: string;
  cmd: string;
  // via says how the process came to be recorded: as a root the runner started,
  // as a member of a root's session, or as a child of a recorded process.
  via: string;
  // seenMs is when the record was first taken, in milliseconds after the table
  // was created.
  seenMs: number;
}

// DeathRecord is when one recorded process was first seen gone during teardown.
export interface DeathRecord {
  pid: number;
  comm: string;
  cmd: string;
  goneMs: number;
}

// SignalRecord is one signal teardown sent, to one recorded process.
export interface SignalRecord {
  pid: number;
  comm: string;
  cmd: string;
  signal: string;
  atMs: number;
}

// TeardownReport is what one teardown did and how long each part took.
export interface TeardownReport {
  // closeMs is how long the clean close took to leave nothing alive, or null
  // where no clean close was attempted or it did not finish within its bound.
  closeMs: number | null;
  closeBoundMs: number;
  signals: SignalRecord[];
  deaths: DeathRecord[];
  recorded: number;
  stillAlive: ProcRecord[];
  elapsedMs: number;
}

function allPids(): number[] {
  return fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map(Number);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ProcessTable holds every process one launch started, written to a state file
// after each change so a separate reader can see what was recorded.
export class ProcessTable {
  private readonly records = new Map<string, ProcRecord>();
  private readonly roots: { name: string; pid: number; start: string }[] = [];
  private readonly t0 = Date.now();

  constructor(private readonly stateFile: string) {}

  // addRoot records a process the runner started itself. It throws where the
  // process is already gone, because a root that cannot be recorded cannot be
  // stopped by identity later.
  addRoot(name: string, pid: number): ProcRecord {
    const st = readStat(pid);
    if (st === null || st.state === 'Z') {
      throw new Error(`the ${name} process ${pid} exited before it could be recorded`);
    }
    this.roots.push({ name, pid, start: st.start });
    const rec = this.put(st, `root:${name}`);
    this.save();
    return rec;
  }

  // snapshot records every member of a root's session and every descendant of a
  // recorded process that is still alive, to a fixed point, and returns how many
  // records it added.
  snapshot(): number {
    const stats = allPids().map(readStat).filter((s): s is ProcStat => s !== null);
    let added = 0;
    for (const root of this.roots) {
      if (!this.isSame(root.pid, root.start)) { continue; }
      for (const st of stats) {
        if (st.session === root.pid && st.pid !== root.pid && this.record(st, `session:${root.name}`)) { added++; }
      }
    }
    let grew = true;
    while (grew) {
      grew = false;
      const live = new Set(this.alive().map((r) => r.pid));
      for (const st of stats) {
        if (live.has(st.ppid) && this.record(st, `child-of:${st.ppid}`)) { added++; grew = true; }
      }
    }
    if (added > 0) { this.save(); }
    return added;
  }

  // alive lists the recorded processes that are still the same processes.
  alive(): ProcRecord[] {
    return [...this.records.values()].filter((r) => this.isSame(r.pid, r.start));
  }

  // all lists every record, alive or gone, in the order they were taken.
  all(): ProcRecord[] {
    return [...this.records.values()];
  }

  // teardown stops every recorded process. Where `close` is given it is asked
  // first, and the processes are given `closeBoundMs` to leave by themselves;
  // whatever is still recorded and alive is then sent SIGTERM, given
  // `termBoundMs`, and sent SIGKILL. The recording continues throughout, so a
  // process started during shutdown is recorded before it can outlive the run.
  async teardown(opts: {
    close?: () => Promise<void>;
    closeBoundMs: number;
    termBoundMs: number;
    killBoundMs: number;
  }): Promise<TeardownReport> {
    const w = this.watcher();
    const signals: SignalRecord[] = [];
    let closeMs: number | null = null;
    if (opts.close) {
      try {
        await opts.close();
      } catch {
        // A close that throws is judged by what it left alive, below.
      }
      if (await w.waitGone(opts.closeBoundMs)) { closeMs = w.elapsed(); }
    }
    const signalAll = (signal: NodeJS.Signals): void => {
      for (const r of w.sample()) {
        signals.push({ pid: r.pid, comm: r.comm, cmd: r.cmd, signal, atMs: w.elapsed() });
        try { process.kill(r.pid, signal); } catch { /* gone in between */ }
      }
    };
    if (w.sample().length > 0) {
      signalAll('SIGTERM');
      if (!(await w.waitGone(opts.termBoundMs))) {
        signalAll('SIGKILL');
        await w.waitGone(opts.killBoundMs);
      }
    }
    const stillAlive = w.sample();
    this.save();
    return { closeMs, closeBoundMs: opts.closeBoundMs, signals, deaths: w.deaths, recorded: this.records.size, stillAlive, elapsedMs: w.elapsed() };
  }

  // signalRoots sends one signal to the processes the runner started itself, and
  // to nothing else.
  signalRoots(signal: NodeJS.Signals): ProcRecord[] {
    const sent: ProcRecord[] = [];
    for (const root of this.roots) {
      const rec = this.records.get(`${root.pid}:${root.start}`);
      if (rec && this.isSame(root.pid, root.start)) {
        try { process.kill(root.pid, signal); sent.push(rec); } catch { /* gone in between */ }
      }
    }
    return sent;
  }

  // observe watches the recorded processes for up to `boundMs`, and reports when
  // each one was first seen gone and which were still alive at the bound.
  async observe(boundMs: number): Promise<{ deaths: DeathRecord[]; survivors: ProcRecord[]; elapsedMs: number }> {
    const w = this.watcher();
    await w.waitGone(boundMs);
    return { deaths: w.deaths, survivors: w.sample(), elapsedMs: w.elapsed() };
  }

  // watcher samples the table, recording each process's disappearance with its
  // time since the watcher started.
  private watcher(): { sample: () => ProcRecord[]; waitGone: (boundMs: number) => Promise<boolean>; elapsed: () => number; deaths: DeathRecord[] } {
    const t0 = Date.now();
    const deaths: DeathRecord[] = [];
    this.snapshot();
    const known = new Map(this.alive().map((r) => [`${r.pid}:${r.start}`, r]));
    const sample = (): ProcRecord[] => {
      this.snapshot();
      const alive = this.alive();
      for (const r of alive) { known.set(`${r.pid}:${r.start}`, r); }
      const liveKeys = new Set(alive.map((r) => `${r.pid}:${r.start}`));
      for (const [key, r] of known) {
        if (!liveKeys.has(key)) {
          deaths.push({ pid: r.pid, comm: r.comm, cmd: r.cmd, goneMs: Date.now() - t0 });
          known.delete(key);
        }
      }
      return alive;
    };
    const waitGone = async (boundMs: number): Promise<boolean> => {
      const until = Date.now() + boundMs;
      while (Date.now() < until) {
        if (sample().length === 0) { return true; }
        await sleep(50);
      }
      return sample().length === 0;
    };
    return { sample, waitGone, elapsed: () => Date.now() - t0, deaths };
  }

  private isSame(pid: number, start: string): boolean {
    const st = readStat(pid);
    return st !== null && st.start === start && st.state !== 'Z';
  }

  private record(st: ProcStat, via: string): boolean {
    const key = `${st.pid}:${st.start}`;
    if (this.records.has(key) || st.state === 'Z') { return false; }
    this.put(st, via);
    return true;
  }

  private put(st: ProcStat, via: string): ProcRecord {
    const rec: ProcRecord = { pid: st.pid, start: st.start, comm: st.comm, cmd: readCmdline(st.pid), via, seenMs: Date.now() - this.t0 };
    this.records.set(`${st.pid}:${st.start}`, rec);
    return rec;
  }

  private save(): void {
    fs.writeFileSync(this.stateFile, `${JSON.stringify({ roots: this.roots, records: this.all() }, null, 2)}\n`);
  }
}
