# FocusFlow AI 程式碼理解指南

最後核對：2026-08-12

這份文件用來說明 FocusFlow 如何把教學影片轉成可搜尋資料，以及學生提問後如何找出片段、生成答案並回傳時間戳。內容以目前程式碼為準，適合用來向指導教授口頭說明；部署狀態仍以 [`current-status.md`](current-status.md) 與 `/health` 的即時結果為準。

## 30 秒說法

FocusFlow 不是把整支影片直接交給 AI 回答。系統先把影片語音轉成逐字稿，再切成帶有開始與結束時間的文字片段；每個片段會被轉成 3072 維向量。學生提問時，問題也會被轉成同一套向量，系統用向量相似度找出最接近的課程片段，再把這些片段交給語言模型整理答案。回應會保留來源影片、文字摘要與時間戳，因此學生能回到原影片核對。

## 一、從影片到答案的完整流程

```text
教師上傳影片或提供 YouTube URL
  → FFmpeg / yt-dlp 取得音訊
  → Faster-Whisper 產生帶時間戳逐字稿
  → 專有名詞正規化
  → 相鄰逐字稿切成 Leaf chunks
  → Gemini 產生文件向量並做 unit-L2 正規化
  → uploader 寫入 MongoDB video_segments_text

學生在網頁或 LINE 提問
  → JWT / LINE 綁定與課程存取檢查
  → FAQ 完全相同問題快取
  → 問題轉成同一向量空間的 query vector
  → FAQ 語意快取
  → 課程範圍內的 Atlas 或 memory 向量檢索
  → 取回相關片段，交給回答模型
  → 回傳 answer、citations、answerStatus 與時間戳
  → 記錄 Question / UsageLog；合格回答可寫入 FAQ 快取
```

網頁與 LINE 並沒有各自實作一套 AI。兩者最後都呼叫 `qa.service.askQuestion()`，所以權限、檢索、答案、citation 與紀錄邏輯共用。

## 二、Embedding 到底是什麼

Embedding 是把一段文字轉成一串數字。這串數字可視為文字在「語意空間」中的座標：意思相近的文字，其向量方向通常較接近；字面不同但語意相似的問法，因此仍可能找到同一段教材。

現行 stable Gemini 文字搜尋契約如下：

| 契約項目 | 現行值 | 為什麼重要 |
|---|---|---|
| Provider / model | Gemini `gemini-embedding-2` | Query 與文件必須使用相容模型 |
| 維度 | 3072 | 每個向量必須有相同數量的座標 |
| Query instruction | `task: search result \| query: <問題>` | 告訴模型這段文字是搜尋問題 |
| Document instruction | `title: none \| text: <片段>` | 使用 Gemini Embedding 2 官方的非對稱檢索文件格式 |
| task type | `null` | stable 契約不再使用 preview `RETRIEVAL_QUERY` / `RETRIEVAL_DOCUMENT` |
| 正規化 | `unit_l2_v1` | 把向量長度固定為 1，讓比較聚焦在方向 |
| generation | `text_search_generation_v2` | 防止不同批次、不同規則的向量被誤混 |
| contract | `gemini_embedding_2_text_v2` | Backend、Pipeline、Database 的共同版本標記 |

「同樣是 3072 維」不代表一定能比較。模型、instruction、generation 與正規化規則只要有一項不同，就可能落在不同向量空間。Backend 的 `/health` 因此逐欄檢查完整契約，不只檢查維度。

## 三、Cosine similarity 如何比較向量

Cosine similarity 比較兩個向量的方向：

```text
cos(A, B) = (A · B) / (||A|| × ||B||)
```

- `A · B` 是對應座標相乘後加總。
- `||A||` 與 `||B||` 是兩個向量的長度。
- 越接近 `1`，方向越相似；接近 `0` 代表關聯弱；負值代表方向相反。

簡化例子：如果問題向量是 `[1, 0]`，片段甲是 `[0.9, 0.1]`，片段乙是 `[0, 1]`，問題與甲的方向接近，與乙近乎垂直，因此甲會排在乙前面。實際系統使用 3072 維，計算概念相同。

Pipeline 與 Backend 都把向量除以自己的 L2 長度，使向量長度成為 1。正規化後，dot product 與 cosine 排序等價，也能避免單純因數值幅度較大就得到較高分。

