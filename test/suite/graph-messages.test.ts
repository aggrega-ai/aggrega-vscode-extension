// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { GraphMessage, holdUntilListening, makeGraphMessageHandler } from '../../src/graph-messages';
import { callArguments } from '../helpers/anchoring-census';
import { EXTENSION_ROOT } from '../helpers/launch-census';
import { loadGraphWebview } from '../helpers/webview-dom';

interface Recorder {
  opened: Array<{ workspaceRoot: string; sourceFile: string }>;
  noWorkspaceReports: number;
  asked: Array<{ nodeId: string; requestId: number }>;
  attached: Array<{ nodeId: string; featureName: string }>;
  listened: number;
}

function recorder(): Recorder {
  return { opened: [], noWorkspaceReports: 0, asked: [], attached: [], listened: 0 };
}

function handlerOver(getRoot: () => string | null, rec: Recorder) {
  return makeGraphMessageHandler(getRoot, {
    openSource: (workspaceRoot, sourceFile) => { rec.opened.push({ workspaceRoot, sourceFile }); },
    reportNoWorkspace: () => { rec.noWorkspaceReports++; },
    requestAttachCandidates: (nodeId, requestId) => {
      rec.asked.push({ nodeId, requestId });
    },
    attachFeature: (nodeId, featureName) => { rec.attached.push({ nodeId, featureName }); },
    listening: () => { rec.listened++; },
  });
}

