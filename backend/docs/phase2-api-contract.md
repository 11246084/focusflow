# Phase 2 API Contract

最後更新：2026-09-05

本文件收斂 Notion「後端開發」Phase 2 任務的 API 回傳語意。它不是完整 OpenAPI 取代品；正式欄位仍以 `backend/docs/openapi.yaml` 與 route files 為準。

## 1. QA 回答契約

`POST /api/v1/qa/ask` 回傳主體：

```json
{
  "answer": "string",
  "matches": [],
  "citations": [],
  "answerStatus": {},
  "clip": null,
  "runtime": {}
}
```

欄位語意：

| 欄位 | 用途 |
|------|------|
| `answer` | 使用者可直接看的答案或無答案提示 |
| `matches[]` | legacy/debug retrieval candidates；不等於回答實際使用的引用 |
| `citations[]` | 使用者可見來源的唯一正式欄位；只包含答案生成器明確選用、且仍可播放的教材 evidence，不等同全部 retrieval matches |
| `answerStatus` | 前端與 LINE 的狀態分流欄位 |
| `runtime` | 後端診斷與 fallback 訊號 |

`answerStatus`：

```json
{
  "status": "answered | no_answer",
  "isAnswerable": true,
  "matchStatus": "matched | no_relevant_match | no_searchable_segments",
  "confidence": "high | medium | low | none",
  "noAnswerReason": null
}
```

無答案狀態：

| `matchStatus` | `answerStatus.status` | `noAnswerReason` | UI 建議 |
|------|------|------|------|
| `matched` | `answered` | `null` | 顯示答案與 citations |
| `no_relevant_match` | `no_answer` | `NO_RELEVANT_MATCH` | 顯示「找不到足夠相關片段」，可引導換問法 |
| `no_searchable_segments` | `no_answer` | `NO_SEARCHABLE_SEGMENTS` | 顯示「影片尚未完成索引或目前只有 metadata」 |

若答案生成器回覆正式無答案字串，即使 `runtime.matchStatus` 仍為 `matched`
（代表 retrieval 曾取得候選片段），`answerStatus` 仍必須回傳
`no_answer / no_relevant_match`，`citations[]` 與 `clip` 必須為空。
多輪 conversation 的 `sources[]` 只能由最終 `citations[]` 轉換，不得直接回傳 raw `matches[]`。
成功回答的 `citations[]` 也必須由答案生成器回傳的 opaque evidence ID 映射；未知、缺漏或不在目前 context 的 ID 必須 fail closed，不能把全部 `matches[]` 自動升格為引用。

`citations[]` 單筆格式：

```json
{
  "citationId": "C1",
  "segmentId": "segment-id",
  "videoId": "video-id",
  "videoTitle": "Published Video",
  "sourceVideo": {
    "videoId": "video-id",
    "title": "Published Video",
    "sourceUrl": "/uploads/file.mp4",
    "videoUrl": "/uploads/file.mp4",
    "youtubeVideoId": null
  },
  "timestamp": {
    "startSec": 12,
    "endSec": 32,
    "label": "0:12",
    "jumpUrl": null
  },
  "match": {
    "status": "matched",
    "score": 0.83,
    "confidence": "high"
  },
  "transcriptSnippet": "..."
}
```

## 2. Video / Course 顯示狀態

影片列表與 QA 需要分開看：

| 概念 | 欄位 / 訊號 | 說明 |
|------|------|------|
| 可觀看 | `videoUrl` / `sourceUrl` / `youtubeVideoId` | 前端播放器是否有可用來源 |
| 可提問 | `processingStatus=completed` + searchable segments | QA 是否有文字片段可查 |
| metadata-only | `metadataOnly=true` | 只有 pipeline / bridge metadata，不應 fallback 到 `/uploads` |
| QA-only 課程 | `qaScopeOnly=true` / `bridgeMode=qa_scope_only` | 可作問答範圍，不代表完整影片管理體驗 |
| ownership | `ownership=app_owned | pipeline_metadata` | 明確標示 mixed `videos` collection 中的後端管理邊界 |
| 內容已下架 | dashboard `contentMissing=true` | 歷史紀錄保留，但顯示層標示不可操作 |

展示規則：

- 學生 Recent Queries：保留歷史，若來源不存在顯示「內容已下架」。
- 老師 Top Segments：只顯示仍可操作的影片片段，過濾已刪除來源。
- 管理員 Recent Events：保留稽核歷史，若來源不存在顯示已刪除標籤。

## 3. Clip / Shorts 契約（部分已實作）

目前已實作的是 `ShortAsset` 儲存層、內部建立／更新 service、學生修課限定 feed、課程 hard delete 封存、YouTube metadata 同步與 health 診斷。自動選片、Clip candidate/job、FFmpeg 剪輯、自動字幕、YouTube 發布 worker、教師管理 API/UI 仍未實作。

