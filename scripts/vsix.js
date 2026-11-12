#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

// Builds the extension's installable package (a .vsix) and publishes a built one
// to the Visual Studio Marketplace and to Open VSX. `node scripts/vsix.js --help`
// states every mode and option; that text is the contract, and this header only
// explains it.
//
// 🔴 THE PACKAGE IS BUILT ONCE, AND PUBLISHING ONLY EVER UPLOADS A FILE IT IS
// GIVEN. Packaging and publishing are separate modes so that one built file is
// published to both marketplaces, and so that what is published is exactly what
// was built and inspected. A publish mode never asks a marketplace's tool to
// build: given no file it refuses, because each marketplace's own publish
// command, given no file, packages the working folder and uploads that in one step.
//
// 🔴 THE OPEN VSX TOKEN COMES FROM OVSX_PAT AND NOWHERE ELSE. The Open VSX client
// treats an empty OVSX_PAT as no token at all, and then uses a token stored on the
// machine, or asks for one at a prompt and stores it. So both Open VSX modes
// refuse before starting it unless OVSX_PAT holds a token, and name the registry
// on its command line, so that no setting in the environment sends the token
// anywhere else.
//
// 🔴 THE PACKAGE IS BUILT FROM COMMITTED TREES, OUTSIDE THEM. The extension
// compiles only beside two sibling checkouts — the wire contract it type-checks
// against and the compiler's build-version recipe it stamps its version with — and
// its compile writes into both the extension and the wire contract's directory.
// So the package mode lays out a work directory of its own: the extension's last
// commit, the wire contract's last commit, and the recipe as the compiler's last
// commit holds it, each read from the repositories without writing to them. A
// working tree's uncommitted edits, and anything an earlier build left in it,
// therefore never reach the package, and the build stamp names the commit the
// package was built from.
//
// 🔴 THE LISTING FIELDS ARE CHECKED BEFORE THE PACKAGER RUNS. The packager asks
// whether to continue when the repository field or the licence file is missing,
// and a question with nobody to answer it is not a refusal anyone can read. The
// check runs on the committed tree first and names everything missing at once.
//
// The packager and the Open VSX client are each the version package.json pins,
// run from the directory npm installed it into from the lockfile — never fetched
// afresh at publish time, since the publish step is the one that holds a
// credential.

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXTENSION_ROOT = path.resolve(__dirname, '..');

// Each tool is a development dependency, named by its package and by the command
// it installs.
const PACKAGER = { name: '@vscode/vsce', command: 'vsce' };
const OPEN_VSX_CLIENT = { name: 'ovsx', command: 'ovsx' };

const OPEN_VSX = 'https://open-vsx.org';
const MIN_NODE_MAJOR = 22;
const MIN_ICON_SIDE = 128;
const LICENSE_FILE = /^LICENSE(\.md|\.txt)?$/i;
const RECIPE = 'scripts/lib/build-version.sh';