describe('makeGraphMessageHandler', () => {
  it('resolves a click against the root that is live at click time, not at registration', () => {
    const rec = recorder();
    // The reader is rebound between clicks, standing for the workspace
    // re-anchoring while the panel — and therefore the handler — stays alive.
    let root: string | null = '/first/root';
    const handle = handlerOver(() => root, rec);

    handle({ type: 'openSource', sourceFile: 'aggregate.yaml' });
    root = '/second/root';
    handle({ type: 'openSource', sourceFile: 'aggregate.yaml' });

    assert.deepStrictEqual(rec.opened, [
      { workspaceRoot: '/first/root', sourceFile: 'aggregate.yaml' },
      { workspaceRoot: '/second/root', sourceFile: 'aggregate.yaml' },
    ]);
    assert.strictEqual(rec.noWorkspaceReports, 0);
  });

  it('reports rather than guesses when nothing is anchored at click time', () => {
    const rec = recorder();
    let root: string | null = '/a/root';
    const handle = handlerOver(() => root, rec);

    handle({ type: 'openSource', sourceFile: 'release.yaml' });
    root = null;
    handle({ type: 'openSource', sourceFile: 'release.yaml' });

    assert.deepStrictEqual(rec.opened, [{ workspaceRoot: '/a/root', sourceFile: 'release.yaml' }]);
    assert.strictEqual(rec.noWorkspaceReports, 1);
  });

  it('ignores a message that names no source file, and an unrecognized type', () => {
    const rec = recorder();
    const handle = handlerOver(() => '/a/root', rec);

    handle({ type: 'openSource' });
    handle({ type: 'openSource', sourceFile: '' });
    handle({ type: 'somethingElse', sourceFile: 'aggregate.yaml' });

    assert.deepStrictEqual(rec.opened, []);
    assert.strictEqual(rec.noWorkspaceReports, 0);
    assert.deepStrictEqual(rec.asked, []);
  });

  it('forwards a candidacy request with the node it names', () => {
    const rec = recorder();
    const handle = handlerOver(() => '/a/root', rec);

    handle({ type: 'attachCandidates', nodeId: 'api', requestId: 7 });

    assert.deepStrictEqual(rec.asked, [{ nodeId: 'api', requestId: 7 }]);
    // A candidacy request is not a source-file click and must not become one.
    assert.deepStrictEqual(rec.opened, []);
  });

  it('carries the request id through unread, so the asker can tell its answers apart', () => {
    const rec = recorder();
    const handle = handlerOver(() => '/a/root', rec);

    // Two questions about the SAME node. A re-render re-asks because the
    // node's labels may have changed, so these are different questions and the
    // ids are the only thing that distinguishes their answers.
    handle({ type: 'attachCandidates', nodeId: 'api', requestId: 1 });
    handle({ type: 'attachCandidates', nodeId: 'api', requestId: 2 });

    // Nothing here interprets the id: it is minted and compared by the asker.
    assert.deepStrictEqual(rec.asked, [
      { nodeId: 'api', requestId: 1 },
      { nodeId: 'api', requestId: 2 },
    ]);
  });

  it('still serves a request that minted no id', () => {
    const rec = recorder();
    const handle = handlerOver(() => '/a/root', rec);

    // The two halves ship in either order, so a sender that does not mint an
    // id is asking a question this side can still answer.
    handle({ type: 'attachCandidates', nodeId: 'api' });
    handle({ type: 'attachCandidates', nodeId: 'api', requestId: Number.NaN });

    assert.deepStrictEqual(rec.asked.map((a) => a.requestId), [0, 0]);
  });

  it('serves a view that still sends the node\'s labels by the node alone', () => {
    const rec = recorder();
    const handle = handlerOver(() => '/a/root', rec);

    // The labels matched are the ones the Release's compiled graph carries for
    // the node, so a label set the view read off its drawing is not forwarded.
    // Serving such a message rather than dropping it is the tolerance that lets
    // the two halves ship in either order.
    handle({
      type: 'attachCandidates',
      nodeId: 'plain',
      labels: { tier: 'web' },
      requestId: 3,
    } as GraphMessage);

    assert.deepStrictEqual(rec.asked, [{ nodeId: 'plain', requestId: 3 }]);
  });

  it('asks nothing when there is no node to ask about', () => {
    const rec = recorder();
    const handle = handlerOver(() => '/a/root', rec);

    handle({ type: 'attachCandidates', requestId: 1 });
    handle({ type: 'attachCandidates', nodeId: '', requestId: 2 });

    assert.deepStrictEqual(rec.asked, []);
  });

  it('serves a candidacy request while nothing is anchored, because it resolves nothing here', () => {
    const rec = recorder();
    const handle = handlerOver(() => null, rec);

    handle({ type: 'attachCandidates', nodeId: 'api', requestId: 1 });

    // The node is addressed on the graph the panel drew, and the side holding
    // that graph adds its Release, so no root is consulted here and the reader
    // is not told to anchor something the question never needed.
    assert.deepStrictEqual(rec.asked, [{ nodeId: 'api', requestId: 1 }]);
    assert.strictEqual(rec.noWorkspaceReports, 0);
  });

  it('forwards a commit with the two names it was given, and nothing else', () => {
    const rec = recorder();
    const handle = handlerOver(() => '/a/root', rec);

    handle({ type: 'attachFeature', nodeId: 'cache', featureName: 'observability/scrape' });

    assert.deepStrictEqual(rec.attached, [
      { nodeId: 'cache', featureName: 'observability/scrape' },
    ]);
    // A commit is not a source-file click and not a candidacy question.
    assert.deepStrictEqual(rec.opened, []);
    assert.deepStrictEqual(rec.asked, []);
  });

  it('commits nothing when either name is missing, rather than completing one', () => {
    const rec = recorder();
    const handle = handlerOver(() => '/a/root', rec);

    // An absent name on either side names no subject: there is either no node
    // to attach to or nothing to attach. Defaulting either would edit a file on
    // a guess.
    handle({ type: 'attachFeature', featureName: 'observability/scrape' });
    handle({ type: 'attachFeature', nodeId: 'cache' });
    handle({ type: 'attachFeature', nodeId: '', featureName: 'observability/scrape' });
    handle({ type: 'attachFeature', nodeId: 'cache', featureName: '' });

    assert.deepStrictEqual(rec.attached, []);
  });

  it('passes on the panel saying it listens, and nothing else for it', () => {
    const rec = recorder();
    const handle = handlerOver(() => '/a/root', rec);

    handle({ type: 'listening' });

    assert.strictEqual(rec.listened, 1);
    assert.deepStrictEqual(rec.opened, []);
    assert.deepStrictEqual(rec.asked, []);
    assert.deepStrictEqual(rec.attached, []);
  });
});

