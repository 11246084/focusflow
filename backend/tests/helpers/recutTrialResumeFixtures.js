'use strict';
const crypto = require('node:crypto');
const { fixture } = require('./recutPipelineFixtures');
const { validateSelection } = require('../../src/services/recutSelectionValidation.service');
const { canonicalSha256 } = require('../../src/services/recutTrialResume.service');
const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
const uri = 'mongodb://127.0.0.1:27029/recut_trial_professor-siri-20261103';
function resumeFixture({ sourcePath = '/synthetic/source.mp4', sourceBytes = 'synthetic source' } = {}) {
  const f = fixture(), input = { scriptId: 'a'.repeat(24), courseId: 'b'.repeat(24) };
  Object.assign(f.source, { _id: 'c'.repeat(24), scriptId: input.scriptId, videoId: 'd'.repeat(24), sourceSha256: sha(sourceBytes),
    transcriptVersion: 'synthetic-frozen', sourceCheck: { passed: true } });
  const policy = { modelId: 'gemini-3.8-flash', maxCalls: 5, maxRequestBytes: 100000, maxOutputTokens: 4096,
    budgetUsd: 0.5, inputPerMillion: 0.75, outputPerMillion: 3.75, validUntil: '2026-12-31' };
  const config = { geminiApiKeyEnv: 'GEMINI_API_KEY', model: { provider: 'gemini', model: policy.modelId },
    callLimit: 5, maxOutputTokens: 4096, thinkingLevel: 'LOW', trialPolicy: policy, codeCards: { enabled: false } };
  const scriptProjection = { _id: input.scriptId, recut: { revision: 0, state: 'idle', currentVersionId: null, currentAssetId: null, activeTaskId: null }, status: 'evidence_ready' };
  const script = { ...scriptProjection, courseId: input.courseId, topic: 'synthetic-only classroom question', sourceQuestions: [] };
  const budget = { _id: input.scriptId, modelId: policy.modelId, maxCalls: 5, budgetUsd: 0.5, status: 'reserved', createdAt: '2026-11-03T22:43:00.000Z' };
  const modelOutput = structuredClone(f.selection); delete modelOutput.lockedSentenceIds;
  const validation = validateSelection(f.source, modelOutput);
  let sum = 0;
  const attempts = [33572, 34750, 34868].map((requestBodyBytes, n) => {
    const reservation = (requestBodyBytes * 0.75 + 4096 * 3.75) / 1e6; sum += reservation;
    return { stepId: 'recut-selection-v1', stage: 'selection', consumesCall: true, status: n === 2 ? 'succeeded' : 'failed',
      input: { question: script.topic, variants: [] }, output: JSON.stringify(modelOutput), validation: n === 2 ? validation : { valid: false, errors: ['synthetic retry'] },
      trialRequest: { requestedModelId: policy.modelId, requestBodyBytes, trialModelCalls: n + 1,
        budgetReservationUsd: reservation, cumulativeBudgetReservationUsd: sum }, usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
  });
  attempts.push({ stepId: 'recut-cards-sentence-v1', stage: 'cards', consumesCall: true, status: 'failed',
    input: { sentences: f.source.sentences }, error: { code: 'RECUT_TRIAL_REQUEST_TOO_LARGE' } });
  const report = { status: 'failed', stage: 'cards', code: 'RECUT_TRIAL_REQUEST_TOO_LARGE', callsUsed: 4, attempts };
  const reportRaw = Buffer.from(JSON.stringify(report));
  const checkpoint = { algorithm: 'canonical-json-v1', runSha256: sha(reportRaw), sourceCanonicalSha256: canonicalSha256(f.source),
    source: f.source, script: scriptProjection, budget };
  const bootstrap = { input, source: { filePath: sourcePath }, sourceSnapshot: { sourceSha256: f.source.sourceSha256, transcriptVersion: f.source.transcriptVersion } };
  const artifacts = Object.fromEntries(Object.entries({ report, input, config, bootstrap, checkpoint }).map(([k, v]) => [k, Buffer.from(JSON.stringify(v))]));
  const reviewed = { ...Object.fromEntries(['report', 'input', 'config', 'bootstrap'].map((k) => [`${k}Sha256`, sha(artifacts[k])])),
    checkpointSha256: canonicalSha256(checkpoint), providerCalls: 3, workflowCallsUsed: 4, reservedUsd: sum };
  const rows = { shortscripts: [script], recutsources: [f.source], videos: [{ _id: f.source.videoId, filePath: sourcePath }],
    recuttrialbudgets: [{ ...budget, createdAt: new Date(budget.createdAt), scriptId: input.scriptId, courseId: input.courseId,
      maxRequestBytes: 100000, maxOutputTokens: 4096, refundable: false }], recuttrialruns: [] };
  let connections = 0;
  class ObjectId { constructor(value) { this.value = value || crypto.randomBytes(12).toString('hex'); } toString() { return this.value; } toHexString() { return this.value; } }
  const get = (row, key) => key.split('.').reduce((v, k) => v?.[k], row);
  const eq = (a, b) => a instanceof Date || b instanceof Date ? new Date(a).getTime() === new Date(b).getTime() : String(a) === String(b);
  const matches = (row, query) => Object.entries(query).every(([k, v]) => v && typeof v === 'object' && '$exists' in v ? (get(row, k) !== undefined) === v.$exists : eq(get(row, k), v));
  const state = { rows, beforeUpdate: null, connects: () => connections };
  class MongoClient {
    async connect() { connections++; } async close() {}
    db() { return { collection: (name) => ({
      findOne: async (query) => (rows[name] || []).find((row) => matches(row, query)) || null,
      updateOne: async (query, update) => {
        await state.beforeUpdate?.(name);
        const row = (rows[name] || []).find((r) => matches(r, query));
        if (!row) return { matchedCount: 0 };
        Object.assign(row, update.$set); return { matchedCount: 1 };
      },
      insertOne: async (row) => { (rows[name] ||= []).push(row); },
    }) }; }
  }
  return { ...f, input, config, artifacts, reviewed, state, driverLoader: () => ({ MongoClient, ObjectId }) };
}
module.exports = { resumeFixture, uri, sha };
