// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.
//
// One flow drafts every document, and a control that exists for one kind reaches
// it with that kind already settled rather than growing a flow of its own.
//
// WHAT IS DRIVEN HERE AND WHAT IS ONLY READ. The resolution and the prompt are
// pure and are called directly. The flow itself reaches the editor host, so the
// host is stood in for at module load and the flow is then RUN — which is the
// only way to observe the thing it decides: whether the kind question is asked
// at all. The wiring of the two controls that pre-set the kind is READ as source
// text, which is a weaker instrument: it catches a change that silently undoes
// the wiring and claims nothing about the control having been pressed. Nothing
// here is pressed; the extension host cannot start in this container.

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { draftNamePrompt, draftSubjectFor } from '../../src/entity-kinds';
import { SELECTOR_ROW_LABELS } from '../../src/selector-levels';

const EXTENSION_ROOT = path.resolve(__dirname, '../../..');

function sourceOf(relative: string): string {
  return fs.readFileSync(path.join(EXTENSION_ROOT, relative), 'utf8');
}

// ANSWERED is an answer of the shape the language server sends for a schema
// request that named no kind. It is written out here rather than read from any
// product value, and it deliberately holds a kind whose two registers differ by
// more than case, so a lookup that derived one register from the other would
// fail rather than agree.
const ANSWERED = {
  entityKinds: [
    { kind: 'aggregate', documentKind: 'Aggregate' },
    { kind: 'release', documentKind: 'Release' },
    { kind: 'feature-recipe', documentKind: 'FeatureRecipe' },
  ],
};

const KINDS = ANSWERED.entityKinds;

// WITHOUT_RELEASE is the same answer from a compiler that has no such kind. It
// is what the fallback is measured against, and it is the whole of the
// difference from the answer above.
const WITHOUT_RELEASE = {
  entityKinds: [
    { kind: 'aggregate', documentKind: 'Aggregate' },
    { kind: 'feature-recipe', documentKind: 'FeatureRecipe' },
  ],
};

describe('what a draft is drafting, settled from the compiler\'s own answer', () => {
  it('resolves a name the answer holds to that entry, in both registers', () => {
    assert.deepStrictEqual(
      draftSubjectFor(KINDS, null, 'Release'),
      { kind: 'release', documentKind: 'Release' },
      'a kind named the way a reader reads it did not come back as the compiler\'s own entry',
    );
    // The self-check that makes the line above a lookup rather than a lowercase:
    // a kind whose two registers differ by more than case resolves too.
    assert.deepStrictEqual(
      draftSubjectFor(KINDS, null, 'FeatureRecipe'),
      { kind: 'feature-recipe', documentKind: 'FeatureRecipe' },
      'a kind of more than one word did not survive the lookup, so a register was derived rather than read',
    );
  });

  it('resolves a name the answer does NOT hold to nothing, which is the cue to ask', () => {
    assert.strictEqual(
      draftSubjectFor(WITHOUT_RELEASE.entityKinds, null, 'Release'), null,
      'a kind this compiler has no entry for was answered with a token invented on this side',
    );
    // The negative control for that absence: the same reader, the same call,
    // against an answer that does hold the kind.
    assert.notStrictEqual(
      draftSubjectFor(KINDS, null, 'Release'), null,
      'the answer these absences are read from never held the kind, so nothing above measures a fallback',
    );
  });

  it('lets a token outrank a name, and carries a token the answer does not hold', () => {
    assert.deepStrictEqual(
      draftSubjectFor(KINDS, 'aggregate', 'Release'),
      { kind: 'aggregate', documentKind: 'Aggregate' },
      'a name pre-set by a call site overrode the kind a reader had just chosen',
    );
    assert.deepStrictEqual(
      draftSubjectFor(KINDS, 'banana', null),
      { kind: 'banana', documentKind: null },
      'a token this answer does not hold was refused here rather than left to the compiler',
    );
    assert.strictEqual(
      draftSubjectFor(KINDS, null, null), null,
      'an invocation that carried nothing settled a kind anyway',
    );
  });

  it('names the kind in the prompt, and says "entity" only where it holds no name', () => {
    assert.strictEqual(
      draftNamePrompt('Release'),
      'Name for the new Release — leave empty for a placeholder',
    );
    assert.strictEqual(
      draftNamePrompt(null),
      'Name for the new entity — leave empty for a placeholder',
    );
  });
});

// --- the flow itself, run with the editor host stood in --------------------

// asked records everything the flow put in front of a reader, so a test reads
// back exactly what they would have met — including the questions that were NOT
// asked, which is what every case below turns on.
const asked = {
  quickPicks: [] as string[][],
  prompts: [] as { title?: string; prompt?: string }[],
  messages: [] as string[],
  documents: [] as { content?: string; language?: string }[],
};

type Offered = { label: string };

