#!/usr/bin/env node
'use strict';

// Self-made synthetic cards only. No source video, ASR, FFmpeg or model call.
const fs = require('node:fs');
const path = require('node:path');
const { input } = require('../tests/sentence.fixture');
const { buildRecutPlan, getComponentCatalog } = require('../src/plan');
const { THEMES } = require('../src/plan/runtime');
const { buildHtml } = require('../src/render/html');
const { fontPath } = require('../src/util');

function buildPrototypes(outDir, { resolveFont = fontPath } = {}) {
  fs.mkdirSync(path.join(outDir, 'fonts'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'vendor'), { recursive: true });
  fs.copyFileSync(resolveFont(), path.join(outDir, 'fonts', 'NotoSansTC-VF.ttf'));
  fs.copyFileSync(require.resolve('gsap/dist/gsap.min.js'), path.join(outDir, 'vendor', 'gsap.min.js'));
  // A generated silent WAV makes the offline controls usable; it is not media evidence.
  const rate = 8000, samples = rate * 30;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  fs.writeFileSync(path.join(outDir, 'narration.wav'), wav);
  const params = {
    'not-fit': { object: { text: '大物件', icon: 'fluent:desktop-computer' }, container: { text: '小空間', icon: 'fluent:package' } },
    'not-merge': { left: { text: '第一份', icon: 'fluent:package' }, right: { text: '第二份', icon: 'fluent:package' }, result: { text: '一個整體', icon: 'fluent:desktop-computer' } },
    nested: { layers: [{ text: '整體', icon: 'fluent:desktop-computer' }, { text: '子系統', icon: 'fluent:package' }, { text: '元件', icon: 'phosphor:brackets-curly' }] },
  };
  const links = [];
  for (const theme of Object.keys(THEMES)) {
    const args = input(); args.theme = theme; args.title.text = '新圖卡離線合成原型';
    args.scenes = args.scenes.map((scene, i) => {
      const component = Object.keys(params)[i % 3];
      return { ...scene, component, params: params[component], cues: {} };
    });
    const built = buildRecutPlan(args);
    if (built.errors.length) throw new Error(JSON.stringify(built.errors));
    fs.writeFileSync(path.join(outDir, `${theme}.html`), buildHtml(built.plan, built.resolved, { mode: 'preview' }));
    links.push(`<li><a href="${theme}.html">${theme}：放不進去 → 合不起來 → 層層包含</a></li>`);
  }
  fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify(getComponentCatalog(), null, 2));
  fs.writeFileSync(path.join(outDir, 'index.html'), `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>圖卡原型</title><style>body{font:18px sans-serif;line-height:1.7;margin:24px;max-width:720px}a{display:block;padding:12px}li{margin:8px 0}</style><h1>新圖卡離線合成原型</h1><p>全為自製合成資料，30 秒靜音；新圖卡仍停用 AI。每 5 秒換卡，拖曳播放位置檢查手機可讀性。此頁不代表實際成品或正式驗收。</p><ul>${links.join('')}</ul></html>`);
  return path.join(outDir, 'index.html');
}
if (require.main === module) console.log(buildPrototypes(path.resolve(process.argv[2] || path.join(__dirname, '..', 'out', 'prototypes'))));
module.exports = { buildPrototypes };
