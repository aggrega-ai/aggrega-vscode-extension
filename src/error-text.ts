// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import type { JsonRpcError } from './types';

// This module renders a thrown value as the line a reader is shown. It imports
// nothing at runtime, so every surface that reports a failure can reach it —
// the language-server client included, which most of the extension depends on
// and which therefore cannot depend back on most of it.

// isJsonRpcError narrows a thrown value to the daemon's error shape. A numeric
// code is the discriminator: the language-server transport always carries one,
// and nothing else the extension throws does.
export function isJsonRpcError(v: unknown): v is JsonRpcError {
  return !!v && typeof v === 'object' && typeof (v as JsonRpcError).code === 'number';
}

// REFUSAL_WITHOUT_WORDS is the line for a refusal the language server answered
// with no message, which is the one case where there are no words of its own to
// carry.
export const REFUSAL_WITHOUT_WORDS = 'the language server refused the request without saying why';

// describeError renders any thrown value as one line for a reader.
//
// It is the single home for that conversion across the extension, so a failure
// reaching the reader through the language server and one reaching it through a
// CLI subprocess are worded by the same rule. The daemon branch is the only
// special case, and it is additive: a value carrying no numeric code — every
// CLI failure — falls through to the plain reading, so a caller that will never
// see a transport error loses nothing by going through here.
//
// The message is the thrown value's own text, never a re-wording of it: where
// the failure came from the compiler, that text is the compiler's, and the
// remediation it already names is what the reader needs.
//
// 🔴 A REFUSAL'S NUMERIC CODE IS NOT PART OF THE LINE. It is how the transport
// tells one kind of refusal from another, and the extension reads it to decide
// which surface a refusal belongs on; a reader can do nothing with it, so the
// line is the compiler's words alone.
export function describeError(err: unknown): string {
  if (isJsonRpcError(err)) {
    return err.message || REFUSAL_WITHOUT_WORDS;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
