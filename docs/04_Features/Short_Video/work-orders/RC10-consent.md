# 工作說明：recut RC10（同意流程與撤回）

分支 `wip/recut-rc10-consent`，從 `feat/recut` 切出（RC1 已合併）。先讀 `AGENTS.md` 與 [HANDOFF.md](../HANDOFF.md) 的「必守規則」。

**協調**：撤回時要把 YouTube 影片轉私人，會用到 `youtubeUpload.service.js`；[YouTube 恢復與清理](../../YouTube_Lifecycle/HANDOFF.md)正在另一個分支修改相關檔案，開工前先看它的狀態，避免同時改同一段程式。

## 先讀

1. [recut 設計決策](../recut-design-decisions.md)第 11、12、28、37、39、45、78、81、82 項；待答 R4。
2. `frontend/focus-flow/src/pages/TeacherUpload.jsx`、`backend/src/models/video.model.js`、`backend/src/models/shortAsset.model.js`（`consentConfirmed`）、`backend/src/services/shortAssetPublish.service.js`、`backend/src/services/youtubeUpload.service.js` 的 `privatizeVideoOnDelete`、`backend/src/services/notification.service.js`。

## 要做

1. **條款版本**（第 11 項）：系統內的 PoC 版同意條款有版本號；每筆同意記錄誰、何時、同意哪一版。同意與撤回紀錄只新增、不刪除。
2. **上傳長影片時的內容同意**（第 78 項①、第 82 項）：涵蓋逐字稿與向量化供問答，以及短片衍生內容；這是上傳的必要條件。
3. **生成短片時的聲音與肖像同意**（第 78 項②、第 81 項）：選 recut 時詢問是否使用教師聲音，第一次問、記住選擇，可改選，改選留紀錄；選數位分身時取得肖像與聲音複製的同意。提供 RC9 需要的讀取與更新 API。
4. **現有資料**（第 39 項）：教授的影片由團隊代為記錄同意。寫一支補登腳本，預設只列出會寫入的內容（dry-run），**不得對共用 Atlas 執行**；實際執行由使用者另外授權。
5. **撤回**（第 37 項）：撤回後不能再選需要該同意的產片方式，處理中的工作停止；列出已做好的短片供教師逐支勾選下架（有全選、預設不勾）；勾選的 ShortAsset 改 `archived`、YouTube 轉私人、未上架的取消。轉私人失敗時通知每一位管理員，並在管理員頁列出待手動下架的影片。現有 `privatizeVideoOnDelete` 只處理 Video，ShortAsset 要另寫對應版本。
6. **條款草稿**（待答 R4）：參考網路範本起草，涵蓋授課內容、教師聲音、肖像與聲音複製、合成語音揭露、實際使用的外部服務（Gemini；合成語音版的 Azure 依 RC12 再補）、撤回與逐支下架、已下載或轉傳的影片無法收回。**不得寫成 recut 會送資料給 TypeSafe**（第 46 項）。草稿放在文件中並標明「尚未經使用者確認」。

## 測試

YouTube 一律用假的 `fetchImpl`。至少涵蓋：未同意內容不能上傳；聲音同意記住與改選；撤回後不能選對應方式、處理中工作停止；逐支下架與全選；轉私人失敗時每位管理員各一則通知；同意紀錄只新增；補登腳本 dry-run 不寫入。

## 完成時回報

commit 清單、測試結果、和本工單不同之處、條款草稿位置（交給使用者確認）、補登腳本的執行方式。