// npm masks any text shaped like a UUID in what it prints, the paths `npm list`
// prints included, and the packager finds the files to package — the extension's
// own and its runtime dependencies' — through that listing. Under a directory
// whose path holds such a name it finds none, and reports only that the entry
// point is missing, so the work directory is refused up front instead.
const UUID_SHAPED = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const USAGE = `usage: node scripts/vsix.js <mode> [options]

modes:
  package       Build the .vsix once, from the committed trees, and print its path
                as the last line of output.
    --out <dir>      Directory the .vsix is written to (default: the work directory).
                     It must lie outside every repository the package is built from.
    --work <dir>     Empty or absent directory to build in (default: a new directory
                     under the system's temporary directory). It must lie outside every
                     repository the package is built from, and its path must hold no
                     UUID-shaped name, which npm masks in what it prints. It is left
                     in place.
    --source <repo>  The extension's repository (default: the one holding this script).
    --abi <repo>     The wire contract's repository (default: <source>/../aggrega-abi).
    --cli <repo>     The compiler's repository, read for its build-version recipe only
                     (default: <source>/../aggrega-cli).
                     Each repository is read at its current commit (HEAD); none is
                     written to.
    Refuses, before installing anything, when the committed extension lacks a listing
    field the Marketplace needs: a "repository" field in package.json, a LICENSE,
    LICENSE.md or LICENSE.txt at its root, or an "icon" naming a square PNG of at least
    ${MIN_ICON_SIDE}x${MIN_ICON_SIDE}.

  publish-marketplace <file.vsix>
                Publish that already-built package to the Visual Studio Marketplace.
                A listing there is public from the moment this succeeds.

  verify-marketplace
                Check that the sign-in may publish as package.json's publisher.
                Publishes nothing.

  publish-open-vsx <file.vsix>
                Publish that already-built package to Open VSX, at ${OPEN_VSX},
                into the namespace the package's publisher names. A listing there is
                public from the moment this succeeds.

  verify-open-vsx
                Read package.json's publisher as a namespace from Open VSX and report
                whether the registry has it, then check that the token may publish to
                it. Publishes nothing. Refuses when either check fails.

Signing in, for publish-marketplace and verify-marketplace: when VSCE_PAT is set and not
empty in the environment, the packager signs in with that personal access token, which it
reads from the environment itself; otherwise it signs in with Microsoft Entra ID
(--azure-credential), which takes credentials from the environment, an Azure CLI sign-in
or a managed identity.

Signing in, for publish-open-vsx and verify-open-vsx: the Open VSX client signs in with
the personal access token in OVSX_PAT, which it reads from the environment itself. Both
modes refuse before starting it when OVSX_PAT is unset or empty, and give it the
registry's address, so it neither uses a token stored on the machine nor sends this one
elsewhere.

A token is never accepted as an argument or read from a file.

The packager is ${PACKAGER.name} and the Open VSX client is ${OPEN_VSX_CLIENT.name}, each at the exact
version package.json pins under devDependencies, run from where npm installed it from the
lockfile: the work directory's copy of the extension when packaging, this repository's
node_modules when publishing or verifying (run npm ci first). Node ${MIN_NODE_MAJOR} or newer
is required.

Exit status: 0 done; 1 refused or failed, with the reason printed; 2 usage error.
`;

