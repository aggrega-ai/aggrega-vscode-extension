// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// What the editor does when a language request — a hover, a completion, a
// definition, or the references or implementations of what is under the cursor —
// is answered "file not validated", decided without an editor.
//
// That answer means the language server holds no parse of the document and is
// producing none: no validation of it has reached the server since the server
// started, the parse was dropped because the file changed on disk, or the last
// validation met a buffer no parser will read. What gives the server a parse is
// a validation, and the editor already sends that request on its own, with
// nothing to confirm, whenever a document opens and whenever typing pauses. So it
// is sent here the same way: the document is validated, the refused request is
// sent again, and the reader is asked nothing.
//
// 🔴 NOTHING STANDS BETWEEN THE REFUSAL AND THE VALIDATION. A question put to the
// reader first would ask leave for a request the editor sends unasked at every
// pause in typing, and the hover or completion behind it would wait on an answer
// the reader might never give.
//
// One of each, and no more. A retry that is refused again is not retried: the
// document may be one no parser will read, which a validation reports on and
// leaves unparsed, so asking again would go round the same refusal. Whatever
// either request meets is handed to failed, and the language request answers
// with nothing.

// CacheMissDeps is everything the recovery reaches outside itself. Each is passed
// in so a test drives it with no editor and no server.
export interface CacheMissDeps<T> {
  // validate sends the language server a validation of the document the refused
  // request was about, composed as every other validation the editor sends is.
  validate(): Promise<unknown>;
  // retry sends the refused request again, with the parameters it was first sent
  // with.
  retry(): Promise<T>;
  // failed is told what a request met when it did not answer.
  failed(err: unknown): void;
}

// recoverFromCacheMiss validates the document, sends the refused request again,
// and answers with what that second request answers — or with null where either
// request failed.
export async function recoverFromCacheMiss<T>(deps: CacheMissDeps<T>): Promise<T | null> {
  try {
    await deps.validate();
    return await deps.retry();
  } catch (err) {
    deps.failed(err);
    return null;
  }
}
