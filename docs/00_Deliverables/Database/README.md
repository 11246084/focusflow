# FocusFlow 資料庫交付與還原說明

本文件對應校方繳交項目 (3)「資料庫 MDF 與 LDF 檔」。FocusFlow 使用 MongoDB，沒有 SQL Server 的 MDF／LDF 檔案，因此改交一份可驗證、可還原的 MongoDB 資料庫交付包。替代方式是否被接受，以指導老師與最新公告為準。

> 狀態（2026-10-07）：匯出與還原腳本已完成，並通過 in-memory 測試（`backend/tests/database-deliverable.service.test.js`）。撰寫時本機無法連線資料庫，**尚未對真實 MongoDB／Atlas 實際匯出或還原**。第一次實跑後，請在本節補上日期、資料庫與結果。

## 1. 與 MDF／LDF 的對照

| SQL Server | 用途 | FocusFlow 交付包 |
|---|---|---|
| `.mdf` 主資料檔 | 資料表結構與資料 | `collections/*.ejson.gz`：每個 collection 一個檔，內容為 canonical Extended JSON，保留 ObjectId、Date、Int32、Double、Binary 等型別 |
| `.ldf` 交易紀錄檔 | 交易紀錄，用於還原 | 不需要。交付包是一致的完整匯出，還原不需要重播交易紀錄 |
| 資料表結構、索引 | schema、index | `manifest.json`：collection options、一般索引、Atlas Search／Vector 索引定義 |
| 附加資料庫（Attach） | 還原 | `npm run db:restore-deliverable` |

## 2. 交付包內容

```text
focusflow-db-<時間>/
├── manifest.json            ← 匯出時間、commit、各 collection 筆數、SHA-256、索引定義
├── 還原說明.md               ← 本文件的副本（匯出時自動複製）
└── collections/
    ├── users.ejson.gz
    ├── courses.ejson.gz
    ├── videos.ejson.gz
    ├── video_segments_text.ejson.gz   ← 含 3072 維 embedding
    └── …（來源資料庫的其他 collection）
```

匯出規則：

- 匯出來源資料庫的所有 collection，`system.*` 和 view 除外。
- 預設排除 `line_bind_tokens`（LINE 一次性綁定 token），可用 `--exclude` 再加。
- `users.passwordReset`（忘記密碼驗證碼雜湊）一律移除；`passwordHash` 保留，否則還原後無法登入。
- 來源有非 `@focusflow.local` 帳號或已綁 LINE 的帳號時，預設**拒絕匯出**（見第 3 節）。

不在交付包內的東西：

- 教師上傳的影片原始檔（`backend/uploads/`）。問答所需的逐字稿片段與 embedding 已在資料庫內，不重跑 pipeline 也能問答；要重新處理影片或重新上傳 YouTube，才需要原始檔。
- 已上傳 YouTube 的影片本身。
- `.env` 裡的秘密值（Gemini API key、JWT secret、LINE、YouTube OAuth、SMTP）。這些不放進交付包，另行安全交接。

## 3. 匯出（組員操作）

### 3-1 準備示範資料庫

**不要直接匯出正式資料庫。** 2026-09-21 開放學生試用後，正式資料庫有真實學生的帳號、Email、提問紀錄與 LINE userId，而這個 repo 是公開的。

建議做法：

1. 準備一個空的資料庫，擇一：
   - 本機 MongoDB：`mongodb://127.0.0.1:27017/focusflow_deliverable`
   - 同一個 Atlas cluster 的新 database：連線字串的 database 名稱改成 `focusflow_deliverable`
2. 讓 backend 與 STT pipeline 都指向這個資料庫（`backend/.env` 和 `STT_Whisper/.env` 的連線字串都要改），然後建立示範帳號與課程：

   ```powershell
   cd backend
   npm run seed
   ```

3. 用示範教師帳號登入前端，上傳幾支示範影片，等處理完成（`processing.status = completed`）。
4. 若要用 Atlas 向量檢索，先在這個 database 建好 `text_embedding_index`（定義見第 5 節），匯出時才會一併記錄。
5. 用示範學生帳號問幾題，確認能回答並附時間戳。

### 3-2 執行匯出

```powershell
cd backend
npm run db:export-deliverable
```

- 來源連線預設讀 `backend/.env` 的 `MONGODB_URI`；要匯出別的資料庫，先設定 `EXPORT_MONGODB_URI`：

  ```powershell
  $env:EXPORT_MONGODB_URI = "mongodb://127.0.0.1:27017/focusflow_deliverable"
  npm run db:export-deliverable
  ```

- 預設輸出到 `backend/tmp/database-deliverable/focusflow-db-<時間>/`（`tmp/` 已被 `.gitignore` 排除）。可用 `--out <資料夾>` 指定，資料夾必須不存在或是空的。
- 匯出只讀不寫，不會修改來源資料庫。

| 參數 | 說明 |
|---|---|
| `--out <dir>` | 輸出資料夾 |
| `--exclude a,b` | 另外排除的 collection（會加在 `line_bind_tokens` 之外） |
| `--allowed-email-domains a,b` | 視為示範帳號的 Email 網域，預設 `focusflow.local` |
| `--allow-real-users` | 來源含真實帳號仍匯出。只有在資料已去識別化、且經指導老師同意時才使用 |

匯出完成會印出各 collection 的筆數、檔案大小與向量索引名稱。

### 3-3 繳交前檢查

```powershell
npm run db:restore-deliverable -- --from tmp/database-deliverable/focusflow-db-<時間> --verify-only
```

