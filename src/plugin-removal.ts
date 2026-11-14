// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';
import { AppliedWrite, endingInEffect } from './config-change-watch';
import { reachPhrase } from './config-write-scope';
import * as l10n from './l10n';
import { OperationOutcome, outcomeOf } from './operation-outcome';
import { withSubject } from './operation-groups';

// This module is the whole of what removing a configured plugin means on this
// side: what the request carries, what the answer carries, and the sentence the
// reader is left with. It holds no editor type, so each of those is read back by
// a test exactly as an author would meet it.
//
// The compiler owns the work. Nothing here decides what a removal does, and
// nothing here re-words what the compiler says about it: the closing sentence is
// composed from the answer's own fields, and a refusal travels through the
// extension's one rendering home with the compiler's text intact — including the
// one that says a query matched no entry, which is the refusal a reader is most
// likely to meet.
//
// 🔴 NOTHING HERE CAN BE STOPPED, AND THE ABSENCE OF A STOP IS THE DECISION. A
// stop is offered exactly where the compiler can honour one, which is read off
// that operation's own handler rather than off a precedent. The shared operation
// behind this request takes no cancellation — nothing is passed to it that could
// carry one — and the request handler checks for a stopped caller only after that
// operation has already returned, at which point all it can do is withhold the
// reply. So a stop offered here could only ever stop the editor waiting, never
// the work, and presenting that as a stop would break the rule that stopping
// means the compiler stopped. No signal is accepted anywhere in this module.
//
// The removal needs no opening line on the channel either, and that follows from
// what it is rather than from its being quick: it reaches no registry and
// fetches nothing, operating on the configuration text alone. There is no wait
// for a reader to be told about. What the silence rule asks for is that the
// ending is observable, and every ending writes the channel line and raises a
// notification.

// PluginRemoveParams is what this client sends to remove a configured plugin.
//
// 🔴 IT CARRIES TWO FIELDS, AND THE ABSENCE OF THE OTHERS IS THE CONTRACT RATHER
// THAN AN OMISSION. The operation also accepts the two write-target overrides
// that force which configuration file the removal writes, and this client sends
// neither — so neither is declared here, because a declared field is a field a
// later call site will fill.
//
// Sending neither takes the operation's own default, which is the default a
// reader gets from the command line: a socket attachment resolves to this
// project's configuration and a command extension to the global one. Which file
// a removal targets is the operator's setting to make, and pinning it here would
// decide it for them.
export type PluginRemoveParams = Required<Pick<wire.PluginRemoveParams, 'type' | 'query'>>;

// PluginRemoveResult is the answer a removal produces.
//
// It is the reason this operation ends in something a reader can check rather
// than in a status: the type and the query are echoed as the compiler matched
// them, and the scope names the file the removal actually wrote and how far that
// file reaches. Every field is read from the answer; none is assumed.
export type PluginRemoveResult = wire.PluginRemoveResult;

// PluginRemovalDeps is the one thing a removal needs: a way to ask the compiler.
//
// It is declared this narrowly so the surface that owns the panel passes its own
// richer dependency set here unchanged, and so a test drives the whole decision
// with a fake answer and no transport at all. It takes no cancellation, for the
// reason stated at the head of this module. It answers the compiler's answer and
// whether the language server running afterwards has read the removal.
export interface PluginRemovalDeps {
  removePlugin(params: PluginRemoveParams): Promise<AppliedWrite<PluginRemoveResult>>;
}

// REMOVAL_SUBJECT is the removal in the reader's terms, used for the sentence
// every ending produces. One spelling, so a completion and a failure name the
// same thing.
export const REMOVAL_SUBJECT = l10n.t('The removal');

// removeParams composes the request for one configured plugin.
//
// Both values are the product's own strings, passed through verbatim: the listing
// reports them and the removal accepts them, matching a reference by an exact
// match on the entry it was configured with. A translation between the two
// surfaces would be a second copy of a vocabulary that belongs to the compiler,
// and it would agree with the compiler only until the day one of them changed.
//
// The blank guard is REACHED rather than restated. It is the extension's one home
// for refusing an operation with nothing to act on, exported for exactly this
// reason, and a second blank check written here would agree with it until the day
// one of the two was changed. It is a second guard rather than the only one — the
// row a removal is invoked from already carries no subject unless both values are
// present — and it is the one that holds if a later binding is written more
// loosely.
export function removeParams(type: string, reference: string): PluginRemoveParams {
  const [, checkedType] = withSubject('plugin remove', type, l10n.t("the plugin's type"));
  const [, query] = withSubject(
    'plugin remove',
    reference,
    l10n.t('a reference to the plugin to remove'),
  );
  return { type: checkedType, query };
}

// runPluginRemoval asks the compiler to remove the plugin and reports how it
// ended.
//
// It returns the ending rather than announcing it, because the words a reader
// reads and the place they read them belong to the surface. What is decided here
// is whether the removal completed and, if it did, the sentence naming what was
// actually removed and from where — followed by the sentence saying it is in
// effect, where the language server running afterwards has read it.
//
// 🔴 IT TAKES THREE ARGUMENTS AND MUST KEEP TAKING THREE. A fourth carrying a
// stop would be a stop the compiler cannot honour, for the reason at the head of
// this module, and an assertion holds the arity so that adding one has to be
// argued rather than slipped in.
export async function runPluginRemoval(
  deps: PluginRemovalDeps,
  type: string,
  reference: string,
): Promise<OperationOutcome> {
  try {
    const { answer, inEffect } = await deps.removePlugin(removeParams(type, reference));
    return { kind: 'ok', detail: endingInEffect(removalDetail(answer), inEffect) };
  } catch (err) {
    return outcomeOf(err);
  }
}

// removalDetail is the sentence a completed removal ends in.
//
// It is composed from the answer's own fields, so the reader is told what was
// removed and from where rather than that something finished. That is strictly
// more than the command line's own account of the same removal: that one names
// the file it wrote and leaves the reader to judge how far the file reaches,
// which is the fact that decides whether the change affects this project or
// every project on the machine. How far the file reaches fills a placeholder in
// config-write-scope.ts's own words, a phrase standing alone after the file.
export function removalDetail(result: PluginRemoveResult): string {
  return l10n.t(
    'removed the {0} plugin {1} from {2}, {3}.',
    result.type, result.query, result.scope.configFile, reachPhrase(result.scope),
  );
}