// Refusal ends the run with exit status 1 and its message; UsageError with 2.
class Refusal extends Error {}
class UsageError extends Error {}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// isWithin reports whether a path is the directory or lies beneath it.
function isWithin(candidate, dir) {
  const rel = path.relative(dir, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// run executes a command with no input, so nothing it starts can wait on a
// question, and its output passed through; a non-zero status refuses.
function run(what, command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...options });
  if (result.error) {
    throw new Refusal(`${what} could not be started: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Refusal(`${what} failed (${result.status === null ? `signal ${result.signal}` : `exit ${result.status}`})`);
  }
}

// capture executes a command with no input and returns what it printed.
function capture(what, command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : (result.stderr || '').trim();
    throw new Refusal(`${what} failed: ${detail}`);
  }
  return result.stdout;
}

function requireNode(tool) {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    throw new Refusal(`${tool.name} needs Node ${MIN_NODE_MAJOR} or newer, and this is Node ${process.versions.node}`);
  }
}

// parseOptions splits arguments into named options, each taking one value, and
// positional ones.
function parseOptions(args, names) {
  const options = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!names.includes(name)) {
      throw new UsageError(`unknown option --${name}`);
    }
    const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
    if (value === undefined || value === '') {
      throw new UsageError(`--${name} needs a value`);
    }
    options[name] = value;
  }
  return { options, positional };
}

// pngSize reads a PNG's width and height from its header, or returns null for
// anything that is not a PNG.
function pngSize(buf) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(signature) || buf.toString('latin1', 12, 16) !== 'IHDR') {
    return null;
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// listingGaps names every listing field the Marketplace needs that the extension
// at root lacks, one sentence each.
function listingGaps(root) {
  const manifest = readJson(path.join(root, 'package.json'));
  const gaps = [];

  const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  if (typeof repository !== 'string' || repository.trim() === '') {
    gaps.push('package.json has no "repository" field, which the listing links to the source from');
  }

  if (!fs.readdirSync(root).some((name) => LICENSE_FILE.test(name) && fs.statSync(path.join(root, name)).isFile())) {
    gaps.push("the extension's root has no LICENSE, LICENSE.md or LICENSE.txt, which the listing shows as its licence");
  }

  if (typeof manifest.icon !== 'string' || manifest.icon.trim() === '') {
    gaps.push(`package.json has no "icon" field naming the listing's icon, a square PNG of at least ${MIN_ICON_SIDE}x${MIN_ICON_SIDE}`);
  } else {
    const icon = path.join(root, manifest.icon);
    const size = fs.existsSync(icon) && fs.statSync(icon).isFile() ? pngSize(fs.readFileSync(icon)) : undefined;
    if (size === undefined) {
      gaps.push(`the icon package.json names, ${manifest.icon}, is not a file in the extension`);
    } else if (size === null) {
      gaps.push(`the icon package.json names, ${manifest.icon}, is not a PNG`);
    } else if (size.width !== size.height) {
      gaps.push(`the icon ${manifest.icon} is ${size.width}x${size.height}, and the listing's icon is square`);
    } else if (size.width < MIN_ICON_SIDE) {
      gaps.push(`the icon ${manifest.icon} is ${size.width}x${size.height}, smaller than ${MIN_ICON_SIDE}x${MIN_ICON_SIDE}`);
    }
  }
  return gaps;
}

// pinnedToolAt returns a tool's command as installed under root, after checking
// that the installed copy is the exact version root's package.json pins.
function pinnedToolAt(root, tool) {
  const pin = readJson(path.join(root, 'package.json')).devDependencies?.[tool.name];
  if (typeof pin !== 'string' || !/^\d+\.\d+\.\d+$/.test(pin)) {
    throw new Refusal(`package.json must pin ${tool.name} to one exact version under devDependencies, and it has ${JSON.stringify(pin)}`);
  }
  const dir = path.join(root, 'node_modules', ...tool.name.split('/'));
  let installed;
  try {
    installed = readJson(path.join(dir, 'package.json'));
  } catch {
    throw new Refusal(`${tool.name} ${pin} is not installed under ${root}; run npm ci there first`);
  }
  if (installed.version !== pin) {
    throw new Refusal(`${root} has ${tool.name} ${installed.version} installed, not the ${pin} package.json pins; run npm ci there`);
  }
  const bin = typeof installed.bin === 'string' ? installed.bin : installed.bin?.[tool.command];
  if (typeof bin !== 'string') {
    throw new Refusal(`${tool.name} ${pin} declares no ${tool.command} command`);
  }
  return path.join(dir, bin);
}

// manifestPublisher returns the publisher package.json names, which is both the
// Marketplace publisher and the Open VSX namespace.
function manifestPublisher() {
  const publisher = readJson(path.join(EXTENSION_ROOT, 'package.json')).publisher;
  if (typeof publisher !== 'string' || publisher === '') {
    throw new Refusal('package.json names no publisher to verify');
  }
  return publisher;
}

// signIn chooses how the packager signs in to the Marketplace: the token in
// VSCE_PAT when one is set, else Microsoft Entra ID. The token stays in the
// environment, where the packager reads it, and never reaches a command line.
function signIn() {
  const token = process.env.VSCE_PAT;
  if (typeof token === 'string' && token !== '') {
    return { label: 'the personal access token in VSCE_PAT', args: [], env: process.env };
  }
  const env = { ...process.env };
  delete env.VSCE_PAT;
  return { label: 'Microsoft Entra ID (--azure-credential)', args: ['--azure-credential'], env };
}

// requireOpenVsxToken refuses unless OVSX_PAT holds a token, which the Open VSX
// client then reads from the environment itself. The client counts an empty
// OVSX_PAT as no token and turns to a token stored on the machine, or to a
// prompt whose answer it stores, so the check comes before it is started.
function requireOpenVsxToken(mode) {
  const token = process.env.OVSX_PAT;
  if (typeof token !== 'string' || token === '') {
    throw new Refusal(`${mode} signs in with the personal access token in OVSX_PAT, which is not set or is empty`);
  }
}

// openVsxNamespace reads a namespace from Open VSX, which needs no sign-in, and
// reports the registry's answer: the namespace and the extensions it holds, or
// the registry's own message when it has none by that name. It returns whether
// the namespace exists.
async function openVsxNamespace(namespace) {
  const address = `${OPEN_VSX}/api/${encodeURIComponent(namespace)}`;
  let response;
  let body;
  try {
    response = await fetch(address, { signal: AbortSignal.timeout(30_000) });
    body = await response.text();
  } catch (err) {
    throw new Refusal(`reading ${address} failed: ${err.message}`);
  }
  let answer = {};
  try {
    const parsed = JSON.parse(body);
    if (parsed !== null && typeof parsed === 'object') {
      answer = parsed;
    }
  } catch {
    // An answer that is not JSON is reported by its status below.
  }
  const message = answer.error ?? answer.message;
  if (response.status === 404) {
    console.log(`vsix: Open VSX has no namespace ${namespace}; the registry answers: ${message ?? `${response.status} ${response.statusText}`}`);
    return false;
  }
  if (!response.ok) {
    throw new Refusal(`reading ${address} failed: the registry answers ${response.status} ${response.statusText}${message ? `: ${message}` : ''}`);
  }
  const extensions = Object.keys(answer.extensions ?? {});
  const holding = extensions.length > 0 ? `holding ${extensions.join(', ')}` : 'holding no extension';
  console.log(`vsix: Open VSX has the namespace ${namespace}, ${answer.verified ? 'verified' : 'not verified'}, ${holding}`);
  return true;
}

// checkOutCommitted places the commit a repository's HEAD names into a new
// directory, with the repository's tags, so the build-version recipe reads the
// same history there as in the repository. Fetching reads the repository and
// writes nothing to it.
function checkOutCommitted(repository, into) {
  run(`creating ${into}`, 'git', ['-c', 'init.defaultBranch=build', 'init', '--quiet', into]);
  run(`reading the last commit of ${repository}`, 'git', ['-C', into, 'fetch', '--quiet', '--tags', '--no-recurse-submodules', repository, 'HEAD']);
  run(`checking out the last commit of ${repository}`, 'git', ['-C', into, 'checkout', '--quiet', '--detach', 'FETCH_HEAD']);
}

// noteUncommitted says so when a repository has changes its last commit does
// not carry among the paths the package is built from, since the package is
// built without them.
function noteUncommitted(repository, paths = []) {
  const status = capture(`reading the status of ${repository}`, 'git', ['-C', repository, 'status', '--porcelain', '--untracked-files=no', '--', ...paths]);
  if (status.trim() !== '') {
    const what = paths.length > 0 ? paths.join(', ') : repository;
    console.log(`vsix: note: ${what} in ${repository} has uncommitted changes; the package is built from the last commit, without them`);
  }
}

// vsixEntries lists the files a .vsix holds, read from its zip central directory.
function vsixEntries(file) {
  const buf = fs.readFileSync(file);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    throw new Refusal(`${file} is not a zip archive`);
  }
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const names = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) {
      throw new Refusal(`${file} has a damaged central directory`);
    }
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    names.push({ name: buf.toString('utf8', at + 46, at + 46 + nameLength), size: buf.readUInt32LE(at + 24) });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function packageMode(args) {
  const { options, positional } = parseOptions(args, ['out', 'work', 'source', 'abi', 'cli']);
  if (positional.length > 0) {
    throw new UsageError(`package takes no positional argument, and was given ${positional.join(' ')}`);
  }
  requireNode(PACKAGER);

  const source = path.resolve(options.source ?? EXTENSION_ROOT);
  const abi = path.resolve(options.abi ?? path.join(source, '..', 'aggrega-abi'));
  const cli = path.resolve(options.cli ?? path.join(source, '..', 'aggrega-cli'));
  const repositories = [source, abi, cli];

  const work = options.work !== undefined ? path.resolve(options.work) : fs.mkdtempSync(path.join(os.tmpdir(), 'aggrega-vsix-'));
  const out = path.resolve(options.out ?? work);
  for (const [flag, dir] of [['--work', work], ['--out', out]]) {
    const holder = repositories.find((repository) => isWithin(dir, repository));
    if (holder !== undefined) {
      throw new Refusal(`${flag} ${dir} lies inside ${holder}; the package is built and written outside the repositories it is built from`);
    }
  }
  if (UUID_SHAPED.test(work)) {
    throw new Refusal(`--work ${work} has a UUID-shaped name in its path, which npm masks in the listing the packager reads its files from; give a work directory whose path holds none`);
  }
  if (fs.existsSync(work) && fs.readdirSync(work).length > 0) {
    throw new Refusal(`--work ${work} is not empty; give an empty or absent directory, so nothing an earlier build left is packaged`);
  }
  fs.mkdirSync(work, { recursive: true });

  noteUncommitted(source);
  noteUncommitted(abi);
  noteUncommitted(cli, [RECIPE]);

  const extension = path.join(work, 'aggrega-vscode-extension');
  checkOutCommitted(source, extension);
  checkOutCommitted(abi, path.join(work, 'aggrega-abi'));
  const recipe = path.join(work, 'aggrega-cli', RECIPE);
  fs.mkdirSync(path.dirname(recipe), { recursive: true });
  fs.writeFileSync(recipe, capture(`reading ${RECIPE} from the last commit of ${cli}`, 'git', ['-C', cli, 'show', `HEAD:${RECIPE}`]));

  const gaps = listingGaps(extension);
  if (gaps.length > 0) {
    throw new Refusal(
      `refusing to package: the committed extension lacks what the Marketplace listing needs —\n${gaps.map((gap) => `  - ${gap}`).join('\n')}\n`
      + 'Commit what is missing and package again.',
    );
  }

  run('npm ci', 'npm', ['ci', '--no-audit', '--no-fund'], { cwd: extension });
  const packager = pinnedToolAt(extension, PACKAGER);
  const manifest = readJson(path.join(extension, 'package.json'));
  fs.mkdirSync(out, { recursive: true });
  const vsix = path.join(out, `${manifest.name}-${manifest.version}.vsix`);
  if (fs.existsSync(vsix)) {
    throw new Refusal(`${vsix} already exists; remove it or give another --out, so one file never stands for two builds`);
  }
  // The packager runs the manifest's prepublish step — the compile, which builds
  // the wire contract, type-checks, places the vendored assets and stamps the
  // build — and then packages.
  run(`${PACKAGER.name} package`, process.execPath, [packager, 'package', '--out', vsix], { cwd: extension });

  const stamp = readJson(path.join(extension, 'out', 'build-version.json'));
  const entries = vsixEntries(vsix);
  console.log(`vsix: ${entries.length} files in the package:`);
  for (const entry of entries) {
    console.log(`  ${entry.name}  (${entry.size} bytes)`);
  }
  console.log(`vsix: packaged ${manifest.publisher}.${manifest.name} ${manifest.version}, build stamp ${JSON.stringify(stamp)}`);
  console.log(vsix);
}

