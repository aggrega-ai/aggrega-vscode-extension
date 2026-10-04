// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { DaemonErrorRouting, WhoAsked, describeError } from './error-surfaces';

// GraphFailureSinks are the surfaces a failed graph render reports on.
// Injecting them is what keeps the decisions — which surfaces are written, in
// which order, and in whose words — free of every editor type, and therefore
// directly assertable.
export interface GraphFailureSinks {
  // reportDaemonError routes the error envelope to the per-code surfaces the
  // extension already has for it — a diagnostic on the document the envelope
  // names, or the notice that offers the act resolving it — and reports what it
  // did. fallbackPath is the document to attach a diagnostic to when the
  // envelope names no artifact of its own; whoAsked is whether the reader asked
  // for this drawing.
  reportDaemonError(err: unknown, fallbackPath: string, whoAsked: WhoAsked): DaemonErrorRouting;
  // logLine appends one line to the channel that keeps this view's failures
  // after the panel is closed.
  logLine(line: string): void;
  // notifyPanel tells the open panel that the graph is not coming, and why.
  notifyPanel(message: string): void;
}

// reportGraphFailure surfaces a failed graph render on every surface that has
// to hear about it.
//
// The envelope is routed BEFORE the two lines below rather than instead of
// them. A daemon refusal is about an authored document and carries which one,
// so routing it puts the fault on that document where the reader can act on it
// — and where the fault is attributable to a single key, on that key rather
// than at the head of the file. The log line and the panel notice still fire
// either way: a reader looking at the panel has to be told the graph is not
// there, and a value that is not a daemon envelope at all has nowhere else to
// surface.
//
// The reader-facing text is produced by describeError, the extension's one home
// for rendering a thrown value as a line. A transport refusal is an object
// carrying a numeric code rather than a thrown Error, so a conversion that only
// knows about Error renders it as an object with no text at all — destroying the
// reason the compiler wrote, which is usually the sentence naming what the
// reader has to change.
//
// whoAsked is 'reader' for a drawing the reader asked for and 'nobody' for the
// quiet redraw that follows a save, and it is passed through to the routing
// unread: whether a notice about the refusal may be held back is decided there,
// and only there.
export function reportGraphFailure(
  err: unknown,
  release: string,
  whoAsked: WhoAsked,
  sinks: GraphFailureSinks,
): void {
  sinks.reportDaemonError(err, release, whoAsked);
  const message = describeError(err);
  sinks.logLine(graphFailureLine(release, message));
  sinks.notifyPanel(message);
}

// graphFailureLine is the channel's line for a drawing that could not be made:
// what could not be drawn, named after the Release a reader picked, then the
// compiler's own words for why. It names the act as a reader knows it rather
// than by the request that carries it.
export function graphFailureLine(release: string, message: string): string {
  return `The topology of ${release} could not be drawn: ${message}`;
}
