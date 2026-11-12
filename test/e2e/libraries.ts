// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { spawnSync } from 'child_process';

// The editor's shared libraries, checked before its first launch.
//
// 🔴 THE LIBRARIES ARE THE MACHINE'S, NEVER THE RUNNER'S. They are expected to be
// installed by the development container's definition, so the runner provides
// none: it sets no library search path and fetches no package. What it does is
// refuse to launch an editor the dynamic loader cannot complete, naming every
// library that is missing, because an editor that dies at start or draws with a
// fallback reads, from the outside, like a failing check.

// LibraryReport is what the dynamic loader resolved for one executable.
export interface LibraryReport {
  executable: string;
  resolved: number;
  missing: string[];
  // lddStatus is the loader listing's own exit status.
  lddStatus: number | null;
}

// checkLibraries lists the shared libraries the executable needs that the loader
// cannot find. The listing runs with no library search path in its environment,
// which is the environment the editor itself is launched with.
export function checkLibraries(executable: string): LibraryReport {
  const r = spawnSync('ldd', [executable], { encoding: 'utf8', timeout: 30000, env: { PATH: '/usr/bin:/bin', LANG: 'C' } });
  const lines = `${r.stdout ?? ''}`.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const missing: string[] = [];
  let resolved = 0;
  for (const line of lines) {
    const m = /^(\S+)\s+=>\s+not found$/.exec(line);
    if (m) { missing.push(m[1]); } else if (line.includes('=>') || line.startsWith('/')) { resolved++; }
  }
  return { executable, resolved, missing, lddStatus: r.status };
}

// libraryRefusal is the sentence the runner stops with when a library is missing,
// or null when the executable can be loaded.
export function libraryRefusal(report: LibraryReport): string | null {
  if (report.missing.length === 0 && report.lddStatus === 0) { return null; }
  if (report.missing.length === 0) {
    return `the loader could not list the libraries of ${report.executable} (ldd exited ${report.lddStatus}); the editor was not launched`;
  }
  return `the editor at ${report.executable} needs ${report.missing.length} shared ` +
    `librar${report.missing.length === 1 ? 'y' : 'ies'} the loader cannot find: ${report.missing.join(', ')}. ` +
    'They are expected to be installed by the development container\'s definition; rebuild the container ' +
    'from it, or install the packages that provide them. The editor was not launched.';
}
