// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'node:fs';
import * as path from 'node:path';

// This helper is the one home of the launch census, so every claim that a module
// reaches the compiler without starting a process is measured by the same
// instrument. A second copy of the pattern would agree on the day it was written
// and would then be the only thing consulted by whichever spec held it.

// EXTENSION_ROOT is the repository root, resolved from the compiled location of
// this helper rather than from a caller's own depth.
export const EXTENSION_ROOT = path.resolve(__dirname, '../../..');

// LAUNCH_FACILITY matches the ways a module creates a child process: the two
// calls that start one, and the import that makes either reachable.
//
// It is a global pattern because every claim below is a COUNT and not a
// presence. A module that launches twice and is cleaned up once satisfies any
// "does it still contain one" reading, so a presence test cannot express the
// claim.
//
// It is built fresh per call rather than shared, because a global regular
// expression carries a lastIndex and a shared one would make a count depend on
// the order the specs happened to run in.
function launchFacility(): RegExp {
  return /\bspawn\s*\(|\bexecFile\s*\(|from\s+['"]child_process['"]|require\(\s*['"]child_process['"]/g;
}

// launchFacilityCount reports how many ways one module has of starting a child
// process.
export function launchFacilityCount(relativePath: string): number {
  const source = fs.readFileSync(path.join(EXTENSION_ROOT, relativePath), 'utf8');
  return (source.match(launchFacility()) ?? []).length;
}

// LAUNCHING_CONTROL is a module the extension deliberately still launches from,
// and it is the positive control every census here needs.
//
// 🔴 IT IS THE HALF THAT MAKES A ZERO MEAN ANYTHING. A pattern that has stopped
// matching reports every module clean, so a census without a control cannot tell
// an absence from a dead instrument. This module is on the same side of the claim
// as the subjects and moves independently of them.
//
// Its own survival is deliberate rather than pending: the one operation still
// behind it is the plugin listing, which the compiler does not serve over the
// request surface because its subject is the toolchain rather than a workspace.
export const LAUNCHING_CONTROL = 'src/cli-json.ts';

// assertCensusInstrumentFires proves the pattern still detects a launch before
// any absence measured with it is believed.
export function assertCensusInstrumentFires(
  assertOk: (value: boolean, message: string) => void,
): void {
  assertOk(
    launchFacilityCount(LAUNCHING_CONTROL) > 0,
    `the launch pattern no longer matches ${LAUNCHING_CONTROL}, which provably launches, so it `
    + 'can no longer detect a module that does — every absence measured with it would pass '
    + 'vacuously',
  );
}

// --- the whole-tree census -----------------------------------------------

// SOURCE_DIR is the directory the census reads. It is the extension's own source
// tree and holds no subdirectories, so a flat listing covers all of it; a nested
// module would sit outside every count below and is the one shape this reading
// cannot see.
const SOURCE_DIR = path.join(EXTENSION_ROOT, 'src');

// LaunchHelper is a helper that invokes the compiler as a command. There are
// three, they are the only ways a panel reaches one, and naming them as a closed
// set is what makes the census below exhaustive rather than a sample.
export type LaunchHelper = 'runCli' | 'runCliJson' | 'runWatchableCli';

// LAUNCH_HELPERS is that set, in the order the counts are recorded.
export const LAUNCH_HELPERS: readonly LaunchHelper[] = [
  'runCli',
  'runCliJson',
  'runWatchableCli',
];

// helperCall matches a direct call of one helper.
//
// 🔴 THE TYPE ARGUMENTS ARE THE PART THAT MATTERS, and leaving them out is not a
// near miss: a call written with explicit type arguments puts them between the
// name and the parenthesis, so a pattern demanding the parenthesis immediately
// after the name matches none of the structured helper's call sites and reports
// its whole census as ZERO. Measured on this tree: without the optional type
// argument group the structured helper counts three sites as none, in three
// separate modules, and the reading looks exactly like a helper nobody calls.
//
// The leading guard keeps a method-style call out — an injected seam reached
// through a dependency creates no process of its own — and keeps the shorter
// helper name from matching inside the longer one.
//
// It is built fresh per call, because a global expression carries a lastIndex and
// a shared one would make a count depend on the order the readings happened to
// run in.
function helperCall(helper: LaunchHelper): RegExp {
  return new RegExp(`(?:^|[^a-zA-Z.])${helper}\\s*(?:<[^<>]*>)?\\s*\\(`, 'gm');
}

// launchHelperSites reports, per module, how many times one helper is called
// directly — its own declaration included, because a declaration is where the
// process is created and a census that skipped it would report the module that
// launches as clean.
//
// The answer is a sorted list of pairs rather than a total. A total cannot say
// which module a launch sits in, and every claim made against this reading is
// about a named module.
export function launchHelperSites(helper: LaunchHelper): Array<[string, number]> {
  const sites: Array<[string, number]> = [];
  for (const file of fs.readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(SOURCE_DIR, file), 'utf8');
    const count = (source.match(helperCall(helper)) ?? []).length;
    if (count > 0) { sites.push([file, count]); }
  }
  return sites.sort();
}

// RECORDED_LAUNCH_SITES is every direct call of every helper, per module, as the
// surface stands.
//
// It is a hand-written record compared against a fresh reading of the tree, so
// the two sides move independently: nothing here is derived from the source the
// reading walks, and nothing the reading walks is derived from here. A comparison
// whose expectation came out of the same walk would accept whatever the walk
// produced.
//
// Each entry is accounted for at the call itself, which is where a reader
// standing at a launch can see why it is one. Three of these are the helpers'
// own declarations and one is the watchable wrapper reaching the streaming
// helper; the rest are operations, and each carries a stated reason.
export const RECORDED_LAUNCH_SITES: Readonly<Record<LaunchHelper, ReadonlyArray<readonly [string, number]>>> = {
  // The declaration and the one call inside the watchable wrapper, plus the
  // catalog generation whose destination the reader picks.
  runCli: [
    ['cli-operation.ts', 2],
    ['plugins-view.ts', 1],
  ],
  // The declaration, and the plugin listing the compiler does not serve.
  runCliJson: [
    ['cli-json.ts', 1],
    ['plugins-view.ts', 1],
  ],
  // The declaration, and the operations still reached as commands.
  //
  // 🔴 NO SINGLE REASON HOLDS THE REMAINDER, AND READING IT AS THOUGH ONE DID IS
  // HOW AN ENTRY COMES TO LOOK SETTLED WHEN IT IS NOT. The absent stop was once
  // what they had in common; it no longer is, and each survivor now carries its
  // own reason at its own call site, which is where a reader standing at a launch
  // can see it. In `operations.ts` it is the pull; in `registries-view.ts` the two
  // scopes of the registry index build; in `workspace-catalog-view.ts` the
  // per-entity correctness check, whose request answers a different shape, and the
  // per-entity conventions check, held by where its answer would land rather than
  // by anything the compiler cannot do.
  runWatchableCli: [
    ['cli-operation.ts', 1],
    ['operations.ts', 1],
    ['registries-view.ts', 2],
    ['workspace-catalog-view.ts', 2],
  ],
};

// launchFacilityModules reports which modules carry a way of starting a child
// process at all, whether or not they reach it through one of the helpers above.
//
// It is the reading the per-helper census structurally cannot make: a fourth
// helper, written in a new module around the same primitives, is invisible to a
// census keyed on three names and is named here.
export function launchFacilityModules(): string[] {
  return fs.readdirSync(SOURCE_DIR)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => launchFacilityCount(path.join('src', f)) > 0)
    .sort();
}

// RECORDED_LAUNCH_FACILITY_MODULES is that set as the surface stands: the
// transport, the version probe, the two helper declarations, the shared child
// runner they both drive, and two modules that only describe the facility in
// prose or declare it as an injected seam.
//
// Those last two are members deliberately. Excluding them would mean deciding
// which mentions are real, which needs a parser rather than a reading — and a
// member that turns out to be prose costs a look at a failing comparison, while a
// missing member costs a launch nobody noticed. A new module that merely
// mentions the facility therefore fails this comparison, and reading the diff is
// how it is resolved.
export const RECORDED_LAUNCH_FACILITY_MODULES: readonly string[] = [
  'cli-json.ts',
  'cli-operation.ts',
  'cli-run.ts',
  'daemon.ts',
  'extension.ts',
  'notifications.ts',
  'version-check.ts',
];
