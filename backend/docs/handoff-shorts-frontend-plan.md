# Short 影片修課過濾前端串接方案

> 文件狀態：方案待確認；本輪未修改任何 `frontend/` 程式碼。
>
> 對應後端 API：`GET /api/v1/youtube/shorts`

## 1. 任務範圍與觸發原因

後端將學生 Short feed 改為登入後、僅限學生使用的修課過濾清單：只有同時符合「學生已修課、課程為 `published`、ShortAsset 為 `published`、YouTube 可播放」的項目才會回傳。原有 response 欄位 `videoId`、`title`、`thumbnail`、`publishedAt`、`nextPageToken` 保持相容，並新增 `assetId`、`course`、`youtubeUrl`。

現有學生頁面使用未附 JWT 的原生 `fetch`，後端加入驗證後會收到 `401`，因此前端需要改用既有 authenticated API helper。這份文件只規劃後續串接；本輪依明確指示不編輯前端檔案。

本方案不涵蓋自動選片、FFmpeg 剪輯、自動字幕、YouTube 發布 worker、教師 Short 管理頁面或新路由。後端完成修課過濾與 YouTube availability 同步，不代表整條 Short 產線已完成。

## 2. 現況分析

### 實際元件與 API 呼叫

- 實際頁面：`frontend/focus-flow/src/pages/StudentShortsWall.jsx`
- API helper：`frontend/focus-flow/src/api.js`
- 頁面目前從 `api.js` 匯入 `BACKEND_ORIGIN`，使用原生 `fetch` 呼叫 `${BACKEND_ORIGIN}/api/v1/youtube/shorts`，沒有附帶 JWT。
- `api.js` 已有 `apiFetch(path, options)`：會讀取 `ff_token`，存在 token 時自動附加 `Authorization: Bearer <token>`，並統一解析 JSON 與將非 2xx response 轉成帶 `code`、`status` 的 Error。可直接沿用，不需新增 helper、hook 或 util。

### 既有分頁與播放行為

- 首頁不帶 `pageToken`；下一頁使用 `?pageToken=${encodeURIComponent(nextPageToken)}`。
- 頁面讀取 `body.data.items` 與 `body.data.nextPageToken`，載入更多時用 `[...prev, ...data.items]` 附加，不覆蓋既有清單。
- `loadingMore` 防止重複請求；沒有 `nextPageToken` 時不顯示載入更多按鈕。
- 播放 modal 維持 9:16 YouTube iframe embed，使用 `videoId` 播放；背景點擊、右上角按鈕與 `Escape` 可關閉，內容區以 `stopPropagation` 避免誤關閉。

## 3. 後續前端實作的具體改動

預計只修改 `frontend/focus-flow/src/pages/StudentShortsWall.jsx` 一個既有檔案。

### 3.1 改用既有 authenticated `apiFetch`

- 將 `BACKEND_ORIGIN` import 改為 `apiFetch`。
- `fetchPage` 改以 `'/youtube/shorts' + qs` 呼叫 `apiFetch`；`apiFetch` 的 base 已包含 `/api/v1`，不可再拼入完整 origin 或重複 `/api/v1`。
- `apiFetch` 直接回傳解析後的 response body，因此 `fetchPage` 取其 `body.data`；不再自行讀 `res.json()` 或重複判斷 `res.ok`。
- 保留現有 `loadFirst`、`loadMore`、`loading`、`loadingMore`、`error` 與重試流程。未登入 `401`、非學生 `403` 仍由既有錯誤區塊呈現；本次不另建全域登入導向或權限處理。

### 3.2 顯示 Short 所屬課程

- 在每張 `VideoCard` 的資訊區顯示所屬課程，位置建議放在 Short 標題下、發布時間上，讓使用者在點入播放前能辨識來源課程。
- 更新後的 `backend/docs/openapi.yaml` 已固定 `course: { courseId, title }`，兩欄皆必填；卡片直接顯示 `course.title`，不需猜測 `course.name` 或建立 fallback mapping。
- `assetId` 可作為清單項目的 React key；YouTube iframe 仍使用相容欄位 `videoId`，不因新增 `youtubeUrl` 改寫既有 modal 播放方式。
- `youtubeUrl` 保留供未來外連用途；本次需求沒有要求新增外連按鈕，既有播放 modal 不需要使用它。

### 3.3 空清單文案

