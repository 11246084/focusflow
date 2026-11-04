# 工作說明：系統設定 S3（學生額度）

你在 FocusFlow repo 的一個 git worktree 裡工作，分支 `wip/system-settings-s3-quota`，從已合併 S1 的 `feat/system-settings` 切出。先讀 repo 根目錄的 `AGENTS.md` 與 [HANDOFF.md](../HANDOFF.md) 的「必守規則」並遵守。S2 可能同時在改問答流程，見 HANDOFF 的分工說明。

## 先讀

1. [decisions.md](../decisions.md)：第 18～21 項、第 6 項（修改紀錄）、第 31 項（重置券在 LINE 的兌換由 S4 處理）。
2. S1 的回報：定義表、`getSetting` 與修改紀錄的介面。
3. `backend/src/services/askLimits.service.js`、`costControl.service.js`、`qa.service.js`、`models/usageLog.model.js`、`models/user.model.js`（`dailyAskLimitOverride`）、`admin.service.js`、前端使用者管理頁與學生問答頁。

## 要做

1. **記錄實際 token**（第 18 項）：每次回答取 provider 回應的輸入與輸出 token，乘上模型倍率後存進 `usageLog`；命中快取記 0。S2 尚未合併時先從 Gemini 的 `usageMetadata` 取得，倍率預設 1。
2. **兩段上線**（第 19、43 項）：額度模式設定 `quota.mode`，值為 `record_only`（預設：只記錄 token，維持現有每日 5 題）或 `tokens`（改用 token 上限）。切換需要 step-up。
3. **每日、每月 token 上限**：依台灣時間重置（同時修正 `costControl.service.js` 以 UTC 計算月份的問題）；學生只看到百分比與重置時間；用量已達上限才擋，讓用量超過上限的那一題可以答完。全站每月總預算 `QA_MONTHLY_TOKEN_BUDGET` 留在環境變數。
4. **原子預扣**（第 20 項）：提問前用單一條件更新預扣（「已用 + 預估 ≤ 上限」才扣），答完依實際用量多退少補，失敗退回；每位學生同時只能有 1 題在處理。新集合需要的唯一索引寫進獨立的建立腳本（比照 `backend/src/scripts/ensureAuthAuditLog.js`），model 設 `autoCreate: false`、`autoIndex: false`；**不要對共用 Atlas 執行腳本**。
5. **重置券**（第 21 項）：admin 發給單一學生、一門課或全部學生，填理由並寫入修改紀錄；學生用完今日額度時在網頁看到並自行使用，只重置當天、記錄重置時間點、不刪紀錄；月底失效；兌換用單一條件更新（屬於本人、未使用、未過期）。LINE 上的兌換按鈕由 S4 做，本工單提供兌換服務函式。
6. **個別每月上限**：使用者頁比照 `dailyAskLimitOverride`，讓 admin 調整單一學生的每月上限；修改寫入修改紀錄。
7. **前端**：學生問答頁顯示今日與本月的百分比與重置時間、重置券提示；admin 使用者頁的發券與個別上限；系統設定頁「學生使用額度」區加入新設定。
8. **文件**：OpenAPI、API 契約、錯誤碼表、`.env.example`。

## 測試

至少涵蓋：`record_only` 下行為與現在相同；token 與倍率計算、快取記 0；台灣時間的日界與月界（含月底最後一天 23:59 與次月 00:00）；同時送出 20 題只放行上限內的數量；同一學生同時第 2 題被擋；失敗退回額度；重置券並行兌換只成功一次、過期與非本人不能兌換、只重置當天；發券與調整上限寫入修改紀錄；教師與學生不能發券。

## 完成時回報

commit 清單、測試結果（已執行與未執行分開列）、和本工單不同的地方與原因、新集合與索引清單（部署時要授權建立），以及給 S4 使用的兌換與額度查詢函式。
