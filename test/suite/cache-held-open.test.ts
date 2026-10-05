// A cache clean-up says what it left in place because another process has it
// open, and an answer naming nothing left adds not a word to what it reports.
//
// A platform that refuses to remove an open file makes a prune, a trim or a wipe
// leave some of what it was asked to remove. The compiler names each entry it
// left, or counts the files a wipe left in each cache, and the reader who ran the
// clean-up from the editor is told the same: the channel names or counts them,
// and the sentence the operation ends in says how many and that running it again
// once that process has finished removes them.
//
// Each case asserts the whole transcript — every channel line and the ending —
// rather than looking for a phrase. The cases naming nothing are the half that
// matters most: most platforms never refuse such a removal, so an ending that
// grew a sentence about files left in place when none were would be read by
// nearly every reader, and only an exact comparison catches it. Their expected
// lines carry no word about anything left in place, and they are asserted for
// each form an answer naming nothing can take: an empty list, null, a zero
// count, or the field left out.
//
// The module under test reaches the editor host at load time and never during a
// cache operation, so the host is stood in for at module load and nothing in the
// exercised path touches it.

import * as assert from 'assert';

import type {
  CacheClearResponse,
  CacheEvictResponse,
  CachePruneResponse,
  CacheRemoval,
} from '../../src/types';

// The editor host stood in for, so the module under test can be loaded outside
// the editor. Only module load reads it; the exercised path does not.
const editorHostStub = {
  window: {},
  workspace: { getConfiguration: () => ({ get: () => undefined }) },
  commands: {},
  Uri: {},
  ProgressLocation: { Notification: 15, Window: 10 },
};

type ModuleLoader = {
  _load: (request: string, ...rest: unknown[]) => unknown;
};

const nodeModule = require('module') as ModuleLoader;
const originalLoad = nodeModule._load;
nodeModule._load = function (this: unknown, request: string, ...rest: unknown[]): unknown {
  if (request === 'vscode') {
    return editorHostStub;
  }
  return originalLoad.apply(this, [request, ...rest]);
};

type PerformCacheOperation = (
  deps: unknown,
  operation: string,
  maxSize: string,
) => Promise<string>;

const { performCacheOperation } = require('../../src/operations') as {
  performCacheOperation: PerformCacheOperation;
};

// Transcript is everything a reader is shown: the channel lines in the order
// they were written, and the sentence the operation ends in, which the editor
// writes to the channel last and raises as the notification.
interface Transcript {
  lines: string[];
  ending: string;
}

async function transcriptOf(
  operation: string,
  answer: Record<string, unknown>,
  maxSize = '',
): Promise<Transcript> {
  const lines: string[] = [];
  const deps = {
    output: { appendLine: (line: string) => { lines.push(line); } },
    ...answer,
  };
  const ending = await performCacheOperation(deps, operation, maxSize);
  return { lines, ending };
}

const scope = { machineWideClasses: ['compiled-module cache'], workspaceRoot: '/w' };

const RENDERER: CacheRemoval = {
  class: 'compiled-module cache', label: 'renderer', reach: 'machine', size: 536870912, sizeText: '512.0 MiB',
};
const DESCRIBER: CacheRemoval = {
  class: 'compiled-module cache', label: 'describer', reach: 'machine', size: 2097152, sizeText: '2.0 MiB',
};
const DESCRIPTOR: CacheRemoval = {
  class: 'plugin-describe cache', label: 'describer@1.0.0', reach: 'machine', size: 4096, sizeText: '4.0 KiB',
};
const SMALL_MODULE: CacheRemoval = {
  class: 'compiled-module cache', label: 'renderer', reach: 'machine', size: 1048576, sizeText: '1.0 MiB',
};

// HeldForm is each way an answer can carry a list of entries left in place: the
// list itself, an empty list, null, or no field at all.
type HeldForm = CacheRemoval[] | null | 'absent';

function pruneAnswer(held: HeldForm): Record<string, unknown> {
  const answer: Omit<CachePruneResponse, 'heldOpen'> & { heldOpen?: CacheRemoval[] | null } = {
    removed: [RENDERER],
    retainedCount: 2,
    reclaimedBytes: 536870912,
    reclaimedBytesText: '512.0 MiB',
    unattributedCount: 1,
    unattributedSize: 1048576,
    unattributedSizeText: '1.0 MiB',
    notPruneEligible: [{
      class: 'fetched artifacts', count: 3, size: 104857600, sizeText: '100.0 MiB', reach: 'workspace', reclaimedBy: ['clear'],
    }],
    scope,
  };
  if (held !== 'absent') { answer.heldOpen = held; }
  return { cachePrune: async () => answer };
}

