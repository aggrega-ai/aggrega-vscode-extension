// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { CatalogIndexEntity } from './workspace-catalog-run';

// This module is the one description of the operation surface: which operations
// exist, which group each sits in, and the argument list each composes.
//
// It imports no editor type on purpose. The panel is drawn in two interchangeable
// shapes, and both read this description rather than each carrying a table of
// their own — two tables would be two answers to "what is on this panel", and
// they would part company the first time an operation moved. Being free of editor
// types is also what makes the membership and every composed argument list
// assertable without an extension host.

// OperationId enumerates the compiler operations the surface exposes. Each value
// is the stable key its row carries, and, for the operations whose command this
// surface contributes, the suffix of that command id.
export type OperationId =
  | 'validate'
  | 'lint'
  | 'build'
  | 'preview'
  | 'graph'
  | 'pull'
  | 'acquire'
  | 'scaffold'
  | 'import'
  | 'inspect'
  | 'push'
  | 'sign'
  | 'deprecate'
  | 'configShow'
  | 'cache';

// OperationGroupId names the five reasons a person opens this panel.
export type OperationGroupId =
  | 'build'
  | 'dependencies'
  | 'author'
  | 'publish'
  | 'config';

export interface OperationDef {
  id: OperationId;
  label: string;
  detail: string;
  // icon is a VS Code ThemeIcon (codicon) id, so the surface inherits the editor
  // theme rather than shipping bitmap assets.
  icon: string;
  // command overrides the derived id for an operation whose command is
  // contributed under a name of its own. The topology graph is the case: it was
  // contributed before this surface grouped anything, and a command id is what a
  // reader binds a keystroke to, so renaming it would silently break that
  // binding.
  command?: string;
}

export interface OperationGroup {
  id: OperationGroupId;
  // heading is what a reader sees above the group's entries.
  heading: string;
  // separated draws a divider ahead of the group. It is a property of the group
  // rather than of the rendering so both shapes separate the same one.
  separated?: boolean;
  operations: OperationDef[];
}

// OPERATION_GROUPS is the operation surface, in display order.
//
// The groups are the five reasons a person opens this panel: to compile
// something, to fetch what compiling needs, to write something new, to publish,
// and to see or change how the tool is configured. Ordering by that reason means
// a reader looking for one thing scans one group.
//
// Validate and Lint sit adjacent, and that adjacency is deliberate: they are the
// two entries that answer "what is wrong with what I wrote", and both report
// their findings into the Problems panel. Separating them would put one question
// in two places.
//
// The publish group is set apart because its operations differ in kind rather
// than in degree from the rest: a build writes files on this machine, while a
// publication changes what every consumer of a catalog resolves. That difference
// belongs in front of the reader before the click, not in an explanation after
// it.
//
// Seeding a configuration is deliberately not an entry here. It belongs to the
// welcome flow and the empty state, where it reads as a first step; on a row
// beside the others it would read as a routine action.
export const OPERATION_GROUPS: OperationGroup[] = [
  {
    id: 'build',
    heading: 'Build',
    operations: [
      {
        id: 'validate',
        label: 'Validate active file',
        detail: 'Validate the active YAML file via the language server',
        icon: 'check',
      },
      {
        id: 'lint',
        label: 'Lint',
        detail: 'Check publishing conventions across the catalog; findings land in the Problems panel',
        icon: 'search',
      },
      {
        id: 'build',
        label: 'Build',
        detail: 'Compile a Release and write its rendered artifacts; findings land in the Problems panel',
        icon: 'package',
      },
      {
        id: 'preview',
        label: 'Preview build',
        detail: 'Render what a build would emit without writing it; findings land in the Problems panel',
        icon: 'eye',
      },
      {
        id: 'graph',
        label: 'Show topology graph',
        detail: 'Draw the topology the selected Release compiles to',
        icon: 'type-hierarchy',
        command: 'aggrega.graph.show',
      },
    ],
  },
  {
    id: 'dependencies',
    heading: 'Dependencies',
    operations: [
      {
        id: 'pull',
        label: 'Pull',
        detail: 'Pull remote dependencies into the workspace',
        icon: 'cloud-download',
      },
      {
        id: 'acquire',
        label: 'Acquire inputs',
        detail: "Pin the external inputs the selected Release's render consumes, and record them in its lockfile",
        icon: 'pinned',
      },
    ],
  },
  {
    id: 'author',
    heading: 'Author',
    operations: [
      {
        id: 'scaffold',
        label: 'Draft entity…',
        detail: 'Draft a starter document for an entity kind, opened in a new editor tab',
        icon: 'new-file',
      },
      {
        id: 'import',
        label: 'Import…',
        detail: 'Import a foreign source into Aggrega',
        icon: 'arrow-into',
      },
      {
        id: 'inspect',
        label: 'Inspect…',
        detail: 'Show what an entity in this workspace resolves to',
        icon: 'list-tree',
      },
    ],
  },
  {
    id: 'publish',
    heading: 'Publish',
    separated: true,
    operations: [
      {
        id: 'push',
        label: 'Push…',
        detail: 'Bundle and publish a catalog entity in this workspace to a configured registry',
        icon: 'cloud-upload',
      },
      {
        id: 'sign',
        label: 'Sign…',
        detail: 'Attach a signature to an already-published artifact',
        icon: 'verified',
      },
      {
        id: 'deprecate',
        label: 'Deprecate…',
        detail: 'Attach a signed deprecation marker to an already-published artifact',
        icon: 'warning',
      },
    ],
  },
  {
    id: 'config',
    heading: 'Configuration',
    operations: [
      {
        id: 'configShow',
        label: 'Show effective config',
        detail: 'Show the resolved configuration and the layer each setting came from',
        icon: 'settings-gear',
      },
      {
        id: 'cache',
        label: 'Cache…',
        detail: 'Inspect or maintain the local cache',
        icon: 'database',
      },
    ],
  },
];

