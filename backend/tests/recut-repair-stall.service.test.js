'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { context } = require('./helpers/recutPipelineFixtures');
const renderer = require('../../short_render/src/plan');
const { createRecutCardsStep } = require('../src/services/recutCards.service');
const { runValidatedDecision } = require('../src/services/recutDecision.service');
const { errorSignature, createRepairStallTracker } = require('../src/services/recutRepairStall.service');

it('error signatures ignore order, duplicates and changing numbers but keep code and path', () => {
  const a = [{ code: 'FIELD_UNKNOWN', path: 'scenes[1].params.words', message: 'x' }, 'scene scene-1 lasts 12.58s'];
  const b = ['scene scene-1 lasts 12.46s', { code: 'FIELD_UNKNOWN', path: 'scenes[1].params.words', message: 'other text' }, 'scene scene-1 lasts 12.46s'];
  assert.equal(errorSignature(a), errorSignature(b));
  assert.notEqual(errorSignature(a), errorSignature([{ code: 'FIELD_UNKNOWN', path: 'scenes[2].params.words' }, 'scene scene-1 lasts 12.58s']));
});

// Reproduces run-6: the model keeps sending relation.words inside a stat card.
const repeatingCards = (c, { fixAfter = Infinity, alternate = false } = {}) => {
  const requests = [];
  const bad = (field) => { const cards = structuredClone(c.cards); cards.scenes[0].params = { 'quote-reveal': { text: 'OpenCV', [field]: 'x' } }; return cards; };
  const decide = async ({ input }) => {
    requests.push(structuredClone(input));
    const n = requests.length;
    const output = n > fixAfter ? c.cards : bad(alternate && n % 2 === 0 ? 'unit' : 'words');
    return { output: JSON.stringify(output), modelId: 'fake', usageMetadata: null };
  };
  return { decide, requests };
};

it('identical failures switch to a targeted request once, then stop with diagnostics before the budget is spent', async () => {
  const c = context(); c.task.callLimit = 20; c.task.callsUsed = 1;
  const { decide, requests } = repeatingCards(c);
  const step = createRecutCardsStep({ decide, renderer, loadSource: async () => c.source });
  await assert.rejects(step.run(c), (error) => {
    assert.equal(error.code, 'RECUT_REPAIR_STALLED');
    assert.equal(error.diagnostics.stage, 'cards');
    assert.equal(error.diagnostics.occurrences, 3);
    assert.deepEqual(error.diagnostics.signature, ['FIELD_UNKNOWN|scenes[0].params.words']);
    assert.match(error.message, /scenes\[0\]\.params\.words/);
    return true;
  });
  assert.equal(requests.length, 3);
  assert.equal(c.task.callsUsed, 4, 'only three calls were spent out of a limit of 20');
  assert.equal(requests[1].repairStrategy, undefined);
  assert.equal(requests[2].repairStrategy, 'targeted');
  assert.match(requests[2].mustFix[0], /FIELD_UNKNOWN scenes\[0\]\.params\.words/);
  assert.match(requests[2].repairNotice, /完全相同的錯誤/);
});

it('a targeted request that fixes the problem completes normally', async () => {
  const c = context(); c.task.callLimit = 20;
  const { decide, requests } = repeatingCards(c, { fixAfter: 2 });
  const result = await createRecutCardsStep({ decide, renderer, loadSource: async () => c.source }).run(c);
  assert.equal(requests.length, 3);
  assert.equal(requests[2].repairStrategy, 'targeted');
  assert.deepEqual(result.plan.scenes[0].params, { text: 'OpenCV' });
});

it('alternating failures are detected as a stall too', async () => {
  const c = context(); c.task.callLimit = 20;
  const { decide, requests } = repeatingCards(c, { alternate: true });
  await assert.rejects(createRecutCardsStep({ decide, renderer, loadSource: async () => c.source }).run(c), { code: 'RECUT_REPAIR_STALLED' });
  assert.equal(requests.length, 5, 'words, unit, words(targeted), unit(targeted), words(third time) -> stop');
});

it('changing errors are not a stall and keep using the normal repair path', () => {
  const tracker = createRepairStallTracker({ stage: 'cards' });
  for (const path of ['a', 'b', 'c', 'd', 'e']) assert.equal(tracker.record([{ code: 'X', path }]).strategy, 'repair');
});

it('selection loop uses the same stall rule', async () => {
  const task = { callLimit: 20, callsUsed: 0 }; const requests = [];
  const runAttempt = async ({ execute }) => { task.callsUsed += 1; const result = await execute(); if (result.validation.valid === false) throw Object.assign(new Error('v'), { code: 'RECUT_VALIDATION_FAILED' }); };
  const decide = async ({ input }) => { requests.push(input); return { output: '{"answerable":true}', modelId: 'fake' }; };
  await assert.rejects(runValidatedDecision({ task, runAttempt, checkCancelled: async () => {}, decide, model: { model: 'fake' }, instructions: 'i', input: {}, responseSchema: {},
    validate: () => ({ valid: false, errors: ['s18 的錨點不存在或不唯一：如果你的設備'] }) }), (error) => error.code === 'RECUT_REPAIR_STALLED' && error.diagnostics.stage === 'selection');
  assert.equal(task.callsUsed, 3);
  assert.equal(requests[2].repairStrategy, 'targeted');
});

it('production call-limit defaults are unchanged', () => {
  const saved = { a: process.env.RECUT_INITIAL_CALL_LIMIT, b: process.env.RECUT_MODIFICATION_CALL_LIMIT };
  delete process.env.RECUT_INITIAL_CALL_LIMIT; delete process.env.RECUT_MODIFICATION_CALL_LIMIT;
  try {
    const settings = require('../src/services/recutSettings.service');
    const read = settings.getSetting || settings.getRecutSetting;
    assert.equal(typeof read, 'function');
    assert.equal(read('recut.initialCallLimit'), 5);
    assert.equal(read('recut.modificationCallLimit'), 5);
  } finally {
    if (saved.a !== undefined) process.env.RECUT_INITIAL_CALL_LIMIT = saved.a;
    if (saved.b !== undefined) process.env.RECUT_MODIFICATION_CALL_LIMIT = saved.b;
  }
});

it('when the budget is already used up the normal exhaustion code is kept', () => {
  const tracker = createRepairStallTracker({ stage: 'cards' });
  tracker.record(['same']); tracker.record(['same']);
  assert.equal(tracker.record(['same'], { budgetLeft: false }).strategy, 'targeted');
  assert.throws(() => tracker.record(['same'], { budgetLeft: true }), { code: 'RECUT_REPAIR_STALLED' });
});
