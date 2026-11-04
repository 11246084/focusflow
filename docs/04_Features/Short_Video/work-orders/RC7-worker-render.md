# 工作說明：recut RC7（worker 與渲染佇列）

分支 `wip/recut-rc7-worker`，從 `feat/recut` 切出（RC1、RC5 已合併）。先讀 `AGENTS.md` 與 [HANDOFF.md](../HANDOFF.md) 的「必守規則」。

worker 是在組員電腦上常駐的渲染程式，向後端領工作、渲染、自我檢查後上傳成品。VM 渲染預設關閉（第 7 項），本工單只在本機驗證。

## 先讀

1. [recut 設計決策](../recut-design-decisions.md)第 6、7、9、35、36、38、62、63、65 項，「階段與檢查」表的「渲染」「成品審核」列；待答 R3。
2. 成品審核的既有流程：`backend/src/routes/short-script.routes.js` 的 `POST /short-scripts/:scriptId/asset`、`backend/src/controllers/shortScript.controller.js`、`backend/src/services/shortAsset.service.js`、`backend/src/models/shortAsset.model.js`、`backend/src/services/shortAssetRecovery.service.js`。
3. 管理員頁與修改紀錄：`backend/src/routes/admin.routes.js`、`backend/src/services/adminAudit.service.js`、`frontend/focus-flow/src/pages/AdminOverview.jsx`、`frontend/focus-flow/src/components/DashboardApp.jsx`。
4. `.claude/rules/security.md`；RC1 的狀態轉換函式與背景工作；RC5 的渲染指令與版本欄位。

## 要做

1. **worker 專用金鑰**（第 35 項）：管理員在後台為每台電腦各建一組，金鑰只在建立時顯示一次，資料庫只存雜湊值；金鑰只能領渲染工作與上傳成品，其他 API 一律拒絕。管理員頁每台 worker 一列，可「接工作／暫停」與「停用金鑰」（第 7 項）；建立、暫停、停用都寫修改紀錄。
2. **租約與心跳**（第 36 項）：領工作取得 10 分鐘租約，每 60 秒回報延長；逾時放回佇列。每台 worker 一次一支，先到先做；同一支片最多重派 2 次，第 3 次失敗標「渲染失敗」並通知教師與管理員。後端重啟時把租約過期的工作放回佇列（沿用 `recoverQueuedVideoProcessing` 的模式）。
3. **只渲染已核准的版本**（第 63、65 項）：只有講稿核准紀錄對應目前版本的施工單能進佇列；worker 的 short_render 與素材版本和施工單不符時不渲染，回報「版本不符」並通知管理員。
4. **worker 程式**：放在 `short_render/`（例：新增 `bin/` 下的 worker 指令），用 RC5 的渲染流程；後端網址與金鑰用環境變數。
5. **渲染後檢查**（第 62 項）：上傳前用 FFmpeg／ffprobe 檢查規格與長度、黑畫面、靜音、響度與真峰值、字型已載入；不合格不上傳，偶發類交給另一台重渲，固定類第一次就標「渲染失敗」並寫明原因；各項數值隨結果回報並存檔。門檻集中成常數。
6. **成品回傳**（待答 R3）：為 worker 身分設計受限的上傳流程，核對租約、工作與施工單版本，通過後接上現有成品審核的語意（建立待審核的 ShortAsset），不讓教師路由直接接受 worker 金鑰。被接手後原 worker 才上傳的成品拒收，後端刪除已收到的部分檔案；worker 收到拒收或上傳成功後刪除本機成品與暫存檔（第 36 項）。
7. **文件**：OpenAPI 與 API 契約；`backend/.env.example`；`short_render/README.md` 的 worker 使用方式；依第 70 項記錄租約與重派的設計。

## 測試

假的 worker、假的 FFmpeg 結果。至少涵蓋：金鑰只能用在兩個 API；停用與暫停後領不到工作；租約逾時放回、重派次數上限與通知；重啟恢復；版本不符；未核准版本進不了佇列；每項渲染後檢查的偶發與固定分類；遲到的上傳被拒並清除；上傳成功後成品進入待審核。

## 完成時回報

commit 清單、測試結果、和本工單不同之處、成品回傳 API 的契約（交給審查確認 R3），以及 worker 的安裝與執行步驟。
