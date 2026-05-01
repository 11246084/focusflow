/**
 * 把本機 questions 同步到 Atlas。
 *
 * 策略：
 *  1. 把本機缺少的 courses upsert 到 Atlas（保留同一個 _id）
 *  2. 用 email 把本機 users → Atlas users 建立對應表
 *  3. 把本機每筆 question 的 studentId 換成 Atlas 的 _id（courseId 不用換，因為步驟 1 已同步）
 *  4. 用 upsert-by-_id 寫入 Atlas questions（冪等）
 *
 * 環境變數：
 *  LOCAL_MONGODB_URI  — 本機 URI（預設讀 .env MONGODB_URI）
 *  ATLAS_MONGODB_URI  — Atlas URI（必填）
 *
 * 用法：
 *  node src/scripts/syncQuestionsToAtlas.js [--dry-run]
 */

const dns = require('dns');
const { MongoClient } = require('mongodb');
const env = require('../config/env');

dns.setServers(['8.8.8.8', '8.8.4.4']);

function redactUri(uri) {
  return String(uri || '').replace(/\/\/([^:]+):([^@]+)@/, (_, user) => `//${user}:***@`);
}

async function syncMissingCourses(localDb, atlasDb, dryRun) {
  const localCourses = await localDb.collection('courses').find({}).toArray();
  const atlasCourseIds = new Set(
    (await atlasDb.collection('courses').find({}, { projection: { _id: 1 } }).toArray())
      .map((c) => String(c._id)),
  );

  const missing = localCourses.filter((c) => !atlasCourseIds.has(String(c._id)));
  console.log(`  Courses: ${localCourses.length} local, ${atlasCourseIds.size} in Atlas, ${missing.length} to insert`);

  if (!missing.length || dryRun) return;

  await atlasDb.collection('courses').insertMany(missing, { ordered: false });
  missing.forEach((c) => console.log(`  + inserted course: "${c.title}" (${c._id})`));
}

async function buildUserIdMap(localDb, atlasDb) {
  const localUsers = await localDb.collection('users').find({}, { projection: { _id: 1, email: 1 } }).toArray();
  const atlasUsers = await atlasDb.collection('users').find({}, { projection: { _id: 1, email: 1 } }).toArray();

  const atlasByEmail = new Map(atlasUsers.map((u) => [u.email.toLowerCase(), u._id]));
  const map = new Map();
  let unmapped = 0;

  for (const u of localUsers) {
    const atlasId = atlasByEmail.get(u.email.toLowerCase());
    if (atlasId) {
      map.set(String(u._id), atlasId);
    } else {
      console.warn(`  [user] no Atlas match for email: ${u.email}`);
      unmapped++;
    }
  }

  console.log(`  Users mapped: ${map.size}, unmapped: ${unmapped}`);
  return map;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const localUri = process.env.LOCAL_MONGODB_URI || env.mongodbUri;
  const atlasUri = process.env.ATLAS_MONGODB_URI || process.env.MONGODB_ATLAS_URI;

  if (!atlasUri) throw new Error('ATLAS_MONGODB_URI is required.');
  if (localUri === atlasUri) throw new Error('Local and Atlas URIs are identical; refusing to sync.');

  const clientOptions = { connectTimeoutMS: 10000, serverSelectionTimeoutMS: 10000 };
  const localClient = new MongoClient(localUri, clientOptions);
  const atlasClient = new MongoClient(atlasUri, clientOptions);

  try {
    await localClient.connect();
    await atlasClient.connect();

    const localDb = localClient.db();
    const atlasDb = atlasClient.db();

    console.log(JSON.stringify({
      mode: dryRun ? 'dry-run' : 'sync-courses-then-questions',
      local: redactUri(localUri),
      atlas: redactUri(atlasUri),
    }, null, 2));

    console.log('\n[Step 1] Sync missing courses to Atlas...');
    await syncMissingCourses(localDb, atlasDb, dryRun);

    console.log('\n[Step 2] Build user ID map (local → Atlas via email)...');
    const userIdMap = await buildUserIdMap(localDb, atlasDb);

    const localQuestions = await localDb.collection('questions').find({}).toArray();
    console.log(`\n[Step 3] Remapping ${localQuestions.length} questions...`);

    const remapped = [];
    const skipped = [];

    for (const q of localQuestions) {
      const atlasStudentId = userIdMap.get(String(q.studentId));
      if (!atlasStudentId) {
        skipped.push({ _id: q._id, reason: `no Atlas user for studentId ${q.studentId}` });
        continue;
      }
      remapped.push({ ...q, studentId: atlasStudentId });
    }

    console.log(`  Will upsert: ${remapped.length}, skipped: ${skipped.length}`);
    if (skipped.length) skipped.forEach((s) => console.warn(`  skipped ${s._id} — ${s.reason}`));

    if (dryRun) {
      console.log('\n[dry-run] No changes written.');
      return;
    }
    if (!remapped.length) {
      console.log('Nothing to upsert.');
      return;
    }

    const result = await atlasDb.collection('questions').bulkWrite(
      remapped.map((doc) => ({
        replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true },
      })),
      { ordered: false },
    );

    console.log(JSON.stringify({
      upserted: result.upsertedCount,
      modified: result.modifiedCount,
      matched: result.matchedCount,
    }, null, 2));
  } finally {
    await Promise.allSettled([localClient.close(), atlasClient.close()]);
  }
}

main().catch((e) => { console.error('syncQuestionsToAtlas failed:', e.message); process.exitCode = 1; });
