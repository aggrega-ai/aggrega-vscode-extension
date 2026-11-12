// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';

// This module reads the compiler's answer to a schema request that names no
// kind, and it holds no editor type — so what a reader is offered is read back
// by a test with no extension host.
//
// 🔴 THE SET OF ENTITY KINDS IS THE COMPILER'S, AND NO LIST OF IT IS HELD HERE.
// A list written on this side would agree on the day it was written and diverge
// silently the day a kind was declared, with nothing comparing the two — and the
// reader who could not find their kind would have no way to tell a kind that is
// missing from one that does not exist.

// EntityKind names one kind an author may write a document of, in both of the
// registers this surface needs it in.
//
// Neither register is derived from the other here, and carrying both is what
// leaves this side no mapping to keep. A kind whose name is more than one word
// does not survive the round trip in either direction, and the direction that
// does work — lowercasing the value a document carries — is a derivation the
// compiler owns: performing it here would leave this surface as the one place to
// correct the day a token stopped being its document value lowercased.
// kind is the token a request naming this kind takes, and it is what the
// drafting request sends. documentKind is the value the document itself carries,
// and it is what a reader reads. acceptedBy is which operations the compiler
// accepts a document of this kind for, as the compiler states it.
export type EntityKind = wire.EntityKindDescriptor;

// EntityKindAcceptance says, for one kind, which operations accept a document of
// that kind named on its own: checking it as a single entity, publishing it by
// its path alone, and inspecting it by its name.
//
// 🔴 IT IS THE COMPILER'S STATEMENT, AND NO COPY OF IT IS HELD HERE. Which kinds
// an operation takes is decided by the operation itself, on the other side, and
// it moves when the operation does; a list of each operation's kinds written on
// this side would agree until then and go on offering a refusal afterwards.
export type EntityKindAcceptance = wire.EntityKindAcceptance;

// ENTITY_KIND_READ names the read of the kinds answer in the sentence it ends in
// when it fails. Two surfaces read that answer — the drafting flow and the
// Catalog panel — and a failure of the one read reads the same on both.
export const ENTITY_KIND_READ = 'The entity-kind read';

// readAcceptance reads an entry's acceptance, each member accepting only where
// the answer carries the boolean true for it.
//
// 🔴 ANYTHING ELSE READS AS NOT ACCEPTING — an absent member, a value of another
// type, an acceptance that is not an object at all. What depends on this is which
// operations a row offers, and the direction a misreading may fall in is the one
// where a row offers less than it could: an operation withheld is a control the
// reader can see is missing, while one offered wrongly is a press the compiler
// refuses. The entry itself is kept, because its two registers are still whole and
// the drafting flow needs nothing else of it.
function readAcceptance(held: unknown): EntityKindAcceptance {
  const said = typeof held === 'object' && held !== null
    ? held as { singleEntityValidation?: unknown; publication?: unknown; inspectionByName?: unknown }
    : {};
  return {
    singleEntityValidation: said.singleEntityValidation === true,
    publication: said.publication === true,
    inspectionByName: said.inspectionByName === true,
  };
}

// readEntityKinds reports the kinds an author may write a document of, from the
// compiler's answer to a schema request that named none.
//
// 🔴 IT READS THE NARROW SET AND NEVER THE WIDE ONE, and both are on that
// answer. The wide one is every token the compiler answers for, and it holds the
// intermediate representation, the lockfile, the workspace configuration and the
// plugin socket contracts — none of which is a document an author writes, so a
// choice built from it would offer values no authoring schema accepts.
//
// 🔴 NARROWING THE WIDE ONE HERE IS REFUSED AS WELL, and by a distinction this
// side cannot make: a kind whose content is written inside another kind's
// document is identifiable and not addressable, and nothing in the answer
// separates the two — so a pattern applied here would offer a document there is
// nowhere to put. The narrow set is the compiler's answer to exactly that
// question, which is why it travels.
//
// The answer is unknown by contract, as every answer from another process is, so
// every field is checked rather than trusted. An entry carrying only one of the
// two registers is dropped rather than half-read: a choice that could be read
// but not sent, or sent but not read, is worse than one that is absent. An entry
// whose acceptance cannot be read is kept, accepting nothing, for the reason
// readAcceptance gives.
export function readEntityKinds(answer: unknown): EntityKind[] {
  if (typeof answer !== 'object' || answer === null) { return []; }
  const held = (answer as { entityKinds?: unknown }).entityKinds;
  if (!Array.isArray(held)) { return []; }
  const kinds: EntityKind[] = [];
  for (const entry of held) {
    if (typeof entry !== 'object' || entry === null) { continue; }
    const registers = entry as { kind?: unknown; documentKind?: unknown; acceptedBy?: unknown };
    if (typeof registers.kind !== 'string' || registers.kind === '') { continue; }
    if (typeof registers.documentKind !== 'string' || registers.documentKind === '') { continue; }
    kinds.push({
      kind: registers.kind,
      documentKind: registers.documentKind,
      acceptedBy: readAcceptance(registers.acceptedBy),
    });
  }
  return kinds;
}

