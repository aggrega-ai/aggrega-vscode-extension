// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import {
  CACHE_OPERATIONS,
  EntitySubject,
  OperationId,
} from './operation-groups';
import {
  ATTACHABLE_PLUGIN_TYPES,
  GEN_CATALOG_SCOPES,
} from './plugins-run';
import { EntityKind } from './entity-kinds';

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

// OperationMenu describes one control's menu.
//
// The two kinds are not two styles of the same thing: a fixed menu carries its
// whole content in the composed document, while a fetched one cannot, because
// its options are the language server's answer about the workspace. That
// difference is what makes the in-flight state a property of the fetched kind
// alone.
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
  };

// CACHE_MENU_LABEL and the rest name what each menu is choosing. Each is a
// noun phrase rather than a sentence, because it is announced immediately after
// the control's own name.
const CACHE_MENU_LABEL = 'Cache operation';
const INSPECT_MENU_LABEL = 'Entity to inspect';
const PUBLISH_MENU_LABEL = 'Entity to publish';
const DRAFT_MENU_LABEL = 'Kind of entity to draft';
const PLUGIN_TYPE_MENU_LABEL = 'Type of plugin to add';
const GEN_CATALOG_MENU_LABEL = 'Plugins to generate an entity for';

// READING_THE_INDEX is what the two menus offering the workspace's own entities
// say while the language server is answering. It is one sentence for both
// because it describes the same read — the workspace's own entity index — and
// two wordings for one wait would tell a reader the two controls do different
// work.
const READING_THE_INDEX = 'Reading the workspace entity index…';

// READING_THE_KINDS is what the drafting menu says while it waits. It is a
// second sentence rather than the one above because it names a DIFFERENT read:
// the kinds are the compiler's own, answered from the schemas compiled into it,
// and telling a reader that the workspace was being read would name a subject
// this read never touches.
const READING_THE_KINDS = 'Reading the entity kinds the compiler declares…';

// OPERATION_MENUS is the whole set, keyed by the operation whose button opens
// it. An operation absent from this map answers a press by running, or by
// opening a prompt of its own, exactly as it did before.
export const OPERATION_MENUS: Partial<Record<OperationId, OperationMenu>> = {
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
  // The drafting control's choices are the KINDS THE COMPILER ANSWERS FOR, and
  // it is fetched for that reason rather than because the answer is slow: the
  // set of kinds belongs to the compiler, so a list of them here would be a
  // second statement of it, agreeing until the day a kind was declared and then
  // quietly wrong with nothing comparing the two. Asking is what makes what a
  // reader is offered follow the running binary.
  //
  // The fetched kind admits no options field at all, so a list on this side is
  // not a thing this entry can hold — the type refuses it rather than a reviewer
  // having to notice.
  scaffold: {
    kind: 'fetched',
    label: DRAFT_MENU_LABEL,
    pending: READING_THE_KINDS,
  },
  // The two whose subjects are the workspace's own entities, on the same terms:
  // the menu opens saying it is reading and fills in when the answer arrives.
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
  // The attachable types, from the one set that decides them. That set omits
  // the type whose installation confirms a capability grant at a terminal an
  // editor control has none of, and the omission is a property of the set
  // rather than of this menu — so reading it here keeps the menu unable to
  // offer what the surface must not.
  pluginAdd: {
    kind: 'fixed',
    label: PLUGIN_TYPE_MENU_LABEL,
    options: ATTACHABLE_PLUGIN_TYPES.map((type) => ({
      value: type,
      label: type,
      detail: '',
    })),
  },
  pluginEntities: {
    kind: 'fixed',
    label: GEN_CATALOG_MENU_LABEL,
    options: GEN_CATALOG_SCOPES.map((scope) => ({
      value: scope.value,
      label: scope.label,
      detail: '',
    })),
  },
};

// menuFor reports the menu a control opens, or null where pressing it opens no
// menu at all.
export function menuFor(id: OperationId): OperationMenu | null {
  return OPERATION_MENUS[id] ?? null;
}

// menuOptionOffered reports whether a control's menu offers a value.
//
// It answers for a FIXED menu only, and returns false for every other case —
// including for a fetched menu, whose choices are not this surface's to hold.
// That is the honest bound rather than a gap: a fetched value is a position into
// an offer that was composed for one opening of one menu, or a token of the
// compiler's own vocabulary, and neither is a member of any set kept here. So
// such a choice is resolved where it can be — against the offer by whoever
// consumes it, or by the compiler, which refuses in its own words a value it no
// longer answers for.
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

// entityKindMenuOptions turns the kinds the compiler answered with into the
// choices the drafting menu offers.
//
// 🔴 A READER READS THE VALUE THE DOCUMENT CARRIES AND THE CHOICE COMPOSES THE
// TOKEN THE REQUEST TAKES, AND NEITHER IS DERIVED FROM THE OTHER. The two are
// different words for a kind whose name is more than one word, so taking either
// for the other would compose a request the compiler refuses or show a reader a
// word their own document never carries. The word a reader reads is the one
// their draft will open with, which is what makes it the right one to show.
//
// The value is the kind's own token rather than the choice's position in the
// offer, and that is the one difference from the menus offering the workspace's
// own entities. Two entities may share a name, so only a position identifies
// one; a kind's token is the compiler's own identity for that kind and is
// already the vocabulary its request takes, so it is carried through verbatim —
// which is also what keeps the same command working when a reader's keybinding
// or recorded workflow invokes it naming a kind outright.
//
// The second line is left empty rather than composed. On the menus that carry
// one it says what choosing does or which document a subject is; here the word
// a reader reads names the kind completely, and drawing the token beside it
// would show two spellings of one thing with nothing to say why they differ.
export function entityKindMenuOptions(kinds: EntityKind[]): MenuOption[] {
  return kinds.map((kind) => ({
    value: kind.kind,
    label: kind.documentKind,
    detail: '',
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
//     value is a position into an offer composed for one opening of one menu, or
//     a token of the compiler's own vocabulary; the first is resolved against
//     that offer by whoever consumes it, and the second by the compiler, which
//     refuses in its own words a value it no longer answers for.
export function menuAnswer(id: OperationId, value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') { return null; }
  const menu = menuFor(id);
  if (menu === null) { return null; }
  if (menu.kind === 'fetched') { return value; }
  return menuOptionOffered(id, value) ? value : null;
}
