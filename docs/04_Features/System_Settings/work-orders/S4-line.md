# 工作說明：系統設定 S4（LINE 按鈕與防重放）

你在 FocusFlow repo 的一個 git worktree 裡工作，分支 `wip/system-settings-s4-line`，從已合併 S1（最好也已合併 S2、S3）的 `feat/system-settings` 切出。先讀 repo 根目錄的 `AGENTS.md` 與 [HANDOFF.md](../HANDOFF.md) 的「必守規則」並遵守。**[LINE 綁定](../../LINE_Binding/decisions.md)定案前不要開工**：圖文選單上要不要有「綁定帳號」、綁定碼何時停用，由那份文件決定。

## 先讀

1. [decisions.md](../decisions.md)：第 11、31、35 項，以及待討論的「圖文選單依學生狀態切換」。
2. [LINE 綁定決策](../../LINE_Binding/decisions.md)的定案內容。
3. LINE 官方文件：[接收 webhook](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)、[圖文選單](https://developers.line.biz/en/docs/messaging-api/rich-menus-overview/)、[快速回覆](https://developers.line.biz/en/docs/messaging-api/using-quick-reply/)。
4. `backend/src/services/line.service.js`（切換課程、postback、綁定碼）、`backend/src/middleware/lineSignature.middleware.js`、`backend/src/middleware/internalProcessingAuth.middleware.js`、`backend/src/app.js`（raw body）。
5. S2、S3 的回報：LINE 模型選擇、額度查詢與重置券兌換的服務函式。

## 要做

1. **postback 共用解析器**（第 31 項）：`action` 白名單，每個 action 宣告欄位與格式；每次重新檢查權限（課程修課、模型是否開放、券是否屬於本人）；一次性動作（使用重置券）帶短效 nonce，原子消耗；依 `webhookEventId` 去除重複（TTL 集合，約保留 1 天）；先回 200，再在背景處理 AI 回答。
2. **Flex 卡片**：切換課程與切換模型改成 Flex 卡片，目前使用中的標示「使用中」，最多 12 張；取代切換課程的 Buttons Template。
3. **快速回覆**：每則回答附「換模型」「換課程」；回答結尾附「（由 ○○ 回答）」。
4. **本月額度**：回覆今日與本月百分比與重置時間；有重置券時附「使用重置券」按鈕。
5. **圖文選單**：在 repo 內新增建立腳本與 2500×843 圖片（四格：切換課程、切換模型、本月額度、網頁版），用 Messaging API 建立。**只寫腳本，不要執行**；建立屬於對外設定，部署時由使用者授權。保留「切換課程」「切換模型」文字指令（電腦版 LINE 不顯示圖文選單）。
6. **低風險修正**（第 35 項）：LINE 簽章與內部 webhook 共用密鑰改用 `crypto.timingSafeEqual`（先確認長度相同）；webhook 的 raw body 不是 Buffer 時回 400。
7. **文件**：API 契約、`.env.example`、部署文件中圖文選單的建立與退回步驟。

## 測試

全部用假的 LINE 呼叫。至少涵蓋：未知 action 與格式錯誤的欄位被拒並回固定訊息；重按舊按鈕、同一事件重送（相同 `webhookEventId`、`isRedelivery`）只處理一次；重置券 nonce 只能用一次；模型未開放時切換失敗；先回 200 後處理；Flex 卡片標示使用中；簽章比對長度不同時不會丟例外；Content-Type 錯誤回 400。

## 完成時回報

commit 清單、測試結果（已執行與未執行分開列）、和本工單不同的地方與原因、新集合與索引清單，以及部署時要授權執行的圖文選單腳本與退回方式。
