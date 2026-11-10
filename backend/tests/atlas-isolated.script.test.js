const { test } = require('node:test');
const assert = require('node:assert/strict');
const { IDS, COURSE_ID, vectorDigest, hash } = require('../scripts/atlas-multimodal/control');
const { TARGET, OWNER, DEFINITION, buildDocuments, validateTargetRows, permissions, restorePlan, rehearseRestore, search } = require('../scripts/atlas-multimodal/isolated');
const { buildGeminiTextSearchContract } = require('../src/services/embeddingContract.service');
const { ISOLATED_INDEX_NAME, buildAtlasPipeline } = require('../src/services/atlasMultimodalAdapter.service');
const vector = [1, ...Array(3071).fill(0)];
function bundle() {
  return { schemaVersion: 'atlas_sample_v1', executionMode: 'gemini', records: IDS.flatMap((chunkId, i) => ['query', 'text', 'audio', 'visual'].map(kind => {
    const identity = { courseId: COURSE_ID, videoId: chunkId.split('_chunk_')[0], chunkId, startSec: i * 10, endSec: i * 10 + 9 };
    return { kind, requestId: `${chunkId}:${kind}`, identity, text: kind === 'text' ? `sample${i}` : null,
      embedding: vector, vectorDigest: vectorDigest(vector), metadata: { ...buildGeminiTextSearchContract(), ...identity,
        status: 'success', modality: kind, signature: 'a'.repeat(64), sampleStartSec: identity.startSec,
        sampleEndSec: identity.endSec, mediaDurationSec: 9,
        contractVersion: ['text', 'query'].includes(kind) ? 'gemini_embedding_2_text_v2' : `gemini_embedding_2_${kind}_v1` } };
  })) };
}
function database(docs, { failChannel = false, leakScope = false } = {}) {
  const calls = [];
  const db = { collection: name => {
    assert.equal(name, TARGET);
    return { find: () => ({ limit: () => ({ toArray: async () => docs }) }), aggregate: pipeline => {
      if (pipeline[0].$listSearchIndexes) return { toArray: async () => [{ name: ISOLATED_INDEX_NAME, type: 'vectorSearch', status: 'READY', queryable: true, latestDefinition: DEFINITION }] };
      const q = pipeline[0].$vectorSearch; calls.push(q);
      return { toArray: async () => {
        if (failChannel && q.path === 'audioEmbedding') throw new Error('SECRET');
        const negative = q.filter.courseId === 'unauthorized-course' || q.filter.videoId.$in.includes('unauthorized-video');
        return negative && !leakScope ? [] : docs.map(d => ({ ...d, score: 1 }));
      } };
    } };
  } };
  return { db, calls };
}
test('isolated payload contains exactly three owned documents, nine vectors and no legacy vector', () => {
  const docs = buildDocuments(bundle());
  assert.equal(docs.length, 3); assert.ok(docs.every(d => d.validationOwner === OWNER && !Object.hasOwn(d, 'embedding')));
  assert.deepEqual(DEFINITION.fields.map(f => f.path), ['stableTextEmbedding', 'audioEmbedding', 'visualEmbedding', 'courseId', 'videoId']);
  validateTargetRows(docs, structuredClone(docs));
  assert.throws(() => validateTargetRows([...docs, docs[0]], docs));
  const changed = structuredClone(docs); changed[0].text = 'concurrent';
  assert.throws(() => validateTargetRows(changed, docs));
});
test('restoration is owned, allowlisted and refuses unexpected or preexisting data', () => {
  const docs = buildDocuments(bundle());
  const p = restorePlan({ existed: false }, docs, docs);
  assert.deepEqual(rehearseRestore({ existed: false }, docs).after, { existed: false, documents: [], index: null });
  assert.equal(p.documentDeletes.length, 3);
  const remaining = docs.filter(d => !p.documentDeletes.some(x => x._id === d._id && x.expectedHash === hash(d)));
  assert.deepEqual(remaining, []);
  assert.throws(() => restorePlan({ existed: true }, docs, docs));
  assert.throws(() => restorePlan({ existed: false }, [...docs, { _id: 'unexpected' }], docs));
  const forged = structuredClone(docs); forged[0].validationOwner = 'other';
  assert.throws(() => restorePlan({ existed: false }, forged, forged), /Ownership/);
});
test('privilege summary honors database and collection scope without exposing identities', () => {
  assert.equal(permissions([{ resource: { db: 'other', collection: '' }, actions: ['insert'] }]).insert, false);
  assert.equal(permissions([{ resource: { db: 'focusflow', collection: TARGET }, actions: ['insert', 'createSearchIndexes'] }]).createSearchIndexes, true);
  assert.ok(Object.values(permissions([{ resource: { anyResource: true }, actions: ['anyAction'] }])).every(Boolean));
});
test('partial insert cleanup plans only exact successfully written owned documents', () => {
  const docs = buildDocuments(bundle());
  for (const n of [0, 1, 2, 3]) {
    const current = docs.slice(0, n);
    assert.equal(restorePlan({ existed: false }, current, docs, { allowPartial: true }).documentDeletes.length, n);
  }
  const changed = structuredClone(docs.slice(0, 1)); changed[0].text = 'changed';
  assert.throws(() => restorePlan({ existed: false }, changed, docs, { allowPartial: true }), /conflict/);
});
test('isolated query uses the test index and both course/video prefilters; production defaults stay fixed', () => {
  const p = buildAtlasPipeline('text', vector, ['video'], 'stableTextEmbedding', ISOLATED_INDEX_NAME, COURSE_ID)[0].$vectorSearch;
  assert.equal(p.index, ISOLATED_INDEX_NAME); assert.equal(p.filter.courseId, COURSE_ID);
  assert.deepEqual(p.filter.videoId, { $in: ['video'] });
  assert.equal(buildAtlasPipeline('text', vector, ['video'])[0].$vectorSearch.index, 'text_embedding_index');
  assert.throws(() => buildAtlasPipeline('text', vector, ['video'], 'stableTextEmbedding', 'arbitrary-index'));
});
test('mock Atlas three-query search feeds actual RRF, local comparison and six negative scope probes', async () => {
  const b = bundle(), docs = buildDocuments(b), { db, calls } = database(docs);
  const result = await search(db, b, docs);
  assert.equal(calls.length, 15); assert.equal(result.queries.length, 3); assert.equal(result.probes.length, 6);
  assert.equal(result.queries[0].equal.candidates[0].fusionScore, 3 / 61);
  assert.equal(result.queries[0].textWeighted.candidates[0].fusionScore, 4 / 61);
  assert.ok(result.queries.every(q => Object.values(q.local.differences).flat().every(d => d.scoreDelta === 0)));
  assert.equal(JSON.stringify(result).includes('sample0'), false);
  assert.ok(result.queries[0].equal.candidates[0].retrievedBy.includes('audio'));
});
test('one failed channel or scope leakage stops validation instead of claiming success', async () => {
  const b = bundle(), docs = buildDocuments(b);
  await assert.rejects(search(database(docs, { failChannel: true }).db, b, docs), /three channels/);
  await assert.rejects(search(database(docs, { leakScope: true }).db, b, docs), /isolation/);
});
