// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';
import { CancellationSignal } from './cancellation';
import * as l10n from './l10n';
import { couldNotBeReached, refusedAsNotReached } from './not-reached';
import { OperationOutcome, outcomeOf } from './operation-outcome';

// This module is the whole of what building the searchable index means on this
// side: what the request carries, what the answer carries, the lines the reader
// reads on the channel, and the sentence the operation ends in. It holds no
// editor type, so every one of those is read back by a test exactly as an author
// would meet it.
//
// It is deliberately separate from the module that changes the configured set of
// registries. That one registers, drops and forgets credentials — all writes to a
// configuration file, none of them reaching a registry, and none of them able to
// be stopped. This one is the only registry operation that goes out to the
// registries themselves, and it is the only one that takes the reader's stop. The
// two properties are what the reader's experience differs by, so they are stated
// where they hold rather than folded into one module whose head would then have
// to contradict itself.
//
// The compiler owns the work. Nothing here decides what an index build does,
// nothing here reaches a registry, and nothing here re-words what the compiler
// says about it: every closing sentence is composed from the answer's own fields,
// and a refusal travels through the extension's one rendering home with the
// compiler's text unaltered — named as a registry not reached, ahead of that text,
// only where the refusal's data says so.
//
// 🔴 THIS ONE CAN BE STOPPED, AND THAT IS READ OFF THE COMPILER RATHER THAN
// ASSUMED. The request's own context reaches the walk: it is observed ahead of
// each registry's walk and again ahead of writing that registry's index, and it
// is carried into every network call the walk makes — the repository enumeration,
// each conditional tag listing, each manifest resolve and each referrer read. So
// stopping this ends the walk rather than only ending this side's wait for an
// answer.
//
// 🔴 AND WHAT A STOP LEAVES BEHIND, STATED RATHER THAN GLOSSED: the registries
// already indexed have been written, so a withdrawn walk leaves a partial index
// rather than none, and the registry being walked when the stop lands keeps the
// index it had, because only a finished walk writes. That is the shared
// operation's own decision and it is the right one — an index is per-registry and
// a registry that was read is read — but it means a stop is not an undo, and a
// reader is owed that distinction.
//
// 🔴 NOTHING HERE IS ASKED OF A PERSON. Credentials resolve from a supplied or
// ambient source and are never prompted for: a registry needing one the machine
// does not carry is refused with the credential named.

// --- the request and answer shapes ---------------------------------------

// RegistryUpdateParams is what this client sends to build the searchable index.
//
// 🔴 IT IS ONE OPERATION WITH ONE SCOPE PARAMETER RATHER THAN TWO OPERATIONS, and
// that is the compiler's shape rather than a convenience taken here: an absent
// registry indexes every configured one, and naming a registry indexes only that
// one. The two entries a reader can press differ by this field and by nothing
// else, which is why they compose one request.
//
// The two scopes do differ in how a host-level failure is reported, and that is
// the compiler's decision too: a walk over every registry answers with the ones
// that failed named, while a walk over one named registry has no partial result
// to hand back and refuses outright. Both endings are composed below.
//
// The other field the operation accepts — a full re-read that ignores what is
// already cached — is not declared, because a declared field is a field a later
// call site will fill. Omitting it takes the conditional refresh, which is what a
// reader gets from a bare command line.
export type RegistryUpdateParams = Pick<wire.RegistryUpdateParams, 'registry'>;

// SkippedRepository is one repository the walk could not read, and why.
//
// A skip is reported rather than swallowed because one unreadable repository does
// not abandon the walk: the index that results is incomplete, and a reader acting
// on it needs to know which repositories are missing from it rather than reading a
// short answer as a complete one.
export type SkippedRepository = wire.SkippedRepo;

// DeprecationMet is one deprecation marker the walk met, and what it did with it.
//
// recorded distinguishes a marker whose own signature verified — and which the
// index therefore carries — from one that was present and not honoured. The two
// are reported on the same footing, because reporting only the failures would
// invert which outcome is audible: recording many markers would pass in silence
// while declining one would announce itself.
//
// reason carries the compiler's own account of why a marker was not recorded, so
// a reader is told which of the two ways it declined rather than only that it did.
export type DeprecationMet = wire.DeprecationNote;

