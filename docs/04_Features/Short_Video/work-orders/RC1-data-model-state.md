# 工作說明：recut RC1（資料模型、狀態機與背景工作）

你在 FocusFlow repo 的一個 git worktree 裡工作，分支 `wip/recut-rc1-data-model`，從 `feat/recut` 切出（`feat/recut` 不存在時先從 `dev` 建立）。先讀 repo 根目錄的 `AGENTS.md` 與 [HANDOFF.md](../HANDOFF.md) 的「必守規則」並遵守。

這張工單打地基：資料怎麼存、狀態怎麼走、背景工作怎麼排隊與恢復。**不呼叫 Gemini、ffprobe、faster-whisper 或渲染**；這些步驟由 RC2～RC4、RC7 接上，本工單只提供它們要插入的介面與假步驟測試。

## 先讀

1. [recut 設計決策](../recut-design-decisions.md)：「名詞」「整體流程」「階段與檢查」三節，以及第 1～4、16、17、19、25、27、34、47、51、54、55、58、60、63～65、67～69、72、73、75～78 項。
2. [體驗設計決策](../decisions.md)：UX-3、UX-7～UX-10、UX-12。
3. 現有短影片腳本（要擴充，不要另起一套選題與審核）：`backend/src/models/shortScript.model.js`、`backend/src/constants/enums.js`（`SHORT_SCRIPT_STATUSES`）、`backend/src/services/shortScript.service.js`、`backend/src/services/shortScriptGeneration.service.js`（8 拍，**行為不改**）、`backend/src/routes/short-script.routes.js`、`backend/src/controllers/shortScript.controller.js`、`backend/src/models/shortAsset.model.js`。
4. 背景工作與啟動恢復的既有模式：`backend/src/services/video.service.js` 的 `recoverQueuedVideoProcessing`、`backend/src/services/videoProcessingQueue.service.js`、`backend/src/server.js` 的啟動流程、`backend/src/services/notification.service.js`。
5. 施工單格式：`short_render/README.md` 的「plan 格式」與 `short_render/src/plan/schema.js`。
6. `.claude/rules/database.md`、`.claude/rules/api-design.md`、`.claude/rules/testing.md`、`.claude/rules/security.md`。

## 要做

1. **產片方式**（第 2、78 項）：`ShortScript` 加 `productionMode`（`avatar`｜`recut`）；舊資料沒有這個欄位時視為 `avatar`，讀取時處理，不寫資料遷移。教師在選題之後、建立腳本之前選擇；還沒有任何 recut 生成紀錄前可切換，之後切換時保留舊紀錄不刪（第 64 項）。現有 `courseId + topicKey` 唯一索引不動。
2. **recut 資料**：每次生成或修改的大量紀錄放在**獨立集合**，`ShortScript` 只放 recut 的目前狀態與指向目前版本的參照，避免單一文件無限長大。集合與欄位依 `.claude/rules/database.md` 命名；要放的內容至少有：
   - **連續視窗**（第 1 項）：影片、起訖秒數、凍結時間、命中的片段 ID。
   - **句子清單**（第 25 項）：`s1`、`s2`…的編號、起訖秒數、文字、逐字時間、是否為檢索命中（★）。格式在這裡定好並附測試用的樣本資料，RC2 負責產生、RC3 負責使用。
   - **原片檢查與音量**（第 61、67 項）：檢查結果、量到的響度與峰值、算出的固定增益。
   - **版本**：每一版的選段（`from`／`to`／`startAt`／`endAt`、每句理由標籤、片頭重點句、無法回答與原因，第 27、47 項）、施工單（`recut-v1`）、產生它的模型 ID、素材套件與 short_render 版本、主題（第 20、65 項）；舊版不覆蓋（第 64 項）。
   - **任務紀錄**（第 34、64 項、UX-8、UX-12）：任務類型（初次生成、套用選段修改、套用 AI 建議）、開始時固定下來的呼叫上限、已用次數、每一步每一次嘗試的輸入、輸出、驗證結果、模型 ID、token 用量（`usageMetadata`）、耗時。
   - **AI 檢查建議**（第 19 項）：類型、內容、教師是否採納。
   - **教師修改紀錄**（第 51、77 項）：改了哪一句、那句原本的標籤、選填的修改原因標籤、時間。
   - **核准紀錄**（第 63、73、75 項）：講稿核准與成品核准各自記下誰、何時、核准的是哪一版。
   - **操作時間**（第 58、76 項）：講稿審閱、成品審閱、等待製作三段。
