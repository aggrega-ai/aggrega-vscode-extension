// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  ConfigurationWatch,
  configurationChangedWarning,
  createConfigurationWatch,
  deferredChangeLine,
  ownWriteRestartLine,
  ownWriteRestartTitle,
  watchedConfigurationFiles,
  watchingLine,
  writtenFile,
} from '../../src/config-change-watch';

// The decision half of the configuration watch, driven with no editor and no
// server: a disk held in memory, watchers that fire when told to, a warning that
// stays on screen until the test closes it, and a clock that moves only when the
// test moves it. Every order of events a real editor can produce is produced here
// by hand, and every outcome is read back by equality.

const SETTLE_MS = 300;
const GLOBAL = '/home/reader/.config/aggrega/config.yaml';
const WORKSPACE = '/work/project/.aggrega-config.yaml';

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

// Harness is one extension's worth of surroundings around one watch.
class Harness {
  readonly timer = new FakeTimer();
  readonly disk = new Map<string, string>();
  layers: unknown = [WORKSPACE];
  running = true;
  // Every file a watcher was created for, in the order the watch asked.
  readonly armed: string[] = [];
  // Every warning raised, by the file it named.
  readonly warned: string[] = [];
  // Every restart the watch asked for after a write, by the file it named.
  readonly restarts: string[] = [];
  reads = 0;
  // Every line the watch wrote to the output channel.
  readonly logs: string[] = [];
  // duringRestart runs inside the restart, before the restarted server becomes
  // answerable — the window in which a late report of the write can land.
  duringRestart: (() => Promise<void>) | null = null;
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly closers = new Map<string, () => void>();
  readonly watch: ConfigurationWatch;

  constructor() {
    this.watch = createConfigurationWatch({
      readLayers: async () => this.layers,
      watchFile: (file, onEvent) => {
        this.armed.push(file);
        const set = this.listeners.get(file) ?? new Set<() => void>();
        set.add(onEvent);
        this.listeners.set(file, set);
        return { dispose: () => { set.delete(onEvent); } };
      },
      readContent: async (file) => {
        this.reads += 1;
        return this.disk.has(file) ? this.disk.get(file) as string : null;
      },
      warn: (file) => {
        this.warned.push(file);
        return new Promise<void>((resolve) => { this.closers.set(file, resolve); });
      },
      restartForWrite: async (file) => {
        this.restarts.push(file);
        if (this.duringRestart) { await this.duringRestart(); }
        // The restarted server becoming answerable is the rising edge the
        // extension re-arms the watch on; it happens inside the restart.
        void this.watch.reload();
      },
      isServerRunning: () => this.running,
      timer: this.timer,
      settleMs: () => SETTLE_MS,
      log: (line) => { this.logs.push(line); },
    });
  }

  // fire reports a change to one file, as the editor's watcher would.
  fire(file: string): void {
    for (const listener of [...(this.listeners.get(file) ?? [])]) { listener(); }
  }

  // settle lets a quiet period pass and every judgement it made due complete.
  async settle(): Promise<void> {
    this.timer.advance(SETTLE_MS);
    await this.watch.idle();
  }

