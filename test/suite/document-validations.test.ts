// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import {
  DocumentValidations,
  createDocumentValidations,
  readAfterValidations,
} from '../../src/document-validations';

// When each open document's text is sent to the language server, and when a
// press of the Catalog panel's Refresh reads the list, driven with no editor and
// no server: documents held as a name and the text the editor holds, a language
// server that answers each validation only when the test says so and holds the
// text of the last one it answered for each document — as the server's index
// reads it — and a clock that moves only when the test moves it. Every
// validation sent, every answer and every read of the list is recorded in order,
// with the time it happened, and read back by equality.

const PAUSE_MS = 300;

// drained lets every promise callback already queued run, which is where what
// follows an answer runs.
function drained(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

class FakeTimer {
  now = 0;
  private nextId = 1;
  private queue: Array<{ id: number; due: number; fn: () => void }> = [];

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.queue.push({ id, due: this.now + ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.queue = this.queue.filter((q) => q.id !== handle);
  }

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      this.queue.sort((a, b) => a.due - b.due);
      const next = this.queue[0];
      if (!next || next.due > target) { this.now = target; return; }
      this.queue.shift();
      this.now = next.due;
      next.fn();
    }
  }
}

// Doc is an open document: its name and the text the editor holds for it now.
interface Doc {
  name: string;
  text: string;
}

// Unanswered is one validation the language server has not answered yet.
interface Unanswered {
  name: string;
  text: string;
  answer(): void;
  refuse(): void;
}

interface Harness {
  timer: FakeTimer;
  validations: DocumentValidations<Doc>;
  unanswered: Unanswered[];
  // held is the text the language server holds for each document: the text of
  // the last validation it answered.
  held: Map<string, string>;
  // trace is every validation sent, every answer and refusal, and every read of
  // the list, in order, each with the time on the clock.
  trace: string[];
  press(): Promise<void>;
  answer(name: string): Promise<void>;
  refuse(name: string): Promise<void>;
}

function harness(): Harness {
  const timer = new FakeTimer();
  const unanswered: Unanswered[] = [];
  const held = new Map<string, string>();
  const trace: string[] = [];
  const validations = createDocumentValidations<Doc>({
    key: (doc) => doc.name,
    validate: (doc) => {
      const text = doc.text;
      trace.push(`${timer.now} validate ${doc.name} "${text}"`);
      return new Promise<void>((resolve, reject) => {
        unanswered.push({
          name: doc.name,
          text,
          // The server writes the text where its index reads it before it
          // answers.
          answer: () => { held.set(doc.name, text); trace.push(`${timer.now} answered ${doc.name} "${text}"`); resolve(); },
          refuse: () => { trace.push(`${timer.now} refused ${doc.name} "${text}"`); reject(new Error('refused')); },
        });
      });
    },
    timer,
    pauseMs: () => PAUSE_MS,
  });
  const read = (): void => {
    trace.push(`${timer.now} read ${JSON.stringify([...held].sort())}`);
  };
  // settle answers or refuses the oldest validation of name still waiting. Where
  // none is waiting it does nothing, so the trace read afterwards shows what was
  // missing.
  const settle = async (name: string, how: 'answer' | 'refuse'): Promise<void> => {
    const at = unanswered.findIndex((u) => u.name === name);
    if (at !== -1) {
      const [u] = unanswered.splice(at, 1);
      u[how]();
    }
    await drained();
  };
  return {
    timer,
    validations,
    unanswered,
    held,
    trace,
    press: () => readAfterValidations(() => validations.answered(), read),
    answer: (name) => settle(name, 'answer'),
    refuse: (name) => settle(name, 'refuse'),
  };
}

