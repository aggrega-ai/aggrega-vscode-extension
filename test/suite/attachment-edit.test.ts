// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AttachmentSite,
  ConnectionSite,
  Insertion,
  attachCandidatesRequest,
  attachFailureLine,
  attachRefusal,
  attachmentContainerRequest,
  attachmentEntryLines,
  attachmentSites,
  composeInsertionText,
  connectionCandidatesRequest,
  connectionContainerRequest,
  connectionNotDrawn,
  connectionSites,
  fillSlot,
  insertionEncoding,
  insertionPositionInDocument,
  instanceNameFor,
  nameAttachment,
  readAttachmentContainer,
  readInsertion,
  refusesEntryShape,
} from '../../src/attachment-edit';
import { loadAttachmentsModel } from '../../src/graph-payload';
import { ERR_ENTITY_NOT_RESOLVABLE } from '../../src/types';
import { EXTENSION_ROOT } from '../helpers/launch-census';

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
    attached: [],
    ...over,
  };
}

// A refusal envelope as the transport delivers one: the numeric code is what
// tells a compiler refusal from anything else the extension throws, and the
// message is the compiler's own wording for the refusal.
function refusalEnvelope(reason: string): unknown {
  return {
    code: ERR_ENTITY_NOT_RESOLVABLE,
    message: `no container is reported for ledger on the compiled graph of releases/dev.yaml: ${reason}`,
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

describe('nameAttachment', () => {
  it('reports the name the attachment is written under and nothing about a document', () => {
    // The keys are asserted rather than only the name: a file or a container
    // path coming back here is this side composing a structural claim about an
    // Aggregate again, which is the whole thing asking the compiler removed.
    const named = nameAttachment(site(), 'observability/prometheus-scrape');
    assert.deepStrictEqual(named, { instanceName: 'prometheus-scrape' });
    assert.deepStrictEqual(Object.keys(named), ['instanceName']);
  });

  it('names a component authored inside a subsystem exactly as it names any other', () => {
    // The site carries no notion of how the node was authored, so there is
    // nothing here to refuse on. Where the entry goes is asked of the compiler
    // and is the same question for both authoring shapes.
    const named = nameAttachment(site({ nodeId: 'finance.ledger' }), 'observability/scrape');
    assert.deepStrictEqual(named, { instanceName: 'scrape' });
  });

  it('refuses a name already attached, which would be a second key of the same name', () => {
    const named = nameAttachment(site({ attached: ['prometheus-scrape'] }),
      'observability/prometheus-scrape');
    assert.ok('refusal' in named);
    assert.ok(named.refusal.includes('prometheus-scrape'));
  });

  it('refuses a Feature whose name yields nothing an attachment can be written under', () => {
    const named = nameAttachment(site(), 'observability/');
    assert.ok('refusal' in named);
  });
});

describe('attachmentContainerRequest', () => {
  it('carries the node id and the Release, and nothing composed on this side', () => {
    const request = attachmentContainerRequest(site({ nodeId: 'finance.ledger' }),
      'releases/dev.yaml');
    assert.deepStrictEqual(request, { graphNode: 'finance.ledger', release: 'releases/dev.yaml' });
    // Named field by field, because a third key could only be something this
    // side had invented: the document, or a path into it.
    assert.deepStrictEqual(Object.keys(request).sort(), ['graphNode', 'release']);
  });
});

describe('attachCandidatesRequest', () => {
  it('asks by the drawn node and the Release its graph was built from, and carries no label set', () => {
    const request = attachCandidatesRequest('db', 'release-helm-synth.yaml');
    assert.deepStrictEqual(request, { graphNode: 'db', release: 'release-helm-synth.yaml' });
    // Named field by field. The request refuses a Release beside a label set,
    // and a label set alone is answered from the workspace's own catalog
    // directories — so a label set appearing here would stop the answer
    // following the directories the graph's Release builds against.
    assert.deepStrictEqual(Object.keys(request).sort(), ['graphNode', 'release']);
  });

  it('asks the same coordinate the attachment container is asked with', () => {
    // Both questions are about one node of one drawn graph, so the two are
    // addressed identically: an answer about what may attach and the edit that
    // commits one cannot come to name different nodes or different Releases.
    const release = 'releases/dev.yaml';
    assert.deepStrictEqual(
      attachCandidatesRequest('finance.ledger', release),
      attachmentContainerRequest(site({ nodeId: 'finance.ledger' }), release),
    );
  });
});

describe('readAttachmentContainer', () => {
  it('hands on the segments of a nested answer exactly as they arrived', () => {
    // A component authored two subsystems deep. The segments are longer than
    // anything this side ever composed, they repeat a key between levels, and
    // one of them carries a dot — which is precisely why a joined path could
    // not be read back into parts.
    const wire = {
      node: 'finance.ledger',
      file: 'aggregates/finance.yaml',
      container: ['spec', 'subsystems', 'finance', 'subsystems', 'ledger.core',
        'components', 'ledger', 'features'],
    };
    const located = readAttachmentContainer(wire);
    assert.ok(located !== null);
    assert.strictEqual(located.file, 'aggregates/finance.yaml');
    assert.deepStrictEqual(located.container, wire.container);
  });

  it('hands on a top-level answer the same way, with nothing special-cased', () => {
    const located = readAttachmentContainer({
      node: 'web',
      file: 'aggregates/web.yaml',
      container: ['spec', 'components', 'web', 'features'],
    });
    assert.ok(located !== null);
    assert.deepStrictEqual(located.container, ['spec', 'components', 'web', 'features']);
  });

  it('refuses an answer whose document or path is not in a shape it can pass on', () => {
    const whole = {
      node: 'web',
      file: 'aggregates/web.yaml',
      container: ['spec', 'components', 'web', 'features'],
    };
    assert.strictEqual(readAttachmentContainer({ ...whole, file: 7 }), null);
    assert.strictEqual(readAttachmentContainer({ ...whole, container: 'spec.components' }), null);
    assert.strictEqual(readAttachmentContainer({ ...whole, container: ['spec', 4] }), null);
    assert.strictEqual(readAttachmentContainer({ node: 'web' }), null);
    assert.strictEqual(readAttachmentContainer(null), null);
    assert.strictEqual(readAttachmentContainer('a container'), null);
    assert.strictEqual(readAttachmentContainer([]), null);
  });
});

describe('attachFailureLine', () => {
  // The three reasons the compiler declines to report a container, in its own
  // words. They are quoted rather than paraphrased because the point of the
  // assertion is that this side adds no wording of its own: a second wording
  // for one refusal is exactly what a single home for it prevents.
  const REASONS = [
    'the compiled graph carries no node with that id; node ids are the graph\'s own keys, and a '
    + 'node contributed by a sub-aggregate carries a qualified id',
    'the graph records no document for that node, and where an attachment belongs is a fact '
    + 'about a document',
    'the node\'s own block cannot be named in the document it was authored in, so there is no '
    + 'container for an attachment to go inside',
  ];

  for (const reason of REASONS) {
    it(`reports the reason the response carried: ${reason.slice(0, 40)}…`, () => {
      const line = attachFailureLine(refusalEnvelope(reason));
      assert.ok(line.includes(reason), `the reason was not reported: ${line}`);
      // And the node the refusal was about, which the compiler names too.
      assert.ok(line.includes('ledger'));
    });
  }

  it('reports a transport failure by the same rule, with no wording of its own', () => {
    assert.strictEqual(
      attachFailureLine(new Error('the Aggrega language server is not running')),
      attachRefusal('the Aggrega language server is not running'),
    );
  });
});

describe('no container path is composed on this side', () => {
  // The keys an Aggregate spells its components and their attachments with.
  // This side composes no path out of them, because the compiler is asked where
  // an attachment belongs, and this is what fails if such a composition
  // appears. It is deliberately a reading of the source: the composition
  // could return anywhere in any of these files, and no signature would change.
  //
  // Only the quoted spellings are looked for, so prose about an Aggregate's
  // shape is unaffected — which also means a comment that quotes a key trips
  // this, and should be reworded rather than the check loosened.
  const CONTAINER_KEYS = ['spec', 'subsystems', 'components', 'features'];
  const FILES = ['src/attachment-edit.ts', 'src/attach-candidates.ts', 'src/graph-view.ts'];

  for (const rel of FILES) {
    it(`spells no Aggregate container key in ${rel}`, () => {
      const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', rel), 'utf8');
      for (const key of CONTAINER_KEYS) {
        for (const quoted of [`'${key}'`, `"${key}"`]) {
          assert.ok(!source.includes(quoted),
            `${rel} spells ${quoted}: a container path is being composed here again`);
        }
      }
    });
  }
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
  // The payload carries each node's authoring file and whether its enclosing
  // scope was one normalization generated. Both are left in this fixture on
  // purpose: the assertions below are what shows they are not picked up, since
  // reading either would be this side forming its own idea of where a
  // component was written.
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

  it('reads the names already attached to each node the graph carries', () => {
    const sites = attachmentSites(graph);
    assert.deepStrictEqual(sites.get('web'), {
      nodeId: 'web',
      attached: ['metrics'],
    });
    // A node authored inside a subsystem is read exactly like any other: how it
    // was authored decides nothing here, because where an attachment for it
    // goes is not answered here.
    assert.deepStrictEqual(sites.get('ledger'), {
      nodeId: 'ledger',
      attached: [],
    });
  });

  it('keeps a name per node and no authored value, and no document path either', () => {
    // The panel's payload is redacted before it crosses into the view; this
    // table is kept on the other side, so it holds nothing that redaction
    // removes. It also holds no file: the document an attachment belongs in is
    // the compiler's answer, so a path held here would be a second one.
    const site = attachmentSites(graph).get('web');
    assert.ok(site !== undefined);
    assert.deepStrictEqual(Object.keys(site).sort(), ['attached', 'nodeId']);
    assert.deepStrictEqual(site.attached, ['metrics']);
  });

  it('reads a payload in an unexpected shape as no sites, rather than failing', () => {
    assert.strictEqual(attachmentSites(null).size, 0);
    assert.strictEqual(attachmentSites({}).size, 0);
    assert.strictEqual(attachmentSites({ spec: {} }).size, 0);
    assert.strictEqual(attachmentSites({ spec: { nodes: 'some' } }).size, 0);
  });

  it('reports a node carrying nothing, rather than dropping it', () => {
    // Dropping it would be indistinguishable from the node not being in the
    // graph, and the two are told apart by different sentences: a node with no
    // attachments can take one, and a node the graph does not carry cannot.
    const sites = attachmentSites({ spec: { nodes: { orphan: {} } } });
    assert.deepStrictEqual(sites.get('orphan'), {
      nodeId: 'orphan',
      attached: [],
    });
  });
});

// ---- attaching to a connection ----------------------------------------------

// The edges and the consuming node's bucket the language server answered for a
// workspace drawing every kind of connection: one the Aggregate drew whose
// `credential` slot it fills, one into a socket the component does not declare,
// one a Feature drew, and two the Release drew — through a socket with no slot,
// and through one whose `note` slot the Release fills. Copied from that answer,
// with the withheld markers it carried by default.
const CONNECTION_GRAPH = {
  spec: {
    nodes: { gateway: {}, model: {}, sink: {} },
    edges: [
      { source: 'gateway', target: 'model', socket: 'models', alias: 'gpt', socket_declaration: 'declared' },
      { source: 'gateway', target: 'sink', socket: 'extra', alias: 'side', socket_declaration: 'ad-hoc' },
      {
        source: 'gateway', target: 'model', socket: 'peer', alias: 'p1', socket_declaration: 'declared',
        origin_feature: 'feature.conn/peering', origin_feature_instance: 'peering',
      },
      { source: 'gateway', target: 'sink', socket: 'logs', alias: 'out', socket_declaration: 'declared', origin_release: true },
      { source: 'gateway', target: 'sink', socket: 'mirrors', alias: 'm1', socket_declaration: 'declared', origin_release: true },
    ],
    feature_values_mapping: {
      gateway: {
        'peering': { type: 'feature.conn/peering', resolved_version: '1.0.0', binding: 'free', origin: 'explicit' },
        'own-token': {
          type: 'feature.conn/token', resolved_version: '1.0.0', binding: 'free',
          values: { key: 'own-key', secret: { aggrega_withheld: 'declared' } },
          sensitive: true, sensitive_payload_leaves: ['values.secret'],
        },
        'gpt.credential': {
          type: 'feature.conn/token', resolved_version: '1.0.0', binding: 'credential',
          values: { key: 'gpt-key', secret: { aggrega_withheld: 'declared' } },
          sensitive: true, sensitive_payload_leaves: ['values.secret'],
          connection: { socket: 'models', alias: 'gpt' },
        },
        'm1.note': {
          type: 'feature.conn/audit', resolved_version: '1.0.0', binding: 'note', origin: 'explicit',
          connection: { socket: 'mirrors', alias: 'm1' },
        },
      },
    },
  },
};

const placement = loadAttachmentsModel(EXTENSION_ROOT);

function connectionSite(over: Partial<ConnectionSite> = {}): ConnectionSite {
  return { source: 'gateway', socket: 'models', alias: 'gpt', document: 'aggregate', filled: [], ...over };
}

describe('connectionSites', () => {
  const sites = connectionSites(CONNECTION_GRAPH, placement);
  const at = (socket: string, alias: string): ConnectionSite | undefined => sites('gateway', { socket, alias });

  it('reads each connection the graph draws, with the document that drew it and the slots filled on it', () => {
    assert.deepStrictEqual(at('models', 'gpt'), connectionSite({ filled: ['credential'] }));
    assert.deepStrictEqual(at('mirrors', 'm1'),
      connectionSite({ socket: 'mirrors', alias: 'm1', document: 'release', filled: ['note'] }));
    assert.deepStrictEqual(at('logs', 'out'),
      connectionSite({ socket: 'logs', alias: 'out', document: 'release' }));
    assert.deepStrictEqual(at('extra', 'side'), connectionSite({ socket: 'extra', alias: 'side' }));
  });

  it('takes the Aggregate for a connection a Feature drew, and leaves whether it may carry one to the compiler', () => {
    // The table does not refuse it: the language server answers that nothing may
    // be attached there, and refuses an attach in its own words.
    assert.deepStrictEqual(at('peer', 'p1'), connectionSite({ socket: 'peer', alias: 'p1' }));
  });

  it('reads the filled slots from where the shared placement puts each entry, never from its key', () => {
    // The node's own attachments fill no slot of any connection, whatever they
    // are called; an entry named like a connection's but carrying no mark stays
    // on the node; a marked entry is placed under any key.
    const graph = {
      spec: {
        edges: [{ source: 'gateway', target: 'model', socket: 'models', alias: 'gpt' }],
        feature_values_mapping: {
          gateway: {
            'gpt.trace': { type: 'f/a', resolved_version: '1', binding: 'free' },
            'anything': { type: 'f/b', resolved_version: '1', binding: 'trace', connection: { socket: 'models', alias: 'gpt' } },
          },
        },
      },
    };
    assert.deepStrictEqual(connectionSites(graph, placement)('gateway', { socket: 'models', alias: 'gpt' }),
      connectionSite({ filled: ['trace'] }));
  });

  it('holds names and no authored value', () => {
    const site = at('models', 'gpt');
    assert.ok(site !== undefined);
    assert.deepStrictEqual(Object.keys(site).sort(), ['alias', 'document', 'filled', 'socket', 'source']);
    assert.ok(!JSON.stringify(site).includes('gpt-key'), 'a value of the connection\'s attachment reached the table');
  });

  it('holds no connection the graph does not draw', () => {
    assert.strictEqual(at('models', 'claude'), undefined);
    assert.strictEqual(at('nope', 'gpt'), undefined);
    assert.strictEqual(sites('model', { socket: 'models', alias: 'gpt' }), undefined,
      'a connection is found by the node whose component draws it, not by its target');
  });

  it('holds no connection two edges name, and none an edge draws without a socket or an alias', () => {
    const graph = {
      spec: {
        edges: [
          { source: 'a', target: 'b', socket: 's', alias: 'x' },
          { source: 'a', target: 'c', socket: 's', alias: 'x' },
          { source: 'a', target: 'b', socket: 's' },
          { source: 'a', target: 'b', alias: 'y' },
          { source: 'a', target: 'b', socket: '', alias: 'z' },
          { source: 'a', target: 'b', socket: 's', alias: 'ok' },
        ],
      },
    };
    const read = connectionSites(graph, placement);
    assert.strictEqual(read('a', { socket: 's', alias: 'x' }), undefined);
    assert.strictEqual(read('a', { socket: '', alias: 'z' }), undefined);
    // The control: the one connection named once, in full, is held.
    assert.deepStrictEqual(read('a', { socket: 's', alias: 'ok' }),
      { source: 'a', socket: 's', alias: 'ok', document: 'aggregate', filled: [] });
  });

  it('reads a payload in an unexpected shape as no connections, rather than failing', () => {
    for (const graph of [null, {}, { spec: {} }, { spec: { edges: 'some' } }, { spec: { edges: [7, null] } }]) {
      assert.strictEqual(connectionSites(graph, placement)('a', { socket: 's', alias: 'x' }), undefined);
    }
  });
});

describe('the requests an attach to a connection asks', () => {
  it('asks what may fill a connection by the node, the Release and the connection, with no document', () => {
    const request = connectionCandidatesRequest('gateway', { socket: 'models', alias: 'gpt' }, 'release.yaml');
    assert.deepStrictEqual(request, {
      graphNode: 'gateway', release: 'release.yaml', connection: { socket: 'models', alias: 'gpt' },
    });
    // The node's own question is unchanged by it.
    assert.deepStrictEqual(Object.keys(attachCandidatesRequest('gateway', 'release.yaml')).sort(), ['graphNode', 'release']);
  });

  it('carries only the socket and the alias of a connection it is handed, whatever else the value holds', () => {
    const handed = { socket: 'models', alias: 'gpt', document: 'release', extra: 1 } as unknown as { socket: string; alias: string };
    assert.deepStrictEqual(connectionCandidatesRequest('gateway', handed, 'release.yaml').connection,
      { socket: 'models', alias: 'gpt' });
  });

  it('asks where the entry goes in the document that drew the connection, read from the table', () => {
    assert.deepStrictEqual(connectionContainerRequest(connectionSite(), 'release.yaml'), {
      graphNode: 'gateway', release: 'release.yaml',
      connection: { socket: 'models', alias: 'gpt', document: 'aggregate' },
    });
    assert.deepStrictEqual(
      connectionContainerRequest(connectionSite({ socket: 'mirrors', alias: 'm1', document: 'release' }), 'release.yaml'),
      { graphNode: 'gateway', release: 'release.yaml', connection: { socket: 'mirrors', alias: 'm1', document: 'release' } },
    );
  });

  it('follows the edge\'s origin from the compiled graph to the request', () => {
    const sites = connectionSites(CONNECTION_GRAPH, placement);
    const documentOf = (socket: string, alias: string): unknown => {
      const site = sites('gateway', { socket, alias });
      assert.ok(site, `no site for ${socket}/${alias}`);
      return connectionContainerRequest(site, 'release.yaml').connection?.document;
    };
    assert.strictEqual(documentOf('models', 'gpt'), 'aggregate');
    assert.strictEqual(documentOf('mirrors', 'm1'), 'release');
    assert.strictEqual(documentOf('logs', 'out'), 'release');
  });
});

describe('fillSlot', () => {
  it('writes the entry under the slot\'s own name', () => {
    assert.deepStrictEqual(fillSlot(connectionSite({ filled: ['credential'] }), 'trace'), { instanceName: 'trace' });
  });

  it('refuses a slot the graph already shows filled on that connection, before anything is asked', () => {
    const named = fillSlot(connectionSite({ filled: ['credential'] }), 'credential');
    assert.deepStrictEqual(named, {
      refusal: 'The slot credential of the connection gpt through socket models of gateway is already filled.',
    });
  });

  it('refuses only on the connection the slot is filled on', () => {
    // The same slot name filled on another connection is another slot.
    assert.deepStrictEqual(fillSlot(connectionSite({ alias: 'claude', filled: [] }), 'credential'),
      { instanceName: 'credential' });
  });

  it('refuses a slot name it cannot write as a plain key, rather than reshaping it', () => {
    for (const slot of ['', 'has space', 'has.dot', 'a: b']) {
      const named = fillSlot(connectionSite(), slot);
      assert.ok('refusal' in named, `${JSON.stringify(slot)} was written`);
    }
  });

  it('composes the entry under the slot, with the Feature as its type', () => {
    const named = fillSlot(connectionSite(), 'trace');
    assert.ok('instanceName' in named);
    assert.strictEqual(
      composeInsertionText(
        answer({ missingContainerKeys: ['models', 'gpt', 'features'], entryIndent: 18, indentStep: 2, entryShape: 'unknown' }),
        attachmentEntryLines(named.instanceName, 'feature.conn/audit', 2),
      ),
      '\n            models:\n              gpt:\n                features:\n                  trace:\n                    type: feature.conn/audit',
    );
  });
});

describe('connectionNotDrawn', () => {
  it('says the connection is not on the graph, naming it as the compiler does', () => {
    assert.strictEqual(
      connectionNotDrawn('gateway', { socket: 'models', alias: 'claude' }),
      'The connection claude through socket models of gateway is not on the graph this panel drew.',
    );
  });
});
