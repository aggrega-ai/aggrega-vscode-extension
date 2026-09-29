// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as dns from 'dns';
import * as fs from 'fs';
import * as path from 'path';

import { runCompiler, ScratchHome } from './cli';

// The folders and states the checks run against, each built fresh for a scenario
// and proven before anything rests on it.
//
// 🔴 A FIXTURE THAT CANNOT BE BUILT IS REPORTED, NEVER PAPERED OVER. Each builder
// returns its proof — what was read back after it was built — or throws with the
// step that failed, and every check resting on it then reports "not run" naming
// that step. A check run against a fixture that silently failed to build reads
// exactly like a check run against a good one.

// CATALOG_PLACEHOLDER stands in the fixtures' configuration files where the
// standard-library catalog's directory goes, so no fixture depends on where a
// checkout sits.
export const CATALOG_PLACEHOLDER = '<standard-library-catalog>';

// FIXTURE_CONFIG is the one file of a fixture that carries the placeholder.
const FIXTURE_CONFIG = '.aggrega-config.yaml';

// fixturesDir is where the suite's folder fixtures are kept, in the extension's
// own source tree: they are not compiled, so they are read from the source.
export function fixturesDir(extensionDir: string): string {
  return path.join(extensionDir, 'test', 'e2e', 'fixtures');
}

// FixtureProof is what one built fixture was read back as.
export interface FixtureProof {
  fixture: string;
  built: boolean;
  proof: string;
  evidence?: unknown;
}

// FixtureError is a fixture that could not be built, naming the step that failed.
export class FixtureError extends Error {
  constructor(readonly fixture: string, readonly step: string) {
    super(`${fixture}: ${step}`);
  }
}

function copyTree(from: string, to: string, skip: (rel: string) => boolean, rel = ''): string[] {
  const copied: string[] = [];
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const r = rel === '' ? e.name : `${rel}/${e.name}`;
    if (skip(r)) { continue; }
    if (e.isDirectory()) {
      copied.push(...copyTree(path.join(from, e.name), path.join(to, e.name), skip, r));
    } else if (e.isFile()) {
      fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
      copied.push(r);
    }
  }
  return copied;
}

function occurrences(text: string, needle: string): number {
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) { n++; }
  return n;
}

// placeFolder copies one folder fixture to `dest` and writes the catalog's
// directory in place of its placeholder. It refuses unless the placeholder
// occurs exactly once in the configuration file and nowhere else, so a fixture
// edited into carrying two, or none, stops the run instead of reading a
// different catalog than the one the report names.
export function placeFolder(extensionDir: string, name: string, dest: string, catalog: string): FixtureProof {
  const from = path.join(fixturesDir(extensionDir), name);
  if (!fs.existsSync(from)) { throw new FixtureError(`folder ${name}`, `the suite holds no fixture at ${from}`); }
  const files = copyTree(from, dest, () => false);
  const config = path.join(dest, FIXTURE_CONFIG);
  const text = fs.readFileSync(config, 'utf8');
  const found = occurrences(text, CATALOG_PLACEHOLDER);
  if (found !== 1) {
    throw new FixtureError(`folder ${name}`, `${FIXTURE_CONFIG} carries the catalog placeholder ${found} times, not once`);
  }
  const elsewhere = files.filter((f) => f !== FIXTURE_CONFIG && fs.readFileSync(path.join(dest, f), 'utf8').includes(CATALOG_PLACEHOLDER));
  if (elsewhere.length > 0) {
    throw new FixtureError(`folder ${name}`, `the catalog placeholder also stands in ${elsewhere.join(', ')}`);
  }
  fs.writeFileSync(config, text.replace(CATALOG_PLACEHOLDER, catalog));
  const readBack = fs.readFileSync(config, 'utf8');
  if (!readBack.includes(`- ${catalog}\n`) || readBack.includes(CATALOG_PLACEHOLDER)) {
    throw new FixtureError(`folder ${name}`, `${FIXTURE_CONFIG} does not name the catalog after the placeholder was written`);
  }
  return { fixture: `folder ${name}`, built: true, proof: `${files.length} files copied to ${dest}; ${FIXTURE_CONFIG} names ${catalog} once, and no placeholder remains`, evidence: { files } };
}