// IndexedHost is what an index build did for one registry.
//
// deprecationsExamined says whether the walk looked for markers at all. It is
// separate from the count because "this registry published no honoured marker"
// and "this run had no trust basis to judge one" are different facts, and a
// reader shown only a zero cannot tell them apart.
//
// error carries a host-level failure in the compiler's own words, so a walk over
// several registries reports which of them failed without a reader having to
// correlate anything.
//
// 🔴 unreachable SAYS WHETHER THE REGISTRY WAS REACHED AT ALL, AND IT IS THE ONLY
// THING THAT SAYS SO. It stands beside error where the registry's name did not
// resolve, a connection to it was refused or could not be opened, or a secure
// connection could not be established, and is absent for a registry that
// answered, whatever it answered. The compiler decides it from the failure itself;
// the words of error are never read for it, because they differ by machine and by
// compiler version — a name the resolver completes with a search domain fails as a
// refused connection rather than as a name that does not exist.
export type IndexedHost = wire.HostUpdate;

// RegistryUpdateResult is the answer an index build produces.
//
// It is the reason this operation ends in something a reader can check rather
// than in an exit status: each host carries what its walk found, including the
// repositories it could not read and the markers it met, and indexRoot names the
// directory the indexes were written under.
//
// 🔴 indexRoot IS WHAT SAYS THE SCOPE OF THE WRITE, and it is the fact this
// operation is most likely to be misread without. A registration defaults to the
// machine-wide configuration file, so a reader who has just registered a registry
// has reason to expect this to reach that far as well — and it does not: the index
// is written inside this workspace's own configured cache directory, so a refresh
// changes nothing any other project on the machine resolves through.
//
// registriesConfigured distinguishes "nothing is configured" from "every
// configured registry was indexed and none held anything", which are different
// answers to a reader deciding what to do next.
export type RegistryUpdateResult = wire.RegistryUpdateResult;

// RegistryIndexDeps is the one thing an index build needs: a way to ask the
// compiler, carrying the reader's stop.
//
// It is declared this narrowly so the surface that owns the tree passes its own
// richer dependency set here unchanged, and so a test drives the whole decision
// with a fake answer and no transport at all.
export interface RegistryIndexDeps {
  updateRegistryIndex(
    params: RegistryUpdateParams,
    signal?: CancellationSignal,
  ): Promise<RegistryUpdateResult>;
}

// RegistryIndexReport is what one index build leaves behind: how it ended, and
// the lines the channel gets.
export interface RegistryIndexReport {
  outcome: OperationOutcome;
  lines: readonly string[];
}

// --- what the reader reads -----------------------------------------------

// INDEX_BUILD_SUBJECT is the operation in the reader's terms, used for the
// sentence every ending produces. One spelling, so a completion and a failure
// name the same thing, and the same spelling whichever scope was pressed.
export const INDEX_BUILD_SUBJECT = l10n.t('The index build');

// indexBuildOpeningLine is what the channel says an index build is about to do.
//
// It names the scope the reader chose, which is the one fact the answer does not
// carry back: an answer over one registry and an answer over a single configured
// registry are indistinguishable, and a reader scrolling this channel needs to
// know which they pressed. The leading blank line separates this run from the
// last, the way every operation that writes here does.
export function indexBuildOpeningLine(registry?: string): string {
  return registry
    ? `\n${l10n.t('Index build for {0}.', registry)}`
    : `\n${l10n.t('Index build for every configured registry.')}`;
}

// --- composing the request -----------------------------------------------

// indexBuildRequest composes an index build at the scope the reader chose.
//
// 🔴 IT IS ONE COMPOSER FOR ONE OPERATION, AND THAT IS THE COMPILER'S SHAPE
// RATHER THAN A SAVING TAKEN HERE. The whole-set walk and the one-registry walk
// differ by this single field, so two composers would re-split what the request
// surface joined — and the pair would then have to be kept agreeing about
// everything they share.
//
// The host is passed through verbatim: the compiler accepts the host or a
// friendly alias and resolves whichever it was handed, so a translation here
// would be a second answer to what names a registry.
//
// 🔴 A PRESENT-BUT-BLANK SCOPE IS REFUSED RATHER THAN SENT, and the distinction
// from an absent one is the whole reason this guard exists. An absent registry is
// a legitimate request meaning every configured one; a blank string is a row that
// named nothing, and sending it would index every registry when the reader
// pressed one row. The two would otherwise be indistinguishable on the wire.
export function indexBuildRequest(registry?: string): RegistryUpdateParams {
  if (registry === undefined) {
    return {};
  }
  const trimmed = registry.trim();
  if (trimmed === '') {
    throw new Error(l10n.t('an index build for one registry takes that registry, and none was named'));
  }
  return { registry: trimmed };
}

