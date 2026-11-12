// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { SELECTOR_ROW_LABELS } from './selector-levels';

// LinksLeadingOut is what an answer from the language server reports about the
// links inside the workspace that lead out of it and that it did not read: each
// link to a directory outside the workspace, and each link named like a YAML file
// that leads to a file outside it. Each is named relative to the workspace root
// where the link itself sits, in the order the workspace is searched.
//
// The two lists stay two because the answer carries two. It does not say how the
// search met them interleaved, so nothing here composes an order the answer did
// not give.
export interface LinksLeadingOut {
  readonly unreadLinkedDirs: readonly string[];
  readonly unreadLinkedFiles: readonly string[];
}

// Withheld names what a surface does not show because of such links: the things
// it shows, in the plural, and whether it offers them or lists them.
export interface Withheld {
  readonly things: string;
  readonly as: 'offered' | 'listed';
}

// describeLinksLeadingOut is the sentence a surface says about the links leading
// out of the workspace that the language server did not read, or null where the
// answer names none. Every surface where the editor's file tree shows more than
// the language server read says it in these words, naming only what it withholds,
// so the reason is worded in one place.
//
// The links to directories are named first and the links to files after them,
// each in the order the answer gives, and the names close the sentence, so a path
// is never read as running into the words after it.
//
// It says what is reached through a link is not offered rather than what the link
// leads to: a link to a file outside the workspace is not read, so whether that
// file holds what the surface shows is not known.
export function describeLinksLeadingOut(links: LinksLeadingOut, withheld: Withheld): string | null {
  const names = [...links.unreadLinkedDirs, ...links.unreadLinkedFiles];
  if (names.length === 0) { return null; }
  const one = names.length === 1;
  return `${withheld.things} reached through ${one ? 'this link' : 'these links'} are not ${withheld.as}, because ${one ? 'it leads' : 'each leads'} outside the ${SELECTOR_ROW_LABELS.workspace}: ${names.join(', ')}`;
}
