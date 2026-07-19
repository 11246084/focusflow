# Short 教學短片牆前端串接完成交接

## 1. 任務範圍與觸發原因

本次任務串接已完成的 `GET /api/v1/youtube/shorts` 後端變更。後端 Short API 現在需要 JWT 驗證，並依登入學生的修課資料回傳可觀看的 Short。原本 `StudentShortsWall.jsx` 使用原生 `fetch`，請求不會自動附帶登入 token，因此後端會回傳 `401`。

前端因此改用專案既有的 `apiFetch(path, options)`。此 helper 會從 `localStorage` 讀取 `ff_token`，並在 token 存在時自動加入 `Authorization: Bearer <token>`。本次沒有新增 API helper、元件、hook、util、依賴、畫面或路由。

本次前端程式修改範圍只有：

- `frontend/focus-flow/src/pages/StudentShortsWall.jsx`

另依交接要求新增本文件：

- `backend/docs/handoff-shorts-frontend-done.md`

## 2. 小改動判定

本次判定為小改動，全部判準均符合。

| 判準 | 結果 | 實際情況 |
|---|---|---|
| 改動檔案數不超過 3 個 | 符合 | 只修改 1 個既有前端檔案；強制 handoff Markdown 不計入前端檔案數。 |
| 不新增任何前端檔案 | 符合 | 沒有新增元件、hook、util 或 type 定義檔。 |
| 不新增或更新 npm 依賴 | 符合 | 沒有修改 `package.json` 或 `package-lock.json`。 |
| 不修改共用資源 | 符合 | 只沿用 `src/api.js` 已有的 `apiFetch`，沒有修改它，也沒有修改 common/shared、共用 hook、Context Provider 或 store/slice。 |
| 不修改路由設定 | 符合 | 沿用既有「教學短片」頁面，沒有新增畫面或路由。 |
| 不修改建置或環境設定 | 符合 | 沒有修改 Vite、Webpack、TypeScript 或 `.env` 設定。 |
| 不變更既有元件對外 props 介面或函式參數簽章 | 符合 | `VideoCard({ video, onClick })`、`VideoModal({ video, onClose })` 與 `fetchPage(pageToken)` 的簽章均未變更。 |
| 不做架構調整或狀態管理更換 | 符合 | 保留原元件結構、React hooks、inline style、state 與互動方式。 |
| 不新增畫面或新路由 | 符合 | 沒有新增畫面或路由。 |

## 3. 具體改動

### 3.1 Short API 改用 authenticated `apiFetch`

- 改動前：頁面從 `src/api.js` 匯入 `BACKEND_ORIGIN`，以原生 `fetch` 呼叫完整的 `/api/v1/youtube/shorts` URL，再自行執行 `res.json()` 與 `res.ok` 錯誤判斷。這個呼叫不會自動帶入目前登入者的 JWT。
- 改動後：頁面改為匯入 `apiFetch`，以 `apiFetch('/youtube/shorts' + qs)` 呼叫 API。`apiFetch` 的 base URL 已包含 `/api/v1`，並會自動附加 `Authorization: Bearer <token>`；頁面直接讀取 helper 回傳資料的 `body.data`。
- `fetchPage(pageToken)` 的參數簽章、query string 組法，以及呼叫端均維持不變。

### 3.2 顯示 Short 所屬課程名稱

- 改動前：每張 Short 卡片只顯示 Short 標題與發布時間。
- 改動後：在 Short 標題下、發布時間上方加入 `video.course.title`，顯示後端回傳的課程名稱。
- 顯示方式沿用卡片既有的 inline style 與文字層級，沒有新增共用元件或變更 `VideoCard` props。

### 3.3 更新空清單文案

- 改動前：清單為空時顯示「目前頻道尚無影片」。
- 改動後：相同空狀態容器與條件改為顯示「目前修課尚無教學短片」。
- 空狀態判斷 `!loading && !error && items.length === 0` 未變更。

## 4. 明確未變動的部分

### 分頁邏輯未變動

