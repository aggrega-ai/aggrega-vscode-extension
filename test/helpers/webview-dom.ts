// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

import { EXTENSION_ROOT } from './launch-census';

// A stand-in document, and the realm to run the topology renderer in.
//
// The renderer owns the document, which is why every rule it could hold without
// one already lives in the layout model beside it. What is left here is the part
// that genuinely needs a document: what ends up on the canvas, and what the
// notice above it says. Neither is reachable from a pattern over the source —
// the question is not whether a line is present but what the reader is looking
// at after a sequence of messages — so this supplies enough of a document for
// the shipped file to run against, and the specs read the result.
//
// It records structure and nothing else: which elements exist, where, and what
// classes and text they carry. There are no pixels here and none are claimed.

// StubElement is one element of the stand-in document.
export interface StubElement {
  tag: string;
  children: StubElement[];
  readonly firstChild: StubElement | null;
  readonly childNodes: StubElement[];
  textContent: string;
  className: string;
  classes: Set<string>;
  attrs: Record<string, unknown>;
  style: Record<string, unknown>;
  setAttribute(key: string, value: unknown): void;
  getAttribute(key: string): unknown;
  appendChild(child: StubElement): StubElement;
  removeChild(child: StubElement): StubElement;
  addEventListener(name: string, fn: (ev: unknown) => void): void;
  classList: {
    add(c: string): void;
    remove(c: string): void;
    toggle(c: string, on?: boolean): void;
    contains(c: string): boolean;
  };
  getComputedTextLength(): number;
  getBoundingClientRect(): StubBox;
  // box is what getBoundingClientRect reports. A spec sets it where the place an
  // element is drawn is part of the question — the legend's, which a frame is
  // fitted above. By default every element reports the same 800 × 600 at the
  // origin.
  box: StubBox;
  clientWidth: number;
  clientHeight: number;
  // fire delivers one event to whatever the renderer subscribed to this
  // element. The renderer's pan and zoom are event handlers, so an element that
  // recorded subscriptions and could not deliver to them would leave the reader
  // half of every question here undrivable.
  fire(name: string, event?: Record<string, unknown>): void;
}

// StubBox is where an element is drawn, as a document reports it.
export interface StubBox { left: number; top: number; width: number; height: number }

function makeElement(tag: string): StubElement {
  const classes = new Set<string>();
  const children: StubElement[] = [];
  const listeners = new Map<string, ((ev: unknown) => void)[]>();
  let text = '';
  const el = {
    tag,
    children,
    classes,
    attrs: {} as Record<string, unknown>,
    style: {} as Record<string, unknown>,
    clientWidth: 800,
    clientHeight: 600,
    setAttribute(key: string, value: unknown) { el.attrs[key] = value; },
    getAttribute(key: string) { return el.attrs[key]; },
    appendChild(child: StubElement) { children.push(child); return child; },
    removeChild(child: StubElement) {
      const at = children.indexOf(child);
      if (at >= 0) { children.splice(at, 1); }
      return child;
    },
    addEventListener(name: string, fn: (ev: unknown) => void) {
      const kept = listeners.get(name) ?? [];
      kept.push(fn);
      listeners.set(name, kept);
    },
    fire(name: string, event?: Record<string, unknown>) {
      for (const fn of listeners.get(name) ?? []) {
        fn({ preventDefault() { /* nothing to prevent here */ }, ...(event ?? {}) });
      }
    },
    classList: {
      add(c: string) { splitClasses(c).forEach(one => classes.add(one)); },
      remove(c: string) { splitClasses(c).forEach(one => classes.delete(one)); },
      toggle(c: string, on?: boolean) {
        const wanted = on === undefined ? !classes.has(c) : !!on;
        if (wanted) { classes.add(c); } else { classes.delete(c); }
      },
      contains(c: string) { return classes.has(c); },
    },
    // The real measurement asks the document for a font's text advance. This is
    // the same contract with an arithmetic answer, so what the layout exercises
    // is the sizing rule rather than a font.
    getComputedTextLength() { return text.length * 7; },
    box: { left: 0, top: 0, width: 800, height: 600 } as StubBox,
    getBoundingClientRect() { return { ...el.box }; },
  } as unknown as StubElement;

  Object.defineProperty(el, 'firstChild', { get: () => children[0] ?? null });
  Object.defineProperty(el, 'childNodes', { get: () => children });
  Object.defineProperty(el, 'textContent', {
    get: () => text,
    set: (value: string) => { text = String(value); children.length = 0; },
  });
  Object.defineProperty(el, 'className', {
    get: () => Array.from(classes).join(' '),
    set: (value: string) => {
      classes.clear();
      splitClasses(value).forEach(one => classes.add(one));
    },
  });
  return el;
}

