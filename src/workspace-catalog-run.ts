// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';
import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';
import {
  ENTITY_KIND_READ,
  EntityKind,
  EntityKindAcceptance,
  acceptanceFor,
  readEntityKinds,
} from './entity-kinds';
import { daemonStandingTooltip, startServerPress } from './daemon-status';
import { outcomeOf, terminalLine } from './operation-outcome';
import type { PanelActionPress } from './panel-actions';
import { NO_ANCHORED_WORKSPACE_TREE_LABEL } from './workspace';

// --- the workspace entity index, as the compiler publishes it -------------

// CatalogIndexEntity is one entity the language server reported for the open
// workspace, reported exactly as its author wrote it: the index derives nothing
// and classifies nothing by kind, name or label.
//
// Every field is always present. The server sends each key carrying its empty
// value when the document declares nothing for it, so a reader distinguishes
// "the author declared no description" from "this build sends no description
// field" without guessing — which is why nothing here is optional. labels is
// declared nullable because the published shape admits null there, and the
// compiler states it sends an empty object instead; a reader coalesces rather
// than relying on the stronger of the two statements.
//
// origin says where the entity was read from, and file is read together with it
// rather than alone: an entity read from a workspace document reports that
// document's workspace-RELATIVE path, while one resolved from a configured
// catalog directory reports an EMPTY path. That empty path is a complete answer
// rather than a gap — the only path such an entity has names a location on the
// machine the server runs on, which resolves against nothing on this side of
// the connection — and origin is the field that makes it readable as such.
export type CatalogIndexEntity = wire.CatalogEntity;

// The origin values the server sends.
//
// These are a DELIBERATE second copy of values the server declares, recorded as
// one so nobody later unifies them away as an accident. The shape above is the
// compiler's own, consumed rather than restated — but it types this member as a
// plain string and publishes no closed set of the values it takes, so there is
// still nothing here to import and nothing to unify with.
//
// Two things hold the copies in step, and the second matters more than the
// first. The suite reads them back from a response RECORDED from the running
// server, so a reading here that stops matching that response fails — which
// binds this side to what was recorded, and correspondingly obliges a change on
// the server's side to re-record it. And the classification below is written so
// that an origin matching neither value yields no open target rather than a
// guessed one: a value that moves therefore costs a reader an affordance they
// can see is missing, never a click that opens the wrong thing.
export const ENTITY_ORIGIN_WORKSPACE = 'workspace';
export const ENTITY_ORIGIN_CATALOG = 'catalog';

// CatalogIndexDoc is the top level of the index response. The compiler states it
// sends an array rather than null when the workspace declares no entity; the
// published shape admits null, so a reader coalesces rather than relying on the
// stronger of the two statements.
export type CatalogIndexDoc = wire.CatalogIndexResult;

// --- reader-facing wording -----------------------------------------------

// EMPTY_LABEL is the row for a workspace the server read successfully and found
// no entity in. An empty index is a complete answer rather than a failure,
// which is why it gets a row of its own and never the failure wording: one says
// "there is nothing here" and the other says "we do not know what is here".
export const EMPTY_LABEL = 'No entities in this workspace.';

// FAILURE_LABEL points at the channel that carries the server's own message
// verbatim. The row stays one short line because a tree row is not a place to
// render a diagnostic; the full text reaches the reader through the channel and
// through this row's detail.
export const FAILURE_LABEL =
  'Could not read the workspace catalog — see the Aggrega output channel.';

// SERVER_STOPPED_LABEL is the row for an anchored workspace whose language
// server is not running. It is distinct from FAILURE_LABEL on purpose: a server
// that has not started yet is an ordinary transient state, and wording it as a
// failure would send a reader looking for a fault that is not there.
export const SERVER_STOPPED_LABEL = 'The Aggrega language server is not running.';

// serverStoppedNode is that row as every list panel draws it whose list is the
// language server's answer: the line above, the hover the status bar's indicator
// gives for the same state, and a press that starts the server — the act the
// indicator offers for it, so the row leads somewhere rather than only saying
// where things stand.
//
// It is the one composition of the row. The Registries panel draws it as this
// panel does, because its list is the language server's answer too and the state
// is the same one; two compositions would come to word one state two ways.
export function serverStoppedNode(): { kind: 'message'; label: string; detail: string; press: PanelActionPress } {
  return {
    kind: 'message',
    label: SERVER_STOPPED_LABEL,
    detail: daemonStandingTooltip('notRunning', true),
    press: startServerPress(),
  };
}

