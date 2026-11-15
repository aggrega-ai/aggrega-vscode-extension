// A cache size reaches the reader spelled the way the compiler spelled it.
//
// The compiler renders every size it reports and sends that rendering beside the
// measured byte count. This surface prints the rendering and never composes one:
// the compiler reads its own spelling back, and this surface asks for a size cap
// in the same vocabulary, so a figure a reader copies out of a cache report and
// types into the trim prompt has to be one the compiler accepts.
//
// Each case below therefore asserts twice, and the negative is the half that
// matters. A surface that quietly went back to composing its own figure would
// still print something size-shaped in the right place, so an assertion that
// only looked for a plausible size would keep passing. What cannot survive the
// regression is the absence of the raw byte count and of the word that spelled
// it, which is what the negatives pin down.
//
// The module under test reaches the editor host at load time and never during a
// cache operation — it writes through the output channel it is handed, and the
// four cache calls are supplied. So the host is stood in for at module load and
// nothing in the exercised path touches it.

import * as assert from 'assert';

import type {
  CacheClearResponse,
  CacheEvictResponse,
  CachePruneResponse,
  CacheStatusResponse,
} from '../../src/types';
import { loadAgainstEditorStub } from '../helpers/editor-stub';

// The editor host stood in for, so the module under test can be loaded outside
// the editor. Only module load reads it; the exercised path does not.
const editorHostStub = {
  window: {},
  workspace: { getConfiguration: () => ({ get: () => undefined }) },
  commands: {},
  Uri: {},
  ProgressLocation: { Notification: 15, Window: 10 },
};

type PerformCacheOperation = (
  deps: unknown,
  operation: string,
  maxSize: string,
) => Promise<string>;

const { performCacheOperation } = loadAgainstEditorStub<{
  performCacheOperation: PerformCacheOperation;
}>(editorHostStub, 'operations');

// Every size below pairs a byte count with the rendering the compiler produces
// for that exact count, so a fixture cannot drift into asserting a spelling the
// compiler would never send.
const HALF_GIB = 536870912;
const HALF_GIB_TEXT = '512.0 MiB';
const ONE_GIB = 1073741824;
const ONE_GIB_TEXT = '1.0 GiB';
const TWO_GIB = 2147483648;
const TWO_GIB_TEXT = '2.0 GiB';
const HUNDRED_MIB = 104857600;
const HUNDRED_MIB_TEXT = '100.0 MiB';
const ONE_MIB = 1048576;
const ONE_MIB_TEXT = '1.0 MiB';

const scope = { machineWideClasses: ['compiled modules'], workspaceRoot: '/w' };

// captureOperation runs one cache operation against a supplied answer and
// returns everything the reader would see: the channel lines and the sentence
// the operation ends in.
async function captureOperation(
  operation: string,
  answer: Record<string, unknown>,
  maxSize = '',
): Promise<string> {
  const lines: string[] = [];
  const deps = {
    output: { appendLine: (line: string) => { lines.push(line); } },
    ...answer,
  };
  const ending = await performCacheOperation(deps, operation, maxSize);
  return [...lines, ending].join('\n');
}

// assertSpelledByCompiler is the paired check every case makes: each rendering
// the answer carried reaches the reader intact, and neither the raw count it was
// rendered from nor the word a locally-composed figure used survives anywhere.
function assertSpelledByCompiler(
  transcript: string,
  renderings: string[],
  rawCounts: number[],
): void {
  for (const rendering of renderings) {
    assert.ok(
      transcript.includes(rendering),
      `expected the compiler's own spelling ${rendering} in:\n${transcript}`,
    );
  }
  for (const count of rawCounts) {
    assert.ok(
      !transcript.includes(String(count)),
      `raw byte count ${count} reached the reader in:\n${transcript}`,
    );
  }
  assert.ok(
    !transcript.includes('bytes'),
    `a size was spelled on this side rather than the compiler's in:\n${transcript}`,
  );
}