// What the extension posts to the graph panel is held until the panel says it
// listens: the editor hands a message to the panel's document whether or not its
// script has started, and one arriving first is lost, which left a panel showing
// the sentence it opens with although a Release was selected and its drawing had
// been sent.
describe('holdUntilListening', () => {
  const delivered = (): { sent: unknown[]; deliver: (m: unknown) => void } => {
    const sent: unknown[] = [];
    return { sent, deliver: (m) => { sent.push(m); } };
  };

  it('sends nothing posted before the panel listens', () => {
    const d = delivered();
    const toPanel = holdUntilListening(d.deliver);

    toPanel.post({ type: 'loading', release: 'release.yaml' });
    toPanel.post({ type: 'render', release: 'release.yaml' });

    assert.deepStrictEqual(d.sent, []);
  });

  it('sends what it held when the panel listens, in the order it was posted', () => {
    const d = delivered();
    const toPanel = holdUntilListening(d.deliver);

    toPanel.post({ type: 'loading', release: 'release.yaml' });
    toPanel.post({ type: 'visibility', visible: false });
    toPanel.post({ type: 'render', release: 'release.yaml' });
    toPanel.listening();

    assert.deepStrictEqual(d.sent, [
      { type: 'loading', release: 'release.yaml' },
      { type: 'visibility', visible: false },
      { type: 'render', release: 'release.yaml' },
    ]);
  });

  it('sends at once what is posted once the panel listens', () => {
    const d = delivered();
    const toPanel = holdUntilListening(d.deliver);

    toPanel.listening();
    toPanel.post({ type: 'render', release: 'release.yaml' });

    assert.deepStrictEqual(d.sent, [{ type: 'render', release: 'release.yaml' }]);
  });

  it('sends nothing twice when the panel says it listens again', () => {
    const d = delivered();
    const toPanel = holdUntilListening(d.deliver);

    toPanel.post({ type: 'render', release: 'release.yaml' });
    toPanel.listening();
    toPanel.listening();
    toPanel.post({ type: 'attachOutcome', nodeId: 'db' });

    assert.deepStrictEqual(d.sent, [
      { type: 'render', release: 'release.yaml' },
      { type: 'attachOutcome', nodeId: 'db' },
    ]);
  });
});

// The two ends of the hold, read where they cannot be driven: the graph view
// imports the editor, which does not start in a headless run, so its source is
// read; the panel's own script is run, as shipped, in a stand-in document.
describe('the graph panel is posted to only behind the hold, and says it listens once it does', () => {
  it('the graph view posts to the panel\'s document at one place, the hold\'s own delivery', () => {
    const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src', 'graph-view.ts'), 'utf8');
    // An equality over every post in the module, so a second, direct one fails
    // here by its count and a hold that stopped posting fails by its argument.
    assert.deepStrictEqual(source.match(/\.postMessage\s*\(/g), ['.postMessage(']);
    assert.deepStrictEqual(callArguments('src/graph-view.ts', 'holdUntilListening'), [
      ['(message) => { void created.webview.postMessage(message); }'],
    ]);
  });

  it('the panel\'s script says it listens, once, with its listener already in place', () => {
    const view = loadGraphWebview();
    const said = view.posted
      .map((m, i) => ({ m: m as { type?: string }, listeners: view.listenersWhenPosted[i] }))
      .filter((p) => p.m.type === 'listening');
    assert.deepStrictEqual(said.map((p) => p.listeners), [1], 'one announcement, made with the one message listener subscribed');
  });
});
