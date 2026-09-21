// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { findAggregaWorkspaceAnchor } from '../../src/workspace';

// The workspace-discovery parity cases are owned by the aggrega-cli repo, next
// to the authoritative Go resolver (the daemon this extension drives). Both the
// Go resolver test and this test materialize the SAME cases and assert their
// discovery agrees, so the extension's TypeScript discovery cannot silently
// diverge from the daemon's — and a new marker added on the Go side is covered
// here automatically, with no hand-kept copy.
//
// aggrega-cli is a required sibling of this repo (the extension spawns the
// aggrega binary), and every layout that gates this suite has it checked out
// beside this one.
//
// 🔴 AN UNREADABLE MANIFEST FAILS HERE; IT DOES NOT STAND THE SUITE DOWN. A
// side that reads nothing and reports success is indistinguishable from one
// that compared every case and agreed, which is the precise way a parity pair
// rots: the pair proves the two sides AGREE, never that both RAN. So the one
// outcome this spec must never produce is a green over a comparison it did not
// perform, and a skip is exactly that green.
const PARITY_CASES = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'aggrega-cli',
  'pkg',
  'workspaceconfig',
  'testdata',
  'discovery_parity_cases.json',
);

interface FixtureFile {
  path: string;
  content?: string;
  dir?: boolean;
}
interface ParityCase {
  name: string;
  files: FixtureFile[];
  start: string;
  anchor: string | null;
  marker: string;
}

// WANT_FIXTURE_REVISION is the revision of the shared case manifest THIS side
// was written against, and the assertion below refuses any other.
//
// 🔴 IT IS A DELIBERATE NEAR-DUPLICATE OF THE GO RESOLVER TEST'S OWN PINNED
// COPY AND MUST NOT BE UNIFIED WITH IT — not by reading it out of the manifest,
// not by importing it, not by generating both from one place. The climb is
// implemented twice across a language boundary on purpose; the value of the
// cross-check is that the two were written independently, and one constant
// cannot disagree with itself while disagreement is the entire signal.
//
// What the pin buys: a green from this side becomes evidence that THIS side
// read the revision named below, rather than evidence that somebody's
// comparison agreed. Bumping the manifest's revision refuses both sides until
// each side's own copy is moved, which cannot be done without running both.
//
// 🔴 TWO BOUNDS SHIP WITH IT. It cannot catch a runner-level filter, because no
// test observes its own non-execution; what covers that is the build driver's
// target table, which runs this package's suite, and its census refusing a
// package that declares a suite no target runs. And it says nothing about the
// Go side's execution: it pins this side's reading, and two greens pinned to
// one revision are what jointly mean both sides read it.
const WANT_FIXTURE_REVISION = 2;

describe('workspace-discovery cross-language parity', function () {
  let cases: ParityCase[] | null = null;

  before(async function () {
    let raw: string;
    try {
      raw = await fs.readFile(PARITY_CASES, 'utf8');
    } catch (err) {
      throw new Error(
        `parity cases unreadable at ${PARITY_CASES} (${String(err)}). `
        + 'The aggrega-cli sibling checkout holds the shared case manifest; without it this '
        + 'spec compares nothing, and reporting success for that would certify a comparison '
        + 'it never made. Check out aggrega-cli beside this repo.',
      );
    }
    const doc = JSON.parse(raw) as { revision?: number; cases: ParityCase[] };
    assert.strictEqual(
      doc.revision,
      WANT_FIXTURE_REVISION,
      `parity manifest revision mismatch: this side is pinned to ${WANT_FIXTURE_REVISION}. `
      + 'Move this pin and the Go resolver test\'s own pin together, and run BOTH sides: a '
      + 'pair whose sides name different revisions has not compared anything.',
    );
    cases = doc.cases;
    assert.ok(cases && cases.length > 0, 'parity manifest has no cases');
  });

  it('matches the Go resolver on every shared case', async function () {
    assert.ok(cases, 'cases not loaded');
    for (const tc of cases) {
      const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'aggrega-parity-'));
      try {
        for (const f of tc.files) {
          const full = path.join(fixture, f.path);
          if (f.dir) {
            await fs.mkdir(full, { recursive: true });
            continue;
          }
          await fs.mkdir(path.dirname(full), { recursive: true });
          await fs.writeFile(full, f.content ?? '');
        }
        const start = path.join(fixture, tc.start);
        await fs.mkdir(start, { recursive: true });

        const got = await findAggregaWorkspaceAnchor(start);
        const want = tc.anchor === null ? null : path.join(fixture, tc.anchor);
        assert.strictEqual(got, want, `case ${JSON.stringify(tc.name)}: anchor mismatch`);
      } finally {
        await fs.rm(fixture, { recursive: true, force: true });
      }
    }
  });
});
