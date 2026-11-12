// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { execFile } from 'child_process';
import { CancellationSignal, OperationCancelled } from './cancellation';
import { isStartFailure } from './start-failure';

// CliJsonDeps is the slice of extension state a structured CLI capture needs:
// the anchored workspace root the command runs in, and the configured binary
// path. Every surface that consumes a `-o json` command satisfies this
// structurally, so no caller needs a bespoke deps type.
export interface CliJsonDeps {
  getWorkspaceRoot(): string | null;
  getBinaryPath(): string;
}

// CliJsonResult carries both streams of a structured run, because the compiler
// uses them for two different things and a consumer may want either.
//
// stdout holds the machine document and is already parsed into doc. stderr is
// NOT an error channel on a successful run: commands that have both a
// structured and a human rendering write the machine document to stdout and
// their own human report to stderr, so a run can succeed with stderr full.
// Surfacing that text verbatim is how a reader gets the product's own report
// without the extension composing a second rendering of it.
export interface CliJsonResult<T> {
  doc: T;
  stderr: string;
}

// UNPARSED_OUTPUT_EXCERPT_LIMIT caps how much of an unparsable stdout travels
// into a reader-facing message. A structured run may carry megabytes, and a
// notification is one line; the full text still reaches the output channel
// through the caller.
const UNPARSED_OUTPUT_EXCERPT_LIMIT = 240;

// messageForUnparsedOutput picks the most useful text to report when a
// structured run produced something that is not JSON.
//
// The order is the product's own channels, most actionable first. stderr wins,
// because that is where a command writes the sentence naming what to do. Where
// stderr is silent the sentence is on stdout instead: a command asked for JSON
// can still answer a configuration question in prose and exit zero, and showing
// that prose is strictly better than reporting a parse failure the reader can
// do nothing with. Where both are silent there is nothing to quote, so the
// command line itself is named.
//
// Nothing here interprets the text. It is excerpted for length and passed
// through; no branch reads its content and no behaviour turns on what it says,
// so the product remains the only thing that decides what a state means.
export function messageForUnparsedOutput(args: string[], stdout: string, stderr: string): string {
  const fromStderr = stderr.trim();
  if (fromStderr) {
    return fromStderr;
  }
  const fromStdout = stdout.trim();
  if (fromStdout) {
    return excerpt(fromStdout);
  }
  return `\`aggrega ${args.join(' ')}\` produced no output.`;
}

// excerpt reduces a captured stream to one displayable line: the first
// non-empty line, truncated to the cap. A trailing marker is appended whenever
// anything was dropped, so a reader is never shown a silently shortened
// sentence and read it as the whole answer.
function excerpt(text: string): string {
  const lines = text.split('\n');
  const firstIndex = lines.findIndex((l) => l.trim().length > 0);
  if (firstIndex < 0) {
    return text.trim();
  }
  const first = lines[firstIndex].trim();
  const hasLaterLines = lines.slice(firstIndex + 1).some((l) => l.trim().length > 0);
  if (first.length > UNPARSED_OUTPUT_EXCERPT_LIMIT) {
    return `${first.slice(0, UNPARSED_OUTPUT_EXCERPT_LIMIT)}…`;
  }
  return hasLaterLines ? `${first} …` : first;
}

// runCliJson runs the binary with the given args in the anchored workspace root
// and parses stdout as JSON. It captures (rather than streams) because these
// surfaces consume the structured result.
//
// It is the single home for the structured-run contract, so every `-o json`
// surface reports a failure by the same rule. Two shapes of failure reach the
// rejection, and in both the message is the product's own text rather than a
// re-worded wrapper:
//
//   - a non-zero exit, where stderr carries the reason and the remediation;
//   - a zero exit whose stdout is not JSON, which happens when a command
//     answers a configuration question in prose instead of data.
//
// A third is the compiler not starting at all — nothing at the path, or nothing
// runnable there — and there is no product text to carry. The runtime's own
// failure is handed on unchanged instead, because the fields it carries are what
// tell a caller which of those it was, and a fresh error with only its message
// would leave the caller to read that from words.
//
// A zero exit with parsable stdout resolves with the parsed document and the
// raw stderr alongside it.
//
// A caller that may need to stop the run passes a signal and names the
// operation. The child is held for the whole run rather than left unreachable,
// so stopping terminates the compiler rather than only abandoning the answer —
// the run would otherwise carry on walking the catalog with nobody waiting for
// what it found. what is the operation in the reader's terms, carried into the
// stopped-by-the-reader rejection so the caller need not supply it twice.
export function runCliJson<T>(
  deps: CliJsonDeps,
  args: string[],
  signal?: CancellationSignal,
  what = `aggrega ${args[0] ?? ''}`.trim(),
): Promise<CliJsonResult<T>> {
  const root = deps.getWorkspaceRoot();
  const bin = deps.getBinaryPath();
  return new Promise<CliJsonResult<T>>((resolve, reject) => {
    if (signal?.isCancellationRequested) {
      reject(new OperationCancelled(what));
      return;
    }
    let settled = false;
    let subscription: { dispose(): void } | null = null;
    const finish = (act: () => void): void => {
      if (settled) { return; }
      settled = true;
      subscription?.dispose();
      act();
    };
    const child = execFile(
      bin,
      args,
      { cwd: root ?? undefined, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        // A terminated child reaches this callback carrying the signal that
        // stopped it. finish makes the stop the only settlement, so that
        // arrival never overwrites the stopped-by-the-reader answer with a
        // failure the reader would read as something having gone wrong.
        if (err) {
          finish(() => reject(isStartFailure(err) ? err : new Error(stderr?.trim() || err.message)));
          return;
        }
        try {
          const doc = JSON.parse(stdout) as T;
          finish(() => resolve({ doc, stderr: stderr ?? '' }));
        } catch {
          finish(() => reject(new Error(messageForUnparsedOutput(args, stdout ?? '', stderr ?? ''))));
        }
      },
    );
    if (!signal) { return; }
    subscription = signal.onCancellationRequested(() => {
      if (settled) { return; }
      // Terminating precedes settling, so the reader is told the run stopped
      // only once the compiler has been told to stop.
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
      }
      finish(() => reject(new OperationCancelled(what)));
    });
  });
}
