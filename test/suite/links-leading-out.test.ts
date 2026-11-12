// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

// The one sentence every surface says about the links leading out of the
// workspace that the language server did not read. Each surface names what it
// withholds and how; the reason, the order of the names and the wording for one
// link or several are the composition's, so they read the same wherever the
// sentence is drawn.

import * as assert from 'node:assert';

import { describeLinksLeadingOut } from '../../src/links-leading-out';

describe('the sentence about links leading out of the workspace', () => {
  it('is no sentence where the answer names no link', () => {
    assert.strictEqual(
      describeLinksLeadingOut({ unreadLinkedDirs: [], unreadLinkedFiles: [] }, { things: 'Entities', as: 'listed' }),
      null,
    );
  });

  it('names what a surface withholds, and how, in the words for one link and for several', () => {
    assert.strictEqual(
      describeLinksLeadingOut({ unreadLinkedDirs: [], unreadLinkedFiles: ['linked-component.yaml'] }, { things: 'Entities', as: 'listed' }),
      'Entities reached through this link are not listed, because it leads outside the Aggrega workspace: linked-component.yaml',
    );
    assert.strictEqual(
      describeLinksLeadingOut({ unreadLinkedDirs: ['shared'], unreadLinkedFiles: ['linked-feature.yaml'] }, { things: 'Features', as: 'offered' }),
      'Features reached through these links are not offered, because each leads outside the Aggrega workspace: shared, linked-feature.yaml',
    );
  });

  it('names the links to directories, then the links to files, each in the order the answer gives it', () => {
    // Ordered so that a sorted list, or the files named first, would read
    // differently.
    const sentence = describeLinksLeadingOut(
      { unreadLinkedDirs: ['zeta/shared', 'alpha/shared'], unreadLinkedFiles: ['zeta/linked.yaml', 'alpha/linked.yaml'] },
      { things: 'Releases', as: 'offered' },
    );
    assert.ok(
      sentence !== null && sentence.endsWith(': zeta/shared, alpha/shared, zeta/linked.yaml, alpha/linked.yaml'),
      `the names, in order: ${sentence}`,
    );
  });
});
