// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ReleaseTarget, releaseFileName } from '../../src/compiler-download';
import {
  CompilerMemory,
  DownloadDeps,
  DownloadPrompts,
  HostFacts,
  compilerSituation,
  downloadCompiler,
  mayReplace,
  newerVersionToMention,
  offeredVersions,
  noteNewerRelease,
  samePath,
  sharedLocation,
  situationLine,
} from '../../src/compiler-provision';
import { readDaemonVersion } from '../../src/version-check';
import {
  ReleaseServer,
  ServedRelease,
  fakeCompiler,
  runVersion,
  serveReleases,
  sha256,
  startReleaseServer,
} from '../helpers/release-server';

// The situations a reader can be in with the compiler, each driven end to end:
// a path they set with a file there, a path they set with nothing there, a plain
// name found on PATH, and nothing found — and, across them, which file the
// extension may replace and when it says a newer release exists.
//
// Every release is served from 127.0.0.1 by a server started here; the home
// folder, the shared location and every other folder are temporary ones made
// here; the setting and the extension's own record are stand-ins that record
// what was written. Nothing here touches the real home folder, the editor's
// settings or its storage.

const LINUX: ReleaseTarget = { os: 'linux', arch: 'amd64' };
const RANGE = '>=0.1.0 <1.0.0';
const SETTING = 'aggrega.server.binaryPath';

// RELEASES are what the server publishes: the newest inside the range is 0.9.1,
// because 1.0.0 is outside it and 0.9.2-rc.1 is a pre-release.
function releases(overrides: Partial<Record<string, Partial<ServedRelease>>> = {}): ServedRelease[] {
  const one = (version: string, extra: Partial<ServedRelease> = {}): ServedRelease => ({
    version,
    files: [{ name: releaseFileName(LINUX, version), body: fakeCompiler(version) }],
    ...extra,
    ...overrides[version],
  });
  return [one('1.0.0'), one('0.9.2-rc.1', { prerelease: true }), one('0.9.1'), one('0.9.0')];
}

function needsPosix(ctx: Mocha.Context): void {
  if (process.platform === 'win32') { ctx.skip(); }
}

// Seen is what the stand-in prompts were asked and told.
interface Seen {
  folders: Array<{ proposed: string; version: string }>;
  confirms: string[];
  progress: string[];
  informed: string[];
  warned: string[];
}

// scriptedPrompts answers the download's questions as a reader would, from the
// answers given, and records every question and every message.
function scriptedPrompts(answers: {
  folder?: (proposed: string) => string | undefined;
  confirm?: (question: string) => boolean;
}): { prompts: DownloadPrompts; seen: Seen } {
  const seen: Seen = { folders: [], confirms: [], progress: [], informed: [], warned: [] };
  const prompts: DownloadPrompts = {
    askFolder: async (proposed, version) => {
      seen.folders.push({ proposed, version });
      return answers.folder ? answers.folder(proposed) : proposed;
    },
    confirm: async (question) => {
      seen.confirms.push(question);
      return answers.confirm ? answers.confirm(question) : true;
    },
    withProgress: (title, work) => {
      seen.progress.push(title);
      return work(new AbortController().signal);
    },
    inform: (message) => { seen.informed.push(message); },
    warn: (message) => { seen.warned.push(message); },
  };
  return { prompts, seen };
}

// memoryOf is the extension's own record, held in two lists a spec can read.
function memoryOf(downloaded: string[] = [], mentioned: string[] = []): CompilerMemory & {
  downloaded: string[];
  mentionedList: string[];
} {
  return {
    downloaded,
    mentionedList: mentioned,
    downloadedInto: () => downloaded,
    rememberDownload: async (file) => { downloaded.push(file); },
    mentioned: () => mentioned,
    rememberMention: async (version) => { mentioned.push(version); },
  };
}

