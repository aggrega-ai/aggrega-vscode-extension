// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { findAggregaConfigUpward } from '../../src/workspace';

describe('findAggregaConfigUpward', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aggrega-workspace-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('finds the config when present at the workspace root', async () => {
    const cfgPath = path.join(tmpRoot, '.aggrega-config.yaml');
    await fs.writeFile(cfgPath, '');
    const found = await findAggregaConfigUpward(tmpRoot);
    assert.strictEqual(found, cfgPath);
  });

  it('walks upward to find a config in a parent directory', async () => {
    const cfgPath = path.join(tmpRoot, '.aggrega-config.yaml');
    await fs.writeFile(cfgPath, '');
    const child = path.join(tmpRoot, 'a', 'b', 'c');
    await fs.mkdir(child, { recursive: true });
    const found = await findAggregaConfigUpward(child);
    assert.strictEqual(found, cfgPath);
  });

  it('returns null when no config exists in the parent chain', async () => {
    const child = path.join(tmpRoot, 'a', 'b');
    await fs.mkdir(child, { recursive: true });
    const found = await findAggregaConfigUpward(child);
    assert.strictEqual(found, null);
  });

  it('terminates at the filesystem root without infinite loop', async () => {
    const root = path.parse(tmpRoot).root;
    const found = await findAggregaConfigUpward(root);
    assert.strictEqual(found === null || typeof found === 'string', true);
  });
});