function splitClasses(value: string): string[] {
  return String(value).split(/\s+/).filter(Boolean);
}

// The elements the renderer looks up by id as it starts. It reads all of them
// before it handles anything, so a missing one is a load failure rather than a
// surprise several messages later.
const DOCUMENT_IDS = [
  'status', 'canvas', 'panel', 'panel-title', 'panel-body', 'panel-close',
  'legend', 'measure', 'measure-text',
];

// GraphWebview is a loaded renderer, with the handles a spec needs to drive it
// and read what it did.
export interface GraphWebview {
  // post delivers one message to the renderer, as the panel would.
  post(message: Record<string, unknown>): void;
  // posted is what the renderer sent back the other way.
  posted: unknown[];
  // listenersWhenPosted is, beside each message in posted, how many message
  // listeners the renderer had subscribed when it sent it — what tells a panel
  // that says it listens from one that says so first and listens after.
  listenersWhenPosted: number[];
  // element returns one of the document's own elements by id.
  element(id: string): StubElement;
  // drawn counts the elements on the canvas, transitively.
  drawn(): number;
  // statusText is what the notice above the drawing currently says.
  statusText(): string;
  // statusClasses are the classes the notice carries, sorted.
  statusClasses(): string[];
  // canvasClasses are the classes the canvas carries, sorted.
  canvasClasses(): string[];
  // fireWindow delivers one event the renderer subscribed to on the window
  // rather than on an element — dragging continues there, so a pan driven only
  // through the canvas would stop at the first movement.
  fireWindow(name: string, event?: Record<string, unknown>): void;
  // setDrawingArea reports a new size for the drawing area and tells whatever
  // is watching it, which is what the editor does when a panel is resized or
  // comes back on screen.
  setDrawingArea(width: number, height: number): void;
  // frame is the transform the drawing currently carries — the reader's pan and
  // zoom, as one string. It is null before anything is drawn.
  //
  // It is read off the drawn group rather than from the renderer's own state,
  // because what the reader is looking at is what the group says and the state
  // is only how it got there.
  frame(): string | null;
  // settle waits for the asynchronous half of a render — the layout runs off a
  // promise the message handler does not return — until `until` holds.
  settle(until: () => boolean, what: string): Promise<void>;
}

