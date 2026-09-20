// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as path from 'path';

// distinguishingLabel names one location among others, adding its parent's name
// only when the name alone would be ambiguous.
//
// A reader choosing between locations scans the trailing segment, so that is
// what is shown — until two of the locations on offer end in the same segment,
// at which point the shortest thing that tells them apart is the segment above.
// Adding the parent unconditionally would put a longer label in front of every
// reader to serve the case that is not theirs.
//
// 🔴 IT HAS ONE HOME BECAUSE THREE SURFACES OFFER A LIST OF LOCATIONS. The
// chooser for the folder the editor works in, the chooser for the Aggrega
// workspace, and the indicator naming the workspace in force all label a
// location among its siblings, and a reader meeting one list after another must
// not find the same place named two different ways. Three copies of the rule
// would agree on the day they were written.
//
// `among` is the whole set the label is being read against, including the
// target itself; a set that omitted it could not tell whether anything collides.
export function distinguishingLabel(target: string, among: readonly string[]): string {
  const name = path.basename(target);
  const collides = among.filter((other) => path.basename(other) === name).length > 1;
  return collides ? `${name} (${path.basename(path.dirname(target))})` : name;
}

// shortUri renders a URI's trailing segment, which is the part a reader scans.
//
// It has one home because two surfaces need the same reading: the plugins tree
// labels a plugin by it, and the published-catalog list falls back to it for a
// record whose name the index did not carry. Two copies of one display rule
// would agree today and part company the first time either is adjusted.
//
// The scheme is dropped and the last non-empty path segment returned, so
// `governance/cel` reads as `cel` and
// `oci://hub.aggrega.ai/plugin/cli/example:1.0.0` reads as `example:1.0.0` —
// the version pin travels with the segment because it is part of the identity a
// reader is comparing. A URI with no segment at all is returned unchanged
// rather than reduced to nothing.
export function shortUri(uri: string): string {
  const noScheme = uri.replace(/^[a-z]+:\/\//i, '');
  const parts = noScheme.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : uri;
}
