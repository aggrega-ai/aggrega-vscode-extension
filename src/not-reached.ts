// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { isJsonRpcError } from './error-text';

// This module is the one wording of a registry the compiler could not reach, and
// the one reading of a refusal that says so.
//
// 🔴 WHETHER A REGISTRY WAS REACHED IS READ FROM A FIELD, NEVER FROM WORDS. Every
// answer that can carry the fact says it in a field of its own — an index build's
// row for one registry, a registration's trust outcome, and the data of a refused
// index build naming one registry — which the compiler sets from the failure
// itself: a name that did not resolve, a connection refused or that could not be
// opened, or a secure connection that could not be established. The compiler's
// sentence beside it is carried whole and never searched, because the same fault
// reads differently by machine — a name a resolver completes with a search domain
// fails as a refused connection rather than as a name that does not exist — and
// the words are the compiler's to change.
//
// It imports nothing that can start a process or reach the editor, so every
// sentence here is read back by a test exactly as a reader meets it.

// couldNotBeReached is the sentence naming a registry the compiler could not
// reach, followed by the compiler's own words for why. Where the answer carries
// no words, the sentence ends at the fact.
export function couldNotBeReached(registry: string, words: string | undefined): string {
  return words ? `${registry} could not be reached: ${words}` : `${registry} could not be reached.`;
}

// refusedAsNotReached says whether a refusal states, in its data, that the
// registry the request named could not be reached. Anything that is not a
// language-server refusal, and a refusal whose data does not say so, reads as no.
export function refusedAsNotReached(err: unknown): boolean {
  return isJsonRpcError(err) && err.data?.unreachable === true;
}
