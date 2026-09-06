// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { CancellationSignal } from './cancellation';
import { SeverityToken, severityTokenFromString, zeroBasedFromOneBased } from './diagnostics-shape';
import { outcomeOf, terminalLine } from './operation-outcome';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from './workspace';

// LINT_DIAGNOSTIC_SOURCE names the conventions linter as the origin of every
// finding it publishes. It is deliberately distinct from the language server's
// source so the Problems panel groups conventions findings apart from
// validation results, and a reader can tell which of the two spoke.
export const LINT_DIAGNOSTIC_SOURCE = 'aggrega lint';

// --- wire shapes (mirror the conventions linter's structured output) ------

// LintLocation is the entity a finding concerns.
//
// file is an ABSOLUTE path, unlike the IR graph's workspace-relative
// source_file — so a consumer builds a file URI from it directly and must not
// resolve it against the workspace root.
//
// line and column are 1-based and OPTIONAL: the linter supplies them only when
// the rule that produced the finding located the issue that precisely.
// Otherwise the file alone locates it, which is the ordinary case.
export interface LintLocation {
  file: string;
  line?: number;
  column?: number;
}

// LintFinding is one finding of the linter's structured output. message is the
// rule's own text; it is carried through unchanged so the structured and human
// renderings never word a finding differently.
export interface LintFinding {
  severity: string;
  message: string;
  ruleId: string;
  location: LintLocation;
}

// LintSummary carries the linter's own counts. Every field is optional here
// because a consumer that reads a count it did not receive would report a
// number it invented.
export interface LintSummary {
  entitiesChecked?: number;
  findings?: number;
  errors?: number;
  warnings?: number;
  infos?: number;
}

// LintDocument is the top level of the linter's structured output. Both fields
// are optional so a document missing either is reported as it arrived rather
// than crashing the surface that reads it.
export interface LintDocument {
  findings?: LintFinding[];
  summary?: LintSummary;
}

// --- conversion ----------------------------------------------------------

// LintFindingShape is the pure conversion of one finding into 0-based VS Code
// position semantics, carrying the rule that produced it. It depends on no
// vscode runtime type, so the mapping is testable without the editor.
export interface LintFindingShape {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  severity: SeverityToken;
  // message is the linter's own text, verbatim.
  message: string;
  // ruleId travels to the diagnostic's code, so the Problems panel names the
  // rule that fired alongside the finding.
  ruleId: string;
  source: string;
  // located records whether the linter supplied a line for this finding.
  //
  // A VS Code diagnostic must carry a range, so a finding the linter located to
  // a file and no further is published as a zero-length range at the start of
  // the document — the editor's own encoding for a file-scoped problem. This
  // flag is what lets a reader (and a test) tell that encoding apart from a
  // position the linter actually named: false means no line was implicated, so
  // nothing downstream may present the range as the linter's own answer.
  located: boolean;
}

// shapeForLintFinding produces the pure conversion of one finding.
//
// When the linter supplies a positive line the range is point-style at that
// position, matching the language-server path's fallback for a start-only
// position. When it does not, the range is the zero-length range at the
// document start and located is false: no line the linter never named is ever
// fabricated into a position.
export function shapeForLintFinding(f: LintFinding): LintFindingShape {
  const rawLine = f.location?.line;
  const rawColumn = f.location?.column;
  const hasLine = typeof rawLine === 'number' && rawLine > 0;
  const line = hasLine ? zeroBasedFromOneBased(rawLine!) : 0;
  const character =
    hasLine && typeof rawColumn === 'number' && rawColumn > 0
      ? zeroBasedFromOneBased(rawColumn)
      : 0;
  return {
    startLine: line,
    startChar: character,
    endLine: line,
    endChar: character,
    severity: severityTokenFromString(f.severity),
    message: f.message,
    ruleId: f.ruleId,
    source: LINT_DIAGNOSTIC_SOURCE,
    located: hasLine,
  };
}

// findingsByFile groups a document's findings by the absolute file each one
// concerns, preserving the linter's own order within a file so a second run
// over unchanged content produces the same reading order.
//
// A finding carrying no file names no entity to navigate to, so it is left out
// of the grouping; countUnlocatable reports how many were dropped, and the
// caller surfaces them in the log rather than discarding them silently.
export function findingsByFile(doc: LintDocument): Map<string, LintFindingShape[]> {
  const byFile = new Map<string, LintFindingShape[]>();
  for (const finding of doc.findings ?? []) {
    const file = finding.location?.file;
    if (!file) { continue; }
    const shapes = byFile.get(file);
    if (shapes) {
      shapes.push(shapeForLintFinding(finding));
    } else {
      byFile.set(file, [shapeForLintFinding(finding)]);
    }
  }
  return byFile;
}

