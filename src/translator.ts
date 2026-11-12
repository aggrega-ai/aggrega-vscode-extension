// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import { inReleaseTerms } from './release-terms';
import {
  CompletionParams,
  CompletionResponse,
  DaemonCompletionItem,
  DaemonLocation,
  DaemonPosition,
  FindImplementationsParams,
  FindImplementationsResponse,
  FindReferencesParams,
  FindReferencesResponse,
  HoverParams,
  HoverResponse,
  LspLocation,
  LspPosition,
  LspRange,
  MarkupContent,
  ResolveParams,
  ResolveResponse,
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

// The cursor requests below — go-to-definition, references, implementations,
// hover and completion — are each answered in a Release's terms: the entity a
// reference resolves to, and the names a reference may take, are the selected
// Release's where the workspace gives its Releases catalog directories of their
// own. So each takes the selected Release, required rather than optional, so a
// caller that forgot it fails to compile instead of asking about the whole
// workspace; and each puts it on the request through the one composition every
// such request goes through.

export function lspDefinitionToResolve(
  uri: string,
  lspPosition: LspPosition,
  documentContent: string,
  serverEncoding: ServerEncoding,
  selectedRelease: string | null,
): ResolveParams {
  return inReleaseTerms({ uri, position: convertPosition(documentContent, lspPosition, 'utf-16', serverEncoding) }, selectedRelease);
}

export function lspReferencesToFindReferences(
  uri: string,
  lspPosition: LspPosition,
  documentContent: string,
  serverEncoding: ServerEncoding,
  selectedRelease: string | null,
): FindReferencesParams {
  return inReleaseTerms({ uri, position: convertPosition(documentContent, lspPosition, 'utf-16', serverEncoding) }, selectedRelease);
}

export function lspImplementationToFindImplementations(
  uri: string,
  lspPosition: LspPosition,
  documentContent: string,
  serverEncoding: ServerEncoding,
  selectedRelease: string | null,
): FindImplementationsParams {
  return inReleaseTerms({ uri, position: convertPosition(documentContent, lspPosition, 'utf-16', serverEncoding) }, selectedRelease);
}

export function lspHoverToHover(
  uri: string,
  lspPosition: LspPosition,
  documentContent: string,
  serverEncoding: ServerEncoding,
  selectedRelease: string | null,
): HoverParams {
  return inReleaseTerms({ uri, position: convertPosition(documentContent, lspPosition, 'utf-16', serverEncoding) }, selectedRelease);
}

// HoverMarkup is a hover's text in one of the two markups the protocol names:
// markdown, which is rendered, and plaintext, which is shown as text with
// nothing in it read as markdown.
export type HoverMarkup = MarkupContent & { kind: 'markdown' | 'plaintext' };

// hoverResponseToMarkup reads an aggrega/hover answer into the text a hover
// shows, or undefined where it shows none: no answer, a null contents, a value
// that is empty or only whitespace, and contents in any shape other than a
// MarkupContent in one of those two markups.
//
// A markup this reader does not know is shown as nothing rather than as one of
// the two it does: text rendered in a markup it was not written in shows the
// reader something other than what the compiler wrote, and nothing on the
// screen says so.
export function hoverResponseToMarkup(answer: HoverResponse | null): HoverMarkup | undefined {
  const contents = answer?.contents;
  if (contents === null || typeof contents !== 'object' || Array.isArray(contents)) {
    return undefined;
  }
  const { kind, value } = contents as { [K in keyof MarkupContent]?: unknown };
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  if (kind === 'markdown' || kind === 'plaintext') {
    return { kind, value };
  }
  return undefined;
}

// lspCompletionToCompletion composes the completion request.
//
// The trigger character travels inside the request's context member, which is
// where the compiler reads it from — the protocol's own CompletionContext
// shape, carried rather than flattened. A trigger character placed beside the
// position instead reaches the compiler as a key it does not read, so the
// narrowing it exists to drive simply never happens and nothing reports that.
//
// triggerKind is the protocol's own: 2 says this completion was raised by a
// character the reader typed, which is the only case that carries one here.
export function lspCompletionToCompletion(
  uri: string,
  lspPosition: LspPosition,
  documentContent: string,
  serverEncoding: ServerEncoding,
  selectedRelease: string | null,
  triggerCharacter?: string,
): CompletionParams {
  const params: CompletionParams = {
    uri,
    position: convertPosition(documentContent, lspPosition, 'utf-16', serverEncoding),
  };
  if (triggerCharacter !== undefined) {
    params.context = { triggerKind: COMPLETION_TRIGGERED_BY_CHARACTER, triggerCharacter };
  }
  return inReleaseTerms(params, selectedRelease);
}

// COMPLETION_TRIGGERED_BY_CHARACTER is the protocol's triggerKind for a
// completion raised by a character the reader typed, as against one invoked
// outright or re-raised over an incomplete list.
const COMPLETION_TRIGGERED_BY_CHARACTER = 2;

// CompletionOffer is one entry of the completion list, in the members of the
// compiler's item that the list shows: the text written, the value it is
// ordered by where that differs from the text, and the short qualifier shown
// beside it.
export type CompletionOffer = Pick<DaemonCompletionItem, 'label' | 'sortText' | 'detail'>;

// completionResponseToOffers reads an aggrega/completion answer into the
// entries the completion list offers, one per item and in the order the items
// arrive. No answer, and an answer whose items is null, both read as nothing to
// offer, the same as an empty list: the published shape admits null there, and
// a reader that took the list as always present would throw on it.
//
// A sortText or detail that is empty is not carried, so an entry is ordered by
// its label and shows no qualifier. An item's kind and documentation are not
// carried either: nothing the list shows is drawn from them.
export function completionResponseToOffers(answer: CompletionResponse | null): CompletionOffer[] {
  return (answer?.items ?? []).map(({ label, sortText, detail }) => {
    const offer: CompletionOffer = { label };
    if (sortText) { offer.sortText = sortText; }
    if (detail) { offer.detail = detail; }
    return offer;
  });
}

// resolvedLocations reads the aggrega/resolve answer into the locations it
// names: the one under location, or none where it is null or in a shape that is
// not a location. The answer is an object carrying the location, never the
// location itself, so reading the answer as one finds no range to convert.
export function resolvedLocations(answer: ResolveResponse | null): DaemonLocation[] {
  const location = answer?.location;
  return isDaemonLocation(location) ? [location] : [];
}

// listedLocations reads an aggrega/findReferences or aggrega/findImplementations
// answer into the locations it lists, none where it lists null.
export function listedLocations(answer: FindReferencesResponse | FindImplementationsResponse | null): DaemonLocation[] {
  return (answer?.locations ?? []).filter(isDaemonLocation);
}

function isDaemonPosition(v: unknown): boolean {
  const p = v as { line?: unknown; character?: unknown } | null;
  return typeof p === 'object' && p !== null && typeof p.line === 'number' && typeof p.character === 'number';
}

function isDaemonLocation(v: unknown): v is DaemonLocation {
  const l = v as { uri?: unknown; range?: { start?: unknown; end?: unknown } | null } | null;
  return typeof l === 'object' && l !== null && typeof l.uri === 'string'
    && typeof l.range === 'object' && l.range !== null && isDaemonPosition(l.range.start) && isDaemonPosition(l.range.end);
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
