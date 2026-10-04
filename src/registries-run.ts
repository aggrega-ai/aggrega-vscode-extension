// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';
import { describeError } from './error-surfaces';
import type { PanelActionPress } from './panel-actions';
import { NO_ANCHORED_WORKSPACE_TREE_LABEL } from './workspace';
import { serverStoppedNode } from './workspace-catalog-run';

// The compiler owns the enumeration and this module owns what it looks like.
// Nothing here resolves configuration, merges files or decides an order: every
// row is shaped from fields the answer carried, and a refusal is rendered as the
// compiler's own text.
//
// 🔴 NOTHING HERE CAN BE STOPPED, AND THE ABSENCE OF A STOP IS THE DECISION. The
// shared operation behind the request takes no cancellation — nothing is passed
// to it that could carry one — so a stop offered here could only ever stop the
// editor waiting, never the work, and presenting that as a stop would break the
// rule that stopping means the compiler stopped. The enumeration reads the
// resolved configuration and contacts no registry, so its work is bounded by
// local computation and there is nothing a reader would want to interrupt. No
// signal is accepted anywhere in this module.

// --- the aggrega/registryList answer, as the compiler publishes it --------

// RegistryTrust is the registry's trust posture as discrete fields. The
// structured output carries the posture this way deliberately, in place of the
// sentence the table renders, so a consumer reads a value rather than parsing
// prose.
export type RegistryTrust = wire.RegistryTrust;

// RegistryEntry is one configured registry.
//
// host is the IDENTITY. name is an optional friendly alias that resolves to the
// host wherever a registry is named; an entry without one omits the key rather
// than carrying an empty string, so a missing alias is an ordinary state and not
// a blank to render.
//
// authState reports credential PRESENCE ONLY. It says whether a credential for
// this host exists in the shared credential store — nothing about the credential
// itself, and nothing about whether the registry would accept it, which cannot
// be known without contacting the registry.
export type RegistryEntry = wire.Registry;

// RegistryListDoc is the top level of the answer.
//
// The answer also states that the credential state it reports is a machine-wide
// fact rather than a property of this workspace. Nothing here reads it: naming
// the reach of a credential to a reader is a decision about what these rows say.
export type RegistryListDoc = wire.RegistryListResult;

// --- row shaping ---------------------------------------------------------

// AUTH_STATE_PRESENT and AUTH_STATE_ABSENT are the credential states observed
// from the product. The set is treated as OPEN: the credential store
// honors a configured credential helper, so a third state is plausible, and one
// is rendered as itself rather than folded into either of these. Folding an
// unknown state into the absent one would tell a reader there is no credential
// when the product never said so.
const AUTH_STATE_PRESENT = 'configured';
const AUTH_STATE_ABSENT = 'none';

// EMPTY_LABEL is the product's own sentence for a configuration that names no
// registry. Reusing it keeps the view and the command saying the same thing
// about the same state, and an empty result is a successful answer rather than a
// failure — which is why it gets a row of its own.
export const EMPTY_LABEL = 'No registries configured.';

// FAILURE_LABEL points at the channel that carries the product's own message
// verbatim, for a listing the language server was asked for and could not
// produce. The row stays one short line because a tree row is not a place to
// render a compiler diagnostic; the full text reaches the reader through the
// channel and this row's detail. A language server that is not running is not
// such a failure, and draws the Catalog panel's row for that state instead.
export const FAILURE_LABEL = 'registry list failed — see the Aggrega output channel.';

// DEFAULT_ICON and ENTRY_ICON are the editor's own theme-icon ids, so the tree
// follows the reader's theme rather than shipping bitmaps. The default registry
// is additionally marked in the description and the tooltip, so no fact lives
// only in an icon.
const DEFAULT_ICON = 'star-full';
const ENTRY_ICON = 'cloud';

