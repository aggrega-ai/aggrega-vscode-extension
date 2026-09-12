// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { CancellationSignal } from './cancellation';
import { ConfigWriteScope, reachPhrase } from './config-write-scope';
import { OperationOutcome, outcomeOf } from './operation-outcome';
import { withSubject } from './operation-groups';
import { PLUGIN_TYPE_GOVERNANCE, PLUGIN_TYPE_PROVIDER, PluginAttachment } from './plugins-run';

// This module is the whole of what attaching a plugin means on this side: what
// the request carries, what the answer carries, and the sentence the reader is
// left with. It holds no editor type, so each of those is read back by a test
// exactly as an author would meet it.
//
// The compiler owns the work. Nothing here decides what an attachment does,
// nothing here reaches the registry, and nothing here re-words what the compiler
// says about it: the closing sentence is composed from the answer's own fields,
// and a refusal travels through the extension's one rendering home with the
// compiler's text intact — including the one that says a search term matched
// several plugins and lists them, which is the refusal a reader is most likely to
// meet.
//
// 🔴 THIS ONE CAN BE STOPPED, AND THAT IS READ OFF THE COMPILER RATHER THAN
// ASSUMED. A stop is offered exactly where the compiler can honour one. Here it
// can: the request's own context reaches the registry enumeration that resolves
// the search term, and on to the registry client's own listing call — so stopping
// this ends the search rather than only ending the wait for an answer. That is
// what separates it from the operations beside it on this panel, whose shared work
// takes no cancellation at all and which therefore offer no stop.
//
// 🔴 AND THE RETRACTION ADVISORY REACHES THE READER IN THE ENDING, WHICH IS WHY
// IT IS BUILT THIS WAY. When a published version of a plugin has been withdrawn,
// the compiler skips it, pins another one down, and says which and why. A
// retraction is a withdrawal, frequently for a safety reason, so that is the one
// thing a reader cannot afford to miss — and a reader handed an older version than
// the newest published one, with nothing said about it, has been denied exactly
// that. So the answer carries the screen's conclusion as values and the sentence
// below states it where the reader is already looking, rather than somewhere they
// would have to go and open.
//
// What is composed here is the wording alone. Which versions were withdrawn, the
// reason recorded against each, which version was pinned instead, and where the
// withdrawal records were read from are all the compiler's own, carried across
// unchanged — so this surface can say it in the words its reader is reading
// without being able to disagree about the facts.

// ATTACHMENT_SUBJECT is the operation in the reader's terms, used for the
// sentence every ending produces. One spelling, so a completion and a failure
// name the same thing.
export const ATTACHMENT_SUBJECT = 'The attachment';

// attachmentProgressTitle is what the indicator reads while the work runs.
//
// It names searching rather than attaching, because searching is what the wait
// is: resolving the term to exactly one plugin is the part that reaches the
// registry, and the write that follows is local. It names the type too, since a
// reader who chose one is watching for that one.
export function attachmentProgressTitle(type: string): string {
  return `Aggrega: searching the registry for a ${type} plugin`;
}

// --- the request and answer shapes ---------------------------------------

// PluginAddParams is what this client sends to attach a plugin.
//
// 🔴 IT CARRIES THE TYPE, THE SEARCH TERM AND THE ONE ANSWER SOME TYPES REQUIRE,
// AND THE ABSENCE OF THE REST IS THE CONTRACT RATHER THAN AN OMISSION. The
// operation also accepts the two write-target overrides that force which
// configuration file the attachment lands in, and a field carrying the
// capability decision a command-extension install needs. None of the three is
// declared here, because a declared field is a field a later call site will fill.
//
// Sending no override takes the operation's own default, which is the default a
// reader gets from the command line. Every type this surface offers is scoped to
// one project's build rather than to the machine, so that default is this
// project's own configuration file — which is what the question asking for a
// search term already tells the reader it will write to.
//
// 🔴 THE CAPABILITY FIELD IS NOT MERELY UNNEEDED HERE, IT IS UNSENDABLE. The
// decision it carries belongs to the command-extension type, which this surface
// does not offer; the shared operation refuses that field outright on every other
// type, naming it as applying to that one type alone. So sending it would not
// grant a consent nobody gave — it would halt the attachment.
export interface PluginAddParams {
  type: string;
  query: string;
  // capability is the capability a provider binding serves. The provider type
  // requires it and no other type accepts it, so it is present on exactly those
  // requests rather than sent empty.
  capability?: string;
  // role is the pipeline role a governance attachment is bound at, on the same
  // present-or-absent terms as the capability above.
  role?: string;
}

