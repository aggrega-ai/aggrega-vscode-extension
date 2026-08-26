// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { NO_ANCHORED_WORKSPACE_TREE_LABEL } from './workspace';

// --- wire shapes (mirror `aggrega registry list -o json`) -----------------

// RegistryTrust is the registry's trust posture as discrete fields. The
// structured output carries the posture this way deliberately, in place of the
// sentence the table renders, so a consumer reads a value rather than parsing
// prose.
export interface RegistryTrust {
  signaturesRequired?: boolean;
}

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
// be known without contacting the registry. Every field is optional because a
// consumer that reads a state the product did not send would report a fact it
// invented.
export interface RegistryEntry {
  host: string;
  name?: string;
  default?: boolean;
  authState?: string;
  trust?: RegistryTrust;
}

// RegistryListDoc is the top level of the structured output.
export interface RegistryListDoc {
  registries?: RegistryEntry[];
}

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
// verbatim. The row stays one short line because a tree row is not a place to
// render a compiler diagnostic; the full text reaches the reader through the
// channel and this row's detail.
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
// explaining why there is none. The no-registry states — nothing anchored,
// nothing configured, and the enumeration failing — are distinct messages on
// purpose. An empty catalog of registries and a failed enumeration
// must never look identical, because one means "you have configured none" and
// the other means "we do not know".
export type RegistryNode =
  | { kind: 'entry'; row: RegistryRow }
  | { kind: 'message'; label: string; detail?: string };

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
    label: entry.host,
    description: segments.join(' · '),
    tooltip: lines.join('\n'),
    icon: isDefault ? DEFAULT_ICON : ENTRY_ICON,
  };
}

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

// RegistriesRunDeps supplies the run's surfaces: the anchored root that decides
// whether the command can be invoked at all, the structured invocation itself,
// and the log that carries the product's message when it fails.
export interface RegistriesRunDeps {
  getWorkspaceRoot(): string | null;
  // runRegistryListJson invokes the structured listing. It resolves the parsed
  // document, and rejects with the product's own message when the command could
  // not run.
  runRegistryListJson(): Promise<{ doc: RegistryListDoc; stderr: string }>;
  log: RegistriesLog;
}

// registryNodes enumerates the configured registries for display.
//
// The command reads the resolved configuration and never contacts a registry,
// so this run is cheap and a refresh costs nothing over the network. That is
// also why the credential state it surfaces is a presence report and never a
// reachability or validity check: no round trip is made, and none is implied.
//
// A failure is surfaced as its own row with the product's message in the log and
// in the row's detail, so it can never be read as "no registries configured".
export async function registryNodes(deps: RegistriesRunDeps): Promise<RegistryNode[]> {
  if (!deps.getWorkspaceRoot()) {
    return [{ kind: 'message', label: NO_ANCHORED_WORKSPACE_TREE_LABEL }];
  }
  let result: { doc: RegistryListDoc; stderr: string };
  try {
    result = await deps.runRegistryListJson();
  } catch (err) {
    // The message is the command's own text. It is carried through unchanged: a
    // re-worded wrapper would hide the remediation the product already named.
    const message = err instanceof Error ? err.message : String(err);
    deps.log.appendLine(message);
    return [{ kind: 'message', label: FAILURE_LABEL, detail: message }];
  }
  return nodesForDocument(result.doc);
}
