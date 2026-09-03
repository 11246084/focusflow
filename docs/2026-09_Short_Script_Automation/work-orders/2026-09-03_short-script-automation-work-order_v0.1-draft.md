# 短影片腳本自動化施工單 v0.1（草案）

> **本文件是草案，不得作為開工依據。**
>
> 依 [施工單目錄說明](../../2026-09_Student_Pilot_Backend/work-orders/work-order_README.md)：「若規格仍有未決事項，施工單只能標記為草案，不得作為開工依據。」
>
> **2026-09-03 更新**：[規格書 v0.9 草案](../2026-09_Short_Script_Automation_Spec.md) 已產出，原第 8.2 節的 D-01～D-07 全數轉為規格書的定案項目 DR-01～DR-09 或待決項目 P-01～P-04。本施工單的範圍與驗收條件一律以規格書為準；規格書升 v1.0 Frozen 後，本施工單方可核准開工。

| 項目 | 內容 |
| --- | --- |
| 產出日期 | 2026-09-03 |
| 基準文件 | [短影片腳本自動化規格書 v0.9 草案](../2026-09_Short_Script_Automation_Spec.md)（2026-09-03） |
| 證據來源 | Claude Code 唯讀程式盤點（2026-09-03，backend 工作樹 `main` @ `f404fe5`） |
| 對應討論 | 2026-09-03 對話：自動化流程六步驟可行性評估 |
| 目標 | 把「學生常問問題 → 短影片腳本」的前三步自動化，產出**結構化資料**供腳本模板套用 |
| 狀態 | 草案，未核准 |

---

## 核准

### 核准流程

```text
規格書 v1.0 Frozen（含簽核欄填寫）
      ↓
本施工單逐項對齊規格書
      ↓
核准前檢查表全部打勾
      ↓
簽核欄填寫
      ↓
開始實作（批次 A）
```

### 核准前檢查表

- [ ] [規格書](../2026-09_Short_Script_Automation_Spec.md) 已升 v1.0 Frozen，且簽核欄已填寫
- [ ] 本施工單第 1 節的納入／排除，與規格書第 3 章一致
- [ ] 各工作項的驗收條件與規格書第 7 章一致，且**沒有新增規格書沒有的需求**
- [ ] 第 3.2 節的資料寫入邊界，與規格書 R-03 一致
- [ ] 第 4 節的禁止事項，涵蓋規格書第 5 章全部七條安全紅線
- [ ] 第 7 節的修改位置總表，沒有涵蓋規格書排除範圍內的檔案
- [ ] 確認 `SHORT_SCRIPT_AUTOMATION_ENABLED` 預設為 `false`，且本輪不打算開啟

任一項不成立即停止，回報差異位置，不得自行選擇版本。

### 簽核欄

| 角色 | 姓名 | 日期 | 意見 |
| --- | --- | --- | --- |
| 專題負責人 | | | |
| 實作者 | | | |

> 未填寫前不得開始寫程式。

### 停止點需要再核准

本施工單有兩個停止點。**通過停止點需要再次核准，不由實作者自行判定**：

| 停止點 | 核准依據 | 核准人 |
| --- | --- | --- |
| SP-1 | 規格書 7.1 檢查表全部通過，且未觸發「明確失敗條件」；比對證據已存入 `evidence/`；P-01 分群門檻已依證據定版並回填規格書附錄 B | 專題負責人 |
| SP-2 | 規格書 7.2 檢查表全部通過 | 專題負責人 |

SP-1 若觸發明確失敗條件，回到 WO-02／WO-04 調整參數後重跑，**不得進入批次 B**。

---

## 0. 背景與定位

現況是人工流程：組員手動查資料庫、挑片段、寫腳本，已產出兩份範例與一份空白模板（`docs/short-video-examples/teacher-avatar-track/`）。本輪要把其中可重複的部分自動化。

### 0.1 關鍵設計決定：自動化不產出 markdown

自動化的輸出是 **JSON 結構化資料**，不是完整的 13 節腳本 markdown。理由：

- 腳本模板的 §0 架構決策、§1 分層、§6 SSML 骨架、§7 分身規格、§9 配樂、§10 字卡、§11 ffmpeg、§12 製作順序、§13 驗收清單，在既有兩份範例之間**幾乎逐字相同**，屬於模板固定值，不需要每次重新生成。
- 只有 §2 證據表、§3 全域設定、§4 寫作四題、§5 分鏡 8 拍、§1 的 B-roll 視覺隱喻是因主題而異。
- 腳本模板本身將另案修訂（見 8.1）。輸出 JSON 可讓自動化與模板版本**解耦**：模板改版時只需換 renderer，不必重寫 prompt。

