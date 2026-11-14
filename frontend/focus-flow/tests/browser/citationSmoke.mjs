import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CitationRetrievalLabel from '../../src/components/CitationRetrievalLabel.js';
import { toStudentCitation } from '../../src/pages/qaConversationUtils.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const [fixturePath, outputDirectory] = process.argv.slice(2);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const citation = toStudentCitation(fixture.match);
assert.equal(citation.startSec, fixture.citation.timestamp.startSec);
assert.equal(citation.endSec, fixture.citation.timestamp.endSec);
assert.deepEqual(fixture.match.retrievedBy, fixture.citation.retrievedBy);
assert.deepEqual(fixture.match.channelRanks, fixture.citation.channelRanks);
assert.equal(fixture.match.chunkId, fixture.citation.chunkId);
assert.equal(fixture.match.videoId, fixture.citation.videoId);
const label = renderToStaticMarkup(createElement(CitationRetrievalLabel, { label: citation.retrievalLabel }));
const legacy = renderToStaticMarkup(createElement(CitationRetrievalLabel, { label: '' }));
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
});
try {
  const page = await browser.newPage();
  await page.setContent(`<html lang="zh-Hant"><title>FocusFlow local citation fixture</title><body>
    <p>Local Fake Atlas / saved query fixture</p><a href="#t=${citation.startSec}" aria-label="跳到引用時間">${citation.startSec}–${citation.endSec}</a>
    ${label}<div id="legacy">${legacy}</div></body></html>`);
  assert.equal(await page.getByLabel(`比對方式：${citation.retrievalLabel}`).count(), 1);
  assert.equal(await page.locator('#legacy').textContent(), '');
  await page.getByRole('link', { name: '跳到引用時間' }).focus();
  await page.keyboard.press('Enter');
  assert.ok(page.url().endsWith(`#t=${citation.startSec}`));
  fs.mkdirSync(outputDirectory, { recursive: true });
  await page.screenshot({ path: path.join(outputDirectory, 'citation.png') });
  fs.writeFileSync(path.join(outputDirectory, 'result.json'), JSON.stringify({
    status: 'passed', source: 'local rendered component with Fake Atlas API fixture',
    originalStartSec: citation.startSec, originalEndSec: citation.endSec,
    keyboardJump: true, accessibleLabel: true, legacyLabelAbsent: true,
  }, null, 2));
  console.log('Local citation browser smoke passed');
} finally { await browser.close(); }
