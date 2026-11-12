// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  ReleaseFetchError,
  ReleaseTarget,
  compatibleVersions,
  installRelease,
  installedFileName,
  listReleases,
  parseChecksums,
  releaseFileName,
  releaseTarget,
} from '../../src/compiler-download';
import {
  ReleaseServer,
  fakeCompiler,
  runVersion,
  serveReleases,
  sha256,
  startReleaseServer,
} from '../helpers/release-server';

// Every download here is served from 127.0.0.1 by a server this file starts, in
// the layout published releases use, and installed into a folder this file
// creates. Nothing here reaches another host or writes outside that folder.

const LINUX: ReleaseTarget = { os: 'linux', arch: 'amd64' };

// The served programs are shell scripts, so the specs that run one stand down on
// a machine that cannot run a shell script by its path.
function needsPosix(ctx: Mocha.Context): void {
  if (process.platform === 'win32') { ctx.skip(); }
}

function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aggrega-download-'));
}

describe('compiler-download: naming the machine the way releases name it', () => {
  it('names the five machines releases carry a binary for', () => {
    assert.deepStrictEqual(releaseTarget('linux', 'x64'), { kind: 'supported', target: { os: 'linux', arch: 'amd64' } });
    assert.deepStrictEqual(releaseTarget('linux', 'arm64'), { kind: 'supported', target: { os: 'linux', arch: 'arm64' } });
    assert.deepStrictEqual(releaseTarget('darwin', 'x64'), { kind: 'supported', target: { os: 'darwin', arch: 'amd64' } });
    assert.deepStrictEqual(releaseTarget('darwin', 'arm64'), { kind: 'supported', target: { os: 'darwin', arch: 'arm64' } });
    assert.deepStrictEqual(releaseTarget('win32', 'x64'), { kind: 'supported', target: { os: 'windows', arch: 'amd64' } });
  });

  it('refuses every other machine, naming it', () => {
    for (const [platform, arch, named] of [
      ['win32', 'arm64', 'arm64'],
      ['linux', 'ia32', 'ia32'],
      ['freebsd', 'x64', 'freebsd'],
      ['sunos', 'x64', 'sunos'],
    ] as const) {
      const reading = releaseTarget(platform, arch);
      assert.strictEqual(reading.kind, 'unsupported', `${platform}/${arch} read as supported`);
      if (reading.kind !== 'unsupported') { continue; }
      assert.ok(reading.sentence.includes(named), `the refusal for ${platform}/${arch} does not name ${named}: ${reading.sentence}`);
      assert.ok(reading.sentence.startsWith('no release carries an aggrega binary for'), reading.sentence);
    }
  });

  it('names the default binary and the installed file as the install scripts do', () => {
    assert.strictEqual(releaseFileName(LINUX, '0.9.1'), 'aggrega-0.9.1-linux-amd64');
    assert.strictEqual(releaseFileName({ os: 'darwin', arch: 'arm64' }, '0.9.1'), 'aggrega-0.9.1-darwin-arm64');
    assert.strictEqual(releaseFileName({ os: 'windows', arch: 'amd64' }, '0.9.1'), 'aggrega-0.9.1-windows-amd64.exe');
    assert.strictEqual(installedFileName(LINUX), 'aggrega');
    assert.strictEqual(installedFileName({ os: 'windows', arch: 'amd64' }), 'aggrega.exe');
  });
});

describe('compiler-download: the extension runs on the machine the workspace is on', () => {
  // The machine read above is the one the extension's own process runs on, so the
  // manifest has to put that process where the workspace is: in a remote window,
  // that is the remote machine, and the binary downloaded is one it can run.
  it('declares itself a workspace extension, and nothing else', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
    ) as { extensionKind?: unknown; browser?: unknown; main?: unknown };
    assert.deepStrictEqual(manifest.extensionKind, ['workspace']);
    assert.strictEqual(manifest.browser, undefined, 'a browser entry would run the extension where no compiler can be started');
    assert.strictEqual(manifest.main, './out/src/extension.js');
  });
});

describe('compiler-download: reading a checksum list', () => {
  it('reads both line forms, any letter case and a carriage return, and skips the rest', () => {
    const upper = 'A'.repeat(64);
    const lower = 'b'.repeat(64);
    const sums = parseChecksums(`${upper}  aggrega-0.9.1-linux-amd64\r\n${lower} *aggrega-0.9.1-darwin-arm64\nnot a line\n`);
    assert.strictEqual(sums.get('aggrega-0.9.1-linux-amd64'), 'a'.repeat(64));
    assert.strictEqual(sums.get('aggrega-0.9.1-darwin-arm64'), lower);
    assert.strictEqual(sums.size, 2);
  });
});

