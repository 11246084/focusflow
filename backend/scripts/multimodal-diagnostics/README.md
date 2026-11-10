# 多模態資料唯讀診斷

此工具使用既有後端 `.env`，查詢 AI入門課程六支影片的 chunk、文字向量統計與 Atlas 搜尋索引。獨立使用 MongoDB driver，沿用 repo 的 env loader 與向量契約比較函式，執行完關閉連線。

## 執行

從 repo 根目錄執行，先使用支援版本的 Node 與已安裝的 backend 依賴。

```powershell
. .\.local-tools\activate.ps1
node backend/scripts/multimodal-diagnostics/run.js
```

預設輸出 `.local-tools/multimodal-diagnostics/atlas.json`。此目錄在本機 Git 排除清單，其他 checkout 應自行使用忽略目錄保存輸出。可用 `--output "本機路徑/atlas.json"` 改位置。原始報告留在本機，對外摘要只保留已核對的結構與統計。

## 查詢範圍

- 課程固定 `6a6da68456dd124511ec5196`，影片 ID 固定使用 HANDOFF 的六支。
- 讀取 `courses`、`videos`、設定的 Leaf／Parent collection，以及 Leaf 的 `$listSearchIndexes`。
- chunk 查詢包含六支影片的 canonical ID、影片別名與課程 ID，便於發現本課程範圍內無法對上影片的記錄。
- 每次查詢最多 15 秒，Leaf／Parent 各取最多 5001 筆。超過 5000 筆標記 truncated，結果只能視為部分檢查。影片最多 51 筆，超過 50 筆同樣標記部分檢查。
- 向量在資料庫端計算型別、維度、有效數值數量及平方範數，回傳結果省略完整向量與逐字稿。
- 查詢使用 `$match`、`$limit`、`$project` 與 `$listSearchIndexes`。工具未載入 Model、app、server，沒有 migration、排程、模型或索引寫入流程。

所有讀取仍受現有帳號權限限制。索引權限不足會記錄 section 與錯誤代碼，結束碼為 1，保留成功取得的資料；主要查詢失敗時輸出通用錯誤與代碼。錯誤訊息不包含 provider／MongoDB 原始錯誤全文。工具未新增資料庫權限。

## 解讀限制

`atlas` 是當次資料庫實查，`localCode` 是本機設定與程式契約。正式站是否使用相同設定仍須查正式 runtime。`incompleteMetadata` 表示無法完整驗證，`incompatibleDeclaredMetadata` 表示已存在的 metadata 與本機契約衝突，兩者可同時發生。3072 維與接近單位長度無法證明產生模型。

排序統計按影片與 `startSec` 檢查，重疊區間不自動視為錯誤。重複 ID、Parent 引用與版本統計只限本次查詢範圍，缺少版本欄位時無法排除曾經原地替換資料。`queryable=true` 是索引服務狀態，本工具尚未執行向量命中測試。

```powershell
node --test backend/tests/multimodal-diagnostics.script.test.js
```
