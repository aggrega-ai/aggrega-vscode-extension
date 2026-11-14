// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as fsp from 'fs/promises';
import * as path from 'path';
import * as semver from 'semver';

import {
  InstallOutcome,
  ReleaseSource,
  ReleaseTarget,
  installRelease,
  releaseTarget,
} from './compiler-download';
import {
  CompilerMemory,
  DownloadPrompts,
  HostFacts,
  compilerSituation,
  downloadingTitle,
  keptSentence,
  namesAPath,
  offeredVersions,
  replaceableDestination,
  samePath,
  sharedLocation,
} from './compiler-provision';
import { describeError } from './error-text';
import * as l10n from './l10n';
import { BINARY_PATH_SETTING } from './start-failure';
import { SpawnFn, readDaemonVersion } from './version-check';

// This module changes the version of the compiler a reader runs, from the
// releases this extension works with, after a warning they confirm. It reaches no
// editor type: the questions go through a surface handed in, and so does starting
// the language server, so the whole change — the refusals included — is driven
// here with no editor running.
//
// It reuses the rules the download already has rather than holding its own: the
// releases on offer, what may be replaced, and how a file is checked before it is
// used each have one home in the download modules, so the two ways of getting a
// compiler cannot come to disagree about any of them.
//
// 🔴 THE NEW COPY IS DOWNLOADED BESIDE THE CURRENT ONE AND STARTED BEFORE IT
// REPLACES ANYTHING. A version that will not start the language server is
// deleted and the server is put back on the compiler the setting names, so the
// reader is never left with a compiler that does not run in place of one that did.

// SELECT_COMPILER_VERSION_COMMAND is the command that changes the version.
export const SELECT_COMPILER_VERSION_COMMAND = 'aggrega.compiler.selectVersion';

// SWITCH_GO is the button the warning carries.
export const SWITCH_GO = l10n.t('Download and switch');

// VersionPrompts is every question the change puts to the reader.
export interface VersionPrompts extends Pick<DownloadPrompts, 'confirm' | 'withProgress' | 'inform' | 'warn'> {
  // pickVersion offers the versions, newest first, saying which one the
  // compiler in use reports. Undefined is the reader declining.
  pickVersion(versions: readonly string[], current: string | null): PromiseLike<string | undefined>;
}

// ServerStart is how starting the language server from one compiler file went:
// started, failed with the reason, or not tried because no language server runs
// in the window to start.
export type ServerStart =
  | { kind: 'started' }
  | { kind: 'failed'; reason: string }
  | { kind: 'noServer' };

// VersionDeps is what one change of version reads and writes.
export interface VersionDeps {
  source: ReleaseSource;
  host: HostFacts;
  compatibilityRange: string | undefined;
  configuredPath: string;
  memory: CompilerMemory;
  runVersion: SpawnFn;
  writeBinaryPath(file: string): PromiseLike<void>;
  // startServerOn starts the language server from a compiler file without
  // moving the setting.
  startServerOn(file: string): Promise<ServerStart>;
  // restoreServer starts the language server again from the compiler the
  // setting names.
  restoreServer(): Promise<void>;
  prompts: VersionPrompts;
}

// VersionOutcome is how a change of version ended.
export type VersionOutcome =
  | { kind: 'switched'; path: string; version: string; started: boolean }
  | { kind: 'unchanged'; version: string }
  | { kind: 'kept'; sentence: string }
  | { kind: 'declined' };

// versionDescription is what a version's entry in the list says beside it: that
// it is the newest, that it is the one in use, both, or nothing.
export function versionDescription(version: string, current: string | null, newest: boolean): string {
  const words: string[] = [];
  if (newest) { words.push(l10n.t('newest')); }
  if (sameVersion(version, current)) { words.push(l10n.t('in use')); }
  return l10n.series(words);
}

// versionWarning is the question put before a version is changed. It names what
// the change reaches, because the compiler is installed once per machine.
export function versionWarning(version: string, destination: string): string {
  return l10n.t('Aggrega: switch to aggrega {0}? The compiler at {1} is the one every workspace on this machine uses, so the version changes for all of them, and a Release whose lockfile another version wrote may need its lockfile regenerated with Pull.', version, destination);
}

// candidateFor is the file a new version is downloaded into, beside the one it
// is to replace and hidden from a folder listing.
export function candidateFor(destination: string, version: string, target: ReleaseTarget): string {
  return path.join(
    path.dirname(destination),
    `.aggrega-${version}.candidate${target.os === 'windows' ? '.exe' : ''}`,
  );
}

function sameVersion(a: string, b: string | null): boolean {
  if (b === null) { return false; }
  const left = semver.coerce(a);
  const right = semver.coerce(b);
  return left !== null && right !== null && left.version === right.version;
}

