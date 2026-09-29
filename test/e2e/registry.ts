// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { runCompiler, ScratchHome } from './cli';
import { freePort } from './editor';
import { FixtureError, FixtureProof } from './fixtures';
import { ProcessTable } from './processes';
import { HOSTS_FILE, LISTED_REPOSITORY, LISTED_VERSION, REPEATING_LISTING, REQUESTS_FILE, StubHosts } from './stub-registries';

// A scratch registry: the zot server the development registry pins, started on a
// free loopback port with a data directory of its own and no authentication, so
// the checks that need a registry reach one that holds exactly what the scenario
// published and nothing else. The compiler speaks plain HTTP to a loopback
// registry, so no certificate is involved.
//
// The server is recorded by PID and start time in the scenario's process table,
// and stopped with it.
//
// Beside it, a pair of stub registries answering only what an index build asks:
// one whose repository listing never ends and one well-behaved, served by one
// process the runner starts, recorded and stopped the same way.

export interface ScratchRegistry {
  host: string;
  dataDir: string;
  pid: number;
  proof: FixtureProof;
}

// startRegistry writes the server's configuration and starts it, and returns once
// the distribution API answers.
export async function startRegistry(zot: string, dir: string, home: ScratchHome, table: ProcessTable): Promise<ScratchRegistry> {
  const port = await freePort();
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const config = path.join(dir, 'zot.json');
  // The same configuration the development registry writes when it runs
  // without credentials, with this registry's own port and data directory.
  fs.writeFileSync(config, `${JSON.stringify({
    distSpecVersion: '1.1.1',
    storage: { rootDirectory: dataDir },
    http: { address: '127.0.0.1', port: String(port) },
    log: { level: 'info' },
    extensions: { search: { enable: true }, ui: { enable: true } },
  }, null, 2)}\n`);
  const log = fs.openSync(path.join(dir, 'zot.log'), 'a');
  const child = spawn(zot, ['serve', config], {
    cwd: dir,
    env: { PATH: '/usr/bin:/bin', HOME: home.home, TMPDIR: home.tmp },
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  fs.closeSync(log);
  if (child.pid === undefined) { throw new FixtureError('scratch registry', 'the registry server could not be started'); }
  table.addRoot('registry', child.pid);
  const host = `127.0.0.1:${port}`;
  const until = Date.now() + 30000;
  let last = 'no answer';
  while (Date.now() < until) {
    try {
      const res = await fetch(`http://${host}/v2/`, { signal: AbortSignal.timeout(2000) });
      if (res.status === 200) {
        return { host, dataDir, pid: child.pid, proof: { fixture: 'scratch registry', built: true, proof: `zot at ${host} (pid ${child.pid}), data in ${dataDir}, no authentication: GET /v2/ answered 200` } };
      }
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new FixtureError('scratch registry', `GET http://${host}/v2/ did not answer 200 within 30000 ms (${last}); see ${path.join(dir, 'zot.log')}`);
}

// SigningKey is a key pair for keyed signing, written into the scenario.
export interface SigningKey { privatePem: string; publicPem: string }

export function makeSigningKey(dir: string): SigningKey {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const privatePem = path.join(dir, 'signing.pem');
  const publicPem = path.join(dir, 'signing.pub.pem');
  fs.writeFileSync(privatePem, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(publicPem, pair.publicKey.export({ type: 'spki', format: 'pem' }));
  return { privatePem, publicPem };
}

// PublishedEntity is the one entity the registry is populated with, published at
// two versions with the newer one withdrawn.
export const PUBLISHED_ENTITY = { kind: 'component', name: 'core/devtool/adminer', older: '1.0.0', newer: '1.1.0' } as const;

// WITHDRAWAL_REASON is the reason the newer version is withdrawn with.
export const WITHDRAWAL_REASON = 'withdrawn by the editor suite to have a withdrawal to show';

// Population is what the registry was populated with, and the index built over it.
export interface Population {
  references: { older: string; newer: string };
  searchJson: unknown;
  proof: FixtureProof;
}

// populateRegistry registers the scratch registry in the scenario's global
// configuration with the key its signatures verify against, publishes one
// standard-library Component at two versions, withdraws the newer at severity
// retracted, and builds the searchable index from `folder`, where it lands in
// that folder's own cache. Every step is the compiler's own command.
export async function populateRegistry(opts: {
  binary: string;
  registry: ScratchRegistry;
  catalog: string;
  folder: string;
  dir: string;
  home: ScratchHome;
  log: string;
  alsoRegister?: string[];
}): Promise<Population> {
  const { binary, registry, home, log } = opts;
  const key = makeSigningKey(opts.dir);
  const step = async (what: string, args: string[], cwd: string): Promise<string> => {
    const run = await runCompiler(binary, args, { cwd, home, boundMs: 120000, log });
    if (run.status !== 0) {
      throw new FixtureError('withdrawn Component version', `${what}: \`aggrega ${args.join(' ')}\` exited ${run.status ?? run.signal}: ${(run.stderr || run.stdout).trim().split('\n').slice(-2).join(' | ')}`);
    }
    return `${run.stdout}${run.stderr}`;
  };
  await step('registering the scratch registry', ['registry', 'add', registry.host, '--key', key.publicPem, '--fetch-trust=false'], opts.folder);
  for (const host of opts.alsoRegister ?? []) {
    await step(`registering ${host}`, ['registry', 'add', host, '--fetch-trust=false'], opts.folder);
  }
  const source = path.join(opts.catalog, PUBLISHED_ENTITY.kind, ...PUBLISHED_ENTITY.name.split('/'), PUBLISHED_ENTITY.older, 'component.yaml');
  if (!fs.existsSync(source)) { throw new FixtureError('withdrawn Component version', `the catalog holds no ${source}`); }
  const text = fs.readFileSync(source, 'utf8');
  const versionLine = `  version: ${PUBLISHED_ENTITY.older}\n`;
  if (text.split(versionLine).length !== 2) {
    throw new FixtureError('withdrawn Component version', `${source} does not state its version once as \`${versionLine.trim()}\``);
  }
  const published = path.join(opts.dir, 'published');
  for (const version of [PUBLISHED_ENTITY.older, PUBLISHED_ENTITY.newer]) {
    const d = path.join(published, version);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'component.yaml'), text.replace(versionLine, `  version: ${version}\n`));
    await step(`publishing ${PUBLISHED_ENTITY.name} ${version}`, ['push', path.join(d, 'component.yaml'), '--registry', registry.host, '--key', key.privatePem], opts.dir);
  }
  const reference = (v: string): string => `${registry.host}/${PUBLISHED_ENTITY.kind}/${PUBLISHED_ENTITY.name}:${v}`;
  await step('withdrawing the newer version', ['deprecate', reference(PUBLISHED_ENTITY.newer), '--severity', 'retracted', '--reason', WITHDRAWAL_REASON, '--key', key.privatePem], opts.dir);
  const updated = await step('building the searchable index', ['registry', 'update', registry.host], opts.folder);
  const searched = await runCompiler(binary, ['search', '-o', 'json'], { cwd: opts.folder, home, boundMs: 60000, log });
  let searchJson: { records?: { name?: string; version?: string; retracted?: string[] }[] } = {};
  try { searchJson = JSON.parse(searched.stdout); } catch { searchJson = {}; }
  const record = (searchJson.records ?? []).find((r) => r.name === `${PUBLISHED_ENTITY.kind}/${PUBLISHED_ENTITY.name}`);
  if (searched.status !== 0 || !record || record.version !== PUBLISHED_ENTITY.older || !(record.retracted ?? []).includes(PUBLISHED_ENTITY.newer)) {
    throw new FixtureError('withdrawn Component version', `the index does not read back the withdrawal: \`aggrega search -o json\` exited ${searched.status}, record ${JSON.stringify(record ?? null)}`);
  }
  const recorded = updated.split('\n').find((l) => l.startsWith('Recorded ')) ?? '';
  return {
    references: { older: reference(PUBLISHED_ENTITY.older), newer: reference(PUBLISHED_ENTITY.newer) },
    searchJson,
    proof: {
      fixture: 'withdrawn Component version',
      built: true,
      proof: `${PUBLISHED_ENTITY.name} published at ${PUBLISHED_ENTITY.older} and ${PUBLISHED_ENTITY.newer}, the newer withdrawn at severity retracted; \`aggrega registry update\`: "${recorded.trim()}"; \`aggrega search -o json\` reads version ${record.version} with retracted ${JSON.stringify(record.retracted)}`,
    },
  };
}

// StubRegistries is the pair of registries the stub process serves
// (stub-registries.ts): one whose repository listing never ends, and a
// well-behaved one beside it.
export interface StubRegistries extends StubHosts {
  pid: number;
  proof: FixtureProof;
  // requests reads what the stub has been asked so far, in order, one line each
  // opening with the name of the registry that was asked.
  requests(): string[];
}

// startStubRegistries starts the stub process with a directory of its own,
// records it by PID and start time in the scenario's process table, so it is
// stopped with it, and returns once both registries answer and read back as
// what they are for: the repeating one's listing, asked for its next page, hands
// back the same page and a link to a next one again; the well-behaved one lists
// one repository and links to no next page.
export async function startStubRegistries(dir: string, home: ScratchHome, table: ProcessTable): Promise<StubRegistries> {
  const fixture = 'stub registries';
  fs.mkdirSync(dir, { recursive: true });
  const log = fs.openSync(path.join(dir, 'stub-registries.log'), 'a');
  const child = spawn(process.execPath, [path.join(__dirname, 'stub-registries.js'), dir], {
    cwd: dir,
    env: { PATH: '/usr/bin:/bin', HOME: home.home, TMPDIR: home.tmp },
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();
  fs.closeSync(log);
  if (child.pid === undefined) { throw new FixtureError(fixture, 'the stub process could not be started'); }
  table.addRoot('stub registries', child.pid);
  const hostsFile = path.join(dir, HOSTS_FILE);
  const until = Date.now() + 15000;
  while (!fs.existsSync(hostsFile)) {
    if (Date.now() > until) { throw new FixtureError(fixture, `the stub process wrote no ${HOSTS_FILE} within 15000 ms; see ${path.join(dir, 'stub-registries.log')}`); }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const hosts = JSON.parse(fs.readFileSync(hostsFile, 'utf8')) as StubHosts;
  const page = async (url: string): Promise<{ repositories: string[]; next: string | null }> => {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.status !== 200) { throw new FixtureError(fixture, `GET ${url} answered ${res.status}`); }
    const body = await res.json() as { repositories?: string[] };
    const link = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '');
    return { repositories: body.repositories ?? [], next: link ? link[1] : null };
  };
  const same = (a: string[], b: readonly string[]): boolean => JSON.stringify(a) === JSON.stringify(b);
  const first = await page(`http://${hosts.repeating}/v2/_catalog`);
  const second = first.next === null ? null : await page(`http://${hosts.repeating}${first.next}`);
  if (!same(first.repositories, REPEATING_LISTING) || second === null || !same(second.repositories, REPEATING_LISTING) || second.next === null) {
    throw new FixtureError(fixture, `the repeating registry at ${hosts.repeating} does not hand back the same page with a next link twice: ${JSON.stringify({ first, second })}`);
  }
  const listed = await page(`http://${hosts.wellBehaved}/v2/_catalog`);
  const tags = await fetch(`http://${hosts.wellBehaved}/v2/${LISTED_REPOSITORY}/tags/list`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json() as Promise<{ tags?: string[] }>);
  if (!same(listed.repositories, [LISTED_REPOSITORY]) || listed.next !== null || !same(tags.tags ?? [], [LISTED_VERSION])) {
    throw new FixtureError(fixture, `the well-behaved registry at ${hosts.wellBehaved} does not list ${LISTED_REPOSITORY} alone at ${LISTED_VERSION} with no next page: ${JSON.stringify({ listed, tags })}`);
  }
  const requestsFile = path.join(dir, REQUESTS_FILE);
  return {
    ...hosts,
    pid: child.pid,
    requests: () => fs.readFileSync(requestsFile, 'utf8').split('\n').filter((l) => l !== ''),
    proof: {
      fixture,
      built: true,
      proof: `one process (pid ${child.pid}) serving, with no authentication, ${hosts.repeating}, whose listing handed back ${JSON.stringify(REPEATING_LISTING)} with a next link, and the same page and link again when that link was followed; and ${hosts.wellBehaved}, listing ${LISTED_REPOSITORY} alone, with no next page, at ${LISTED_VERSION}`,
    },
  };
}

// WITHDRAWN_PLUGIN_LINK is the link of the withdrawn-plugin chain that cannot be
// built, as measured: the chain needs one plugin published at two versions, and
// a Plugin is published only with a guest whose own self-report states the
// entity's version, while the searchable index takes release versions only. The
// runner is given no guest, and none it could reach reports two release
// versions.
export const WITHDRAWN_PLUGIN_LINK =
  'publishing one plugin at two versions: a Plugin is published only with a Wasm guest whose describe() version equals metadata.version, ' +
  'the searchable index skips pre-release versions, and the runner has no guest reporting two release versions to publish';
