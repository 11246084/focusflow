// ============================================================
// focusflow — 修復 Bridge Course 無可搜尋段落的問題
//
// 問題：
//   - Bridge course _id=680000000000000000000103
//   - Bridge video _id=680000000000000000000203，video_id="focusflow-demo-video-pipeline-bridge"
//   - video_segments_text 以 courseId=...103 或 video_id="focusflow-demo-video-pipeline-bridge" 查詢均為 0 筆
//   - pipeline 實際資料在 video_id="video_001"（102 筆 3072 維 segments）
//
// 策略（本腳本採用）：
//   在 video_001 的 segments 上補寫 courseId=ObjectId("680000000000000000000103")
//   讓 backend 的 atlas filter（bridge_course_or_video 模式）以 courseId 找到這些段落。
//
//   備選策略（未採用）：
//   將 bridge video 的 video_id 改為 "video_001"，backend scope 就會把 video_001 納入
//   allowedVideoIds。但這會改變影片文件語義，需要與 RAG / DB 組確認。
//
// 執行方式：
//   mongosh "<Atlas 連接字串>" --file database/fix_bridge_course_segments.js
// ============================================================

use("focusflow");

const BRIDGE_COURSE_ID = ObjectId("680000000000000000000103");
const PIPELINE_VIDEO_ID = "video_001";

// 1. 確認 bridge course 存在
const bridgeCourse = db.courses.findOne({ _id: BRIDGE_COURSE_ID });
if (!bridgeCourse) {
  print(`❌ 找不到 bridge course _id=${BRIDGE_COURSE_ID}，請確認 ID 是否正確。`);
  quit(1);
}
print(`✅ bridge course 存在：${bridgeCourse.title}`);

// 2. 確認 video_001 在 video_segments_text 中有段落
const segmentCount = db.video_segments_text.countDocuments({ video_id: PIPELINE_VIDEO_ID });
print(`🔍 video_segments_text 中 video_id="${PIPELINE_VIDEO_ID}" 的段落數：${segmentCount}`);

if (segmentCount === 0) {
  print(`❌ 找不到 video_id="${PIPELINE_VIDEO_ID}" 的段落，請先執行 pipeline 匯入腳本。`);
  quit(1);
}

// 3. 確認這些段落目前有無 courseId
const withCourseId = db.video_segments_text.countDocuments({
  video_id: PIPELINE_VIDEO_ID,
  courseId: { $ne: null },
});
const withoutCourseId = db.video_segments_text.countDocuments({
  video_id: PIPELINE_VIDEO_ID,
  courseId: null,
});
print(`   其中已有 courseId：${withCourseId} 筆`);
print(`   其中無 courseId：${withoutCourseId} 筆`);

// 4. 只更新尚未設定 courseId 的段落（避免覆蓋已綁定其他課程的段落）
if (withoutCourseId === 0) {
  print(`✅ 所有 video_001 段落已有 courseId，無需修復。`);
} else {
  const result = db.video_segments_text.updateMany(
    { video_id: PIPELINE_VIDEO_ID, courseId: null },
    { $set: { courseId: BRIDGE_COURSE_ID } }
  );
  print(`\n✅ 已更新 ${result.modifiedCount} 筆段落，courseId 設為 bridge course。`);
}

// 5. 驗證修復結果
const afterCount = db.video_segments_text.countDocuments({
  video_id: PIPELINE_VIDEO_ID,
  courseId: BRIDGE_COURSE_ID,
});
print(`\n📊 修復後驗證：`);
print(`   video_id="${PIPELINE_VIDEO_ID}" + courseId=bridge_course 的段落數：${afterCount}`);

if (afterCount > 0) {
  print(`✅ Bridge course QA 應可找到段落，backend atlas filter 可正常運作。`);
  print(`\n⚠️  後續注意：`);
  print(`   1. 確認 Atlas Vector Search Index 已建立（text_embedding_index, 3072 維）`);
  print(`   2. Backend .env 設定 QA_VECTOR_SEARCH_MODE=atlas`);
  print(`   3. Backend .env 設定 QA_ATLAS_VECTOR_INDEX_NAME=text_embedding_index`);
} else {
  print(`❌ 修復失敗，請檢查腳本邏輯或 courseId 欄位型別。`);
}