// PluginAddResult is the answer an attachment produces.
//
// It is the reason this operation ends in something a reader can check rather
// than in a status: which plugin the search actually resolved to, what it was
// bound as, and the file the attachment was written to together with how far that
// file reaches. Every field is read from the answer; none is assumed.
//
// Which field is filled says what kind of attachment landed, so the ending is
// chosen from the answer rather than re-derived from the type that was sent: a
// config socket carries the version-pinned entity identity, and a provider
// binding carries the plugin's artifact identity and the capability it now
// serves. The third field the wire declares, reference, is filled only by the
// command-extension install this surface does not offer — it is declared so the
// shape driven here is the shape the wire has, and read by nothing.
export interface PluginAddResult {
  type: string;
  identity?: string;
  uri?: string;
  capability?: string;
  reference?: string;
  scope: ConfigWriteScope;
  // written and content are the answer's two halves of one choice: whether the
  // compiler put the configuration on disk or handed it back instead. A write
  // leaves content empty, because the file is already at the path scope names; a
  // report leaves written false and returns the document in content. The two are
  // never both meaningful.
  //
  // This surface composes no such choice, so every attachment it sends writes and
  // both fields say the same thing on every answer it reads. They are declared so
  // the shape driven here is the shape the wire has, and read by nothing.
  written: boolean;
  content?: string;
  // retraction is what the compiler's withdrawal screen concluded about the
  // version that was pinned, and is absent whenever it concluded nothing — which
  // is every ordinary attachment. It is optional for that reason rather than
  // because a client may ignore it.
  retraction?: PluginRetraction;
}

// PluginRetractionExclusion is one published version the compiler withdrew from
// selection, with the reason recorded against it. The reason is optional because a
// withdrawal record is not required to carry prose, so an absent one means none was
// recorded rather than that this side failed to read it.
export interface PluginRetractionExclusion {
  version: string;
  reason?: string;
}

// PluginRetractionProvenance says where the compiler's withdrawal screen got its
// facts and how current they are.
//
// source is the screen's own spelling for where it read them, carried across
// unchanged. Naming it in words of this surface's own would let the two come to
// call one source by two names, and a reader comparing them would have no way to
// tell that is what happened.
//
// lastUpdated is when the snapshot behind those facts was taken. It is absent
// whenever there is no such time to report — facts read while the attachment ran
// have none, and a snapshot may carry no build time — so an absent one is not a
// stale one, and the sentence composed from it says nothing about currency rather
// than guessing at it.
export interface PluginRetractionProvenance {
  source: string;
  lastUpdated?: string;
}

// PluginRetraction is the compiler's conclusion about the version an attachment
// pinned.
//
// 🔴 THE TWO CONDITIONS IT CARRIES SAY OPPOSITE THINGS AND MUST NOT BE COLLAPSED.
// excluded is "you are being told something": the screen ran, withdrew the versions
// named, and the attachment pinned selected instead. unscreened is "you did not get
// something": the withdrawal records could not be read at all, so nothing was
// screened and nothing is being claimed about whether the pinned version has since
// been withdrawn. Reading an empty excluded as "nothing was withdrawn" without
// looking at unscreened first is the mistake that turns the second case silent,
// which is the exact silence this field exists to end.
export interface PluginRetraction {
  reference: string;
  selected?: string;
  excluded?: PluginRetractionExclusion[];
  unscreened?: string;
  // provenance qualifies whichever of those two conditions arrived, and is absent
  // when selection ran with no screen at all — where nothing was consulted there
  // is no source to report. A reader acting on a withdrawal needs it: facts read
  // while the attachment ran speak to now, while a snapshot can be older than the
  // withdrawal it is being asked about, and only the second leaves the reader
  // anything to do about the gap.
  provenance?: PluginRetractionProvenance;
}

