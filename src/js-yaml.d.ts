// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// The one call this extension makes into js-yaml, declared here because the
// package ships no type declarations of its own.
//
// It is deliberately the call this extension makes and nothing more. A
// declaration of the rest of the package would be a second description of an
// API nothing here uses, and nothing would ever check that description against
// the package it describes.
declare module 'js-yaml' {
  // loadAll parses every document in the stream and answers with them in
  // stream order. It throws when any document in the stream does not parse.
  export function loadAll(input: string): unknown[];
}
