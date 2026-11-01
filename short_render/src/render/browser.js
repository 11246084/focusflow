'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Uses HyperFrames' lockfile-pinned browser driver, never installs a browser.
// Caller must supply an existing chrome-headless-shell executable.
async function ensureFontLoaded({ stageDir, browserExecutable, launch }) {
  if (!browserExecutable && !launch) throw new Error('existing chrome-headless-shell path is required');
  const browserLaunch = launch || require(require.resolve('puppeteer-core', {
    paths: [path.dirname(require.resolve('hyperframes/package.json'))],
  })).launch;
  const browser = await browserLaunch({ executablePath: browserExecutable, headless: true });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (/^(file|data|blob):/.test(request.url())) request.continue();
      else request.abort();
    });
    await page.goto(pathToFileURL(path.join(stageDir, 'index.html')).href, { waitUntil: 'load' });
    return await page.evaluate(async () => {
      await window.__recutReady;
      return window.__recutFontLoaded === true;
    });
  } finally { await browser.close(); }
}
module.exports = { ensureFontLoaded };