// PluginAttachmentDeps is the one thing an attachment needs: a way to ask the
// compiler, carrying the reader's stop.
//
// It is declared this narrowly so the surface that owns the panel passes its own
// richer dependency set here unchanged, and so a test drives the whole decision
// with a fake answer and no transport at all.
export interface PluginAttachmentDeps {
  addPlugin(params: PluginAddParams, signal?: CancellationSignal): Promise<PluginAddResult>;
}

// --- composing the request -----------------------------------------------

// attachmentRequest composes the attachment of one plugin.
//
// The two type-conditional answers are required or refused rather than merely
// passed along, because the shared operation treats each the same way: absent
// where it is required, and present where it is not, are both refused. Composing
// either shape would build a request that cannot succeed, and refusing it here
// means the reader is told what the operation needed instead of waiting for a
// round trip to say so.
//
// The type and the search term are the product's own strings, passed through
// verbatim. A translation between the two surfaces would be a second copy of a
// vocabulary that belongs to the compiler, and it would agree with the compiler
// only until the day one of them changed.
//
// The blank guard is REACHED rather than restated. It is the extension's one home
// for refusing an operation with nothing to act on, and a second blank check
// written here would agree with it until the day one of the two was changed. It
// is a second guard rather than the only one — the questions that collect these
// answers invoke nothing when any of them is dismissed — and it is the one that
// holds if a later binding is written more loosely.
export function attachmentRequest(attachment: PluginAttachment): PluginAddParams {
  const [, type] = withSubject('plugin add', attachment.type, "the plugin's type");
  const [, query] = withSubject(
    'plugin add',
    attachment.query,
    'a name to search the registry for',
  );

  const capability = (attachment.capability ?? '').trim();
  const role = (attachment.role ?? '').trim();
  if (type === PLUGIN_TYPE_PROVIDER && capability === '') {
    throw new Error(
      'aggrega plugin add: the provider type takes the capability the binding serves, and none was given',
    );
  }
  if (type !== PLUGIN_TYPE_PROVIDER && capability !== '') {
    throw new Error('aggrega plugin add: a capability applies only to the provider type');
  }
  if (type === PLUGIN_TYPE_GOVERNANCE && role === '') {
    throw new Error(
      'aggrega plugin add: the governance type takes the role the attachment is bound at, and none was given',
    );
  }
  if (type !== PLUGIN_TYPE_GOVERNANCE && role !== '') {
    throw new Error('aggrega plugin add: a role applies only to the governance type');
  }

  const params: PluginAddParams = { type, query };
  if (capability !== '') { params.capability = capability; }
  if (role !== '') { params.role = role; }
  return params;
}

// --- running it ----------------------------------------------------------

// runPluginAttachment asks the compiler to resolve the search term to one plugin
// and attach it, and reports how it ended.
//
// It returns the ending rather than announcing it, because the words a reader
// reads and the place they read them belong to the surface. What is decided here
// is whether the attachment completed and, if it did, the sentence naming what
// was actually attached and where.
//
// 🔴 IT TAKES A STOP, AND THAT IS THE POINT RATHER THAN A CONVENIENCE. The signal
// reaches the compiler as the cancellation of the request this call was sent as,
// and that request's context is what the registry enumeration runs under — so a
// reader who stops this stops the search. The operations beside it take none, for
// the opposite reason read off their own handlers.
export async function runPluginAttachment(
  deps: PluginAttachmentDeps,
  attachment: PluginAttachment,
  signal?: CancellationSignal,
): Promise<OperationOutcome> {
  try {
    const result = await deps.addPlugin(attachmentRequest(attachment), signal);
    return { kind: 'ok', detail: attachmentDetail(result) };
  } catch (err) {
    return outcomeOf(err);
  }
}

// article picks the indefinite article for a plugin type.
//
// It is read off the type's first letter rather than chosen from a list of the
// types this surface offers, and the reason is that the type is a value the
// compiler owns: the set grows, and a sentence spelled for today's four would
// read wrongly for the first vowel-initial type added after it. Of the four
// offered now, exactly one begins with a vowel — which is what makes a fixed
// article read correctly almost everywhere and wrongly in one place.
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

