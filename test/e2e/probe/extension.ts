// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as crypto from 'crypto';
import * as http from 'http';
import * as vscode from 'vscode';

import { PROBE_PORT_ENV } from './protocol';

// The editor suite's probe: a test-only extension loaded beside the one under
// test, answering a closed set of requests about the extension host's state from
// a loopback port the runner hands it through the environment.
//
// 🔴 IT READS ONLY WHAT THE EDITOR'S OWN API EXPOSES, NEVER THE AGGREGA
// EXTENSION'S INTERNALS. A check that needs the extension's own state reads what
// the extension shows, in the drawn editor. A probe that reached into the
// extension's exports would pass over a defect in everything the reader sees.
//
// It stays inert unless the port variable is set, so an editor that loads it by
// accident answers nothing. A window reload restarts it with every other
// extension, on the same port, which is how the runner reconnects to it.

let server: http.Server | undefined;

// REQUESTS is the closed set the probe answers. A request outside it is refused
// by name, with the set listed, rather than guessed at.
const REQUESTS: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  'hello': async () => ({ pid: process.pid, instance, activatedAt, editorVersion: vscode.version }),
  'command.run': async (p) => toJson(await vscode.commands.executeCommand(str(p, 'command'), ...(Array.isArray(p.args) ? p.args.map(revive) : []))),
  'diagnostics.list': async (p) => listDiagnostics(typeof p.path === 'string' ? p.path : undefined),
  // The documents the editor holds, tab or none: a document an extension opened
  // is held without a tab, so the tabs drawn do not say which documents are open.
  'documents.list': async () => vscode.workspace.textDocuments.map(describeDocument),
  'document.open': async (p) => {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(str(p, 'path')));
    await vscode.window.showTextDocument(doc, { preview: false });
    return describeDocument(doc);
  },
  'document.edit': async (p) => {
    const doc = await documentAt(str(p, 'path'));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, rangeOf(p), str(p, 'text'));
    const applied = await vscode.workspace.applyEdit(edit);
    return { applied, ...describeDocument(doc) };
  },
  'document.save': async (p) => {
    const doc = await documentAt(str(p, 'path'));
    const saved = await doc.save();
    return { saved, ...describeDocument(doc) };
  },
  'document.undo': async (p) => {
    const doc = await documentAt(str(p, 'path'));
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.commands.executeCommand('undo');
    return describeDocument(doc);
  },
  'editor.active': async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return null; }
    const s = editor.selection;
    return { ...describeDocument(editor.document), text: editor.document.getText(), selection: { start: pos(s.start), end: pos(s.end) } };
  },
  'configuration.inspect': async (p) => {
    const resource = typeof p.path === 'string' ? vscode.Uri.file(p.path) : undefined;
    const key = str(p, 'key');
    const config = vscode.workspace.getConfiguration(undefined, resource);
    return { key, value: toJson(config.get(key)), inspect: toJson(config.inspect(key)) };
  },
  'workspace.folders': async () => (vscode.workspace.workspaceFolders ?? []).map((f) => ({ name: f.name, index: f.index, path: f.uri.fsPath, uri: f.uri.toString() })),
  'terminals.list': async () => Promise.all(vscode.window.terminals.map(async (t) => ({
    name: t.name,
    processId: await t.processId,
    creationOptions: toJson(t.creationOptions),
  }))),
  'clipboard.read': async () => vscode.env.clipboard.readText(),
};

const instance = crypto.randomBytes(8).toString('hex');
let activatedAt = '';

export function activate(context: vscode.ExtensionContext): void {
  const port = Number(process.env[PROBE_PORT_ENV]);
  if (!Number.isInteger(port) || port <= 0) { return; }
  activatedAt = new Date().toISOString();
  server = http.createServer((req, res) => { void answer(req, res); });
  listen(server, port, 100);
  context.subscriptions.push({ dispose: () => { server?.close(); } });
}

export function deactivate(): Promise<void> | undefined {
  const s = server;
  server = undefined;
  if (!s) { return undefined; }
  return new Promise((resolve) => s.close(() => resolve()));
}

// listen binds the loopback port, retrying while the extension host this one
// replaced still holds it: a reload starts the new host before the old one has
// always let go.
function listen(s: http.Server, port: number, attemptsLeft: number): void {
  s.once('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      setTimeout(() => listen(s, port, attemptsLeft - 1), 100);
    }
  });
  s.listen(port, '127.0.0.1');
}

