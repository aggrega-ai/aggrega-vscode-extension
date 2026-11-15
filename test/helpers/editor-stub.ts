// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as path from 'path';

type ModuleLoader = {
  _load: (request: string, ...rest: unknown[]) => unknown;
};

// loadAgainstEditorStub loads one of the extension's compiled modules with `stub`
// standing in for the editor's API, and answers that module's exports.
//
// The module is loaded against the stub rather than against whatever some other
// file left in the module cache, and the cache is put back exactly as it was
// found afterwards, so a spec loading against its own stub neither sees nor
// leaves behind another's. The rule is the tree the modules live in rather than
// a list of their names, because a list would be a second statement of which
// modules reach the editor and would go stale the first time one did.
//
// `compiledModule` names the module as it sits under the compiled sources, the
// way a spec imports it: 'operations' for src/operations.ts.
export function loadAgainstEditorStub<T>(stub: unknown, compiledModule: string): T {
  const nodeModule = require('module') as ModuleLoader;
  const restoreLoad = nodeModule._load;
  nodeModule._load = function (this: unknown, request: string, ...rest: unknown[]): unknown {
    if (request === 'vscode') { return stub; }
    return restoreLoad.apply(this, [request, ...rest]);
  };

  const compiledSrc = path.resolve(__dirname, '..', '..', 'src') + path.sep;
  const displaced = new Map<string, NodeModule>();
  try {
    for (const id of Object.keys(require.cache)) {
      if (id.startsWith(compiledSrc)) {
        displaced.set(id, require.cache[id] as NodeModule);
        delete require.cache[id];
      }
    }
    return require(path.join(compiledSrc, compiledModule)) as T;
  } finally {
    for (const id of Object.keys(require.cache)) {
      if (id.startsWith(compiledSrc)) { delete require.cache[id]; }
    }
    for (const [id, held] of displaced) { require.cache[id] = held; }
    nodeModule._load = restoreLoad;
  }
}
