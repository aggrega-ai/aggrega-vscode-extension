// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Cognitio s.r.l.

import * as assert from 'assert';
import { configDocumentHtml } from '../../src/config-render';
import { graphDocumentHtml } from '../../src/graph-render';
import { documentLanguage, languageDirection } from '../../src/l10n';
import { operationsDocumentHtml } from '../../src/operations-render';
import { welcomeDocumentHtml } from '../../src/welcome-render';
import { configPanelModel } from '../../src/config-model';

const ARABIC = { lang: 'ar', dir: 'rtl' } as const;

// Each renderer is composed with the language the caller passes, and once with
// none, which is English.
const renderers: Array<{ name: string; render: (document?: { lang: string; dir: 'ltr' | 'rtl' }) => string }> = [
  {
    name: 'the graph',
    render: (document) => graphDocumentHtml({
      nonce: 'N', cspSource: 'vscode-resource:', elkUri: 'e.js', modelUri: 'm.js',
      attachmentsUri: 'a.js', candidatesUri: 'c.js', scriptUri: 's.js', styleUri: 's.css', document,
    }),
  },
  {
    name: 'the configuration',
    render: (document) => configDocumentHtml({
      model: configPanelModel({ type: 'object', properties: { offline: { type: 'boolean', default: false } } }, null),
      presentation: 'table', nonce: 'N', styleUri: 'c.css', cspSource: 'vscode-resource:', document,
    }),
  },
  {
    name: 'the welcome page',
    render: (document) => welcomeDocumentHtml({
      nonce: 'N', styleUri: 'w.css', scriptUri: 'w.js', cspSource: 'vscode-resource:',
      readings: {
        workspace: { met: false, value: { absent: 'none' } },
        compiler: { met: false, value: { absent: 'none' } },
        release: { met: false, value: { absent: 'none' } },
        registry: { met: false, value: { absent: 'none' } },
      }, collapsed: [], opensWithEditor: true,
      versions: { extension: '1', compiler: '1' }, server: { reading: 'running', version: '1' }, document,
    }),
  },
  {
    name: 'the operations panel',
    render: (document) => operationsDocumentHtml({
      nonce: 'N', styleUri: 'o.css', codiconUri: 'i.css', scriptUri: 'o.js', cspSource: 'vscode-resource:',
      layout: 'buttons', selectors: [], unavailable: {}, collapsed: [], focused: null, dials: [], document,
    }),
  },
];

describe('the language and direction a panel declares', () => {
  for (const { name, render } of renderers) {
    it(`${name} declares the language and direction it is given`, () => {
      assert.ok(render(ARABIC).includes('<html lang="ar" dir="rtl">'));
    });
    it(`${name} declares English left to right by default`, () => {
      assert.ok(render().includes('<html lang="en" dir="ltr">'));
    });
  }

  it('keeps the graph drawing left to right', () => {
    assert.ok(renderers[0].render(ARABIC).includes('<svg id="canvas" dir="ltr"'));
  });

  it('reads right to left for Arabic and left to right for German and an unknown tag', () => {
    assert.strictEqual(languageDirection('ar'), 'rtl');
    assert.strictEqual(languageDirection('he-IL'), 'rtl');
    assert.strictEqual(languageDirection('de'), 'ltr');
    assert.strictEqual(languageDirection('not a tag!'), 'ltr');
  });

  it('declares English where no editor is running', () => {
    assert.deepStrictEqual(documentLanguage(), { lang: 'en', dir: 'ltr' });
  });
});
