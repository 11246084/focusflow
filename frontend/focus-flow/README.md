# focus flow frontend

`frontend/focus-flow/` 是 FocusFlow 的 React 19 + Vite 前端。正式環境由 nginx 提供 build 後的靜態檔（`https://focusflow.ntub.edu.tw`，2026-09-21 起開放學生試用），push `main` 時由 GitHub Actions 自動 build 與部署。

## 如何運行

在專案根目錄執行：

```powershell
cd frontend\focus-flow
npm install
Copy-Item .env.example .env
npm run dev
```

啟動後，Vite 會在終端機顯示本機網址，預設通常是：

```text
http://localhost:5173
```

如果 `5173` 已被占用，Vite 會自動改用其他 port。

## 環境變數

前端目前已提供 `.env.example`，可先複製成 `.env`：

```powershell
cd frontend\focus-flow
Copy-Item .env.example .env
```

目前提供的變數：

- `VITE_API_BASE_URL`: backend API base URL，預設建議為 `http://127.0.0.1:4000/api/v1`
- `VITE_LINE_BOT_URL`: LINE 官方帳號加入好友網址（選填，留空時不顯示加入好友連結）

說明：

- 登入、學生註冊、忘記密碼、個人資料／密碼修改、課程列表、教師建立／刪除課程、修課學生管理（含 CSV 匯入）、教師上傳本機影片（多檔，走 `/video-batches`）、學生課程播放與網頁多輪 QA、LINE QR 綁定與解除、站內通知、問題回報已串接後端 API
- 註冊頁 [`src/components/RegisterPage.jsx`](src/components/RegisterPage.jsx)：欄位 = 姓名 / Email / 密碼（≥8）/ 確認密碼，只能註冊學生帳號（2026-09-18 起移除教師 tab，教師帳號由管理員建立）；登入頁的「立即註冊」按鈕由 [`App.jsx`](src/App.jsx) 切換到 `page === 'register'`，後端打 `POST /api/v1/auth/register`，成功後直接 `setToken` + `setUser` 進 dashboard；admin 不開放自助註冊
- 網址同步 [`src/utils/pageRouting.js`](src/utils/pageRouting.js)（2026-09-18）：未引入 react-router，頁面狀態仍是 `page` / `sub`，但會同步到網址（`/`、`/login`、`/register`、`/app/<頁面>`；管理員為 `/admin/<頁面>`），重新整理停在原頁、瀏覽器上一頁可返回。頁面代號與路徑對照在 [`navigationConfig.js`](src/components/navigationConfig.js) 的 `pagePaths`。正式環境需要 nginx `try_files ... /index.html`（已設定）。
- 錯誤訊息中文化 [`src/utils/errorMessages.js`](src/utils/errorMessages.js)（2026-09-18）：`apiFetch` 會把後端英文錯誤訊息依錯誤碼／常見驗證訊息／HTTP 狀態轉成中文顯示，原文保留在 `error.originalMessage` 供除錯。新增後端錯誤碼時請一併補中文。
- `VITE_API_BASE_URL` 預設指向本機 backend（`http://127.0.0.1:4000/api/v1`）

## 主要頁面行為

`src/pages/` 共 16 個頁面檔：Student（Dashboard、Courses、LineBot、ShortsWall）、Teacher（Dashboard、Courses、Upload、ShortScripts、VideoReview）、Admin（Overview、Users、Courses、Videos、Stats、Feedback）與共用 Profile。以下為各頁的重點行為紀錄（依各條日期）：

