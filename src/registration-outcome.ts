// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { ConfigWriteScope, reachPhrase } from './config-write-scope';

// This module is the one rendering of what registering a registry produced.
//
// 🔴 TWO OPERATIONS REACH THE SAME REGISTRATION, WHICH IS WHY THIS IS ONE HOME
// RATHER THAN TWO. Registering a registry performs it directly, and seeding a
// configuration reaches it through the seeding operation — and both answers
// carry the same trust-fetch outcome from the same shared operation. The
// compiler already renders those two as one set of sentences for this reason; a
// surface rendering them twice would re-create on this side exactly the
// divergence the compiler took care to avoid, and the two copies would agree
// until the first edit of either.
//
// It holds no editor type and imports nothing that can start a process, so every
// sentence below is read back by a test exactly as an author would meet it.

// TrustFetchOutcome is what the advertised-trust fetch did (mirrors `trust`).
//
// The three states mean different things to a reader and are carried as separate
// fields rather than as a sentence, so this surface reads a value instead of
// parsing prose. A registry that advertises nothing is not a failure: the
// registration proceeds on the built-in baseline and says so.
export interface TrustFetchOutcome {
  pinned: boolean;
  notAdvertised?: boolean;
  skipped?: boolean;
  identities?: number;
  reason?: string;
}

// trustPhrase says what the advertised-trust fetch found.
//
// A registry that advertises nothing carries the endpoint's own account of what
// happened, unaltered — it is the compiler's text and it names what was actually
// reached, which a re-wording would discard.
export function trustPhrase(trust: TrustFetchOutcome): string {
  if (trust.pinned) {
    const count = trust.identities ?? 0;
    return count === 1
      ? 'Its advertised signature trust policy was pinned, naming 1 identity.'
      : `Its advertised signature trust policy was pinned, naming ${count} identities.`;
  }
  if (trust.notAdvertised) {
    const because = trust.reason ? ` ${trust.reason}` : '';
    return 'It advertises no signature trust policy, so the built-in baseline stands.'
      + because;
  }
  if (trust.skipped) {
    return 'No advertised signature trust policy was fetched.';
  }
  // The answer reported none of the three. Saying so is the honest reading: a
  // surface that picked one of them would report a fact the compiler did not
  // send.
  return 'The answer names no signature trust policy outcome.';
}

// registrationSentence is what a completed registration reads as.
//
// It is composed from the answer's own fields, so the reader is told which host
// was registered, which file it landed in, how far that file reaches, and what
// the trust fetch found — rather than that something finished. The host is the
// normalised one the compiler keyed the entry under, which is not always the
// token that was typed, and the file is the one the write actually resolved to.
export function registrationSentence(
  host: string,
  scope: ConfigWriteScope,
  trust: TrustFetchOutcome,
): string {
  return `registered ${host} in ${scope.configFile}, ${reachPhrase(scope)}. `
    + trustPhrase(trust);
}
