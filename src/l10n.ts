// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import type * as vscode from 'vscode';

// This module is the extension's one lookup for the text it writes itself, in the
// language the editor is showing.
//
// 🔴 EVERY MODULE REACHES THE EDITOR'S TRANSLATIONS THROUGH HERE, AND NOTHING ELSE
// REACHES THEM. In the editor, t hands the message to the editor's own lookup,
// which answers the translation the extension's bundle for the editor's language
// holds — or the English message, where there is no bundle or the bundle has no
// entry for it. With no editor at all, as under the unit tests, it writes the
// English message itself, with its placeholders filled exactly as the editor
// fills them. So a module that imports no editor type can still have its words
// translated, and its tests still read them in English. The English bundle every
// translation is checked against is generated from the calls to t, so a second way
// of reaching the editor's lookup would be text no bundle lists.
//
// The editor is reached lazily, on the first message, and only through a module
// load that may fail: a module evaluated where there is no editor never needs one.
// A stand-in for the editor that carries no lookup is read as no editor.
//
// 🔴 A MESSAGE READ WHILE A MODULE IS FIRST EVALUATED IS TRANSLATED TOO. The editor
// loads the extension's bundle for its language before it loads the extension's
// main module, so a constant computed through t at module level already holds the
// translation. Such a constant keeps the language the editor had at start-up,
// which is the only language an editor session has: changing it restarts the
// editor.
//
// HOW TO WRITE A MESSAGE — every module converted to this lookup follows these:
//
// - Import it as `import * as l10n from './l10n';` and call `l10n.t(...)`. The
//   English bundle, l10n/bundle.l10n.json, is collected by reading those calls, so
//   the first argument is a string literal and never a variable, a template with
//   substitutions or a concatenation. `npm run l10n-bundle` regenerates the bundle
//   and refuses any other call shape, naming the site; the compile does not run
//   it, and the unit suite fails while the committed bundle differs from what the
//   sources generate.
// - Translate the extension's OWN words that a reader sees: notifications,
//   input-box and quick-pick titles, prompts and placeholders, button labels,
//   status-bar text and tooltips, the sentences it composes for the output channel,
//   the text it composes for a webview, and the labels and tooltips it composes for
//   a tree.
// - NEVER translate the compiler's words: diagnostics, refusals, an import's
//   questions and its advice on a secret, or any message relayed as it arrived.
//   Those reach the reader as the compiler wrote them, and are passed into a
//   message as a placeholder value.
// - NEVER translate a line written to mirror the command line's own output and
//   held to it by a case manifest the compiler's tree owns, nor a line its comment
//   says repeats the command line's words — the mapping-decision, drift and
//   written-file lines of an import, and a build's pull summary, are such lines.
// - NEVER translate identifiers: command ids, setting ids, view ids, file names,
//   codes, flags and protocol values. Product and entity names — Aggrega,
//   Aggregate, Component, Feature, Recipe, FeatureRecipe, Manifest, Release,
//   Plugin, Workload and the other kinds — stay as authored inside a translated
//   message.
// - Write a whole sentence with placeholders — `{0}`, `{1}`, in the order the
//   arguments are passed — rather than a sentence assembled from separately
//   translated pieces, wherever a placeholder can carry the part that varies, so a
//   translation may put the parts in the order its language needs. Keep singular
//   and plural as separate messages, as the code already writes them.
// - What a placeholder carries decides whether it may carry it. Anything the
//   extension did not word — a name, a path, a count, a version, the compiler's
//   own text — fills a placeholder freely. A piece the extension DID word fills
//   one only where it stands alone, carrying its own article and everything that
//   has to agree with it, so no word of the sentence around it depends on it.
//   Such a piece is translated in its dictionary form, and the sentence holding
//   it sets it off with punctuation — a dash or parentheses — wherever its
//   language would otherwise inflect it there. Where the sentence uses the piece
//   as a noun — after an article, a number or a preposition — write one whole
//   message per noun instead, as the trust sentences of a registration do, one
//   per kind of trust supplied.
// - A shared label constant — a name the reader is taught, held in one home so
//   every surface spells it alike — fills a placeholder only where the sentence
//   holds it as a label: after a colon, or quoted as the name of a control. Inside
//   running prose, the sentence's own message writes the label's words, and a
//   comment at that site names the constant it spells, so a change to the label
//   finds the sentences that spell it.
// - Punctuation belongs inside the message with the words it closes: a full stop,
//   a colon, the parentheses around a value. Only layout stays outside — the
//   indentation of a channel line, a line break, and the space between two whole
//   sentences each translated on its own.
// - An operation's ending is its subject ("The import") and a predicate ("drafted
//   3 files, …") joined by a message of operation-outcome.ts's own — `{0} {1}`, or
//   `{0} {1}.` where the predicate is the stop's — which a translation may rewrite
//   as its language needs, a label and a colon included. Word a subject and a
//   predicate each to stand on its own after that joining: never let a
//   predicate's words depend on agreeing with the subject it follows.
// - Markdown, code spans and a webview's markup stay intact inside a message, so
//   a translation carries them as they are.
// - A converted message's English is byte-identical to what the code wrote before,
//   so the tests that read it back still hold; where turning a sentence into a whole
//   message would change its English, leave the sentence as it is.

