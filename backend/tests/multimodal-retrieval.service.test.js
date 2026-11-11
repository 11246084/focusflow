const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { retrieveMultimodal } = require('../src/services/multimodalRetrieval.service');
const { createCase } = require('../scripts/multimodal-demo/cases');
const { fuseQueries } = require('../scripts/multimodal-demo/fuseValidationCandidates');

test('normal and rescue scenarios compute RRF with unchanged evidence times', async () => {
  for (const name of ['normal', 'rescue']) {
    const scenario = createCase(name);
    const result = await retrieveMultimodal(scenario);
    const expected = scenario.chunks[name === 'normal' ? 1 : 0];
    assert.equal(result.matches[0].chunkId, expected.chunkId);
    assert.equal(result.matches[0].startSec, expected.startSec);
    assert.equal(result.matches[0].endSec, expected.endSec);
    assert.equal(new Set(result.matches.map((item) => item.chunkId)).size, result.matches.length);
  }
});

test('failed, missing and empty channels produce explicit diagnostics and usable results', async () => {
  const result = await retrieveMultimodal(createCase('rescue', { fail: 'audio', missing: 'visual' }));
  assert.equal(result.diagnostics.audio.status, 'failed');
  assert.equal(result.diagnostics.visual.status, 'missing');
  assert.deepEqual(result.matches[0].retrievedBy, ['text']);
  assert.deepEqual((await retrieveMultimodal(createCase('empty'))).matches, []);
});

test('scope filtering precedes top 20 selection and fusion', async () => {
  const scenario = createCase('normal');
  const valid = scenario.chunks[0];
  scenario.searchers.text = async () => [
    ...Array.from({ length: 25 }, () => ({ ...valid, courseId: 'forbidden' })),
    { ...valid, videoId: 'forbidden' }, valid,
  ];
  const result = await retrieveMultimodal(scenario);
  assert.equal(result.lists.text.length, 1);
  assert.equal(result.matches.find((item) => item.chunkId === valid.chunkId).channelRanks.text, 1);
  await assert.rejects(retrieveMultimodal({ ...scenario, scope: {} }), /scope/);
  await assert.rejects(retrieveMultimodal({ ...scenario, mode: 'unknown' }), /mode/);
});

test('CLI runs failure scenario and writes a labelled, reproducible JSON report', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'focusflow-demo-'));
  try {
    const cli = path.resolve(__dirname, '../scripts/multimodal-demo/run.js');
    const args = [cli, '--case', 'rescue', '--no-media', '--fail', 'audio', '--output', directory];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const report = path.join(directory, 'result-rescue-equal-fail-audio.json');
    const before = fs.readFileSync(report, 'utf8');
    assert.equal(JSON.parse(before).labels.retrieval, 'mock candidates');
    assert.equal(JSON.parse(before).diagnostics.audio.status, 'failed');
    assert.equal(spawnSync(process.execPath, args).status, 0);
    assert.equal(fs.readFileSync(report, 'utf8'), before);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('small-sample bridge uses the same RRF for equal and text-weighted rankings', () => {
  const scenario = createCase('normal');
  const first = scenario.chunks[0];
  const second = scenario.chunks[1];
  const result = fuseQueries([{ queryId: 'query', lists: { text: [first, second], audio: [second], visual: [second] } }]);
  assert.equal(result[0].equal[0].chunkId, second.chunkId);
  assert.ok(Math.abs(result[0].equal[0].fusionScore - (1 / 62 + 2 / 61)) < 1e-15);
  assert.ok(Math.abs(result[0].textWeighted[0].fusionScore - (2 / 62 + 2 / 61)) < 1e-15);
  assert.throws(() => fuseQueries([{}, {}, {}, {}]), /three/);
});
