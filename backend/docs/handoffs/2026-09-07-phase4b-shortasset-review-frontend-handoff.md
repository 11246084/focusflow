# Phase 4B ShortAsset 教師審核前端異動說明

## 任務範圍與觸發原因

本次將教師「短影片審核」頁由示範資料與假送出流程，串接至 Phase 4A 已完成的 ShortAsset review API：

- `GET /api/v1/shorts?reviewStatus=pending&limit=50`
- `GET /api/v1/shorts/:shortAssetId`
- `POST /api/v1/shorts/:shortAssetId/review`

前端使用真實 `shortAssetId` 與 `generationVersion`，送出 `status`、`expectedGenerationVersion`，退件時另送六類結構化 `reasons`。POST 成功後仍會再讀取 detail；detail readback 成功後才顯示完成畫面。通過只更新審核結果，不代表直接發布。

## 小改動／大改動判定

本次 production integration 判定為小改動：

| 判準 | 結果 |
| --- | --- |
| production frontend 修改檔案不超過 3 個 | 符合；修改 2 個既有檔案 |
| 不新增元件、hook、util 或 type 檔 | 符合 |
| 不新增或更新 npm 依賴 | 符合；`package.json`、lockfile 未修改 |
| 不修改 common/shared、共用 hook、Provider、store/slice | 符合 |
| 不修改 router、build、TypeScript 或環境設定 | 符合 |
| 不改既有元件 props 或既有函式參數簽章 | 符合；頁面沒有對外 props；原 mock service 改成已規格化的真實 ShortAsset payload |
| 不新增畫面或路由 | 符合；沿用既有教師審核頁與側欄入口 |

Phase 4B 自動化驗證另在既有 `frontend/focus-flow/tests/` 測試目錄加入一個 contract test，由平行測試工作負責；沒有新增 production module。

## 修改檔案與理由

### `frontend/focus-flow/src/services/videoReview.js`

- 移除 `console.log`、fake success 與錯誤的 `/videos/:id/review` 註解。
- 新增 ShortAsset list、detail、review API 呼叫。
- 建立 approved/rejected request body，approved 不夾帶退件理由。
- 提供六類理由、other note、500 字驗證。
- 將 access denied、not found、validation、network、5xx 映射為教師可理解的訊息。
- 409 stale/conflict 僅重新讀取 detail 一次，不會重送 POST；若自動讀取失敗，保留原錯誤並要求使用者手動重新讀取。
- POST 成功後一定執行 detail readback；讀取失敗會拋錯，不會回報 UI success。

### `frontend/focus-flow/src/pages/TeacherVideoReview.jsx`

- 移除 `SAMPLE_VIDEO` 與所有 mock/fake success 流程。
- 頁面載入 pending ShortAsset 清單，選取後再讀取 detail。
- 顯示標題、課程、生命週期、審核狀態、generation version、description、更新時間與素材 ID。
- 有 `youtubeVideoId` 時提供內嵌預覽；只有 thumbnail 時顯示圖片；兩者皆無時顯示明確的 unavailable 狀態。
- 支援 approve/reject、六類退件原因、other 必填、每項 note 500 字上限與字數提示。
- 送出時使用目前 detail 的 `id` 和 `generationVersion`。
- stale/conflict reload 後保留教師已勾選的 reasons 與 note，回到審核步驟重新確認；不自動重送。
- access、missing、validation、network、5xx 均停留在非成功狀態，retry 需由使用者按鈕觸發。
- 已完成審核的 server state 會停用送出按鈕，避免覆蓋。

## 驗證建議

### 成功情境

1. 以課程 owner teacher 進入審核頁，確認清單只出現可存取的 pending assets。
2. 在清單切換兩支素材，確認 detail、素材 ID 與 generation version 同步更新。
3. Approve 後確認 request 不含 `reasons`，readback 成功後才進完成畫面，且頁面明示不會直接發布。
4. Reject 各選一種或多種理由，確認 backend readback 保留 `{ code, note }` 結構。
5. `other` 有填說明、note 恰為 500 字時可送出。

### 失敗與邊界情境

1. `other` 未填、未選理由、note 超過 500 字時不可進入確認送出。
2. 開頁後觸發 regeneration 再送出，確認 stale 顯示版本更新、只 GET 最新 detail、不自動 POST，既有草稿仍在。
3. 另一個操作先完成同版本審核，再由舊頁送出，確認 conflict reload server state、停用再送出且不覆蓋。
4. 使用非 owner teacher、已刪除 asset、backend validation error、離線及 5xx，均不可進完成畫面。
5. POST 成功但 detail readback 暫時失敗時，不顯示完成；重新讀取後應以 server state 為準，避免直接重送造成 conflict。

## 未完成、未驗證與需決定事項

- 本輪沒有執行 live backend、Atlas、YouTube、LINE 或 Gemini 驗收。
- pending ShortAsset 的 detail contract 目前只提供 `youtubeVideoId`、`youtubeUrl` 與 `thumbnail` 作為預覽來源。若實際待審素材在上傳 YouTube 前三者皆為空，前端只能顯示 metadata 與「沒有可用預覽」；團隊需決定是否由 backend 另提供具權限與時效性的 preview URL。前端不應自行拼接本機檔案路徑。
- 需人工確認手機／窄螢幕下雙欄理由面板、直式 iframe 與長標題的視覺效果。
- OpenAPI 由本輪平行契約工作處理，不在本 frontend production integration 的檔案所有權內。
- 未執行 commit 或 push；請組員檢查整體 Phase 4A/4B diff 後手動處理版本控制。
