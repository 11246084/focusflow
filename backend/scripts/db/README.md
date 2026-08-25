# MongoDB 查詢工具

一支命令列工具，直接連 FocusFlow 的 MongoDB Atlas 做查詢。不用開 Compass，也不用寫一次性的腳本。

**預設唯讀**——`eval` 指令偵測到寫入操作會直接擋下，要明確加參數才放行。

---

## 前置準備

### 1. 安裝相依套件

```powershell
cd focusflow\backend
npm install
```

用到的 `mongoose` 與 `dotenv` 都已經在 `package.json` 裡，不用另外裝。

### 2. 準備 `backend/.env`

**`.env` 不進版控**，git pull 不會帶下來，必須自己放。

跟組員拿共用的那份，放到 `backend/.env`。裡面至少要有 `MONGODB_URI` 這一行。

如果要從範本開始：

```powershell
Copy-Item .env.example .env
```

然後填入 `MONGODB_URI`。

### 3. 驗證

```powershell
node scripts/db/mongo.js ping
```

看到這樣就成功了：

```
連線中：mongodb+srv://11246084:***@focusflow.gw8l4ke.mongodb.net/...
已連線。

{
  "database": "focusflow",
  "host": "ac-jzhny0c-shard-00-01.gw8l4ke.mongodb.net:27017",
  "version": "8.0.29",
  "collections": 20,
  "objects": 2496,
  "dataSizeMB": 70.83
}
```

> 不用先 `cd backend` 也可以。腳本會用絕對路徑找 `backend/.env`，從 repo 根目錄執行同樣有效：
> `node backend/scripts/db/mongo.js ping`

---

## 指令一覽

| 指令 | 用途 |
|------|------|
| `ping` | 確認連得上，顯示資料庫大小與版本 |
| `collections` | 列出所有 collection 與筆數 |
| `count <collection> [filter]` | 計數 |
| `find <collection> [filter] [limit]` | 查詢文件（預設 5 筆） |
| `sample <collection>` | 隨機抽一筆，看欄位長怎樣 |
| `indexes <collection>` | 一般索引 |
| `search-indexes [collection]` | Atlas Search / Vector index 與狀態 |
| `eval "<js>"` | 執行任意查詢 |

`--help` 可以隨時叫出說明：

```powershell
node scripts/db/mongo.js --help
```

---

## 常用範例

**看整個資料庫有什麼**

```powershell
node scripts/db/mongo.js collections
```

```
video_segments_text         1651
usage_logs                   450
questions                    244
videos                        32
...
共 20 個 collection。
```

**不知道欄位長怎樣時，先抽一筆看看**

```powershell
node scripts/db/mongo.js sample video_segments_text
```

輸出最後會列出所有欄位名稱。`embedding` 這種 3072 維的向量會自動顯示成 `<3072 維向量，已省略>`，不會洗版。

**用 ObjectId 過濾**

filter 裡可以用 `{"$oid":"..."}` 表示 ObjectId、`{"$date":"..."}` 表示日期：

```powershell
node scripts/db/mongo.js count questions '{\"courseId\":{\"$oid\":\"6a6da68456dd124511ec5196\"}}'
```

**查詢文件**

```powershell
node scripts/db/mongo.js find courses '{\"status\":\"published\"}' 5
```

**確認 Atlas 向量索引是不是真的建好了**

```powershell
node scripts/db/mongo.js search-indexes video_segments_text
```

```
=== video_segments_text ===
  text_embedding_index  type=vectorSearch  status=READY  queryable=true
    path=embedding dims=3072 similarity=cosine
```

> 這條很重要。專案規範明訂 Atlas 向量索引的狀態要**實查為準**，不能憑文件或 `.env` 斷言。`status` 不是 `READY` 的話，QA 的 atlas 模式會直接 fail-fast。

**任意查詢**

`db`、`mongoose`、`ObjectId` 三個變數可以直接用：

```powershell
node scripts/db/mongo.js eval "await db.collection('questions').countDocuments({status:'answered'})"
```

多行或複雜一點的也可以，記得要有 `return`：

