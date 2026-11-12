// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import {
  CACHE_OPERATIONS,
  EntitySubject,
  OperationId,
} from './operation-groups';
import { BUILD_DIALS } from './build-dials';

// This module is the one description of which controls answer a press by
// offering a choice BESIDE THEMSELVES, and what each of those choices holds.
//
// It imports no editor type, for the same reason the operation description does
// not: what a reader is offered is then read back by a test with no extension
// host, and the panel's composition and the handler that receives the answer
// read one description rather than each carrying a table of their own.
//
// Every fixed option set here is DERIVED from the set its operation already
// owns rather than written out again. A second copy would agree on the day it
// was written and then diverge silently — and the symptom would be a menu
// offering something the operation refuses, or withholding something it accepts,
// with nothing comparing the two.

// MenuControlId names a control that can hold a menu.
//
// It is wider than the operation set because not every such control IS an
// operation: an operation's own button holds the menu that answers the question
// that operation was going to ask, while a SECOND control beside it holds the
// adjustments made before it runs. The two cannot be one entry, and the reason
// is mechanical rather than a matter of taste — a control carrying a menu
// answers a press by opening it instead of running, so putting the adjustments
// under the operation's own id would stop that operation running at all.
export type DialsControlId = `dials-${OperationId}`;
export type MenuControlId = OperationId | DialsControlId;

// dialsControlId names the control that holds one operation's adjustments. It
// is derived rather than recorded, so the key this menu is registered under and
// every reference to it cannot disagree.
export function dialsControlId(id: OperationId): DialsControlId {
  return `dials-${id}`;
}

// MenuOption is one choice, with every string already decided.
//
// value is what the choice composes and is the operation's own vocabulary,
// carried through verbatim. label is what the reader reads. The two are
// separate fields rather than one because a label is shortened and composed for
// reading, and taking it as the value an operation acts on would tie what a
// choice does to what it happens to read.
export interface MenuOption {
  value: string;
  label: string;
  // detail is the second line, saying what choosing this one does. It is empty
  // where the operation's own set carries no explanation, rather than being
  // invented here.
  detail: string;
}

// MenuDial is one setting a menu holds, rather than one choice it offers.
//
// The two are shaped alike and behave oppositely, which is why they are
// separate types: taking a choice ANSWERS the control's question and closes the
// menu, while turning a setting leaves the menu standing, because a reader
// adjusting two settings would otherwise have to re-open the menu between them.
export interface MenuDial {
  value: string;
  label: string;
  detail: string;
}

// OperationMenu describes one control's menu.
//
// The three kinds are not three styles of the same thing.
//
// A fixed menu carries its whole content in the composed document, while a
// fetched one cannot, because its options are the language server's answer
// about the workspace — which is what makes the in-flight state a property of
// the fetched kind alone.
//
// A dials menu differs from both on a further axis: its entries are not answers
// to a question but SETTINGS carried into the next press of the control beside
// it. So it holds no command of its own, nothing it holds runs anything, and
// pressing an entry leaves the menu open. The kinds are separate cases rather
// than one case with a flag because the panel's own script must be able to tell
// a press that answers from a press that adjusts, and a flag on one shape would
// leave that distinction to be remembered rather than read.
export type OperationMenu =
  | {
    kind: 'fixed';
    // label names the menu to a reader whose assistive technology announces it
    // on entry. It states what is being chosen, because the button's own name
    // is already behind them by then.
    label: string;
    options: MenuOption[];
  }
  | {
    kind: 'fetched';
    label: string;
    // pending is what the menu SAYS while the read is in flight.
    //
    // 🔴 A menu that opened empty here would be worse than the chooser it
    // replaces: emptiness reads as "there is nothing" rather than as "wait",
    // and the reader would act on that reading. So the fetched kind always
    // composes this line, and the options arrive beneath it.
    pending: string;
  }
  | {
    kind: 'dials';
    label: string;
    dials: MenuDial[];
  };

// CACHE_MENU_LABEL and the rest name what each menu is choosing. Each is a
// noun phrase rather than a sentence, because it is announced immediately after
// the control's own name.
const CACHE_MENU_LABEL = 'Cache operation';
const INSPECT_MENU_LABEL = 'Entity to inspect';
const PUBLISH_MENU_LABEL = 'Entity to publish';

// BUILD_DIALS_MENU_LABEL names what the options beside the Build button are. It
// says they apply to the next build rather than naming them a mode, because
// they are not alternatives to a build — pressing Build runs a build either
// way, and these decide what that one build also does.
const BUILD_DIALS_MENU_LABEL = 'Options for the next build';

// READING_THE_INDEX is what the two menus offering the workspace's own entities
// say while the language server is answering. It is one sentence for both
// because it describes the same read — the workspace's own entity index — and
// two wordings for one wait would tell a reader the two controls do different
// work.
const READING_THE_INDEX = 'Reading the workspace entity index…';

