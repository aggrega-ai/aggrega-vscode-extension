// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';
import {
  ConfigWriteDestination,
  configWriteOverrides,
  reachOfDestination,
  reachPhrase,
} from './config-write-scope';
import { OperationOutcome, outcomeOf } from './operation-outcome';
import { registrationSentence } from './registration-outcome';
import { withSubject } from './operation-groups';

// This module is the whole of what changing the configured registries means on
// this side: what each request carries, what each answer carries, and the
// sentences the reader is left with. It holds no editor type, so each of those is
// read back by a test exactly as an author would meet it.
//
// The compiler owns the work. Nothing here decides what a registration or a
// removal does, and nothing here re-words what the compiler says about it: every
// closing sentence is composed from the answer's own fields, and a refusal
// travels through the extension's one rendering home with the compiler's text
// intact — including the ones that say a token matched no entry and that a host
// is required, which are the refusals a reader is most likely to meet.
//
// 🔴 NOTHING HERE CAN BE STOPPED, AND THE ABSENCE OF A STOP IS THE DECISION. A
// stop is offered exactly where the compiler can honour one, which is read off
// that operation's own handler rather than off a precedent. Each of the three
// shared operations behind these requests is called with no cancellation reaching
// its work, and each handler checks for a stopped caller only after that
// operation has already returned, at which point all it can do is withhold the
// reply. So a stop offered here could only ever stop the editor waiting, never
// the work, and presenting that as a stop would break the rule that stopping
// means the compiler stopped. No signal is accepted anywhere in this module.
//
// 🔴 THE INDEX BUILD IS DELIBERATELY NOT HERE, AND THE REASON IS THE PARAGRAPH
// ABOVE RATHER THAN A TRANSPORT DIFFERENCE. It is a request like these three, but
// it is the one registry operation that reaches the registries themselves and the
// one whose shared walk observes the request's own context — so it carries a stop,
// and it would falsify the module-wide statement that nothing here accepts a
// signal. It lives in its own module, where that property can be stated where it
// holds.

// --- what the reader chooses ---------------------------------------------

// REGISTRATION_DESTINATION_PROMPT and REMOVAL_DESTINATION_PROMPT are what the
// reader is asked before either write.
//
// The question is asked in each operation's own terms — which file the entry is
// written to, which file it is removed from — because the two are different acts
// on the same pair of files, and one wording for both would leave a reader
// working out which direction they were choosing for.
export const REGISTRATION_DESTINATION_PROMPT =
  'Aggrega: which configuration file should the registry be written to?';
export const REMOVAL_DESTINATION_PROMPT =
  'Aggrega: which configuration file should the entry be removed from?';

// removalConsentDetail is what the confirmation says a removal will reach.
//
// 🔴 IT IS COMPOSED FROM THE CHOSEN DESTINATION RATHER THAN STATED, and that is
// the whole reason it is a function. The sentence a reader consents to has to be
// true of the file they picked: told that every project on the machine is
// affected while removing an entry from their own project's file, they would be
// consenting to something that is not going to happen.
//
// The file is named in the words the ending will use, from the one home for
// them. The consequence is this operation's own: a registry entry is what a
// project resolves through, so which projects stop resolving through it is the
// fact that decides whether a reader wants this at all.
export function removalConsentDetail(destination: ConfigWriteDestination): string {
  const consequence = destination === 'global'
    ? 'every project resolving through it is affected'
    : 'no other project on this machine is affected';
  return `The entry is removed from ${reachOfDestination(destination)}, so ${consequence}. `
    + 'Which registry is the default is left unchanged.';
}

// --- the request and answer shapes ---------------------------------------

// RegistryAddParams is what this client sends to register a registry.
//
// 🔴 IT CARRIES THE HOST AND THE DESTINATION, AND THE ABSENCE OF THE REST IS THE
// CONTRACT RATHER THAN AN OMISSION. The operation also accepts a friendly alias,
// pinned identities, a key path, a trust-root path, a signature requirement, an
// advisory downgrade and a switch for the advertised-trust fetch. This client
// offers none of them, so none is declared here, because a declared field is a
// field a later call site will fill.
//
// Sending none of them takes the compiler's own defaults, which are the defaults
// a reader gets from a bare command line: the advertised trust policy is fetched
// and pinned, nothing is required, nothing is downgraded, and no identity is
// pinned by hand. Two of those defaults are not the zero value — the fetch
// defaults to on, and an unset signature requirement is distinguishable from one
// explicitly turned off — which is why omitting the fields is not the same as
// declaring them false, and why they must stay undeclared rather than sent empty.
//
// The two destination fields are declared BECAUSE the reader chooses between
// them. Exactly one is true on any request, decided by one value in one place,
// so the pair cannot express the combination the compiler refuses nor the absence
// that would silently take a default instead of the reader's answer.
export type RegistryAddParams = Required<
  Pick<wire.RegistryAddParams, 'host' | 'global' | 'workspace'>
