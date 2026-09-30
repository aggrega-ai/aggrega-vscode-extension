// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  ConvertedShape,
  editorCodeForShape,
  shapeForDaemonDiagnostic,
} from '../../src/diagnostics-shape';
import {
  LOCKFILE_PULL_ACTION,
  WhoAsked,
  handleDaemonError,
  lockfileNotice,
  resetSessionDedup,
} from '../../src/error-surfaces';
import { operationLabel } from '../../src/operation-groups';
import {
  DaemonDiagnostic,
  ERR_ENTITY_NOT_RESOLVABLE,
  ERR_FILE_NOT_VALIDATED,
  ERR_LOCKFILE_ABSENT,
  ERR_SHUTTING_DOWN,
} from '../../src/types';

// RETIRED_RELEASE_NOT_RESOLVED is a numeric code the daemon does not
// allocate. It is spelled here, in the one test that needs a second key, so
// nothing in src/ carries a constant for a condition nothing emits.
const RETIRED_RELEASE_NOT_RESOLVED = 1002;

// The compiler's sentence for a missing lockfile, as the pinned language server
// words it, with the Release the fixtures below name.
const COMPILER_SENTENCE =
  'lockfile /workspace/envs/prod.lock not found; run `aggrega pull --release envs/prod.yaml` to generate';

// The words that describe which notices were held back, which belong to this
// extension's own bookkeeping and never to a surface a reader reads.
const BOOKKEEPING = /toast|suppress|throttl|next surface allowed|debounce/i;

interface FakeUri {
  toString(): string;
}

interface ContextFixture {
  uri: FakeUri;
  whoAsked: WhoAsked;
  publishCalls: Array<{ uri: FakeUri; shapes: ConvertedShape[] }>;
  logLines: string[];
  notices: Array<{ kind: 'error' | 'info'; message: string; items: string[] }>;
  noticeResponse: string | undefined;
  // pulls records every Release the Pull was run for, in order.
  pulls: Array<string | null>;
  // selectedRelease is the editor's one selected Release, which the
  // lockfile-absent handler falls back to when the envelope names none.
  selectedRelease: string | null;
  // selectedReleaseReads counts consultations of the selection. The
  // lockfile-absent handler must not consult it when the error envelope already
  // names the Release, so the count is the assertion that the envelope wins
  // rather than merely agreeing.
  selectedReleaseReads: number;
  toastDebounce: Map<number, true | number>;
  toastDebounceMode: 'time' | 'session';
  toastThrottleSeconds: number;
  currentTime: number;
}

function makeContext(initial?: Partial<ContextFixture>): ContextFixture & {
  ctx: Parameters<typeof handleDaemonError>[1];
} {
  const fixture: ContextFixture = {
    uri: { toString: () => 'file:///workspace/a.yaml' },
    whoAsked: 'nobody',
    publishCalls: [],
    logLines: [],
    notices: [],
    noticeResponse: undefined,
    pulls: [],
    selectedRelease: 'release.yaml',
    selectedReleaseReads: 0,
    toastDebounce: new Map(),
    toastDebounceMode: 'session',
    toastThrottleSeconds: 300,
    currentTime: 0,
    ...initial,
  };
  const ctx = {
    uri: fixture.uri as any,
    whoAsked: fixture.whoAsked,
    publishShape: (uri: any, shapes: ConvertedShape[]) => {
      fixture.publishCalls.push({ uri, shapes });
    },
    logLine: (line: string) => { fixture.logLines.push(line); },
    notify: (kind: 'error' | 'info', message: string, ...items: string[]) => {
      fixture.notices.push({ kind, message, items });
      return Promise.resolve(fixture.noticeResponse);
    },
    pull: (release: string | null) => { fixture.pulls.push(release); },
    selectedRelease: () => {
      fixture.selectedReleaseReads += 1;
      return fixture.selectedRelease;
    },
    toastDebounce: fixture.toastDebounce,
    toastDebounceMode: fixture.toastDebounceMode,
    toastThrottleSeconds: fixture.toastThrottleSeconds,
    now: () => fixture.currentTime,
  };
  return Object.assign(fixture, { ctx });
}

