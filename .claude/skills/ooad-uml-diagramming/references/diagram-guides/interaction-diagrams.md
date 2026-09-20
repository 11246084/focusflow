# 互動圖指南：循序圖與通訊圖

## 選擇

- 需要看時間先後、呼叫巢狀、同步／非同步或替代流程：用**循序圖**。
- 需要強調物件連結與協作拓撲、時間軸不是主角：用**通訊圖**。
- 需要表達工作流程、責任泳道或業務決策，而不是物件訊息：改用活動圖。
- `[NTUB:MUST]` 同一流程若章節契約要求二擇一，不同時畫循序圖與通訊圖製造重複資訊。

## 建模順序

1. 從 diagram brief 的單一觸發開始，寫出成功後可觀察的結束條件。
2. 只留下對該情境負責的 actor、boundary、control、entity／repository 與外部系統。
3. 依目前 route、controller、service、model、adapter 或介面契約查證訊息。
4. 先畫主路徑，再加入會改變結果的 `alt`、`opt`、`loop`、`par`；不要把每個 `if` 都搬進圖。
5. 回傳箭頭只保留能說明狀態、資料形狀或錯誤語意者。

## 語意規則

- `[OOAD:MUST]` 每條生命線都能對映到已定義的設計元件或明確的外部 actor／system。
- `[DOC:MUST]` 訊息名稱優先使用已驗證的 endpoint、operation、event 或資料契約；不得憑空發明方法。
- `[UML:MUST]` `alt` 表互斥分支、`opt` 表單一可選分支、`loop` 表重複、`par` 表可並行互動。
- `[DOC:SHOULD]` 同步呼叫、非同步事件與 webhook callback 應使用可辨識的不同箭頭或標註。
- `[FF:SHOULD]` 一張圖只放一個獨立觸發。頁面載入、使用者稍後操作、背景回報通常是不同圖。
- `[DOC:MUST]` `partial`／`planned` 步驟須在訊息或 note 上直接標示，不能只寫在圖外。

## 不要畫

- framework 自動完成且不影響設計判讀的每一層呼叫。
- 沒有證據的 retry、queue、cache、transaction 或 external service。
- 為了「有回傳箭頭」而重複 success／OK，卻沒有資料或狀態語意。
- 把「前端、後端、資料庫」當成全部生命線；那只是分層示意，不是物件互動。

## Review questions

1. 第一個訊息是否對應 brief 的觸發，最後結果是否可觀察？
2. 每個 participant 與 message 是否能指出來源？
3. 分支條件是否真的改變流程或輸出？
4. 是否混入另一個獨立觸發或無關子流程？
5. 圖中的訊息能否與設計類別操作、元件介面或 API 契約互相對照？
