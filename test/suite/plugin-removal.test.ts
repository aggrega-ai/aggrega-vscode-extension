// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  PluginRemoveParams,
  PluginRemoveResult,
  REMOVAL_SUBJECT,
  removalDetail,
  removeParams,
  runPluginRemoval,
} from '../../src/plugin-removal';
import { terminalLine } from '../../src/operation-outcome';
import { EXTENSION_ROOT } from '../helpers/launch-census';

// A DAEMON REFUSAL IS AN ENVELOPE OBJECT, NOT AN ERROR. The client rejects a
// refused request with the raw JSON-RPC error member, so anything that reads a
// failure as `err.message` sees nothing and anything that stringifies it sees
// `[object Object]` — which loses the compiler's whole diagnostic rather than
// re-wording it. The removal's most likely refusal is the one below, so that loss
// would fall on the case a reader meets most.
interface DaemonRefusal {
  code: number;
  message: string;
}

// COMPILER_REFUSAL is what the compiler writes when the query matched no entry.
//
// 🔴 IT IS A LITERAL HERE ON PURPOSE. The extension holds no copy of this
// sentence and must not: it is the compiler's, and the whole property under test
// is that it arrives unaltered. A test that built its expectation from the
// extension's own rendering would move both sides of the comparison at once, so
// it would accept any re-wording — a comparison is blind to a change reaching
// both of its sides.
const COMPILER_REFUSAL =
  'plugin remove: no linter plugin matching "publishing" is configured in '
  + '/work/project/aggrega.yaml; the configuration was left untouched';

const REFUSAL_CODE = -32602;

// answer builds a removal answer, defaulting to the shape the compiler produces
// for a socket attachment: this project's own configuration file.
function answer(over: Partial<PluginRemoveResult> = {}): PluginRemoveResult {
  return {
    type: 'linter',
    query: 'publishing',
    scope: {
      configFile: '/work/project/aggrega.yaml',
      machineWide: false,
      workspaceRoot: '/work/project',
    },
    ...over,
  };
}

// recorder is a removal that records what it was asked and answers as told. It
// stands in for the language server, so the whole decision runs with no
// transport, no compiler and no editor.
function recorder(result: PluginRemoveResult | Error | DaemonRefusal) {
  const sent: PluginRemoveParams[] = [];
  return {
    sent,
    removePlugin(params: PluginRemoveParams) {
      sent.push(params);
      if (result instanceof Error) { return Promise.reject(result); }
      if ('code' in result) { return Promise.reject(result); }
      return Promise.resolve(result);
    },
  };
}

