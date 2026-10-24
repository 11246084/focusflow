const { MongoClient } = require('mongodb');

async function ensureAuthAuditLog(db) {
  try { await db.createCollection('adminAuditLogs'); }
  catch (error) { if (error.code !== 48) throw error; }
}
async function main() {
  const uri = process.env.AUTH_AUDIT_MONGODB_URI;
  const index = process.argv.indexOf('--database');
  const database = index >= 0 ? process.argv[index + 1] : '';
  if (!uri || !database || database.startsWith('--')) throw new Error('Explicit audit credentials and target database required.');
  const client = new MongoClient(uri);
  try {
    await client.connect(); await ensureAuthAuditLog(client.db(database));
    console.log(JSON.stringify({ database, collection: 'adminAuditLogs' }));
  } finally { await client.close(); }
}
if (require.main === module) main().catch(() => { console.error('adminAuditLogs ensure failed; verify explicitly authorized target.'); process.exitCode = 1; });
module.exports = { ensureAuthAuditLog };
