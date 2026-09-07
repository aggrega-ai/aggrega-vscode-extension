// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { withSubject } from './operation-groups';
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
  // reference is the plugin's full identity as the product reported it, and it
  // is the value every operation on this row is invoked with. It is carried as
  // its own field rather than read back off the label: the label is a shortened
  // display string, and a later change to what a row reads would silently change
  // what its operations act on.
  reference: string;
  // type is the type the product reported for this plugin, or the empty string
  // when it reported none. An entry nothing answered for carries no type at all,
  // and an operation that needs one cannot be composed for such a row — so the
  // empty string is the signal to withhold it rather than a blank to render.
  //
  // The value is carried through verbatim and never translated. It is the
  // product's own vocabulary on both surfaces: the listing reports it and the
  // removal accepts it, so a reading here would be a second copy of a set that
  // belongs to the compiler.
  type: string;
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
    reference: entry.uri,
    type: entry.type ?? '',
    label: shortUri(entry.uri),
    description: segments.join(' · '),
    tooltip: lines.join('\n'),
    icon: entry.error || noteworthy ? WARNING_ICON : ENTRY_ICON,
  };
}

// --- nodes ---------------------------------------------------------------

// PluginGroup identifies which of the listing's two groups a plugin came from.
//
// It is a value on the node rather than a reading of the group's label, and the
// distinction matters: which group a plugin sits in decides what can be done to
// it. A guest compiled into the binary is no configuration entry, so nothing
// that edits configuration can address it; an attachment the configuration names
// can be addressed. A label is a display string, and deciding an operation from
// one would tie what a row offers to what it happens to read.
export type PluginGroup = 'embedded' | 'configured';

// PluginEntryNode is one plugin as the tree renders it, carrying the group it
// came from alongside its row. Shaping it here rather than in the view is what
// keeps the group from being lost between the two: the view renders the nodes it
// is given and constructs none of its own.
export interface PluginEntryNode {
  kind: 'entry';
  group: PluginGroup;
  row: PluginRow;
}

// PluginNode is what the tree renders: a group, a plugin inside one, or a
// single line explaining why there is none.
//
// A group carries its plugins as already-shaped nodes rather than as bare rows,
// so expanding one hands the tree exactly what the model built.
//
// The no-plugin states — nothing anchored, and the listing failing — are
// distinct messages on purpose. An empty group and a failed listing must never
// look identical, because one means "there are none" and the other means "we do
// not know".
export type PluginNode =
  | { kind: 'group'; group: PluginGroup; label: string; entries: PluginEntryNode[] }
  | PluginEntryNode
  | { kind: 'message'; label: string; detail?: string };

// groupNode shapes one group and the plugins inside it. It is the one place a
// group's identity and its reader-visible label are paired, so the two cannot
// disagree.
function groupNode(
  group: PluginGroup,
  label: string,
  entries: PluginEntry[] | undefined,
): PluginNode {
  return {
    kind: 'group',
    group,
    label,
    entries: (entries ?? []).map((entry) => ({
      kind: 'entry' as const,
      group,
      row: rowForPlugin(entry),
    })),
  };
}

// nodesForDocument shapes a whole listing into its two groups, preserving the
// order the product emitted so a reader comparing the view against the
// command's own table sees one order.
//
// Both groups are always present, including when empty: a group reading zero is
// itself the answer, and dropping it would leave a reader unable to tell "no
// attachments are configured" from "the attachments were not looked at".
export function nodesForDocument(doc: PluginListDoc): PluginNode[] {
  return [
    groupNode('embedded', EMBEDDED_GROUP_LABEL, doc.embedded),
    groupNode('configured', CONFIGURED_GROUP_LABEL, doc.configured),
  ];
}

// --- operations on a plugin ----------------------------------------------

// PLUGIN_TYPE_PROVIDER, PLUGIN_TYPE_GOVERNANCE and PLUGIN_TYPE_CLI are the three
// types this surface has to name for a reason of its own: the first two each
// require a further answer before an attachment can be composed, and the third
// cannot be attached from here at all.
export const PLUGIN_TYPE_PROVIDER = 'provider';
export const PLUGIN_TYPE_GOVERNANCE = 'governance';
export const PLUGIN_TYPE_CLI = 'cli';

