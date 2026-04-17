# docs/decision-log.md — 關鍵架構決策

只記錄不從程式碼或 git history 可直接推導的決策。瑣碎的實作選擇不在此記錄。

---

## 2026-03 | AI Pipeline 作為離線 CLI，不內嵌於 Backend

**決策**：Whisper STT 與 embedding pipeline 作為獨立 Python CLI（`STT_Whisper/`），執行完畢後直接寫入 MongoDB，backend 只查詢結果。

**原因**：Whisper 模型體積大（數 GB）、執行耗時（分鐘級），不適合與 Express API server 共用 process。CLI 模式也方便在開發機本地批次處理。

**影響**：Backend 與 Pipeline 的協作介面是 MongoDB schema，需要跨組對齊 `video_segments_text` collection 的欄位口徑。

---

## 2026-03 | QA 系統採用可插拔 Provider 架構

**決策**：QA 的 embedding 與 answer generation 透過環境變數切換 provider（`mock` / `openai` / `gemini`），不寫死。

**原因**：開發期間不想依賴 API key；上線時可切換到真實 provider，不需改程式碼。

**影響**：所有開發環境預設 `mock + template`，CI 測試不依賴外部服務。Phase-1 正式 runtime 為 `mock + gemini`。

---

## 2026-04 | MongoDB Schema 採分 Collection 設計（v1 契約）

**決策**：問答資料拆成兩個獨立 collection：`video_segments_text`（文字 + text embedding）與 `video_segments_video`（影片片段 + video embedding）。舊版 `video_segments` 與 `clips` 視為 legacy 過渡層。

**原因**：文字與影片 embedding 維度、查詢模式與 Atlas index 設定不同，合併在一個 collection 會造成 index 複雜度與查詢效率問題。

**影響**：Backend `qa.service.js` 有 legacy 相容邏輯待清除。Atlas vector index 需跨組確認 name 與 filter fields。詳見 [docs/05_Database_Schema_Contract/MongoDB_契約定版_v1.md](05_Database_Schema_Contract/MongoDB_契約定版_v1.md)。

---

## 2026-04 | QA_VECTOR_SEARCH_MODE=atlas 改為 fail-fast，不靜默降級

**決策**：切換到 `atlas` mode 但缺少必要 index 或設定時，直接 hard-fail，不自動 fallback 到 memory mode。

**原因**：靜默降級曾導致 demo 環境誤以為 Atlas 已上線，實際跑的是 memory mode。Fail-fast 讓問題可被觀察，避免口徑錯誤。

**影響**：`/health` 回傳 `runtime.qa.readiness=hard_fail` 時需明確修復設定，不是重啟就好。