Phase 2 不再新增零散卡片，統一用三層語意：

| 資源 | 用途 | 建議狀態 |
|------|------|------|
| Clip candidate | 從 QA/segments 找到的候選短片段 | `candidate`, `rejected`, `promoted` |
| Clip job | 實際產生短片的背景任務 | `queued`, `processing`, `completed`, `failed` |
| Shorts asset | 可發布或已發布的短影片成果 | `draft`, `ready`, `published`, `archived` |

### 3.1 Clip candidate

候選片段是「可被剪成短片」的來源，不等於已產生影片檔。

```json
{
  "candidateId": "clipcand_...",
  "courseId": "507f...",
  "segmentId": "segment-one",
  "sourceVideoId": "507f...",
  "sourceExternalVideoId": "video-published-001",
  "startSec": 12,
  "endSec": 32,
  "transcriptSnippet": "JWT authentication and role based access control...",
  "score": 0.82,
  "createdFromQuestionId": "507f...",
  "status": "candidate",
  "rejectedReason": null,
  "createdAt": "2026-07-10T00:00:00.000Z"
}
```

狀態轉移：

- `candidate -> promoted`：teacher/admin 決定產生短片 job。
- `candidate -> rejected`：teacher/admin 明確拒絕；需保存 `rejectedReason`。
- `rejected -> candidate`：允許 undo，但不自動建立 job。
- `promoted` 不直接退回；若要重新產生，建立新的 job。

### 3.2 Clip job

Clip job 是背景任務。它持有輸入範圍、處理狀態與錯誤資訊；不直接代表可播放成果。

```json
{
  "jobId": "clipjob_...",
  "candidateId": "clipcand_...",
  "courseId": "507f...",
  "requestedBy": "507f...",
  "status": "queued",
  "source": {
    "videoId": "507f...",
    "startSec": 12,
    "endSec": 32
  },
  "attemptCount": 0,
  "outputUrl": null,
  "errorCode": null,
  "errorMessage": null,
  "queuedAt": "2026-07-10T00:00:00.000Z",
  "startedAt": null,
  "completedAt": null,
  "failedAt": null
}
```

狀態轉移：

- `queued -> processing -> completed`
- `queued -> failed`
- `processing -> failed`
- `failed -> queued`：僅 owner teacher/admin 可 retry；保留 `attemptCount`。
- `completed` 不可直接重跑；若輸入或模板改變，建立新 job。

### 3.3 Shorts asset（已實作儲存層）

Shorts asset 是可管理的短影片成果。它可能只是 local/cloud draft，也可能已發布到 YouTube。

```json
{
  "assetId": "short_...",
  "jobId": "clipjob_...",
  "courseId": "507f...",
  "sourceVideoId": "507f...",
  "title": "JWT auth overview",
  "description": "FocusFlow auto-generated short",
  "status": "draft",
  "youtubeVideoId": "youtube-id",
  "youtubeUrl": "https://www.youtube.com/watch?v=youtube-id",
  "thumbnail": "https://i.ytimg.com/vi/youtube-id/hqdefault.jpg",
  "publishedAt": "2026-07-18T00:00:00.000Z",
  "archivedAt": null,
  "archivedBy": null,
  "archiveReason": null,
  "statusBeforeArchive": null,
  "courseSnapshot": null,
  "youtubeAvailability": "playable",
  "youtubePrivacyStatus": "unlisted",
  "lastCheckedAt": "2026-07-18T00:00:00.000Z"
}
```

索引：

- `{ courseId: 1, status: 1, youtubeAvailability: 1, publishedAt: -1, _id: -1 }`
- `{ youtubeVideoId: 1 }`（`unique + sparse`；缺值時不持久化 `null`）

學生 feed：`GET /api/v1/youtube/shorts` 需要 Bearer JWT 且只允許 student。可見集合固定為 `Enrollment ∩ Course.status=published ∩ ShortAsset.status=published ∩ youtubeAvailability=playable`，以 `publishedAt + _id` opaque cursor 降冪分頁；預設 20、最多 50 筆，非法或重複 token 回 400。內部 create/update 在進入 published+playable 前強制要求非空 `youtubeVideoId` 與有效 `publishedAt`，feed 也會排除 legacy 異常資料。回傳保留 `videoId/title/thumbnail/publishedAt/nextPageToken`，並新增 `assetId`、`course: { courseId, title }`、`youtubeUrl`。

課程生命週期：

- Course 改成 `archived` 時不修改 ShortAsset；feed 會因 Course status 自動隱藏，恢復 `published` 後重新顯示。
- Course hard delete 時，在既有 cascade 成功後、`Course.deleteOne()` 前 idempotent 封存該課程尚未封存的 ShortAsset，保存最小 `courseSnapshot`；Course 刪除失敗時只 best-effort 還原本輪封存，不提供 transaction/atomicity 保證，也不刪除 ShortAsset。

