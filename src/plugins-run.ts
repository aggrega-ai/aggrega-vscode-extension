// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { shortUri } from './uri-display';
import { NO_ANCHORED_WORKSPACE_TREE_LABEL } from './workspace';

// --- wire shapes (mirror `aggrega plugin list -o json`) -------------------

// PluginEntry is one entry of the structured plugin listing.
//
// uri is the only field every entry carries. Everything else is optional, and
// the reason is that the product emits a DIFFERENT subset per plugin class, so
// a consumer treating any of them as present would report a fact it invented:
//
//   - a governance or linter guest carries type, version, commit and exports;
//   - a parser guest adds capabilities;
//   - a provider guest adds capabilities, inputKinds and boundary;
//   - a configured attachment adds origin, naming the config key it came from;
//   - a CLI-extension attachment adds readiness;
//   - an entry that could not be resolved or described carries error, and
//     carries NEITHER type NOR version, because nothing answered.
//
// There is no digest field. A CLI-extension attachment is pinned by content
// digest, and that pin reaches a reader inside origin, as a string the product
// composes and shortens. It is rendered as it arrives and never taken apart:
// recovering the digest from it would be reading a human sentence for data, and
// deciding from it whether the bytes drifted would be re-implementing a
// judgement that belongs to the product — which already reports its own answer
// as a readiness value.
export interface PluginEntry {
  uri: string;
  type?: string;
  version?: string;
  commit?: string;
  capabilities?: string[];
  inputKinds?: string[];
  boundary?: string;
  exports?: string[];
  origin?: string;
  readiness?: string;
  error?: string;
}

// PluginListDoc is the top level of the structured listing: the guests built
// into the binary, and the attachments the workspace configuration names. Both
// are optional so a document missing either is rendered as it arrived.
export interface PluginListDoc {
  embedded?: PluginEntry[];
  configured?: PluginEntry[];
}

// --- readiness -----------------------------------------------------------

// READINESS_READY is the one readiness value that reports a normal plugin.
// The others the product documents — unresolved, describe-failed and
// digest-drift — are all states a reader should notice.
const READINESS_READY = 'ready';

// EMBEDDED_GROUP_LABEL and CONFIGURED_GROUP_LABEL name the two groups in the
// product's own terms: the guests compiled into the binary, and the attachments
// the workspace configuration binds.
export const EMBEDDED_GROUP_LABEL = 'Embedded';
export const CONFIGURED_GROUP_LABEL = 'Configured';

// FAILURE_LABEL points at the channel carrying the product's own message. The
// row stays one short line because a tree row is not a place to render a
// diagnostic; the full text reaches the reader through the channel and through
// this row's detail.
export const FAILURE_LABEL = 'plugin list failed — see the Aggrega output channel.';

// isNoteworthyReadiness reports whether a readiness value is one a reader
// should be drawn to.
//
// The test is "not ready" rather than a list of the abnormal labels, and the
// direction is deliberate: the value set is the product's and it may grow, so a
// value this build has never seen is treated as noteworthy rather than normal.
// Getting that backwards would show a healthy icon beside a plugin whose bytes
// had drifted, which is the failure that matters here — while the cost of the
// other direction is one icon on a state whose token is displayed anyway.
export function isNoteworthyReadiness(readiness: string | undefined): boolean {
  if (readiness === undefined || readiness === '') {
    return false;
  }
  return readiness !== READINESS_READY;
}

// --- row shaping ---------------------------------------------------------

// PluginRow is one plugin rendered for display, with every string already
// decided. Shaping it free of editor types is what makes the rendering
// assertable without an extension host: a test reads back exactly the line an
// author would see.
export interface PluginRow {
  // label is the plugin's trailing identity segment.
  label: string;
  // description is the dimmed secondary line. Segments the product did not
  // report are absent rather than blank.
  description: string;
  // tooltip repeats the same facts one per line, so a reader who needs them
  // unambiguously gets them named rather than positional.
  tooltip: string;
  // icon is a theme-icon id, so the tree follows the reader's theme.
  icon: string;
}

// ENTRY_ICON, WARNING_ICON: the editor's own theme-icon ids.
const ENTRY_ICON = 'plug';
const WARNING_ICON = 'warning';

