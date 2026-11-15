// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { buildStampPath, parseBuildStamp } from '../../src/build-stamp';

// The runner's named inputs, and the refusal each one earns when it is missing or
// is not what it claims to be.
//
// 🔴 THE RUNNER COMPILES NOTHING AND BUILDS NO COMPILER. Every input is something
// that already exists and is handed to it, so what a run tested is exactly what
// the report names. A runner that rebuilt a stale input on the way in would test
// a build nobody asked for, and would reach into other repositories to do it.

// EDITOR_VERSION is the editor build the suite drives. It is the one place the
// version is written; the refusal for a different build names it.
export const EDITOR_VERSION = '1.138.0';

// REPO_ROOT is the root of the repository the runner itself is compiled in.
export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// BUILD_VERSION_RECIPE is the compiler's build-provenance recipe, reached by the
// same sibling layout the extension's stamp script reaches it by. Where it is not
// there the catalog is refused naming this path, so a recipe that has moved stops
// the run instead of leaving the report without the catalog's identity.
const BUILD_VERSION_RECIPE = path.resolve(REPO_ROOT, '..', 'aggrega-cli', 'scripts', 'lib', 'build-version.sh');

// InputOptions are the paths and expectations a run is given, from its arguments
// or its environment.
export interface InputOptions {
  extension: string;
  compiler?: string;
  compilerCommit?: string;
  catalog?: string;
  registryServer?: string;
  editor?: string;
  // importerCatalog is optional for every command: a catalog folder holding the
  // core importers, read where a run imports with a compiler no registry holds
  // the importers of.
  importerCatalog?: string;
  // scratch is where the runner may write while it checks the inputs.
  scratch: string;
}

// Inputs are the checked inputs, each with the identity the report is headed with.
export interface Inputs {
  extension: { dir: string; buildStamp: string };
  compiler: { path: string; version: string; commit: string };
  // uncommitted is the checkout the catalog sits in, never the catalog directory
  // alone; catalogIdentity says exactly what it covers.
  catalog: { dir: string; commit: string; uncommitted: boolean };
  registryServer: { path: string; version: string };
  editor: { dir: string; executable: string; version: string; commit: string };
  // importerCatalog is null where none was given; importers are what it holds, as
  // importerVersions reads them.
  importerCatalog: { dir: string; importers: readonly CatalogImporter[] } | null;
}

// CatalogImporter is one importer a catalog folder holds: its name, the directory
// its versions sit in, and each version holding its Plugin entity with its module
// beside it, sorted.
export interface CatalogImporter {
  name: string;
  dir: string;
  versions: readonly string[];
}

// Refusal names one input, why it cannot be used, and what would put it right.
export interface Refusal {
  input: string;
  option: string;
  reason: string;
  remedy: string;
}

// INPUT_NAMES are the inputs by subject, with the option and the environment
// variable each one is read from.
export const INPUT_NAMES = {
  extension: { subject: 'the compiled extension', option: '--extension', env: 'AGGREGA_E2E_EXTENSION' },
  compiler: { subject: 'the language-server binary', option: '--compiler', env: 'AGGREGA_E2E_COMPILER' },
  compilerCommit: { subject: 'the commit the language-server binary must report', option: '--compiler-commit', env: 'AGGREGA_E2E_COMPILER_COMMIT' },
  catalog: { subject: 'the standard-library catalog', option: '--catalog', env: 'AGGREGA_E2E_CATALOG' },
  registryServer: { subject: 'the registry server binary', option: '--registry-server', env: 'AGGREGA_E2E_REGISTRY_SERVER' },
  editor: { subject: 'the editor build', option: '--editor', env: 'AGGREGA_E2E_EDITOR' },
  importerCatalog: { subject: 'the catalog folder holding the importers', option: '--importer-catalog', env: 'AGGREGA_E2E_IMPORTER_CATALOG' },
} as const;

type InputKey = keyof typeof INPUT_NAMES;

function refusal(key: InputKey, reason: string, remedy: string): Refusal {
  const n = INPUT_NAMES[key];
  return { input: n.subject, option: `${n.option} or ${n.env}`, reason, remedy };
}

// defaultEditorDir is where the editor build sits once it has been fetched into
// the extension's own download directory.
export function defaultEditorDir(extensionDir: string): string {
  return path.join(extensionDir, '.vscode-test', `vscode-linux-x64-${EDITOR_VERSION}`);
}

