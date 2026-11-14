// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as l10n from './l10n';

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
//
// It is a closed set of pairs rather than any noun and any verb, because each pair
// is a sentence of its own: the things are the sentence's subject and the verb
// agrees with them, so a translation needs the whole sentence for each pair, and a
// pair added here without its sentences does not compile.
export type Withheld =
  | { readonly things: 'Releases'; readonly as: 'offered' }
  | { readonly things: 'Features'; readonly as: 'offered' }
  | { readonly things: 'Entities'; readonly as: 'listed' };

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
//
// Each sentence spells SELECTOR_ROW_LABELS.workspace (selector-levels.ts) inside
// its own message, since the label is a noun after "the" there.
export function describeLinksLeadingOut(links: LinksLeadingOut, withheld: Withheld): string | null {
  const names = [...links.unreadLinkedDirs, ...links.unreadLinkedFiles];
  if (names.length === 0) { return null; }
  const one = names.length === 1;
  const listed = l10n.series(names);
  switch (withheld.things) {
    case 'Releases':
      return one
        ? l10n.t('Releases reached through this link are not offered, because it leads outside the Aggrega workspace: {0}', listed)
        : l10n.t('Releases reached through these links are not offered, because each leads outside the Aggrega workspace: {0}', listed);
    case 'Features':
      return one
        ? l10n.t('Features reached through this link are not offered, because it leads outside the Aggrega workspace: {0}', listed)
        : l10n.t('Features reached through these links are not offered, because each leads outside the Aggrega workspace: {0}', listed);
    case 'Entities':
      return one
        ? l10n.t('Entities reached through this link are not listed, because it leads outside the Aggrega workspace: {0}', listed)
        : l10n.t('Entities reached through these links are not listed, because each leads outside the Aggrega workspace: {0}', listed);
  }
}
