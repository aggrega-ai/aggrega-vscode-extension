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

// The two values a row of this panel carries, and the reason there are two.
//
// Every operation on this panel needs a subject, and the rows do not all carry
// the same one. A row backed by a document in this workspace can name a path; a
// row for an entity that resolves without one cannot, because the only path such
// an entity has names a location this side of the connection resolves nothing
// against. Publishing, linting and checking one entity all take a path, so they
// are offered on the first and withheld from the second — not as a judgement
// about the entity, but because an invocation naming no path cannot succeed.
//
// The distinction is drawn on whether the row HAS a document rather than on
// where the entity came from, and those are not the same question: an origin
// this build has no reading for also yields no path, and it must fall on the
// withholding side rather than be assumed to behave like a workspace document.
//
// A kind heading and a message row carry neither value. A heading names a kind
// and a message explains why there is nothing to name, so an operation on either
// could only be invoked with no subject at all.
export const CATALOG_DOCUMENT_ROW_CONTEXT = 'aggrega.catalogEntity.document';
export const CATALOG_NO_DOCUMENT_ROW_CONTEXT = 'aggrega.catalogEntity.noDocument';

// catalogRowContext reports the value a node's row operations are bound to, or
// null when the node admits none.
//
// It is the one place a node is classified, so the value the view sets and the
// value the manifest targets cannot be decided by two different readings.
export function catalogRowContext(node: WorkspaceCatalogNode): string | null {
  if (node.kind !== 'entry') {
    return null;
  }
  return node.row.entityPath === ''
    ? CATALOG_NO_DOCUMENT_ROW_CONTEXT
    : CATALOG_DOCUMENT_ROW_CONTEXT;
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
// which is the name the row already displays.
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