// settle lets a notice's promise and the handler it continues into run.
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

const REFUSAL = {
  code: ERR_LOCKFILE_ABSENT,
  message: COMPILER_SENTENCE,
  data: { lockfile: '/workspace/envs/prod.lock', release: 'envs/prod.yaml' },
};

describe('handleDaemonError', () => {
  it('reports an unknown code as unrecognised', () => {
    const f = makeContext();
    const handled = handleDaemonError({ code: 9999, message: 'unknown' }, f.ctx);
    assert.strictEqual(handled, 'unrecognised');
    assert.strictEqual(f.publishCalls.length, 0);
    assert.strictEqual(f.notices.length, 0);
  });

  it('reports 1001 as unrecognised (cache-miss path is owned by extension.ts)', () => {
    const f = makeContext();
    const handled = handleDaemonError({ code: ERR_FILE_NOT_VALIDATED, message: 'cold' }, f.ctx);
    assert.strictEqual(handled, 'unrecognised');
  });

  it('1004 publishes an Error diagnostic with the unresolvable-entity message', () => {
    const f = makeContext();
    const handled = handleDaemonError(
      { code: ERR_ENTITY_NOT_RESOLVABLE, message: 'oci://hub/foo not found' },
      f.ctx,
    );
    assert.strictEqual(handled, 'surfaced');
    assert.strictEqual(f.publishCalls.length, 1);
    const shape = f.publishCalls[0].shapes[0];
    assert.ok(shape.message.includes('oci://hub/foo not found'));
    assert.strictEqual(f.notices.length, 0);
  });

  it('1004 with full data positions the diagnostic at the daemon-reported line/column (1-based → 0-based)', () => {
    const f = makeContext();
    const handled = handleDaemonError(
      {
        code: ERR_ENTITY_NOT_RESOLVABLE,
        message: 'release.yaml load failed',
        data: { file: '/workspace/release.yaml', line: 12, column: 7 },
      },
      f.ctx,
    );
    assert.strictEqual(handled, 'surfaced');
    assert.strictEqual(f.publishCalls.length, 1);
    const shape = f.publishCalls[0].shapes[0];
    // 1-based daemon → 0-based VS Code.
    assert.strictEqual(shape.startLine, 11);
    assert.strictEqual(shape.startChar, 6);
    assert.strictEqual(shape.endLine, 11);
    assert.strictEqual(shape.endChar, 6);
  });

  it('1004 with end_line/end_column spans a wide range', () => {
    const f = makeContext();
    const handled = handleDaemonError(
      {
        code: ERR_ENTITY_NOT_RESOLVABLE,
        message: 'aggregate.yaml extends unresolved',
        data: { file: '/workspace/aggregate.yaml', line: 7, column: 16, end_line: 7, end_column: 40 },
      },
      f.ctx,
    );
    assert.strictEqual(handled, 'surfaced');
    const shape = f.publishCalls[0].shapes[0];
    assert.strictEqual(shape.startLine, 6);
    assert.strictEqual(shape.startChar, 15);
    assert.strictEqual(shape.endLine, 6);
    assert.strictEqual(shape.endChar, 39);
  });

  it('1004 with file-only data falls back to file:1:1 (start of file)', () => {
    const f = makeContext();
    const handled = handleDaemonError(
      {
        code: ERR_ENTITY_NOT_RESOLVABLE,
        message: 'release.yaml load failed',
        data: { file: '/workspace/release.yaml' },
      },
      f.ctx,
    );
    assert.strictEqual(handled, 'surfaced');
    const shape = f.publishCalls[0].shapes[0];
    assert.strictEqual(shape.startLine, 0);
    assert.strictEqual(shape.startChar, 0);
  });

  it('1004 with no data field at all falls back to file:1:1', () => {
    const f = makeContext();
    // Envelope shape from a daemon predating the structured data
    // field — backward-compat path. No data field at all.
    const handled = handleDaemonError(
      { code: ERR_ENTITY_NOT_RESOLVABLE, message: 'release.yaml load failed' },
      f.ctx,
    );
    assert.strictEqual(handled, 'surfaced');
    const shape = f.publishCalls[0].shapes[0];
    assert.strictEqual(shape.startLine, 0);
    assert.strictEqual(shape.startChar, 0);
  });

  it('a refusal the reader asked for is one error notice in plain words, offering Pull', () => {
    const f = makeContext({ whoAsked: 'reader', selectedRelease: 'envs/staging.yaml' });
    const handled = handleDaemonError(REFUSAL, f.ctx);
    // 'notified' is what tells the ending not to raise a second notification.
    assert.strictEqual(handled, 'notified');
    assert.deepStrictEqual(f.notices, [{
      kind: 'error',
      message: `Aggrega: envs/prod.yaml has no lockfile. ${COMPILER_SENTENCE}`,
      items: ['Pull'],
    }]);
    // The channel line for a requested refusal is the ending's, written by the
    // operation the reader pressed; the routing adds none of its own.
    assert.deepStrictEqual(f.logLines, []);
    assert.strictEqual(f.publishCalls.length, 0);
    assert.strictEqual(f.selectedReleaseReads, 0, 'the envelope named the Release; nothing to resolve');
  });

  it('a refusal the reader asked for is never held back, however recently the notice was shown', () => {
    // Session mode with the notice already recorded is the strongest hold there
    // is: a refusal nobody asked for would stay silent here until a restart.
    const f = makeContext({ whoAsked: 'reader', toastDebounceMode: 'session' });
    f.toastDebounce.set(ERR_LOCKFILE_ABSENT, true);
    assert.strictEqual(handleDaemonError(REFUSAL, f.ctx), 'notified');
    assert.strictEqual(handleDaemonError(REFUSAL, f.ctx), 'notified');
    assert.deepStrictEqual(f.notices.map((n) => n.kind), ['error', 'error']);
  });

  it('a refusal the reader asked for is never held back inside the time window either', async () => {
    const f = makeContext({
      whoAsked: 'reader', toastDebounceMode: 'time', toastThrottleSeconds: 300, currentTime: 1_000_000,
    });
    handleDaemonError(REFUSAL, f.ctx);
    await settle();
    f.currentTime = 1_000_000 + 1000;
    handleDaemonError(REFUSAL, f.ctx);
    await settle();
    assert.strictEqual(f.notices.length, 2, 'the second press, a second after the first, is answered too');
  });

  it('Pull runs the Pull operation for the Release the compiler named, not the selected one', async () => {
    // The selection is deliberately a DIFFERENT Release: a workspace may hold
    // several, and pulling any but the one the refusal is about would succeed
    // while the refusal stood.
    const f = makeContext({ whoAsked: 'reader', noticeResponse: 'Pull', selectedRelease: 'envs/staging.yaml' });
    handleDaemonError(REFUSAL, f.ctx);
    await settle();
    assert.deepStrictEqual(f.pulls, ['envs/prod.yaml']);
    assert.strictEqual(f.selectedReleaseReads, 0);
  });

  it('Pull falls back to the selected Release where the refusal names none', async () => {
    const f = makeContext({ whoAsked: 'reader', noticeResponse: 'Pull', selectedRelease: 'envs/prod.yaml' });
    handleDaemonError({ code: ERR_LOCKFILE_ABSENT, message: COMPILER_SENTENCE }, f.ctx);
    await settle();
    assert.deepStrictEqual(f.notices[0].message, `Aggrega: envs/prod.yaml has no lockfile. ${COMPILER_SENTENCE}`);
    assert.deepStrictEqual(f.pulls, ['envs/prod.yaml']);
    assert.strictEqual(f.selectedReleaseReads, 1);
  });

  it('Pull falls back to the selected Release where the refusal names an empty one', async () => {
    // An empty path names nothing, so it is never carried as the Release.
    const f = makeContext({ whoAsked: 'reader', noticeResponse: 'Pull', selectedRelease: 'envs/prod.yaml' });
    handleDaemonError({ code: ERR_LOCKFILE_ABSENT, message: COMPILER_SENTENCE, data: { release: '' } }, f.ctx);
    await settle();
    assert.deepStrictEqual(f.pulls, ['envs/prod.yaml']);
    assert.strictEqual(f.selectedReleaseReads, 1);
  });

  it('with no Release named or selected, the notice says "the Release" and Pull is left to ask', async () => {
    const f = makeContext({ whoAsked: 'reader', noticeResponse: 'Pull', selectedRelease: null });
    handleDaemonError({ code: ERR_LOCKFILE_ABSENT, message: COMPILER_SENTENCE }, f.ctx);
    await settle();
    assert.strictEqual(f.notices[0].message, `Aggrega: the Release has no lockfile. ${COMPILER_SENTENCE}`);
    // null is the Pull operation's own "the selected Release", which reports that
    // none is selected and offers to select one, as the panel's button does.
    assert.deepStrictEqual(f.pulls, [null]);
  });

  it('a notice closed without pressing Pull runs nothing', async () => {
    const f = makeContext({ whoAsked: 'reader', noticeResponse: undefined });
    handleDaemonError(REFUSAL, f.ctx);
    await settle();
    assert.deepStrictEqual(f.pulls, []);
  });

  it('the notice\'s action is the Commands panel\'s Pull, named as the panel names it', () => {
    assert.strictEqual(LOCKFILE_PULL_ACTION, operationLabel('pull'));
    assert.strictEqual(LOCKFILE_PULL_ACTION, 'Pull');
  });

  it('a refusal nobody asked for is the same notice, informational, and its channel line is the compiler\'s sentence', () => {
    const f = makeContext({ whoAsked: 'nobody' });
    const handled = handleDaemonError(REFUSAL, f.ctx);
    assert.strictEqual(handled, 'notified');
    assert.deepStrictEqual(f.notices, [{
      kind: 'info',
      message: lockfileNotice('envs/prod.yaml', COMPILER_SENTENCE),
      items: ['Pull'],
    }]);
    assert.deepStrictEqual(f.logLines, [COMPILER_SENTENCE]);
  });

  it('a refusal nobody asked for is held back in session mode, leaving only the compiler\'s sentence', () => {
    const f = makeContext({ whoAsked: 'nobody', toastDebounceMode: 'session' });
    assert.strictEqual(handleDaemonError(REFUSAL, f.ctx), 'notified');
    assert.strictEqual(handleDaemonError(REFUSAL, f.ctx), 'surfaced');
    assert.strictEqual(f.notices.length, 1);
    // The held-back one leaves exactly what the shown one left: nothing on the
    // channel says whether a notice was shown.
    assert.deepStrictEqual(f.logLines, [COMPILER_SENTENCE, COMPILER_SENTENCE]);
  });

  it('a notice the reader asked for holds back the same notice for a redraw nobody asked for', () => {
    const asked = makeContext({ whoAsked: 'reader', toastDebounceMode: 'session' });
    handleDaemonError(REFUSAL, asked.ctx);
    const quiet = makeContext({ whoAsked: 'nobody', toastDebounceMode: 'session', toastDebounce: asked.toastDebounce });
    assert.strictEqual(handleDaemonError(REFUSAL, quiet.ctx), 'surfaced');
    assert.strictEqual(quiet.notices.length, 0);
  });

  it('no composed line carries the extension\'s own bookkeeping', async () => {
    // Every path that composes a line a reader sees, for both callers and both
    // readings of the settings, held back and shown.
    const lines: string[] = [];
    for (const whoAsked of ['reader', 'nobody'] as const) {
      for (const toastDebounceMode of ['session', 'time'] as const) {
        const f = makeContext({ whoAsked, toastDebounceMode, currentTime: 1_000_000 });
        handleDaemonError(REFUSAL, f.ctx);
        await settle();
        f.currentTime = 1_000_000 + 1000;
        handleDaemonError(REFUSAL, f.ctx);
        handleDaemonError({ code: ERR_LOCKFILE_ABSENT, message: COMPILER_SENTENCE }, f.ctx);
        lines.push(...f.logLines, ...f.notices.map((n) => n.message), ...f.notices.flatMap((n) => n.items));
      }
    }
    assert.ok(lines.length > 0, 'nothing was composed, so the absence below would prove nothing');
    assert.deepStrictEqual(lines.filter((l) => BOOKKEEPING.test(l)), []);
    assert.deepStrictEqual(lines.filter((l) => l.includes('<release>')), []);
  });

  it('1005 logs to the output channel and produces no UI', () => {
    const f = makeContext();
    const handled = handleDaemonError(
      { code: ERR_SHUTTING_DOWN, message: 'daemon shutting down' },
      f.ctx,
    );
    assert.strictEqual(handled, 'surfaced');
    assert.strictEqual(f.publishCalls.length, 0);
    assert.strictEqual(f.notices.length, 0);
    assert.ok(f.logLines.some(l => l.includes('[shutting down]')));
  });

  it('resetSessionDedup clears the dedup map', () => {
    const dedup = new Map<number, true | number>();
    dedup.set(ERR_LOCKFILE_ABSENT, true);
    dedup.set(ERR_SHUTTING_DOWN, true);
    resetSessionDedup(dedup);
    assert.strictEqual(dedup.size, 0);
  });

  it('time mode: a refusal nobody asked for is shown, held back inside the window, and shown again after it', async () => {
    const f = makeContext({
      whoAsked: 'nobody',
      toastDebounceMode: 'time',
      toastThrottleSeconds: 60,
      currentTime: 1_000_000,
    });
    handleDaemonError(REFUSAL, f.ctx);
    await settle();
    assert.strictEqual(f.notices.length, 1, 'the first is shown');

    // Thirty seconds after the first closed, inside the 60 s window.
    f.currentTime = 1_000_000 + 30 * 1000;
    assert.strictEqual(handleDaemonError(REFUSAL, f.ctx), 'surfaced');
    await settle();
    assert.strictEqual(f.notices.length, 1, 'inside the window it is held back');

    // Past the window it is shown again.
    f.currentTime = 1_000_000 + 90 * 1000;
    assert.strictEqual(handleDaemonError(REFUSAL, f.ctx), 'notified');
    await settle();
    assert.strictEqual(f.notices.length, 2, 'past the window it is shown again');
    assert.deepStrictEqual(f.logLines, [COMPILER_SENTENCE, COMPILER_SENTENCE, COMPILER_SENTENCE]);
  });

  it('time mode: the record is kept per code', async () => {
    const f = makeContext({
      whoAsked: 'nobody',
      toastDebounceMode: 'time',
      toastThrottleSeconds: 60,
      currentTime: 1_000_000,
    });
    handleDaemonError(REFUSAL, f.ctx);
    await settle();
    assert.strictEqual(f.notices.length, 1);
    // The 1003 entry is now in the map; a different code's record is untouched
    // because the map keys by code.
    assert.strictEqual(f.toastDebounce.has(ERR_LOCKFILE_ABSENT), true);
    assert.strictEqual(f.toastDebounce.has(RETIRED_RELEASE_NOT_RESOLVED), false);
  });

  it('time mode: the window starts when the notice closes, not when it is raised', async () => {
    const f = makeContext({
      whoAsked: 'nobody',
      toastDebounceMode: 'time',
      toastThrottleSeconds: 60,
      currentTime: 1_000_000,
    });
    handleDaemonError(REFUSAL, f.ctx);
    // The notice has not closed at this microtask boundary. Advance the clock,
    // then let it close.
    f.currentTime = 1_000_000 + 10 * 1000;
    await settle();
    assert.strictEqual(f.toastDebounce.get(ERR_LOCKFILE_ABSENT), 1_000_000 + 10 * 1000);
  });
});

