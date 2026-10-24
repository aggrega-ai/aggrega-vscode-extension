// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import type { ReleaseSource } from '../../src/compiler-download';

// This helper serves releases from this machine, laid out the way the published
// ones are, so a download can be driven end to end without reaching any host
// but 127.0.0.1. It is the one home of that layout for every spec that needs it.
//
// The layout is the release list under <api>/releases and each release's files
// under <downloads>/download/v<version>/<file>, which is what the extension and
// the install scripts read.

// Answer is what the server answers one address with.
export interface Answer {
  status: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

// ReleaseServer is a running server, the source to hand the code under test, and
// the addresses it has been asked for, in order.
export interface ReleaseServer {
  source: ReleaseSource;
  base: string;
  requests: string[];
  answer(pathname: string, answer: Answer): void;
  close(): Promise<void>;
}

// startReleaseServer starts a server on a free port of 127.0.0.1. An address it
// has no answer for is answered 404.
export async function startReleaseServer(): Promise<ReleaseServer> {
  const answers = new Map<string, Answer>();
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    requests.push(url);
    const found = answers.get(url) ?? answers.get(url.split('?')[0]);
    if (!found) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(found.status, found.headers ?? {});
    res.end(found.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  return {
    source: { api: `${base}/api`, downloads: `${base}/releases` },
    base,
    requests,
    answer: (pathname, answer) => { answers.set(pathname, answer); },
    // Connections a client keeps open for reuse would hold the close open until
    // they time out, so they are ended with it.
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

// sha256 is a file's digest as SHA256SUMS lists it.
export function sha256(body: string | Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

// fakeCompiler is a program that answers `version -o json` the way the compiler
// does, reporting the version given, or — when it is told to fail — exits with
// an error and prints nothing.
export function fakeCompiler(version: string, fails = false): string {
  if (fails) {
    return '#!/bin/sh\necho "this build cannot run here" >&2\nexit 3\n';
  }
  const payload = JSON.stringify({ version, commit: 'abc1234', goVersion: 'go1.23.0', platform: 'linux/amd64' });
  return `#!/bin/sh\nif [ "$1" = version ]; then printf '%s\\n' '${payload}'; exit 0; fi\nexit 1\n`;
}

// fakeServingCompiler is a program that answers `version -o json` as
// fakeCompiler does and also answers `serve`: exiting cleanly where it serves,
// and with an error where it does not — a version that passes every check a
// download makes and still cannot start the language server.
export function fakeServingCompiler(version: string, serves: boolean): string {
  const payload = JSON.stringify({ version, commit: 'abc1234', goVersion: 'go1.23.0', platform: 'linux/amd64' });
  const serve = serves ? 'exit 0' : 'echo "the language server cannot start here" >&2; exit 4';
  return `#!/bin/sh\nif [ "$1" = version ]; then printf '%s\\n' '${payload}'; exit 0; fi\nif [ "$1" = serve ]; then ${serve}; fi\nexit 1\n`;
}

// PublishedFile is one file a served release carries.
export interface PublishedFile {
  name: string;
  body: string | Buffer;
}

// ServedRelease is one release to serve: its version, whether it is a draft or a
// pre-release, its files, and — where the checksum list is to disagree with a
// file — the digest the list names for that file instead.
export interface ServedRelease {
  version: string;
  draft?: boolean;
  prerelease?: boolean;
  files: PublishedFile[];
  listedDigest?: Record<string, string>;
  // withoutChecksums leaves SHA256SUMS out of the release altogether.
  withoutChecksums?: boolean;
}

// serveReleases answers the release list with the releases given, in the order
// given, and each release's files and checksum list under its tag.
export function serveReleases(server: ReleaseServer, releases: readonly ServedRelease[]): void {
  const list = releases.map((release) => ({
    tag_name: `v${release.version}`,
    draft: release.draft === true,
    prerelease: release.prerelease === true,
    assets: [
      ...release.files.map((f) => ({ name: f.name })),
      ...(release.withoutChecksums ? [] : [{ name: 'SHA256SUMS' }]),
    ],
  }));
  server.answer('/api/releases', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(list),
  });
  for (const release of releases) {
    const dir = `/releases/download/v${release.version}`;
    for (const file of release.files) {
      server.answer(`${dir}/${file.name}`, { status: 200, body: file.body });
    }
    if (release.withoutChecksums) { continue; }
    const sums = release.files
      .map((f) => `${release.listedDigest?.[f.name] ?? sha256(f.body)}  ${f.name}`)
      .join('\n');
    server.answer(`${dir}/SHA256SUMS`, { status: 200, body: `${sums}\n` });
  }
}

// runVersion runs a program with arguments and answers with what it printed, the
// way the extension's own seam does.
export function runVersion(binaryPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binaryPath, args, { timeout: 5000 }, (err, stdout) => {
      if (err) { reject(err); return; }
      resolve(stdout);
    });
  });
}