// commandIdFor reports the command an entry runs. It is derived from the
// operation id unless the entry names one, so the id and the command cannot
// drift for the entries this surface contributes.
export function commandIdFor(op: OperationDef): string {
  return op.command ?? `aggrega.op.${op.id}`;
}

// allOperations flattens the groups in display order. Callers that need every
// operation read it from here rather than keeping a list beside the groups.
export function allOperations(): OperationDef[] {
  return OPERATION_GROUPS.flatMap((group) => group.operations);
}

// --- the two shapes ------------------------------------------------------

// OperationsLayout selects how a group is drawn. It changes the shape of the
// panel and never which operations exist or what they do.
export type OperationsLayout = 'grouped' | 'collapsible';

export const DEFAULT_OPERATIONS_LAYOUT: OperationsLayout = 'grouped';

// OperationsNode is the abstract row both shapes render. Modelling the rows here
// rather than in the tree provider is what lets one description drive two
// renderings: the shape decides which nodes are produced, not what a node means.
export type OperationsNode =
  | { kind: 'separator' }
  | { kind: 'heading'; group: OperationGroup }
  | { kind: 'group'; group: OperationGroup }
  | { kind: 'operation'; op: OperationDef };

// operationsTopLevel reports the rows below the selector rows, for a shape.
//
// Grouped draws a heading followed by its entries, all at one level, so every
// operation is visible without expanding anything. Collapsible draws one row per
// group, which the reader opens. Both walk the same groups in the same order and
// separate the same group.
export function operationsTopLevel(layout: OperationsLayout): OperationsNode[] {
  const nodes: OperationsNode[] = [];
  for (const group of OPERATION_GROUPS) {
    if (group.separated) {
      nodes.push({ kind: 'separator' });
    }
    if (layout === 'collapsible') {
      nodes.push({ kind: 'group', group });
      continue;
    }
    nodes.push({ kind: 'heading', group });
    for (const op of group.operations) {
      nodes.push({ kind: 'operation', op });
    }
  }
  return nodes;
}

// operationsUnder reports a collapsible group's children. The grouped shape
// expands nothing, so it never asks.
export function operationsUnder(group: OperationGroup): OperationsNode[] {
  return group.operations.map((op) => ({ kind: 'operation', op }) as OperationsNode);
}

// readLayout decides the shape from whatever the editor reports the setting to
// be. Anything other than the one alternative spelling reads as the default, so
// a hand-edited settings file carrying a value this cannot understand draws the
// panel rather than drawing nothing.
export function readLayout(configured: unknown): OperationsLayout {
  return configured === 'collapsible' ? 'collapsible' : DEFAULT_OPERATIONS_LAYOUT;
}

// --- the arguments each entry composes -----------------------------------

// An entry appears on this panel only when its invocation can succeed, and for a
// command-line-backed entry that means the subject the command requires is
// present before the invocation is built. A control that always fails is worse
// than an absent one: an absent capability sends the reader to the command line,
// while a failing button sends them looking for what they did wrong.
//
// withSubject is where that rule is enforced, once. Every composition that takes
// a subject routes through it, so a bare invocation cannot be assembled by any
// path — including a path written later by someone who has not read this
// paragraph.
function withSubject(verb: string, subject: string, what: string): string[] {
  const trimmed = subject.trim();
  if (trimmed === '') {
    throw new Error(`aggrega ${verb} takes ${what}, and none was given`);
  }
  return [verb, trimmed];
}

