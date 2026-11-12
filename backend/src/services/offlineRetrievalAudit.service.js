const { createHash } = require('node:crypto');
const { GROUPS } = require('./multimodalOfflineEvaluation.service');
const { normalizeCandidate } = require('./rankFusion.service');

const MODES = ['flat', 'hierarchical'];
const WEIGHTS = ['equal', 'text_weighted'];
function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function parseBank(bank, { allowIncompleteGold = false } = {}) {
  requireCondition(bank?.courseId && bank.videos && Array.isArray(bank.questions), 'Invalid question bank');
  const seen = new Set();
  const questions = bank.questions.map(question => {
    requireCondition(question.id && !seen.has(question.id) && typeof question.shouldRefuse === 'boolean', 'Invalid question identity');
    seen.add(question.id);
    if (question.shouldRefuse) return { id: question.id, refused: true, targets: [] };
    const videos = String(question.expectedVideos).split('+').map(value => value.trim());
    requireCondition(videos.length && videos.every(key => bank.videos[key]?.videoId), 'Unknown gold video');
    const targets = [];
    for (const section of String(question.expectedTimeRange).split('/')) {
      const match = section.trim().match(/^(?:(V\d+)\s+)?(\d+(?:\.\d+)?-\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?-\d+(?:\.\d+)?)*)$/);
      requireCondition(match && (match[1] || videos.length === 1), 'Ambiguous gold time range');
      const video = match[1] || videos[0];
      requireCondition(videos.includes(video), 'Gold video/time mismatch');
      for (const range of match[2].split(',')) {
        const [startSec, endSec] = range.split('-').map(Number);
        requireCondition(endSec > startSec, 'Invalid gold interval');
        targets.push({ videoId: bank.videos[video].videoId, startSec, endSec });
      }
    }
    const missingVideos = videos.filter(video => !targets.some(target => target.videoId === bank.videos[video].videoId));
    requireCondition(allowIncompleteGold || !missingVideos.length, `Incomplete gold videos: ${question.id} (${missingVideos.join(',')})`);
    return { id: question.id, refused: false, targets, missingVideos };
  });
  requireCondition(questions.filter(question => !question.refused).length === 43, 'Expected 43 answerable questions');
  return questions;
}

function relevant(chunk, targets) {
  // Union intervals so two overlapping annotations never count the same second twice.
  const intervals = targets.filter(target => target.videoId === chunk.videoId)
    .map(target => [Math.max(chunk.startSec, target.startSec), Math.min(chunk.endSec, target.endSec)])
    .filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  let overlap = 0;
  let end = -Infinity;
  for (const [start, nextEnd] of intervals) {
    overlap += Math.max(0, nextEnd - Math.max(start, end));
    end = Math.max(end, nextEnd);
  }
  return overlap >= (chunk.endSec - chunk.startSec) / 2;
}

function annotationReport(bank) {
  const questions = parseBank(bank, { allowIncompleteGold: true });
  return { schemaVersion: 'annotation-issues-v1', bankHash: fingerprint(bank), goldVersion: `bank-sha256:${fingerprint(bank)}`,
    issues: questions.filter(question => question.missingVideos?.length).map(question => ({
      questionId: question.id, status: 'needs-human-confirmation', missingTimeVideos: question.missingVideos,
      original: { expectedVideos: bank.questions.find(row => row.id === question.id).expectedVideos,
        expectedTimeRange: bank.questions.find(row => row.id === question.id).expectedTimeRange },
      approvedCorrection: null,
    })) };
}

function evaluationProtocol(bank, { pendingX01 = false } = {}) {
  const questions = parseBank(bank, { allowIncompleteGold: true });
  if (pendingX01) requireCondition(questions.some(q => q.id === 'X01' && JSON.stringify(q.missingVideos) === '["V5"]')
    && questions.every(q => !q.missingVideos?.length || q.id === 'X01'), 'Only unresolved X01 may be excluded');
  const scored = questions.filter(question => !question.refused && !(pendingX01 && question.id === 'X01'));
  return { version: pendingX01 ? 'focusflow-retrieval-pending-X01-v1' : 'focusflow-retrieval-v1', bankHash: fingerprint(bank),
    goldVersion: `bank-sha256:${fingerprint(bank)}`,
    scoredQuestionIds: scored.map(question => question.id),
    ...(pendingX01 ? { pendingQuestionIds: ['X01'], scoringCount: 42 } : {}),
    diagnosticQuestionIds: questions.filter(question => question.refused).map(question => question.id),
    recallAt5: `question hit in first 5 / all ${scored.length} answerable questions`,
    recallAt10: `secondary question hit in first 10 over the same ${scored.length} questions`,
    mrr: `mean first reciprocal rank in saved top 20 over the same ${scored.length} questions`,
    refusalPolicy: 'excluded from retrieval averages; top score diagnostics only',
    primaryCells: MODES.flatMap(mode => ['text', 'all'].map(group => ({ mode, group }))),
    weights: WEIGHTS, diagnosticGroups: Object.keys(GROUPS),
    k: 60, perChannelLimit: 20 };
}

