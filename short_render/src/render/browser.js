'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Uses HyperFrames' lockfile-pinned browser driver, never installs a browser.
// Caller must supply an existing chrome-headless-shell executable.
// Chromium refuses to start as root on Linux without --no-sandbox. HyperFrames'
// own render already launches that way; this check still loads only the local
// stage and aborts every non-file/data/blob request below.
const runningAsLinuxRoot = () => process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0;
async function ensureFontLoaded({ stageDir, browserExecutable, launch, signal, env, isLinuxRoot = runningAsLinuxRoot }) {
  signal?.throwIfAborted();
  if (!browserExecutable && !launch) throw new Error('existing chrome-headless-shell path is required');
  const browserLaunch = launch || require(require.resolve('puppeteer-core', {
    paths: [path.dirname(require.resolve('hyperframes/package.json'))],
  })).launch;
  const browser = await browserLaunch({ executablePath: browserExecutable, headless: true, ...(env ? { env } : {}), ...(isLinuxRoot() ? { args: ['--no-sandbox'] } : {}) });
  const abort = () => { browser.close().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    signal?.throwIfAborted();
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (/^(file|data|blob):/.test(request.url())) request.continue();
      else request.abort();
    });
    await page.goto(pathToFileURL(path.join(stageDir, 'index.html')).href, { waitUntil: 'load' });
    const result = await page.evaluate(async () => {
      await window.__recutReady;
      return { font: window.__recutFontLoaded === true, fit: window.__recutTextFit || [] };
    });
    // Same page, font and layout as the render: a card whose text still spills out
    // at the minimum zoom is a fixed defect, not a retryable font problem.
    const overflowing = (result?.fit || []).filter((card) => card && card.overflow);
    if (overflowing.length) throw new Error(`RECUT_TEXT_OVERFLOW: ${overflowing.map((card) => `${card.id} ${JSON.stringify(card.overflow)}`).join('; ')}`);
    return typeof result === 'boolean' ? result : result?.font === true;
  } finally { signal?.removeEventListener('abort', abort); await browser.close(); }
}
module.exports = { ensureFontLoaded };