// ReleaseScopedVerb is the set of command-line verbs this surface runs against
// the selected Release. It is a closed set rather than a string so a verb that
// has moved to the language server cannot be routed here by a caller that has
// not noticed.
export type ReleaseScopedVerb = 'pull' | 'acquire';

// releaseScopedArgs builds `aggrega <verb> --release <path>`. Both verbs mark
// --release required, so the bare verb is a usage error; the path is
// workspace-relative and the subprocess runs in the workspace root, so it
// resolves there.
export function releaseScopedArgs(verb: ReleaseScopedVerb, release: string): string[] {
  const trimmed = release.trim();
  if (trimmed === '') {
    throw new Error(`aggrega ${verb} requires a Release, and none is selected`);
  }
  return [verb, '--release', trimmed];
}

// catalogUploadArgs builds the publication of one catalog entity. The command
// takes the entity's path, so an invocation carrying none publishes nothing and
// reports a usage error.
export function catalogUploadArgs(entityPath: string): string[] {
  return withSubject('push', entityPath, 'the path of the entity to publish');
}

// signArgs builds the signature of one already-published artifact. The subject
// is a reference to something in a registry, which is why it is asked for rather
// than taken from the workspace index: the index describes what is authored
// here, and this command amends what is already published.
export function signArgs(reference: string): string[] {
  return withSubject('sign', reference, 'a reference to the artifact to sign');
}

// deprecateArgs builds the deprecation of one already-published artifact.
//
// The severity and the reason travel as flags rather than being left out. The
// command asks for them at an interactive terminal when they are absent, and a
// spawned subprocess has no terminal to be asked at — so an invocation carrying
// only the reference refuses every time, whatever the reader intended.
export function deprecateArgs(reference: string, severity: string, reason: string): string[] {
  const args = withSubject('deprecate', reference, 'a reference to the artifact to deprecate');
  const trimmedSeverity = severity.trim();
  if (trimmedSeverity === '') {
    throw new Error('aggrega deprecate takes a severity, and none was given');
  }
  const trimmedReason = reason.trim();
  if (trimmedReason === '') {
    throw new Error('aggrega deprecate takes a reason, and none was given');
  }
  return [...args, '--severity', trimmedSeverity, '--reason', trimmedReason];
}

// importArgs builds the import of one foreign source. The source is passed
// verbatim; the compiler validates it and reports on it.
export function importArgs(source: string): string[] {
  return withSubject('import', source, 'the source to import');
}

// CacheSubcommand is the closed set of cache operations this surface offers.
export type CacheSubcommand = 'status' | 'prune' | 'clear';

// CACHE_SUBCOMMANDS is what the reader chooses from, with the scope of each
// stated on its own row: the difference between emptying what belongs to this
// workspace and emptying what every project on this machine shares is the fact
// a reader most needs before choosing, and a label alone cannot carry it.
export const CACHE_SUBCOMMANDS: Array<{ value: CacheSubcommand; detail: string }> = [
  {
    value: 'status',
    detail: 'List every cache and what it holds — removes nothing',
  },
  {
    value: 'prune',
    detail: 'Remove entries no lockfile references, in this workspace and on this machine',
  },
  {
    value: 'clear',
    detail: 'Empty every cache, in this workspace and on this machine',
  },
];

// CACHE_CONFIRM_LABEL is the affirmative on a cache confirmation. It says what
// will happen rather than "OK", so a reader dismissing the dialog quickly is
// reading the act rather than agreeing to an unnamed one.
const CACHE_CONFIRM_LABEL_PRUNE = 'Remove unreferenced entries';
const CACHE_CONFIRM_LABEL_CLEAR = 'Empty every cache';

// CacheConfirmation is what a reader is asked before a cache operation removes
// anything: the question, the scope it reaches, and the affirmative.
export interface CacheConfirmation {
  question: string;
  // scope names which caches the operation reaches, in the two terms that
  // matter to a reader — the ones belonging to this workspace and the ones
  // every project on this machine shares. Both are named where an operation
  // reaches both, because naming one would understate what is about to happen.
  scope: string;
  confirmLabel: string;
}

// THIS_MACHINE_CACHES names the caches that are not this workspace's.
//
// They are shared because what they hold is identical across projects — a
// compiled plugin is the same bytes whichever workspace asked for it — so
// emptying them affects every project on the machine, not only this one. The
// names are the compiler's own, as they appear in its cache listing, so a
// reader who runs the report sees the same words back.
const THIS_MACHINE_CACHES =
  'the compiled-module cache and the plugin-describe cache, which every project on this machine shares';

