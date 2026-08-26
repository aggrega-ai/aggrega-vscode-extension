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
  source: 'aggrega';
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
    source: 'aggrega',
  };
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