### 0.2 對應的人工流程步驟

| 步驟 | 本輪範圍 |
| --- | --- |
| 1. 從 QA 選學生最常問的問題當主題 | 納入（WO-02） |
| 2. 從資料庫搜尋正確知識 | 納入（WO-03、WO-04） |
| 3. 生成腳本 | 納入（WO-05） |
| 4. 老師生成影片 | 不自動化（人工） |
| 5. 老師審核 | 不自動化（人工），但需提供審核與回饋的資料介面（WO-06） |
| 6. 通過→上架；未通過→帶回饋重生 | 部分納入：重生迴圈納入（WO-06）；YouTube 上架**不納入本輪** |

---

## 1. 納入與排除

### 1.1 納入

- 課程層級的「熱門提問候選清單」聚合，含同義題合併與拒答題過濾。
- 依選定問句取得檢索證據，並**凍結快照**存檔（含 `chunkId`、`videoId`、`startSec`、`endSec`、STT 原文）。
- 依證據生成 8 拍口白與敘事設定，每一拍強制標注依據來源。
- 生成後的**引用驗證**：所有 `basedOn` 的 chunkId 必須存在於本次證據包，否則整份退回。
- 腳本版本化，以及老師回饋的分流重生（`retrieval` / `narrative`）。
- 教師端 API 與對應測試。

### 1.2 排除（本輪明確不做）

- **不修改** `docs/short-video-examples/teacher-avatar-track/` 底下的 V4、V5 與空白模板。使用者 2026-09-03 決定：先做自動化，腳本模板之後才套用。
- 不做 YouTube 上架（`ShortAsset` 發布流程另案；本輪只到「腳本核准」為止）。
- 不做前端頁面（本輪只做 backend API 與 service）。
- 不改動 QA 既有行為：`askQuestion` 的回應格式、FAQ 快取命中路徑、`QA_MATCH_LIMIT` 語意一律不動。
- 不做 B-roll 影片生成、語音合成、ffmpeg 合成等產製環節。
- 不改 `questions`、`faqs`、`video_segments_text` 任何既有欄位或索引。

---

## 2. 工作項與執行順序

依賴關係固定，不得跳批次執行。

```text
批次 A（純資料，無 LLM）
  WO-01 → WO-02
        → WO-03 → WO-04
              ↓
         【停止點 SP-1】
              ↓
批次 B（含 LLM）
  WO-05 → WO-06 → WO-07
              ↓
         【停止點 SP-2】
```

### WO-01 抽出重複的 cosine similarity

**問題**：`computeCosineSimilarity` 目前有兩份幾乎相同的實作：

| 位置 | 是否 export |
| --- | --- |
| `backend/src/services/faqCache.service.js:31` | 否 |
| `backend/src/services/qa.service.js:105` | 否 |

WO-02 需要用到向量相似度做同義題分群，若再複製第三份會擴大重複。

**修改位置**

- 新增 `backend/src/utils/vectorSimilarity.js`
- 修改 `backend/src/services/faqCache.service.js`、`backend/src/services/qa.service.js` 改為引用

**驗收條件**

- 兩個 service 的行為完全不變。
- `cd backend && npm test` 全數通過，且測試數不減少。

**禁止**：不得順手調整任何相似度門檻或比較邏輯。這是純搬移。

---

### WO-02 熱門提問候選清單

**資料來源**：`faqs` collection。既有欄位已足夠，不需新增：

| 欄位 | 用途 |
| --- | --- |
| `question` / `normalizedQuestion` | 顯示與精確去重 |
| `questionEmbedding` | 同義題分群（不需重跑 embedding） |
| `hitCount` | 熱度排序，已有索引 `{ courseId: 1, hitCount: -1 }`（`backend/src/models/faq.model.js:63`） |
| `matches` | 預覽該題目前撈到哪些片段 |

**必要處理**

