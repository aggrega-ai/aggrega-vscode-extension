// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

// ServerEncoding is the position-encoding the daemon negotiates at
// initialize. UTF-8 wins when both sides offer it; UTF-16 is the LSP
// default fallback when initialize fails or omits the field.
export type ServerEncoding = 'utf-8' | 'utf-16';

// LspPosition is the VS Code / LSP Position shape: 0-based line, then
// 0-based column in UTF-16 code units.
export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

// DaemonPosition is the daemon's Position shape: 0-based line, then
// 0-based column in the encoding negotiated at initialize.
export interface DaemonPosition {
  line: number;
  character: number;
}

export interface DaemonRange {
  start: DaemonPosition;
  end: DaemonPosition;
}

export interface DaemonLocation {
  uri: string;
  range: DaemonRange;
}

// Request param shapes for the aggrega/* methods.
export interface ValidateParams { file: string; content: string; }
export interface InvalidateParams {
  file: string;
  // granularity selects the daemon's cache-eviction scope. When
  // omitted (or set to "workspace"), the daemon drops the workspace-
  // level resolved-catalog cache alongside the per-file parse +
  // diagnostics caches. The "file" value drops only the per-file
  // caches; "entity" is reserved at the daemon and currently falls
  // through to workspace behavior.
  granularity?: 'file' | 'workspace' | 'entity';
}
export interface DiagnosticsParams { file: string; }
export interface ResolveParams { uri: string; position: DaemonPosition; }
export interface FindReferencesParams { uri: string; position: DaemonPosition; }
export interface FindImplementationsParams { uri: string; position: DaemonPosition; }
export interface HoverParams { uri: string; position: DaemonPosition; }
export interface CompletionParams {
  uri: string;
  position: DaemonPosition;
  triggerCharacter?: string;
}

// JSON-RPC 2.0 framing types.
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: JsonRpcError;
}

// JsonRpcNotification is a server-push JSON-RPC 2.0 message — no
// id field, no expected response. The daemon emits
// aggrega/publishDiagnostics as a notification when diagnostic
// state changes. The Daemon class routes these by method via its
// EventEmitter using the convention `notification:<method>`.
export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

// PublishDiagnosticsParams is the params shape carried by the
// aggrega/publishDiagnostics notification. An empty diagnostics
// array signals "clear this file's DiagnosticCollection entry."
export interface PublishDiagnosticsParams {
  file: string;
  diagnostics: DaemonDiagnostic[];
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: ErrorData;
}

// ErrorData mirrors the daemon's errors_data.go errorData struct.
// All fields are optional — partial data is honest. Line and column
// are 1-based per the daemon's LSP-aligned convention; the
// extension converts to VS Code's 0-based positions at the
// surfaceDiagnostic boundary.
//
// Each path-valued field names one artifact and only that artifact, so
// reading one is enough to know what it points at — no branching on the
// error code. file is the source document line and column locate;
// lockfile is a lockfile; release is a Release.
export interface ErrorData {
  // file names the source document the position fields locate — the
  // document being validated, or the Release whose load failed. It
  // never carries a lockfile path; that has its own field.
  file?: string;
  line?: number;
  column?: number;
  // cascade_attempt carries the multi-line cascade trace the daemon
  // populates on release-not-resolved emissions. Mirrors the
  // daemon's errors_data.go field of the same name. Consumed by
  // error-surfaces' release-not-resolved handler for the
  // OutputChannel auto-log. Other emission sites leave this empty.
  cascade_attempt?: string;
  // end_line and end_column carry the 1-based end position of the
  // source token, mirroring the daemon's errors_data.go fields. When
  // present alongside line and column, surfaceDiagnostic renders a
  // range spanning the whole token; absent, it falls back to a
  // point-style range at the start position.
  end_line?: number;
  end_column?: number;
  // release names the Release the error refers to, spelled the way the
  // request named it — the same value the `--release` flag takes. The
  // daemon populates it on the lockfile-absent emission so a client can
  // compose the remediating command without parsing it back out of
  // message. Consumed by error-surfaces' lockfile-absent handler.
  // Optional: an emission path that has no Release in hand omits it.
  release?: string;
  // lockfile names the lockfile a lockfile-scoped failure is about —
  // the path the daemon looked for and did not find, or could not
  // stat. Mirrors the daemon's errors_data.go field of the same name.
  // Optional: an emission path that is not about a lockfile omits it.
  lockfile?: string;
}

// Daemon application error codes (see internal/serve/errors.go).
export const ERR_FILE_NOT_VALIDATED = 1001;
export const ERR_RELEASE_NOT_RESOLVED = 1002;
export const ERR_LOCKFILE_ABSENT = 1003;
export const ERR_ENTITY_NOT_RESOLVABLE = 1004;
export const ERR_SHUTTING_DOWN = 1005;

// ServerInitMetadata is the subset of the aggrega/initialize
// response that the extension surfaces in the status bar. Populated
// when the handshake completes; null until then.
//
// workspaceMarker names the marker tier that anchored the workspace
// root: "config" | "directory" | "aggregate-glob" | "release-glob" |
// "manifest-glob". Optional: daemons anchored via --workspace-root
// omit it (no marker was consulted in that path). Extensions reading
// it must tolerate undefined.
export interface ServerInitMetadata {
  workspaceRoot: string;
  configSource: string;
  workspaceMarker?: string;
}

// DaemonDiagnostic mirrors the daemon's per-file Diagnostic wire
// shape from aggrega/validate and aggrega/diagnostics. Line and
// column are 1-based per the daemon's LSP-aligned convention;
// severity is one of "error" | "warning" | "info".
export interface DaemonDiagnostic {
  line: number;
  column: number;
  severity: string;
  message: string;
  // end_line and end_column carry the 1-based end position of the
  // token the diagnostic spans, mirroring the daemon's Diagnostic wire
  // struct. When present, shapeForDaemonDiagnostic produces a range
  // spanning the token; absent, it falls back to a point-style range.
  end_line?: number;
  end_column?: number;
}

// ValidateResponse is the body the daemon returns for
// aggrega/validate — diagnostics are returned directly in the
// response, so no separate aggrega/diagnostics poll is needed for
// the publish path.
export interface ValidateResponse {
  diagnostics: DaemonDiagnostic[];
}

// ReleaseCandidatesResponse is the aggrega/releaseCandidates result: the
// absolute paths of the workspace's Release-kind documents, determined by the
// daemon by content (`kind: Release`). The extension delegates Release
// detection to the daemon rather than scanning by filename, so the IDE's
// candidate set matches what the daemon resolves.
export interface ReleaseCandidatesResponse {
  releases: string[];
}