// --- what one run puts on the channel ------------------------------------

// skippedLine renders one unreadable repository, with the compiler's own reason
// unaltered.
export function skippedLine(skipped: SkippedRepository): string {
  return `    ${l10n.t('skipped {0}: {1}', skipped.repo, skipped.reason)}`;
}

// deprecationLine renders one marker the walk met.
//
// A recorded marker names the severity the index now carries; one that was not
// recorded names the compiler's own reason, which is what distinguishes a marker
// that could not be read from one whose signature was not honoured. Reporting
// only that it was not recorded would collapse two different situations a reader
// acts on differently.
//
// The severity and the reason are the compiler's own words and fill their
// placeholders untranslated; a marker carrying no severity is recorded as
// deprecated, in a message of its own.
export function deprecationLine(met: DeprecationMet): string {
  if (met.recorded) {
    const severity = met.severity ?? null;
    return `    ${severity !== null
      ? l10n.t('deprecation {0}:{1}: recorded as {2}', met.repo, met.version, severity)
      : l10n.t('deprecation {0}:{1}: recorded as deprecated', met.repo, met.version)}`;
  }
  return `    ${met.reason
    ? l10n.t('deprecation {0}:{1}: present, not recorded — {2}', met.repo, met.version, met.reason)
    : l10n.t('deprecation {0}:{1}: present, not recorded', met.repo, met.version)}`;
}

// hostLines is everything one registry's walk puts on the channel.
//
// A failed host reports the compiler's own error and nothing else: there is no
// walk to describe, and a count of zero beside it would read as a registry that
// held nothing. A host the answer says could not be reached is named as such
// ahead of those words; any other failure — a registry that answered, and whose
// answer could not be indexed — is named by the compiler's words alone.
//
// The headline lists what the walk found after the registry's name, each item a
// piece standing on its own between commas, and the list itself is a message of
// its own, so a translation joins the items as its language does.
export function hostLines(host: IndexedHost): readonly string[] {
  if (host.error) {
    return host.unreachable === true
      ? [`  ${couldNotBeReached(host.host, host.error)}`]
      : [`  ${host.host}: ${host.error}`];
  }
  const lines: string[] = [];
  // Every collection in this answer reaches the wire as null when it is empty,
  // which says the same thing an empty list does.
  const skipped = host.skipped ?? [];
  const entities = host.indexed === 1 ? l10n.t('1 entity') : l10n.t('{0} entities', host.indexed);
  // The reads asked again are stated on every row, zero included: a walk whose
  // retries all succeeded lists no repository above, so this count is the only
  // sign of how close it came to leaving one out.
  const retried = host.readsRetried === 1
    ? l10n.t('1 read retried')
    : l10n.t('{0} reads retried', host.readsRetried);
  if (skipped.length > 0) {
    const unread = skipped.length === 1
      ? l10n.t('1 repository could not be read')
      : l10n.t('{0} repositories could not be read', skipped.length);
    lines.push(`  ${l10n.t('{0}: {1}, {2}, {3}', host.host, entities, unread, retried)}`);
  } else {
    lines.push(`  ${l10n.t('{0}: {1}, {2}', host.host, entities, retried)}`);
  }
  // The markers line says which of two things happened rather than showing a
  // count that could mean either: a run with no trust basis did not look, and a
  // run that looked and found nothing is a different answer.
  if (host.deprecationsExamined) {
    lines.push(`    ${host.deprecationsRecorded === 1
      ? l10n.t('1 deprecation marker recorded')
      : l10n.t('{0} deprecation markers recorded', host.deprecationsRecorded)}`);
  } else {
    lines.push(`    ${l10n.t('deprecation markers not examined: signature verification is disabled for this registry')}`);
  }
  for (const one of skipped) {
    lines.push(skippedLine(one));
  }
  for (const met of host.deprecations ?? []) {
    lines.push(deprecationLine(met));
  }
  return lines;
}

