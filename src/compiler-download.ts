// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import * as semver from 'semver';

import { describeError } from './error-text';
import * as l10n from './l10n';
import { SpawnFn, readDaemonVersion } from './version-check';

// This module gets a compiler from a published release: it names the machine the
// extension runs on the way releases name it, reads the list of releases, and
// downloads, checks and installs one release's default binary. It reaches no
// editor type, so every one of those acts can be driven against a folder served
// on this machine.
//
// THE RULES ARE THE INSTALL SCRIPTS' RULES, because a reader may install the
// compiler either way and should get the same file: the default binary is
// aggrega-<version>-<os>-<arch>, with .exe on Windows, a release is tagged
// v<version>, and the release's SHA256SUMS list is what a download is checked
// against.
//
// 🔴 THE NETWORK IS REACHED THROUGH NODE'S OWN HTTP AND HTTPS MODULES, WITH NO
// AGENT OF THIS EXTENSION'S OWN, AND THAT IS HOW THE EDITOR'S PROXY SETTINGS
// APPLY. The editor hands an extension those two modules already configured from
// its proxy settings — the proxy address, whether the proxy's certificate is
// checked strictly, the hosts that bypass it — unless the reader has turned that
// support off. An agent supplied here would sit beside that configuration as a
// second one, and the two would disagree the first time a reader changed either.

// ReleaseSource is where releases are read from: the address the release list
// is asked for under, and the address release files are downloaded under.
//
// It is a value handed in rather than a constant read here so the whole download
// can be driven against releases served from this machine. It is no setting and
// no environment variable: a reader has no reason to point the extension at
// another host, and a name for it would be a surface to document and keep.
export interface ReleaseSource {
  // api is the repository's address on the release-list service; the list is
  // read from <api>/releases.
  api: string;
  // downloads is laid out the way the install scripts read it:
  // <downloads>/download/v<version>/<file>.
  downloads: string;
}

// PUBLISHED_RELEASES is where the compiler is published.
export const PUBLISHED_RELEASES: ReleaseSource = {
  api: 'https://api.github.com/repos/aggrega-ai/aggrega-cli',
  downloads: 'https://github.com/aggrega-ai/aggrega-cli/releases',
};

// ReleaseOs and ReleaseArch are the names release files carry.
export type ReleaseOs = 'linux' | 'darwin' | 'windows';
export type ReleaseArch = 'amd64' | 'arm64';

// ReleaseTarget is one machine a release carries a default binary for.
export interface ReleaseTarget {
  os: ReleaseOs;
  arch: ReleaseArch;
}

// TargetReading is what the machine the extension runs on reads as: one a
// release carries a binary for, or one it does not, with the sentence saying so.
export type TargetReading =
  | { kind: 'supported'; target: ReleaseTarget }
  | { kind: 'unsupported'; sentence: string };

// The operating systems and processors are named by their makers' own names, so
// neither list is translated.
const OS_WORDS: Record<ReleaseOs, string> = { linux: 'Linux', darwin: 'macOS', windows: 'Windows' };
const ARCH_WORDS: Record<ReleaseArch, string> = { amd64: '64-bit x86', arm64: '64-bit ARM' };

// releaseTarget reads the operating system and processor the extension runs on,
// in the runtime's own names, as the names release files carry.
//
// 🔴 IT IS HANDED THE NAMES RATHER THAN READING THEM, and the caller hands it the
// names of the process the extension runs in. That process runs on the machine
// the workspace is on — the remote machine, in a window opened on one — so the
// binary downloaded is one that machine can run.
export function releaseTarget(platform: string, arch: string): TargetReading {
  const os: ReleaseOs | null =
    platform === 'linux' ? 'linux' : platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'windows' : null;
  const releaseArch: ReleaseArch | null = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : null;
  if (os === null) {
    return {
      kind: 'unsupported',
      sentence: l10n.t('no release carries an aggrega binary for the operating system {0}; releases carry binaries for Linux and macOS on 64-bit x86 and 64-bit ARM, and for Windows on 64-bit x86', platform),
    };
  }
  if (releaseArch === null || (os === 'windows' && releaseArch !== 'amd64')) {
    return {
      kind: 'unsupported',
      sentence: l10n.t('no release carries an aggrega binary for {0} on the processor {1}; releases carry binaries for Linux and macOS on 64-bit x86 and 64-bit ARM, and for Windows on 64-bit x86', OS_WORDS[os], arch),
    };
  }
  return { kind: 'supported', target: { os, arch: releaseArch } };
}

