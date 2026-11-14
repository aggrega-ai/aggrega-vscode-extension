// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

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

// --- what a module imports, with the two kinds told apart -----------------

// 🔴 A TYPE-ONLY IMPORT AND A VALUE IMPORT ARE DIFFERENT CLAIMS ABOUT WHAT A
// MODULE CAN REACH, AND A READING THAT CANNOT TELL THEM APART MAKES THE WEAKER
// ONE. A type-only import is erased before anything runs: it names no code at
// run time, requires nothing, and therefore cannot start a process or carry the
// editor in whatever the module it names contains. A value import of the same
// module can do all three.
//
// So the census reports the two separately, and the claims below are made
// against the VALUE list. Folding the type-only ones into it would let a later
// change from one kind to the other pass unnoticed, which is exactly the change
// worth catching — the published wire contract carries encoders and decoders, so
// importing it as a value would put them in the packaged extension.
//
// It is built fresh per call for the reason every pattern here is: a global
// expression carries a lastIndex, and a shared one makes a reading depend on the
// order the specs happened to run in.
function importFrom(): RegExp {
  return /(?:^|\n)\s*(?:import|export)(\s+type)?\b[^;]*?from\s+['"]([^'"]+)['"]/g;
}

function specifiers(relativePath: string, typeOnly: boolean): string[] {
  const source = fs.readFileSync(path.join(EXTENSION_ROOT, relativePath), 'utf8');
  return [...source.matchAll(importFrom())]
    .filter((m) => (m[1] !== undefined) === typeOnly)
    .map((m) => m[2])
    .sort();
}

// valueImports reports every module one module names in a way that reaches code
// at run time.
export function valueImports(relativePath: string): string[] {
  return specifiers(relativePath, false);
}

// typeOnlyImports reports every module one module names for its declarations
// alone, which the compiler erases before anything runs.
export function typeOnlyImports(relativePath: string): string[] {
  return specifiers(relativePath, true);
}

// WIRE_CONTRACT is the published request-and-answer contract every module that
// speaks to the compiler consumes its shapes from. It is named once here so a
// spec asserting that a module takes its shapes from the published contract
// rather than restating them cannot spell the path differently from its
// neighbour.
export const WIRE_CONTRACT = '@aggrega-ai/aggrega-abi/dist/servewire_gen';

// TEXT_LOOKUP is the extension's text lookup, the one module a census of what a
// module reaches admits by name although it reaches the editor.
//
// 🔴 IT IS ADMITTED BECAUSE ITS ONE REACH IS THE EDITOR'S TRANSLATIONS. It answers
// a module's own words in the editor's language: in the editor it hands them to
// the editor's lookup and takes nothing else from the editor, and with no editor it
// answers the English itself, so a module importing it stays readable without a
// host. That the lookup reaches no other module, starts nothing and loads the
// editor once is held by the localization spec (l10n-bundles.test.ts); a census
// lists this constant rather than the path, so the reason is read here once
// however many modules come to import it.
export const TEXT_LOOKUP = './l10n';

// --- the whole-tree census -----------------------------------------------

// SOURCE_DIR is the directory the census reads. It is the extension's own source
// tree and holds no subdirectories, so a flat listing covers all of it; a nested
// module would sit outside every count below and is the one shape this reading
// cannot see.
const SOURCE_DIR = path.join(EXTENSION_ROOT, 'src');

// readSourceTree reads every module in that directory as a [file, source] pair,
// for a sweep whose subject is the whole surface rather than one module.
//
// 🔴 IT EXISTS BECAUSE A SWEEP CONFINED TO ONE MODULE GOES VACUOUS WHEN THAT
// MODULE EMPTIES, WHICH IS MEASURED RATHER THAN HYPOTHETICAL. The module that
// once declared every command-line composition now declares none, so a sweep of
// it reports any retired composer absent whether or not one was written into a
// neighbour. Reading the whole tree is what keeps an absence an absence.
//
// It is here rather than in a spec so the specs that sweep share one corpus
// definition; a second listing would agree on the day it was written and would
// then be the only thing whichever spec held it consulted.
export function readSourceTree(): Array<readonly [string, string]> {
  return fs.readdirSync(SOURCE_DIR)
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .map((f) => [f, fs.readFileSync(path.join(SOURCE_DIR, f), 'utf8')] as const);
}

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
  // The declaration, the dependency resolution, and the per-entity correctness
  // check.
  //
  // 🔴 NO SINGLE REASON HOLDS THE REMAINDER, AND READING IT AS THOUGH ONE DID IS
  // HOW AN ENTRY COMES TO LOOK SETTLED WHEN IT IS NOT. Each survivor carries its
  // own reason at its own call site, which is where a reader standing at a launch
  // can see it. In `workspace-catalog-view.ts`: the per-entity correctness check,
  // whose request answers correctness in a different shape — over a document's
  // bytes or a Release's closure, neither of which a row names. In
  // `operations.ts`: the dependency resolution, held by a stop the request surface
  // cannot match — the closure walk resolves each entity through a catalog lookup
  // that takes no context, so the registry fetch inside the walk runs on one
  // nothing can cancel, while ending the process ends it.
  //
  // 🔴 TWO OPERATIONS ARE ABSENT FROM THIS TABLE AND THEIR ABSENCE IS THE
  // MEASUREMENT. The registry index build is absent because its walk observes the
  // request's own context ahead of each registry's walk and write and carries it
  // into every network call, so the stop survives on the request surface. The
  // per-entity conventions check is absent because a publish carries the subject
  // it was about, so an
  // answer covering one entity replaces that entity's entries rather than the
  // whole panel — which is the only thing that kept it on a command. An entry
  // appearing in `registries-view.ts`, or a second one in
  // `workspace-catalog-view.ts`, is a regression rather than a survivor, and this
  // comparison is what says so.
  runWatchableCli: [
    ['cli-operation.ts', 1],
    ['operations.ts', 1],
    ['workspace-catalog-view.ts', 1],
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
// runner they both drive, and a module that declares the facility as an injected
// seam rather than calling it.
//
// That last one is a member deliberately, as a module that only described the
// facility in prose would be. Excluding such members would mean deciding which
// mentions are real, which needs a parser rather than a reading — and a member
// that turns out to be prose costs a look at a failing comparison, while a
// missing member costs a launch nobody noticed. A new module that merely
// mentions the facility therefore fails this comparison, and reading the diff is
// how it is resolved.
export const RECORDED_LAUNCH_FACILITY_MODULES: readonly string[] = [
  'cli-json.ts',
  'cli-operation.ts',
  'cli-run.ts',
  'daemon.ts',
  'extension.ts',
  'version-check.ts',
];
