# docs/decision-log.md — 關鍵架構決策

只記錄不從程式碼或 git history 可直接推導的決策。瑣碎的實作選擇不在此記錄。

---

## 2026-03 | AI Pipeline 作為離線 CLI，不內嵌於 Backend

**決策**：Whisper STT 與 embedding pipeline 作為獨立 Python CLI（`STT_Whisper/`），與 backend process 分離；主線先輸出標準化 JSON / JSONL，必要時再由 uploader 導入 MongoDB，backend 只查詢結果。

**原因**：Whisper 模型體積大（數 GB）、執行耗時（分鐘級），不適合與 Express API server 共用 process。CLI 模式也方便在開發機本地批次處理。

**影響**：Backend 與 Pipeline 的協作介面仍以 MongoDB schema 為主，但 pipeline 交付物不再只剩直接落庫；跨組仍需對齊 `video_segments_text` collection 的欄位口徑與 uploader 行為。

**2026-05-05 補充**：Phase-1 MVP 已改為 backend 在影片建立後背景 spawn 這個 CLI（本機影片傳 `--video-path`，YouTube MVP 傳 `--youtube-url`），但決策核心不變：Whisper / embedding 不進 Express process，狀態用 internal webhook 回報，資料仍經 MongoDB 交接。

---

## 2026-05 | YouTube 先採 URL MVP，不先做 Data API 自動上傳

**決策**：Phase-1 先支援老師手動上傳 YouTube 後貼 URL；backend 建立 `sourceType: youtube` 的 Video，pipeline 用 `yt-dlp` 抽音，前端用 YouTube iframe 播放，QA / LINE 產生 timestamp jump link。

**原因**：YouTube Data API OAuth、上傳權限、playlist 與檔案清理策略都需要額外營運設定。URL MVP 可先驗證核心教學問答流程。

**影響**：`backend/uploads/` 仍不能無差別清除，因為本機 upload 影片還靠 `sourceUrl` 給前端 `<video>` 播放。自動上傳 YouTube 與上傳檔清理要等 demo 流程穩定後再設計。

---

## 2026-03 | QA 系統採用可插拔 Provider 架構

**決策**：QA 的 embedding 與 answer generation 透過環境變數切換 provider（`mock` / `openai` / `gemini`），不寫死。

**原因**：開發期間不想依賴 API key；上線時可切換到真實 provider，不需改程式碼。

**影響**：CI 與 isolated local 測試仍可使用 `mock + template`，不依賴外部服務；共享 / demo 環境則可切到 `gemini + atlas + gemini`，實際 runtime 以 `.env` 與 `/health` 為準。

---

## 2026-04 | MongoDB Schema 採分 Collection 設計（v1 契約）

**決策**：問答資料拆成兩個獨立 collection：`video_segments_text`（文字 + text embedding）與 `video_segments_video`（影片片段 + video embedding）。舊版 `video_segments` 與 `clips` 視為 legacy 過渡層。

**原因**：文字與影片 embedding 維度、查詢模式與 Atlas index 設定不同，合併在一個 collection 會造成 index 複雜度與查詢效率問題。

**影響**：Backend `qa.service.js` 有 legacy 相容邏輯待清除。Atlas vector index 需跨組確認 name 與 filter fields。正式欄位口徑請以 `docs/current-status.md`、`backend/docs/current-state.md` 與實際程式碼為準；`docs/05_Database_Schema_Contract/MongoDB_契約定版_v1_已過期.md` 僅供歷史參考。

---

## 2026-04 | QA_VECTOR_SEARCH_MODE=atlas 改為 fail-fast，不靜默降級

**決策**：切換到 `atlas` mode 但缺少必要 index 或設定時，直接 hard-fail，不自動 fallback 到 memory mode。

**原因**：靜默降級曾導致 demo 環境誤以為 Atlas 已上線，實際跑的是 memory mode。Fail-fast 讓問題可被觀察，避免口徑錯誤。

**影響**：`/health` 回傳 `runtime.qa.readiness=hard_fail` 時需明確修復設定，不是重啟就好。

---

## 2026-08 | Hierarchical Retrieval 採 active generation + live evidence fail-closed

**決策**：Parent Search 只查 `generationVersion=text_search_generation_v2` 且 `isActive=true` 的文件，並在命中後重驗完整 embedding contract。Hierarchy Gate 開啟時，Backend 還必須以唯讀方式核對 rollout scope 內的 Parent／Child Leaf metadata、`chunkId_1` 與 Parent vector filter definition；部署環境的 `QA_ACTIVE_*_EMBEDDING_CONTRACT_JSON` 不能單獨構成 readiness 證據。

**原因**：相同的 3072 維可能來自不同模型、instruction 或 generation；只靠環境宣告會讓 stale／混合向量被誤當成相容資料。

**影響**：Parent Atlas index 必須能 filter `courseId`、`videoId`、`generationVersion`、`isActive`。任一 active data 或 index 條件缺失時，shadow／serve 都不具 eligibility；Leaf fallback 與全域 Gate=false 仍是 rollback 路徑。Shared Atlas publication／index update 與 live Gemini E2E 仍需分別授權。
