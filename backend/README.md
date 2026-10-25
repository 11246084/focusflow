# FocusFlow 後端安裝與使用

這份文件說明如何啟動 FocusFlow 後端，供網頁與 LINE 呼叫。請先設定自己的資料庫，再啟動服務；功能進度及驗收結果只看[目前狀態](../docs/current-status.md)。

## 安裝與設定

使用 Node.js 22.23.4 以上、npm 10 以上；版本理由與檢查方式見[根 README 環境需求](../README.md#環境需求)。從 repo 根目錄執行：

```powershell
cd backend
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

`.env` 是程序讀取的環境設定檔。啟動前編輯下列項目；更多設定見[範例檔](.env.example)：

| 設定 | 本機操作 |
|---|---|
| `MONGODB_URI` | 指向自己的資料庫，例如 `mongodb://127.0.0.1:27017/focusflow_local`。 |
| `JWT_SECRET` | 設定自行產生的隨機密鑰，用於驗證登入憑證。 |
| `PROCESSING_WEBHOOK_SECRET` | 設定影片處理回報的密鑰，與 Pipeline 相同。 |
| `QA_QUERY_EMBEDDING_PROVIDER=mock`、`QA_ANSWER_PROVIDER=template`、`QA_VECTOR_SEARCH_MODE=memory` | 本機模擬問答設定；仍需資料庫，不代表真實模型效果。 |

Gemini、LINE 與 YouTube 的金鑰依要使用的功能填寫；不要把金鑰提交到 Git。後端連線使用 [Mongoose](src/config/database.js)（操作 MongoDB 的套件），啟動可能建立索引，請勿用共用 Atlas 驗證啟動。

## 啟動與操作

```powershell
npm.cmd run dev
```

開發模式會監看檔案變更；一般啟動用 `npm.cmd start`。預設服務在 `http://localhost:4000`，可讀取 `/health`，並由 `/docs` 查看 API（前端呼叫後端的介面）說明。

需要本機示範資料時，在確認 `MONGODB_URI` 後執行 `npm.cmd run seed`，此操作會寫入指定資料庫。例：空白本機資料庫 → 執行 seed → 以 `student@focusflow.local`／`Student123!` 登入；帳號定義見[種子資料](src/scripts/seedDemoUsers.js)。

## 資料工具與問答設定

下列指令會寫入 `MONGODB_URI` 指向的資料庫；指向共用 Atlas 時，先確認目標與授權。

| 指令 | 作用 |
|---|---|
| `npm.cmd run seed` | 把示範資料收斂到基準狀態，不清除既有資料 |
| `npm.cmd run seed:reset` | 保守清除示範帳號產生的資料後重建 |
| `npm.cmd run db:sync-atlas` | 把本機資料同步到 Atlas |
| `npm.cmd run db:ensure-questions` | 建立 `questions` 集合並同步索引 |
| `npm.cmd run db:backfill-questions` | 預設只預覽（dry-run），加 `-- --write` 才寫入 |

問答設定有幾個限制：`QA_ANSWER_PROVIDER=gemini` 必須設定 `GEMINI_API_KEY`，缺少時直接回設定錯誤，不會改用其他方式；`QA_VECTOR_SEARCH_MODE=atlas` 不能搭配 `QA_QUERY_EMBEDDING_PROVIDER=mock`。服務是否可用，看 `/health` 的 `runtime.qa`、`runtime.line`、`runtime.youtubeUpload`，不以 `.env` 有填值推定。

例：本機沒有金鑰 → 設定 `mock`／`template`／`memory` → `/health` 的 `runtime.qa` 顯示可用，但回答只是模擬結果。

測試、規格檢查與其他資料工具指令見 [package.json](package.json)；驗證方式依[測試規則](../.claude/rules/testing.md)選用。設定問題查[技術索引](docs/current-state.md)，操作文件查[文件入口](docs/README.md)。
