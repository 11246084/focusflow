const { test } = require('node:test');
const assert = require('node:assert/strict');
const { retrieveForQa, retrievalSettings, faqEvidenceVersion } = require('../src/services/multimodalQaBridge.service');
const { buildComparisonRecords } = require('../src/services/multimodalOfflineEvaluation.service');
const scope = { courseId: 'course', allowedVideoIds: ['video'] };
const chunk = { ...scope, courseId: 'course', videoId: 'video', chunkId: 'chunk',
  startSec: 10, endSec: 12, text: '教師逐字稿' };
const base = { scope, settings: { enabled: true }, textSearch: async () => [],
  loadEvidence: async () => [chunk] };

test('media finds transcript evidence with original times and provenance', async () => {
  const result = await retrieveForQa({ ...base, searchers: { audio: async () => [{ ...chunk, text: 'untrusted' }] } });
  assert.equal(result.matches[0].transcript, chunk.text);
  assert.deepEqual(result.citations[0], { chunkId: 'chunk', videoId: 'video', startSec: 10,
    endSec: 12, retrievedBy: ['audio'], channelRanks: { audio: 1 } });
  assert.equal(result.supplementalVisualEnabled, false);
});

test('disabled, empty, failed and missing-index retrieval fall back to scoped text', async () => {
  for (const variant of ['disabled', 'empty', 'failed', 'index']) {
    let calls = 0;
    const result = await retrieveForQa({ ...base,
      settings: { enabled: variant !== 'disabled' },
      textSearch: async () => (++calls === 1 && !['disabled', 'index'].includes(variant) ? [] : [chunk]),
      searchers: { audio: async () => { throw new Error('offline'); } },
      ...(variant === 'index' ? { atlas: { indexSnapshot: null }, queryEmbedding: {} } : {}),
    });
    assert.equal(result.usedFallback, true);
    assert.equal(result.matches[0].chunkId, chunk.chunkId);
    assert.deepEqual(result.matches[0].retrievedBy, ['text']);
  }
});

test('cross-course, unauthorized video and shifted evidence never become answers', async () => {
  for (const bad of [{ courseId: 'other' }, { videoId: 'other' }, { startSec: 9 }]) {
    const result = await retrieveForQa({ ...base, searchers: { visual: async () => [{ ...chunk, ...bad }] } });
    assert.equal(result.matches.length, 0);
  }
  const result = await retrieveForQa({ ...base, textSearch: async () => [{ ...chunk, videoId: 'other' }] });
  assert.equal(result.matches.length, 0);
});

test('hierarchy replaces only text, partial channel failures preserve other results', async () => {
  let flatCalls = 0;
  const result = await retrieveForQa({ ...base, settings: { enabled: true, hierarchy: true },
    textSearch: async () => { flatCalls++; return []; }, hierarchicalTextSearch: async () => [chunk],
    searchers: { audio: async () => [chunk], visual: async () => { throw new Error('failed'); } } });
  assert.equal(flatCalls, 0);
  assert.deepEqual(result.matches[0].retrievedBy, ['text', 'audio']);
  assert.equal(result.diagnostics.visual.status, 'failed');
});

test('cache settings are deterministic and separate enabled, hierarchy and weights', () => {
  assert.equal(retrievalSettings().enabled, false);
  const versions = [{}, { enabled: true }, { hierarchy: true }, { mode: 'text_weighted' }]
    .map(config => faqEvidenceVersion('base', config));
  assert.equal(new Set(versions).size, 4);
  assert.equal(versions[0], faqEvidenceVersion('base', { enabled: false }));
});

test('all channels fail before a successful legacy text retry', async () => {
  let attempts = 0;
  const fail = async () => { throw new Error('unavailable'); };
  const result = await retrieveForQa({ ...base, textSearch: async () => {
    if (++attempts === 1) throw new Error('unavailable');
    return [chunk];
  }, searchers: { audio: fail, visual: fail } });
  assert.equal(result.usedFallback, true);
  assert.equal(result.matches[0].transcript, chunk.text);
  assert.ok(Object.values(result.diagnostics).every(channel => channel.status === 'failed'));
});

test('missing transcript and restricted chunk allowlist reject visual evidence', async () => {
  for (const extra of [{ loadEvidence: async () => [] },
    { scope: { ...scope, allowedChunkIds: ['other'] } }]) {
    const result = await retrieveForQa({ ...base, ...extra,
      searchers: { visual: async () => [chunk] } });
    assert.equal(result.matches.length, 0);
  }
});

