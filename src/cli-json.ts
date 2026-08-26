// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { execFile } from 'child_process';

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
// A zero exit with parsable stdout resolves with the parsed document and the
// raw stderr alongside it.
export function runCliJson<T>(deps: CliJsonDeps, args: string[]): Promise<CliJsonResult<T>> {
  const root = deps.getWorkspaceRoot();
  const bin = deps.getBinaryPath();
  return new Promise<CliJsonResult<T>>((resolve, reject) => {
    execFile(bin, args, { cwd: root ?? undefined, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
        return;
      }
      try {
        resolve({ doc: JSON.parse(stdout) as T, stderr: stderr ?? '' });
      } catch {
        reject(new Error(messageForUnparsedOutput(args, stdout ?? '', stderr ?? '')));
      }
    });
  });
}
