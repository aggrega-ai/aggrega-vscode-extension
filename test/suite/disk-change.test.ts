// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  DiskChangeDeps,
  DiskWatcher,
  ON_DISK_PATTERN,
  WATCHED_EXTENSIONS,
  createDiskChangeHandler,
  diskChangeKind,
  subscribeToWatcher,
} from '../../src/disk-change';

// What the on-disk watcher does with each file it reports, driven with no editor
// and no server: a Problems panel held as a set of files, a graph panel that is
// closed or showing one Release, a selection holding a Release and the lockfile
// the language server named for it, a language server that answers each
// invalidation only when the test says so, and a clock that moves only when the
// test moves it. Every call the handler makes, and every answer the test gives,
// is recorded in order and read back by equality.

const SETTLE_MS = 300;
const RELEASE = 'release-compose.yaml';
const OTHER_RELEASE = 'release-prod.yaml';
const LOCKFILE = '/work/gateway/release-compose.lock';
const OTHER_LOCKFILE = '/work/gateway/release-prod.lock';
const RECIPE = '/work/gateway/catalog/recipe/compose/nginx-probed/1.0.0/recipe.yaml';
const COMPONENT = '/work/gateway/catalog/component/web/nginx/1.0.0/component.yaml';
const AGGREGATE = '/work/gateway/aggregate.yaml';