// attachmentDetail is the sentence a completed attachment ends in.
//
// It is composed from the answer's own fields, so the reader is told which plugin
// the search resolved to and where the entry landed rather than that something
// finished. Each of the two shapes uses the words the command line uses for the
// same fact, so a reader who has seen one surface's account of an attachment
// recognises the other's — plus how far the written file reaches, which the
// command line names the path for and leaves the reader to judge.
//
// The last branch is reached by an answer that filled neither identity nor
// artifact identity, which no type this surface offers produces. It says what is
// certain rather than naming a field that is not there: a sentence built from an
// absent value would read as a plugin called undefined.
export function attachmentDetail(result: PluginAddResult): string {
  const where = `${result.scope.configFile}, ${reachPhrase(result.scope)}.`;
  const note = retractionNote(result.retraction);
  if (result.uri) {
    return `bound capability ${result.capability} to ${result.uri} in ${where}${note}`;
  }
  if (result.identity) {
    return `added ${result.identity} as ${article(result.type)} ${result.type} plugin in ${where}${note}`;
  }
  return `added ${article(result.type)} ${result.type} plugin in ${where}${note}`;
}

// retractionNote states what the compiler's withdrawal screen concluded, or
// nothing when it concluded nothing.
//
// It is appended to the ending the reader already reads rather than offered
// behind a button, because a withdrawal is frequently a safety matter and a
// reader who has to go and look is a reader who will not. The empty string for an
// absent conclusion is what lets the ending stay one sentence on every ordinary
// attachment.
//
// Every value in it is the compiler's own, rendered verbatim: the versions, the
// reasons recorded against them, the fault a failed screening read reported, and
// the source those records came from. What this composes is the sentence around
// them, which is this surface's own because the reader is reading this surface —
// and composing it from the values rather than re-stating the compiler's line is
// what keeps the two from drifting into disagreement about the facts.
//
// 🔴 THE SOURCE CLAUSE QUALIFIES BOTH CONDITIONS, AND WIRING IT INTO ONE WOULD
// LEAVE THE WORSE CASE UNQUALIFIED. A reader told that the screen could not run
// still needs to know which records it could not read, because that is what says
// whether the gap is one they can close. So it is composed once and appended to
// whichever condition spoke.
export function retractionNote(retraction?: PluginRetraction): string {
  if (!retraction) {
    return '';
  }
  const source = provenanceNote(retraction.provenance);
  // The unscreened case is answered first and on its own, because it is the one
  // that would otherwise pass as silence: it carries no exclusions by definition,
  // so a check that looked at those first would find none and say nothing at all —
  // which reads exactly like an attachment that screened cleanly.
  if (retraction.unscreened) {
    return ` Published versions were not screened for retraction: ${retraction.unscreened}.${source}`;
  }
  const excluded = retraction.excluded ?? [];
  if (excluded.length === 0) {
    return '';
  }
  const named = excluded
    .map((x) => (x.reason ? `${x.version} (${x.reason})` : x.version))
    .join(', ');
  return ` Retracted and not selected: ${named}.${source}`;
}

// provenanceNote names where the withdrawal records came from, and when they were
// last refreshed where there is such a time.
//
// It says where rather than how good, because how current a source is is a
// judgement about the source and this surface has no grounds for one: what it can
// tell the reader is the two facts the compiler measured, in the compiler's own
// spelling of each.
//
// An absent time is left unsaid rather than described. It means there is no such
// time to report — facts read while the attachment ran have none — so a phrase
// standing in for it would report an uncertainty the compiler never claimed, and
// a reader would weigh it as though it had.
function provenanceNote(provenance?: PluginRetractionProvenance): string {
  if (!provenance) {
    return '';
  }
  if (provenance.lastUpdated) {
    return ` Withdrawal records from ${provenance.source}, last updated ${provenance.lastUpdated}.`;
  }
  return ` Withdrawal records from ${provenance.source}.`;
}
