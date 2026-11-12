const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fingerprint, parseBank, annotationReport, evaluationProtocol, auditRetrieval } = require('../src/services/offlineRetrievalAudit.service');
const { verifyAudit } = require('../scripts/verifyMultimodalAudit');
const { buildComparisonRecords, GROUPS } = require('../src/services/multimodalOfflineEvaluation.service');

// Deliberately synthetic gold and corpus. Scores below test arithmetic, never product quality.
function fixture() {
  const bank = { courseId: 'synthetic-course', videos: { V1: { videoId: 'video' } },
    questions: Array.from({ length: 43 }, (_, i) => ({ id: `q${i}`, shouldRefuse: false,
      expectedVideos: 'V1', expectedTimeRange: '10-20,15-25' })) };
  bank.questions.push({ id: 'refusal', shouldRefuse: true });
  const chunks = [{ courseId: bank.courseId, videoId: 'video', chunkId: 'hit', startSec: 10, endSec: 30 },
    { courseId: bank.courseId, videoId: 'video', chunkId: 'miss', startSec: 40, endSec: 50 }];
  const manifest = { provenance: 'synthetic', chunks };
  const scope = { courseId: bank.courseId, allowedVideoIds: ['video'] };
  const records = bank.questions.flatMap(question => buildComparisonRecords({ questionId: question.id, scope,
    flat: { text: [chunks[1], chunks[0]], audio: [], visual: [] }, hierarchical: { text: [chunks[0]] } }));
  const config = { bankHash: fingerprint(bank), manifestHash: fingerprint(manifest), k: 60,
    protocolHash: fingerprint(evaluationProtocol(bank)),
    perChannelLimit: 20, questionCount: bank.questions.length, groups: Object.keys(GROUPS),
    modes: ['flat', 'hierarchical'], weights: ['equal', 'text_weighted'],
    provenance: 'synthetic', formalEvaluation: false };
  return { bank, manifest, records, config };
}

test('real bank has 43 answerable, 7 refusal questions and fails closed on X01 missing V5 gold', () => {
  const bank = require('../../docs/04_Features/QA_Evaluation/datasets/question-bank.json');
  const parsed = parseBank(bank, { allowIncompleteGold: true });
  assert.equal(parsed.length, 50);
  assert.equal(parsed.filter(question => question.refused).length, 7);
  assert.deepEqual(parsed.find(question => question.id === 'X01').missingVideos, ['V5']);
  assert.throws(() => parseBank(bank), /X01.*V5/);
  const protocol = evaluationProtocol(bank);
  assert.equal(protocol.scoredQuestionIds.length, 43);
  assert.equal(protocol.diagnosticQuestionIds.length, 7);
  assert.equal(protocol.primaryCells.length, 4);
  assert.equal(protocol.primaryCells.length * protocol.weights.length, 8);
  assert.equal(annotationReport(bank).issues[0].approvedCorrection, null);
  const issueFile = require('../../docs/04_Features/QA_Evaluation/datasets/annotation-issues.json');
  assert.equal(issueFile.bankHash, fingerprint(bank));
  assert.equal(issueFile.goldVersion, protocol.goldVersion);
  assert.deepEqual(issueFile.issues, annotationReport(bank).issues);
  const protocolFile = require('../../docs/04_Features/QA_Evaluation/datasets/retrieval-protocol.json');
  const provisional = evaluationProtocol(bank, { pendingX01: true });
  assert.deepEqual(protocolFile.protocol, provisional);
  assert.equal(protocolFile.protocolHash, fingerprint(provisional));
});

test('independent interval sweep agrees on overlaps, multiple gold, empty ranks and all 24 groups', () => {
  const data = fixture();
  const report = auditRetrieval(data);
  assert.equal(verifyAudit({ ...data, report }), true);
  assert.equal(report.aggregates.find(row => row.mode === 'flat' && row.group === 'text').mrr, 0.5);
  assert.equal(report.aggregates.find(row => row.group === 'audio').mrr, 0);
  assert.equal(report.aggregates[0].count, 43);
  const tampered = structuredClone(report);
  tampered.perQuery[0].mrr = 0.123;
  assert.throws(() => verifyAudit({ ...data, report: tampered }));
  const badAggregate = structuredClone(report);
  badAggregate.aggregates[0].count = 44;
  assert.throws(() => verifyAudit({ ...data, report: badAggregate }));
});

test('refuses incomplete, cross-scope, changed, duplicate or mislabeled evidence', () => {
  const mutations = [
    data => { data.records.pop(); },
    data => { data.records[0].ranked[0].videoId = 'other'; },
    data => { data.records[0].ranked[0].startSec++; },
    data => { data.records[0].ranked.push({ ...data.records[0].ranked[0], rank: 3 }); },
    data => { data.manifest.chunks[0].endSec++; },
    data => { data.config.groups.pop(); },
    data => { data.config.formalEvaluation = true; },
    data => { data.bank.questions[0].expectedTimeRange = 'unknown'; },
    data => { data.records[0].ranked[0].rank = 2; },
    data => { delete data.records[0].ranked[0].chunkId; },
    data => { data.manifest.chunks[0].courseId = 'other'; },
  ];
  for (const mutate of mutations) {
    const data = fixture();
    mutate(data);
    assert.throws(() => auditRetrieval(data));
  }
  const missing = fixture();
  missing.manifest.chunks = [missing.manifest.chunks[1]];
  missing.config.manifestHash = fingerprint(missing.manifest);
  assert.throws(() => auditRetrieval(missing), /Missing gold/);
});