describe('compiler-provision: which situation holds', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aggrega-situation-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const host = (pathValue: string): HostFacts => ({ platform: 'linux', arch: 'x64', home: dir, env: { PATH: pathValue } });

  it('(a) reads a path set with a file there as the reader\'s own compiler', async () => {
    const mine = path.join(dir, 'tools', 'aggrega');
    fs.mkdirSync(path.dirname(mine));
    fs.writeFileSync(mine, 'my own build');
    assert.deepStrictEqual(await compilerSituation(mine, host('')), { kind: 'chosen', path: mine });
  });

  it('(b) reads a path set with nothing there as a missing one', async () => {
    const missing = path.join(dir, 'nowhere', 'aggrega');
    assert.deepStrictEqual(await compilerSituation(missing, host('')), { kind: 'chosenMissing', path: missing });
  });

  it('(c) finds a plain name on PATH, skipping a file there that cannot be run, and writes its version down', async function () {
    needsPosix(this);
    const first = path.join(dir, 'first');
    const second = path.join(dir, 'second');
    fs.mkdirSync(first);
    fs.mkdirSync(second);
    fs.writeFileSync(path.join(first, 'aggrega'), 'not runnable', { mode: 0o644 });
    fs.writeFileSync(path.join(second, 'aggrega'), fakeCompiler('0.9.0'), { mode: 0o755 });
    const situation = await compilerSituation('aggrega', host(`${first}:${second}`));
    assert.deepStrictEqual(situation, { kind: 'onPath', name: 'aggrega', path: path.join(second, 'aggrega') });
    const reading = await readDaemonVersion({ binaryPath: path.join(second, 'aggrega'), spawn: runVersion });
    assert.deepStrictEqual(reading, { kind: 'reported', version: '0.9.0' });
    assert.strictEqual(
      situationLine(situation, reading.kind === 'reported' ? reading.version : null),
      `Aggrega: using the compiler found on PATH at ${path.join(second, 'aggrega')}, version 0.9.0.`,
    );
    // The line belongs to the one situation the reader did not name a file for.
    assert.strictEqual(situationLine({ kind: 'chosen', path: '/x/aggrega' }, '0.9.0'), null);
  });

  it('(d) reads a plain name found nowhere as nothing found', async () => {
    assert.deepStrictEqual(await compilerSituation('aggrega', host('')), { kind: 'notFound', name: 'aggrega' });
    assert.deepStrictEqual(await compilerSituation('aggrega', host(path.join(dir, 'empty'))), { kind: 'notFound', name: 'aggrega' });
  });

  it('proposes the folder the install scripts use, on each operating system', () => {
    assert.strictEqual(
      sharedLocation(LINUX, { platform: 'linux', arch: 'x64', home: '/home/someone', env: {} }),
      path.join('/home/someone', '.local', 'bin', 'aggrega'),
    );
    assert.strictEqual(
      sharedLocation({ os: 'darwin', arch: 'arm64' }, { platform: 'darwin', arch: 'arm64', home: '/Users/someone', env: {} }),
      path.join('/Users/someone', '.local', 'bin', 'aggrega'),
    );
    assert.strictEqual(
      sharedLocation({ os: 'windows', arch: 'amd64' }, { platform: 'win32', arch: 'x64', home: 'C:\\Users\\someone', env: { LOCALAPPDATA: 'C:\\Users\\someone\\AppData\\Local' } }),
      path.join('C:\\Users\\someone\\AppData\\Local', 'Programs', 'aggrega', 'aggrega.exe'),
    );
    assert.strictEqual(
      sharedLocation({ os: 'windows', arch: 'amd64' }, { platform: 'win32', arch: 'x64', home: 'C:\\Users\\someone', env: {} }),
      null,
    );
  });
});

describe('compiler-provision: (f) what the extension may replace', () => {
  it('replaces the shared location and a file it downloaded itself, and nothing else', () => {
    const shared = '/home/someone/.local/bin/aggrega';
    const memory = memoryOf(['/opt/tools/aggrega']);
    assert.strictEqual(mayReplace(shared, shared, memory, 'linux'), true);
    assert.strictEqual(mayReplace('/opt/tools/aggrega', shared, memory, 'linux'), true);
    assert.strictEqual(mayReplace('/home/someone/build/aggrega', shared, memory, 'linux'), false);
    assert.strictEqual(mayReplace('/opt/tools/aggrega', null, memoryOf(), 'linux'), false);
  });

  it('compares paths without regard to case only where the operating system does', () => {
    assert.strictEqual(samePath('C:\\Tools\\aggrega.exe', 'c:\\tools\\AGGREGA.EXE', 'win32'), true);
    assert.strictEqual(samePath('/opt/Tools/aggrega', '/opt/tools/aggrega', 'linux'), false);
  });
});