## 四、問題送出後，程式實際做什麼

`askQuestion()` 的主要順序是：

1. 檢查 QA runtime、課程 ID、問題文字與使用者是否能存取課程。
2. 平行取得課程可用影片，並查找正規化文字完全相同的 FAQ；命中時不呼叫 embedding 或回答模型。
3. 檢查每月與每位使用者的 QA quota。
4. 建立只能搜尋目前課程的 `courseId` / `videoId` 範圍。
5. 平行載入課程片段並產生 query embedding。
6. 用 query vector 比較 FAQ 的 question embedding；預設相似度達門檻才使用快取。
7. 未命中快取時，執行 Leaf retrieval：
   - `atlas`：MongoDB `$vectorSearch`，在 index 內直接找最相近片段。
   - `memory`：Backend 讀出範圍內片段並自行計算 cosine。
   - 單筆向量缺失或維度不符時，memory 模式才會對該片段改用文字／中文字元 n-gram 分數，並在 runtime 標示 fallback。
8. 無文字命中時，可再嘗試 course-scoped visual citation；因視覺片段沒有 transcript，只提供保守的看片位置，不冒充完整文字答案。
9. 有文字命中時，把相關 transcript 與問題交給 answer provider，並同步查詢既有 clip。
10. 組成 `answer`、`matches`、`citations`、`answerStatus`、`runtime`，再寫入提問與使用紀錄。
11. 只有 runtime 沒有降級、不是拒答、也沒有 LINE 對話歷史的回答，才可存成 FAQ 快取。

## 五、為什麼需要兩層 FAQ 快取

第一層是文字完全相同快取。系統會移除空白與標點並轉小寫，例如「什麼是 JWT？」與「什麼是JWT」會視為同一題。這一層連 query embedding 都不用產生。

第二層是語意快取。問題已產生向量後，系統用 cosine similarity 與同課程 FAQ 比較；預設門檻由 `FAQ_CACHE_SIMILARITY_THRESHOLD` 控制，目前程式預設語意為 0.95。命中時可省下後續向量搜尋與回答模型成本。

FAQ 是效能最佳化，但內容正確性仍要受到保護。影片刪除或從課程解除掛載前，現行方案會先嚴格清除受影響課程的 FAQ；清除失敗就回 `FAQ_INVALIDATION_FAILED`，不執行不可逆的刪除或解除操作。

## 六、課程範圍與權限如何避免資料外洩

向量很相似不代表使用者有權看。系統先由課程與影片關係建立 scope，再進行搜尋：

- `standard`：課程只有 FocusFlow 建立的正式影片。
- `qa_scope_only`：課程只有 Pipeline metadata 影片。
- `mixed_scope`：兩者同時存在。

Memory 模式在載入後再次檢查 scope；Atlas 模式把 `courseId` / `videoId` filter 放入 `$vectorSearch`，取回後又再檢查一次。這是授權條件，不是單純的搜尋品質設定。

## 七、前端與 LINE 如何共用結果

### 網頁

`StudentCourses.jsx` 透過 `apiFetch('/qa/ask')` 帶 JWT 送出 `courseId` 與 `question`，顯示答案與命中片段。學生點 citation card 時，前端依 `videoId` 與 `startSec` 切換影片並跳到對應時間。

### LINE

LINE webhook 先驗證綁定、對話狀態與目前課程，再呼叫同一個 `askQuestion()`。LINE 會保留最近 6 則訊息，也就是 3 輪問答，供後續追問使用；回覆優先採用 citation 的時間戳與 jump URL。帶有對話歷史的答案不寫入共用 FAQ，避免把只在特定上下文成立的答案給其他學生。

## 八、重要程式入口

