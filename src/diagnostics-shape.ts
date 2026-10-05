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
  // code and shortCode are the compiler's two identifiers for what the entry
  // reports: the one a program matches on, and the one a reader quotes. Both are
  // carried through unchanged.
  //
  // Both are optional and their absence is meaningful rather than incidental, so
  // neither is defaulted here: an entry with no code names nothing registered,
  // and an entry with a code and no quotable one names something that resolves no
  // further. A default would erase the difference the daemon went to trouble to
  // express.
  code?: string;
  shortCode?: string;
  // codeHref is where the condition is explained, as the daemon's
  // code-description structure supplied it. Present only alongside shortCode.
  codeHref?: string;
}

// EditorCode is what an editor diagnostic carries in its code slot: nothing, a
// bare identifier, or an identifier the editor renders as a link to where the
// condition is explained.
//
// The link-bearing form is what turns a code in the Problems panel into
// something a reader can act on. The bare form is a code they can still copy but
// cannot follow, and undefined is an entry that names nothing to copy at all.
export type EditorCode =
  | undefined
  | string
  | { value: string; target: string };

// editorCodeForShape decides which of the three the shape earns, and is where
// that decision lives for every publish path.
//
// It is a pure function rather than part of the editor-coupled construction
// because the decision is the interesting half and the construction is one
// assignment. What a reader ends up able to DO with a diagnostic follows from
// this, so this is what a test asserts against.
//
// The rules, in the order they are checked:
//
//   - No code at all: the entry names nothing registered, so the slot is empty.
//     An editor then shows the message and the source, and nothing else.
//   - A quotable code with somewhere to read about it: the slot carries the
//     QUOTABLE code and the address, so the panel shows the identifier a reader
//     would search for and offers to open the explanation. The machine-matchable
//     code stays on the wire for whatever matches on it; what goes on screen is
//     the one a person can use.
//   - A code with no quotable form: the slot carries that code and no address.
//     A render advisory's class, and the identity of a rule no condition names
//     (one a linter the workspace attaches reports from a rule set of its own),
//     are real identifiers a reader can copy, and neither is explained on the
//     page the address resolves to — so offering to open it would be offering a
//     link that lands somewhere not describing their problem. A
//     publishing-conventions rule Aggrega declares names a condition, so its
//     finding carries a quotable code and an address, and is the case above.
// The parameter is the whole shape rather than the three identifier fields on
// their own, because the shape is what every publish path holds by the time it
// builds an editor diagnostic.
export function editorCodeForShape(shape: ConvertedShape): EditorCode {
  if (shape.shortCode && shape.codeHref) {
    return { value: shape.shortCode, target: shape.codeHref };
  }
  if (shape.shortCode) {
    return shape.shortCode;
  }
  if (shape.code) {
    return shape.code;
  }
  return undefined;
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
  const shape: ConvertedShape = {
    startLine: line,
    startChar: character,
    endLine: hasEnd ? zeroBasedFromOneBased(d.end_line!) : line,
    endChar: hasEnd ? zeroBasedFromOneBased(d.end_column!) : character,
    severity: severityTokenFromString(d.severity),
    message: d.message,
    source: sourceForDaemonDiagnostic(d),
  };
  // Each identifier key is set only when the daemon sent it, so an absent key
  // stays absent on the shape. Assigning undefined instead would put the key
  // there carrying nothing, which reads to anything inspecting the shape as a
  // value the daemon supplied — and the difference between "no code" and "a code
  // that resolves no further" is the distinction these fields exist to carry.
  if (typeof d.code === 'string' && d.code.length > 0) {
    shape.code = d.code;
  }
  if (typeof d.shortCode === 'string' && d.shortCode.length > 0) {
    shape.shortCode = d.shortCode;
  }
  const href = d.codeDescription?.href;
  if (typeof href === 'string' && href.length > 0) {
    shape.codeHref = href;
  }
  return shape;
}

// DIAGNOSTIC_SOURCE_FALLBACK is the source a diagnostic is filed under when the
// daemon supplied none.
//
// The case it covers: a daemon whose diagnostics carry no per-layer source
// field, so nothing on the wire says which layer raised the finding. Filing it
// under the document-validation layer keeps it visible in a group an editor
// already shows; filing it under an empty name would hide it in an unnamed
// group instead.
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
// compiler.
//
// Both spellings the compiler uses for the middle tier are accepted. The
// language server writes "warning"; the rules that produce findings write
// "warn", which is the spelling the command line prints and the one a plugin
// declares. Every request this extension sends is answered in the first
// vocabulary, so the second is a tolerance rather than a path in use — kept
// because the extension mirrors a wire it does not control, and because the
// unknown-value fallback is 'error': a spelling this refused would render every
// advisory as an Error squiggle rather than surfacing as a gap.
//
// Unknown values default to 'error' so unmapped severities surface visibly
// rather than disappearing into the Information tier.
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
