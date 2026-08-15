# Backend 文字搜尋 Embedding 契約

最後更新：2026-08-08。這份文件是 Backend 與 Pipeline、Database 對齊用的契約草案與驗收清單；它不代表既有 Leaf／Parent 向量已重建，也不代表正式環境已切流。

## 目的與切換邊界

`gemini-embedding-2-preview` 與 stable `gemini-embedding-2` 不可混用。兩者即使都輸出 3072 維，也不代表位於同一個向量空間；query、Leaf document、Parent document 必須使用同一組模型與文字處理規則。

本輪 Backend 交付包含：穩定模型的 query request、輸出驗證與 normalization、runtime/health diagnostics、相容性測試、API／環境設定說明，以及供跨組提供 active data metadata 的檢查入口。

本輪不包含：重新處理影片、重建 Leaf／Parent vectors、寫入 shared MongoDB／Atlas、建立或修改 Atlas index、Gemini live smoke、部署或開啟 `HIERARCHICAL_RETRIEVAL_ENABLED`。

## Canonical contract

| 欄位 | Backend query contract | Leaf／Parent document contract |
|---|---|---|
| provider | `gemini` | `gemini` |
| model | `GEMINI_EMBEDDING_MODEL_NAME`，預設 `gemini-embedding-2` | 必須與 Backend model 完全相同；任何 `preview` model 都不相容 |
| dimension | 3072 | 3072 |
| query instruction | `task: search result \| query: {content}` | — |
| document instruction | — | `title: {title} \| text: {content}`；沒有標題時使用 `title: none` |
| instruction version | `gemini_embedding_2_asymmetric_retrieval_v2` | Query 使用 `task: search result \| query: ...`，Document 使用 `title: none \| text: ...` |
| task type | 不傳 `taskType`／`task_type`（stable Embedding 2 不支援） | 不使用 legacy `RETRIEVAL_DOCUMENT`／`RETRIEVAL_QUERY` task type |
| generation version | `text_search_generation_v2` | 必須相同 |
| normalization | `unit_l2_v1`，輸出為非零 unit vector | 必須相同 |
| contract version | `gemini_embedding_2_text_v2` | 必須相同 |
| schema version | `gemini_embedding_2_text_v2` | 必須相同；legacy `embeddingSchemaVersion` 會納入比較 |

模型名稱可以設定，但 runtime 不得呼叫 preview 或其他未通過此契約的模型。query response 必須恰好包含 3072 個 finite number；Backend 仍會自行做 L2 normalization，避免把 provider 的正常化行為當成未驗證的假設。

Backend 使用 Gemini raw REST `embedContent`：API key 放在 `x-goog-api-key` header，body 使用 `model: models/gemini-embedding-2`、`content.parts[].text` 與頂層 snake_case `output_dimensionality: 3072`；不傳 `taskType`、`task_type` 或 SDK 專用的 `embedContentConfig` wrapper。

## Health / readiness

`GET /health` 的 `runtime.qa` 應同時顯示：

- `queryEmbeddingContract`：目前 provider、model、dimension、instruction version、generation version、normalization version、contract/schema version 與 task type。
- `dataContractCompatibility`：active Leaf／Parent 的 `status`、`expected`、`active`、`mismatches` 與 metadata source。
- `parentQueryEmbeddingCompatible`：完整契約結果，不得只比較 dimension。

部署可以透過 `QA_ACTIVE_LEAF_EMBEDDING_CONTRACT_JSON` 與 `QA_ACTIVE_PARENT_EMBEDDING_CONTRACT_JSON` 提供 Pipeline／Database 已驗證的 active metadata。未提供 metadata 時：

- `mock + memory` 可保持本機 QA `ready`，但 compatibility 必須顯示未驗證，不能被當成 Atlas 證據。
- `atlas` 需要 active Leaf contract；缺少或不相容時必須 `hard_fail`。
- 開啟 hierarchical retrieval 時需要 active Parent contract；允許 Leaf fallback 時為 `degraded`，禁止 fallback 時為 `hard_fail`。

這些 assertions 是跨組契約證據，不是對 shared Atlas 的寫入，也不是自動重建或自動切流機制。

## 跨組狀態與責任

| 組別 | 本輪要求 | 目前可宣稱的證據 |
|---|---|---|
| Backend | stable query request、完整 contract comparison、health、tests、OpenAPI／env 說明 | 本機／mock／in-memory 可驗證；不等於 Gemini live 或 Atlas ready |
| Pipeline | 將 document query instruction、model、version、normalization 契約套用到新 artifacts；拒絕 preview checkpoint reuse | 既有 source／artifact 仍需另行遷移與重建，未因 Backend 變更而自動完成 |
| Database | 只接受契約一致的 Leaf／Parent documents，提供 active metadata、collection/index 與 read-only explain 證據 | index READY 不等於 vectors compatible；本任務不寫 shared DB 或改 index |
| Gate review | 確認 vectors、metadata、index、read-only E2E 與 rollback 後才評估開關 | `HIERARCHICAL_RETRIEVAL_ENABLED` 維持 `false` |

在 Pipeline／Database 尚未提供相同 contract metadata 與新 vectors 前，Backend health 應明確呈現 degraded／hard-fail，而不是用 3072 維度誤報正常。

## 驗收層級

1. Node unit／route tests：驗 request payload、instruction、3072 維、finite／non-zero、L2 normalization、錯誤分類與 health readiness。
2. 隔離 MongoDB：需另行驗證 schema、vector index 與 read-only query；本輪不自動執行。
3. Shared Atlas：需使用核准的 read-only fixture，確認 active Leaf／Parent metadata、index queryability、`chunkId_1` explain 與零寫入 E2E；本輪未執行。
4. 外部 Gemini：需額外授權與成本確認；本輪未執行 live smoke。

官方契約依 [Gemini Embeddings 文件](https://ai.google.dev/gemini-api/docs/embeddings) 與 [Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations)；stable `gemini-embedding-2` 的文字檢索 instruction、`task_type` 不支援與舊向量空間不可直接比較，均以官方文件為準。