// targetWords names a target the way a reader names it.
export function targetWords(target: ReleaseTarget): string {
  return l10n.t('{0} on {1}', OS_WORDS[target.os], ARCH_WORDS[target.arch]);
}

// releaseFileName is the default binary one release carries for one target.
export function releaseFileName(target: ReleaseTarget, version: string): string {
  return `aggrega-${version}-${target.os}-${target.arch}${target.os === 'windows' ? '.exe' : ''}`;
}

// installedFileName is the name the compiler is installed under, which is the
// name the install scripts give it.
export function installedFileName(target: ReleaseTarget): string {
  return target.os === 'windows' ? 'aggrega.exe' : 'aggrega';
}

// CHECKSUM_LIST is the file every release carries naming the SHA-256 digest of
// each of its files.
export const CHECKSUM_LIST = 'SHA256SUMS';

// ---- reaching the network ---------------------------------------------------

// ReleaseFetchError is a request for a release file or the release list that
// produced no usable answer. Its message is one clause saying why, written for
// the end of a sentence.
export class ReleaseFetchError extends Error {
  constructor(message: string, readonly rateLimited = false) {
    super(message);
    this.name = 'ReleaseFetchError';
  }
}

// REDIRECTS_FOLLOWED is how many redirects one request follows. A release file
// is answered with one redirect to the host that stores it; more than a few is
// a loop rather than a route.
const REDIRECTS_FOLLOWED = 5;

// IDLE_LIMIT_MS is how long a request may go without receiving anything before
// it is given up on, so a connection that stalls ends in a sentence rather than
// a download that never finishes.
const IDLE_LIMIT_MS = 30_000;

// REQUEST_HEADERS names the client making each request: this extension, by its
// identifier — publisher and name joined by a dot — since `aggrega` alone is also
// the compiler's name. It repeats the identifier settings.ts declares rather than
// importing it, so this module's imports stay the few its own work needs; nothing
// reads the header back, so the two can only disagree in a server's log.
const REQUEST_HEADERS = { 'User-Agent': 'aggrega-ai.aggrega' };

// open asks for one address and answers with the response that is not a
// redirect, or refuses with the reason.
function open(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
  redirectsLeft = REDIRECTS_FOLLOWED,
): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new ReleaseFetchError(l10n.t('{0} is not an address', url)));
      return;
    }
    const transport = parsed.protocol === 'https:' ? https : parsed.protocol === 'http:' ? http : null;
    if (transport === null) {
      reject(new ReleaseFetchError(l10n.t('{0} is not an http or https address', url)));
      return;
    }
    const request = transport.get(parsed, { headers: { ...REQUEST_HEADERS, ...headers }, signal }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirectsLeft === 0) {
          reject(new ReleaseFetchError(l10n.t('{0} redirected more than {1} times', url, REDIRECTS_FOLLOWED)));
          return;
        }
        open(new URL(location, parsed).toString(), headers, signal, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(refusalOf(url, response));
        return;
      }
      resolve(response);
    });
    request.setTimeout(IDLE_LIMIT_MS, () => {
      request.destroy(new Error(l10n.t('nothing arrived for {0} seconds', IDLE_LIMIT_MS / 1000)));
    });
    request.on('error', (err) => reject(unreachable(url, err)));
  });
}

// refusalOf reads a refusing answer. A request the release-list service is
// limiting answers 429, or 403 with none of its allowance left; every other
// status is reported as the status it is.
function refusalOf(url: string, response: http.IncomingMessage): ReleaseFetchError {
  const status = response.statusCode ?? 0;
  if (status === 429 || (status === 403 && response.headers['x-ratelimit-remaining'] === '0')) {
    return new ReleaseFetchError(
      l10n.t('GitHub is limiting how many requests this address may make for now, so try again later'),
      true,
    );
  }
  // The status's own words are the server's, and fill a placeholder as they came.
  return new ReleaseFetchError(response.statusMessage
    ? l10n.t('{0} answered {1} {2}', url, status, response.statusMessage)
    : l10n.t('{0} answered {1}', url, status));
}

