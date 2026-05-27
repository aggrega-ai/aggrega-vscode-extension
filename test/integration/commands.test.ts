// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as vscode from 'vscode';

// Verifies the two Aggrega-contributed commands are registered with
// VS Code at extension activation. The status bar item binds its
// click handler to the openMenu command; the restart command is
// surfaced both directly and through the quick-pick menu.
describe('Aggrega-contributed commands', () => {
  before(async function () {
    this.timeout(15000);
    const ext = vscode.extensions.getExtension('aggrega-ai.aggrega-vscode-extension');
    assert.ok(ext);
    await ext.activate();
  });

  it('registers aggrega.server.restart', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('aggrega.server.restart'),
      'expected aggrega.server.restart to be in the command registry',
    );
  });

  it('registers aggrega.statusBar.openMenu', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes('aggrega.statusBar.openMenu'),
      'expected aggrega.statusBar.openMenu to be in the command registry',
    );
  });
});
