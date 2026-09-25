# 2026-09-24 FocusFlow 專案缺口稽核報告

> 性質：**唯讀驗證**。本輪沒有修改任何既有程式碼或文件，只新增這份報告。
> 基準：branch `dev` @ `5230d7a`（2026-09-24 雲端 session clone）。
> 環境：雲端容器、Node `v22.22.2`、**沒有 `backend/.env`**，也沒有 Atlas、Gemini、LINE、YouTube 憑證或 VM 存取權。
> 方法：先讀 `AGENTS.md`、`docs/current-status.md`「未完成／缺口」、`backend/docs/current-state.md`「已知限制」找線索，再用程式碼、測試與實際執行結果逐項驗證。行號以 `5230d7a` 為準。

---

## 0. 摘要

| 類別 | 結果 |
|------|------|
| `cd backend && npm test`（本輪實跑，無 `.env`） | **887 tests／105 suites：853 passed、34 failed** |
| 同上，只加 `QA_MATCH_LIMIT=15` | **887 passed／0 failed** |
| 失敗原因 | 34 筆全在 short-script 三個測試檔，因為 `env.js` 的 `QA_MATCH_LIMIT` 程式預設仍是 `3`，這些測試只有在開發者本機 `.env` 設成 15 時才會過（見 N-01） |
| Service 行覆蓋率（`--experimental-test-coverage`，`QA_MATCH_LIMIT=15`） | `src/**` 全體 line 89.99%、branch 75.41%、function 92.97%；最低的是 `admin.service.js` 25.82%、`videoBatchProcessing.service.js` 48.04%、`videoBatchReconciliation.service.js` 60.00%、`video.service.js` 70.61%；`youtube.service.js` 沒有被任何程式載入（死碼） |
| Routes 與 OpenAPI | runtime 列出 80 個 `/api/v1` 端點，OpenAPI 列 63 個（另有 `/health`）；**OpenAPI 缺 17 個端點**，其中 `GET /api/v1/line/webhook` 是文件沒記錄的遺漏 |
| AppError 錯誤碼與 `api-design.md` | 程式碼用了 98 個字面錯誤碼；**16 個不在錯誤碼表**；`YOUTUBE_UPLOAD_FAILED` 有一處回 500，表上寫 502；另有 23 個錯誤碼在測試中從未被斷言 |

### 優先處理清單

| 優先 | 編號 | 缺口 | 預估工作量 |
|------|------|------|-----------|
| 高 | N-01 | `npm test` 依賴本機 `.env`；乾淨環境 34 筆失敗；`QA_MATCH_LIMIT` 程式預設 3 與文件口徑 15 不符 | 0.5 天 |
| 高 | N-05 | 管理員 API 回傳 `lineUserId`，違反 `security.md` | 0.5 天 |
| 高 | N-07 | production 環境的非預期錯誤會把原始 `error.message`／`error.code` 回給前端 | 0.5 天 |
| 高 | N-09 | 沒有任何 CI 測試閘門；push `main` 直接 production deploy | 0.5～1 天 |
| 中 | N-06 | 管理員可把自己或最後一位 admin 停用或降級，沒有防呆；`updateUser` 沒有 route 測試 | 0.5 天 |
| 中 | D-14 | 刪除影片／課程不清本機 `uploads/` 檔案，只會持續累積 | 1～2 天 |
| 中 | D-08 | Leaf `courseId` 缺失的**根因仍在程式裡**：pipeline uploader 不寫 `courseId`，backend spawn 也不傳 | 1 天（跨組） |
| 中 | N-02 | OpenAPI 缺 17 個端點 | 1～1.5 天 |
| 中 | D-15 | FAQ 快取沒有設定／模型指紋 | 1 天 |
| 低 | N-03、N-04、N-08、D-02、D-23 等 | 錯誤碼表、測試缺口、常數時間比對、init 腳本、文件過期 | 見各節 |

---

## 1. 測試執行紀錄（本輪實跑）

### 1.1 `cd backend && npm test`（依指示，無 `.env`）

```text
# tests 887
# suites 105
# pass 853
# fail 34
# cancelled 0
# skipped 0
# duration_ms 230371
```

失敗分布（34 個 leaf test，全部 `code: 'SHORT_SCRIPT_EVIDENCE_EMPTY'` 或其連帶斷言）：

| 測試檔 | 失敗數 |
|--------|-------|
| `backend/tests/short-script-review.service.test.js` | 18 |
| `backend/tests/short-script.service.test.js` | 9 |
| `backend/tests/short-script.routes.test.js` | 7 |

單獨跑 `short-script-review.service.test.js` 同樣 18/18 失敗，所以不是測試順序造成的。

### 1.2 根因確認

- `backend/src/config/env.js:125`：`qaMatchLimit: Number(process.env.QA_MATCH_LIMIT) || 3`，程式預設仍是 **3**。
- `backend/.env.example:76`：`QA_MATCH_LIMIT=15`。
- `backend/src/config/env.js:11`：`dotenv.config({ path: path.join(projectRoot, '.env') })`，測試也會載入開發者的 `.env`。
- `backend/src/services/qa.service.js:416`、`:1819`：`retrieveSegmentsOnly` 的底層搜尋一律先截到 `env.qaMatchLimit` 筆，再依呼叫端的 `limit` 收斂。
- 測試設 `env.shortScriptMatchLimit = 6`、`shortScriptEvidenceMinItems = 6`，但沒有設 `env.qaMatchLimit`。預設 3 時只會命中 3 筆，鄰接擴展後證據仍不到 6 筆，於是丟出 `SHORT_SCRIPT_EVIDENCE_EMPTY`（`backend/src/services/shortScript.service.js:237-242`）。
- 驗證：`QA_MATCH_LIMIT=15 npm test` → **887/887 通過**；`QA_MATCH_LIMIT=15` 單跑該檔 → 18/18 通過。

### 1.3 與文件數字比對

| 來源 | 文件數字 | 本輪實測 |
|------|---------|---------|
| `AGENTS.md:117` | 262 passed／31 suites（2026-07-31） | 887 tests／105 suites |
| `docs/current-status.md:44`、`backend/docs/current-state.md:214` | 500/500（2026-08-30） | 同上 |

文件的測試數字已過期，但文件本身有註明日期與「未重跑」，所以不算誤稱。

---

## 2. 文件已列缺口：逐項驗證

欄位說明：**驗證結果**分為「確認存在」、「已修好」、「文件過期」、「部分過期」。**雲端可驗證**寫「否（需本機／VM 驗證）」的項目，本輪只核對程式碼，沒有嘗試連線處理。

### D-01 Atlas vector index（`text_embedding_index`／`video_embedding_index`）