1. **同義題分群**：字串比對不足以合併。實測資料顯示同一題有多種寫法（「open cv 跟 yolo 的關係是甚麼?」8 次、「YOLO跟opencv的具體差異是什麼？」4 次、「opencv跟yolo有什麼差異?」3 次）。以 `questionEmbedding` 做 cosine 分群，門檻須低於 FAQ 命中用的 `FAQ_CACHE_SIMILARITY_THRESHOLD`（預設 0.95）。建議起始值 0.85，**列為待決事項 D-02**。
2. **拒答題過濾**：被 `answerGeneration.service.js` 的 `isNoAnswerReply()` 判定的回答不會存進 FAQ，但 `questions` collection 內仍有。若日後改用 `questions` 為來源，必須套用同一判定。本輪以 `faqs` 為唯一來源，因此天然已過濾，但須在程式註解標明此依賴。
3. **候選清單，非自動選題**：目前資料量下最高熱度僅個位數（範例中 8 次已是全庫最高），排名統計意義薄弱。輸出為**候選清單供老師勾選**，不得自動決定主題。

**修改位置**

- 新增 `backend/src/services/shortScriptTopic.service.js`

**驗收條件**

- 給定同一課程的多筆同義 FAQ，回傳合併後的單一候選，且 `totalHitCount` 為各筆加總、`variants[]` 保留原始問句。
- 跨課程不得混入：只回傳呼叫者有權限的課程（沿用 `courseAccess.service` 既有判定，不自行實作權限邏輯）。
- 新增 `backend/tests/short-script-topic.service.test.js`，至少涵蓋：同義合併、跨課程隔離、空資料 zero-state。

---

### WO-03 QA 檢索的 retrieval-only 出口

**問題**：`backend/src/services/qa.service.js:1530` 目前只 export `askQuestion`、`buildAnswerStatus`、`buildCitations`、`buildUserFacingCitations`。沒有「只檢索、不生成答案」的路徑。腳本自動化只需要片段，不需要也不應該觸發 LLM 答案生成與 FAQ 寫入。

**可用接縫**（皆已存在，僅未 export）：

| 函式 | 位置 |
| --- | --- |
| `loadScopedSearchableSegments` | `qa.service.js:446` |
| `searchSegmentsInMemory` | `qa.service.js:461` |
| `searchSegmentsWithAtlas` | `qa.service.js:506` |

範圍建構沿用 `backend/src/services/bridgeScope.service.js`，不得自行實作 scope。

**修改位置**

- `backend/src/services/qa.service.js`：新增並 export `retrieveSegmentsOnly({ courseId, question, limit })`

**驗收條件**

- 呼叫後**不得**寫入 `faqs`、`questions`、`usagelogs` 任何一筆。
- 沿用既有 fail-closed 行為：scope 為空時不得回傳跨課程片段。
- `askQuestion` 的既有測試全部維持通過，回應格式零變更。

**禁止**：不得為了方便而放寬 `bridgeScope` 的 allowlist 語意。跨課程隔離是學生試用版 Phase 1 已收斂的安全邊界。

---

### WO-04 證據包凍結

**為什麼要凍結**：影片可能被刪除或重新處理，`video_segments_text` 的內容會變動。腳本的可追溯性依賴當下引用的原文，因此證據必須**在選定當下複製一份存下來**，不可在生成或審核時即時重查。

**新增 collection**：`shortscripts`（Mongoose model `ShortScript`，沿用預設小寫複數命名）

```text
courseId          ObjectId, ref Course, required
topic             String（老師確認的主題文字）
sourceQuestions   [{ faqId, question, hitCount }]
evidence          [{ code, chunkId, videoId, videoTitle, startSec, endSec, rawText }]
evidenceFrozenAt  Date
versions          [{ versionNo, payload, generatedAt, feedback, feedbackType, reviewedBy, reviewedAt }]
status            enum: draft | evidence_ready | generated | changes_requested | approved
```

- `evidence[].code` 對應腳本模板 §2 的代號 A、B、C…
- `evidence[].rawText` 存**未修飾的 STT 原文**。STT 錯字（例：`雀的gp`、`OvenCV`、`優龍`、`Opens TV`）一律原樣保留，不得在此階段自動糾錯——糾錯本身會引入幻覺，且會使引用無法比對回原始片段。

**修改位置**

- 新增 `backend/src/models/shortScript.model.js`
- 新增 `backend/src/services/shortScript.service.js`（本工作項只做證據凍結）
- 修改 `backend/src/constants/enums.js`：新增腳本狀態列舉

**驗收條件**

- 凍結後刪除來源影片，證據包內容不變且仍可讀取。
- 同一課程可存在多份腳本，互不干擾。
- 新增 `backend/tests/short-script.service.test.js` 涵蓋凍結與影片刪除後的不變性。

