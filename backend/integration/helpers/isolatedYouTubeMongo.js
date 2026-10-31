const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');

function assertLoopbackMongoUri(uri) {
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(uri || '')) {
    throw new Error('YOUTUBE_TEST_MONGODB_URI must be a bare loopback URI with an explicit port; no existing database or Atlas.');
  }
  const port = Number(new URL(uri).port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid isolated MongoDB port.');
  return uri;
}
async function openIsolatedYouTubeMongo(uri) {
  assertLoopbackMongoUri(uri);
  const databaseName = `focusflow_youtube_test_${crypto.randomBytes(8).toString('hex')}`;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, directConnection: true });
  let db;
  try {
    await client.connect();
    db = client.db(databaseName);
    await db.createCollection('testMarker');
    let closed = false;
    return {
      db, databaseName,
      async close() {
        if (closed) return;
        try {
          if (db.databaseName !== databaseName || !/^focusflow_youtube_test_[a-f0-9]{16}$/.test(databaseName)) throw new Error('Refusing to drop an unowned database.');
          await db.dropDatabase();
          const remaining = await client.db('admin').admin().listDatabases({ nameOnly: true, filter: { name: databaseName } });
          if (remaining.databases.length) throw new Error('Isolated database cleanup failed.');
          closed = true;
        } finally { await client.close(); }
      },
    };
  } catch (error) {
    try {
      if (db) {
        if (db.databaseName !== databaseName || !/^focusflow_youtube_test_[a-f0-9]{16}$/.test(databaseName)) throw new Error('Refusing to drop an unowned database.');
        await db.dropDatabase();
      }
    } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Isolated Mongo setup and cleanup failed.'); }
    finally { await client.close(); }
    throw error;
  }
}
async function withIsolatedYouTubeMongo(uri, run) {
  const isolated = await openIsolatedYouTubeMongo(uri);
  try { return await run(isolated); } finally { await isolated.close(); }
}
module.exports = { assertLoopbackMongoUri, openIsolatedYouTubeMongo, withIsolatedYouTubeMongo };
