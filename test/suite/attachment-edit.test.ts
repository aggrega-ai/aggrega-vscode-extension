// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import {
  AttachmentSite,
  Insertion,
  attachmentEntryLines,
  attachmentSites,
  composeInsertionText,
  insertionEncoding,
  insertionPositionInDocument,
  instanceNameFor,
  placeAttachment,
  readInsertion,
  refusesEntryShape,
} from '../../src/attachment-edit';

// The two documents the compiler's own locating tests are written against: one
// where the attachments block has to be created, one where it has to be
// extended. They are reproduced here so both sides of the boundary are exercised
// over the same two shapes — the side that answers where, and the side that
// composes what goes there.
const ABSENT_BLOCK = 'kind: Aggregate\n'
  + 'metadata:\n'
  + '  name: web-app\n'
  + 'spec:\n'
  + '  components:\n'
  + '    web:\n'
  + '      type: core/service\n';

const EXISTING_BLOCK = 'kind: Aggregate\n'
  + 'metadata:\n'
  + '  name: web-app\n'
  + 'spec:\n'
  + '  components:\n'
  + '    web:\n'
  + '      type: core/service\n'
  + '      features:\n'
  + '        metrics:\n'
  + '          type: core/metrics\n';

// answer builds a well-formed answer, so a case states only the field it is
// about and a reader can see which one that is.
function answer(over: Partial<Insertion> = {}): Insertion {
  return {
    file: 'aggregates/web.yaml',
    positionEncoding: 'utf-16',
    position: { line: 0, character: 0 },
    precededByLineBreak: true,
    missingContainerKeys: [],
    entryIndent: 8,
    indentStep: 2,
    indentStepMeasured: true,
    entryShape: 'mapping',
    ...over,
  };
}

// applyAt splices text in at a line and column the way the editor does: a
// zero-width insertion that replaces nothing.
function applyAt(source: string, line: number, character: number, text: string): string {
  const lines = source.split('\n');
  let offset = 0;
  for (let i = 0; i < line; i++) {
    offset += (lines[i] ?? '').length + 1;
  }
  const at = offset + character;
  return source.slice(0, at) + text + source.slice(at);
}

function site(over: Partial<AttachmentSite> = {}): AttachmentSite {
  return {
    nodeId: 'web',
    sourceFile: 'aggregates/web.yaml',
    authoredAtTopLevel: true,
    attached: [],
    ...over,
  };
}

describe('instanceNameFor', () => {
  it('takes the Feature\'s own name, without the namespace it is published in', () => {
    assert.strictEqual(instanceNameFor('observability/prometheus-scrape'), 'prometheus-scrape');
    assert.strictEqual(instanceNameFor('core/observability/logging'), 'logging');
    assert.strictEqual(instanceNameFor('logging'), 'logging');
  });

  it('drops a version, which says which Feature is requested and not what it is called here', () => {
    assert.strictEqual(instanceNameFor('observability/scrape:1.2.0'), 'scrape');
  });

  it('refuses a name the attachment surface cannot carry, rather than reshaping one', () => {
    // The name decides whether the attachment fills a slot the Component
    // declares or stands free, so a silent rewrite would change what it does.
    assert.strictEqual(instanceNameFor('observability/'), null);
    assert.strictEqual(instanceNameFor(''), null);
    assert.strictEqual(instanceNameFor('has space'), null);
    assert.strictEqual(instanceNameFor('has.dot'), null);
  });
});

