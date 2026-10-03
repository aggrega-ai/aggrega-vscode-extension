// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import { inReleaseTerms } from './release-terms';
import { ValidateParams } from './types';

// buildValidateParams composes the aggrega/validate request for one document
// against the editor's selected Release.
//
// It is the single home for that request, so every validation the editor
// performs — document open, debounced change, the startup sweep, the sweep that
// follows a move of the selection, the on-demand action, and the re-seed after a
// cache miss — sends the same request. A site that composed its own could send
// the narrower one without anything reporting it. The Release is put on it by the
// composition every request answered in a Release's terms goes through.
//
// Carrying the Release is what makes the answer the full one. A request naming
// none is answered from the document alone — whether it parses, and whether its
// own shape is admissible — and every check that needs a Release is skipped.
// That answer is well-formed and its diagnostic list is merely shorter, so
// omitting the field shows the reader fewer findings than the compiler has with
// nothing on screen saying so.
//
// The field is omitted only when nothing is selected, which is the honest
// request for a workspace that holds no Release to name. It is never sent
// empty: an empty value states a coordinate the workspace does not hold.
export function buildValidateParams(
  file: string,
  content: string,
  selectedRelease: string | null,
): ValidateParams {
  return inReleaseTerms({ file, content }, selectedRelease);
}
