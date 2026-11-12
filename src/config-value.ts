// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

// What a control will accept is read off the schema declaration it was generated
// from, so a value the schema refuses cannot be composed on this side.
//
// The bounds and the admissible values have ONE home — the schema — and this
// module reads them from the generated control rather than restating them. A
// second copy of a bound would agree with the schema until the day the schema
// moved, and the symptom of a disagreement is a value the surface accepts and the
// compiler then refuses, reported to the reader as a failure of their input
// rather than of ours.
//
// It exists as its own module because it is the half that must be provable
// without drawing anything: the refusal is the guarantee, so it is asserted
// directly rather than through a rendered document.

import { ConfigControl } from './config-schema';

// ConfigValueVerdict is what a control makes of a reader's text.
//
// A refusal carries the reason in the reader's own terms — what they typed and
// what the schema admits — because a refusal they cannot act on is a refusal that
// sends them to the file to do it by hand.
export type ConfigValueVerdict =
  | { readonly accepted: true; readonly value: unknown }
  | { readonly accepted: false; readonly reason: string };

// readConfigValue reads a reader's text against the control's own declaration.
//
// The text arrives as text because that is what a control hands back, whatever
// the declared type: the conversion and the check are one step here rather than
// two, so there is no window in which a converted value has not yet been
// checked.
export function readConfigValue(control: ConfigControl, raw: string): ConfigValueVerdict {
  switch (control.kind) {
    case 'toggle':
      return readToggle(raw);
    case 'number':
      return readNumber(control, raw);
    case 'choice':
      return readChoice(control, raw);
    case 'text':
      return { accepted: true, value: raw };
    case 'text-list':
      return readTextList(raw);
    default:
      // A collection, a keyed collection and a shape the generator could not
      // read are not composed from one line of text. Refusing here rather than
      // guessing is what keeps a control the surface cannot honestly offer from
      // appearing to work.
      return {
        accepted: false,
        reason: `${label(control)} is not a single value this surface composes.`,
      };
  }
}

// readToggle accepts the two spellings a toggle produces and nothing else.
function readToggle(raw: string): ConfigValueVerdict {
  const text = raw.trim().toLowerCase();
  if (text === 'true') { return { accepted: true, value: true }; }
  if (text === 'false') { return { accepted: true, value: false }; }
  return { accepted: false, reason: `${raw} is not true or false.` };
}

// readNumber accepts a whole number inside the declared bounds.
//
// The bounds are read off the control, so a schema that widens or narrows one
// changes what is accepted with nothing edited here. A declaration carrying no
// bound is unbounded on that side, which is the schema's own statement rather
// than a default chosen here.
function readNumber(control: ConfigControl, raw: string): ConfigValueVerdict {
  const text = raw.trim();
  if (text.length === 0) { return { accepted: false, reason: `${label(control)} needs a number.` }; }
  // The pattern is deliberately stricter than the language's own parse, which
  // accepts leading text and hexadecimal and would let "12abc" through as 12.
  if (!/^-?\d+$/.test(text)) {
    return { accepted: false, reason: `${raw} is not a whole number.` };
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    return { accepted: false, reason: `${raw} is too large to be written exactly.` };
  }
  if (control.minimum !== undefined && value < control.minimum) {
    return { accepted: false, reason: `${value} is below the smallest value ${label(control)} takes, ${control.minimum}.` };
  }
  if (control.maximum !== undefined && value > control.maximum) {
    return { accepted: false, reason: `${value} is above the largest value ${label(control)} takes, ${control.maximum}.` };
  }
  return { accepted: true, value };
}

// readChoice accepts one of the values the schema enumerates.
//
// The comparison is against the enumeration itself, so a value added to the
// schema is accepted here with nothing edited, and one removed from it stops
// being accepted at the same moment.
function readChoice(control: ConfigControl, raw: string): ConfigValueVerdict {
  const choices = control.choices ?? [];
  if (choices.includes(raw)) { return { accepted: true, value: raw }; }
  return {
    accepted: false,
    reason: `${raw} is not one of the values ${label(control)} takes: ${choices.join(', ')}.`,
  };
}

// readTextList reads a list of strings, one per line.
//
// Blank lines are dropped rather than written as empty entries: a reader who
// leaves a trailing newline means a list of what they typed, not a list with
// nothing on the end.
function readTextList(raw: string): ConfigValueVerdict {
  const entries = raw.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  return { accepted: true, value: entries };
}

// label names a control in a refusal, by the path the reader sees rather than by
// the label alone: two settings under different groups can carry the same label,
// and a refusal naming only the label would not say which one it is about.
function label(control: ConfigControl): string {
  return control.path.join('.');
}
