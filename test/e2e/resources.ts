// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { spawnSync } from 'child_process';
import * as fs from 'fs';

import { ProcessTable, readStat } from './processes';

// What one editor launch used: the memory and CPU time of the editor's process
// tree and of the language servers it started, read from /proc for the
// processes the launch's table recorded, on a fixed interval from the launch
// until the end of its teardown.
//
// 🔴 A READING IS TAKEN AT ONE MOMENT, AND WHAT HAPPENS BETWEEN TWO READINGS IS
// NOT SEEN. Memory is summed over the group's live processes at each reading and
// the peak is the largest such sum, so a peak lasting less than the interval can
// be missed. CPU time is each process's own user and system time as last read, so
// the time a process uses after its last reading, and a process that starts and
// ends between two readings, are not counted. The report states the interval and
// the number of readings beside every figure, so a reader can weigh them.

// SAMPLE_INTERVAL_MS is how often the recorded processes are read.
export const SAMPLE_INTERVAL_MS = 1000;

// GroupUse is what one group of processes used over the launch.
export interface GroupUse {
  // peakRssMb is the largest sum of resident memory over the group's live
  // processes at one reading. Pages two processes share are counted in each, so
  // for a tree of processes that share their runtime it overstates the memory the
  // tree holds; peakPssMb divides each shared page between its sharers.
  peakRssMb: number;
  peakPssMb: number;
  // peakAtMs is when the resident peak was read, after the sampler started.
  peakAtMs: number | null;
  peakProcesses: number;
  cpuSeconds: number;
  processesSeen: number;
}

// ResourceReport is the whole reading of one launch.
export interface ResourceReport {
  intervalMs: number;
  readings: number;
  spanMs: number;
  clockTicksPerSecond: number;
  editor: GroupUse;
  languageServer: GroupUse;
  method: string;
}

// clockTicks is the kernel's clock tick rate, in which /proc reports CPU time.
function clockTicks(): number {
  const r = spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8', timeout: 5000 });
  const n = Number((r.stdout ?? '').trim());
  return r.status === 0 && Number.isFinite(n) && n > 0 ? n : 100;
}

// memoryKb reads a process's resident and proportional memory, in kilobytes, or
// null where the process is gone.
function memoryKb(pid: number): { rss: number; pss: number } | null {
  let raw: string;
  try {
    raw = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
  } catch {
    return null;
  }
  const field = (name: string): number => {
    const m = new RegExp(`^${name}:\\s+(\\d+) kB`, 'm').exec(raw);
    return m ? Number(m[1]) : 0;
  };
  return { rss: field('Rss'), pss: field('Pss') };
}

interface Tally { peakRssKb: number; peakPssKb: number; peakAtMs: number | null; peakProcesses: number; ticks: Map<string, number> }

function emptyTally(): Tally {
  return { peakRssKb: 0, peakPssKb: 0, peakAtMs: null, peakProcesses: 0, ticks: new Map() };
}

// ResourceSampler reads one launch's recorded processes on a fixed interval.
export class ResourceSampler {
  private timer: NodeJS.Timeout | null = null;
  private readings = 0;
  private readonly t0 = Date.now();
  private readonly ticksPerSecond = clockTicks();
  private readonly editor = emptyTally();
  private readonly server = emptyTally();

  constructor(private readonly table: ProcessTable, private readonly compiler: string, private readonly intervalMs = SAMPLE_INTERVAL_MS) {}

  start(): void {
    this.read();
    this.timer = setInterval(() => this.read(), this.intervalMs);
    this.timer.unref();
  }

  // stop takes a last reading and reports the whole launch.
  stop(): ResourceReport {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    this.read();
    const use = (t: Tally): GroupUse => ({
      peakRssMb: round(t.peakRssKb / 1024),
      peakPssMb: round(t.peakPssKb / 1024),
      peakAtMs: t.peakAtMs,
      peakProcesses: t.peakProcesses,
      cpuSeconds: round([...t.ticks.values()].reduce((a, b) => a + b, 0) / this.ticksPerSecond),
      processesSeen: t.ticks.size,
    });
    return {
      intervalMs: this.intervalMs,
      readings: this.readings,
      spanMs: Date.now() - this.t0,
      clockTicksPerSecond: this.ticksPerSecond,
      editor: use(this.editor),
      languageServer: use(this.server),
      method: `every ${this.intervalMs} ms from the launch to the end of teardown, each process the launch's table recorded is read from /proc/<pid>/stat (user and system time) and /proc/<pid>/smaps_rollup (Rss, Pss); a group's memory is the sum over its live processes at one reading and its peak the largest sum; its CPU time is the sum of each process's time as last read. The editor's group is every process descending from the editor it launched, the language servers included; the language server's group is the descendants whose command line is the binary under test followed by serve.`,
    };
  }

  private read(): void {
    this.readings++;
    this.table.snapshot();
    const at = Date.now() - this.t0;
    const sums = { editor: { rss: 0, pss: 0, n: 0 }, server: { rss: 0, pss: 0, n: 0 } };
    for (const r of this.table.alive()) {
      if (r.root !== 'editor') { continue; }
      const st = readStat(r.pid);
      const mem = memoryKb(r.pid);
      if (st === null || st.start !== r.start || mem === null) { continue; }
      const key = `${r.pid}:${r.start}`;
      const isServer = r.cmd === `${this.compiler} serve` || r.cmd.startsWith(`${this.compiler} serve `);
      this.editor.ticks.set(key, st.cpuTicks);
      sums.editor.rss += mem.rss; sums.editor.pss += mem.pss; sums.editor.n++;
      if (isServer) {
        this.server.ticks.set(key, st.cpuTicks);
        sums.server.rss += mem.rss; sums.server.pss += mem.pss; sums.server.n++;
      }
    }
    for (const [t, s] of [[this.editor, sums.editor], [this.server, sums.server]] as const) {
      if (s.rss > t.peakRssKb) { t.peakRssKb = s.rss; t.peakAtMs = at; t.peakProcesses = s.n; }
      if (s.pss > t.peakPssKb) { t.peakPssKb = s.pss; }
    }
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