// builtPackage reads a publish mode's one argument, the package to publish, and
// refuses anything but an existing .vsix, so that no publish command is ever
// started without a file — which would package the working folder instead.
function builtPackage(mode, args) {
  const { positional } = parseOptions(args, []);
  if (positional.length !== 1) {
    throw new UsageError(`${mode} takes exactly one argument, the .vsix to publish`);
  }
  const vsix = path.resolve(positional[0]);
  if (path.extname(vsix) !== '.vsix') {
    throw new Refusal(`${vsix} is not a .vsix; ${mode} publishes a package the package mode built`);
  }
  if (!fs.existsSync(vsix) || !fs.statSync(vsix).isFile()) {
    throw new Refusal(`${vsix} does not exist; build it with the package mode first`);
  }
  return vsix;
}

function noArguments(mode, args) {
  const { positional } = parseOptions(args, []);
  if (positional.length > 0) {
    throw new UsageError(`${mode} takes no argument, and was given ${positional.join(' ')}`);
  }
}

function publishMarketplaceMode(args) {
  const vsix = builtPackage('publish-marketplace', args);
  requireNode(PACKAGER);
  const packager = pinnedToolAt(EXTENSION_ROOT, PACKAGER);
  const credential = signIn();
  console.log(`vsix: publishing ${vsix} to the Visual Studio Marketplace, signing in with ${credential.label}`);
  run(`${PACKAGER.name} publish`, process.execPath, [packager, 'publish', '--packagePath', vsix, ...credential.args], {
    cwd: EXTENSION_ROOT,
    env: credential.env,
  });
}

