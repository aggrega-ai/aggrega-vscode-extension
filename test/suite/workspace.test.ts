// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  ACTIVE_RELEASE_MARKER_BASENAME,
  ACTIVE_RELEASE_MARKER_GLOB,
  AGGREGA_DIR,
  activeReleaseMarkerPath,
  findAggregaWorkspaceAnchor,
  releaseParamFor,
  toWorkspaceRelative,
} from '../../src/workspace';

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

  // anchoredAlone materializes one file in a directory of its own and answers
  // what the climb makes of it. Each row gets its own directory so a row cannot
  // be answered by a file another row wrote.
  async function anchoredAlone(name: string): Promise<{ dir: string; found: string | null }> {
    const dir = path.join(tmpRoot, name.replace(/[^a-z0-9]/gi, '-'));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), '');
    return { dir, found: await findAggregaWorkspaceAnchor(dir) };
  }

  // Both YAML spellings anchor, for every glob prefix. The compiler accepts
  // either, so a reader whose Release is named release.yml is in an Aggrega
  // workspace exactly as one whose Release is release.yaml is.
  it('anchors on either YAML spelling, for every glob prefix', async () => {
    for (const name of [
      'aggregate.yaml',
      'aggregate.yml',
      'aggregate-staging.yml',
      'release.yaml',
      'release.yml',
      'manifest.yaml',
      'manifest.yml',
    ]) {
      const { dir, found } = await anchoredAlone(name);
      assert.strictEqual(
        found,
        path.join(dir, name),
        `${name} does not anchor, so a reader who named their file that is told no Aggrega workspace is available while a build finds one`,
      );
    }
  });

  // 🔴 THE LOCKFILE EXCLUSION HAS TO COVER EVERY SPELLING THE GLOB TIER
  // ACCEPTS, AND IT IS THE HALF THAT GOES UNNOTICED. Admitting a spelling
  // without excluding its lockfile form makes a generated lockfile anchor a
  // workspace root — which the compiler refuses — and the symptom is a reader
  // whose build output directory is reported to them as their project root.
  // Each form is named here because a check written against one spelling
  // passes while the other anchors.
  it('excludes the lockfile form of every accepted YAML spelling', async () => {
    for (const name of [
      'aggregate.lock.yaml',
      'aggregate.lock.yml',
      'release.lock.yaml',
      'release.lock.yml',
      'manifest.lock.yaml',
      'manifest.lock.yml',
    ]) {
      const { found } = await anchoredAlone(name);
      assert.strictEqual(
        found,
        null,
        `${name} anchors a workspace root, which a generated lockfile must never do`,
      );
    }
  });

  // A quoted key is the same key. YAML lets a mapping key be bare or quoted and
  // the compiler reads the document rather than its lines, so all three
  // spellings name one key and all three anchor.
  it('anchors on a workspace key written bare or quoted', async () => {
    for (const content of ['workspace: {}\n', '"workspace": {}\n', "'workspace': {}\n"]) {
      const dir = path.join(tmpRoot, `quoted-${Buffer.from(content).toString('hex')}`);
      await fs.mkdir(dir, { recursive: true });
      const cfgPath = path.join(dir, '.aggrega-config.yaml');
      await fs.writeFile(cfgPath, content);
      assert.strictEqual(
        await findAggregaWorkspaceAnchor(dir),
        cfgPath,
        `a configuration reading ${JSON.stringify(content)} does not anchor, though the compiler reads it as the same key`,
      );
    }
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

describe('releaseParamFor', () => {
  // A Release is offerable exactly when the request derived from it would be
  // accepted, so this is the offer and the acceptance expressed once. These
  // cases pin both directions, because a bound whose refusal nobody has
  // demonstrated proves nothing.
  const root = path.join(path.sep + 'ws', 'project');

  it('names a document inside the root, in the form a request takes', () => {
    assert.strictEqual(
      releaseParamFor(root, path.join(root, 'envs', 'prod.yaml')),
      path.join('envs', 'prod.yaml'),
    );
    assert.strictEqual(releaseParamFor(root, path.join(root, 'release.yaml')), 'release.yaml');
  });

  it('refuses a path that climbs out of the root', () => {
    assert.strictEqual(
      releaseParamFor(root, path.join(path.sep + 'ws', 'other', 'release.yaml')),
      null,
    );
    assert.strictEqual(releaseParamFor(root, path.join('..', 'release.yaml')), null);
    assert.strictEqual(releaseParamFor(root, '..'), null);
  });

  it('refuses a sibling whose name merely extends the root, which a prefix test would accept', () => {
    const sibling = path.join(path.sep + 'ws', 'project-old', 'release.yaml');
    assert.ok(sibling.startsWith(root), 'the sibling really does share the prefix');
    assert.strictEqual(releaseParamFor(root, sibling), null);
  });

  it('accepts an interior climb that resolves back inside', () => {
    // Escape is a property of where the value lands, not of how it is spelled,
    // which is the rule the request parameter is judged by.
    assert.strictEqual(
      releaseParamFor(root, path.join('a', '..', 'b', 'release.yaml')),
      path.join('a', '..', 'b', 'release.yaml'),
    );
  });

  it('refuses a value naming the root itself, which names no document', () => {
    assert.strictEqual(releaseParamFor(root, root), null);
  });

  it('refuses every candidate when there is no root to name one against', () => {
    assert.strictEqual(releaseParamFor('', path.join(root, 'release.yaml')), null);
  });
});

describe('active-release marker location', () => {
  const root = path.join(path.sep + 'w', 'proj');

  it('composes the marker path from the directory and file basenames', () => {
    assert.strictEqual(
      activeReleaseMarkerPath(root),
      path.join(root, AGGREGA_DIR, ACTIVE_RELEASE_MARKER_BASENAME),
    );
  });

  it('watches exactly the path it writes', () => {
    // This is the property the single definition exists for: the glob a
    // watcher is built from and the path the marker is written to name the same
    // location. A watcher whose pattern matches nothing reports no error and
    // logs nothing, so a mismatch between the two has no symptom beyond an
    // indicator that quietly stops refreshing — which is why renaming or moving
    // the marker must break this assertion rather than the feature.
    const written = path.relative(root, activeReleaseMarkerPath(root)).split(path.sep).join('/');
    assert.strictEqual(ACTIVE_RELEASE_MARKER_GLOB, `**/${written}`);
  });

  it('uses forward slashes in the glob on every platform', () => {
    // The editor's glob patterns are forward-slash separated regardless of the
    // host, so a pattern joined with the host separator would match nothing on
    // Windows.
    assert.ok(!ACTIVE_RELEASE_MARKER_GLOB.includes('\\'));
    assert.ok(ACTIVE_RELEASE_MARKER_GLOB.startsWith('**/'));
  });
});
