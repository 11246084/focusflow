# FocusFlow 後端安裝與使用

這份文件說明如何啟動 FocusFlow 後端，供網頁與 LINE 呼叫。請先設定自己的資料庫，再啟動服務；功能進度及驗收結果只看[目前狀態](../docs/current-status.md)。

## 安裝與設定

使用 Node.js 20.x（至少 20.19.0）或 22.12.0 以上、npm 10 以上；需求依據見[鎖定檔](package-lock.json)。從 repo 根目錄執行：

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

測試、規格檢查與資料工具指令見 [package.json](package.json)；驗證方式依[測試規則](../.claude/rules/testing.md)選用。設定問題查[技術索引](docs/current-state.md)，操作文件查[文件入口](docs/README.md)。
