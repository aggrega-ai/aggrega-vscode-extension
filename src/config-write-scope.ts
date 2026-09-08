// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// This module is the one home of "how far did a configuration write reach".
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

// ConfigWriteScope is how far a configuration write reached.
//
// machineWide is the fact a reader most needs and has no other way to get. It is
// derived from the file the write actually resolved to rather than from the
// request, so it cannot describe a machine-wide change as a local one.
export interface ConfigWriteScope {
  configFile: string;
  machineWide: boolean;
  workspaceRoot: string;
}

// reachPhrase says how far the file that was written reaches, in the words the
// product's own configuration reference uses for the two files.
//
// It is a phrase rather than a sentence so a caller can place it after the file
// it names, which is the order that reads: the reader is told which file first
// and how far it reaches second.
export function reachPhrase(scope: ConfigWriteScope): string {
  return scope.machineWide
    ? 'the global file shared by every project on this machine'
    : 'this project\'s own configuration file';
}