// THIS_WORKSPACE_CACHES names the caches that sit under this workspace's own
// configured cache directory.
const THIS_WORKSPACE_CACHES =
  "this workspace's own entity, source-artifact, external-input and docs-bundle caches";

// cacheConfirmation reports what to ask before a cache subcommand runs, or null
// where nothing is removed and there is nothing to confirm.
//
// Both removals reach both scopes, which is why neither confirmation names only
// one: clear empties this workspace's caches and the two shared ones, and prune
// reclaims unreferenced entries from this workspace's caches, from the shared
// plugin-describe cache, and from the shared compiled-module cache by reference.
export function cacheConfirmation(subcommand: CacheSubcommand): CacheConfirmation | null {
  switch (subcommand) {
    case 'status':
      return null;
    case 'prune':
      return {
        question: 'Remove cache entries no lockfile references?',
        scope: `This reaches ${THIS_WORKSPACE_CACHES}, and ${THIS_MACHINE_CACHES}. Entries still referenced are kept.`,
        confirmLabel: CACHE_CONFIRM_LABEL_PRUNE,
      };
    case 'clear':
      return {
        question: 'Empty every cache?',
        scope: `This empties ${THIS_WORKSPACE_CACHES}, and ${THIS_MACHINE_CACHES}. The caches repopulate on the next build.`,
        confirmLabel: CACHE_CONFIRM_LABEL_CLEAR,
      };
  }
}

// cacheArgs builds one cache subcommand.
//
// The wipe carries its own non-interactive consent. The command asks for
// confirmation at an interactive terminal and refuses outright when there is
// none, and this surface runs it as a subprocess that has none — so an
// invocation without the answer refuses every time, whatever the reader
// intended. The answer travels as a flag because the reader has already given
// it, in a dialog naming the same scope; this composes no consent the reader
// did not give, and cacheConfirmation is the only place that consent is
// obtained.
export function cacheArgs(subcommand: CacheSubcommand): string[] {
  const args = withSubject('cache', subcommand, 'a subcommand');
  return subcommand === 'clear' ? [...args, '--yes'] : args;
}

// DeprecationSeverity is the severity a deprecation marker records. The three
// are the compiler's own vocabulary, offered as a choice because the set is
// closed and a reader picking from a list need not know how one is spelled.
export interface DeprecationSeverity {
  value: string;
  detail: string;
}

export const DEPRECATION_SEVERITIES: DeprecationSeverity[] = [
  {
    value: 'warning',
    detail: 'Deprecated but still usable — a consumer is advised to migrate, not blocked',
  },
  {
    value: 'error',
    detail: 'Deprecated and no longer fit for new use — a consumer should treat resolving it as an error',
  },
  {
    value: 'retracted',
    detail: 'Withdrawn — it must not be used',
  },
];

// --- the subjects the workspace itself can answer for --------------------

// EntitySubject is one entity offered as the subject of an operation, with every
// string already decided. Shaping it free of editor types is what makes the
// offer assertable: a test reads back exactly the line an author would see, and
// exactly the argument the choice composes.
export interface EntitySubject {
  // label is the name the author declared, because that is how the entity is
  // referred to everywhere else.
  label: string;
  // description is the kind, which is what separates two entities sharing a
  // name.
  description: string;
  // detail is the workspace-relative file, empty for an entity the workspace has
  // no file for.
  detail: string;
  // name is the identity, and the argument an inspection takes.
  name: string;
  // file is the workspace-relative path, and the argument a publication takes.
  file: string;
}

function subjectFor(entity: CatalogIndexEntity): EntitySubject {
  return {
    label: entity.name,
    description: entity.kind,
    detail: entity.file,
    name: entity.name,
    file: entity.file,
  };
}

// publishableSubjects offers the entities a publication can name.
//
// An entity with no workspace file of its own is left out, and the reason is the
// argument rather than where the entity came from: the command takes a path, so
// an entry offering an entity that has none would compose an invocation that
// cannot succeed. Read it as a check on the argument, not as a way of telling
// which entities the workspace authored — the index reports that separately, and
// inferring it from an empty path would be a second answer to a question already
// answered.
export function publishableSubjects(entities: CatalogIndexEntity[]): EntitySubject[] {
  return entities.filter((entity) => entity.file.trim() !== '').map(subjectFor);
}

// inspectableSubjects offers the entities an inspection can name. An inspection
// is addressed by identity rather than by path, so an entity the workspace holds
// no file for is still answerable and is offered.
export function inspectableSubjects(entities: CatalogIndexEntity[]): EntitySubject[] {
  return entities.filter((entity) => entity.name.trim() !== '').map(subjectFor);
}
