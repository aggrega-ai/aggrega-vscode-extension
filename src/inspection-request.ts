// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { zeroBasedFromOneBased } from './diagnostics-shape';
import { isJsonRpcError } from './error-surfaces';
import { OperationOutcome, outcomeOf } from './operation-outcome';
import { ERR_ENTITY_NOT_RESOLVABLE } from './types';
import { fromWorkspaceRelative } from './workspace';

// This module decides how an inspection ends when the language server refuses
// it. It holds no editor type, so the sentence a reader is shown and the
// document its action opens are read back by a test exactly as an author would
// meet them.
//
// An inspection is refused for one of two reasons, and they need different
// things from the reader. A name nothing declares is usually a mistyped request,
// and it ends the way any failed operation ends. A name a document in the
// workspace does declare, which the catalog nonetheless resolved nothing for, is
// a state of the workspace a person repairs — so the ending names that document
// as the cause and offers to open it, rather than reporting an operation that
// broke.

// INSPECTION_SUBJECT names the operation in the reader's terms, for the ending
// every other refusal takes.
export const INSPECTION_SUBJECT = 'The inspection';

// OPEN_DECLARING_DOCUMENT_ACTION is the label on the button a refusal naming
// the declaring document offers.
export const OPEN_DECLARING_DOCUMENT_ACTION = 'Open document';

// DeclaringDocument is where that button takes the reader: the absolute path of
// the document, and the 0-based position to put the cursor at, or null where the
// answer names no line and the document opens at its start.
export interface DeclaringDocument {
  file: string;
  at: { line: number; character: number } | null;
}

// InspectionEnding is how one refused inspection ends.
//
// declaring-document carries its own sentence, which the notification and the
// channel both show, and the document the button opens — null where no workspace
// root is in use, since the reported path is read against one, in which case no
// button is offered. ended carries the outcome every other operation ends in, and
// is reported through the same ending they are.
export type InspectionEnding =
  | { kind: 'declaring-document'; line: string; document: DeclaringDocument | null }
  | {
    kind: 'ended';
    outcome: Extract<OperationOutcome, { kind: 'cancelled' } | { kind: 'failed' }>;
  };

// inspectionEnding reads a thrown value from the inspection of name.
//
// 🔴 THE BRANCH IS ON THE ENVELOPE'S FIELDS, NEVER ON ITS WORDS. A refusal names
// the declaring document in its file field exactly when a workspace document
// declares the name, and a name nothing declares carries no such field — that is
// the compiler's stated contract for this request, so the field's presence is
// the whole test. Reading the message instead would stop recognising the case
// the first time the sentence was reworded, and nothing would fail.
//
// 🔴 THE SENTENCE SAYS "BECAUSE OF THE DOCUMENT THAT DECLARES IT", AND NOT THAT
// THE DOCUMENT WAS REFUSED, BECAUSE THE FIELD DOES NOT SAY WHICH. It is carried
// both where the catalog read the document and refused it, and where the
// catalog never read it because it sits outside every catalog directory. The
// document is the cause in both, and the compiler's own sentence, which follows,
// says which of the two it is and what to change.
//
// That sentence is the compiler's message, carried whole and unchanged. What is
// left out is the code the transport attaches, because it names the refusal for
// a program and the reader is already told, in words, what it means. Every other
// thrown value is rendered by the extension's one reading of a thrown value,
// reached through outcomeOf, so a stopped inspection still reads as stopped.
//
// A relative path resolves against workspaceRoot, the anchored root every other
// path this side reads off an answer resolves against. The line and column are
// the envelope's own 1-based fields, read where it carries a line.
export function inspectionEnding(
  name: string,
  err: unknown,
  workspaceRoot: string | null,
): InspectionEnding {
  // Truthiness rather than a presence check on purpose: an empty path names no
  // document, so it falls through to the ordinary ending rather than offering
  // to open the workspace root.
  if (isJsonRpcError(err) && err.code === ERR_ENTITY_NOT_RESOLVABLE && err.data?.file) {
    const line = `${name} cannot be inspected because of the document that declares it: ${err.message}`;
    if (workspaceRoot === null) {
      return { kind: 'declaring-document', line, document: null };
    }
    const reportedLine = err.data.line ?? 0;
    const at = reportedLine > 0
      ? {
        line: zeroBasedFromOneBased(reportedLine),
        character: zeroBasedFromOneBased(err.data.column ?? 0),
      }
      : null;
    return {
      kind: 'declaring-document',
      line,
      document: { file: fromWorkspaceRelative(workspaceRoot, err.data.file), at },
    };
  }
  return { kind: 'ended', outcome: outcomeOf(err) };
}
