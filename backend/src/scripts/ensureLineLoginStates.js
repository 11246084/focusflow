const { MongoClient } = require('mongodb');

const INDEXES = [
  { key: { userId: 1 }, name: 'userId_1' },
  { key: { expiresAt: 1 }, name: 'expiresAt_1', expireAfterSeconds: 0 },
];
class IndexContractError extends Error {}
async function ensureLineLoginStates(db) {
  try { await db.createCollection('lineLoginStates'); }
  catch (error) { if (error.code !== 48) throw error; }
  const collection = db.collection('lineLoginStates');
  const existing = await collection.listIndexes().toArray();
  // Validate every existing target before creating anything. Never drop/rebuild.
  for (const expected of INDEXES) {
    const matches = existing.filter((index) => JSON.stringify(index.key) === JSON.stringify(expected.key) || index.name === expected.name);
    for (const index of matches) {
      if (JSON.stringify(index.key) !== JSON.stringify(expected.key)
        || index.expireAfterSeconds !== expected.expireAfterSeconds
        || index.unique || index.sparse || index.partialFilterExpression || index.collation || index.hidden) {
        throw new IndexContractError(`lineLoginStates index ${index.name} has conflicting options; stop for manual review.`);
      }
    }
  }
  for (const expected of INDEXES) {
    if (!existing.some((index) => JSON.stringify(index.key) === JSON.stringify(expected.key))) {
      const { key, ...options } = expected;
      await collection.createIndex(key, options);
    }
  }
  return collection.listIndexes().toArray();
}
async function main() {
  // Dedicated limited-role credentials, explicitly supplied by the operator.
  // Do not load the application's .env or initialize any Mongoose model.
  const uri = process.env.LINE_LOGIN_STATES_MONGODB_URI;
  const database = process.argv[process.argv.indexOf('--database') + 1];
  if (!uri || !process.argv.includes('--database') || !database || database.startsWith('--')) {
    throw new Error('Set LINE_LOGIN_STATES_MONGODB_URI and pass --database <confirmed-target>.');
  }
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const indexes = await ensureLineLoginStates(client.db(database));
    console.log(JSON.stringify({ database, collection: 'lineLoginStates', indexes }, null, 2));
  } finally { await client.close(); }
}
if (require.main === module) main().catch((error) => {
  console.error(error instanceof IndexContractError ? error.message : 'lineLoginStates ensure failed; verify target and index options.');
  process.exitCode = 1;
});
module.exports = { ensureLineLoginStates, INDEXES };