// indexBuildLines is everything one index build puts on the channel: what each
// registry's walk found, then where the index was written.
//
// 🔴 THESE ARE COMPOSED FROM THE ANSWER'S FACTS RATHER THAN FROM A STREAM, AND
// THE ANSWER CARRIES MORE OF THEM THAN THE STREAM DID. The walk writes a running
// commentary for a person watching a terminal, and every fact in it travels
// structurally instead — which registry indexed how many entities, which
// repositories could not be read and why, which markers were met and what became
// of each, and whether markers were examined at all. What changes is that the
// account arrives complete at the end rather than line by line, and that the
// per-registry outcome is now gathered rather than spread across a scroll.
//
// The destination is named only when a registry was actually indexed. The index
// directory is resolved once there is a registry to walk, so naming it after a
// walk that indexed nothing would name a directory nothing was written to.
export function indexBuildLines(result: RegistryUpdateResult): readonly string[] {
  if (!result.registriesConfigured) {
    return [`  ${l10n.t('no registries are configured')}`];
  }
  const lines: string[] = [];
  const hosts = result.hosts ?? [];
  for (const host of hosts) {
    lines.push(...hostLines(host));
  }
  if (result.indexRoot !== '' && hosts.some((host) => !host.error)) {
    lines.push(`  ${l10n.t('index written to {0}', result.indexRoot)}`);
  }
  return lines;
}

// --- how it ends ---------------------------------------------------------

// indexedEntities totals what the walk recorded across the registries it indexed.
//
// It is summed from the per-host answers rather than read from a total the answer
// does not carry, and the hosts that failed contribute nothing — a failed host
// indexed nothing, and its zero is already implied by its being named as failed.
function indexedEntities(hosts: readonly IndexedHost[]): number {
  return hosts.reduce((total, host) => total + (host.error ? 0 : host.indexed), 0);
}

// missedPhrase names the registries a walk missed, those not reached ahead of
// those not indexed; the second group drops its noun where the first has named
// it already. At least one of the two holds a registry.
//
// A group standing alone is one message, its count and its noun together. Both
// groups together are one whole message per count of each, because the second
// group's clause leans on the first group's noun and cannot stand apart from it.
function missedPhrase(notReached: readonly string[], notIndexed: readonly string[]): string {
  const reached = l10n.series(notReached);
  const listed = l10n.series(notIndexed);
  if (notIndexed.length === 0) {
    if (notReached.length === 0) { return ''; }
    return notReached.length === 1
      ? l10n.t('1 registry could not be reached ({0})', reached)
      : l10n.t('{0} registries could not be reached ({1})', notReached.length, reached);
  }
  if (notReached.length === 0) {
    return notIndexed.length === 1
      ? l10n.t('1 registry could not be indexed ({0})', listed)
      : l10n.t('{0} registries could not be indexed ({1})', notIndexed.length, listed);
  }
  if (notReached.length === 1) {
    return notIndexed.length === 1
      ? l10n.t('1 registry could not be reached ({0}) and 1 could not be indexed ({1})', reached, listed)
      : l10n.t('1 registry could not be reached ({0}) and {1} could not be indexed ({2})', reached, notIndexed.length, listed);
  }
  return notIndexed.length === 1
    ? l10n.t('{0} registries could not be reached ({1}) and 1 could not be indexed ({2})', notReached.length, reached, listed)
    : l10n.t('{0} registries could not be reached ({1}) and {2} could not be indexed ({3})', notReached.length, reached, notIndexed.length, listed);
}

// indexedFrom says how many entities a walk that missed some registries indexed
// from the ones it did walk, each count with its noun in one whole message.
function indexedFrom(entityCount: number, registryCount: number): string {
  if (entityCount === 1) {
    return registryCount === 1
      ? l10n.t('1 entity was indexed from 1 registry')
      : l10n.t('1 entity was indexed from {0} registries', registryCount);
  }
  return registryCount === 1
    ? l10n.t('{0} entities were indexed from 1 registry', entityCount)
    : l10n.t('{0} entities were indexed from {1} registries', entityCount, registryCount);
}