// writeLockfile writes a Release's lockfile with the compiler's own pull, run
// with no network: every entity the fixtures reach is in a local catalog.
export async function writeLockfile(
  binary: string,
  folder: string,
  release: string,
  home: ScratchHome,
  log: string,
): Promise<FixtureProof> {
  const lock = path.join(folder, release.replace(/\.ya?ml$/, '.lock'));
  const run = await runCompiler(binary, ['--offline', 'pull', '--release', release, '--quiet'], { cwd: folder, home, boundMs: 120000, log });
  if (run.status !== 0 || !fs.existsSync(lock)) {
    throw new FixtureError(`lockfile of ${path.basename(folder)}/${release}`, `\`aggrega --offline pull --release ${release}\` exited ${run.status ?? run.signal}: ${(run.stderr || run.stdout).trim().split('\n').slice(-3).join(' | ')}`);
  }
  const summary = run.stdout.trim().split('\n').find((l) => l.startsWith('Pull complete:')) ?? '';
  return { fixture: `lockfile of ${path.basename(folder)}/${release}`, built: true, proof: `\`aggrega --offline pull\` exited 0 in ${run.elapsedMs} ms: ${summary}; ${lock} is ${fs.statSync(lock).size} bytes` };
}

// copyLockfile copies a Release's lockfile, written by writeLockfile in one copy
// of a folder, into another copy of the same folder, and refuses a lockfile that
// names the copy it was written in, since it would then pin the first copy's
// paths in the second.
export function copyLockfile(from: string, to: string, release: string): FixtureProof {
  const name = release.replace(/\.ya?ml$/, '.lock');
  const fixture = `lockfile of ${path.basename(to)}/${release}, copied`;
  const source = path.join(from, name);
  if (!fs.existsSync(source)) { throw new FixtureError(fixture, `${source} is not there to copy`); }
  if (fs.readFileSync(source, 'utf8').includes(from)) { throw new FixtureError(fixture, `${source} names the folder it was written in`); }
  fs.copyFileSync(source, path.join(to, name));
  if (!fs.readFileSync(path.join(to, name)).equals(fs.readFileSync(source))) { throw new FixtureError(fixture, `${path.join(to, name)} does not read back as ${source}`); }
  return { fixture, built: true, proof: `${source}, which names no path of the folder it was written in, copied byte for byte to ${path.join(to, name)}` };
}

// DOCS_EXAMPLE is the documentation example the workspace-above layout holds,
// by its path under the documentation checkout; the layout keeps that path
// beneath its root.
export const DOCS_EXAMPLE = path.join('aggrega-docs', 'language-reference', 'examples', 'prometheus-scrape');

// WorkspaceAbove is the generated layout: a root whose configuration marks it as
// the workspace, and a folder beneath it with no configuration of its own.
export interface WorkspaceAbove {
  root: string;
  folder: string;
  proof: FixtureProof;
}

// placeWorkspaceAbove generates the layout from the documentation example in the
// sibling checkout, which it reads and never writes. The example's own build
// output, lockfiles and caches are left behind, as a fresh checkout has none.
export function placeWorkspaceAbove(docsCheckoutParent: string, dest: string, catalog: string): WorkspaceAbove {
  const source = path.join(docsCheckoutParent, DOCS_EXAMPLE);
  if (!fs.existsSync(source)) {
    throw new FixtureError('workspace-above layout', `the documentation example is not at ${source}`);
  }
  const root = dest;
  const folder = path.join(root, DOCS_EXAMPLE);
  const skip = (rel: string): boolean => /^(dist|\.aggrega|\.trace)(\/|$)/.test(rel) || /\.lock$/.test(rel);
  const files = copyTree(source, folder, skip);
  fs.writeFileSync(path.join(root, FIXTURE_CONFIG), `workspace:\n  catalog_dirs:\n    - ${catalog}\n`);
  const own = fs.existsSync(path.join(folder, FIXTURE_CONFIG));
  const marker = fs.readFileSync(path.join(root, FIXTURE_CONFIG), 'utf8');
  const releases = files.filter((f) => /^release[^/]*\.ya?ml$/.test(f));
  if (own || !/^workspace:/m.test(marker) || releases.length === 0) {
    throw new FixtureError('workspace-above layout', `the folder carries a configuration of its own (${own}), or the root's has no workspace: key, or the folder holds no Release`);
  }
  return {
    root,
    folder,
    proof: {
      fixture: 'workspace-above layout',
      built: true,
      proof: `${root} carries a top-level workspace: naming the catalog; ${DOCS_EXAMPLE} beneath it holds ${files.length} files, ${releases.length} Releases (${releases.join(', ')}) and no configuration of its own`,
      evidence: { files },
    },
  };
}

