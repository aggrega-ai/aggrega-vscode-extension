// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

// The words a version reading is stated in, wherever the extension states one:
// the welcome page's readings, and the notification a start or a restart of the
// language server ends in. They have one home so a reader meets one phrase for a
// version nobody reported wherever they meet it, and one rule for which values
// name a build at all.
//
// It holds no editor type, so every phrase is read back by a test exactly as a
// reader would meet it.
//
// Each phrase stands alone where it is placed — set off by a comma after the
// sentence it completes, or as a reading's value on its own — so a translation
// words it in its dictionary form.

import * as l10n from './l10n';

// VERSION_ABSENT is what stands where a reading could not be taken.
//
// It says the version was not reported rather than naming a cause, and the
// restraint is deliberate: the page cannot tell "nothing is running to ask" from
// "something is running and did not answer", and a word that picked one would be
// wrong in the other case — on a page that already carries a step reporting
// whether the compiler answers at all.
export const VERSION_ABSENT = l10n.t('version not reported');

// versionKnown reports whether a reading names a build. An empty value names
// none, so it is read as the absence it is.
export function versionKnown(value: string | null | undefined): value is string {
  return typeof value === 'string' && value !== '';
}

// versionPhrase is one reading as a phrase that stands in a sentence: the word
// "version" and the value as it was read, or the words for a reading not
// obtained.
export function versionPhrase(value: string | null | undefined): string {
  return versionKnown(value) ? l10n.t('version {0}', value) : VERSION_ABSENT;
}
