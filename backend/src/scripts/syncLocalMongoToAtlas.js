const dns = require('dns');
const { MongoClient } = require('mongodb');
const env = require('../config/env');

dns.setServers(['8.8.8.8', '8.8.4.4']);

const COLLECTIONS = [
  'users',
  'courses',
  'videos',
  env.videoSegmentCollection,
  'enrollments',
  'clips',
  'usage_logs',
  'questions',
  'line_bind_tokens',
];

function redactUri(uri) {
  return String(uri || '').replace(/\/\/([^:]+):([^@]+)@/, (_, user) => `//${user}:***@`);
}

async function syncCollection(sourceDb, targetDb, collectionName) {
  const sourceCollection = sourceDb.collection(collectionName);
  const targetCollection = targetDb.collection(collectionName);
  const documents = await sourceCollection.find({}).toArray();

  if (!documents.length) {
    return { collection: collectionName, sourceCount: 0, upserted: 0, modified: 0, matched: 0 };
  }

  const result = await targetCollection.bulkWrite(
    documents.map((document) => ({
      replaceOne: {
        filter: { _id: document._id },
        replacement: document,
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return {
    collection: collectionName,
    sourceCount: documents.length,
    upserted: result.upsertedCount || 0,
    modified: result.modifiedCount || 0,
    matched: result.matchedCount || 0,
  };
}

async function main() {
  const localUri = process.env.LOCAL_MONGODB_URI || env.mongodbUri;
  const atlasUri = process.env.ATLAS_MONGODB_URI || process.env.MONGODB_ATLAS_URI;

  if (!atlasUri) {
    throw new Error('ATLAS_MONGODB_URI is required.');
  }

  if (localUri === atlasUri) {
    throw new Error('Local and Atlas MongoDB URIs are identical; refusing to sync.');
  }

  const clientOptions = {
    connectTimeoutMS: 10000,
    serverSelectionTimeoutMS: 10000,
  };
  const localClient = new MongoClient(localUri, clientOptions);
  const atlasClient = new MongoClient(atlasUri, clientOptions);

  try {
    await localClient.connect();
    await atlasClient.connect();

    const localDb = localClient.db();
    const atlasDb = atlasClient.db();

    console.log(JSON.stringify({
      mode: 'upsert-by-_id',
      local: redactUri(localUri),
      atlas: redactUri(atlasUri),
      localDatabase: localDb.databaseName,
      atlasDatabase: atlasDb.databaseName,
    }, null, 2));

    const results = [];

    for (const collectionName of [...new Set(COLLECTIONS)]) {
      console.log(`Syncing ${collectionName}...`);
      const result = await syncCollection(localDb, atlasDb, collectionName);
      results.push(result);
      console.log(JSON.stringify(result));
    }

    console.log(JSON.stringify({ results }, null, 2));
  } finally {
    await Promise.allSettled([
      localClient.close(),
      atlasClient.close(),
    ]);
  }
}

main().catch((error) => {
  console.error('Failed to sync local MongoDB to Atlas.', error);
  process.exitCode = 1;
});
