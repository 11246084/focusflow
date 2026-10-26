# 工作說明：系統設定 S5（管理員建立教師帳號）

你在 FocusFlow repo 的一個 git worktree 裡工作，分支 `wip/system-settings-s5-teachers`，從 `feat/system-settings` 切出。先讀 repo 根目錄的 `AGENTS.md` 與 [HANDOFF.md](../HANDOFF.md) 的「必守規則」並遵守。本工單與 S1～S4 沒有相依，可以隨時開工。

## 開工前確認事項（待使用者確認）

以下兩點是工單提出的建議，決策文件尚未定案；使用者確認前不要開工。

1. **初始密碼怎麼給**：建議由系統產生隨機密碼並**寄到教師的 Email**，畫面不顯示；寄信失敗時帳號仍建立，畫面提示可以重寄。另一個做法是只在建立當下顯示一次，由 admin 轉交，缺點是密碼會經過第二個人。
2. **建立教師要不要 step-up**：建議要。教師帳號能管理課程與影片，屬於高風險操作，和升為 admin 同等處理（第 29 項）。

## 先讀

1. [decisions.md](../decisions.md)：第 41 項①，以及待討論中「管理員建立教師帳號」的原文；第 6、29、30 項（修改紀錄、step-up、帳號安全）。
2. [httpOnly cookie 決策](../../HttpOnly_Cookie/decisions.md)第 17、25 項：`emailVerifiedAt`、`mustChangePassword` 與首次登入流程。
3. 學生名單匯入的現有做法：`backend/src/services/enrollment.service.js`（匯入檢查、建立帳號）、`backend/src/scripts/importStudents.js`；`admin.service.js`、`admin.controller.js`、`admin.routes.js`；前端 admin 使用者頁。

## 要做

1. **單筆新增教師**：admin 在使用者頁填姓名與 Email 建立教師帳號；系統產生隨機初始密碼（不使用學號或任何可猜的值），帳號設 `mustChangePassword`，第一次登入要驗證信箱並改密碼（沿用 cookie 功能的首次登入流程）。初始密碼的交付方式依上方確認事項第 1 點。
2. **CSV 匯入教師**：欄位與檢查沿用學生名單匯入（重複 Email、格式錯誤逐列回報）；已存在的帳號不修改密碼、不改角色，只回報。
3. **權限與紀錄**：只有 admin 能用；是否需要 step-up 依上方確認事項第 2 點；每筆建立與匯入結果寫入 `adminAuditLogs`。
4. **文件**：OpenAPI、API 契約、錯誤碼表。

## 測試

至少涵蓋：非 admin 403；沒有 step-up 被拒；單筆建立後 `mustChangePassword` 為真且無法略過首次登入；初始密碼不出現在回應與 log；CSV 逐列錯誤回報；已存在帳號不被修改；寫入修改紀錄。

## 完成時回報

commit 清單、測試結果（已執行與未執行分開列）、和本工單不同的地方與原因。
