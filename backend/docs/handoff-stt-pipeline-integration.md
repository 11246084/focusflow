# 後端交接文件：STT Pipeline 自動化整合

建立日期：2026-04-27

---

## 這份文件的目的

說明 2026-04-27 完成的「影片上傳自動觸發 STT Pipeline」功能，讓後端接手的人快速理解架構、設定方式與後續待辦事項。

---

## 一、完整流程說明

```
教師在前端上傳影片或貼 YouTube URL
    ↓
POST /api/v1/courses/:courseId/videos
或 POST /api/v1/courses/:courseId/videos/youtube
    ↓
backend/src/services/video.service.js
① 本機影片：存至 backend/uploads/
   YouTube 影片：解析 youtubeVideoId，儲存 videoUrl / youtubeVideoId
② MongoDB 建立 Video 文件（processing.status = queued）
③ 背景 spawn STT_Whisper/.venv/Scripts/python.exe
   本機影片：src/main.py --video-path <路徑> --video-id <mongoId> --overwrite
   YouTube 影片：src/main.py --youtube-url <url> --video-id <mongoId> --overwrite
    ↓
STT_Whisper/src/main.py 啟動
④ 呼叫 POST /api/v1/internal/videos/:id/processing/start
   → Video 文件狀態改為 processing
    ↓
⑤ 本機影片先抽音；YouTube 影片先用 yt-dlp 下載音訊
   接著 Whisper 轉錄 → Gemini embedding → 產出 JSONL
    ↓
⑥ 自動執行 mongodb_uploader.py → 寫入 video_segments_text
    ↓
⑦ 呼叫 POST /api/v1/internal/videos/:id/processing/complete
   → Video 文件狀態改為 completed
    ↓
學生可以對這支影片提問
```

失敗時：任一步驟發生例外 → 呼叫 `POST /api/v1/internal/videos/:id/processing/fail` → 狀態改為 failed

---

## 二、修改的檔案清單

### Backend

**`backend/src/services/video.service.js`**

在 `createCourseVideo()` 函式裡，`Video.create()` 與 `Course.findByIdAndUpdate()` 完成後，新增以下邏輯：

