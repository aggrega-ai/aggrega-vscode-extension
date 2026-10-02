// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { recipeAnswer } from '../e2e/inputs';

const BINARY_NAME = 'aggrega';
const SOURCE_TREE_RELATIVE = path.join('..', 'aggrega-cli');

// COMPILER_FIXTURE_ENV names the variable that opts a run into the compiler
// fixture: building the aggrega binary from the sibling source tree, and running
// the specs that drive the editor against it.
//
// It is off by default, and the default is what keeps the expensive half of this
// package's suite out of a run that did not ask for it. `npm test` runs `pretest`
// before a single spec is selected, so a fixture build wired unconditionally into
// that hook costs a Go build of the whole compiler on every test-grade run of this
// package, whatever that run goes on to execute. Reading an explicit opt-in here
// is what keeps the cost with the run that wants the coverage.
//
// One variable drives both halves. The fixture build reads it here, and the specs
// that need the binary read it through requireAggregaBinary below, so a run cannot
// end up with the specs selected and no binary built, or a binary built for specs
// that will not run.
export const COMPILER_FIXTURE_ENV = 'AGGREGA_EDITOR_COMPILER_FIXTURE';

// compilerFixtureRequested reports whether this run opted into the compiler
// fixture. Any value other than the empty string and '0' enables it, so both
// `=1` and a bare assignment read as a request.
export function compilerFixtureRequested(): boolean {
  const raw = process.env[COMPILER_FIXTURE_ENV];
  return raw !== undefined && raw !== '' && raw !== '0';
}

// COVERAGE_BOUND states, in one sentence, what a run without the fixture does not
// cover. It is printed by every spec that stands itself down, because a skip that
// says nothing is indistinguishable from a spec that does not exist — which is the
// state this gate is built to stay out of.
const COVERAGE_BOUND =
  `the editor-against-compiler seam is NOT covered in this run; ` +
  `set ${COMPILER_FIXTURE_ENV}=1 to build the compiler fixture and cover it`;

// requireAggregaBinary is the entry point for a spec that cannot run without the
// compiler binary. It returns the binary's path, or stands the calling suite down
// with an explicit line saying so.
//
// A run that did NOT ask for the fixture skips and says why. A run that DID ask
// and then cannot build the binary FAILS: the request is the caller's statement
// that they want this coverage, so silently downgrading it to a skip would hand
// back a green that covers nothing.
export function requireAggregaBinary(ctx: Mocha.Context, suiteName: string): string {
  if (!compilerFixtureRequested()) {
    // eslint-disable-next-line no-console
    console.log(`[compiler fixture] SKIPPING ${suiteName}: ${COVERAGE_BOUND}`);
    ctx.skip();
    // ctx.skip() throws to abandon the suite, so control never reaches here. The
    // throw is what tells the compiler's return-path analysis the same thing.
    throw new Error('unreachable: ctx.skip() does not return');
  }
  // eslint-disable-next-line no-console
  console.log(`[compiler fixture] RUNNING ${suiteName} against the built aggrega binary`);
  return ensureAggregaBinary();
}

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

// stampPath is where the version and commit the cached binary was stamped with
// are kept, beside it.
function stampPath(): string {
  return `${binaryCachePath()}.stamp.json`;
}