function inspectInputs(bank, manifest, { pendingX01 = false } = {}) {
  if (pendingX01) evaluationProtocol(bank, { pendingX01 });
  const questions = parseBank(bank, { allowIncompleteGold: pendingX01 });
  requireCondition(Array.isArray(manifest?.chunks) && manifest.provenance, 'Chunk manifest with provenance required');
  const videos = new Set(Object.values(bank.videos).map(video => video.videoId));
  const chunks = new Map();
  for (const row of manifest.chunks) {
    const chunk = normalizeCandidate(row);
    requireCondition(chunk.courseId === bank.courseId && videos.has(chunk.videoId), 'Cross-course manifest chunk');
    requireCondition(!chunks.has(chunk.chunkId), 'Duplicate manifest chunk');
    chunks.set(chunk.chunkId, chunk);
  }
  const gold = new Map(questions.filter(question => !question.refused && !(pendingX01 && question.id === 'X01')).map(question => [question.id,
    new Set([...chunks.values()].filter(chunk => relevant(chunk, question.targets)).map(chunk => chunk.chunkId))]));
  const missingGold = [...gold].filter(([, ids]) => !ids.size).map(([id]) => id);
  return { questions, chunks, gold, missingGold };
}

function auditRetrieval({ bank, manifest, records, config }) {
  const pendingX01 = config?.pendingX01 === true;
  const inputs = inspectInputs(bank, manifest, { pendingX01 });
  requireCondition(config?.bankHash === fingerprint(bank) && config.manifestHash === fingerprint(manifest), 'Manifest or bank hash changed');
  requireCondition(config.protocolHash === fingerprint(evaluationProtocol(bank, { pendingX01 })), 'Evaluation protocol hash changed');
  requireCondition(config.k === 60 && config.perChannelLimit === 20 && config.questionCount === inputs.questions.length, 'Evaluation parameters changed');
  requireCondition(JSON.stringify(config.modes) === JSON.stringify(MODES)
    && JSON.stringify(config.weights) === JSON.stringify(WEIGHTS)
    && JSON.stringify(config.groups) === JSON.stringify(Object.keys(GROUPS)), 'Evaluation groups changed');
  requireCondition(['synthetic', 'saved-gemini-fake-atlas', 'atlas'].includes(config.provenance)
    && typeof config.formalEvaluation === 'boolean', 'Explicit evaluation provenance required');
  requireCondition(config.formalEvaluation === false, 'Offline audit cannot authorize a formal quality report');
  requireCondition(!inputs.missingGold.length, `Missing gold chunk coverage: ${inputs.missingGold.join(',')}`);
  requireCondition(Array.isArray(records), 'Ranking records required');
  const questionById = new Map(inputs.questions.map(question => [question.id, question]));
  const seen = new Set();
  const perQuery = records.map(record => {
    const question = questionById.get(record.questionId);
    const key = JSON.stringify([record.questionId, record.mode, record.group, record.weighting]);
    requireCondition(question && MODES.includes(record.mode) && Object.hasOwn(GROUPS, record.group)
      && WEIGHTS.includes(record.weighting) && !seen.has(key), 'Unknown or duplicate ranking group');
    seen.add(key);
    requireCondition(Array.isArray(record.ranked) && record.ranked.length <= 20, 'Invalid ranking size');
    const ids = new Set();
    const hits = record.ranked.map((candidate, index) => {
      const chunk = inputs.chunks.get(candidate.chunkId);
      requireCondition(chunk && candidate.rank === index + 1 && !ids.has(candidate.chunkId), 'Invalid rank or duplicate chunk');
      requireCondition(candidate.videoId === chunk.videoId && candidate.startSec === chunk.startSec
        && candidate.endSec === chunk.endSec && (!candidate.courseId || candidate.courseId === bank.courseId), 'Ranking scope or timestamp mismatch');
      ids.add(candidate.chunkId);
      return inputs.gold.get(question.id)?.has(candidate.chunkId) || false;
    });
    const first = hits.indexOf(true);
    const scored = !question.refused && !(pendingX01 && question.id === 'X01');
    return { questionId: record.questionId, mode: record.mode, group: record.group, weighting: record.weighting,
      ...(pendingX01 && question.id === 'X01' ? { goldStatus: 'pending_human_approval' } : {}),
      recallAt5: scored ? Number(hits.slice(0, 5).some(Boolean)) : null,
      recallAt10: scored ? Number(hits.slice(0, 10).some(Boolean)) : null,
      mrr: scored ? first < 0 ? 0 : 1 / (first + 1) : null,
      refusalTopScore: question.refused ? record.ranked[0]?.score ?? null : null };
  });
  requireCondition(seen.size === inputs.questions.length * 24, 'Missing comparison groups or questions');
  const aggregates = [];
  for (const mode of MODES) for (const group of Object.keys(GROUPS)) for (const weighting of WEIGHTS) {
    const rows = perQuery.filter(row => row.mode === mode && row.group === group && row.weighting === weighting && row.recallAt5 !== null);
    aggregates.push({ mode, group, weighting, count: rows.length,
      recallAt5: rows.reduce((sum, row) => sum + row.recallAt5, 0) / rows.length,
      recallAt10: rows.reduce((sum, row) => sum + row.recallAt10, 0) / rows.length,
      mrr: rows.reduce((sum, row) => sum + row.mrr, 0) / rows.length });
  }
  return { status: 'AUDITED', provenance: config.provenance, formalEvaluation: false, qualityClaim: false,
    scoringCount: inputs.gold.size, pendingQuestionIds: pendingX01 ? ['X01'] : [],
    metricDefinition: 'question hit within top 5; first reciprocal rank within saved top 20; refusal questions excluded',
    bankHash: config.bankHash, manifestHash: config.manifestHash,
    configHash: fingerprint(config), rankingHash: fingerprint(records), protocolHash: config.protocolHash,
    missingRefusalScores: perQuery.filter(row => inputs.questions.find(q => q.id === row.questionId)?.refused && row.refusalTopScore === null).length,
    perQuery, aggregates };
}

module.exports = { fingerprint, parseBank, annotationReport, evaluationProtocol, inspectInputs, auditRetrieval, MODES, WEIGHTS };
