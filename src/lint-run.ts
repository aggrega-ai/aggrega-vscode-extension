// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'node:path';

import { CancellationSignal } from './cancellation';
import { ConvertedShape, shapeForDaemonDiagnostic } from './diagnostics-shape';
import { outcomeOf, terminalLine } from './operation-outcome';
import { DaemonDiagnostic } from './types';
import { NO_ANCHORED_WORKSPACE_MESSAGE } from './workspace';

// --- wire shapes (mirror the aggrega/lint answer) -------------------------

// LintFileFindings is one document's publishing-conventions findings, as the
// answer groups them.
//
// The file is carried beside the entries rather than on each one, because a
// diagnostic locates a position inside a document and says nothing about which
// document. It is spelled relative to the workspace root for a document inside
// it and absolutely for one outside — a catalog directory need not sit under the
// root — so a consumer resolves it against the root rather than using it as a
// path directly.
export interface LintFileFindings {
  file: string;
  diagnostics?: DaemonDiagnostic[];
}

// LintAnswer is what the compiler answers a publishing-conventions request
// with.
//
// Every field is optional here, and that is the same posture the daemon
// diagnostic shape takes: the extension mirrors a wire it does not control, and
// a consumer that reads a count it did not receive reports a number it invented.
// So an absent count omits its clause rather than defaulting to zero.
//
// checked is how many entity documents the run covered, which is what makes a
// clean answer readable as a corpus rather than only as an empty list: no
// findings over forty entities and no findings over none are different answers.
//
// The per-severity counts and the total are the run's own, derived by the
// compiler from the findings it produced. They are read rather than recounted
// here: a second derivation at this boundary would agree with the compiler's
// until one of the two was edited.
//
// halted says whether the run's own verdict refuses publication. It is false for
// every advisory run, which is what a whole-catalog check always is.
export interface LintAnswer {
  entity?: string;
  release?: string;
  checked?: number;
  findings?: number;
  errors?: number;
  warnings?: number;
  infos?: number;
  files?: LintFileFindings[];
  halted?: boolean;
}

// --- conversion -----------------------------------------------------------

// absolutePathFor resolves the document one group of findings concerns.
//
// The answer spells a contained document relative to the workspace root and one
// outside it absolutely, so resolution against the root covers both: an already
// absolute path resolves to itself. This is the single place the two spellings
// are reconciled, so nothing downstream has to know which of them it holds.
function absolutePathFor(workspaceRoot: string, file: string): string {
  return path.resolve(workspaceRoot, file);
}

// findingsByFile groups the answer's findings by the absolute path of the
// document each concerns, preserving the compiler's own order within a group so
// a second run over unchanged content produces the same reading order.
//
// Each entry converts through the extension's one home for a compiler
// diagnostic, so a conventions finding and a validation result reach the
// Problems panel by the same position, severity and code rules. The source
// stays whatever the compiler stamped, which is what keeps the Problems panel's
// grouping a property of the answer rather than of this module.
//
// A group naming no document names no entity to navigate to, so it is left out;
// countUnlocatable reports how many entries were dropped, and the caller
// surfaces them in the log rather than discarding them silently.
export function findingsByFile(
  answer: LintAnswer,
  workspaceRoot: string,
): Map<string, ConvertedShape[]> {
  const byFile = new Map<string, ConvertedShape[]>();
  for (const group of answer.files ?? []) {
    if (!group.file) { continue; }
    const shapes = (group.diagnostics ?? []).map(shapeForDaemonDiagnostic);
    if (shapes.length === 0) { continue; }
    const file = absolutePathFor(workspaceRoot, group.file);
    const existing = byFile.get(file);
    if (existing) {
      existing.push(...shapes);
    } else {
      byFile.set(file, shapes);
    }
  }
  return byFile;
}

// countUnlocatable reports how many findings named no document. Such a finding
// cannot be published against any file, so the count is what keeps it from
// vanishing without trace.
export function countUnlocatable(answer: LintAnswer): number {
  let n = 0;
  for (const group of answer.files ?? []) {
    if (group.file) { continue; }
    n += (group.diagnostics ?? []).length;
  }
  return n;
}

// reportLines renders the run's findings in the compiler's own report format:
// the document, then one line per finding carrying its severity, the rule that
// produced it, and the rule's own text.
//
// It is composed from the answer's values rather than from a rendering the
// compiler wrote, because the request surface answers with the facts and leaves
// the human formatting to whichever surface a reader is looking at. Every value
// in it is the compiler's own and none is re-worded — in particular the message
// is carried through byte for byte, so the remediation the rule named is never
// replaced by a friendlier sentence.
//
// The document is named by its absolute path, which is the path a reader can
// open and the one the rules' own message text already quotes.
//
// A finding whose producer assigned no rule identity is rendered without one
// rather than with an empty identifier, since an empty name states nothing.
export function reportLines(answer: LintAnswer, workspaceRoot: string): string[] {
  const lines: string[] = [];
  for (const group of answer.files ?? []) {
    const diagnostics = group.diagnostics ?? [];
    if (diagnostics.length === 0) { continue; }
    lines.push(`${group.file ? absolutePathFor(workspaceRoot, group.file) : '(no entity file)'}:`);
    for (const d of diagnostics) {
      lines.push(d.code ? `[${d.severity}] ${d.code}: ${d.message}` : `[${d.severity}] ${d.message}`);
    }
  }
  return lines;
}

