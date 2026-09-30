// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { WorkspaceCatalogNode } from './workspace-catalog-run';
import { withSubject } from './operation-groups';

// This module decides what a row of the workspace catalog admits, and composes
// the invocation each admitted operation takes.
//
// It imports no editor type, which is what makes every decision here assertable
// without an extension host: a test reads back the exact argument list a press
// would compose, and the exact value the manifest targets a row with.
//
// The publication and the publishing-conventions check are not composed here and
// no longer pass through here. Each is a language-server request taking the row's
// own workspace-relative path as a request parameter, so there is no argument
// list for this module to own or to re-export; the panel reaches both directly.

// CatalogRowOperation names one operation a row of this panel can offer, by the
// last segment of the command the manifest binds for it — which is also the
// token the row's value carries for it, so the manifest's clause for each
// command names that command's own last segment and there is no table pairing
// the two.
export type CatalogRowOperation = 'inspect' | 'validate' | 'lint' | 'push';

// CATALOG_ROW_OPERATIONS is every operation a row can offer, in the order a
// row's value carries them.
export const CATALOG_ROW_OPERATIONS: readonly CatalogRowOperation[] = ['inspect', 'validate', 'lint', 'push'];

// CATALOG_ENTITY_ROW_CONTEXT opens the value an entity row carries. The value is
// this, followed by `:<operation>` for each operation the row offers, and each
// entry in the manifest matches the one operation it binds by a pattern over it.
//
// A value naming each operation, rather than one value for each combination of
// them, is what keeps the manifest from restating the rule below: independent
// operations combine multiplicatively, and a clause listing the combinations an
// operation appears in would be a second statement of when it is offered, in a
// file the rule itself never reads.
export const CATALOG_ENTITY_ROW_CONTEXT = 'aggrega.catalogEntity';

// catalogRowOperations reports which operations a node's row offers, in order,
// or null when the node is not an entity row.
//
// 🔴 THIS IS THE ONE PLACE THE OFFERING IS DECIDED, and it is decided from two
// facts and nothing else: whether the row has a document in this workspace, and
// what the compiler says it accepts a document of the row's kind for.
//
// Every operation on this panel needs a subject, and the rows do not all carry
// the same one. A row backed by a document in this workspace can name a path; a
// row for an entity that resolves without one cannot, because the only path such
// an entity has names a location this side of the connection resolves nothing
// against. Checking one entity, checking its publishing conventions and
// publishing it all take a path, so none is offered on a row with no document —
// not as a judgement about the entity, but because an invocation naming no path
// cannot succeed. The inspection takes the entity's name, which every row
// carries, so a row with no document can still offer it.
//
// The distinction is drawn on whether the row HAS a document rather than on
// where the entity came from, and those are not the same question: an origin
// this build has no reading for also yields no path, and it must fall on the
// withholding side rather than be assumed to behave like a workspace document.
//
// 🔴 AN OPERATION THE COMPILER REFUSES FOR THE ROW'S KIND IS NOT OFFERED, and
// which kinds each accepts is read from the compiler's answer rather than held
// here. The single-entity check, publication by path alone and the inspection
// each refuse some kinds outright — a Release is checked as a Release rather than
// as an entity, a Manifest is published by no registry, a Plugin's publication
// needs its executable beside it — and a row offering one of those would be a
// press that can only be refused. A row whose kind the answer holds no entry for,
// or whose answer could not be read, is offered none of the three. The conventions
// check is offered on every row with a document: the compiler declares no kind it
// refuses it for.
//
// A heading or a message row is not an entity row. A heading names a kind and a
// message explains why there is nothing to name, so an operation on either could
// only be invoked with no subject at all.
export function catalogRowOperations(node: WorkspaceCatalogNode): CatalogRowOperation[] | null {
  if (node.kind !== 'entry') {
    return null;
  }
  const hasDocument = node.row.entityPath !== '';
  const accepts = node.row.acceptance;
  const offered: CatalogRowOperation[] = [];
  if (accepts !== null && accepts.inspectionByName) { offered.push('inspect'); }
  if (hasDocument && accepts !== null && accepts.singleEntityValidation) { offered.push('validate'); }
  if (hasDocument) { offered.push('lint'); }
  if (hasDocument && accepts !== null && accepts.publication) { offered.push('push'); }
  return offered;
}

// catalogRowContext reports the value a node's row operations are bound to, or
// null when the node offers none.
//
// It composes that value from the one decision above, so the value the view sets
// and the value the manifest targets cannot be decided by two different readings.
// A row offering nothing carries no value, and so opens no menu.
export function catalogRowContext(node: WorkspaceCatalogNode): string | null {
  const offered = catalogRowOperations(node);
  if (offered === null || offered.length === 0) {
    return null;
  }
  return [CATALOG_ENTITY_ROW_CONTEXT, ...offered].join(':');
}

// catalogEntityPath reports the document a node's path-taking operations act on,
// or null when the node names none.
//
// A null answer is the signal to invoke nothing: there is no path to name, so
// there is no invocation to compose. It is read through this one extractor
// rather than off the row's open target, which is the same document expressed in
// the terms an editor opens it in rather than the terms a command takes it in.
export function catalogEntityPath(node: WorkspaceCatalogNode): string | null {
  if (node.kind !== 'entry' || node.row.entityPath === '') {
    return null;
  }
  return node.row.entityPath;
}

// catalogEntityName reports the entity a node's identity-taking operations act
// on, or null when the node names none.
//
// Every entity row answers this, whether or not the workspace holds a document
// for it: an entity that resolves is answerable by the name it resolves under,
// which is the name the row already displays. Whether the row offers such an
// operation at all is decided above, not here.
export function catalogEntityName(node: WorkspaceCatalogNode): string | null {
  if (node.kind !== 'entry' || node.row.name === '') {
    return null;
  }
  return node.row.name;
}

// catalogValidateArgs composes the correctness check for one entity. The
// pathless form of this command addresses the whole catalog rather than this
// row, which is a different question and is already offered elsewhere, so the
// path is required here rather than defaulted.
export function catalogValidateArgs(entityPath: string): string[] {
  return withSubject('validate', entityPath, 'the path of the entity to check');
}
