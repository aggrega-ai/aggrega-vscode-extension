// Pure helper that extracts the daemon's aggrega/initialize response
// shape into the extension's ServerInitMetadata type. Kept here (not
// inline in daemon.ts) so the parsing logic is unit-testable without
// spawning a subprocess — daemon.ts re-exports it via import.

import { ServerInitMetadata } from './types';

// extractServerInitMetadata reads workspaceRoot, configSource, and
// the optional workspaceMarker and version from an aggrega/initialize result.
// Returns null when either of the two required fields is missing or
// malformed — in which case the extension's status bar stays hidden
// until a future daemon upgrade. workspaceMarker is best-effort:
// daemons anchored via --workspace-root omit it; the field stays undefined.
//
// version is best-effort in the same way: a server whose answer carries no
// version, or an empty one, leaves the field undefined, and the welcome page
// then says the running server reported none rather than naming one it did not
// give.
export function extractServerInitMetadata(result: unknown): ServerInitMetadata | null {
  if (!result || typeof result !== 'object') {
    return null;
  }
  const workspaceRoot = (result as { workspaceRoot?: unknown }).workspaceRoot;
  const configSource = (result as { configSource?: unknown }).configSource;
  const workspaceMarker = (result as { workspaceMarker?: unknown }).workspaceMarker;
  const version = (result as { version?: unknown }).version;
  if (typeof workspaceRoot !== 'string' || workspaceRoot === '') {
    return null;
  }
  if (typeof configSource !== 'string' || configSource === '') {
    return null;
  }
  const out: ServerInitMetadata = { workspaceRoot, configSource };
  if (typeof workspaceMarker === 'string' && workspaceMarker !== '') {
    out.workspaceMarker = workspaceMarker;
  }
  if (typeof version === 'string' && version !== '') {
    out.version = version;
  }
  return out;
}
