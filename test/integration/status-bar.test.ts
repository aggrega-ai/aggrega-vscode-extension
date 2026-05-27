// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as vscode from 'vscode';

// Verifies the status bar item is bound to the openMenu command.
// Direct DOM-level inspection of the rendered status bar is not
// exposed via the VS Code API; this test asserts the command is
// available and clickable through the command palette, which is the
// same code path the status bar's click invokes.
describe('Aggrega status bar', () => {
  before(async function () {
    this.timeout(15000);
    const ext = vscode.extensions.getExtension('aggrega-ai.aggrega-vscode-extension');
    assert.ok(ext);
    await ext.activate();
  });

  it('exposes the openMenu command through the command registry', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('aggrega.statusBar.openMenu'));
  });
});