// CATALOG_ORIGIN_LABEL is the row's note for an entity that came from one of
// the catalog directories the workspace configures rather than from a document
// in the workspace.
//
// It says where the entity came from and stops there. Such an entity is
// present, named and usable — it is what a Recipe or an Aggregate resolves by
// name — so wording this as something missing or unavailable would report a
// fault where there is none. It is the same distinction the empty and failure
// rows above draw, one step further in: "this came from somewhere else" is a
// fact about the entity, not a limit on it.
//
// "catalog directory" is the reader's own term for it: these are the
// directories their configuration's workspace block names. Naming the
// directories rather than the catalog keeps it distinct from the published
// catalog the search palette reaches, which is a registry and not a directory.
export const CATALOG_ORIGIN_LABEL = 'from a configured catalog directory';

// ENTITY_ICON is the editor's own theme-icon id, so the tree follows the
// reader's theme rather than shipping bitmaps. One icon serves every entity of
// a given origin: choosing one per kind would mean holding a kind list here,
// and the index reports whatever kind an author wrote rather than a closed set.
const ENTITY_ICON = 'file-code';

// CATALOG_ENTITY_ICON marks a row that is not a file in this workspace. It
// varies on origin, which is a two-valued fact the server states, and not on
// kind, which is the open set ENTITY_ICON declines to hold a list of. The file
// icon is wrong on such a row for the same reason the row opens nothing: it
// would draw a file the reader cannot go to, and the icon is what they read
// before the note beside it.
const CATALOG_ENTITY_ICON = 'library';

// --- row shaping ---------------------------------------------------------

// WorkspaceEntityRow is one entity rendered for display, with every string
// already decided. Shaping it here — free of editor types — is what makes the
// rendering assertable without an extension host: a test reads back exactly the
// line an author would see.
export interface WorkspaceEntityRow {
  // label is the name the author declared, because that is how the entity is
  // referred to everywhere else.
  label: string;
  // name is the identity, and it is the value an inspection is invoked with.
  //
  // It carries the same string the label does, and it is a field of its own
  // rather than a second reading of that one: the label is a display string and
  // this is an invocation subject. Those are separate jobs, and a later change
  // to what a row reads would otherwise silently change what its operations act
  // on, with nothing failing.
  name: string;
  // entityPath is the workspace-relative path of the document that declares
  // this entity, and it is the value a path-taking operation is invoked with. It
  // is empty for an entity the workspace holds no document for.
  //
  // Relative rather than absolute, because the invocation runs in the workspace
  // root: the relative form resolves there, and it is the path the reader
  // recognizes in the command line the run reports.
  //
  // It is carried separately from openPath even though both answer to the same
  // document, because they are consumed in different terms — one is a path an
  // editor opens, the other an argument a command takes — and each is correct
  // only in its own form.
  entityPath: string;
  // description is the dimmed secondary line: where the entity came from when
  // that is worth saying, then the labels the author declared, as key=value.
  // Labels get this slot rather than the description text because a label is
  // what a selector matches on, so it is the fact a reader scanning the list is
  // looking for. An entity declaring none leaves that part empty rather than
  // carrying a placeholder.
  //
  // The origin note leads, and the labels are pushed right by it, because it
  // says whether the row can be opened at all — and because the labels are
  // repeated in the tooltip while a truncated line's tail is not recoverable
  // anywhere else.
  description: string;
  // originLabel is the origin note alone, empty for an entity read from a
  // workspace document. It is carried separately as well as composed into
  // description so the note is assertable on its own, without a test having to
  // take it apart from whatever labels sit beside it.
  originLabel: string;
  // tooltip repeats every fact one per line, named, so a reader who needs them
  // unambiguously gets them named rather than positional — the author's own
  // description text among them.
  tooltip: string;
  // icon is a theme-icon id.
  icon: string;
  // openPath is the absolute path this row opens, resolved from the
  // workspace-relative path the server reported — or null when the entity is
  // not a document in this workspace and there is therefore nothing to open.
  //
  // Null rather than an empty string: an empty string is a path that resolves,
  // and joining one onto the workspace root yields the root itself, so a row
  // that has nothing to open would offer to open the whole workspace. The
  // absence has to be a value no path operation accepts.
  openPath: string | null;
  // acceptance is what the compiler accepts a document of this row's kind for,
  // read from its answer naming the kinds — or null where that answer holds no
  // such kind, or could not be read, either of which accepts nothing. Which of the
  // row's operations are offered is decided from it in one place, beside the value
  // the manifest targets the row with, and not here.
  acceptance: EntityKindAcceptance | null;
}

