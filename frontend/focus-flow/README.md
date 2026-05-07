# focus flow frontend

`frontend/focus-flow/` 是 focus flow MVP 的 React 19 + Vite 前端。

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

說明：

- 登入、課程列表、教師建立 / 刪除課程、教師上傳影片（本機檔案 / YouTube URL）、學生課程播放與 QA、LINE QR 綁定流程已串接後端 API
- `VITE_API_BASE_URL` 預設指向本機 backend（`http://127.0.0.1:4000/api/v1`）

## 主要頁面行為（2026-05-07 更新）

- **TeacherUpload**：支援「上傳檔案 / YouTube 連結」切換；移除 `uploadDone` 鎖，前一支處理中也能切 tab、貼新 URL、選新檔案；POST 成功後自動清空輸入欄位；主上傳按鈕文字隨狀態切換（「開始上傳並建立 AI 索引」/「上傳中...」/「繼續上傳下一支影片」）；POST 成功後將回傳的 `videoId` 寫入 `localStorage`，使用者離開或重整頁面再回到上傳頁時會自動恢復處理進度輪詢（`GET /api/v1/videos/:videoId/processing`），完成或失敗後再清除該 key
- **TeacherCourses**：課程列表加刪除按鈕 + cascade 確認 modal；CREATE 表單不顯示 `archived` 選項
- **AdminCourses**：CourseModal 僅在編輯既有課程時顯示 `archived` 選項
- **StudentCourses**：`resolveVideoPlayback()` 統一解析 `youtubeVideoId` / `youtube_video_id` / `videoUrl` / `sourceUrl`，YouTube 一律用 IFrame API 播放並支援 QA timestamp `seekTo`；metadata-only / QA-only 影片不再 fallback `/uploads`；`YouTubePlayer` 用 React-owned wrapper 承接 iframe，避免切頁 / 切影片時 React root 黑屏
- **StudentDashboard**：Recent Queries 帶 `contentMissing` 旗標時顯示「內容已下架」badge（藍色）
- **AdminOverview**：Total Users 描述補 `adminCount`
- **AdminStats**：Recent Events COURSE 欄位 — 課程被刪時 dim 顯示；`contentMissing` 時加「內容已下架」inline badge

## 其他常用指令

```powershell
cd frontend\focus-flow
npm run lint
npm run build
npm run preview
```

用途：

- `npm run dev`: 啟動 Vite 開發伺服器
- `npm run lint`: 執行 ESLint 檢查
- `npm run build`: 建立 production build
- `npm run preview`: 本機預覽 build 後的結果