// ensureAggregaBinary builds aggrega from the sibling aggrega-cli checkout on
// demand and caches the result. A cached binary is reused while its mtime is
// newer than the latest mtime in the aggrega-cli source tree (a coarse but
// reliable signal — any edit to any .go file under aggrega-cli/ invalidates the
// cache) and it was stamped with the version and commit that checkout reports
// now, so a commit that changes no file still rebuilds it.
//
// 🔴 THE BINARY REPORTS aggrega-cli's OWN REVISION, STAMPED AS THE COMPILER'S
// BUILD SCRIPTS STAMP IT. Left to stamp a build itself, the Go toolchain reads the
// revision from the nearest repository whose metadata is a directory, and a
// checkout held inside another repository carries a `.git` file instead, so the
// binary would report the enclosing repository's commit and "(devel)". The build
// is given instead the version and commit the compiler's build-provenance recipe
// reports for the checkout — read by `recipeAnswer`, the runner's one reader of
// that recipe — as `-X main.version` and `-X main.commit`, and the toolchain's own
// stamping is turned off, so no part of the version names the other repository.
//
// Returns the absolute path of the built binary. Throws when the
// source tree is missing, its revision cannot be read, or the build fails.
export function ensureAggregaBinary(): string {
  const binPath = binaryCachePath();
  const cliRoot = path.resolve(extensionRoot(), SOURCE_TREE_RELATIVE);
  if (!fs.existsSync(cliRoot)) {
    throw new Error(`aggrega-cli source tree not found at ${cliRoot}`);
  }
  const revision = recipeAnswer(cliRoot);
  if ('failure' in revision) {
    throw new Error(`the aggrega binary cannot be stamped with the revision of ${cliRoot}: ${revision.failure}`);
  }
  if (revision.version === '' || revision.version === 'dev' || revision.commit === '' || revision.commit === 'unknown') {
    throw new Error(`git cannot name the commit ${cliRoot} is checked out at, so the aggrega binary cannot be stamped with it`);
  }
  const stamp = JSON.stringify({ version: revision.version, commit: revision.commit });

  if (isUsableBinary(binPath) && isUpToDate(binPath, cliRoot) && readStamp() === stamp) {
    return binPath;
  }

  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  fs.rmSync(stampPath(), { force: true });
  const ldflags = `-X main.version=${revision.version} -X main.commit=${revision.commit}`;
  const result = spawnSync('go', ['build', '-buildvcs=false', '-ldflags', ldflags, '-o', binPath, './cmd/aggrega'], {
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
  fs.writeFileSync(stampPath(), stamp);
  return binPath;
}

// readStamp is what the cached binary was stamped with, or null where no stamp
// is kept beside it.
function readStamp(): string | null {
  try {
    return fs.readFileSync(stampPath(), 'utf8');
  } catch {
    return null;
  }
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

// sensitivityFixtureRoot returns the absolute path of the compiler's own
// declared-sensitivity fixture — a workspace whose Component and Feature
// schemas declare leaves sensitive and whose Aggregate and Release author
// values at them.
//
// It is reached in the source tree rather than copied here, and deliberately:
// the fixture's job in this suite is to make the compiler emit a real withheld
// marker, so a copy that drifted from the compiler's own fixture would go on
// asserting against a marker the compiler had stopped producing. The same
// sibling tree already supplies the binary these tests run.
export function sensitivityFixtureRoot(): string {
  return path.resolve(
    extensionRoot(),
    SOURCE_TREE_RELATIVE,
    'internal', 'compiler', 'testdata', 'authored-leaf-marking',
  );
}

// brokenManifestWorkspaceRoot returns the absolute path of the workspace
// whose Release points at a Manifest that is not there. It is the fixture for
// the one failure whose fault is attributable to a single authored key, so it
// is what proves the error envelope carries that key's span end to end.
export function brokenManifestWorkspaceRoot(): string {
  return path.resolve(extensionRoot(), 'test', 'fixtures', 'broken-manifest-reference');
}

// Invoked directly, this module IS the package's fixture-build step: it builds the
// compiler binary when the run asked for it and announces that it did not when the
// run did not. Running the step through this module rather than through a shell
// line in the package manifest is what keeps one home for the decision — the
// manifest cannot consult an environment variable without restating the rule that
// reads it, and a restated rule is one that drifts from the specs it must agree
// with.
//
// It exits 0 in both directions. Declining to build is an outcome of the step, not
// a failure of it, and a non-zero exit here would fail the whole run for having
// asked for the cheap shape.
if (require.main === module) {
  if (!compilerFixtureRequested()) {
    // eslint-disable-next-line no-console
    console.log(
      `[compiler fixture] not building the aggrega binary: ${COVERAGE_BOUND}`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.log('[compiler fixture] building the aggrega binary from the sibling source tree');
    const built = ensureAggregaBinary();
    // eslint-disable-next-line no-console
    console.log(`[compiler fixture] built ${built}`);
  }
}
