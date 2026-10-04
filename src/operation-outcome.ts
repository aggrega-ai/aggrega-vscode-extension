// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { CANCELLED_BY_READER, isCancellation } from './cancellation';
import { describeError } from './error-text';

// This module decides what a reader is told when an operation ends. It reaches
// no editor type at runtime, so the sentence each of the three endings produces
// is read back by a test exactly as an author would see it. The one module it
// imports for the failure text imports nothing at runtime itself.
//
// Every command ends here. That is the whole rule: an operation that finishes,
// one the reader stops, and one that fails each produce a line, so no command
// can end in silence — and a silent success, which looks exactly like a command
// that never ran, is the case this exists for.

// SHOW_OUTPUT_ACTION is the label on the button a failure offers.
//
// The remedy is the compiler's own output, in full. A failure notification is
// one line and the compiler usually wrote several — the line naming what to fix
// is often not the first — so the button takes the reader to the whole text
// rather than to a summary of it. It adds a way to reach the compiler's words
// and replaces none of them.
export const SHOW_OUTPUT_ACTION = 'Show output';

// OperationOutcome is how an operation ended.
//
// Three cases and no more, because the third is the one that gets collapsed
// into the second: an operation the reader stopped did not fail, and the reader
// who stopped it must not be told it broke.
export type OperationOutcome =
  | { kind: 'ok'; detail: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

// outcomeOf classifies a thrown value. A stopped operation is told apart by its
// type rather than by its message, so the classification cannot quietly stop
// working when a sentence is reworded.
//
// The return type names only the two endings a thrown value can be, so a caller
// that has ruled out one is left holding the other rather than a completion
// that cannot have happened.
//
// 🔴 THE FAILURE TEXT IS PRODUCED BY describeError AND IS NOT DERIVED HERE. That
// is the extension's one home for rendering a thrown value as a line, and a
// reading of its own beside it would be a second implementation of the same job
// — one that agrees for everything the extension itself throws and diverges for
// the shape the language server rejects with, which is an envelope object rather
// than an error. That divergence loses the compiler's whole diagnostic instead
// of re-wording it, and nothing fails while the two agree, which is exactly why
// the derivation lives in one place.
export function outcomeOf(
  err: unknown,
): Extract<OperationOutcome, { kind: 'cancelled' } | { kind: 'failed' }> {
  if (isCancellation(err)) {
    return { kind: 'cancelled' };
  }
  return { kind: 'failed', message: describeError(err) };
}

// terminalLine renders the sentence one ended operation leaves behind.
//
// what is the operation in the reader's terms — "The build", "The publication"
// — so the sentence reads as prose rather than as a status code.
//
// The failure case carries the compiler's message verbatim. Where the failure
// came from the compiler that text is the compiler's own, and it usually names
// what to run or what to fix; a re-wording would discard precisely that, which
// is why nothing here rewrites it and the remedy is offered as a button beside
// it instead.
export function terminalLine(what: string, outcome: OperationOutcome): string {
  switch (outcome.kind) {
    case 'ok':
      return `${what} ${outcome.detail}`;
    case 'cancelled':
      return `${what} ${CANCELLED_BY_READER}.`;
    case 'failed':
      return `${what} did not complete: ${outcome.message}`;
  }
}

// countReport renders a run's finding count, and it is written so the
// zero case is a sentence rather than an absence.
//
// A run that finds nothing is a result: it says the checks ran and objected to
// nothing. Reporting only non-zero counts leaves that run looking exactly like
// one that never happened, which teaches a reader that pressing the entry does
// nothing — and that lesson costs the surfaces carrying the real findings, not
// this one.
//
// where names the place the findings landed, so a reader with a non-zero count
// knows to go and look.
export function countReport(what: string, count: number, where: string): string {
  if (count === 0) {
    return `${what}: no problems found.`;
  }
  if (count === 1) {
    return `${what}: 1 problem — see the ${where}.`;
  }
  return `${what}: ${count} problems — see the ${where}.`;
}
