// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';
import * as l10n from './l10n';

// This module is the one home of "which configuration file, and how far does it
// reach" — both directions: the destination a request ASKS for, and the reach an
// answer REPORTS.
//
// Several operations write configuration, and each answers with the same three
// facts for the same reason: a request names one workspace, so an answer that
// said nothing about reach would be read as being about that workspace — and
// more than one of these operations defaults to the file every project on the
// machine resolves through, which makes that reading wrong.
//
// It lives here rather than beside any one of them because a second copy would
// agree on the day it was written. The two that would diverge are the shape and
// the sentence: two shapes drift a field apart when the compiler adds one, and
// two sentences tell a reader about the same file in two different sets of
// words, which reads as two different files.
//
// 🔴 THE WORDS FOR THE TWO FILES ARE WRITTEN ONCE HERE AND REACHED FROM
// EVERYWHERE ELSE — the choice a reader is offered, the consent a destructive
// operation asks for, and the sentence an operation ends in. A surface that is
// asked to pick a file and then told about a file in different words has been
// shown two files, and nothing would ever fail while the two wordings happened
// to agree.

// ConfigWriteScope is how far a configuration write reached.
//
// machineWide is the fact a reader most needs and has no other way to get. It is
// derived from the file the write actually resolved to rather than from the
// request, so it cannot describe a machine-wide change as a local one.
export type ConfigWriteScope = wire.ConfigWriteScope;

// ConfigWriteDestination is which configuration file a request ASKS a write to
// land in.
//
// It is a separate type from the scope above, and the separation is what keeps
// each honest. A request can name a destination and nothing more; only the
// answer knows the path that destination resolved to, so a surface reusing the
// answer's shape to ask a question would have to invent a path to fill it with.
export type ConfigWriteDestination = 'global' | 'workspace';

// MACHINE_WIDE_REACH and PROJECT_REACH are the words for the two files, in the
// terms the product's own configuration reference uses for them.
//
// They are phrases rather than sentences so a caller can place one after the
// file it names, which is the order that reads: the reader is told which file
// first and how far it reaches second.
//
// Each is translated as a phrase standing alone, carrying its own article, since
// every sentence that places one sets it off after the file's name.
const MACHINE_WIDE_REACH = l10n.t('the global file shared by every project on this machine');
const PROJECT_REACH = l10n.t('this project\'s own configuration file');

// reachOfDestination says how far the file a destination names reaches.
//
// It is the entry point for a surface that has a reader's choice in hand and no
// answer yet — a confirmation asked before anything runs, or the choice itself.
export function reachOfDestination(destination: ConfigWriteDestination): string {
  return destination === 'global' ? MACHINE_WIDE_REACH : PROJECT_REACH;
}

// reachPhrase says how far the file that was written reaches.
//
// It reads the answer's own derived fact rather than the request's, so a write
// that resolved somewhere other than where it was asked to is described as it
// landed. The words are the ones above, so an operation's ending and the choice
// that preceded it name one file in one set of words.
export function reachPhrase(scope: ConfigWriteScope): string {
  return reachOfDestination(scope.machineWide ? 'global' : 'workspace');
}

// configWriteOverrides composes the two write-target overrides a request carries
// for a chosen destination.
//
// 🔴 IT IS THE ONE MAPPING, AND THAT IS WHAT MAKES THE PAIR SAFE. The compiler
// refuses a request setting both, and a request setting neither takes that
// operation's own default rather than the reader's choice — so exactly one is
// true here, decided by a single value, and neither hazard is reachable from a
// call site.
export function configWriteOverrides(destination: ConfigWriteDestination): {
  global: boolean;
  workspace: boolean;
} {
  return {
    global: destination === 'global',
    workspace: destination === 'workspace',
  };
}

// destinationLabel is how a destination reads as something a reader picks: the
// reach phrase, opened with a capital because it stands on its own line rather
// than after a file name.
//
// Deriving it is the point. A label written out again here would be a second set
// of words for a file the ending already names, and the reader would be choosing
// between two files that are described differently from the ones they are then
// told about.
function destinationLabel(destination: ConfigWriteDestination): string {
  const reach = reachOfDestination(destination);
  return reach.charAt(0).toUpperCase() + reach.slice(1);
}

// CONFIG_WRITE_DESTINATIONS is what a reader chooses between, in the order they
// are offered.
//
// 🔴 THE GLOBAL FILE IS FIRST BECAUSE IT IS THE DEFAULT for the operations that
// offer this choice, and the first entry is the one a reader takes by pressing
// nothing. The order is therefore load-bearing rather than cosmetic: it is how
// "the default is unchanged" is expressed to somebody who does not want to
// choose.
export const CONFIG_WRITE_DESTINATIONS: ReadonlyArray<{
  value: ConfigWriteDestination;
  label: string;
}> = [
  { value: 'global', label: destinationLabel('global') },
  { value: 'workspace', label: destinationLabel('workspace') },
];
