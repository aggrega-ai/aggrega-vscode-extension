// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';
import { CancellationSignal } from './cancellation';
import * as l10n from './l10n';
import { OperationOutcome, outcomeOf } from './operation-outcome';
import { withSubject } from './operation-groups';

// This module is the whole of what publishing means on this side: what each
// request carries, what each answer carries, and the sentence each operation
// ends in. It holds no editor type, so every one of those is read back by a test
// exactly as an author would meet it.
//
// The three belong in one module because they share one boundary. Publishing an
// entity, signing what is published, and withdrawing it are the operations that
// reach past this machine: what they land is what every consumer of that
// registry resolves, and none of it can be recalled from anyone who has already
// fetched it. Splitting them would put that one property in three places.
//
// The compiler owns the work. Nothing here decides what a publication does,
// nothing here reaches a registry, and nothing here re-words what the compiler
// says about it: a refusal travels through the extension's one rendering home
// with the compiler's text intact, and every closing sentence is composed from
// the answer's own fields.
//
// 🔴 THESE CAN BE STOPPED, AND THAT IS READ OFF THE COMPILER RATHER THAN
// ASSUMED. Each shared operation takes the request's own context and observes it
// at the point before anything becomes visible to anyone else — so stopping one
// abandons the publication rather than only ending this side's wait for an
// answer. That matters more here than anywhere else on these surfaces, because
// these are the operations whose product cannot be taken back.
//
// 🔴 AND NOTHING HERE IS ASKED OF A PERSON BY THE COMPILER. The command line
// asks a reader at a terminal for the content a withdrawal needs, and for a
// credential when it has none. A request surface has no terminal to ask on, so
// every one of those is a field the caller sends: the withdrawal's severity and
// reason are collected by this surface and travel on the request, and a
// credential that resolves from nothing is refused in the compiler's own words
// naming what to supply. Neither was reachable from this surface before either —
// a spawned subprocess has no terminal — so this is the same contract stated
// where it can be seen rather than a new constraint.

// --- the request shapes ---------------------------------------------------

// PublishEntityParams is what this client sends to publish one catalog entity.
//
// 🔴 IT CARRIES THE ENTITY AND NOTHING ELSE, AND THE ABSENCE OF THE REST IS THE
// CONTRACT RATHER THAN AN OMISSION. The operation also accepts a destination
// registry, a dry run, an explicit signing choice, a plugin executable and the
// keyless signing endpoints. This client sends none of them, so none is declared
// here, because a declared field is a field a later call site will fill.
//
// Omitting the registry takes the workspace's own configured default, which is
// what a reader gets from a bare command line. Omitting the signing choice
// follows the destination registry's policy, which is again the command line's
// behaviour when its flag is not passed — and no value of that field could relax
// a registry or workspace policy that requires a signature.
//
// The path is workspace-relative. That is the form the row and the index already
// carry, and the form every path-naming request parameter takes.
//
// It is a projection of the published request shape rather than a copy of one
// member of it, which is what keeps the narrowing deliberate AND checked: the
// member's name and type are the compiler's, and a member this surface names
// that the compiler stops declaring does not compile.
export type PublishEntityParams = Required<Pick<wire.PublishEntityParams, 'entity'>>;

// SignArtifactsParams is what this client sends to sign already-published
// artifacts.
//
// The references are addresses in a registry rather than paths, so they carry no
// workspace-relative contract — which is why the reference is asked for rather
// than offered from the workspace index: the index describes what is authored
// here, and this operation amends what is already published.
//
// It is a list because the operation is a batch and one authentication serves
// the whole of it. This surface sends one, and sending it as the list the
// operation takes is what keeps the shape the wire has.
export type SignArtifactsParams = Required<Pick<wire.SignArtifactsParams, 'references'>>;

// DeprecateArtifactParams is what this client sends to withdraw an
// already-published artifact.
//
// 🔴 THE SEVERITY AND THE REASON ARE REQUIRED, AND THAT IS WHY THIS SURFACE
// COLLECTS THEM. The compiler asks a person for them at a terminal and refuses
// without them anywhere else, naming what to send. There is no terminal behind
// this request, so they are gathered by the surface and travel here — which is
// exactly what the subprocess path did with them, for the same reason.
//
// The optional replacement and the separate message are not sent. This surface
// asks for neither, and a declared field is a field a later call site will fill.
export type DeprecateArtifactParams = Required<
  Pick<wire.DeprecateArtifactParams, 'reference' | 'severity' | 'reason'>
>;

// --- the answer shapes ----------------------------------------------------