function verifyMarketplaceMode(args) {
  noArguments('verify-marketplace', args);
  requireNode(PACKAGER);
  const publisher = manifestPublisher();
  const packager = pinnedToolAt(EXTENSION_ROOT, PACKAGER);
  const credential = signIn();
  console.log(`vsix: checking that ${credential.label} may publish as ${publisher}; nothing is published`);
  run(`${PACKAGER.name} verify-pat`, process.execPath, [packager, 'verify-pat', publisher, ...credential.args], {
    cwd: EXTENSION_ROOT,
    env: credential.env,
  });
}

// Both Open VSX modes give the client the registry before the command, which is
// where it reads its own options, and an address given there outranks any the
// environment names.
function publishOpenVsxMode(args) {
  const vsix = builtPackage('publish-open-vsx', args);
  requireNode(OPEN_VSX_CLIENT);
  const client = pinnedToolAt(EXTENSION_ROOT, OPEN_VSX_CLIENT);
  requireOpenVsxToken('publish-open-vsx');
  console.log(`vsix: publishing ${vsix} to Open VSX (${OPEN_VSX}), signing in with the personal access token in OVSX_PAT`);
  run(`${OPEN_VSX_CLIENT.name} publish`, process.execPath, [client, '--registryUrl', OPEN_VSX, 'publish', vsix], {
    cwd: EXTENSION_ROOT,
  });
}

