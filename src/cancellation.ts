// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as l10n from './l10n';

// This module is the one home for what it means to stop an operation the reader
// started. It depends on no editor type, so the daemon client and the
// subprocess runner both reach it without either of them importing the editor,
// and the rule that a stopped operation is reported as stopped is asserted
// without an extension host. Its one import is the text lookup, which answers
// the English itself where there is no editor.

// CancellationSignal is the shape this extension asks a caller for when an
// operation can be stopped.
//
// It is declared structurally rather than imported from the editor for one
// reason: the daemon client must stay free of editor types, because it is
// driven directly against a real language server by the tests. The editor's own
// cancellation token satisfies this shape as written, so a caller passes one
// straight through and nothing adapts between them.
export interface CancellationSignal {
  // isCancellationRequested reports whether the reader has already stopped the
  // operation. It is read before the work starts, because a reader can press
  // cancel while a picker ahead of the work is still open.
  readonly isCancellationRequested: boolean;
  // onCancellationRequested registers a listener fired when the reader stops
  // the operation, and returns the handle that unregisters it. The listener
  // signature is the editor's own, which passes an argument this extension
  // never reads.
  onCancellationRequested(listener: (e: unknown) => unknown): { dispose(): void };
}

// CANCELLED_BY_READER is the message an operation the reader stopped carries.
//
// It is one sentence, in one place, because the distinction it draws is the
// whole point: an operation that was stopped did not fail, and a reader who
// pressed cancel and is then told something went wrong learns that the button
// broke it. Every surface that reports an outcome routes a stopped operation
// through here, so none of them can word it as a failure.
export const CANCELLED_BY_READER = l10n.t('stopped at your request');

// stoppedSentence is the sentence a stopped operation ends in: the operation in
// the reader's terms, then CANCELLED_BY_READER, joined by a message of its own
// that closes the sentence — so a translation joins the two as its language does.
// It is the one composition of that sentence, for the message a stop carries and
// for the line an ending writes alike.
export function stoppedSentence(what: string): string {
  return l10n.t('{0} {1}.', what, CANCELLED_BY_READER);
}

// OperationCancelled is what a stopped operation rejects with.
//
// A distinct type rather than a message anyone can match on: a message
// comparison keeps compiling after the wording moves and silently stops
// matching, at which point a stopped operation starts being reported as a
// failure with nothing to report the change.
export class OperationCancelled extends Error {
  // what names the operation the reader stopped, so a caller reporting the
  // outcome need not carry the name separately.
  readonly what: string;

  constructor(what: string) {
    // The same sentence the ending of an operation writes, so the message a stop
    // carries reads as the line it ends in.
    super(stoppedSentence(what));
    this.name = 'OperationCancelled';
    this.what = what;
    // Restoring the prototype is required for instanceof to hold across the
    // ES5 downlevel this package compiles to, where extending a built-in
    // otherwise loses the chain.
    Object.setPrototypeOf(this, OperationCancelled.prototype);
  }
}

// isCancellation reports whether a thrown value is an operation the reader
// stopped. Every surface deciding between "stopped" and "failed" asks here, so
// the two are never told apart by reading a message.
export function isCancellation(err: unknown): err is OperationCancelled {
  return err instanceof OperationCancelled;
}