// PublicationReach is how far one publication reached: every registry host it
// addressed, in the order it first addressed them, and whether it attached
// anything a registry now serves to other people — content, a signature, a
// publication date or a withdrawal marker.
//
// It is on every answer here, and it is the fact none of the command line's own
// status lines states. The compiler derives it from what the operation actually
// attached rather than from what the request asked for, so an ending cannot
// describe a dry run, or a re-run that found everything already there, as a
// publication — or the reverse.
export type PublicationReach = wire.PublicationReach;

// PublishEntityResult is the answer publishing one entity produces.
//
// It is the reason this operation ends in something a reader can check rather
// than in an exit status: the reference and tag name what the compiler resolved
// the entity to, the digest names what that tag now points at, and the two
// booleans say which path ran — a dry run landed nothing, and an already-published
// tag already pointed at byte-identical content and landed nothing either. On a
// dry run the digest is the one a publication of the same content would land,
// which is the digest the command line's dry run prints.
//
// sizeText is the compiler's own rendering of size. It is read rather than
// recomputed, so this surface does not carry a second copy of the rounding rule
// that formatter owns.
export type PublishEntityResult = wire.PublishEntityResult;

// SignedArtifact is one signed reference and the digest its signature commits
// to. The digest is what makes the answer checkable: a signature commits to a
// digest string, so naming the reference alone would not say what was signed.
export type SignedArtifact = wire.SignedArtifact;

// SignArtifactsResult is the answer a signing batch produces.
//
// It reports successes only. A batch in which any reference failed arrives as a
// failure naming each one rather than as a result with a short list, so a
// shorter list here is never a partial batch being read as a whole one.
export type SignArtifactsResult = wire.SignArtifactsResult;

// DeprecationMarked is one attached marker: what it withdraws, the severity it
// carries, when it was issued, and the marker's own manifest digest.
//
// The digest is the marker's identity — a marker is attached as an untagged
// referrer of its subject, so nothing else addresses it.
export type DeprecationMarked = wire.DeprecationMarked;

// DeprecateArtifactResult is the answer a withdrawal produces.
export type DeprecateArtifactResult = wire.DeprecateArtifactResult;

// --- what an operation needs ----------------------------------------------

// What each operation needs, declared one operation at a time.
//
// They are separate rather than one set of three because the surfaces that run
// them are not the same: the catalog panel publishes and does nothing else, so
// requiring it to supply a signing and a withdrawal seam would make it declare
// two capabilities it never reaches. Each is declared this narrowly so the
// surface that owns a panel passes its own richer dependency set here unchanged,
// and so a test drives every decision with a fake answer and no transport at all.
export interface PublishEntityDeps {
  publishEntity(
    params: PublishEntityParams,
    signal?: CancellationSignal,
  ): Promise<PublishEntityResult>;
}

export interface SignArtifactsDeps {
  signArtifacts(
    params: SignArtifactsParams,
    signal?: CancellationSignal,
  ): Promise<SignArtifactsResult>;
}

export interface DeprecateArtifactDeps {
  deprecateArtifact(
    params: DeprecateArtifactParams,
    signal?: CancellationSignal,
  ): Promise<DeprecateArtifactResult>;
}

// PublicationRequestDeps is all three together, for a surface that offers all
// three.
export interface PublicationRequestDeps
  extends PublishEntityDeps, SignArtifactsDeps, DeprecateArtifactDeps {}

// PublicationReport is what one of these leaves behind: how it ended, and the
// lines the channel gets.
//
// The two travel together because they are one account of one run and the
// surface renders both. Composing them here rather than at the surface is what
// keeps every word an author reads in a module a test can read it back from.
export interface PublicationReport {
  outcome: OperationOutcome;
  lines: readonly string[];
}

// --- composing the requests -----------------------------------------------

// The blank guards below are REACHED rather than restated. withSubject is the
// extension's one home for refusing an operation with nothing to act on, and a
// second blank check written here would agree with it until the day one of the
// two was changed. Each is a second guard rather than the only one — the chooser
// or the prompt that asks for a subject invokes nothing when it is dismissed —
// and it is the one that holds if a later binding is written more loosely.

// publishEntityRequest composes the publication of one workspace entity.
export function publishEntityRequest(entityPath: string): PublishEntityParams {
  const [, checked] = withSubject('push', entityPath, l10n.t('the path of the entity to publish'));
  return { entity: checked };
}

// signArtifactsRequest composes the signature of one already-published artifact.
export function signArtifactsRequest(reference: string): SignArtifactsParams {
  const [, checked] = withSubject('sign', reference, l10n.t('a reference to the artifact to sign'));
  return { references: [checked] };
}