async function verifyOpenVsxMode(args) {
  noArguments('verify-open-vsx', args);
  requireNode(OPEN_VSX_CLIENT);
  const namespace = manifestPublisher();
  const client = pinnedToolAt(EXTENSION_ROOT, OPEN_VSX_CLIENT);
  requireOpenVsxToken('verify-open-vsx');
  const exists = await openVsxNamespace(namespace);
  console.log(`vsix: checking that the personal access token in OVSX_PAT may publish to the namespace ${namespace}; nothing is published`);
  run(`${OPEN_VSX_CLIENT.name} verify-pat`, process.execPath, [client, '--registryUrl', OPEN_VSX, 'verify-pat', namespace], {
    cwd: EXTENSION_ROOT,
  });
  if (!exists) {
    throw new Refusal(`Open VSX has no namespace ${namespace}, and nothing can be published to it until it is created`);
  }
}

const MODES = {
  'package': packageMode,
  'publish-marketplace': publishMarketplaceMode,
  'verify-marketplace': verifyMarketplaceMode,
  'publish-open-vsx': publishOpenVsxMode,
  'verify-open-vsx': verifyOpenVsxMode,
};

async function main(argv) {
  const [mode, ...args] = argv;
  if (mode === '--help' || mode === '-h' || mode === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  try {
    const handler = MODES[mode];
    if (handler === undefined) {
      throw new UsageError(mode === undefined ? 'no mode given' : `unknown mode ${mode}`);
    }
    await handler(args);
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`vsix: ${err.message}\n\n${USAGE}`);
      return 2;
    }
    if (err instanceof Refusal) {
      process.stderr.write(`vsix: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

main(process.argv.slice(2)).then((status) => {
  process.exitCode = status;
});
