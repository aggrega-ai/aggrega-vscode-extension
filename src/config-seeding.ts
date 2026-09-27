// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';
import { AppliedWrite, endingInEffect } from './config-change-watch';
import { reachPhrase } from './config-write-scope';
import { OperationOutcome, outcomeOf } from './operation-outcome';
import { registrationSentence, trustPhrase } from './registration-outcome';

// This module is the whole of what seeding a configuration means on this side:
// what the request carries, what the answer carries, and the sentences the reader
// is left with. It holds no editor type, so every one of those is read back by a
// test exactly as an author would meet it.
//
// The compiler owns the work. Nothing here computes what a seeding produces, and
// nothing here re-words what the compiler says about it: the answer's own fields
// are what the closing sentence is composed from, and a refusal travels through
// the extension's one rendering home with the compiler's text intact.
//
// 🔴 NOTHING HERE CAN BE STOPPED, AND THE ABSENCE OF A STOP IS THE DECISION.
// Seeding reaches the registry to read the trust policy it advertises, which
// makes its work unbounded by local computation — the reading under which an
// operation is watched and stoppable. But the shared operation behind the request
// takes no cancellation: nothing is passed to it that could carry one, and the
// request handler checks for a stopped caller only after its operation has
// already returned, at which point all it can do is withhold the reply. So a stop
// offered here could only ever stop the editor waiting, never the work — and
// presenting that as a stop would break the rule that stopping means the compiler
// stopped. There is nothing to interrupt, so nothing offering to interrupt it is
// drawn, and no signal is accepted anywhere in this module.
//
// Silence is not the alternative. The channel is told what is being done before
// the request goes out and how it ended afterwards, and every ending raises a
// notification — which is what the rule against a silent success actually asks
// for.

// ConfigInitParams is what this client sends to seed a configuration.
//
// 🔴 IT CARRIES ONE FIELD, AND THE ABSENCE OF THE OTHERS IS THE CONTRACT RATHER
// THAN AN OMISSION. The operation also accepts a force override and a choice of
// which configuration file to write, and this client offers neither — so neither
// is declared here, because a declared field is a field a later call site will
// fill.
//
//   - Declining is the behaviour a reader gets from the command line: seeding
//     leaves a configuration somebody is already working from exactly as it
//     stands. Pressing past that guard would not replace the file — the write
//     behind it merges the entry into the document already there — but it would
//     still change a file somebody is working from on one click, without their
//     having asked for that file to be touched. A registration is the act that
//     asks for it, and it is offered where a reader meets the refusal.
//   - Which configuration file a seeding lands in is not this surface's to
//     choose. Sending neither override takes the compiler's own default — the
//     global file shared by every project on the machine — which is the file this
//     surface's own words tell the reader it writes, so the destination has one
//     home and this side is not a second one.
//
// registry is optional and an absent value seeds the official hub, which is the
// same default the command line's flag carries. It is OMITTED rather than sent
// empty when no host is named: an absent key is the honest expression of a
// request that says nothing about the registry.
export type ConfigInitParams = Pick<wire.ConfigInitParams, 'registry'>;

// ConfigInitResult is the answer a seeding produces.
//
// It is the whole reason this operation ends in something a reader can check
// rather than in a status: it names the host that was seeded, the file it landed
// in, how far that file reaches, and what the trust fetch found. Every field is
// read from the answer; none is assumed.
//
// The answer also carries the seeded document as content, under the request field
// this client does not send, so it is read by nothing here: it could only ever be
// read empty.
export type ConfigInitResult = wire.ConfigInitResult;

// ConfigSeedingDeps is the one thing a seeding needs: a way to ask the compiler.
//
// It is declared this narrowly so the surface that owns the panel passes its own
// richer dependency set here unchanged, and so a test drives the whole decision
// with a fake answer and no transport at all. It takes no cancellation, for the
// reason stated at the head of this module. It answers the compiler's answer and
// whether the language server running afterwards has read what was written.
export interface ConfigSeedingDeps {
  seedConfiguration(params: ConfigInitParams): Promise<AppliedWrite<ConfigInitResult>>;
}

// OFFICIAL_HUB_LABEL is how the unnamed registry is named to a reader.
//
// Naming no host means the official hub, and the words are the panel's own for
// the control that does it — so what the reader is told reads as the button they
// pressed.
export const OFFICIAL_HUB_LABEL = 'the official hub';

// SEEDING_SUBJECT is the seeding in the reader's terms, used for the sentence
// every ending produces. One spelling, so a completion and a failure name the
// same thing.
export const SEEDING_SUBJECT = 'The seeding';

// seedingOpeningLine is what the channel is told before the request goes out.
//
// It exists because the work reaches a registry and takes as long as that
// registry takes, with nothing drawn while it does. A reader who pressed the
// control and then went to the channel finds the operation named there rather
// than an empty channel, and the terminal line lands under it.
export function seedingOpeningLine(host: string | null): string {
  return `\nSeeding ${host ?? OFFICIAL_HUB_LABEL}, with its signature trust policy.`;
}

// seedParams composes the request for a host, or for none.
//
// A null host omits the key rather than sending an empty string. The two reach
// the same default in the compiler, so this is not a correctness fix — it is that
// a request saying nothing about the registry should not claim to name one.
export function seedParams(host: string | null): ConfigInitParams {
  return host === null ? {} : { registry: host };
}

// runSeeding asks the compiler to seed the configuration and reports how it
// ended.
//
// It returns the ending rather than announcing it, because the words a reader
// reads and the place they read them belong to the surface. What is decided here
// is whether the seeding completed and, if it did, the sentence naming what was
// actually seeded and where — followed by the sentence saying it is in effect,
// where the language server running afterwards has read it.
//
// A refusal is classified through the extension's one home for that, so the
// compiler's own diagnostic travels intact — including the one that says an
// existing configuration was left untouched and names the file it found.
//
// 🔴 IT TAKES TWO ARGUMENTS AND MUST KEEP TAKING TWO. A third carrying a stop
// would be a stop the compiler cannot honour, for the reason at the head of this
// module, and an assertion holds the arity so that adding one has to be argued
// rather than slipped in.
export async function runSeeding(
  deps: ConfigSeedingDeps,
  host: string | null,
): Promise<OperationOutcome> {
  try {
    const { answer, inEffect } = await deps.seedConfiguration(seedParams(host));
    return { kind: 'ok', detail: endingInEffect(seedingDetail(answer), inEffect) };
  } catch (err) {
    return outcomeOf(err);
  }
}

// seedingDetail is the sentence a completed seeding ends in.
//
// It is composed from the answer's own fields, so the reader is told what was
// seeded and where rather than that something finished.
//
// The written branch is the shared registration sentence rather than a wording
// of its own: the seeding reaches the same registration a registration does, and
// the compiler renders both as one set of sentences for that reason.
export function seedingDetail(result: ConfigInitResult): string {
  // The verb is read from the answer rather than assumed. This client asks for a
  // write and cannot ask for anything else, so the other branch is what an answer
  // that did not write would honestly be reported as, instead of a completion
  // sentence claiming a file that is not there.
  if (result.written) {
    return registrationSentence(result.host, result.scope, result.trust);
  }
  const where = `${result.scope.configFile}, ${reachPhrase(result.scope)}`;
  return `reported the configuration for ${result.host} without writing ${where}. `
    + trustPhrase(result.trust);
}