// InputsNeeded says which of the inputs a command needs beyond the extension, the
// compiler and the editor, which every command needs. The suite needs all of
// them, and is checked with the default; a command that starts no registry
// server, or reads a catalog only where it is given one, says so.
export interface InputsNeeded {
  catalog: 'required' | 'optional';
  registryServer: boolean;
}

const EVERY_INPUT: InputsNeeded = { catalog: 'required', registryServer: true };

// NOT_GIVEN_CATALOG and NOT_USED_REGISTRY_SERVER stand in an input set for an
// input a command does not need and was not given. Nothing such a command starts
// reads either, and each says so where a report prints it.
const NOT_GIVEN_CATALOG: Inputs['catalog'] = { dir: '', commit: 'none given', uncommitted: false };
const NOT_USED_REGISTRY_SERVER: Inputs['registryServer'] = { path: '', version: 'not used' };

// catalogGiven says whether an input set carries a catalog, rather than the stand-in
// for one a command was not given.
export function catalogGiven(inputs: Inputs): boolean {
  return inputs.catalog !== NOT_GIVEN_CATALOG;
}

// checkInputs checks every input a command needs and returns either all of them or
// every refusal at once, so one attempt names everything that has to be put right.
export function checkInputs(opts: InputOptions, needed: InputsNeeded = EVERY_INPUT): { inputs: Inputs } | { refusals: Refusal[] } {
  const refusals: Refusal[] = [];
  const extension = checkExtension(opts.extension, refusals);
  const compiler = checkCompiler(opts, refusals);
  const catalog = needed.catalog === 'optional' && opts.catalog === undefined ? NOT_GIVEN_CATALOG : checkCatalog(opts.catalog, refusals);
  const registryServer = needed.registryServer ? checkRegistryServer(opts.registryServer, refusals) : NOT_USED_REGISTRY_SERVER;
  const editor = checkEditor(opts.editor ?? defaultEditorDir(opts.extension), refusals);
  const importerCatalog = opts.importerCatalog === undefined ? null : checkImporterCatalog(opts.importerCatalog, refusals);
  if (refusals.length > 0 || !extension || !compiler || !catalog || !registryServer || !editor || (opts.importerCatalog !== undefined && !importerCatalog)) {
    return { refusals };
  }
  return { inputs: { extension, compiler, catalog, registryServer, editor, importerCatalog } };
}

// importersAhead is the list of catalog directories an import reads with an
// importer catalog: the importer catalog first, then the catalog a run otherwise
// reads, as AGGREGA_CATALOG_DIRS spells a list.
export function importersAhead(importerCatalog: string, catalog: string): string {
  return `${importerCatalog}:${catalog}`;
}

// checkImporterCatalog accepts a catalog folder holding importers — a
// plugin/importer directory, each importer under its name and version, as the
// compiler's colocated-plugin catalog lays them — and reads what it holds. Which
// version an import runs is the compiler's to decide; a scenario that needs one
// importer asks the compiler itself.
function checkImporterCatalog(dir: string, refusals: Refusal[]): NonNullable<Inputs['importerCatalog']> | null {
  const importers = path.join(dir, 'plugin', 'importer');
  if (fs.statSync(importers, { throwIfNoEntry: false })?.isDirectory() !== true) {
    refusals.push(refusal('importerCatalog', `${dir} names no catalog folder holding importers (it holds no plugin/importer)`, 'name the folder aggrega-cli/scripts/gen-colocated-plugin-catalog.sh wrote: each importer under plugin/importer/<name>/<version>, its Plugin entity with its module beside it'));
    return null;
  }
  return { dir, importers: importerVersions(importers) };
}

// importerVersions reads a plugin/importer directory: each importer by its name,
// with the versions holding its Plugin entity (plugin.yaml) and a module (a .wasm
// file) beside it, names and versions sorted. An entry that is not a directory is
// neither an importer nor a version, and an importer with no such version is
// listed with none. It is the one reading of that layout, for the report's header
// and for a scenario's proof alike.
function importerVersions(importers: string): CatalogImporter[] {
  const subdirs = (dir: string): string[] => fs.readdirSync(dir)
    .filter((n) => fs.statSync(path.join(dir, n), { throwIfNoEntry: false })?.isDirectory() === true).sort();
  return subdirs(importers).map((name) => {
    const dir = path.join(importers, name);
    return {
      name,
      dir,
      versions: subdirs(dir).filter((v) => {
        const files = fs.readdirSync(path.join(dir, v));
        return files.includes('plugin.yaml') && files.some((f) => f.endsWith('.wasm'));
      }),
    };
  });
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function walk(dir: string, keep: (file: string) => boolean): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) { return out; }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...walk(full, keep)); } else if (keep(full)) { out.push(full); }
  }
  return out;
}

