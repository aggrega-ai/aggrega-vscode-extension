// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ReleaseTarget, releaseFileName } from '../../src/compiler-download';
import { CompilerMemory, SHARED_INSTEAD_GO } from '../../src/compiler-provision';
import {
  SWITCH_GO,
  ServerStart,
  VersionDeps,
  VersionPrompts,
  candidateFor,
  selectCompilerVersion,
  versionDescription,
  versionWarning,
} from '../../src/compiler-version';
import {
  ReleaseServer,
  ServedRelease,
  fakeServingCompiler,
  runVersion,
  serveReleases,
  startReleaseServer,
} from '../helpers/release-server';

// Changing the compiler's version, driven end to end: the releases are served
// from 127.0.0.1 by a server started here, the home folder and the shared
// location are temporary folders made here, the setting and the extension's own
// record are stand-ins that record what was written, and starting the language
// server is a stand-in that runs the candidate the way the editor would and
// reports whether it came up. Nothing here touches the real home folder, the
// editor's settings or its storage.

const LINUX: ReleaseTarget = { os: 'linux', arch: 'amd64' };
const RANGE = '>=0.1.0 <1.0.0';
const SETTING = 'aggrega.server.binaryPath';

function needsPosix(ctx: Mocha.Context): void {
  if (process.platform === 'win32') { ctx.skip(); }
}

// releases are what the server publishes: inside the range, 0.9.1 is the newest
// and 0.9.0 the one before it; 1.0.0 is outside it and 0.9.2-rc.1 is a
// pre-release. 0.9.1 starts the language server unless told otherwise.
function releases(newestServes = true): ServedRelease[] {
  const one = (version: string, serves: boolean, prerelease = false): ServedRelease => ({
    version,
    prerelease,
    files: [{ name: releaseFileName(LINUX, version), body: fakeServingCompiler(version, serves) }],
  });
  return [one('1.0.0', true), one('0.9.2-rc.1', true, true), one('0.9.1', newestServes), one('0.9.0', true)];
}

interface Seen {
  offered: Array<{ versions: readonly string[]; current: string | null }>;
  confirms: string[];
  informed: string[];
  warned: string[];
  started: string[];
  // at each start, what the file being replaced held at that moment
  heldAtStart: Array<string | null>;
  restored: number;
}

function memoryOf(downloaded: string[] = []): CompilerMemory {
  return {
    downloadedInto: () => downloaded,
    rememberDownload: async (file) => { downloaded.push(file); },
    mentioned: () => [],
    rememberMention: async () => undefined,
  };
}

describe('compiler-version: what the list and the warning say', () => {
  it('marks the newest version and the one in use', () => {
    assert.strictEqual(versionDescription('0.9.1', '0.9.0', true), 'newest');
    assert.strictEqual(versionDescription('0.9.0', '0.9.0', false), 'in use');
    assert.strictEqual(versionDescription('0.9.1', '0.9.1-3-gabc1234', true), 'newest, in use');
    assert.strictEqual(versionDescription('0.9.0', null, false), '');
  });

  it('warns that the version changes for every workspace on this machine and that a lockfile may need regenerating', () => {
    assert.strictEqual(
      versionWarning('0.9.1', '/home/someone/.local/bin/aggrega'),
      'Aggrega: switch to aggrega 0.9.1? The compiler at /home/someone/.local/bin/aggrega is the one every workspace on this machine uses, so the version changes for all of them, and a Release whose lockfile another version wrote may need its lockfile regenerated with Pull.',
    );
  });

  it('downloads beside the file it is to replace, under a hidden name', () => {
    assert.strictEqual(
      candidateFor('/home/someone/.local/bin/aggrega', '0.9.1', LINUX),
      path.join('/home/someone/.local/bin', '.aggrega-0.9.1.candidate'),
    );
    assert.strictEqual(
      candidateFor('C:\\aggrega\\aggrega.exe', '0.9.1', { os: 'windows', arch: 'amd64' }).endsWith('.aggrega-0.9.1.candidate.exe'),
      true,
    );
  });
});

