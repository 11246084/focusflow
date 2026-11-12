const c = require('../../scripts/atlas-multimodal/control');
const s = require('../../scripts/atlas-multimodal/video1-scope');
const { buildGeminiTextSearchContract } = require('../../src/services/embeddingContract.service');
function fixture() {
  const vector = [1, ...Array(3071).fill(0)], contract = buildGeminiTextSearchContract();
  const chunks = s.IDS.map((chunkId, i) => ({ courseId: s.COURSE_ID, videoId: s.VIDEO_ID, chunkId,
    startSec: i * 10, endSec: i * 10 + 8, text: 'Synthetic contract fixture: authentication course evidence.' }));
  const scope = { schemaVersion: 'video1_manifest_v1', courseId: s.COURSE_ID, videoId: s.VIDEO_ID, ids: s.IDS, chunks };
  const documents = chunks.map((d, i) => ({ ...d, _id: `v1-${i}`, segmentId: d.chunkId, embedding: vector }));
  const bundle = { schemaVersion: 'atlas_video1_v1', executionMode: 'gemini', records: chunks.flatMap(d =>
    ['text', 'audio', 'visual'].map(kind => {
      const { text, ...identity } = d;
      return { kind, identity, text: kind === 'text' ? text : null, embedding: vector, vectorDigest: c.vectorDigest(vector),
        metadata: { ...contract, ...identity, status: 'success', modality: kind, signature: 'a'.repeat(64),
          contractVersion: kind === 'text' ? contract.contractVersion : `gemini_embedding_2_${kind}_v1`,
          sampleStartSec: d.startSec, sampleEndSec: d.endSec, mediaDurationSec: 8 } };
    })) };
  const definition = { fields: [{ type: 'vector', path: 'embedding', numDimensions: 3072, similarity: 'cosine' },
    { type: 'filter', path: 'videoId' }, { type: 'filter', path: 'courseId' }] };
  const index = { name: 'text_embedding_index', type: 'vectorSearch', id: 'fixed-index', latestDefinitionVersion: { version: 1 },
    status: 'READY', queryable: true, latestDefinition: definition, statusDetail: ['a', 'b', 'c'].map(hostname => ({ hostname,
      status: 'READY', queryable: true, mainIndex: { status: 'READY', queryable: true, definition } })) };
  const videos = c.VIDEO_IDS.map(_id => ({ _id, courseId: c.COURSE_ID, activeTranscriptVersion: 'fixed-v1' }));
  return { scope, documents, bundle, index, videos, vector, contract };
}
function repository(documents) {
  const rows = structuredClone(documents);
  const db = { rows, writes: 0, findOne: async ({ _id }) => structuredClone(rows.find(r => r._id === _id)),
    updateOne: async (filter, update, options) => {
      db.writes++; const row = rows.find(r => r._id === filter._id);
      if (options.upsert !== false || c.hash(row) !== c.hash(filter.$expr.$eq[1].$literal)) return { matchedCount: 0 };
      for (const [key, v] of Object.entries(update.$set || {})) {
        const [a, b] = key.split('.'); if (b) { row[a] ||= {}; row[a][b] = structuredClone(v); } else row[a] = structuredClone(v);
      }
      for (const key of Object.keys(update.$unset || {})) {
        const [a, b] = key.split('.'); if (b) delete row[a][b]; else delete row[a];
      }
      return { matchedCount: 1, modifiedCount: 1 };
    } };
  return db;
}
module.exports = { fixture, repository };