describe('compiler-provision: downloading', () => {
  let server: ReleaseServer;
  let home: string;
  let shared: string;
  let written: string[];

  beforeEach(async () => {
    server = await startReleaseServer();
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aggrega-home-'));
    shared = path.join(home, '.local', 'bin', 'aggrega');
    written = [];
  });
  afterEach(async () => {
    await server.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  function deps(configuredPath: string, prompts: DownloadPrompts, memory: CompilerMemory, platform = 'linux'): DownloadDeps {
    return {
      source: server.source,
      host: { platform, arch: 'x64', home, env: { PATH: '' } },
      compatibilityRange: RANGE,
      configuredPath,
      memory,
      runVersion,
      writeBinaryPath: async (file) => { written.push(file); },
      prompts,
    };
  }

  const kept = (reason: string): string =>
    `Aggrega: no compiler was downloaded and ${SETTING} was left as it is, because ${reason}.`;

  it('(d) shows the newest release inside the range, proposes the shared folder, lets the reader change it, confirms, downloads and sets the path', async function () {
    needsPosix(this);
    serveReleases(server, releases());
    const elsewhere = path.join(home, 'tools');
    const { prompts, seen } = scriptedPrompts({ folder: () => elsewhere });
    const memory = memoryOf();
    const outcome = await downloadCompiler(deps('aggrega', prompts, memory));
    const destination = path.join(elsewhere, 'aggrega');
    assert.deepStrictEqual(outcome, { kind: 'installed', path: destination, version: '0.9.1', replaced: false });
    assert.deepStrictEqual(seen.folders, [{ proposed: path.dirname(shared), version: '0.9.1' }]);
    assert.deepStrictEqual(seen.confirms, [
      `Aggrega: download aggrega 0.9.1 for Linux on 64-bit x86 into ${destination} and set ${SETTING} to it?`,
    ]);
    assert.deepStrictEqual(written, [destination]);
    assert.deepStrictEqual(memory.downloaded, [destination], 'a download outside the shared location is not remembered as the extension\'s own');
    assert.deepStrictEqual(seen.informed, [`Aggrega: aggrega 0.9.1 is installed at ${destination}, and ${SETTING} names it.`]);
    assert.deepStrictEqual(seen.warned, []);
    assert.strictEqual(fs.readFileSync(destination, 'utf8'), fakeCompiler('0.9.1'));
    assert.ok(!server.requests.some((r) => r.includes('v1.0.0') || r.includes('rc.1')), 'a release outside the range was fetched');
  });

  it('(d) keeps the proposed shared folder when the reader does, and records nothing of its own for it', async function () {
    needsPosix(this);
    serveReleases(server, releases());
    const { prompts } = scriptedPrompts({});
    const memory = memoryOf();
    const outcome = await downloadCompiler(deps('aggrega', prompts, memory));
    assert.deepStrictEqual(outcome, { kind: 'installed', path: shared, version: '0.9.1', replaced: false });
    assert.deepStrictEqual(written, [shared]);
    assert.deepStrictEqual(memory.downloaded, []);
  });

  it('(d) changes nothing when the reader declines the folder or the confirmation', async () => {
    serveReleases(server, releases());
    const declineFolder = scriptedPrompts({ folder: () => undefined });
    assert.deepStrictEqual(await downloadCompiler(deps('aggrega', declineFolder.prompts, memoryOf())), { kind: 'declined' });
    const declineConfirm = scriptedPrompts({ confirm: () => false });
    assert.deepStrictEqual(await downloadCompiler(deps('aggrega', declineConfirm.prompts, memoryOf())), { kind: 'declined' });
    assert.deepStrictEqual(written, []);
    assert.ok(!fs.existsSync(shared));
    assert.ok(!server.requests.some((r) => r.startsWith('/releases/')), 'a release file was fetched without consent');
  });

  it('(a) never replaces the reader\'s own compiler, and offers the shared location instead', async function () {
    needsPosix(this);
    serveReleases(server, releases());
    const mine = path.join(home, 'build', 'aggrega');
    fs.mkdirSync(path.dirname(mine));
    fs.writeFileSync(mine, 'my own build');

    // The proposal is the shared folder, not the reader's own.
    const declined = scriptedPrompts({ folder: () => path.dirname(mine), confirm: () => false });
    assert.deepStrictEqual(await downloadCompiler(deps(mine, declined.prompts, memoryOf())), { kind: 'declined' });
    assert.strictEqual(declined.seen.folders[0].proposed, path.dirname(shared));
    assert.deepStrictEqual(declined.seen.confirms, [
      `Aggrega: ${mine} is a compiler you chose, and the extension never replaces one. Download aggrega 0.9.1 into the shared location, ${shared}, instead?`,
    ]);
    assert.strictEqual(fs.readFileSync(mine, 'utf8'), 'my own build');
    assert.deepStrictEqual(written, []);

    const accepted = scriptedPrompts({ folder: () => path.dirname(mine) });
    const outcome = await downloadCompiler(deps(mine, accepted.prompts, memoryOf()));
    assert.deepStrictEqual(outcome, { kind: 'installed', path: shared, version: '0.9.1', replaced: false });
    assert.strictEqual(fs.readFileSync(mine, 'utf8'), 'my own build', 'the reader\'s own compiler was replaced');
    assert.deepStrictEqual(written, [shared]);
  });

  it('(b) proposes the shared folder for a path set with nothing there', async () => {
    serveReleases(server, releases());
    const { prompts, seen } = scriptedPrompts({ folder: () => undefined });
    await downloadCompiler(deps(path.join(home, 'gone', 'aggrega'), prompts, memoryOf()));
    assert.deepStrictEqual(seen.folders, [{ proposed: path.dirname(shared), version: '0.9.1' }]);
  });

  it('(f) replaces a compiler it downloaded itself, in place, and says it is replacing it', async function () {
    needsPosix(this);
    serveReleases(server, releases());
    const ours = path.join(home, 'tools', 'aggrega');
    fs.mkdirSync(path.dirname(ours));
    fs.writeFileSync(ours, fakeCompiler('0.9.0'), { mode: 0o755 });
    const memory = memoryOf([ours]);
    const { prompts, seen } = scriptedPrompts({});
    const outcome = await downloadCompiler(deps(ours, prompts, memory));
    assert.deepStrictEqual(outcome, { kind: 'installed', path: ours, version: '0.9.1', replaced: true });
    assert.deepStrictEqual(seen.folders, [{ proposed: path.dirname(ours), version: '0.9.1' }]);
    assert.deepStrictEqual(seen.confirms, [
      `Aggrega: download aggrega 0.9.1 for Linux on 64-bit x86 into ${ours}, replacing the aggrega already there, and set ${SETTING} to it?`,
    ]);
    assert.strictEqual(fs.readFileSync(ours, 'utf8'), fakeCompiler('0.9.1'));
    assert.deepStrictEqual(memory.downloaded, [ours], 'the record of its own download was written twice');
  });

  it('keeps the current compiler and says so when the release list is limited (403)', async () => {
    server.answer('/api/releases', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    const { prompts, seen } = scriptedPrompts({});
    const outcome = await downloadCompiler(deps('aggrega', prompts, memoryOf()));
    const sentence = kept('GitHub is limiting how many requests this address may make for now, so try again later');
    assert.deepStrictEqual(outcome, { kind: 'kept', sentence });
    assert.deepStrictEqual(seen.warned, [sentence]);
    assert.deepStrictEqual(seen.folders, [], 'the reader was asked for a folder with no version to offer');
    assert.deepStrictEqual(written, []);
  });

  it('keeps the current compiler and says so when the release list is limited (429)', async () => {
    server.answer('/api/releases', { status: 429 });
    const { prompts } = scriptedPrompts({});
    const outcome = await downloadCompiler(deps('aggrega', prompts, memoryOf()));
    assert.deepStrictEqual(outcome, {
      kind: 'kept',
      sentence: kept('GitHub is limiting how many requests this address may make for now, so try again later'),
    });
  });

  it('keeps the current compiler and says so when the releases cannot be reached', async () => {
    const source = server.source;
    await server.close();
    server = await startReleaseServer();
    const { prompts, seen } = scriptedPrompts({});
    const outcome = await downloadCompiler({ ...deps('aggrega', prompts, memoryOf()), source });
    assert.strictEqual(outcome.kind, 'kept');
    assert.match(seen.warned[0], /^Aggrega: no compiler was downloaded and aggrega\.server\.binaryPath was left as it is, because .+ could not be reached: .+\.$/);
    assert.deepStrictEqual(written, []);
  });

  it('refuses an unsupported machine by name, before asking anything of the network', async () => {
    serveReleases(server, releases());
    const { prompts, seen } = scriptedPrompts({});
    const outcome = await downloadCompiler(deps('aggrega', prompts, memoryOf(), 'freebsd'));
    assert.strictEqual(outcome.kind, 'kept');
    assert.match(seen.warned[0], /no release carries an aggrega binary for the operating system freebsd/);
    assert.deepStrictEqual(server.requests, []);
  });

  it('keeps the current compiler when the download differs from its checksum by one byte, naming the file', async () => {
    const asset = releaseFileName(LINUX, '0.9.1');
    const good = fakeCompiler('0.9.1');
    const planted = Buffer.from(good);
    planted[10] ^= 0x01;
    serveReleases(server, releases({
      '0.9.1': { files: [{ name: asset, body: planted }], listedDigest: { [asset]: sha256(good) } },
    }));
    fs.mkdirSync(path.dirname(shared), { recursive: true });
    fs.writeFileSync(shared, 'the compiler already here');
    const { prompts } = scriptedPrompts({});
    const outcome = await downloadCompiler(deps('aggrega', prompts, memoryOf()));
    assert.deepStrictEqual(outcome, {
      kind: 'kept',
      sentence: kept(`the SHA-256 checksum of the downloaded ${asset} is ${sha256(planted)}, but SHA256SUMS lists ${sha256(good)}, so the download was deleted`),
    });
    assert.strictEqual(fs.readFileSync(shared, 'utf8'), 'the compiler already here');
    assert.deepStrictEqual(fs.readdirSync(path.dirname(shared)), ['aggrega']);
    assert.deepStrictEqual(written, []);
  });

  it('keeps the current compiler when the download fails `version -o json`', async function () {
    needsPosix(this);
    const asset = releaseFileName(LINUX, '0.9.1');
    serveReleases(server, releases({ '0.9.1': { files: [{ name: asset, body: fakeCompiler('0.9.1', true) }] } }));
    fs.mkdirSync(path.dirname(shared), { recursive: true });
    fs.writeFileSync(shared, 'the compiler already here');
    const { prompts, seen } = scriptedPrompts({});
    const outcome = await downloadCompiler(deps('aggrega', prompts, memoryOf()));
    assert.strictEqual(outcome.kind, 'kept');
    assert.match(seen.warned[0], new RegExp(`because the downloaded ${asset} did not answer \`version -o json\` \\(.+\\), so it was deleted\\.$`));
    assert.strictEqual(fs.readFileSync(shared, 'utf8'), 'the compiler already here');
    assert.deepStrictEqual(written, []);
  });

  it('says so when no release inside the range carries this machine\'s binary', async () => {
    serveReleases(server, [releases()[0]]);
    const { prompts } = scriptedPrompts({});
    const outcome = await downloadCompiler(deps('aggrega', prompts, memoryOf()));
    assert.deepStrictEqual(outcome, {
      kind: 'kept',
      sentence: kept(`no published release within ${RANGE}, the versions this extension works with, carries a compiler for Linux on 64-bit x86`),
    });
  });
});

describe('compiler-provision: (g) it never upgrades on its own, and says once per version that a newer one exists', () => {
  it('names the newest version only when it is newer and not mentioned before', () => {
    assert.strictEqual(newerVersionToMention('0.9.0', ['0.9.1', '0.9.0'], []), '0.9.1');
    assert.strictEqual(newerVersionToMention('0.9.0', ['0.9.1', '0.9.0'], ['0.9.1']), null);
    assert.strictEqual(newerVersionToMention('0.9.1', ['0.9.1', '0.9.0'], []), null);
    assert.strictEqual(newerVersionToMention('0.9.0-3-gabc1234', ['0.9.1'], []), '0.9.1');
    assert.strictEqual(newerVersionToMention('(devel)', ['0.9.1'], []), null);
    assert.strictEqual(newerVersionToMention('0.9.0', [], []), null);
  });

  let server: ReleaseServer;
  let home: string;
  beforeEach(async () => {
    server = await startReleaseServer();
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aggrega-notice-'));
  });
  afterEach(async () => {
    await server.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  function noticeDeps(configuredPath: string, memory: CompilerMemory, informed: string[]) {
    return {
      source: server.source,
      host: { platform: 'linux', arch: 'x64', home, env: { PATH: '' } },
      compatibilityRange: RANGE,
      configuredPath,
      memory,
      runVersion,
      inform: (message: string) => { informed.push(message); },
      log: () => undefined,
    };
  }

  it('says once that a newer release exists for a compiler at the shared location, and changes nothing', async function () {
    needsPosix(this);
    serveReleases(server, releases());
    const shared = path.join(home, '.local', 'bin', 'aggrega');
    fs.mkdirSync(path.dirname(shared), { recursive: true });
    fs.writeFileSync(shared, fakeCompiler('0.9.0'), { mode: 0o755 });
    const memory = memoryOf();
    const informed: string[] = [];
    assert.strictEqual(await noteNewerRelease(noticeDeps(shared, memory, informed)), '0.9.1');
    assert.deepStrictEqual(informed, [
      `Aggrega: aggrega 0.9.1 is available; the compiler at ${shared} is 0.9.0. The extension does not upgrade it on its own.`,
    ]);
    assert.deepStrictEqual(memory.mentionedList, ['0.9.1']);
    assert.strictEqual(await noteNewerRelease(noticeDeps(shared, memory, informed)), null);
    assert.strictEqual(informed.length, 1, 'the same version was mentioned twice');
    assert.strictEqual(fs.readFileSync(shared, 'utf8'), fakeCompiler('0.9.0'), 'the compiler was upgraded unasked');
    assert.ok(!server.requests.some((r) => r.startsWith('/releases/')), 'a release file was fetched unasked');
  });

  it('asks nothing of the network for a compiler the reader chose', async function () {
    needsPosix(this);
    serveReleases(server, releases());
    const mine = path.join(home, 'build', 'aggrega');
    fs.mkdirSync(path.dirname(mine));
    fs.writeFileSync(mine, fakeCompiler('0.9.0'), { mode: 0o755 });
    const informed: string[] = [];
    assert.strictEqual(await noteNewerRelease(noticeDeps(mine, memoryOf(), informed)), null);
    assert.deepStrictEqual(informed, []);
    assert.deepStrictEqual(server.requests, []);
  });
});

describe('compiler-provision: the versions offered', () => {
  let server: ReleaseServer;
  beforeEach(async () => { server = await startReleaseServer(); });
  afterEach(async () => { await server.close(); });

  const one = (version: string): ServedRelease => ({
    version,
    prerelease: false,
    files: [{ name: releaseFileName({ os: 'linux', arch: 'amd64' }, version), body: 'x' }],
  });
  const progress = { withProgress: <T>(_title: string, work: (signal: AbortSignal) => Promise<T>) => work(new AbortController().signal) };
  const target: ReleaseTarget = { os: 'linux', arch: 'amd64' };

  it('names the newest newer release outside the range beside the versions inside it', async () => {
    serveReleases(server, [one('0.10.0'), one('0.9.1'), one('0.8.11')]);
    const offered = await offeredVersions(server.source, '>=0.9.0 <0.10.0', target, progress);
    assert.deepStrictEqual(offered, { kind: 'offered', versions: ['0.9.1'], incompatible: '0.10.0' });
  });

  it('names none when every release is inside the range or below it', async () => {
    serveReleases(server, [one('0.9.1'), one('0.8.11')]);
    const offered = await offeredVersions(server.source, '>=0.9.0 <0.10.0', target, progress);
    assert.deepStrictEqual(offered, { kind: 'offered', versions: ['0.9.1'] });
  });
});
