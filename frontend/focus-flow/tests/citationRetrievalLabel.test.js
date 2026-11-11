import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CitationRetrievalLabel from '../src/components/CitationRetrievalLabel.js';
import { toStudentCitation } from '../src/pages/qaConversationUtils.js';

test('actual citation label component exposes provenance to assistive technology', () => {
  const citation = toStudentCitation({ retrievedBy: ['text', 'audio', 'visual'], startSec: 12, endSec: 14 });
  const html = renderToStaticMarkup(createElement(CitationRetrievalLabel, { label: citation.retrievalLabel }));
  assert.ok(html.includes('aria-label="比對方式：文字、聲音、畫面"'));
  assert.equal(renderToStaticMarkup(createElement(CitationRetrievalLabel, { label: '' })), '');
  assert.equal(citation.startSec, 12);
  assert.equal(citation.endSec, 14);
});