async function answer(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const reply = (status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST') { reply(405, { ok: false, error: 'the probe answers POST requests only' }); return; }
  const chunks: Buffer[] = [];
  for await (const chunk of req) { chunks.push(chunk as Buffer); }
  let request: { op?: unknown; params?: unknown };
  try {
    request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    reply(400, { ok: false, error: 'the request is not JSON' });
    return;
  }
  const op = typeof request.op === 'string' ? request.op : '';
  const handler = Object.prototype.hasOwnProperty.call(REQUESTS, op) ? REQUESTS[op] : undefined;
  if (!handler) {
    reply(400, { ok: false, error: `the probe answers no request named ${JSON.stringify(op)}; it answers ${Object.keys(REQUESTS).join(', ')}` });
    return;
  }
  const params = typeof request.params === 'object' && request.params !== null ? request.params as Record<string, unknown> : {};
  try {
    reply(200, { ok: true, result: await handler(params) });
  } catch (err) {
    reply(200, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

function str(p: Record<string, unknown>, key: string): string {
  const v = p[key];
  if (typeof v !== 'string') { throw new Error(`the request needs a string ${key}`); }
  return v;
}

function num(v: unknown, key: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) { throw new Error(`the request needs a non-negative whole ${key}`); }
  return v;
}

function rangeOf(p: Record<string, unknown>): vscode.Range {
  const at = (v: unknown, key: string): vscode.Position => {
    const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
    return new vscode.Position(num(o.line, `${key}.line`), num(o.character, `${key}.character`));
  };
  const start = at(p.start, 'start');
  return new vscode.Range(start, p.end === undefined ? start : at(p.end, 'end'));
}

async function documentAt(file: string): Promise<vscode.TextDocument> {
  const uri = vscode.Uri.file(file).toString();
  return vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri) ?? vscode.workspace.openTextDocument(vscode.Uri.file(file));
}

// revive turns a command argument written as plain data back into the editor
// value a command expects: `{ "$file": <path> }` into a document address and
// `{ "$position": { line, character } }` into a position. Every other argument
// is passed as it came. The editor's own language commands — completion and
// hover at a position — take those two values and nothing written as JSON.
function revive(arg: unknown): unknown {
  if (typeof arg !== 'object' || arg === null) { return arg; }
  const o = arg as Record<string, unknown>;
  if (typeof o.$file === 'string') { return vscode.Uri.file(o.$file); }
  if (typeof o.$position === 'object' && o.$position !== null) {
    const q = o.$position as Record<string, unknown>;
    return new vscode.Position(num(q.line, 'line'), num(q.character, 'character'));
  }
  return arg;
}

function pos(p: vscode.Position): { line: number; character: number } {
  return { line: p.line, character: p.character };
}

function describeDocument(doc: vscode.TextDocument): Record<string, unknown> {
  return { path: doc.uri.fsPath, uri: doc.uri.toString(), languageId: doc.languageId, isDirty: doc.isDirty, isUntitled: doc.isUntitled, version: doc.version, lineCount: doc.lineCount };
}

function listDiagnostics(file: string | undefined): unknown {
  const entries: [vscode.Uri, readonly vscode.Diagnostic[]][] = file === undefined
    ? vscode.languages.getDiagnostics()
    : [[vscode.Uri.file(file), vscode.languages.getDiagnostics(vscode.Uri.file(file))]];
  return entries.filter(([, d]) => d.length > 0).map(([uri, diagnostics]) => ({
    path: uri.fsPath,
    uri: uri.toString(),
    diagnostics: diagnostics.map((d) => ({
      message: d.message,
      source: d.source ?? null,
      code: typeof d.code === 'object' && d.code !== null ? String(d.code.value) : d.code === undefined ? null : String(d.code),
      // Where the Problems panel's code leads when pressed; null for a code drawn
      // with nowhere to follow, and for no code.
      codeTarget: typeof d.code === 'object' && d.code !== null ? d.code.target.toString(true) : null,
      severity: vscode.DiagnosticSeverity[d.severity],
      range: { start: pos(d.range.start), end: pos(d.range.end) },
    })),
  }));
}

// toJson turns whatever an editor API returned into plain data: a URI as its
// string, a markdown string as its text, a cycle cut, a function dropped.
function toJson(value: unknown): unknown {
  const seen = new WeakSet<object>();
  // The replacer reads the holder's own value, because JSON.stringify hands it a
  // URI already turned into its components by the URI's own toJSON.
  const text = JSON.stringify(value, function (this: Record<string, unknown>, key: string, v: unknown) {
    if (this[key] instanceof vscode.Uri) { return (this[key] as vscode.Uri).toString(); }
    // A markdown string keeps its text behind an accessor, which plain
    // serialisation does not read, so a hover's words would arrive as nothing.
    if (this[key] instanceof vscode.MarkdownString) { return { value: (this[key] as vscode.MarkdownString).value }; }
    if (typeof v === 'bigint') { return v.toString(); }
    if (typeof v === 'function') { return undefined; }
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) { return '[cycle]'; }
      seen.add(v);
    }
    return v;
  });
  return text === undefined ? null : JSON.parse(text);
}
