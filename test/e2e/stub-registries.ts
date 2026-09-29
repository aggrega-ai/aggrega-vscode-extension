// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

// Two registries served on loopback by one process the runner starts beside the
// editor, for the index build to walk:
//
// - one whose repository listing never ends: every page it hands back names the
//   same repositories and links to a next page, and the next page is that page
//   again. A walk that follows the link for as long as one is served never
//   finishes; a walk that notices the listing repeating ends that registry's walk
//   and names it.
// - one that answers as a registry holding one repository with one version does:
//   a listing with no next page, a tag list, the version's manifest and an empty
//   referrer list.
//
// Only the reads the index build makes are answered. Everything else is not
// found, so a request nothing here expects shows up as a refusal rather than as
// an answer made up for it.
//
//   node stub-registries.js <dir>
//
// Once both registries listen, it writes <dir>/hosts.json naming each by the host
// it answers on, and it appends every request it answers to <dir>/requests.log,
// one line each, naming the registry that was asked. It runs until it is
// signalled, and nothing it serves reaches beyond the loopback interface.

// REPEATING_LISTING is the page the repeating registry hands back every time.
export const REPEATING_LISTING = ['component/stub/compute/listed-again', 'recipe/compose/stub-listed-again'];

// LISTED_REPOSITORY and LISTED_VERSION are what the well-behaved registry holds.
export const LISTED_REPOSITORY = 'component/stub/compute/one';
export const LISTED_VERSION = '1.0.0';

// HOSTS_FILE and REQUESTS_FILE are the two files the process writes in its
// directory.
export const HOSTS_FILE = 'hosts.json';
export const REQUESTS_FILE = 'requests.log';

// StubHosts is what hosts.json holds.
export interface StubHosts { repeating: string; wellBehaved: string }

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

function json(res: http.ServerResponse, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(text)), ...headers });
  res.end(text);
}

function notFound(res: http.ServerResponse): void {
  const text = JSON.stringify({ errors: [{ code: 'NAME_UNKNOWN', message: 'not served here' }] });
  res.writeHead(404, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(text)) });
  res.end(text);
}

function pathOf(req: http.IncomingMessage): string {
  return new URL(req.url ?? '/', 'http://registry').pathname;
}

const isBase = (p: string): boolean => p === '/v2/' || p === '/v2';

// repeating hands back the same page of the listing at every request, each time
// with a link to a next page that asks for the same page again.
const repeating: Handler = (req, res) => {
  const p = pathOf(req);
  if (isBase(p)) { return json(res, {}); }
  if (p === '/v2/_catalog') {
    const last = encodeURIComponent(REPEATING_LISTING[REPEATING_LISTING.length - 1]);
    return json(res, { repositories: REPEATING_LISTING }, { Link: `</v2/_catalog?last=${last}&n=${REPEATING_LISTING.length}>; rel="next"` });
  }
  return notFound(res);
};

// wellBehaved answers the reads a walk makes of one repository with one version.
function wellBehaved(): Handler {
  const config = '{}';
  const configDigest = `sha256:${crypto.createHash('sha256').update(config).digest('hex')}`;
  const manifest = JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    config: { mediaType: 'application/vnd.oci.empty.v1+json', digest: configDigest, size: 2 },
    layers: [{ mediaType: 'application/vnd.oci.empty.v1+json', digest: configDigest, size: 2 }],
    annotations: { 'org.opencontainers.image.description': 'the one version the well-behaved registry holds' },
  });
  const manifestDigest = `sha256:${crypto.createHash('sha256').update(manifest).digest('hex')}`;
  const referrers = JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [] });
  return (req, res) => {
    const p = pathOf(req);
    if (isBase(p)) { return json(res, {}); }
    if (p === '/v2/_catalog') { return json(res, { repositories: [LISTED_REPOSITORY] }); }
    if (p === `/v2/${LISTED_REPOSITORY}/tags/list`) { return json(res, { name: LISTED_REPOSITORY, tags: [LISTED_VERSION] }, { ETag: '"tags-1"' }); }
    if (p === `/v2/${LISTED_REPOSITORY}/manifests/${LISTED_VERSION}` || p === `/v2/${LISTED_REPOSITORY}/manifests/${manifestDigest}`) {
      res.writeHead(200, {
        'Content-Type': 'application/vnd.oci.image.manifest.v1+json',
        'Content-Length': String(Buffer.byteLength(manifest)),
        'Docker-Content-Digest': manifestDigest,
      });
      res.end(req.method === 'HEAD' ? undefined : manifest);
      return;
    }
    if (p.startsWith(`/v2/${LISTED_REPOSITORY}/referrers/`)) {
      res.writeHead(200, { 'Content-Type': 'application/vnd.oci.image.index.v1+json', 'Content-Length': String(Buffer.byteLength(referrers)) });
      res.end(referrers);
      return;
    }
    return notFound(res);
  };
}

function serve(name: string, handler: Handler, requests: string): Promise<{ server: http.Server; host: string }> {
  const server = http.createServer((req, res) => {
    fs.appendFileSync(requests, `${name} ${req.method ?? ''} ${req.url ?? ''}\n`);
    handler(req, res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') { reject(new Error(`${name}: no port was assigned`)); return; }
      resolve({ server, host: `127.0.0.1:${address.port}` });
    });
  });
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) { throw new Error('usage: stub-registries.js <dir>'); }
  fs.mkdirSync(dir, { recursive: true });
  const requests = path.join(dir, REQUESTS_FILE);
  fs.writeFileSync(requests, '');
  const a = await serve('repeating', repeating, requests);
  const b = await serve('well-behaved', wellBehaved(), requests);
  const hosts: StubHosts = { repeating: a.host, wellBehaved: b.host };
  // Written whole under another name and then moved into place, so a reader
  // never meets half of it.
  const file = path.join(dir, HOSTS_FILE);
  fs.writeFileSync(`${file}.partial`, `${JSON.stringify(hosts)}\n`);
  fs.renameSync(`${file}.partial`, file);
  const stop = (): void => {
    for (const s of [a.server, b.server]) { s.closeAllConnections(); s.close(); }
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