// 以下四項是整合審查補的回歸測試：穩定版文字向量不在索引裡、或只覆蓋部分 chunk 時的行為。
function atlasFixture(rowsByPath) {
  const { buildGeminiTextSearchContract } = require('../src/services/embeddingContract.service');
  const contract = buildGeminiTextSearchContract();
  const meta = channel => (channel === 'text' ? contract : { provider: 'gemini', dimension: 3072, status: 'success',
    model: 'gemini-embedding-2', contractVersion: `gemini_embedding_2_${channel}_v1` });
  const channelOf = { stableTextEmbedding: 'text', audioEmbedding: 'audio', visualEmbedding: 'visual' };
  const indexSnapshot = { name: 'text_embedding_index', type: 'vectorSearch', status: 'READY', queryable: true,
    latestDefinition: { fields: Object.keys(rowsByPath).map(path => ({ path, type: 'vector', numDimensions: 3072,
      similarity: 'cosine' })).concat([{ path: 'videoId', type: 'filter' }]) } };
  const collection = { aggregate: pipeline => ({ toArray: async () => {
    const path = pipeline[0].$vectorSearch.path;
    return (rowsByPath[path] || []).map((row, index) => ({ ...row, score: 0.9 - index / 100,
      mediaEmbeddingMeta: { [channelOf[path]]: meta(channelOf[path]) } }));
  } }) };
  return { atlas: { collection, indexSnapshot, textPath: 'stableTextEmbedding', textDataContract: contract },
    queryEmbedding: { ...contract, provider: 'gemini', modality: 'query', status: 'success',
      embedding: [1, ...Array(3071).fill(0)] } };
}
const chunkOf = (id, startSec) => ({ ...chunk, chunkId: id, startSec, endSec: startSec + 2, text: `逐字稿 ${id}` });

test('索引沒有穩定版文字欄位時，文字那一路改用既有文字檢索，不會只剩聲音與畫面', async () => {
  const a = chunkOf('a', 10); const b = chunkOf('b', 20);
  const result = await retrieveForQa({ ...base, ...atlasFixture({ audioEmbedding: [a], visualEmbedding: [] }),
    textSearch: async () => [b, a], loadEvidence: async () => [a, b], minTextCandidates: 2 });
  assert.equal(result.usedFallback, false);
  assert.equal(result.diagnostics.textSource, 'scoped_text_search');
  assert.deepEqual(result.matches.map(match => match.chunkId).sort(), ['a', 'b']);
  assert.deepEqual(result.matches.find(match => match.chunkId === 'a').retrievedBy, ['text', 'audio']);
  assert.deepEqual(result.matches.find(match => match.chunkId === 'b').retrievedBy, ['text']);
});

test('穩定版文字向量只覆蓋部分 chunk 時不拿那一小部分當文字結果', async () => {
  const a = chunkOf('a', 10); const b = chunkOf('b', 20); const covered = chunkOf('covered', 30);
  const fixture = atlasFixture({ stableTextEmbedding: [covered], audioEmbedding: [a], visualEmbedding: [] });
  const result = await retrieveForQa({ ...base, ...fixture, textSearch: async () => [a, b],
    loadEvidence: async () => [a, b, covered], minTextCandidates: 20 });
  assert.equal(result.usedFallback, false);
  assert.equal(result.matches.some(match => match.chunkId === 'covered'), false);
  assert.deepEqual(result.matches.map(match => match.chunkId).sort(), ['a', 'b']);
});

test('穩定版文字只覆蓋部分且聲音畫面都沒有結果時，退回既有文字檢索', async () => {
  const a = chunkOf('a', 10); const covered = chunkOf('covered', 30);
  const fixture = atlasFixture({ stableTextEmbedding: [covered], audioEmbedding: [], visualEmbedding: [] });
  const result = await retrieveForQa({ ...base, ...fixture, textSearch: async () => [a],
    loadEvidence: async () => [a, covered], minTextCandidates: 20 });
  assert.equal(result.usedFallback, true);
  assert.deepEqual(result.matches.map(match => match.chunkId), ['a']);
  assert.deepEqual(result.matches[0].retrievedBy, ['text']);
});

test('資料庫裡的逐字稿前後有空白時，仍可和既有文字檢索的結果合併', async () => {
  const a = chunkOf('a', 10);
  const stored = { ...a, text: `  ${a.text}\n` };
  const result = await retrieveForQa({ ...base, ...atlasFixture({ audioEmbedding: [stored], visualEmbedding: [] }),
    textSearch: async () => [a], loadEvidence: async () => [a], minTextCandidates: 1 });
  assert.equal(result.usedFallback, false);
  assert.deepEqual(result.matches[0].retrievedBy, ['text', 'audio']);
  assert.equal(result.matches[0].transcript, a.text);
});

test('穩定版文字向量覆蓋足夠時照常使用，不另外呼叫既有文字檢索', async () => {
  const a = chunkOf('a', 10); const b = chunkOf('b', 20);
  let textCalls = 0;
  const fixture = atlasFixture({ stableTextEmbedding: [b, a], audioEmbedding: [a], visualEmbedding: [] });
  const result = await retrieveForQa({ ...base, ...fixture, textSearch: async () => { textCalls++; return []; },
    loadEvidence: async () => [a, b], minTextCandidates: 2 });
  assert.equal(textCalls, 0);
  assert.equal(result.usedFallback, false);
  assert.equal(result.diagnostics.textSource, undefined);
  assert.deepEqual(result.matches.find(match => match.chunkId === 'a').retrievedBy, ['text', 'audio']);
});

test('offline export covers six groups, two hierarchies and two weights with shared media', () => {
  const records = buildComparisonRecords({ questionId: 'q1', scope,
    flat: { text: [], audio: [chunk], visual: [] }, hierarchical: { text: [chunk] } });
  assert.equal(records.length, 24);
  const audio = records.filter(row => row.group === 'audio');
  assert.deepEqual(audio[0].ranked, audio[2].ranked);
  assert.equal(records.find(row => row.group === 'text' && row.mode === 'flat').ranked.length, 0);
});
