# 登入、通知與頭像前端串接交接

建立日期：2026-07-24  
Reviewer 返工更新：2026-07-25

## 任務範圍與觸發原因

本次工作只串接已完成且已通過後端 review 的 API 契約，不調整前端架構或既有路由：

1. 登入時將使用者目前選擇的 `role` 一併送往 `POST /api/v1/auth/login`，避免跨身分登入。
2. 將 Topbar 的 mock 通知改為真實通知 API，支援通知列表、單筆已讀、全部已讀及管理員系統公告。
3. 將個人資料頁的本機預覽頭像改為後端持久化頭像，載入 `/auth/me`、讀取 binary 頭像並以 multipart 上傳。

`RegisterPage.jsx` 未修改；註冊失敗仍沿用 `apiFetch()` 建立的 `Error.message` 顯示後端明確訊息。

## 對應後端契約與錯誤映射

### 登入

- `POST /api/v1/auth/login`
  - request：`{ email, password, role }`
  - success：`data.token`、`data.user`
  - `ROLE_MISMATCH`（403）：前端顯示「所選身分與此帳號類型不符，請切換正確身分後再登入。」
  - 其他失敗：顯示後端 response 的 `message`，沒有訊息時才使用前端 fallback。
- 成功導向仍以後端回傳的 `data.user.role` 為準，不以使用者點選 tab 強制覆寫。

### 通知

- `GET /api/v1/notifications`
  - 使用 `data.notifications`、`data.unreadCount`、`data.nextCursor`。
  - 通知項目使用 `id`、`title`、`content`、`urgent`、`read`、`createdAt`。
  - `nextCursor` 非空時可用相同 endpoint 加上 `?cursor=...` 載入下一頁。
- `PATCH /api/v1/notifications/:notificationId/read`
  - 成功後用 `data.notification` 更新該筆通知並調整未讀數。
- `POST /api/v1/notifications/read-all`
  - 成功後將目前列表及 badge 更新為已讀。
- `POST /api/v1/admin/notifications`
  - request：`{ title, content, urgent }`
  - success：使用 `data.recipientCount` 顯示實際收件學生數。
  - 管理員原本就由 `DashboardApp.jsx` 渲染共用 `Topbar`，因此公告表單可放入既有通知 dropdown，不需要新增頁面或路由。

### 頭像

- `GET /api/v1/auth/me`
  - 使用 `data.user.hasAvatar` 與公開使用者欄位，並同步更新既有 localStorage user。
- `GET /api/v1/auth/me/avatar`
  - 使用現有 token 送出 `Authorization: Bearer ...`，以 binary/blob 讀取，不透過 JSON helper。
- `PUT /api/v1/auth/me/avatar`
  - multipart field 固定為 `avatar`。
  - 成功後重新取得 `/auth/me` 與 binary 頭像，確保重新整理頁面後仍可顯示。
- 前端接受 JPEG、PNG、WebP，限制 5 MiB；後端訊息仍是最終判定。
- UI、state 與 localStorage 均不保存或顯示伺服器端檔名。

## 小改動／大改動判定

判定：小改動，可直接實作。

| 判準 | 結果 | 說明 |
|---|---|---|
| 前端改動檔案不超過 3 個 | 符合 | 共 3 個既有前端檔 |
| 不新增前端檔案 | 符合 | 未新增 component、hook、util 或 type 檔 |
| 不新增或更新 npm 依賴 | 符合 | `package.json`、lockfile 未修改 |
| 不修改 common/shared、共用 hook、Provider、store/slice | 符合 | 未觸及 |
| 不修改 router config | 符合 | 未觸及 |
| 不修改 build/env 設定 | 符合 | 未觸及 Vite、tsconfig 或 `.env*` |
| 不變更既有元件對外 props／函式參數簽章 | 符合 | `LoginPage`、`Topbar`、`Profile` 對外 props 維持原樣 |
| 不新增畫面或新路由 | 符合 | 管理員公告沿用既有 Topbar dropdown |

本 handoff Markdown 位於允許的 `backend/docs/handoffs/`，不計入三個前端檔案限制。

## 修改檔案與理由

### `frontend/focus-flow/src/components/LoginPage.jsx`