`--verify-only` 不連資料庫，只核對每個檔案的 SHA-256。看到 `"success": true` 後，把整個 `focusflow-db-<時間>` 資料夾壓縮後上傳 FTP。**交付包不要 commit 進 repo。**

## 4. 還原（評審或安裝時操作）

### 4-1 需要的環境

- Node.js（開發時使用 v22）
- FocusFlow 原始碼，並在 `backend/` 執行過 `npm install`
- 一個空的 MongoDB 資料庫，擇一：
  - **MongoDB Community Server**（本機）：資料可完整還原，但不支援 Atlas 向量索引，問答改用 memory 模式（見 4-4）
  - **MongoDB Atlas**：可還原向量索引，與正式環境相同

### 4-2 驗證交付包

```powershell
cd backend
npm run db:restore-deliverable -- --from <交付包資料夾> --verify-only
```

### 4-3 還原

在 `backend/.env` 設定目標資料庫，或用 `RESTORE_MONGODB_URI` 臨時指定：

```powershell
$env:RESTORE_MONGODB_URI = "mongodb://127.0.0.1:27017/focusflow"
npm run db:restore-deliverable -- --from <交付包資料夾> --target-db focusflow
```

腳本依序：

1. 核對 `manifest.json` 與每個檔案的 SHA-256，不符就停止，不寫入任何資料。
2. 檢查目標資料庫：交付包內任一 collection 在目標已有資料時，未加 `--drop` 就拒絕寫入。
3. 建立 collection、寫入資料、重建一般索引（含 unique、sparse、partial 索引）。
4. 依 manifest 建立 Atlas Search／Vector 索引。
5. 逐一核對還原後的筆數，與 manifest 不符時結束碼為 1。

| 參數 | 說明 |
|---|---|
| `--from <dir>` | 交付包資料夾（必填） |
| `--target-db <name>` | 必須等於連線字串中的 database 名稱，用來確認寫入對象 |
| `--drop` | 目標已有同名 collection 時先刪除再還原。**會刪除目標資料，確認目標不是正式資料庫才使用** |
| `--skip-search-indexes` | 不建立 Atlas Search／Vector 索引 |
| `--verify-only` | 只驗證檔案，不連資料庫 |

輸出中每個 collection 的 `expected` 與 `restored` 應相同。`searchIndexes` 欄位的狀態：

| 狀態 | 意義 |
|---|---|
| `requested` | Atlas 已接受建立請求。索引需要幾分鐘建置，狀態變成 `READY` 前，atlas 模式的問答會失敗 |
| `failed` | 目標不支援（本機 MongoDB Community 屬預期情況），改用 memory 模式 |
| `skipped` | 使用了 `--skip-search-indexes` |

### 4-4 設定問答模式並啟動

**目標是 Atlas**（索引 `READY` 後）：

```env
QA_QUERY_EMBEDDING_PROVIDER=gemini
QA_VECTOR_SEARCH_MODE=atlas
QA_ATLAS_VECTOR_INDEX_NAME=text_embedding_index
QA_ANSWER_PROVIDER=gemini
GEMINI_API_KEY=<另行交接>
```

**目標是本機 MongoDB Community**：

```env
QA_QUERY_EMBEDDING_PROVIDER=gemini
QA_VECTOR_SEARCH_MODE=memory
QA_ANSWER_PROVIDER=gemini
GEMINI_API_KEY=<另行交接>
```

memory 模式由 backend 自行計算片段與問題向量的相似度。沒有 Gemini API key 時可改 `QA_QUERY_EMBEDDING_PROVIDER=mock`、`QA_ANSWER_PROVIDER=template`：系統仍可操作，但向量維度對不上，檢索會退回關鍵字比對，回答為範本文字，不代表正式問答品質。

啟動並檢查：

```powershell
npm start
curl http://localhost:4000/health
```

`/health` 回應的 `data.runtime.qa.readyForAsk` 應為 `true`。示範帳號由 `npm run seed` 建立，帳號與密碼見 `backend/src/services/demoSeed.service.js` 的 `DEMO_USERS`。

## 5. 向量索引定義

交付包會記錄來源資料庫實際存在的 Atlas Search／Vector 索引。來源是本機 MongoDB 時沒有這些索引，需要在 Atlas 手動建立。`text_embedding_index` 的定義以 2026-09-08 對共享 Atlas 的實查為準（`docs/30_Features/Student_Pilot_Backend/evidence/2026-09-08_g2-atlas-contract-inventory.json`）：

- Collection：`video_segments_text`
- 索引名稱：`text_embedding_index`
- 類型：Vector Search

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 3072, "similarity": "cosine" },
    { "type": "filter", "path": "courseId" },
    { "type": "filter", "path": "videoId" }
  ]
}
```

影像片段與階層式檢索的索引有專用腳本：`npm run db:ensure-video-vector-index`、`npm run db:ensure-parent-storage`。這兩項功能預設關閉，試用版不需要。

## 6. 沒有 Node.js 時的替代還原方式

交付包解壓後，每一行是一筆 canonical Extended JSON 文件，可用 MongoDB Database Tools 的 `mongoimport` 逐個 collection 匯入：

```powershell
mongoimport --uri "mongodb://127.0.0.1:27017/focusflow" --collection users --file users.ejson
```

`.ejson.gz` 要先用 7-Zip 等工具解壓成 `.ejson`。這種方式**不會建立索引**，也不會核對 checksum 和筆數。unique 索引要依 `manifest.json` 的 `indexes` 手動建立，所以優先使用 4-3 的還原腳本。