function unreachable(url: string, err: unknown): ReleaseFetchError {
  if (err instanceof ReleaseFetchError) { return err; }
  if (isAbort(err)) { return new ReleaseFetchError(l10n.t('the download was stopped')); }
  return new ReleaseFetchError(l10n.t('{0} could not be reached: {1}', url, describeError(err)));
}

function isAbort(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError';
}

// fetchText reads one address whole, as text.
async function fetchText(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<string> {
  const response = await open(url, headers, signal);
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of response) {
      chunks.push(chunk as Buffer);
    }
  } catch (err) {
    throw unreachable(url, err);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// fetchToFile writes one address into a file and answers with the SHA-256
// digest of what was written, in lowercase hexadecimal.
async function fetchToFile(url: string, file: string, signal?: AbortSignal): Promise<string> {
  const response = await open(url, {}, signal);
  const digest = createHash('sha256');
  const out = fs.createWriteStream(file, { mode: 0o600 });
  try {
    await new Promise<void>((resolve, reject) => {
      response.on('data', (chunk: Buffer) => digest.update(chunk));
      response.on('error', reject);
      // A connection that ends before the whole body arrived ends the copy without
      // finishing it, so it is reported here rather than waited on.
      response.on('close', () => {
        if (!response.complete) { reject(new Error(l10n.t('the connection closed before the whole file arrived'))); }
      });
      out.on('error', reject);
      out.on('finish', () => resolve());
      response.pipe(out);
    });
  } catch (err) {
    out.destroy();
    throw unreachable(url, err);
  }
  return digest.digest('hex');
}

// ---- the release list --------------------------------------------------------

// PublishedRelease is one entry of the release list, as much of it as choosing
// a release reads.
export interface PublishedRelease {
  tag: string;
  draft: boolean;
  prerelease: boolean;
  assets: string[];
}

// listReleases reads the published releases, newest first as the list gives
// them.
export async function listReleases(source: ReleaseSource, signal?: AbortSignal): Promise<PublishedRelease[]> {
  const url = `${source.api}/releases?per_page=100`;
  const text = await fetchText(url, { Accept: 'application/vnd.github+json' }, signal);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ReleaseFetchError(l10n.t('what {0} answered is not a list of releases', url));
  }
  if (!Array.isArray(parsed)) {
    throw new ReleaseFetchError(l10n.t('what {0} answered is not a list of releases', url));
  }
  return parsed.flatMap((entry): PublishedRelease[] => {
    if (typeof entry !== 'object' || entry === null) { return []; }
    const e = entry as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; assets?: unknown };
    if (typeof e.tag_name !== 'string') { return []; }
    const assets = Array.isArray(e.assets)
      ? e.assets.flatMap((a) => (typeof a === 'object' && a !== null && typeof (a as { name?: unknown }).name === 'string'
        ? [(a as { name: string }).name]
        : []))
      : [];
    return [{ tag: e.tag_name, draft: e.draft === true, prerelease: e.prerelease === true, assets }];
  });
}

// compatibleVersions answers with the versions of the releases this extension
// works with that carry a default binary for the target and a checksum list,
// newest first.
//
// A draft and a pre-release are never offered: neither is a release a reader
// is meant to run without asking for it by name. A release whose tag is not
// v followed by a version is not one the install scripts could fetch either, so
// it is not offered. A range that is absent offers every release.
export function compatibleVersions(
  releases: readonly PublishedRelease[],
  range: string | undefined,
  target: ReleaseTarget,
): string[] {
  const versions = releases.flatMap((release) => {
    if (release.draft || release.prerelease || !release.tag.startsWith('v')) { return []; }
    const version = release.tag.slice(1);
    if (semver.valid(version) === null) { return []; }
    if (range !== undefined && !semver.satisfies(version, range)) { return []; }
    if (!release.assets.includes(releaseFileName(target, version)) || !release.assets.includes(CHECKSUM_LIST)) {
      return [];
    }
    return [version];
  });
  return [...new Set(versions)].sort(semver.rcompare);
}

// parseChecksums reads a SHA256SUMS list into the digest it names for each
// file, in lowercase. A line that is not a digest followed by a file name is
// skipped, as the install scripts skip one.
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = /^([0-9A-Fa-f]{64}) [ *](.+?)\s*$/.exec(line);
    if (m) { sums.set(m[2], m[1].toLowerCase()); }
  }
  return sums;
}