```powershell
node scripts/db/mongo.js eval "const c = await db.collection('videos').find({}).limit(3).toArray(); return c.map(v => v.title)"
```

---

## 安全機制

### `eval` 預設擋寫入

程式碼裡出現 `insert`、`update`、`delete`、`drop`、`createIndex` 這類字眼會被擋下來，而且**在連線之前就擋**：

```powershell
node scripts/db/mongo.js eval "await db.collection('faqs').deleteMany({})"
```

```
錯誤：這段程式碼看起來包含寫入操作，預設被擋下。
確認要執行請加上 --allow-write，並先確認你連的是哪個資料庫。
```

真的要執行才加參數：

```powershell
node scripts/db/mongo.js eval "await db.collection('faqs').deleteMany({})" --allow-write
```

**這是共用的正式資料庫，動手前先確認影響範圍。**

### 密碼自動遮蔽

輸出的連線字串是 `mongodb+srv://11246084:***@...`，截圖或貼給別人時不會外洩密碼。

### 不要把這兩個檔案傳出去

| 檔案 | 為什麼 |
|------|--------|
| `backend/.env` | 含資料庫帳密明文 |
| `.mcp.json` | 同上 |

兩個都在 `.gitignore` 裡，git 不會帶走。但用 LINE、Discord 傳就等於留在聊天紀錄裡。

---

## 常見錯誤

### `querySrv ECONNREFUSED`

DNS 層問題，**不是帳密錯誤**。`mongodb+srv://` 需要先做 DNS SRV 查詢才知道主機位址，校網、VPN、某些 ISP 的 DNS 會擋掉這類查詢。

腳本會**自動改用公用 DNS（1.1.1.1 / 8.8.8.8）重試一次**，通常就會通，並且會告訴你：

```
SRV 查詢失敗，改用公用 DNS 重試：1.1.1.1, 8.8.8.8
（靠公用 DNS 才連上——代表你的預設 DNS 擋了 SRV 查詢）
```

還是不行的話，指定其他 DNS：

```powershell
$env:MONGO_DNS_SERVERS="168.95.1.1"; node scripts/db/mongo.js ping
```

> 注意：backend 本身（`npm run dev`）**沒有**這層 fallback。如果腳本要靠公用 DNS 才連得上，backend 在同一個網路下也會連不上 Atlas，錯誤訊息一樣。根本解法是把 `.env` 的 `MONGODB_URI` 換成非 SRV 的連線字串（Atlas 介面上可以複製到，格式是直接列出三台 shard 主機的 `mongodb://`）。

### `ServerSelectionTimeoutError`

跟上面不一樣，這通常是**你的 IP 不在 Atlas 的 Network Access 白名單**。請組員到 Atlas → Network Access 把你的 IP 加進去。

### `找不到 .../backend/.env`

`.env` 沒放好。回到「前置準備」第 2 步。

### `filter 不是合法的 JSON`

PowerShell 的引號處理容易出錯。JSON 用雙引號、外層用單引號，內層雙引號跳脫：

```powershell
node scripts/db/mongo.js count faqs '{\"courseId\":{\"$oid\":\"...\"}}'
```

---

## 進階：讓 Claude Code 也能直接查

這支腳本是給你在終端機用的。如果想讓 Claude 直接查資料庫（不用你複製貼上），那是另一套機制：專案根目錄的 `.mcp.json`。

這個檔案**在 `.gitignore` 裡，不會跟著 git 下來**，要跟組員拿一份放到 repo 根目錄。放好之後 Claude Code 會詢問是否啟用這個專案的 MCP server，同意即可。

兩者可以並存，用途不同：

- **腳本** — 你自己查、寫進文件、貼進報告
- **MCP** — 讓 Claude 在回答問題時自己去查證

---

## 相關文件

- [`.claude/skills/mongodb-inspect/SKILL.md`](../../../.claude/skills/mongodb-inspect/SKILL.md) — 資料庫查證的專案規範
- [`.claude/rules/database.md`](../../../.claude/rules/database.md) — Schema、索引、資料存取規範