- 保留現在空狀態容器的位置、樣式與顯示條件 `!loading && !error && items.length === 0`。
- 將現有「目前頻道尚無影片」改為固定文案「目前修課尚無教學短片」。這同時涵蓋學生沒有修課，以及有修課但目前沒有符合 feed 條件的 Short；前端不需自行區分原因。

### 3.4 保持既有分頁與 modal

- opaque `nextPageToken` 只負責原樣送回後端；前端不可解析、重組或自行產生 token。
- 保留既有載入更多的 append 行為與 `loadingMore` 防重複請求。
- 保留 9:16 modal、iframe embed、三種關閉方式與內容區事件阻擋，不改 props 簽章或互動結構。

## 4. 小改動判定

後續若依本方案實作，判定為可直接執行的小改動；本輪仍因使用者要求而只寫方案、不動前端。

| 判準 | 判定 | 說明 |
|---|---|---|
| 改動檔案數不超過 3 個 | 符合 | 預計只修改 `StudentShortsWall.jsx` 1 個前端檔案；本 handoff 文件不計入前端檔案數。 |
| 不新增任何前端檔案 | 符合 | 不新增元件、hook、util 或 type 檔。 |
| 不新增或更新 npm 依賴 | 符合 | 不變更 `package.json`、`package-lock.json`。 |
| 不修改共用資源 | 符合 | `api.js` 只沿用、不修改；不碰 common/shared、共用 hook、Context Provider 或全域 store/slice。 |
| 不修改路由設定 | 符合 | 沿用現有學生教學短片頁面，不新增畫面或路由。 |
| 不修改建置或環境設定 | 符合 | 不動 `vite.config.*`、`webpack.config.*`、`tsconfig.json` 或 `.env*`。 |
| 不變更既有元件對外 props 或既有函式參數簽章 | 符合 | `VideoCard({ video, onClick })`、`VideoModal({ video, onClose })` 與 `fetchPage(pageToken)` 可維持原簽章。 |
| 不做架構調整或狀態管理更換 | 符合 | 延用現有 hooks、inline style、分頁 state 與 modal state。 |

## 5. 組員驗證清單

### 畫面與成功情境

- 學生登入後進入「教學短片」，request 帶有正確 Bearer token，回傳 `200`。
- 卡片只顯示該學生修課範圍內、後端回傳的可播放 Short，且能看見所屬課程。
- 多頁資料可連續載入，項目不被前頁覆蓋；按鈕載入期間不可重複觸發。
- 卡片開啟 modal 後可正常播放，背景、關閉按鈕與 `Escape` 均可關閉。

### 失敗情境

- token 缺失或失效時，`401` 被 `apiFetch` 轉為錯誤並顯示既有錯誤區塊；按重試不造成頁面崩潰。
- 非學生角色收到 `403` 時，不顯示任何 Short，並顯示既有錯誤區塊。
- 網路錯誤或 backend 非 2xx 時，既有錯誤與重試流程正常。
- 非法或過期 `pageToken` 收到 `400` 時，既有項目不被清空，錯誤可見，且 `loadingMore` 最終恢復為 `false`。

### 邊界情境

- `200` 且 `items: []` 時顯示「目前修課尚無教學短片」。
- 最後一頁 `nextPageToken` 為空時不顯示載入更多按鈕。
- 多筆 Short 有相同 `publishedAt` 時，前端只依後端 cursor 結果 append，不自行排序或去重。
- Short 缺少 thumbnail 時仍使用既有 placeholder；course 顯示欄位則必須符合 OpenAPI 的 nullable/required 定義。

## 6. 待確認、未完成與未驗證

- **後端契約已固定：** `course` 為 `{ courseId, title }`，兩欄皆必填；前端實作仍應以 `backend/docs/openapi.yaml` 為準。
- **待組員確認：** 課程顯示欄位過長時是否沿用卡片現有截斷風格；若只需單行省略，可在同一元件內完成，仍不需新增共用元件。
- **本輪未完成：** 未修改 `StudentShortsWall.jsx` 或任何其他前端檔案。
- **本輪未驗證：** 未執行前端 lint、build、瀏覽器或 API 串接測試；應在使用者放行前端實作後再執行。
- **後端邊界：** 本方案假設 `GET /api/v1/youtube/shorts` 已完成 JWT、student-only、修課過濾、opaque cursor 與新增 response 欄位；實作前仍需以實際 runtime 與 OpenAPI 驗證。