// rowForPlugin shapes one entry.
//
// The readiness value is carried through VERBATIM, with no re-wording. That is
// a deliberate departure from how this extension renders other structured
// tokens, and the reason is that these tokens are already the product's own
// user-facing vocabulary: `aggrega plugin list` prints the same words in its
// own table, and its help enumerates them. A gloss here would be a second copy
// of the product's teaching, and a reader comparing the view against the
// command would find the two wording one state differently.
export function rowForPlugin(entry: PluginEntry): PluginRow {
  const noteworthy = isNoteworthyReadiness(entry.readiness);
  const segments = [entry.type, entry.version, entry.readiness].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );

  const lines = [entry.uri];
  if (entry.type) { lines.push(`type: ${entry.type}`); }
  if (entry.version) { lines.push(`version: ${entry.version}`); }
  if (entry.commit) { lines.push(`commit: ${entry.commit}`); }
  if (entry.readiness) { lines.push(`readiness: ${entry.readiness}`); }
  // origin names the configuration key the attachment came from, or carries the
  // pin a CLI-extension attachment was installed with. Either way it is the
  // product's string, shown as it arrived.
  if (entry.origin) { lines.push(`origin: ${entry.origin}`); }
  if (entry.capabilities?.length) { lines.push(`capabilities: ${entry.capabilities.join(', ')}`); }
  if (entry.inputKinds?.length) { lines.push(`input kinds: ${entry.inputKinds.join(', ')}`); }
  if (entry.boundary) { lines.push(`boundary: ${entry.boundary}`); }
  if (entry.exports?.length) { lines.push(`exports: ${entry.exports.join(', ')}`); }
  if (entry.error) { lines.push(`error: ${entry.error}`); }

  return {
    label: shortUri(entry.uri),
    description: segments.join(' · '),
    tooltip: lines.join('\n'),
    icon: entry.error || noteworthy ? WARNING_ICON : ENTRY_ICON,
  };
}

// --- nodes ---------------------------------------------------------------

// PluginNode is what the tree renders: a group, a plugin inside one, or a
// single line explaining why there is none.
//
// The no-plugin states — nothing anchored, and the listing failing — are
// distinct messages on purpose. An empty group and a failed listing must never
// look identical, because one means "there are none" and the other means "we do
// not know".
export type PluginNode =
  | { kind: 'group'; label: string; rows: PluginRow[] }
  | { kind: 'entry'; row: PluginRow }
  | { kind: 'message'; label: string; detail?: string };

// nodesForDocument shapes a whole listing into its two groups, preserving the
// order the product emitted so a reader comparing the view against the
// command's own table sees one order.
//
// Both groups are always present, including when empty: a group reading zero is
// itself the answer, and dropping it would leave a reader unable to tell "no
// attachments are configured" from "the attachments were not looked at".
export function nodesForDocument(doc: PluginListDoc): PluginNode[] {
  return [
    { kind: 'group', label: EMBEDDED_GROUP_LABEL, rows: (doc.embedded ?? []).map(rowForPlugin) },
    { kind: 'group', label: CONFIGURED_GROUP_LABEL, rows: (doc.configured ?? []).map(rowForPlugin) },
  ];
}

// --- the run -------------------------------------------------------------

// PluginsLog is the reader-visible channel the run appends to — the product's
// own report, verbatim.
export interface PluginsLog {
  appendLine(text: string): void;
}

// PluginsRunDeps supplies the run's surfaces: the anchored root that decides
// whether the command can be invoked at all, the structured invocation itself,
// and the log that carries the product's text.
export interface PluginsRunDeps {
  getWorkspaceRoot(): string | null;
  // runPluginListJson invokes the structured listing. It resolves the parsed
  // document together with whatever the product wrote to stderr, and rejects
  // with the product's own message when the command could not run.
  runPluginListJson(): Promise<{ doc: PluginListDoc; stderr: string }>;
  log: PluginsLog;
}

// pluginNodes enumerates the plugins the compiler can see, for display.
//
// A successful listing can still carry text on stderr — the command reports a
// configuration it had to ignore, or an attachment it could not register, and
// keeps going rather than failing the whole listing. That report is appended to
// the log verbatim, because it explains an entry a reader is about to wonder
// about, and the product has already worded it.
//
// A failure becomes its own row with the product's message in the log and in the
// row's detail, so it can never be read as "there are no plugins".
export async function pluginNodes(deps: PluginsRunDeps): Promise<PluginNode[]> {
  if (!deps.getWorkspaceRoot()) {
    return [{ kind: 'message', label: NO_ANCHORED_WORKSPACE_TREE_LABEL }];
  }
  let result: { doc: PluginListDoc; stderr: string };
  try {
    result = await deps.runPluginListJson();
  } catch (err) {
    // The message is the command's own text, carried through unchanged: a
    // re-worded wrapper would hide the remediation the product already named.
    const message = err instanceof Error ? err.message : String(err);
    deps.log.appendLine(message);
    return [{ kind: 'message', label: FAILURE_LABEL, detail: message }];
  }
  const report = result.stderr.trim();
  if (report) {
    deps.log.appendLine(report);
  }
  return nodesForDocument(result.doc);
}
