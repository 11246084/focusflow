---
name: mongodb-inspect
description: 連線並查證 FocusFlow 的 MongoDB Atlas（focusflow database）。用於檢查 collection、index、vector search index 狀態、資料完整性 preflight、explain 效能驗證，以及 QA bridge / Parent-Child 資料流的實查。當任務涉及「查 DB 現況」「建索引前檢查」「explain 走不走索引」「Atlas index 是否 READY」「片段對不到影片」時使用。
---

# mongodb-inspect

## 目的

FocusFlow 的 DB 狀態**不能靠文件推論**，必須實查。本 skill 提供固定的連線方式、collection 地圖、已知陷阱與查證流程，避免每次重新摸索或憑舊文件斷言。

## 連線方式

優先使用 **MongoDB MCP server**，已預先設定好連線：

- `connectionId`: `"preconfigured"`
- `database`: `"focusflow"`

所有 MCP 工具（`mcp__mongodb__*`）都要帶這兩個參數。**不需要也不應該**去讀 `backend/.env` 取 URI，更不要把 URI 或憑證輸出到回覆、log 或文件裡。

MCP 工具若未載入，先用 ToolSearch 一次抓齊常用的：

```
select:mcp__mongodb__collection-indexes,mcp__mongodb__aggregate,mcp__mongodb__count,mcp__mongodb__explain,mcp__mongodb__find,mcp__mongodb__list-collections,mcp__mongodb__create-index
```

### 直連的已知限制

從 Claude Code 的 shell 直接跑 Node 腳本連 Atlas 會失敗：SRV DNS 查詢被阻擋（`querySrv ECONNREFUSED _mongodb._tcp.*`）。`dangerouslyDisableSandbox` 也救不了。

代表：**任何需要真正跑 backend service 連 live DB 的驗證，都不能在這裡完成**。可行作法二選一：

1. 用 MCP 對 live 執行查詢，把回傳文件餵給真實的 service function 重放（邏輯是 production code，只有傳輸層不同）——回報時必須據實說明這個差異。
2. 把腳本寫好，交給使用者在自己的環境執行。

## Collection 地圖

`focusflow` database，17 個 collection。

| Collection | 用途 |
|------------|------|
| `users` / `courses` / `enrollments` / `videos` | App 主資料 |
| `video_segments_text` | **Leaf**：逐字稿片段 + text embedding（3072 維） |
| `video_segments_parent` | **Parent**：Phase 2-2 階層檢索的上層片段 |
| `video_segments_audio` / `video_segments_video` | 預留 / legacy，**不是**正式 multimodal QA source |
| `transcripts_normalized` | Pipeline 正規化逐字稿 |
| `questions` / `usage_logs` / `faqs` | QA 紀錄、用量、FAQ 快取 |
| `clips` / `shortassets` / `term_dictionary` / `notifications` / `line_bind_tokens` | 其餘功能 |

Leaf collection 名稱由 `VIDEO_SEGMENT_COLLECTION` 環境變數決定，預設 `video_segments_text`。查之前先確認實際值。

## 已知陷阱（踩過的）

### 1. 欄位命名混雜 camelCase / snake_case

`video_segments_text` 的**正式欄位是 camelCase**（`videoId`、`chunkId`、`segmentId`、`courseId`、`startSec`、`endSec`、`text`、`embedding`）。Pipeline 的其他 collection（`transcripts_normalized`、`video_segments_audio`、`video_segments_video`）仍用 snake_case（`video_id`、`clip_id`）。不要假設一致。

`database/tools/setup/init_indexes.js` 歷史上留過 snake_case 的 Leaf 索引定義，與實際查詢對不上。改動索引時要順手確認 bootstrap 與 live 一致。

### 2. app-owned 影片沒有 `videoId` 欄位

QA bridge contract：

```text
course.videoIds -> videos._id | videos.videoId | videos.video_id -> video_segments_text.videoId
```

實務分佈：

- **app-owned 影片**：`videos.videoId` 是 `undefined`，pipeline 把 `String(videos._id)` 寫進片段的 `videoId`
- **只有 pipeline metadata 影片**才有 `videoId` / `video_id`

所以 join 片段時要用 `String(videos._id)`，用 `videos.videoId` 會讓 app-owned 影片全部對不到。

### 3. Leaf 文件可能沒有 `courseId`、`segmentId` 為 null

實查過的一批 Leaf：**沒有 `courseId` 欄位**、`segmentId` 是 `null`、只有 `videoId`。代表 scope 過濾的 `courseId` 條件對這批資料不成立，實際只有 `videoId` 那條會命中。設計查詢或解讀 explain 時要記得。