function evictAnswer(held: HeldForm): Record<string, unknown> {
  const answer: Omit<CacheEvictResponse, 'heldOpen'> & { heldOpen?: CacheRemoval[] | null } = {
    withinCapBefore: false,
    removed: [SMALL_MODULE],
    totalBefore: 2147483648,
    totalBeforeText: '2.0 GiB',
    reclaimedBytes: 1048576,
    reclaimedBytesText: '1.0 MiB',
    remainingBytes: 1073741824,
    remainingBytesText: '1.0 GiB',
    capBytes: 1073741824,
    capBytesText: '1.0 GiB',
    scope,
  };
  if (held !== 'absent') { answer.heldOpen = held; }
  return { cacheEvict: async () => answer };
}

// ClearedHeld is what one cleared cache says it left: a count with its size, a
// zero, null, or nothing at all.
type ClearedHeld = { files: number; bytes: number; text: string } | 'zero' | 'null' | 'absent';

function clearAnswer(compiled: ClearedHeld, entities: ClearedHeld): Record<string, unknown> {
  const cleared = (name: string, reach: string, size: number, sizeText: string, held: ClearedHeld): Record<string, unknown> => {
    const c: Record<string, unknown> = { class: name, reach, size, sizeText };
    if (held === 'zero') { Object.assign(c, { heldOpenFiles: 0, heldOpenBytes: 0, heldOpenBytesText: '0 B' }); }
    if (held === 'null') { Object.assign(c, { heldOpenFiles: null, heldOpenBytes: null, heldOpenBytesText: null }); }
    if (typeof held === 'object') { Object.assign(c, { heldOpenFiles: held.files, heldOpenBytes: held.bytes, heldOpenBytesText: held.text }); }
    return c;
  };
  const answer = {
    cleared: [
      cleared('compiled-module cache', 'machine', 536870912, '512.0 MiB', compiled),
      cleared('entities', 'workspace', 1048576, '1.0 MiB', entities),
    ],
    reclaimedBytes: 537919488,
    reclaimedBytesText: '513.0 MiB',
    scope,
  } as unknown as CacheClearResponse;
  return { cacheClear: async () => answer };
}

// The transcripts an answer naming nothing left in place produces: the same
// lines and ending as the cases above with the held-open lines and sentence
// taken out, and nothing else.
const PRUNE_NAMING_NONE: Transcript = {
  lines: [
    '\nRemoving cache entries no lockfile references.',
    '  removed compiled-module cache: renderer (machine)  512.0 MiB',
    '  kept, still referenced: 2 entries',
    '  attributed to no lockfile either way: 1 entry, 1.0 MiB',
    '  left in fetched artifacts (workspace): 3 entries, 100.0 MiB — reclaimed by clear',
    '  Reached beyond this workspace, shared by every project on this machine: compiled-module cache.',
    '  Workspace: /w',
  ],
  ending: 'removed 1 entry and reclaimed 512.0 MiB.',
};
const EVICT_NAMING_NONE: Transcript = {
  lines: [
    '\nTrimming the compiled-module cache to the size cap.',
    '  removed compiled-module cache: renderer (machine)  1.0 MiB',
    '  held before: 2.0 GiB',
    '  holds now: 1.0 GiB, under a cap of 1.0 GiB',
    '  Reached beyond this workspace, shared by every project on this machine: compiled-module cache.',
    '  Workspace: /w',
  ],
  ending: 'removed 1 entry and reclaimed 1.0 MiB.',
};
const CLEAR_NAMING_NONE: Transcript = {
  lines: [
    '\nEmptying every cache this session addresses.',
    '  emptied compiled-module cache (machine)  512.0 MiB',
    '  emptied entities (workspace)  1.0 MiB',
    '  Reached beyond this workspace, shared by every project on this machine: compiled-module cache.',
    '  Workspace: /w',
  ],
  ending: 'emptied 2 caches and reclaimed 513.0 MiB. They repopulate on the next build.',
};