test('CLI audits persisted files and independently verifies without a provider or database', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const { run } = require('../scripts/auditMultimodalOffline');
  const data = fixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-audit-'));
  try {
    const files = ['bank', 'manifest', 'records', 'config'].map(key => {
      const file = path.join(directory, `${key}.json`);
      fs.writeFileSync(file, JSON.stringify(data[key]));
      return file;
    });
    assert.equal(run(files).independentVerification, 'passed');
    assert.equal(run(files.slice(0, 2)).status, 'BLOCKED');
    fs.writeFileSync(files[3], '{}');
    assert.throws(() => run(files), /hash changed/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('overlapping gold is a union, disjoint gaps do not become relevant and equal scores have stable ranks', () => {
  const data = fixture();
  for (const question of data.bank.questions.filter(question => !question.shouldRefuse)) question.expectedTimeRange = '10-12,18-20';
  data.manifest.chunks.push({ ...data.manifest.chunks[0], chunkId: 'short-gold', endSec: 12 });
  data.config.bankHash = fingerprint(data.bank);
  data.config.protocolHash = fingerprint(evaluationProtocol(data.bank));
  data.config.manifestHash = fingerprint(data.manifest);
  const report = auditRetrieval(data);
  assert.equal(report.aggregates[0].recallAt5, 0);
  assert.equal(verifyAudit({ ...data, report }), true);
  const scope = { courseId: data.bank.courseId, allowedVideoIds: ['video'] };
  const candidates = data.manifest.chunks.map(row => ({ ...row, score: 1 }));
  const first = buildComparisonRecords({ questionId: 'ties', scope,
    flat: { text: candidates, audio: [...candidates].reverse(), visual: [] }, hierarchical: { text: candidates } });
  const second = buildComparisonRecords({ questionId: 'ties', scope,
    flat: { text: candidates, audio: [...candidates].reverse(), visual: [] }, hierarchical: { text: candidates } });
  assert.deepEqual(first, second);
  assert.deepEqual(first.find(row => row.mode === 'flat' && row.group === 'text_audio'
    && row.weighting === 'equal').ranked.map(row => row.chunkId), ['hit', 'short-gold', 'miss']);
});

test('approved provisional policy scores exactly42, preserves X01 rows and hashes; no other missing gold is silently omitted', () => {
  const data = fixture();
  data.bank.videos.V5 = { videoId: 'other-video' };
  data.bank.questions[0] = { ...data.bank.questions[0], id: 'X01', expectedVideos: 'V1+V5', expectedTimeRange: 'V1 10-25' };
  for (const record of data.records) if (record.questionId === 'q0') record.questionId = 'X01';
  data.config.pendingX01 = true;
  data.config.bankHash = fingerprint(data.bank);
  data.config.protocolHash = fingerprint(evaluationProtocol(data.bank, { pendingX01: true }));
  const report = auditRetrieval(data);
  assert.equal(report.scoringCount, 42); assert.deepEqual(report.pendingQuestionIds, ['X01']);
  assert.equal(report.perQuery.filter(r => r.questionId === 'X01').length, 24);
  assert.ok(report.perQuery.filter(r => r.questionId === 'X01').every(r => r.mrr === null));
  assert.ok(report.aggregates.every(r => r.count === 42)); assert.equal(verifyAudit({ ...data, report }), true);
  data.config.pendingX01 = false; assert.throws(() => auditRetrieval(data), /Incomplete/);
  data.bank.questions[1].expectedVideos = 'V1+V5'; data.bank.questions[1].expectedTimeRange = 'V1 10-25';
  assert.throws(() => evaluationProtocol(data.bank, { pendingX01: true }), /Only unresolved X01/);
});

test('a first relevant result at rank six misses Recall@5 but contributes MRR', () => {
  const data = fixture();
  const misses = Array.from({ length: 5 }, (_, index) => ({ ...data.manifest.chunks[1], chunkId: `miss-${index}` }));
  data.manifest.chunks.push(...misses);
  data.config.manifestHash = fingerprint(data.manifest);
  for (const record of data.records.filter(row => row.group === 'text' && row.mode === 'flat')) {
    record.ranked = [...misses, data.manifest.chunks[0]].map((row, index) => ({ ...row, rank: index + 1 }));
  }
  const report = auditRetrieval(data);
  const group = report.aggregates.find(row => row.mode === 'flat' && row.group === 'text');
  assert.equal(group.recallAt5, 0);
  assert.equal(group.recallAt10, 1);
  assert.ok(Math.abs(group.mrr - 1 / 6) < 1e-12);
  assert.equal(verifyAudit({ ...data, report }), true);
});
