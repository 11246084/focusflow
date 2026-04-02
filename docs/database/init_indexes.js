// ============================================================
// focusflow — MongoDB 初始化 Indexes
// 執行方式：在 MongoDB Shell (mongosh) 中執行此腳本
// 指令：mongosh "your_connection_string" --file init_indexes.js
// ⚠️  請先執行 init_collections.js 再執行此腳本
// ============================================================

use("focusflow");

// ── users ──────────────────────────────────────────────────
// email 唯一索引，確保不重複，登入查詢用
db.users.createIndex({ email: 1 }, { unique: true });
print("✅ users.email（unique）");

// ── courses ────────────────────────────────────────────────
// 查詢某位教師開設的所有課程
db.courses.createIndex({ teacherId: 1 });
print("✅ courses.teacherId");

// ── videos ─────────────────────────────────────────────────
// 查詢某堂課的所有影片
db.videos.createIndex({ courseId: 1 });
print("✅ videos.courseId");

// ── video_segments ─────────────────────────────────────────
// 查詢某堂課的所有影片片段
db.video_segments.createIndex({ courseId: 1 });
print("✅ video_segments.courseId");

// 查詢某部影片的所有切段
db.video_segments.createIndex({ video_id: 1 });
print("✅ video_segments.video_id");

// ── clips ──────────────────────────────────────────────────
// 根據片段 ID 快速找到對應短影音
db.clips.createIndex({ segmentId: 1 });
print("✅ clips.segmentId");

// 查詢某堂課產生的所有短影音
db.clips.createIndex({ courseId: 1 });
print("✅ clips.courseId");

// ── enrollments ────────────────────────────────────────────
// 查詢某位學生選了哪些課
db.enrollments.createIndex({ studentId: 1 });
print("✅ enrollments.studentId");

// 查詢某堂課有哪些學生選修
db.enrollments.createIndex({ courseId: 1 });
print("✅ enrollments.courseId");

// ── usage_logs ─────────────────────────────────────────────
// 查詢某位使用者的所有行為紀錄
db.usage_logs.createIndex({ userId: 1 });
print("✅ usage_logs.userId");

// 查詢最新 log，倒序排列
db.usage_logs.createIndex({ timestamp: -1 });
print("✅ usage_logs.timestamp（倒序）");

// TTL Index：90 天後自動刪除過期 log（7776000 秒 = 90 天）
db.usage_logs.createIndex(
  { timestamp: 1 },
  { expireAfterSeconds: 7776000 }
);
print("✅ usage_logs.timestamp（TTL 90 天）");

print("\n🎉 所有 Indexes 建立完成！");

// ============================================================
// ⚠️  Vector Search Index 說明
// ============================================================
// video_segments 的 Vector Search Index 無法透過腳本建立，
// 需要到 MongoDB Atlas 網頁手動設定：
//
// 路徑：Atlas → Search & Vector Search → Create Vector Search Index
//
// 設定內容：
// {
//   "fields": [
//     {
//       "type": "vector",
//       "path": "embedding",
//       "numDimensions": 1536,
//       "similarity": "cosine"
//     }
//   ]
// }
//
// Index 名稱：vector_index
// Collection：focusflow.video_segments
// ============================================================
