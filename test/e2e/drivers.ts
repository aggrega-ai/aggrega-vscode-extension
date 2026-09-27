// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as fs from 'fs';
import type { Browser, BrowserContext, CDPSession, ElectronApplication, Frame, Page } from 'playwright-core';

// The UI drivers the runner reads the drawn editor with.
//
// Every read is an expression evaluated in a document the editor draws: the
// workbench page, or a webview document found by its content, never by its URL.
// A webview is an out-of-process frame of the workbench whose panel content is a
// child frame inside it, so the webview documents are listed from every frame
// the driver reaches.

// WebviewDocument is one webview document the driver can evaluate in.
export interface WebviewDocument {
  url: string;
  evaluate<T>(expression: string): Promise<T>;
}

// PlatformFonts is what the renderer drew a node's text in.
export interface PlatformFonts {
  cssFontFamily: string | null;
  fonts: { familyName: string; postScriptName?: string; glyphCount: number; isCustomFont: boolean }[];
}

// Box is an element's rectangle in the window's coordinates.
export interface Box { x: number; y: number; width: number; height: number }

// UiDriver is what the calibration and the checks need from a driver.
export interface UiDriver {
  readonly name: string;
  workbench<T>(expression: string): Promise<T>;
  webviews(): Promise<WebviewDocument[]>;
  screenshot(file: string): Promise<number>;
  drag(from: { x: number; y: number }, to: { x: number; y: number }, steps: number): Promise<void>;
  press(key: string): Promise<void>;
  // type sends text as key presses, to whatever holds the focus.
  type(text: string): Promise<void>;
  // box reads the rectangle of the first element matching `selector` in a
  // webview document, or in the workbench where `doc` is null, in the window's
  // coordinates, so a press can be made where a person would make it.
  box(doc: WebviewDocument | null, selector: string): Promise<Box | null>;
  // click presses the pointer at a point — the secondary button where asked,
  // which opens a context menu — and moveTo moves it there, which is what raises
  // a hover.
  click(at: { x: number; y: number }, button?: 'left' | 'right'): Promise<void>;
  moveTo(at: { x: number; y: number }): Promise<void>;
  platformFonts(doc: WebviewDocument, selector: string): Promise<PlatformFonts>;
  // detach lets go of the editor without stopping it.
  detach(): Promise<void>;
}

// loadPlaywright loads the driver library only when a Playwright driver is asked
// for, so a run that uses neither never loads it.
function loadPlaywright(): typeof import('playwright-core') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('playwright-core') as typeof import('playwright-core');
}

class PlaywrightDriver implements UiDriver {
  constructor(
    readonly name: string,
    private readonly page: Page,
    private readonly context: BrowserContext,
    private readonly onDetach: () => Promise<void>,
  ) {}

  workbench<T>(expression: string): Promise<T> {
    return this.page.evaluate(expression) as Promise<T>;
  }

  async webviews(): Promise<WebviewDocument[]> {
    return this.page.frames()
      .filter((f) => f.url().startsWith('vscode-webview://') && !f.isDetached())
      .map((f) => new PlaywrightDocument(f));
  }

  async screenshot(file: string): Promise<number> {
    const png = await this.page.screenshot({ path: file });
    return png.length;
  }

  async drag(from: { x: number; y: number }, to: { x: number; y: number }, steps: number): Promise<void> {
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await this.page.mouse.move(to.x, to.y, { steps });
    await this.page.mouse.up();
  }

  press(key: string): Promise<void> {
    return this.page.keyboard.press(key);
  }

  type(text: string): Promise<void> {
    return this.page.keyboard.type(text);
  }

  async box(doc: WebviewDocument | null, selector: string): Promise<Box | null> {
    const frame = doc === null ? this.page.mainFrame() : (doc as PlaywrightDocument).frame;
    const b = await frame.locator(selector).first().boundingBox({ timeout: 2000 }).catch(() => null);
    return b === null ? null : { x: b.x, y: b.y, width: b.width, height: b.height };
  }

  click(at: { x: number; y: number }, button: 'left' | 'right' = 'left'): Promise<void> {
    return this.page.mouse.click(at.x, at.y, { button });
  }

  moveTo(at: { x: number; y: number }): Promise<void> {
    return this.page.mouse.move(at.x, at.y);
  }

