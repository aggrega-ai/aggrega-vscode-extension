// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as path from 'path';

import { SELECTOR_ROW_LABELS } from './selector-levels';
import type { ReleaseCandidatesResponse } from './types';
import { toWorkspaceRelative } from './workspace';

// This module decides whether an action that opens the workspace's configuration
// file opens it, and the sentence said where it does not. It reaches no editor
// type, so the decision is driven by a test; the two actions that open the file —
// the command setting the authoring Release, and the welcome page's control that
// creates a workspace configuration or opens the one already there — each show
// what it decides.
//
// 🔴 WHERE THE FILE LEADS IS THE LANGUAGE SERVER'S JUDGEMENT, NEVER THIS ONE'S. A
// configuration file that is a link leading out of the workspace is not read by
// the language server at all: it lists the workspace with nothing configured,
// names the file among the links it did not read, and refuses every request the
// configuration decides. The extension's own reading of the path is its spelling,
// which says nothing about where a link leads, so the file is withheld only where
// the server's answer names it. Where the server answers without naming it, where
// it refuses the listing — a configuration file that does not validate is one such
// refusal, and that file is opened so the reader can repair it — and where no
// server is running to ask, the file is opened as it always was: nothing has
// judged it, and a refusal with no judgement behind it would be this extension
// deciding by the absence of an answer.

// ServerListing is how an action reaches that judgement.
export interface ServerListing {
  // listReleases asks the running language server for its Release listing. It
  // rejects where no server is running, and with the server's refusal where the
  // listing is refused.
  listReleases(): Promise<Pick<ReleaseCandidatesResponse, 'unreadLinkedFiles'>>;
  // answeredRoot is the workspace root the running language server reported it
  // answers for, or null where none has reported one.
  answeredRoot(): string | null;
}

// HowFound says how the action came to hold the file: found already there, or
// created by the action itself a moment ago.
export type HowFound = 'found' | 'created';

// ConfigurationOpening is what an action does with the file: open it, or leave it
// unopened and say why.
export type ConfigurationOpening = { open: true } | { open: false; message: string };

const OPENS: ConfigurationOpening = { open: true };

// configurationNotOpened is the sentence an action ends in where it does not open
// a configuration file, naming the file as the language server's answer spells it.
export function configurationNotOpened(name: string): string {
  return `Aggrega: ${name} is not opened, because it leads outside the ${SELECTOR_ROW_LABELS.workspace}, so Aggrega does not use it.`;
}

// asTheServerSpellsIt writes a path relative to the workspace root the way the
// language server names one in an answer: with a forward slash between its parts,
// on every platform. The extension spells a relative path with the platform's own
// separator, so where that separator is another character a file in a
// subdirectory would be spelled apart from the server's name for it and matched by
// none. separator is the platform's; a test hands in another one.
export function asTheServerSpellsIt(relative: string, separator: string = path.sep): string {
  return separator === '/' ? relative : relative.split(separator).join('/');
}

// configurationOpening decides whether an action opens file, the absolute path of
// the configuration file it would open.
//
// A file the action has just created is opened without asking anything: the
// action wrote it inside the workspace a moment ago, so there is no link to judge.
// A file found already there is opened unless the running language server's
// Release listing names it among the files it did not read. The comparison is of
// spellings, the file spelled relative to the root the server answers for, as the
// server spells such a path, against each name the answer gives — so the
// judgement of where the file leads stays the server's, and this compares names it
// has already given.
export async function configurationOpening(
  listing: ServerListing,
  file: string,
  how: HowFound,
): Promise<ConfigurationOpening> {
  if (how === 'created') {
    return OPENS;
  }
  let answer: Pick<ReleaseCandidatesResponse, 'unreadLinkedFiles'>;
  try {
    answer = await listing.listReleases();
  } catch {
    return OPENS;
  }
  const root = listing.answeredRoot();
  if (!root) {
    return OPENS;
  }
  const spelled = asTheServerSpellsIt(toWorkspaceRelative(root, file));
  const named = (answer.unreadLinkedFiles ?? []).find((name) => name === spelled);
  return named === undefined ? OPENS : { open: false, message: configurationNotOpened(named) };
}
