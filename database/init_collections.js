// ============================================================
// focusflow — MongoDB 初始化 Collections
// 執行方式：在 MongoDB Shell (mongosh) 中執行此腳本
// 指令：mongosh "your_connection_string" --file init_collections.js
// 備註：此腳本同時建立 v1 正式 collections 與少量 legacy collections，
//      目的是讓新資料契約與目前過渡中的 backend 可以並存。
// ============================================================

use("focusflow");

const collections = [
  "users",
  "courses",
  "videos",
  "enrollments",
  "usage_logs",
  "stt_cache",
  "term_dictionary",
  "raw_transcripts",
  "transcripts_normalized",
  "video_segments_text",
  "video_segments_audio",
  "video_segments_video",
  "video_segments",
  "clips",
  "line_bind_tokens",
];

collections.forEach((name) => {
  db.createCollection(name);
  print(`✅ 建立 Collection：${name}`);
});

print("\n🎉 所有 Collection 建立完成！");

// ============================================================
// Collection 說明
// ============================================================
//
// ── 核心業務 Collection ──────────────────────────────────────
//
// users          — 所有使用者（學生 / 教師 / 管理者）
//                  欄位：_id, name, email, passwordHash,
//                        role, isActive,
//                        lineUserId, lineBindAt,
//                        activeCourseId, lineConversationState,
//                        createdAt
//
// courses        — 課程基本資料
//                  欄位：_id, title, description,
//                        teacherId, videoIds[], createdAt
//
// videos         — 影片 metadata 主表
//                  正式欄位請參考 docs/05_Database_Schema_Contract/
//                  MongoDB_契約定版_v1.md
//
// enrollments    — 學生選課紀錄
//                  欄位：_id, studentId, courseId,
//                        enrolledAt, progress, lineNotify
//
// usage_logs     — 使用者行為紀錄（設有 90 天 TTL）
//                  欄位：_id, userId, courseId,
//                        event, durationSec, timestamp
//
// line_bind_tokens — LINE 綁定 token，10 分鐘後自動刪除
//                  欄位：_id, token, userId, createdAt, expiresAt
//
// ── Pipeline 支援 Collection ─────────────────────────────────
//
// stt_cache      — Whisper STT 快取，多人共用避免重複執行
//                  欄位：_id, video_id, segments[], createdAt
//                  來源：data/cache/transcripts/*.json
//
// term_dictionary — 專有名詞校正詞庫，多人協作共用
//                  欄位：_id, correct, alternatives[], updatedAt
//                  來源：data/term_dictionary.json
//
// raw_transcripts — Whisper 原始輸出，供 debug 與追溯
//                  欄位：_id, video_id, segments[],
//                        segment_count, createdAt
//                  來源：data/outputs/transcripts.json
//
// transcripts_normalized — 正規化後逐字稿，中間產物
//                  欄位：_id, video_id, segments[], updated_at
//
// video_segments_text — 正式文字檢索主 collection
//                  欄位：_id, chunk_id, video_id, segment_id,
//                        start_sec, end_sec, text, embedding,
//                        embedding_model, embedding_dim, updated_at
//
// video_segments_audio — 音檔片段 + audio embedding
//                  欄位：_id, segment_id, video_id,
//                        start_sec, end_sec, audio_path, embedding
//
// video_segments_video — 正式影片片段檢索主 collection
//                  欄位：_id, clip_id, video_id,
//                        start_sec, end_sec, clip_path, embedding,
//                        embedding_model, embedding_dim, updated_at
//
// video_segments — legacy 舊版結構，供過渡相容使用
//
// clips          — legacy 快取層，非正式 source of truth
// ============================================================