  async platformFonts(doc: WebviewDocument, selector: string): Promise<PlatformFonts> {
    const frame = (doc as PlaywrightDocument).frame;
    // A protocol session belongs to an out-of-process frame, and a panel's
    // document is an in-process child of one, so the session is the nearest
    // ancestor that has its own and the node is reached through the child's
    // execution context.
    let owner: Frame | null = frame;
    let session: CDPSession | null = null;
    while (owner !== null && session === null) {
      try { session = await this.context.newCDPSession(owner); } catch { owner = owner.parentFrame(); }
    }
    if (session === null || owner === null) { throw new Error('no protocol session reaches the frame'); }
    // The panel's frame is found in the session's frame tree by its position under
    // the session's own frame, not by its URL or name: the editor writes the
    // panel's document into a frame it renamed after creating it, and the driver's
    // copy of those two fields is the one from before the rename.
    const steps: number[] = [];
    for (let f: Frame = frame; f !== owner; f = f.parentFrame() as Frame) {
      const parent = f.parentFrame();
      if (parent === null) { throw new Error('the frame is not under its session\'s frame'); }
      steps.unshift(parent.childFrames().indexOf(f));
    }
    try {
      const tree = await session.send('Page.getFrameTree') as { frameTree: FrameTreeNode };
      const frameId = frameAt(tree.frameTree, steps);
      if (frameId === null) { throw new Error(`no frame at ${JSON.stringify(steps)} under the session's frame`); }
      const { executionContextId } = await session.send('Page.createIsolatedWorld', { frameId, worldName: 'editor-suite' });
      await session.send('DOM.enable');
      await session.send('CSS.enable');
      await session.send('DOM.getDocument', { depth: -1, pierce: true });
      const { result } = await session.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})`, contextId: executionContextId });
      if (!result.objectId) { throw new Error(`no element matches ${selector}`); }
      const { nodeId } = await session.send('DOM.requestNode', { objectId: result.objectId });
      const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
      const { computedStyle } = await session.send('CSS.getComputedStyleForNode', { nodeId });
      return { cssFontFamily: computedStyle.find((p) => p.name === 'font-family')?.value ?? null, fonts };
    } finally {
      await session.detach().catch(() => undefined);
    }
  }

  detach(): Promise<void> {
    return this.onDetach();
  }
}

interface FrameTreeNode {
  frame: { id: string; url: string; name?: string };
  childFrames?: FrameTreeNode[];
}

function frameAt(node: FrameTreeNode, steps: number[]): string | null {
  let at: FrameTreeNode | undefined = node;
  for (const i of steps) { at = at?.childFrames?.[i]; }
  return at ? at.frame.id : null;
}

class PlaywrightDocument implements WebviewDocument {
  constructor(readonly frame: Frame) {}
  get url(): string { return this.frame.url(); }
  evaluate<T>(expression: string): Promise<T> {
    return this.frame.evaluate(expression) as Promise<T>;
  }
}

async function workbenchPage(pages: () => Page[], boundMs: number): Promise<Page> {
  const until = Date.now() + boundMs;
  while (Date.now() < until) {
    const page = pages().find((p) => p.url().includes('workbench'));
    if (page) { return page; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no workbench page appeared within ${boundMs} ms`);
}

// connectOverDevTools attaches Playwright to an editor the runner launched, over
// the editor's own debugging port.
export async function connectOverDevTools(debugPort: number, boundMs: number): Promise<UiDriver> {
  const { chromium } = loadPlaywright();
  const browser: Browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: boundMs });
  const context = browser.contexts()[0];
  if (!context) { throw new Error('the editor exposes no browser context'); }
  const page = await workbenchPage(() => context.pages(), boundMs);
  // Closing a browser that was connected to, rather than launched, disconnects
  // from it and leaves the editor running.
  return new PlaywrightDriver('playwright-devtools', page, context, () => browser.close());
}

// ElectronLaunch is an editor Playwright's Electron launcher started.
export interface ElectronLaunch {
  driver: UiDriver;
  app: ElectronApplication;
  pid: number;
}

// launchWithElectron starts the editor with Playwright's Electron launcher. The
// launcher adds its own debugging arguments; the environment is exactly the one
// given.
export async function launchWithElectron(opts: { executable: string; args: string[]; env: Record<string, string>; cwd: string; log: string; boundMs: number }): Promise<ElectronLaunch> {
  const { _electron } = loadPlaywright();
  const app = await _electron.launch({ executablePath: opts.executable, args: opts.args, env: opts.env, cwd: opts.cwd, timeout: opts.boundMs });
  const child = app.process();
  const log = fs.createWriteStream(opts.log, { flags: 'a' });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  const page = await workbenchPage(() => app.windows(), opts.boundMs);
  const context = app.context();
  if (child.pid === undefined) { throw new Error('the Electron launcher reported no process'); }
  // Detaching from a launched application has no disconnect of its own: the
  // connection ends with the application, so detaching here is a no-op and the
  // teardown stops the application.
  return { driver: new PlaywrightDriver('playwright-electron', page, context, async () => undefined), app, pid: child.pid };
}
