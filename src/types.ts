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
export interface InvalidateParams { file: string; }
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

// Daemon application error codes (see internal/serve/dispatch.go).
export const ERR_FILE_NOT_VALIDATED = 1001;
export const ERR_RELEASE_NOT_RESOLVED = 1002;
export const ERR_LOCKFILE_ABSENT = 1003;
export const ERR_ENTITY_NOT_RESOLVABLE = 1004;
