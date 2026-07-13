const env = require('../config/env');

const DEFAULT_VIDEO_VECTOR_INDEX_NAME = 'video_embedding_index';
const VIDEO_VECTOR_EMBEDDING_DIMENSIONS = 3072;

function buildVideoVectorSearchIndexDefinition() {
  return {
    fields: [
      {
        type: 'vector',
        path: 'embedding',
        numDimensions: VIDEO_VECTOR_EMBEDDING_DIMENSIONS,
        similarity: 'cosine',
      },
      {
        type: 'filter',
        path: 'video_id',
      },
    ],
  };
}

async function listSearchIndexes(db, collectionName) {
  return db
    .collection(collectionName)
    .aggregate([{ $listSearchIndexes: {} }])
    .toArray();
}

async function ensureVideoVectorSearchIndex(db, options = {}) {
  const collectionName = options.collectionName || env.videoSegmentVideoCollection;
  const indexName = options.indexName
    || env.videoSegmentVideoVectorIndexName
    || DEFAULT_VIDEO_VECTOR_INDEX_NAME;
  const dryRun = Boolean(options.dryRun);
  const definition = buildVideoVectorSearchIndexDefinition();

  if (!collectionName) {
    throw new Error('VIDEO_SEGMENT_VIDEO_COLLECTION is required.');
  }

  if (!indexName) {
    throw new Error('VIDEO_SEGMENTS_VIDEO_VECTOR_INDEX_NAME is required.');
  }

  const existingIndexes = await listSearchIndexes(db, collectionName);
  const existingIndex = existingIndexes.find((index) => index.name === indexName) || null;

  if (existingIndex) {
    return {
      collection: collectionName,
      indexName,
      created: false,
      dryRun,
      status: existingIndex.status || null,
      message: 'Atlas Search index already exists.',
    };
  }

  const command = {
    createSearchIndexes: collectionName,
    indexes: [
      {
        name: indexName,
        type: 'vectorSearch',
        definition,
      },
    ],
  };

  if (dryRun) {
    return {
      collection: collectionName,
      indexName,
      created: false,
      dryRun: true,
      command,
      message: 'Atlas Search index is missing; dry-run only.',
    };
  }

  const result = await db.command(command);

  return {
    collection: collectionName,
    indexName,
    created: true,
    dryRun: false,
    commandResult: result,
    message: 'Atlas Search index creation requested.',
  };
}

module.exports = {
  DEFAULT_VIDEO_VECTOR_INDEX_NAME,
  VIDEO_VECTOR_EMBEDDING_DIMENSIONS,
  buildVideoVectorSearchIndexDefinition,
  ensureVideoVectorSearchIndex,
};
