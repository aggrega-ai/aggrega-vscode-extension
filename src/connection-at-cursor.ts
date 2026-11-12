// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

import type * as wire from '@aggrega-ai/aggrega-abi/dist/servewire_gen';
import {
  ConnectionAddress,
  ConnectionDocument,
  ConnectionSite,
  attachRefusal,
} from './attachment-edit';
import { convertPosition } from './translator';
import { LspPosition, ServerEncoding } from './types';
import { CatalogIndexDoc } from './workspace-catalog-run';

// The document-free half of attaching a Feature to the connection at the
// cursor: the question asked about the cursor, the reading of its answer, the
// sentence for a cursor on no connection, the selection the graph panel is asked
// to make and the rule an attach from that selection is written by, and which
// documents the command is offered in.
//
// It opens no document and calls no editor API, so each of those decisions can
// be driven on its own; graph-view.ts binds them to the editor, the panel and
// the language server.
//
// WHICH CONNECTION IS WRITTEN AT A POSITION IS THE COMPILER'S ANSWER. The
// compiled graph records where each entry an attachment is written in was
// authored, so the question names a document, a position and the Release whose
// graph is consulted, and the answer names the graph node and the connection —
// or why there is none. Nothing here reads the document's structure: a key's
// name does not say whether it is a connection, and a reading made here would be
// a second answer to a question the compiler already answers.

// ATTACH_TO_CONNECTION_AT_CURSOR_COMMAND is the command that offers the attach
// from a connection's entry in a document.
export const ATTACH_TO_CONNECTION_AT_CURSOR_COMMAND = 'aggrega.graph.attachToConnectionAtCursor';

// CONNECTION_DOCUMENTS_CONTEXT_KEY is the editor condition naming the documents
// that command is offered in: each document the workspace reads as an Aggregate
// or a Release, by its path. The manifest offers the command where the active
// document's path is one of them.
export const CONNECTION_DOCUMENTS_CONTEXT_KEY = 'aggrega.connectionDocuments';

// The two kinds a connection's entry is written in, as an author writes them on
// a document's kind and as the entity index reports them.
const AGGREGATE_KIND = 'Aggregate';
const RELEASE_KIND = 'Release';

// connectionDocumentFiles is the one decision of which documents the command is
// offered in, read off the entity index: the file of every entity the index
// reports as an Aggregate or a Release, workspace-relative and each once, in the
// order the index names them.
//
// An entity resolved from a configured catalog directory reports no file — the
// only path it has names a place on the machine the language server runs on —
// so it names no document a reader could have open in this workspace, and none
// is offered for it.
export function connectionDocumentFiles(doc: CatalogIndexDoc): string[] {
  const files: string[] = [];
  for (const entity of doc.entities ?? []) {
    if (entity.kind !== AGGREGATE_KIND && entity.kind !== RELEASE_KIND) { continue; }
    if (!entity.file || files.includes(entity.file)) { continue; }
    files.push(entity.file);
  }
  return files;
}

// ConnectionAtPositionRequest is the question asked about the cursor: the
// document it is in, workspace-relative, the position in the units the session
// settled on, and the Release whose compiled graph records the connections.
//
// The Release is required for a position in an Aggregate as well, because a
// graph node and a connection exist only on a compiled graph — the same
// coordinate the questions about what may fill a connection's slots and where
// an attachment on it belongs are asked with.
export type ConnectionAtPositionRequest = Required<
  Pick<wire.ConnectionAtPositionParams, 'file' | 'position' | 'release'>
>;

// connectionAtPositionRequest composes that question from the document's text,
// the cursor as the editor measures it, and the units the session settled on.
//
// The conversion is the extension's existing one, the only place either
// direction is implemented: a second one here would agree on every document
// whose text the two encodings measure alike, which is every document until one
// carries text outside that range.
export function connectionAtPositionRequest(
  file: string,
  documentContent: string,
  cursor: LspPosition,
  encoding: ServerEncoding,
  release: string,
): ConnectionAtPositionRequest {
  return { file, position: convertPosition(documentContent, cursor, 'utf-16', encoding), release };
}

