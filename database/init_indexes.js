// ============================================================
// focusflow — MongoDB 初始化 Indexes
// 執行方式：在 MongoDB Shell (mongosh) 中執行此腳本
// 指令：mongosh "your_connection_string" --file init_indexes.js
// ⚠️  請先執行 init_collections.js 再執行此腳本
// 備註：此腳本優先補齊 v1 正式契約需要的 index，
//      同時保留 legacy `video_segments` / `clips` 的過渡索引。
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

db.videos.createIndex({ video_id: 1 }, { unique: true, sparse: true });
print("✅ videos.video_id（sparse unique）");

// ── raw_transcripts ────────────────────────────────────────
db.raw_transcripts.createIndex({ video_id: 1 }, { unique: true });
print("✅ raw_transcripts.video_id（unique）");

// ── stt_cache ──────────────────────────────────────────────
db.stt_cache.createIndex({ video_id: 1 }, { unique: true });
print("✅ stt_cache.video_id（unique）");

// ── transcripts_normalized ────────────────────────────────
db.transcripts_normalized.createIndex({ video_id: 1 }, { unique: true });
print("✅ transcripts_normalized.video_id（unique）");

db.transcripts_normalized.createIndex({ "segments.segment_id": 1 });
print("✅ transcripts_normalized.segments.segment_id");

// ── video_segments_text ───────────────────────────────────
db.video_segments_text.createIndex({ video_id: 1 });
print("✅ video_segments_text.video_id");

db.video_segments_text.createIndex({ chunk_id: 1 }, { unique: true });
print("✅ video_segments_text.chunk_id（unique）");

// ── video_segments_video ──────────────────────────────────
db.video_segments_video.createIndex({ video_id: 1 });
print("✅ video_segments_video.video_id");

db.video_segments_video.createIndex({ clip_id: 1 }, { unique: true });
print("✅ video_segments_video.clip_id（unique）");

// ── video_segments（legacy）────────────────────────────────
db.video_segments.createIndex({ courseId: 1 });
print("✅ video_segments.courseId");

db.video_segments.createIndex({ video_id: 1 });
print("✅ video_segments.video_id");

// ── clips（legacy）─────────────────────────────────────────
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

// ── term_dictionary ────────────────────────────────────────
db.term_dictionary.createIndex({ correct: 1 });
print("✅ term_dictionary.correct");

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
// 正式 v1 契約採分 collection Vector Search Index，
// 需要到 MongoDB Atlas 網頁手動設定：
//
// 路徑：Atlas → Search & Vector Search → Create Vector Search Index
//
// 1. Collection：focusflow.video_segments_text
//    Index 名稱：text_embedding_index
//    path：embedding
//    numDimensions：3072
//
// 2. Collection：focusflow.video_segments_video
//    Index 名稱：video_embedding_index
//    path：embedding
//    numDimensions：依實際模型而定
//
// 舊版 `video_segments.vector_index` 視為 legacy。
//
// text 範例設定內容：
// {
//   "fields": [
//     {
//       "type": "vector",
//       "path": "embedding",
//       "numDimensions": 3072,
//       "similarity": "cosine"
//     }
//   ]
// }
// ============================================================
