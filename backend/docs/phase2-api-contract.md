# Phase 2 API Contract

最後更新：2026-10-24

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

### 1.x FAQ 快取

FAQ 快取保留可重用的答案，API 與 LINE 共用（`faqs` 集合＋`faqCache.service.js`）：

- **命中條件**：正規化後文字完全相同直接命中；否則以問題向量和課程 FAQ 比較餘弦相似度，達 `FAQ_CACHE_SIMILARITY_THRESHOLD`（預設 0.95）即命中，跳過向量搜尋與模型生成。命中時 `runtime.faqCache.hit=true`、`answerProviderUsed='faq_cache'`，仍照常寫 `usage_logs` 與 `questions`。
- **寫入條件**：只快取 runtime ready 且沒有對話歷史的回答。`answerGeneration.service.js` 的 `isNoAnswerReply()` 辨識「答不出來」的罐頭回覆（`NO_ANSWER_INSUFFICIENT`、`NO_ANSWER_UNDETERMINED`），這類回覆不快取。改罐頭文案時改常數，不改提示詞內的字面字串；提示詞只插入 `NO_ANSWER_INSUFFICIENT`，`NO_ANSWER_UNDETERMINED` 只用來辨識改版前的舊答案。
- **失效**：沒有 TTL，只在影片刪除、影片重新處理完成、課程刪除、影片掛載到課程或自課程移除時清除該課程快取；單一課程超過 `FAQ_CACHE_MAX_ENTRIES_PER_COURSE` 時淘汰 `hitCount` 最低者。人工清除用 `DELETE /api/v1/courses/:courseId/faqs`，執行前確認授權與目標課程。
- **修改注意**：改 QA 回應格式時，命中路徑 `respondFromFaqCache` 要同步；測試非快取路徑可設 `FAQ_CACHE_ENABLED=false` 或避免同題重問。

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

### 2.x 影片資料來源與片段綁定

`videos` 是混合集合：課程影片有 `courseId`、`uploadedBy`、`title`、`processing.status`；只有 `video_id` 或 `videoId` 的是 Pipeline 處理資訊，不是課程影片。

- **文字片段**：[範圍服務](../src/services/bridgeScope.service.js)依「課程可存取影片 → `String(videos._id)` → `video_segments_text.videoId`」建立允許範圍；`addVideoIdentifiers` 只加入影片 `_id`。
- **影像片段**：以 `video_segments_video.video_id = String(videos._id)` 綁定課程影片，欄位仍是 snake_case；舊 `video_001` 類識別碼另有檔名／路徑配對邏輯。兩者的識別碼規則不能互相套用。

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
- 本機檔案 auto-upload：教師上傳本地影片並完成 STT / embedding 後，若 `YOUTUBE_UPLOAD_ENABLED=true` 且 OAuth 設定完整，backend 會用 FocusFlow 系統 YouTube 帳號走 Data API resumable upload，再把 `youtubeVideoId` / `videoUrl` 寫回同一筆 `Video`。

Phase 2 自動上傳流程定義如下：

1. 教師上傳本地影片到 backend。
2. 後端先完成同課程 mp4 SHA-256 去重。
3. 後端建立 `Video`，processing 狀態為 `queued`，並以 `/uploads/<file>` 作為本機播放來源。
4. 單支或 batch pipeline 執行 STT、切段與 embedding；completion callback 先把 processing 持久化為 `completed`。
5. 若 `YOUTUBE_UPLOAD_ENABLED=true`，completion side effect 才排程 FocusFlow 系統 YouTube 帳號上傳；重複 callback 由 process-local single-flight 與 DB atomic claim 避免重複建立影片。
6. YouTube 回傳 id 後，後端在同一筆 `Video` 保存：
   - `youtubeVideoId`
   - `videoUrl=https://www.youtube.com/watch?v=<id>`
   - `sourceUrl=https://www.youtube.com/watch?v=<id>`
   - `sourceType=upload`
   - `videoSource=youtube`
   - `YOUTUBE_UPLOAD_PRIVACY_STATUS=unlisted`
