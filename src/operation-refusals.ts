// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { ConvertedShape } from './diagnostics-shape';
import { refusalDocument, refusalEntry } from './error-surfaces';
import { isJsonRpcError } from './error-text';
import { ERR_SHUTTING_DOWN } from './types';

// This module decides what a refusal of a build, a preview or a graph leaves in
// the Problems panel, and for how long. It reaches no editor type, so the rule
// is driven by a test rather than through an editor; the extension supplies the
// collection the entries land in.
//
// Such a refusal is about a Release rather than about the document it is filed
// on, so it is kept apart from the documents' own findings: the document's
// close and its next validation leave it where it is. It leaves when the
// Release is answered again without it — a later build, preview or graph that
// completes, or that is refused for something else about the Release — which is
// the moment the compiler stops reporting it.

// OPERATION_REFUSALS_COLLECTION names the collection those entries are kept in.
// The name is the extension's own: no entry carries it, and each entry names its
// layer the way every other refusal does.
export const OPERATION_REFUSALS_COLLECTION = 'aggrega-operation-refusals';

// Settled is how one build, preview or graph request ended: answered, or
// rejected with what it was rejected with.
export type Settled = { answered: unknown } | { thrown: unknown };

// RefusalFiling is one entry an answer files, and the document it is filed on.
export interface RefusalFiling {
  document: string;
  entry: ConvertedShape;
}

// filingsForAnswer decides what one request's ending files for its Release, in
// place of what that Release's earlier answers filed.
//
//   - Answered: nothing, so whatever an earlier answer filed leaves.
//   - Refused: the refusal's entry, on the document it is about, where its
//     surface is an entry; nothing otherwise, so the earlier entry leaves.
//   - Never answered — stopped by the reader, or the server gone: undefined,
//     which replaces nothing. Nothing was learned about the Release, so what the
//     last answer filed still stands. A refusal because the server is shutting
//     down is one of these: a server shutting down refuses every request it is
//     sent from then on, before reading it, so the refusal says the server is
//     going and nothing about the Release.
//
// subject is the Release the request named, as the request named it: it is
// where an entry is filed when the refusal names no document of its own. A
// document the refusal names is returned as it was written there.
export function filingsForAnswer(settled: Settled, subject: string): RefusalFiling[] | undefined {
  if ('answered' in settled) {
    return [];
  }
  const err = settled.thrown;
  if (!isJsonRpcError(err)) {
    return undefined;
  }
  if (err.code === ERR_SHUTTING_DOWN) {
    return undefined;
  }
  const entry = refusalEntry(err);
  if (!entry) {
    return [];
  }
  const document = refusalDocument(err, subject);
  return document ? [{ document, entry }] : [];
}

// RefusalSink is the collection the entries land in, addressed by the name each
// filing gives its document.
export interface RefusalSink {
  set(document: string, entries: ConvertedShape[]): void;
  delete(document: string): void;
  clear(): void;
}

// OperationRefusals keeps, for each Release, what its last answer filed.
export interface OperationRefusals {
  // replace files what one answer for release filed, in place of what that
  // Release's earlier answers filed.
  replace(release: string, filings: RefusalFiling[]): void;
  // holds reports whether an entry stands on document.
  holds(document: string): boolean;
  // clear forgets every entry. What a language server said is forgotten when a
  // new one starts, and these entries are what one said.
  clear(): void;
}

// createOperationRefusals builds the store over the collection it fills.
//
// One document can carry entries filed for several Releases — two Releases
// reading the same document, each refused over it — so what a document shows is
// the entries every Release filed on it, in the order the Releases came to hold
// entries, with an entry two Releases filed in the same words at the same place
// shown once. Replacing one Release's entries leaves the others'.
//
// Documents are compared by the name each filing gives them, so the caller names
// every document one way.
export function createOperationRefusals(sink: RefusalSink): OperationRefusals {
  const byRelease = new Map<string, Map<string, ConvertedShape[]>>();
  const shownOn = (document: string): ConvertedShape[] => {
    const seen = new Set<string>();
    const shown: ConvertedShape[] = [];
    for (const filed of byRelease.values()) {
      for (const entry of filed.get(document) ?? []) {
        const key = entryKey(entry);
        if (seen.has(key)) { continue; }
        seen.add(key);
        shown.push(entry);
      }
    }
    return shown;
  };
  return {
    replace(release, filings) {
      const touched = new Set<string>(byRelease.get(release)?.keys() ?? []);
      const next = new Map<string, ConvertedShape[]>();
      for (const { document, entry } of filings) {
        touched.add(document);
        const entries = next.get(document);
        if (entries) { entries.push(entry); } else { next.set(document, [entry]); }
      }
      if (next.size === 0) {
        byRelease.delete(release);
      } else {
        byRelease.set(release, next);
      }
      for (const document of touched) {
        const shown = shownOn(document);
        if (shown.length === 0) {
          sink.delete(document);
        } else {
          sink.set(document, shown);
        }
      }
    },
    holds(document) {
      for (const filed of byRelease.values()) {
        if ((filed.get(document)?.length ?? 0) > 0) { return true; }
      }
      return false;
    },
    clear() {
      byRelease.clear();
      sink.clear();
    },
  };
}

// entryKey is what makes two entries the same finding: the same place, the same
// words, the same severity, layer and codes.
function entryKey(e: ConvertedShape): string {
  return JSON.stringify([
    e.startLine, e.startChar, e.endLine, e.endChar, e.severity, e.message, e.source,
    e.code ?? null, e.shortCode ?? null, e.codeHref ?? null,
  ]);
}
