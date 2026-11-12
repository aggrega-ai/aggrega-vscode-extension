// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as vscode from 'vscode';

// openDocument puts text in front of the reader in an unsaved buffer.
//
// Nothing is written to disk: the buffer is where the author reads, edits or
// discards it, and the moment a new document reaches disk stays with them. It is
// also what keeps an operation that answers with a document from ending in
// silence — the answer is something the reader can see.
//
// Every surface that answers with a document reaches it here, so how such an
// answer is presented is one decision rather than one per panel: a second
// opening written elsewhere would settle the buffer's language and its preview
// state again, and the two would agree only until one of them changed.
export async function openDocument(content: string, language: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ content, language });
  await vscode.window.showTextDocument(doc, { preview: false });
}