describe('the removal request says only what this surface has decided to say', () => {
  it('carries exactly the type and the query and nothing else', () => {
    // 🔴 THIS IS AN EQUALITY, NOT A PRESENCE, AND THAT IS THE WHOLE POINT. An
    // assertion that the params "contain" the type would pass with a write-target
    // override added beside it — the thing this surface must not send. Exact
    // equality is what makes such an addition fail.
    assert.deepStrictEqual(removeParams('linter', 'publishing'), {
      type: 'linter',
      query: 'publishing',
    });
    assert.deepStrictEqual(
      Object.keys(removeParams('linter', 'publishing')).sort(),
      ['query', 'type'],
    );
  });

  it('sends no write-target override, so the operator\'s default decides the file', () => {
    // Named separately from the equality above because it is the property, and a
    // reader of a failure should see which rule was broken. Which file a removal
    // targets is the operator's setting to make, and pinning it here would decide
    // it for them.
    const params = removeParams('cli', 'x/y') as unknown as Record<string, unknown>;
    for (const forbidden of ['global', 'workspace']) {
      assert.ok(
        !(forbidden in params),
        `${forbidden} must not be sent: it forces which configuration file the removal `
        + 'writes, which is not this surface\'s to decide',
      );
    }
  });

  it('translates no type, whatever the type is', () => {
    // The listing reports a type and the removal accepts one, in the product's
    // own vocabulary on both sides. A mapping here would be a second copy of a
    // set the compiler owns, and it would rot silently.
    for (const type of ['provider', 'governance', 'linter', 'importer', 'cli']) {
      assert.strictEqual(removeParams(type, 'x/y').type, type);
    }
  });

  it('refuses without a reference, so no removal is sent with nothing to match', () => {
    assert.throws(() => removeParams('linter', ''), /takes a reference/);
    assert.throws(() => removeParams('linter', '   '), /takes a reference/);
  });

  it('refuses without a type', () => {
    assert.throws(() => removeParams('', 'x/y'), /takes the plugin's type/);
  });

  it('sends the composed request unchanged, exactly once', async () => {
    const removal = recorder(answer());
    await runPluginRemoval(removal, 'linter', 'publishing');
    assert.deepStrictEqual(removal.sent, [{ type: 'linter', query: 'publishing' }]);
  });

  it('accepts no cancellation, because the compiler cannot interrupt the work', () => {
    // 🔴 THE ARITY IS THE ASSERTION. The shared operation behind the request takes
    // no cancellation and the handler checks for a stopped caller only after that
    // operation has returned, so a stop would stop this side waiting and not the
    // work. Presenting that as a stop breaks the rule that stopping means the
    // compiler stopped.
    //
    // Holding the arity means a fourth parameter carrying a stop has to be argued
    // rather than added, and it fails here the moment one appears.
    assert.strictEqual(
      runPluginRemoval.length,
      3,
      'a fourth argument carrying a stop would offer a stop the compiler cannot honour',
    );
  });
});

describe('a completed removal says what was removed and from where', () => {
  it('names the plugin, the file the write landed in, and how far that file reaches', async () => {
    const outcome = await runPluginRemoval(recorder(answer()), 'linter', 'publishing');
    assert.strictEqual(outcome.kind, 'ok');
    assert.strictEqual(
      terminalLine(REMOVAL_SUBJECT, outcome),
      'The removal removed the linter plugin publishing from /work/project/aggrega.yaml, '
      + 'this project\'s own configuration file.',
    );
  });

  it('says the reach of the file, because one type defaults to the machine-wide one', () => {
    // 🔴 BOTH BRANCHES ARE WHOLE-MESSAGE EQUALITIES rather than containment
    // checks. A containment check passes on a message that keeps the phrase and
    // re-words everything around it, which is the failure this repository has
    // measured — so the property is pinned as the whole sentence.
    assert.strictEqual(
      removalDetail(answer()),
      'removed the linter plugin publishing from /work/project/aggrega.yaml, '
      + 'this project\'s own configuration file.',
    );
    assert.strictEqual(
      removalDetail(answer({
        type: 'cli',
        query: 'deploy',
        scope: {
          configFile: '/home/reader/.config/aggrega/config.yaml',
          machineWide: true,
          workspaceRoot: '/work/project',
        },
      })),
      'removed the cli plugin deploy from /home/reader/.config/aggrega/config.yaml, '
      + 'the global file shared by every project on this machine.',
    );
  });

  it('never describes a project-local write as machine-wide', () => {
    assert.ok(
      !removalDetail(answer()).includes('every project on this machine'),
      'a project-local removal must never be described as reaching the whole machine',
    );
  });

  it('reads the file from the answer rather than predicting it from the type', async () => {
    // The confirmation shown before the removal predicts the file from the
    // plugin's type, because there is no answer to read yet. The ending reports
    // the file the compiler actually wrote — so an answer naming an unexpected
    // file is reported as it came, not as the prediction said.
    const outcome = await runPluginRemoval(
      recorder(answer({ scope: {
        configFile: '/somewhere/else/aggrega.yaml',
        machineWide: false,
        workspaceRoot: '/work/project',
      } })),
      'linter',
      'publishing',
    );
    assert.strictEqual(outcome.kind, 'ok');
    assert.ok(terminalLine(REMOVAL_SUBJECT, outcome).includes('/somewhere/else/aggrega.yaml'));
  });

  it('echoes the type and query the compiler matched, not the ones that were sent', async () => {
    // The answer's own fields are what the sentence is composed from. A compiler
    // that matched a fuller reference than the query typed reports that fuller
    // one, and the reader is told what was actually removed.
    const outcome = await runPluginRemoval(
      recorder(answer({ query: 'oci://hub.aggrega.ai/plugin/linter/publishing:1.0.0' })),
      'linter',
      'publishing',
    );
    assert.strictEqual(outcome.kind, 'ok');
    assert.ok(
      terminalLine(REMOVAL_SUBJECT, outcome)
        .includes('oci://hub.aggrega.ai/plugin/linter/publishing:1.0.0'),
    );
  });

  it('never ends in silence, whatever the answer carried', async () => {
    // Silence never means success. Every shape of answer produces a sentence with
    // something in it, so no removal can end in nothing.
    const shapes: Partial<PluginRemoveResult>[] = [
      {},
      { type: 'cli' },
      { query: 'x/y' },
      { scope: { configFile: '/c', machineWide: true, workspaceRoot: '/w' } },
    ];
    for (const over of shapes) {
      const outcome = await runPluginRemoval(recorder(answer(over)), 'linter', 'publishing');
      assert.strictEqual(outcome.kind, 'ok');
      assert.ok(terminalLine(REMOVAL_SUBJECT, outcome).trim().length > 0);
    }
  });
});

describe('the compiler\'s own words reach the reader', () => {
  it('carries a refused removal\'s diagnostic through as an exact line', async () => {
    // 🔴 THE ASSERTION IS AN EQUALITY AGAINST A LITERAL THE IMPLEMENTATION DOES
    // NOT READ. A substring check would pass on a truncated diagnostic and on a
    // wrapper sentence with the compiler's text buried in it; an equality against
    // the whole rendered line cannot.
    const outcome = await runPluginRemoval(
      recorder({ code: REFUSAL_CODE, message: COMPILER_REFUSAL }),
      'linter',
      'publishing',
    );
    assert.strictEqual(outcome.kind, 'failed');
    assert.strictEqual(
      outcome.kind === 'failed' ? outcome.message : '',
      `code=${REFUSAL_CODE} ${COMPILER_REFUSAL}`,
    );
    assert.strictEqual(
      terminalLine(REMOVAL_SUBJECT, outcome),
      `The removal did not complete: code=${REFUSAL_CODE} ${COMPILER_REFUSAL}`,
    );
  });

  it('keeps the two facts the compiler named, which a wrapper message would discard', async () => {
    const outcome = await runPluginRemoval(
      recorder({ code: REFUSAL_CODE, message: COMPILER_REFUSAL }),
      'linter',
      'publishing',
    );
    const line = terminalLine(REMOVAL_SUBJECT, outcome);
    // The load-bearing halves of the compiler's sentence: the file it looked in,
    // and that nothing was changed. A reader acts on both.
    assert.ok(line.includes('/work/project/aggrega.yaml'));
    assert.ok(line.includes('the configuration was left untouched'));
    assert.ok(
      !line.includes('[object Object]'),
      'a refusal rendered as [object Object] loses the whole diagnostic',
    );
  });

  it('reports a query that matched nothing as a failure, never as a completion', async () => {
    // A removal that matched no entry left the configuration alone, so reporting
    // it as done would tell a reader a plugin stopped participating when it did
    // not. The compiler halts on it, and the ending carries that.
    const outcome = await runPluginRemoval(
      recorder({ code: REFUSAL_CODE, message: COMPILER_REFUSAL }),
      'linter',
      'publishing',
    );
    assert.strictEqual(outcome.kind, 'failed');
  });

  it('carries the message of a transport failure that is a real error', async () => {
    // Not every failure is a language-server refusal: a request sent while no
    // server is running throws an ordinary error, and its sentence is what the
    // reader needs — it names the state to fix rather than the operation.
    const outcome = await runPluginRemoval(
      recorder(new Error('the Aggrega language server is not running')),
      'linter',
      'publishing',
    );
    assert.deepStrictEqual(outcome, {
      kind: 'failed',
      message: 'the Aggrega language server is not running',
    });
  });
});

// --- one execution path per operation ------------------------------------

describe('the removal reaches the compiler without a launch', () => {
  it('gives the module that decides a removal no way to reach a process', () => {
    // Read as the WHOLE import list, so a module added to it has to be looked at
    // — including one that could start a process and one that would carry the
    // editor in, which is what keeps the removal decision readable without a
    // host.
    const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src/plugin-removal.ts'), 'utf8');
    const imported = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    assert.deepStrictEqual(
      imported.sort(),
      ['./config-write-scope', './operation-groups', './operation-outcome'],
    );
  });

  it('🔴 LEAVES THE LAUNCH HELPER EXACTLY THREE DIRECT CALL SITES, EACH ACCOUNTED FOR', () => {
    // A COUNT rather than a presence, and per module rather than over the tree.
    // The claim is that each remaining launch is accounted for, and a count is
    // the only shape that can express it: a presence check passes whatever the
    // number, and a tree-wide total hides which module a launch sits in.
    //
    // The survivors are accounted for rather than tolerated: one catalog
    // generation whose destination is written to and stays confined to the
    // workspace while the picker that chooses it yields an absolute path, and the
    // wrapper that supplies a stop to the operations that have one.
    //
    // The operations panel is absent from the list, and the reason is the import:
    // its source is READ, so the request surface resolves it as a file the reader
    // selected and accepts one naming anywhere on the machine — which is what
    // makes a request able to serve it at all.
    const dir = path.join(EXTENSION_ROOT, 'src');
    const sites = new Map<string, number>();
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      const count = (source.match(/(?:^|[^a-zA-Z.])runCli\(/gm) ?? []).length;
      if (count > 0) { sites.set(file, count); }
    }
    assert.deepStrictEqual(
      [...sites.entries()].sort(),
      [
        // The declaration and the one call inside the watchable wrapper.
        ['cli-operation.ts', 2],
        ['plugins-view.ts', 1],
      ],
      'the launch helper gained or lost a direct call site; each one is a process launch and '
      + 'each needs a stated reason to exist',
    );
  });

  it('fires on the module it measures, so the zero for the removal is an absence', () => {
    // 🔴 THE POSITIVE CONTROL for the count above, and it is what makes the
    // removal's absence mean anything. The pattern must still match a module that
    // provably calls the helper — otherwise a pattern that stopped matching would
    // report every module clean and the removal would look moved whether it was
    // or not.
    //
    // The control is the plugins panel, which still runs an attachment as a
    // command: it is on the same side of the claim as the subject and moves
    // independently of it.
    const source = fs.readFileSync(path.join(EXTENSION_ROOT, 'src/plugins-view.ts'), 'utf8');
    const count = (source.match(/(?:^|[^a-zA-Z.])runCli\(/gm) ?? []).length;
    assert.ok(
      count > 0,
      'the call-site pattern no longer matches plugins-view.ts, which provably calls the '
      + 'launch helper, so it can no longer detect a module that does',
    );
  });

  it('sends the removal from exactly one place', () => {
    // The request has one sender. A second would be a second execution path for
    // one operation, which is the shape a single execution path exists to rule
    // out.
    const dir = path.join(EXTENSION_ROOT, 'src');
    const senders = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /'aggrega\/pluginRemove'/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
      .sort();
    assert.deepStrictEqual(senders, ['extension.ts']);
  });
});