YouTube metadata 同步只使用 `YOUTUBE_API_KEY` 呼叫 `videos.list`（每批最多 50 IDs）。`SHORTS_SYNC_INTERVAL_MS` 預設 600000，設 0 停用；startup、interval 與直接呼叫共用 single-flight promise，避免重疊消耗 quota 或舊結果覆寫新狀態。只有 public/unlisted 會標為 playable；private 或成功回應中缺少 ID 會標為 unavailable。網路、429、5xx 依 Retry-After 或 1s/2s/4s+jitter 最多重試三次；400/401/404 與 quotaExceeded 不重試。暫時性整批失敗保留上次成功 availability/privacy，只更新 `lastCheckedAt`。`youtube_video_not_returned` 與 `private` 原因只寫結構化 server log，不持久化到 ShortAsset。

狀態轉移：

- `draft -> ready`：短片檔案已產生並通過 basic validation。
- `ready -> published`：透過 YouTube 發布成功並保存 `youtubeVideoId` / `youtubeUrl`。
- `draft|ready|published -> archived`：不再於前端主列表顯示；歷史仍保留。

### 3.4 權限與預留端點

權限：

- student：只能透過 `GET /api/v1/youtube/shorts` 讀取自己已修課、課程已發布、asset 已發布且 YouTube 狀態可播放的 Shorts；不可建立 / 發布 / archive。
- teacher：可管理自己課程的 candidate、job、asset。
- admin：可管理所有課程的 candidate、job、asset。
- metadata-only / QA-only bridge video：可產生 candidate，但在沒有可剪輯來源檔前不得建立 job，需回 `CLIP_SOURCE_NOT_FOUND` 或 `CLIP_SOURCE_NOT_ACTIONABLE`。

預留管理端點（尚未實作，先作為 Phase 2 contract；不包含已實作的學生 feed）：

| Endpoint | 用途 |
|------|------|
| `GET /api/v1/courses/:courseId/clip-candidates` | 列出課程候選片段 |
| `POST /api/v1/clip-candidates/:candidateId/jobs` | 將 candidate promoted 並建立 clip job |
| `GET /api/v1/clip-jobs/:jobId` | 讀取 job 狀態 |
| `POST /api/v1/clip-jobs/:jobId/retry` | 重試 failed job |
| `GET /api/v1/courses/:courseId/shorts` | 列出課程 Shorts assets |
| `POST /api/v1/shorts/:assetId/publish` | 發布 ready asset 到 YouTube |
| `POST /api/v1/shorts/:assetId/archive` | 封存 asset |

建議錯誤碼：

| 錯誤碼 | 情境 |
|------|------|
| `CLIP_SOURCE_NOT_FOUND` | candidate 指向的 segment/video 不存在 |
| `CLIP_SOURCE_NOT_ACTIONABLE` | candidate 來自 metadata-only / QA-only source，沒有可剪輯來源檔 |
| `CLIP_JOB_NOT_READY` | job 尚未完成但被讀取成果 |
| `CLIP_JOB_TRANSITION_INVALID` | job 狀態轉移不合法 |
| `SHORTS_PUBLISH_NOT_CONFIGURED` | 尚未設定 YouTube 發布憑證 |
| `SHORTS_ASSET_NOT_READY` | asset 尚未 ready 就要求發布 |
| `SHORTS_PERMISSION_DENIED` | 使用者不是課程 owner/admin |

## 4. YouTube 系統帳號上傳流程

目前有兩條路徑：

- YouTube URL MVP：教師先手動上傳 YouTube，再貼 URL，後端保存 `youtubeVideoId` / `videoUrl` 並觸發 STT。
- 本機檔案 auto-upload：教師上傳本地影片後，若 `YOUTUBE_UPLOAD_ENABLED=true` 且 OAuth 設定完整，backend 會用 FocusFlow 系統 YouTube 帳號走 Data API resumable upload，再把 `youtubeVideoId` / `videoUrl` 寫回同一筆 `Video`。

Phase 2 自動上傳流程定義如下：

1. 教師上傳本地影片到 backend。
2. 後端先完成同課程 mp4 SHA-256 去重。
3. 若 `YOUTUBE_UPLOAD_ENABLED=true`，用 FocusFlow 系統 YouTube 帳號上傳。
4. YouTube 回傳 `youtubeVideoId` 後，後端建立 `Video`，狀態為 `queued`，並保存：
   - `youtubeVideoId`
   - `videoUrl=https://www.youtube.com/watch?v=<id>`
   - `sourceUrl=https://www.youtube.com/watch?v=<id>`
   - `sourceType=upload`
   - `videoSource=youtube`
   - `YOUTUBE_UPLOAD_PRIVACY_STATUS=unlisted`