1. **缺口與出處**：atlas 模式要依賴 Atlas 上的 vector index 為 READY。出處：`docs/current-status.md:193`、`backend/docs/current-state.md:55,152-153`、`CLAUDE.md`「不能誤稱的邊界」。
2. **驗證結果**：程式面**確認存在**。index 不可用時會 fail-fast：`backend/src/services/qa.service.js:563-568` 丟出 `503 QA_ATLAS_NOT_READY`；`/health` 也有 readiness 判斷，`.github/workflows/deploy.yml` 的 “Verify backend and proxy readiness” 步驟會檢查 `readyForAsk` 與 `leaf.status === "compatible"`。index 目前是否 READY，程式碼無法回答。
3. **雲端可驗證**：否（需本機／VM 驗證）。要用唯讀帳號執行 `listSearchIndexes`，或在 VM 內 `curl localhost:4000/health`。
4. **補缺口方案**：不需改程式。建議每次部署後把 `deploy.yml` readiness 步驟的輸出（目前只 echo 成功字串）存成 artifact，就能留下「何時確認為 READY」的證據。改 `.github/workflows/deploy.yml`；風險低；0.5 天；優先度**低**。

### D-02 init collections 與 Atlas 實況差異

1. **缺口與出處**：`docs/current-status.md:194`、`backend/docs/current-state.md:148,290`。文件寫 `init_collections.js`「現列 16 個並已含 `notifications`」。
2. **驗證結果**：**部分過期**。16 個與含 `notifications` 屬實（`database/tools/setup/init_collections.js:11-28`），但它和目前 21 個 Mongoose model 相比，**缺 11 個 collection**：`faqs`、`questions`、`avatars`、`conversations`、`messages`、`feedbacks`、`feedbackattachments`、`shortscripts`、`shortassets`、`videobatches`、`video_segments_parent`。對照來源為 `backend/src/models/*.model.js` 的 `collection:` 設定與 model 名稱。另外，backend 以 `mongoose.connect(env.mongodbUri)` 啟動（`backend/src/config/database.js:6`），沒有關 `autoIndex`，所以文件「不得未核准用 shared Atlas 啟服觸發 autoIndex」的警告仍然成立。
3. **雲端可驗證**：程式面可以（已完成）；Atlas 實際有哪些 collection，需本機／VM 驗證。
4. **補缺口方案**：`init_collections.js` 補齊 11 個 collection，或改成註明「只列 pipeline／legacy，app collections 由 Mongoose 建立」。同時更新 `backend/docs/current-state.md` 的敘述。風險低（腳本只在人工執行時生效）；0.5 天；優先度**低**。

### D-03 OpenAPI 維護

1. **缺口與出處**：`docs/current-status.md:195`（寫「internal processing webhook 等少數內部端點」）、`CLAUDE.md:77,314`、`backend/docs/current-state.md:201`。
2. **驗證結果**：**確認存在**，而且 `docs/current-status.md:195` 的表格描述**過期**。它只提到 internal webhook，但實際缺 17 個端點，其他段落列的 short-scripts／short-assets／feedback／admin feedback 也在缺漏之中，另外還有文件沒寫的 `GET /line/webhook`。完整清單見 N-02。
3. **雲端可驗證**：是（已完成）。
4. **補缺口方案**：見 N-02。

### D-04 Query embedding 與 pipeline contract 對齊

1. **缺口與出處**：`docs/current-status.md:196`、`backend/docs/current-state.md:295`。文件寫「Backend 已切 stable，Pipeline／Database preview vectors 尚未重建」。
2. **驗證結果**：**部分過期**。程式面兩邊都已切到 stable：backend 是 `backend/src/config/env.js:211`（預設 `gemini-embedding-2`），pipeline 是 `STT_Whisper/src/embedding_contract.py:6,23-25`（強制 `gemini-embedding-2`），`STT_Whisper/src/parent_mongodb_uploader.py:34` 也是。`deploy.yml` 並以 `QA_ACTIVE_LEAF_EMBEDDING_CONTRACT_JSON` 宣告 `gemini_embedding_2_text_v2`。剩下的是**資料面**：Atlas 既有 vectors 是否已經重建。
3. **雲端可驗證**：否（需本機／VM 驗證）。要唯讀抽查 `video_segments_text` 的 contract metadata 分布。
4. **補缺口方案**：由 DB 組唯讀查 `video_segments_text` 各 `contractVersion`／`generationVersion` 的筆數。若仍有 preview 資料，再用 pipeline 重新 embedding 並上傳。之後更新 `docs/current-status.md:196`，把「Pipeline code 未切」的暗示改成「資料待重建」。會寫 shared Atlas，需另行授權；重建 1～2 天；優先度**中**。

### D-05 `videos` physical storage 邊界（mixed collection）

1. **缺口與出處**：`docs/current-status.md:197`、`backend/docs/current-state.md:278`。
2. **驗證結果**：**確認存在**（屬跨組決策）。另外找到一個文件沒寫的不一致：backend model 對 `videoId` 建 unique+sparse（`backend/src/models/video.model.js:97-101`），但 DB 初始化腳本建的是 `video_id` unique+sparse（`database/tools/setup/init_indexes.js:27`）。兩套 bootstrap 產生的 index 不同。
3. **雲端可驗證**：程式面可以；Atlas 實際 index 需本機／VM 驗證。
4. **補缺口方案**：短期先讓 `init_indexes.js` 跟 model 一致（改 `videoId`），或加註 legacy 用途。是否拆 collection 仍待跨組決定。改 `database/tools/setup/init_indexes.js`；風險：若 Atlas 已有 `video_id_1`，需 DB owner 決定是否保留；0.5 天；優先度**低**。

### D-06 Live LINE smoke／運維紀錄

1. **缺口與出處**：`docs/current-status.md:198`、`CLAUDE.md`「部署與對外連線」。
2. **驗證結果**：程式面沒有問題。webhook verify 在 `backend/src/routes/line.routes.js:25`，簽章驗證在 `backend/src/middleware/lineSignature.middleware.js`，route tests 通過。實際通道是 ngrok，屬運維狀態。
3. **雲端可驗證**：否（需本機／VM 驗證）。
4. **補缺口方案**：在 `docs/40_Operations/` 建立 LINE smoke checklist（channel、webhook URL、一次提問的 log 時間戳），每次換 Channel 或網域後補一筆。純文件；0.5 天；優先度**低**。

### D-07 Phase 2-2 Parent／Leaf publication 與 Gate

