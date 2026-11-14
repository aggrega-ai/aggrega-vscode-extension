// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';
import { AppliedWrite, endingInEffect } from './config-change-watch';
import {
  ConfigWriteDestination,
  configWriteOverrides,
  reachOfDestination,
  reachPhrase,
} from './config-write-scope';
import { refusalCondition } from './error-surfaces';
import * as l10n from './l10n';
import { OperationOutcome, outcomeOf } from './operation-outcome';
import { PinnedByHand, registrationSentence } from './registration-outcome';
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
  l10n.t('Aggrega: which configuration file should the registry be written to?');
export const REMOVAL_DESTINATION_PROMPT =
  l10n.t('Aggrega: which configuration file should the entry be removed from?');

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
//
// Each destination's consequence is a whole sentence of its own; the file fills
// its placeholder in config-write-scope.ts's words, the one home for them, as a
// phrase carrying its own article.
export function removalConsentDetail(destination: ConfigWriteDestination): string {
  const reach = reachOfDestination(destination);
  const removed = destination === 'global'
    ? l10n.t('The entry is removed from {0}, so every project resolving through it is affected.', reach)
    : l10n.t('The entry is removed from {0}, so no other project on this machine is affected.', reach);
  return `${removed} ${l10n.t('Which registry is the default is left unchanged.')}`;
}

// --- the request and answer shapes ---------------------------------------

// RegistryAddParams is what this client sends to register a registry.
//
// 🔴 IT CARRIES THE HOST AND THE DESTINATION, AND, WHERE THE READER SUPPLIED THEM,
// KEYLESS IDENTITIES AND A PUBLIC KEY — AND THE ABSENCE OF THE REST IS THE
// CONTRACT RATHER THAN AN OMISSION. The operation also accepts a friendly alias, a
// trust-root path, a signature requirement, an advisory downgrade and a switch for
// the advertised-trust fetch. This client offers none of them, so none is declared
// here, because a declared field is a field a later call site will fill.
//
// The identities and the key are declared because they are exactly what the
// command line takes where a registry advertises no trust policy: its notice for
// that case, and its refusal of such a registry while the workspace is offline,
// each name those two and nothing else. They are asked for only in that case (see
// asksForTrust), and each is sent only where the reader supplied it, so a
// registration that names neither is the bare one.
//
// Sending none of the rest takes the compiler's own defaults, which are the
// defaults a reader gets from a command line naming none of those flags: the
// advertised trust policy is fetched and pinned unless identities or a key are
// supplied, nothing is required, and nothing is downgraded. Two of those defaults
// are not the zero value — the fetch defaults to on, and an unset signature
// requirement is distinguishable from one explicitly turned off — which is why
// omitting the fields is not the same as declaring them false, and why they must
// stay undeclared rather than sent empty.
//
// The two destination fields are declared BECAUSE the reader chooses between
// them. Exactly one is true on any request, decided by one value in one place,
// so the pair cannot express the combination the compiler refuses nor the absence
// that would silently take a default instead of the reader's answer.
export type RegistryAddParams = Required<
  Pick<wire.RegistryAddParams, 'host' | 'global' | 'workspace'>
> & Pick<wire.RegistryAddParams, 'identities' | 'keyPath'>;

