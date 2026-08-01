const env = require('../config/env');

const DEFAULT_PARENT_VECTOR_INDEX_NAME = 'parent_embedding_index';
const PARENT_VECTOR_EMBEDDING_DIMENSIONS = 3072;

// Regular indexes（契約 §11）；需與 videoSegmentParent.model.js 的 schema.index 定義一致
const PARENT_REGULAR_INDEXES = [
  { key: { parentId: 1 }, options: { name: 'parentId_1', unique: true } },
  { key: { courseId: 1, videoId: 1 }, options: { name: 'courseId_1_videoId_1' } },
  { key: { videoId: 1, hierarchyFingerprint: 1 }, options: { name: 'videoId_1_hierarchyFingerprint_1' } },
];

function buildParentVectorSearchIndexDefinition() {
  return {
    fields: [
      {
        type: 'vector',
        path: 'embedding',
        numDimensions: PARENT_VECTOR_EMBEDDING_DIMENSIONS,
        similarity: 'cosine',
      },
      {
        type: 'filter',
        path: 'courseId',
      },
      {
        type: 'filter',
        path: 'videoId',
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

async function ensureParentRegularIndexes(db, options = {}) {
  const collectionName = options.collectionName || env.videoSegmentParentCollection;
  const dryRun = Boolean(options.dryRun);

  if (!collectionName) {
    throw new Error('VIDEO_SEGMENT_PARENT_COLLECTION is required.');
  }

  const collection = db.collection(collectionName);
  const existing = await collection.indexes().catch((error) => {
    // NamespaceNotFound：collection 尚未存在，所有 index 都視為缺少
    if (error.codeName === 'NamespaceNotFound' || error.code === 26) return [];
    throw error;
  });
  const existingNames = new Set(existing.map((index) => index.name));
  const missing = PARENT_REGULAR_INDEXES.filter((spec) => !existingNames.has(spec.options.name));

  if (dryRun || !missing.length) {
    return {
      collection: collectionName,
      dryRun,
      createdIndexNames: [],
      missingIndexNames: missing.map((spec) => spec.options.name),
      message: missing.length
        ? 'Regular indexes are missing; dry-run only.'
        : 'Regular indexes already exist.',
    };
  }

  for (const spec of missing) {
    await collection.createIndex(spec.key, spec.options);
  }

  return {
    collection: collectionName,
    dryRun: false,
    createdIndexNames: missing.map((spec) => spec.options.name),
    missingIndexNames: [],
    message: 'Regular index creation requested.',
  };
}

async function ensureParentVectorSearchIndex(db, options = {}) {
  const collectionName = options.collectionName || env.videoSegmentParentCollection;
  const indexName = options.indexName
    || env.videoSegmentParentVectorIndexName
    || DEFAULT_PARENT_VECTOR_INDEX_NAME;
  const dryRun = Boolean(options.dryRun);
  const definition = buildParentVectorSearchIndexDefinition();

  if (!collectionName) {
    throw new Error('VIDEO_SEGMENT_PARENT_COLLECTION is required.');
  }

  if (!indexName) {
    throw new Error('VIDEO_SEGMENTS_PARENT_VECTOR_INDEX_NAME is required.');
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
  DEFAULT_PARENT_VECTOR_INDEX_NAME,
  PARENT_VECTOR_EMBEDDING_DIMENSIONS,
  PARENT_REGULAR_INDEXES,
  buildParentVectorSearchIndexDefinition,
  ensureParentRegularIndexes,
  ensureParentVectorSearchIndex,
};
