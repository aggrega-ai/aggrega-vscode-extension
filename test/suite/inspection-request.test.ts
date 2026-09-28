// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio S.r.l.

import * as assert from 'node:assert';
import * as path from 'node:path';

import { OperationCancelled } from '../../src/cancellation';
import {
  INSPECTION_SUBJECT,
  OPEN_DECLARING_DOCUMENT_ACTION,
  inspectionEnding,
} from '../../src/inspection-request';
import { terminalLine } from '../../src/operation-outcome';

// Every expected sentence below is an equality against a literal written here,
// not a reading built from the extension's own rendering: a comparison whose two
// sides both came from the implementation moves both at once and accepts
// anything. The expected paths are joined by the platform's own rule, so they
// read the same on every host.

const ROOT = path.join(path.sep, 'work', 'shop');

// The refusal a Feature missing its metadata.version draws, as the language
// server answers it: the message and the data exactly as they arrive.
const REFUSED_DOCUMENT_MESSAGE =
  '[CATALOG_ERROR E0215] catalog/feature/local/nightly-backup/1.0.0/feature.yaml: document envelope '
  + 'validation failed (Feature); 6:1: metadata.version: missing required property: version. correct '
  + 'the document to match its kind\'s schema; note: this file was skipped at load, so the catalog '
  + 'holds nothing under the identity it declares, and "local/nightly-backup" resolved to no entity';
const refusedDocument = {
  code: 1004,
  message: REFUSED_DOCUMENT_MESSAGE,
  data: { file: 'catalog/feature/local/nightly-backup/1.0.0/feature.yaml' },
};

describe('an inspection refused because of the document that declares the entity', () => {
  it('names the document as the cause and carries the compiler\'s sentence whole', () => {
    // 🔴 THE SHAPE THIS EXISTS FOR. The same refusal otherwise reads as an
    // operation that broke, with the transport's code in front of it.
    const ending = inspectionEnding('local/nightly-backup', refusedDocument, ROOT);
    assert.deepStrictEqual(ending, {
      kind: 'declaring-document',
      line: 'local/nightly-backup cannot be inspected because of the document that declares it: '
        + '[CATALOG_ERROR E0215] catalog/feature/local/nightly-backup/1.0.0/feature.yaml: document '
        + 'envelope validation failed (Feature); 6:1: metadata.version: missing required property: '
        + 'version. correct the document to match its kind\'s schema; note: this file was skipped at '
        + 'load, so the catalog holds nothing under the identity it declares, and '
        + '"local/nightly-backup" resolved to no entity',
      document: {
        file: path.join(ROOT, 'catalog', 'feature', 'local', 'nightly-backup', '1.0.0', 'feature.yaml'),
        at: null,
      },
    });
  });

  it('reads the same for a document the catalog never read, and says only what both share', () => {
    // A document outside every catalog directory is named the same way, and it
    // was not refused — so the sentence claims the document as the cause and
    // leaves the compiler's own words to say which cause it is.
    const message = '"local/stray-backup" is declared as a Feature by stray-feature.yaml, but the '
      + 'catalog resolved no entity for it';
    const ending = inspectionEnding(
      'local/stray-backup',
      { code: 1004, message, data: { file: 'stray-feature.yaml' } },
      ROOT,
    );
    assert.deepStrictEqual(ending, {
      kind: 'declaring-document',
      line: 'local/stray-backup cannot be inspected because of the document that declares it: '
        + '"local/stray-backup" is declared as a Feature by stray-feature.yaml, but the catalog '
        + 'resolved no entity for it',
      document: { file: path.join(ROOT, 'stray-feature.yaml'), at: null },
    });
  });

  it('opens the document at the line and column the refusal carries, in the editor\'s terms', () => {
    const ending = inspectionEnding(
      'local/nightly-backup',
      { ...refusedDocument, data: { ...refusedDocument.data, line: 6, column: 3 } },
      ROOT,
    );
    assert.strictEqual(ending.kind, 'declaring-document');
    assert.deepStrictEqual(ending.kind === 'declaring-document' ? ending.document : null, {
      file: path.join(ROOT, 'catalog', 'feature', 'local', 'nightly-backup', '1.0.0', 'feature.yaml'),
      at: { line: 5, character: 2 },
    });
  });

  it('keeps a path the refusal already names absolutely', () => {
    const absolute = path.join(path.sep, 'elsewhere', 'feature.yaml');
    const ending = inspectionEnding(
      'local/nightly-backup',
      { ...refusedDocument, data: { file: absolute } },
      ROOT,
    );
    assert.deepStrictEqual(ending.kind === 'declaring-document' ? ending.document : null, {
      file: absolute,
      at: null,
    });
  });

  it('offers nothing to open where no workspace root is in use to read the path against', () => {
    const ending = inspectionEnding('local/nightly-backup', refusedDocument, null);
    assert.strictEqual(ending.kind, 'declaring-document');
    assert.strictEqual(ending.kind === 'declaring-document' ? ending.document : undefined, null);
  });

  it('labels the button by what it opens', () => {
    assert.strictEqual(OPEN_DECLARING_DOCUMENT_ACTION, 'Open document');
  });
});

describe('every other refused inspection ends as any failed operation does', () => {
  it('a name nothing declares carries no document, and keeps the ordinary ending', () => {
    const ending = inspectionEnding('local/no-such-entity', {
      code: 1004,
      message: '"local/no-such-entity" matched no entity of any kind; no document in the workspace '
        + 'declares that name and no catalog tier resolves it',
    }, ROOT);
    assert.strictEqual(ending.kind, 'ended');
    assert.strictEqual(
      ending.kind === 'ended' ? terminalLine(INSPECTION_SUBJECT, ending.outcome) : '',
      'The inspection did not complete: code=1004 "local/no-such-entity" matched no entity of any '
        + 'kind; no document in the workspace declares that name and no catalog tier resolves it',
    );
  });

  it('an empty path names no document', () => {
    const ending = inspectionEnding(
      'local/nightly-backup',
      { code: 1004, message: 'refused', data: { file: '' } },
      ROOT,
    );
    assert.deepStrictEqual(ending, {
      kind: 'ended',
      outcome: { kind: 'failed', message: 'code=1004 refused' },
    });
  });

  it('a different refusal naming a file is not read as this one', () => {
    const ending = inspectionEnding(
      'local/nightly-backup',
      { code: -32602, message: 'invalid params: name must be the entity\'s identity', data: { file: 'x.yaml' } },
      ROOT,
    );
    assert.deepStrictEqual(ending, {
      kind: 'ended',
      outcome: {
        kind: 'failed',
        message: 'code=-32602 invalid params: name must be the entity\'s identity',
      },
    });
  });

  it('a stopped inspection reads as stopped', () => {
    const ending = inspectionEnding('local/nightly-backup', new OperationCancelled('The inspection'), ROOT);
    assert.deepStrictEqual(ending, { kind: 'ended', outcome: { kind: 'cancelled' } });
    assert.strictEqual(
      ending.kind === 'ended' ? terminalLine(INSPECTION_SUBJECT, ending.outcome) : '',
      'The inspection stopped at your request.',
    );
  });

  it('a language server that is not running reads as the failure it is', () => {
    const ending = inspectionEnding(
      'local/nightly-backup',
      new Error('the Aggrega language server is not running'),
      ROOT,
    );
    assert.strictEqual(
      ending.kind === 'ended' ? terminalLine(INSPECTION_SUBJECT, ending.outcome) : '',
      'The inspection did not complete: the Aggrega language server is not running',
    );
  });
});
