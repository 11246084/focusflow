const dns = require('dns');
const { MongoClient } = require('mongodb');
const env = require('../config/env');
const {
  DEFAULT_PARENT_VECTOR_INDEX_NAME,
  ensureParentRegularIndexes,
  ensureParentVectorSearchIndex,
} = require('../services/parentVectorIndex.service');

dns.setServers(['8.8.8.8', '8.8.4.4']);

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
  };
}

function redactUri(uri) {
  return String(uri || '').replace(/\/\/([^:]+):([^@]+)@/, (_, user) => `//${user}:***@`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const uri = env.mongodbUri;
  const client = new MongoClient(uri, {
    connectTimeoutMS: 10000,
    serverSelectionTimeoutMS: 10000,
  });

  try {
    await client.connect();
    const db = client.db();
    const regularResult = await ensureParentRegularIndexes(db, {
      collectionName: env.videoSegmentParentCollection,
      dryRun: args.dryRun,
    });
    const vectorResult = await ensureParentVectorSearchIndex(db, {
      collectionName: env.videoSegmentParentCollection,
      indexName: env.videoSegmentParentVectorIndexName || DEFAULT_PARENT_VECTOR_INDEX_NAME,
      dryRun: args.dryRun,
    });

    console.log(JSON.stringify({
      database: db.databaseName,
      mongoUri: redactUri(uri),
      envReminder: {
        VIDEO_SEGMENT_PARENT_COLLECTION: regularResult.collection,
        VIDEO_SEGMENTS_PARENT_VECTOR_INDEX_NAME: vectorResult.indexName,
      },
      regularIndexes: regularResult,
      vectorIndex: vectorResult,
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('ensureParentStorage failed:', error.message);
  process.exitCode = 1;
});
