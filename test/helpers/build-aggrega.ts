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

  if (fs.existsSync(binPath) && isUpToDate(binPath, cliRoot)) {
    return binPath;
  }

  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  const result = spawnSync('go', ['build', '-o', binPath, './cmd/aggrega'], {
    cwd: cliRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CGO_ENABLED: '0' },
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString('utf8') ?? '';
    throw new Error(`go build failed (status=${result.status}): ${stderr}`);
  }
  return binPath;
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
