// ============================================================
// focusflow — MongoDB 初始化 Collections
// 執行方式：在 MongoDB Shell (mongosh) 中執行此腳本
// 指令：mongosh "your_connection_string" --file init_collections.js
// ============================================================

use("focusflow");

const collections = [
  "users",
  "courses",
  "videos",
  "video_segments",
  "clips",
  "enrollments",
  "usage_logs",
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
// users          — 所有使用者（學生 / 教師 / 管理者）
//                  欄位：_id, name, email, passwordHash,
//                        role, lineUserId, createdAt
//
// courses        — 課程基本資料
//                  欄位：_id, title, description,
//                        teacherId, videoIds[], createdAt
//
// videos         — 影片 metadata（來自 videos.json）
//                  欄位：_id, video_id, file_name,
//                        duration_sec, week, lesson,
//                        video_url, courseId
//
// video_segments — 影片切段 + 向量（語意搜尋核心）
//                  欄位：_id, chunk_id, courseId, video_id,
//                        startSec, endSec, transcript, embedding[]
//
// clips          — FFmpeg 剪輯後的短影音
//                  欄位：_id, segmentId, courseId,
//                        clipUrl, keyPoints[], jumpUrl, hitCount
//
// enrollments    — 學生選課紀錄
//                  欄位：_id, studentId, courseId,
//                        enrolledAt, progress, lineState
//
// usage_logs     — 使用者行為紀錄（設有 90 天 TTL）
//                  欄位：_id, userId, courseId,
//                        event, durationSec, timestamp
// ============================================================