// ATTACHABLE_PLUGIN_TYPES is what a reader chooses from when attaching a plugin.
//
// 🔴 This is a copy of vocabulary the compiler owns, and it is here because the
// alternative is worse rather than because it is good. A free-text box would need
// no list, and it would also offer the one type this surface must not offer (see
// below) with nothing to stop a reader typing it. A choice needs something to
// choose from, so the set is written once, here, and nowhere else.
//
// The cli type is absent, and the reason is not a preference. Installing one
// confirms the plugin's declared capabilities first, and it refuses outright
// rather than blocking when the confirmation cannot be answered — which is the
// case for every invocation this surface makes, because the process it starts has
// no terminal behind it. The other way through is to accept the capabilities
// without asking, and accepting a capability grant on the reader's behalf is
// their decision to make and not this surface's. So the type is left off, and a
// reader who wants one runs the command from a terminal.
//
// A removal deliberately does NOT read this set: it passes the type the listing
// reported straight through. The compiler's own set grows, so a membership test
// here would eventually withhold a removal the compiler would have accepted, and
// it would withhold it silently — which is worse than the compiler answering a
// type it does not know in its own words.
export const ATTACHABLE_PLUGIN_TYPES: readonly string[] = [
  PLUGIN_TYPE_PROVIDER,
  PLUGIN_TYPE_GOVERNANCE,
  'linter',
  'importer',
];

// GOVERNANCE_ROLES is the set of attachment roles a governance plugin can be
// bound at, in the product's own order. A governance attachment is not composable
// without one, so the set is offered rather than typed.
export const GOVERNANCE_ROLES: readonly string[] = [
  'annotation-transform',
  'label-transform',
  'ir-verdict',
  'render-verdict',
];

// The two values a row of this panel carries, and the reason there are two.
//
// Removing a plugin names the plugin's type and a reference to it, and not every
// row can supply both. A guest compiled into the binary is no configuration
// entry, so there is nothing to remove it from. An attachment the configuration
// names but nothing could resolve or describe arrives with no type at all, which
// is a state the listing genuinely reports rather than one this surface guards
// against speculatively.
//
// So the value is decided by whether a removal can be addressed to the row —
// configured, carrying a type, and carrying a reference — and not by which group
// the row is drawn under. A group heading and a message row carry neither value:
// a heading names a group and a message explains why there is nothing to name,
// so an operation on either could only be invoked with no subject at all.
export const PLUGIN_CONFIG_ENTRY_ROW_CONTEXT = 'aggrega.plugin.configEntry';
export const PLUGIN_ROW_CONTEXT = 'aggrega.plugin';

// pluginRowContext reports the value a node's row operations are bound to, or
// null when the node is not a plugin at all.
//
// It is the one place a node is classified, so the value the view sets and the
// value the manifest targets cannot be decided by two different readings.
export function pluginRowContext(node: PluginNode): string | null {
  if (node.kind !== 'entry') {
    return null;
  }
  return node.group === 'configured' && node.row.type !== '' && node.row.reference !== ''
    ? PLUGIN_CONFIG_ENTRY_ROW_CONTEXT
    : PLUGIN_ROW_CONTEXT;
}

// PluginRemovalSubject is the pair a removal is addressed by: the type the
// product reported for the plugin, and the reference it reported for it.
export interface PluginRemovalSubject {
  type: string;
  reference: string;
}

// pluginRemovalSubject reports the plugin a removal acts on, or null when the
// node names none.
//
// It is the one place a row becomes a subject, so no caller re-derives it and no
// caller reads a display string in its place. A null answer is the signal to
// invoke nothing: there is nothing to name, so there is no invocation to
// compose. The condition is the same one pluginRowContext reads, so the value
// the manifest binds on and the value a handler acts on cannot part company.
export function pluginRemovalSubject(node: PluginNode): PluginRemovalSubject | null {
  if (pluginRowContext(node) !== PLUGIN_CONFIG_ENTRY_ROW_CONTEXT || node.kind !== 'entry') {
    return null;
  }
  return { type: node.row.type, reference: node.row.reference };
}