let answerQuickPick: (items: Offered[]) => Offered | undefined = () => undefined;
let answerInputBox: string | undefined = '';

function forget(): void {
  asked.quickPicks = [];
  asked.prompts = [];
  asked.messages = [];
  asked.documents = [];
  answerQuickPick = () => undefined;
  answerInputBox = '';
}

// The editor host stood in for, so the flow can be run outside the editor. Only
// what the flow actually reaches is supplied; anything it grew a use for would
// fail loudly here rather than being quietly satisfied.
const editorHostStub = {
  window: {
    showQuickPick: async (items: Offered[]): Promise<Offered | undefined> => {
      asked.quickPicks.push(items.map((item) => item.label));
      return answerQuickPick(items);
    },
    showInputBox: async (
      options: { title?: string; prompt?: string },
    ): Promise<string | undefined> => {
      asked.prompts.push({ title: options?.title, prompt: options?.prompt });
      return answerInputBox;
    },
    showInformationMessage: async (message: string): Promise<undefined> => {
      asked.messages.push(message);
      return undefined;
    },
    showErrorMessage: async (message: string): Promise<undefined> => {
      asked.messages.push(message);
      return undefined;
    },
    showTextDocument: async (): Promise<undefined> => undefined,
  },
  workspace: {
    getConfiguration: () => ({ get: (): undefined => undefined }),
    openTextDocument: async (
      opened: { content?: string; language?: string },
    ): Promise<unknown> => {
      asked.documents.push(opened);
      return opened;
    },
  },
  commands: {},
  Uri: {},
  ProgressLocation: { Notification: 15, Window: 10 },
};

type ModuleLoader = {
  _load: (request: string, ...rest: unknown[]) => unknown;
};

type RunScaffold = (
  deps: unknown,
  chosen?: unknown,
  drafting?: unknown,
) => Promise<void>;

// The flow is loaded against the stub above rather than against whatever some
// other file left in the module cache, and the cache is put back exactly as it
// was found afterwards. The rule is the tree the modules live in rather than a
// list of their names, because a list would be a second statement of which
// modules reach the editor and would go stale the first time one did.
function loadFlowAgainstStub(): RunScaffold {
  const nodeModule = require('module') as ModuleLoader;
  const restoreLoad = nodeModule._load;
  nodeModule._load = function (this: unknown, request: string, ...rest: unknown[]): unknown {
    if (request === 'vscode') { return editorHostStub; }
    return restoreLoad.apply(this, [request, ...rest]);
  };

  const compiledSrc = path.resolve(__dirname, '..', '..', 'src') + path.sep;
  const displaced = new Map<string, NodeModule>();
  for (const id of Object.keys(require.cache)) {
    if (id.startsWith(compiledSrc)) {
      displaced.set(id, require.cache[id] as NodeModule);
      delete require.cache[id];
    }
  }

  const { runScaffold } = require('../../src/operations') as { runScaffold: RunScaffold };

  for (const id of Object.keys(require.cache)) {
    if (id.startsWith(compiledSrc)) { delete require.cache[id]; }
  }
  for (const [id, held] of displaced) { require.cache[id] = held; }
  nodeModule._load = restoreLoad;

  return runScaffold;
}

const runScaffold = loadFlowAgainstStub();

// drafted records what the flow asked the compiler to draft.
function depsAnswering(answer: unknown, drafted: { kind: string; name: string }[]): unknown {
  return {
    entityKinds: async (): Promise<unknown> => answer,
    scaffoldEntity: async (kind: string, name: string): Promise<unknown> => {
      drafted.push({ kind, name });
      return { kind, skeleton: 'apiVersion: aggrega.ai/v1alpha1\n' };
    },
    output: { appendLine: (): void => {} },
  };
}

