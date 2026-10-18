# Adaptive GenUI 共用契約

M0-E02 的純資料套件，依 `m0-contract-v1` 定義 comparison、steps、quiz。
契約位於 `index.cjs`；`index.mjs` 只重新匯出同一組物件。沒有 app、DB、環境設定或 provider SDK 相依。

採固定 **zod 3.25.76 的 `zod/v4` 子路徑**：本地 Node 22.23.2 的 CJS／ESM 探針與內建 `toJSONSchema` 通過，因此不改採 Ajv。套件版本與匯入的 API 世代不同是刻意選擇；升級時須重跑探針，不可改用 `require('zod')` 的 v3 API。lockfile 的 resolved／integrity 取自先前核准安裝留下的 `node_modules/.package-lock.json`，本輪不下載依賴。

在本目錄安裝依賴：`npm.cmd ci --ignore-scripts --no-audit --no-fund`。需要 registry 或已準備的本地 cache；此命令本輪未執行。執行測試前須有本套件的 Zod，後端／前端原有 package manifest 不必安裝新相依。

```js
// Backend (CJS, from backend/tests)
const { LearningUiDraftSchema } = require('../../shared/adaptive-genui');
```

```js
// Frontend (ESM, from frontend/focus-flow/tests)
import { LearningUiArtifactSchema } from '../../../shared/adaptive-genui/index.mjs';
```

公開 schema：`LearningUiDraftSchema`、`LearningUiArtifactSchema`、`LearningInteractionSchema`、`InteractionContextSchema`；均拒絕未知欄位。版本欄位使用字串 `'1'`，artifactVersion／expectedStateRevision 使用安全整數。結構檢查包括唯一 ID、內部參照、來源身分一致、比較格子完整與 quiz 正解存在。Draft／Artifact 限 32,768 UTF-8 bytes，文字限 1,000 Unicode code points。`ref-<64 hex>` 與 `sha256:<64 hex>` 是專用來源身分格式，不套用一般 64 字元 ID 限制。

`draftJsonSchema()` 匯出完整 Draft 結構；傳入 `comparison`／`steps`／`quiz` 可匯出 planner 選定元件的結構，避免 provider payload 使用多型 union。所有結構由同一 Zod shape 產生。JSON Schema 不完整表達 Zod refinements：Unicode code point／整體 byte 上限、保留 ID、唯一性、參照及教材語意仍須 runtime validation。

`tests/providerMocks.cjs` 是**測試專用**的 OpenAI Chat Completions／Gemini payload 與 response 範例。Gemini 的 legacy responseSchema 探針只投影基本 type／enum／properties／required／items／array bounds；移除的 constraints 不代表放寬應用層契約，回應一律再經嚴格 Zod 驗證。Mock 沒有網路能力；不證明任何 live 模型接受此 schema 或符合品質要求。正式 provider adapter 及能力／失敗處理仍由 M2 建立。

驗證命令：

- cwd `backend`：`node --test --experimental-test-isolation=none --test-concurrency=1 tests/adaptiveGenui.contract.test.js`
- cwd `frontend/focus-flow`：`node --test tests/adaptiveGenui.contract.test.js`

本輪僅建立 Node CJS／ESM 匯入探針，未接入產品 API、React renderer 或正式依賴鏈。Vite 未安裝，瀏覽器 bundle、lint／build 及 renderer 整合留待 M3；不能把 Node ESM 成功當成瀏覽器驗收。套件沒有讀取 `.env` 或啟服。

本 schema 的 S-id 檢查只驗格式；當輪 Evidence Bundle membership、內容支持、hash 計算／授權／撤銷重驗屬 M2/M3/M4。事件 schema 只驗 request，擁有權、去重、CAS、期限及持久化必須由後端執行，前端驗證不能取代它們。
