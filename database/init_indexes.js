// ============================================================
// focusflow — MongoDB 初始化 Indexes
// 執行方式：在 MongoDB Shell (mongosh) 中執行此腳本
// 指令：mongosh "your_connection_string" --file init_indexes.js
// ⚠️  請先執行 init_collections.js 再執行此腳本
// ============================================================

use("focusflow");

// ── users ──────────────────────────────────────────────────
db.users.createIndex({ email: 1 }, { unique: true });
print("✅ users.email（unique）");

db.users.createIndex({ lineUserId: 1 }, { sparse: true });
print("✅ users.lineUserId（sparse）");

// ── courses ────────────────────────────────────────────────
db.courses.createIndex({ teacherId: 1 });
print("✅ courses.teacherId");

// ── videos ─────────────────────────────────────────────────
db.videos.createIndex({ courseId: 1 });
print("✅ videos.courseId");

// ── video_segments ─────────────────────────────────────────
db.video_segments.createIndex({ courseId: 1 });
print("✅ video_segments.courseId");

db.video_segments.createIndex({ video_id: 1 });
print("✅ video_segments.video_id");

// ── clips ──────────────────────────────────────────────────
db.clips.createIndex({ segmentId: 1 });
print("✅ clips.segmentId");

db.clips.createIndex({ courseId: 1 });
print("✅ clips.courseId");

// ── enrollments ────────────────────────────────────────────
db.enrollments.createIndex({ studentId: 1 });
print("✅ enrollments.studentId");

db.enrollments.createIndex({ courseId: 1 });
print("✅ enrollments.courseId");

// ── usage_logs ─────────────────────────────────────────────
db.usage_logs.createIndex({ userId: 1 });
print("✅ usage_logs.userId");

db.usage_logs.createIndex({ timestamp: -1 });
print("✅ usage_logs.timestamp（倒序）");

// TTL Index：90 天後自動刪除過期 log
db.usage_logs.createIndex(
  { timestamp: 1 },
  { expireAfterSeconds: 7776000 }
);
print("✅ usage_logs.timestamp（TTL 90 天）");

// ── stt_cache ──────────────────────────────────────────────
db.stt_cache.createIndex({ video_id: 1 }, { unique: true });
print("✅ stt_cache.video_id（unique）");

// ── term_dictionary ────────────────────────────────────────
db.term_dictionary.createIndex({ correct: 1 });
print("✅ term_dictionary.correct");

// ── raw_transcripts ────────────────────────────────────────
db.raw_transcripts.createIndex({ video_id: 1 }, { unique: true });
print("✅ raw_transcripts.video_id（unique）");

// ── line_bind_tokens ───────────────────────────────────────
db.line_bind_tokens.createIndex({ token: 1 }, { unique: true });
print("✅ line_bind_tokens.token（unique）");

// TTL Index：token 到期自動刪除（expiresAt 由程式碼設定為 10 分鐘後）
db.line_bind_tokens.createIndex(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);
print("✅ line_bind_tokens.expiresAt（TTL）");

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