3. **階段與檢查常數**（第 60 項）：把決策「階段與檢查」表寫成**一份**常數（階段、執行位置、檢查項目代碼、不通過時退回哪一步），其他程式只引用它。
4. **狀態轉換的唯一入口**（第 63、68、54、69、75 項）：寫一個集中處理狀態轉換的函式，所有改狀態的程式都走它，並在這裡擋下：
   - 沒有講稿核准紀錄、或核准的不是目前版本時，不得進渲染佇列；
   - 沒有對應這支 MP4 的成品核准紀錄時，不得上架；舊成品的核准不得用在新版；
   - 有未套用的選段修改、或重新配圖正在跑時，不得核准講稿；
   - 成品修改後依第 75 項判斷回到講稿審閱或只重審成品。
5. **背景工作佇列**（第 16、69 項）：recut 的生成與修改任務存成資料庫中的工作（排隊、執行中、要求取消、成功、失敗），同一程序一次跑一件；後端重啟時沿用 `recoverQueuedVideoProcessing` 的模式恢復；每一步之間檢查「要求取消」，取消或失敗時回到原版（第 69 項）。步驟用可插拔的介面註冊，本工單只放假步驟供測試；完成或失敗時用現有通知服務通知教師。
6. **最小 API**（掛在現有短影片腳本路由下，沿用相同的教師權限檢查）：設定產片方式、啟動 recut 生成（回 202 與任務 ID）、查詢任務與目前狀態、要求取消。新增錯誤碼補進 `.claude/rules/api-design.md`。
7. **文件**：`backend/docs/openapi.yaml`（`tests/docs.routes.test.js` 要通過）、`backend/docs/phase2-api-contract.md`；依決策第 70 項，把狀態機與背景工作的設計（狀態圖、轉換規則、恢復方式、取捨）寫進 `backend/docs/` 中適當的文件。

## 測試

用 `node:test` 與 `tests/helpers/backendTestHarness.js`。至少涵蓋：

- 舊的 `ShortScript` 沒有 `productionMode` 時視為 `avatar`；8 拍腳本的既有測試全部通過、行為不變。
- 產片方式的切換規則：未生成前可切換；已有 recut 紀錄後切換不刪紀錄。
- 狀態轉換：上面第 4 點的每一條各有通過與被擋下的測試，包含「核准的是舊版本」。
- 背景工作：排隊與依序執行；重啟後恢復排隊中的工作；執行中的工作重啟後的處理；取消在步驟之間生效並回到原版；失敗時回到原版並保留錯誤原因；完成與失敗都發通知。
- 呼叫上限在任務開始時固定，任務進行中改設定不影響這次任務。
- 新 API：權限（非該課程教師、學生得 403）、輸入驗證、202 與任務查詢。

## 不在本工單

視窗擴展與辨識（RC2）、Gemini 呼叫與驗證（RC3、RC4）、施工單內容與渲染（RC5、RC7）、審閱 API 的修改與套用（RC8）、前端（RC9）、同意（RC10）。

## 完成時回報

commit 清單、測試結果（已執行與未執行分開列）、和本工單不同的地方與原因，以及留給後續工單的介面：集合與欄位、句子清單格式與樣本資料位置、狀態轉換函式與階段常數的用法、背景工作步驟的註冊介面。