describe('placeAttachment', () => {
  it('states where an attachment goes for a component authored at the top level', () => {
    const placed = placeAttachment(site(), 'observability/prometheus-scrape');
    assert.deepStrictEqual(placed, {
      file: 'aggregates/web.yaml',
      container: ['spec', 'components', 'web', 'features'],
      instanceName: 'prometheus-scrape',
    });
  });

  it('REFUSES a component authored inside a subsystem instead of guessing its keys', () => {
    // Recovering the keys the author wrote would mean splitting a scope name on
    // a separator this side would have to know, and a component reached through
    // an imported Aggregate is named in a way that split cannot be told from. A
    // path built on either guess addresses nothing — and addressing nothing does
    // not fail: the answer would report the whole path as absent and the entry
    // would be created under keys nobody authored.
    const placed = placeAttachment(site({ authoredAtTopLevel: false }), 'observability/scrape');
    assert.ok('refusal' in placed);
    assert.ok(placed.refusal.includes('subsystem'));
    // The refusal names the file, so the reader can make the edit themselves.
    assert.ok(placed.refusal.includes('aggregates/web.yaml'));
  });

  it('refuses a name already attached, which would be a second key of the same name', () => {
    const placed = placeAttachment(site({ attached: ['prometheus-scrape'] }),
      'observability/prometheus-scrape');
    assert.ok('refusal' in placed);
    assert.ok(placed.refusal.includes('prometheus-scrape'));
  });

  it('refuses when the compiler named no authoring file for the node', () => {
    const placed = placeAttachment(site({ sourceFile: '' }), 'observability/scrape');
    assert.ok('refusal' in placed);
  });

  it('refuses a Feature whose name yields nothing an attachment can be written under', () => {
    const placed = placeAttachment(site(), 'observability/');
    assert.ok('refusal' in placed);
  });
});

describe('readInsertion', () => {
  it('reads a whole answer', () => {
    const read = readInsertion({
      file: 'aggregates/web.yaml',
      container: ['spec', 'components', 'web', 'features'],
      positionEncoding: 'utf-8',
      position: { line: 6, character: 24 },
      precededByLineBreak: true,
      missingContainerKeys: ['features'],
      entryIndent: 8,
      indentStep: 2,
      indentStepMeasured: true,
      entryShape: 'unknown',
    });
    assert.ok(read !== null);
    assert.strictEqual(read.entryIndent, 8);
    assert.strictEqual(read.positionEncoding, 'utf-8');
    assert.deepStrictEqual(read.missingContainerKeys, ['features']);
  });

  it('reads an absent list of missing keys as the whole path already being there', () => {
    // The compiler reports "nothing is missing" as an absent list rather than an
    // empty one, so an absent list is a positive finding and not a gap.
    const read = readInsertion({
      file: 'a.yaml',
      positionEncoding: 'utf-16',
      position: { line: 1, character: 2 },
      precededByLineBreak: true,
      entryIndent: 4,
      indentStep: 2,
      indentStepMeasured: false,
      entryShape: 'mapping',
    });
    assert.ok(read !== null);
    assert.deepStrictEqual(read.missingContainerKeys, []);
  });

  it('refuses an answer missing any field that decides where bytes land', () => {
    const whole: Record<string, unknown> = {
      file: 'a.yaml',
      positionEncoding: 'utf-16',
      position: { line: 1, character: 2 },
      precededByLineBreak: true,
      missingContainerKeys: [],
      entryIndent: 4,
      indentStep: 2,
      indentStepMeasured: true,
      entryShape: 'mapping',
    };
    // Each of these decides part of where the entry goes. A default in place of
    // any one of them writes a well-formed entry into the wrong place, which
    // nothing reports.
    for (const field of [
      'position', 'precededByLineBreak', 'entryIndent', 'indentStep', 'indentStepMeasured',
    ]) {
      const partial = { ...whole };
      delete partial[field];
      assert.strictEqual(readInsertion(partial), null, `${field} was defaulted rather than refused`);
    }
  });

  it('refuses a shape it cannot read at all', () => {
    assert.strictEqual(readInsertion(null), null);
    assert.strictEqual(readInsertion('an answer'), null);
    assert.strictEqual(readInsertion([]), null);
    assert.strictEqual(readInsertion({ ...answer(), position: 'here' }), null);
  });

  it('refuses numbers no position can be built from', () => {
    const base: Record<string, unknown> = { ...answer() };
    assert.strictEqual(readInsertion({ ...base, position: { line: -1, character: 0 } }), null);
    assert.strictEqual(readInsertion({ ...base, position: { line: 0, character: 1.5 } }), null);
    assert.strictEqual(readInsertion({ ...base, entryIndent: -2 }), null);
    // A step of zero collapses the arithmetic every indent below is computed
    // with, and a collapsed indent produces a document that no longer parses.
    assert.strictEqual(readInsertion({ ...base, indentStep: 0 }), null);
  });

  it('refuses a missing-keys list carrying anything but keys', () => {
    assert.strictEqual(readInsertion({ ...answer(), missingContainerKeys: [1, 2] }), null);
    assert.strictEqual(readInsertion({ ...answer(), missingContainerKeys: 'features' }), null);
  });
});

