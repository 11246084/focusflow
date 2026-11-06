'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { input } = require('./sentence.fixture');
const { buildRecutPlan, resolvePlan, validatePlan } = require('../src/plan');
const { ensureFontLoaded } = require('../src/render/browser');
const { buildHtml } = require('../src/render/html');

const build = (mutate) => { const args = input(); mutate(args); const built = buildRecutPlan(args); return { ...built, args }; };

// run-6: a c3 subtitle stayed on screen 2.2 s into c4's audio.
test('a subtitle ends at its own clip cut even when the next subtitle starts later', () => {
  const { plan, errors, args } = build((a) => {
    const s = a.source.sentences;
    a.selectionResult.clips = [
      { sentenceIds: ['s1', 's2', 's3'], words: s.slice(0, 3).flatMap((x) => x.words), startSec: 100, endSec: 115, opening: false },
      { sentenceIds: ['s4', 's5', 's6'], words: s.slice(3).flatMap((x) => x.words), startSec: 115, endSec: 130, opening: false }];
    a.subtitles = a.subtitles.filter((sub) => sub.from.sentenceId !== 's4');
  });
  assert.deepEqual(errors, []);
  const { resolved } = resolvePlan(plan, { sentences: args.source.sentences });
  const third = resolved.subtitles[2], fourth = resolved.subtitles[3];
  assert.equal(plan.subtitles[2].clip, plan.clips[0].id);
  assert.equal(third.t1, resolved.clips[0].outEnd, 'clamped to the end of its clip');
  assert.ok(fourth.t0 > third.t1, 'gap instead of a subtitle over the next clip');
  for (const sub of resolved.subtitles) {
    const clip = resolved.clips.find((c) => c.id === sub.clip);
    assert.ok(sub.t0 >= clip.outStart && sub.t1 <= clip.outEnd + 1e-9, `subtitle ${sub.index} stays inside ${clip.id}`);
  }
});

// run-6 scene-5: label and text both timed 3.18 s or later after the card appeared.
test('a card whose every element is timed late is rejected with an actionable message', () => {
  const { plan, errors, args } = build((a) => {
    a.scenes = [{ id: 'card1', from: 's1', to: 's2', component: 'quote-reveal', params: { label: '重點', text: '段落說明' },
      cues: { label: { sentenceId: 's2' }, text: { sentenceId: 's2' } } }, ...a.scenes.slice(2)];
  });
  const timing = (errors.length ? errors : validatePlan(plan, { sentences: args.source.sentences, evidence: args.source }).errors).find((e) => e.code === 'SENTENCE_TIMING');
  assert.match(timing.message, /scene card1 shows an empty card for 5s .*anchor its first cue within 1.5s of the scene start, e.g. on a phrase in s1/);
  const ok = build((a) => {
    a.scenes = [{ id: 'card1', from: 's1', to: 's2', component: 'quote-reveal', params: { label: '重點', text: '段落說明' },
      cues: { label: { sentenceId: 's1' }, text: { sentenceId: 's2' } } }, ...a.scenes.slice(2)];
  });
  assert.deepEqual(ok.errors, []);
  assert.equal(validatePlan(ok.plan, { sentences: ok.args.source.sentences, evidence: ok.args.source }).valid, true);
  // Elements left without explicit cues use early defaults: not an empty card.
  const defaults = build((a) => {
    a.scenes = [{ id: 'card1', from: 's1', to: 's2', component: 'quote-reveal', params: { label: '重點', text: '段落說明' }, cues: { text: { sentenceId: 's2' } } }, ...a.scenes.slice(2)];
  });
  assert.deepEqual(defaults.errors, []);
});

test('font preflight refuses a page that reports card text still overflowing at the minimum zoom', async () => {
  const page = (fit) => async () => ({ newPage: async () => ({ setRequestInterception: async () => {}, on: () => {}, goto: async () => {},
    evaluate: async () => ({ font: true, fit }) }), close: async () => {} });
  assert.equal(await ensureFontLoaded({ stageDir: '.', launch: page([{ id: 'a', zoom: 0.8, overflow: null }]), isLinuxRoot: () => false }), true);
  await assert.rejects(ensureFontLoaded({ stageDir: '.', launch: page([{ id: 'card7', zoom: 0.6, overflow: { left: 4, right: 4, top: 0, bottom: 0 } }]), isLinuxRoot: () => false }),
    /RECUT_TEXT_OVERFLOW: card7/);
});

// Real layout needs a browser; opt in with SHORT_RENDER_TEST_BROWSER=<chrome-headless-shell path>.
// run-6 scene-5: a nowrap 50 px quote bubble ran 23 px past the card border.
test('real browser: an overflowing quote is zoomed to fit and a wrapped stat is left alone', { skip: !process.env.SHORT_RENDER_TEST_BROWSER }, async (t) => {
  const { plan, args } = build((a) => {
    a.scenes = [{ id: 'card1', from: 's1', to: 's1', component: 'quote-reveal', params: { label: '無 GPU 解決方案', text: '利用 OpenCV 小型模型替代' }, cues: {} },
      { id: 'card2', from: 's2', to: 's2', component: 'stat', params: { label: 'YOLO 特性', value: '能力強但耗資源' }, cues: {} }, ...a.scenes.slice(2)];
  });
  const { resolved } = resolvePlan(plan, { sentences: args.source.sentences });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recut-fit-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'fonts')); fs.mkdirSync(path.join(dir, 'vendor'));
  fs.copyFileSync(require('../src/util').fontPath(), path.join(dir, 'fonts', 'NotoSansTC-VF.ttf'));
  fs.copyFileSync(require.resolve('gsap/dist/gsap.min.js'), path.join(dir, 'vendor', 'gsap.min.js'));
  fs.writeFileSync(path.join(dir, 'index.html'), buildHtml(plan, resolved, { mode: 'render' }));
  const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.dirname(require.resolve('hyperframes/package.json'))] }));
  const browser = await puppeteer.launch({ executablePath: process.env.SHORT_RENDER_TEST_BROWSER, headless: true, args: ['--no-sandbox'] });
  try {
    const p = await browser.newPage(); await p.setViewport({ width: 720, height: 1280 });
    await p.goto(require('node:url').pathToFileURL(path.join(dir, 'index.html')).href, { waitUntil: 'load' });
    const fit = await p.evaluate(async () => { await window.__recutReady; return window.__recutTextFit; });
    const quote = fit.find((c) => c.id === 'card1'), stat = fit.find((c) => c.id === 'card2');
    assert.equal(quote.overflow, null); assert.ok(quote.zoom < 1 && quote.zoom >= 0.6, `quote zoom ${quote.zoom}`);
    assert.deepEqual(stat, { id: 'card2', zoom: 1, overflow: null });
    assert.ok(fit.every((c) => c.overflow === null));
  } finally { await browser.close(); }
});