1. **缺口與出處**：`docs/current-status.md:199`、`AGENTS.md`「不能誤稱」、`backend/docs/current-state.md:303`。
2. **驗證結果**：**確認存在**。`HIERARCHICAL_RETRIEVAL_ENABLED` 程式預設為 `false`（`backend/src/config/env.js:134-138`）；相關 service 的單元覆蓋率高（`hierarchicalRetrieval.service.js` 100% line），但沒有 live 證據。
3. **雲端可驗證**：否（需本機／VM 驗證，要唯讀 Atlas 帳號與 Gemini key）。
4. **補缺口方案**：依 `docs/current-status.md:235-238` 的既有步驟 1～4 執行，本報告不新增方案。優先度**中**，但不是試用期的阻擋項。

### D-08 Leaf `courseId` 全為空

1. **缺口與出處**：`docs/current-status.md:201`、`backend/docs/current-state.md:123,291`（2026-08-02 實查 1,651 筆全部 missing）。
2. **驗證結果**：**確認存在，而且根因仍在程式碼裡**，新上傳的影片會繼續產生沒有 `courseId` 的 Leaf：
   - `STT_Whisper/src/mongodb_uploader.py:349,366,381,499`：只寫 `videoId`，整個檔案都沒有 `courseId`。
   - `backend/src/services/video.service.js:350-366`：spawn pipeline 時只傳 `--video-id`，env 也沒有 course 資訊。
   - 只有 `database/tools/mongodb_uploader.py:17,134-136,180` 支援選填的 `FOCUSFLOW_COURSE_ID`，但它不在 backend 自動觸發的路徑上。
   - 目前 QA scope 靠 `QA_ATLAS_FILTER_MODE=bridge_course_or_video` 展開 `videoId $in`，所以功能正確，只是 `courseId` filter 形同虛設。
3. **雲端可驗證**：程式面可以（已完成）；Atlas 目前的缺失筆數需本機／VM 驗證。
4. **補缺口方案**：pipeline 新增 `--course-id` 參數（或 `FOCUSFLOW_COURSE_ID` env），`mongodb_uploader.py` 寫入 ObjectId `courseId`；backend 在 `video.service.js` 與 `videoBatchProcessing.service.js` 的 spawn 傳入 `video.courseId`。既有資料由 DB 組依 `videos._id → courseId` 唯讀比對後 backfill。風險：一支影片掛在多個課程時（`course.videoIds`），單一 `courseId` 只代表主課程，filter 仍要保留 bridge 模式。約 1 天（跨 backend＋pipeline），backfill 另需授權；優先度**中**。

### D-09 Demo 環境策略

1. **缺口與出處**：`docs/current-status.md:202,242`。
2. **驗證結果**：**確認存在**（這是決策，不是程式缺口）。程式已有 `DEMO_SEED_ENABLED` 與 `seed:reset` 保守清除機制。
3. **雲端可驗證**：不適用。
4. **補缺口方案**：由全組決定後寫進 `docs/decision-log.md`。優先度**低**。

### D-10 `clips` 與 `video_segments_video` 正式分工

1. **缺口與出處**：`docs/current-status.md:213`。
2. **驗證結果**：**確認存在**（決策）。backend 以獨立 model 讀取 snake_case 欄位（`backend/src/models/videoSegmentVideo.model.js`），只作 visual citation 使用。
3. **雲端可驗證**：不適用。
4. **補缺口方案**：跨組決定後更新 `ARCHITECTURE.md`。優先度**低**。

### D-11 searchable segments 覆蓋率

1. **缺口與出處**：`docs/current-status.md:214`（2026-05-23 資料：16 支影片、130 筆）。
2. **驗證結果**：無法用程式碼驗證；數字已是四個月前的 snapshot。
3. **雲端可驗證**：否（需本機／VM 驗證）。
4. **補缺口方案**：用 `mongodb-inspect` skill 唯讀 aggregate 每支 app-owned 影片（`String(videos._id)`）的 `video_segments_text` 筆數，列出 0 筆的影片。0.5 天；優先度**低**。

### D-12 `HIERARCHICAL_PARENT_TIMEOUT_MS` 預設 1000ms 偏緊

1. **缺口與出處**：`backend/docs/current-state.md:293`。
2. **驗證結果**：**確認存在**（`backend/src/config/env.js:166`）。
3. **雲端可驗證**：要 Atlas 實測延遲才能調整，需本機／VM 驗證。
4. **補缺口方案**：Gate 開啟前做 shadow 測量 p95 再調整預設值。優先度**低**（Gate 關閉時不影響）。

### D-13 `chunkId` classic index 與 `init_indexes.js` snake_case

1. **缺口與出處**：`backend/docs/current-state.md:294`；`docs/current-status.md:16` 寫「`init_indexes.js` 仍是 snake_case，bootstrap Commit／Push 待同步」。
2. **驗證結果**：**部分過期**。`database/tools/setup/init_indexes.js:47-67` 對 `video_segments_text` 已經是 camelCase（`videoId`、`chunkId`、`segmentId`、`courseId`、`courseId+videoId`），`chunkId` index 的 source 已補上，所以 `docs/current-status.md:16` 的敘述過期。backend model 只宣告了 `{ courseId: 1, videoId: 1 }`（`backend/src/models/videoSegment.model.js:73`），沒有 `chunkId`，所以不會靠 autoIndex 建立。`raw_transcripts`、`stt_cache`、`video_segments_audio`、`video_segments_video` 仍是 snake_case，這屬於 pipeline 既有契約。
3. **雲端可驗證**：source 可以（已完成）；Atlas 上是否已經有 `chunkId_1`，需本機／VM 驗證。
4. **補缺口方案**：更新 `docs/current-status.md:16`。Atlas 若沒有 `chunkId_1`，由 DB owner 依 `init_indexes.js:55` 建立，並用 `explain` 驗證。文件 0.1 天；建 index 需授權；優先度**低**。

### D-14 `backend/uploads/` 自動清理策略

1. **缺口與出處**：`docs/current-status.md:240`（下一步 #6）。
2. **驗證結果**：**確認存在**。
   - `deleteVideo`（`backend/src/services/video.service.js:499-525`）只刪 DB 並呼叫 `privatizeVideoOnDelete`，不刪本機影片檔。
   - `deleteCourse`（`backend/src/services/course.service.js:154-173`）只做 `Video.deleteMany`，同樣不刪檔。
   - 唯一的清檔路徑是 YouTube 上傳完成後的 cleanup（`backend/src/services/youtubeUpload.service.js:377`），但它受 `YOUTUBE_UPLOAD_CLEANUP_ENABLED` 控制，預設 `false`（`backend/src/config/env.js:276`）。
   - 其他 `unlinkSync` 只清上傳失敗或重複的暫存檔（`video.service.js:410,418`、`videoBatch.service.js:37`、`shortAssetPublish.service.js:436`）。
   - pipeline log `STT_Whisper/data/pipeline_<videoId>.log`（`video.service.js:347`）也不會清。
