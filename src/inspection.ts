// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as vscode from 'vscode';
import { CancellationSignal } from './cancellation';
import { OutcomeChannel, reportOutcome } from './cli-operation';
import {
  DeclaringDocument,
  INSPECTION_SUBJECT,
  OPEN_DECLARING_DOCUMENT_ACTION,
  inspectionEnding,
} from './inspection-request';
import * as l10n from './l10n';
import { outcomeOf } from './operation-outcome';
import { openDocument } from './open-document';
import { withCancellableProgress } from './progress';

// InspectionDeps is what an inspection needs: the request, the root a path in
// its answer resolves against, and the channel its ending is written to. It is
// declared this narrowly so each surface offering an inspection satisfies it
// structurally with its own richer dependency set.
export interface InspectionDeps extends OutcomeChannel {
  getWorkspaceRoot(): string | null;
  entityDefinition(name: string, signal?: CancellationSignal): Promise<unknown>;
}

// inspectEntity reports what the entity named name resolves to, opened as a new
// document, or how the language server refused to say.
//
// 🔴 IT IS THE ONE INSPECTION, AND EVERY SURFACE THAT OFFERS ONE CALLS IT. The
// Commands panel and a Catalog panel row both inspect, and an inspection they
// each composed would word a refusal differently the first time either changed —
// with nothing failing while the two agreed. So the request, the progress it
// runs behind and the ending it leaves are decided here once, and the ending's
// words are decided in inspectionEnding, where a test reads them back.
//
// The resolution runs over the catalog, so it is watched and can be stopped on
// the same terms as every other operation that walks one.
export async function inspectEntity(deps: InspectionDeps, name: string): Promise<void> {
  try {
    const result = await withCancellableProgress(
      l10n.t('Aggrega: inspecting {0}', name),
      (signal) => deps.entityDefinition(name, signal),
    );
    await openDocument(JSON.stringify(result, null, 2), 'json');
  } catch (err) {
    const ending = inspectionEnding(name, err, deps.getWorkspaceRoot());
    if (ending.kind === 'ended') {
      await reportOutcome(deps, INSPECTION_SUBJECT, ending.outcome, true);
      return;
    }
    // A refusal naming the document that declares the entity: the channel and
    // the notification carry the same sentence, and the notification's one
    // button opens that document rather than the channel, since the channel
    // holds nothing the sentence does not.
    deps.output.appendLine(ending.line);
    const document = ending.document;
    if (document === null) {
      void vscode.window.showErrorMessage(ending.line);
      return;
    }
    const choice = await vscode.window.showErrorMessage(ending.line, OPEN_DECLARING_DOCUMENT_ACTION);
    if (choice === OPEN_DECLARING_DOCUMENT_ACTION) {
      await openDeclaringDocument(deps, document);
    }
  }
}

// openDeclaringDocument opens the document a refusal named, with the cursor at
// the position the refusal carries, or at the document's start where it carries
// none. It is opened as a kept tab rather than a preview, because the reader is
// going there to change it.
//
// A document that cannot be opened — removed since the answer was written, say —
// ends the way any failed operation ends rather than leaving the press silent.
async function openDeclaringDocument(deps: OutcomeChannel, document: DeclaringDocument): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(document.file));
    const selection = document.at === null
      ? undefined
      : new vscode.Range(
        document.at.line, document.at.character, document.at.line, document.at.character,
      );
    await vscode.window.showTextDocument(doc, { preview: false, selection });
  } catch (err) {
    await reportOutcome(deps, l10n.t('Opening {0}', document.file), outcomeOf(err), true);
  }
}
