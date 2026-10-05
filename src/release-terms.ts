// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { CatalogIndexParams, EntityDefinitionParams } from './types';

// A workspace may give each of its Releases catalog directories of its own, and
// then which entities a request can see, the entity a name resolves to and what a
// reference in a document points at all depend on which Release is asked about.
// The language server answers such a request in a Release's terms when the
// request names one, and in the workspace's own terms when it names none. This
// module is where every such request is given its Release: the editor's selected
// one, or for the index asked beside what may attach, the one the graph was drawn
// from.

// ReleaseTerms is the one field such a request names the Release under: a path
// relative to the workspace root, the form the selection holds it in.
export interface ReleaseTerms {
  release?: string;
}

// inReleaseTerms composes a request the language server answers in a Release's
// terms, from the request's own parameters and the editor's selected Release.
//
// 🔴 IT IS THE ONE HOME FOR THAT COMPOSITION, and every such request is composed
// through it: an open document's validation, the Catalog panel's listing, an
// inspection by name, hover, completion, go-to-definition, references and
// implementations, and — in the form the command line takes — the Catalog row's
// correctness check. A request that composed its own would answer from the whole
// workspace while the reader is working on one Release, and nothing on screen
// would say so: every variant listed, a name resolved to the first variant found.
//
// The field is present when a Release is selected and omitted when none is, which
// is the request a workspace holding no Release to name has always sent. It is
// never sent empty: an empty value names nothing, so it is read as no selection.
export function inReleaseTerms<P extends object>(params: P, selectedRelease: string | null): P & ReleaseTerms {
  if (!selectedRelease) {
    return { ...params };
  }
  return { ...params, release: selectedRelease };
}

// releaseFlag is the same composition for an operation the editor runs as a
// command: `--release <file>` where a Release is selected, nothing where none is.
// It reads the decision above rather than restating it, so the two forms cannot
// come to disagree about when a Release is named.
export function releaseFlag(selectedRelease: string | null): string[] {
  const { release } = inReleaseTerms({}, selectedRelease);
  return release === undefined ? [] : ['--release', release];
}

// catalogIndexParams composes the Catalog panel's listing, which every surface
// offering the workspace's entities by name reads, and the index the list of what
// may attach asks beside it, in the terms of the Release its graph was drawn from.
export function catalogIndexParams(release: string | null): CatalogIndexParams {
  return inReleaseTerms({}, release);
}

// entityDefinitionParams composes an inspection of the entity name resolves to.
export function entityDefinitionParams(name: string, selectedRelease: string | null): EntityDefinitionParams {
  return inReleaseTerms({ name }, selectedRelease);
}