---

## 【停止點 SP-1】

批次 A 完成後**停止**，等待核准才進入批次 B。

**核准條件**：對至少 2 個課程各跑一次 WO-02 + WO-04，把系統選出的候選題與證據包，與人工撰寫 V4／V5 時實際採用的題目與片段做人工比對，並記錄差異。

這一步是整條路最便宜的可行性驗證：如果系統選出的題目和片段與人工判斷差太遠，批次 B 的生成品質不可能好，應先回頭調整分群門檻與檢索參數，而不是往下做。

比對結果存入 `docs/2026-09_Short_Script_Automation/evidence/`。

---

### WO-05 腳本生成與引用驗證

**輸出格式**（JSON，非 markdown）

```text
{
  globalSettings: { coreEvent, coreView, audienceAssumption, audienceTakeaway, targetAudience },
  writingFourQuestions: [ ... ],
  visualMetaphor: { s1, s2, s3 },      // 建議產出 2-3 組選項供老師挑
  shots: [
    { shotNo, arcRole, timeRange, narration, subtitle, editing, sfx,
      basedOn: ['chunk_0038'] | 'template' }
  ]
}
```

**引用驗證（本工作項的核心，不是附加檢查）**

- 每一拍必須帶 `basedOn`：陣列（chunkId）或字串 `'template'`。
- `'template'` 只允許用於不給答案的反問與懸念句（對應既有兩份範例鏡 08 的用法）。
- 生成後逐項驗證 `basedOn` 的 chunkId **確實存在於本次 evidence 快照**，任一項對不上即整份退回重生，最多重試 N 次後回報失敗，不得部分接受。
- 這是唯一能讓「AI 生成」與「追得回逐字稿」同時成立的機制。

**弧線適用性前置判斷**

8 拍標準弧線的核心是「反轉」，而既有兩份範例的反轉都是**逐字稿原句就有的**（V4「不是只有 ChatGPT」、V5「CPU 版等於沒有」）。若證據包內找不到轉折句，不得硬套此弧線——硬套會逼出假反轉（即幻覺）或空轉的鉤子。此情況應回報「本主題不適用此模板」，交由老師改用其他手法。

**修改位置**

- 擴充 `backend/src/services/shortScript.service.js`
- 新增 `backend/src/services/shortScriptGeneration.service.js`（prompt 與 provider 呼叫，沿用 `answerGeneration.service.js` 既有的 Gemini 接法）

**驗收條件**

- 注入一份含捏造 chunkId 的假生成結果，必須被驗證器攔下並退回。
- 證據包無轉折句時，回報不適用而非硬生成。
- provider 未設定時 fail-fast，不得 fallback 成靜默的模板輸出。

---

### WO-06 審核迴圈與回饋分流

老師的回饋分兩類，處理路徑不同，不得一律回到生成：

| 回饋類型 | 意義 | 回到 |
| --- | --- | --- |
| `retrieval` | 「這裡講錯了／漏了重點」 | WO-04 重撈證據 |
| `narrative` | 「開頭不夠吸引人／節奏太趕」 | WO-05 重生腳本 |

一律回 WO-05 會讓模型在錯的證據上反覆重寫，越改越像編的。

**修改位置**

- 擴充 `backend/src/services/shortScript.service.js`：`submitReview`、`regenerate`

**驗收條件**

- `versions[]` 逐版保留，且可取出任兩版做差異比對（老師需要確認上一輪意見有沒有被吃掉）。
- `retrieval` 類回饋會重新凍結證據，並在新版本記錄證據已更換。

---

### WO-07 教師端 API

**現況缺口**：`ShortAsset` 的 `createShortAsset`（`backend/src/services/shortAsset.service.js:110`）與 `updateShortAsset`（同檔 `:119`）**沒有掛任何 HTTP route**，目前只有 `backend/tests/short-asset.service.test.js` 在呼叫。學生端只有 `GET /api/v1/youtube/shorts`（`backend/src/routes/youtube.routes.js:9`）。

本輪只補腳本相關路由，`ShortAsset` 的教師端路由留待上架功能另案處理。

**新增路由**（沿用 `.claude/rules/api-design.md` 的 kebab-case、巢狀不超過兩層、`sendSuccess`）