// MessageArgument is a value a placeholder is filled with.
export type MessageArgument = string | number | boolean;

// EditorLookup is the part of the editor's localization namespace this module
// calls.
type EditorLookup = Pick<typeof vscode.l10n, 't'>;

// reached is the editor's lookup once it has been looked for: the lookup, or null
// where there is no editor carrying one.
let reached: EditorLookup | null | undefined;

// editorLookup answers the editor's lookup, looking for it once.
function editorLookup(): EditorLookup | null {
  if (reached === undefined) {
    reached = null;
    try {
      const editor = require('vscode') as { l10n?: Partial<EditorLookup> } | undefined;
      if (typeof editor?.l10n?.t === 'function') {
        reached = editor.l10n as EditorLookup;
      }
    } catch {
      // No editor: the English message is written here.
    }
  }
  return reached;
}

// t answers message in the editor's language, its placeholders filled with args.
export function t(message: string, ...args: MessageArgument[]): string {
  const editor = editorLookup();
  return editor === null ? format(message, args) : editor.t(message, ...args);
}

// PLACEHOLDER is how the editor finds a placeholder in a message: anything between
// a pair of braces.
const PLACEHOLDER = /{([^}]+)}/g;

// placeholders lists the placeholders message names, each once, sorted — the set a
// translation of it must name too, since a placeholder a translation drops loses
// its value and one it adds is written out as it stands.
export function placeholders(message: string): string[] {
  const names = new Set(Array.from(message.matchAll(PLACEHOLDER), (m) => m[1]));
  return [...names].sort();
}

// format fills message's placeholders from args as the editor's own lookup does:
// a message given no arguments is answered unchanged, and a placeholder naming no
// argument is left as written.
//
// 🔴 A DELIBERATE COPY OF THE EDITOR'S OWN PLACEHOLDER FILLING, AND IT MUST STAY
// ONE. The unit suite runs with no editor, so the editor's filling cannot be
// called there, and a message must read back under the suite exactly as the
// editor writes it in English. It was read from the editor's extension host in
// VS Code 1.138.0: the same pattern as PLACEHOLDER, each match replaced by the
// argument it names or left as it stands, and a message with no arguments
// returned untouched.
function format(message: string, args: readonly MessageArgument[]): string {
  if (args.length === 0) {
    return message;
  }
  return message.replace(PLACEHOLDER, (match, key: string) => {
    const value = (args as unknown as Record<string, MessageArgument | undefined>)[key];
    return value === undefined ? match : String(value);
  });
}
