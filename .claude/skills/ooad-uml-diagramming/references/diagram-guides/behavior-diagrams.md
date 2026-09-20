# 行為圖指南：活動圖與狀態機圖

## 選擇

- **活動圖**回答「工作如何流動」：action、decision、merge、fork/join、泳道責任。
- **狀態機圖**回答「單一 classifier 如何因事件改變狀態」：state、event、guard、effect。
- 使用者切換頁面不是 domain state；畫面導覽改用畫面移轉圖。

## 活動圖

- `[UML:MUST]` 有明確起點與結束；decision 的 outgoing edge 有互斥 guard。
- `[UML:MUST]` 並行工作用 fork/join，不用 decision diamond 假裝並行。
- `[DOC:SHOULD]` 泳道表示責任擁有者，不只是視覺分欄；同一 action 只屬一個主要責任者。
- `[DOC:SHOULD]` 只保留影響流程理解的資料物件與例外路徑。

## 狀態機圖

- `[UML:MUST]` 一張圖只建模一個 classifier。
- `[UML:MUST]` transition 使用 `event [guard] / effect` 語意；不要只寫模糊動詞。
- `[OOAD:MUST]` state 是持續一段時間、影響允許行為的條件，不是瞬間 action。
- `[DOC:MUST]` 尚不存在的狀態或轉換標示 `planned`，不能由 roadmap 推成已實作。
- `[DOC:SHOULD]` 若程式碼已有狀態常數與 transition guard，圖名與拼字沿用目前契約。

## Review questions

1. 圖回答的是流程還是單一物件生命週期？
2. decision guards 是否完整且可理解，並行是否正確配對？
3. 每個狀態是否能持續存在，而不是 action 或畫面名稱？
4. 每個 transition 是否有可辨識的 trigger？
5. 圖中狀態與目前 schema／service transition 是否一致？