describe('cache sizes are spelled the way the compiler spelled them', () => {
  it('a cache report prints each entry size and the total as sent', async () => {
    const answer: CacheStatusResponse = {
      classes: [{
        name: 'compiled modules',
        reach: 'every project on this machine',
        prunable: false,
        elements: [{ label: 'renderer', size: HALF_GIB, sizeText: HALF_GIB_TEXT }],
      }],
      provenance: [],
      totalCount: 1,
      totalSize: ONE_GIB,
      totalSizeText: ONE_GIB_TEXT,
      scope,
    };

    const transcript = await captureOperation('status', { cacheStatus: async () => answer });

    assertSpelledByCompiler(transcript, [HALF_GIB_TEXT, ONE_GIB_TEXT], [HALF_GIB, ONE_GIB]);
  });

  it('a prune prints what it removed, what it could not attribute, and what it left', async () => {
    const answer: CachePruneResponse = {
      removed: [{
        class: 'compiled modules',
        label: 'renderer',
        reach: 'every project on this machine',
        size: HALF_GIB,
        sizeText: HALF_GIB_TEXT,
      }],
      heldOpen: [],
      retainedCount: 2,
      reclaimedBytes: ONE_GIB,
      reclaimedBytesText: ONE_GIB_TEXT,
      unattributedCount: 1,
      unattributedSize: ONE_MIB,
      unattributedSizeText: ONE_MIB_TEXT,
      notPruneEligible: [{
        class: 'fetched artifacts',
        count: 3,
        size: HUNDRED_MIB,
        sizeText: HUNDRED_MIB_TEXT,
        reach: 'this workspace',
        reclaimedBy: ['clear'],
      }],
      scope,
    };

    const transcript = await captureOperation('prune', { cachePrune: async () => answer });

    assertSpelledByCompiler(
      transcript,
      [HALF_GIB_TEXT, ONE_GIB_TEXT, ONE_MIB_TEXT, HUNDRED_MIB_TEXT],
      [HALF_GIB, ONE_GIB, ONE_MIB, HUNDRED_MIB],
    );
  });

  it('a trim prints the sizes it held, holds and was capped at', async () => {
    const answer: CacheEvictResponse = {
      withinCapBefore: false,
      removed: [{
        class: 'compiled modules',
        label: 'renderer',
        reach: 'every project on this machine',
        size: ONE_MIB,
        sizeText: ONE_MIB_TEXT,
      }],
      heldOpen: [],
      totalBefore: TWO_GIB,
      totalBeforeText: TWO_GIB_TEXT,
      reclaimedBytes: HALF_GIB,
      reclaimedBytesText: HALF_GIB_TEXT,
      remainingBytes: ONE_GIB,
      remainingBytesText: ONE_GIB_TEXT,
      capBytes: HUNDRED_MIB,
      capBytesText: HUNDRED_MIB_TEXT,
      scope,
    };

    const transcript = await captureOperation(
      'evict',
      { cacheEvict: async () => answer },
      HUNDRED_MIB_TEXT,
    );

    assertSpelledByCompiler(
      transcript,
      [TWO_GIB_TEXT, HALF_GIB_TEXT, ONE_GIB_TEXT, HUNDRED_MIB_TEXT, ONE_MIB_TEXT],
      [TWO_GIB, HALF_GIB, ONE_GIB, HUNDRED_MIB, ONE_MIB],
    );
  });

  // The already-under-the-cap answer ends in a sentence of its own, carrying two
  // sizes that the removing path never reaches — so it is exercised separately
  // rather than folded into the case above.
  it('a trim that removed nothing prints the size held and the cap as sent', async () => {
    const answer: CacheEvictResponse = {
      withinCapBefore: true,
      removed: [],
      heldOpen: [],
      totalBefore: ONE_MIB,
      totalBeforeText: ONE_MIB_TEXT,
      reclaimedBytes: 0,
      reclaimedBytesText: '0 B',
      remainingBytes: ONE_MIB,
      remainingBytesText: ONE_MIB_TEXT,
      capBytes: HUNDRED_MIB,
      capBytesText: HUNDRED_MIB_TEXT,
      scope,
    };

    const transcript = await captureOperation(
      'evict',
      { cacheEvict: async () => answer },
      HUNDRED_MIB_TEXT,
    );

    assertSpelledByCompiler(
      transcript,
      [ONE_MIB_TEXT, HUNDRED_MIB_TEXT],
      [ONE_MIB, HUNDRED_MIB],
    );
  });

  it('a wipe prints each emptied subtree and the total it reclaimed as sent', async () => {
    const answer: CacheClearResponse = {
      cleared: [{
        class: 'compiled modules',
        reach: 'every project on this machine',
        size: HALF_GIB,
        sizeText: HALF_GIB_TEXT,
        heldOpenFiles: 0,
        heldOpenBytes: 0,
        heldOpenBytesText: '0 B',
      }],
      reclaimedBytes: ONE_GIB,
      reclaimedBytesText: ONE_GIB_TEXT,
      scope,
    };

    const transcript = await captureOperation('clear', { cacheClear: async () => answer });

    assertSpelledByCompiler(transcript, [HALF_GIB_TEXT, ONE_GIB_TEXT], [HALF_GIB, ONE_GIB]);
  });
});
