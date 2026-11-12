// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';
import { ConfigWriteScope, reachPhrase } from './config-write-scope';
import { couldNotBeReached } from './not-reached';

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
// The outcomes mean different things to a reader and are carried as separate
// fields rather than as a sentence, so this surface reads a value instead of
// parsing prose. A registry that advertises nothing is not a failure: the
// registration proceeds on what the request supplied, and a registration this
// client sends first supplies no identity and no key. Where the reader then
// supplies either by hand, a second registration carries it, and that one's fetch
// is skipped, because a policy stated by hand takes the place of an advertised
// one. The official hub is the exception, because the compiler carries a built-in
// baseline for it and pins that whenever no advertised policy was taken —
// including where the offline posture kept the hub from being asked at all, which
// the answer reports as the baseline alone.
//
// 🔴 A REGISTRY THAT COULD NOT BE REACHED CARRIES notAdvertised TOO, AND
// unreachable BESIDE IT. No policy came back from it, so the answer reports it as
// one that advertised none, and the second field is what says it was never
// reached — read from the failure by the compiler, never from reason. So
// unreachable is read before notAdvertised, or an unreachable registry would be
// described as one that answered.
export type TrustFetchOutcome = wire.TrustFetchOutcome;

// PinnedByHand says what a registration supplied to pin by hand: how many keyless
// identities, and whether a public key.
//
// 🔴 IT CARRIES NO IDENTITY AND NO PATH, AND THE ABSENCE IS THE POINT. The
// sentence below names what kind of trust the entry now carries and never the
// values: the reader has just typed or chosen them, and the command line's own
// confirmation of such a registration names neither. A refusal of one is the
// compiler's own sentence, carried whole, and names what the compiler names.
export interface PinnedByHand {
  identities: number;
  key: boolean;
}

// trustPhrase says what the advertised-trust fetch found for host, the registry
// the entry is keyed under, and — where the fetch was skipped because the
// registration supplied a policy by hand — what the entry carries in its place.
//
// 🔴 THE BUILT-IN BASELINE IS READ AHEAD OF THE NOT-ADVERTISED CASE, which is the
// compiler's own order. Both are set where the hub was asked and advertised
// nothing, and the entry then carries the baseline, so a sentence saying only
// that nothing was advertised would tell the reader the entry trusts nothing
// when it carries the baseline's identities.
//
// 🔴 A REGISTRY THAT COULD NOT BE REACHED IS READ AHEAD OF THE NOT-ADVERTISED
// CASE TOO. The answer sets both for it, and saying it advertises no policy would
// state an answer the registry never gave. Its sentence says no policy could be
// fetched, and its account of why names the registry as not reached.
//
// Where a fetch was attempted and took no policy, the sentence ends on the
// answer's own account of why, unaltered — the endpoint's reply, or the offline
// refusal that kept the registry from being asked — after the sentence naming the
// registry as not reached where the answer says it could not be. It is the
// compiler's text and it names what was actually reached, which a re-wording would
// discard.
//
// What was pinned by hand is read only where the answer says the fetch was
// skipped. That is the answer confirming the compiler took the policy the request
// stated; an answer reporting anything else is read as that, whatever was sent.
export function trustPhrase(
  host: string,
  trust: TrustFetchOutcome,
  byHand: PinnedByHand | null = null,
): string {
  const because = trust.unreachable === true
    ? ` ${couldNotBeReached(host, trust.reason)}`
    : trust.reason ? ` ${trust.reason}` : '';
  if (trust.pinned) {
    const count = trust.identities ?? 0;
    return count === 1
      ? 'Its advertised signature trust policy was pinned, naming 1 identity.'
      : `Its advertised signature trust policy was pinned, naming ${count} identities.`;
  }
  if (trust.baseline) {
    return 'The built-in trust baseline was pinned instead of an advertised policy.'
      + because;
  }
  if (trust.unreachable === true) {
    return 'No signature trust policy could be fetched from it, and this registration names no '
      + 'identity or key, so the entry carries none.'
      + because;
  }
  if (trust.notAdvertised) {
    return 'It advertises no signature trust policy, and this registration names no '
      + 'identity or key, so the entry carries none.'
      + because;
  }
  if (trust.skipped) {
    const supplied = byHand === null ? null : pinnedByHandPhrase(byHand);
    return supplied === null
      ? 'No advertised signature trust policy was fetched.'
      : `Its signature trust policy is ${supplied} this registration supplied, so no `
        + 'advertised policy was fetched.';
  }
  // The answer reported none of the outcomes above. Saying so is the honest
  // reading: a surface that picked one of them would report a fact the compiler
  // did not send.
  return 'The answer names no signature trust policy outcome.';
}

// pinnedByHandPhrase names the kinds of trust a registration pinned by hand, or
// reports null where it pinned none.
function pinnedByHandPhrase(byHand: PinnedByHand): string | null {
  const identities = byHand.identities === 0
    ? null
    : byHand.identities === 1 ? 'the keyless identity' : 'the keyless identities';
  const key = byHand.key ? 'the public key' : null;
  if (identities !== null && key !== null) {
    return `${identities} and ${key}`;
  }
  return identities ?? key;
}

// registrationSentence is what a completed registration reads as.
//
// It is composed from the answer's own fields, so the reader is told which host
// was registered, which file it landed in, how far that file reaches, and what
// the trust fetch found — rather than that something finished. The host is the
// normalised one the compiler keyed the entry under, which is not always the
// token that was typed, and the file is the one the write actually resolved to.
// A registration that supplied a policy by hand says what kind it pinned.
export function registrationSentence(
  host: string,
  scope: ConfigWriteScope,
  trust: TrustFetchOutcome,
  byHand: PinnedByHand | null = null,
): string {
  return `registered ${host} in ${scope.configFile}, ${reachPhrase(scope)}. `
    + trustPhrase(host, trust, byHand);
}