3. **雲端可驗證**：程式面可以（已完成）；VM 磁碟實際用量需 VM 驗證。
4. **補缺口方案**：在 `video.service.deleteVideo` 刪 DB 之後，若 `filePath` 位在 `UPLOAD_DIR` 內、而且沒有其他 Video 共用同一檔案，就 best-effort 刪檔。可沿用 `youtubeUpload.service.js` 既有的「位於 `UPLOAD_DIR` 且無共用」判斷。`course.service.deleteCourse` 逐支套用。風險：刪錯共用檔、YouTube 尚未上傳完成時刪檔，需加 feature flag 並補 route 測試。1～2 天；優先度**中**（試用期影片量增加後會吃滿 VM 磁碟）。

### D-15 FAQ 快取不因設定／模型／prompt 變更失效

1. **缺口與出處**：`CLAUDE.md:199`「尚存缺口」。
2. **驗證結果**：**確認存在**。`backend/src/models/faq.model.js` 只有 `courseId`、`question`、`normalizedQuestion`、`answer`、`matches`、`clip`、`questionEmbedding`、`hitCount`、`lastHitAt`、`lastAnsweredAt`，沒有任何 prompt／模型／`QA_MATCH_LIMIT` 指紋欄位。另一個文件沒寫的風險：語意命中比對 `questionEmbedding`（`backend/src/services/faqCache.service.js:70`），`vectorSimilarity.js:4` 只擋維度不同。若日後換成同樣 3072 維的另一個 embedding 模型，會拿兩個不同向量空間做比較，不會報錯。
3. **雲端可驗證**：是（已完成）。
4. **補缺口方案**：在 `faq.model.js` 新增 `answerConfigFingerprint`（由 `GEMINI_CHAT_MODEL`、`QA_MATCH_LIMIT`、prompt 版本常數、embedding contract 算出的 SHA-256），`faqCache.service.js` 查詢時加上 fingerprint 條件，不符就視為 miss，舊資料由容量淘汰自然清掉。`answerGeneration.service.js` 需新增 `PROMPT_VERSION` 常數。風險：部署後 FAQ 命中率會短暫歸零（token 成本上升一次）。1 天，含 service 測試；優先度**中**。

### D-16 `QA_MATCH_LIMIT` 3→15

1. **缺口與出處**：`CLAUDE.md:160` 寫「2026-07-25 從 `3` 調成 `15`」；`docs/current-status.md:32`。
2. **驗證結果**：**部分過期（文件沒寫的缺口）**。只有 `backend/.env.example:76` 改成 15，程式預設仍是 3（`backend/src/config/env.js:125`）。`.github/workflows/deploy.yml` 的 “Restart services” 步驟也沒有設 `QA_MATCH_LIMIT`，而 `/health` 的 runtime 沒有輸出這個值（`backend/src/services/runtimeDiagnostics.service.js` 沒有 `qaMatchLimit`）。所以 VM 實際值完全取決於 VM 上的 `backend/.env`，外部無法觀察。這也是 N-01 測試失敗的根因。
3. **雲端可驗證**：程式面可以（已完成）；VM `.env` 是否有 `QA_MATCH_LIMIT=15`，需 VM 驗證（`sudo -u focusflow grep QA_MATCH_LIMIT /opt/focusflow/backend/.env`）。
4. **補缺口方案**：見 N-01。

### D-17 登入失敗鎖定存在記憶體

1. **缺口與出處**：`backend/docs/current-state.md:171`、`.claude/rules/security.md`。
2. **驗證結果**：**確認存在，而且是設計取捨**（`backend/src/services/loginThrottle.service.js:6-10`，`const attempts = new Map()`，註解說明 pm2 fork 單一 process）。重啟會歸零；若日後改 pm2 cluster mode，鎖定會失效。
3. **雲端可驗證**：程式面可以；VM 的 pm2 模式需 VM 驗證（`pm2 describe focusflow-backend`）。
4. **補缺口方案**：試用期不需要改。若要 cluster 化，改存 MongoDB（TTL index）。優先度**低**。

### D-18 `syncQuestionsToAtlas.js` 未掛 npm script

1. **缺口與出處**：`backend/docs/current-state.md:198`。
2. **驗證結果**：**確認存在**（`backend/package.json:11-18` 沒有這支）。
3. **雲端可驗證**：是（已完成）。
4. **補缺口方案**：若仍需要，在 `package.json` 加 `db:sync-questions`；否則在文件標為 legacy。0.1 天；優先度**低**。

### D-19 LIFF 未實作

1. **缺口與出處**：`backend/docs/current-state.md:208`、`docs/current-status.md`「不能誤稱」。
2. **驗證結果**：**確認存在**。runtime route 清單（見 N-02）沒有任何 `liff` 端點。
3. **雲端可驗證**：是（已完成）。
4. **補缺口方案**：屬 Phase 2 規劃，依開發原則「只做 Phase 1 MVP」暫不處理。優先度**低**。

### D-20 刪除時轉 private 沒有還原入口

1. **缺口與出處**：`backend/docs/current-state.md:285`。
2. **驗證結果**：**確認存在，而且是設計取捨**。`deleteVideo` 在 `Video.deleteOne` 之後才呼叫 `privatizeVideoOnDelete`（`backend/src/services/video.service.js:520-525`），DB 紀錄已經刪除。
3. **雲端可驗證**：程式面可以；YouTube 結果需 live 驗證。
4. **補缺口方案**：不需改。若要能追查，可在 `usage_logs` 記下被轉 private 的 `youtubeVideoId`。優先度**低**。

### D-21 部署、憑證、網路類缺口

`LINE webhook 走 ngrok`、`port 80 不通`、`Let's Encrypt 首次自動續約（預計 2026-11-10 前後）`、`VM .env 不同步`、`HSTS／整站 CSP 未加`。

1. **出處**：`CLAUDE.md`「部署與對外連線」、`docs/current-status.md:239-240`。
2. **驗證結果**：repo 內只能看到 `deploy.yml`，內容與文件描述一致。其餘都是 VM／網路狀態。
3. **雲端可驗證**：否（需 VM 驗證）。
4. **補缺口方案**：依文件既有 runbook。建議在 2026-11-15 前排一次續約檢查。優先度**中**（憑證過期會讓整站無法使用）。

### D-22 Frontend 單一 bundle 大於 500 kB

1. **缺口與出處**：`AGENTS.md:121`。
2. **驗證結果**：**本輪未執行**（這項雲端可以驗證，但不在本次指定範圍，沒有跑 `npm run build`）。
3. **雲端可驗證**：是（未執行）。
4. **補缺口方案**：在 `vite.config.js` 對 admin／teacher 頁面做 `React.lazy` 動態載入或設定 `manualChunks`。0.5～1 天；優先度**低**。

### D-23 規範文件本身的過期內容（文件沒記錄，本輪發現）