7. YouTube 上傳失敗只更新 `youtubeUpload` lifecycle，processing 維持 `completed`，本機播放來源也保留。
8. 只有在 YouTube upload 與 processing 都完成後，才允許清理 `backend/uploads` 原始檔；清理前先把播放欄位切到 YouTube，並拒絕 `UPLOAD_DIR` 外路徑或仍被其他 Video 共用的檔案。
   短影片成品（`ShortAsset`）同一套排程清理，但只清**已上架或已封存**且 YouTube 上傳完成的成品，保留期從 `youtubeUpload.uploadedAt` 起算，也拒絕與其他成品或影片共用的檔案。清理後 `filePath` **保留**，改記 `youtubeUpload.localCleanupAt`（失敗記 `localCleanupError`），因為上傳排程、退回轉私人與核准上架都以 `filePath` 有值判斷是否為教師上傳的成品；之後重新上傳會回 `SHORT_ASSET_SOURCE_FILE_MISSING`。短片不提供補回原片。短片上傳 YouTube 時描述欄末尾固定加一行 `(FocusFlow short <成品ID>)`，供管理員比對頻道上傳清單；依據見[設計決策](../../docs/04_Features/YouTube_Lifecycle/decisions.md) #28～#32。
9. OAuth/session 建立等「確認尚未傳送影片 bytes」的失敗才可有限重試；上傳串流開始後的錯誤一律標記 `retrySafe=false`。恢復排程發現卡在 `uploading` 的項目也只隔離、不自動重送，交由管理員在待處理清單收尾（見 4.1）。

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
YOUTUBE_UPLOAD_RECOVERY_INTERVAL_MS=300000
YOUTUBE_UPLOAD_MAX_ATTEMPTS=3
YOUTUBE_UPLOAD_RETRY_BASE_MS=60000
YOUTUBE_UPLOAD_RECOVERY_BATCH_SIZE=5
YOUTUBE_UPLOAD_STUCK_AFTER_MS=900000
YOUTUBE_UPLOAD_CLEANUP_ENABLED=false
YOUTUBE_UPLOAD_CLEANUP_INTERVAL_MS=3600000
YOUTUBE_UPLOAD_CLEANUP_MAX_AGE_DAYS=180
YOUTUBE_UPLOAD_CLEANUP_MIN_FREE_GB=10
YOUTUBE_UPLOAD_CLEANUP_MIN_AGE_DAYS=14
```

預設策略：

- `visibility`：`unlisted`，避免公開發布未審核影片。
- Shorts：不要自動判定；由 Clip/Shorts job 決定是否發布為 Shorts。
- playlist：可選，等課程/教師分流策略定版後再啟用。
- recovery 與 uploads 清理：兩個 feature flag 都預設關閉；先觀察 `/health.runtime.youtubeUpload` 與持久化的 `youtubeUpload` 狀態，再由部署者明確開啟。上傳、恢復、清理都是兩層開關（環境變數＋管理員執行期開關），規則見[功能開關](feature-flags.md)。

### 4.1 恢復、隔離收尾與原片清理

設計依據見[設計決策](../../docs/04_Features/YouTube_Lifecycle/decisions.md)；request／response schema 以 [OpenAPI](openapi.yaml) 為準。

| 方法與路徑 | 用途 | 權限 |
|---|---|---|
| `GET`／`PATCH /admin/youtube-lifecycle/settings` | 三個開關的環境允許、執行期設定、實際生效值與原因，加最近 50 筆修改紀錄；`PATCH { key, enabled }` 回傳與 `GET` 相同的完整內容 | admin |
| `GET /admin/youtube-lifecycle/cleanup-preview?scope=enable\|upcoming` | 啟用清理後會立即刪除的清單，或 7 天內到期的清單 | admin |
| `POST /admin/youtube-lifecycle/recovery/run` | 立即執行一輪恢復；`skipped` 是撈到但這一輪沒處理的筆數。整輪沒有執行時回 `409 YOUTUBE_RECOVERY_NOT_RUN`，`error.details.reason` 為 `recovery_disabled`、`upload_not_configured`、`upload_disabled` 或 `already_running` | admin |
| `GET /admin/youtube-quarantine` | 待處理清單：`youtubeUpload.status=failed`、尚無 YouTube ID 的影片與短片，每筆 `reason` 標示原因：`quarantined`＝`retrySafe` 不是 `true`；`retry_limit`＝`retrySafe=true` 但 `attemptCount` 已達 `YOUTUBE_UPLOAD_MAX_ATTEMPTS`。`data.searchable` 表示憑證能否讀頻道 | admin |
| `POST /admin/youtube-quarantine/{videos\|short-assets}/:id/lookup` | 只接受 `quarantined`：用描述標記比對自家頻道上傳清單，只回傳 `{ searchable, matches }`，最多往回看 1000 支 | admin |
| `POST /admin/youtube-quarantine/{videos\|short-assets}/:id/apply` | 只接受 `quarantined`：`{ youtubeVideoId }`，先向 YouTube 確認影片存在、屬於自家頻道且未被其他項目使用，再標成上傳完成並切換播放；完成後通知上傳的教師 | admin |
| `POST /admin/youtube-quarantine/{videos\|short-assets}/:id/reset` | 兩種原因都接受：確定沒有上傳、或已達上限且原因已排除時使用，重設為可安全重試、次數歸零、重試時間設為現在，由恢復排程重新上傳；完成後通知上傳的教師 | admin |
| `POST /videos/:videoId/source/restore` | 補回原片（multipart 欄位 `video`）：只接受已清理的影片，影片 ID 不變、不重新上傳 YouTube，保留期從補回時間起算 | 課程教師、admin |

- 查詢與套用需要讀自家頻道的權限（`youtube.force-ssl`）；憑證只有 `youtube.upload` 時，查詢回 `searchable: false`，套用會回 `502 YOUTUBE_QUARANTINE_VERIFY_FAILED`。
- `retry_limit` 的失敗都發生在送出影片內容之前，YouTube 上確定沒有這支，所以不提供查詢與套用（回 `409 YOUTUBE_QUARANTINE_NOT_ALLOWED`），只能重設（[設計決策](../../docs/04_Features/YouTube_Lifecycle/decisions.md) #34）。教師重試已達上限的項目仍回 `409 YOUTUBE_UPLOAD_RETRY_LIMIT_REACHED`，畫面提示已通知管理員。
- 影片或短片被隔離、或最後一次可安全重試的失敗達到上限時，通知所有啟用中的管理員（來源 `youtube_upload_needs_review`），同一次失敗只通知一次；收尾後通知教師（`youtube_upload_resolved`，短片附 `scriptId`）。
- 課程影片清單與 `GET /admin/videos` 的每支影片附 `sourceAvailable`；前端只有在 `sourceAvailable=false` 且有 `youtubeUpload.localCleanupAt` 時才視為原片已清理並提供補回。
- 系統狀態 `/admin/system-status` 另有 `youtube_lifecycle` 列，顯示待處理與 7 天內到期刪除的數量。
- 清理預告是查詢當下的估算。預告與實刪共用 Video／ShortAsset 的實體檔案引用檢查；相對路徑以 backend 根目錄解析，根外、根目錄本身與經 symlink／junction 的來源拒絕清理。任何草稿、處理中或其他引用都會保護同檔來源。
- 每支低空間候選在刪除前重新讀取可用空間，未知或已達門檻即略過；超最長保留期仍獨立處理。每次 unlink 前重查清理開關，停用或設定讀取失敗即停止。刪檔成功但資料庫收尾失敗時，下輪以缺檔狀態補寫，不重複計算釋放量。

權限與隱私限制：

- 刪除影片時轉為私人影片，需 OAuth 權限屬於[上傳服務](../src/services/youtubeUpload.service.js)的 `PRIVACY_CAPABLE_SCOPES`（例如 `youtube.force-ssl`）；只有 `youtube.upload` 不足以轉私人。
- `privatizeVideoOnDelete` 只處理 `youtubeUpload.status === 'uploaded'` 的影片；轉私人失敗只記錄錯誤、不中斷系統刪除，所以不能保證 YouTube 影片必定下架。
- `unlisted` 是知道連結即可觀看；課程權限不能阻止取得連結的人轉貼。

## 5. 已完成與待定版

已完成：

- QA `citations[]` / `answerStatus` response contract。
- QA cost guardrails：`QA_MONTHLY_TOKEN_BUDGET`、`QA_USER_MONTHLY_TOKEN_QUOTA`、`QA_ESTIMATED_TOKENS_PER_ASK`；超額回 `429 QA_QUOTA_EXCEEDED`，成功 ASK 會寫入 `UsageLog.metadata.costControl`。
- UsageLog / Question 歷史保留，dashboard display 分流。
- 同課程重複 YouTube URL 與相同 mp4 SHA-256 防呆。
- 本機檔案 YouTube auto-upload adapter：OAuth refresh token、resumable upload、`youtubeVideoId` / `videoUrl` 寫回路徑與測試。
- YouTube 上傳有限恢復與安全清理：`POST /videos/:videoId/youtube-upload/retry`、pre-byte-only retry、stale upload quarantine、attempt/backoff 狀態、完成後 path/shared-reference guard，以及 health diagnostics；recovery/cleanup 預設關閉。
- YouTube 恢復與清理第二版（2026-10-20，本機測試）：兩層開關、定期恢復與清理排程、管理員隔離收尾、刪除預告、補回原片、短片成品納入，見 4.1。
- `db:ensure-questions` / `db:backfill-questions` scripts 補齊。
- `/health.runtime.qa.costControl` 監控 snapshot，顯示 guardrails 是否啟用與 UTC 月重置口徑。
- `/health.runtime.multimodal` 監控 snapshot，顯示 `video_segments_video` / `video_embedding_index` 狀態與目前 QA 接入邊界。
- `video_segments_video` 初版 visual citation retrieval：backend 會從 course-scoped videos 的檔名 / URL 解析 pipeline visual ID，並用 Atlas `video_embedding_index` + `video_id` filter 檢索同課程視覺片段；回覆標示 `modality=video`、`clipPath` 與 timestamp citation。
- Video presentation ownership：`ownership=app_owned|pipeline_metadata`、`isAppOwned`、`metadataOnly` 已固定為前端/LINE 共用語意。
- `ShortAsset` model、內部 create/update service、修課限定學生 feed、Course hard delete idempotent 封存與 best-effort rollback。
- YouTube metadata `videos.list` 批次同步、retry/backoff、結構化 unavailable log 與 `/health.runtime.shortsSync` 診斷。

待定版：

- recovery／cleanup 開啟後的正式環境驗收與長期觀察（本機測試只用測試替身，沒有呼叫 YouTube live API，也沒有清正式檔案）。
- 跨課程共用同一支影片的多對多資料模型。
- mixed `videos` collection 是否拆分為 app-owned / pipeline-owned 實體 collection。
- Clip candidate/job、自動選片、FFmpeg／字幕、Short 發布與教師管理 endpoints/background workers。
- 視覺片段 caption / OCR / frame description；目前 visual retrieval 只提供 citation，不生成畫面內容。

## Cookie 認證契約

依 [httpOnly 決策第 1～25 項](../../docs/04_Features/HttpOnly_Cookie/decisions.md)。所有登入／驗證回應均為 `Cache-Control: no-store`；瀏覽器 body 不含 JWT。

| 呼叫 | 結果 |
|---|---|
| `POST /auth/login` | 腳本用，body `{ token, user }`，不設 cookie；拒絕 Origin、Sec-Fetch-Site、Sec-Fetch-Dest，允許 Node fetch 的 Sec-Fetch-Mode |
| `POST /auth/session`、`POST /auth/register` | 瀏覽器用，需可信 Origin 與 `X-Requested-With: FocusFlow`；成功只設 session cookie，body `{ user }` |
| 尚須驗證 | body `{ requiresVerification: true, purpose, maskedEmail, codeVerified, remainingResends }`，只設 pending cookie；腳本回 `403 VERIFICATION_REQUIRED` |
| `POST /auth/pending/verify` | `{ code, trustDevice?: boolean }`；first_login 回新的 pending（codeVerified=true），其他流程發 session |
| `POST /auth/pending/resend` | 無間隔、最多重寄五次；回剩餘次數，不延長原期限、不歸零猜碼次數 |
| `POST /auth/pending/password` | `{ newPassword, trustDevice?: boolean }`；只收已驗證的 first_login，完成後換正式 session |
| `DELETE /auth/pending` | 取消並清 pending cookie，204 |
| `DELETE /auth/session` | 冪等撤銷目前 sid，204；Bearer 與 cookie 並存時只處理 Bearer、不清 cookie |
| `POST /auth/logout-all` | 先遞增版本再刪全部 session，204；撤銷信任裝置、pending、step-up |
| `POST /auth/step-up` | admin 瀏覽器用 `{ password }`，204、只設 step-up cookie；5 分鐘內可用於敏感操作 |
| `PATCH /auth/me/password` | cookie 模式換新 session；腳本回新 `{ token, user }`；其他 session 撤銷 |
| 忘記密碼 confirm | 只改密碼、撤銷其他憑證，不發 session，使用者重新登入 |

舊帳號缺 mustChangePassword 視為 true，必須先驗證再改密碼；非 production 略過寄信，但必要的首次改密碼仍用 codeVerified=true 的 pending 完成。新自行註冊設 false，CSV 建立設 true。第一次驗證成功寫 emailVerifiedAt。所有密碼入口至少八碼、至少一個英文字母，不能與目前密碼相同。

`remainingResends` 為 0 後仍可使用已寄出的未過期碼；額度保存在帳號，不因重新登入而重置。寄信暫停回 `429 VERIFICATION_MAIL_PAUSED`，公開 details 含 `remainingResends: 0`、`retryAfterSec`。pending 與忘記密碼各有獨立的計數。信任裝置只限 admin，最多五台、七天，cookie 明文不存入資料庫或稽核。

`authenticate` 每次驗證 session 紀錄與 User.tokenVersion；任何相關儲存故障均拒絕，不退回只驗 JWT。LINE webhook 與 internal processing webhook 沿用各自驗證，忽略 cookie。

管理員實際將學生／教師升為 admin 時，操作人須通過瀏覽器 step-up；目標帳號的角色與 tokenVersion 在同次更新中變更，再刪除全部 session，pending、step-up 與信任裝置也失效。目標帳號重新走 admin 登入及信箱兩段式驗證，新 session 為 12 小時；原 admin 只改姓名或傳入未變的 role 不撤銷。刪除 session 故障回 503 時，已遞增的版本仍會擋住舊憑證。

### 索引與隔離測試

正式環境由使用者確認目標與授權後，使用限 authSessions 的帳號設定 `AUTH_SESSIONS_MONGODB_URI`，執行 `npm.cmd run db:ensure-auth-sessions -- --database focusflow`。腳本不載入應用程式 .env、不初始化其他 model，只建立 collection 與缺少的 userId／expiresAt TTL 索引；現有設定衝突會報錯停止，不刪除或重建。

本機隔離 Mongo 的連線必須是明確 loopback 與 port，例如 PowerShell 設 `$env:AUTH_TEST_MONGODB_URI='mongodb://127.0.0.1:27028'`，再跑 `npm.cmd run test:auth-mongo`。測試只用隨機 `focusflow_auth_test_*` 資料庫並清理，禁止 Atlas URI；測 TTL 時以獨立 mongod 的 `ttlMonitorSleepSecs=1` 縮短等待，不改正式設定。

本機瀏覽器可設定 `$env:AUTH_BROWSER_FIXTURE='local-only'`，執行 `node integration/auth.browser.cjs`，另啟動前端 Vite。此 fixture 只在 `127.0.0.1:4000` 使用記憶體 model 與假寄信；`127.0.0.1:4001` 可讀取假信驗證碼，`POST /reset?production=true&firstLoginRole=admin` 可重建 admin 首次登入情境，`POST /shutdown` 會關閉服務並清理專用上傳暫存目錄。它不載入 `server.js`、不連 Mongo、不寄真信或啟動 STT；production 參數只切換認證設定，正式 TLS、寄信送達與外部進站仍須另行驗收。

adminAuditLogs 另以使用者明確授權的帳號設定 `AUTH_AUDIT_MONGODB_URI`，執行 `npm.cmd run db:ensure-auth-audit -- --database focusflow`。此帳號須有該集合的 createCollection 權限；authSessionsIndexer 不能代替。應用程式的新 model 都不在啟動時建集合或索引。
