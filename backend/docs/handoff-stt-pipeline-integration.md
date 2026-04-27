# 後端交接文件：STT Pipeline 自動化整合

建立日期：2026-04-27

---

## 這份文件的目的

說明 2026-04-27 完成的「影片上傳自動觸發 STT Pipeline」功能，讓後端接手的人快速理解架構、設定方式與後續待辦事項。

---

## 一、完整流程說明

```
教師在前端上傳影片
    ↓
POST /api/v1/courses/:courseId/videos
    ↓
backend/src/services/video.service.js → createCourseVideo()
① 影片存至 backend/uploads/
② MongoDB 建立 Video 文件（processing.status = queued）
③ 背景 spawn python src/main.py --video-path <路徑> --video-id <mongoId>
    ↓
STT_Whisper/src/main.py 啟動
④ 呼叫 POST /api/v1/internal/videos/:id/processing/start
   → Video 文件狀態改為 processing
    ↓
⑤ Whisper 轉錄 → Gemini embedding → 產出 JSONL
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
const sttProcess = spawn('python', [
  'src/main.py',
  '--video-path', path.resolve(file.path),
  '--video-id', String(video._id),
], {
  cwd: sttDir,
  detached: true,
  stdio: 'ignore',
  env: {
    ...process.env,
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
| `STT_Whisper/src/config.py` | 新增三個欄位：`backend_url`、`processing_webhook_secret`、`target_video_path` |
| `STT_Whisper/src/scan_videos.py` | `scan_videos()` 開頭加判斷：若 `config.target_video_path` 不為 None，只處理那一支影片 |
| `STT_Whisper/src/main.py` | 新增 `--video-path`、`--video-id` CLI 參數；新增 `notify_backend()` 函式；pipeline 完成後自動呼叫 `mongodb_uploader.main()`；在 start/complete/fail 呼叫 `notify_backend()` |
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

### YouTube 自動上傳（優先度：高）

**為什麼需要：** 學生提問時，QA 回答要附上可以跳轉到對應影片時間點的連結，格式為：
```
https://www.youtube.com/watch?v=<youtubeVideoId>&t=<startSec>s
```

**需要做的事：**

1. **`backend/src/models/video.model.js`**：新增欄位
   ```js
   youtubeVideoId: { type: String, default: null }
   ```

2. **`backend/src/services/video.service.js`**：影片上傳後呼叫 YouTube Data API v3
   - 影片隱私設定：`unlisted`（有連結才能看，不公開列出）
   - 頻道：統一上傳到 FocusFlow 官方 YouTube 頻道
   - 取得 YouTube 影片 ID 後存入 `Video.youtubeVideoId`

3. **QA 回答串接**：在 QA service 回傳的 `clip.jumpUrl` 改為 YouTube 時間戳連結

4. **需要的憑證**：FocusFlow Google 帳號的 YouTube Data API OAuth 2.0 憑證（`client_id`、`client_secret`、`refresh_token`）

---

## 六、測試方式

### 手動測試完整流程

1. 啟動後端：`cd backend && npm run dev`
2. 啟動 STT 虛擬環境：`cd STT_Whisper && .venv/Scripts/activate`
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
- `python` 命令必須在系統 PATH 中可執行；若環境使用虛擬環境（venv），spawn 時的 `python` 路徑需對應到 venv 內的 python
- STT pipeline 為同步處理，一次只處理一支影片；若多人同時上傳，影片會依序排隊（`processing.status = queued` 狀態會保持）
