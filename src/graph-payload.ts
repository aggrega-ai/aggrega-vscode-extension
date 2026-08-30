// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

// The payload the topology view is given is built here, on this side of the
// boundary, so a value the sensitivity rule withholds is removed before the view
// is handed anything — rather than being sent across and then not drawn.
//
// The rule itself is not restated here. It lives in media/attachments-model.js,
// which the view also loads, and this module runs that same file: the question
// "is this value withheld" therefore has one implementation, and the side that
// removes a value and the side that draws what arrives cannot come to disagree
// about the answer. A redactor written in TypeScript here would agree with it on
// the day it was written, and that agreement is what would hide the divergence.
//
// The file is a plain script that assigns to a global rather than a module, so
// it is evaluated the same way the view evaluates it: as a script, in a context
// of its own. What runs is the file that ships, not a copy of it.

// ATTACHMENTS_MODEL_PATH is where the shared rule sits relative to the
// extension's own root. It ships in the package: the ignore list excludes the
// TypeScript sources and the tests, and does not exclude the media directory.
const ATTACHMENTS_MODEL_PATH = ['media', 'attachments-model.js'];

// AttachmentsModel is the part of the shared rule this side calls.
export interface AttachmentsModel {
  // redactGraph returns the graph with every withheld value removed and every
  // sensitivity marking kept, so the view can still report why a field is
  // absent.
  redactGraph(graph: unknown): unknown;
}

// loadAttachmentsModel evaluates the shared rule and returns it.
//
// It throws when the file is missing, unreadable, or defines nothing — which is
// what the caller wants: with no rule to apply there is no way to tell a value
// that may be shown from one that may not, and the only safe answer is to show
// nothing rather than to fall back to sending everything.
export function loadAttachmentsModel(extensionRoot: string): AttachmentsModel {
  const file = path.join(extensionRoot, ...ATTACHMENTS_MODEL_PATH);
  const source = fs.readFileSync(file, 'utf8');
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox as vm.Context, { filename: file });
  const model = sandbox.AggregaAttachments as AttachmentsModel | undefined;
  if (!model || typeof model.redactGraph !== 'function') {
    throw new Error(`${file} defines no attachment projection`);
  }
  return model;
}

// GraphRedactor builds the payload the view is sent.
export type GraphRedactor = (graph: unknown, showSensitiveValues: boolean) => unknown;

// createGraphRedactor returns the redactor for an installed extension.
//
// The shared rule is loaded on first use and kept, so re-rendering a graph does
// not re-evaluate it. Loading it lazily also keeps the failure at the point a
// graph is actually rendered, where the view has somewhere to report it, rather
// than at activation where it would take the whole extension down.
//
// With sensitive values shown the rule is not consulted at all: the reader has
// asked for the payload as the compiler produced it, and there is nothing to
// decide. That is also why a broken rule file does not block that direction —
// it blocks only the direction that needs the rule in order to be safe.
export function createGraphRedactor(extensionRoot: string): GraphRedactor {
  let model: AttachmentsModel | null = null;
  return (graph: unknown, showSensitiveValues: boolean): unknown => {
    if (showSensitiveValues) { return graph; }
    if (model === null) { model = loadAttachmentsModel(extensionRoot); }
    return model.redactGraph(graph);
  };
}
