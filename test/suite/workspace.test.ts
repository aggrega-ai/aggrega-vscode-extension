// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { findAggregaWorkspaceAnchor } from '../../src/workspace';

describe('findAggregaWorkspaceAnchor', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aggrega-workspace-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('finds .aggrega-config.yaml carrying a workspace: block at the root', async () => {
    const cfgPath = path.join(tmpRoot, '.aggrega-config.yaml');
    await fs.writeFile(cfgPath, 'workspace: {}\n');
    const found = await findAggregaWorkspaceAnchor(tmpRoot);
    assert.strictEqual(found, cfgPath);
  });

  it('a bare .aggrega-config.yaml (no workspace: block) does not anchor', async () => {
    await fs.writeFile(path.join(tmpRoot, '.aggrega-config.yaml'), 'default_registry: r.io\n');
    const found = await findAggregaWorkspaceAnchor(tmpRoot);
    assert.strictEqual(found, null);
  });

  it('finds .aggrega/ directory at the workspace root', async () => {
    const dirPath = path.join(tmpRoot, '.aggrega');
    await fs.mkdir(dirPath);
    const found = await findAggregaWorkspaceAnchor(tmpRoot);
    assert.strictEqual(found, dirPath);
  });

  it('finds aggregate.yaml at the workspace root', async () => {
    const filePath = path.join(tmpRoot, 'aggregate.yaml');
    await fs.writeFile(filePath, '');
    const found = await findAggregaWorkspaceAnchor(tmpRoot);
    assert.strictEqual(found, filePath);
  });

  it('finds aggregate-staging.yaml (suffixed glob form)', async () => {
    const filePath = path.join(tmpRoot, 'aggregate-staging.yaml');
    await fs.writeFile(filePath, '');
    const found = await findAggregaWorkspaceAnchor(tmpRoot);
    assert.strictEqual(found, filePath);
  });

  it('finds release.yaml at the workspace root', async () => {
    const filePath = path.join(tmpRoot, 'release.yaml');
    await fs.writeFile(filePath, '');
    const found = await findAggregaWorkspaceAnchor(tmpRoot);
    assert.strictEqual(found, filePath);
  });

  it('finds manifest.yaml at the workspace root', async () => {
    const filePath = path.join(tmpRoot, 'manifest.yaml');
    await fs.writeFile(filePath, '');
    const found = await findAggregaWorkspaceAnchor(tmpRoot);
    assert.strictEqual(found, filePath);
  });

  it('excludes lockfile-suffixed files from glob anchoring', async () => {
    await fs.writeFile(path.join(tmpRoot, 'release.lock.yaml'), '');
    await fs.writeFile(path.join(tmpRoot, 'aggregate.lock.yaml'), '');
    const found = await findAggregaWorkspaceAnchor(tmpRoot);
    assert.strictEqual(found, null);
  });

  it('priority tiebreak: workspace: config wins over aggregate.yaml in same dir', async () => {
    const cfgPath = path.join(tmpRoot, '.aggrega-config.yaml');
    await fs.writeFile(cfgPath, 'workspace: {}\n');
    await fs.writeFile(path.join(tmpRoot, 'aggregate.yaml'), '');
    const found = await findAggregaWorkspaceAnchor(tmpRoot);
    assert.strictEqual(found, cfgPath);
  });

  it('walks upward to find an anchor in a parent directory', async () => {
    const cfgPath = path.join(tmpRoot, '.aggrega-config.yaml');
    await fs.writeFile(cfgPath, 'workspace: {}\n');
    const child = path.join(tmpRoot, 'a', 'b', 'c');
    await fs.mkdir(child, { recursive: true });
    const found = await findAggregaWorkspaceAnchor(child);
    assert.strictEqual(found, cfgPath);
  });

  it('a workspace: config ancestor wins over a nearer heuristic marker', async () => {
    // New precedence (matches the Go discoverRoot): an explicit workspace:
    // config higher up beats a nearer heuristic. The child's aggregate.yaml no
    // longer hijacks the root away from the parent's workspace: config.
    const child = path.join(tmpRoot, 'child');
    await fs.mkdir(child);
    const cfgPath = path.join(tmpRoot, '.aggrega-config.yaml');
    await fs.writeFile(cfgPath, 'workspace: {}\n');
    await fs.writeFile(path.join(child, 'aggregate.yaml'), '');
    const found = await findAggregaWorkspaceAnchor(child);
    assert.strictEqual(found, cfgPath);
  });

  it('returns null when no marker exists in the parent chain', async () => {
    const child = path.join(tmpRoot, 'a', 'b');
    await fs.mkdir(child, { recursive: true });
    const found = await findAggregaWorkspaceAnchor(child);
    assert.strictEqual(found, null);
  });
});