// What a reader can DO with a diagnostic's identifiers.
//
// This is the half a wire assertion cannot reach. That the daemon sends a
// quotable code and a reference says nothing about whether anybody can act on
// them: what decides that is the value the extension puts in the editor's code
// slot, because an editor renders that slot's link form as a followable link and
// its bare form as text. So these cases assert the slot, per case, including the
// case where it must stay empty.
describe('the identifier affordance a diagnostic earns', () => {
  // The three cases the compiler can produce, built as wire frames rather than as
  // shapes, so the conversion is inside what is being tested.
  const CODED: DaemonDiagnostic = {
    line: 4, column: 7, severity: 'error',
    message: 'parameter port: expected integer, got string',
    source: 'aggrega',
    code: 'resolver/parameter-contract-violation',
    shortCode: 'E0164',
    codeDescription: { href: 'https://aggrega.example/docs/errors/sentinels/#codes' },
  };

  const CODED_BUT_UNMAPPED: DaemonDiagnostic = {
    line: 1, column: 1, severity: 'warning',
    message: 'target does not fully support one field',
    source: 'aggrega-build',
    code: 'unsupported-field',
  };

  const UNCODED: DaemonDiagnostic = {
    line: 1, column: 1, severity: 'error',
    message: 'yaml: line 3: did not find expected node content',
    source: 'aggrega',
  };

  it('offers a followable identifier for a condition that resolves', () => {
    const code = editorCodeForShape(shapeForDaemonDiagnostic(CODED));

    // The whole affordance in one assertion: the exact object an editor turns
    // into a link, carrying the code a reader would search for. Asserted as a
    // whole value rather than field by field, so a slot that grew or lost a key
    // fails here.
    assert.deepStrictEqual(code, {
      value: 'E0164',
      target: 'https://aggrega.example/docs/errors/sentinels/#codes',
    });

    // And the machine-matchable code is still on the shape for whatever matches
    // on it — the quotable one was added beside it, not in place of it.
    assert.strictEqual(
      shapeForDaemonDiagnostic(CODED).code,
      'resolver/parameter-contract-violation',
    );
  });

  it('offers a copyable identifier and no link for a code that resolves no further', () => {
    const code = editorCodeForShape(shapeForDaemonDiagnostic(CODED_BUT_UNMAPPED));

    // A string and not an object: the reader can copy the class of the finding
    // and is offered nothing to open, because there is nothing that describes it.
    assert.strictEqual(code, 'unsupported-field');
    assert.strictEqual(typeof code, 'string');
  });

  it('offers nothing at all for a diagnostic that names no condition', () => {
    const shape = shapeForDaemonDiagnostic(UNCODED);

    // Undefined rather than an empty string. An editor given an empty code slot
    // renders an empty identifier beside the message; given none it renders the
    // message alone, which is what this extension showed before any identifier
    // travelled at all.
    assert.strictEqual(editorCodeForShape(shape), undefined);

    // Byte-identical to what the conversion produced before the identifiers
    // existed: the exact key set, so a key present carrying undefined fails here.
    // Three absence checks would each pass on a shape that had grown a fourth
    // identifier nobody decided about.
    assert.deepStrictEqual(Object.keys(shape).sort(), [
      'endChar', 'endLine', 'message', 'severity', 'source', 'startChar', 'startLine',
    ]);
  });

  it('tells a code that resolves to nothing apart from no code at all', () => {
    // The distinction the daemon went to trouble to express, asserted as a
    // distinction rather than as two separate facts. Without this the two cases
    // above could both be satisfied by an implementation that collapsed them.
    const unmapped = editorCodeForShape(shapeForDaemonDiagnostic(CODED_BUT_UNMAPPED));
    const uncoded = editorCodeForShape(shapeForDaemonDiagnostic(UNCODED));
    assert.notStrictEqual(unmapped, uncoded);
    assert.ok(unmapped !== undefined, 'a code that resolves no further is still a code');
    assert.strictEqual(uncoded, undefined);
  });
});
