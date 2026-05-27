// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as vscode from 'vscode';

// Verifies the extension is discoverable in vscode.extensions.all
// and activates against the fixture workspace. The fixture carries
// a .aggrega-config.yaml which matches one of the extension's
// activationEvents.
describe('Aggrega extension activation', () => {
  it('is present in vscode.extensions.all', () => {
    const ext = vscode.extensions.getExtension('aggrega-ai.aggrega-vscode-extension');
    assert.ok(ext, 'expected Aggrega extension to be registered');
  });

  it('activates against the fixture workspace', async function () {
    this.timeout(15000);
    const ext = vscode.extensions.getExtension('aggrega-ai.aggrega-vscode-extension');
    assert.ok(ext);
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });
});
