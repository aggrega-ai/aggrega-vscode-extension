// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as fs from 'node:fs';
import * as path from 'node:path';

// This helper is the one home of reading the documentation's guide to this
// extension — the manual a reader is sent to from this repository's README. The
// guide is a section of the authoring guide: an index page and one page for each
// part of the extension. Every spec asserting what the guide teaches reads it
// here, so a page added to the section is read by all of them at once rather
// than by whichever spec happened to be updated.
//
// The section sits outside this repository, so it is reachable when the
// extension is checked out beside the documentation and not when the extension
// is cloned alone; a spec that reads it reports itself pending in the second
// case rather than passing quietly.
export const EDITOR_GUIDE_DIR = path.resolve(__dirname, '../../../../aggrega-docs/authoring/editor');

// The section's index page, which is what makes the directory the guide.
const INDEX_PAGE = 'README.md';

// editorGuidePresent reports whether the guide is checked out beside the
// extension.
export function editorGuidePresent(): boolean {
  return fs.existsSync(path.join(EDITOR_GUIDE_DIR, INDEX_PAGE));
}

// editorGuidePages returns the section's pages by file name, the index first and
// the rest sorted by name. Sorted rather than in the site's reading order: the
// order has to be the same on every machine, and nothing asserted over the
// guide depends on which page comes first.
export function editorGuidePages(): string[] {
  const rest = fs.readdirSync(EDITOR_GUIDE_DIR)
    .filter((name) => name.endsWith('.md') && name !== INDEX_PAGE)
    .sort();
  return [INDEX_PAGE, ...rest];
}

// editorGuidePage returns one page of the section.
export function editorGuidePage(name: string): string {
  return fs.readFileSync(path.join(EDITOR_GUIDE_DIR, name), 'utf8');
}

// editorGuide returns the whole guide: every page of the section, in the order
// editorGuidePages gives, joined by a blank line.
export function editorGuide(): string {
  return editorGuidePages().map(editorGuidePage).join('\n\n');
}
