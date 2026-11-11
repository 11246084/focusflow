import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export async function runStudentBrowser({ backendUrl, env, store, ids, chunkId, startSec, endSec, setScenario, outputDirectory, mediaFile }) {
  assert.equal(env.nodeEnv, 'test');
  assert.equal(new URL(backendUrl).hostname, '127.0.0.1');
  const root = fileURLToPath(new URL('../../frontend/focus-flow/', import.meta.url));
  const { createServer } = await import(pathToFileURL(require.resolve('vite', { paths: [root] })));
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
  const vite = await createServer({ root, logLevel: 'error', clearScreen: false,
    server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: backendUrl, changeOrigin: false } } } });
  const saved = { origins: env.csrfTrustedOrigins, cors: env.allowedOrigins,
    local: env.localPlaybackEnabled, flag: env.qaMultimodalFusionEnabled, hierarchy: env.hierarchicalRetrievalEnabled };
  const video = store.videos.find(row => row._id === ids.publishedVideo);
  const originalVideo = { ...video };
  const destination = path.join(env.uploadDir, 'synthetic-student-1800s.mp4');
  let browser;
  try {
    fs.copyFileSync(mediaFile, destination);
    Object.assign(video, { filePath: destination, file_path: destination, sourceType: 'upload',
      videoSource: 'upload', sourceUrl: '/uploads/synthetic-student-1800s.mp4',
      videoUrl: '/uploads/synthetic-student-1800s.mp4', youtubeVideoId: null, durationSec: 1800 });
    env.localPlaybackEnabled = true;
    await vite.listen();
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    env.csrfTrustedOrigins = [origin];
    env.allowedOrigins = [origin];
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(15000);
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/login`);
    await page.locator('input[type="email"]').fill('student@focusflow.local');
    await page.locator('input[type="password"]').fill('Student123!');
    await page.getByRole('button', { name: '登入系統', exact: true }).click();
    await page.waitForURL('**/app/**');
    const results = [];
    for (const scenario of ['off', 'flat', 'hierarchical', 'missing-index', 'all-failed', 'invalid-time']) {
      env.qaMultimodalFusionEnabled = scenario !== 'off';
      env.hierarchicalRetrievalEnabled = scenario === 'hierarchical';
      setScenario(['off', 'flat', 'hierarchical'].includes(scenario) ? 'success' : scenario);
      await page.goto(`${origin}/app/courses`);
      await page.locator('.course-row').filter({ hasText: 'Published AI Course' }).getByRole('button', { name: '進入課程 →' }).click();
      const answerResponse = page.waitForResponse(response => /\/conversations\/[^/]+\/messages$/.test(new URL(response.url()).pathname)
        && response.request().method() === 'POST');
      await page.getByRole('textbox', { name: '輸入課程問題' }).fill(`JWT authentication ${scenario}`);
      await page.getByRole('textbox', { name: '輸入課程問題' }).press('Enter');
      const response = await answerResponse;
      assert.equal(response.status(), 201);
      const answer = (await response.json()).data;
      assert.equal(answer.failed, false);
      const source = answer.sources[0];
      assert.equal(source.startSec, startSec);
      assert.equal(source.endSec, endSec);
      assert.equal(source.videoId, ids.publishedVideo);
      assert.equal(source.chunkId, chunkId);
      if (scenario !== 'off') {
        assert.equal(answer.runtime.multimodal.usedFallback, !['flat', 'hierarchical'].includes(scenario));
        assert.deepEqual(source.channelRanks, ['flat', 'hierarchical'].includes(scenario)
          ? { text: 1, audio: 1, visual: 1 } : {});
      }
      if (scenario === 'hierarchical') assert.equal(answer.runtime.hierarchicalRetrieval.retrievalMode, 'hierarchical');
      if (scenario === 'off') assert.equal(await page.locator('[aria-label^="比對方式："]').count(), 0);
      else await page.getByLabel(`比對方式：${['flat', 'hierarchical'].includes(scenario) ? '文字、聲音、畫面' : '文字'}`).waitFor();
      await page.locator('.citation-card').first().click();
      await page.waitForFunction(expected => {
        const element = document.querySelector('video');
        return element?.readyState >= 1 && Math.abs(element.currentTime - expected) < 2;
      }, startSec);
      const currentTime = await page.locator('video').evaluate(element => { element.pause(); return element.currentTime; });
      if (scenario === 'flat') {
        await page.reload();
        await page.locator('.course-row').filter({ hasText: 'Published AI Course' }).getByRole('button', { name: '進入課程 →' }).click();
        await page.getByRole('button', { name: /最近對話/ }).click();
        await page.getByRole('menuitemradio').filter({ hasText: 'JWT authentication flat' }).click();
        await page.getByLabel('比對方式：文字、聲音、畫面').waitFor();
        await page.locator('.citation-card').first().click();
        await page.waitForFunction(expected => Math.abs((document.querySelector('video')?.currentTime ?? -1) - expected) < 2, startSec);
        await page.locator('video').evaluate(element => element.pause());
      }
      const unauthorized = await page.evaluate(async courseId => {
        const response = await fetch('/api/v1/qa/ask', { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'FocusFlow' },
          body: JSON.stringify({ courseId, question: 'JWT authentication' }) });
        return response.status;
      }, ids.teacherCourse);
      assert.equal(unauthorized, 403);
      results.push({ scenario, apiStatus: response.status(), originalStartSec: startSec,
        originalEndSec: endSec, playerTime: currentTime, unauthorizedStatus: unauthorized,
        restoredConversation: scenario === 'flat',
        fallback: answer.runtime.multimodal?.usedFallback ?? null });
      fs.mkdirSync(outputDirectory, { recursive: true });
      await page.screenshot({ path: path.join(outputDirectory, `${scenario}.png`) });
    }
    fs.writeFileSync(path.join(outputDirectory, 'result.json'), JSON.stringify({ status: 'passed',
      provenance: 'full local React app / Express harness / saved Gemini query / Fake Atlas / synthetic Parent / template answer / synthetic MP4', results }, null, 2));
    return results;
  } finally {
    if (browser) await browser.close();
    await vite.close();
    env.csrfTrustedOrigins = saved.origins; env.allowedOrigins = saved.cors;
    env.localPlaybackEnabled = saved.local; env.qaMultimodalFusionEnabled = saved.flag;
    env.hierarchicalRetrievalEnabled = saved.hierarchy;
    for (const key of Object.keys(video)) if (!Object.hasOwn(originalVideo, key)) delete video[key];
    Object.assign(video, originalVideo);
    if (fs.existsSync(destination)) fs.unlinkSync(destination);
  }
}