| 文件 | 過期內容 | 實際程式碼 |
|------|---------|-----------|
| `CLAUDE.md:269`、`.claude/rules/testing.md:77` | 前端「目前沒有正式自動化測試框架」 | `frontend/focus-flow/package.json:10` 有 `"test": "node --test"`，`frontend/focus-flow/tests/` 有 10 個測試檔；`AGENTS.md:118` 也寫前端 9 passed |
| `CLAUDE.md:279`、`.claude/rules/testing.md:77` | AI Pipeline「目前沒有正式自動化測試套件」 | `STT_Whisper/tests/` 有 15 個 `test_*.py`＋`fixtures/`；`AGENTS.md:119` 寫 99 passed |
| `.claude/rules/security.md:37,40` | 角色授權用 `requireRole(...)` | 實際是 `authorizeRoles(...)`（`backend/src/middleware/role.middleware.js:3`） |
| `.claude/rules/security.md:92` | LINE 簽章不符「回傳 400」 | 實際回 `401 LINE_SIGNATURE_INVALID`（`backend/src/middleware/lineSignature.middleware.js:39-41`）；`api-design.md` 錯誤碼表寫 401，兩份規則互相矛盾 |
| `.claude/rules/security.md:102` | internal webhook 為 `POST /api/v1/internal/videos/:videoId/processing` | 實際是 `/processing/start`、`/processing/complete`、`/processing/fail` 三支（`backend/src/routes/internal-video.routes.js:9-11`） |
| `docs/current-status.md:16` | `init_indexes.js` 仍是 snake_case | 見 D-13，`video_segments_text` 已是 camelCase |
| `docs/current-status.md:195` | OpenAPI 只缺 internal webhook 等少數端點 | 見 N-02，缺 17 個 |
| `AGENTS.md:117` | Backend 262 passed | 見 §1.3 |

補缺口方案：一次性文件 PR，逐項修正上表內容。`CLAUDE.md` 與 `AGENTS.md` 要依 `CLAUDE.md` 開頭的規定保持一致。0.5 天；優先度**中**，因為 agent 會照這些規則文件工作，錯的規則會直接造成錯的實作。

---

## 3. 自行比對發現的缺口（文件沒記錄）

### N-01 測試依賴本機 `.env`；`QA_MATCH_LIMIT` 程式預設與文件口徑不一致

1. **描述**：`npm test` 在沒有 `.env` 的乾淨環境（新 clone、CI、雲端）會有 34 筆失敗，只在開發者 `.env` 有 `QA_MATCH_LIMIT=15` 時才全綠。這也代表開發者 `.env` 的任何設定都可能讓測試結果不同，測試沒有和本機設定隔離。出處：無文件記錄。
2. **驗證結果**：**確認存在**。證據見 §1.2（`backend/src/config/env.js:11,125`、`backend/.env.example:76`、`backend/src/services/qa.service.js:416,1819`、`backend/tests/short-script-review.service.test.js:15-31` 的 `resetEnv()` 沒有設 `qaMatchLimit`）。
3. **雲端可驗證**：是（已完成：無 `.env` 為 853/887，加 `QA_MATCH_LIMIT=15` 為 887/887）。
4. **補缺口方案**：
   - (a) 把 `backend/src/config/env.js:125` 的預設改成 `15`，與 `.env.example`、`CLAUDE.md` 口徑一致。這同時消除「VM `.env` 漏設就退回 3」的風險。
   - (b) 在三個 short-script 測試檔的 `resetEnv()` 明確設 `env.qaMatchLimit`，不依賴預設值。
   - (c) 長期：`NODE_ENV=test` 時不載入 `.env`（`env.js:11` 加條件），或在 `package.json` 的 `test` script 設 `DOTENV_CONFIG_PATH=/dev/null` 類隔離，讓測試結果與開發者本機設定無關。
   - 風險：(a) 會改變「VM `.env` 沒設」時的行為，但這正是文件宣稱的目標值；(c) 可能讓其他依賴 `.env` 的測試浮現失敗，需逐一補 env。
   - 工作量：(a)＋(b) 0.5 天；(c) 另 0.5～1 天。優先度**高**。

### N-02 `backend/src/routes/` 與 `backend/docs/openapi.yaml` 差異

方法：在不連 DB 的情況下載入 `src/app.js`，走訪 Express router stack 列出所有端點；再用 `js-yaml` 解析 `openapi.yaml` 的 `paths`，正規化 `{param}` 為 `:param` 後比對。

1. **描述**：OpenAPI 缺 17 個已上線的端點。
2. **驗證結果**：**確認存在**。runtime `/api/v1` 端點 80 個；OpenAPI 63 個（另有 `GET /health`）。**OpenAPI 沒有、routes 有的端點**：

| 群組 | 端點 | 定義位置 | 文件是否已知 |
|------|------|---------|-------------|
| LINE | `GET /api/v1/line/webhook`（LINE Console verify 用） | `backend/src/routes/line.routes.js:25` | **否**（文件說 LINE webhook 已涵蓋，但只涵蓋 POST） |
| internal | `POST /api/v1/internal/videos/:videoId/processing/start` | `internal-video.routes.js:9` | 是 |
| internal | `POST /api/v1/internal/videos/:videoId/processing/complete` | `internal-video.routes.js:10` | 是 |
| internal | `POST /api/v1/internal/videos/:videoId/processing/fail` | `internal-video.routes.js:11` | 是 |
| feedback | `POST /api/v1/feedback` | `feedback.routes.js:10` | 是 |
| feedback | `GET /api/v1/feedback/:feedbackId/attachments/:attachmentId` | `feedback.routes.js:11` | 是 |
| admin feedback | `GET /api/v1/admin/feedback` | `admin.routes.js:21` | 是 |
| admin feedback | `PATCH /api/v1/admin/feedback/:feedbackId` | `admin.routes.js:22` | 是 |
| short-scripts | `GET /api/v1/courses/:courseId/short-scripts/candidates` | `short-script.routes.js:27` | 是 |
| short-scripts | `GET /api/v1/courses/:courseId/short-scripts` | `short-script.routes.js:28` | 是 |
| short-scripts | `POST /api/v1/courses/:courseId/short-scripts/auto` | `short-script.routes.js:29` | 是 |
| short-scripts | `GET /api/v1/short-scripts/:scriptId` | `short-script.routes.js:31` | 是 |
| short-scripts | `POST /api/v1/short-scripts/:scriptId/generate` | `short-script.routes.js:32` | 是 |
| short-scripts | `POST /api/v1/short-scripts/:scriptId/review` | `short-script.routes.js:33` | 是 |
| short-scripts | `POST /api/v1/short-scripts/:scriptId/asset` | `short-script.routes.js:37` | 是 |
| short-assets | `POST /api/v1/short-assets/:assetId/upload/retry` | `short-script.routes.js:38` | 是 |
| short-assets | `GET /api/v1/courses/:courseId/short-assets` | `short-script.routes.js:39` | 是 |

