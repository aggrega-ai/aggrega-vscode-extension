// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const BINARY_NAME = 'aggrega';
const SOURCE_TREE_RELATIVE = path.join('..', 'aggrega-cli');

// extensionRoot is the absolute path of the aggrega-vscode-extension
// directory. After compilation this file lives at
// out/test/helpers/build-aggrega.js, so three parent hops are
// required to reach the extension root.
function extensionRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

// binaryCachePath is where the built aggrega binary lives. Stored
// under out/ so it inherits the .gitignore for compiled output and
// gets cleaned along with the TypeScript build.
function binaryCachePath(): string {
  return path.join(extensionRoot(), 'out', 'test-fixtures', BINARY_NAME);
}

// ensureAggregaBinary builds aggrega from the umbrella's
// aggrega-cli/ submodule on demand and caches the result. A cached
// binary is reused when its mtime is newer than the latest mtime in
// the aggrega-cli source tree (a coarse but reliable signal — any
// edit to any .go file under aggrega-cli/ invalidates the cache).
//
// Returns the absolute path of the built binary. Throws when the
// source tree is missing or the build fails.
export function ensureAggregaBinary(): string {
  const binPath = binaryCachePath();
  const cliRoot = path.resolve(extensionRoot(), SOURCE_TREE_RELATIVE);
  if (!fs.existsSync(cliRoot)) {
    throw new Error(`aggrega-cli source tree not found at ${cliRoot}`);
  }

  if (isUsableBinary(binPath) && isUpToDate(binPath, cliRoot)) {
    return binPath;
  }

  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  const result = spawnSync('go', ['build', '-o', binPath, './cmd/aggrega'], {
    cwd: cliRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CGO_ENABLED: '0' },
  });
  if (result.status !== 0) {
    // A failed build can leave a truncated or zero-byte file at binPath that
    // would pass a bare existence check on the next run; remove it so the
    // cache never serves a non-runnable binary.
    try {
      fs.rmSync(binPath, { force: true });
    } catch {
      // Best-effort cleanup; the thrown error below is the operative signal.
    }
    const stderr = result.stderr?.toString('utf8') ?? '';
    throw new Error(`go build failed (status=${result.status}): ${stderr}`);
  }
  return binPath;
}

// isUsableBinary reports whether binPath is a cached binary worth reusing: a
// regular, non-empty, owner-executable file. A bare existence check is not
// enough — an interrupted or failed build can leave a zero-byte or
// non-executable file at the path, which an existence check accepts but the
// daemon cannot spawn (the spawn fails asynchronously and surfaces downstream
// as an initialize timeout). Verifying mode and size here forces a rebuild
// instead of caching a broken binary.
function isUsableBinary(binPath: string): boolean {
  let st: fs.Stats;
  try {
    st = fs.statSync(binPath);
  } catch {
    return false;
  }
  if (!st.isFile() || st.size === 0) {
    return false;
  }
  // 0o100 is the owner-execute bit; a successfully built binary carries it.
  return (st.mode & 0o100) !== 0;
}

function isUpToDate(binPath: string, sourceRoot: string): boolean {
  const binMtime = fs.statSync(binPath).mtimeMs;
  const sourceMtime = latestGoSourceMtime(sourceRoot);
  return binMtime >= sourceMtime;
}

function latestGoSourceMtime(root: string): number {
  let latest = 0;
  const skip = new Set(['testdata', 'node_modules', '.git']);
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) { continue; }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.isFile() && (entry.name.endsWith('.go') || entry.name === 'go.mod' || entry.name === 'go.sum')) {
        try {
          const m = fs.statSync(full).mtimeMs;
          if (m > latest) { latest = m; }
        } catch {
          // ignore stat failures
        }
      }
    }
  };
  walk(root);
  return latest;
}

// fixtureWorkspaceRoot returns the absolute path of the empty
// workspace fixture used by integration tests.
export function fixtureWorkspaceRoot(): string {
  return path.resolve(extensionRoot(), 'test', 'fixtures', 'empty-workspace');
}