describe('document validations', () => {
  describe('each document waits out its own pause', () => {
    it('leaves a document validated with its own latest text when another document changes inside its window', async () => {
      const h = harness();
      const a: Doc = { name: 'a.yaml', text: 'a1' };
      const b: Doc = { name: 'b.yaml', text: 'b1' };
      h.validations.changed(a);
      h.timer.advance(100);
      h.validations.changed(b);
      h.timer.advance(100);
      a.text = 'a2';
      h.validations.changed(a);
      h.timer.advance(1000);
      assert.deepStrictEqual(h.trace, [
        '400 validate b.yaml "b1"',
        '500 validate a.yaml "a2"',
      ]);
    });

    it('validates a document whose window another document\'s change fell inside, at the end of its own window', async () => {
      const h = harness();
      const a: Doc = { name: 'a.yaml', text: 'name: scratch/unused' };
      const b: Doc = { name: 'b.yaml', text: 'b1' };
      h.validations.changed(a);
      h.timer.advance(100);
      h.validations.changed(b);
      h.timer.advance(1000);
      assert.deepStrictEqual(h.trace, [
        '300 validate a.yaml "name: scratch/unused"',
        '400 validate b.yaml "b1"',
      ]);
    });

    it('collapses a burst of changes to one document into one validation of its last text', () => {
      const h = harness();
      const a: Doc = { name: 'a.yaml', text: 'a1' };
      h.validations.changed(a);
      h.timer.advance(200);
      a.text = 'a2';
      h.validations.changed(a);
      h.timer.advance(200);
      a.text = 'a3';
      h.validations.changed(a);
      h.timer.advance(1000);
      assert.deepStrictEqual(h.trace, ['700 validate a.yaml "a3"']);
    });
  });

  describe('a press of the Catalog panel\'s Refresh', () => {
    it('sends a validation still waiting out its pause and reads the list only once it is answered', async () => {
      const h = harness();
      const component: Doc = { name: 'scratch-component.yaml', text: 'name: scratch/renamed-unsaved' };
      h.validations.changed(component);
      h.timer.advance(PAUSE_MS);
      await h.answer('scratch-component.yaml');
      // The rename undone, and the press made inside the pause that follows.
      component.text = 'name: scratch/unused';
      h.validations.changed(component);
      h.timer.advance(100);
      const pressed = h.press();
      await drained();
      h.timer.advance(50);
      await h.answer('scratch-component.yaml');
      await pressed;
      // Nothing is left waiting: the pause the press cut short sends nothing more.
      h.timer.advance(1000);
      await drained();
      assert.deepStrictEqual(h.trace, [
        '300 validate scratch-component.yaml "name: scratch/renamed-unsaved"',
        '300 answered scratch-component.yaml "name: scratch/renamed-unsaved"',
        '400 validate scratch-component.yaml "name: scratch/unused"',
        '450 answered scratch-component.yaml "name: scratch/unused"',
        '450 read [["scratch-component.yaml","name: scratch/unused"]]',
      ]);
    });

    it('reads the list only once a validation already in flight is answered', async () => {
      const h = harness();
      const a: Doc = { name: 'a.yaml', text: 'a1' };
      h.validations.changed(a);
      h.timer.advance(PAUSE_MS);
      const pressed = h.press();
      await drained();
      h.timer.advance(200);
      await h.answer('a.yaml');
      await pressed;
      assert.deepStrictEqual(h.trace, [
        '300 validate a.yaml "a1"',
        '500 answered a.yaml "a1"',
        '500 read [["a.yaml","a1"]]',
      ]);
    });

    it('waits for the validation a document\'s opening sent', async () => {
      const h = harness();
      h.validations.send({ name: 'a.yaml', text: 'opened' });
      const pressed = h.press();
      await drained();
      h.timer.advance(120);
      await h.answer('a.yaml');
      await pressed;
      assert.deepStrictEqual(h.trace, [
        '0 validate a.yaml "opened"',
        '120 answered a.yaml "opened"',
        '120 read [["a.yaml","opened"]]',
      ]);
    });

    it('reads the list once a refused validation settles, as an answered one does', async () => {
      const h = harness();
      const a: Doc = { name: 'a.yaml', text: 'a1' };
      h.validations.changed(a);
      h.timer.advance(PAUSE_MS);
      const pressed = h.press();
      await drained();
      h.timer.advance(10);
      await h.refuse('a.yaml');
      await pressed;
      assert.deepStrictEqual(h.trace, [
        '300 validate a.yaml "a1"',
        '310 refused a.yaml "a1"',
        '310 read []',
      ]);
    });

    it('reads the list at once where no validation is waiting or in flight', async () => {
      const h = harness();
      await h.press();
      assert.deepStrictEqual(h.trace, ['0 read []']);
    });

    it('does not wait for a validation sent after the press', async () => {
      const h = harness();
      const a: Doc = { name: 'a.yaml', text: 'a1' };
      h.validations.changed(a);
      h.timer.advance(PAUSE_MS);
      const pressed = h.press();
      await drained();
      a.text = 'a2';
      h.validations.changed(a);
      h.timer.advance(PAUSE_MS);
      await h.answer('a.yaml');
      await pressed;
      assert.deepStrictEqual(h.trace, [
        '300 validate a.yaml "a1"',
        '600 validate a.yaml "a2"',
        '600 answered a.yaml "a1"',
        '600 read [["a.yaml","a1"]]',
      ]);
    });

    it('sends every document\'s waiting validation at once, and reads after the last answer', async () => {
      const h = harness();
      h.validations.changed({ name: 'a.yaml', text: 'a1' });
      h.timer.advance(100);
      h.validations.changed({ name: 'b.yaml', text: 'b1' });
      h.timer.advance(100);
      const pressed = h.press();
      await drained();
      h.timer.advance(30);
      await h.answer('b.yaml');
      h.timer.advance(30);
      await h.answer('a.yaml');
      await pressed;
      assert.deepStrictEqual(h.trace, [
        '200 validate a.yaml "a1"',
        '200 validate b.yaml "b1"',
        '230 answered b.yaml "b1"',
        '260 answered a.yaml "a1"',
        '260 read [["a.yaml","a1"],["b.yaml","b1"]]',
      ]);
    });
  });

  it('reads nothing on its own however the documents change', async () => {
    const h = harness();
    const a: Doc = { name: 'a.yaml', text: 'a1' };
    h.validations.changed(a);
    h.timer.advance(PAUSE_MS);
    await h.answer('a.yaml');
    a.text = 'a2';
    h.validations.changed(a);
    h.timer.advance(3000);
    await h.answer('a.yaml');
    assert.deepStrictEqual(h.trace.filter((t) => t.includes(' read ')), []);
  });
});
