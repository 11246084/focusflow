@AGENTS.md

# Claude Code 補充

共用規則以 AGENTS.md 為準；本檔只放每次工作都用得到、且讀程式看不出來的事項。`.claude/rules/` 會在修改對應路徑時自動載入，功能狀態只看[目前狀態](docs/current-status.md)。

## 常用指令

```powershell
# backend/
npm run dev
npm test
node --test --experimental-test-isolation=none --test-concurrency=1 tests\<file>.test.js
npm run docs:lint

# frontend/focus-flow/
npm run dev; npm test; npm run lint; npm run build

# STT_Whisper/
.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_*.py'
```

安裝步驟見各服務 README；驗證範圍依 [AGENTS.md](AGENTS.md#驗證依變更影響選擇) 選擇。

## 容易踩的坑

- `npm run seed:reset`、`db:sync-atlas`、`db:ensure-questions`、`db:backfill-questions -- --write` 會寫入資料庫；對 Atlas 執行前確認目標。
- 本機沒有金鑰時用 `QA_QUERY_EMBEDDING_PROVIDER=mock`、`QA_ANSWER_PROVIDER=template`、`QA_VECTOR_SEARCH_MODE=memory`；`atlas` 搭配 `mock` 不合法，`gemini` 缺金鑰會直接報錯。
- 服務是否可用看 `/health` 的 `runtime.*`，不看 `.env`。
- 新增或刪除 route 要同步 `backend/docs/openapi.yaml`，否則 `tests/docs.routes.test.js` 失敗。
- 改 QA 回應格式要同步 FAQ 快取命中路徑 `respondFromFaqCache`；比較設定或提示詞效果前先排除快取（`FAQ_CACHE_ENABLED=false`）。
- 改「答不出來」文案時改 `NO_ANSWER_*` 常數，不改提示詞內的字面字串。
- `docs/90_Archive/` 是歷史原文，不當成目前真相，也不改內文。

## 技術參考

| 主題 | 文件 |
|---|---|
| 後端分層、資料流、LINE 對話規則 | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 資料工具、問答設定組合 | [後端 README](backend/README.md) |
| FAQ 快取、影片與片段綁定、YouTube 權限 | [API 契約](backend/docs/phase2-api-contract.md) |
| STT 整合與處理狀態機 | [STT 整合流程](backend/docs/stt-integration.md) |
| 功能開關 | [功能開關](backend/docs/feature-flags.md) |
| 技術限制與交接注意 | [後端注意事項](backend/docs/handoff-known-issues.md) |
| 部署、nginx、憑證與連線排錯 | [部署與連線排錯](docs/10_Operations/deployment/部署與連線排錯.md) |

改功能時檢查是否要同步：根 README、[目前狀態](docs/current-status.md)、[後端技術索引](backend/docs/current-state.md)、OpenAPI、`backend/.env.example` 與各服務 README。
