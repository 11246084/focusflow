# YouTube 自動上傳設定指南

最後更新：2026-07-20（首次建立；OAuth 憑證已依本流程取得，live upload smoke 尚未執行）

> 功能實作見 `backend/src/services/youtubeUpload.service.js`；本文件只記錄「如何取得憑證並啟用」的操作步驟與注意事項。

## 這個功能在做什麼

啟用後，教師上傳本地影片時 backend 會在背景自動把檔案傳到 FocusFlow 的 YouTube 頻道（預設 unlisted），成功後回寫 `youtubeVideoId` / `videoUrl`，學生端自動改用 YouTube iframe 播放，LINE Bot 可回傳 YouTube timestamp link。對齊 2026-04-21 教授決議「影片託管採 YouTube，不自建串流伺服器」。

為什麼需要 OAuth 而不是 API key：API key 只能證明「請求來自哪個 GCP 專案」，只允許公開唯讀查詢（本專案用於 Shorts metadata sync）；上傳影片是寫入特定頻道的私有操作，YouTube 上傳 API 強制要求 OAuth（頻道主人明確授權，scope 限縮為 `youtube.upload`，可隨時撤銷）。

## 設定步驟

### A. Google Cloud Console

1. 登入 [console.cloud.google.com](https://console.cloud.google.com)，切到 FocusFlow 用的專案（例：`focusflow-youtube`）
2. 確認「API 和服務 → 已啟用的 API」中 **YouTube Data API v3** 為已啟用
3. 設定 OAuth 同意畫面（Google Auth Platform）：
   - 應用程式名稱：`FocusFlow`；支援 email 填自己的
   - 目標對象：**外部（External）**
   - 「目標對象」頁的「測試使用者」加入頻道的 Google 帳號（不加會 403）
4. 建立 OAuth 用戶端（「用戶端」→ 建立）：
   - 類型：**網頁應用程式**
   - 已授權的重新導向 URI：`https://developers.google.com/oauthplayground`
   - 建立後取得 **Client ID** 與 **Client Secret**

### B. OAuth Playground 換 refresh token

5. 開 [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground)
6. 齒輪 ⚙️ → 確認 Access type = **Offline** → 勾「**Use your own OAuth credentials**」→ 貼入 Client ID / Client Secret
7. Step 1 的「Input your own scopes」貼入：`https://www.googleapis.com/auth/youtube.upload` → **Authorize APIs**
8. 選頻道帳號登入 → 「未經 Google 驗證」警告按「繼續」→ 允許權限
9. Step 2 按 **Exchange authorization code for tokens** → 從 Response 複製 **`refresh_token`**

### C. 填入 backend/.env 並重啟

10. 在 `backend/.env` 加入（`=` 兩邊無空格、值不加引號，勿貼入版控或對話）：

    ```env
    YOUTUBE_API_KEY=xxxx
    SHORTS_SYNC_INTERVAL_MS=600000
    YOUTUBE_UPLOAD_ENABLED=true
    YOUTUBE_CLIENT_ID=xxxx.apps.googleusercontent.com
    YOUTUBE_CLIENT_SECRET=xxxx
    YOUTUBE_REFRESH_TOKEN=xxxx
    YOUTUBE_UPLOAD_PRIVACY=unlisted
    ```

11. 重啟 backend（`cd backend` → `npm run dev`）

### D. 驗證（smoke）

12. `GET /health` 檢查 `runtime.shortsSync`
13. 用教師帳號上傳一支小影片，確認：
    - `videos.youtubeUpload.status` 走到 `uploaded` 並回寫 `youtubeVideoId`
    - YouTube Studio 出現該支 unlisted 影片
    - 學生端改用 YouTube iframe 播放
14. smoke 成功後，更新 `current-state.md` / `docs/current-status.md` / `CLAUDE.md` 中「未經 live 憑證端對端驗證」的註記

## 注意事項

- **refresh token 7 天過期問題**：OAuth 同意畫面在「測試中（Testing）」狀態時，refresh token 7 天後失效（上傳開始回 `YOUTUBE_UPLOAD_FAILED`）。長期使用需在 Google Auth Platform 按「發布應用程式」切到正式狀態（不需通過 Google 審查，授權時多一個未驗證警告），再重走 B 段換新 token
- **配額（免費，不會產生費用）**：每專案每天 10,000 單位；上傳一支耗 1,600（每天上限約 6 支），Shorts sync 每批 50 支耗 1 單位。超額當天失敗、隔天重置，不扣錢
- 憑證四項（`YOUTUBE_UPLOAD_ENABLED` + Client ID/Secret + refresh token）缺任一項會**靜默略過**，不影響本地上傳與 STT pipeline
- 撤銷授權：Google 帳號 → 安全性 → 第三方應用程式存取權，移除 FocusFlow 即可，不需刪 OAuth Client
