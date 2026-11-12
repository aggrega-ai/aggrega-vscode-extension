// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as semver from 'semver';

// VersionCheckResult names the four outcomes the helper can produce.
// The caller in extension.ts decides surface behavior per kind:
// `match` is silent; `mismatch` warns the operator via toast;
// `skipped` and `error` log to the OutputChannel without a toast.
//
// 🔴 IT IS A VERDICT, NOT A READING, AND IT IS NOT WHAT A SURFACE SHOWING THE
// RUNNING VERSION CONSUMES. Two of its four arms carry no version at all,
// because two of them are reached without one being comparable — so a display
// wired here would be blank on precisely the builds whose version a reader most
// wants to see. DaemonVersionReading below is the reading; this is what one
// caller concluded from it.
export type VersionCheckResult =
  | { kind: 'match'; version: string }
  | { kind: 'mismatch'; version: string; range: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'error'; err: Error };

// DaemonVersionPayload mirrors the wire shape emitted by
// `aggrega version -o json`. camelCase per the Go ecosystem's
// json.Marshal default convention; the same shape is pinned on the
// daemon side by cmd/aggrega/version_test.go.
export interface DaemonVersionPayload {
  version: string;
  commit: string;
  goVersion: string;
  platform: string;
}

// SpawnFn is a test seam: production passes a wrapper around
// child_process.execFile; tests pass a stub returning a known
// payload or rejecting with a known error.
export type SpawnFn = (binaryPath: string, args: string[]) => Promise<string>;

// DaemonVersionReading is what the compiler reports about ITSELF, before
// anything decides what that means.
//
// 🔴 IT IS SEPARATE FROM THE COMPATIBILITY VERDICT BELOW, AND THE SEPARATION IS
// THE WHOLE POINT. "What is running?" and "is what is running compatible?" are
// two questions, and a surface that has to SHOW the first cannot be served by
// the second's answer: a build whose version reads `(devel)` is not comparable
// against any range, so the verdict has nothing to report — while the reader
// looking at the page still wants to be told they are on a development build.
// Reading the version through the verdict would therefore show nothing on
// exactly the builds a contributor runs, and would pass any assertion written
// against a released one.
//
// `reported` carries the string the compiler printed, VERBATIM and
// uninterpreted, `(devel)` included.
export type DaemonVersionReading =
  | { kind: 'reported'; version: string }
  | { kind: 'unreadable'; err: Error };

// VersionReadDeps is what readDaemonVersion reaches into: the binary to ask,
// and the seam that asks it.
export interface VersionReadDeps {
  binaryPath: string;
  spawn: SpawnFn;
}

// readDaemonVersion asks one compiler what version it is.
//
// It is the ONE place the version payload is obtained and parsed. Everything
// that wants to know what the compiler is — the compatibility check, and the
// welcome page — reads it from here, so the two cannot come to disagree about
// what the same binary reported.
export async function readDaemonVersion(deps: VersionReadDeps): Promise<DaemonVersionReading> {
  let stdout: string;
  try {
    stdout = await deps.spawn(deps.binaryPath, ['version', '-o', 'json']);
  } catch (err) {
    return { kind: 'unreadable', err: err instanceof Error ? err : new Error(String(err)) };
  }
  let payload: DaemonVersionPayload;
  try {
    payload = JSON.parse(stdout) as DaemonVersionPayload;
  } catch (err) {
    return { kind: 'unreadable', err: err instanceof Error ? err : new Error(String(err)) };
  }
  if (!payload.version) {
    return {
      kind: 'unreadable',
      err: new Error('daemon version output missing `version` field'),
    };
  }
  return { kind: 'reported', version: payload.version };
}

// VersionCheckDeps carries the testable surfaces checkDaemonVersion
// reaches into. binaryPath names the daemon binary (PATH-resolved or
// absolute, per aggrega.server.binaryPath). compatibilityRange is the
// SemVer range read from package.json's aggregaCompatibility field;
// undefined when the field is absent — in which case the check is
// skipped silently.
export interface VersionCheckDeps {
  binaryPath: string;
  compatibilityRange: string | undefined;
  spawn: SpawnFn;
}

// checkDaemonVersion spawns the daemon binary with `version -o json`,
// parses the response, and compares against the declared
// compatibility range. The four-state result lets the caller decide
// how loudly to surface each outcome:
//
//   - match    → silent (version is in range)
//   - mismatch → toast (version is outside the declared range)
//   - skipped  → log only ((devel)/(unknown) build, missing range,
//                or version that does not parse as SemVer)
//   - error    → log only (spawn failed, output not parseable)
//
// (devel) and (unknown) are documented sentinels emitted by the
// daemon when ReadBuildInfo cannot identify a tagged build. The
// extension treats them identically: skip the check and trust that
// the operator running an unreleased build knows what they are
// doing.
export async function checkDaemonVersion(deps: VersionCheckDeps): Promise<VersionCheckResult> {
  if (!deps.compatibilityRange) {
    return { kind: 'skipped', reason: 'aggregaCompatibility field absent from package.json' };
  }
  const reading = await readDaemonVersion(deps);
  if (reading.kind === 'unreadable') {
    return { kind: 'error', err: reading.err };
  }
  const reported = reading.version;
  if (reported === '(devel)' || reported === '(unknown)') {
    return { kind: 'skipped', reason: `daemon reports unreleased build (${reported}); skipping compatibility check` };
  }
  const parsed = semver.coerce(reported);
  if (!parsed) {
    return { kind: 'skipped', reason: `daemon version "${reported}" does not parse as SemVer; skipping compatibility check` };
  }
  if (semver.satisfies(parsed, deps.compatibilityRange)) {
    return { kind: 'match', version: reported };
  }
  return { kind: 'mismatch', version: reported, range: deps.compatibilityRange };
}
