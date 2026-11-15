// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as dns from 'dns';
import * as fs from 'fs';
import * as path from 'path';

import { findAggregaWorkspaceAnchor } from '../../src/workspace';
import { endingOf, runCompiler, ScratchHome } from './cli';
import { Inputs } from './inputs';

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
//
// A catalog of null places a fixture that reads no standard library, only the
// catalog it carries itself. Such a fixture must carry no placeholder anywhere
// and its configuration must name no absolute path, so it depends neither on the
// catalog input nor on where a checkout sits.
export function placeFolder(extensionDir: string, name: string, dest: string, catalog: string | null): FixtureProof {
  const from = path.join(fixturesDir(extensionDir), name);
  if (!fs.existsSync(from)) { throw new FixtureError(`folder ${name}`, `the suite holds no fixture at ${from}`); }
  const files = copyTree(from, dest, () => false);
  const config = path.join(dest, FIXTURE_CONFIG);
  const text = fs.readFileSync(config, 'utf8');
  if (catalog === null) {
    const carrying = files.filter((f) => fs.readFileSync(path.join(dest, f), 'utf8').includes(CATALOG_PLACEHOLDER));
    const absolute = text.split('\n').filter((l) => /^\s*-\s*\//.test(l));
    if (carrying.length > 0 || absolute.length > 0) {
      throw new FixtureError(`folder ${name}`, `a fixture that reads no standard library carries the catalog placeholder in ${JSON.stringify(carrying)} and names ${JSON.stringify(absolute)} in ${FIXTURE_CONFIG}`);
    }
    return { fixture: `folder ${name}`, built: true, proof: `${files.length} files copied to ${dest}; it reads only the catalog it carries: no placeholder, and no absolute path in ${FIXTURE_CONFIG}`, evidence: { files } };
  }
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

// Tree is a directory's files by their path beneath it, in path order.
export type Tree = Map<string, Buffer>;

// readTree reads every file beneath `dir`, which is none where it is absent.
export function readTree(dir: string): Tree {
  const files: [string, Buffer][] = [];
  const walk = (d: string, rel: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) { walk(path.join(d, e.name), r); } else if (e.isFile()) { files.push([r, fs.readFileSync(path.join(d, e.name))]); }
    }
  };
  if (fs.existsSync(dir)) { walk(dir, ''); }
  return new Map(files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// sameTree reports whether two trees hold the same files with the same bytes.
export function sameTree(a: Tree, b: Tree): boolean {
  return a.size === b.size && [...a].every(([f, bytes]) => b.get(f)?.equals(bytes) === true);
}

// TreeChange is how a directory now differs from a tree read from it earlier:
// the files whose bytes differ, the files gone, and the files added.
export interface TreeChange { changed: string[]; missing: string[]; added: string[] }

export function changeSince(before: Tree, dir: string): TreeChange {
  const now = readTree(dir);
  return {
    changed: [...before].filter(([f, bytes]) => now.has(f) && !(now.get(f) as Buffer).equals(bytes)).map(([f]) => f),
    missing: [...before.keys()].filter((f) => !now.has(f)),
    added: [...now.keys()].filter((f) => !before.has(f)),
  };
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
  copyReadBack(fixture, source, path.join(to, name));
  return { fixture, built: true, proof: `${source}, which names no path of the folder it was written in, copied byte for byte to ${path.join(to, name)}` };
}

// copyReadBack copies one file and refuses the fixture unless the copy reads back
// byte for byte as the file it was copied from.
function copyReadBack(fixture: string, source: string, dest: string): void {
  fs.copyFileSync(source, dest);
  if (!fs.readFileSync(dest).equals(fs.readFileSync(source))) { throw new FixtureError(fixture, `${dest} does not read back as ${source}`); }
}

// IMPORT_ANSWERS_FILE is the answers file an import reads its owed values from and
// keeps them in, beside the source it imports: the compiler's name for it.
export const IMPORT_ANSWERS_FILE = 'import-answers.yaml';

// IMPORT_DIFY_EXAMPLE is the documentation example whose source the import
// scenario imports, by its path under the documentation checkout, and
// IMPORT_DIFY_SOURCE that source's file name.
export const IMPORT_DIFY_EXAMPLE = path.join('aggrega-docs', 'language-reference', 'examples', 'import-dify');
export const IMPORT_DIFY_SOURCE = 'support-assistant.yml';

// placeImportSource copies the documentation example's source into a placed
// folder, so the import checked is the one the documentation walks through and no
// copy of it can drift; it refuses where the documentation checkout does not hold
// it.
export function placeImportSource(docsCheckoutParent: string, folder: string): FixtureProof {
  const from = path.join(docsCheckoutParent, IMPORT_DIFY_EXAMPLE, 'source', IMPORT_DIFY_SOURCE);
  const fixture = `the import source ${IMPORT_DIFY_SOURCE}`;
  if (!fs.existsSync(from)) { throw new FixtureError(fixture, `the documentation checkout holds no ${from}`); }
  const to = path.join(folder, IMPORT_DIFY_SOURCE);
  copyReadBack(fixture, from, to);
  return { fixture, built: true, proof: `${from} copied byte for byte to ${to}` };
}

// ImporterRun is how proveImporterCatalog asks the compiler: the folder holding a
// copy of the source and its name there, the target the import drafts for, the
// environment the scenario's editor is given (offline, and the catalogs it reads),
// how long the import is waited for, and a scratch home of the proof's own with
// the log its run is recorded in. The two pieces of the compiler's wording the
// proof reads are handed in by the scenario, so that wording has one home: the
// start of the line naming the format the source was read as, and what each line
// about a value still owed carries, which the scenario also reads on the editor's
// channel. The compiler writes
// both to standard error; under --dry-run its standard output is the drafts.
export interface ImporterRun {
  folder: string;
  source: string;
  target: string;
  env: Readonly<Record<string, string>>;
  boundMs: number;
  formatOpening: string;
  owedMarker: string;
  home: ScratchHome;
  log: string;
}

// proveImporterCatalog refuses a fixture unless the run was given an importer
// catalog holding `importer`'s Plugin entity with its module beside it at exactly
// one version, as the input check read it — more than one is refused, naming
// them, since the proof could not then say which ran — and the compiler under
// test runs it.
//
// 🔴 THE COMPILER IS ASKED, NOT PREDICTED. Which importer an import runs is the
// compiler's to choose. It carries each core importer's entity but not its
// module, which it fetches from a registry, and it weighs an importer laid in a
// catalog folder against the entity of the same name it carries, so it is asked
// rather than predicted: before the scenario starts, the compiler under test
// imports a copy of the source once, offline, as a preview, with the catalogs the
// scenario reads, and the fixture is refused unless the importer runs. The run's
// home is the proof's own and starts empty, so offline no module is found
// anywhere but beside the entities in the catalogs it reads: an import that says
// on standard error that it read the source as the importer's format, and names
// the values it still owes, ran the importer laid here.
export async function proveImporterCatalog(inputs: Inputs, importer: string, run: ImporterRun): Promise<FixtureProof> {
  const fixture = `the ${importer} importer in the importer catalog`;
  if (inputs.importerCatalog === null) {
    throw new FixtureError(fixture, 'no catalog folder holding the importers was given (--importer-catalog); the compiler carries each core importer\'s entity but not its module, which it fetches from a registry, and the scenario runs offline');
  }
  const found = inputs.importerCatalog.importers.find((i) => i.name === importer);
  if (found === undefined) {
    throw new FixtureError(fixture, `${inputs.importerCatalog.dir} holds no ${importer} importer under plugin/importer`);
  }
  const { dir, versions } = found;
  if (versions.length === 0) {
    throw new FixtureError(fixture, `${dir} holds no version with a Plugin entity and its module beside it`);
  }
  if (versions.length > 1) {
    throw new FixtureError(fixture, `${dir} holds ${versions.length} versions with a Plugin entity and its module beside it, ${versions.join(', ')}, so which one an import runs could not be named; lay one`);
  }
  const [version] = versions;
  const args = ['import', run.source, '--dry-run', '--target', run.target];
  const ran = await runCompiler(inputs.compiler.path, args, { cwd: run.folder, home: run.home, boundMs: run.boundMs, log: run.log, env: { ...run.env } });
  const said = ran.stderr.split('\n');
  const formatLine = said.find((l) => l.startsWith(run.formatOpening));
  const owed = said.filter((l) => l.includes(run.owedMarker)).length;
  const command = `\`aggrega ${args.join(' ')}\`, run offline with the catalogs the scenario reads,`;
  if (ran.status !== 0 || formatLine === undefined || owed === 0) {
    // runCompiler kills a run at its bound with SIGKILL, and a run that could not
    // be started has neither an exit status nor a signal.
    const ending = ran.status !== null ? endingOf(ran)
      : ran.signal === 'SIGKILL' ? `was killed at its bound of ${run.boundMs} ms`
        : ran.signal !== null ? endingOf(ran) : 'could not be started';
    const failed = [
      ran.status !== 0 ? (ran.status === null ? 'it did not exit' : `it exited ${ran.status}, not 0`) : '',
      formatLine === undefined ? `no line on standard error opens "${run.formatOpening}"` : '',
      owed === 0 ? `no line on standard error carries "${run.owedMarker}"` : '',
    ].filter((f) => f !== '');
    const last = ran.stderr.trim().split('\n').filter((l) => l.trim() !== '').slice(-3).map((l) => l.trim()).join(' | ') || 'none';
    throw new FixtureError(fixture, `${command} ${ending}; the line naming the format it read: ${formatLine === undefined ? 'none printed' : `"${formatLine.trim()}"`}; lines naming a value still owed: ${owed}; failed: ${failed.join('; ')}; so the compiler was not shown to run the ${importer} importer laid at ${version} in ${dir}; its last standard-error lines: ${last}; the run is recorded in ${run.log}`);
  }
  return { fixture, built: true, proof: `${command} ${endingOf(ran)}, said "${formatLine.trim()}" on standard error and named ${owed} value(s) still owed there: the compiler ran the ${importer} importer laid at ${version} in ${dir}` };
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

// SECOND_AGGREGATE is the Aggregate a copy placed by placeOwnCatalogs gains for
// the check that moves the selection between two Releases and reads which one the
// graph is drawn from: every Release of the example deploys the one Aggregate, so
// each node of every Release's graph names the same document and two drawings
// cannot be told apart by it. The copy gains a copy of that Aggregate differing
// only in its name, under another file, and `release` is pointed at it by that
// name; the Components, their values and every other Release are left as they
// were.
export const SECOND_AGGREGATE = { release: 'release-helm-chart.yaml', from: 'aggregate.yaml', file: 'aggregate-chart.yaml', was: 'aggregate', name: 'aggregate-chart' } as const;

// placeSecondAggregate writes SECOND_AGGREGATE into a copy placed by
// placeOwnCatalogs, refusing where the copy already holds its file, where the
// Aggregate it copies does not carry its name once, or where the Release does not
// name that Aggregate once; and reads both documents back.
export function placeSecondAggregate(folder: string): FixtureProof {
  const a = SECOND_AGGREGATE;
  const fixture = `second Aggregate in ${path.basename(folder)}`;
  const target = path.join(folder, a.file);
  const release = path.join(folder, a.release);
  const named = { as: `\nmetadata:\n  name: ${a.was}\n`, to: `\nmetadata:\n  name: ${a.name}\n` };
  const pointer = { as: `\n  aggregate: ${a.was}\n`, to: `\n  aggregate: ${a.name}\n` };
  const source = fs.readFileSync(path.join(folder, a.from), 'utf8');
  const releaseText = fs.readFileSync(release, 'utf8');
  const refusals = [
    fs.existsSync(target) ? `the copy already holds ${a.file}` : '',
    occurrences(source, named.as) !== 1 ? `${a.from} does not carry "name: ${a.was}" under metadata once` : '',
    occurrences(releaseText, pointer.as) !== 1 ? `${a.release} does not name the Aggregate ${a.was} once` : '',
  ].filter((r) => r !== '');
  if (refusals.length > 0) { throw new FixtureError(fixture, refusals.join('; ')); }
  const written = { aggregate: source.replace(named.as, named.to), release: releaseText.replace(pointer.as, pointer.to) };
  fs.writeFileSync(target, written.aggregate);
  fs.writeFileSync(release, written.release);
  if (fs.readFileSync(target, 'utf8') !== written.aggregate || fs.readFileSync(release, 'utf8') !== written.release) {
    throw new FixtureError(fixture, `${a.file} or ${a.release} does not read back as written`);
  }
  return { fixture, built: true, proof: `${a.file} is ${a.from} with metadata.name ${a.name}, and ${a.release} deploys it by that name rather than ${a.was}; both read back as written` };
}

// The two entities the copy gains for the checks that read a request answered in
// the selected Release's terms, beside the example's own. Every variant of the
// example declares the same Component names, and the variants of the Component
// most of its documents name hover alike in three Releases out of four, so the
// copy as placed above would answer those checks the same way whichever Release
// is selected — and a defect sending no Release would leave them green.
//
// SIZED_VOLUME is a workspace document under no catalog directory, so the Catalog
// panel lists it whichever Release is selected and no Release reads it as part of
// its catalog; its storage is composed from the DbSizing library, which only some
// Releases' catalog directories declare, so checking it on its own passes in
// those Releases' terms and is refused in the others'. In a catalog directory
// every Release reads, the library it names would be missing from the catalog of
// every Release that does not declare it, and those Releases would stop
// resolving. CHART_ONLY sits in one Release's catalog directory alone, so
// completion at a component's type offers it in that Release's terms and nowhere
// a Release that does not read that directory is selected.
export const SIZED_VOLUME = { name: 'local/datastore/sized-volume', file: path.join('components', 'sized-volume.yaml') };
export const CHART_ONLY = { name: 'local/datastore/chart-only', file: path.join('catalog-helm-chart', 'component', 'chart-only.yaml') };
export const SIZING_LIBRARY = 'DbSizing';

const SIZED_VOLUME_DOCUMENT = `apiVersion: aggrega.ai/v1beta1
kind: Component
metadata:
  name: ${SIZED_VOLUME.name}
  version: 1.0.0
  description: A volume whose storage is sized by the shared ${SIZING_LIBRARY} library.
  labels:
    component.aggrega.ai/type: resource
spec:
  schema:
    infra:
      storage:
        $ref: "${SIZING_LIBRARY}#/schemas/Storage"
`;

const CHART_ONLY_DOCUMENT = `apiVersion: aggrega.ai/v1beta1
kind: Component
metadata:
  name: ${CHART_ONLY.name}
  version: 1.0.0
  description: A Component one Release's catalog directory alone declares.
  labels:
    component.aggrega.ai/type: server
spec:
  schema:
    values:
      database:
        type: string
        description: Logical database name.
`;

// placeSelectionReadings writes the two entities into a copy placed by
// placeOwnCatalogs, refusing where the copy already holds either file or holds no
// catalog directory for CHART_ONLY to sit in, and reads both back.
export function placeSelectionReadings(folder: string): FixtureProof {
  const fixture = `selection readings in ${path.basename(folder)}`;
  const chartCatalog = path.join(folder, CHART_ONLY.file.split(path.sep)[0]);
  if (!fs.existsSync(chartCatalog)) { throw new FixtureError(fixture, `the copy holds no ${path.basename(chartCatalog)} directory to write ${CHART_ONLY.file} into`); }
  const written: string[] = [];
  for (const [entity, text] of [[SIZED_VOLUME, SIZED_VOLUME_DOCUMENT], [CHART_ONLY, CHART_ONLY_DOCUMENT]] as const) {
    const file = path.join(folder, entity.file);
    if (fs.existsSync(file)) { throw new FixtureError(fixture, `the copy already holds ${entity.file}`); }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    if (fs.readFileSync(file, 'utf8') !== text) { throw new FixtureError(fixture, `${entity.file} does not read back as written`); }
    written.push(`${entity.file} declaring ${entity.name}`);
  }
  return { fixture, built: true, proof: `${written.join(' and ')}, each read back as written` };
}

// MYSQL_EXAMPLE is the documentation example with two Releases and no default,
// by its path under the documentation checkout.
export const MYSQL_EXAMPLE = path.join('aggrega-docs', 'language-reference', 'examples', 'mysql-innodb-cluster');

// EMPTY_WORKSPACE is the line a documentation example that authors no entities
// of its own marks its root with: it lists no catalog directory, and reads the
// standard library from its default registry.
const EMPTY_WORKSPACE = 'workspace: {}\n';

// DocsExample is a documentation example copied from the sibling checkout, with
// the Releases it holds.
export interface DocsExample {
  folder: string;
  releases: string[];
  proof: FixtureProof;
}

// placeDocsExample copies a documentation example from the sibling checkout,
// which it reads and never writes, as a fresh checkout holds it: its own build
// output, caches and Release lockfiles are left behind. The example lists no
// catalog directory and reads the standard library from its default registry,
// for which a scratch home holds no credential, so the copy supplies the catalog
// input itself: its root line, EMPTY_WORKSPACE, becomes a workspace listing that
// input as its one catalog directory. The copy is refused where that line does
// not stand there exactly once or the example already lists catalog directories,
// and read back naming the input exactly once — so the copy never reads a
// catalog other than the one the report names.
export function placeDocsExample(docsCheckoutParent: string, example: string, dest: string, catalog: string): DocsExample {
  const fixture = `${path.basename(example)} example`;
  const source = path.join(docsCheckoutParent, example);
  if (!fs.existsSync(source)) { throw new FixtureError(fixture, `the documentation example is not at ${source}`); }
  const skip = (rel: string): boolean => /^(dist|\.aggrega|\.trace)(\/|$)/.test(rel) || /\.lock$/.test(rel);
  const files = copyTree(source, dest, skip);
  const config = path.join(dest, FIXTURE_CONFIG);
  const text = fs.readFileSync(config, 'utf8');
  if (occurrences(text, EMPTY_WORKSPACE) !== 1 || text.includes('catalog_dirs')) {
    throw new FixtureError(fixture, `${FIXTURE_CONFIG} does not mark its root with "${EMPTY_WORKSPACE.trim()}" once and list no catalog directory`);
  }
  const listed = `    - ${catalog}\n`;
  fs.writeFileSync(config, text.replace(EMPTY_WORKSPACE, `workspace:\n  catalog_dirs:\n${listed}`));
  const readBack = fs.readFileSync(config, 'utf8');
  const releases = files.filter((f) => /^release[^/]*\.ya?ml$/.test(f)).sort();
  if (occurrences(readBack, listed) !== 1 || occurrences(readBack, '\n  catalog_dirs:\n') !== 1 || readBack.includes(EMPTY_WORKSPACE) || releases.length === 0) {
    throw new FixtureError(fixture, `the copy did not read back as written: the catalog input named ${occurrences(readBack, listed)} times, the empty workspace line ${readBack.includes(EMPTY_WORKSPACE) ? 'still there' : 'gone'}, ${releases.length} Releases`);
  }
  return {
    folder: dest,
    releases,
    proof: { fixture, built: true, proof: `${files.length} files of ${example} copied to ${dest}, with no dist/, .aggrega/, .trace/ or lockfile; ${FIXTURE_CONFIG} lists ${catalog} once as its catalog directory where the example lists none; Releases ${releases.join(', ')}`, evidence: { files } },
  };
}

// placeUnanchored makes an empty folder that no workspace marker reaches: none
// in it and none above it, read back with the extension's own discovery, which
// walks up from the folder by the rule the compiler walks by.
export async function placeUnanchored(dest: string): Promise<FixtureProof> {
  const fixture = `unanchored folder ${path.basename(dest)}`;
  fs.mkdirSync(dest, { recursive: true });
  const held = fs.readdirSync(dest);
  const anchor = await findAggregaWorkspaceAnchor(dest);
  if (held.length > 0 || anchor !== null) {
    throw new FixtureError(fixture, `${dest} holds ${JSON.stringify(held)} and discovery from it finds ${anchor ?? 'nothing'}`);
  }
  return { fixture, built: true, proof: `${dest} is empty, and discovery walking up from it finds no workspace marker` };
}

// WORKSPACE_ANCHOR_ONLY is the smallest configuration that marks a root: a
// workspace block and nothing in it.
export const WORKSPACE_ANCHOR_ONLY = 'workspace: {}\n';

// placeEmptyBeneathWorkspace makes a root carrying the smallest configuration
// that marks it and an empty folder `beneath` it, and reads back that discovery
// from the folder finds the root's configuration.
export async function placeEmptyBeneathWorkspace(root: string, beneath: string): Promise<{ folder: string; proof: FixtureProof }> {
  const fixture = `empty folder beneath a workspace at ${path.basename(root)}`;
  const folder = path.join(root, beneath);
  fs.mkdirSync(folder, { recursive: true });
  const marker = path.join(root, FIXTURE_CONFIG);
  fs.writeFileSync(marker, WORKSPACE_ANCHOR_ONLY);
  const anchor = await findAggregaWorkspaceAnchor(folder);
  if (anchor !== marker || fs.readdirSync(folder).length > 0) {
    throw new FixtureError(fixture, `discovery from ${folder} finds ${anchor ?? 'nothing'}, not ${marker}, or the folder is not empty`);
  }
  return { folder, proof: { fixture, built: true, proof: `${marker} holds "${WORKSPACE_ANCHOR_ONLY.trim()}"; ${folder} is empty, and discovery walking up from it finds ${marker}` } };
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