```text
GET    /api/v1/courses/:courseId/short-scripts/topics    取得候選主題清單
POST   /api/v1/courses/:courseId/short-scripts           建立腳本（含證據凍結）
POST   /api/v1/short-scripts/:scriptId/generate          生成／重生
POST   /api/v1/short-scripts/:scriptId/review            提交審核回饋
GET    /api/v1/short-scripts/:scriptId                   取得腳本與版本
```

全部掛 `authenticate` + `authorizeRoles(teacher, admin)`，並沿用 `courseAccess.service` 的 owner teacher 判定。

**新增錯誤碼**（SCREAMING_SNAKE_CASE，須補進 `.claude/rules/api-design.md` 表格）

| 錯誤碼 | HTTP | 情境 |
| --- | --- | --- |
| `SHORT_SCRIPT_NOT_FOUND` | 404 | 腳本不存在 |
| `SHORT_SCRIPT_EVIDENCE_EMPTY` | 422 | 檢索不到可用片段，無法凍結證據 |
| `SHORT_SCRIPT_CITATION_INVALID` | 502 | 生成結果引用了證據包外的 chunkId，已退回 |
| `SHORT_SCRIPT_ARC_NOT_APPLICABLE` | 422 | 證據包無轉折句，不適用 8 拍弧線 |
| `SHORT_SCRIPT_STATE_INVALID` | 409 | 狀態轉換不合法 |

**驗收條件**

- 新增 `backend/tests/short-script.routes.test.js`，每條路由至少涵蓋成功、未授權、無權限、資源不存在。
- 依 `.claude/rules/testing.md`，測試透過 `tests/helpers/backendTestHarness.js` 的 in-memory store，不依賴真實 MongoDB。

---

## 【停止點 SP-2】

批次 B 完成後停止。核准前不得啟用 feature flag，也不得接上任何上架流程。

---

## 3. Feature flag 與資料寫入邊界

### 3.1 Feature flag

新增 `SHORT_SCRIPT_AUTOMATION_ENABLED`，**預設 `false`**。為 `false` 時所有新增路由回 404，service 不得被其他既有流程呼叫。

須同步更新 `backend/.env.example` 與 `/health` 的 runtime 區塊（依 CLAUDE.md：判斷 runtime 狀態一律看 `/health`，不看 `.env`）。

**提醒**：`.env` 不進版控，部署不會同步。新增變數後 VM 上必須手動維護 `backend/.env`，否則本機可跑不代表 VM 可跑。

### 3.2 資料寫入邊界

| Collection | 本輪權限 |
| --- | --- |
| `shortscripts` | 讀寫（本輪新增） |
| `faqs` | **唯讀** |
| `questions` | **唯讀** |
| `video_segments_text` | **唯讀** |
| `videos`、`courses` | **唯讀** |
| `usagelogs` | 不寫（若之後要記 token 成本，另案決議） |
| `shortassets` | 本輪不碰 |

任何工作項若發現需要寫入唯讀 collection，**停止該項並回報**，不得自行放寬。

---

## 4. 禁止事項

1. 不得修改 `docs/short-video-examples/teacher-avatar-track/` 的任何檔案（使用者 2026-09-03 決定）。
2. 不得改變 `askQuestion` 的回應格式或 FAQ 快取行為。
3. 不得放寬 `bridgeScope` 的跨課程 allowlist 語意。
4. 不得對 STT 原文做自動糾錯後覆蓋原文。
5. 不得把「最常問」直接當成「已選定主題」，必須經老師確認。
6. 不得在引用驗證失敗時部分接受生成結果。
7. 不得刪除任何既有檔案或資料。

---

## 5. 測試要求

依 `.claude/rules/testing.md`：

```powershell
cd backend
npm test
```

單檔：

```powershell
node --test --experimental-test-isolation=none --test-concurrency=1 tests\short-script.service.test.js
```

每個批次結束時，backend 全套測試須全數通過且測試總數不得減少。

---

## 6. 文件更新

依 CLAUDE.md「文件更新」節，本輪完成後須檢查：

- `docs/current-status.md`（新增功能與其 flag 狀態）
- `backend/docs/current-state.md`
- `backend/docs/openapi.yaml`（新增五條路由）
- `backend/.env.example`（新增 flag）
- `.claude/rules/api-design.md`（新增五個錯誤碼）

---

## 7. 預計修改的程式位置總表