- 登入 body 加入目前 tab 的 `role`。
- `ROLE_MISMATCH` 顯示清楚的繁體中文指引。
- 其他錯誤沿用後端 `message`。
- 登入成功後仍依 `res.data.user.role` 導向。

### `frontend/focus-flow/src/components/Topbar.jsx`

- 移除 `MOCK_NOTIFICATIONS`。
- 以既有 `apiFetch()` 與 token 模式串接通知列表、單筆已讀、全部已讀。
- 未讀 badge 使用後端 `unreadCount`，列表互動成功後同步更新。
- 單筆已讀使用 per-id ref guard 與 functional `Set` state；同一通知 pending 時重複點擊只會送出一個 PATCH，badge 只減一次。
- 任一單筆已讀仍 pending 時，read-all 按鈕與 handler 均會阻止操作，避免 read-all 成功後舊 PATCH 的失敗訊息覆蓋畫面而造成誤導。
- 通知 GET 使用 `AbortController` 與 request generation；新請求、已讀操作或全部已讀會使舊 GET 失效，避免 stale response 覆蓋本機狀態。
- 保存 `nextCursor`，提供「載入更多」按鈕；append 時依通知 ID 去重，並保留已在本機標為已讀的狀態。
- 全部已讀成功後會一致更新所有已載入頁面及全域 badge。
- 顯示 loading、空列表、API error 與 `createdAt` 時間。
- 管理員通知 dropdown 加入最小的標題、內容、緊急 checkbox 與發送按鈕。
- 管理員發送成功後顯示後端回傳的學生收件數。
- Dropdown 依剩餘 viewport 設定 `maxHeight` 並允許垂直捲動，改善低高度視窗溢出。

### `frontend/focus-flow/src/pages/Profile.jsx`

- 頁面載入時取得 `/auth/me`，同步公開使用者資料與 localStorage。
- `hasAvatar=true` 時以 authenticated native `fetch()` 讀取 binary 頭像。
- 上傳使用 `FormData`，field 名稱為 `avatar`，不手動設定 `Content-Type`。
- 上傳成功後重新取得 user 與 binary 頭像，確認採用伺服器持久化版本。
- 加入上傳中、載入中、成功與錯誤訊息。
- 釋放被替換或卸載的 object URL，避免 blob URL 累積。
- `/auth/me` 與 binary avatar GET 使用 request generation、`AbortController` 及 session token guard；unmount、logout 或 token 改變後不會更新 React state 或 localStorage。
- stale request 若已建立 object URL，會立即 revoke，不等待元件 cleanup。
- avatar PUT 使用獨立 request ID、`AbortController` 與同步 ref 單飛；pending 時頭像本體、上傳圖示及 file input 全部禁用。
- stale upload 的 error/finally 不會覆蓋新 session 的 UI，第二次上傳也不會在第一個 request pending 時送出。
- 不顯示使用者本機檔名或後端儲存檔名。

## 驗證結果

### 已執行

- 三個異動檔定向 ESLint：PASS
  - `LoginPage.jsx`
  - `Topbar.jsx`
  - `Profile.jsx`
- `npm run build`：PASS
  - Vite 8.0.5，44 modules transformed。
  - Reviewer 最終低風險修正後 bundle 約 932.64 kB。
  - 有既有的大 chunk 警告，不影響 build 成功，且本次不得調整架構或 code splitting。

### Repo 全量 lint

原始三檔串接完成時，`npm run lint` 因範圍外的 `Icons.jsx` 4 個
`react-refresh/only-export-components` error 與 `StudentCourses.jsx` 1 個
`react-hooks/exhaustive-deps` warning 而失敗。

2026-07-26 經使用者明確授權一次性將本輪前端檔案上限由 3 檔擴為 5 檔後，
已完成下列 Release Gate 前置修正：

- `src/components/Icons.jsx`：只保留 `Ic`、`Logo` React 元件 export。
- `src/components/navigationConfig.js`：承接原有 `navItems`、`roleLabels`、`roleDot`、`topbarMap`；值、順序、label、icon mapping、角色色彩與 topbar mapping 完全不變。
- `src/components/Sidebar.jsx`：`Ic` 仍由 `Icons.jsx` 匯入，導覽與角色設定改由 `navigationConfig.js` 匯入。
- `src/components/DashboardApp.jsx`：`topbarMap` 改由 `navigationConfig.js` 匯入。
- `src/pages/StudentCourses.jsx`：effect 建立時捕捉 `wrapperRef.current`，初始化與 cleanup 使用同一個 DOM 節點；既有 `SEGMENT_PREVIEW_COUNT = 3` 與「顯示全部／收合」功能未修改。