// RegistryAddResult is the answer a registration produces.
//
// It is the reason this operation ends in something a reader can check rather
// than in a status: the host is echoed as the compiler normalised it, the scope
// names the file the write actually landed in and how far that file reaches, and
// the trust outcome says what reading the registry's advertised policy did. Every
// field is read from the answer; none is assumed.
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
//
// The two that write a configuration file answer whether the language server
// running afterwards has read the write, which the ending says; the credential
// removal writes no configuration file, so it answers the compiler's answer
// alone.
export interface RegistryConfigureDeps {
  addRegistry(params: RegistryAddParams): Promise<AppliedWrite<RegistryAddResult>>;
  removeRegistry(params: RegistryRemoveParams): Promise<AppliedWrite<RegistryRemoveResult>>;
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
export const REGISTRATION_SUBJECT = l10n.t('The registration');
export const REGISTRY_REMOVAL_SUBJECT = l10n.t('The removal');
export const CREDENTIAL_REMOVAL_SUBJECT = l10n.t('The credential removal');

// --- a trust policy pinned by hand ---------------------------------------

// TrustByHand is what a reader supplied to pin by hand where a registration took
// no advertised policy: keyless identities, each exactly as typed, and the path
// of a public-key file, or null where no key was chosen.
//
// 🔴 NOTHING HERE READS, CHECKS OR KEEPS EITHER. Each identity is sent as typed
// and the key file is read by the compiler, which refuses a malformed identity, an
// unreadable file or one that is not a public key in the same sentence the command
// line prints for it; a check on this side would be a second answer to what an
// identity or a key is. Nothing is
// written anywhere by this side, and the answers last only as long as the one
// registration they are sent with.
export interface TrustByHand {
  identities: string[];
  keyPath: string | null;
}

// TrustByHandChoice is one row of the question asked first: which kinds of trust
// the reader wants to pin. The row that pins neither is a way to say no, beside
// dismissing the question.
export interface TrustByHandChoice {
  label: string;
  description: string;
  identities: boolean;
  key: boolean;
}

export const TRUST_BY_HAND_CHOICES: readonly TrustByHandChoice[] = [
  { label: l10n.t('Keyless identities'), description: l10n.t('each written identity=issuer'), identities: true, key: false },
  { label: l10n.t('A public key'), description: l10n.t('a public-key file, read and pinned in the entry'), identities: false, key: true },
  { label: l10n.t('Keyless identities and a public key'), description: l10n.t('the identities first, then the key'), identities: true, key: true },
  { label: l10n.t('Neither'), description: l10n.t('leave it as it stands'), identities: false, key: false },
];

// trustByHandTitle and TRUST_BY_HAND_PLACEHOLDER are how the question is put.
// One wording serves every case it is asked in — a registry that advertises
// nothing, one that could not be reached, and one refused offline for want of a
// policy — because the ending in front of the reader has already said which it
// was.
export function trustByHandTitle(host: string): string {
  return l10n.t('Aggrega: pin a signature trust policy for {0} by hand?', host);
}
export const TRUST_BY_HAND_PLACEHOLDER =
  l10n.t('The registry\'s own policy was not taken. Choose what to pin, or press Escape to pin nothing.');

// The prompt that asks for the identities, one at a time. An empty answer ends
// the list, and dismissing any prompt pins nothing at all.
export function identityPromptTitle(host: string): string {
  return l10n.t('Aggrega: a keyless identity to trust for {0}', host);
}
export const IDENTITY_PROMPT_FIRST =
  l10n.t('Written identity=issuer. Press Enter with nothing typed to pin none; Escape pins nothing at all.');
export const IDENTITY_PROMPT_NEXT =
  l10n.t('Another, written identity=issuer. Press Enter with nothing typed when there are no more.');
export const IDENTITY_PLACEHOLDER = 'dev@example.com=https://accounts.google.com';

// The dialog that asks for the key file. A file dialog rather than a typed path,
// because it answers with an absolute path: the compiler reads a relative one
// against the directory the language server was started in, which a reader of
// this surface cannot see.
export function keyDialogTitle(host: string): string {
  return l10n.t('Aggrega: a public key to trust for {0}', host);
}
export const KEY_DIALOG_BUTTON = l10n.t('Pin this key');

// OFFLINE_REGISTRATION_WITHOUT_TRUST_POLICY is the code of the compiler's refusal
// to register a registry other than the official hub while the workspace is
// offline and no policy was supplied by hand.
//
// 🔴 IT IS MATCHED AGAINST THE CODE THE REFUSAL'S DATA CARRIES, AND AGAINST
// NOTHING ELSE. That field is the condition's descriptive name, the identifier
// the compiler publishes for a client to branch on. The short code the message
// opens with is there for the reader, and the sentence after it is the
// compiler's and may be reworded, so neither is read.
export const OFFLINE_REGISTRATION_WITHOUT_TRUST_POLICY = 'offline-registration-without-trust-policy';

// asksForTrust says whether a completed registration leaves the reader a trust
// policy to pin by hand: the registry was asked and no advertised policy came
// back — it advertised none, or it could not be reached, which the answer reports
// as not advertised with unreachable beside it — and no built-in baseline was
// pinned in its place. The entry carries no policy either way, and a policy stated
// by hand needs no fetch, so the question is the same for both.
//
// 🔴 IT IS DECIDED ON THE ANSWER, NEVER BEFORE THE REQUEST. A policy supplied by
// hand takes the place of the advertised one, so a question asked first would
// invite a reader to override a policy the registry does advertise. A pinned
// policy and the hub's baseline are therefore never followed by the question.
export function asksForTrust(result: RegistryAddResult): boolean {
  return result.trust.notAdvertised === true && !result.trust.pinned && !result.trust.baseline;
}

// refusedForWantOfTrust says whether a refused registration is the offline
// refusal whose remedy is a policy supplied by hand. The command line names
// exactly the identities and the key as that remedy, so it is the same case as a
// registry advertising nothing, met before anything was written.
export function refusedForWantOfTrust(err: unknown): boolean {
  return refusalCondition(err).code === OFFLINE_REGISTRATION_WITHOUT_TRUST_POLICY;
}

// pinsAnything says whether a reader's answers supply anything to pin. Where they
// do not — the question dismissed, Neither chosen, or no identity typed and no
// key chosen — no second registration is sent, and the entry is what the first
// one wrote.
export function pinsAnything(byHand: TrustByHand | null): byHand is TrustByHand {
  return byHand !== null && (byHand.identities.length > 0 || byHand.keyPath !== null);
}

// pinnedIn is the part of a sent request the ending names: how many identities it
// carried, and whether a key — never either value. It is read off the request
// rather than off the reader's answers, so the ending names what was sent.
function pinnedIn(request: RegistryAddParams): PinnedByHand {
  return { identities: request.identities?.length ?? 0, key: request.keyPath !== undefined };
}

// --- composing the requests ----------------------------------------------

// addRequest composes the registration of one registry at a chosen destination,
// carrying the identities and the key a reader supplied by hand where there are
// any.
//
// The blank guard is REACHED rather than restated. It is the extension's one home
// for refusing an operation with nothing to act on, exported for exactly this
// reason, and a second blank check written here would agree with it until the day
// one of the two was changed. It is a second guard rather than the only one — the
// prompt that asks for a host invokes nothing when it is dismissed — and it is
// the one that holds if a later binding is written more loosely.
//
// Each detail is added only where it was supplied: an empty list of identities is
// omitted rather than sent, so a registration naming none is the bare request.
export function addRequest(
  host: string,
  destination: ConfigWriteDestination,
  byHand: TrustByHand | null = null,
): RegistryAddParams {
  const [, checked] = withSubject('registry add', host, l10n.t('the registry to register'));
  const request: RegistryAddParams = { host: checked, ...configWriteOverrides(destination) };
  if (byHand !== null && byHand.identities.length > 0) {
    request.identities = [...byHand.identities];
  }
  if (byHand !== null && byHand.keyPath !== null) {
    request.keyPath = byHand.keyPath;
  }
  return request;
}

// removeRequest composes the removal of one registry's entry from a chosen
// destination. The token is guarded through the same one home.
export function removeRequest(
  host: string,
  destination: ConfigWriteDestination,
): RegistryRemoveParams {
  const [, checked] = withSubject('registry remove', host, l10n.t('the registry to remove'));
  return { registry: checked, ...configWriteOverrides(destination) };
}

// logoutRequest composes the removal of one registry's stored credential.
export function logoutRequest(host: string): LogoutParams {
  const [, checked] = withSubject(
    'logout',
    host,
    l10n.t('the registry whose stored credential to remove'),
  );
  return { registry: checked };
}

// --- running them --------------------------------------------------------

// RegistrationEnding is how a registration ended, together with whether the reader
// is then asked for a trust policy to pin by hand, and the host that question
// names — the one the compiler keyed the entry under where it answered, and the
// one the request carried where it refused.
export interface RegistrationEnding {
  outcome: OperationOutcome;
  asksForTrust: boolean;
  host: string;
}

// runRegistryAdd asks the compiler to register the registry and reports how it
// ended, and whether the ending leaves the reader a trust policy to pin by hand.
//
// It returns the ending rather than announcing it, because the words a reader
// reads and the place they read them belong to the surface. What is decided here
// is whether the registration completed and, if it did, the sentence naming what
// was actually registered, where, and what signature trust it was given —
// followed by the sentence saying it is in effect, where the language server
// running afterwards has read it — and whether the answer, or the refusal, is the
// one case in which the command line takes identities or a key.
//
// 🔴 IT TAKES THREE ARGUMENTS AND MUST KEEP TAKING THREE. A fourth carrying a
// stop would be a stop the compiler cannot honour, for the reason at the head of
// this module, and an assertion holds the arity so that adding one has to be
// argued rather than slipped in.
export async function runRegistryAdd(
  deps: RegistryConfigureDeps,
  host: string,
  destination: ConfigWriteDestination,
): Promise<RegistrationEnding> {
  const request = addRequest(host, destination);
  try {
    const { answer, inEffect } = await deps.addRegistry(request);
    return {
      outcome: { kind: 'ok', detail: endingInEffect(registrationDetail(answer), inEffect) },
      asksForTrust: asksForTrust(answer),
      host: answer.host,
    };
  } catch (err) {
    return { outcome: outcomeOf(err), asksForTrust: refusedForWantOfTrust(err), host: request.host };
  }
}

// runRegistryAddWithTrust registers the registry again, at the same destination
// and through the same request, carrying what the reader supplied by hand, and
// reports how it ended.
//
// The entry it writes takes the place of the one the first registration wrote,
// which is what the command line writes when it is given the same identities and
// key. A refusal — a malformed identity, a key file that cannot be read or is not
// a public key — is the compiler's own sentence, carried whole; the first
// registration's entry is then left as it was written. Carried whole is safe for a
// file that is not a public key, a private key chosen by mistake among them,
// because the compiler's sentence names the field and the form it expects and
// withholds what the file holds.
//
// 🔴 IT TAKES FOUR ARGUMENTS AND MUST KEEP TAKING FOUR: the three the first
// registration takes and what was supplied. None of them is a stop, for the reason
// at the head of this module, and an assertion holds the arity.
export async function runRegistryAddWithTrust(
  deps: RegistryConfigureDeps,
  host: string,
  destination: ConfigWriteDestination,
  byHand: TrustByHand,
): Promise<OperationOutcome> {
  const request = addRequest(host, destination, byHand);
  try {
    const { answer, inEffect } = await deps.addRegistry(request);
    return { kind: 'ok', detail: endingInEffect(registrationDetail(answer, request), inEffect) };
  } catch (err) {
    return outcomeOf(err);
  }
}

// runRegistryRemove asks the compiler to drop the registry's entry and reports
// how it ended, saying the removal is in effect on the same terms as a
// registration.
//
// 🔴 IT TAKES THREE ARGUMENTS AND MUST KEEP TAKING THREE, for the reason above.
export async function runRegistryRemove(
  deps: RegistryConfigureDeps,
  host: string,
  destination: ConfigWriteDestination,
): Promise<OperationOutcome> {
  try {
    const { answer, inEffect } = await deps.removeRegistry(removeRequest(host, destination));
    return { kind: 'ok', detail: endingInEffect(registryRemovalDetail(answer), inEffect) };
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
// renders both as one set of sentences. Given the request that was sent, a
// registration that carried a policy supplied by hand says what kind it pinned,
// and names none of the values.
export function registrationDetail(
  result: RegistryAddResult,
  sent: RegistryAddParams | null = null,
): string {
  return registrationSentence(
    result.host,
    result.scope,
    result.trust,
    sent === null ? null : pinnedIn(sent),
  );
}

// registryRemovalDetail is the sentence a completed removal ends in.
//
// It names the host the compiler resolved the token to and the file the removal
// actually wrote, which is strictly more than the reader was told beforehand: the
// confirmation predicted a file from the destination they chose, and this is the
// same fact measured instead of predicted. How far the file reaches fills a
// placeholder in config-write-scope.ts's own words, a phrase standing alone after
// the file.
export function registryRemovalDetail(result: RegistryRemoveResult): string {
  return l10n.t(
    'removed the registry {0} from {1}, {2}.',
    result.host, result.scope.configFile, reachPhrase(result.scope),
  );
}

// credentialRemovalDetail is the sentence a completed credential removal ends in.
//
// The host is echoed from the answer rather than from the request, so the reader
// is told which address the store was asked about as the compiler received it.
// Nothing is said about where the credential lived: the store frequently
// delegates to a keychain or a credential helper, so naming a location would
// assert one the removal did not necessarily touch.
export function credentialRemovalDetail(result: LogoutResult): string {
  return l10n.t('removed the stored credential for {0}.', result.registry);
}
