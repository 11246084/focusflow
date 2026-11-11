# 多模態離線驗收

這套工具驗證 Parent 到引用的程式路徑，以及固定題庫的排名驗算。執行時只讀本機 JSON，使用合成 fixture 或已保存向量，不連 Atlas、不呼叫模型。實際完成範圍與當次結果見[目前狀態](../../current-status.md)。

## Parent 路徑

`backend/tests/helpers/multimodalParentFixture.js` 明列 synthetic 來源。合成 Parent 用二維單位向量內積排序，正式 `searchParents` 複核契約與授權，再由 `expandParentHits` 查 Child、`assembleLeafContext` 組教師逐字稿，最後接 Bridge 與既有 RRF。

```mermaid
flowchart LR
  P[本機 Parent repository] --> S[searchParents 契約與授權]
  S --> C[expandParentHits 查 Child]
  C --> A[assembleLeafContext]
  A --> B[QA Bridge 文字一路]
  M[固定 audio／visual 候選] --> B
  B --> R[RRF 與授權逐字稿]
  R --> Q[QA／API 引用]
```

Flat 只回 child-0，Parent 命中則回 child-1、child-2。Parent 的 0–90 秒不取代 child-1 的 22–24 秒。兩種模式共用 media 候選；六組 × 兩模式 × 兩種權重維持每題 24 筆。缺 Parent、缺 Child、跨課影片會回退；部分 Child 缺少仍可保留有效候選，重複命中會去重。正式 QA 的新增測試另外使用 Fake Parent adapter 驗證 serve rollout，沒有宣稱 Atlas Parent 效果。

## 題庫與評分規則

正本為 [question-bank.json](../QA_Evaluation/datasets/question-bank.json)，檔案有 50 題，其中 43 題可回答、7 題應拒答。`--inspect-bank` 只檢查格式與缺漏，不計算品質分數。宣告的影片缺時間標註時拒絕評分，由題庫維護者確認，不自動補 gold。

沿用決議第 7 項，chunk 一半以上落在標註時間範圍才相關；同影片區間先取聯集，避免重複計秒。專題的 Recall@5 沿用題級命中定義，前五筆至少一筆相關為 1，否則 0；MRR 為保存前 20 名中第一筆相關結果的倒數排名。43 題做平均，拒答題排除並另記第一名 score，缺分數時回報 missingRefusalScores，不憑空填分數。

`offlineRetrievalAudit.service.js` 用區間合併評分；`verifyMultimodalAudit.js` 獨立以端點切割及中點覆蓋重算，不共用相關性與指標計算函式。兩者共用題庫 parser，parser 的多影片、逗號區間與缺漏由獨立案例驗證。任一逐題／平均結果不符即拒絕驗算。

## 輸入與命令

從根目錄使用支援版本的 Node。

```powershell
node backend/scripts/auditMultimodalOffline.js --inspect-bank docs/04_Features/QA_Evaluation/datasets/question-bank.json
node backend/scripts/auditMultimodalOffline.js bank.json manifest.json per-question.json config.json
```

輸出只有機器可讀 JSON。BLOCKED 結束碼 2，格式／校驗錯誤結束碼 1；成功為 0。檔案與輸出保存在忽略目錄，不將向量、逐字稿或備份提交 Git。

- bank 沿用上述題庫格式。manifest 為 `{ provenance, chunks }`，每個 chunk 必須有 courseId、videoId、chunkId、startSec、endSec，且在題庫課程與影片範圍內。禁止重複身份或無效時間，不需要向量與逐字稿。
- per-question 沿用現有輸出，每筆包含 questionId、mode、group、weighting、ranked。每題完整 24 組，ranked 上限 20，rank 從 1 連續；身份、影片與秒數必須和 manifest 一致。重複 chunk、未知題號、跨課、缺組或時間錯位會拒絕。
- config 需有 bankHash、manifestHash（`fingerprint` 對載入 JSON 的 SHA-256）、questionCount（含拒答題）、k=60、perChannelLimit=20、modes=`[flat,hierarchical]`、weights=`[equal,text_weighted]`、groups=`[text,audio,visual,text_audio,text_visual,all]`。順序固定。provenance 明列 synthetic、saved-gemini-fake-atlas 或 atlas，formalEvaluation 必須 false。
- 舊三題／72 筆 config 沒有完整題庫與 manifest 綁定，會回報 BLOCKED。不能把它補標成完整 43 題結果。工具回傳 bank／manifest／ranking／config hash 供獨立驗算與追溯，qualityClaim 固定 false。

離線單元測試用合成 43 題及合成 gold 驗算算式，所有數字僅代表測試預期值。正式品質報告、真實完整排名、gold 補標與驗收另行進行，本工具不授權正式品質宣稱。

## 引用元件瀏覽器 smoke

`multimodal-qa.integration.test.js` 可將本機 API 結果的身份、原始時間及來源輸出到 MULTIMODAL_BROWSER_FIXTURE 指定位置；不輸出逐字稿或向量。先設定 MULTIMODAL_OFFLINE_BUNDLE 指向保存的小樣本 bundle，再執行該測試。

`frontend/focus-flow/tests/browser/citationSmoke.mjs` 用 React 實際標籤元件渲染最小本機頁面，再以 Playwright 驗證 aria-label、舊資料無標籤、身份／排名／秒數及鍵盤跳轉。PLAYWRIGHT_MODULE_PATH 可指向現有 Playwright 模組，PLAYWRIGHT_CHROMIUM_EXECUTABLE 可指向已安裝的 Edge／Chromium。

```powershell
node frontend/focus-flow/tests/browser/citationSmoke.mjs .local-tools/phase2-validation/phase9-browser-fixture.json .local-tools/phase2-validation/phase9-browser
```

這是實際引用元件的本機 smoke，範圍不含整個 StudentCourses 頁面、正式播放器或正式站人工驗收。若缺瀏覽器，明列未執行，不自動安裝或宣稱通過。