// RegistryRow is one registry rendered for display, with every string already
// decided. Shaping it here — free of editor types — is what makes the rendering
// assertable without an extension host: a test reads back exactly the line an
// author would see.
export interface RegistryRow {
  // host is the registry's identity, and it is the value every operation on
  // this row is invoked with. It is carried as its own field rather than read
  // back off the label: the label is a display string, and a later change to
  // what a row reads would silently change what its operations act on.
  host: string;
  // label is the host, because the host is the registry's identity.
  label: string;
  // description is the dimmed secondary line: the alias when there is one, the
  // default marker when the product set it, and the trust and credential states
  // when it reported them. Segments the product did not report are absent
  // rather than blank.
  description: string;
  // tooltip repeats the same facts one per line, so a reader who needs them
  // unambiguously gets them named rather than positional.
  tooltip: string;
  // icon is a theme-icon id.
  icon: string;
}

// RegistryNode is what the tree renders: either a registry or a single line
// explaining why there is none. The no-registry states — nothing anchored, no
// language server, nothing configured, and the enumeration failing — are
// distinct messages on purpose. An empty catalog of registries and a failed
// enumeration must never look identical, because one means "you have configured
// none" and the other means "we do not know"; and a server that is not running
// is neither, since nothing was asked.
export type RegistryNode =
  | { kind: 'entry'; row: RegistryRow }
  | { kind: 'message'; label: string; detail?: string; press?: PanelActionPress };

// describeAuthState renders the credential-presence state.
//
// The two known states get a plain reading. Anything else is rendered as
// ITSELF, prefixed so a reader can see it is a state this view has no phrase
// for, and an absent state produces nothing at all — the product said nothing,
// so the view says nothing.
export function describeAuthState(authState: string | undefined): string | null {
  if (authState === undefined || authState === '') {
    return null;
  }
  if (authState === AUTH_STATE_PRESENT) {
    return 'credential configured';
  }
  if (authState === AUTH_STATE_ABSENT) {
    return 'no credential';
  }
  return `credential: ${authState}`;
}

// describeTrust renders the trust posture in the same words the command's own
// table uses, so the two renderings of one posture never word it differently.
// A posture the product did not report produces nothing.
export function describeTrust(trust: RegistryTrust | undefined): string | null {
  const required = trust?.signaturesRequired;
  if (typeof required !== 'boolean') {
    return null;
  }
  return required ? 'signatures required' : 'signatures optional';
}

// rowForRegistry shapes one entry.
//
// The default marker is emitted only where the product set the flag. Exactly
// one entry carries it in the ordinary case, but none does when the configured
// default names a host that is not itself configured — so the marker is read
// per entry and nothing here assumes a default exists.
export function rowForRegistry(entry: RegistryEntry): RegistryRow {
  const isDefault = entry.default === true;
  const trust = describeTrust(entry.trust);
  const credential = describeAuthState(entry.authState);

  const segments = [
    entry.name,
    isDefault ? 'default' : null,
    trust,
    credential,
  ].filter((s): s is string => typeof s === 'string' && s.length > 0);

  // The tooltip names each fact and carries the credential state as the
  // product's own token, so a reader who wants the literal value gets it
  // unfiltered — including a value this view has no phrase for.
  const lines = [`host: ${entry.host}`];
  if (entry.name) { lines.push(`alias: ${entry.name}`); }
  if (isDefault) { lines.push('default registry'); }
  if (trust) { lines.push(`trust: ${trust}`); }
  if (credential) { lines.push(`credential: ${entry.authState}`); }

  return {
    host: entry.host,
    label: entry.host,
    description: segments.join(' · '),
    tooltip: lines.join('\n'),
    icon: isDefault ? DEFAULT_ICON : ENTRY_ICON,
  };
}

// --- operations on a registry --------------------------------------------

// REGISTRY_ROW_CONTEXT marks a row that names one configured registry, and it
// is what the manifest targets its row entries with.
//
// Only an entry row carries it. The message rows — nothing anchored, no language
// server, nothing configured, the enumeration failed — name no registry, so an
// operation on one could only be invoked with no subject, and an invocation that
// cannot succeed is not offered at all. Targeting the view instead of this value
// would put every registry operation on those rows.
export const REGISTRY_ROW_CONTEXT = 'aggrega.registry';

// registrySubject reports the registry a node's operations act on, or null when
// the node names none.
//
// It is the one place a row is turned into a subject, so no caller re-derives
// it and no caller reads a display string in its place. A null answer is the
// signal to invoke nothing: there is no registry to name, so there is no
// invocation to compose.
export function registrySubject(node: RegistryNode): string | null {
  return node.kind === 'entry' ? node.row.host : null;
}

