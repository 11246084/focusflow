# httpOnly cookie 認證上線紀錄（2026-10-25）

這份紀錄說明 2026-10-25 把 `dev` 合併到 `main`、部署 httpOnly cookie 認證的過程與證據。之後要知道當時改了哪些設定、做過哪些 Atlas 寫入、驗收了什麼時查閱；功能目前狀態一律看[目前狀態](../../current-status.md)，設計理由見[cookie 決策](../../04_Features/HttpOnly_Cookie/decisions.md)。

## 結論

| 項目 | 內容 |
|---|---|
| 上線時間 | 2026-10-25 13:13（台灣時間）push `main`，同分鐘部署完成 |
| 部署版本 | `main` = `d3de1ef Merge branch 'dev'`（從 `88e3454` 合併 37 筆 commit，內容與 `dev` 的 `e155ec1` 相同）；退回目標為 `88e3454` |
| 部署方式 | 使用者自行 push `dev` 與 `main` → GitHub Actions self-hosted runner 依 [deploy.yml](../../../.github/workflows/deploy.yml) 自動部署 |
| Actions 結果 | ✅ [Deploy to VM #40164725618](https://github.com/11246084/focusflow/actions/runs/40164725618)：fast-forward 到 `d3de1ef`、前端同來源檢查 29 檔通過、PM2 online、QA 就緒與 nginx `/api` 401 檢查通過 |
| 驗收結果 | 部署探測與決策 15 第 6 層瀏覽器驗收全部通過；未觸發退回 |
| 對使用者的影響 | 所有人重新登入一次；上線前就存在的帳號第一次登入要驗證信箱並改密碼，admin 之後每次登入要信箱驗證碼（可信任裝置 7 天） |

## 與決策 16 的差異

| 項目 | 決策原文 | 實際做法與理由 |
|---|---|---|
| 公告 | 部署前一天通知所有使用者，在公告的維護時段部署 | 使用者決定（2026-10-25）當天直接維護，判斷當天沒有人使用，未提前公告 |
| 三個測試帳號的新密碼 | 部署前改成 Gmail 別名與 repo 外的新密碼 | 部署前只改 Email；新密碼在上線後首次登入（`first_login`）的畫面上設定。密碼不經過 VM 指令或指令歷史，也順便驗收首次登入流程（使用者 2026-10-25 同意） |
| `adminAuditLogs` | 部署文件另需授權帳號執行 `db:ensure-auth-audit` | 在 `authSessionsIndexer` 角色加上 `focusflow.adminAuditLogs` 的 `createCollection`，同一個臨時帳號完成兩支腳本 |

## 部署當天步驟

| 步驟 | 結果 | 做法 |
|---|---|---|
| 事前：SMTP | ✅ VM 以後端寄信模組寄到 `focusflow115413@gmail.com` 與 `+admin` 別名，都進收件匣 | 使用者在主 session 換新的 Gmail 應用程式密碼後測試；密碼未寫入對話或檔案 |
| ① 建 collection 與 index | ✅ `authSessions`（`userId_1`、TTL `expiresAt_1`，`expireAfterSeconds: 0`）與 `adminAuditLogs` 建立；唯讀 MongoDB MCP 查證 | 使用者建立 1 天臨時帳號 `ff-auth-indexer-1025`（只有 `authSessionsIndexer` 角色），在本機以隱藏輸入提供連線字串執行 `db:ensure-auth-sessions`、`db:ensure-auth-audit`，兩者 exit 0 |
| ② 測試帳號與部署探測帳號 | ✅ `admin`／`teacher`／`student@focusflow.local` 改為 `focusflow115413+admin／teacher／student@gmail.com`；建立 `deploy-probe@focusflow.local`（student、已驗證信箱、不需改密碼、隨機不可登入密碼），只選修 `69fb4d4c069e21f4e65b74dc` | VM 以 `focusflow` 身分執行一次性腳本，先預檢再 `--write`，跑完刪除；唯讀 MCP 查證 |
| ③ VM 環境變數 | ✅ 見下方「環境變數設定」 | 使用者在 VM 修改 |
| ④ 唯讀檢查 | ✅ HTTP 301 轉 HTTPS；`/api/v1/courses` 未登入回 401；前端 `.env` 為 `/api/v1`，runner 沒有 `VITE_` 設定。⚠️ nginx 沒有 `/uploads` 轉送，見「未完成項目」 | VM 內 `curl`、`grep` |
| ⑤ 合併與部署 | ✅ 獨立 worktree `git merge --no-ff dev`；VM 上一版 `dist` 備份到 `/opt/focusflow-backup/dist-88e3454`（13M） | 合併 commit 與 37 筆待上線 commit 的作者、committer 都是 Weihao，訊息無 AI 署名 |
| ⑥ 部署後檢查 | ✅ 見下方「上線驗收」 | VM 探測腳本與使用者瀏覽器操作 |

## 環境變數設定

VM 的 `backend/.env` 不隨部署同步，部署的 `pm2 restart --update-env` 會一起套用。2026-10-25 12:22 修改前備份為 `backend/.env.bak-20261025`；改後擁有者 `focusflow`、權限 `-rw-------` 不變。

| 變數 | 改前 | 改後 | 說明 |
|---|---|---|---|
| `CSRF_TRUSTED_ORIGINS` | 未設定 | `https://focusflow.ntub.edu.tw` | 決策 7；production 缺少時後端拒絕啟動 |
| `ALLOWED_ORIGINS` | `https://focusflow.ntub.edu.tw` | 不變 | 決策 7 要求明確白名單 |
| `SMTP_PASS` | 舊應用程式密碼 | 新的「FocusFlow VM」應用程式密碼 | 舊密碼曾在對話中外洩，上線前更換 |
| `ADMIN_EMAIL_2FA_ENABLED`、`EMAIL_VERIFICATION_ENABLED`、`SYSTEM_SETTINGS_DB_ENABLED` | 未設定 | 未設定（預設 `true`） | 決策 25；`runtimesettings` 也沒有 `auth.*`，兩層開關都是開啟 |
| `NODE_ENV`、`DEMO_SEED_ENABLED` | `production`、`false` | 不變 | 正式環境不重建展示帳號 |

## 上線驗收

| 項目 | 結果 |
|---|---|
| 外部請求 | ✅ `GET /auth/me` 未登入回 401；`POST /auth/session` 帶不受信任的 Origin 回 403 `CSRF_REJECTED` |
| 服務狀態 | ✅ PM2 online、`unstable restarts` 0；`/health` 的 QA `readyForAsk: true`、YouTube `ready` |
| 部署探測 | ✅ 以 `deploy-probe` 經 `issueSession` 取得 5 分鐘 token：`/auth/me`、課程清單、探測課程 200；舊格式 JWT（無 `typ`／`ver`／`sid`）401；Bearer 登出 204，登出後同一張 token 401。未呼叫付費 AI 服務 |
| admin | ✅ 舊密碼登入 → 信箱驗證碼 → 設定新密碼；`__Host-ff_session` 為 HttpOnly、Secure、SameSite=Strict、Path=/、無 Domain，localStorage 沒有 token；Network 全部是同來源 `/api/v1`；重新整理維持登入；新密碼登入走 admin 兩段式驗證 |
| 教師 | ✅ 首次登入驗證與改密碼；頭像上傳 |
| 學生 | ✅ 首次登入驗證與改密碼；多分頁同步登出；登出所有裝置；回報問題附件上傳 |
| 外部連結進站 | ✅ LINE 內建瀏覽器關閉後再點連結仍維持登入；手機瀏覽器從其他 App 開啟、電腦從 Gmail 信件連結進站都恢復登入 |
| 未在正式站測 | step-up（重新輸入密碼）只在把帳號升為 admin 時觸發，會實際改帳號，本機已驗、正式站未測；信任裝置 7 天未測 |

## 不影響上線、但仍未完成的項目

- **nginx 沒有轉送 `/uploads`**：正式站 `/uploads/*` 回前端首頁（200 `text/html`）。上一版在相同設定下也是同來源 `/uploads`，屬於既有問題，影響學生頁播放還沒上 YouTube、存在 VM 本機的影片。修正等於公開 `/uploads`，和 cookie 決策「待討論」的存取控制一起決定。
- **信箱無法收信的帳號**：Cathy 的教師與學生帳號（`@focusflow.local`）與 3 個信箱打錯的學生（`gmail.con`、`aaaa.com`、`you.com`）收不到驗證碼，需由 admin 在使用者頁修正 Email；另有 57 個 2026-09-30 一次建立、從未登入的 `@example.com` 學生帳號，上線後無法登入。
- **VM 工作區的頭像檔**：`backend/private-data/avatars/` 有一個被 Git 追蹤的頭像檔已被刪除、兩個未追蹤，不擋 `git pull`；頭像已改存 MongoDB，另案清理 repo 追蹤的檔案。
- **組員本機設定**：後端 `.env` 補 `CSRF_TRUSTED_ORIGINS`、`ADMIN_EMAIL_2FA_ENABLED`、`EMAIL_VERIFICATION_ENABLED`、`SYSTEM_SETTINGS_DB_ENABLED`，前端 `VITE_API_BASE_URL=/api/v1`（見兩份 `.env.example`）。
- **Atlas 臨時帳號**：`ff-auth-indexer-1025` 於建立後 1 天自動失效。
- 2026-11-16～11-27 佈展期間凍結部署，只修緊急問題。

## 退回方式（未使用）

依決策 16，先在 VM `backend/.env` 換新的 `JWT_SECRET`，再部署 revert 後的版本（`88e3454`）並還原 `/opt/focusflow-backup/dist-88e3454`；新增的 `authSessions`、`adminAuditLogs`、使用者欄位保留。步驟見[部署與連線排錯](部署與連線排錯.md#cookie-認證的部署與退回)。