| 檔案 | 動作 | 工作項 |
| --- | --- | --- |
| `backend/src/utils/vectorSimilarity.js` | 新增 | WO-01 |
| `backend/src/services/faqCache.service.js` | 修改（改引用） | WO-01 |
| `backend/src/services/qa.service.js` | 修改（改引用、新增 export） | WO-01、WO-03 |
| `backend/src/services/shortScriptTopic.service.js` | 新增 | WO-02 |
| `backend/src/models/shortScript.model.js` | 新增 | WO-04 |
| `backend/src/services/shortScript.service.js` | 新增 | WO-04、WO-06 |
| `backend/src/services/shortScriptGeneration.service.js` | 新增 | WO-05 |
| `backend/src/constants/enums.js` | 修改（新增狀態列舉） | WO-04 |
| `backend/src/routes/short-script.routes.js` | 新增 | WO-07 |
| `backend/src/routes/index.js` | 修改（掛載） | WO-07 |
| `backend/src/controllers/shortScript.controller.js` | 新增 | WO-07 |
| `backend/src/config/env.js` | 修改（新增 flag） | WO-07 |
| `backend/tests/short-script-topic.service.test.js` | 新增 | WO-02 |
| `backend/tests/short-script.service.test.js` | 新增 | WO-04、WO-06 |
| `backend/tests/short-script.routes.test.js` | 新增 | WO-07 |
| `backend/tests/helpers/backendTestHarness.js` | 修改（新增 store） | WO-04 |

---

## 8. 已知衝突、阻塞與待決事項

開工前須完成決議。

### 8.1 已知狀態（不阻塞，但須知悉）

- **腳本模板為舊版**：`4ish_腳本架構模板_教師數位分身x標準敘事弧線.md` 仍寫著 `Reference-to-Video`（第 107、281 行）、「一次產出 30 秒」（第 397 行）與「驅動音軌用於對嘴」（第 284 行），三項均與 MiniMax H3 官方規格不符。使用者已決定本輪不修。因為自動化輸出 JSON 而非 markdown，此事**不阻塞本施工單**，但套用階段前必須修正，否則組員填出來的每一支都會複製同樣的錯誤假設。
- **teacher-avatar-track 未收進 README**：與 `docs/short-video-examples/` 的十支體系（v8，含 G1／G2／G3 驗證閘、共用配樂、統一調色）分岔。本輪不處理。

### 8.2 原待決事項 D-01～D-07：已由規格書處理

2026-09-03 產出規格書後，本節原列的七項待決事項全數轉出，本施工單不再重複定義。對照如下：

| 原編號 | 議題 | 現況 |
| --- | --- | --- |
| D-01 | 是否先立規格書 | 已產出 [規格書 v0.9 草案](../2026-09_Short_Script_Automation_Spec.md) |
| D-02 | 同義題分群門檻 | 轉為規格書 **P-01**：預設 0.85，須以階段 A 實際資料校準後定版 |
| D-03 | 候選清單資料量門檻 | 已定案為規格書 **DR-03**：`hitCount >= 2` |
| D-04 | Parent 多層級檢索 | 已定案為規格書 **DR-04**：本輪不納入，沿用 leaf 檢索 |
| D-05 | B-roll 視覺隱喻 | 已定案為規格書 **DR-05**：產出 2–3 組選項，且須避開該課程用過的隱喻 |
| D-06 | 生成成本歸屬 | 已定案為規格書 **DR-06**：寫入 `usagelogs` 但用新 event 型別，不計入 `queriesCount` |
| D-07 | 引用驗證重試上限 | 已定案為規格書 **DR-07**：重試 2 次，失敗保留最後輸出供人工檢視 |

### 8.3 仍阻塞正式使用的事項

見規格書第 8.2 節 P-01～P-04（分群門檻定版、腳本品質標準、書面同意書格式、腳本模板修訂時程）。其中僅 **P-01** 與本施工單的批次 A 直接相關；其餘不擋實作，擋正式使用。

**需要決策的人員**：專題負責人（範圍、P-03、P-04）、指導教授（P-02 的品質標準）。

---

## 9. 變更紀錄

| 日期 | 版本 | 變更 |
| --- | --- | --- |
| 2026-09-03 | v0.1 草案 | 初稿。依 2026-09-03 對話的可行性評估與唯讀程式盤點產出 |
| 2026-09-03 | v0.1 草案（修訂） | 規格書 v0.9 產出後同步：基準文件改指向規格書；第 8.2 節的 D-01～D-07 轉出至規格書的 DR/P 編號，避免兩份文件重複定義同一議題 |