// 🔴 THIS MODULE COMPOSES NO INVOCATION AT ALL, BECAUSE EVERY REGISTRY OPERATION
// IS A REQUEST. Registering a registry, dropping its entry, removing its stored
// credential and building the searchable index all travel as request parameters,
// and each answer carries what the compiler resolved — the file a write landed
// in, or the directory an index was written under and what each registry's walk
// found. Their shapes and their wording live with the requests instead of here.
//
// The index build was the last invocation this module composed. It is a request
// now because the walk takes the request's own context and observes it per
// registry, so the stop a reader is offered reaches the walk rather than only
// this side's wait — which was the one property that had kept it a command.
// Compositions left standing here would be a second way to reach operations that
// already have one, and the one nothing exercises is the one that goes stale.

// nodesForDocument shapes a whole structured document, preserving the order the
// product emitted. The command lists registries in ascending host order and
// says so, so the view presents that order and never re-sorts: a reader
// comparing the view against the command's own output must see one order.
export function nodesForDocument(doc: RegistryListDoc): RegistryNode[] {
  const entries = doc.registries ?? [];
  if (entries.length === 0) {
    return [{ kind: 'message', label: EMPTY_LABEL }];
  }
  return entries.map((entry) => ({ kind: 'entry' as const, row: rowForRegistry(entry) }));
}

// --- the run -------------------------------------------------------------

// RegistriesLog is the reader-visible channel the run appends to — the
// product's own report, verbatim.
export interface RegistriesLog {
  appendLine(text: string): void;
}

// RegistriesRunDeps supplies the run's surfaces: the anchored root and the
// language server's state, which together decide whether the enumeration can be
// asked for at all, the request itself, and the log that carries the compiler's
// message when it refuses.
//
// It is declared this narrowly so the surface that owns the tree passes its own
// richer dependency set here unchanged, and so a test drives the whole rendering
// with a fake answer and no transport at all. It takes no cancellation, for the
// reason stated at the head of this module.
export interface RegistriesRunDeps {
  getWorkspaceRoot(): string | null;
  isLanguageServerRunning(): boolean;
  // runRegistryList asks the compiler for the listing. It resolves the answer,
  // and rejects with the compiler's own refusal when it could not be produced.
  runRegistryList(): Promise<RegistryListDoc>;
  log: RegistriesLog;
}

// registryNodes enumerates the configured registries for display.
//
// The enumeration reads the resolved configuration and never contacts a
// registry, so this run is cheap and a refresh costs nothing over the network.
// That is also why the credential state it surfaces is a presence report and
// never a reachability or validity check: no round trip is made, and none is
// implied.
//
// A refusal is surfaced as its own row with the compiler's message in the log
// and in the row's detail, so it can never be read as "no registries
// configured".
//
// A language server that is not running is asked nothing. The enumeration is
// its answer, so there is no fault to report, only a state — and the row for that
// state is the Catalog panel's, offering to start the server, because both
// panels are reading the same server and a reader should meet one sentence for
// it rather than a failure in one panel and a state in the other.
export async function registryNodes(deps: RegistriesRunDeps): Promise<RegistryNode[]> {
  if (!deps.getWorkspaceRoot()) {
    return [{ kind: 'message', label: NO_ANCHORED_WORKSPACE_TREE_LABEL }];
  }
  if (!deps.isLanguageServerRunning()) {
    return [serverStoppedNode()];
  }
  let doc: RegistryListDoc;
  try {
    doc = await deps.runRegistryList();
  } catch (err) {
    // The message is the compiler's own text, rendered through the extension's
    // one home for that conversion. A reading of its own here would be a second
    // implementation of the same job — one that agrees for everything the
    // extension throws and loses the whole diagnostic for the shape the language
    // server rejects with, which is an envelope object rather than an error.
    const message = describeError(err);
    deps.log.appendLine(message);
    return [{ kind: 'message', label: FAILURE_LABEL, detail: message }];
  }
  return nodesForDocument(doc);
}