// acceptanceFor reports what the compiler accepts a document of one kind for,
// the kind named by the value a document carries in its own `kind:` field — or
// null where the answer holds no such kind, which accepts nothing.
//
// It is looked up by that register because that is the one a document, and so an
// index of documents, carries: the entity index reports each entity's kind as its
// document wrote it.
export function acceptanceFor(
  kinds: readonly EntityKind[],
  documentKind: string,
): EntityKindAcceptance | null {
  return kinds.find((kind) => kind.documentKind === documentKind)?.acceptedBy ?? null;
}

// DraftSubject is what a draft names: the token its request takes, and the
// compiler's own name for that token where the answer holds one.
//
// An EntityKind IS one, which is what lets a kind a reader chose and a kind an
// invocation carried travel the same way from the moment either is settled. The
// second register is nullable here and is not on an EntityKind, and that is the
// difference in what they carry: a token the compiler's answer does not hold has
// no name to show, and inventing one would be the derivation this module refuses
// at its head. What an operation accepts is not part of what a draft names, so a
// subject resolved here carries the two registers and nothing else.
export interface DraftSubject {
  kind: string;
  documentKind: string | null;
}

// draftSubjectFor settles what a drafting flow is drafting, from the compiler's
// answer and from whatever the invocation already carried — or null where the
// invocation settled nothing, which is the flow's cue to ask.
//
// 🔴 BOTH ROUTES ARE LOOKUPS IN THE COMPILER'S OWN ANSWER AND NEITHER IS A PAIR
// WRITTEN HERE. A caller that already knows which kind it is drafting knows it
// by the name the product teaches, and the token a request takes for that name
// is the compiler's to state — so the name goes in and the answer's own entry
// comes back. A pair written on this side would be the list this module refuses
// at its head arriving through a different door, and it would go on naming a
// token the day the compiler stopped answering to it.
//
// A TOKEN OUTRANKS A NAME, and the two are never both meant. A token is the kind
// the invocation itself named outright, so a name pre-set by the call site that
// overrode it would be the flow ignoring the kind it was just told to draft.
//
// A token the answer does not hold still travels, with no name against it. That
// is an invocation of a reader's own — a keybinding, a recorded workflow — and
// refusing it here would replace the compiler's own corrective text, which names
// the whole valid set, with a refusal this side worded from a narrower view. A
// NAME the answer does not hold resolves to nothing instead, because nothing
// downstream could do anything with it: the request takes tokens.
export function draftSubjectFor(
  kinds: readonly EntityKind[],
  token: string | null,
  documentKind: string | null,
): DraftSubject | null {
  if (token !== null) {
    const held = kinds.find((kind) => kind.kind === token);
    return { kind: token, documentKind: held?.documentKind ?? null };
  }
  if (documentKind !== null) {
    const held = kinds.find((kind) => kind.documentKind === documentKind);
    return held === undefined ? null : { kind: held.kind, documentKind: held.documentKind };
  }
  return null;
}

// draftNamePrompt is what a reader is asked for when a draft needs a name.
//
// It names the kind in the register a reader reads, so a flow that already knows
// what it is drafting says so rather than asking for the name of an unnamed
// thing. Where it holds no name — an invocation carrying a token the compiler's
// answer does not hold — it says "entity", which names the class of thing being
// drafted without claiming to know which one.
//
// The sentence lives beside the two registers rather than beside the dialogue
// that shows it, because the only thing that varies in it is the register this
// module is the one reader of, and because the dialogue is composed in a module
// that holds an editor type — so written there the sentence a reader is shown
// could not be read back without an extension host.
export function draftNamePrompt(documentKind: string | null): string {
  return `Name for the new ${documentKind ?? 'entity'} — leave empty for a placeholder`;
}
