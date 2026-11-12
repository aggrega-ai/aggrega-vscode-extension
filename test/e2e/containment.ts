// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { everyTable, ProcRecord } from './processes';

// Whether a run stayed inside its scratch directory, read after the run rather
// than assumed from how its processes were started.
//
// 🔴 A PATH NEWER THAN THE RUN'S START IS REPORTED, NOT ATTRIBUTED. The places
// read are where a process of this run would write if its isolation failed — the
// developer's home, the temporary directories, the inputs the run reads, and the
// repositories those inputs sit in — and other processes on the machine may write
// there too. The runner cannot tell which process wrote a path, so it lists what
// it found and leaves the attribution to whoever reads the report. What it does
// decide is the absence: a place with nothing newer than the run's start was not
// written by the run.

// Containment is the reading taken at the end of a run.
export interface Containment {
  startedAt: string;
  marker: string;
  scratch: string;
  places: Place[];
  newer: number;
  processes: { tables: number; recorded: number; alive: ProcRecord[] };
}

// Place is one place read, and what was found newer than the run's start there.
export interface Place {
  place: string;
  depth: 'all' | 'top';
  newer: number;
  paths: string[];
  unreadable?: string;
}

// PATHS_LISTED is how many paths the report lists for one place; the count is
// always the whole count.
const PATHS_LISTED = 20;

// ContainmentStart is taken as a run begins, before anything else is done.
export interface ContainmentStart {
  marker: string;
  startedAt: string;
  // tmp is the temporary directory the runner was given, read before the runner
  // points its own at the run's directory.
  tmp: string;
  home: string;
}

// markStart writes the marker file every later path is compared with.
export function markStart(runDir: string): ContainmentStart {
  const marker = path.join(runDir, 'run-started');
  fs.writeFileSync(marker, `${new Date().toISOString()}\n`);
  return { marker, startedAt: new Date().toISOString(), tmp: os.tmpdir(), home: os.homedir() };
}

// gitDirOf finds the directory git keeps a checkout's state in, for the checkout
// holding `dir`, by reading the checkout's own `.git` entry rather than by asking
// git: the directory itself, or the one a `gitdir:` line in the file names.
function gitDirOf(dir: string): string | null {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    const dotGit = path.join(d, '.git');
    if (fs.existsSync(dotGit)) {
      if (fs.statSync(dotGit).isDirectory()) { return dotGit; }
      const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
      return m ? path.resolve(d, m[1].trim()) : null;
    }
    if (path.dirname(d) === d) { return null; }
  }
}

// placesFor names the places a run reads. `top` places are read one level deep:
// a leak there shows as a new or changed entry at the top, and reading deeper
// would list the other work on the machine rather than this run's.
export function placesFor(start: ContainmentStart, inputs: { extension: string; catalog: string; compiler: string; registryServer: string; editor: string; docsExamples: readonly string[] }): { place: string; depth: 'all' | 'top' }[] {
  const all = (p: string): { place: string; depth: 'all' } => ({ place: p, depth: 'all' });
  const top = (p: string): { place: string; depth: 'top' } => ({ place: p, depth: 'top' });
  const places: { place: string; depth: 'all' | 'top' }[] = [
    top(start.home),
    ...['.cache', '.config', '.local', '.vscode', '.npm', '.pki'].map((d) => all(path.join(start.home, d))),
    top(start.tmp),
    top('/dev/shm'),
    all(inputs.extension),
    all(inputs.catalog),
    ...inputs.docsExamples.map(all),
    // The editor build is read on its own only where it sits outside the
    // extension's directory, which is read whole above.
    ...(inputs.editor.startsWith(`${inputs.extension}${path.sep}`) ? [] : [all(inputs.editor)]),
    all(path.dirname(inputs.compiler)),
    all(path.dirname(inputs.registryServer)),
  ];
  for (const repo of [inputs.extension, inputs.catalog, ...inputs.docsExamples]) {
    const g = gitDirOf(repo);
    if (g !== null) { places.push(top(g)); }
  }
  const seen = new Set<string>();
  return places.filter((p) => {
    const key = `${p.place}:${p.depth}`;
    if (seen.has(key) || !fs.existsSync(p.place)) { return false; }
    seen.add(key);
    return true;
  });
}

// readContainment lists every path newer than the marker in each place, the
// scratch directory left out, and reads every process table the run created for
// a record still alive.
export function readContainment(start: ContainmentStart, scratch: string, places: { place: string; depth: 'all' | 'top' }[]): Containment {
  const read: Place[] = places.map(({ place, depth }) => {
    const args = [place, ...(depth === 'top' ? ['-mindepth', '1', '-maxdepth', '1'] : []), '-path', scratch, '-prune', '-o', '-newer', start.marker, '-print'];
    const r = spawnSync('find', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    const paths = (r.stdout ?? '').split('\n').filter((l) => l !== '' && l !== place);
    const out: Place = { place, depth, newer: paths.length, paths: paths.slice(0, PATHS_LISTED) };
    if (r.status !== 0) { out.unreadable = `find exited ${r.status ?? r.signal}: ${(r.stderr ?? '').trim().split('\n').slice(0, 2).join(' | ')}`; }
    return out;
  });
  const tables = everyTable();
  const alive = tables.flatMap((t) => t.alive());
  return {
    startedAt: start.startedAt,
    marker: start.marker,
    scratch,
    places: read,
    newer: read.reduce((n, p) => n + p.newer, 0),
    processes: { tables: tables.length, recorded: tables.reduce((n, t) => n + t.all().length, 0), alive },
  };
}

// containmentSummary states the reading in words.
export function containmentSummary(c: Containment): string[] {
  const written = c.places.filter((p) => p.newer > 0 || p.unreadable);
  const lines = [
    `containment: ${c.places.length} places outside the scratch directory read for anything newer than the run's start (${c.startedAt}); ${written.length === 0 ? 'nothing newer in any of them' : `${c.newer} path(s) newer in ${written.length} of them, which the runner does not attribute: another process on this machine may have written them`}`,
  ];
  for (const p of written) {
    lines.push(`  ${p.place}${p.depth === 'top' ? ' (top level)' : ''}: ${p.newer} newer${p.unreadable ? `; ${p.unreadable}` : ''}${p.paths.length > 0 ? ` — ${p.paths.join(', ')}${p.newer > p.paths.length ? ', …' : ''}` : ''}`);
  }
  lines.push(`  read with nothing newer: ${c.places.filter((p) => p.newer === 0 && !p.unreadable).map((p) => `${p.place}${p.depth === 'top' ? ' (top level)' : ''}`).join(', ') || 'none'}`);
  lines.push(`processes: ${c.processes.alive.length === 0 ? 'none' : c.processes.alive.map((r) => `${r.pid} ${r.comm}`).join(', ')} alive of ${c.processes.recorded} recorded across ${c.processes.tables} process table(s)`);
  return lines;
}