describe('compiler-download: choosing among releases', () => {
  const carrying = (version: string): string[] => [releaseFileName(LINUX, version), 'SHA256SUMS'];

  it('offers the releases inside the range that carry this machine\'s binary and a checksum list, newest first', () => {
    const versions = compatibleVersions([
      { tag: 'v0.8.0', draft: false, prerelease: false, assets: carrying('0.8.0') },
      { tag: 'v1.0.0', draft: false, prerelease: false, assets: carrying('1.0.0') },
      { tag: 'v0.9.1', draft: false, prerelease: false, assets: carrying('0.9.1') },
      { tag: 'v0.9.2', draft: true, prerelease: false, assets: carrying('0.9.2') },
      { tag: 'v0.9.3-rc.1', draft: false, prerelease: true, assets: carrying('0.9.3-rc.1') },
      { tag: 'v0.9.4', draft: false, prerelease: false, assets: [releaseFileName(LINUX, '0.9.4')] },
      { tag: 'v0.9.5', draft: false, prerelease: false, assets: [releaseFileName({ os: 'darwin', arch: 'arm64' }, '0.9.5'), 'SHA256SUMS'] },
      { tag: 'nightly', draft: false, prerelease: false, assets: ['SHA256SUMS'] },
    ], '>=0.1.0 <1.0.0', LINUX);
    assert.deepStrictEqual(versions, ['0.9.1', '0.8.0']);
  });

  it('offers every release when no range is declared', () => {
    const versions = compatibleVersions([
      { tag: 'v1.0.0', draft: false, prerelease: false, assets: carrying('1.0.0') },
    ], undefined, LINUX);
    assert.deepStrictEqual(versions, ['1.0.0']);
  });
});

describe('compiler-download: reading the release list', () => {
  let server: ReleaseServer;
  beforeEach(async () => { server = await startReleaseServer(); });
  afterEach(async () => { await server.close(); });

  it('reads each release\'s tag, standing and files', async () => {
    serveReleases(server, [
      { version: '0.9.1', files: [{ name: releaseFileName(LINUX, '0.9.1'), body: 'x' }] },
      { version: '0.9.2', prerelease: true, files: [] },
    ]);
    const releases = await listReleases(server.source);
    assert.deepStrictEqual(releases, [
      { tag: 'v0.9.1', draft: false, prerelease: false, assets: ['aggrega-0.9.1-linux-amd64', 'SHA256SUMS'] },
      { tag: 'v0.9.2', draft: false, prerelease: true, assets: ['SHA256SUMS'] },
    ]);
    assert.deepStrictEqual(server.requests, ['/api/releases?per_page=100']);
  });

  it('reads 403 with no allowance left, and 429, as being limited', async () => {
    for (const answer of [
      { status: 403, headers: { 'x-ratelimit-remaining': '0' } },
      { status: 429 },
    ]) {
      server.answer('/api/releases', answer);
      await assert.rejects(listReleases(server.source), (err: unknown) => {
        assert.ok(err instanceof ReleaseFetchError);
        assert.strictEqual(err.rateLimited, true, `${answer.status} was not read as being limited`);
        assert.match(err.message, /GitHub is limiting how many requests this address may make/);
        return true;
      });
    }
  });

  it('reports any other refusal by its status, and not as being limited', async () => {
    server.answer('/api/releases', { status: 403, headers: { 'x-ratelimit-remaining': '12' } });
    await assert.rejects(listReleases(server.source), (err: unknown) => {
      assert.ok(err instanceof ReleaseFetchError);
      assert.strictEqual(err.rateLimited, false);
      assert.match(err.message, /\/api\/releases\?per_page=100 answered 403/);
      return true;
    });
  });

  it('says an address it cannot reach could not be reached', async () => {
    const { source } = server;
    await server.close();
    server = await startReleaseServer();
    await assert.rejects(listReleases(source), (err: unknown) => {
      assert.ok(err instanceof ReleaseFetchError);
      assert.match(err.message, /could not be reached/);
      return true;
    });
  });
});

