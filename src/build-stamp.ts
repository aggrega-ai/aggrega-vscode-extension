// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as path from 'path';

// The build stamp is the extension's own account of which build it is: the
// description of the source tree it was compiled from, written into the compiled
// output by the compile step and read back by the running extension when the
// welcome page is drawn.
//
// 🔴 THIS MODULE IS THE ONE HOME OF WHERE THE STAMP SITS AND WHAT IT HOLDS, FOR
// BOTH ITS WRITER AND ITS READER. The compile step's own script loads this
// module's compiled form to learn the path and the shape it writes, so the file
// the page reads cannot drift from the file the build wrote: a second spelling of
// either would agree until one of them was edited, and the symptom would be a
// page reporting "not reported" on every build rather than a failing check.
//
// It holds no editor type, so the reading is assertable without an extension
// host.

// BUILD_STAMP_SEGMENTS is where the stamp sits, relative to the extension's own
// root. It is under the compiled output, which the repository ignores and the
// packaged extension carries, so the stamp travels with every installed copy and
// never becomes a file anyone commits.
export const BUILD_STAMP_SEGMENTS: readonly string[] = ['out', 'build-version.json'];

// buildStampPath is the stamp's location inside one installed or built copy of
// the extension.
export function buildStampPath(extensionRoot: string): string {
  return path.join(extensionRoot, ...BUILD_STAMP_SEGMENTS);
}

// formatBuildStamp is the stamp's text for one build description.
export function formatBuildStamp(version: string): string {
  return `${JSON.stringify({ version }, null, 2)}\n`;
}

// parseBuildStamp reads a build description back out of a stamp's text.
//
// Anything that is not a stamp this module would have written is no reading at
// all, rather than a guess at one: a partly written or hand-edited file is
// reported as absent, which the page draws as a version that was not reported.
export function parseBuildStamp(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) { return null; }
  const version = (parsed as { version?: unknown }).version;
  return typeof version === 'string' && version !== '' ? version : null;
}

// readBuildStamp reports the build description of the copy of the extension
// rooted at `extensionRoot`, or null where that copy carries no readable stamp.
//
// 🔴 A MISSING STAMP IS AN ABSENT READING, NEVER THE MANIFEST'S VERSION. The
// manifest's number is the same for every build made between two releases, so
// showing it in the stamp's place would name a build nobody established — the one
// thing this reading exists to prevent. The file is read through `readFile` so
// the caller holding the editor supplies the filesystem and this module stays
// free of it.
export function readBuildStamp(
  extensionRoot: string,
  readFile: (file: string) => string,
): string | null {
  let text: string;
  try {
    text = readFile(buildStampPath(extensionRoot));
  } catch {
    return null;
  }
  return parseBuildStamp(text);
}
