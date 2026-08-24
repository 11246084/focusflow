# QA 回答品質評測

針對 FocusFlow 的 QA 系統做人工＋自動混合評分，量出「答得對不對、有沒有幻覺、引用準不準、學生看不看得懂」。

題庫課程：**AI入門基礎課**（`courseId 6a6da68456dd124511ec5196`），6 支影片、約 3.4 小時、694 個逐字稿片段。
所有題目與 Gold 要點皆取自實際逐字稿，非虛構。

## 檔案

| 檔案 | 用途 |
|------|------|
| `FocusFlow_QA評測_AI入門基礎課_v1.xlsx` | 主評分表（50 題）＋評分準則＋統計儀表 |
| `question-bank.json` | 同一份題庫的機器可讀版本，供 runner 使用 |
| `../../backend/scripts/qa-eval/runQaEval.js` | 逐題呼叫 QA API，產出可貼進評分表的執行結果 |
| `../../backend/scripts/qa-eval/dumpTranscripts.js` | 匯出課程逐字稿，供人工核對 Gold 要點 |
| `runs/<timestamp>/` | 每次執行的 `results.json` / `results.csv` |
| `2026-08-24-評測結果.md` | **首輪基準線報告**（50 題、加權 4.35/5），之後調整後的對比基準 |

## 評分面向（各 1–5 分）

| 代號 | 面向 | 權重 |
|------|------|------|
| A | 正確性 | 30% |
| B | 忠實性（不幻覺） | 20% |
| C | 完整性 | 15% |
| D | 引用與時間戳 | 15% |
| E | 清晰度與可讀性 | 10% |
| F | 拒答恰當性 | 10% |

加權總分 = A×0.3 + B×0.2 + C×0.15 + D×0.15 + E×0.1 + F×0.1。
B ≤ 2（幻覺）或 D ≤ 2（引用錯影片）時標記致命錯誤，該題總分自動壓到 2.00 上限。

**A 與 B 必須分開評。** prompt 規則第 3 條禁止使用外部知識，所以「答案正確但根據來自模型自身知識」對本系統仍是失敗；只有 A/B 分開才看得出這種 A 高 B 低的情況。

## 題型分佈（50 題）

| 題型 | 題數 | 測什麼 |
|------|------|--------|
| 單片段事實 | 13 | 基礎檢索與答案抽取 |
| 跨片段歸納 | 10 | `QA_MATCH_LIMIT` 是否足夠、prompt 規則 2 是否生效 |
| 跨影片 | 5 | `bridgeScope` 是否納入整門課的影片 |
| 名詞定義 | 5 | 定義類問題的品質 |
| 時間定位 | 5 | 時間戳與 `jumpUrl` 準確度 |
| 課程外負向 | 7 | 是否會用外部知識硬答（幻覺主要來源） |
| 口語錯字 | 5 | prompt 規則 4（STT 專有名詞對齊）與真實學生問法 |

題庫原本設計為 70 題，依需求等比縮減為 50 題，各題型比例維持不變。
刪去的都是與保留題重疊度最高的題目（例如同一個故事的兩種問法）。

## 執行流程

### 1. 測試前置（必做）

```bash
# backend/.env
FAQ_CACHE_ENABLED=false
```

清空該課程既有 FAQ 快取（改設定不會讓舊快取失效）：

```bash
# PowerShell。注意 /auth/login 需要 email + password + role 三者
$t = (Invoke-RestMethod -Uri http://localhost:4000/api/v1/auth/login -Method Post `
  -ContentType 'application/json; charset=utf-8' `
  -Body '{"email":"teacher@focusflow.local","password":"Teacher123!","role":"teacher"}').data.token
Invoke-RestMethod -Uri "http://localhost:4000/api/v1/courses/6a6da68456dd124511ec5196/faqs" `
  -Method Delete -Headers @{Authorization="Bearer $t"}
```

把本輪的 `QA_MATCH_LIMIT`、`GEMINI_CHAT_MODEL`、`QA_VECTOR_SEARCH_MODE`、日期記到 Excel 的「測試環境」分頁。之後要做調參前後對比全靠這一頁。

### 2. 跑題庫

```bash
node scripts/qa-eval/runQaEval.js
```

需先設定 `QA_EVAL_EMAIL` / `QA_EVAL_PASSWORD`（該帳號要能存取此課程）。
其他可選：`QA_EVAL_ROLE`（預設 `student`）、`QA_EVAL_BASE_URL`、`QA_EVAL_DELAY_MS`、`QA_EVAL_ONLY=F01,M03`。

腳本會在任何題目命中 FAQ 快取時警告——命中代表那題量到的是快取而不是模型，結果無效。

### 3. 貼進評分表

把 `runs/<timestamp>/results.csv` 的第 9–17 欄（系統答案 … 回應秒數）貼到評分表對應的黃色欄位。題號順序與題庫一致。

### 4. 評分

綠色欄位為人工（或交給 Claude）填寫。建議順序：先看 matches 片段 → 評 B、D → 對 Gold 要點評 A、C → 最後評 E、F。先評 B/D 可避免被通順的文筆影響對正確性的判斷。

建議抽 20% 題目給第二人盲評，在「人工複核」欄填「同意」或「修正」，統計分頁會自動算一致率；低於 80% 代表評分準則的錨定描述需要再細化。

## 怎麼讀統計結果

- **A 明顯高於 B** — 答案對但根據來自模型自身知識，是檢索或 prompt 的問題，不是模型能力問題。
- **C 偏低且集中在跨片段題** — `QA_MATCH_LIMIT` 不足，考慮調高。
- **D 偏低** — 時間戳或 `jumpUrl` 有問題，學生跳過去會看到不相干內容。
- **「該拒答卻硬答」> 0** — 最嚴重的失敗模式，代表系統會編造。
- **「不該拒答卻拒答」偏高** — 假拒答，通常是檢索範圍或 `QA_MATCH_LIMIT` 問題。
