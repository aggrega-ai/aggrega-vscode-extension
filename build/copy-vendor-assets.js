// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// Places the third-party assets the panels serve into media/vendor/.
//
// WHY A COPY RATHER THAN SERVING FROM node_modules. A packaged extension carries
// its runtime dependencies and not its development ones, and these assets are
// not a runtime dependency by any reading: nothing imports them, at build time
// or at run time. They are static files handed to a document. So they are a
// development dependency that is COPIED into the packaged surface, rather than a
// runtime dependency serving one directory deeper.
//
// WHY THEY ARE NOT COMMITTED. Third-party bytes in this repository's own history
// are third-party bytes every check that reads this repository then has to reason
// about — and the icon set names two of its icons after words this project's own
// prose checks look for, so committing the stylesheet would mean widening a check
// to admit content that was never ours. Taking the files from the published
// package at build time keeps that question from arising at all.
//
// It is written in Node rather than as a shell line so it behaves the same
// wherever npm runs, and it FAILS LOUDLY when a source file is missing: a silent
// no-op here means an extension whose every panel icon is quietly absent, which
// is the one outcome that would not be noticed until somebody looked at the
// panel.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'media', 'vendor');

// Each asset names where it comes from and where it goes. The codicon stylesheet
// refers to the font file beside it by a content hash, so the pair travels
// together or loads nothing.
const ASSETS = [
  ['node_modules/@vscode/codicons/dist/codicon.css', 'codicon.css'],
  ['node_modules/@vscode/codicons/dist/codicon.ttf', 'codicon.ttf'],
  ['node_modules/@vscode/codicons/LICENSE', 'codicon-LICENSE.txt'],
];

fs.mkdirSync(target, { recursive: true });

const missing = [];
for (const [from, to] of ASSETS) {
  const source = path.join(root, from);
  if (!fs.existsSync(source)) {
    missing.push(from);
    continue;
  }
  fs.copyFileSync(source, path.join(target, to));
}

if (missing.length > 0) {
  console.error(
    'copy-vendor-assets: missing, so the panels would draw no icons:\n  '
    + missing.join('\n  ')
    + '\nRun npm install first.',
  );
  process.exit(1);
}

console.log(`copy-vendor-assets: ${ASSETS.length} file(s) into media/vendor/`);