// OWN_CATALOGS_EXAMPLE is the documentation example whose workspace configuration
// gives each of its Releases catalog directories of its own, by its path under the
// documentation checkout.
export const OWN_CATALOGS_EXAMPLE = path.join('aggrega-docs', 'language-reference', 'examples', 'mariadb-adminer');

// MAPPED_RELEASES are the example's Releases, each named in its configuration's
// map with a catalog directory of its own.
export const MAPPED_RELEASES = ['release-compose.yaml', 'release-helm-synth.yaml', 'release-helm-bitnami.yaml', 'release-helm-chart.yaml'] as const;

// UNMAPPED_RELEASE is the Release the copy gains beside the example's own: a byte
// copy of UNMAPPED_COPY_OF under a name the map does not carry, so it builds
// against the catalog directories the configuration lists for the whole
// workspace, which is WORKSPACE_CATALOG_DIR and which no mapped Release reads.
export const UNMAPPED_RELEASE = 'release-unmapped.yaml';
export const UNMAPPED_COPY_OF = 'release-compose.yaml';
export const WORKSPACE_CATALOG_DIR = 'catalog-compose';

// The one standard-library entity the example reads from the hub, by its path in
// the catalog input. A scratch home holds no credential for the hub, so the copy
// carries it in the root catalog directory, which ends every Release's list of
// catalog directories, the mapped ones' included.
const HUB_COMPONENT = path.join('component', 'core', 'devtool', 'adminer', '1.0.0', 'component.yaml');

// The line the example's configuration opens its map with, which the copy's
// workspace-level list is written above.
const MAP_OPENING = 'workspace:\n  releases:\n';

// OwnCatalogsLayout is the generated copy: its folder, and the Releases it holds.
export interface OwnCatalogsLayout {
  folder: string;
  releases: string[];
  proof: FixtureProof;
}

// placeOwnCatalogs copies the documentation example from the sibling checkout,
// which it reads and never writes, as a fresh checkout holds it: its own build
// output, caches and Release lockfiles are left behind, and the per-entity pin
// records beside its local charts are kept, as the example's own ignore file
// keeps them. The copy then gains the unmapped Release, a workspace-level catalog
// directory for it, and the hub's one entity in its root catalog directory. Each
// addition is refused where the example already carries something it would
// change, so the copy never differs from the example by more than it says.
export function placeOwnCatalogs(docsCheckoutParent: string, dest: string, catalog: string): OwnCatalogsLayout {
  const fixture = 'own-catalogs layout';
  const source = path.join(docsCheckoutParent, OWN_CATALOGS_EXAMPLE);
  if (!fs.existsSync(source)) { throw new FixtureError(fixture, `the documentation example is not at ${source}`); }
  const hub = path.join(catalog, HUB_COMPONENT);
  if (!fs.existsSync(hub)) { throw new FixtureError(fixture, `the catalog holds no ${HUB_COMPONENT}`); }
  const skip = (rel: string): boolean => /^(dist|\.aggrega|\.trace)(\/|$)/.test(rel) || (/\.lock$/.test(rel) && path.basename(rel) !== 'entity.lock');
  const files = copyTree(source, dest, skip);
  const config = path.join(dest, FIXTURE_CONFIG);
  const text = fs.readFileSync(config, 'utf8');
  const unmapped = path.join(dest, UNMAPPED_RELEASE);
  const rootCatalog = path.join(dest, 'catalog');
  const refusals = [
    occurrences(text, MAP_OPENING) !== 1 ? `${FIXTURE_CONFIG} does not open its map with "${MAP_OPENING.trim()}" once` : '',
    /^ {2}catalog_dirs:/m.test(text) ? `${FIXTURE_CONFIG} already lists catalog directories for the whole workspace` : '',
    text.includes(UNMAPPED_RELEASE) ? `${FIXTURE_CONFIG} already names ${UNMAPPED_RELEASE}` : '',
    ...MAPPED_RELEASES.filter((r) => !text.includes(`\n    ${r}:\n      catalog_dirs:\n`)).map((r) => `${FIXTURE_CONFIG} does not map ${r} to catalog directories of its own`),
    fs.existsSync(unmapped) ? `the example already holds ${UNMAPPED_RELEASE}` : '',
    fs.existsSync(rootCatalog) ? 'the example already holds a root catalog directory' : '',
  ].filter((r) => r !== '');
  if (refusals.length > 0) { throw new FixtureError(fixture, refusals.join('; ')); }
  fs.writeFileSync(config, text.replace(MAP_OPENING, `workspace:\n  catalog_dirs:\n    - ${WORKSPACE_CATALOG_DIR}\n  releases:\n`));
  fs.copyFileSync(path.join(dest, UNMAPPED_COPY_OF), unmapped);
  fs.mkdirSync(path.dirname(path.join(rootCatalog, HUB_COMPONENT)), { recursive: true });
  fs.copyFileSync(hub, path.join(rootCatalog, HUB_COMPONENT));
  const readBack = fs.readFileSync(config, 'utf8');
  const sameRelease = fs.readFileSync(unmapped).equals(fs.readFileSync(path.join(dest, UNMAPPED_COPY_OF)));
  const releases = fs.readdirSync(dest).filter((f) => /^release[^/]*\.ya?ml$/.test(f)).sort();
  if (occurrences(readBack, `\n  catalog_dirs:\n    - ${WORKSPACE_CATALOG_DIR}\n  releases:\n`) !== 1 || !sameRelease || releases.length !== MAPPED_RELEASES.length + 1) {
    throw new FixtureError(fixture, `the copy did not read back as written: the workspace-level list ${readBack.includes(`  catalog_dirs:\n    - ${WORKSPACE_CATALOG_DIR}\n  releases:`) ? 'present' : 'absent'}, ${UNMAPPED_RELEASE} ${sameRelease ? 'a byte copy' : 'not a byte copy'} of ${UNMAPPED_COPY_OF}, ${releases.length} Releases`);
  }
  return {
    folder: dest,
    releases,
    proof: {
      fixture,
      built: true,
      proof: `${files.length} files of ${OWN_CATALOGS_EXAMPLE} copied to ${dest}, with no dist/, .aggrega/, .trace/ or Release lockfile and every entity.lock kept; ${FIXTURE_CONFIG} maps ${MAPPED_RELEASES.join(', ')} each to catalog directories of its own and now lists ${WORKSPACE_CATALOG_DIR} for the whole workspace; ${UNMAPPED_RELEASE} is a byte copy of ${UNMAPPED_COPY_OF} the map does not name; catalog/ holds ${hub}, which the example otherwise reads from the hub`,
      evidence: { files, releases },
    },
  };
}

