// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as semver from 'semver';

// VersionCheckResult names the four outcomes the helper can produce.
// The caller in extension.ts decides surface behavior per kind:
// `match` is silent; `mismatch` warns the operator via toast;
// `skipped` and `error` log to the OutputChannel without a toast.
export type VersionCheckResult =
  | { kind: 'match'; version: string }
  | { kind: 'mismatch'; version: string; range: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'error'; err: Error };

// DaemonVersionPayload mirrors the wire shape emitted by
// `aggrega version --json`. camelCase per the Go ecosystem's
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

// checkDaemonVersion spawns the daemon binary with `version --json`,
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
  let stdout: string;
  try {
    stdout = await deps.spawn(deps.binaryPath, ['version', '--json']);
  } catch (err) {
    return { kind: 'error', err: err instanceof Error ? err : new Error(String(err)) };
  }
  let payload: DaemonVersionPayload;
  try {
    payload = JSON.parse(stdout) as DaemonVersionPayload;
  } catch (err) {
    return { kind: 'error', err: err instanceof Error ? err : new Error(String(err)) };
  }
  if (!payload.version) {
    return { kind: 'error', err: new Error('daemon version output missing `version` field') };
  }
  if (payload.version === '(devel)' || payload.version === '(unknown)') {
    return { kind: 'skipped', reason: `daemon reports unreleased build (${payload.version}); skipping compatibility check` };
  }
  const parsed = semver.coerce(payload.version);
  if (!parsed) {
    return { kind: 'skipped', reason: `daemon version "${payload.version}" does not parse as SemVer; skipping compatibility check` };
  }
  if (semver.satisfies(parsed, deps.compatibilityRange)) {
    return { kind: 'match', version: payload.version };
  }
  return { kind: 'mismatch', version: payload.version, range: deps.compatibilityRange };
}
