// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { DaemonDiagnostic } from './types';

// SeverityToken is the normalized severity value the diagnostic
// surface emits. Maps cleanly to vscode.DiagnosticSeverity at the
// vscode-coupled wrapper boundary.
export type SeverityToken = 'error' | 'warning' | 'information';

// ConvertedShape carries the pure conversion of a daemon diagnostic
// into 0-based VS Code position semantics, without depending on any
// vscode runtime type. The vscode-coupled wrapper in diagnostics.ts
// constructs vscode.Diagnostic from this shape.
export interface ConvertedShape {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  severity: SeverityToken;
  message: string;
  // source is the layer the daemon named, carried through unchanged. It is a
  // free string rather than a fixed set because the compiler decides which
  // layers exist; the extension only groups by the answer.
  source: string;
}

// shapeForDaemonDiagnostic produces the pure conversion shape. The
// daemon's line/column are 1-based; VS Code positions are 0-based.
// When the daemon supplies end_line/end_column the range spans the
// whole token; absent (or non-positive), the range is point-style —
// start equals end. Non-positive inputs are clamped at 0 to defend
// against malformed daemon output.
export function shapeForDaemonDiagnostic(d: DaemonDiagnostic): ConvertedShape {
  const line = zeroBasedFromOneBased(d.line);
  const character = zeroBasedFromOneBased(d.column);
  const hasEnd =
    typeof d.end_line === 'number' &&
    d.end_line > 0 &&
    typeof d.end_column === 'number' &&
    d.end_column > 0;
  return {
    startLine: line,
    startChar: character,
    endLine: hasEnd ? zeroBasedFromOneBased(d.end_line!) : line,
    endChar: hasEnd ? zeroBasedFromOneBased(d.end_column!) : character,
    severity: severityTokenFromString(d.severity),
    message: d.message,
    source: sourceForDaemonDiagnostic(d),
  };
}

// DIAGNOSTIC_SOURCE_FALLBACK is the source a diagnostic is filed under when the
// daemon supplied none.
//
// The case it covers: a daemon whose diagnostics predate the per-layer source
// field, so nothing on the wire says which layer raised the finding. Filing it
// under the document-validation layer keeps it visible in the group an editor
// already shows, which is where every diagnostic used to appear; filing it
// under an empty name would hide it in an unnamed group instead.
export const DIAGNOSTIC_SOURCE_FALLBACK = 'aggrega';

// sourceForDaemonDiagnostic reads the layer name off one daemon diagnostic,
// substituting the fallback when the field is absent or empty. Every surface
// that needs a diagnostic's source — the shape conversion and the per-source
// grouping — reads it through here, so the fallback is decided in one place.
export function sourceForDaemonDiagnostic(d: DaemonDiagnostic): string {
  return typeof d.source === 'string' && d.source.length > 0
    ? d.source
    : DIAGNOSTIC_SOURCE_FALLBACK;
}

// groupDiagnosticsBySource partitions one file's daemon diagnostics by the layer
// that raised them, so each layer can be published into its own collection and
// therefore cleared independently.
//
// Group order is first-appearance order in the daemon's list, and each group
// preserves the daemon's relative order within it, so the same wire payload
// always produces the same grouping.
export function groupDiagnosticsBySource(
  diagnostics: DaemonDiagnostic[],
): Map<string, DaemonDiagnostic[]> {
  const bySource = new Map<string, DaemonDiagnostic[]>();
  for (const d of diagnostics) {
    const source = sourceForDaemonDiagnostic(d);
    const group = bySource.get(source);
    if (group) {
      group.push(d);
    } else {
      bySource.set(source, [d]);
    }
  }
  return bySource;
}

// zeroBasedFromOneBased converts one 1-based compiler line or column into the
// 0-based position VS Code takes, clamping at 0 to defend against malformed
// output. Every surface that consumes a compiler position converts through
// here, so the two conventions meet in exactly one place.
export function zeroBasedFromOneBased(n: number): number {
  return Math.max(0, n - 1);
}

// severityTokenFromString normalizes a severity field arriving from the
// compiler. Both spellings the compiler uses for the middle tier are
// accepted: the language server writes "warning", and the conventions
// linter's structured output writes "warn". Unknown values default to
// 'error' so unmapped severities surface visibly rather than disappearing
// into the Information tier.
export function severityTokenFromString(s: string): SeverityToken {
  switch (s) {
    case 'error':
      return 'error';
    case 'warn':
    case 'warning':
      return 'warning';
    case 'info':
    case 'information':
      return 'information';
    default:
      return 'error';
  }
}