describe('the one drafting flow, entered three ways', () => {
  beforeEach(forget);

  it('asks only for the name when the kind was pre-set, and names it in the prompt', async () => {
    const drafted: { kind: string; name: string }[] = [];
    answerInputBox = 'prod';

    await runScaffold(depsAnswering(ANSWERED, drafted), undefined, SELECTOR_ROW_LABELS.release);

    assert.deepStrictEqual(
      asked.quickPicks, [],
      'the kind was asked for again although the control that opened this knew it',
    );
    assert.deepStrictEqual(
      asked.prompts,
      [{
        title: 'Aggrega: draft an entity',
        prompt: 'Name for the new Release — leave empty for a placeholder',
      }],
      'the prompt does not name the kind the flow was told it is drafting',
    );
    assert.deepStrictEqual(
      drafted, [{ kind: 'release', name: 'prod' }],
      'the request carried something other than the compiler\'s own token for that kind',
    );
  });

  it('still asks which kind where the invocation named none', async () => {
    const drafted: { kind: string; name: string }[] = [];
    answerQuickPick = (items) => items[0];
    answerInputBox = 'web';

    await runScaffold(depsAnswering(ANSWERED, drafted));

    assert.deepStrictEqual(
      asked.quickPicks, [['Aggregate', 'Release', 'FeatureRecipe']],
      'a command invoked with no kind did not offer the kinds the compiler answered with',
    );
    assert.deepStrictEqual(
      asked.prompts.map((p) => p.prompt),
      ['Name for the new Aggregate — leave empty for a placeholder'],
      'the prompt does not name the kind the reader just chose',
    );
    assert.deepStrictEqual(drafted, [{ kind: 'aggregate', name: 'web' }]);
  });

  it('falls back to the ordinary chooser where the compiler has no such kind, rather than failing', async () => {
    const drafted: { kind: string; name: string }[] = [];
    answerQuickPick = (items) => items[0];
    answerInputBox = 'web';

    await runScaffold(
      depsAnswering(WITHOUT_RELEASE, drafted),
      undefined,
      SELECTOR_ROW_LABELS.release,
    );

    assert.deepStrictEqual(
      asked.quickPicks, [['Aggregate', 'FeatureRecipe']],
      'a pre-set kind this compiler does not answer to left the reader with no way on',
    );
    assert.deepStrictEqual(
      asked.messages, [],
      'the reader was told something went wrong rather than being offered the ordinary choice',
    );
    assert.deepStrictEqual(drafted, [{ kind: 'aggregate', name: 'web' }]);
  });

  it('names the kind a menu answer carried, without asking again', async () => {
    const drafted: { kind: string; name: string }[] = [];
    answerInputBox = 'api';

    await runScaffold(depsAnswering(ANSWERED, drafted), 'feature-recipe');

    assert.deepStrictEqual(asked.quickPicks, []);
    assert.deepStrictEqual(
      asked.prompts.map((p) => p.prompt),
      ['Name for the new FeatureRecipe — leave empty for a placeholder'],
      'a kind of more than one word was renamed on this side rather than read from the answer',
    );
    assert.deepStrictEqual(drafted, [{ kind: 'feature-recipe', name: 'api' }]);
  });

  it('sends a token the compiler does not answer to, and names nothing it was not told', async () => {
    const drafted: { kind: string; name: string }[] = [];
    answerInputBox = '';

    await runScaffold(depsAnswering(ANSWERED, drafted), 'banana');

    assert.deepStrictEqual(
      asked.quickPicks, [],
      'an invocation naming a kind outright was answered with a list instead of being sent',
    );
    assert.deepStrictEqual(
      asked.prompts.map((p) => p.prompt),
      ['Name for the new entity — leave empty for a placeholder'],
      'the prompt named a kind the compiler\'s answer never held',
    );
    assert.deepStrictEqual(
      drafted, [{ kind: 'banana', name: '' }],
      'the token was refused here rather than by the compiler, whose refusal names the whole valid set',
    );
  });

  it('opens the draft it was given, so the flow ends where a reader can see it', async () => {
    const drafted: { kind: string; name: string }[] = [];
    answerInputBox = 'prod';

    await runScaffold(depsAnswering(ANSWERED, drafted), undefined, SELECTOR_ROW_LABELS.release);

    assert.deepStrictEqual(
      asked.documents,
      [{ content: 'apiVersion: aggrega.ai/v1alpha1\n', language: 'yaml' }],
      'the draft the compiler returned was not put in front of the reader',
    );
  });
});

// --- the call sites, read as source text -----------------------------------

