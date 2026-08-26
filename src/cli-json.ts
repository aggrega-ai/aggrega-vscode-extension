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

// runCliJson runs the binary with the given args in the anchored workspace root
// and parses stdout as JSON. It captures (rather than streams) because these
// surfaces consume the structured result.
//
// A non-zero exit rejects with the command's own stderr text, so the compiler's
// message is what reaches the caller rather than a re-worded wrapper. A
// zero exit resolves with the parsed document and the raw stderr alongside it.
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
      } catch (parseErr) {
        reject(new Error(`could not parse ${args.join(' ')} output: ${(parseErr as Error).message}`));
      }
    });
  });
}