- **TeacherUpload**：2026-07-12 起收斂為**單一上傳軌道（本地檔案）**，移除 YouTube URL tab（後端 `POST /courses/:courseId/videos/youtube` API 保留，僅 UI 不露出）；上傳後系統自動跑 STT + 向量索引，後端設定 YouTube 憑證時亦自動上傳 YouTube。移除 `uploadDone` 鎖，前一支處理中也能選新檔案；POST 成功後自動清空輸入欄位；主上傳按鈕文字隨狀態切換（「開始上傳並建立 AI 索引」/「上傳中...」/「繼續上傳下一支影片」）；POST 成功後將回傳的 `videoId` 寫入 `localStorage`，使用者離開或重整頁面再回到上傳頁時會自動恢復處理進度輪詢（`GET /api/v1/videos/:videoId/processing`），完成或失敗後再清除該 key
- **TeacherCourses**：課程列表加刪除按鈕 + cascade 確認 modal；CREATE 表單不顯示 `archived` 選項；2026-07-12 新增「掛載既有影片」modal（`POST /courses/:courseId/videos/:videoId/attach`），掛載進來的影片顯示「掛載」badge 與「解除」按鈕（detach，不刪影片本身）；2026-09-12 新增失敗重試：處理失敗的影片顯示「重試處理」（`POST /videos/:videoId/processing/retry`），YouTube 上傳失敗顯示「YouTube 失敗」badge 與「重傳 YouTube」（`POST /videos/:videoId/youtube-upload/retry`），錯誤碼會轉成可行動的中文提示；按鈕只出現在影片的主課程，不出現在掛載課程
- **AdminCourses**：CourseModal 僅在編輯既有課程時顯示 `archived` 選項
- **StudentCourses**：`resolveVideoPlayback()` 統一解析 `youtubeVideoId` / `youtube_video_id` / `videoUrl` / `sourceUrl`，YouTube 一律用 IFrame API 播放並支援 QA timestamp `seekTo`；metadata-only / QA-only 影片不再 fallback `/uploads`；`YouTubePlayer` 用 React-owned wrapper 承接 iframe，避免切頁 / 切影片時 React root 黑屏。新增 watch 標記：mp4 `<video>` 透過 `onTimeUpdate ≥ 80%` 或 `onEnded` 觸發 `POST /api/v1/courses/:courseId/videos/:videoId/watched`；YouTube IFrame 透過 `onStateChange ENDED` 或每 5 秒 poll `cur/dur ≥ 80%` 觸發；`watchedMarkedRef` Set 確保同一 video session 只 POST 一次，後端首次觀看會寫 `UsageLog event=WATCH` 並更新 `Enrollment.progress`
- **StudentDashboard**：Recent Queries 帶 `contentMissing` 旗標時顯示「內容已下架」badge（藍色）；2026-07-13 統計卡片副標改中文說明並加 hover tooltip（本週提問＝最近 7 天滾動、含網頁 + LINE；累計＝開始使用至今；回答命中率＝成功回答 ÷ 累計提問），卡片下方加一行註解說明「本週」與「累計」統計範圍不同
- **問題回報**（2026-09-22 改版，[`IssueReportLauncher.jsx`](src/components/IssueReportLauncher.jsx)）：登入後右下角有兩顆浮動按鈕。「回報問題」開啟站內表單（類別、嚴重度、描述，最多 3 張截圖），送到 `POST /api/v1/feedback`，不需要 Google 帳號；管理員在 **AdminFeedback** 頁處理。另一顆意見回饋按鈕仍以新分頁開啟 Google 表單
- **TeacherShortScripts**：短影片腳本自動選題、生成與教師上傳成品（`/short-scripts`、`/short-assets`）；後端 `SHORT_SCRIPT_AUTOMATION_ENABLED` 預設關閉，關閉時這組 API 回 404
- **TeacherVideoReview**：教師審核短影片成品、核准或勾選退回原因（`/api/v1/shorts`），不受上述 feature flag 影響
- **TeacherDashboard**：Top Queried Segments 帶 `contentMissing` 旗標的列顯示「已刪除影片的提問」+「內容已下架」badge（2026-07-12，修老師 #13 中文課程統計消失）
- **AdminOverview**：Total Users 描述補 `adminCount`
- **AdminStats**：Recent Events COURSE 欄位 — 課程被刪時 dim 顯示；`contentMissing` 時加「內容已下架」inline badge

## 其他常用指令

```powershell
cd frontend\focus-flow
npm test
npm run lint
npm run build
npm run preview
```

用途：

- `npm run dev`: 啟動 Vite 開發伺服器
- `npm test`: 執行 `tests/` 下的 node:test 單元測試
- `npm run lint`: 執行 ESLint 檢查
- `npm run build`: 建立 production build
- `npm run preview`: 本機預覽 build 後的結果
