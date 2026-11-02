'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { fixture, input } = require('./sentence.fixture');
const { buildRecutPlan, getComponentCatalog } = require('../src/plan');
const { THEMES } = require('../src/plan/runtime');
const { buildHtml } = require('../src/render/html');
const { stageProject, renderProject } = require('../src/render/render');
const { ensureFontLoaded } = require('../src/render/browser');
const { buildPrototypes } = require('../bin/prototype');

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recut-render-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const font = path.join(root, 'fake-font.ttf'); fs.writeFileSync(font, 'fake font');
  return { root, resolveFont: () => font };
}
function codeFixture() {
  const args = input();
  args.scenes[0] = { ...args.scenes[0], component: 'code', cues: {}, params: {
    language: 'javascript', lines: [{ text: 'const x = 1;', source: 'AI 修正', originalText: 'PRIVATE_OCR_ONLY' }],
    requiredVariables: ['x'], boxes: [{ line: 1, text: 'x' }], highlightLines: [1],
  } };
  return buildRecutPlan(args);
}

test('five themes share full animation and safe local original audio', () => {
  for (const theme of Object.keys(THEMES)) {
    const args = input(); args.theme = theme;
    const { plan, resolved, errors } = buildRecutPlan(args); assert.deepEqual(errors, []);
    const html = buildHtml(plan, resolved);
    assert.match(html, /<audio id="narration"/); assert.doesNotMatch(html, /<video|teacher\.mp4/);
    assert.ok(html.includes(`--bg:${THEMES[theme].bg}`));
    assert.doesNotMatch(html, /class="preview-|PRIVATE_OCR_ONLY|AI 修正/);
    assert.match(html, /RECUT_FONT_NOT_LOADED/);
    assert.throws(() => buildHtml(plan, resolved, { audioSrc: 'https://example.invalid/a.wav' }), /relative local/);
    // SVG xmlns is metadata, never an asset fetch.
    assert.doesNotMatch(html, /(?:src|href)="https?:/);
  }
  const css = fs.readFileSync(path.join(__dirname, '../src/render/style.css'), 'utf8');
  assert.doesNotMatch(css, /#[\da-f]{3,8}\b/i);
});

test('code provenance exists only in preview; render contains neither original OCR nor hidden metadata', () => {
  const { plan, resolved, errors } = codeFixture(); assert.deepEqual(errors, []);
  const rendered = buildHtml(plan, resolved), preview = buildHtml(plan, resolved, { mode: 'preview' });
  assert.match(preview, /PRIVATE_OCR_ONLY/); assert.match(preview, /AI 修正/);
  assert.doesNotMatch(rendered, /PRIVATE_OCR_ONLY|AI 修正|程式碼來源對照|class="preview-provenance"/);
  assert.match(rendered, /syntax-keyword/); assert.match(rendered, /code-box/);
  assert.match(preview, /Math\.pow\(10,4\/20\)/);
  assert.match(preview, /media\.currentTime/);
  const timeline = (html) => html.match(/const tl = gsap.timeline[\s\S]*?window.__recutReady/)[0];
  assert.equal(timeline(preview), timeline(rendered));
});

test('shared time seeking hides all other scenes and font gate registers timeline only after load', async () => {
  const { plan, resolved } = fixture(), html = buildHtml(plan, resolved);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const clips = resolved.scenes.map((s) => ({ dataset: { start: s.t0, duration: s.t1 - s.t0 }, style: {} }));
  let finishFonts;
  const fonts = new Promise((resolve) => { finishFonts = resolve; });
  const timeline = new Proxy({}, { get: () => () => timeline });
  const window = {}, context = { window, gsap: { timeline: () => timeline }, document: {
    fonts: { load: () => fonts, check: () => true }, querySelectorAll: () => clips,
  } };
  vm.runInNewContext(scripts[0][1], context);
  assert.equal(window.__timelines, undefined);
  finishFonts([{}]); await window.__recutReady;
  assert.equal(window.__recutFontLoaded, true); assert.equal(window.__timelines.recut, timeline);
  window.__recutSeek(5);
  assert.equal(clips[0].style.visibility, 'hidden'); assert.equal(clips[1].style.visibility, 'visible');
  window.__recutSeek(1); assert.equal(clips[0].style.visibility, 'visible'); assert.equal(clips[1].style.visibility, 'hidden');
});

test('staging/render use fake externals, fixed gain once, and fence modified media and missing font', async (t) => {
  const { root, resolveFont } = temporary(t), { plan, resolved, sentences, source } = fixture();
  const commands = [], frames = [];
  const runCommand = async (bin, args) => { commands.push(args); fs.writeFileSync(args.at(-1), 'fake bytes'); return { stdout: '', stderr: '' }; };
  const stageDir = await stageProject({ plan, resolved, sentences, evidence: source, sourcePath: 'fake-source', outDir: root, runCommand, resolveFont });
  const options = { plan, resolved, stageDir, outDir: root, runCommand, hyperframesImpl: async (args) => { frames.push(args); return {}; } };
  await assert.rejects(renderProject({ ...options, ensureFontLoaded: async () => false }), /FONT_NOT_LOADED/);
  assert.equal(frames.length, 0);
  await renderProject({ ...options, ensureFontLoaded: async () => true });
  assert.equal(frames.length, 1); assert.equal(commands.length, 2);
  assert.ok(commands[1].includes('volume=4dB')); assert.doesNotMatch(commands.flat().join(' '), /loudnorm|crop|atempo/);
  fs.appendFileSync(path.join(stageDir, 'narration.wav'), 'changed');
  await assert.rejects(renderProject({ ...options, ensureFontLoaded: async () => true }), /narration.wav changed/);
});

test('version mismatch and stale resolved timing fail before any external command', async (t) => {
  const { root, resolveFont } = temporary(t), f = fixture(); let called = false;
  const base = { ...f, evidence: f.source, outDir: root, resolveFont, runCommand: async () => { called = true; } };
  await assert.rejects(stageProject({ ...base, plan: { ...f.plan, versions: { ...f.plan.versions, shortRender: 'old' } } }), /VERSION_MISMATCH/);
  await assert.rejects(stageProject({ ...base, resolved: { ...f.resolved, total: 31 } }), /RESOLVED_MISMATCH/);
  assert.equal(called, false);
});

test('offline prototypes keep new cards disabled and produce five themes plus real code renderer entries', (t) => {
  const { root, resolveFont } = temporary(t);
  const entry = buildPrototypes(root, { resolveFont }); assert.equal(fs.existsSync(entry), true);
  for (const theme of Object.keys(THEMES)) assert.match(fs.readFileSync(path.join(root, `${theme}.html`), 'utf8'), /resizePreview/);
  for (const theme of Object.keys(THEMES)) {
    const preview = fs.readFileSync(path.join(root, `code-${theme}.html`), 'utf8');
    const render = fs.readFileSync(path.join(root, `code-${theme}.render.html`), 'utf8');
    assert.match(preview, /class="code-line code-highlight"/); assert.match(preview, /<mark class="code-box">value<\/mark>/);
    assert.match(preview, /SyntaxError: invalid syntax/); assert.match(preview, /程式碼來源對照/);
    const plan = JSON.parse(fs.readFileSync(path.join(root, `code-${theme}.plan.json`), 'utf8'));
    assert.equal(plan.scenes[0].params.lines[0].intentionalError, true);
    assert.equal(plan.scenes[0].params.lines[0].text, plan.scenes[0].params.lines[0].originalText);
    assert.doesNotMatch(render, /程式碼來源對照|畫面原樣|class="preview-provenance"/);
    assert.match(render, /data-width="720" data-height="1280"/);
  }
  for (const card of getComponentCatalog().filter((c) => ['not-fit', 'not-merge', 'nested', 'code'].includes(c.name))) assert.equal(card.aiEnabled, false);
});

test('browser font preflight closes browser and blocks remote requests with fake driver', async () => {
  let closed = false, interceptor;
  const launch = async () => ({ newPage: async () => ({ setRequestInterception: async () => {},
    on: (name, callback) => { interceptor = callback; }, goto: async () => {}, evaluate: async () => true,
  }), close: async () => { closed = true; } });
  assert.equal(await ensureFontLoaded({ stageDir: '.', launch }), true); assert.equal(closed, true);
  let aborted = false; interceptor({ url: () => 'https://example.invalid', abort: () => { aborted = true; } }); assert.equal(aborted, true);
});

test('responsive preview confines the document and shrinks controls without changing the render canvas', () => {
  const { plan, resolved } = fixture();
  const preview = buildHtml(plan, resolved, { mode: 'preview' }), render = buildHtml(plan, resolved);
  assert.match(preview, /<html lang="zh-Hant" class="preview-document">/);
  assert.doesNotMatch(render, /<html[^>]*class="preview-document"/);
  assert.match(preview, /html\.preview-document \{ width:100%; min-height:0; \}/);
  assert.match(preview, /flex:1 1 0; width:0; min-width:44px/);
  assert.match(preview, /Math\.min\(720,viewport\.clientWidth\)/);
  for (const html of [preview, render]) assert.match(html, /data-width="720" data-height="1280"/);
});
