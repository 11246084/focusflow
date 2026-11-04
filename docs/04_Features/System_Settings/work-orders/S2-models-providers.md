# 工作說明：系統設定 S2（模型與 provider）

你在 FocusFlow repo 的一個 git worktree 裡工作，分支 `wip/system-settings-s2-models`，從已合併 S1 的 `feat/system-settings` 切出。先讀 repo 根目錄的 `AGENTS.md` 與 [HANDOFF.md](../HANDOFF.md) 的「必守規則」並遵守。**下方「開工前確認事項」由使用者確認之前不要開工。**

## 開工前確認事項（待使用者確認）

決策第 41 項要求以下細節先經使用者確認。以下是建議值：

1. **自接連線的主機白名單**：環境變數 `CUSTOM_LLM_ALLOWED_HOSTS`，逗號分隔，主機名稱完全比對（可含連接埠），空值代表不允許任何自接連線。連線的金鑰欄位只能填**環境變數名稱**，而且名稱必須符合 `^CUSTOM_LLM_KEY_[A-Z0-9_]+$`，避免管理員把 `JWT_SECRET`、`MONGODB_URI` 等其他密鑰指給外部端點。
2. **個資遮罩規則**：只遮蔽送往外部模型（查詢向量與回答生成）的文字；資料庫裡保存的學生原始提問不變。學號：前後不是數字的連續 8 碼數字；Email：一般 Email 格式；電話：手機 `09` 開頭共 10 碼（可含 `-` 或空白）、市話 `0` 開頭加區碼共 9～10 碼。分別換成 `[學號]`、`[Email]`、`[電話]`。log 只記錄各類遮了幾個，不記錄原文。
3. **測試資料**：至少 20 題，包括應該遮蔽的（學號、各種 Email 與電話寫法）和**不應該遮蔽**的（年份「2026年」、「第 3 章」、程式碼裡的數字如 `1024`、短的數字），兩類都要寫成自動測試。

## 先讀

1. [decisions.md](../decisions.md)：第 3、10、12～17、26～28 項，以及待討論中「自接模型連線」「送出外部模型前遮罩個資」的原文（第 41 項已納入第一版）。
2. S1 的回報：定義表、`getSetting` 與修改紀錄的介面。
3. `backend/src/services/answerGeneration.service.js`（Gemini 的 `responseSchema`、寫死的 `api.openai.com`、失敗時退回 template 的路徑）、`queryEmbedding.service.js`、`qa.service.js`、`faqCache.service.js`、`models/faq.model.js`、`models/message.model.js`、`models/usageLog.model.js`、`notification.service.js`、`shortScriptGeneration.service.js`。
4. `backend/src/services/loginThrottle.service.js`（限流器可參考的寫法）。
5. 前端學生問答頁與 admin 系統設定頁（S1 建立的「AI 問答」區）。

## 要做

1. **provider 層**：把回答生成整理成可替換的 provider 介面，實作 Gemini（現有）、OpenAI 相容（現有 OpenAI 路徑改成可設定端點，不再寫死網址）、Anthropic（新增）。三者輸出同一種 JSON 格式（引用來源、答不出來）。8 拍腳本與 recut 第一版仍只用 Gemini，但模型 ID 改由 S1 的設定讀取（第 3、15 項）。
2. **可不可以用的判斷**（第 14 項）：provider 層面三個條件（有程式、有金鑰、列出模型成功；啟動時與每 6 小時檢查一次），模型層面四個條件（在清單中、通過格式測試、不在 10 分鐘跳過期、管理員有開放）。
3. **模型清單與格式測試**（第 12、13 項）：`GET /admin/models`、`POST /admin/models/refresh`（清單快取 10 分鐘，只留文字生成模型）；開放模型清單是 S1 的設定值 `qaOfferedModels`，內容含伺服器端代號、provider、模型 ID、顯示名稱、說明、排序、計算倍率；加入新模型時在驗證中做格式測試，不合格不能存。改預設模型與開放清單需要 step-up（第 29 項）。
4. **自接連線**（第 41 項②，規則照上方確認事項）：admin 新增、修改、停用連線；不跟隨轉址、設逾時、只允許 http 與 https；新增前要 step-up 並寫入修改紀錄。
5. **學生選模型**（第 10 項）：`GET /qa/models` 只回代號、顯示名稱、說明與倍率；網頁問答以對話為單位帶入選擇；每則回答記錄 provider 與模型並顯示「由 ○○ 回答」。學生端與 API 只傳代號（第 12 項）。LINE 的選擇介面在 S4，本工單只提供「讀寫學生的 LINE 模型選擇」的服務函式。
6. **FAQ 快取依 provider 區分**（第 16 項）：快取紀錄加記 provider，只比對同一家；舊紀錄視為 gemini；命中時標示「快取答案，原由 ○○ 回答」。同步 `respondFromFaqCache`。
7. **故障換模型與故障事件**（第 17 項）：依序改用預設模型、其他開放模型；失敗模型 10 分鐘內跳過；故障事件記錄受影響人數；通知每位 admin，同一模型 24 小時一次並附累計人數；8 拍腳本與 recut 不自動換模型。
8. **個資遮罩**（第 41 項③，規則照上方確認事項）：在查詢向量與回答生成送出前套用。
9. **錯誤遮蔽、限流、模型 ID 白名單**（第 26～28 項）：共用的 `sanitizeProviderError`，後台測試結果只顯示分類；admin 的重新抓取與測試呼叫每分鐘 5 次、全站同時最多 2 個；模型 ID 格式白名單且必須在最近清單內。
10. **文件**：OpenAPI、API 契約、錯誤碼表、`.env.example`。

## 測試

全部用假的 `fetchImpl`，不打真的 API。至少涵蓋：三家 provider 的成功、格式錯誤、逾時、金鑰錯誤；錯誤訊息不含 `sk-…`、`AIza…`、`Bearer …`；七個可用條件各自不成立時模型被隱藏；格式測試不合格不能開放；學生不能指定未開放的代號；快取不跨 provider 命中、舊快取算 gemini；故障時依序換模型、跳過期、通知只發一次；自接連線拒絕白名單外的主機、轉址與不合規的金鑰變數名稱；限流；個資遮罩的應遮與不應遮兩類測試資料。

## 完成時回報

commit 清單、測試結果（已執行與未執行分開列）、和本工單不同的地方與原因，以及給 S3（每次回答的實際 token 從哪裡取得）、S4（讀寫 LINE 模型選擇的函式）使用的介面。