>;

// RegistryAddResult is the answer a registration produces.
//
// It is the reason this operation ends in something a reader can check rather
// than in a status: the host is echoed as the compiler normalised it, the scope
// names the file the write actually landed in and how far that file reaches, and
// the trust outcome says what the registry advertised. Every field is read from
// the answer; none is assumed.
export type RegistryAddResult = wire.RegistryAddResult;

// RegistryRemoveParams is what this client sends to drop a registry's entry.
//
// The registry is addressed by the host the listing reported, which is also what
// the compiler accepts as a friendly alias — so the value is passed through
// verbatim rather than resolved here, and a token matching nothing is refused by
// the compiler in its own words instead of being pre-judged by a set this side
// holds.
export type RegistryRemoveParams = Required<
  Pick<wire.RegistryRemoveParams, 'registry' | 'global' | 'workspace'>
>;

// RegistryRemoveResult is the answer a removal produces: the host as the
// compiler resolved the token, and the file the removal wrote.
export type RegistryRemoveResult = wire.RegistryRemoveResult;

// LogoutParams is what this client sends to remove a stored credential.
//
// 🔴 IT CARRIES ONE FIELD, AND THERE IS NO DESTINATION TO CHOOSE. The credential
// store is shared by every project on the machine and by every other tool
// speaking to the same registries, so this operation has no project-scoped form
// to resolve to and the request surface carries no override to send. Offering a
// choice here would be a choice the compiler cannot honour.
//
// The value is a host rather than a friendly alias: the store is keyed by the
// address a client authenticates to and holds no alias to resolve.
export type LogoutParams = Required<Pick<wire.LogoutParams, 'registry'>>;

// LogoutResult is the answer a credential removal produces.
//
// The answer also carries the reach of the change and the workspace that
// answered. Neither is declared, for the reason the seeding's unread field is
// not: the reach is documented as always machine-wide for this operation, so
// reading it would add a branch for a state the compiler never sends, and the
// workspace is a discriminator for a caller holding several sessions, which this
// one is not. The confirmation asked beforehand is where the reader is told how
// far the store reaches.
export type LogoutResult = Pick<wire.LogoutResult, 'registry'>;

// RegistryConfigureDeps is what this family needs: a way to ask the compiler for
// each of the three changes.
//
// It is declared this narrowly so the surface that owns the tree passes its own
// richer dependency set here unchanged, and so a test drives every decision with
// a fake answer and no transport at all. It takes no cancellation, for the reason
// stated at the head of this module.
export interface RegistryConfigureDeps {
  addRegistry(params: RegistryAddParams): Promise<RegistryAddResult>;
  removeRegistry(params: RegistryRemoveParams): Promise<RegistryRemoveResult>;
  logOutOfRegistry(params: LogoutParams): Promise<LogoutResult>;
}

// REGISTRY_ADD_COMMAND is the one command that registers a registry.
//
// It lives beside the operation it performs rather than beside any of the
// surfaces that run it — the Registries panel, the operation surface, and the
// welcome page's registry step all name it, and a declaration beside one of
// those would make the others depend on a surface they have nothing to do with.
// Two copies agree until one of them moves, and what they hide while they agree
// is a command registered under one identifier and invoked under another.
export const REGISTRY_ADD_COMMAND = 'aggrega.registries.add';

// The three operations in the reader's terms, used for the sentence every ending
// produces. One spelling each, so a completion and a failure name the same thing.
export const REGISTRATION_SUBJECT = 'The registration';
export const REGISTRY_REMOVAL_SUBJECT = 'The removal';
export const CREDENTIAL_REMOVAL_SUBJECT = 'The credential removal';

// --- composing the requests ----------------------------------------------

// addRequest composes the registration of one registry at a chosen destination.
//
// The blank guard is REACHED rather than restated. It is the extension's one home
// for refusing an operation with nothing to act on, exported for exactly this
// reason, and a second blank check written here would agree with it until the day
// one of the two was changed. It is a second guard rather than the only one — the
// prompt that asks for a host invokes nothing when it is dismissed — and it is
// the one that holds if a later binding is written more loosely.
export function addRequest(
  host: string,
  destination: ConfigWriteDestination,
): RegistryAddParams {
  const [, checked] = withSubject('registry add', host, 'the registry to register');
  return { host: checked, ...configWriteOverrides(destination) };
}

