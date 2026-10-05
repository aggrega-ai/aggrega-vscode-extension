// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';

import { AttachCandidatesDeps, FEATURES_NOT_OFFERED, postAttachCandidates } from '../../src/attach-candidates';
import { AttachCandidatesRequest } from '../../src/attachment-edit';
import { describeLinksLeadingOut } from '../../src/links-leading-out';
import { CatalogIndexParams } from '../../src/types';
import { CatalogIndexDoc } from '../../src/workspace-catalog-run';

// What the graph panel's list of what may attach is sent for each answer: the
// answer about one node of the drawn graph, and — where the entity index, asked
// in the terms of the same Release, names links leading out of the workspace —
// the line naming them, posted with it.

const RELEASE = 'release-compose.yaml';
const NODE = 'db';
const REQUEST_ID = 7;

// ANSWER stands for whatever the language server answered about what may attach.
// It is posted untouched, so its contents are not what these specs read.
const ANSWER = { node: NODE, nodeLabels: {}, labelSource: 'resolved', candidates: [{ kind: 'Feature', name: 'core/secret-value', file: '', origin: 'catalog' }] };

function index(dirs: string[] | undefined, files: string[] | undefined): CatalogIndexDoc {
  const doc: Record<string, unknown> = { entities: [] };
  if (dirs !== undefined) { doc.unreadLinkedDirs = dirs; }
  if (files !== undefined) { doc.unreadLinkedFiles = files; }
  return doc as unknown as CatalogIndexDoc;
}

interface Recorded {
  posted: unknown[];
  channel: string[];
  attachAsked: AttachCandidatesRequest[];
  indexAsked: CatalogIndexParams[];
}

// over runs one question against the two answers given, and records what was
// asked, what was posted to the panel and what was written to the channel.
async function over(
  candidates: () => Promise<unknown>,
  catalogIndex: () => Promise<CatalogIndexDoc>,
): Promise<Recorded> {
  const rec: Recorded = { posted: [], channel: [], attachAsked: [], indexAsked: [] };
  const deps: AttachCandidatesDeps = {
    requestAttachCandidates: (request) => { rec.attachAsked.push(request); return candidates(); },
    requestCatalogIndex: (params) => { rec.indexAsked.push(params); return catalogIndex(); },
    output: { appendLine: (line) => { rec.channel.push(line); } },
  };
  await postAttachCandidates({ post: (m) => { rec.posted.push(m); } }, deps, NODE, RELEASE, REQUEST_ID);
  return rec;
}

const answered = (): Promise<unknown> => Promise.resolve(ANSWER);
const naming = (dirs: string[] | undefined, files: string[] | undefined) => (): Promise<CatalogIndexDoc> => Promise.resolve(index(dirs, files));
const refused = (message: string) => (): Promise<never> => Promise.reject(new Error(message));

describe('the list of what may attach, and the links leading out of the workspace', () => {
  it('posts the line naming the link with the answer, where the index names one', async () => {
    const rec = await over(answered, naming([], ['linked-feature.yaml']));
    assert.deepStrictEqual(rec.posted, [{
      type: 'attachCandidates', nodeId: NODE, requestId: REQUEST_ID, result: ANSWER,
      linksNote: 'Features reached through this link are not offered, because it leads outside the Aggrega workspace: linked-feature.yaml',
    }]);
    assert.deepStrictEqual(rec.channel, []);
  });

  it('names the links to directories, then the links to files, in the one sentence every surface says', async () => {
    const links = { unreadLinkedDirs: ['zeta-dir', 'alpha-dir'], unreadLinkedFiles: ['zeta.yaml', 'alpha.yaml'] };
    const rec = await over(answered, naming(links.unreadLinkedDirs, links.unreadLinkedFiles));
    const [message] = rec.posted as { linksNote?: string }[];
    assert.deepStrictEqual(FEATURES_NOT_OFFERED, { things: 'Features', as: 'offered' });
    assert.strictEqual(message.linksNote, describeLinksLeadingOut(links, FEATURES_NOT_OFFERED));
    assert.strictEqual(
      message.linksNote,
      'Features reached through these links are not offered, because each leads outside the Aggrega workspace: zeta-dir, alpha-dir, zeta.yaml, alpha.yaml',
    );
  });

  it('posts the answer exactly as it is without a line, where the index names no link', async () => {
    for (const [dirs, files] of [[[], []], [undefined, undefined]] as const) {
      const rec = await over(answered, naming(dirs as string[] | undefined, files as string[] | undefined));
      assert.deepStrictEqual(
        rec.posted, [{ type: 'attachCandidates', nodeId: NODE, requestId: REQUEST_ID, result: ANSWER }],
        `an index carrying ${dirs === undefined ? 'neither list' : 'two empty lists'} added something to the answer`,
      );
      assert.deepStrictEqual(rec.channel, []);
    }
  });

  it('leaves the answer as it is where the index cannot be read, and says why on the channel, once', async () => {
    const rec = await over(answered, refused('the index could not be read'));
    assert.deepStrictEqual(rec.posted, [{ type: 'attachCandidates', nodeId: NODE, requestId: REQUEST_ID, result: ANSWER }]);
    assert.deepStrictEqual(rec.channel, [
      `catalogIndex failed for ${NODE}, so the list of what may attach names no link leading out of the workspace: the index could not be read`,
    ]);
  });

  it('posts a refused list as the refusal alone, whatever the index answered', async () => {
    for (const catalogIndex of [naming([], ['linked-feature.yaml']), refused('the index could not be read')]) {
      const rec = await over(refused('the Aggrega language server is not running'), catalogIndex);
      assert.deepStrictEqual(rec.posted, [{
        type: 'attachCandidatesError', nodeId: NODE, requestId: REQUEST_ID, message: 'the Aggrega language server is not running',
      }]);
      assert.deepStrictEqual(rec.channel, [`attachCandidates failed for ${NODE}: the Aggrega language server is not running`]);
    }
  });

  it('asks the index in the terms of the Release the list is asked about', async () => {
    const rec = await over(answered, naming([], []));
    assert.deepStrictEqual(rec.attachAsked, [{ graphNode: NODE, release: RELEASE }]);
    assert.deepStrictEqual(rec.indexAsked, [{ release: RELEASE }]);
  });

  it('has both questions in flight together', async () => {
    // The answer about what may attach is held back until the index has been
    // asked, or for a moment where it is not: a host asking one after the other
    // asks the index only once that answer is in, which reads here as held.
    let indexAsked: () => void = () => undefined;
    const asked = new Promise<void>((resolve) => { indexAsked = resolve; });
    let answeredFirst = false;
    const posted: unknown[] = [];
    const deps: AttachCandidatesDeps = {
      requestAttachCandidates: async () => {
        await Promise.race([asked, new Promise((resolve) => setTimeout(resolve, 200))]);
        answeredFirst = true;
        return ANSWER;
      },
      requestCatalogIndex: () => { if (!answeredFirst) { indexAsked(); } return Promise.resolve(index([], [])); },
      output: { appendLine: () => undefined },
    };
    let held = true;
    void asked.then(() => { held = false; });
    await postAttachCandidates({ post: (m) => { posted.push(m); } }, deps, NODE, RELEASE, REQUEST_ID);
    assert.strictEqual(held, false, 'the index was not asked until what may attach had been answered');
    assert.strictEqual(posted.length, 1);
  });
});
