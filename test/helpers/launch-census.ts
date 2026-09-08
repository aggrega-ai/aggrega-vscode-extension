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
// Its own survival is deliberate rather than pending: the operations still behind
// it are one the compiler does not serve, because its subject is the toolchain
// rather than a workspace, and one whose command-line run can be stopped in a way
// no request could be.
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