// deprecateArtifactRequest composes the withdrawal of one already-published
// artifact.
//
// The severity and the reason are checked here because the compiler requires
// both and this surface is what gathers them: a request missing either is
// refused on arrival, and refusing it here names the missing one in the terms
// the reader was asked in.
export function deprecateArtifactRequest(
  reference: string,
  severity: string,
  reason: string,
): DeprecateArtifactParams {
  const [, checkedRef] = withSubject(
    'deprecate', reference, l10n.t('a reference to the artifact to deprecate'),
  );
  const trimmedSeverity = severity.trim();
  if (trimmedSeverity === '') {
    throw new Error(l10n.t('a deprecation takes a severity, and none was given'));
  }
  const trimmedReason = reason.trim();
  if (trimmedReason === '') {
    throw new Error(l10n.t('a deprecation takes a reason, and none was given'));
  }
  return { reference: checkedRef, severity: trimmedSeverity, reason: trimmedReason };
}

// --- what the reader reads ------------------------------------------------

// PUBLICATION_SUBJECT, SIGNATURE_SUBJECT and WITHDRAWAL_SUBJECT name each
// operation in the reader's terms. One spelling each, so a completion and a
// failure name the same thing.
export const PUBLICATION_SUBJECT = l10n.t('The publication');
export const SIGNATURE_SUBJECT = l10n.t('The signature');
export const WITHDRAWAL_SUBJECT = l10n.t('The deprecation');

// publicationOpeningLine is what the channel says a publication is about to do.
//
// It names the entity the reader chose, which is the one fact the answer does
// not carry back and the one a reader scrolling this channel needs in order to
// tell one publication from another. The leading blank line separates this run
// from the last, the way every operation that writes here does.
export function publicationOpeningLine(entityPath: string): string {
  return `\n${l10n.t('Publication of {0}.', entityPath)}`;
}

// publishingTitle is what the progress of a publication says while it runs,
// whichever panel started it.
export function publishingTitle(subject: string): string {
  return l10n.t('Aggrega: publishing {0}', subject);
}

// signatureOpeningLine and withdrawalOpeningLine do what publicationOpeningLine
// does, for the two operations addressed by reference.
export function signatureOpeningLine(reference: string): string {
  return `\n${l10n.t('Signature of {0}.', reference)}`;
}

export function withdrawalOpeningLine(reference: string): string {
  return `\n${l10n.t('Withdrawal of {0}.', reference)}`;
}

// publicationLines is everything one publication puts on the channel, in the
// command line's own words for the same facts — which is why they stay
// untranslated.
//
// The compiler prints `Push complete: <reference>:<tag> (<digest>)` followed by
// the kind, the media type and the size, and its dry run prints the same
// `<reference>:<tag> (<digest>)` with the digest a publication would land; the
// same facts travel on the answer, so they are composed here from the answer
// rather than read off a stream this surface does not have. A dry run and an
// already-published tag each say what they are instead, because neither uploaded
// the entity's content, and reporting either as a publication would be the one
// thing a reader cannot check for themselves.
export function publicationLines(result: PublishEntityResult): readonly string[] {
  const lines: string[] = [];
  if (result.dryRun) {
    lines.push(`  dry run: ${result.reference}:${result.tag} (${result.digest}) — nothing was published`);
  } else if (result.alreadyPublished) {
    lines.push(`  already published: ${result.reference}:${result.tag} (${result.digest})`);
  } else {
    lines.push(`  published: ${result.reference}:${result.tag} (${result.digest})`);
  }
  lines.push(`  kind: ${result.kind}`);
  lines.push(`  mediatype: ${result.mediaType}`);
  lines.push(`  size: ${result.sizeText}`);
  // The executable's size is carried only for a plugin entity, so it is
  // rendered only where the compiler reported one — a reader never meets a
  // labelled size with nothing beside it.
  if (result.pluginSizeText) {
    lines.push(`  executable size: ${result.pluginSizeText}`);
  }
  if (result.signed) {
    lines.push(`  signature attached: ${result.reference}:${result.tag}`);
  }
  return lines;
}

// signatureLines lists each reference the batch signed with the digest its
// signature commits to, in the command line's own form for the same fact, so
// it stays untranslated as the publication's lines do.
//
// The label is read off the reach: a batch that attached nothing found every
// reference already signed, and one reference alone that reached past this
// machine was attached. Which of several were attached is not on the answer, so
// those are labelled signed, which is true of each.
export function signatureLines(result: SignArtifactsResult): readonly string[] {
  const signed = signedArtifacts(result);
  const label = !result.reach.beyondThisMachine
    ? 'already signed'
    : signed.length === 1 ? 'signature attached' : 'signed';
  return signed.map((a) => `  ${label}: ${a.reference} (${a.digest})`);
}

