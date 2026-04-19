// ============================================================
// focusflow — 修復 video_segments_text 中的 embedding 維度不一致問題
//
// 問題：video_segments_text 同時存在
//   - 102 筆 3072 維（pipeline 真實向量）
//   -   3 筆   32 維（demo seed mock 向量）
//
// 若不處理就建立 Atlas Vector Search Index（numDimensions: 3072），
// 32 維文件會被 ANN 搜尋跳過或產生錯誤，且 Atlas 可能拒絕建立 index。
//
// 策略：將 32 維文件的 embedding 欄位重置為空陣列
//       （保留其他欄位以維持 lexical fallback 可用性）
//
// 執行方式：
//   mongosh "<Atlas 連接字串>" --file database/tools/fixes/fix_embedding_dims.js
// ============================================================

use("focusflow");

// 找出所有非 3072 維的文件（空陣列 [] 也算異常，一併列出）
const badDocs = db.video_segments_text.find(
  {
    $expr: {
      $and: [
        { $gt: [{ $size: "$embedding" }, 0] },
        { $ne: [{ $size: "$embedding" }, 3072] },
      ],
    },
  },
  { _id: 1, chunk_id: 1, video_id: 1, courseId: 1, embedding: { $slice: 3 } }
).toArray();

print(`\n🔍 發現 ${badDocs.length} 筆維度異常文件：`);
badDocs.forEach((doc) => {
  print(`  _id=${doc._id}  chunk_id=${doc.chunk_id}  video_id=${doc.video_id}  courseId=${doc.courseId}  dim=${doc.embedding.length}（前三值 shown）`);
});

if (badDocs.length === 0) {
  print("✅ 無需修復，所有文件 embedding 維度正常（3072 或空陣列）。");
} else {
  const ids = badDocs.map((d) => d._id);
  const result = db.video_segments_text.updateMany(
    { _id: { $in: ids } },
    { $set: { embedding: [] } }
  );
  print(`\n✅ 已將 ${result.modifiedCount} 筆文件的 embedding 重置為空陣列。`);
  print("   這些文件仍可參與 lexical fallback 搜尋，但不會進入 Atlas vector search。");
  print("   若需保留完整 demo 功能，請改用正式 Gemini embedding 重新產生向量後匯入。");
}

// 確認修復後的維度分佈
print("\n📊 修復後的維度分佈：");
const dims = db.video_segments_text.aggregate([
  {
    $group: {
      _id: { $size: "$embedding" },
      count: { $sum: 1 },
    },
  },
  { $sort: { _id: 1 } },
]).toArray();
dims.forEach((d) => print(`  dim=${d._id}  count=${d.count}`));
