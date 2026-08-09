// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { findAggregaWorkspaceAnchor, toWorkspaceRelative } from '../../src/workspace';

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

describe('toWorkspaceRelative', () => {
  // The daemon reports Release candidates as absolute paths and takes
  // workspace-relative ones in its request parameters. It refuses the absolute
  // form rather than resolving it, so the conversion is what keeps a value read
  // from one surface usable on the other. These cases pin it.
  const root = path.join(path.sep + 'ws', 'project');

  it('converts an absolute Release path under the root to the relative form', () => {
    const abs = path.join(root, 'envs', 'prod.yaml');
    assert.strictEqual(toWorkspaceRelative(root, abs), path.join('envs', 'prod.yaml'));
  });

  it('converts an absolute Release path at the root itself', () => {
    const abs = path.join(root, 'release.yaml');
    assert.strictEqual(toWorkspaceRelative(root, abs), 'release.yaml');
  });

  it('leaves an already-relative path untouched', () => {
    // Idempotence matters because the conversion sits on a path a caller may
    // have converted already; a second pass must not re-anchor it.
    const rel = path.join('envs', 'prod.yaml');
    assert.strictEqual(toWorkspaceRelative(root, rel), rel);
    assert.strictEqual(toWorkspaceRelative(root, toWorkspaceRelative(root, rel)), rel);
  });

  it('produces no escaping path for any candidate the daemon enumerates', () => {
    // The daemon enumerates Release candidates by walking from the workspace
    // root, so every candidate lies under it and the relative form never
    // starts with a parent segment — which is exactly what the daemon now
    // refuses. This is the property that makes normalisation sufficient.
    for (const depth of [['release.yaml'], ['envs', 'prod.yaml'], ['a', 'b', 'c', 'r.yaml']]) {
      const rel = toWorkspaceRelative(root, path.join(root, ...depth));
      assert.ok(
        !rel.startsWith('..'),
        `candidate ${depth.join('/')} produced an escaping relative path: ${rel}`,
      );
      assert.strictEqual(rel, path.join(...depth));
    }
  });
});