// WorkspaceCatalogNode is what the tree renders: a kind heading, an entity
// under one, or a single line explaining why there is neither.
//
// The three no-entity states — nothing anchored, no language server, and a
// server that could not answer — are distinct messages on purpose, and an empty
// index is a fourth. A reader must be able to tell "you have authored none"
// from "we cannot tell you", because only one of them is something to fix.
export type WorkspaceCatalogNode =
  | { kind: 'group'; label: string; rows: WorkspaceEntityRow[] }
  | { kind: 'entry'; row: WorkspaceEntityRow }
  | { kind: 'message'; label: string; detail?: string; press?: PanelActionPress };

// labelSegments renders an entity's labels as key=value, in the order they
// arrived. The server emits them in a deterministic order, so preserving it
// keeps one ordering with one owner; re-sorting here would be a second home for
// a decision the server has already made.
export function labelSegments(labels: Record<string, string>): string[] {
  return Object.entries(labels).map(([key, value]) => `${key}=${value}`);
}

// rowForEntity shapes one entity.
//
// A field the author did not declare contributes nothing — no blank segment and
// no named-but-empty tooltip line — so the row reports what was written rather
// than what the shape allows.
//
// What the row may do is decided by the origin the server states, never by
// reading the file path it sent. The empty path a catalog-resolved entity
// carries is a consequence of that origin, and reading the consequence would be
// a second answer to a question the server already answers — one that agrees
// with the first only for as long as the server expresses the consequence the
// same way. So the origin is read, and read once.
//
// An origin matching neither declared value is classified as neither: it gets
// no open target, because only a workspace document's path resolves against
// this root, and no note claiming a source this reader cannot be told about.
//
// kinds is the compiler's answer naming the kinds, read once for the whole
// index; the row takes the entry for the kind its document declares.
export function rowForEntity(
  workspaceRoot: string,
  entity: CatalogIndexEntity,
  kinds: readonly EntityKind[],
): WorkspaceEntityRow {
  const labels = labelSegments(entity.labels ?? {});
  const fromWorkspace = entity.origin === ENTITY_ORIGIN_WORKSPACE;
  const originLabel = entity.origin === ENTITY_ORIGIN_CATALOG ? CATALOG_ORIGIN_LABEL : '';
  // A document is what both the open target and every path-taking operation
  // need, and having one takes BOTH a workspace origin and a path to go with
  // it. The origin alone is not enough: an empty path joined onto the workspace
  // root yields the root itself, so reading the origin by itself would hand a
  // reader a row offering to open — and to publish, lint or check — the whole
  // workspace directory. The two facts are therefore read together, once, and
  // everything that depends on having a document reads the answer.
  const hasDocument = fromWorkspace && entity.file !== '';

  const lines = [`kind: ${entity.kind}`, `name: ${entity.name}`];
  if (entity.apiVersion) { lines.push(`apiVersion: ${entity.apiVersion}`); }
  if (entity.description) { lines.push(`description: ${entity.description}`); }
  for (const segment of labels) { lines.push(`label: ${segment}`); }
  // The relative path is what the reader recognizes and what names the file
  // this row opens; the absolute form it resolves to is not shown, because it
  // says nothing a reader working inside the workspace needs. An entity with no
  // document in this workspace contributes no such line, the same way an
  // undeclared description contributes none, and carries where it came from
  // instead — so the tooltip answers "where is this from" either way, and never
  // with a name followed by nothing.
  if (entity.file) { lines.push(`file: ${entity.file}`); }
  if (originLabel) { lines.push(originLabel); }

  // The two parts of the dimmed line are separated by a dash rather than by the
  // labels' own separator: the note is not another label, and running it into
  // the same list would present it as one the author had declared.
  const labelLine = labels.join(' · ');
  const description = originLabel && labelLine
    ? `${originLabel} — ${labelLine}`
    : originLabel || labelLine;

  return {
    label: entity.name,
    name: entity.name,
    entityPath: hasDocument ? entity.file : '',
    description,
    originLabel,
    tooltip: lines.join('\n'),
    icon: fromWorkspace ? ENTITY_ICON : CATALOG_ENTITY_ICON,
    openPath: hasDocument ? path.join(workspaceRoot, entity.file) : null,
    acceptance: acceptanceFor(kinds, entity.kind),
  };
}

