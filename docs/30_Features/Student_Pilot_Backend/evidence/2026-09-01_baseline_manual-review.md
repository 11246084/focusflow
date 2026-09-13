# Phase 2 baseline 人工複核

| 項目 | 內容 |
|------|------|
| 複核日期 | 2026-09-01 |
| 證據用途 | 門檻調整前 baseline，不作為 final 驗收結果 |
| 題庫 | [2026-09-01_baseline_questions.md](2026-09-01_baseline_questions.md) |
| 執行設定 | [2026-09-01_baseline_flag-snapshot.json](2026-09-01_baseline_flag-snapshot.json) |
| 原始結果 | [2026-09-01_baseline_raw-results.json](2026-09-01_baseline_raw-results.json) |
| 正式範圍 | OpenCV 15 支正式影片、129 筆 Leaf，排除 TEST_0720 |
| 複核依據 | raw answer、shared Atlas 真實 Leaf、citation videoId、chunkId 與時間區間 |
| Atlas 安全 | 專用唯讀角色；本次複核查詢偵測到 0 次 DB write |

> runner 的 `success: true` 只代表 14 題都完成執行，不代表答案與引用通過人工複核。
>
> 本次 timestamp 複核確認 citation 時間與 Atlas Leaf 的 `startSec`、`endSec` 一致；未在本輪另外執行跨裝置影片播放驗證。

## 1. 整體結果

### Q01～Q12

| PASS | WEAK | FAIL |
|------|------|------|
| 0 | 10 | 2 |

- `WEAK`：Q01、Q02、Q03、Q05、Q06、Q07、Q08、Q10、Q11、Q12。
- `FAIL`：Q04、Q09。
- 12 題均完成 Atlas Leaf-only retrieval，fallback 為 0，DB write 為 0。
- 12 題各有 15 筆 retrieval match，也各輸出 15 筆 citation。關鍵支持 Leaf 多數存在，但 citation 同時包含許多只具表面關聯、未直接支持答案的片段，因此沒有正向題可判為完整 PASS。

### N01

- 跨課程隔離：**PASS**。沒有使用或引用「影像處理導論」的 videoId `6a67ffcb95668cc2b904f3b9`。
- 拒答：**PASS**。回答為「目前資料庫片段不足以回答這個問題。」
- citation：**WEAK**。雖然 15 筆 citation 全屬 OpenCV，沒有跨課程引用，但這些 Leaf 不支持資料時效、定期替換與語言習慣，拒答時不應保留為答案依據。
- 整體：**WEAK**。隔離與拒答成功，引用品質仍有問題。

### N02

- 拒答：**PASS**。沒有用 Gemini 通用知識回答 Canny 雙閾值。
- citation：**FAIL**。預期為空，實際仍輸出 15 筆 OpenCV citation。
- 整體：**FAIL**。

## 2. 判定方式

- **PASS**：回答正確且完整，教材直接支持，citation 主要指向支持內容，timestamp 合理。
- **WEAK**：回答大致正確，但有內容遺漏、citation 過廣或關鍵支持 Leaf 未被引用。
- **FAIL**：回答有實質錯誤、問題缺乏足夠教材支持，或負向題未符合明確契約。

## 3. 逐題複核

