# Phase 2 API Contract

最後更新：2026-07-10

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
| `matches[]` | legacy/debug 命中片段，保留給既有前端與測試 |
| `citations[]` | Phase 2 顯示來源的主要欄位，包含 source video、timestamp、jump URL、confidence、snippet |
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

## 3. Clip / Shorts 契約草案

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

### 3.3 Shorts asset

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
  "assetUrl": "https://storage.example/short.mp4",
  "youtubeVideoId": null,
  "youtubeUrl": null,
  "visibility": "unlisted",
  "createdAt": "2026-07-10T00:00:00.000Z",
  "publishedAt": null
}
```

狀態轉移：

- `draft -> ready`：短片檔案已產生並通過 basic validation。
- `ready -> published`：透過 YouTube 發布成功並保存 `youtubeVideoId` / `youtubeUrl`。
- `draft|ready|published -> archived`：不再於前端主列表顯示；歷史仍保留。

### 3.4 權限與預留端點

權限：

- student：只能讀取已發布或已公開給課程的 Shorts asset；不可建立 / 發布 / archive。
- teacher：可管理自己課程的 candidate、job、asset。
- admin：可管理所有課程的 candidate、job、asset。
- metadata-only / QA-only bridge video：可產生 candidate，但在沒有可剪輯來源檔前不得建立 job，需回 `CLIP_SOURCE_NOT_FOUND` 或 `CLIP_SOURCE_NOT_ACTIONABLE`。

預留端點（尚未實作，先作為 Phase 2 contract）：

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
- 本機檔案 auto-upload skeleton：教師上傳本地影片後，若 `YOUTUBE_AUTO_UPLOAD_ENABLED=true` 且 OAuth 設定完整，backend 會先用 FocusFlow 系統 YouTube 帳號走 Data API resumable upload，再把 `youtubeVideoId` / `videoUrl` 寫回同一筆 `Video`。

Phase 2 自動上傳流程定義如下：

1. 教師上傳本地影片到 backend。
2. 後端先完成同課程 mp4 SHA-256 去重。
3. 若 `YOUTUBE_AUTO_UPLOAD_ENABLED=true`，用 FocusFlow 系統 YouTube 帳號上傳。
4. YouTube 回傳 `youtubeVideoId` 後，後端建立 `Video`，狀態為 `queued`，並保存：
   - `youtubeVideoId`
   - `videoUrl=https://www.youtube.com/watch?v=<id>`
   - `sourceUrl=https://www.youtube.com/watch?v=<id>`
   - `sourceType=upload`
   - `videoSource=youtube`
   - `YOUTUBE_UPLOAD_PRIVACY_STATUS=unlisted`
5. STT / embedding processing 繼續以本地暫存檔接續，避免重新下載剛上傳的影片。
6. 只有在 YouTube 上傳成功、STT/embedding 已完成或可重試狀態明確後，才清理 `backend/uploads` 原始檔。

建議環境變數：

```env
YOUTUBE_AUTO_UPLOAD_ENABLED=false
YOUTUBE_OAUTH_CLIENT_ID=
YOUTUBE_OAUTH_CLIENT_SECRET=
YOUTUBE_OAUTH_REFRESH_TOKEN=
YOUTUBE_UPLOAD_ACCESS_TOKEN=
YOUTUBE_UPLOAD_PRIVACY_STATUS=unlisted
YOUTUBE_UPLOAD_CATEGORY_ID=27
```

預設策略：

- `visibility`：`unlisted`，避免公開發布未審核影片。
- Shorts：不要自動判定；由 Clip/Shorts job 決定是否發布為 Shorts。
- playlist：可選，等課程/教師分流策略定版後再啟用。
- uploads 清理：預設不清本地原始檔，等 YouTube/cloud + processing retry 策略穩定後再開。

## 5. 已完成與待定版

已完成：

- QA `citations[]` / `answerStatus` response contract。
- QA cost guardrails：`QA_MONTHLY_TOKEN_BUDGET`、`QA_USER_MONTHLY_TOKEN_QUOTA`、`QA_ESTIMATED_TOKENS_PER_ASK`；超額回 `429 QA_QUOTA_EXCEEDED`，成功 ASK 會寫入 `UsageLog.metadata.costControl`。
- UsageLog / Question 歷史保留，dashboard display 分流。
- 同課程重複 YouTube URL 與相同 mp4 SHA-256 防呆。
- 本機檔案 YouTube auto-upload adapter：OAuth refresh token、resumable upload、`youtubeVideoId` / `videoUrl` 寫回路徑與測試。
- `db:ensure-questions` / `db:backfill-questions` scripts 補齊。
- `/health.runtime.qa.costControl` 監控 snapshot，顯示 guardrails 是否啟用與 UTC 月重置口徑。
- `/health.runtime.multimodal` 監控 snapshot，顯示 `video_segments_video` / `video_embedding_index` 狀態與目前 QA 接入邊界。
- `video_segments_video` 初版 visual citation retrieval：backend 會從 course-scoped videos 的檔名 / URL 解析 pipeline visual ID，並用 Atlas `video_embedding_index` + `video_id` filter 檢索同課程視覺片段；回覆標示 `modality=video`、`clipPath` 與 timestamp citation。
- Video presentation ownership：`ownership=app_owned|pipeline_metadata`、`isAppOwned`、`metadataOnly` 已固定為前端/LINE 共用語意。

待定版：

- FocusFlow Google 帳號 OAuth refresh token 與一次真實 YouTube upload smoke。
- 跨課程共用同一支影片的多對多資料模型。
- mixed `videos` collection 是否拆分為 app-owned / pipeline-owned 實體 collection。
- Clip/Shorts endpoint 與 background job 實作。
- 視覺片段 caption / OCR / frame description；目前 visual retrieval 只提供 citation，不生成畫面內容。