| 想理解的問題 | 主要檔案 |
|---|---|
| 整條 QA orchestration | `backend/src/services/qa.service.js` |
| Query embedding、stable Gemini 呼叫與 L2 正規化 | `backend/src/services/queryEmbedding.service.js` |
| 跨 Backend / Pipeline / DB 的 embedding 契約 | `backend/src/services/embeddingContract.service.js`、`STT_Whisper/src/embedding_contract.py` |
| FAQ exact / semantic cache 與 cosine | `backend/src/services/faqCache.service.js` |
| 回答 provider、prompt 與 fallback | `backend/src/services/answerGeneration.service.js` |
| 課程與影片搜尋範圍 | `backend/src/services/bridgeScope.service.js` |
| QA readiness 與完整向量契約檢查 | `backend/src/services/runtimeDiagnostics.service.js` |
| 逐字稿切成 Leaf chunks | `STT_Whisper/src/chunking.py` |
| 文件 embedding、批次重試與 checkpoint | `STT_Whisper/src/embedding.py` |
| Pipeline 全流程 | `STT_Whisper/src/main.py` |
| 網頁提問與 citation 跳轉 | `frontend/focus-flow/src/pages/StudentCourses.jsx` |
| LINE 提問與對話歷史 | `backend/src/services/line.service.js` |

`STT_Whisper/src/embedding.py` 仍保留一個未被正式流程呼叫的 `embed_query_gemini()` debug helper，內容沿用 preview `RETRIEVAL_QUERY`。正式查詢路徑是 Backend 的 `queryEmbedding.service.js`；不能拿該 helper 當成目前 production query contract 的依據。

## 九、目前可說與不能說的邊界

### 已有程式與測試支持

- stable `gemini-embedding-2` 文字搜尋契約與 3072 維檢查已存在。
- Query / document 使用不同文字 instruction，向量會做 unit-L2 正規化。
- FAQ、課程 scope、memory / Atlas retrieval、答案生成、citation 與 Question / UsageLog 紀錄已接線。
- 網頁與 LINE 共用同一套 QA service。
- Parent Search adapter、Child expansion 與 Leaf fallback 程式已存在，feature gate 預設關閉。

### 尚不能宣稱完成

- 不能只因程式與 mock 測試通過，就說正式 Atlas 中現有 Leaf / Parent vectors 已與 stable contract 相容。
- 部署環境必須透過 `QA_ACTIVE_LEAF_EMBEDDING_CONTRACT_JSON` 宣告並驗證 active Leaf 契約；缺少或不相容時，Atlas QA 會 hard-fail。
- Parent hierarchical retrieval 尚未完成正式 active Parent 資料與 live E2E，因此 `HIERARCHICAL_RETRIEVAL_ENABLED` 應維持 `false`。
- Memory + mock 測試證明控制流程可運作，不等於真實 Gemini、Atlas index 或正式資料已驗收。

## 十、老師常問的問題

### 為什麼不直接把整支逐字稿丟給語言模型？

整支逐字稿容易超過上下文限制、成本高，也難以指出答案來源。先檢索少量相關片段，可降低輸入量並保留影片時間戳。

### Embedding 是不是答案？

不是。Embedding 只負責把問題與片段轉成可比較的向量，找出候選資料；最後的自然語言答案由 answer provider 根據命中片段整理。

### Cosine 分數高就一定正確嗎？

不一定。它代表語意方向接近，不等於事實保證。因此系統限制課程 scope、提供 citation、保留 runtime 診斷，找不到可靠片段時應拒答或請使用者換問法。

### 為什麼維度相同仍不能混用？

兩張不同地圖都可能使用相同數量的座標，但座標含義不同。模型、instruction、generation 或正規化不同時，即使都是 3072 維，距離也沒有可靠意義。

### Parent chunk 是什麼？

Leaf chunk 是可精準引用的小片段；Parent chunk 把多個相鄰 Leaf 合成較長語境。目標是先用 Parent 找主題，再展開回 Leaf 做 citation。但正式資料與 live E2E 尚未完成，所以目前仍以 Leaf retrieval 為安全主線。

## 十一、口頭報告範本

「FocusFlow 先用 Whisper 把影片轉成帶時間戳的逐字稿，再切成小片段。每個片段使用 stable Gemini Embedding 2 轉成 3072 維、長度為 1 的向量。學生問題也會用同一個版本的查詢契約轉成向量，系統在該學生可存取的課程範圍內，用 cosine 或 Atlas Vector Search 找出最接近的片段。語言模型只能根據這些片段組答案，回應同時保留 citation 與影片時間戳。為避免把不同向量空間誤混，系統會檢查模型、維度、instruction、generation 和 normalization；正式資料未宣告相容時，Atlas 模式不會假裝可用。」
