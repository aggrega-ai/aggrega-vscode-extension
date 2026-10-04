// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// Stands in for @vscode/vsce-sign, which the packager (@vscode/vsce) and the Open VSX client
// (ovsx, through its own copy of the packager) depend on. The packager calls that package only
// to sign a package or to check a signature, and this extension is packaged, checked and
// published without either, so package.json's "overrides" puts this stub in its place
// everywhere: the build installs neither that package nor the prebuilt signing program it
// brings. Each name below is one the packager reads from it, and each refuses, naming this
// stub, if a signing path is ever reached. Re-check these names at every @vscode/vsce or ovsx
// upgrade.
'use strict';

const MESSAGE = '@vscode/vsce-sign is replaced in this repository by a stub (scripts/vsce-sign-stub), so signing a package and checking a signature are not available';
const refuse = () => Promise.reject(new Error(MESSAGE));

module.exports = {
  generateManifest: refuse,
  verify: refuse,
  zip: refuse,
  ExtensionSignatureVerificationCode: new Proxy({}, { get() { throw new Error(MESSAGE); } }),
};
