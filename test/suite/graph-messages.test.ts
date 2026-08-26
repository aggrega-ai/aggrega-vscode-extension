// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import { makeGraphMessageHandler } from '../../src/graph-messages';

interface Recorder {
  opened: Array<{ workspaceRoot: string; sourceFile: string }>;
  noWorkspaceReports: number;
}

function recorder(): Recorder {
  return { opened: [], noWorkspaceReports: 0 };
}

function handlerOver(getRoot: () => string | null, rec: Recorder) {
  return makeGraphMessageHandler(getRoot, {
    openSource: (workspaceRoot, sourceFile) => { rec.opened.push({ workspaceRoot, sourceFile }); },
    reportNoWorkspace: () => { rec.noWorkspaceReports++; },
  });
}

describe('makeGraphMessageHandler', () => {
  it('resolves a click against the root that is live at click time, not at registration', () => {
    const rec = recorder();
    // The reader is rebound between clicks, standing for the workspace
    // re-anchoring while the panel — and therefore the handler — stays alive.
    let root: string | null = '/first/root';
    const handle = handlerOver(() => root, rec);

    handle({ type: 'openSource', sourceFile: 'aggregate.yaml' });
    root = '/second/root';
    handle({ type: 'openSource', sourceFile: 'aggregate.yaml' });

    assert.deepStrictEqual(rec.opened, [
      { workspaceRoot: '/first/root', sourceFile: 'aggregate.yaml' },
      { workspaceRoot: '/second/root', sourceFile: 'aggregate.yaml' },
    ]);
    assert.strictEqual(rec.noWorkspaceReports, 0);
  });

  it('reports rather than guesses when nothing is anchored at click time', () => {
    const rec = recorder();
    let root: string | null = '/a/root';
    const handle = handlerOver(() => root, rec);

    handle({ type: 'openSource', sourceFile: 'release.yaml' });
    root = null;
    handle({ type: 'openSource', sourceFile: 'release.yaml' });

    assert.deepStrictEqual(rec.opened, [{ workspaceRoot: '/a/root', sourceFile: 'release.yaml' }]);
    assert.strictEqual(rec.noWorkspaceReports, 1);
  });

  it('ignores a message that names no source file, and an unrecognized type', () => {
    const rec = recorder();
    const handle = handlerOver(() => '/a/root', rec);

    handle({ type: 'openSource' });
    handle({ type: 'openSource', sourceFile: '' });
    handle({ type: 'somethingElse', sourceFile: 'aggregate.yaml' });

    assert.deepStrictEqual(rec.opened, []);
    assert.strictEqual(rec.noWorkspaceReports, 0);
  });
});