// DocumentSelection is the connection an answer named: the node whose component
// draws it, its socket and its alias, and the document the position was read
// in, which is the document an attachment made from that entry is written in.
export interface DocumentSelection extends ConnectionAddress {
  source: string;
  document: ConnectionDocument;
}

// ConnectionAtCursor is the answer as this side reads it: the connection at the
// cursor, or the reason there is none. The reason is the answer's own field; the
// connection is read into the selection this side keeps of it, which names its
// node as a drawn connection's is named.
export type ConnectionAtCursor =
  | { readonly selection: DocumentSelection }
  | Readonly<Required<Pick<wire.ConnectionAtPositionResult, 'noConnectionReason'>>>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function name(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// readConnectionAtPosition reads the answer, or reports that it arrived in a
// shape this side cannot act on.
//
// Exactly one half is read. A connection is read only whole — a node, a socket,
// an alias and one of the two documents — because each names where an edit
// would land, and a part completed with a default would write into a connection
// nobody named. A reason is read as it arrived, worded or not, since the
// sentence for it is chosen elsewhere and a reason with no sentence of its own
// still says there is no connection here. An answer carrying both halves, or
// neither, is not read as either.
export function readConnectionAtPosition(value: unknown): ConnectionAtCursor | null {
  if (!isPlainObject(value)) { return null; }
  const hasConnection = value.graphNode !== undefined || value.connection !== undefined;
  const hasReason = value.noConnectionReason !== undefined;
  if (hasConnection === hasReason) { return null; }
  if (hasReason) {
    return typeof value.noConnectionReason === 'string'
      ? { noConnectionReason: value.noConnectionReason }
      : null;
  }
  const source = name(value.graphNode);
  const connection = value.connection;
  if (!source || !isPlainObject(connection)) { return null; }
  const socket = name(connection.socket);
  const alias = name(connection.alias);
  const document = connection.document;
  if (!socket || !alias || (document !== 'aggregate' && document !== 'release')) { return null; }
  return { selection: { source, socket, alias, document } };
}

// UNREADABLE_ANSWER is what is said for an answer in a shape this side cannot
// act on, in the words the attach's other unreadable answers are reported in.
export const UNREADABLE_ANSWER = attachRefusal(
  'the compiler\'s answer about the connection at the cursor is in a shape this cannot read.',
);

// The reasons the answer gives for a cursor on no connection. These are wire
// values, matched but never shown; the set is the answer's own, and closed.
const NO_CONNECTION_ENTRY = 'no-connection-entry';
const FEATURE_CREATED_CONNECTION = 'feature-created-connection';
const UNKNOWN_CONNECTION = 'unknown-connection';

// noConnectionSentence is the sentence shown for a cursor on no connection,
// worded from the reason the answer gives.
//
// A connection a Feature drew is said in the sentence the graph panel says the
// same fact in, which is the shared candidate projection's and is handed in, so
// the two surfaces cannot come to word one fact two ways. A reason this side has
// no wording for, or none at all, claims nothing beyond that nothing may be
// attached at the cursor: naming a cause the answer did not give would be a
// guess.
export function noConnectionSentence(reason: string, noSlotNote: (reason: string) => string): string {
  if (reason === NO_CONNECTION_ENTRY) {
    return 'The cursor is not inside a connection\'s entry — the entry a component draws a '
      + 'connection with, under its alias, or the entry a Release writes for one — so nothing '
      + 'may be attached here.';
  }
  if (reason === FEATURE_CREATED_CONNECTION) {
    return noSlotNote(FEATURE_CREATED_CONNECTION);
  }
  if (reason === UNKNOWN_CONNECTION) {
    return 'The entry at the cursor is one the Release writes for a connection its compiled '
      + 'graph does not carry, so nothing may be attached here.';
  }
  return 'Nothing may be attached at the cursor.';
}

// CANDIDATES_MODEL_PATH is where the shared candidate projection sits relative
// to the extension's own root. It ships in the package, as the view loads it.
const CANDIDATES_MODEL_PATH = ['media', 'candidates-model.js'];

// loadNoSlotNote evaluates the shipped candidate projection, as the view
// evaluates it — a script in a context of its own — and returns its sentence
// for a connection no slot may be filled on. What runs is the file that ships,
// not a copy of its words.
//
// It throws when the file is missing or defines no such sentence.
export function loadNoSlotNote(extensionRoot: string): (reason: string) => string {
  const file = path.join(extensionRoot, ...CANDIDATES_MODEL_PATH);
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox as vm.Context, { filename: file });
  const model = sandbox.AggregaCandidates as { noSlotNote?: unknown } | undefined;
  const noSlotNote = model?.noSlotNote;
  if (typeof noSlotNote !== 'function') {
    throw new Error(`${file} defines no candidate projection`);
  }
  return (reason: string) => String(noSlotNote(reason));
}