**OpenAPI 有、routes 沒有**：無（`GET /health` 掛在 `/health`，不在 `/api/v1` 下，兩邊一致）。

本輪只比對了「路徑＋方法」是否存在，**沒有**逐一比對 request／response schema 與狀態碼。

3. **雲端可驗證**：是（已完成）。
4. **補缺口方案**：
   - 在 `backend/docs/openapi.yaml` 補上述 17 個端點。short-scripts／short-assets 要標註 `SHORT_SCRIPT_AUTOMATION_ENABLED=false` 時回 404（`short-script.routes.js:12-19`）；internal 端點用獨立的 `X-Processing-Secret` securityScheme 並標 internal。
   - 在 `backend/tests/docs.routes.test.js` 加一個「runtime routes ⊆ OpenAPI paths」的自動比對測試（可直接沿用本報告的 router stack 走訪法），避免日後再漂移。
   - 風險低（只改文件與測試）。1～1.5 天；優先度**中**。

### N-03 `.claude/rules/api-design.md` 錯誤碼表與程式碼差異

方法：以括號配對解析 `backend/src/**/*.js` 每個 `new AppError(...)` 的第 2、3 個參數（98 個字面錯誤碼，沒有非字面值的呼叫），再與錯誤碼表的第一欄比對。`error.middleware.js` 以物件字面值產生的 `VALIDATION_ERROR`、`INVALID_ID`、`DUPLICATE_RESOURCE`、`UPLOAD_ERROR` 在表上都有。

1. **描述**：錯誤碼表不完整，有一個狀態碼不一致。
2. **驗證結果**：**確認存在**。

**(a) 程式有、表上沒有的 16 個錯誤碼**：

| 錯誤碼 | HTTP | 第一個出處 |
|--------|------|-----------|
| `ANSWER_PROVIDER_EMPTY_RESPONSE` | 502 | `src/services/answerGeneration.service.js:82`（表上只在 `ANSWER_PROVIDER_ERROR` 備註帶過，沒有獨立列） |
| `ANSWER_PROVIDER_INVALID_RESPONSE` | 502 | `src/services/answerGeneration.service.js:73`（同上） |
| `AVATAR_TOO_LARGE` | 413 | `src/middleware/avatarUpload.middleware.js:47` |
| `INVALID_AVATAR_TYPE` | 400 | `src/middleware/avatarUpload.middleware.js:29` |
| `INVALID_AVATAR_FILE` | 400 | `src/services/avatar.service.js:17` |
| `EMBEDDING_CONTRACT_INVALID` | 500 | `src/services/queryEmbedding.service.js:103` |
| `EMBEDDING_PROVIDER_NOT_CONFIGURED` | 500 | `src/services/queryEmbedding.service.js:53` |
| `HIERARCHICAL_RETRIEVAL_UNAVAILABLE` | 503 | `src/services/hierarchicalRetrieval.service.js:126` |
| `LINE_ACCOUNT_ALREADY_LINKED` | 409 | `src/services/auth.service.js:52` |
| `NOTIFICATION_FANOUT_FAILED` | 500 | `src/services/notification.service.js:366` |
| `QA_ATLAS_NOT_READY` | 503 | `src/services/qa.service.js:564` |
| `QA_RUNTIME_MISCONFIGURED` | 500 | `src/services/answerGeneration.service.js:424` |
| `SHORT_ASSET_ACCESS_DENIED` | 403 | `src/services/shortAsset.service.js:226` |
| `SHORT_ASSET_REVIEW_CONFLICT` | 409 | `src/services/shortAsset.service.js:526` |
| `SHORT_ASSET_REVIEW_STALE` | 409 | `src/services/shortAsset.service.js:515` |
| `VIDEO_METADATA_ONLY` | 409 | `src/services/video.service.js:487` |

**(b) 表上有、沒有被 `new AppError` 丟出的錯誤碼**：`INTERNAL_SERVER_ERROR`（`error.middleware.js:50`、`appError.js:2` 的預設值，合理）、`VIDEO_BATCH_ITEM_FAILED`（`videoBatch.service.js:50,55`，寫進批次 item 的 `errorCode` 欄位，不是 HTTP 錯誤回應，合理，但可在表上註明「只出現在 batch item 狀態」）。

**(c) 狀態碼不一致**：`YOUTUBE_UPLOAD_FAILED` 表上寫 502，但 `src/services/youtubeUpload.service.js:167` 在「`fetch` 不存在」時丟 **500**，其他位置都是 502。

3. **雲端可驗證**：是（已完成）。
4. **補缺口方案**：
   - 在 `.claude/rules/api-design.md` 錯誤碼表補 16 列，並對 `VIDEO_BATCH_ITEM_FAILED` 加註。
   - `youtubeUpload.service.js:167` 改用 `500 YOUTUBE_UPLOAD_NOT_CONFIGURED` 或 `INTERNAL_SERVER_ERROR`，因為這是執行環境缺陷，不是上游 API 失敗。或者在表上註明例外。
   - 可加一個測試：掃描 `src` 的 AppError 錯誤碼，斷言它們都在 `api-design.md` 表內，防止再漂移。
   - 風險低。0.5 天；優先度**低**。

### N-04 `backend/src/services/` 與 `backend/tests/` 覆蓋落差

方法：(1) 用 `QA_MATCH_LIMIT=15 node --test --experimental-test-isolation=none --test-concurrency=1 --experimental-test-coverage --test-coverage-include='src/**'` 取得每個 service 的實際行／分支／函式覆蓋率（887/887 通過）；(2) 用 grep 找出沒有被任何測試檔直接 `require` 的 service；(3) 找出從未在 `tests/` 出現的錯誤碼。

1. **描述**：整體 line coverage 高（89.99%），但集中在 QA／hierarchy；管理、批次處理、影片 spawn 路徑明顯偏低。
2. **驗證結果**：**確認存在**。

**(a) 覆蓋率最低的 service（line %）**

