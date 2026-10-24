// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { constants as fsConstants } from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as semver from 'semver';

import {
  InstallOutcome,
  ReleaseSource,
  ReleaseTarget,
  compatibleVersions,
  installRelease,
  installedFileName,
  listReleases,
  releaseTarget,
  targetWords,
} from './compiler-download';
import { describeError } from './error-text';
import { BINARY_PATH_SETTING } from './start-failure';
import { SpawnFn, readDaemonVersion } from './version-check';

// This module decides what the extension does about the compiler it runs: which
// of the situations a reader can be in holds, where a download is offered to go,
// whether a file already there may be replaced, and when a newer release is worth
// a word. It reaches no editor type — every question it puts to the reader goes
// through a surface handed in — so each of those decisions can be driven here
// end to end.
//
// 🔴 THE EXTENSION REPLACES ONLY A COMPILER IT IS ENTITLED TO REPLACE: one at the
// shared location the install scripts use, or one it downloaded itself. A
// compiler at any other path is one the reader chose, and it is never replaced,
// whatever the reader is asked. That is the rule a reader can rely on without
// reading anything else here, which is why it is stated first.
//
// 🔴 IT NEVER UPGRADES ON ITS OWN. A download happens only after the reader has
// seen the version and the destination and confirmed both; the most the
// extension does unasked is say, once per version, that a newer one exists.

// ---- where the compiler is ---------------------------------------------------

// HostFacts is what the machine the extension runs on reads as, for the
// questions this module asks of it: its operating system and processor in the
// runtime's own names, the home folder, and the environment variables the
// shared location and the PATH lookup read.
export interface HostFacts {
  platform: string;
  arch: string;
  home: string;
  env: { PATH?: string; PATHEXT?: string; LOCALAPPDATA?: string };
}

// sharedLocation is the file the install scripts install the compiler as for the
// person this machine runs the extension for: ~/.local/bin/aggrega on Linux and
// macOS, and %LOCALAPPDATA%\Programs\aggrega\aggrega.exe on Windows. It is null on
// Windows where LOCALAPPDATA is not set, which is where the install script
// refuses to guess too.
export function sharedLocation(target: ReleaseTarget, host: HostFacts): string | null {
  if (target.os === 'windows') {
    const local = host.env.LOCALAPPDATA;
    return local ? path.join(local, 'Programs', 'aggrega', installedFileName(target)) : null;
  }
  return path.join(host.home, '.local', 'bin', installedFileName(target));
}

// samePath reports whether two paths name the same file, comparing letters
// without regard to case where the operating system does.
export function samePath(a: string, b: string, platform: string): boolean {
  const norm = (p: string): string => {
    const resolved = path.resolve(p);
    return platform === 'win32' || platform === 'darwin' ? resolved.toLowerCase() : resolved;
  };
  return norm(a) === norm(b);
}

// namesAPath reports whether the setting naming the compiler names a path rather
// than a plain name. A plain name is looked up on PATH, exactly as the language
// server is started from it; anything carrying a folder separator is used as
// written.
export function namesAPath(configured: string): boolean {
  return configured.includes('/') || configured.includes('\\');
}

// CompilerSituation is which of the situations a reader can be in holds.
//
// 'chosen' and 'chosenMissing' are a path the reader set, with a file there and
// with nothing there; 'onPath' and 'notFound' are a plain name, found on PATH and
// found nowhere.
export type CompilerSituation =
  | { kind: 'chosen'; path: string }
  | { kind: 'chosenMissing'; path: string }
  | { kind: 'onPath'; name: string; path: string }
  | { kind: 'notFound'; name: string };

// compilerSituation reads which situation holds for the compiler the setting
// names.
export async function compilerSituation(configured: string, host: HostFacts): Promise<CompilerSituation> {
  if (namesAPath(configured)) {
    const file = path.resolve(configured);
    return (await isFile(file)) ? { kind: 'chosen', path: file } : { kind: 'chosenMissing', path: file };
  }
  const found = await findOnPath(configured, host);
  return found === null ? { kind: 'notFound', name: configured } : { kind: 'onPath', name: configured, path: found };
}

// findOnPath looks a plain name up on PATH the way the operating system starts
// one: the folders in order, the first file that can be run winning, and on
// Windows each extension PATHEXT names tried after the name as written.
export async function findOnPath(name: string, host: HostFacts): Promise<string | null> {
  const windows = host.platform === 'win32';
  const folders = (host.env.PATH ?? '').split(windows ? ';' : ':').filter((f) => f !== '');
  const extensions = windows && path.extname(name) === ''
    ? ['', ...(host.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((e) => e !== '')]
    : [''];
  for (const folder of folders) {
    for (const extension of extensions) {
      const candidate = path.join(folder, `${name}${extension}`);
      if (!(await isFile(candidate))) { continue; }
      if (windows || (await isExecutable(candidate))) { return candidate; }
    }
  }
  return null;
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fsp.stat(file)).isFile();
  } catch {
    return false;
  }
}