| ID | Answer review | Citation / timestamp review | Result | Finding |
|----|---------------|-----------------------------|--------|---------|
| Q01 | 正確回答電腦視覺函式庫、Intel 牽頭及 Open Source。Atlas `69fb57..._chunk_0006～0007` 直接支持。 | 關鍵 citation 61.82～82.82 秒正確，但其餘多筆 citation 與公司、授權無直接關係。 | **WEAK** | 搜尋品質／門檻問題：引用範圍過廣。 |
| Q02 | 正確回答固定檔案與動態攝影機。Atlas `69fb5b..._chunk_0001～0002` 直接支持。 | 0.30～50.89 秒合理；其餘多支影片 citation 並非回答所需。 | **WEAK** | 搜尋品質／門檻問題：引用過多。 |
| Q03 | 回答有提到前處理、形狀與簡單特徵，但漏掉教材明說的「提高處理速度、降低成本」。 | `chunk_0002～0003` 有命中；關鍵 `chunk_0004` 46.90～64.50 秒未進 raw citations，答案因此誤稱沒有更多好處。 | **WEAK** | 搜尋品質／門檻問題：相鄰關鍵 Leaf 遺漏。 |
| Q04 | 錯誤。Atlas `6a02f34..._chunk_0006～0007` 說半導體瑕疵檢測與肺部 CT 疾病判斷「都是物件分類」，raw answer 卻把前者判為物件偵測。 | 65.14～96.06 秒的正確來源已排在 citation 前段，timestamp 正確，因此不是找不到資料。 | **FAIL** | 程式邏輯問題：回答生成誤讀已取得的直接證據。 |
| Q05 | 正確整理攝影機拍攝、車牌定位、OCR 與放行邏輯；`69fb5d..._chunk_0005～0008` 與 `69fc291...` 片段足以支持入場及出場邏輯。 | 關鍵時間 57.52～120.26 秒及執行邏輯時間合理，但仍混入數筆一般影像處理片段。 | **WEAK** | 搜尋品質／門檻問題：答案正確，citation 不夠精簡。 |
| Q06 | 正確。Atlas `6a02f38..._chunk_0002～0006` 明確支持 OpenCV 可用 CPU、YOLO 的 CPU 版本過慢，以及沒有 GPU 時使用 OpenCV 或較小型模型。 | 12.62～86.80 秒的關鍵 citation 完整；另有多筆非必要 citation。 | **WEAK** | 搜尋品質／門檻問題：關鍵來源正確，但引用過廣。 |
| Q07 | 正確說明物件偵測還要學會不同物件的位置，訓練難度與成本較高。 | `6a02f34..._chunk_0003～0005` 30.64～65.14 秒均有命中；其餘 citation 多為延伸或重複。 | **WEAK** | 搜尋品質／門檻問題：核心正確，引用過多。 |
| Q08 | 只部分回答。教材核心是同一張影像需分別跑找狗、找貓、找車三次，目標愈多就重複運算愈多；raw answer偏向模型體積與訓練成本。 | 預期 `6a02f463..._chunk_0002～0006` 中只有 `chunk_0006` 進 citation，16.30～64.21 秒的三次運算過程未命中。 | **WEAK** | 搜尋品質／門檻問題：核心推理來源遺漏，回答焦點偏移。 |
| Q09 | 前半段的偵測與分類定義正確；後半段有問題。教材說兩者有時會先找位置再判斷內容，但車牌案例實際接的是定位後做 OCR，沒有充分證明「分類」在該流程中的具體角色。raw answer也一面宣稱包含分類，一面承認只看到 OCR。 | 定義來源 64.50～119.98 秒合理；車牌來源沒有足夠支持題目要求的配合關係。 | **FAIL** | 題目／教材支持度問題，並伴隨回答自相矛盾。 |
| Q10 | 固定檔案、動態攝影機與 Colab 難以存取本機硬體的原因正確。 | `chunk_0001～0004` 0.30～96.45 秒有命中；真正提到改用 Spyder 的 `chunk_0005` 96.71～118.41 秒未進 citation。 | **WEAK** | 搜尋品質／門檻問題：回答從題目沿用 Spyder，但 citation 缺直接來源。 |
| Q11 | CPU／GPU 差異與 YOLO 一次處理多物件的方向正確，但沒有完整說明 OpenCV 端需以多個偵測器重複運算的比較。 | 硬體 citation 合理；YOLO 主來源 `6a02f48..._chunk_0001～0006` 大多未命中，只由其他片段部分支持。 | **WEAK** | 搜尋品質／門檻問題：比較只完成一部分。 |
| Q12 | 正確區分單一流浪狗需求可用專門、較簡單的模型，多種常見物件則可使用現成 YOLO。 | `6a02f4b..._chunk_0001～00011` 與 `6a02f48..._chunk_0007` 的關鍵內容有命中，時間合理；仍有非必要 citation。 | **WEAK** | 搜尋品質／門檻問題：回答完整，但 citation 過廣。 |
| N01 | 正確拒答，沒有使用外課 Leaf 中「替換過時資料並重新訓練」的答案。 | 15 筆 citation 全為 OpenCV，外課引用為 0；但 OpenCV citation 不支持答案且拒答時不應列為依據。 | **WEAK** | 程式邏輯問題：隔離成功，但拒答仍組裝 citation。 |
| N02 | 正確拒答，沒有補上 Canny 通用知識。 | 15 筆 citation 均與 Canny 雙閾值答案無直接關係；規格要求 citation 為空。 | **FAIL** | 程式邏輯問題：無答案回覆仍保留 retrieval citations。 |