| Service | Line | Branch | Func | 主要未覆蓋內容 |
|---------|------|--------|------|---------------|
| `admin.service.js` | **25.82** | 85.71 | 37.50 | `getStats`（13-39）、`updateUser`（71-102）、`listVideos`（104-137）、`getRecentEvents`（139-190）、`getEventStats`（192-204）。`tests/admin.routes.test.js` 只有 3 個 `it`，沒有測 `PATCH /admin/users/:userId`（改角色、停用帳號） |
| `videoBatchProcessing.service.js` | 48.04 | 72.22 | 50.00 | `spawnBatchProcess`（82-133）、`scheduleVideoBatchProcessing`、`scheduleVideoBatchResume` |
| `videoBatchReconciliation.service.js` | 60.00 | 63.33 | 63.64 | `reconcileActiveVideoBatches`（94-125）、scheduler（127-145） |
| `video.service.js` | 70.61 | 73.33 | 78.13 | `spawnLocalVideoPipeline`、`scheduleExistingVideoProcessing`、`retryExistingVideoProcessing`、`recoverQueuedVideoProcessing`（45-177）、YouTube URL spawn（345-377） |
| `usageLog.service.js` | 78.26 | 66.67 | 100 | 14-18 |
| `mailer.service.js` | 80.00 | 75.00 | 100 | 實際寄信路徑 16-24（需 SMTP，合理） |
| `mediaIntegrity.service.js` | 82.02 | 52.63 | 100 | 容器損壞的多個分支 |
| `feedback.service.js` | 86.38 | 64.81 | 87.50 | 附件讀取失敗分支 |
| `line.service.js` | 87.23 | 72.19 | 100 | 多段 postback／切換課程錯誤分支 |
| `costControl.service.js` | 89.29 | 83.33 | 100 | **全站月 token 預算超額（81-95）從未測到** |

**(b) 沒有被測試檔直接 `require` 的 service**：`admin`、`auth`、`avatar`、`conversation`、`costControl`、`courseAccess`、`enrollment`、`feedback`、`passwordReset`、`questionRecording`、`usageLog`、`videoBatch`、`youtube`。除 `admin`（見上）與 `youtube` 外，其餘都透過 route 整合測試間接覆蓋在 86% 以上，可以接受。

**(c) 死碼**：`backend/src/services/youtube.service.js`（75 行，匯出 `getShorts`）**沒有被任何檔案 require**。`GET /api/v1/youtube/shorts` 實際走 `shortAsset.service.listStudentShorts`（`backend/src/controllers/youtube.controller.js:3-10`），所以這個檔案也不出現在 coverage 報告中。

**(d) 從未在 `tests/` 出現的錯誤碼（23 個）**：`CONVERSATION_NOT_FOUND`、`COURSE_DELETE_FAILED`、`EMBEDDING_PROVIDER_NOT_CONFIGURED`、`ENROLLMENT_NOT_FOUND`、`FEEDBACK_ATTACHMENT_LIMIT_EXCEEDED`、`FEEDBACK_ATTACHMENT_NOT_FOUND`、`FEEDBACK_ATTACHMENT_TOO_LARGE`、`INVALID_ENCODING`、`LINE_NOT_CONFIGURED`、`LINE_RAW_BODY_MISSING`、`MESSAGE_NOT_FOUND`、`MESSAGE_RETRY_NOT_ALLOWED`、`SHORT_SCRIPT_GENERATION_FAILED`、`STUDENT_NOT_FOUND`、`USER_NOT_FOUND`、`VIDEO_BATCH_FILES_REQUIRED`、`VIDEO_BATCH_ITEM_NOT_FOUND`、`VIDEO_BATCH_LIMIT_EXCEEDED`、`VIDEO_BATCH_NOT_FOUND`、`VIDEO_BATCH_RETRY_IN_PROGRESS`、`VIDEO_PROCESSING_RETRY_SOURCE_UNAVAILABLE`、`YOUTUBE_UPLOAD_FAILED`、`YOUTUBE_UPLOAD_RETRY_LIMIT_REACHED`。這些失敗路徑依 `.claude/rules/testing.md`「每個新 API 路由至少需要主要失敗情境」屬於缺測。

3. **雲端可驗證**：是（已完成）。
4. **補缺口方案**（依優先度）：
   - **中**：`backend/tests/admin.routes.test.js` 補 `PATCH /admin/users/:userId`（改角色、停用、非法角色、學生無權）與 `GET /admin/videos`、`/admin/events`、`/admin/event-stats` 的成功與 403 情境。0.5 天。
   - **中**：`costControl` 補全站預算超額 429 測試；video-batch 補 `VIDEO_BATCH_LIMIT_EXCEEDED`、`VIDEO_BATCH_NOT_FOUND`、`VIDEO_BATCH_RETRY_IN_PROGRESS` route 測試。0.5～1 天。
   - **低**：`videoBatchProcessing`／`video.service` 的 spawn 路徑以注入假的 `spawn` 做 service 測試（目前直接 `require('child_process')`，需要小幅重構成可注入，風險中）。1～2 天。
   - **低**：刪除 `youtube.service.js`。依 `CLAUDE.md`「不刪除檔案除非使用者明確要求」，需先取得同意。0.1 天。

### N-05 管理員 API 回傳 `lineUserId`（違反 security.md）

1. **描述**：`.claude/rules/security.md`「回應中不得出現的欄位」明列 `lineUserId`，但管理員使用者列表與更新都回傳原始值。
2. **驗證結果**：**確認存在**。`backend/src/services/admin.service.js:64`（`listUsers`，對應 `GET /api/v1/admin/users`）與 `:99`（`updateUser`，對應 `PATCH /api/v1/admin/users/:userId`）都是 `lineUserId: u.lineUserId || null`。前端 `frontend/focus-flow/src` 全域 grep 不到 `lineUserId`，代表這個欄位**沒有使用者**，純屬多餘暴露。
3. **雲端可驗證**：是（已完成）。
4. **補缺口方案**：兩處改成 `lineBound: Boolean(u.lineUserId)`；同步檢查 `backend/docs/openapi.yaml` 的 admin user schema；在 `admin.routes.test.js` 加上「回應不含 `lineUserId`」的斷言。風險低（前端沒用到）。0.5 天；優先度**高**（違反明文安全規範，修法小）。

### N-06 管理員可停用或降級自己／最後一位 admin

1. **描述**：`updateUser` 沒有防止 admin 停用或降級自己，也沒有保證至少保留一位 active admin。另外 `isActive: Boolean(isActive)`（`admin.service.js:84`）遇到字串 `"false"` 會變成 `true`。
2. **驗證結果**：**確認存在**（`backend/src/services/admin.service.js:71-102`，controller `backend/src/controllers/admin.controller.js:17-21` 也沒有傳入呼叫者身分）。這條路徑沒有 route 測試（見 N-04）。
3. **雲端可驗證**：是（已完成程式檢視；未實際呼叫）。
4. **補缺口方案**：controller 傳入 `req.user`；service 拒絕 `userId === req.user.id` 的 `role`／`isActive=false` 變更，並在把 admin 降級或停用前確認 `User.countDocuments({ role: 'admin', isActive: true }) > 1`，否則回 `409`（新增錯誤碼例如 `LAST_ADMIN_PROTECTED`，並補進錯誤碼表）。`isActive` 改成嚴格驗證布林值。風險低。0.5 天；優先度**中**。

