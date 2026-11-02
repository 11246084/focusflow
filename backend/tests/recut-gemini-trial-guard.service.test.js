'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { createGeminiProvider, createRecutRuntimeAdapters } = require('../src/services/recutRuntimeAdapters.service');
const { runSingleTopicTrial } = require('../src/services/recutRuntimeTrial.service');
const { createRecutTrialGuard } = require('../src/services/recutTrialGuard.service');
const policy = () => ({ modelId: 'gemini-3.8-flash', maxCalls: 5, maxRequestBytes: 100000, maxOutputTokens: 4096,
  budgetUsd: 0.5, inputPerMillion: 0.75, outputPerMillion: 3.75, validUntil: '2026-12-31' });
const request = () => ({ model: { provider: 'gemini', model: 'gemini-3.8-flash' }, instructions: '只依老師原話判斷。', input: { question: 'Siri 如何處理問題？', sentences: [{ id: 's1', text: '只用必要逐字稿', words: [] }], codeAvailable: false }, responseSchema: { type: 'OBJECT', properties: { answer: { type: 'STRING' } } } });
function setup(extra = {}) {
  const http = [];
  const provider = createGeminiProvider({ apiKey: 'SECRET_KEY_SENTINEL', thinkingLevel: 'low', trialPolicy: policy(), now: () => new Date('2026-11-02T00:00:00Z'),
    forbiddenValues: ['D:/PRIVATE_PROFESSOR_ROOT'], fetchImpl: async (url, options) => {
      http.push({ url, ...options }); return { ok: true, json: async () => ({ modelVersion: 'gemini-3.8-flash', candidates: [{ content: { parts: [{ text: 'private internal thought', thought: true }, { text: '{"answer":"ok"}' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 2 } }) };
    }, ...extra });
  return { provider, http };
}
it('3.8 generateContent uses documented camelCase/UPPER enum thinking, fixed model and no deprecated sampling/tool fields', async () => {
  const { provider, http } = setup(); const response = await provider(request()); const body = JSON.parse(http[0].body);
  assert.ok(http[0].url.endsWith('/models/gemini-3.8-flash:generateContent'));
  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'LOW' }); assert.equal(body.generationConfig.maxOutputTokens, 4096);
  for (const field of ['temperature', 'topP', 'topK', 'candidateCount', 'thinkingBudget']) assert.equal(body.generationConfig[field], undefined);
  assert.equal(body.tools, undefined); assert.equal(body.toolConfig, undefined); assert.equal(body.cachedContent, undefined);
  assert.equal(response.output, '{"answer":"ok"}'); assert.equal(response.trialRequest.requestedModelId, 'gemini-3.8-flash'); assert.equal(response.trialRequest.reservationOnly, true);
  assert.ok(response.trialRequest.budgetReservationUsd > 0); assert.ok(!http[0].body.includes('SECRET_KEY_SENTINEL'));
  assert.equal(http[0].headers['x-goog-api-key'], 'SECRET_KEY_SENTINEL');
});
it('trial calls/model/body/images/output/dollar guards stop before HTTP and never fall back', async () => {
  const r = setup();
  for (let n = 0; n < 5; n++) await r.provider(request());
  await assert.rejects(r.provider(request()), { code: 'RECUT_TRIAL_CALL_LIMIT' }); assert.equal(r.http.length, 5);
  const cases = [
    { req: { ...request(), model: { provider: 'gemini', model: 'gemini-2.5-flash' } }, code: 'RECUT_TRIAL_MODEL_MISMATCH' },
    { req: { ...request(), images: [{ mimeType: 'image/png', data: 'QUJD' }] }, code: 'RECUT_TRIAL_INPUT_FORBIDDEN' },
    { req: { ...request(), input: { ...request().input, codeAvailable: true } }, code: 'RECUT_TRIAL_INPUT_FORBIDDEN' },
    { req: { ...request(), input: { question: 'x'.repeat(100001) } }, code: 'RECUT_TRIAL_REQUEST_TOO_LARGE' },
  ];
  for (const test of cases) { const r = setup(); await assert.rejects(r.provider(test.req), { code: test.code }); assert.equal(r.http.length, 0); }
  const costly = setup({ trialPolicy: { ...policy(), budgetUsd: 0.0000001 } }); await assert.rejects(costly.provider(request()), { code: 'RECUT_TRIAL_BUDGET_EXCEEDED' }); assert.equal(costly.http.length, 0);
  const output = setup({ maxOutputTokens: 8192 }); await assert.rejects(output.provider(request()), { code: 'RECUT_TRIAL_POLICY_INVALID' }); assert.equal(output.http.length, 0);
  const wrongLevel = setup({ thinkingLevel: 'minimal' }); await assert.rejects(wrongLevel.provider(request()), { code: 'RECUT_PROVIDER_NOT_CONFIGURED' }); assert.equal(wrongLevel.http.length, 0);
});
it('trial only serializes permitted stage inputs: no runtime/teacher/password/path/environment/media/callback sentinels', async () => {
  for (const forbidden of [
    { runtime: { apiKey: 'SECRET_RUNTIME_SENTINEL' } }, { teacher: { password: 'SECRET_PASSWORD_SENTINEL' } }, { env: { SECRET: 'SECRET_ENV_SENTINEL' } },
    { question: 'normal', sentences: [{ id: 's1', text: 'normal', filePath: 'D:/PRIVATE_PROFESSOR_ROOT/video.mp4' }] },
    { question: 'normal', previousOutput: 'D:/PRIVATE_PROFESSOR_ROOT/video.mp4' }, { question: 'SECRET_KEY_SENTINEL' },
    { question: 'normal', errors: [() => 'CALLBACK_SENTINEL'] }, { question: 'normal', errors: [Buffer.from('PROFESSOR_VIDEO_BYTES_SENTINEL')] },
  ]) {
    const r = setup(); await assert.rejects(r.provider({ ...request(), input: forbidden }), { code: 'RECUT_TRIAL_INPUT_FORBIDDEN' }); assert.equal(r.http.length, 0);
  }
});
it('byte-based reservation upper bound and explicit prices remain estimates, with expiry and unavailable-model errors', async () => {
  const guard = createRecutTrialGuard(policy(), { now: () => new Date('2026-11-02T00:00:00Z') });
  let result; for (let n = 0; n < 5; n++) result = guard.reserve({ modelId: 'gemini-3.8-flash', input: {}, images: [], body: 'x'.repeat(100000), maxOutputTokens: 4096 });
  assert.ok(Math.abs(result.cumulativeBudgetReservationUsd - 0.4518) < 1e-12); assert.equal(result.reservationOnly, true);
  const expired = setup({ now: () => new Date('2027-01-01T00:00:00Z') }); await assert.rejects(expired.provider(request()), { code: 'RECUT_TRIAL_POLICY_EXPIRED' });
  for (const status of [403, 404]) {
    let calls = 0; const r = setup({ fetchImpl: async () => { calls++; return { ok: false, status, json: async () => ({ error: { message: 'SECRET_PROVIDER_DETAIL' } }) }; } });
    await assert.rejects(r.provider(request()), (e) => e.code === (status === 404 ? 'RECUT_MODEL_UNAVAILABLE' : 'RECUT_PROVIDER_PERMISSION_DENIED') && !e.message.includes('SECRET'));
    assert.equal(calls, 1);
  }
});
it('timeout/JSON/403 failures retain reservations and do not refund the five-call guard', async () => {
  for (const mode of ['timeout', 'json', '403']) {
    let calls = 0;
    const r = setup({ fetchImpl: async () => { calls++;
      if (mode === 'timeout') throw new Error('PRIVATE_TIMEOUT_DETAIL');
      return { ok: mode !== '403', status: 403, json: async () => { if (mode === 'json') throw new Error('PRIVATE_JSON_DETAIL'); return {}; } };
    } });
    for (let i = 1; i <= 5; i++) await assert.rejects(r.provider(request()), (e) => e.trialRequest?.trialModelCalls === i && e.trialRequest.cumulativeBudgetReservationUsd > 0 && !e.message.includes('PRIVATE'));
    await assert.rejects(r.provider(request()), { code: 'RECUT_TRIAL_CALL_LIMIT' }); assert.equal(calls, 5);
  }
});
it('failed single-topic run preserves safe request reservations through decision and attempt wrappers', async () => {
  const runtime = createRecutRuntimeAdapters({ allowModel: true, gemini: { apiKey: 'PRIVATE_KEY_SENTINEL', trialPolicy: policy(), now: () => new Date('2026-11-03T00:00:00Z'),
    fetchImpl: async () => { throw new Error('PRIVATE_TIMEOUT_SENTINEL'); } } });
  const pipeline = { generate: [{ id: 'decision', stage: 'selection', run: async (context) => context.runAttempt({ consumesCall: true, modelId: 'gemini-3.8-flash', execute: () => runtime.decide(request()) }) }] };
  await assert.rejects(runSingleTopicTrial({ pipeline, model: request().model, allowModel: true }), (error) => {
    const attempt = error.trial.attempts.find((a) => a.consumesCall);
    assert.equal(attempt.trialRequest.trialModelCalls, 1); assert.ok(attempt.trialRequest.requestBodyBytes > 0);
    assert.ok(!JSON.stringify(error.trial).includes('PRIVATE_')); return true;
  });
});
