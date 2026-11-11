const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { parseBank } = require('../src/services/offlineRetrievalAudit.service');

// Shares parsing, but neither relevance decisions nor metric calculations with the scorer.
function verifyAudit({ bank, manifest, records, config, report }) {
  for (const [value, expected] of [[bank, report.bankHash], [manifest, report.manifestHash],
    [config, report.configHash], [records, report.rankingHash]]) {
    assert.equal(createHash('sha256').update(JSON.stringify(value)).digest('hex'), expected);
  }
  const questions = new Map(parseBank(bank).map(question => [question.id, question]));
  assert.equal(report.perQuery.length, records.length);
  const groups = new Map();
  records.forEach((record, index) => {
    const question = questions.get(record.questionId);
    assert.ok(question);
    const matches = record.ranked.map(candidate => {
      const ranges = question.targets.filter(range => range.videoId === candidate.videoId);
      const points = [...new Set([candidate.startSec, candidate.endSec,
        ...ranges.flatMap(range => [range.startSec, range.endSec])])]
        .filter(point => point >= candidate.startSec && point <= candidate.endSec).sort((a, b) => a - b);
      let seconds = 0;
      for (let i = 1; i < points.length; i++) {
        const middle = (points[i - 1] + points[i]) / 2;
        if (ranges.some(range => range.startSec <= middle && range.endSec >= middle)) seconds += points[i] - points[i - 1];
      }
      return seconds * 2 >= candidate.endSec - candidate.startSec;
    });
    const expected = report.perQuery[index];
    assert.equal(expected.questionId, record.questionId);
    assert.equal(expected.mode, record.mode);
    assert.equal(expected.group, record.group);
    assert.equal(expected.weighting, record.weighting);
    let reciprocal = 0;
    for (let i = matches.length - 1; i >= 0; i--) if (matches[i]) reciprocal = 1 / (i + 1);
    const hit = Number(matches.filter((value, i) => value && i < 5).length > 0);
    assert.equal(expected.recallAt5, question.refused ? null : hit);
    assert.equal(expected.mrr, question.refused ? null : reciprocal);
    const key = JSON.stringify([record.mode, record.group, record.weighting]);
    if (!groups.has(key)) groups.set(key, { hits: 0, reciprocal: 0, count: 0 });
    const group = groups.get(key);
    if (!question.refused) { group.count++; group.hits += hit; group.reciprocal += reciprocal; }
  });
  assert.equal(report.aggregates.length, groups.size);
  const seen = new Set();
  for (const aggregate of report.aggregates) {
    const key = JSON.stringify([aggregate.mode, aggregate.group, aggregate.weighting]);
    assert.ok(!seen.has(key));
    seen.add(key);
    const group = groups.get(key);
    assert.ok(group);
    assert.equal(aggregate.count, group.count);
    assert.ok(Math.abs(aggregate.recallAt5 - group.hits / group.count) < 1e-12);
    assert.ok(Math.abs(aggregate.mrr - group.reciprocal / group.count) < 1e-12);
  }
  return true;
}
module.exports = { verifyAudit };
