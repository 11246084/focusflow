# recut 與逐字稿升級的 chunk 版本契約

這份契約說明影片逐字稿重新處理之後，recut 怎麼繼續安全地引用逐字稿片段。多模態工作會讓後端自動升級舊影片的逐字稿，而 recut 存有 `chunkId`；先定好契約，兩邊才能並行開發。recut 的 agent 實作前先讀這份，依「recut 要做的事」調整程式。

決策來源：[多模態決策](../Multimodal_Retrieval/decisions.md) RU、RC、MB（2026-10-31 Weihao 定案）。

## 為什麼需要

**chunk** 是逐字稿切出的小片段，存在 `video_segments_text`，`chunkId` 依順序編號，格式是 `<videoId>_chunk_<NNNN>`（[chunking.py](../../../STT_Whisper/src/chunking.py) `_build_chunk_record`）。影片換 Whisper 設定或切段規則重新處理後，**同一個編號會被不同內容重新使用**：舊引用不會變成「找不到」，而是悄悄指到另一段文字。

例：升級前 `v1_chunk_0042` 是「全聯先生的廣告」（312～326 秒）；新規則切得比較長，升級後 `v1_chunk_0042` 變成 540～566 秒的另一段。recut 若用舊的 `chunkId` 回查，會拿到錯的原文與時間。

編號格式不能改：鄰近片段擴展（[leafContextSelection.service.js](../../../backend/src/services/leafContextSelection.service.js)）與教師統計（[teacherStats.service.js](../../../backend/src/services/teacherStats.service.js)）都依格式拼出 `chunkId`。

2026-10-31 查證的現況：

| 資料 | 存什麼 | 升級後 |
|---|---|---|
| `questions` 的命中片段 | 影片 ID、起訖秒數、`segmentId` | 秒數快照，不受影響 |
| `shortScripts` 的凍結證據（`dev`） | `chunkId`、影片、起訖秒數、`rawText` | 已是快照，model 註解寫明「不是參照」 |
| `RecutSource`（`feat/recut`） | 絕對秒數、句子與逐字時間、`hitChunkIds`、句子的 `chunkIds` | 內容是快照，但 `chunkId` 升級後可能指到別段 |
| recut 剪輯計畫 | `clips[].chunkIds` 與錨點（`recutState.service.js`） | 同上，要確認凍結後是否回查目前的 chunk |

## 契約

| # | 規則 | 負責 |
|---|---|---|
| C1 | `chunkId` 格式 `<videoId>_chunk_<NNNN>` 不變 | 多模態 |
| C2 | `video_segments_text` 與 `video_segments_parent` 每筆帶 `transcriptVersion`（字串，只比對是否相同，不解讀內容）；影片記錄 `videos.activeTranscriptVersion`。沒有這個欄位的舊資料一律視為 `legacy` | 多模態寫入 |
| C3 | 升級以一支影片為單位：新 chunk 先在本機產生並驗證，再在一個資料庫交易內刪掉該影片的舊 chunk 與 Parent、寫入新的、更新 `activeTranscriptVersion`，最後清除該課程的 FAQ 快取。新舊兩版不會同時存在 | 多模態 |
| C4 | 升級前列出仍引用該影片的資料（`shortScripts`、`recutSources`、`clips` 等）；有引用就停下來找 Weihao，不自行刪除或改寫 recut 的資料 | 多模態 |
| C5 | 任何功能需要日後再引用 chunk 時，一律存快照（影片 ID、起訖秒數、原文），並記下當時的 `transcriptVersion`。之後只在記錄的版本等於影片目前的 `activeTranscriptVersion` 時，才回查目前的 chunk；版本不同就用快照，或標示「來源已更新，需要重新凍結」 | recut 與其他引用 chunk 的功能 |
| C6 | 引用 chunk 的功能不寫入 `video_segments_text`、`video_segments_parent` | 所有功能 |

例：recut 在 `activeTranscriptVersion = "legacy"` 時凍結 `RecutSource`，記下 `transcriptVersion: "legacy"`。之後影片升級成 `"2026-11-whisper-small"`，教師再打開這份腳本 → recut 比對版本不同 → 用快照裡的原文與秒數顯示，並標示「來源已更新，需要重新凍結」；教師按重新凍結時，才用新版本的 chunk 重新檢索。

## recut 要做的事

1. 盤點凍結之後還會用 `chunkId` 回查 `video_segments_text` 或 `video_segments_parent` 的程式，至少檢查 `recutSource.service.js`、`recutState.service.js` 與審閱 API。
2. 在 `RecutSource` 與 `shortScripts` 的凍結證據加上 `transcriptVersion`，凍結時寫入影片當下的 `activeTranscriptVersion`（沒有就寫 `legacy`）。
3. 回查前比對版本，不同就依 C5 用快照或標示需要重新凍結；畫面上的文案由 recut 決定。
4. 測試至少涵蓋：版本相同時回查；版本不同時不回查、改用快照；舊資料沒有欄位時當成 `legacy`。

多模態那邊的欄位名稱與寫入時機以本契約為準；任何一方要改契約，先找 Weihao，改完同步更新本文件與[多模態決策](../Multimodal_Retrieval/decisions.md) RC。