// indexedInto is the ending of a walk that indexed every registry it was asked
// for, each count with its noun in one whole message.
function indexedInto(entityCount: number, registryCount: number, indexRoot: string): string {
  if (entityCount === 1) {
    return registryCount === 1
      ? l10n.t('indexed 1 entity from 1 registry, into {0}.', indexRoot)
      : l10n.t('indexed 1 entity from {0} registries, into {1}.', registryCount, indexRoot);
  }
  return registryCount === 1
    ? l10n.t('indexed {0} entities from 1 registry, into {1}.', entityCount, indexRoot)
    : l10n.t('indexed {0} entities from {1} registries, into {2}.', entityCount, registryCount, indexRoot);
}

// indexBuildOutcome is the sentence an index build ends in.
//
// 🔴 EVERY FACT IN IT IS READ OFF THE ANSWER RATHER THAN OFF THE REQUEST, and the
// partial walk is the case that makes the difference visible. A walk that indexed
// some registries and not others is reported as an operation that did not
// complete, naming which registries were missed — which is what the command line
// reports for the same walk, as a non-zero exit, because a shell has no other
// channel. Reporting it as done would tell a reader their index is current when
// part of it is not.
//
// The registries it missed are named in two groups, each in parentheses, in the
// order the answer lists them: the ones the answer says could not be reached
// first, then every other failure as a registry that could not be indexed — "1
// registry could not be reached (a) and 1 could not be indexed (b)". A group with
// no member is not mentioned.
//
// The zero case is a sentence rather than an absence: a workspace with no
// configured registry is a result, and leaving it unsaid reads exactly like an
// entry that does nothing when pressed.
export function indexBuildOutcome(result: RegistryUpdateResult): OperationOutcome {
  if (!result.registriesConfigured) {
    return {
      kind: 'ok',
      detail: l10n.t('found no configured registries, so there was nothing to index.'),
    };
  }
  const hosts = result.hosts ?? [];
  const walked = hosts.filter((host) => !host.error);
  const failed = hosts.filter((host) => host.error);
  const notReached = failed.filter((host) => host.unreachable === true).map((host) => host.host);
  const notIndexed = failed.filter((host) => host.unreachable !== true).map((host) => host.host);
  const entityCount = indexedEntities(hosts);
  if (failed.length > 0) {
    const indexed = walked.length === 0
      ? l10n.t('nothing was indexed')
      : indexedFrom(entityCount, walked.length);
    return {
      kind: 'failed',
      message: l10n.t('{0}; {1}.', missedPhrase(notReached, notIndexed), indexed),
    };
  }
  return {
    kind: 'ok',
    detail: indexedInto(entityCount, walked.length, result.indexRoot),
  };
}

// --- running it ----------------------------------------------------------

// runIndexBuild asks the compiler to build the searchable index and reports how
// it ended.
//
// It returns the ending rather than announcing it, because the words a reader
// reads and the place they read them belong to the surface.
//
// registry is the scope the reader chose: absent for every configured registry,
// a host or alias for one. The two entries a reader can press differ by that one
// value and share every word after it.
//
// The request is composed INSIDE the attempt rather than by the caller, so a
// scope this surface refuses is reported through the same ending as a scope the
// compiler refuses. Composing it outside would leave one of the two refusals
// escaping the command handler with nothing to render it.
//
// A refusal is returned as it arrived: the compiler's own text is the whole of
// what the reader gets — what says the token matched nothing, or why the walk of
// the one registry failed. Where the refusal's data says the registry the request
// named could not be reached, the ending names that registry as not reached ahead
// of the same text; it is the registry as the request named it, since the
// refusal's data says only that it was not reached.
export async function runIndexBuild(
  deps: RegistryIndexDeps,
  registry?: string,
  signal?: CancellationSignal,
): Promise<RegistryIndexReport> {
  let result: RegistryUpdateResult;
  let named: string | undefined;
  try {
    const request = indexBuildRequest(registry);
    named = request.registry;
    result = await deps.updateRegistryIndex(request, signal);
  } catch (err) {
    const outcome = outcomeOf(err);
    if (outcome.kind === 'failed' && named !== undefined && refusedAsNotReached(err)) {
      return { outcome: { kind: 'failed', message: couldNotBeReached(named, outcome.message) }, lines: [] };
    }
    return { outcome, lines: [] };
  }
  return { outcome: indexBuildOutcome(result), lines: indexBuildLines(result) };
}