// countUnlocatable reports how many findings named no file. Such a finding
// cannot be published against any document, so the count is what keeps it from
// vanishing without trace.
export function countUnlocatable(doc: LintDocument): number {
  return (doc.findings ?? []).filter((f) => !f.location?.file).length;
}

// summaryLine renders the run's outcome for the reader, from the linter's own
// counts and the findings actually published — so the number a reader sees
// here is the number of entries in the Problems panel.
//
// The entity clause is omitted when the linter reported no count, rather than
// showing a zero it never sent.
export function summaryLine(doc: LintDocument): string {
  const published = (doc.findings ?? []).length;
  const checked = doc.summary?.entitiesChecked;
  const scope = typeof checked === 'number' ? ` across ${checked} entities checked` : '';
  if (published === 0) {
    return `Aggrega lint: no findings${scope}.`;
  }
  return `Aggrega lint: ${published} finding(s)${scope} — see the Problems panel.`;
}

// --- the run ---------------------------------------------------------------

// LintSink is the slice of a diagnostic collection the run writes into.
// Injecting it (rather than reaching for the editor runtime) is what makes the
// run's outcome directly assertable: a test passes a recorder and reads back
// exactly the findings an author would have seen in the Problems panel.
export interface LintSink {
  // replace makes byFile the whole published set, dropping the previous run's.
  replace(byFile: Map<string, LintFindingShape[]>): void;
}

// LintLog is the reader-visible log the run appends to — the product's own
// human report, verbatim.
export interface LintLog {
  appendLine(text: string): void;
  show(): void;
}

// LintRunDeps supplies the run's surfaces: the anchored root that decides
// whether the linter can be invoked at all, the structured invocation itself,
// the collection findings land in, the log, and the reader notification.
export interface LintRunDeps {
  getWorkspaceRoot(): string | null;
  // runLintJson invokes the linter's structured output. It resolves the parsed
  // document together with the report the product wrote to stderr, and rejects
  // with the product's own message when the linter could not run.
  //
  // The signal is how a reader stops it. The linter walks every catalog entity,
  // so a run on a large catalog is one a reader may want to stop; stopping it
  // terminates the run rather than leaving it walking with nobody waiting.
  runLintJson(signal?: CancellationSignal): Promise<{ doc: LintDocument; stderr: string }>;
  sink: LintSink;
  log: LintLog;
  // notify surfaces one short status to the reader. The 'error' tier carries
  // the product's own message, so nothing re-words a compiler failure.
  notify(message: string, tier: 'info' | 'error'): void;
}

// runLint invokes the conventions linter and publishes its findings as
// navigable diagnostics.
//
// Three properties of the linter's structured output shape this run:
// the exit status is 0 even when there are findings (conventions findings are
// advisory and never halt), so only the parsed document says whether any
// exist; a failure to run leaves stdout empty and writes the reason to stderr,
// which is what the rejection carries; and a successful run also writes its
// human report to stderr, which is appended to the log verbatim so a reader
// wanting the full report gets the product's own rendering of it.
//
// A run that could not execute leaves the previous run's findings in place. It
// learned nothing, so clearing them would destroy a result the author has not
// yet acted on; the failure is surfaced instead.
//
// A run the reader stopped is reported as stopped rather than as a failure, and
// leaves the previous findings in place for the same reason a failed run does:
// it learned nothing, so there is nothing to replace them with.
export async function runLint(deps: LintRunDeps, signal?: CancellationSignal): Promise<void> {
  if (!deps.getWorkspaceRoot()) {
    // The shared no-anchor message, so the reader learns the linter was never
    // invoked rather than reading an empty result as a clean catalog — and
    // learns it in the same words every other surface uses.
    deps.notify(NO_ANCHORED_WORKSPACE_MESSAGE, 'info');
    return;
  }

  let result: { doc: LintDocument; stderr: string };
  try {
    result = await deps.runLintJson(signal);
  } catch (err) {
    const outcome = outcomeOf(err);
    if (outcome.kind === 'cancelled') {
      const line = terminalLine('The lint', outcome);
      deps.log.appendLine(line);
      deps.notify(line, 'info');
      return;
    }
    // The message is the linter's own stderr text. It is surfaced as-is: a
    // re-worded wrapper would hide the remediation the compiler already named.
    deps.log.appendLine(outcome.message);
    deps.log.show();
    deps.notify(outcome.message, 'error');
    return;
  }

  const byFile = findingsByFile(result.doc);
  deps.sink.replace(byFile);

  const report = result.stderr.trim();
  if (report) {
    deps.log.appendLine(report);
  }

  const dropped = countUnlocatable(result.doc);
  if (dropped > 0) {
    // A finding naming no file cannot be published against any document, so it
    // is named in the log rather than lost.
    deps.log.appendLine(
      `${dropped} finding(s) named no entity file, so they appear only in this log.`,
    );
  }

  deps.notify(summaryLine(result.doc), 'info');
}