// staleOutputs lists each TypeScript source under `srcDir` whose compiled output
// under `outDir` is missing or older than the source. A declaration file compiles
// to nothing, so it has no output to compare.
function staleOutputs(root: string, srcRel: string, outRel: string): string[] {
  const srcDir = path.join(root, srcRel);
  const stale: string[] = [];
  for (const ts of walk(srcDir, (f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))) {
    const js = path.join(root, outRel, path.relative(srcDir, ts)).replace(/\.ts$/, '.js');
    if (!fs.existsSync(js)) {
      stale.push(`${path.relative(root, ts)} (no ${path.relative(root, js)})`);
    } else if (fs.statSync(js).mtimeMs < fs.statSync(ts).mtimeMs) {
      stale.push(`${path.relative(root, ts)} (newer than ${path.relative(root, js)})`);
    }
  }
  return stale;
}

function checkExtension(dir: string, refusals: Refusal[]): Inputs['extension'] | null {
  const recompile = 'compile the extension (`npx tsc -p ./` from its root), then write its build stamp (`node build/stamp-build-version.js`)';
  if (!fs.existsSync(path.join(dir, 'package.json')) || !fs.existsSync(path.join(dir, 'src'))) {
    refusals.push(refusal('extension', `${dir} is not the extension's source root: it holds no package.json and src/`, 'name the extension\'s root directory'));
    return null;
  }
  const stale = [
    ...staleOutputs(dir, 'src', path.join('out', 'src')),
    ...staleOutputs(dir, path.join('test', 'e2e'), path.join('out', 'test', 'e2e')),
  ];
  if (stale.length > 0) {
    refusals.push(refusal('extension', `its compiled output is older than its source: ${stale.join('; ')}`, recompile));
    return null;
  }
  const vendor = path.join(dir, 'media', 'vendor');
  if (!fs.existsSync(vendor) || fs.readdirSync(vendor).length === 0) {
    refusals.push(refusal('extension', `${vendor} is missing, so the panels would draw without their icons`, 'copy the vendored assets (`node build/copy-vendor-assets.js`)'));
    return null;
  }
  const stampFile = buildStampPath(dir);
  let stampText: string | null = null;
  try { stampText = fs.readFileSync(stampFile, 'utf8'); } catch { stampText = null; }
  const stamp = stampText === null ? null : parseBuildStamp(stampText);
  if (stamp === null) {
    refusals.push(refusal('extension', `${stampFile} holds no build stamp, so the report could not say which build it tested`, 'write the build stamp (`node build/stamp-build-version.js`)'));
    return null;
  }
  const stampMs = fs.statSync(stampFile).mtimeMs;
  const newer = walk(path.join(dir, 'out', 'src'), (f) => f.endsWith('.js')).filter((f) => fs.statSync(f).mtimeMs > stampMs);
  if (newer.length > 0) {
    refusals.push(refusal('extension', `its build stamp (${stamp}) is older than ${newer.length} compiled file(s), among them ${path.relative(dir, newer[0])}, so it names an earlier build`, 'write the build stamp again (`node build/stamp-build-version.js`)'));
    return null;
  }
  return { dir, buildStamp: stamp };
}

// quietEnv is the environment the runner's own probes of an input run under: no
// inherited variable, and a home inside the scratch directory, so asking a binary
// for its version cannot write into the developer's home.
function quietEnv(scratch: string): NodeJS.ProcessEnv {
  const home = path.join(scratch, 'input-checks-home');
  fs.mkdirSync(home, { recursive: true });
  return { PATH: '/usr/bin:/bin', HOME: home, XDG_CACHE_HOME: path.join(home, '.cache'), XDG_CONFIG_HOME: path.join(home, '.config'), LANG: 'C.UTF-8' };
}

