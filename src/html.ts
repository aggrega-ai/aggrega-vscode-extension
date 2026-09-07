// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// The extension draws two of its own documents — the welcome tab and the
// Operations panel — and both need the same two pieces to compose one: a way to
// render authored text as text, and a token for the content policy's script
// allowlist. Each has one home here rather than one per document: two copies
// would agree until the day either was changed, and the symptom of a
// disagreement is markup reaching a document, or a policy admitting a script,
// rather than a failing assertion.
//
// This module holds no editor type, so both documents stay assertable without an
// extension host.

// escapeHtml renders arbitrary text as text.
//
// It runs before any inline marker is interpreted, which is the ordering that
// makes composed content unable to introduce markup of its own however it is
// later edited.
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// makeNonce returns a random token for a content policy's script allowlist.
//
// Math.random is sufficient for it — the nonce is not a security boundary on its
// own; the policy's source restriction and the local-only resource root are.
export function makeNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