// A batch that signed or marked nothing answers with null rather than an empty
// list, and the two say the same thing — so each is coalesced in one place here.
function signedArtifacts(result: SignArtifactsResult): readonly SignedArtifact[] {
  return result.signed ?? [];
}

function attachedMarkers(result: DeprecateArtifactResult): readonly DeprecationMarked[] {
  return result.marked ?? [];
}

// withdrawalLines lists each marker attached, with the severity it carries, when
// it was issued and the marker's own digest.
//
// The command line prints no status line for a withdrawal at all, so these are
// facts a reader had no way to see before. They are the marker's identity: a
// marker is addressed by nothing else, so a withdrawal reported without its
// digest names nothing a reader could go and look at. The severity is the
// compiler's own word and fills its placeholder untranslated.
export function withdrawalLines(result: DeprecateArtifactResult): readonly string[] {
  return attachedMarkers(result).map(
    (m) => `  ${l10n.t('marker attached: {0} — {1}, issued {2} ({3})', m.reference, m.severity, m.issuedOn, m.digest)}`,
  );
}

// --- how each one ends ----------------------------------------------------

// NOTHING_LEFT_THIS_MACHINE is the sentence an operation that attached nothing
// anywhere ends with.
const NOTHING_LEFT_THIS_MACHINE = l10n.t('Nothing left this machine.');

// reachPhrase says where a publication landed, from the answer's own reach.
//
// It is the fact that separates these operations from everything else a reader
// can press: the others change this machine, and these change what anyone
// pulling from those registries resolves. It names every registry the call
// addressed, in the order the answer gives them. A call that attached nothing
// says so: where it addressed a registry and found everything already there,
// the sentence names that registry and says nothing new reached it, rather than
// claiming a landing that did not happen.
//
// It is a whole sentence of its own, so it follows the ending's first sentence
// after a space rather than being joined into it.
function reachPhrase(reach: PublicationReach): string {
  const registries = l10n.list(reach.registries);
  if (registries === '') {
    return NOTHING_LEFT_THIS_MACHINE;
  }
  return reach.beyondThisMachine
    ? l10n.t('Anyone resolving from {0} now sees it.', registries)
    : l10n.t('Nothing new was attached at {0}.', registries);
}

// publicationOutcome is the sentence a publication ends in.
//
// 🔴 EVERY FACT IN IT IS READ OFF THE ANSWER RATHER THAN OFF THE REQUEST. What
// the entity resolved to, what the tag points at or a dry run would have it point
// at, and how far the operation reached are all things the compiler measured; the
// entity the reader chose is named on the opening line instead, because that one
// is the request and this sentence is the result.
//
// All of it is strictly more than an exit status says: a publication, a
// re-publication of identical bytes, and a dry run all exit zero, so an exit
// status alone cannot tell a reader which of the three happened.
//
// Each shape of the first sentence is a whole message of its own; the reach
// follows it as a sentence of its own.
export function publicationOutcome(result: PublishEntityResult): OperationOutcome {
  if (result.dryRun) {
    return {
      kind: 'ok',
      detail: `${l10n.t('reported {0}:{1} ({2}) without publishing it.', result.reference, result.tag, result.digest)}`
        + ` ${NOTHING_LEFT_THIS_MACHINE}`,
    };
  }
  if (result.alreadyPublished) {
    // A re-publication uploads no content, so its reach is true exactly when it
    // attached a signature or a publication date the version lacked. signed says
    // whether it attached a signature; a reach that is true without one can only
    // be the date. A reach that is false attached nothing, and the reach phrase
    // says so.
    let found: string;
    if (result.signed) {
      found = l10n.t('found {0}:{1} already published as {2}, uploaded no content and attached a signature.', result.reference, result.tag, result.digest);
    } else if (result.reach.beyondThisMachine) {
      found = l10n.t('found {0}:{1} already published as {2}, uploaded no content and attached the publication date it lacked.', result.reference, result.tag, result.digest);
    } else {
      found = l10n.t('found {0}:{1} already published as {2}, uploaded no content.', result.reference, result.tag, result.digest);
    }
    return { kind: 'ok', detail: `${found} ${reachPhrase(result.reach)}` };
  }
  const published = result.signed
    ? l10n.t('published {0}:{1} as {2}, signed.', result.reference, result.tag, result.digest)
    : l10n.t('published {0}:{1} as {2}.', result.reference, result.tag, result.digest);
  return { kind: 'ok', detail: `${published} ${reachPhrase(result.reach)}` };
}

