// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';

import {
  LAUNCH_HELPERS,
  RECORDED_LAUNCH_FACILITY_MODULES,
  RECORDED_LAUNCH_SITES,
  launchFacilityModules,
  launchHelperSites,
} from '../helpers/launch-census';

// The extension reaches the compiler two ways: it asks the language server, and
// it invokes the binary as a command. Which operations still take the second way
// is a property of the whole surface rather than of any one panel, so it is
// measured here, once, over the whole source tree.
//
// 🔴 EVERY CLAIM HERE IS AN EQUALITY, NEVER A PRESENCE. A presence reading passes
// while any one of several launches survives, and a total cannot say which module
// a launch sits in — so a comparison against the recorded per-module shape is the
// only form that can express "these and no others".
//
// 🔴 THE EQUALITY IS ITS OWN CONTROL, which is why no separate one is asserted
// beside it. A pattern that stopped matching yields an empty list, and an empty
// list is not the recorded shape, so the comparison refuses it and names what it
// expected. A pattern that widened to catch a comment or an import raises a count
// and is refused from the other side. Both directions fail loudly, so an extra
// "does the instrument still fire" case would assert something already fixed.
describe('the launch census over the whole surface', () => {
  for (const helper of LAUNCH_HELPERS) {
    it(`accounts for every direct call of ${helper}, per module`, () => {
      // A gained call site is a second way of reaching one operation, and a lost
      // one is an operation that moved: both are changes a reader has to see, so
      // both fail here rather than one of them.
      assert.deepStrictEqual(
        launchHelperSites(helper),
        RECORDED_LAUNCH_SITES[helper].map((row) => [...row]),
        `${helper} gained or lost a direct call site; each one invokes the compiler as a `
        + 'command, and each needs a stated reason at the call',
      );
    });
  }

  it('names every module that can start a child process at all', () => {
    // The per-helper readings above are keyed on three names, so a fourth helper
    // written around the same primitives in a new module would pass every one of
    // them. This reading is keyed on the primitives instead, which is what makes
    // "no new launch appeared" a claim about the surface rather than about three
    // identifiers.
    assert.deepStrictEqual(
      launchFacilityModules(),
      [...RECORDED_LAUNCH_FACILITY_MODULES],
      'a module gained or lost a way of starting a child process; a new one is a new '
      + 'execution path unless it is only describing the facility, and reading the diff is '
      + 'how the two are told apart',
    );
  });
});
