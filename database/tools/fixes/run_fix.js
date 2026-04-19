// 用 Node.js 執行：node database/tools/fixes/run_fix.js
// 自動讀取 backend/.env 的 MONGODB_URI

const path = require('path');
const MAIN_REPO = 'C:/Users/940/Documents/GitHub/focusflow';
const backendModules = path.join(MAIN_REPO, 'backend/node_modules');
const { MongoClient, ObjectId } = require(path.join(backendModules, 'mongodb'));
require(path.join(backendModules, 'dotenv')).config({ path: path.join(MAIN_REPO, 'backend/.env') });

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('❌ 找不到 MONGODB_URI，請確認 backend/.env 已設定');
  process.exit(1);
}

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('focusflow');
  const col = db.collection('video_segments_text');

  console.log('🔗 已連線到 Atlas:', uri.split('@')[1]);

  // ── Fix 1：清理 32 維 embeddings ──────────────────────────
  console.log('\n📌 Fix 1：清理維度異常的 embedding...');
  const allDocs = await col.find({}, { projection: { _id: 1, chunk_id: 1, video_id: 1, courseId: 1, embedding: 1 } }).toArray();
  const badDocs = allDocs.filter(d => d.embedding && d.embedding.length > 0 && d.embedding.length !== 3072);

  console.log(`   發現 ${badDocs.length} 筆維度異常文件`);
  badDocs.forEach(d => console.log(`   → chunk_id=${d.chunk_id}  dim=${d.embedding.length}`));

  if (badDocs.length > 0) {
    const ids = badDocs.map(d => d._id);
    const r1 = await col.updateMany({ _id: { $in: ids } }, { $set: { embedding: [] } });
    console.log(`   ✅ 已重置 ${r1.modifiedCount} 筆文件的 embedding 為空陣列`);
  } else {
    console.log('   ✅ 無需修復');
  }

  // ── Fix 2：Bridge course 段落綁定 ────────────────────────
  console.log('\n📌 Fix 2：綁定 video_001 段落到 bridge course...');
  const BRIDGE_COURSE_ID = new ObjectId('680000000000000000000103');
  const PIPELINE_VIDEO_ID = 'video_001';

  const total = await col.countDocuments({ video_id: PIPELINE_VIDEO_ID });
  const needFix = await col.countDocuments({ video_id: PIPELINE_VIDEO_ID, courseId: null });
  console.log(`   video_001 段落總數：${total}，其中無 courseId：${needFix}`);

  if (needFix > 0) {
    const r2 = await col.updateMany(
      { video_id: PIPELINE_VIDEO_ID, courseId: null },
      { $set: { courseId: BRIDGE_COURSE_ID } }
    );
    console.log(`   ✅ 已更新 ${r2.modifiedCount} 筆段落，courseId 設為 bridge course`);
  } else {
    console.log('   ✅ 無需修復');
  }

  // ── Fix 3：補複合索引 ─────────────────────────────────────
  console.log('\n📌 Fix 3：建立複合索引 video_id + courseId...');
  try {
    await col.createIndex({ video_id: 1, courseId: 1 });
    console.log('   ✅ 複合索引建立完成');
  } catch (e) {
    console.log('   ℹ️  索引已存在或建立失敗：', e.message);
  }

  // ── 驗證結果 ─────────────────────────────────────────────
  console.log('\n📊 修復後狀態：');
  const afterBridge = await col.countDocuments({ video_id: PIPELINE_VIDEO_ID, courseId: BRIDGE_COURSE_ID });
  const dims = await col.aggregate([
    { $group: { _id: { $size: '$embedding' }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]).toArray();
  console.log(`   bridge course 可搜段落數：${afterBridge}`);
  console.log('   embedding 維度分佈：');
  dims.forEach(d => console.log(`     dim=${d._id}  count=${d.count}`));

  await client.close();
  console.log('\n🎉 完成！請至 MongoDB Atlas UI 建立 Vector Search Index。');
}

run().catch(err => {
  console.error('❌ 執行失敗：', err.message);
  process.exit(1);
});