// drained lets every promise callback already queued run, which is where what
// follows an answer runs.
function drained(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

type WatcherEvent = 'create' | 'change' | 'delete';

// FakeWatcher is the editor's file-system watcher: the three events, each fired
// when the test fires it.
class FakeWatcher implements DiskWatcher {
  private readonly listeners: Record<WatcherEvent, Array<(uri: { fsPath: string }) => unknown>> = {
    create: [], change: [], delete: [],
  };

  onDidCreate(listener: (uri: { fsPath: string }) => unknown): void { this.listeners.create.push(listener); }
  onDidChange(listener: (uri: { fsPath: string }) => unknown): void { this.listeners.change.push(listener); }
  onDidDelete(listener: (uri: { fsPath: string }) => unknown): void { this.listeners.delete.push(listener); }

  fire(event: WatcherEvent, file: string): void {
    for (const listener of this.listeners[event]) { listener({ fsPath: file }); }
  }
}

// Unanswered is one invalidation the language server has not answered yet.
interface Unanswered {
  file: string;
  answer(): void;
  refuse(): void;
}

class FakeTimer {
  private now = 0;
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

// Harness is the surroundings of one handler.
class Harness {
  readonly timer = new FakeTimer();
  readonly calls: string[] = [];
  // shown is the Release the graph panel shows, or null while none is open.
  shown: string | null = null;
  readonly findings = new Set<string>();
  // release is the selected Release as a request carries it, and lockfile is the
  // path the language server named for its lockfile. A selection moves both at
  // once; a test that moves one alone says why.
  release: string | null = RELEASE;
  lockfile: string | null = LOCKFILE;
  readonly onDisk: (file: string) => void;
  // unanswered holds every invalidation sent and not yet answered, oldest first.
  private readonly unanswered: Unanswered[] = [];

  constructor() {
    const deps: DiskChangeDeps = {
      invalidate: (file) => {
        this.calls.push(`invalidate ${file}`);
        return new Promise<void>((resolve, reject) => {
          this.unanswered.push({ file, answer: () => resolve(), refuse: () => reject(new Error('refused')) });
        });
      },
      redraw: () => { this.calls.push('redraw'); },
      refreshCatalog: () => { this.calls.push('catalog re-read'); },
      revalidate: () => { this.calls.push('revalidate'); },
      shownRelease: () => this.shown,
      findingStands: (file) => this.findings.has(file),
      selectedRelease: () => this.release,
      selectedLockfile: () => this.lockfile,
      requestGraph: (release) => { this.calls.push(`graph request ${release}`); },
      timer: this.timer,
      settleMs: () => SETTLE_MS,
    };
    this.onDisk = createDiskChangeHandler(deps);
  }

  // answer answers the oldest invalidation of file still waiting, and returns
  // once what the answer releases has run. An invalidation that was never sent
  // cannot be answered, so asking for one fails the test.
  async answer(file: string): Promise<void> {
    await this.settle(file, 'answered');
  }

  // refuse fails that invalidation instead, as a request the server could not
  // take does.
  async refuse(file: string): Promise<void> {
    await this.settle(file, 'refused');
  }

  // answerAll answers every invalidation waiting, oldest first.
  async answerAll(): Promise<void> {
    while (this.unanswered.length > 0) {
      await this.answer(this.unanswered[0].file);
    }
  }

  private async settle(file: string, how: 'answered' | 'refused'): Promise<void> {
    const at = this.unanswered.findIndex((u) => u.file === file);
    assert.ok(at >= 0, `no invalidation of ${file} is waiting for an answer`);
    const [waiting] = this.unanswered.splice(at, 1);
    this.calls.push(`${how} ${file}`);
    if (how === 'answered') { waiting.answer(); } else { waiting.refuse(); }
    await drained();
  }
}

describe('which files the on-disk watcher reports, and how each is read', () => {
  it('watches the authored documents and the lockfile, and nothing else', () => {
    assert.deepStrictEqual(WATCHED_EXTENSIONS, ['yaml', 'lock']);
    assert.strictEqual(ON_DISK_PATTERN, '**/*.{yaml,lock}');
  });

  it('reads a document as a document, and a .lock only as the selected Release\'s lockfile', () => {
    const read = (file: string): string | null => diskChangeKind(file, LOCKFILE);
    assert.deepStrictEqual(
      [RECIPE, LOCKFILE, '/work/gateway/release-prod.lock', '/work/gateway/Cargo.lock',
        '/work/gateway/catalog/recipe/compose/nginx-probed/1.0.0/entity.lock', '/work/gateway/release.yml',
        '/work/gateway/notes.txt'].map(read),
      ['document', 'lockfile', null, null, null, null, null],
    );
  });

  it('reads no lockfile at all while no Release is selected', () => {
    assert.strictEqual(diskChangeKind(LOCKFILE, null), null);
    assert.strictEqual(diskChangeKind(RECIPE, null), 'document');
  });
});

describe('what the on-disk watcher does with each file it reports', () => {
  it('drops the document\'s entry, redraws and reads the Catalog panel\'s list again, and asks nothing else', async () => {
    const h = new Harness();
    h.findings.add(LOCKFILE);
    h.onDisk(RECIPE);
    await h.answer(RECIPE);
    h.timer.advance(SETTLE_MS * 4);
    assert.deepStrictEqual(h.calls, [`invalidate ${RECIPE}`, 'redraw', `answered ${RECIPE}`, 'catalog re-read']);
  });

  it('with a graph open on the selected Release, redraws for the lockfile and validates the open documents again', () => {
    const h = new Harness();
    h.shown = RELEASE;
    h.findings.add(LOCKFILE);
    h.onDisk(LOCKFILE);
    // The invalidation and the redraw are asked for as the write arrives.
    assert.deepStrictEqual(h.calls, [`invalidate ${LOCKFILE}`, 'redraw']);
    h.timer.advance(SETTLE_MS);
    // The redraw is the graph request, so nothing is asked for beside it.
    assert.deepStrictEqual(h.calls, [`invalidate ${LOCKFILE}`, 'redraw', 'revalidate']);
  });

  it('with no graph open and a finding standing on the lockfile, sends the graph request once', () => {
    const h = new Harness();
    h.findings.add(LOCKFILE);
    h.onDisk(LOCKFILE);
    h.timer.advance(SETTLE_MS);
    assert.deepStrictEqual(h.calls, [
      `invalidate ${LOCKFILE}`, 'redraw', 'revalidate', `graph request ${RELEASE}`,
    ]);
  });

  it('with a graph open on another Release and a finding standing, sends the graph request for the selected one', () => {
    // A panel keeps the Release it was shown with when the selection moves, so
    // the redraw checks that Release's lockfile and not the one written.
    const h = new Harness();
    h.shown = OTHER_RELEASE;
    h.findings.add(LOCKFILE);
    h.onDisk(LOCKFILE);
    h.timer.advance(SETTLE_MS);
    assert.deepStrictEqual(h.calls, [
      `invalidate ${LOCKFILE}`, 'redraw', 'revalidate', `graph request ${RELEASE}`,
    ]);
  });

  it('reads which Release the panel shows when the burst ends: shown the selected one by then, nothing beside the redraw', () => {
    const h = new Harness();
    h.shown = OTHER_RELEASE;
    h.findings.add(LOCKFILE);
    h.onDisk(LOCKFILE);
    // The reader shows the selected Release while the write is settling.
    h.shown = RELEASE;
    h.timer.advance(SETTLE_MS * 4);
    assert.deepStrictEqual(h.calls, [`invalidate ${LOCKFILE}`, 'redraw', 'revalidate']);
  });

  it('with no graph open and nothing standing on the lockfile, sends no graph request', () => {
    const h = new Harness();
    h.findings.add(RECIPE);
    h.onDisk(LOCKFILE);
    h.timer.advance(SETTLE_MS * 4);
    assert.deepStrictEqual(h.calls, [`invalidate ${LOCKFILE}`, 'redraw', 'revalidate']);
  });

  it('answers a burst of writes to the lockfile with one validation and one graph request', () => {
    const h = new Harness();
    h.findings.add(LOCKFILE);
    h.onDisk(LOCKFILE);
    h.timer.advance(SETTLE_MS - 1);
    h.onDisk(LOCKFILE);
    h.timer.advance(SETTLE_MS - 1);
    h.onDisk(LOCKFILE);
    // Still inside the window the last write opened.
    h.timer.advance(SETTLE_MS - 1);
    assert.deepStrictEqual(h.calls.filter((c) => c === 'revalidate' || c.startsWith('graph request')), []);
    h.timer.advance(1);
    assert.deepStrictEqual(h.calls, [
      `invalidate ${LOCKFILE}`, 'redraw',
      `invalidate ${LOCKFILE}`, 'redraw',
      `invalidate ${LOCKFILE}`, 'redraw',
      'revalidate', `graph request ${RELEASE}`,
    ]);
  });

  it('reads the panel and the Problems panel when the burst ends, not when it began', () => {
    const h = new Harness();
    h.shown = RELEASE;
    h.onDisk(LOCKFILE);
    // The graph is closed and the warning is filed while the write is settling.
    h.shown = null;
    h.findings.add(LOCKFILE);
    h.timer.advance(SETTLE_MS);
    assert.deepStrictEqual(h.calls, [
      `invalidate ${LOCKFILE}`, 'redraw', 'revalidate', `graph request ${RELEASE}`,
    ]);
  });

  it('does nothing further once the selection has moved to another Release', () => {
    const h = new Harness();
    h.findings.add(LOCKFILE);
    h.onDisk(LOCKFILE);
    h.release = OTHER_RELEASE;
    h.lockfile = OTHER_LOCKFILE;
    h.timer.advance(SETTLE_MS * 4);
    assert.deepStrictEqual(h.calls, [`invalidate ${LOCKFILE}`, 'redraw']);
  });

  it('ignores a lockfile that belongs to no selected Release, and one from another ecosystem', () => {
    const h = new Harness();
    h.findings.add(OTHER_LOCKFILE);
    h.onDisk(OTHER_LOCKFILE);
    h.onDisk('/work/gateway/Cargo.lock');
    h.release = null;
    h.lockfile = null;
    h.onDisk(LOCKFILE);
    h.timer.advance(SETTLE_MS * 4);
    assert.deepStrictEqual(h.calls, []);
  });
});

describe('when the Catalog panel reads its list again', () => {
  // The list is the compiler's entity index, whose first pass is the documents
  // the language server holds, so a read the server handles before it has
  // dropped a deleted file's entry still reports that file. Each case therefore
  // gives the invalidation's answer by hand and reads where the re-read landed
  // relative to it.

  it('reads it again for a document created, changed or deleted on disk', async () => {
    const seen: string[][] = [];
    for (const event of ['create', 'change', 'delete'] as const) {
      const h = new Harness();
      const watcher = new FakeWatcher();
      subscribeToWatcher(watcher, h.onDisk);
      watcher.fire(event, RECIPE);
      await h.answerAll();
      h.timer.advance(SETTLE_MS);
      seen.push([event, ...h.calls]);
    }
    assert.deepStrictEqual(seen, [
      ['create', `invalidate ${RECIPE}`, 'redraw', `answered ${RECIPE}`, 'catalog re-read'],
      ['change', `invalidate ${RECIPE}`, 'redraw', `answered ${RECIPE}`, 'catalog re-read'],
      ['delete', `invalidate ${RECIPE}`, 'redraw', `answered ${RECIPE}`, 'catalog re-read'],
    ]);
  });

  it('reads it only after the invalidation is answered, however long the answer takes', async () => {
    const h = new Harness();
    h.onDisk(RECIPE);
    h.timer.advance(SETTLE_MS * 4);
    assert.deepStrictEqual(h.calls, [`invalidate ${RECIPE}`, 'redraw']);
    await h.answer(RECIPE);
    // The window is counted from the answer, not from the event.
    h.timer.advance(SETTLE_MS - 1);
    assert.deepStrictEqual(h.calls, [`invalidate ${RECIPE}`, 'redraw', `answered ${RECIPE}`]);
    h.timer.advance(1);
    assert.deepStrictEqual(h.calls, [`invalidate ${RECIPE}`, 'redraw', `answered ${RECIPE}`, 'catalog re-read']);
  });

  it('reads it once for a burst, after the last invalidation of the burst is answered', async () => {
    const h = new Harness();
    h.onDisk(RECIPE);
    h.timer.advance(SETTLE_MS - 1);
    h.onDisk(COMPONENT);
    h.timer.advance(SETTLE_MS - 1);
    h.onDisk(AGGREGATE);
    // Answered out of order, and one left waiting: nothing is read while it
    // waits, however long that is.
    await h.answer(COMPONENT);
    await h.answer(RECIPE);
    h.timer.advance(SETTLE_MS * 4);
    await h.answer(AGGREGATE);
    h.timer.advance(SETTLE_MS * 4);
    assert.deepStrictEqual(h.calls, [
      `invalidate ${RECIPE}`, 'redraw',
      `invalidate ${COMPONENT}`, 'redraw',
      `invalidate ${AGGREGATE}`, 'redraw',
      `answered ${COMPONENT}`, `answered ${RECIPE}`, `answered ${AGGREGATE}`,
      'catalog re-read',
    ]);
  });

  it('holds the read back when a document is reported while it waits out the window', async () => {
    const h = new Harness();
    h.onDisk(RECIPE);
    await h.answer(RECIPE);
    h.timer.advance(SETTLE_MS - 1);
    h.onDisk(COMPONENT);
    h.timer.advance(SETTLE_MS * 4);
    await h.answer(COMPONENT);
    h.timer.advance(SETTLE_MS);
    assert.deepStrictEqual(h.calls, [
      `invalidate ${RECIPE}`, 'redraw', `answered ${RECIPE}`,
      `invalidate ${COMPONENT}`, 'redraw', `answered ${COMPONENT}`,
      'catalog re-read',
    ]);
  });

  it('reads it after a refused invalidation as after an answered one', async () => {
    const h = new Harness();
    h.onDisk(RECIPE);
    await h.refuse(RECIPE);
    h.timer.advance(SETTLE_MS);
    // And the next document is followed as usual.
    h.onDisk(COMPONENT);
    await h.answer(COMPONENT);
    h.timer.advance(SETTLE_MS);
    assert.deepStrictEqual(h.calls, [
      `invalidate ${RECIPE}`, 'redraw', `refused ${RECIPE}`, 'catalog re-read',
      `invalidate ${COMPONENT}`, 'redraw', `answered ${COMPONENT}`, 'catalog re-read',
    ]);
  });

  it('does not read it for the selected Release\'s lockfile, and a lockfile neither reads it nor holds it back', async () => {
    const h = new Harness();
    h.findings.add(LOCKFILE);
    h.onDisk(LOCKFILE);
    await h.answer(LOCKFILE);
    h.timer.advance(SETTLE_MS * 4);
    const lockfileAlone = [...h.calls];
    h.calls.length = 0;
    h.onDisk(RECIPE);
    await h.answer(RECIPE);
    h.timer.advance(SETTLE_MS - 1);
    h.onDisk(LOCKFILE);
    await h.answer(LOCKFILE);
    h.timer.advance(1);
    assert.deepStrictEqual([lockfileAlone, h.calls], [
      [`invalidate ${LOCKFILE}`, 'redraw', `answered ${LOCKFILE}`, 'revalidate', `graph request ${RELEASE}`],
      [`invalidate ${RECIPE}`, 'redraw', `answered ${RECIPE}`, `invalidate ${LOCKFILE}`, 'redraw', `answered ${LOCKFILE}`, 'catalog re-read'],
    ]);
  });
});

describe('which file is the selected Release\'s lockfile', () => {
  // The path is the one the language server named, compared by equality and
  // never composed here, so each case names a lockfile the Release's own name
  // would not lead to and reads back that it is exactly the one followed.

  it('follows the lockfile the language server named, wherever it sits', () => {
    const h = new Harness();
    h.release = 'envs/prod.yml';
    h.lockfile = '/work/gateway/pins/prod-pins.lock';
    h.findings.add('/work/gateway/pins/prod-pins.lock');
    h.onDisk('/work/gateway/pins/prod-pins.lock');
    h.timer.advance(SETTLE_MS);
    assert.deepStrictEqual(h.calls, [
      'invalidate /work/gateway/pins/prod-pins.lock', 'redraw', 'revalidate', 'graph request envs/prod.yml',
    ]);
  });

  it('follows nothing beside the Release that the language server did not name', () => {
    // The file a rule composed from the Release's name would pick: beside it,
    // with the extension replaced. The server named another, so this one is
    // someone else's and reaches nothing.
    const h = new Harness();
    h.release = 'envs/prod.yml';
    h.lockfile = '/work/gateway/pins/prod-pins.lock';
    h.findings.add('/work/gateway/envs/prod.lock');
    h.onDisk('/work/gateway/envs/prod.lock');
    h.timer.advance(SETTLE_MS * 4);
    assert.deepStrictEqual(h.calls, []);
  });

  it('follows no lockfile while no answer has named one, with a Release selected', () => {
    // A Release is selected and the answer it came from named no lockfile. The
    // lockfile is then not followed rather than guessed at; the documents still
    // are.
    const h = new Harness();
    h.lockfile = null;
    h.findings.add(LOCKFILE);
    h.onDisk(LOCKFILE);
    h.onDisk(RECIPE);
    h.timer.advance(SETTLE_MS * 4);
    assert.deepStrictEqual(h.calls, [`invalidate ${RECIPE}`, 'redraw']);
  });

  it('reads the lockfile named when the burst ends, not when it began', () => {
    // The selection's lockfile is read again as what follows a write runs, so an
    // answer that named another path while the write was settling decides it.
    const h = new Harness();
    h.findings.add(LOCKFILE);
    h.onDisk(LOCKFILE);
    h.lockfile = '/work/gateway/pins/compose-pins.lock';
    h.timer.advance(SETTLE_MS * 4);
    assert.deepStrictEqual(h.calls, [`invalidate ${LOCKFILE}`, 'redraw']);
  });
});
