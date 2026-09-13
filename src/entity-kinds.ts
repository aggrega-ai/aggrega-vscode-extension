// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

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
// and it is what a reader reads.
export type EntityKind = wire.EntityKindDescriptor;

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
// but not sent, or sent but not read, is worse than one that is absent.
export function readEntityKinds(answer: unknown): EntityKind[] {
  if (typeof answer !== 'object' || answer === null) { return []; }
  const held = (answer as { entityKinds?: unknown }).entityKinds;
  if (!Array.isArray(held)) { return []; }
  const kinds: EntityKind[] = [];
  for (const entry of held) {
    if (typeof entry !== 'object' || entry === null) { continue; }
    const registers = entry as { kind?: unknown; documentKind?: unknown };
    if (typeof registers.kind !== 'string' || registers.kind === '') { continue; }
    if (typeof registers.documentKind !== 'string' || registers.documentKind === '') { continue; }
    kinds.push({ kind: registers.kind, documentKind: registers.documentKind });
  }
  return kinds;
}
