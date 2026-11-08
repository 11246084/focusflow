'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { context } = require('./helpers/recutPipelineFixtures');
const renderer = require('../../short_render/src/plan');
const { createRecutCardsStep, buildCardsInput } = require('../src/services/recutCards.service');
const { createRecutWholeCheckStep } = require('../src/services/recutWholeCheck.service');
const { createGeminiProvider } = require('../src/services/recutRuntimeAdapters.service');
const { INSTRUCTIONS, getResponseSchema } = require('../src/prompts/recutCards');
const policy = { modelId: 'gemini-3.8-flash', maxCalls: 5, maxRequestBytes: 100000, maxOutputTokens: 4096,
  budgetUsd: 0.5, inputPerMillion: 0.75, outputPerMillion: 3.75, validUntil: '2026-12-31' };
it('real catalog plus a 24-sentence window fits the guard with full selected evidence and full-window review', async () => {
  const c = context(); c.task.settingsSnapshot.model.model = policy.modelId; c.data.modelId = policy.modelId;
  for (let i = 0; i < 18; i++) {
    const start = 42 + i * 6;
    const words = Array.from({ length: 20 }, (_, n) => ({ text: '背景教學資料', startSec: start + n * 0.275, endSec: start + (n + 1) * 0.275 }));
    c.source.sentences.push({ id: `s${i + 7}`, text: words.map((w) => w.text).join(''), startSec: start, endSec: start + 5.5,
      words, chunkIds: ['synthetic-only'], retrievalHit: false });
  }
  const requests = [];
  const decide = createGeminiProvider({ apiKey: 'fixture-private-key', thinkingLevel: 'LOW', trialPolicy: policy,
    fetchImpl: async (_, options) => { const body = JSON.parse(options.body); requests.push(body);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(requests.length === 1 ? c.cards : { issues: [] }) }] } }] }) }; } });
  const input = buildCardsInput({ source: c.source, data: c.data, renderer });
  const legacy = { ...input, clips: c.data.selectionResult.clips, sentences: c.source.sentences,
    catalog: renderer.getComponentCatalog({ aiOnly: true }), iconAllowlist: renderer.getAllowedIcons() };
  // The compact cues schema leaves the untrimmed body under 100 KB, so pin the
  // trimming benefit by size ratio and a stricter guard instead of the 100 KB limit.
  const strict = createGeminiProvider({ apiKey: 'fixture-private-key', thinkingLevel: 'LOW', trialPolicy: { ...policy, maxRequestBytes: 50000 },
    fetchImpl: async () => { throw new Error('must not send'); } });
  await assert.rejects(strict({ model: c.task.settingsSnapshot.model, instructions: INSTRUCTIONS, input: legacy, responseSchema: getResponseSchema(renderer) }),
    { code: 'RECUT_TRIAL_REQUEST_TOO_LARGE' });
  assert.ok(Buffer.byteLength(JSON.stringify(input)) * 4 < Buffer.byteLength(JSON.stringify(legacy)));
  assert.equal(requests.length, 0);
  const selected = c.source.sentences.slice(0, 6);
  assert.deepEqual(input.sentences, selected); assert.equal(input.clips[0].words, undefined);
  assert.ok(input.catalog.every((card) => card.paramsSchema === undefined && card.example && card.doNotUse));
  assert.ok(input.iconAllowlist.length <= 64 && input.iconAllowlist.every((icon) => renderer.getAllowedIcons().includes(icon)));
  const step = createRecutCardsStep({ decide, renderer, loadSource: async () => c.source });
  Object.assign(c.data, await step.run(c));
  assert.deepEqual(JSON.parse(requests[0].contents[0].parts[0].text).sentences, selected);
  assert.deepEqual(requests[0].generationConfig.responseSchema, renderer.getCardsResponseSchema());
  assert.ok(Buffer.byteLength(JSON.stringify(requests[0])) < 100000);
  const check = createRecutWholeCheckStep({ decide, renderer, cards: step, loadSource: async () => c.source });
  const result = await check.run(c);
  assert.ok(result.version.plan); assert.equal(requests.length, 2);
  assert.equal(JSON.parse(requests[1].contents[0].parts[0].text).sentences.length, 24);
  assert.ok(Buffer.byteLength(JSON.stringify(requests[1])) < 100000);
  const invalid = structuredClone(result.version.plan); invalid.scenes[0].params.icon = 'not-an-allowed-icon';
  assert.equal(renderer.validatePlan(invalid, { sentences: c.source.sentences, evidence: c.source }).valid, false);
});
