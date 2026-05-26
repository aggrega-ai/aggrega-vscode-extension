// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import {
  CompletionParams,
  DaemonLocation,
  DaemonPosition,
  FindImplementationsParams,
  FindReferencesParams,
  HoverParams,
  LspLocation,
  LspPosition,
  LspRange,
  ResolveParams,
  ServerEncoding,
} from './types';

// convertPosition converts an LspPosition (UTF-16 column) to a
// DaemonPosition in the daemon's negotiated encoding. UTF-16 → UTF-16
// is identity; UTF-16 → UTF-8 walks the line's text and counts bytes
// up to the LSP character offset.
//
// documentContent is the full text of the document the position
// refers to. line numbers in lspPosition index lines of that content
// after splitting on \n.
export function convertPosition(
  documentContent: string,
  lspPosition: LspPosition,
  from: ServerEncoding,
  to: ServerEncoding,
): DaemonPosition {
  if (from === to) {
    return { line: lspPosition.line, character: lspPosition.character };
  }
  const lines = documentContent.split('\n');
  const line = lines[lspPosition.line] ?? '';
  if (from === 'utf-16' && to === 'utf-8') {
    return { line: lspPosition.line, character: utf16OffsetToUtf8(line, lspPosition.character) };
  }
  if (from === 'utf-8' && to === 'utf-16') {
    return { line: lspPosition.line, character: utf8OffsetToUtf16(line, lspPosition.character) };
  }
  return { line: lspPosition.line, character: lspPosition.character };
}

// utf16OffsetToUtf8 returns the UTF-8 byte offset that corresponds to
// the given UTF-16 code-unit offset in line. A code point outside the
// BMP occupies 2 UTF-16 code units and 4 UTF-8 bytes; ASCII occupies
// 1 of each.
function utf16OffsetToUtf8(line: string, utf16Offset: number): number {
  let utf16 = 0;
  let utf8 = 0;
  for (const ch of line) {
    if (utf16 >= utf16Offset) {
      break;
    }
    const cp = ch.codePointAt(0)!;
    utf16 += cp > 0xffff ? 2 : 1;
    utf8 += utf8ByteLen(cp);
  }
  return utf8;
}

// utf8OffsetToUtf16 returns the UTF-16 code-unit offset that
// corresponds to the given UTF-8 byte offset in line.
function utf8OffsetToUtf16(line: string, utf8Offset: number): number {
  let utf16 = 0;
  let utf8 = 0;
  for (const ch of line) {
    if (utf8 >= utf8Offset) {
      break;
    }
    const cp = ch.codePointAt(0)!;
    utf8 += utf8ByteLen(cp);
    utf16 += cp > 0xffff ? 2 : 1;
  }
  return utf16;
}

function utf8ByteLen(cp: number): number {
  if (cp < 0x80) { return 1; }
  if (cp < 0x800) { return 2; }
  if (cp < 0x10000) { return 3; }
  return 4;
}

export function lspDefinitionToResolve(
  uri: string,
  lspPosition: LspPosition,
  documentContent: string,
  serverEncoding: ServerEncoding,
): ResolveParams {
  return { uri, position: convertPosition(documentContent, lspPosition, 'utf-16', serverEncoding) };
}

export function lspReferencesToFindReferences(
  uri: string,
  lspPosition: LspPosition,
  documentContent: string,
  serverEncoding: ServerEncoding,
): FindReferencesParams {
  return { uri, position: convertPosition(documentContent, lspPosition, 'utf-16', serverEncoding) };
}

export function lspImplementationToFindImplementations(
  uri: string,
  lspPosition: LspPosition,
  documentContent: string,
  serverEncoding: ServerEncoding,
): FindImplementationsParams {
  return { uri, position: convertPosition(documentContent, lspPosition, 'utf-16', serverEncoding) };
}

export function lspHoverToHover(
  uri: string,
  lspPosition: LspPosition,
  documentContent: string,
  serverEncoding: ServerEncoding,
): HoverParams {
  return { uri, position: convertPosition(documentContent, lspPosition, 'utf-16', serverEncoding) };
}

export function lspCompletionToCompletion(
  uri: string,
  lspPosition: LspPosition,
  documentContent: string,
  serverEncoding: ServerEncoding,
  triggerCharacter?: string,
): CompletionParams {
  const params: CompletionParams = {
    uri,
    position: convertPosition(documentContent, lspPosition, 'utf-16', serverEncoding),
  };
  if (triggerCharacter !== undefined) {
    params.triggerCharacter = triggerCharacter;
  }
  return params;
}

// locationToLspLocation converts a daemon-encoded Location back to
// VS Code's UTF-16 Location. When the target document's encoding
// matches LSP's UTF-16 (the initialize-fallback case where no
// position encoding is negotiated), the conversion is identity and
// targetDocumentContent may be the empty string.
export function locationToLspLocation(
  loc: DaemonLocation,
  targetDocumentContent: string,
  serverEncoding: ServerEncoding,
): LspLocation {
  return {
    uri: loc.uri,
    range: convertRange(loc.range, targetDocumentContent, serverEncoding),
  };
}

function convertRange(
  range: { start: DaemonPosition; end: DaemonPosition },
  documentContent: string,
  serverEncoding: ServerEncoding,
): LspRange {
  return {
    start: daemonToLspPosition(range.start, documentContent, serverEncoding),
    end: daemonToLspPosition(range.end, documentContent, serverEncoding),
  };
}

function daemonToLspPosition(
  pos: DaemonPosition,
  documentContent: string,
  serverEncoding: ServerEncoding,
): LspPosition {
  return convertPosition(documentContent, pos, serverEncoding, 'utf-16');
}