## 4. 問題整理

### 4.1 程式邏輯問題

1. **拒答仍產生 citation**
   - N01、N02 都正確拒答，但仍各輸出 15 筆 citation。
   - N02 因明確要求 citation 為空而失敗。
   - 這不能只靠調整相似度門檻解決；無答案狀態與 citation 組裝需要一致。

2. **citation 等同全部 retrieval matches**
   - 14 題全部都是 `matchCount = 15`、`citationCount = 15`。
   - 大量 citation 只具表面關聯，未直接支持答案。
   - 正式引用應選擇實際支持答案的 Leaf，而不是機械輸出全部候選。

3. **已取得直接證據仍產生錯誤答案**
   - Q04 已取得正確的兩筆 Leaf，但回答仍誤判半導體瑕疵檢測。
   - 此問題不是放寬或收緊檢索門檻就能直接修正。

4. **回答中的影片名稱不可辨識**
   - answer 文字使用「未知影片」，但 raw citation 有 videoId 與 timestamp。
   - 不影響本次用 videoId 複核，但會降低正式證據及使用者閱讀品質。

### 4.2 題目／教材支持度問題

1. **Q09 第二半題支持不足**
   - 教材可支持「偵測找位置、分類判斷內容」的一般關係。
   - 車牌案例則明確是定位後接 OCR，未充分說明物件分類如何參與。
   - Phase 3 前需先決定保留、收斂或更換，不能用調門檻補出教材不存在的內容。

### 4.3 搜尋品質／門檻問題

1. 每題固定取得 15 筆，相關度不足的 Leaf 仍大量進入 citation。
2. Q03 遺漏「速度更快、成本降低」的相鄰 Leaf。
3. Q08 遺漏「同一張影像分三次運算」的核心 Leaf。
4. Q10 遺漏直接提到 Spyder 的 Leaf。
5. Q11 遺漏 YOLO 一次處理多物件的主要連續 Leaf。
6. Phase 3 應依這份 baseline 調整排序與門檻，但不得放寬 course/video fail-closed 隔離。

### 4.4 其他

- Leaf 仍有 OpenCV、YOLO、OCR、Spyder 等 STT 誤寫；本次依題目與上下文正規化判讀，未把轉錄錯字本身列為答案失敗。
- 所有 raw citation timestamp 均能對應 Atlas Leaf 的時間區間；本次沒有發現越界或 TEST_0720 citation。

## 5. Phase 2 結論

### baseline evidence 是否完整

**完整。**

本次 baseline 已具備：

1. 題庫。
2. `runtime.flag_snapshot`。
3. raw JSON。
4. 人工複核表。

「證據完整」只表示 Phase 2 baseline 四類檔案已齊，不表示問答品質或學生試用已通過。

### 進 Phase 3 前應先處理

1. 拒答時 citation 必須與無答案狀態一致，尤其 N02 必須為空。
2. 確認 citation 不應直接等同全部 retrieval matches。
3. 處理 Q04 在正確證據已取得時仍回答錯誤的問題。
4. 人工決定 Q09 是否收斂或更換；不得用門檻調整補足不存在的教材支持。

### 適合留到 Phase 3

1. 依 baseline 調整 Atlas Leaf 排名與相似度門檻。
2. 降低每題大量表面相關 Leaf 進入結果的情況。
3. 改善 Q03、Q08、Q10、Q11 的關鍵 Leaf 覆蓋。
4. 每次調整後重跑 N01、N02 與 P1～P6，維持 fail-closed，不得以跨課程內容換取正向題命中率。
