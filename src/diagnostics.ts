// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as vscode from 'vscode';
import { DaemonDiagnostic } from './types';
import { ConvertedShape, SeverityToken, shapeForDaemonDiagnostic } from './diagnostics-shape';
import { LintFindingShape } from './lint-run';

// convertDaemonDiagnostic maps the daemon's per-file diagnostic
// wire shape to a vscode.Diagnostic. Delegates the position/severity
// math to the pure helper in diagnostics-shape so the conversion
// logic stays testable without the vscode runtime.
export function convertDaemonDiagnostic(d: DaemonDiagnostic): vscode.Diagnostic {
  const shape = shapeForDaemonDiagnostic(d);
  return diagnosticFromShape(shape);
}

// publishDiagnostics replaces the collection's entries for uri with
// the converted daemon diagnostics. An empty list clears that URI's
// entry; the rest of the collection is untouched.
//
// Thin wrapper over publishDiagnosticsBatch — both paths share the
// same per-entry semantics so single-file and workspace-wide
// publishes behave identically.
export function publishDiagnostics(
  collection: vscode.DiagnosticCollection,
  uri: vscode.Uri,
  daemonDiagnostics: DaemonDiagnostic[],
): void {
  publishDiagnosticsBatch(collection, new Map([[uri, daemonDiagnostics]]));
}

// publishDiagnosticsBatch replaces the collection's entries for
// every URI in batch with the corresponding converted daemon
// diagnostics. Per-URI semantics match publishDiagnostics — an
// empty diagnostics array clears that URI's entry; URIs not present
// in the batch are untouched.
//
// The batch surface anticipates a future workspace-wide validate
// trigger that emits diagnostics for many files in a single
// daemon response. Per-file callers continue to flow through
// publishDiagnostics; the batch path applies to both.
export function publishDiagnosticsBatch(
  collection: vscode.DiagnosticCollection,
  batch: Map<vscode.Uri, DaemonDiagnostic[]>,
): void {
  for (const [uri, diagnostics] of batch) {
    collection.set(uri, diagnostics.map(convertDaemonDiagnostic));
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

// replaceLintFindings makes byFile the whole content of the lint collection:
// every entry the previous run published is dropped first, so a finding the
// author has since fixed disappears instead of accumulating across runs.
//
// The collection passed here is the conventions linter's own, never the
// language server's. The two are kept apart because each replaces its own
// entries wholesale: sharing one would make a validation publish drop a file's
// lint findings, and a lint run erase every validation result.
//
// Keys are the absolute paths the linter reported, used directly as file URIs —
// they are not resolved against the workspace root.
export function replaceLintFindings(
  collection: vscode.DiagnosticCollection,
  byFile: Map<string, LintFindingShape[]>,
): void {
  collection.clear();
  for (const [file, shapes] of byFile) {
    collection.set(vscode.Uri.file(file), shapes.map(diagnosticFromLintShape));
  }
}

// diagnosticFromLintShape constructs the editor diagnostic for one finding.
// The rule id becomes the diagnostic's code and the linter its source, so the
// Problems panel names which rule fired and groups conventions findings apart
// from validation results. The message is the linter's own text, unchanged.
function diagnosticFromLintShape(shape: LintFindingShape): vscode.Diagnostic {
  const diag = diagnosticFromShape(shape);
  diag.code = shape.ruleId;
  return diag;
}

// diagnosticFromShape builds the editor diagnostic every publish path goes
// through, so the position and severity translation happens in one place
// whichever surface produced the shape. ConvertedShape and LintFindingShape
// are structurally compatible in the fields read here.
function diagnosticFromShape(shape: ConvertedShape | LintFindingShape): vscode.Diagnostic {
  const range = new vscode.Range(
    new vscode.Position(shape.startLine, shape.startChar),
    new vscode.Position(shape.endLine, shape.endChar),
  );
  const diag = new vscode.Diagnostic(range, shape.message, vscSeverityFromToken(shape.severity));
  diag.source = shape.source;
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