// removeRequest composes the removal of one registry's entry from a chosen
// destination. The token is guarded through the same one home.
export function removeRequest(
  host: string,
  destination: ConfigWriteDestination,
): RegistryRemoveParams {
  const [, checked] = withSubject('registry remove', host, 'the registry to remove');
  return { registry: checked, ...configWriteOverrides(destination) };
}

// logoutRequest composes the removal of one registry's stored credential.
export function logoutRequest(host: string): LogoutParams {
  const [, checked] = withSubject(
    'logout',
    host,
    'the registry whose stored credential to remove',
  );
  return { registry: checked };
}

// --- running them --------------------------------------------------------

// runRegistryAdd asks the compiler to register the registry and reports how it
// ended.
//
// It returns the ending rather than announcing it, because the words a reader
// reads and the place they read them belong to the surface. What is decided here
// is whether the registration completed and, if it did, the sentence naming what
// was actually registered, where, and what the registry advertised.
//
// 🔴 IT TAKES THREE ARGUMENTS AND MUST KEEP TAKING THREE. A fourth carrying a
// stop would be a stop the compiler cannot honour, for the reason at the head of
// this module, and an assertion holds the arity so that adding one has to be
// argued rather than slipped in.
export async function runRegistryAdd(
  deps: RegistryConfigureDeps,
  host: string,
  destination: ConfigWriteDestination,
): Promise<OperationOutcome> {
  try {
    const result = await deps.addRegistry(addRequest(host, destination));
    return { kind: 'ok', detail: registrationDetail(result) };
  } catch (err) {
    return outcomeOf(err);
  }
}

// runRegistryRemove asks the compiler to drop the registry's entry and reports
// how it ended.
//
// 🔴 IT TAKES THREE ARGUMENTS AND MUST KEEP TAKING THREE, for the reason above.
export async function runRegistryRemove(
  deps: RegistryConfigureDeps,
  host: string,
  destination: ConfigWriteDestination,
): Promise<OperationOutcome> {
  try {
    const result = await deps.removeRegistry(removeRequest(host, destination));
    return { kind: 'ok', detail: registryRemovalDetail(result) };
  } catch (err) {
    return outcomeOf(err);
  }
}

// runLogout asks the compiler to remove the stored credential and reports how it
// ended.
//
// 🔴 IT TAKES TWO ARGUMENTS AND MUST KEEP TAKING TWO. There is no destination to
// pass, because the credential store has no project-scoped form, and no stop to
// pass, for the reason at the head of this module.
export async function runLogout(
  deps: RegistryConfigureDeps,
  host: string,
): Promise<OperationOutcome> {
  try {
    const result = await deps.logOutOfRegistry(logoutRequest(host));
    return { kind: 'ok', detail: credentialRemovalDetail(result) };
  } catch (err) {
    return outcomeOf(err);
  }
}

// --- the sentences each ending produces ----------------------------------

// registrationDetail is the sentence a completed registration ends in.
//
// It is the shared registration sentence rather than a wording of its own,
// because seeding a configuration reaches the same registration and the compiler
// renders both as one set of sentences.
export function registrationDetail(result: RegistryAddResult): string {
  return registrationSentence(result.host, result.scope, result.trust);
}

// registryRemovalDetail is the sentence a completed removal ends in.
//
// It names the host the compiler resolved the token to and the file the removal
// actually wrote, which is strictly more than the reader was told beforehand: the
// confirmation predicted a file from the destination they chose, and this is the
// same fact measured instead of predicted.
export function registryRemovalDetail(result: RegistryRemoveResult): string {
  return `removed the registry ${result.host} from `
    + `${result.scope.configFile}, ${reachPhrase(result.scope)}.`;
}

// credentialRemovalDetail is the sentence a completed credential removal ends in.
//
// The host is echoed from the answer rather than from the request, so the reader
// is told which address the store was asked about as the compiler received it.
// Nothing is said about where the credential lived: the store frequently
// delegates to a keychain or a credential helper, so naming a location would
// assert one the removal did not necessarily touch.
export function credentialRemovalDetail(result: LogoutResult): string {
  return `removed the stored credential for ${result.registry}.`;
}