// ---- installing one release ---------------------------------------------------

// InstallRequest is one release to install, and where.
export interface InstallRequest {
  source: ReleaseSource;
  target: ReleaseTarget;
  version: string;
  // destination is the file the compiler is installed as.
  destination: string;
  // runVersion runs a binary with arguments and answers with what it printed;
  // it is the seam the version is read through everywhere else.
  runVersion: SpawnFn;
  signal?: AbortSignal;
}

// InstallOutcome is a compiler installed, with the version it reports, or the
// reason nothing was installed.
export type InstallOutcome =
  | { kind: 'installed'; path: string; version: string }
  | { kind: 'refused'; reason: string };

// installRelease downloads one release's default binary for the target, checks
// it against the release's checksum list, makes it executable, runs it once with
// `version -o json`, and only then puts it in place at the destination.
//
// 🔴 EVERY CHECK RUNS ON A COPY STAGED BESIDE THE DESTINATION, AND THE RENAME
// THAT PUTS IT IN PLACE IS THE LAST ACT. A download refused at any step is
// deleted and the destination is left as it was, so a compiler already there
// goes on being the one in use; and the rename is one step on one file system,
// so the destination never holds part of a file.
export async function installRelease(request: InstallRequest): Promise<InstallOutcome> {
  const { source, target, version, destination, signal } = request;
  const releaseDir = `${source.downloads}/download/v${version}`;
  const sumsUrl = `${releaseDir}/${CHECKSUM_LIST}`;
  const asset = releaseFileName(target, version);

  let sums: Map<string, string>;
  try {
    sums = parseChecksums(await fetchText(sumsUrl, {}, signal));
  } catch (err) {
    return { kind: 'refused', reason: describeError(err) };
  }
  const expected = sums.get(asset);
  if (expected === undefined) {
    return { kind: 'refused', reason: l10n.t('the checksum list at {0} names no {1}', sumsUrl, asset) };
  }

  const dir = path.dirname(destination);
  try {
    await fsp.mkdir(dir, { recursive: true });
  } catch (err) {
    return { kind: 'refused', reason: l10n.t('the folder {0} could not be created: {1}', dir, describeError(err)) };
  }
  const staged = path.join(
    dir,
    `.aggrega.download.${randomBytes(6).toString('hex')}${target.os === 'windows' ? '.exe' : ''}`,
  );
  const discard = async (): Promise<void> => {
    await fsp.rm(staged, { force: true });
  };

  let actual: string;
  try {
    actual = await fetchToFile(`${releaseDir}/${asset}`, staged, signal);
  } catch (err) {
    await discard();
    return { kind: 'refused', reason: describeError(err) };
  }
  if (actual !== expected) {
    await discard();
    return {
      kind: 'refused',
      reason: l10n.t('the SHA-256 checksum of the downloaded {0} is {1}, but {2} lists {3}, so the download was deleted', asset, actual, CHECKSUM_LIST, expected),
    };
  }

  if (target.os !== 'windows') {
    try {
      await fsp.chmod(staged, 0o755);
    } catch (err) {
      await discard();
      return { kind: 'refused', reason: l10n.t('the downloaded {0} could not be made executable: {1}', asset, describeError(err)) };
    }
  }

  const reading = await readDaemonVersion({ binaryPath: staged, spawn: request.runVersion });
  if (reading.kind === 'unreadable') {
    await discard();
    return {
      kind: 'refused',
      // The runtime's report of a failed run carries what the program printed on
      // lines of its own; its first line is what fits inside one sentence.
      reason: l10n.t('the downloaded {0} did not answer `version -o json` ({1}), so it was deleted', asset, describeError(reading.err).split('\n')[0].trim()),
    };
  }
  if (semver.coerce(reading.version)?.version !== semver.coerce(version)?.version) {
    await discard();
    return {
      kind: 'refused',
      reason: l10n.t('the downloaded {0} reports version {1} rather than {2}, so it was deleted', asset, reading.version, version),
    };
  }

  try {
    await fsp.rename(staged, destination);
  } catch (err) {
    await discard();
    return {
      kind: 'refused',
      reason: l10n.t('the downloaded {0} could not be put in place at {1} ({2}), so it was deleted', asset, destination, describeError(err)),
    };
  }
  return { kind: 'installed', path: destination, version: reading.version };
}