// selectCompilerVersion lists the releases this extension works with, lets the
// reader choose one, warns what changing it reaches and asks for confirmation,
// downloads it beside the current copy, starts the language server on it, and
// only then puts it in place.
//
// The compiler it replaces is the one in use — the file the setting names, or
// the one a plain name finds on PATH — and only where the extension may replace
// it. A compiler the reader chose is never replaced: the shared location is
// offered instead, and only the reader's answer moves the setting there.
export async function selectCompilerVersion(deps: VersionDeps): Promise<VersionOutcome> {
  const { prompts, host } = deps;
  const kept = (reason: string): VersionOutcome => {
    const sentence = keptSentence(reason);
    prompts.warn(sentence);
    return { kind: 'kept', sentence };
  };

  const reading = releaseTarget(host.platform, host.arch);
  if (reading.kind === 'unsupported') { return kept(reading.sentence); }
  const target = reading.target;
  const shared = sharedLocation(target, host);

  const situation = await compilerSituation(deps.configuredPath, host);
  const current = situation.kind === 'chosen' || situation.kind === 'onPath' ? situation.path : null;
  const currentReading = current === null
    ? null
    : await readDaemonVersion({ binaryPath: current, spawn: deps.runVersion });
  const currentVersion = currentReading?.kind === 'reported' ? currentReading.version : null;

  const offered = await offeredVersions(deps.source, deps.compatibilityRange, target, prompts);
  if (offered.kind === 'kept') { return kept(offered.reason); }
  const version = await prompts.pickVersion(offered.versions, currentVersion);
  if (version === undefined) { return { kind: 'declined' }; }
  if (current !== null && currentVersion !== null && sameVersion(version, currentVersion)) {
    prompts.inform(l10n.t('Aggrega: the compiler at {0} is already aggrega {1}.', current, currentVersion));
    return { kind: 'unchanged', version: currentVersion };
  }

  const wanted = current ?? shared;
  if (wanted === null) {
    return kept(l10n.t('LOCALAPPDATA is not set, so there is no shared location to download into'));
  }
  const settled = await replaceableDestination(wanted, version, shared, deps.memory, host.platform, prompts);
  if (settled.kind === 'declined') { return { kind: 'declined' }; }
  if (settled.kind === 'kept') { return kept(settled.reason); }
  const destination = settled.file;

  if (!(await prompts.confirm(versionWarning(version, destination), SWITCH_GO))) {
    return { kind: 'declined' };
  }

  const candidate = candidateFor(destination, version, target);
  let outcome: InstallOutcome;
  try {
    outcome = await prompts.withProgress(
      downloadingTitle(version),
      (signal) => installRelease({
        source: deps.source,
        target,
        version,
        destination: candidate,
        runVersion: deps.runVersion,
        signal,
      }),
    );
  } catch (err) {
    return kept(describeError(err));
  }
  if (outcome.kind === 'refused') { return kept(outcome.reason); }

  const start = await deps.startServerOn(candidate);
  if (start.kind === 'failed') {
    await fsp.rm(candidate, { force: true });
    await deps.restoreServer();
    const sentence = l10n.t('Aggrega: aggrega {0} did not start the language server ({1}), so it was deleted and {2} was left as it is.', version, start.reason, BINARY_PATH_SETTING);
    prompts.warn(sentence);
    return { kind: 'kept', sentence };
  }

  try {
    await fsp.rename(candidate, destination);
  } catch (err) {
    await fsp.rm(candidate, { force: true });
    if (start.kind === 'started') { await deps.restoreServer(); }
    return kept(l10n.t('the downloaded aggrega {0} could not be put in place at {1} ({2}), so it was deleted', version, destination, describeError(err)));
  }

  // Where the setting already names the file that was replaced, writing it moves
  // nothing, so nothing watching it restarts the server; the server running from
  // the candidate is started again from the file's own name instead. Where the
  // setting moves, its own watcher does that.
  const settingMoves = !(namesAPath(deps.configuredPath) && samePath(deps.configuredPath, destination, host.platform));
  if (settingMoves) {
    await deps.writeBinaryPath(destination);
  } else if (start.kind === 'started') {
    await deps.restoreServer();
  }
  // Whether the setting moved and whether a server started each change the
  // sentence, so each pairing is a whole message of its own.
  let switched: string;
  if (start.kind === 'started') {
    switched = settingMoves
      ? l10n.t('Aggrega: the compiler at {0} is now aggrega {1}, and {2} names it; the language server started on it before it replaced the earlier one.', destination, outcome.version, BINARY_PATH_SETTING)
      : l10n.t('Aggrega: the compiler at {0} is now aggrega {1}; the language server started on it before it replaced the earlier one.', destination, outcome.version);
  } else {
    switched = settingMoves
      ? l10n.t('Aggrega: the compiler at {0} is now aggrega {1}, and {2} names it. No language server runs in this window, so it was checked by asking it for its version rather than by starting one.', destination, outcome.version, BINARY_PATH_SETTING)
      : l10n.t('Aggrega: the compiler at {0} is now aggrega {1}. No language server runs in this window, so it was checked by asking it for its version rather than by starting one.', destination, outcome.version);
  }
  prompts.inform(switched);
  return { kind: 'switched', path: destination, version: outcome.version, started: start.kind === 'started' };
}