async function isExecutable(file: string): Promise<boolean> {
  try {
    await fsp.access(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// situationLine is the line the output channel carries for the compiler a
// plain name found on PATH, which is the one situation the reader did not name a
// file for — so the file and the version it reports are written down where the
// reader can look them up.
export function situationLine(situation: CompilerSituation, version: string | null): string | null {
  if (situation.kind !== 'onPath') { return null; }
  return `Aggrega: using the compiler found on PATH at ${situation.path}, version ${version ?? 'not reported'}.`;
}

// ---- what the extension may replace -------------------------------------------

// CompilerMemory is the extension's own record of where it downloaded a
// compiler, and of the versions it has already said were available. It is kept
// in the extension's own storage on this machine and never in a setting, so it
// is nothing a reader has to manage and nothing a repository can carry.
export interface CompilerMemory {
  downloadedInto(): readonly string[];
  rememberDownload(file: string): PromiseLike<void>;
  mentioned(): readonly string[];
  rememberMention(version: string): PromiseLike<void>;
}

// mayReplace reports whether the extension is entitled to replace a compiler at
// a path: the shared location, or a path it downloaded into itself.
export function mayReplace(
  file: string,
  shared: string | null,
  memory: Pick<CompilerMemory, 'downloadedInto'>,
  platform: string,
): boolean {
  if (shared !== null && samePath(file, shared, platform)) { return true; }
  return memory.downloadedInto().some((owned) => samePath(file, owned, platform));
}

// ---- downloading ----------------------------------------------------------------

// DownloadPrompts is every question the download puts to the reader, and every
// way it tells them how it went.
export interface DownloadPrompts {
  // askFolder asks for the folder to download into, offering the proposed one
  // for the reader to keep or change. Undefined is the reader declining.
  askFolder(proposed: string, version: string, target: ReleaseTarget): PromiseLike<string | undefined>;
  // confirm puts one question with one way forward; false is the reader
  // declining it.
  confirm(question: string, go: string): PromiseLike<boolean>;
  // withProgress runs work the reader can watch and stop.
  withProgress<T>(title: string, work: (signal: AbortSignal) => Promise<T>): PromiseLike<T>;
  inform(message: string): void;
  warn(message: string): void;
}

// DownloadDeps is what one download reads and writes.
export interface DownloadDeps {
  source: ReleaseSource;
  host: HostFacts;
  // compatibilityRange is the range of compiler versions this extension works
  // with, as its manifest declares it.
  compatibilityRange: string | undefined;
  // configuredPath is the compiler the setting names now.
  configuredPath: string;
  memory: CompilerMemory;
  runVersion: SpawnFn;
  // writeBinaryPath points the setting at the downloaded compiler.
  writeBinaryPath(file: string): PromiseLike<void>;
  prompts: DownloadPrompts;
}

// DownloadOutcome is how a download ended: a compiler installed, nothing changed
// with the reason already said, or the reader declining.
export type DownloadOutcome =
  | { kind: 'installed'; path: string; version: string; replaced: boolean }
  | { kind: 'kept'; sentence: string }
  | { kind: 'declined' };

// DOWNLOAD_GO, SHARED_INSTEAD_GO are the buttons the two confirmations carry.
export const DOWNLOAD_GO = 'Download';
export const SHARED_INSTEAD_GO = 'Download into the shared location';

// keptSentence is the one sentence that says nothing was changed, and why.
export function keptSentence(reason: string): string {
  return `Aggrega: no compiler was downloaded and ${BINARY_PATH_SETTING} was left as it is, because ${reason}.`;
}

// OfferedVersions is the versions a reader may be offered, newest first and
// never none, or the reason there are none to offer.
export type OfferedVersions =
  | { kind: 'offered'; versions: [string, ...string[]] }
  | { kind: 'kept'; reason: string };

// offeredVersions reads the release list, while the reader can watch and stop
// it, and keeps the releases this extension works with that carry a binary for
// the target. Every way a compiler is downloaded offers its versions from here,
// so the releases one surface offers and another refuses cannot differ.
export async function offeredVersions(
  source: ReleaseSource,
  compatibilityRange: string | undefined,
  target: ReleaseTarget,
  prompts: Pick<DownloadPrompts, 'withProgress'>,
): Promise<OfferedVersions> {
  let versions: string[];
  try {
    const releases = await prompts.withProgress(
      'Aggrega: reading the list of compiler releases',
      (signal) => listReleases(source, signal),
    );
    versions = compatibleVersions(releases, compatibilityRange, target);
  } catch (err) {
    return { kind: 'kept', reason: describeError(err) };
  }
  const [newest, ...older] = versions;
  if (newest === undefined) {
    return {
      kind: 'kept',
      reason: `no published release ${compatibilityRange ? `within ${compatibilityRange}, the versions this extension works with, ` : ''}carries a compiler for ${targetWords(target)}`,
    };
  }
  return { kind: 'offered', versions: [newest, ...older] };
}

// Destination is where a download may go: the file, the reader declining the
// one way on that was offered, or the reason it may go nowhere.
export type Destination =
  | { kind: 'to'; file: string }
  | { kind: 'declined' }
  | { kind: 'kept'; reason: string };

// replaceableDestination settles where a version may be downloaded, given the
// file the reader asked for: that file where nothing is there or the extension
// may replace what is, and otherwise the shared location — offered, never
// taken unasked. Every way a compiler is downloaded or replaced asks this, so
// the rule that decides what may be replaced has one home.
//
// 🔴 A FILE THE READER PUT THERE IS NOT REPLACED, AND THE WAY ON IS OFFERED
// RATHER THAN TAKEN. Downloading into the shared location instead changes which
// compiler the setting names, which is the reader's to agree to.
export async function replaceableDestination(
  wanted: string,
  version: string,
  shared: string | null,
  memory: Pick<CompilerMemory, 'downloadedInto'>,
  platform: string,
  prompts: Pick<DownloadPrompts, 'confirm'>,
): Promise<Destination> {
  if (await isFolder(wanted)) {
    return { kind: 'kept', reason: `${wanted} is a folder, so the compiler cannot be saved under that name` };
  }
  if (!(await exists(wanted)) || mayReplace(wanted, shared, memory, platform)) {
    return { kind: 'to', file: wanted };
  }
  if (shared === null) {
    return { kind: 'kept', reason: `${wanted} is a compiler you chose, which the extension never replaces` };
  }
  const instead = await prompts.confirm(
    `Aggrega: ${wanted} is a compiler you chose, and the extension never replaces one. Download aggrega ${version} into the shared location, ${shared}, instead?`,
    SHARED_INSTEAD_GO,
  );
  if (!instead) { return { kind: 'declined' }; }
  if (await isFolder(shared)) {
    return { kind: 'kept', reason: `${shared} is a folder, so the compiler cannot be saved under that name` };
  }
  return { kind: 'to', file: shared };
}

// downloadCompiler offers the newest release this extension works with, asks
// where to put it — proposing the shared location, or the folder of a compiler
// it already downloaded — confirms, downloads, and points the setting at it.
//
// 🔴 THE LIST OF RELEASES IS READ BEFORE THE READER IS ASKED ANYTHING, because
// the version is part of what they are asked to agree to: a folder chosen for a
// version they had not been shown is not a choice made with the facts.
export async function downloadCompiler(deps: DownloadDeps): Promise<DownloadOutcome> {
  const { prompts, host } = deps;
  const kept = (reason: string): DownloadOutcome => {
    const sentence = keptSentence(reason);
    prompts.warn(sentence);
    return { kind: 'kept', sentence };
  };

  const reading = releaseTarget(host.platform, host.arch);
  if (reading.kind === 'unsupported') { return kept(reading.sentence); }
  const target = reading.target;
  const shared = sharedLocation(target, host);

  const offered = await offeredVersions(deps.source, deps.compatibilityRange, target, prompts);
  if (offered.kind === 'kept') { return kept(offered.reason); }
  const version = offered.versions[0];

  const ownConfigured = namesAPath(deps.configuredPath)
    && mayReplace(path.resolve(deps.configuredPath), shared, deps.memory, host.platform);
  const proposed = ownConfigured
    ? path.dirname(path.resolve(deps.configuredPath))
    : shared !== null ? path.dirname(shared) : '';
  const folder = await prompts.askFolder(proposed, version, target);
  if (folder === undefined || folder.trim() === '') { return { kind: 'declined' }; }
  if (!path.isAbsolute(folder.trim())) {
    return kept(`${folder.trim()} is not a full path to a folder`);
  }

  const settled = await replaceableDestination(
    path.join(folder.trim(), installedFileName(target)),
    version,
    shared,
    deps.memory,
    host.platform,
    prompts,
  );
  if (settled.kind === 'declined') { return { kind: 'declined' }; }
  if (settled.kind === 'kept') { return kept(settled.reason); }
  const destination = settled.file;

  const replacing = await exists(destination);
  const go = await prompts.confirm(
    `Aggrega: download aggrega ${version} for ${targetWords(target)} into ${destination}${replacing ? ', replacing the aggrega already there,' : ''} and set ${BINARY_PATH_SETTING} to it?`,
    DOWNLOAD_GO,
  );
  if (!go) { return { kind: 'declined' }; }

  let outcome: InstallOutcome;
  try {
    outcome = await prompts.withProgress(
      `Aggrega: downloading aggrega ${version}`,
      (signal) => installRelease({
        source: deps.source,
        target,
        version,
        destination,
        runVersion: deps.runVersion,
        signal,
      }),
    );
  } catch (err) {
    return kept(describeError(err));
  }
  if (outcome.kind === 'refused') { return kept(outcome.reason); }

  await deps.writeBinaryPath(outcome.path);
  if (!mayReplace(outcome.path, shared, deps.memory, host.platform)) {
    await deps.memory.rememberDownload(outcome.path);
  }
  prompts.inform(
    `Aggrega: aggrega ${outcome.version} is installed at ${outcome.path}, and ${BINARY_PATH_SETTING} names it.`,
  );
  return { kind: 'installed', path: outcome.path, version: outcome.version, replaced: replacing };
}

async function exists(file: string): Promise<boolean> {
  try {
    await fsp.lstat(file);
    return true;
  } catch {
    return false;
  }
}

async function isFolder(file: string): Promise<boolean> {
  try {
    return (await fsp.stat(file)).isDirectory();
  } catch {
    return false;
  }
}

// ---- saying a newer release exists ---------------------------------------------

// newerVersionToMention answers with the newest version worth a word, or null:
// a version newer than the one running, not mentioned before. One word per
// version, so a reader who keeps the version they have is not told again until
// there is something new to tell.
export function newerVersionToMention(
  running: string,
  newestFirst: readonly string[],
  mentioned: readonly string[],
): string | null {
  const current = semver.coerce(running);
  const newest = newestFirst[0];
  if (current === null || newest === undefined) { return null; }
  if (!semver.gt(newest, current)) { return null; }
  return mentioned.includes(newest) ? null : newest;
}

// NoticeDeps is what the check for a newer release reads.
export interface NoticeDeps {
  source: ReleaseSource;
  host: HostFacts;
  compatibilityRange: string | undefined;
  configuredPath: string;
  memory: CompilerMemory;
  runVersion: SpawnFn;
  inform(message: string): void;
  log(line: string): void;
}

// noteNewerRelease says once that a newer release exists, for a compiler the
// extension is entitled to replace, and changes nothing.
//
// 🔴 IT ASKS FOR THE RELEASE LIST ONLY FOR A COMPILER THE EXTENSION MAY REPLACE —
// the shared location, or one it downloaded. A reader who points the editor at a
// build of their own has told it which compiler to run, and asking a service
// about releases on their behalf every time the editor starts is not something
// they asked for. Anything that goes wrong is written to the output channel and
// nowhere else: a word about an upgrade is not worth an interruption when it
// cannot be given.
export async function noteNewerRelease(deps: NoticeDeps): Promise<string | null> {
  const { host } = deps;
  const reading = releaseTarget(host.platform, host.arch);
  if (reading.kind === 'unsupported') { return null; }
  const target = reading.target;
  const situation = await compilerSituation(deps.configuredPath, host);
  const file = situation.kind === 'chosen' || situation.kind === 'onPath' ? situation.path : null;
  if (file === null || !mayReplace(file, sharedLocation(target, host), deps.memory, host.platform)) {
    return null;
  }
  const running = await readDaemonVersion({ binaryPath: file, spawn: deps.runVersion });
  if (running.kind === 'unreadable') { return null; }
  let versions: string[];
  try {
    versions = compatibleVersions(await listReleases(deps.source), deps.compatibilityRange, target);
  } catch (err) {
    deps.log(`Aggrega: could not read whether a newer compiler is available: ${describeError(err)}`);
    return null;
  }
  const newer = newerVersionToMention(running.version, versions, deps.memory.mentioned());
  if (newer === null) { return null; }
  await deps.memory.rememberMention(newer);
  deps.inform(
    `Aggrega: aggrega ${newer} is available; the compiler at ${file} is ${running.version}. The extension does not upgrade it on its own.`,
  );
  return newer;
}