// nodesForDocument groups a whole index response under kind headings.
//
// The grouping is a single forward walk that opens a new heading whenever the
// kind changes, so the result carries the server's order exactly and cannot
// reorder anything: the server sorts by kind, then name, then source file, and
// a reader comparing this view against any other rendering of that index must
// see one order. Collecting into a map keyed by kind would look equivalent and
// is not — it would silently re-gather a kind the server had split, presenting
// an order the server never sent, so a walk that shows two headings of one kind
// is the honest outcome rather than a defect to paper over.
export function nodesForDocument(
  workspaceRoot: string,
  doc: CatalogIndexDoc,
  kinds: readonly EntityKind[],
): WorkspaceCatalogNode[] {
  const entities = doc.entities ?? [];
  if (entities.length === 0) {
    return [{ kind: 'message', label: EMPTY_LABEL }];
  }
  const groups: { kind: 'group'; label: string; rows: WorkspaceEntityRow[] }[] = [];
  for (const entity of entities) {
    const open = groups[groups.length - 1];
    if (!open || open.label !== entity.kind) {
      groups.push({ kind: 'group', label: entity.kind, rows: [] });
    }
    groups[groups.length - 1].rows.push(rowForEntity(workspaceRoot, entity, kinds));
  }
  return groups;
}

// --- the run -------------------------------------------------------------

// WorkspaceCatalogLog is the reader-visible channel the run appends to — the
// server's own report, verbatim.
export interface WorkspaceCatalogLog {
  appendLine(text: string): void;
}

// WorkspaceCatalogRunDeps supplies the run's surfaces: the anchored root the
// relative paths resolve against, whether the server can be asked at all, the
// two requests, and the log that carries the server's message when one fails.
export interface WorkspaceCatalogRunDeps {
  getWorkspaceRoot(): string | null;
  isLanguageServerRunning(): boolean;
  // requestCatalogIndex asks the server for the workspace's entity index. It
  // resolves the parsed response, and rejects with the server's own message
  // when the request could not be answered.
  requestCatalogIndex(): Promise<CatalogIndexDoc>;
  // entityKinds asks the server which kinds an author writes a document of, and
  // what each operation on a row accepts a document of each kind for. It is the
  // same request the drafting flow reads the kinds from, and it rejects with the
  // server's own message when it could not be answered.
  entityKinds(): Promise<unknown>;
  log: WorkspaceCatalogLog;
}

// workspaceCatalogNodes enumerates the open workspace's entities for display.
//
// The extension walks no workspace of its own. The server reports the index it
// derives from the workspace it reads — the editor's unsaved buffers included,
// ahead of the bytes on disk — so this view and the compiler agree on what the
// workspace contains. Deriving a second answer here would show a set the
// compiler is not using whenever the two walks disagreed, and nothing would
// report the disagreement.
export async function workspaceCatalogNodes(
  deps: WorkspaceCatalogRunDeps,
): Promise<WorkspaceCatalogNode[]> {
  const workspaceRoot = deps.getWorkspaceRoot();
  if (!workspaceRoot) {
    return [{ kind: 'message', label: NO_ANCHORED_WORKSPACE_TREE_LABEL }];
  }
  if (!deps.isLanguageServerRunning()) {
    return [serverStoppedNode()];
  }
  let doc: CatalogIndexDoc;
  try {
    doc = await deps.requestCatalogIndex();
  } catch (err) {
    // The message is the server's own text, carried through unchanged: a
    // re-worded wrapper would hide the remediation it already named.
    const message = err instanceof Error ? err.message : String(err);
    deps.log.appendLine(message);
    return [{ kind: 'message', label: FAILURE_LABEL, detail: message }];
  }
  return nodesForDocument(workspaceRoot, doc, await rowKinds(deps, doc));
}

// rowKinds reads the kinds answer the rows of one index are classified against.
//
// 🔴 IT IS ASKED ON EVERY READ OF THE LIST AND KEPT FOR NONE. Which operations
// accept which kinds is a property of the binary on the other end, so an answer
// kept past the server that gave it would offer, after a restart onto another
// binary, what the previous one accepted.
//
// It is not asked where the index holds no entity, since there is then no row to
// classify. A failed read still draws the rows: the entities are known, and only
// what the compiler accepts for their kinds is not, so every operation that
// depends on that is withheld and the rest stay. The failure goes to the channel
// in the sentence the drafting flow ends the same failed read in, the server's
// own words carried unchanged; it raises no notification and draws no row, as the
// index's own failure raises none, because the list is read again on every
// document change and a notification would repeat with each one.
async function rowKinds(
  deps: WorkspaceCatalogRunDeps,
  doc: CatalogIndexDoc,
): Promise<EntityKind[]> {
  if ((doc.entities ?? []).length === 0) {
    return [];
  }
  try {
    return readEntityKinds(await deps.entityKinds());
  } catch (err) {
    deps.log.appendLine(terminalLine(ENTITY_KIND_READ, outcomeOf(err)));
    return [];
  }
}
