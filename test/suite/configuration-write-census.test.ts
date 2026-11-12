// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';

import {
  CONFIGURATION_WRITES,
  DIRECT_RESTARTS,
  NOT_A_CONFIGURATION_WRITE,
  OWN_WRITE,
  callExtent,
  literalCount,
  requestSites,
} from '../helpers/configuration-write-census';
import { sourceOf } from '../helpers/graph-refresh-census';
import { readSourceTree } from '../helpers/launch-census';

// Which requests are followed by a restart of the language server is a wiring
// property of the module that sends them, and this is where it is held. That
// module imports the editor, so the requests cannot be called from here; what CAN
// be read is which of them is sent from inside the hand-over to the watch, which
// is the one place the restart after a configuration write is decided. How the
// watch decides — once per write, never twice, and whether the write is then in
// effect — is driven by equality in the watch's own suite.
//
// 🔴 BOTH DIRECTIONS ARE ASSERTED AND NEITHER IS THE POINT ON ITS OWN. A write
// sent outside the hand-over leaves the server answering from the configuration
// it started with until something else restarts it; a request that writes no
// configuration file sent inside it restarts the server for nothing. So the set
// handed over is compared with the recorded set as a whole.

const EXTENSION = 'src/extension.ts';

describe('the requests followed by a restart of the language server', () => {
  it('reads real request sites, so an absence below is an absence', () => {
    // 🔴 THE INSTRUMENT'S OWN CONTROLS, on the same side of the claim as the
    // subjects. The census has to find request methods at all; it has to find the
    // listing, which is a request that writes nothing, outside the hand-over; and
    // it has to find the credential removal, which is the site the second
    // direction of the rule is about, as a real function with a body.
    const sites = requestSites(sourceOf(EXTENSION));
    assert.ok(sites.length > CONFIGURATION_WRITES.length, `the census read only ${sites.length} request method(s) in ${EXTENSION}`);
    const listing = sites.find((s) => s.method === 'aggrega/registryList');
    assert.ok(listing !== undefined && listing.fn !== null, 'the registry listing is no longer found as a request site');
    assert.strictEqual(listing.handedOver, false, 'the registry listing reads as handed to the watch');
    const logout = sites.filter((s) => s.method === NOT_A_CONFIGURATION_WRITE);
    assert.strictEqual(logout.length, 1, `${NOT_A_CONFIGURATION_WRITE} is sent from ${logout.length} place(s), not one`);
    assert.ok(
      logout[0].fn !== null && logout[0].body.includes(`'${NOT_A_CONFIGURATION_WRITE}'`),
      'the credential removal was not read as a function holding its request, so the claim about it below would be vacuous',
    );
  });

  it('attributes every request to the function it is sent from', () => {
    // A method the reading could not place inside a declared function is a method
    // whose hand-over nothing below looks at, so it is a failure rather than a
    // row to skip.
    const unplaced = requestSites(sourceOf(EXTENSION)).filter((s) => s.fn === null).map((s) => s.method);
    assert.deepStrictEqual(unplaced, [], `request methods no declared function was found around: ${unplaced.join(', ')}`);
  });

  it('hands exactly the configuration writes to the watch', () => {
    const handed = requestSites(sourceOf(EXTENSION))
      .filter((s) => s.handedOver)
      .map((s) => s.method)
      .sort();
    assert.deepStrictEqual(
      handed,
      [...CONFIGURATION_WRITES],
      'the requests sent from inside the hand-over to the watch are not exactly the configuration '
      + 'writes. A write missing here is followed by no restart, so the language server goes on '
      + 'answering from the configuration it started with; a request here that writes no '
      + 'configuration file restarts the server for nothing.',
    );
  });

  it('hands each write over once, from one function, and restarts nothing beside the watch', () => {
    const sites = requestSites(sourceOf(EXTENSION));
    for (const method of CONFIGURATION_WRITES) {
      const at = sites.filter((s) => s.method === method);
      assert.strictEqual(at.length, 1, `${method} is sent from ${at.length} place(s) in ${EXTENSION}, not one`);
      const site = at[0];
      assert.strictEqual(site.ownWrites, 1, `${site.fn} hands ${site.ownWrites} write(s) to the watch, not one`);
      // The needle on the extraction itself: every hand-over ends by naming the
      // file the answer says was written, so an extent that stopped short of that
      // reader is a parenthesis match that is wrong.
      const call = callExtent(site.body, site.body.indexOf(OWN_WRITE));
      assert.ok(
        call !== null && call.includes('writtenFile('),
        `the hand-over in ${site.fn} was not read to its end, so whether it holds ${method} is not measured`,
      );
      for (const restart of DIRECT_RESTARTS) {
        assert.ok(
          !site.body.includes(restart),
          `${site.fn} restarts the language server itself (${restart}) as well as handing its write to `
          + 'the watch, which is a second restart for one change',
        );
      }
    }
  });

  it('sends no configuration write from any other module', () => {
    // A second sender in a neighbouring module is exactly the change this claim
    // has to survive, and a reading of one module cannot see it.
    const tree = readSourceTree();
    for (const method of CONFIGURATION_WRITES) {
      assert.deepStrictEqual(literalCount(tree, method), [['extension.ts', 1]], `${method} is named outside ${EXTENSION}, or more than once`);
    }
  });

  it('does not hand the credential removal to the watch', () => {
    const [logout] = requestSites(sourceOf(EXTENSION)).filter((s) => s.method === NOT_A_CONFIGURATION_WRITE);
    assert.strictEqual(logout.ownWrites, 0, `${logout.fn} hands a write to the watch`);
    assert.strictEqual(logout.handedOver, false);
    for (const restart of DIRECT_RESTARTS) {
      assert.ok(!logout.body.includes(restart), `${logout.fn} restarts the language server (${restart})`);
    }
  });
});
