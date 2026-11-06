'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { context } = require('./helpers/recutPipelineFixtures');
const renderer = require('../../short_render/src/plan');
const { createRecutCardsStep } = require('../src/services/recutCards.service');
const { runValidatedDecision } = require('../src/services/recutDecision.service');
const { errorSignature, createRepairStallTracker } = require('../src/services/recutRepairStall.service');

it('error signatures ignore order, duplicates and changing decimal values but keep code, path and message', () => {
  const a = [{ code: 'FIELD_UNKNOWN', path: 'scenes[1].params.words', message: 'x' }, 'scene scene-1 lasts 12.58s'];
  const b = ['scene scene-1 lasts 12.46s', { code: 'FIELD_UNKNOWN', path: 'scenes[1].params.words', message: 'x' }, 'scene scene-1 lasts 12.46s'];
  assert.notEqual(errorSignature([{ code: 'FIELD_UNKNOWN', path: 'scenes[1].params.words', message: 'x' }]), errorSignature([{ code: 'FIELD_UNKNOWN', path: 'scenes[1].params.words', message: 'other text' }]));
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
    assert.equal(error.diagnostics.signature.length, 1);
    assert.match(error.diagnostics.signature[0], /^FIELD_UNKNOWN\|scenes\[0\]\.params\.words\|field is not in the sentence-v1 contract/);
    assert.match(error.message, /scenes\[0\]\.params\.words/);
    return true;
  });
  assert.equal(requests.length, 3);
  assert.equal(c.task.callsUsed, 4, 'only three calls were spent out of a limit of 20');
  assert.equal(requests[1].repairStrategy, undefined);
  assert.equal(requests[2].repairStrategy, 'targeted');
  assert.match(requests[2].mustFix[0], /FIELD_UNKNOWN scenes\[0\]\.params\.words/);
  assert.match(requests[2].repairNotice, /再次出現同一組錯誤/);
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
  // words, unit, words (2nd words: next request targeted), unit (targeted), words (3rd words: stop).
  assert.equal(requests.length, 5);
  assert.equal(requests[2].repairStrategy, undefined); assert.equal(requests[3].repairStrategy, 'targeted'); assert.equal(requests[4].repairStrategy, 'targeted');
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

// Review finding: SENTENCE_TIMING always uses path "$"; different timing problems must not look identical.
it('different timing errors on the generic path are distinct; only decimal values are masked', () => {
  const timing = (message) => [{ code: 'SENTENCE_TIMING', path: '$', message }];
  const tracker = createRepairStallTracker({ stage: 'cards' });
  for (const message of ['scene scene-1 (s4-s6) lasts 12.58s but must last 3-12 seconds', 'anchor absent or ambiguous in s12: GPU', 'whole-sentence anchor on s12 was trimmed out of the clip'])
    assert.equal(tracker.record(timing(message)).strategy, 'repair');
  assert.notEqual(errorSignature(timing('anchor absent or ambiguous in s1: a')), errorSignature(timing('anchor absent or ambiguous in s2: a')));
  assert.equal(errorSignature(timing('scene scene-1 lasts 12.58s')), errorSignature(timing('scene scene-1 lasts 12.46s')));
});

it('an invalid JSON attempt counts its own error, not the previous attempt\'s', async () => {
  const { retryDecision } = require('../src/services/recutRuntime.service');
  const task = { callLimit: 10, callsUsed: 0, settingsSnapshot: { model: { model: 'fake' } } }; const requests = [];
  const context = { task, checkCancelled: async () => {}, runAttempt: async ({ execute }) => { task.callsUsed += 1; const r = await execute();
    if (r.validation.valid === false) throw Object.assign(new Error('v'), { code: 'RECUT_VALIDATION_FAILED' }); } };
  const outputs = ['{"a":1}', 'not json', '{"a":1}', '{"ok":true}'];
  const decide = async ({ input }) => { requests.push(structuredClone(input)); return { output: outputs[requests.length - 1] }; };
  const result = await retryDecision(context, { stage: 'cards', decide, instructions: 'i', responseSchema: {}, input: {},
    validate: (output) => (output.ok ? { valid: true, errors: [] } : { valid: false, errors: [{ code: 'FIELD_UNKNOWN', path: 'scenes[0].params.words', message: 'm' }] }) });
  assert.equal(result.valid, true);
  assert.deepEqual(requests[2].errors, ['模型輸出不是有效 JSON'], 'the JSON failure is reported as such');
  assert.equal(requests[2].previousOutput, null);
  assert.equal(requests[3].repairStrategy, 'targeted', 'A, json, A -> second A is targeted, not a stall');
});

it('integer and decimal second values are masked; ids keep their numbers', () => {
  const t = (message) => [{ code: 'SENTENCE_TIMING', path: '$', message }];
  assert.equal(errorSignature(t('scene scene-1 lasts 12.58s')), errorSignature(t('scene scene-1 lasts 13s')));
  assert.notEqual(errorSignature(t('scene scene-1 lasts 13s')), errorSignature(t('scene scene-2 lasts 13s')));
});

// Review m4: with the production 5-call limit, a cards-only modification task that
// repeats the same failure three times stops with two calls left (documented trade-off).
it('5-call modification task: three identical cards failures stop with RECUT_REPAIR_STALLED and two calls left', async () => {
  const c = context(); c.task.callLimit = 5; c.task.callsUsed = 0;
  const { decide, requests } = repeatingCards(c);
  await assert.rejects(createRecutCardsStep({ decide, renderer, loadSource: async () => c.source }).run(c), { code: 'RECUT_REPAIR_STALLED' });
  assert.equal(requests.length, 3); assert.equal(c.task.callLimit - c.task.callsUsed, 2);
});
