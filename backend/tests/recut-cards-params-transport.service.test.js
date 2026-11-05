'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { context } = require('./helpers/recutPipelineFixtures');
const renderer = require('../../short_render/src/plan');
const { createRecutCardsStep, foldTransportParams, foldTransportOutput } = require('../src/services/recutCards.service');

const names = renderer.getComponentCatalog({ aiOnly: false }).map((card) => card.name);
const scene = (component, params) => ({ scenes: [{ id: 'a', component, params, cues: [] }], subtitles: [] });

it('unwraps params[component] and leaves legacy flat params untouched', () => {
  assert.deepEqual(foldTransportParams(scene('stat', { stat: { value: 'CPU' } }), names).scenes[0].params, { value: 'CPU' });
  assert.deepEqual(foldTransportParams(scene('stat', { value: 'CPU' }), names).scenes[0].params, { value: 'CPU' });
  // rows/chips have a field named like the component; a flat array value is legacy form.
  assert.deepEqual(foldTransportParams(scene('rows', { rows: [{ tokens: [{ t: 'a' }] }] }), names).scenes[0].params, { rows: [{ tokens: [{ t: 'a' }] }] });
  assert.deepEqual(foldTransportParams(scene('rows', { rows: { rows: [{ tokens: [{ t: 'a' }] }] } }), names).scenes[0].params, { rows: [{ tokens: [{ t: 'a' }] }] });
  assert.deepEqual(foldTransportOutput({ scenes: [{ id: 'a', component: 'stat', params: { stat: { value: 'v' } }, cues: [{ key: 'value', sentenceId: 's1' }] }], subtitles: [] }, names).scenes[0],
    { id: 'a', component: 'stat', params: { value: 'v' }, cues: { value: { sentenceId: 's1' } } });
});

it('rejects another component key, several component keys and dangerous names', () => {
  assert.throws(() => foldTransportParams(scene('stat', { relation: { words: [] } }), names), /只能有一個與 component 同名的鍵 "stat"，收到：relation/);
  assert.throws(() => foldTransportParams(scene('stat', { stat: { value: 'v' }, relation: { words: [] } }), names), /收到：stat, relation/);
  assert.throws(() => foldTransportParams(scene('stat', { stat: { value: 'v' }, label: 'x' }), names), /收到：stat, label/);
  assert.throws(() => foldTransportParams(scene('stat', JSON.parse('{"stat":{"value":"v","__proto__":{"x":1}}}')), names), /不允許的欄位名稱：scenes\[0\]\.params\.stat\.__proto__/);
  assert.throws(() => foldTransportParams(scene('checklist', JSON.parse('{"checklist":{"items":[{"text":"a","constructor":1}]}}')), names), /scenes\[0\]\.params\.checklist\.items\[0\]\.constructor/);
});

it('cards step builds the same plan from wrapped and flat params, and unknown fields still fail', async () => {
  const run = async (mutate, outputs) => {
    const c = context(); const sent = [];
    const variants = outputs.map((fn) => { const cards = structuredClone(c.cards); fn(cards); return cards; });
    const decide = async ({ input }) => { sent.push(input); return { output: JSON.stringify(variants[Math.min(sent.length - 1, variants.length - 1)]), modelId: 'fake', usageMetadata: null }; };
    mutate(c);
    const result = await createRecutCardsStep({ decide, renderer, loadSource: async () => c.source }).run(c);
    return { plan: result.plan, sent };
  };
  const wrapped = await run(() => {}, [(cards) => cards.scenes.forEach((s) => { s.params = { [s.component]: s.params }; })]);
  const flat = await run(() => {}, [() => {}]);
  assert.deepEqual(wrapped.plan, flat.plan);
  const repaired = await run(() => {}, [(cards) => { cards.scenes[0].params = { 'quote-reveal': { text: 'OpenCV', unit: '秒' } }; }, (cards) => { cards.scenes[0].params = { 'quote-reveal': { text: 'OpenCV' } }; }]);
  assert.equal(repaired.sent.length, 2);
  assert.ok(repaired.sent[1].errors.some((e) => e.code === 'FIELD_UNKNOWN' && e.path === 'scenes[0].params.unit'));
  assert.deepEqual(repaired.plan.scenes[0].params, { text: 'OpenCV' });
});
