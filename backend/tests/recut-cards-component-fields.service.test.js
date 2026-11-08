'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { context } = require('./helpers/recutPipelineFixtures');
const renderer = require('../../short_render/src/plan');
const { createRecutCardsStep, buildCardsInput } = require('../src/services/recutCards.service');
const { createRecutRuntimeAdapters } = require('../src/services/recutRuntimeAdapters.service');

it('cards input gives every component its own fields, required fields, example and example cues', () => {
  const c = context();
  const input = buildCardsInput({ source: c.source, data: c.data, renderer });
  const full = renderer.getComponentCatalog({ aiOnly: true });
  assert.equal(input.catalog.length, full.length);
  for (const card of input.catalog) {
    const source = full.find((entry) => entry.name === card.name);
    assert.equal(card.paramsSchema, undefined);
    assert.deepEqual(card.fields, source.fields);
    assert.deepEqual(card.required, source.required);
    assert.deepEqual(card.nestedFields, source.nestedFields);
    assert.deepEqual(card.exampleCues, source.exampleCues);
    assert.ok(card.example && card.doNotUse);
  }
});

it('guarded RC6 code entry only advertises the language field', () => {
  const runtime = createRecutRuntimeAdapters({ allowModel: true, gemini: { apiKey: 'fake-key', fetchImpl: async () => { throw new Error('no http'); } }, renderer,
    codeCards: { enabled: true, ffmpeg: 'fake-ffmpeg', run: async () => {}, resolveSourcePath: async () => 'D:/source.mp4', resolveSource: async (file) => file,
      createWorkspace: async () => 'D:/owned-work', removeWorkspace: async () => {}, readFile: async () => Buffer.from('png') } });
  const code = runtime.renderer.getComponentCatalog({ aiOnly: true }).find((entry) => entry.name === 'code');
  assert.deepEqual(code.fields, ['language']);
  assert.deepEqual(code.required, ['language']);
  assert.deepEqual(code.nestedFields, []);
  assert.deepEqual(code.exampleCues, ['stamp']);
});

it('a foreign param field is sent back with the component allowed list and is not dropped', async () => {
  const c = context(); const requests = [];
  const bad = structuredClone(c.cards); bad.scenes[0].params.unit = '秒';
  const decide = async ({ input }) => { requests.push(input); return { output: JSON.stringify(requests.length === 1 ? bad : c.cards), modelId: 'fake', usageMetadata: null }; };
  const step = createRecutCardsStep({ decide, renderer, loadSource: async () => c.source });
  const result = await step.run(c);
  assert.equal(requests.length, 2);
  const feedback = requests[1].errors.find((error) => error.code === 'FIELD_UNKNOWN');
  assert.equal(feedback.path, 'scenes[0].params.unit');
  assert.match(feedback.message, /component "quote-reveal" params allows only: text, label, icon; required: text/);
  const previous = typeof requests[1].previousOutput === 'string' ? JSON.parse(requests[1].previousOutput) : requests[1].previousOutput;
  assert.deepEqual(previous.scenes[0].params, { text: 'OpenCV', unit: '秒' });
  assert.equal(result.plan.scenes[0].params.unit, undefined);
});

it('a foreign field that the model never fixes keeps the step failing', async () => {
  const c = context(); c.task.callLimit = 3;
  const bad = structuredClone(c.cards); bad.scenes[0].params.unit = '秒';
  const decide = async () => ({ output: JSON.stringify(bad), modelId: 'fake', usageMetadata: null });
  const step = createRecutCardsStep({ decide, renderer, loadSource: async () => c.source });
  await assert.rejects(step.run(c));
  assert.ok(c.attempts.every((attempt) => attempt.validation?.valid === false));
});