// summaryLine renders the run's outcome for the reader, from the compiler's own
// counts.
//
// Both clauses are omitted when the count behind them is absent, rather than
// showing a zero the compiler never sent — a run that reported no corpus size
// and a run that checked nothing are different answers.
//
// The finding count is the run's own total, which includes any finding that
// named no document; those are accounted for separately in the log, so the two
// readings together add up rather than disagreeing.
export function summaryLine(answer: LintAnswer): string {
  const checked = answer.checked;
  const scope = typeof checked === 'number' ? ` across ${checked} entities checked` : '';
  const found = answer.findings;
  if (typeof found !== 'number') {
    return `Aggrega lint: run complete${scope}.`;
  }
  if (found === 0) {
    return `Aggrega lint: no findings${scope}.`;
  }
  return `Aggrega lint: ${found} finding(s)${scope} — see the Problems panel.`;
}

// --- the run ---------------------------------------------------------------

// LintSink is the slice of a diagnostic collection the run writes into.
// Injecting it (rather than reaching for the editor runtime) is what makes the
// run's outcome directly assertable: a test passes a recorder and reads back
// exactly the findings an author would have seen in the Problems panel.
export interface LintSink {
  // replace makes byFile the whole published set, dropping the previous run's.
  replace(byFile: Map<string, ConvertedShape[]>): void;
}

// LintLog is the reader-visible log the run appends to — the compiler's own
// findings, in the compiler's own report format.
export interface LintLog {
  appendLine(text: string): void;
  show(): void;
}

// LintRunDeps supplies the run's surfaces: the anchored root that decides
// whether the check can be asked for at all and the paths in the answer are
// resolved against, the request itself, the collection findings land in, the
// log, and the reader notification.
export interface LintRunDeps {
  getWorkspaceRoot(): string | null;
  // lint asks the compiler for the publishing-conventions findings over every
  // catalog entity the workspace configures, and rejects with the compiler's own
  // message when the check could not run.
  //
  // The signal is how a reader stops it, and the stop reaches the work rather
  // than only this side's wait: the request's own context is what the walk and
  // the per-entity loop observe, so stopping abandons the remaining entities
  // instead of leaving the compiler walking with nobody waiting.
  lint(signal?: CancellationSignal): Promise<LintAnswer>;
  sink: LintSink;
  log: LintLog;
  // notify surfaces one short status to the reader. The 'error' tier carries
  // the compiler's own message, so nothing re-words a failure.
  notify(message: string, tier: 'info' | 'error'): void;
}

// LINT_SUBJECT is the check in the reader's terms, used for the sentence a
// stopped run leaves behind. One spelling, so every ending names the same thing.
export const LINT_SUBJECT = 'The lint';

// runLint asks for the publishing-conventions findings and publishes them as
// navigable diagnostics.
//
// Two properties of the answer shape this run: findings are advisory, so an
// answer carrying them is a success and not a failure; and a check that could
// not run at all rejects with the compiler's own message, which is what the
// failure branch surfaces.
//
// A run that could not execute leaves the previous run's findings in place. It
// learned nothing, so clearing them would destroy a result the author has not
// yet acted on; the failure is surfaced instead.
//
// A run the reader stopped is reported as stopped rather than as a failure, and
// leaves the previous findings in place for the same reason a failed run does:
// it learned nothing, so there is nothing to replace them with.
export async function runLint(deps: LintRunDeps, signal?: CancellationSignal): Promise<void> {
  const workspaceRoot = deps.getWorkspaceRoot();
  if (!workspaceRoot) {
    // The shared no-anchor message, so the reader learns the check was never
    // asked for rather than reading an empty result as a clean catalog — and
    // learns it in the same words every other surface uses.
    deps.notify(NO_ANCHORED_WORKSPACE_MESSAGE, 'info');
    return;
  }

  let answer: LintAnswer;
  try {
    answer = await deps.lint(signal);
  } catch (err) {
    const outcome = outcomeOf(err);
    if (outcome.kind === 'cancelled') {
      const line = terminalLine(LINT_SUBJECT, outcome);
      deps.log.appendLine(line);
      deps.notify(line, 'info');
      return;
    }
    // The message is the compiler's own text. It is surfaced as-is: a re-worded
    // wrapper would hide the remediation the compiler already named.
    deps.log.appendLine(outcome.message);
    deps.log.show();
    deps.notify(outcome.message, 'error');
    return;
  }

  deps.sink.replace(findingsByFile(answer, workspaceRoot));

  for (const line of reportLines(answer, workspaceRoot)) {
    deps.log.appendLine(line);
  }

  const dropped = countUnlocatable(answer);
  if (dropped > 0) {
    // A finding naming no document cannot be published against any file, so it
    // is named in the log rather than lost.
    deps.log.appendLine(
      `${dropped} finding(s) named no entity file, so they appear only in this log.`,
    );
  }

  deps.notify(summaryLine(answer), 'info');
}