// notBuiltFromACommit says why a version the compiler reports names no committed
// revision, or is null where it names one. Three stamps say so, from the two
// things that stamp a build: the "-dirty" the build-provenance recipe gives a
// working tree with uncommitted changes; the "+dirty" the Go toolchain gives the
// same when it stamps the build itself; and
// "(devel)" — with "(unknown)", the version command's answer where it can read no
// build information — where nothing stamped a revision at all. A binary built
// from a commit reproduces from that commit; none of these does.
export function notBuiltFromACommit(version: string): string | null {
  if (version.endsWith('-dirty') || version.endsWith('+dirty')) { return 'a build of a working tree with uncommitted changes'; }
  if (version === '(devel)' || version === '(unknown)') { return 'a build stamped with no revision at all'; }
  return null;
}

function checkCompiler(opts: InputOptions, refusals: Refusal[]): Inputs['compiler'] | null {
  const bin = opts.compiler;
  if (!bin) {
    refusals.push(refusal('compiler', 'none was given', 'name an aggrega binary built from a committed revision'));
    return null;
  }
  if (!isExecutable(bin)) {
    refusals.push(refusal('compiler', `${bin} is not an executable file`, 'name an aggrega binary built from a committed revision'));
    return null;
  }
  const r = spawnSync(bin, ['version', '-o', 'json'], { env: quietEnv(opts.scratch), encoding: 'utf8', timeout: 30000 });
  let reported: { version?: unknown; commit?: unknown } = {};
  try { reported = JSON.parse(r.stdout); } catch { reported = {}; }
  if (r.status !== 0 || typeof reported.version !== 'string' || typeof reported.commit !== 'string') {
    refusals.push(refusal('compiler', `\`${bin} version -o json\` exited ${r.status} without reporting a version and a commit`, 'name an aggrega binary'));
    return null;
  }
  const uncommitted = notBuiltFromACommit(reported.version);
  if (uncommitted !== null) {
    refusals.push(refusal('compiler', `it reports version ${reported.version}, ${uncommitted}`, 'build the binary from a committed revision'));
    return null;
  }
  const want = opts.compilerCommit;
  if (!want) {
    refusals.push(refusal('compilerCommit', `none was given; the binary reports commit ${reported.commit}`, 'name the commit the binary was built from'));
    return null;
  }
  const n = Math.min(want.length, reported.commit.length);
  if (n < 7 || want.slice(0, n) !== reported.commit.slice(0, n)) {
    refusals.push(refusal('compiler', `it reports commit ${reported.commit}, not ${want}`, 'name the binary built from that commit, or the commit this binary was built from'));
    return null;
  }
  return { path: bin, version: reported.version, commit: reported.commit };
}

// catalogIdentity reads which commit the catalog is checked out at, and whether
// its checkout differs from that commit, from the compiler's build-provenance
// recipe, SOURCED with the working directory at the catalog directory. The
// runner asks no identity question of its own: the recipe is the one place the
// format of a tree's provenance is decided, and a second question held here would
// be a second home for it. The catalog directory may sit below the root of its
// checkout; the recipe's questions resolve the enclosing checkout from there.
//
// The commit is the recipe's `_sha`. `uncommitted` is a "-dirty" suffix on its
// `_ver`, which is the recipe's working-tree marker, and it reaches exactly as far
// as the checkout does: a tracked file changed anywhere in the checkout holding
// the catalog, staged or not, sets it, a change outside the catalog directory
// included. A file the checkout does not track sets nothing, so a new entity file
// not yet added to the checkout leaves `uncommitted` false.
//
// The recipe answers "dev" and "unknown" where the directory is in no checkout
// git can read; either one is reported as no identity.
function catalogIdentity(dir: string, remedy: string): { commit: string; uncommitted: boolean } | { reason: string; remedy: string } {
  const recipeRemedy = 'run the runner from a checkout that holds the compiler\'s repository beside the extension\'s';
  const answer = recipeAnswer(dir);
  if ('failure' in answer) {
    return { reason: `${answer.failure}, so the catalog's identity cannot be read`, remedy: recipeRemedy };
  }
  const { version, commit } = answer;
  if (version === '' || version === 'dev' || commit === '' || commit === 'unknown') {
    return { reason: `git cannot name the commit ${dir} is checked out at, so the report could not say which catalog it tested`, remedy };
  }
  return { commit, uncommitted: version.endsWith('-dirty') };
}

