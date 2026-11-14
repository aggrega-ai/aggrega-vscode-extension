// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { isCancellation, stoppedSentence } from './cancellation';
import { describeError } from './error-text';
import * as l10n from './l10n';

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
export const SHOW_OUTPUT_ACTION = l10n.t('Show output');

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
//
// 🔴 THE COMPLETED AND THE STOPPED SENTENCES ARE A SUBJECT AND A PREDICATE WORDED
// BY DIFFERENT MODULES, JOINED BY A MESSAGE OF THEIR OWN. The subject is the
// operation's owner's and the predicate the ending's, so neither translator sees
// the other half; the joining message is what a translation rewrites into the
// shape its language needs — a label and a colon, say — where a verb would
// otherwise have to agree with a subject it cannot see. A completed operation's
// predicate closes its own sentence, so its joining is `{0} {1}`; the stop's
// predicate is a phrase, so its joining carries the full stop, `{0} {1}.`, and
// that sentence is composed once, by cancellation.ts's stoppedSentence, which the
// message a stop carries is composed by too. The failed sentence's own words are
// this module's, and the compiler's message fills its placeholder untranslated.
export function terminalLine(what: string, outcome: OperationOutcome): string {
  switch (outcome.kind) {
    case 'ok':
      return l10n.t('{0} {1}', what, outcome.detail);
    case 'cancelled':
      return stoppedSentence(what);
    case 'failed':
      return l10n.t('{0} did not complete: {1}', what, outcome.message);
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
// knows to go and look. It picks the sentence rather than filling one: each place
// is its own pair of whole messages, so a translation gives the place the article
// and case "see the …" needs. A place added to CountPlace without its sentences
// does not compile.
export function countReport(what: string, count: number, where: CountPlace): string {
  if (count === 0) {
    return l10n.t('{0}: no problems found.', what);
  }
  switch (where) {
    case 'Problems panel':
      return count === 1
        ? l10n.t('{0}: 1 problem — see the Problems panel.', what)
        : l10n.t('{0}: {1} problems — see the Problems panel.', what, count);
  }
}

// CountPlace is a place a run's findings land, by the editor's own name for it.
export type CountPlace = 'Problems panel';
