# Phase 1 WO-01～WO-09 實作結果

| 項目 | 結果 |
|------|------|
| 日期 | 2026-08-30 |
| 規格版本 | v1.2 |
| 範圍 | Phase 1，WO-01～WO-09 |
| 分支 | `main` |
| 第一批 commit | `e4f1163 完成學生試用版後端第一批 fail-closed 隔離` |
| 第二批狀態 | 已實作並完成本機測試，尚未 commit／push |

> 本文件只證明程式實作與本機測試結果，不是附錄 I 的 12＋2 題 baseline 或 final 證據，也不代表 shared Atlas、Gemini、YouTube、LINE 或正式部署已驗收。

## 1. 工作項結果

| 工作項 | 實作結果 | 主要驗證 |
|--------|----------|----------|
| WO-09 | 新增預設關閉的 `STUDENT_PILOT_MODE`。只有開啟時強制 Atlas 與 YouTube 上傳設定，通過後記錄 Backend 十二項 `runtime.flag_snapshot` | mode=false 維持原行為；memory 拒絕；YouTube=false 拒絕且包含指定原因；atlas + YouTube=true 通過 |
| WO-01 | 空影片 allowlist 改為永不匹配，segment 查詢以 canonical video allowlist 為必要條件 | 空 allowlist、courseId-only、允許與不允許 videoId 測試通過 |
| WO-02 | 移除 courseId 單獨放行，Leaf 必須有允許的 canonical videoId | courseId-only、缺 videoId、錯誤 videoId 都回 false |
| WO-03 | allowlist 只加入 `video._id.toString()` | `id`、`videoId`、`video_id` 不再作為相容 fallback |
| WO-04 | FAQ exact 與 semantic hit 都重新檢查每筆 `videoId + segmentId`；任一失效即整筆作廢並繼續正式檢索 | 有效與他課引用混合時不回舊答案；記錄 `qa.faq_scope_revalidation_failed` |
| WO-05 | Child expansion 的資料庫查詢與回傳後檢查都套用 fail-closed scope | 空 allowlist 仍保留永不匹配條件；既有 Parent 測試維持通過 |
| WO-06 | 問題與 provider response log 只保留字元長度與前 80 字 | 超過 80 字的問題與 response 均截斷，完整內容不出現在 log metadata |
| WO-07 | Citation 組裝前確認影片有 `youtubeVideoId`，或本機 `filePath` 實際存在；否則丟棄 citation | `TEST_0720` 三筆 citation 全部丟棄；記錄 `qa.citation_dropped_no_playable_source` |
| WO-08 | runner 新增 `student-pilot-opencv` 具名模式，固定 OpenCV 課程、排除 `TEST_0720` 並要求 15 支影片／129 筆 Leaf | 具名模式、錯誤範圍、132 筆錯誤數量及一般 runner 回歸測試通過 |

共同隔離語意：

```text
canonical video._id
+ Leaf videoId 必須命中 allowlist
+ empty allowlist fail-closed
```

## 2. 測試結果

### 第二批針對性測試

```text
test suites：8 passed / 0 failed / 0 skipped
tests：79 passed / 0 failed / 0 skipped
```

涵蓋 FAQ revalidation、Child expansion、80 字 log 截斷、citation playable-source filter、`student-pilot-opencv` 與一般 runner 回歸。

### Backend 完整測試

執行位置：`backend/`

```powershell
npm.cmd test
```

結果：

```text
test suites：64 passed / 0 failed / 0 skipped
tests：500 passed / 0 failed / 0 skipped
```

第二批開始前的第一批結果為 64 suites、491 tests 全數通過。本批增加 9 個測試，沒有新增 regression。

## 3. Runner 實際執行結果

嘗試執行：

```powershell
node src/scripts/phase2_2_hierarchical_e2e_runner.js --mode student-pilot-opencv --json
```

安全停止結果：

```json
{
  "success": false,
  "code": "E2E_READONLY_DATABASE_URI_REQUIRED",
  "message": "PHASE2_2_READONLY_MONGODB_URI is required for the isolated E2E runner."
}
```

本機沒有專用唯讀 URI，因此 runner 在建立資料庫連線前停止。沒有改用一般 `MONGODB_URI`，沒有資料庫讀寫，也沒有取得 shared Atlas 的實際 129 筆證據。

## 4. 範圍與安全確認

- 實作期間沒有修改 `docs/`；本文件是在程式完成後，經使用者另行批准才補寫。
- 沒有資料庫寫入、migration、seed 或正式資料修改。
- 沒有修改既有 feature flag 預設值；新增的 `STUDENT_PILOT_MODE` 預設為 `false`。
- 沒有開啟 `HIERARCHICAL_RETRIEVAL_ENABLED`。
- 沒有執行 Phase 2、3、3.5、4。
- 沒有執行 LINE WO-20～23 或 YouTube WO-24～26。
- 沒有由 agent 執行 commit 或 push。

## 5. 尚未取得的正式證據

以下仍不屬於本文件已證明的範圍：

1. 使用專用 read-only Atlas 帳號執行 `student-pilot-opencv`，實際確認 15 支影片與 129 筆 Leaf。
2. 附錄 I 規定的 12＋2 題 baseline 結果。
3. 門檻凍結後的 12＋2 題 final 結果與人工複核。
4. 試用環境的 `runtime.flag_snapshot` 原始紀錄。
5. Shared Atlas、Gemini、YouTube 播放、LINE 與正式部署驗收。
