// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import { Readiness, createReadiness } from '../../src/readiness';
import {
  CatalogIndexDoc,
  EMPTY_LABEL,
  SERVER_STOPPED_LABEL,
  workspaceCatalogNodes,
} from '../../src/workspace-catalog-run';

// Facts is the pair the readiness state is made of, held where a test can move
// them the way activation and a restart move them: the root settles first, and
// the server becomes answerable afterwards.
class Facts {
  root: string | null = null;
  running = false;

  readiness(): Readiness {
    return createReadiness({
      getWorkspaceRoot: () => this.root,
      isLanguageServerRunning: () => this.running,
    });
  }
}

// counter records how many times a subscriber was told the compiler can be
// asked, which is the number a view would have re-rendered.
function counter(): { count: () => number; listener: () => void } {
  let n = 0;
  return { count: () => n, listener: () => { n += 1; } };
}

describe('readiness', () => {
  it('is not ready before the workspace root is known', () => {
    const facts = new Facts();
    facts.running = true;
    assert.strictEqual(facts.readiness().isReady(), false);
  });

  it('is not ready while the language server cannot be asked', () => {
    const facts = new Facts();
    facts.root = '/ws';
    assert.strictEqual(facts.readiness().isReady(), false);
  });

  it('is ready only when both facts hold', () => {
    const facts = new Facts();
    facts.root = '/ws';
    facts.running = true;
    assert.strictEqual(facts.readiness().isReady(), true);
  });

  it('tells every subscriber when the compiler becomes answerable', () => {
    const facts = new Facts();
    const readiness = facts.readiness();
    const first = counter();
    const second = counter();
    readiness.onReady(first.listener);
    readiness.onReady(second.listener);

    assert.strictEqual(first.count(), 0, 'nothing is announced before it is true');

    facts.root = '/ws';
    readiness.reassess();
    assert.strictEqual(first.count(), 0, 'the root alone is not readiness');

    facts.running = true;
    readiness.reassess();

    assert.strictEqual(first.count(), 1);
    assert.strictEqual(second.count(), 1, 'every subscriber reads the one signal');
  });

  it('announces the change and not each reassessment', () => {
    const facts = new Facts();
    facts.root = '/ws';
    const readiness = facts.readiness();
    const seen = counter();
    readiness.onReady(seen.listener);

    facts.running = true;
    readiness.reassess();
    readiness.reassess();
    readiness.reassess();

    assert.strictEqual(seen.count(), 1);
  });

  it('announces nothing when the compiler stops being answerable', () => {
    const facts = new Facts();
    facts.root = '/ws';
    facts.running = true;
    const readiness = facts.readiness();
    const seen = counter();
    readiness.onReady(seen.listener);
    assert.strictEqual(seen.count(), 1, 'subscribing while ready is told immediately');

    facts.running = false;
    readiness.reassess();

    assert.strictEqual(seen.count(), 1);
    assert.strictEqual(readiness.isReady(), false);
  });

  it('announces again after a restart, so the views repopulate unprompted', () => {
    const facts = new Facts();
    facts.root = '/ws';
    const readiness = facts.readiness();
    const seen = counter();
    readiness.onReady(seen.listener);

    // The first connection.
    facts.running = true;
    readiness.reassess();
    assert.strictEqual(seen.count(), 1);

    // A restart: the server refuses requests while it is restarting and again
    // while the replacement is starting, then answers.
    facts.running = false;
    readiness.reassess();
    readiness.reassess();
    facts.running = true;
    readiness.reassess();

    assert.strictEqual(seen.count(), 2, 'the restart re-fires the signal');
  });

  // The command gate is the one consumer that needs the falling edge, and it
  // needs it for the reason the views do not: it holds no content to protect,
  // and a gate left open while the compiler cannot be asked is an enabled
  // control that does nothing.
  it('tells the gate both edges, where a view is told only the rising one', () => {
    const facts = new Facts();
    facts.root = '/ws';
    const readiness = facts.readiness();

    const answers: boolean[] = [];
    readiness.onChange((answerable) => answers.push(answerable));
    const rendered = counter();
    readiness.onReady(rendered.listener);

    assert.deepStrictEqual(answers, [false], 'the answer as it stands is stated rather than left unsaid');

    facts.running = true;
    readiness.reassess();
    facts.running = false;
    readiness.reassess();

    assert.deepStrictEqual(answers, [false, true, false]);
    assert.strictEqual(rendered.count(), 1, 'the view is still told only that it became answerable');
  });

  it('publishes a change and not each reassessment', () => {
    const facts = new Facts();
    facts.root = '/ws';
    const readiness = facts.readiness();
    const answers: boolean[] = [];
    readiness.onChange((answerable) => answers.push(answerable));

    facts.running = true;
    readiness.reassess();
    readiness.reassess();
    readiness.reassess();

    assert.deepStrictEqual(answers, [false, true]);
  });

  it('tells a listener registered after the fact, rather than losing it', () => {
    const facts = new Facts();
    facts.root = '/ws';
    facts.running = true;
    const readiness = facts.readiness();
    readiness.reassess();

    const late = counter();
    readiness.onReady(late.listener);

    assert.strictEqual(late.count(), 1);
  });
});

describe('a view rendering from readiness', () => {
  // This is the closest a test without an extension host gets to the walk: the
  // same dependency set a view holds, rendered once at the moment activation
  // registers it and once more when the signal fires. The first render is the
  // honest not-running row; the second is the answer, obtained with nothing
  // pressed.
  it('supersedes the not-running row when the compiler becomes answerable', async () => {
    const facts = new Facts();
    const readiness = facts.readiness();
    const empty: CatalogIndexDoc = { entities: [] };

    const rendered: string[] = [];
    const render = async (): Promise<void> => {
      const nodes = await workspaceCatalogNodes({
        getWorkspaceRoot: () => facts.root,
        isLanguageServerRunning: () => facts.running,
        requestCatalogIndex: () => Promise.resolve(empty),
        entityKinds: () => Promise.resolve({ entityKinds: [] }),
        log: { appendLine: () => undefined },
      });
      const first = nodes[0];
      rendered.push(first.kind === 'message' ? first.label : first.kind);
    };

    // Registration draws the view before either fact has settled.
    facts.root = '/ws';
    await render();
    assert.deepStrictEqual(rendered, [SERVER_STOPPED_LABEL]);

    // A re-render is what the signal asks for, so the subscription is what a
    // view registers rather than something a reader has to press.
    let pending: Promise<void> = Promise.resolve();
    readiness.onReady(() => { pending = render(); });

    facts.running = true;
    readiness.reassess();
    await pending;

    assert.deepStrictEqual(
      rendered,
      [SERVER_STOPPED_LABEL, EMPTY_LABEL],
      'the empty workspace reads as empty, not as a server that is not running',
    );
  });
});
