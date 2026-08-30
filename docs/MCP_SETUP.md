# 讓 Claude Code 直接查 MongoDB（MCP 設定）

設定完成後，你在 Claude Code 裡可以直接問：

> 「`video_segments_text` 現在有幾筆？」
> 「`text_embedding_index` 建好了嗎？狀態是什麼？」
> 「AI入門基礎課有哪幾支影片？」

Claude 會自己連資料庫查證，不需要你複製貼上結果。

---

## 這跟那支腳本有什麼不同？

專案裡有兩套東西，用途不一樣，可以並存：

| | 誰在用 | 檔案 |
|---|---|---|
| **查詢腳本** | **你**在終端機打指令 | `backend/scripts/db/mongo.js` |
| **MCP（本文件）** | **Claude** 自己去查 | `.mcp.json` |

本文件只講 MCP。腳本的用法見 [`backend/scripts/db/README.md`](../backend/scripts/db/README.md)。

---

## 設定步驟

### 1. 確認 Node.js 可用

MCP server 是用 `npx` 啟動的：

```powershell
node -v
npx -v
```

兩個都有版本號就沒問題。

### 2. 建立 `.mcp.json`

**位置：專案根目錄**，也就是跟 `README.md`、`package.json`、`.gitignore` 同一層：

```
focusflow\
├── .mcp.json          ← 放這裡
├── .mcp.json.example
├── backend\
├── frontend\
└── README.md
```

不是放在 `backend\` 裡，也不是放在 `.claude\` 裡。

從範本複製：

```powershell
Copy-Item .mcp.json.example .mcp.json
```

### 3. 填入連線字串

打開 `.mcp.json`，把 `MDB_MCP_CONNECTION_STRING` 換成真正的值：

```json
{
  "mcpServers": {
    "mongodb": {
      "command": "npx",
      "args": ["-y", "mongodb-mcp-server"],
      "env": {
        "MDB_MCP_CONNECTION_STRING": "mongodb://<帳號>:<密碼>@ac-xxxx-shard-00-00.xxxxx.mongodb.net:27017,ac-xxxx-shard-00-01.xxxxx.mongodb.net:27017,ac-xxxx-shard-00-02.xxxxx.mongodb.net:27017/focusflow?ssl=true&authSource=admin&replicaSet=atlas-xxxxxx-shard-0&retryWrites=true&w=majority",
        "MDB_MCP_READ_ONLY": "true"
      }
    }
  }
}
```

**連線字串跟組員拿**，不要自己拼。

> **重要：請用 `mongodb://` 開頭的「非 SRV」格式，不要用 `mongodb+srv://`。**
>
> `mongodb+srv://` 需要先做 DNS SRV 查詢才知道主機在哪，而校網、VPN、某些 ISP 的 DNS 會擋掉這類查詢，會出現 `querySrv ECONNREFUSED`。非 SRV 格式直接列出三台主機位址，不需要 SRV 查詢，在校網也能連。
>
> 非 SRV 字串可以在 Atlas 介面取得：Database → Connect → Drivers，把 Driver 版本切到 **Node.js 2.2.12 或更早**，顯示出來的就是非 SRV 格式。或者直接跟組員要現成的。

### 4. 重啟 Claude Code

`.mcp.json` 只在啟動時讀取，改完一定要完全關閉再重開。

### 5. 允許這個 MCP server

Claude Code 偵測到專案有 `.mcp.json` 時，會問你要不要啟用。選同意。

同意的紀錄會寫進 `.claude/settings.local.json` 的 `enabledMcpjsonServers`。這個檔案也在 `.gitignore` 裡，所以每個人都要自己同意一次。

### 6. 驗證

在 Claude Code 裡問：

> 「focusflow 資料庫有哪些 collection？各幾筆？」

連得上的話會看到類似這樣的結果：

```
video_segments_text   1651
usage_logs             450
questions              244
videos                  32
...
共 20 個 collection
```

---

## 為什麼設成唯讀

範本裡的 `MDB_MCP_READ_ONLY: "true"` 會讓這個 MCP server **只能讀，不能新增、修改、刪除**。

這是刻意的。共用的是正式資料庫，一個誤解的指令就可能清掉大家的資料。查證用唯讀就夠了；真的要改資料，用 `backend/scripts/db/mongo.js` 手動執行，那支腳本會強迫你加 `--allow-write` 明確確認。

如果之後真的需要寫入權限，把那一行改成 `"false"` 並重啟——但先想清楚。

---

## 常見問題

### Claude 說沒有 MongoDB 工具可用

依序檢查：

1. `.mcp.json` 是不是放在**專案根目錄**（不是 `backend\`）
2. 有沒有**完全重啟** Claude Code（不是開新對話，是關掉程式重開）
3. 開啟專案時有沒有**同意**啟用 MCP server
4. JSON 格式對不對——少一個逗號或引號整個檔案就失效

檢查 JSON 格式：

```powershell
node -e "JSON.parse(require('fs').readFileSync('.mcp.json','utf8')); console.log('JSON 格式正確')"
```

### `querySrv ECONNREFUSED`

連線字串用了 `mongodb+srv://`，而你的 DNS 擋了 SRV 查詢。換成非 SRV 格式，見步驟 3 的說明。

### 連線逾時（timeout）

你的 IP 不在 Atlas 白名單。請組員到 Atlas → **Network Access** → Add IP Address 把你的 IP 加進去。

這跟 DNS 問題不一樣：DNS 問題是「找不到主機」，白名單問題是「找得到但連不進去」。

### 第一次啟動很慢

`npx -y mongodb-mcp-server` 第一次要下載套件，慢是正常的，之後會用快取。

---

## 安全須知

`.mcp.json` **含有資料庫帳號密碼明文**。

- 它已經在 `.gitignore` 裡（第 169 行），不會被 commit，**不要手動 `git add` 它**
- 不要用 LINE、Discord、email 傳——會留在聊天紀錄裡
- 不要在螢幕分享或簡報時打開這個檔案
- 截圖前先確認畫面上沒有它

可以進版控的是 `.mcp.json.example`，裡面只有佔位符。

---

## 相關文件

- [`backend/scripts/db/README.md`](../backend/scripts/db/README.md) — 終端機查詢工具
- [`.claude/skills/mongodb-inspect/SKILL.md`](../.claude/skills/mongodb-inspect/SKILL.md) — 資料庫查證的專案規範
- [mongodb-mcp-server 官方文件](https://github.com/mongodb-js/mongodb-mcp-server)