- 首頁仍以空字串呼叫 `fetchPage('')`，不帶 `pageToken`。
- 下一頁仍將 `nextPageToken` 經 `encodeURIComponent` 後放入 query string。
- 載入更多仍使用 `setItems((prev) => [...prev, ...data.items])` 附加資料，沒有覆蓋既有項目。
- `if (!nextPageToken || loadingMore) return` 的防重複請求條件未變動。
- `loadingMore` 的開始、結束狀態與載入更多按鈕行為未變動。

### 播放 modal 未變動

- `VideoModal` 元件內容未修改。
- 仍維持 9:16 播放版面與 YouTube iframe embed，並繼續使用 `video.videoId`。
- 背景點擊、右上角關閉按鈕與 `Escape` 關閉方式均保留。
- modal 內容區的 `stopPropagation` 仍保留，點擊播放器不會誤關閉 modal。

## 5. 驗證方式

### 測試帳號與畫面

1. 啟動 backend 與 frontend，確認 demo seed 已建立示範資料。
2. 使用學生帳號登入：
   - Email：`student@focusflow.local`
   - 密碼：`Student123!`
3. 進入學生端的「教學短片」畫面。

### 成功情境

- Short request 應帶有目前登入學生的 Bearer token，後端回傳 `200`。
- 畫面應只顯示後端依該學生修課範圍回傳的 Short。
- 每張 Short 卡片應顯示 Short 標題、所屬課程名稱與發布時間。
- 有下一頁時，按「載入更多」應將新項目附加在現有清單後面；載入期間不能重複觸發。
- 點擊 Short 後應開啟 9:16 YouTube 播放 modal；背景、右上角按鈕與 `Escape` 應可正常關閉。

### 失敗情境

- token 缺失或失效時，後端 `401` 應由 `apiFetch` 轉為錯誤，畫面顯示既有錯誤區塊與「重試」按鈕。
- 非學生角色收到 `403` 時，畫面應顯示既有錯誤區塊，不應顯示 Short 清單。
- 網路錯誤或其他非 2xx response 時，既有錯誤顯示與重試流程應維持可用。
- 非法或過期 `pageToken` 收到 `400` 時，先前已載入的項目不應被清空，且 `loadingMore` 最後應恢復為 `false`。

### 邊界情境

- 後端回傳 `200` 且 `items: []` 時，應顯示「目前修課尚無教學短片」。
- `nextPageToken` 為空時，不應顯示「載入更多」按鈕。
- Short 缺少 thumbnail 時，應維持既有 placeholder。
- 多頁或相同發布時間的 Short 應完全依後端順序附加，前端不自行解析 cursor、排序或去重。

## 6. 已執行的檢查

- `npm.cmd run build`：通過。Vite production build 成功；輸出另有既有的大型 chunk 警告。
- `npm.cmd run lint`：未通過。問題位於本次未修改且不在範圍內的 `src/components/Icons.jsx`（4 個 `react-refresh/only-export-components` errors），另有 `src/pages/StudentCourses.jsx` 的 1 個 `react-hooks/exhaustive-deps` warning；輸出沒有指出 `StudentShortsWall.jsx` 問題。
- `node_modules/.bin/eslint.cmd src/pages/StudentShortsWall.jsx`：通過，修改頁面沒有 ESLint 問題。

## 7. 待確認、未驗證與組員決定事項

- 沒有發現與現有前端架構不相容、需要改動共用資源或需要組員決定的新設計。
- 尚未在瀏覽器中以實際學生帳號進行端對端操作，也未對 live backend 執行 API smoke；上述帳號、畫面與情境需由組員在可用環境確認。
- 課程名稱直接使用後端契約的必填欄位 `course.title`；本次沒有加入契約外 fallback。
- repo-wide lint 的既有錯誤未在本任務中處理，避免擴大修改範圍。
- 本次未執行任何 Git 指令，也未執行 `git add`、`git commit`、`git push`、`git checkout` 或 `git merge`。