// loadGraphWebview runs the SHIPPED media/graph.js, with the shipped models and
// the real layout engine, against a stand-in document.
export function loadGraphWebview(): GraphWebview {
  const byId = new Map<string, StubElement>();
  for (const id of DOCUMENT_IDS) { byId.set(id, makeElement('div')); }

  const messageHandlers: ((ev: { data: unknown }) => void)[] = [];
  const windowListeners = new Map<string, ((ev: unknown) => void)[]>();
  const posted: unknown[] = [];
  const listenersWhenPosted: number[] = [];

  // What is watching which element for a change of size. The renderer installs
  // one of these to notice a drawing area that has become measurable, so a
  // stand-in with no way to report a resize would leave that path declared and
  // never run.
  const observers: { element: unknown; report: () => void }[] = [];
  class StubResizeObserver {
    private readonly report: () => void;
    constructor(report: () => void) { this.report = report; }
    observe(element: unknown): void { observers.push({ element, report: this.report }); }
    disconnect(): void { /* nothing here outlives one spec */ }
  }

  const sandbox: Record<string, unknown> = {
    ResizeObserver: StubResizeObserver,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document: {
      getElementById: (id: string) => byId.get(id) ?? null,
      createElement: (tag: string) => makeElement(tag),
      createElementNS: (_ns: string, tag: string) => makeElement(tag),
    },
    window: {
      addEventListener: (name: string, fn: (ev: { data: unknown }) => void) => {
        if (name === 'message') { messageHandlers.push(fn); }
        const kept = windowListeners.get(name) ?? [];
        kept.push(fn as (ev: unknown) => void);
        windowListeners.set(name, kept);
      },
    },
    acquireVsCodeApi: () => ({ postMessage: (m: unknown) => { posted.push(m); listenersWhenPosted.push(messageHandlers.length); } }),
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);

  const runFile = (...parts: string[]): void => {
    const file = path.join(EXTENSION_ROOT, ...parts);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox as vm.Context, { filename: file });
  };

  // 🔴 THE LAYOUT ENGINE RUNS INSIDE THIS REALM, and that is a correctness
  // requirement rather than tidiness. Its importer type-checks the arrays it is
  // handed, and an array built by code in one realm is not an instance of
  // another realm's Array — so an engine loaded outside rejects a perfectly good
  // graph, reporting it as an edge with no endpoints. Loaded that way the specs
  // below would measure an empty canvas at every step and read exactly like a
  // canvas that had been cleared.
  //
  // The stand-in keeps its own addEventListener and falls through to this realm
  // for everything else, because the bundle reads intrinsics off the browser
  // global it expects to find.
  sandbox.module = { exports: {} };
  sandbox.exports = (sandbox.module as { exports: unknown }).exports;
  vm.runInContext(
    'globalThis.window = new Proxy(globalThis.window, {'
    + '  get: (t, k) => (k in t ? t[k] : globalThis[k]),'
    + '  set: (t, k, v) => { t[k] = v; return true; },'
    + '  has: () => true,'
    + '});'
    + 'globalThis.$wnd = globalThis.window;',
    sandbox as vm.Context,
  );
  runFile('node_modules', 'elkjs', 'lib', 'elk.bundled.js');
  sandbox.ELK = (sandbox.module as { exports: unknown }).exports;
  delete sandbox.module;
  delete sandbox.exports;
  assert.strictEqual(
    typeof sandbox.ELK, 'function',
    'the layout engine did not load into the webview realm, so nothing measured below would be '
    + 'about a drawn graph',
  );

  runFile('media', 'graph-model.js');
  runFile('media', 'attachments-model.js');
  runFile('media', 'candidates-model.js');
  runFile('media', 'graph.js');

  assert.strictEqual(
    messageHandlers.length, 1,
    'the renderer did not subscribe to exactly one message, so the specs below would be driving '
    + 'nothing',
  );

  const canvas = byId.get('canvas') as StubElement;
  const status = byId.get('status') as StubElement;

  const countDrawn = (): number => {
    // Everything drawn is nested under one pan/zoom group, so counting the
    // canvas's own children would report one for a full drawing and one for a
    // nearly empty one.
    let seen = 0;
    const walk = (node: StubElement): void => {
      for (const child of node.children) { seen++; walk(child); }
    };
    walk(canvas);
    return seen;
  };

  return {
    posted,
    listenersWhenPosted,
    // A real postMessage structured-clones the payload into the webview's
    // realm. Reproducing that is not a nicety — see the realm note above.
    post: (message) => {
      const inRealm = vm.runInContext(`(${JSON.stringify(message)})`, sandbox as vm.Context);
      messageHandlers[0]({ data: inRealm });
    },
    element: (id) => {
      const found = byId.get(id);
      assert.ok(found, `the stand-in document has no element with id ${id}`);
      return found;
    },
    drawn: countDrawn,
    statusText: () => status.textContent,
    statusClasses: () => Array.from(status.classes).sort(),
    canvasClasses: () => Array.from(canvas.classes).sort(),
    fireWindow: (name, event) => {
      for (const fn of windowListeners.get(name) ?? []) {
        fn({ preventDefault() { /* nothing to prevent here */ }, ...(event ?? {}) });
      }
    },
    setDrawingArea: (width, height) => {
      canvas.clientWidth = width;
      canvas.clientHeight = height;
      for (const watching of observers) {
        if (watching.element === canvas) { watching.report(); }
      }
    },
    frame: () => {
      const group = canvas.firstChild;
      if (group === null) { return null; }
      const transform = group.getAttribute('transform');
      return transform === undefined ? null : String(transform);
    },
    settle: async (until, what) => {
      for (let waited = 0; waited < 5000; waited += 20) {
        if (until()) { return; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.fail(`the renderer never reached: ${what}`);
    },
  };
}

// A topology with two nodes and the edge between them, in the envelope the
// compiler's graph answer carries.
export const DRAWABLE_GRAPH = {
  apiVersion: 'aggrega.ai/v1beta1',
  kind: 'IRGraph',
  spec: {
    nodes: {
      api: { component: 'core/service', resolved_version: '1.0.0' },
      db: { component: 'core/database', resolved_version: '1.0.0' },
    },
    edges: [{ source: 'api', target: 'db', socket: 'store', alias: 'primary' }],
  },
};
