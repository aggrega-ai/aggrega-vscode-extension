// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

// What the runner and the probe must agree on, in one place both of them load.
// It holds no editor type, so the runner can load it outside the editor.

// PROBE_PORT_ENV names the environment variable that carries the probe's loopback
// port into the editor, and from there into its extension host.
export const PROBE_PORT_ENV = 'AGGREGA_EDITOR_SUITE_PROBE_PORT';