```js
const sttDir = path.resolve(env.projectRoot, '../STT_Whisper');
const venvPython = path.join(sttDir, '.venv', 'Scripts', 'python.exe');
const pythonBin = existsSync(venvPython) ? venvPython : 'python';
const sttProcess = spawn(pythonBin, [
  'src/main.py',
  '--video-path', path.resolve(file.path),
  '--video-id', String(video._id),
  '--overwrite',
], {
  cwd: sttDir,
  stdio: ['ignore', logFd, logFd],
  windowsHide: true,
  env: {
    ...process.env,
    MONGODB_URI: env.mongodbUri,
    MONGODB_DATABASE_NAME: 'focusflow',
    BACKEND_URL: `http://localhost:${env.port}`,
    PROCESSING_WEBHOOK_SECRET: env.processingWebhookSecret,
  },
});
sttProcess.unref();
```

新增的 import：
```js
const path = require('path');
const { spawn } = require('child_process');
const env = require('../config/env');
```

### STT Pipeline

| 檔案 | 修改內容 |
|------|---------|
| `STT_Whisper/src/config.py` | 新增 `backend_url`、`processing_webhook_secret`、`target_video_path`、`target_video_id`、`youtube_url` |
| `STT_Whisper/src/scan_videos.py` | `scan_videos()` 開頭加判斷：若 `config.target_video_path` 不為 None，只處理那一支影片 |
| `STT_Whisper/src/main.py` | 新增 `--video-path`、`--video-id`、`--youtube-url` CLI 參數；新增 `notify_backend()`；pipeline 完成後自動呼叫 MongoDB uploader；在 start/complete/fail 呼叫 `notify_backend()` |
| `STT_Whisper/src/mongodb_uploader.py` | 上傳 `videos` 時使用 `videoId`；YouTube 影片不覆蓋暫存檔欄位 |
| `STT_Whisper/requirements.txt` | 新增 `yt-dlp` |
| `STT_Whisper/.env.example` | 新增 `BACKEND_URL`、`PROCESSING_WEBHOOK_SECRET` |

---

## 三、環境變數設定

### `backend/.env`（已存在，確認有值即可）

```
PROCESSING_WEBHOOK_SECRET=focusflow-dev-secret
PORT=4000
```

### `STT_Whisper/.env`（需手動新增這兩行）

```
BACKEND_URL=http://localhost:4000
PROCESSING_WEBHOOK_SECRET=focusflow-dev-secret
```

> 兩個 `.env` 的 `PROCESSING_WEBHOOK_SECRET` 必須完全一致，否則後端會回 401 拒絕狀態更新。

---

## 四、已存在的 Internal Webhook API（不需要修改）

這三個端點在 `backend/src/routes/internal-video.routes.js` 已存在：

| 端點 | 狀態轉換 | 說明 |
|------|---------|------|
| `POST /api/v1/internal/videos/:videoId/processing/start` | `queued → processing` | STT 開始時呼叫 |
| `POST /api/v1/internal/videos/:videoId/processing/complete` | `processing → completed` | STT 全部完成時呼叫 |
| `POST /api/v1/internal/videos/:videoId/processing/fail` | `queued/processing → failed` | 任一步驟失敗時呼叫 |

驗證方式：`X-Processing-Secret` header，值需與 `PROCESSING_WEBHOOK_SECRET` 一致。

---

## 五、尚未實作的後續工作

### YouTube 自動上傳（後續）

**為什麼需要：** 學生提問時，QA 回答要附上可以跳轉到對應影片時間點的連結，格式為：
```
https://www.youtube.com/watch?v=<youtubeVideoId>&t=<startSec>s
```

**需要做的事：**

目前 MVP 已支援「教師手動上傳 YouTube，貼 URL 到 FocusFlow」：

- `Video.youtubeVideoId` 已新增。
- `POST /api/v1/courses/:courseId/videos/youtube` 已新增。
- STT 可用 `yt-dlp` 下載 YouTube 音訊。
- QA / LINE 可回傳 YouTube timestamp link。

尚未完成的是「backend 自動上傳影片到 YouTube」：

1. **`backend/src/services/video.service.js`**：本機影片上傳後呼叫 YouTube Data API v3
   - 影片隱私設定：`unlisted`（有連結才能看，不公開列出）
   - 頻道：統一上傳到 FocusFlow 官方 YouTube 頻道
   - 取得 YouTube 影片 ID 後存入 `Video.youtubeVideoId`

2. **需要的憑證**：FocusFlow Google 帳號的 YouTube Data API OAuth 2.0 憑證（`client_id`、`client_secret`、`refresh_token`）

---

## 六、測試方式

### 手動測試完整流程

1. 啟動後端：`cd backend && npm run dev`
2. 確認 STT 虛擬環境在 `STT_Whisper/.venv`，並已安裝 `requirements.txt`
3. 用 Postman 或前端上傳一支影片到 `POST /api/v1/courses/:courseId/videos`
4. 觀察後端 terminal：應出現 STT pipeline 被 spawn 的 log
5. 觀察 STT terminal：應看到 Whisper 轉錄進度
6. 確認 MongoDB `videos` collection 中那筆文件的 `processing.status` 從 `queued → processing → completed`
7. 確認 `video_segments_text` collection 有新增對應的片段資料

### 失敗情境測試

若 STT pipeline 因缺少 `.env` 設定而無法連到後端：
- Video 文件狀態會停在 `processing`
- 前端教師可以用 `POST /api/v1/videos/:videoId/processing/retry` 重新觸發（狀態必須是 `failed` 才能 retry）

---

## 七、已知限制

- STT pipeline 與後端必須在同一台機器上才能用 `localhost` 互通；部署到伺服器時 `BACKEND_URL` 需改為實際網址
- backend 會優先使用 `STT_Whisper/.venv/Scripts/python.exe`；若 `.venv` 建在 repo 根目錄，會 fallback 到系統 Python，STT 可能失敗
- STT pipeline 為同步處理，一次只處理一支影片；若多人同時上傳，影片會依序排隊（`processing.status = queued` 狀態會保持）