// pluginRemoveArgs composes the removal of one configured plugin.
//
// Both the type and the reference are the product's own strings, passed through
// verbatim: the listing reports them and the removal accepts them, and the
// removal matches a reference by an exact match on the entry it was configured
// with. A translation between the two surfaces would be a second copy of a
// vocabulary that belongs to the compiler, and it would agree with the compiler
// only until the day one of them changed.
//
// The subject guard is reached rather than restated, which is why the verb it is
// given is the whole command as a reader would name it: the composition builds
// its own two-word verb, and only the checked subject is taken back.
export function pluginRemoveArgs(type: string, reference: string): string[] {
  const [, checkedType] = withSubject('plugin remove', type, "the plugin's type");
  const [, query] = withSubject(
    'plugin remove',
    reference,
    'a reference to the plugin to remove',
  );
  return ['plugin', 'remove', checkedType, query];
}

// pluginRemovalConfigTarget names the configuration file a removal of this type
// writes, in the product's own terms.
//
// Which file it is depends on the type, and that is not guessable from a row's
// label — so it is named in front of the reader before anything happens rather
// than explained afterwards. The default is left to stand rather than forced by
// a flag: which file a removal targets is the operator's setting to make, and
// pinning it here would decide it for them.
export function pluginRemovalConfigTarget(type: string): string {
  return type === PLUGIN_TYPE_CLI
    ? 'the global configuration shared across every workspace on this machine'
    : "this project's workspace configuration";
}

// PluginAttachment is the answers an attachment is composed from: the type to
// attach at, the search term that resolves to one plugin, and the one further
// answer some types require.
export interface PluginAttachment {
  type: string;
  query: string;
  // capability is the capability a provider binding serves. The provider type
  // requires it and no other type accepts it.
  capability?: string;
  // role is the pipeline role a governance attachment is bound at. The
  // governance type requires it and no other type accepts it.
  role?: string;
}

// pluginAddArgs composes the attachment of one plugin.
//
// The two type-conditional answers are required or refused rather than merely
// passed along, because the command treats each the same way: absent where it is
// required, and present where it is not, are both usage errors. Composing either
// shape would build an invocation that cannot succeed.
export function pluginAddArgs(attachment: PluginAttachment): string[] {
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

  const args = ['plugin', 'add', type, query];
  if (capability !== '') { args.push('--capability', capability); }
  if (role !== '') { args.push('--role', role); }
  return args;
}

// GenCatalogSelection is which guests a generation run covers: every guest built
// into the compiler, or one artifact named by path. The command declares the two
// mutually exclusive and requires one of them, so they are modelled as a choice
// rather than as two optional flags that could be set together or neither.
export type GenCatalogSelection =
  | { kind: 'embedded' }
  | { kind: 'artifact'; artifactPath: string };

// pluginGenCatalogArgs composes a catalog-generation run. Both paths are
// required by the command, so both are required here; the artifact path is
// required by the selection that names one.
export function pluginGenCatalogArgs(
  selection: GenCatalogSelection,
  outputDir: string,
  overlayPath: string,
): string[] {
  const [, output] = withSubject(
    'plugin gen-catalog',
    outputDir,
    'the directory to write the entities under',
  );
  const [, overlay] = withSubject(
    'plugin gen-catalog',
    overlayPath,
    'the authored overlay to merge',
  );

  const args = ['plugin', 'gen-catalog'];
  if (selection.kind === 'embedded') {
    args.push('--from-embedded');
  } else {
    const [, artifact] = withSubject(
      'plugin gen-catalog',
      selection.artifactPath,
      'the path of the artifact to generate from',
    );
    args.push('--plugin', artifact);
  }
  args.push('--output-dir', output, '--overlay', overlay);
  return args;
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
