const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { classifyGeminiResponse } = require('../src/services/geminiDiagnostics.service');
const { diagnose, parseArgs } = require('../src/scripts/diagnoseGemini');

const quota = (quotaId, retry) => ({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded', details: [
  { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_requests', quotaId }] },
  ...(retry ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: retry }] : []),
] } });

describe('Gemini 失敗原因分類', () => {
  it('每月花費上限（2026-11-14 實際收到的訊息）', () => {
    const result = classifyGeminiResponse({ httpStatus: 429, body: { error: { status: 'RESOURCE_EXHAUSTED', message: 'Your project has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/spend to manage your project spend cap.' } } });
    assert.equal(result.category, 'SPEND_CAP_REACHED');
    assert.match(result.guidance, /花費上限/);
  });
  it('每分鐘速率限制帶出配額名稱與等待時間', () => {
    const result = classifyGeminiResponse({ httpStatus: 429, body: quota('GenerateRequestsPerMinutePerProjectPerModel', '23s') });
    assert.equal(result.category, 'RATE_LIMITED');
    assert.equal(result.retryDelay, '23s');
    assert.deepEqual(result.quotaIds.includes('GenerateRequestsPerMinutePerProjectPerModel'), true);
  });
  it('免費額度用完', () => {
    assert.equal(classifyGeminiResponse({ httpStatus: 429, body: quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier') }).category, 'FREE_TIER_QUOTA');
  });
  it('金鑰無效、權限不足、模型不存在、服務異常與連線失敗', () => {
    assert.equal(classifyGeminiResponse({ httpStatus: 400, body: { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } } }).category, 'API_KEY_INVALID');
    assert.equal(classifyGeminiResponse({ httpStatus: 403, body: { error: { status: 'PERMISSION_DENIED', message: 'Generative Language API has not been used in project' } } }).category, 'PERMISSION_DENIED');
    assert.equal(classifyGeminiResponse({ httpStatus: 404, body: { error: { status: 'NOT_FOUND', message: 'models/x is not found' } } }).category, 'MODEL_NOT_FOUND');
    assert.equal(classifyGeminiResponse({ httpStatus: 503, body: null }).category, 'PROVIDER_UNAVAILABLE');
    assert.equal(classifyGeminiResponse({ networkError: true }).category, 'NETWORK_ERROR');
    assert.equal(classifyGeminiResponse({ httpStatus: 200, body: {} }).category, 'OK');
  });
  it('預設只查模型資訊，--probe 才送生成請求；結果不含金鑰', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => { calls.push({ url, method: options.method || 'GET' }); return { status: url.includes(':generateContent') ? 429 : 200,
      json: async () => (url.includes(':generateContent') ? { error: { status: 'RESOURCE_EXHAUSTED', message: 'exceeded its monthly spending cap' } } : { name: 'models/m' }) }; };
    const lookOnly = await diagnose({ apiKey: 'secret-key-value', model: 'm', probe: false, fetchImpl });
    assert.equal(calls.length, 1); assert.equal(lookOnly.model.category, 'OK'); assert.equal(lookOnly.generate, undefined);
    const probed = await diagnose({ apiKey: 'secret-key-value', model: 'm', probe: true, fetchImpl });
    assert.equal(probed.generate.category, 'SPEND_CAP_REACHED');
    assert.doesNotMatch(JSON.stringify(probed), /secret-key-value/);
  });
  it('沒有金鑰時不發出請求', async () => {
    let called = false;
    const result = await diagnose({ apiKey: '', model: 'm', probe: true, fetchImpl: async () => { called = true; } });
    assert.equal(result.model.category, 'KEY_MISSING'); assert.equal(called, false);
  });
  it('參數只接受環境變數名稱與單純模型 ID', () => {
    assert.throws(() => parseArgs(['--key-env', 'bad-name']));
    assert.throws(() => parseArgs(['--model', 'x/../y']));
    assert.equal(parseArgs(['--probe']).probe, true);
  });
});