describe('compiler-download: installing one release', () => {
  let server: ReleaseServer;
  let dir: string;
  beforeEach(async () => {
    server = await startReleaseServer();
    dir = scratchDir();
  });
  afterEach(async () => {
    await server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const asset = releaseFileName(LINUX, '0.9.1');

  it('downloads, checks, makes executable, runs once and puts the binary in place', async function () {
    needsPosix(this);
    serveReleases(server, [{ version: '0.9.1', files: [{ name: asset, body: fakeCompiler('0.9.1') }] }]);
    const destination = path.join(dir, 'bin', 'aggrega');
    const outcome = await installRelease({ source: server.source, target: LINUX, version: '0.9.1', destination, runVersion });
    assert.deepStrictEqual(outcome, { kind: 'installed', path: destination, version: '0.9.1' });
    assert.strictEqual(fs.readFileSync(destination, 'utf8'), fakeCompiler('0.9.1'));
    assert.ok((fs.statSync(destination).mode & 0o111) !== 0, 'the installed binary is not executable');
    assert.deepStrictEqual(fs.readdirSync(path.dirname(destination)), ['aggrega'], 'a staged copy was left behind');
    assert.deepStrictEqual(server.requests, [
      '/releases/download/v0.9.1/SHA256SUMS',
      `/releases/download/v0.9.1/${asset}`,
    ]);
  });

  it('follows the redirect a release file is answered with', async function () {
    needsPosix(this);
    serveReleases(server, [{ version: '0.9.1', files: [{ name: asset, body: fakeCompiler('0.9.1') }] }]);
    server.answer(`/releases/download/v0.9.1/${asset}`, { status: 302, headers: { Location: `${server.base}/store/${asset}` } });
    server.answer(`/store/${asset}`, { status: 200, body: fakeCompiler('0.9.1') });
    const destination = path.join(dir, 'aggrega');
    const outcome = await installRelease({ source: server.source, target: LINUX, version: '0.9.1', destination, runVersion });
    assert.strictEqual(outcome.kind, 'installed');
    assert.ok(server.requests.includes(`/store/${asset}`), 'the redirect was not followed');
  });

  it('refuses a download whose checksum differs by one byte, deletes it, and leaves the compiler there alone', async () => {
    const good = fakeCompiler('0.9.1');
    const planted = Buffer.from(good);
    planted[planted.length - 2] ^= 0x01;
    serveReleases(server, [{
      version: '0.9.1',
      files: [{ name: asset, body: planted }],
      listedDigest: { [asset]: sha256(good) },
    }]);
    const destination = path.join(dir, 'aggrega');
    fs.writeFileSync(destination, 'the compiler already here');
    const outcome = await installRelease({ source: server.source, target: LINUX, version: '0.9.1', destination, runVersion });
    assert.strictEqual(outcome.kind, 'refused');
    if (outcome.kind !== 'refused') { return; }
    assert.strictEqual(
      outcome.reason,
      `the SHA-256 checksum of the downloaded ${asset} is ${sha256(planted)}, but SHA256SUMS lists ${sha256(good)}, so the download was deleted`,
    );
    assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'the compiler already here');
    assert.deepStrictEqual(fs.readdirSync(dir), ['aggrega'], 'the refused download was not deleted');
  });

  it('refuses a binary that fails `version -o json`, deletes it, and leaves the compiler there alone', async function () {
    needsPosix(this);
    serveReleases(server, [{ version: '0.9.1', files: [{ name: asset, body: fakeCompiler('0.9.1', true) }] }]);
    const destination = path.join(dir, 'aggrega');
    fs.writeFileSync(destination, 'the compiler already here');
    const outcome = await installRelease({ source: server.source, target: LINUX, version: '0.9.1', destination, runVersion });
    assert.strictEqual(outcome.kind, 'refused');
    if (outcome.kind !== 'refused') { return; }
    assert.match(outcome.reason, new RegExp(`^the downloaded ${asset} did not answer \`version -o json\` \\(.+\\), so it was deleted$`));
    assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'the compiler already here');
    assert.deepStrictEqual(fs.readdirSync(dir), ['aggrega']);
  });

  it('refuses a binary reporting a version other than the release\'s', async function () {
    needsPosix(this);
    serveReleases(server, [{ version: '0.9.1', files: [{ name: asset, body: fakeCompiler('0.8.0') }] }]);
    const destination = path.join(dir, 'aggrega');
    const outcome = await installRelease({ source: server.source, target: LINUX, version: '0.9.1', destination, runVersion });
    assert.deepStrictEqual(outcome, {
      kind: 'refused',
      reason: `the downloaded ${asset} reports version 0.8.0 rather than 0.9.1, so it was deleted`,
    });
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  });

  it('refuses a release whose checksum list names no binary for this machine', async () => {
    serveReleases(server, [{ version: '0.9.1', files: [{ name: releaseFileName({ os: 'darwin', arch: 'arm64' }, '0.9.1'), body: 'x' }] }]);
    const outcome = await installRelease({
      source: server.source, target: LINUX, version: '0.9.1', destination: path.join(dir, 'aggrega'), runVersion,
    });
    assert.deepStrictEqual(outcome, {
      kind: 'refused',
      reason: `the checksum list at ${server.base}/releases/download/v0.9.1/SHA256SUMS names no ${asset}`,
    });
  });
});
