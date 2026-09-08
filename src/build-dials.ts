// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// This module is the one description of the adjustments a build offers before
// it runs, and of what each of the two build requests composes.
//
// It imports no editor type, so both are assertable without an extension host:
// what a reader is offered, and the exact parameter set each request carries.
//
// 🔴 THE TWO COMPOSITIONS LIVE TOGETHER BECAUSE THE GUARANTEE IS ABOUT THE
// DIFFERENCE BETWEEN THEM, and a guarantee about a difference cannot be kept on
// one side of it. An adjustment set here belongs to the build; the request that
// reports what a build WOULD write must never carry one, because resolving
// dependencies writes the lockfile and a request that writes nothing cannot
// perform one and still be what it says it is. Composing the two a room apart
// would leave that incompatibility stated nowhere, and the failure it guards
// against is silent: the reader would meet a refusal for a combination they
// never authored and cannot see.

// AUTO_PULL_DIAL is the parameter the dependency-resolving adjustment composes.
//
// It is the compiler's own name for that parameter, carried through verbatim,
// and it is declared once here so the request shape below derives its key from
// it rather than restating it. A second spelling would agree on the day it was
// written and then compose a parameter the compiler does not read, with nothing
// comparing the two.
export const AUTO_PULL_DIAL = 'autoPull';

// BuildDial is one adjustment: the parameter it composes, and the words a
// reader reads.
//
// The parameter and the label are separate fields for the same reason a menu
// choice keeps them apart: a label is written for reading, and taking it as the
// value a request carries would tie what an adjustment DOES to what it happens
// to read.
export interface BuildDial {
  id: string;
  // label says what the adjustment does, in the reader's own terms. 🔴 NEVER A
  // COMMAND-LINE SPELLING. A reader of this panel has authored no flags, so a
  // flag's name is a word they have nowhere to look up — and an adjustment
  // named after a parameter teaches the parameter rather than the effect.
  label: string;
  // detail is the second line, saying what turning it on makes the build do.
  detail: string;
}

// BUILD_DIALS is every adjustment the build offers, in the order a reader meets
// them.
//
// 🔴 EACH IS OFF BY DEFAULT BECAUSE THE COMMAND LINE'S OWN DEFAULT IS OFF, and
// that parity is the ground rather than a convenience: the two surfaces perform
// one operation, so a reader who has learnt what a plain build does in a
// terminal must not meet a different build here. A default that differed would
// be a divergence nothing on either surface reports.
export const BUILD_DIALS: BuildDial[] = [
  {
    id: AUTO_PULL_DIAL,
    label: 'Pull dependencies first',
    detail: "Resolve the Release's dependencies into the lockfile before rendering, "
      + 'then build against them',
  },
];

// BuildRequestParams is exactly what a build request carries.
//
// The adjustment's key is DERIVED from the constant above rather than written
// again, so the parameter has one spelling: renaming the constant renames this
// key, and a composition that still named the old one stops compiling.
export type BuildRequestParams = { release: string } & Record<typeof AUTO_PULL_DIAL, boolean>;

// BuildPreviewRequestParams is exactly what a preview request carries: the
// Release, and nothing else.
//
// 🔴 THE ABSENCE IS THE POINT, AND THIS DECLARATION IS WHAT ENFORCES IT. A
// composition annotated with this type cannot name a second key — the compiler
// refuses the surplus member — so an adjustment reaching the preview is not a
// mistake that has to be noticed in review. That is a stronger guarantee than
// the answering side's own refusal, which is a backstop reached only after a
// reader has already been told no.
export interface BuildPreviewRequestParams {
  release: string;
}

// buildParams composes a build request from the Release and the adjustments the
// reader has turned on.
//
// 🔴 THE ADJUSTMENT IS CARRIED AT BOTH ITS VALUES RATHER THAN OMITTED WHEN OFF.
// The compiler reads an absent parameter and an explicit off identically, so
// stating it costs nothing — and what it buys is that the reader's setting is
// visible in the request itself. A request that carried the parameter only when
// on would make "the reader left it alone" and "this client does not know about
// the parameter" the same bytes, and those are different facts.
export function buildParams(release: string, on: readonly string[]): BuildRequestParams {
  return { release, [AUTO_PULL_DIAL]: on.includes(AUTO_PULL_DIAL) };
}

// buildPreviewParams composes a preview request from the Release alone.
//
// It takes no adjustments, and that is a property of the request rather than an
// omission at this call: there is no argument for one to arrive through, so the
// caller has nothing to forward and nothing to remember not to forward.
export function buildPreviewParams(release: string): BuildPreviewRequestParams {
  return { release };
}

// dialsTurnedOn narrows whatever was recorded to the adjustments this build
// actually offers.
//
// The recorded set arrives from a document the panel drew, so it is checked
// rather than trusted: a panel drawn by an earlier version of this extension,
// or one whose adjustment has since been withdrawn, would otherwise carry a
// value into a request the compiler no longer reads. Order and duplicates are
// resolved against the declared set as well, so one recorded set has one
// composition.
export function dialsTurnedOn(recorded: readonly unknown[]): string[] {
  return BUILD_DIALS
    .map((dial) => dial.id)
    .filter((id) => recorded.includes(id));
}
