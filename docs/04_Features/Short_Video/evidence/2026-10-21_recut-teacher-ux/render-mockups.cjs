// 用現有 short_render 的 Puppeteer 與已安裝 Chromium 輸出靜態 UI PNG。
// 不啟動 FocusFlow、不連 Atlas、不呼叫 AI；FOCUSFLOW_MOCKUP_BROWSER 可指定瀏覽器。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '../../../../..');
const requireRender = createRequire(path.join(root, 'short_render/package.json'));
const puppeteer = requireRender('puppeteer-core');
const cache = path.join(os.homedir(), 'AppData/Local/ms-playwright');
const candidates = fs.existsSync(cache)
  ? fs.readdirSync(cache).filter((name) => name.startsWith('chromium_headless_shell-'))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((name) => path.join(cache, name, 'chrome-headless-shell-win64/chrome-headless-shell.exe'))
  : [];
const executablePath = process.env.FOCUSFLOW_MOCKUP_BROWSER
  || candidates.find((candidate) => fs.existsSync(candidate));
if (!executablePath) throw new Error('請用 FOCUSFLOW_MOCKUP_BROWSER 指定已安裝的 Chromium；本工具不下載瀏覽器。');

const names = [
  '01-preview-main.png', '02-selection-expanded.png', '03-regenerating.png',
  '04-cannot-answer.png', '05-ai-suggestions.png', '06-product-review.png',
  '07-product-listen.png',
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    pipe: true,
    args: ['--disable-gpu', '--no-sandbox', '--disable-background-networking'],
  });
  const audit = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1080, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) request.abort();
      else request.continue();
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (let index = 0; index < names.length; index++) {
      const url = pathToFileURL(path.join(__dirname, 'preview-mockup.html'));
      url.searchParams.set('screen', String(index + 1));
      await page.goto(url.href, { waitUntil: 'load' });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(document.getAnimations()
          .filter((animation) => animation.effect.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => {})));
      });
      const layout = await page.evaluate(() => {
        const clipped = [...document.querySelectorAll('button,h1,h2,h3,.sentence,.prose p,.notice,.step-name')]
          .filter((element) => !element.classList.contains('sr-only')
            && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2)
          .map((element) => element.textContent.trim().slice(0, 80));
        return {
          title: document.querySelector('.note-bar b').textContent,
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
          fonts: document.fonts.status,
          screenCount: document.querySelectorAll('.screen').length,
          disabled: [...document.querySelectorAll('button:disabled')].map((button) => button.textContent),
          currentStep: document.querySelector('.step[aria-current="step"] .step-name')?.textContent,
          journeyHeight: document.querySelector('.journey').getBoundingClientRect().height,
          aiEntryTop: document.querySelector('.review-nav .count')?.getBoundingClientRect().top ?? null,
          hasOrderInstructions: document.body.textContent.includes('你的審閱順序'),
          clipped,
        };
      });
      if (layout.screenCount !== 1 || layout.width > 1440 || layout.clipped.length || errors.length) {
        throw new Error(JSON.stringify({ file: names[index], layout, errors }));
      }
      if ((index === 1 || index === 2) && !layout.disabled.includes('通過講稿，製作短片')) {
        throw new Error(`${names[index]}：修改中缺少停用的講稿通過按鈕`);
      }
      if (layout.hasOrderInstructions || (index === 1 && layout.currentStep !== '修改講稿')) {
        throw new Error(`${names[index]}：流程狀態或重複說明卡未同步`);
      }
      if (layout.journeyHeight > 44) {
        throw new Error(`${names[index]}：細長流程列高度超出示意圖目標`);
      }
      if ([0, 4, 5].includes(index) && !(layout.aiEntryTop >= 0 && layout.aiEntryTop < 1080)) {
        throw new Error(`${names[index]}：AI 建議入口未出現在首屏`);
      }
      await page.screenshot({ path: path.join(__dirname, names[index]), fullPage: true });
      audit.push({ file: names[index], ...layout });
      console.log(`PNG_OK ${names[index]} ${layout.width}x${layout.height}`);
    }
    const output = path.join(root, 'output/playwright');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'recut-ux-layout-audit.json'), JSON.stringify(audit, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