  // dismiss closes the warning on screen for one file.
  async dismiss(file: string): Promise<void> {
    this.closers.get(file)?.();
    this.closers.delete(file);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

// answer is a write's answer naming the file it landed in, shaped as the
// configuration-writing requests answer.
function answer(file: string): { scope: { configFile: string } } {
  return { scope: { configFile: file } };
}

async function armedOver(content: string): Promise<Harness> {
  const h = new Harness();
  h.disk.set(WORKSPACE, content);
  await h.watch.reload();
  return h;
}

describe('which reported layers are watched', () => {
  it('keeps the entries that are file paths, in the reported order and each once', () => {
    assert.deepStrictEqual(
      watchedConfigurationFiles([
        GLOBAL,
        WORKSPACE,
        'env:AGGREGA_OFFLINE',
        '--offline',
        'relative-global.yaml',
        7,
        null,
        GLOBAL,
      ]),
      [GLOBAL, WORKSPACE],
    );
  });

  it('watches nothing where the answer carries no list', () => {
    assert.deepStrictEqual(watchedConfigurationFiles(undefined), []);
    assert.deepStrictEqual(watchedConfigurationFiles({ layers: [WORKSPACE] }), []);
    assert.deepStrictEqual(watchedConfigurationFiles([]), []);
  });

  it('arms a watcher for each reported file and none for an environment entry', async () => {
    const h = new Harness();
    h.layers = [GLOBAL, WORKSPACE, 'env:AGGREGA_OFFLINE'];
    await h.watch.reload();
    assert.deepStrictEqual(h.watch.watched(), [GLOBAL, WORKSPACE]);
    assert.deepStrictEqual(h.armed, [GLOBAL, WORKSPACE]);
  });

  it('re-reads the set on every re-arm, so a server that read another set is watched over it', async () => {
    const h = await armedOver('workspace: {}\n');
    h.disk.set(GLOBAL, 'auto_pull: false\n');
    h.layers = [GLOBAL, WORKSPACE];
    await h.watch.reload();
    assert.deepStrictEqual(h.watch.watched(), [GLOBAL, WORKSPACE]);

    h.layers = [GLOBAL];
    await h.watch.reload();
    assert.deepStrictEqual(h.watch.watched(), [GLOBAL]);
    // A file the server no longer reports is no longer watched.
    h.disk.set(WORKSPACE, 'workspace: {catalog_dirs: [./more]}\n');
    h.fire(WORKSPACE);
    await h.settle();
    assert.deepStrictEqual(h.warned, []);
  });

  it('reads the file a write landed in off the answer', () => {
    assert.strictEqual(writtenFile({ configFile: WORKSPACE }), WORKSPACE);
    assert.strictEqual(writtenFile({ configFile: '' }), null);
    assert.strictEqual(writtenFile(undefined), null);
  });
});

describe('a change the extension did not make', () => {
  it('raises one warning for a burst of writes to one file, naming the file', async () => {
    const h = await armedOver('workspace: {}\n');
    h.reads = 0;
    h.disk.set(WORKSPACE, 'workspace:\n');
    h.fire(WORKSPACE);
    h.timer.advance(SETTLE_MS / 2);
    h.disk.set(WORKSPACE, 'workspace:\n  catalog_dirs: [./no-such-catalog]\n');
    h.fire(WORKSPACE);
    h.timer.advance(SETTLE_MS / 2);
    h.fire(WORKSPACE);
    await h.settle();
    assert.deepStrictEqual(h.warned, [WORKSPACE]);
    // One judgement for the whole burst, so one read of the file.
    assert.strictEqual(h.reads, 1);
  });

  it('warns about a deletion, and says nothing when the file comes back as the server read it', async () => {
    const h = await armedOver('workspace: {}\n');
    h.disk.delete(WORKSPACE);
    h.fire(WORKSPACE);
    await h.settle();
    assert.deepStrictEqual(h.warned, [WORKSPACE]);
    await h.dismiss(WORKSPACE);
    h.disk.set(WORKSPACE, 'workspace: {}\n');
    h.fire(WORKSPACE);
    await h.settle();
    assert.deepStrictEqual(h.warned, [WORKSPACE]);
  });

  it('does not raise it again while it is open, nor after dismissal until the file changes again', async () => {
    const h = await armedOver('workspace: {}\n');
    h.disk.set(WORKSPACE, 'first edit\n');
    h.fire(WORKSPACE);
    await h.settle();
    h.disk.set(WORKSPACE, 'second edit\n');
    h.fire(WORKSPACE);
    await h.settle();
    assert.deepStrictEqual(h.warned, [WORKSPACE]);

    await h.dismiss(WORKSPACE);
    // A report that changes nothing — a save of the same bytes.
    h.fire(WORKSPACE);
    await h.settle();
    assert.deepStrictEqual(h.warned, [WORKSPACE]);

    h.disk.set(WORKSPACE, 'third edit\n');
    h.fire(WORKSPACE);
    await h.settle();
    assert.deepStrictEqual(h.warned, [WORKSPACE, WORKSPACE]);
  });

  it('raises it again after a restart, for a change the restarted server has not read', async () => {
    const h = await armedOver('workspace: {}\n');
    h.disk.set(WORKSPACE, 'first edit\n');
    h.fire(WORKSPACE);
    await h.settle();
    // The restart re-arms over what the restarted server read.
    await h.watch.reload();
    h.fire(WORKSPACE);
    await h.settle();
    assert.deepStrictEqual(h.warned, [WORKSPACE]);
    h.disk.set(WORKSPACE, 'second edit\n');
    h.fire(WORKSPACE);
    await h.settle();
    assert.deepStrictEqual(h.warned, [WORKSPACE, WORKSPACE]);
  });

  it('warns about each watched file on its own', async () => {
    const h = new Harness();
    h.disk.set(GLOBAL, 'auto_pull: false\n');
    h.disk.set(WORKSPACE, 'workspace: {}\n');
    h.layers = [GLOBAL, WORKSPACE];
    await h.watch.reload();
    h.disk.set(GLOBAL, 'auto_pull: true\n');
    h.fire(GLOBAL);
    await h.settle();
    h.disk.set(WORKSPACE, 'workspace:\n');
    h.fire(WORKSPACE);
    await h.settle();
    assert.deepStrictEqual(h.warned, [GLOBAL, WORKSPACE]);
  });

  it('says nothing while no server is running, and nothing once the watch is disarmed', async () => {
    const h = await armedOver('workspace: {}\n');
    h.running = false;
    h.disk.set(WORKSPACE, 'an edit\n');
    h.fire(WORKSPACE);
    await h.settle();
    assert.deepStrictEqual(h.warned, []);

    h.running = true;
    h.watch.disarm();
    assert.deepStrictEqual(h.watch.watched(), []);
    h.disk.set(WORKSPACE, 'another edit\n');
    h.fire(WORKSPACE);
    await h.settle();
    assert.deepStrictEqual(h.warned, []);
  });
});

describe('a write the extension makes itself', () => {
  it('raises no warning when the change is reported before the write is answered', async () => {
    const h = await armedOver('workspace: {}\n');
    const result = await h.watch.ownWrite(async () => {
      h.disk.set(WORKSPACE, 'registries: [registry.invalid]\n');
      h.fire(WORKSPACE);
      await h.settle();
      return answer(WORKSPACE);
    }, (r) => writtenFile(r.scope));
    await h.settle();
    assert.deepStrictEqual(result, answer(WORKSPACE));
    assert.deepStrictEqual(h.warned, []);
    assert.deepStrictEqual(h.restarts, [WORKSPACE]);
    // The report did arrive, and was held back rather than lost.
    assert.deepStrictEqual(
      h.logs.filter((line) => line === deferredChangeLine(WORKSPACE)),
      [deferredChangeLine(WORKSPACE)],
    );
  });

  it('raises no warning when the change is reported after the answer, during the restart', async () => {
    const h = await armedOver('workspace: {}\n');
    h.duringRestart = async () => {
      h.fire(WORKSPACE);
      await h.settle();
    };
    await h.watch.ownWrite(async () => {
      h.disk.set(WORKSPACE, 'registries: [registry.invalid]\n');
      return answer(WORKSPACE);
    }, (r) => writtenFile(r.scope));
    await h.settle();
    assert.deepStrictEqual(h.warned, []);
    assert.deepStrictEqual(h.restarts, [WORKSPACE]);
  });

  it('raises no warning when the change is reported after the restarted server is watched', async () => {
    const h = await armedOver('workspace: {}\n');
    await h.watch.ownWrite(async () => {
      h.disk.set(WORKSPACE, 'registries: [registry.invalid]\n');
      return answer(WORKSPACE);
    }, (r) => writtenFile(r.scope));
    h.fire(WORKSPACE);
    await h.settle();
    assert.deepStrictEqual(h.warned, []);
    assert.deepStrictEqual(h.restarts, [WORKSPACE]);
    // And the watch goes on reporting a change the extension did not make.
    h.disk.set(WORKSPACE, 'a hand edit\n');
    h.fire(WORKSPACE);
    await h.settle();
    assert.deepStrictEqual(h.warned, [WORKSPACE]);
  });

  it('restarts for a file the running server never read, which is then watched', async () => {
    const h = await armedOver('workspace: {}\n');
    await h.watch.ownWrite(async () => {
      h.disk.set(GLOBAL, 'registries: [registry.invalid]\n');
      // The restarted server reports the file it now reads.
      h.layers = [GLOBAL, WORKSPACE];
      return answer(GLOBAL);
    }, (r) => writtenFile(r.scope));
    assert.deepStrictEqual(h.restarts, [GLOBAL]);
    assert.deepStrictEqual(h.watch.watched(), [GLOBAL, WORKSPACE]);
  });

  it('reports a change it deferred when the write failed and nothing was restarted', async () => {
    const h = await armedOver('workspace: {}\n');
    await assert.rejects(h.watch.ownWrite(async () => {
      h.disk.set(WORKSPACE, 'half written\n');
      h.fire(WORKSPACE);
      await h.settle();
      throw new Error('the compiler refused the write');
    }, () => WORKSPACE), /refused/);
    await h.settle();
    assert.deepStrictEqual(h.restarts, []);
    assert.deepStrictEqual(h.warned, [WORKSPACE]);
  });

  it('does not restart for a write that wrote nothing', async () => {
    const h = await armedOver('workspace: {}\n');
    await h.watch.ownWrite(async () => answer(WORKSPACE), () => null);
    assert.deepStrictEqual(h.restarts, []);
  });

  it('does not restart a server the write itself started, which has read it already', async () => {
    const h = new Harness();
    h.running = false;
    h.layers = [];
    await h.watch.reload();
    await h.watch.ownWrite(async () => {
      h.disk.set(WORKSPACE, 'workspace: {}\n');
      // The write's own re-attachment starts a server over the new file.
      h.running = true;
      h.layers = [WORKSPACE];
      void h.watch.reload();
      return true;
    }, () => WORKSPACE);
    assert.deepStrictEqual(h.restarts, []);
    assert.deepStrictEqual(h.watch.watched(), [WORKSPACE]);
    h.fire(WORKSPACE);
    await h.settle();
    assert.deepStrictEqual(h.warned, []);
  });

  it('does not restart where no server is running to restart', async () => {
    const h = await armedOver('workspace: {}\n');
    h.running = false;
    await h.watch.ownWrite(async () => {
      h.disk.set(WORKSPACE, 'workspace:\n');
      return answer(WORKSPACE);
    }, (r) => writtenFile(r.scope));
    assert.deepStrictEqual(h.restarts, []);
  });
});

describe('what the reader is told', () => {
  it('names the file and why the change is not yet in force', () => {
    assert.strictEqual(
      configurationChangedWarning(WORKSPACE),
      'Aggrega: /work/project/.aggrega-config.yaml changed. The language server reads its '
      + 'configuration when it starts, so restart it to pick up the change.',
    );
  });

  it('tells the output channel which files are watched, and a change it held back', () => {
    assert.strictEqual(
      watchingLine([GLOBAL, WORKSPACE]),
      'watching the configuration files the language server read: '
      + '/home/reader/.config/aggrega/config.yaml, /work/project/.aggrega-config.yaml.',
    );
    assert.strictEqual(
      watchingLine([]),
      'the language server read no configuration file, so no configuration change is watched for.',
    );
    assert.strictEqual(
      deferredChangeLine(WORKSPACE),
      '/work/project/.aggrega-config.yaml changed while the extension was writing configuration; '
      + 'the change is judged once the language server has read that write.',
    );
  });

  it('says once, while it happens, that the server is restarted to read a write', () => {
    assert.strictEqual(
      ownWriteRestartTitle(GLOBAL),
      'Aggrega: restarting the language server so it reads /home/reader/.config/aggrega/config.yaml',
    );
    assert.strictEqual(
      ownWriteRestartLine(GLOBAL),
      'restarted the language server so it reads /home/reader/.config/aggrega/config.yaml, '
      + 'which the change just made wrote.',
    );
  });
});