describe('insertionEncoding', () => {
  it('reports the units the answer states', () => {
    assert.strictEqual(insertionEncoding(answer({ positionEncoding: 'utf-8' })), 'utf-8');
    assert.strictEqual(insertionEncoding(answer({ positionEncoding: 'utf-16' })), 'utf-16');
  });

  it('refuses units it cannot convert from, rather than assuming the commoner one', () => {
    // Assuming would be wrong exactly on the documents where the two differ,
    // which are the ones carrying text outside the range they agree on.
    assert.strictEqual(insertionEncoding(answer({ positionEncoding: 'utf-32' })), null);
    assert.strictEqual(insertionEncoding(answer({ positionEncoding: '' })), null);
  });
});

describe('insertionPositionInDocument', () => {
  it('converts a byte offset into the column the editor counts in', () => {
    // The line carries a character outside the range the two encodings agree
    // on, which is the only case in which the conversion is observable.
    const doc = 'a: "é"\nb: 1\n';
    const at = insertionPositionInDocument(doc, answer({
      positionEncoding: 'utf-8',
      // "a: \"é\"" is 7 bytes and 6 code units: the accented letter is two bytes.
      position: { line: 0, character: 7 },
    }));
    assert.deepStrictEqual(at, { line: 0, character: 6 });
  });

  it('leaves a position already in the editor\'s units alone', () => {
    const at = insertionPositionInDocument('a: "é"\n', answer({
      positionEncoding: 'utf-16',
      position: { line: 0, character: 6 },
    }));
    assert.deepStrictEqual(at, { line: 0, character: 6 });
  });

  it('reports nothing for units it cannot convert from', () => {
    assert.strictEqual(
      insertionPositionInDocument('a: 1\n', answer({ positionEncoding: 'utf-32' })),
      null,
    );
  });
});

describe('refusesEntryShape', () => {
  it('refuses a container the document carries as a list', () => {
    // An entry written as a key into a block sequence produces a document that
    // no longer parses, so what the compiler read off the document is checked
    // rather than assumed from what the container is called.
    assert.notStrictEqual(refusesEntryShape(answer({ entryShape: 'sequence' })), '');
  });

  it('admits a mapping, and a container the document has not shaped yet', () => {
    assert.strictEqual(refusesEntryShape(answer({ entryShape: 'mapping' })), '');
    assert.strictEqual(refusesEntryShape(answer({ entryShape: 'unknown' })), '');
  });
});

describe('composeInsertionText', () => {
  it('writes only the entry where the whole container path is already there', () => {
    const text = composeInsertionText(
      answer({ missingContainerKeys: [], entryIndent: 8, indentStep: 2 }),
      ['logging:', '  type: core/logging'],
    );
    assert.strictEqual(text, '\n        logging:\n          type: core/logging');
  });

  it('writes each container key the document does not carry, outermost first', () => {
    // The first key sits as far in as the entry minus one step per missing key,
    // and each key after it one step further, so the entry lands inside them.
    const text = composeInsertionText(
      answer({ missingContainerKeys: ['components', 'web', 'features'], entryIndent: 8, indentStep: 2 }),
      ['logging:'],
    );
    assert.strictEqual(
      text,
      '\n  components:\n    web:\n      features:\n        logging:',
    );
  });

  it('opens with no break where the position sits at the start of an empty document', () => {
    const text = composeInsertionText(
      answer({ precededByLineBreak: false, missingContainerKeys: [], entryIndent: 0 }),
      ['logging:'],
    );
    assert.strictEqual(text, 'logging:');
  });

  it('indents by the step the document itself uses, not by a fixed width', () => {
    const text = composeInsertionText(
      answer({ missingContainerKeys: ['features'], entryIndent: 16, indentStep: 4 }),
      attachmentEntryLines('logging', 'core/logging', 4),
    );
    assert.strictEqual(
      text,
      '\n            features:\n                logging:\n                    type: core/logging',
    );
  });
});