// SelectConnectionMessage asks the graph panel to select one connection once
// the drawing it was sent with has landed.
//
// It names the connection as the panel names it — the node whose component
// draws it, its socket and its alias — and carries the id the selection was
// minted under, which the panel echoes on an attach made from it and on no
// other. It names no document: the panel says an attach from that selection is
// written on the entry the command was run in, and which document that is stays
// on this side, looked up by the id.
export interface SelectConnectionMessage {
  type: 'selectConnection';
  selection: number;
  nodeId: string;
  connection: ConnectionAddress;
}

// selectConnectionMessage composes that message.
export function selectConnectionMessage(id: number, selection: DocumentSelection): SelectConnectionMessage {
  return {
    type: 'selectConnection',
    selection: id,
    nodeId: selection.source,
    connection: { socket: selection.socket, alias: selection.alias },
  };
}

// DocumentSelections is what the side holding the graph keeps of the selection
// it asked the panel to make: the id it was minted under and the connection and
// document the answer named.
//
// 🔴 A DOCUMENT IS NEVER TAKEN FROM THE VIEW. The panel is told an id and echoes
// it; which document that id writes into is looked up here, in what this side
// itself posted, and only for the very connection the id was minted for. So a
// message naming an id this side holds no record of, an id minted for another
// connection, or no id at all is an attach to a pressed edge, written by the
// panel's own rule: in the document that drew the connection.
export interface DocumentSelections {
  // mint records the selection the panel is about to be asked for and returns
  // its id. It replaces the one before: the panel shows one subject at a time,
  // so only the newest selection can be the one it is showing.
  mint(selection: DocumentSelection): number;
  // named is the selection an id was minted for, while it is the newest.
  named(id: number | undefined): DocumentSelection | undefined;
  // siteFor is the site an attach to one drawn connection is written by: the
  // drawn site with the document the selection was read in, where the id names
  // the selection minted for that connection, and the drawn site otherwise.
  siteFor(site: ConnectionSite, id: number | undefined): ConnectionSite;
  // clear forgets the selection, with the panel it was made in.
  clear(): void;
}

// documentSelections builds that record for one panel. Ids are never reused
// while the extension runs, so an id a closed panel was told cannot name a
// selection made in the panel that replaced it.
export function documentSelections(): DocumentSelections {
  let minted = 0;
  let newest: { id: number; selection: DocumentSelection } | null = null;
  const named = (id: number | undefined): DocumentSelection | undefined =>
    (newest !== null && typeof id === 'number' && id === newest.id ? newest.selection : undefined);
  return {
    mint: (selection) => {
      minted += 1;
      newest = { id: minted, selection: { ...selection } };
      return minted;
    },
    named,
    siteFor: (site, id) => {
      const chosen = named(id);
      if (chosen === undefined
        || chosen.source !== site.source
        || chosen.socket !== site.socket
        || chosen.alias !== site.alias) {
        return site;
      }
      return { ...site, document: chosen.document };
    },
    clear: () => { newest = null; },
  };
}