describe('compiler-version: (e) choosing the version', () => {
  let server: ReleaseServer;
  let home: string;
  let shared: string;
  let written: string[];

  beforeEach(async () => {
    server = await startReleaseServer();
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'aggrega-version-'));
    shared = path.join(home, '.local', 'bin', 'aggrega');
    fs.mkdirSync(path.dirname(shared), { recursive: true });
    fs.writeFileSync(shared, fakeServingCompiler('0.9.0', true), { mode: 0o755 });
    written = [];
  });
  afterEach(async () => {
    await server.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  // run changes the version as a reader answering the questions would, and
  // records every question, every message and every start.
  async function run(
    configuredPath: string,
    answers: { pick?: string; confirm?: (question: string) => boolean; noServer?: boolean } = {},
  ) {
    const seen: Seen = { offered: [], confirms: [], informed: [], warned: [], started: [], heldAtStart: [], restored: 0 };
    const prompts: VersionPrompts = {
      pickVersion: async (versions, current) => {
        seen.offered.push({ versions: [...versions], current });
        return answers.pick;
      },
      confirm: async (question) => {
        seen.confirms.push(question);
        return answers.confirm ? answers.confirm(question) : true;
      },
      withProgress: (_title, work) => work(new AbortController().signal),
      inform: (message) => { seen.informed.push(message); },
      warn: (message) => { seen.warned.push(message); },
    };
    const deps: VersionDeps = {
      source: server.source,
      host: { platform: 'linux', arch: 'x64', home, env: { PATH: '' } },
      compatibilityRange: RANGE,
      configuredPath,
      memory: memoryOf(),
      runVersion,
      writeBinaryPath: async (file) => { written.push(file); },
      startServerOn: async (file): Promise<ServerStart> => {
        seen.started.push(file);
        seen.heldAtStart.push(fs.existsSync(shared) ? fs.readFileSync(shared, 'utf8') : null);
        if (answers.noServer) { return { kind: 'noServer' }; }
        try {
          await runVersion(file, ['serve']);
          return { kind: 'started' };
        } catch (err) {
          return { kind: 'failed', reason: (err as Error).message.split('\n')[0] };
        }
      },
      restoreServer: async () => { seen.restored += 1; },
      prompts,
    };
    return { outcome: await selectCompilerVersion(deps), seen };
  }

  it('lists the releases inside the range, newest first, saying which version is in use', async function () {
    needsPosix(this);
    serveReleases(server, releases());
    const { outcome, seen } = await run(shared);
    assert.deepStrictEqual(outcome, { kind: 'declined' });
    assert.deepStrictEqual(seen.offered, [{ versions: ['0.9.1', '0.9.0'], current: '0.9.0' }]);
    assert.ok(!server.requests.some((r) => r.startsWith('/releases/')), 'a release file was fetched before a version was chosen');
  });

  it('warns and asks for confirmation, and changes nothing when the reader declines', async function () {
    needsPosix(this);
    serveReleases(server, releases());
    const { outcome, seen } = await run(shared, { pick: '0.9.1', confirm: () => false });
    assert.deepStrictEqual(outcome, { kind: 'declined' });
    assert.deepStrictEqual(seen.confirms, [versionWarning('0.9.1', shared)]);
    assert.ok(seen.confirms[0].includes('every workspace on this machine') && seen.confirms[0].includes('lockfile'));
    assert.strictEqual(fs.readFileSync(shared, 'utf8'), fakeServingCompiler('0.9.0', true));
    assert.deepStrictEqual(seen.started, []);
    assert.ok(!server.requests.some((r) => r.startsWith('/releases/')), 'a release file was fetched without consent');
  });

  it('downloads beside the current copy, starts the server on it, and only then replaces the old one', async function () {
    needsPosix(this);
    serveReleases(server, releases());
    const { outcome, seen } = await run(shared, { pick: '0.9.1' });
    const candidate = candidateFor(shared, '0.9.1', LINUX);
    assert.deepStrictEqual(outcome, { kind: 'switched', path: shared, version: '0.9.1', started: true });
    assert.deepStrictEqual(seen.confirms, [versionWarning('0.9.1', shared)]);
    assert.deepStrictEqual(seen.started, [candidate], 'the server was not started on the copy beside the current one');
    assert.deepStrictEqual(
      seen.heldAtStart,
      [fakeServingCompiler('0.9.0', true)],
      'the old compiler had already been replaced when the new one was started',
    );
    assert.strictEqual(fs.readFileSync(shared, 'utf8'), fakeServingCompiler('0.9.1', true));
    assert.deepStrictEqual(fs.readdirSync(path.dirname(shared)), ['aggrega'], 'the candidate was left beside the compiler');
    assert.deepStrictEqual(written, [], 'the setting already named this file, so nothing was to be written');
    assert.strictEqual(seen.restored, 1, 'the server was left running from the candidate\'s name');
    assert.deepStrictEqual(seen.informed, [
      `Aggrega: the compiler at ${shared} is now aggrega 0.9.1; the language server started on it before it replaced the earlier one.`,
    ]);
  });

  it('keeps the old one when the new one fails to start, and deletes the new one', async function () {
    needsPosix(this);
    serveReleases(server, releases(false));
    const { outcome, seen } = await run(shared, { pick: '0.9.1' });
    assert.strictEqual(outcome.kind, 'kept');
    assert.match(
      seen.warned[0],
      new RegExp(`^Aggrega: aggrega 0\\.9\\.1 did not start the language server \\(.+\\), so it was deleted and ${SETTING.replace(/\./g, '\\.')} was left as it is\\.$`),
    );
    assert.strictEqual(fs.readFileSync(shared, 'utf8'), fakeServingCompiler('0.9.0', true), 'the old compiler was not kept');
    assert.deepStrictEqual(fs.readdirSync(path.dirname(shared)), ['aggrega'], 'the version that failed to start was not deleted');
    assert.strictEqual(seen.restored, 1, 'the server was not put back on the compiler the setting names');
    assert.deepStrictEqual(written, []);
  });

  it('(f) never replaces a compiler the reader chose, and offers the shared location instead', async function () {
    needsPosix(this);
    serveReleases(server, releases());
    const mine = path.join(home, 'build', 'aggrega');
    fs.mkdirSync(path.dirname(mine));
    fs.writeFileSync(mine, fakeServingCompiler('0.9.0', true), { mode: 0o755 });
    const sharedInstead = `Aggrega: ${mine} is a compiler you chose, and the extension never replaces one. Download aggrega 0.9.1 into the shared location, ${shared}, instead?`;

    const declined = await run(mine, { pick: '0.9.1', confirm: (q) => q !== sharedInstead });
    assert.deepStrictEqual(declined.outcome, { kind: 'declined' });
    assert.deepStrictEqual(declined.seen.confirms, [sharedInstead]);
    assert.deepStrictEqual(declined.seen.started, []);
    assert.strictEqual(fs.readFileSync(mine, 'utf8'), fakeServingCompiler('0.9.0', true));
    assert.deepStrictEqual(written, []);

    const accepted = await run(mine, { pick: '0.9.1' });
    assert.deepStrictEqual(accepted.outcome, { kind: 'switched', path: shared, version: '0.9.1', started: true });
    assert.deepStrictEqual(accepted.seen.confirms, [sharedInstead, versionWarning('0.9.1', shared)]);
    assert.strictEqual(fs.readFileSync(mine, 'utf8'), fakeServingCompiler('0.9.0', true), 'the reader\'s own compiler was replaced');
    assert.deepStrictEqual(written, [shared]);
    assert.strictEqual(accepted.seen.restored, 0, 'the setting moved, so its own watcher restarts the server');
    assert.strictEqual(SHARED_INSTEAD_GO, 'Download into the shared location');
  });

  it('keeps the current compiler and says so when the release list is limited', async () => {
    server.answer('/api/releases', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
    const { outcome, seen } = await run(shared, { pick: '0.9.1' });
    const sentence = `Aggrega: no compiler was downloaded and ${SETTING} was left as it is, because GitHub is limiting how many requests this address may make for now, so try again later.`;
    assert.deepStrictEqual(outcome, { kind: 'kept', sentence });
    assert.deepStrictEqual(seen.warned, [sentence]);
    assert.deepStrictEqual(seen.offered, [], 'a list was offered with nothing read to fill it');
  });

  it('says so when the version chosen is the one in use, and downloads nothing', async function () {
    needsPosix(this);
    serveReleases(server, releases());
    const { outcome, seen } = await run(shared, { pick: '0.9.0' });
    assert.deepStrictEqual(outcome, { kind: 'unchanged', version: '0.9.0' });
    assert.deepStrictEqual(seen.informed, [`Aggrega: the compiler at ${shared} is already aggrega 0.9.0.`]);
    assert.deepStrictEqual(seen.confirms, []);
  });

  it('with no language server in the window, puts the version in place after its version check and says so', async function () {
    needsPosix(this);
    serveReleases(server, releases());
    const { outcome, seen } = await run(shared, { pick: '0.9.1', noServer: true });
    assert.deepStrictEqual(outcome, { kind: 'switched', path: shared, version: '0.9.1', started: false });
    assert.strictEqual(seen.restored, 0);
    assert.deepStrictEqual(seen.informed, [
      `Aggrega: the compiler at ${shared} is now aggrega 0.9.1. No language server runs in this window, so it was checked by asking it for its version rather than by starting one.`,
    ]);
  });

  it('refuses an unsupported machine by name, before asking anything of the network', async () => {
    serveReleases(server, releases());
    const seenWarned: string[] = [];
    const outcome = await selectCompilerVersion({
      source: server.source,
      host: { platform: 'freebsd', arch: 'x64', home, env: { PATH: '' } },
      compatibilityRange: RANGE,
      configuredPath: shared,
      memory: memoryOf(),
      runVersion,
      writeBinaryPath: async () => undefined,
      startServerOn: async () => ({ kind: 'noServer' }),
      restoreServer: async () => undefined,
      prompts: {
        pickVersion: async () => undefined,
        confirm: async () => true,
        withProgress: (_title, work) => work(new AbortController().signal),
        inform: () => undefined,
        warn: (message) => { seenWarned.push(message); },
      },
    });
    assert.strictEqual(outcome.kind, 'kept');
    assert.match(seenWarned[0], /the operating system freebsd/);
    assert.deepStrictEqual(server.requests, []);
  });

  it('carries the warning\'s button in the words the reader confirms with', () => {
    assert.strictEqual(SWITCH_GO, 'Download and switch');
  });
});
