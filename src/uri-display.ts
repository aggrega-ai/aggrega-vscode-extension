// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

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
