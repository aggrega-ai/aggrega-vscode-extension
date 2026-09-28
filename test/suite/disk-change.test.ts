// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  DiskChangeDeps,
  ON_DISK_PATTERN,
  WATCHED_EXTENSIONS,
  createDiskChangeHandler,
  diskChangeKind,
  lockfileOf,
} from '../../src/disk-change';

// What the on-disk watcher does with each file it reports, driven with no editor
// and no server: a Problems panel held as a set of files, a graph panel that is
// closed or showing one Release, and a clock that moves only when the test moves
// it. Every call the handler makes is recorded in order and read back by
// equality.

const SETTLE_MS = 300;
const ROOT = '/work/gateway';
const RELEASE = 'release-compose.yaml';
const OTHER_RELEASE = 'release-prod.yaml';
const LOCKFILE = '/work/gateway/release-compose.lock';
const RECIPE = '/work/gateway/catalog/recipe/compose/nginx-probed/1.0.0/recipe.yaml';

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
  release: string | null = RELEASE;
  root: string | null = ROOT;
  readonly onDisk: (file: string) => void;

  constructor() {
    const deps: DiskChangeDeps = {
      invalidate: (file) => { this.calls.push(`invalidate ${file}`); },
      redraw: () => { this.calls.push('redraw'); },
      revalidate: () => { this.calls.push('revalidate'); },
      shownRelease: () => this.shown,
      findingStands: (file) => this.findings.has(file),
      selectedRelease: () => this.release,
      workspaceRoot: () => this.root,
      requestGraph: (release) => { this.calls.push(`graph request ${release}`); },
      timer: this.timer,
      settleMs: () => SETTLE_MS,
    };
    this.onDisk = createDiskChangeHandler(deps);
  }
}

describe('where a Release\'s lockfile sits', () => {
  // The cases the compiler's own rule is tested against, so this copy of the
  // rule is held to the same answers.
  const cases: Array<[string, string, string]> = [
    ['yaml extension', '/workspace/release.yaml', '/workspace/release.lock'],
    ['yml extension', '/workspace/release.yml', '/workspace/release.lock'],
    ['no extension', '/workspace/release', '/workspace/release.lock'],
    ['other extension', '/workspace/release.txt', '/workspace/release.txt.lock'],
    ['nested path', '/a/b/c/release.yaml', '/a/b/c/release.lock'],
    ['relative path', 'release.yaml', 'release.lock'],
  ];
  for (const [name, release, want] of cases) {
    it(`is named for the Release: ${name}`, () => {
      assert.strictEqual(lockfileOf(release), want);
    });
  }
});

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
  it('drops the document\'s entry and redraws, and asks nothing else', () => {
    const h = new Harness();
    h.findings.add(LOCKFILE);
    h.onDisk(RECIPE);
    h.timer.advance(SETTLE_MS * 4);
    assert.deepStrictEqual(h.calls, [`invalidate ${RECIPE}`, 'redraw']);
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
    h.timer.advance(SETTLE_MS * 4);
    assert.deepStrictEqual(h.calls, [`invalidate ${LOCKFILE}`, 'redraw']);
  });

  it('ignores a lockfile that belongs to no selected Release, and one from another ecosystem', () => {
    const h = new Harness();
    h.findings.add('/work/gateway/release-prod.lock');
    h.onDisk('/work/gateway/release-prod.lock');
    h.onDisk('/work/gateway/Cargo.lock');
    h.release = null;
    h.onDisk(LOCKFILE);
    h.timer.advance(SETTLE_MS * 4);
    assert.deepStrictEqual(h.calls, []);
  });

  it('places a Release in a subdirectory against the root the language server reported', () => {
    const h = new Harness();
    h.release = 'envs/prod.yml';
    h.findings.add('/work/gateway/envs/prod.lock');
    h.onDisk('/work/gateway/envs/prod.lock');
    h.timer.advance(SETTLE_MS);
    assert.deepStrictEqual(h.calls, [
      'invalidate /work/gateway/envs/prod.lock', 'redraw', 'revalidate', 'graph request envs/prod.yml',
    ]);
  });
});
