// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { DIAGNOSTIC_SOURCE_BUILD } from './diagnostics-shape';

// This module decides what a document's close takes out of the Problems panel.
// It reaches no editor type, so the rule is driven by a test with a registry of
// its own rather than through an editor.

// ClosableLayers is what a close reaches of the per-layer registry: the layers
// seen so far, and each one's collection, to take the closed document out of.
// The registry the extension files the language server's findings in has this
// shape as it stands.
export interface ClosableLayers<U> {
  for(source: string): { delete(uri: U): void };
  known(): Iterable<string>;
}

// closeKeeps reports whether a layer's findings about a document stay in the
// Problems panel once the editor closes that document. The build's layer is the
// one that stays, for the reason given where its name is declared.
export function closeKeeps(source: string): boolean {
  return source === DIAGNOSTIC_SOURCE_BUILD;
}

// clearClosedDocument takes a closed document's findings out of every layer
// whose findings leave with it.
//
// The refusal of a build, a preview or a graph is not in this registry at all —
// it is kept in a collection of its own — so a close cannot reach it whatever
// this decides.
export function clearClosedDocument<U>(layers: ClosableLayers<U>, uri: U): void {
  for (const source of layers.known()) {
    if (closeKeeps(source)) { continue; }
    layers.for(source).delete(uri);
  }
}
