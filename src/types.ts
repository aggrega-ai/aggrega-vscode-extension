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

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
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
export interface ServerInitMetadata {
  workspaceRoot: string;
  configSource: string;
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
}

// ValidateResponse is the body the daemon returns for
// aggrega/validate — diagnostics are returned directly in the
// response, so no separate aggrega/diagnostics poll is needed for
// the publish path.
export interface ValidateResponse {
  diagnostics: DaemonDiagnostic[];
}
