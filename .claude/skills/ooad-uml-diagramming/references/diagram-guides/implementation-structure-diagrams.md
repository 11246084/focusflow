# 實作結構指南：套件圖、元件圖與佈署圖

## 三種視角不可混用

| 圖種 | 回答的問題 | 核心元素 |
|---|---|---|
| 套件圖 | 程式或模型如何分群，誰依賴誰？ | package、namespace、dependency |
| 元件圖 | 哪些可替換單元透過什麼介面合作？ | component、provided/required interface |
| 佈署圖 | runtime artifact 跑在哪個節點，如何通訊？ | node、execution environment、artifact、communication path |

同一份程式碼可出現在三種圖，但不能在一張圖裡同時把目錄、服務介面與 VM 拓撲當作同一層元素。

## 套件圖

- `[DOC:MUST]` 先宣告分群準則：實體目錄、namespace、邏輯 layer 或 bounded context，單圖內保持一致。
- `[UML:MUST]` dependency 箭頭由依賴者指向被依賴者；標註依賴原因可提升可讀性。
- `[OOAD:MUST]` 套件名稱是穩定名詞，不是「登入」「取得資料」等流程步驟。
- `[DOC:SHOULD]` 發現 cycle 時標示並解釋，不得為了讓圖漂亮而刪掉已存在的反向依賴。
- `[DOC:SHOULD]` 套件圖不是完整目錄樹；只畫對設計問題有意義的 package 與跨 package dependency。

## 元件圖

- `[UML:MUST]` 元件是可替換／可部署／可由介面隔離的單元，並標示 provided／required interface。
- `[OOAD:MUST]` component 與 interface 應能對照實際 service boundary、adapter contract、API 或可替換 provider。
- 只有資料夾與 import 關係時使用套件圖，不把每個 class 包成 component。

## 佈署圖

- `[UML:MUST]` artifact 放在實際執行或儲存它的 node／execution environment 內。
- `[UML:MUST]` node 間 communication path 標示協定或連線性質。
- `[DOC:MUST]` 易變的 URL、secret、暫時 tunnel 與未 live 驗證環境不得畫成固定事實。
- `[DOC:SHOULD]` planned node 或 future scaling 以 stereotype／note 明確區分。

## Review questions

1. 圖只回答 package、component 或 deployment 中的一種主要問題嗎？
2. 套件分群準則是否一致，依賴方向是否與目前 import／call evidence 相符？
3. 元件是否真有介面與替換邊界，而不只是大方塊？
4. 佈署 artifact、node 與通訊協定是否有目前設定或 runtime 證據？
5. 是否忠實呈現 cycle、partial 與 planned 狀態？
