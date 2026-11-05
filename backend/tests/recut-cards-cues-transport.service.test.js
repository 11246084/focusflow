'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { context } = require('./helpers/recutPipelineFixtures');
const renderer = require('../../short_render/src/plan');
const { createRecutCardsStep, foldTransportCues } = require('../src/services/recutCards.service');

// 2026-11-05 OpenCV 試產：每個 cue 名稱各一個錨點物件的 schema 約 20 KB、330 個型別節點，
// Gemini 回 400 INVALID_ARGUMENT。改成 cues 清單後須維持在明顯較小的規模。
it('cards response schema sends cues as a keyed list and stays compact', () => {
  const schema = renderer.getCardsResponseSchema();
  const cues = schema.properties.scenes.items.properties.cues;
  assert.equal(cues.type, 'ARRAY');
  assert.deepEqual(cues.items.required, ['key', 'sentenceId']);
  // Cue names depend on each card's params, so the key is a plain string; the
  // local validator checks the exact set (see short_render catalog.fields test).
  assert.deepEqual(cues.items.properties.key, { type: 'STRING' });
  let typed = 0;
  (function walk(value) { if (value && typeof value === 'object') { if (value.type) typed++; Object.values(value).forEach(walk); } })(schema);
  assert.ok(JSON.stringify(schema).length < 8000, 'schema bytes');
  assert.ok(typed < 150, 'typed schema nodes');
});

it('folds transport cues back into the plan object form and rejects ambiguous lists', () => {
  const output = { scenes: [{ id: 'a', cues: [{ key: 'text', sentenceId: 's1', text: 'OpenCV' }, { key: 'label', sentenceId: 's2' }] }], subtitles: [] };
  assert.deepEqual(foldTransportCues(output).scenes[0].cues, { text: { sentenceId: 's1', text: 'OpenCV' }, label: { sentenceId: 's2' } });
  const legacy = { scenes: [{ id: 'a', cues: { text: { sentenceId: 's1' } } }], subtitles: [] };
  assert.deepEqual(foldTransportCues(legacy), legacy);
  assert.throws(() => foldTransportCues({ scenes: [{ cues: [{ key: 'text', sentenceId: 's1' }, { key: 'text', sentenceId: 's2' }] }] }), /重複/);
  assert.throws(() => foldTransportCues({ scenes: [{ cues: [{ key: 'text', sentenceId: 's1', startSec: 3 }] }] }), /格式無效/);
  assert.throws(() => foldTransportCues({ scenes: [{ cues: [{ key: '__proto__', sentenceId: 's1' }] }] }), /格式無效/);
});

it('cards step builds the same plan from list cues as from object cues', async () => {
  const run = async (cues) => {
    const c = context(); c.cards.scenes[0].cues = cues;
    const decide = async () => ({ output: JSON.stringify(c.cards), modelId: 'fake', usageMetadata: null });
    const step = createRecutCardsStep({ decide, renderer, loadSource: async () => c.source });
    return (await step.run(c)).plan;
  };
  const fromList = await run([{ key: 'text', sentenceId: 's1', text: 'OpenCV' }]);
  const fromObject = await run({ text: { sentenceId: 's1', text: 'OpenCV' } });
  assert.deepEqual(fromList, fromObject);
  assert.deepEqual(fromList.scenes[0].cues, { text: { sentenceId: 's1', text: 'OpenCV' } });
});

it('duplicate list cues go back to the model as a repair error instead of being dropped', async () => {
  const c = context(); const outputs = [];
  c.cards.scenes[0].cues = [{ key: 'text', sentenceId: 's1' }, { key: 'text', sentenceId: 's1' }];
  const fixed = structuredClone(c.cards); fixed.scenes[0].cues = [{ key: 'text', sentenceId: 's1' }];
  const decide = async ({ input }) => { outputs.push(input); return { output: JSON.stringify(outputs.length === 1 ? c.cards : fixed), modelId: 'fake', usageMetadata: null }; };
  const step = createRecutCardsStep({ decide, renderer, loadSource: async () => c.source });
  const result = await step.run(c);
  assert.equal(outputs.length, 2);
  assert.ok(outputs[1].errors.some((error) => /重複/.test(error)));
  assert.deepEqual(result.plan.scenes[0].cues, { text: { sentenceId: 's1' } });
});
