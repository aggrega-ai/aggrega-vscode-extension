// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { DaemonDiagnostic } from './types';
import {
  ConvertedShape,
  SeverityToken,
  editorCodeForShape,
  groupDiagnosticsBySource,
  shapeForDaemonDiagnostic,
} from './diagnostics-shape';
import { LintPublication, applyLintPublication } from './lint-run';

// convertDaemonDiagnostic maps the daemon's per-file diagnostic
// wire shape to a vscode.Diagnostic. Delegates the position/severity
// math to the pure helper in diagnostics-shape so the conversion
// logic stays testable without the vscode runtime.
export function convertDaemonDiagnostic(d: DaemonDiagnostic): vscode.Diagnostic {
  const shape = shapeForDaemonDiagnostic(d);
  return diagnosticFromShape(shape);
}

// SourcedCollections hands out one diagnostic collection per compiler layer,
// creating a collection the first time a layer is seen.
//
// One collection per layer is what makes the layers independently clearable: a
// layer replaces its own entry for a file and a layer that stops reporting has
// its entry removed, neither touching the other. A single shared collection
// cannot express that — a publish carrying one layer's findings would have to
// either drop the other layer's or leave them unclearable.
export interface SourcedCollections {
  // for returns the collection owning source, creating it on first use.
  for(source: string): vscode.DiagnosticCollection;
  // known enumerates every source a collection has been created for, so a
  // publish can clear the layers its payload no longer mentions.
  known(): Iterable<string>;
}

// createSourcedCollections builds the registry, naming each collection after
// the layer it holds and handing every collection it creates to register so the
// caller's disposal chain tears them down.
export function createSourcedCollections(
  register: (disposable: vscode.Disposable) => void,
): SourcedCollections {
  const collections = new Map<string, vscode.DiagnosticCollection>();
  return {
    for(source: string): vscode.DiagnosticCollection {
      const existing = collections.get(source);
      if (existing) { return existing; }
      const created = vscode.languages.createDiagnosticCollection(source);
      collections.set(source, created);
      register(created);
      return created;
    },
    known(): Iterable<string> {
      return [...collections.keys()];
    },
  };
}

// publishDiagnostics replaces every layer's entries for uri with the converted
// daemon diagnostics, one collection per layer. An empty list clears the URI in
// every layer; other URIs are untouched.
//
// Thin wrapper over publishDiagnosticsBatch — both paths share the same
// per-entry semantics so single-file and workspace-wide publishes behave
// identically.
export function publishDiagnostics(
  collections: SourcedCollections,
  uri: vscode.Uri,
  daemonDiagnostics: DaemonDiagnostic[],
): void {
  publishDiagnosticsBatch(collections, new Map([[uri, daemonDiagnostics]]));
}

// publishDiagnosticsBatch replaces the entries for every URI in batch with the
// corresponding converted daemon diagnostics, routing each diagnostic to the
// collection owning the layer that raised it. Per-URI semantics match
// publishDiagnostics; URIs not present in the batch are untouched.
//
// A layer absent from a URI's payload has that URI cleared from its collection,
// which is what makes a finding that stopped firing disappear rather than
// linger: the daemon replaces a layer wholesale, so "not in this payload" means
// "no longer reported", not "unchanged".
//
// The batch surface anticipates a future workspace-wide validate trigger that
// emits diagnostics for many files in a single daemon response. Per-file
// callers continue to flow through publishDiagnostics; the batch path applies
// to both.
export function publishDiagnosticsBatch(
  collections: SourcedCollections,
  batch: Map<vscode.Uri, DaemonDiagnostic[]>,
): void {
  for (const [uri, diagnostics] of batch) {
    const bySource = groupDiagnosticsBySource(diagnostics);
    for (const source of collections.known()) {
      if (!bySource.has(source)) {
        collections.for(source).delete(uri);
      }
    }
    for (const [source, group] of bySource) {
      collections.for(source).set(uri, group.map(convertDaemonDiagnostic));
    }
  }
}

// clearUriInEverySource removes uri from every layer's collection. Used when a
// document closes, where the answer is the same for all layers: the file is
// gone from the editor, so no layer's findings about it should stay on screen.
export function clearUriInEverySource(
  collections: SourcedCollections,
  uri: vscode.Uri,
): void {
  for (const source of collections.known()) {
    collections.for(source).delete(uri);
  }
}

// publishShapes replaces the collection's entries for uri with
// pre-converted ConvertedShape values. Used by the error-surfaces
// dispatcher, which produces shapes directly without touching the
// vscode runtime; the wrapper here constructs the vscode.Diagnostic
// instances at the boundary.
export function publishShapes(
  collection: vscode.DiagnosticCollection,
  uri: vscode.Uri,
  shapes: ConvertedShape[],
): void {
  collection.set(uri, shapes.map(diagnosticFromShape));
}

// replaceLintFindings carries one publication onto the lint collection.
//
// It is the editor-coupled half and it decides nothing: which entries a run
// supersedes was settled where the publication was composed, so what is left
// here is turning paths into URIs and shapes into diagnostics. That split is
// what makes the decision assertable without an extension host, which is where
// this surface's behaviour is pinned.
//
// The collection passed here is the conventions linter's own, never the
// language server's. The two are kept apart because each replaces its own
// entries: sharing one would make a validation publish drop a file's lint
// findings, and a lint run erase every validation result.
//
// Paths are absolute, already resolved by the caller against the workspace
// root, and are used directly as file URIs.
export function replaceLintFindings(
  collection: vscode.DiagnosticCollection,
  publication: LintPublication,
): void {
  applyLintPublication(
    {
      clearAll: () => collection.clear(),
      clearFile: (file) => collection.delete(vscode.Uri.file(file)),
      setFile: (file, shapes) =>
        collection.set(vscode.Uri.file(file), shapes.map(diagnosticFromShape)),
    },
    publication,
  );
}

// diagnosticFromShape builds the editor diagnostic every publish path goes
// through, so the position and severity translation happens in one place
// whichever layer produced the shape.
//
// The code slot is filled from the shape's identifiers through the shared
// decision, which is where what a reader can DO with a code is decided. Where the
// entry names a registered condition the slot carries the quotable code together
// with the address that condition is explained at, which is what makes the code in
// the Problems panel a link the reader can follow; where it names a class of
// finding the slot carries that identifier alone, with nothing to follow — which
// is the case a conventions rule's identity falls into; and where it names
// nothing the slot is left unset, so the diagnostic is exactly the one this
// extension published before any of these fields existed.
function diagnosticFromShape(shape: ConvertedShape): vscode.Diagnostic {
  const range = new vscode.Range(
    new vscode.Position(shape.startLine, shape.startChar),
    new vscode.Position(shape.endLine, shape.endChar),
  );
  const diag = new vscode.Diagnostic(range, shape.message, vscSeverityFromToken(shape.severity));
  diag.source = shape.source;
  const code = editorCodeForShape(shape);
  if (typeof code === 'string') {
    diag.code = code;
  } else if (code) {
    diag.code = { value: code.value, target: vscode.Uri.parse(code.target) };
  }
  return diag;
}

function vscSeverityFromToken(token: SeverityToken): vscode.DiagnosticSeverity {
  switch (token) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    case 'information':
      return vscode.DiagnosticSeverity.Information;
  }
}