// signatureOutcome is the sentence a signing batch ends in.
//
// It counts what was signed rather than echoing what was asked for, so a batch
// is answered by what the compiler did. The zero case is a sentence rather than
// an absence: a batch that signed nothing is a result, and leaving it unsaid
// reads exactly like one that never ran.
export function signatureOutcome(result: SignArtifactsResult): OperationOutcome {
  const signed = signedArtifacts(result);
  if (signed.length === 0) {
    return { kind: 'ok', detail: `${l10n.t('signed nothing.')} ${NOTHING_LEFT_THIS_MACHINE}` };
  }
  // A batch reports a reference it found already signed among those it signed,
  // and its reach is false exactly when it attached nothing at all — so a false
  // reach means every reference listed already carried a signature that verifies.
  if (!result.reach.beyondThisMachine) {
    const found = signed.length === 1
      ? l10n.t('found {0} already signed, committing to {1}.', signed[0].reference, signed[0].digest)
      : l10n.t('found all {0} references already signed.', signed.length);
    return { kind: 'ok', detail: `${found} ${reachPhrase(result.reach)}` };
  }
  if (signed.length === 1) {
    const only = signed[0];
    return {
      kind: 'ok',
      detail: `${l10n.t('attached a signature to {0}, committing to {1}.', only.reference, only.digest)}`
        + ` ${reachPhrase(result.reach)}`,
    };
  }
  // Which of several references were signed before is not on the answer, so the
  // sentence counts the references rather than the signatures attached.
  return {
    kind: 'ok',
    detail: `${l10n.t('signed {0} references.', signed.length)} ${reachPhrase(result.reach)}`,
  };
}

// withdrawalOutcome is the sentence a withdrawal ends in.
//
// The severity is read off the marker the compiler attached rather than off the
// one the reader chose. They agree, and that is the point: the answer is what
// says the marker carries it, and reporting the request's value would state as
// done something nothing confirmed.
export function withdrawalOutcome(result: DeprecateArtifactResult): OperationOutcome {
  const marked = attachedMarkers(result);
  if (marked.length === 0) {
    return { kind: 'ok', detail: `${l10n.t('attached no marker.')} ${NOTHING_LEFT_THIS_MACHINE}` };
  }
  if (marked.length === 1) {
    const only = marked[0];
    return {
      kind: 'ok',
      detail: `${l10n.t('marked {0} deprecated at {1}, as {2}.', only.reference, only.severity, only.digest)}`
        + ` ${reachPhrase(result.reach)}`,
    };
  }
  return {
    kind: 'ok',
    detail: `${l10n.t('attached {0} markers.', marked.length)} ${reachPhrase(result.reach)}`,
  };
}

// --- running them ---------------------------------------------------------

// Each of the three returns its ending rather than announcing it, because the
// words a reader reads and the place they read them belong to the surface. What
// is decided here is how the operation ended and the lines the channel gets.
//
// A refusal is returned as it arrived. Nothing reached the channel, because
// nothing was answered, and the compiler's own text is the whole of what the
// reader gets — a publication refusal is exactly the message its author needs,
// and a friendlier wrapper would discard the remediation it names.

export async function runPublishEntity(
  deps: PublishEntityDeps,
  entityPath: string,
  signal?: CancellationSignal,
): Promise<PublicationReport> {
  let result: PublishEntityResult;
  try {
    result = await deps.publishEntity(publishEntityRequest(entityPath), signal);
  } catch (err) {
    return { outcome: outcomeOf(err), lines: [] };
  }
  return { outcome: publicationOutcome(result), lines: publicationLines(result) };
}

export async function runSignArtifacts(
  deps: SignArtifactsDeps,
  reference: string,
  signal?: CancellationSignal,
): Promise<PublicationReport> {
  let result: SignArtifactsResult;
  try {
    result = await deps.signArtifacts(signArtifactsRequest(reference), signal);
  } catch (err) {
    return { outcome: outcomeOf(err), lines: [] };
  }
  return { outcome: signatureOutcome(result), lines: signatureLines(result) };
}

export async function runDeprecateArtifact(
  deps: DeprecateArtifactDeps,
  reference: string,
  severity: string,
  reason: string,
  signal?: CancellationSignal,
): Promise<PublicationReport> {
  let result: DeprecateArtifactResult;
  try {
    result = await deps.deprecateArtifact(
      deprecateArtifactRequest(reference, severity, reason), signal,
    );
  } catch (err) {
    return { outcome: outcomeOf(err), lines: [] };
  }
  return { outcome: withdrawalOutcome(result), lines: withdrawalLines(result) };
}
