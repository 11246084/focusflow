const dns = require('dns');
const { MongoClient } = require('mongodb');
const env = require('../config/env');

// Use public resolvers for Atlas SRV lookups in local environments with incomplete DNS forwarding.
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
  'notifications',
];

function redactUri(uri) {
  return String(uri || '').replace(/\/\/([^:]+):([^@]+)@/, (_, user) => `//${user}:***@`);
}

function buildSyncOperation(collectionName, document) {
  if (collectionName === 'users') {
    const { _id } = document;
    const backendOwnedFields = { ...document };
    delete backendOwnedFields._id;
    // Avatar files are target-local, so syncing user data must preserve the target's avatar metadata.
    delete backendOwnedFields.avatar;

    return {
      updateOne: {
        filter: { _id },
        update: {
          $set: backendOwnedFields,
        },
        upsert: true,
      },
    };
  }

  return {
    // Non-user collections mirror the complete local document by stable _id.
    replaceOne: {
      filter: { _id: document._id },
      replacement: document,
      upsert: true,
    },
  };
}

async function syncCollection(sourceDb, targetDb, collectionName) {
  const sourceCollection = sourceDb.collection(collectionName);
  const targetCollection = targetDb.collection(collectionName);
  const documents = await sourceCollection.find({}).toArray();

  if (!documents.length) {
    return { collection: collectionName, sourceCount: 0, upserted: 0, modified: 0, matched: 0 };
  }

  const result = await targetCollection.bulkWrite(
    documents.map((document) => buildSyncOperation(collectionName, document)),
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
    // Guard against accidentally treating one database as both source and destination.
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

if (require.main === module) {
  main().catch((error) => {
    console.error('Failed to sync local MongoDB to Atlas.', error);
    process.exitCode = 1;
  });
}

module.exports = {
  COLLECTIONS,
  buildSyncOperation,
  redactUri,
  syncCollection,
};