### N-07 production 回應會帶出非預期錯誤的原始 message／code

1. **描述**：`backend/src/middleware/error.middleware.js:49-61` 對非 AppError 的例外使用 `error.message` 與 `error.code || 'INTERNAL_SERVER_ERROR'`，而且 production 環境一樣照回。Node 的 `fs` 錯誤（例如 `ENOENT: no such file or directory, open '/opt/focusflow/backend/uploads/...'`）會把伺服器路徑與 `ENOENT` 回給前端；TypeError 會回出程式內部屬性名；非 11000 的 Mongo 錯誤會把數字 `code` 當成 `error.code` 回傳。`security.md` 規定不得洩漏內部診斷，但目前只擋了 `details`，沒有擋 `message`。
2. **驗證結果**：**確認存在**（程式檢視）。`backend/tests/error-middleware.test.js` 只有 1 個 `it`，驗證 `details`／`publicDetails`，沒有涵蓋這個情境。
3. **雲端可驗證**：是（程式檢視完成；未對 VM 實打）。
4. **補缺口方案**：在 `errorHandler` 判斷 `error instanceof AppError`（或 `error.isOperational`），非 AppError 且 `NODE_ENV=production` 時，一律回 `500 INTERNAL_SERVER_ERROR` 加固定訊息，原始錯誤只寫 server log。補兩個 `error-middleware` 測試。風險：前端若有依賴原始訊息顯示，會看到較籠統的文字，影響小。0.5 天；優先度**高**（系統已對校外開放試用）。

### N-08 秘密比對不是常數時間

1. **描述**：LINE 簽章（`backend/src/middleware/lineSignature.middleware.js:39`，`expectedSignature !== signature`）與 internal webhook secret（`backend/src/middleware/internalProcessingAuth.middleware.js:8`，`secret !== env.processingWebhookSecret`）都用一般字串比對。
2. **驗證結果**：**確認存在**。實際風險低：internal 端點理論上只在 localhost 使用，但 nginx 會把 `/api/` 反向代理到 4000，所以 `/api/v1/internal/*` 在網路上是**可達的**，只靠 secret 保護。
3. **雲端可驗證**：程式面可以（已完成）；nginx 是否另外擋 `/api/v1/internal/` 需 VM 驗證（`/etc/nginx/conf.d/focusflow.conf`）。
4. **補缺口方案**：兩處改成 `crypto.timingSafeEqual`，長度不同時先回 false。可再考慮在 nginx 對 `/api/v1/internal/` 回 404，只允許 localhost。程式改動風險低，0.25 天；nginx 需 VM 操作。優先度**低～中**。

### N-09 沒有 CI 測試閘門，push `main` 直接部署

1. **描述**：`.github/workflows/` 只有 `deploy.yml`，在 self-hosted runner 上 `git pull` 後直接 `npm install --production`、build、`pm2 restart`，**沒有任何 `npm test`、`npm run lint` 步驟**，也沒有針對 PR 的 workflow。加上 N-01，目前的測試套件在乾淨環境本來就不會全綠。
2. **驗證結果**：**確認存在**（`.github/workflows/deploy.yml`，觸發條件 `on.push.branches: [main]`）。
3. **雲端可驗證**：是（已完成）。
4. **補缺口方案**：新增 `.github/workflows/ci.yml`，在 `pull_request` 與 `push`（`dev`、`main`）時跑 `backend npm ci && npm test`、`frontend npm ci && npm test && npm run lint && npm run build`，用 GitHub-hosted runner，不碰 VM。`deploy.yml` 可加 `needs` 或 branch protection 要求 CI 通過。前提是先修 N-01，否則 CI 會先紅。另外 `npm install --production` 在新版 npm 已被 `--omit=dev` 取代，可順手更新。風險低。0.5～1 天；優先度**高**。

---

## 4. 需本機／VM 驗證的清單（本輪未處理）

| 項目 | 驗證方式（建議） | 對應 |
|------|----------------|------|
| `text_embedding_index`／`video_embedding_index` 是否 READY | 唯讀帳號 `listSearchIndexes`；VM `curl localhost:4000/health` | D-01 |
| Atlas collections 與 indexes（含 `chunkId_1`、`video_id_1` vs `videoId_1`） | `mongodb-inspect` skill 唯讀 `listCollections`／`listIndexes` | D-02、D-05、D-13 |
| `video_segments_text` 的 contract metadata 分布、`courseId` 缺失筆數 | 唯讀 aggregate | D-04、D-08 |
| 各影片 segments 覆蓋率 | 唯讀 aggregate | D-11 |
| VM `backend/.env` 是否有 `QA_MATCH_LIMIT=15` | `sudo -u focusflow grep QA_MATCH_LIMIT /opt/focusflow/backend/.env` | D-16、N-01 |
| pm2 執行模式（fork／cluster） | `pm2 describe focusflow-backend` | D-17 |
| nginx 是否擋 `/api/v1/internal/` | 讀 `/etc/nginx/conf.d/focusflow.conf`；外部 `curl -X POST https://focusflow.ntub.edu.tw/api/v1/internal/videos/x/processing/start` 應回 401／404 | N-08 |
| VM `uploads/` 磁碟用量 | `du -sh /opt/focusflow/backend/uploads` | D-14 |
| Let's Encrypt 首次自動續約 | 2026-11-10 後檢查憑證效期 | D-21 |
| LINE webhook／ngrok、YouTube OAuth、SMTP 實際可用性 | 管理員「系統服務」頁或 VM `/health` | D-06、D-21 |
| Parent 階層式檢索 live E2E | 依 `docs/current-status.md:235-238` 步驟 | D-07 |

---

## 5. 本輪實際執行的指令與限制

- `cd backend && npm test`：853/887 通過、34 失敗（無 `.env`，完整記錄於 §1）。
- `cd backend && QA_MATCH_LIMIT=15 npm test`：887/887 通過（只用來確認根因，不是本報告的正式測試結果）。
- 覆蓋率：`QA_MATCH_LIMIT=15 node --test --experimental-test-isolation=none --test-concurrency=1 --experimental-test-coverage --test-coverage-include='src/**'`：887/887 通過。
- Route 比對：載入 `src/app.js`（沒有呼叫 `connectDatabase`）並走訪 Express router stack；OpenAPI 以 `js-yaml` 解析。
- 錯誤碼比對：自寫括號配對 parser 掃描 `src/**/*.js` 的 `new AppError(`。
- **沒有**執行：frontend `npm test`／`lint`／`build`、STT pipeline 測試、任何 Atlas／Gemini／LINE／YouTube／VM 連線。
- **沒有**修改任何既有檔案；唯一新增的是本報告。
