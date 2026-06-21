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
// aggrega binary). When the sibling checkout is absent — a standalone clone of
// just this repo — the cases cannot be read and the suite skips loudly rather
// than failing confusingly. Where both repos are checked out together (the
// product/CI layout), the sibling is always present and these run.
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

describe('workspace-discovery cross-language parity', function () {
  let cases: ParityCase[] | null = null;

  before(async function () {
    let raw: string;
    try {
      raw = await fs.readFile(PARITY_CASES, 'utf8');
    } catch {
      // Sibling aggrega-cli not checked out — standalone clone. Skip loudly.
      // eslint-disable-next-line no-console
      console.warn(
        `parity cases not found at ${PARITY_CASES}; the aggrega-cli sibling repo is not checked out — skipping cross-language parity. Check out aggrega-cli beside this repo to run it.`,
      );
      this.skip();
      return;
    }
    cases = (JSON.parse(raw) as { cases: ParityCase[] }).cases;
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