// UNREACHABLE_HOST is a registry host under the domain reserved for names that
// never exist, so no registry answers there.
export const UNREACHABLE_HOST = 'registry.invalid';

// proveUnreachable shows that no registry answers at the host: a request to its
// distribution API fails. Name resolution is recorded beside it rather than
// relied on, because a resolver that appends a search domain can hand back an
// address for any name — the request is what shows nothing answers there.
export async function proveUnreachable(): Promise<FixtureProof> {
  const lookup = (host: string): Promise<string> => new Promise((resolve) => {
    dns.lookup(host, (err, address) => { resolve(err ? `error ${err.code}` : `resolved ${address}`); });
  });
  const absolute = (host: string): Promise<string> => new Promise((resolve) => {
    dns.resolve4(host, (err, addresses) => { resolve(err ? `error ${err.code}` : `resolved ${addresses.join(', ')}`); });
  });
  let answered = '';
  try {
    const res = await fetch(`https://${UNREACHABLE_HOST}/v2/`, { signal: AbortSignal.timeout(8000) });
    answered = `HTTP ${res.status}`;
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    answered = '';
    const why = cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : String(err));
    const resolution = `lookup ${await lookup(UNREACHABLE_HOST)}, without the search list ${await absolute(UNREACHABLE_HOST)}`;
    return { fixture: 'unreachable registry', built: true, proof: `a request to https://${UNREACHABLE_HOST}/v2/ fails (${why}); name resolution: ${resolution}; the resolver's control, localhost: ${await lookup('localhost')}` };
  }
  throw new FixtureError('unreachable registry', `https://${UNREACHABLE_HOST}/v2/ answered ${answered}`);
}

// MISSING_BINARY names a compiler path that does not exist, for the stopped
// server; the proof is that nothing is there.
export function proveMissing(file: string): FixtureProof {
  if (fs.existsSync(file)) { throw new FixtureError('stopped server', `${file} exists`); }
  return { fixture: 'stopped server', built: true, proof: `${file} does not exist` };
}