// OPERATION_MENUS is the whole set, keyed by the control whose press opens it.
// A control absent from this map answers a press by running, or by opening a
// prompt of its own, exactly as it did before.
//
// 🔴 AN OPERATION'S OWN ID AND ITS ADJUSTMENTS' CONTROL ID ARE DIFFERENT KEYS,
// and registering the adjustments under the operation's own id is the one thing
// this map must never carry: a control in this map opens its menu instead of
// running, so the Build button would stop building. The adjustments therefore
// sit under a control of their own, drawn beside the button, and the button's
// own press is untouched.
export const OPERATION_MENUS: Partial<Record<MenuControlId, OperationMenu>> = {
  // The cache entry is the one control whose press names no operation at all,
  // so what its menu offers IS the operation. The reach of each is on its own
  // row, because the difference between emptying what belongs to this workspace
  // and emptying what every project on this machine shares is the fact a reader
  // most needs before choosing.
  cache: {
    kind: 'fixed',
    label: CACHE_MENU_LABEL,
    options: CACHE_OPERATIONS.map((operation) => ({
      value: operation.value,
      label: operation.value,
      detail: operation.detail,
    })),
  },
  // The two whose subjects are the workspace's own entities: the menu opens
  // saying it is reading and fills in when the answer arrives. They are fetched
  // because those entities are the language server's answer about the
  // workspace, and the fetched kind admits no options field at all — so a list
  // on this side is not a thing either entry can hold, and the type refuses it
  // rather than a reviewer having to notice.
  inspect: {
    kind: 'fetched',
    label: INSPECT_MENU_LABEL,
    pending: READING_THE_INDEX,
  },
  push: {
    kind: 'fetched',
    label: PUBLISH_MENU_LABEL,
    pending: READING_THE_INDEX,
  },
  // The adjustments a build offers, read from the one description of them
  // rather than written out again — so a dial withdrawn from the build is
  // withdrawn from what a reader is offered in the same act, and one that has
  // to be added cannot be added here alone and reach no request.
  //
  // 🔴 REGISTERED AGAINST A CONTROL OF ITS OWN, NEVER AGAINST `build`. The
  // Build button runs on a press and offers nothing, which is the whole design:
  // a reader presses it and gets a build with the current settings, with no
  // dialog and no choice in the way.
  [dialsControlId('build')]: {
    kind: 'dials',
    label: BUILD_DIALS_MENU_LABEL,
    dials: BUILD_DIALS.map((dial) => ({
      value: dial.id,
      label: dial.label,
      detail: dial.detail,
    })),
  },
};

// menuFor reports the menu a control opens, or null where pressing it opens no
// menu at all.
export function menuFor(id: MenuControlId): OperationMenu | null {
  return OPERATION_MENUS[id] ?? null;
}

// menuOptionOffered reports whether a control's menu offers a value.
//
// It answers for a FIXED menu only, and returns false for every other case —
// including for a fetched menu, whose choices are not this surface's to hold.
// That is the honest bound rather than a gap: a fetched value is a position into
// an offer that was composed for one opening of one menu, which is not a member
// of any set kept here. So such a choice is resolved where it can be — against
// the offer, by whoever consumes it.
//
// A dials menu answers false for a different reason again, and it is not a
// bound: it holds no choices at all. Nothing it holds is an answer an operation
// acts on, so there is no value here for an invocation to carry.
export function menuOptionOffered(id: OperationId, value: string): boolean {
  const menu = menuFor(id);
  if (menu === null || menu.kind !== 'fixed') { return false; }
  return menu.options.some((option) => option.value === value);
}

// subjectMenuOptions turns the entities a menu offers into its choices.
//
// 🔴 THE VALUE IS THE SUBJECT'S POSITION IN THIS OFFER, NOT ANYTHING THE READER
// READS. Two entities in one workspace may share a name — the kind is what
// separates them — so a name is not an identity and could resolve a choice to
// the wrong entity. The position is unambiguous within the offer it was composed
// from, and the surface that made the offer keeps that same list to resolve
// against, so no display string is ever sent back to stand in for a subject.
//
// The second line names the kind and, where the workspace holds a file for the
// entity, that file — which is what separates two entities sharing a name, and
// then which document each of them is.
export function subjectMenuOptions(subjects: EntitySubject[]): MenuOption[] {
  return subjects.map((subject, at) => ({
    value: String(at),
    label: subject.label,
    detail: subject.detail === ''
      ? subject.description
      : `${subject.description} · ${subject.detail}`,
  }));
}

// menuAnswer reports the choice a caller may act on, or null where there is
// none to act on.
//
// It takes an unknown because that is what a command argument is: the same
// commands are in the editor's own index, where they are invoked with no
// argument at all, and a reader's recorded workflow may invoke one with
// anything. So a null answer is the ordinary case rather than an error — it
// means nobody has chosen yet, and the operation asks its own question exactly
// as it did before any menu existed. **That fallback is what keeps the command
// index working**, and it is the reason a menu is an answer to the operation's
// question rather than a new way in.
//
// What the two kinds check differs, and the difference is the honest bound:
//
//   - a FIXED menu's answer is checked against the set that menu offers, so a
//     value this surface never presented is discarded and the question is asked
//     instead. The set is closed and this side owns it, so the check is exact.
//   - a FETCHED menu's answer is checked for being a non-empty string and
//     nothing more, because this side holds no set for it to belong to. Such a
//     value is a position into an offer composed for one opening of one menu,
//     and it is resolved against that offer by whoever consumes it.
//   - a DIALS menu has no answer to report. Its entries are settings carried
//     into the next press of the control beside it, not answers to a question
//     this operation asked — so every value falls to the check below and comes
//     back as none, and the operation asks whatever it was going to ask.
export function menuAnswer(id: OperationId, value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') { return null; }
  const menu = menuFor(id);
  if (menu === null) { return null; }
  if (menu.kind === 'fetched') { return value; }
  return menuOptionOffered(id, value) ? value : null;
}