### 4. Vector index 狀態必須實查

不要憑文件斷言 Atlas vector index 存不存在——歷史上同一個 index 被記載過「不存在」也被記載過「READY」。一律用 `collection-indexes` 看 `searchIndexes` 的 `status` 與 `queryable`。

截至最近一次實查：

| Collection | Vector index | 狀態 |
|------------|-------------|------|
| `video_segments_text` | `text_embedding_index` | READY / queryable，3072 維，filter: `courseId`、`videoId` |
| `video_segments_parent` | `parent_embedding_index` | READY / queryable，3072 維，filter: `courseId`、`videoId` |

## 常用流程

### A. 看 collection 現況

```
mcp__mongodb__list-collections   → 有哪些 collection
mcp__mongodb__collection-indexes → classic index + vector index 狀態（一次看完）
mcp__mongodb__collection-schema  → 推斷欄位形狀
mcp__mongodb__find (limit 1)     → 看一筆真實文件，確認欄位真的存在
```

`collection-schema` 是抽樣推斷，**不要當成契約**。要確認某欄位是否存在，用 `find` 看實際文件，或用 aggregate 統計。

### B. 建索引前的 preflight

建任何索引（尤其 unique）之前，一定先確認欄位完整性與重複值。單一 aggregate 就能一次算完：

```js
[
  { $group: {
      _id: null,
      total: { $sum: 1 },
      missing:  { $sum: { $cond: [{ $eq: [{ $type: "$<field>" }, "missing"] }, 1, 0] } },
      nullish:  { $sum: { $cond: [{ $eq: [{ $type: "$<field>" }, "null"] }, 1, 0] } },
      empty:    { $sum: { $cond: [{ $eq: ["$<field>", ""] }, 1, 0] } },
      nonString:{ $sum: { $cond: [{ $and: [
                    { $ne: [{ $type: "$<field>" }, "missing"] },
                    { $ne: [{ $type: "$<field>" }, "string"] }] }, 1, 0] } },
      distinctValues: { $addToSet: "$<field>" }
  } },
  { $project: { _id: 0, total: 1, missing: 1, nullish: 1, empty: 1, nonString: 1,
                distinct: { $size: "$distinctValues" } } }
]
```

重複值另外查：

```js
[
  { $group: { _id: "$<field>", count: { $sum: 1 } } },
  { $match: { count: { $gt: 1 } } },
  { $count: "duplicateGroups" }
]
```

有 missing / null / 空字串 / 型別不符 / 重複 → **不要建 unique index**，停下來回報。

### C. explain 效能驗證

用 `mcp__mongodb__explain`，`verbosity: "executionStats"`。回報時固定看這幾項：

- winning plan 的 stage（IXSCAN vs COLLSCAN）
- `indexName` / `keyPattern`
- `totalKeysExamined`、`totalDocsExamined`、`nReturned`、`executionTimeMillis`
- `rejectedPlans`（能證明 planner 主動改選了新索引）

判準：`totalDocsExamined` 應該接近 `nReturned`。差一個數量級以上就是有問題。

**要驗真實查詢就要抄真實查詢形狀**，不要自己編一個簡化版。查詢形狀去 service 層找，例如 Child Expansion 的形狀在 `backend/src/services/childExpansion.service.js` 加上 `bridgeScope.service.js` 的 `buildSegmentLookupQuery`。

建索引前後各跑一次，才有前後對照。

### D. 建索引

```
mcp__mongodb__create-index
  definition: [{ "type": "classic", "keys": { "<field>": 1 } }]
  name: "<field>_1"
```

`createIndex` 本身是 idempotent，重複建同樣定義是 no-op。

建完務必再跑一次 `collection-indexes` 留存「建立後」狀態，並重跑 explain 確認 planner 真的改用了。

## 安全規則

這是**共用的 production Atlas**，不是本機測試庫。

- 預設只做讀取操作。
- 建索引是加法、可回復，屬可接受範圍；**drop index、改資料、改 validator、drop collection 一律先問**。
- 不得修改 vector index 定義。
- 不得輸出 MongoDB URI、憑證、完整逐字稿、embedding 向量。
- 回報數字要用實查結果，不要引用舊文件的數字。

## 回報格式

DB 查證任務的回報至少包含：

1. 查了什麼（collection、查詢形狀）
2. 實際數字（不是「大致上」）
3. 改了什麼（index name、key pattern、unique/sparse/partial 設定）
4. 改動前後對照（listIndexes、explain）
5. 沒做什麼（明確列出未執行的破壞性操作）
6. 哪些部分無法在此環境驗證，以及實際採用的替代作法