5. STT / embedding processing 繼續以本地暫存檔接續，避免重新下載剛上傳的影片。
6. 只有在 YouTube 上傳成功且 STT/embedding 已完成後，才允許清理 `backend/uploads` 原始檔；清理前先把播放欄位切到 YouTube，並拒絕 `UPLOAD_DIR` 外路徑或仍被其他 Video 共用的檔案。
7. OAuth/session 建立等「確認尚未傳送影片 bytes」的失敗才可有限重試；上傳串流開始後的錯誤一律標記 `retrySafe=false`。啟動後發現 stale `uploading` 也只隔離並要求人工確認 YouTube Studio，不自動重送。

建議環境變數：

```env
YOUTUBE_UPLOAD_ENABLED=false
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REFRESH_TOKEN=
YOUTUBE_UPLOAD_ACCESS_TOKEN=
YOUTUBE_UPLOAD_PRIVACY=unlisted
YOUTUBE_UPLOAD_CATEGORY_ID=27
YOUTUBE_UPLOAD_RECOVERY_ENABLED=false
YOUTUBE_UPLOAD_MAX_ATTEMPTS=3
YOUTUBE_UPLOAD_RETRY_BASE_MS=60000
YOUTUBE_UPLOAD_RECOVERY_BATCH_SIZE=5
YOUTUBE_UPLOAD_STUCK_AFTER_MS=900000
YOUTUBE_UPLOAD_CLEANUP_ENABLED=false
```

預設策略：

- `visibility`：`unlisted`，避免公開發布未審核影片。
- Shorts：不要自動判定；由 Clip/Shorts job 決定是否發布為 Shorts。
- playlist：可選，等課程/教師分流策略定版後再啟用。
- recovery 與 uploads 清理：兩個 feature flag 都預設關閉；先觀察 `/health.runtime.youtubeUpload` 與持久化的 `youtubeUpload` 狀態，再由部署者明確開啟。

## 5. 已完成與待定版

已完成：

- QA `citations[]` / `answerStatus` response contract。
- QA cost guardrails：`QA_MONTHLY_TOKEN_BUDGET`、`QA_USER_MONTHLY_TOKEN_QUOTA`、`QA_ESTIMATED_TOKENS_PER_ASK`；超額回 `429 QA_QUOTA_EXCEEDED`，成功 ASK 會寫入 `UsageLog.metadata.costControl`。
- UsageLog / Question 歷史保留，dashboard display 分流。
- 同課程重複 YouTube URL 與相同 mp4 SHA-256 防呆。
- 本機檔案 YouTube auto-upload adapter：OAuth refresh token、resumable upload、`youtubeVideoId` / `videoUrl` 寫回路徑與測試。
- YouTube 上傳有限恢復與安全清理：`POST /videos/:videoId/youtube-upload/retry`、pre-byte-only retry、stale upload quarantine、attempt/backoff 狀態、完成後 path/shared-reference guard，以及 health diagnostics；recovery/cleanup 預設關閉。
- `db:ensure-questions` / `db:backfill-questions` scripts 補齊。
- `/health.runtime.qa.costControl` 監控 snapshot，顯示 guardrails 是否啟用與 UTC 月重置口徑。
- `/health.runtime.multimodal` 監控 snapshot，顯示 `video_segments_video` / `video_embedding_index` 狀態與目前 QA 接入邊界。
- `video_segments_video` 初版 visual citation retrieval：backend 會從 course-scoped videos 的檔名 / URL 解析 pipeline visual ID，並用 Atlas `video_embedding_index` + `video_id` filter 檢索同課程視覺片段；回覆標示 `modality=video`、`clipPath` 與 timestamp citation。
- Video presentation ownership：`ownership=app_owned|pipeline_metadata`、`isAppOwned`、`metadataOnly` 已固定為前端/LINE 共用語意。
- `ShortAsset` model、內部 create/update service、修課限定學生 feed、Course hard delete idempotent 封存與 best-effort rollback。
- YouTube metadata `videos.list` 批次同步、retry/backoff、結構化 unavailable log 與 `/health.runtime.shortsSync` 診斷。

待定版：

- recovery／cleanup feature flag 開啟後的正式環境長期觀察（本輪沒有呼叫 YouTube live API，也沒有清正式檔案）。
- 跨課程共用同一支影片的多對多資料模型。
- mixed `videos` collection 是否拆分為 app-owned / pipeline-owned 實體 collection。
- Clip candidate/job、自動選片、FFmpeg／字幕、Short 發布與教師管理 endpoints/background workers。
- 視覺片段 caption / OCR / frame description；目前 visual retrieval 只提供 citation，不生成畫面內容。
