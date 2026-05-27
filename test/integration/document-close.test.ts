// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';

// Replaces the former unit-tier close-handler.test.ts. The close-handler
// helper module was retired and its body inlined at the registration site;
// this integration test asserts the observable behavior — diagnostics
// cleared after the document closes — at the vscode-test tier.
describe('Aggrega document-close diagnostic clearing', () => {
  before(async function () {
    this.timeout(20000);
    const ext = vscode.extensions.getExtension('aggrega-ai.aggrega-vscode-extension');
    assert.ok(ext);
    await ext.activate();
  });

  it('clears diagnostics from the collection after close', async function () {
    this.timeout(10000);
    const ws = vscode.workspace.workspaceFolders?.[0];
    assert.ok(ws);
    const uri = vscode.Uri.file(path.join(ws.uri.fsPath, 'aggregate.yaml'));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Close all editors so VS Code fires onDidCloseTextDocument.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await new Promise(resolve => setTimeout(resolve, 500));

    // After close, the extension's onDidCloseTextDocument handler
    // should have cleared the per-URI diagnostic-collection entry.
    const diagnostics = vscode.languages.getDiagnostics(uri);
    assert.deepStrictEqual(diagnostics, [], 'expected diagnostics cleared after close');
  });
});
