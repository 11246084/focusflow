const fs = require('node:fs');
const assert = require('node:assert/strict');
const { retrieveForQa } = require('../src/services/multimodalQaBridge.service');
const { buildGeminiTextSearchContract } = require('../src/services/embeddingContract.service');
const { buildComparisonRecords } = require('../src/services/multimodalOfflineEvaluation.service');

async function validate(bundle) {
  const { validateBundle } = require('./atlas-multimodal/control');
  validateBundle(bundle);
  const documents = bundle.records.filter(row => row.kind === 'text');
  const scope = { courseId: documents[0].identity.courseId,
    allowedVideoIds: [...new Set(documents.map(row => row.identity.videoId))] };
  const contract = buildGeminiTextSearchContract();
  const indexSnapshot = { name: 'text_embedding_index', type: 'vectorSearch', status: 'READY', queryable: true,
    latestDefinition: { fields: ['stableTextEmbedding', 'audioEmbedding', 'visualEmbedding']
      .map(path => ({ path, type: 'vector', numDimensions: 3072, similarity: 'cosine' }))
      .concat([{ path: 'videoId', type: 'filter' }]) } };
  const evidence = documents.map(row => ({ ...row.identity, text: row.text }));
  const reports = [];
  const comparison = [];
  for (const query of bundle.records.filter(row => row.kind === 'query')) {
    const lists = {};
    // Emulates only Atlas ranking. Uses saved real vectors and the real adapter / RRF / bridge.
    const collection = { aggregate(pipeline) {
      const channel = { stableTextEmbedding: 'text', audioEmbedding: 'audio', visualEmbedding: 'visual' }
        [pipeline[0].$vectorSearch.path];
      const rows = bundle.records.filter(row => row.kind === channel).map(row => ({
        ...row.identity, text: evidence.find(record => record.chunkId === row.identity.chunkId).text,
        score: row.embedding.reduce((sum, value, i) => sum + value * query.embedding[i], 0),
        mediaEmbeddingMeta: { [channel]: row.metadata },
      })).sort((a, b) => b.score - a.score);
      lists[channel] = rows;
      return { toArray: async () => rows };
    } };
    const result = await retrieveForQa({ scope, settings: { enabled: true },
      queryEmbedding: { ...query.metadata, embedding: query.embedding },
      atlas: { collection, indexSnapshot, textPath: 'stableTextEmbedding', textDataContract: contract },
      textSearch: async () => [], loadEvidence: async () => evidence });
    assert.equal(result.usedFallback, false);
    assert.equal(result.matches.length, 3);
    for (const match of result.matches) {
      const original = evidence.find(row => row.chunkId === match.chunkId);
      assert.equal(match.transcript, original.text);
      assert.equal(match.startSec, original.startSec);
      assert.equal(match.endSec, original.endSec);
      assert.deepEqual(match.retrievedBy, ['text', 'audio', 'visual']);
    }
    reports.push({ queryId: query.requestId, citations: result.citations });
    comparison.push(...buildComparisonRecords({ questionId: query.requestId, scope, flat: lists,
      hierarchical: { text: lists.text } }));
  }
  return { source: 'saved real Gemini vectors; simulated Atlas; unchanged text hierarchy fixture',
    apiCalls: 0, atlasCalls: 0, reports, comparison };
}

if (require.main === module) {
  validate(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')))
    .then(report => process.stdout.write(JSON.stringify(report, null, 2)))
    .catch(() => { console.error('Offline validation failed; private input redacted'); process.exitCode = 1; });
}
module.exports = { validate };