這是針對已知 lint blocker 的一次性小範圍例外：未新增依賴、路由、共用狀態，
也未修改 build 或 env 設定。此 handoff 完成後，`fullstack_feature_owner`
前端異動上限恢復為 3 檔。

- `npm.cmd run lint`：PASS（exit 0）。
- `npm.cmd run build`：PASS（exit 0）。
  - Vite 8.0.5，45 modules transformed。
  - bundle 約 933.20 kB。
  - 仍有既有的大 chunk 警告，不影響 build 成功；本輪未擴張至 code splitting。

## 組員／release validator 驗證情境

### 登入

- 成功：教師 tab + 教師帳號進入教師介面；學生 tab + 學生帳號進入學生介面。
- 失敗：教師帳號選學生 tab，應顯示明確身分不符訊息，且不可儲存 token 或進入學生介面。
- 失敗：錯誤密碼與不存在帳號，應顯示後端明確訊息。
- 邊界：後端回傳 role 應是最後導向依據。

### 通知

- 成功：學生登入後可取得影片完成通知，badge 與項目未讀狀態正確。
- 成功：點單筆通知後呼叫 PATCH，項目轉已讀且 badge 減 1。
- 邊界：同一未讀通知快速連點多次，只能觀察到一個 PATCH，badge 只減 1。
- 邊界：任一單筆 PATCH pending 時，「全部標為已讀」必須維持停用；待單筆 request 結束後才能執行 read-all。
- 邊界：通知 dropdown 快速重開造成重疊 GET 時，較舊 response 不得覆蓋較新列表或已讀狀態。
- 成功：有 `nextCursor` 時可逐頁載入更多；跨頁重複 ID 不重複顯示。
- 成功：全部已讀後呼叫 POST，列表與 badge 均歸零。
- 成功：管理員可在 Topbar 通知 dropdown 發送一般或緊急公告，學生重新載入通知後可查到。
- 失敗：API 401/403/500 時 dropdown 應顯示後端訊息，不能把失敗操作假裝成成功。
- 邊界：無通知時顯示空狀態；未讀數超過 9 時 badge 顯示 `9+`。

### 頭像

- 成功：個人頁初次載入 `/auth/me`；若已有頭像，再讀取 authenticated binary endpoint。
- 成功：上傳 JPEG、PNG 或 WebP 後重新 fetch 並顯示新頭像；重新整理頁面後仍顯示。
- 失敗：超過 5 MiB 或非允許格式，前端先顯示明確訊息；偽造 MIME／內容不符則顯示後端錯誤。
- 失敗：未登入、儲存失敗或頭像讀取失敗時顯示 API 訊息。
- 邊界：連續替換頭像後，舊 object URL 應被 revoke；畫面不可顯示本機或後端檔名。
- 邊界：上傳 pending 時重複點頭像、上傳圖示或 input，僅允許一個 PUT。
- 邊界：在 `/auth/me`、avatar GET 或 PUT pending 時登出、切換 token 或離開 Profile，完成／失敗 response 不得改寫 localStorage 或目前畫面。
- 邊界：已建立 blob URL 後 request 才失效時，該 URL 必須立即 revoke。

## 未完成、未驗證與需要組員決定事項

- 本角色未啟動 backend/frontend 服務，也未執行 Playwright；端到端流程、截圖與 runtime pass/fail 由 `release_validator` 執行。
- 通知已支援手動 cursor 載入更多；未做自動無限捲動，避免擴張 UI 與 observer lifecycle。
- Topbar 圓形使用者按鈕仍顯示姓名首字，不同步顯示 binary 頭像；本次要求限定個人頁讀取新頭像，跨元件同步需共用狀態或額外 API lifecycle，會觸及較大範圍，因此未擴張。
- Repo 全量 lint 與 production build 已於 2026-07-26 通過；Playwright 與 runtime 情境仍由 `release_validator` 執行。
- 未執行任何 `git add`、`git commit`、`git push` 或其他版本控制操作。