describe('the edit an answer produces, applied to the document it was computed over', () => {
  it('creates the attachments block where the component has none', () => {
    // The answer the compiler reports for this document and this container: the
    // block is absent, the entry sits one step inside the component's own keys,
    // and the position is the end of the last line the component's block reaches.
    const insertion = answer({
      missingContainerKeys: ['features'],
      entryIndent: 8,
      indentStep: 2,
      entryShape: 'unknown',
      position: { line: 6, character: '      type: core/service'.length },
    });
    const at = insertionPositionInDocument(ABSENT_BLOCK, insertion);
    assert.ok(at !== null);

    const edited = applyAt(ABSENT_BLOCK, at.line, at.character, composeInsertionText(
      insertion,
      attachmentEntryLines('logging', 'core/logging', insertion.indentStep),
    ));

    assert.strictEqual(edited,
      'kind: Aggregate\n'
      + 'metadata:\n'
      + '  name: web-app\n'
      + 'spec:\n'
      + '  components:\n'
      + '    web:\n'
      + '      type: core/service\n'
      + '      features:\n'
      + '        logging:\n'
      + '          type: core/logging\n');
  });

  it('extends the attachments block the component already has, disturbing nothing in it', () => {
    const insertion = answer({
      missingContainerKeys: [],
      entryIndent: 8,
      indentStep: 2,
      entryShape: 'mapping',
      position: { line: 9, character: '          type: core/metrics'.length },
    });
    const at = insertionPositionInDocument(EXISTING_BLOCK, insertion);
    assert.ok(at !== null);

    const edited = applyAt(EXISTING_BLOCK, at.line, at.character, composeInsertionText(
      insertion,
      attachmentEntryLines('logging', 'core/logging', insertion.indentStep),
    ));

    assert.strictEqual(edited,
      'kind: Aggregate\n'
      + 'metadata:\n'
      + '  name: web-app\n'
      + 'spec:\n'
      + '  components:\n'
      + '    web:\n'
      + '      type: core/service\n'
      + '      features:\n'
      + '        metrics:\n'
      + '          type: core/metrics\n'
      + '        logging:\n'
      + '          type: core/logging\n');
    // What the author already wrote is still there, byte for byte, ahead of the
    // new entry.
    assert.ok(edited.startsWith(EXISTING_BLOCK.slice(0, EXISTING_BLOCK.length - 1)));
  });
});

describe('attachmentSites', () => {
  const graph = {
    spec: {
      nodes: {
        web: {
          source_file: 'aggregates/web.yaml',
          synthesized_subsystem: true,
        },
        ledger: {
          source_file: 'aggregates/finance.yaml',
          synthesized_subsystem: false,
        },
      },
      feature_values_mapping: {
        web: { metrics: { type: 'core/metrics' } },
      },
    },
  };

  it('reads each node\'s authoring file and where it was authored', () => {
    const sites = attachmentSites(graph);
    assert.deepStrictEqual(sites.get('web'), {
      nodeId: 'web',
      sourceFile: 'aggregates/web.yaml',
      authoredAtTopLevel: true,
      attached: ['metrics'],
    });
    assert.deepStrictEqual(sites.get('ledger'), {
      nodeId: 'ledger',
      sourceFile: 'aggregates/finance.yaml',
      authoredAtTopLevel: false,
      attached: [],
    });
  });

  it('keeps names and a path per node and no authored value', () => {
    // The panel's payload is redacted before it crosses into the view; this
    // table is kept on the other side, so it holds nothing that redaction
    // removes.
    const site = attachmentSites(graph).get('web');
    assert.ok(site !== undefined);
    assert.deepStrictEqual(Object.keys(site).sort(),
      ['attached', 'authoredAtTopLevel', 'nodeId', 'sourceFile']);
    assert.deepStrictEqual(site.attached, ['metrics']);
  });

  it('reads a payload in an unexpected shape as no sites, rather than failing', () => {
    assert.strictEqual(attachmentSites(null).size, 0);
    assert.strictEqual(attachmentSites({}).size, 0);
    assert.strictEqual(attachmentSites({ spec: {} }).size, 0);
    assert.strictEqual(attachmentSites({ spec: { nodes: 'some' } }).size, 0);
  });

  it('reports a node the compiler sent no authoring file for, rather than dropping it', () => {
    // Dropping it would be indistinguishable from the node not being in the
    // graph, and the two are told apart by different sentences.
    const sites = attachmentSites({ spec: { nodes: { orphan: {} } } });
    assert.deepStrictEqual(sites.get('orphan'), {
      nodeId: 'orphan',
      sourceFile: '',
      authoredAtTopLevel: false,
      attached: [],
    });
  });
});