describe('a cache clean-up names what it left in place because another process has it open', () => {
  it('a prune names each entry it left after what it removed, and its ending says how many and to run it again', async () => {
    const got = await transcriptOf('prune', pruneAnswer([DESCRIBER, DESCRIPTOR]));

    assert.deepStrictEqual(got, {
      lines: [
        '\nRemoving cache entries no lockfile references.',
        '  removed compiled-module cache: renderer (machine)  512.0 MiB',
        '  left in place compiled-module cache: describer (machine)  2.0 MiB — open in another process',
        '  left in place plugin-describe cache: describer@1.0.0 (machine)  4.0 KiB — open in another process',
        '  kept, still referenced: 2 entries',
        '  attributed to no lockfile either way: 1 entry, 1.0 MiB',
        '  left in fetched artifacts (workspace): 3 entries, 100.0 MiB — reclaimed by clear',
        '  Reached beyond this workspace, shared by every project on this machine: compiled-module cache.',
        '  Workspace: /w',
      ],
      ending: 'removed 1 entry and reclaimed 512.0 MiB. 2 entries were left in place because another process has them open; run the prune again once that process has finished. The Aggrega output channel names them.',
    });
  });

  it('a prune that left one entry says so in the singular', async () => {
    const got = await transcriptOf('prune', pruneAnswer([DESCRIBER]));

    assert.strictEqual(
      got.ending,
      'removed 1 entry and reclaimed 512.0 MiB. 1 entry was left in place because another process has it open; run the prune again once that process has finished. The Aggrega output channel names it.',
    );
    assert.deepStrictEqual(
      got.lines.filter((l) => l.startsWith('  left in place ')),
      ['  left in place compiled-module cache: describer (machine)  2.0 MiB — open in another process'],
    );
  });

  it('a trim names each entry it left after what it removed, and its ending says how many and to run it again', async () => {
    const got = await transcriptOf('evict', evictAnswer([DESCRIBER, RENDERER]), '1GiB');

    assert.deepStrictEqual(got, {
      lines: [
        '\nTrimming the compiled-module cache to the size cap.',
        '  removed compiled-module cache: renderer (machine)  1.0 MiB',
        '  left in place compiled-module cache: describer (machine)  2.0 MiB — open in another process',
        '  left in place compiled-module cache: renderer (machine)  512.0 MiB — open in another process',
        '  held before: 2.0 GiB',
        '  holds now: 1.0 GiB, under a cap of 1.0 GiB',
        '  Reached beyond this workspace, shared by every project on this machine: compiled-module cache.',
        '  Workspace: /w',
      ],
      ending: 'removed 1 entry and reclaimed 1.0 MiB. 2 entries were left in place because another process has them open; run the trim again once that process has finished. The Aggrega output channel names them.',
    });
  });

  it('a wipe counts the files it left under the cache they are in, and its ending totals them', async () => {
    const got = await transcriptOf('clear', clearAnswer({ files: 3, bytes: 6291456, text: '6.0 MiB' }, 'zero'));

    assert.deepStrictEqual(got, {
      lines: [
        '\nEmptying every cache this session addresses.',
        '  emptied compiled-module cache (machine)  512.0 MiB',
        '    left in place: 3 files, 6.0 MiB — open in another process',
        '  emptied entities (workspace)  1.0 MiB',
        '  Reached beyond this workspace, shared by every project on this machine: compiled-module cache.',
        '  Workspace: /w',
      ],
      ending: 'emptied 2 caches and reclaimed 513.0 MiB. They repopulate on the next build. 3 files were left in place because another process has them open; run the cache wipe again once that process has finished. The Aggrega output channel gives the count for each cache.',
    });
  });

  it('a wipe that left files in two caches counts each under its own and totals both', async () => {
    const got = await transcriptOf(
      'clear',
      clearAnswer({ files: 1, bytes: 1048576, text: '1.0 MiB' }, { files: 1, bytes: 4096, text: '4.0 KiB' }),
    );

    assert.deepStrictEqual(
      got.lines.filter((l) => l.startsWith('    left in place: ')),
      ['    left in place: 1 file, 1.0 MiB — open in another process', '    left in place: 1 file, 4.0 KiB — open in another process'],
    );
    assert.strictEqual(
      got.ending,
      'emptied 2 caches and reclaimed 513.0 MiB. They repopulate on the next build. 2 files were left in place because another process has them open; run the cache wipe again once that process has finished. The Aggrega output channel gives the count for each cache.',
    );
  });
});

describe('a cache clean-up naming nothing left in place adds not a word about it', () => {
  const pruneForms: [string, HeldForm][] = [['an empty list', []], ['null', null], ['no field', 'absent']];
  for (const [form, held] of pruneForms) {
    it(`a prune whose answer carries ${form} for what it left`, async () => {
      assert.deepStrictEqual(await transcriptOf('prune', pruneAnswer(held)), PRUNE_NAMING_NONE);
    });
    it(`a trim whose answer carries ${form} for what it left`, async () => {
      assert.deepStrictEqual(await transcriptOf('evict', evictAnswer(held), '1GiB'), EVICT_NAMING_NONE);
    });
  }

  const clearForms: [string, ClearedHeld][] = [['a zero count', 'zero'], ['null', 'null'], ['no field', 'absent']];
  for (const [form, held] of clearForms) {
    it(`a wipe whose answer carries ${form} for the files it left`, async () => {
      assert.deepStrictEqual(await transcriptOf('clear', clearAnswer(held, held)), CLEAR_NAMING_NONE);
    });
  }
});
