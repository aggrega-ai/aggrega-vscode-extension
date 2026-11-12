// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

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

// RefusalCondition is the condition a refusal names, as the two identifiers the
// language server carries for it in the refusal's data: code, the descriptive
// name a client branches on, and shortCode, the one a reader quotes. A key is
// present only where the refusal carried it.
export interface RefusalCondition {
  code?: string;
  shortCode?: string;
}

// refusalCondition reads the condition a thrown value names, and it is the one
// place the extension reads it.
//
// 🔴 IT READS THE FIELDS AND NEVER THE MESSAGE. The short code a refusal's
// message opens with is for the person reading it, and the sentence after it is
// the compiler's and may be reworded; a message that merely opens with something
// shaped like a short code names no condition here. A value that is not a
// language-server refusal, and a refusal whose data carries neither field, name
// none, so the answer is empty and every caller reads it as it read such a
// refusal before the fields existed.
export function refusalCondition(err: unknown): RefusalCondition {
  const named: RefusalCondition = {};
  if (!isJsonRpcError(err)) {
    return named;
  }
  const { code, shortCode } = err.data ?? {};
  if (typeof code === 'string' && code !== '') {
    named.code = code;
  }
  if (typeof shortCode === 'string' && shortCode !== '') {
    named.shortCode = shortCode;
  }
  return named;
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
