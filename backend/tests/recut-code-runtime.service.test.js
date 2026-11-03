'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { createRecutRuntimeAdapters } = require('../src/services/recutRuntimeAdapters.service');
const { context } = require('./helpers/recutPipelineFixtures');
const renderer = require('../../short_render/src/plan');
function setup({ readable = true, failCapture = false } = {}) {
  const http = [], commands = []; let cleaned = 0;
  const runtime = createRecutRuntimeAdapters({ allowModel: true, gemini: { apiKey: 'fake-key', maxOutputTokens: 2048,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body); http.push(body);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ readable, lines: readable ? http.length === 1 ? ['x = 1'] : ['x = 1', 'print(x)'] : [] }) }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 } }) };
    } }, renderer,
    codeCards: { enabled: true, ffmpeg: 'fake-ffmpeg', run: async (_binary, args) => { commands.push(args); if (failCapture) throw new Error('private capture'); },
      resolveSourcePath: async () => 'D:/source.mp4', resolveSource: async (file) => file,
      createWorkspace: async () => 'D:/owned-work', removeWorkspace: async () => { cleaned++; }, readFile: async () => Buffer.from('fake-png-pixels') } });
  return { runtime, http, commands, cleaned: () => cleaned };
}
it('configured RC6 exposes only guarded code request and sends real image parts through fake HTTP', async () => {
  const r = setup(), c = context();
  assert.equal(r.http.length, 0); assert.equal(r.commands.length, 0);
  assert.equal(r.runtime.capabilities.codeCards, true);
  const catalog = r.runtime.renderer.getComponentCatalog({ aiOnly: true });
  assert.ok(catalog.some((item) => item.name === 'code' && item.review === 'rc6-capture-required'));
  for (const name of ['not-fit', 'not-merge', 'nested']) {
    const item = catalog.find((entry) => entry.name === name);
    assert.ok(item); assert.equal(item.aiEnabled, true); assert.equal(item.review, 'independent-mobile-reviewed-20261104');
    assert.deepEqual(item.paramsSchema, renderer.getComponentCatalog({ aiOnly: true }).find((entry) => entry.name === name).paramsSchema);
  }
  assert.equal(renderer.getComponentCatalog({ aiOnly: true }).some((entry) => entry.name === 'code'), false);
  const guardedCode = catalog.find((entry) => entry.name === 'code');
  assert.deepEqual(Object.keys(guardedCode.paramsSchema.properties), ['language']);
  assert.equal(guardedCode.paramsSchema.properties.lines, undefined);
  const schema = r.runtime.renderer.getCardsResponseSchema(); assert.ok(schema.properties.scenes.items.properties.component.enum.includes('code'));
  const properties = schema.properties.scenes.items.properties;
  for (const name of ['not-fit', 'not-merge', 'nested']) assert.ok(properties.component.enum.includes(name));
  assert.ok(properties.params.properties.language); assert.equal(properties.params.properties.lines, undefined);
  const scene = { id: 'code', component: 'code', from: 's1', to: 's2', params: { language: 'python' } };
  const result = await r.runtime.codeCardHandler({ ...c, source: c.source, scene });
  assert.equal(result.component, 'code'); assert.equal(r.commands.length, 3); assert.equal(r.cleaned(), 1);
  assert.equal(r.http.length, 2); assert.equal(c.task.callsUsed, 1);
  assert.deepEqual(result.params.lines.map((line) => line.source), ['畫面原樣', 'AI 補寫']);
  for (const request of r.http) {
    assert.equal(request.contents[0].parts.filter((p) => p.inlineData?.mimeType === 'image/png').length, 3);
    assert.equal(request.generationConfig.maxOutputTokens, 2048);
  }
  assert.ok(!JSON.stringify(c.attempts).includes(Buffer.from('fake-png-pixels').toString('base64')));
  assert.ok(!JSON.stringify(c.attempts).includes('fake-key'));
  await r.runtime.codeCardHandler({ ...c, source: c.source, scene: { ...scene, id: 'renamed' } }); assert.equal(r.http.length, 2);
});
it('unconfigured RC6 stays unavailable and enabled-but-incomplete capture reports precise missing', () => {
  const off = createRecutRuntimeAdapters({ renderer }); assert.equal(off.capabilities.codeCards, false); assert.deepEqual(off.optionalMissing, ['codeCards.enabled']);
  assert.ok(!off.renderer.getCardsResponseSchema().properties.scenes.items.properties.component.enum.includes('code'));
  const incomplete = createRecutRuntimeAdapters({ renderer, codeCards: { enabled: true } });
  assert.ok(incomplete.missing.includes('codeCards.ffmpeg')); assert.ok(incomplete.missing.includes('codeCards.resolveSourcePath')); assert.equal(incomplete.codeCardHandler, undefined);
});
it('unreadable frames and failed capture fall back without fabricated code or leaked provider details', async () => {
  for (const options of [{ readable: false }, { failCapture: true }]) {
    const r = setup(options), c = context();
    const result = await r.runtime.codeCardHandler({ ...c, source: c.source, scene: { id: 'code', component: 'code', from: 's1', to: 's2', params: { language: 'python' } } });
    assert.equal(result.component, 'quote-reveal'); assert.ok(!JSON.stringify(result).includes('private')); assert.equal(r.cleaned(), 1);
    assert.equal(r.http.length, options.failCapture ? 0 : 1);
  }
});
it('concrete capture never allows review to silently correct an intentional classroom error', async () => {
  const r = setup(), c = context(); c.source.sentences[0].text = '這行故意寫錯給你們看';
  const scene = { id: 'code', component: 'code', from: 's1', to: 's2', params: { language: 'python' } };
  assert.equal((await r.runtime.codeCardHandler({ ...c, source: c.source, scene })).component, 'quote-reveal');
  assert.equal(r.http.length, 0);
  const known = setup(), k = context(); k.source.sentences[0].text = '第1行故意寫錯給你們看';
  const result = await known.runtime.codeCardHandler({ ...k, source: k.source, scene });
  assert.equal(result.component, 'quote-reveal'); assert.equal(known.http.length, 0);
  const warning = setup(), w = context(); w.source.sentences[0].text = '這行會出錯';
  assert.equal((await warning.runtime.codeCardHandler({ ...w, source: w.source, scene })).component, 'quote-reveal'); assert.equal(warning.http.length, 0);
});

for (const narration of ['第1行會出錯', '第十二行會出錯', '第 2 行可能出錯', '這一行就會出錯', '會出錯', '可能出錯', '這樣會有錯誤']) {
  it(`intentional error warning fails closed without correcting code: ${narration}`, async () => {
    const r = setup(), c = context(); c.source.sentences[0].text = narration;
    const result = await r.runtime.codeCardHandler({ ...c, source: c.source,
      scene: { id: 'code', component: 'code', from: 's1', to: 's2', params: { language: 'python' } } });
    assert.equal(result.component, 'quote-reveal'); assert.equal(r.http.length, 0);
  });
}