// recipeAnswer is what the compiler's build-provenance recipe answers when it is
// sourced with the working directory at `dir`: the version it composes for the
// checkout holding `dir`, and that checkout's short commit. It is the one way the
// runner reads a tree's provenance, for the catalog's identity and for the build
// the extension's welcome page is expected to name.
export function recipeAnswer(dir: string): { version: string; commit: string } | { failure: string } {
  if (!fs.existsSync(BUILD_VERSION_RECIPE)) {
    return { failure: `the compiler's build-provenance recipe is not at ${BUILD_VERSION_RECIPE}` };
  }
  const r = spawnSync('bash', ['-c', '. "$1" && printf "%s\\n%s" "$_ver" "$_sha"', 'tree-provenance', BUILD_VERSION_RECIPE], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30000,
  });
  if (r.status !== 0) {
    return { failure: `sourcing the compiler's build-provenance recipe at ${BUILD_VERSION_RECIPE} in ${dir} exited ${r.status ?? r.signal}` };
  }
  const [version = '', commit = ''] = (r.stdout ?? '').split('\n');
  return { version, commit };
}

// holdsEntity reports whether a directory holds at least one Aggrega entity file,
// looking no further than the first one found.
function holdsEntity(dir: string, depth: number): boolean {
  if (depth < 0) { return false; }
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && /\.ya?ml$/.test(e.name)) {
      const head = fs.readFileSync(full, 'utf8').slice(0, 400);
      if (/^apiVersion:\s*aggrega\.ai\//m.test(head)) { return true; }
    }
  }
  return entries.some((e) => e.isDirectory() && !e.name.startsWith('.') && holdsEntity(path.join(dir, e.name), depth - 1));
}

function checkCatalog(dir: string | undefined, refusals: Refusal[]): Inputs['catalog'] | null {
  const remedy = 'name the standard-library catalog directory of a git checkout';
  if (!dir) {
    refusals.push(refusal('catalog', 'none was given', remedy));
    return null;
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    refusals.push(refusal('catalog', `${dir} is not a directory`, remedy));
    return null;
  }
  if (!holdsEntity(dir, 6)) {
    refusals.push(refusal('catalog', `${dir} holds no Aggrega entity file`, remedy));
    return null;
  }
  const identity = catalogIdentity(dir, remedy);
  if ('reason' in identity) {
    refusals.push(refusal('catalog', identity.reason, identity.remedy));
    return null;
  }
  return { dir, ...identity };
}

function checkRegistryServer(bin: string | undefined, refusals: Refusal[]): Inputs['registryServer'] | null {
  const remedy = 'name a zot registry server binary';
  if (!bin) {
    refusals.push(refusal('registryServer', 'none was given', remedy));
    return null;
  }
  if (!isExecutable(bin)) {
    refusals.push(refusal('registryServer', `${bin} is not an executable file`, remedy));
    return null;
  }
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 30000, env: { PATH: '/usr/bin:/bin' } });
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  let commit: string | null = null;
  for (const line of text.split('\n')) {
    try {
      const parsed = JSON.parse(line) as { commit?: unknown };
      if (typeof parsed.commit === 'string') { commit = parsed.commit; }
    } catch { /* not the version line */ }
  }
  if (r.status !== 0 || commit === null) {
    refusals.push(refusal('registryServer', `\`${bin} --version\` exited ${r.status} without reporting a version`, remedy));
    return null;
  }
  return { path: bin, version: commit };
}

function checkEditor(dir: string, refusals: Refusal[]): Inputs['editor'] | null {
  const remedy = `fetch it into the extension's .vscode-test directory (\`npm run test:e2e -- fetch-editor\`)`;
  const executable = path.join(dir, 'code');
  const manifest = path.join(dir, 'resources', 'app', 'package.json');
  if (!isExecutable(executable) || !fs.existsSync(manifest)) {
    refusals.push(refusal('editor', `${dir} holds no editor build (no executable \`code\` and resources/app/package.json)`, remedy));
    return null;
  }
  const m = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { version?: string };
  if (m.version !== EDITOR_VERSION) {
    refusals.push(refusal('editor', `${dir} is editor ${m.version ?? '(no version)'}, and this runner drives ${EDITOR_VERSION}`, remedy));
    return null;
  }
  let commit = '';
  try {
    commit = (JSON.parse(fs.readFileSync(path.join(dir, 'resources', 'app', 'product.json'), 'utf8')) as { commit?: string }).commit ?? '';
  } catch { commit = ''; }
  return { dir, executable, version: m.version, commit };
}
