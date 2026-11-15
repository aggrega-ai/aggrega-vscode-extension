// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

// selectorValuesIn reads the value each selector row draws, in the order the
// rows are drawn, out of the Commands panel's composed markup — a whole document
// or a body alike, since both draw the rows the same way.
export function selectorValuesIn(markup: string): string[] {
  return Array.from(markup.matchAll(/<span class="selector-value">([^<]*)<\/span>/g)).map((m) => m[1]);
}