describe('the controls that pre-set the kind, and the one flow they reach', () => {
  it('drafts from exactly one place, so the pre-set case is an argument and not a door', () => {
    const src = sourceOf('src/operations.ts');
    assert.strictEqual(
      (src.match(/deps\.scaffoldEntity\(/g) ?? []).length, 1,
      'the drafting request is sent from more than one place, so one job has two paths',
    );
    assert.strictEqual(
      (src.match(/showInputBox\(/g) ?? []).length >= 1, true,
      'the reader is asked for nothing here, so the count above measures nothing',
    );
    // The command itself is registered once, and the registration forwards BOTH
    // of its arguments, so the three ways in reach one entry point. This half is
    // read rather than run — the registration happens against an extension host
    // that cannot start here — and it is the only thing standing between a
    // pre-set kind and being silently dropped on the way to the flow.
    assert.strictEqual(
      (src.match(/reg\('scaffold',/g) ?? []).length, 1,
      'the drafting command is registered more than once',
    );
    assert.ok(
      /reg\('scaffold', \(chosen, drafting\) => \{ void runScaffold\(deps, chosen, drafting\); \}\);/
        .test(src),
      'the drafting command\'s registration no longer forwards the pre-set kind, so every control '
      + 'that knows which kind it is making would be asked again',
    );
  });

  it('sends the Release level\'s own name and no token, through the one scaffold command', () => {
    // A WEAKER INSTRUMENT, and it is named as one: this reads the wiring rather
    // than pressing the control, because the control lives behind an extension
    // host that cannot start here. It catches a change that silently undoes the
    // wiring; it claims nothing about the control having been pressed.
    const src = sourceOf('src/get-started.ts');
    const call = src.match(
      /executeCommand\(\s*'aggrega\.op\.scaffold',\s*undefined,\s*SELECTOR_ROW_LABELS\.release,?\s*\)/,
    );
    assert.ok(
      call !== null,
      'the Release create control does not reach the drafting flow with the Release pre-set',
    );
    assert.strictEqual(
      (src.match(/'aggrega\.op\.scaffold'/g) ?? []).length, 1,
      'the drafting command is invoked from more than one place in the welcome panel',
    );
    // What it passes is the level's own name, so the wording a reader is asked
    // about and the wording the rows teach cannot come apart.
    assert.strictEqual(SELECTOR_ROW_LABELS.release, 'Release');
  });

  it('runs that one command from both the Release row and the welcome page\'s button', () => {
    // Both controls name the SAME command, which is what makes them one entry
    // point rather than two — the row's create control and the step's action.
    const rows = sourceOf('src/selector-rows.ts');
    const steps = sourceOf('src/get-started-steps.ts');
    assert.ok(
      /command: DRAFT_RELEASE_COMMAND/.test(rows),
      'the Release row\'s create control no longer runs the drafting command',
    );
    assert.ok(
      /label: 'Draft a Release', command: DRAFT_RELEASE_COMMAND/.test(steps),
      'the welcome page\'s Release button no longer runs the drafting command',
    );
  });
});

// --- one declaration per command identifier --------------------------------

// occurrencesInSrc counts a literal across every TypeScript source in src/.
//
// CRITERION, stated beside every number it produces: the exact quoted literal,
// in src/*.ts at this tree state, comments and strings included — which is the
// point, because a comment naming an identifier is the copy nothing compares
// against and the one a symbol census cannot see.
function occurrencesInSrc(literal: string): number {
  const dir = path.join(EXTENSION_ROOT, 'src');
  let found = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.ts')) { continue; }
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    found += text.split(literal).length - 1;
  }
  return found;
}

describe('each command identifier is written once', () => {
  it('declares the Release choice and the Aggrega workspace choice once each', () => {
    assert.strictEqual(
      occurrencesInSrc('aggrega.release.select'), 1,
      'the Release selection command is written more than once, so two copies agree until one moves',
    );
    assert.strictEqual(
      occurrencesInSrc('aggrega.workspace.switchAnchor'), 1,
      'the Aggrega workspace switch command is written more than once, so two copies agree until one moves',
    );
  });

  it('measures the corpus rather than the reader', () => {
    // The instrument's two controls. A literal that provably IS there comes back
    // non-zero, and one that provably is not comes back zero — so the counts
    // above are the corpus and not a reader that finds nothing.
    assert.ok(
      occurrencesInSrc('aggrega.selectedRelease') > 0,
      'the reader found nothing for a literal the tree provably carries',
    );
    assert.strictEqual(
      occurrencesInSrc('aggrega.release.selectAnother'), 0,
      'the reader found a literal the tree does not carry',
    );
  });

  it('puts each identifier beside the choice it opens, and every other site reads it', () => {
    assert.ok(
      /export const SELECT_RELEASE_COMMAND/.test(sourceOf('src/release-selection.ts')),
      'the Release selection command does not live beside the selection it changes',
    );
    assert.ok(
      /export const SWITCH_ANCHOR_COMMAND/.test(sourceOf('src/anchor-picker.ts')),
      'the Aggrega workspace switch command does not live beside the choice it opens',
    );
    for (const reader of ['src/release-status.ts', 'src/selector-rows.ts', 'src/get-started-steps.ts']) {
      assert.ok(
        /SELECT_RELEASE_COMMAND/.test(sourceOf(reader)),
        `${reader} stopped naming the Release selection command at all`,
      );
    }
    for (const reader of ['src/status-bar.ts', 'src/selector-rows.ts']) {
      assert.ok(
        /SWITCH_ANCHOR_COMMAND/.test(sourceOf(reader)),
        `${reader} stopped naming the Aggrega workspace switch command at all`,
      );
    }
  });

  it('has both contributed by the manifest, which is what makes them reachable', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8'),
    ) as { contributes: { commands: { command: string }[] } };
    const contributed = manifest.contributes.commands.map((entry) => entry.command);
    assert.ok(contributed.includes('aggrega.release.select'));
    assert.ok(contributed.includes('aggrega.workspace.switchAnchor'));
    assert.ok(contributed.includes('aggrega.getStarted.draftRelease'));
    assert.ok(contributed.includes('aggrega.op.scaffold'));
  });
});
