// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs/promises';
import * as path from 'path';

const CONFIG_FILENAME = '.aggrega-config.yaml';

// findAggregaConfigUpward walks parent directories from start looking
// for .aggrega-config.yaml. Returns the absolute path of the first
// match (deepest-first wins since the walk goes from start upward),
// or null if the filesystem root is reached without a match.
//
// The file's presence is the workspace anchor for the aggrega
// daemon; its contents are not inspected here.
export async function findAggregaConfigUpward(start: string): Promise<string | null> {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, CONFIG_FILENAME);
    if (await fileExists(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isFile();
  } catch {
    return false;
  }
}
