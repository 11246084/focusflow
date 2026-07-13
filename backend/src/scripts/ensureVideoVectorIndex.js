const dns = require('dns');
const { MongoClient } = require('mongodb');
const env = require('../config/env');
const {
  DEFAULT_VIDEO_VECTOR_INDEX_NAME,
  ensureVideoVectorSearchIndex,
} = require('../services/videoVectorIndex.service');

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
    const result = await ensureVideoVectorSearchIndex(db, {
      collectionName: env.videoSegmentVideoCollection,
      indexName: env.videoSegmentVideoVectorIndexName || DEFAULT_VIDEO_VECTOR_INDEX_NAME,
      dryRun: args.dryRun,
    });

    console.log(JSON.stringify({
      database: db.databaseName,
      mongoUri: redactUri(uri),
      envReminder: {
        VIDEO_SEGMENTS_VIDEO_VECTOR_INDEX_NAME: result.indexName,
      },
      ...result,
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('ensureVideoVectorIndex failed:', error.message);
  process.exitCode = 1;
});
