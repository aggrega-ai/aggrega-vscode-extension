// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// Writes the build stamp: which build of the extension this compile produced,
// for the welcome page to report.
//
// 🔴 THE VALUE IS THE COMPILER'S BUILD-PROVENANCE RECIPE, SOURCED, NEVER A COPY
// OF IT. The recipe lives beside the compiler's own build scripts, is the one
// place the format is decided, and says in its own header what each shape of the
// value means. This script runs it with the working directory at the extension's
// own root, so the answer describes the extension's repository while the format
// stays the compiler's. A second invocation held here would be a second home for
// that format, and the two would agree only until one of them was edited.
//
// It reaches the recipe by the sibling layout the compile already assumes for the
// wire contract. Where the recipe cannot be reached or run, it writes no stamp,
// and it removes the stamp any earlier compile left: a stale stamp would name the
// build before this one while looking current, and an absent one is reported on
// the page as a version that was not reported, which is true.
//
// Where the stamp sits and what it holds are read from the compiled reader
// module, so the file written here is by construction the file the page reads.
// That is why this runs after the TypeScript compile rather than before it.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const recipe = path.resolve(root, '../aggrega-cli/scripts/lib/build-version.sh');
const { buildStampPath, formatBuildStamp } = require(path.join(root, 'out', 'src', 'build-stamp.js'));

const stamp = buildStampPath(root);
fs.rmSync(stamp, { force: true });

function noStamp(why) {
  console.log(`stamp-build-version: no stamp written (${why}); the welcome page reports this build's version as not reported`);
  process.exit(0);
}

if (!fs.existsSync(recipe)) {
  noStamp(`the recipe is not at ${recipe}`);
}

let version;
try {
  version = execFileSync('bash', ['-c', '. "$1" && printf %s "$_ver"', 'stamp-build-version', recipe], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
} catch (err) {
  noStamp(`the recipe could not be run: ${err.message}`);
}

if (version === '') {
  noStamp('the recipe reported nothing');
}

fs.mkdirSync(path.dirname(stamp), { recursive: true });
fs.writeFileSync(stamp, formatBuildStamp(version));
console.log(`stamp-build-version: ${version}`);
