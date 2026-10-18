# FocusFlow 短影音製作規格 v2

**文件狀態：製作規格，尚未實作。**
本文件定義「一支 FocusFlow 短影音該怎麼做出來」的完整規格——腳本結構、提示詞模板、工具鏈、流程、合成參數與資料欄位。可直接當開發依據，也可當人工製作的操作依據。系統目前沒有任何自動生成短影音的程式碼。

- 版本：**v2（2026-08-14）**
- 目標：**用資料庫既有內容，在 30 秒內讓學生弄懂一個觀念**（v2 起不做導流，Shorts 是獨立的學習單元）

---

## v2 的架構轉向：從「禁止生成」改為「生成 + 驗證」

v1 用禁止處理風險：畫面不准帶資訊、字卡一律程式化渲染、原生音軌一律剝除、不得生成人物。

**那是把兩件事混在一起了**——「由誰產出」與「內容能不能追回資料庫」是兩個獨立問題。v1 用限制產出方式去解決溯源問題，代價是砍掉大半表現力，也讓短影音失去教學能力（畫面不能帶資訊，等於畫面不能教東西）。

v2 改成：**全部都可以生成，但每一種產出各有一道自動驗證關卡。**

| | v1 | v2 |
|---|---|---|
| 畫面帶文字／公式 | 禁止 | **可以**，須通過 G2 字面驗證 |
| 字卡 | 一律程式化渲染 | **可生成**，程式化渲染降為 fallback |
| 人物出鏡 | 只能實拍教師 | **可用虛擬講解員**（須標示，不得冒充授課教師） |
| 語音 | 原生音軌一律剝除 | **可用生成語音**，須通過 G3 語音驗證 |
| 生成工具 | 綁 Veo 3.1 + Nano Banana | 改寫成**能力需求**，不綁特定模型 |

**「知識點必須來自資料庫」沒有放寬**，只是改由 G1 溯源驗證保證，與畫面是不是生成的無關。這才是 v1 那些紅線真正想守的東西。

### 三道自動驗證（v2 的核心機制）

| Gate | 位置 | 檢查什麼 | 不過關 |
|------|------|----------|--------|
| **G1 溯源** | 生成之前 | 每一句話都對得回 chunkId，且屬同一課程 | 中止，不生成、不花錢 |
| **G2 字面** | 生圖之後、生影片之前 | 畫面上出現的文字，OCR／VLM 回讀 **逐字等於**指定字串 | 重出圖；N 次不過退回程式化渲染 |
| **G3 語音** | 合成之後 | 成品音軌 ASR 回讀，逐字比對腳本 | 重新合成語音 |

**教師覆核仍然保留。** G1–G3 擋的是機器層面的錯，擋不掉「這段話雖然有出處但被斷章取義」。人是最後一道。

### 與其他文件的關係

本文件是短影音製作的**單一權威來源**，涵蓋從選題到發布的完整規格，不需搭配其他文件即可執行。

研究階段先前產出的三份文件（選型研究、教師操作手冊、教授說明頁）目前不在工作目錄中，其有效結論已整併入本文件的 §2（架構）、§6（選型）、§11（成本）。研究過程中被推翻的兩項舊結論——「雙層架構」與「腳本取自逐字稿」——不再保留。

---

## 1. 成品定義

一支合格的 FocusFlow 短影音：

| 項目 | 規格 |
|------|------|
| 長度 | 25–40 秒（目標 30 秒） |
| 比例 | 9:16 直式，1080×1920 |
| 內容量 | **一支只講一個觀念**，不多不少 |
| 教學內容來源 | 100% 可追溯到資料庫片段 |
| 必要元素 | 逐字字幕、來源時間戳、AI 生成標示（含生成人物時標 `AI 講解員`） |
| 成功指標 | **完播率 + 重播率**，非播放數 |

---

## 2. 四層架構

短影音由四層疊成，**每層用不同技術、承擔不同風險、由不同的關卡驗證**。

```
┌───────────────────────────────────────────────────────┐
│ 教學層   文字內容（旁白 + 字幕）                          │
│          來源：QA 答案生成（受資料庫約束）                  │
│          技術：answerGeneration + 語音合成                │
│          驗證：G1 溯源（生成前）+ G3 語音（合成後）          │
├───────────────────────────────────────────────────────┤
│ 解釋層   字卡、重點標示、步驟框、時間戳、公式               │
│          來源：資料庫欄位直接帶入                          │
│          技術：生成優先；程式化渲染為 fallback              │
│          驗證：G2 字面（OCR 回讀逐字比對）                  │
├───────────────────────────────────────────────────────┤
│ 表演層   虛擬講解員（選用）                                │
│          來源：AI 生成人物 + 腳本鎖定的語音                 │
│          技術：數位人平台或影片模型 + 角色一致性鎖定          │
│          驗證：G3 語音 + 標示 `AI 講解員`                  │
├───────────────────────────────────────────────────────┤
│ 氛圍層   背景畫面                                        │
│          來源：AI 生成                                   │
│          技術：圖生影片                                   │
│          驗證：G2（若帶文字）；否則只需人工看一眼            │
└───────────────────────────────────────────────────────┘
```

### 四層的關係

**「教會一個觀念」靠的是解釋層，不是氛圍層。** 這一點 v1、v2 都成立。

差別在**解釋層的實作方式**：

- v1：生成模型畫不準文字，所以一律程式化渲染
- v2：**生成優先，但必須通過 G2 回讀比對**。過不了才退回程式化渲染

這個轉向的前提是「畫得準不準」已經變成**可以自動量測**的事——把預期字串與 OCR 結果逐字比對即可。既然量得出來，就不需要用禁止來迴避。

**要誠實記錄的限制**：短英文字串（≤ 8 字元）的生成保真度明顯高於中文與數學符號。所以規格上分級——

| 內容 | 建議 |
|------|------|
| 短字串（≤ 8 字）、單一詞彙 | 生成優先 |
| 中文長句、多行條列 | 生成可試，重試上限調低 |
| 數學公式、上下標、希臘字母 | **直接用程式化渲染**，不是不能生成，是重試次數會高到不划算 |

### 氛圍層的美學約束（與一般短影音相反）

對社群短影音，華麗搶眼的背景是資產；**對教學短影音是負資產**。學生要同時處理旁白、字幕、字卡，背景越搶戲，認知負荷越高。

**氛圍層規格：低對比、低飽和、慢速、無焦點競爭。** 它的工作是讓畫面不空，不是吸引注意。

> 注意這條與 v2 放寬「畫面可帶資訊」不衝突：**帶資訊的是解釋層與表演層，氛圍層仍然要淡。** 如果背景本身就在講解，那它已經不是氛圍層了。

---

## 3. 內容怎麼來

### 3.1 全部都是 AI 生成的，重點是「AI 有沒有看材料」

旁白與字幕的每一個字都由 AI 生成。差別不在有沒有生成，而在**AI 寫的時候手邊有沒有材料**。

> 像請助教把上課錄音整理成筆記：字是助教打的，內容來自錄音，助教不能加自己知道但老師沒講的東西。

材料 = 課程逐字稿。**它只給 AI 看，學生看不到。**

### 3.2 不要直接播逐字稿

逐字稿是口語，有贅詞和鋪陳，直接當字幕很難讀。

更重要的是**順序不對**：老師上課是「背景 → 舉例 → 結論」，短影音必須**結論先講**。

所以 AI 的工作是**重新排序 + 濃縮**，不是換掉用詞。重排不新增內容，沒有風險。

### 3.3 材料已經現成：用問答功能的答案

系統既有的 `answerGeneration.service.js` 已經在做這件事，它的 prompt 規則寫著：

- 「自然整理重點，**不要直接貼上逐字稿**」→ 白話好讀
- 「只能根據資料庫片段、不可使用外部知識」→ 內容受約束

所以短影音腳本直接用問答答案，不必另寫一套。`faqs` 裡的高頻問答本身就是整理好的白話版。

### 3.4 AI 離材料多遠：六個層級

每一句都是生成的，差別在**能不能指出它出自材料哪裡**。

| 層 | AI 做了什麼 | 判定 | 標示 |
|----|------------|------|------|
| L0 | 逐字照搬 | ❌ 難讀 | — |
| L1 | 刪贅字、斷句 | ✅ 必做 | 🟢 |
| L2 | 重寫句子，資訊點全保留 | ✅ 必做 | 🟡 |
| L3 | 重排順序、講得更口語 | ✅ 價值最高 | 🟡 |
| L4 | 歸納成一句總結 | ⚠️ 要對應到多個片段 | 🟡 |
| L5 | **加材料裡沒有的類比、舉例** | ⚠️ 分水嶺 | 🔴 |
| L6 | 不看材料自由發揮 | ❌ 禁止 | — |

🔴 的意思不是「這句是生成的」（每句都是），而是「**這句在材料裡找不到出處**」。

### 3.5 紅色的句子要老師點頭

類比對教學很有用，所以不禁止，但**老師要逐句勾選同意才能發布**。老師只需細看紅色那幾句。

理由：錯的類比比講漏更糟，學生會記住錯的觀念且難以糾正。但這件事人看一眼就能擋，不必付「一律禁止」的代價。

### 3.6 畫面的規則（v2 改寫）

v1 說「管不住它畫什麼，所以不准帶資訊」。**v2 的做法是：指定它該畫什麼，然後檢查它畫對沒有。**

#### 三種畫面，三套規則

| 類型 | 例子 | 規則 |
|------|------|------|
| **A. 帶指定文字** | 字卡 `token`、標籤 `句點也算一個` | prompt 明寫 `the exact text "…" appears`，並登記 `expectedText`。生成後 **G2 回讀逐字比對**，不一致就重出 |
| **B. 不帶文字的氛圍／隱喻** | 麵包切片、光帶斷開 | 沿用 v1 的 negative：不准出現任何文字、標籤、商標、浮水印 |
| **C. 虛擬講解員** | 對鏡頭講解的 AI 人物 | 見 §3.7 |

**同一鏡不要混 A 與 B。** 要帶文字就整鏡按 A 走（不加文字類 negative），不帶就整鏡按 B 走（negative 全開）。混在一起會讓模型同時收到「要有字」與「不准有字」，結果最不可控。

#### G2 字面驗證怎麼做

```
生成 → OCR／VLM 讀出畫面上所有文字 → 正規化（全形轉半形、去空白）
     → 與 expectedText 逐字比對
     → 完全相同：通過
     → 不同 or 出現預期外的文字：重出圖
     → 連續失敗 N 次（建議 N=5）：退回程式化渲染，並記錄到 generation.g2FallbackCount
```

**要誠實記錄的殘餘風險**：OCR 過了不代表沒錯。全形半形、形近字（`日`／`曰`）、標點差異都可能被判成一樣。所以 G2 之後**教師覆核仍然要看畫面上的字**，不能因為有自動檢查就跳過。

#### 什麼情況仍然直接用程式化渲染

- 數學公式、上下標、希臘字母
- 多行條列、表格
- 收束字卡——它是全片的記憶點，**寫錯等於整支白做**

### 3.7 虛擬講解員（v2 新增）

允許用 AI 生成的人物出鏡講解。**風險不是「畫面裡有 AI 的人」，是學生誤以為那是授課教師。** 所以規則是關於身分，不是關於技術：

| 規則 | 說明 |
|------|------|
| **固定角色** | 同一課程的所有短影音用同一個虛擬講解員，用 reference image 鎖住長相 |
| **可見標示** | 角落常駐 `AI 講解員`，與「AI 示意畫面」同樣是必要元素 |
| **不得冒充** | 不取授課教師的姓名、不模仿其長相與聲線、不以第一人稱聲稱是授課教師 |
| **語音同樣受 G3 約束** | 講的內容一樣要對得回 chunkId |

#### 這一條不放寬

**未經書面同意，不得複製真實教師的臉或聲音。** 這不是技術限制也不是保守，是肖像權與聲音權——取得同意之後做數位分身是另一回事，屬於需要另行規劃的授權流程。

同理，不得使用真實學生的臉，即使是生成的「看起來像某位學生」的人物。

---

## 4. 腳本規格

### 4.1 四槽模板

固定的是槽位，內容每次從資料庫填。**30 秒只能講一件事，槽位就是硬性的認知負荷上限。**

| 槽 | 秒數 | 內容 | 來源 | 生成層級 | 字數 |
|----|------|------|------|----------|------|
| ① 學生的困惑 | 0–3s | 學生原本問的那句話 | `questions.text` 原句 | L0（照用） | ≤ 20 字 |
| ② 結論先行 | 3–10s | 這個觀念是什麼 | QA 答案第一句 | L2–L3 | 25–35 字 |
| ③ 最小必要解釋 | 10–25s | 為什麼／怎麼用，**1–2 個要點** | QA 答案主體 | L2–L4 | 50–70 字 |
| ④ 收束重述 | 25–30s | 把最反直覺的那句再講一次 | 與槽②或③同源 | L2 | ≤ 20 字 |

**總字數 120–150 字**（中文口語約 30 秒）。

槽 ① 直接用學生原話當鉤子——資料庫裡現成的、最真實的痛點，比任何 AI 想的開場都準。

### 4.2 腳本產出的資料結構

```js
{
  courseId, sourceVideoId,
  question: "學生原問句",
  lines: [
    { slot: 1, text: "...", level: "verbatim",  chunkIds: [],            startSec: null },
    { slot: 2, text: "...", level: "rewritten", chunkIds: ["…chunk_0005"], startSec: 56 },
    { slot: 3, text: "...", level: "rewritten", chunkIds: ["…chunk_0005","…chunk_0006"], startSec: 56 },
    { slot: 4, text: "...", level: "template",  chunkIds: [],            startSec: 56 }
  ],
  primaryStartSec: 56
}
```

`level` 直接對應 §3.3 的分色標示。

### 4.3 腳本生成的 prompt 約束

在既有 QA 答案之上再做一次濃縮時，規則必須寫死：

```
你是課程短影音腳本編寫助手。以下是一段已經整理過的課程答案。

【嚴格規則】
1. 只能從提供的答案中挑選、刪減、重新排序
2. 不可新增答案中沒有的資訊、說明、舉例或背景知識
3. 即使補充後更完整、更正確，也不可補充
4. 必須結論先行：先講「是什麼」，再講「為什麼／怎麼用」
5. 只能講一個觀念。若答案涵蓋多個觀念，只取最核心的一個
6. 總字數 120-150 字，分成三段（結論 / 解釋 / 略）

【輸出】
JSON，每句標註它出自原答案的第幾句，以及該句是「原句 / 重寫 / 重排 / 新增」
```

**必須要求逐句標註來源**，否則無法做 §3.3 的分色與 §7 步驟④（G1 溯源）的驗證。

---

## 5. 提示詞規格

### 5.1 一律使用英文

多數影片模型的官方文件明載**完整支援英文，其他語言未經測試**。中文教學內容須先轉成英文視覺描述。

> **例外**：profile A 的 `{EXPECTED_TEXT}` 若本身就是中文字卡，該字串**照原樣寫進 prompt**，不要翻譯——要生成的就是那串中文。這也是中文保真度需要實測的原因（見 §13）。

### 5.2 提示詞不由 LLM 自由撰寫

紅線交給 LLM 自由發揮就守不住。採**模板 + 槽位填空**，前後段為硬編碼常數，LLM 只填中間兩個槽。

### 5.3 生圖提示詞模板（依畫面類型分成三套）

#### Profile B — 不帶文字的氛圍／隱喻（v1 模板，沿用）

```
A vertical 9:16 cinematic still.
Subject: {SUBJECT}
Action/State: {ACTION}
Setting: {SETTING}
Lighting: soft natural light, low contrast, muted desaturated palette.
Composition: medium shot, shallow depth of field, generous negative space
             in the upper and lower thirds.
Style: realistic photography, calm and unobtrusive, background-appropriate.

NEGATIVE — must not appear:
text, letters, words, numbers, digits, formulas, equations, charts, graphs,
axes, diagrams, schematics, labels, captions, subtitles, signage, logos,
watermarks, user interface elements, any readable content,
recognizable human faces.
```

`{SUBJECT}` / `{ACTION}` / `{SETTING}` 由 LLM 從腳本抽取，**限制在物件與場景詞彙**，禁止填入課程術語與抽象概念。

- ❌ `{SUBJECT} = tokenization of a sentence` ← 概念，模型會試圖把字寫出來
- ✅ `{SUBJECT} = a loaf of bread cut into even slices on a wooden board` ← 畫面

「generous negative space in the upper and lower thirds」是為了讓字幕有地方放。

#### Profile A — 帶指定文字（v2 新增）

```
A vertical 9:16 cinematic still.
Subject: {SUBJECT}
Action/State: {ACTION}
Setting: {SETTING}
Text: the exact text "{EXPECTED_TEXT}" appears, cleanly rendered,
      high contrast, horizontally centred in the upper third,
      no other text anywhere in the image.
Lighting: soft natural light, low contrast, muted desaturated palette.
Style: realistic photography, calm and unobtrusive.

NEGATIVE — must not appear:
misspelled text, garbled letters, duplicated text, extra words,
watermarks, logos, user interface elements, recognizable human faces.
```

注意這一套的 negative **不含** `text, letters, words`——那會與 `Text:` 欄位互相打架。改成排除「拼錯、亂碼、重複、多餘的字」。

`{EXPECTED_TEXT}` 同時寫進資料庫欄位供 G2 比對。**一鏡只放一個字串**，兩個以上就分鏡。

#### Profile C — 虛擬講解員（v2 新增）

```
A vertical 9:16 portrait still.
Subject: a neutral-looking adult presenter, {APPEARANCE_LOCK}
Action/State: facing camera, mid-gesture, calm and approachable
Setting: {SETTING}, softly out of focus
Lighting: soft key from camera left 45°, gentle fill, even skin tone
Composition: chest-up framing, subject centred slightly right,
             eyes on the upper-third line,
             generous negative space in the upper and lower thirds
Style: realistic photography, documentary feel

NEGATIVE — must not appear:
text, letters, numbers, logos, watermarks, university crest,
uniform insignia, extra limbs, deformed hands
```

`{APPEARANCE_LOCK}` 是固定的外貌描述字串，配合 reference image 使用，**同一課程所有短影音共用同一組**。

> 校徽、制服標誌必須排除——一旦出現就等於在暗示這是某間學校的真實師生。

### 5.4 動畫提示詞模板

只描述「怎麼動」，不重述內容：

```
Animate this image. 8 seconds.
Motion: {MOTION}
Camera: slow subtle push-in （或 slow lateral pan / static）
Amplitude: minimal, gentle, natural. No abrupt movement.
Do not add any object not present in the source image.
Preserve all text in the source image exactly as it appears.
```

`{MOTION}` 限用 slow / gentle / subtle / drifting 類動詞。**動作幅度寧小勿大**——AI 影片崩壞幾乎都源自要求太多動作。

**最後一行是 v2 的重點**：從「不准生成文字」改成「不准改動已有的文字」。圖生影片時模型常常把首格的字改掉或糊掉，**所以 G2 要在影片生成後再驗一次**（抽首格、中間格、末格各一張回讀）。

### 5.5 禁止項與 G2 的實作位置

禁止項優先放進 API 的 `negativePrompt` 參數（若可用），比寫在 prompt 本文可靠。

> **待實查**：`negativePrompt` 是否為所選影片模型的支援參數。未支援則保留寫在 prompt 本文。

G2 需要的欄位在 §10 的 `ShortAsset.shots[]` 定義。

---

## 6. 工具與模型

**v2 改成寫能力需求，不綁特定模型。** 生成模型汰換太快，把型號寫死在規格裡，規格會比模型先過期。

| 環節 | 能力需求 | 目前的候選 |
|------|----------|-----------|
| 腳本文字 | 受資料庫約束的答案生成 | 既有 `answerGeneration.service.js` |
| 視覺提示詞 | 程式模板 + LLM 填槽 | 紅線與 `expectedText` 由程式保證，不交給 LLM |
| 生圖 | 9:16、**可指定畫面內文字**、可用 reference 鎖角色 | Nano Banana、Imagen、Flux、Seedream |
| 生影片 | 9:16、1080p、圖生影片、8 秒段、**可保留首格文字** | Veo、Kling、Runway、Sora、Hailuo、Seedance |
| 虛擬講解員 | 吃逐字稿、嘴型對得準、角色跨片一致 | **數位人平台（HeyGen／Synthesia 這類）通常比通用影片模型合適** |
| 語音 | **輸入是我們給的逐字稿**，非模型自由發揮 | TTS、語音複製（需授權）、教師錄音 |
| G2 字面驗證 | OCR 或 VLM 讀圖回文字 | 任一 OCR API 或多模態模型 |
| G3 語音驗證 | ASR 轉逐字稿 | Whisper 或任一 ASR API |
| 解釋層 fallback | 確定性渲染 | FFmpeg（ASS）或 Remotion |
| 合成 | 拼接、疊軌、燒字幕、疊標示 | FFmpeg |
| 發布 | YouTube 上傳 | 既有 OAuth 路徑，已 live 驗證 |

### 6.1 選型時要問的三個問題

1. **能不能指定畫面內文字？** 不能的話 Profile A 走不了，該模型只能拿來做氛圍層
2. **圖生影片會不會改動首格的文字？** 會的話 G2 必須在影片階段再驗一次，重試成本上升
3. **語音是模型自由生成還是吃我們的稿？** 自由生成的一律要過 G3，吃稿的風險低很多

> **模型與價格請在實作前重新查證。** 本節列出的候選只代表撰寫當下的市場概況，不保證仍是最佳選擇，也不保證仍然存在。

### 6.2 參考：Veo 模型 ID 與呼叫參數

以下保留自 v1，**作為介面形狀的參考**，不代表必須用 Veo。

| 模型 | ID | 單價 |
|------|-----|------|
| Veo 3.1 | `veo-3.1-generate-preview` | US$0.40／秒 |
| Veo 3.1 Fast | `veo-3.1-fast-generate-preview` | US$0.15／秒 |
| Veo 3.1 Lite | `veo-3.1-lite-generate-preview` | ~US$0.05／秒 |

```js
const operation = await ai.models.generateVideos({
  model: "veo-3.1-fast-generate-preview",
  prompt: visualPromptEn,          // 英文
  image: startFrame,               // 圖生影片（來自步驟⑥）
  config: {
    aspectRatio: "9:16",
    resolution: "1080p",
    durationSeconds: "8",
    personGeneration: "allow_adult",
    referenceImages: [ref1, ref2],  // 最多 3 張，用於鎖風格
  },
});
```

---

## 7. 完整流程

```
① 選題        faqs.hitCount 排行取一題
                    ↓
② 取答案      該題的 QA 答案（已白話整理）
              ＋ 學生原問句 ＋ chunkIds ＋ startSec
                    ↓
③ 填腳本      套 §4.1 四槽模板 → 4 句中文字幕 + level 標註
              ＋ 每個帶文字的鏡頭登記 expectedText
                    ↓
④ G1 溯源驗證 ★  每句 chunkId 存在且屬同課程？
                 → 失敗即中止，不產出、不花錢
                    ↓
⑤ 出提示詞    每段 → 英文視覺 prompt
              依畫面類型選 Profile A / B / C（§5.3）
                    ↓
⑥ 生圖        每鏡 1 張
                    ↓
⑦ G2 字面驗證 ★  OCR 回讀 = expectedText？多餘文字？人臉？
                 → 不過關回 ⑥（一張約 NT$1.5，便宜）
                 → 連續 N 次失敗 → 退回程式化渲染
                    ↓
⑧ 生影片      圖生影片，非同步 operation，輪詢至完成
                    ↓
⑧' G2 複驗 ★   抽首/中/末格再回讀一次
               → 文字被改動就重生這一段
                    ↓
⑨ 立即下載 ❗  存入 uploads/（伺服器 2 天後刪除）
                    ↓
⑩ 合成        拼接、疊語音、燒字幕、疊標示
                    ↓
⑩' G3 語音驗證 ★ ASR 回讀成品音軌，逐字比對腳本
                 → 相似度低於門檻就重新合成語音
                    ↓
⑪ 落庫        ShortAsset { status:'draft', jobId, lines[], shots[] }
                    ↓
⑫ 老師覆核 ★  分色逐句確認 🟢🟡🔴 ＋ 看畫面上的字
              → ready → published → YouTube Shorts
```

### 五道關（不可省略）

| 關 | 位置 | 擋什麼 | 為什麼在這個位置 |
|----|------|--------|------------------|
| ★ ④ G1 | 生成之前 | 機器編造內容 | 在花任何錢之前擋掉 |
| ★ ⑦ G2 | 生圖之後、生影片之前 | 畫面文字錯誤、多餘文字 | **經濟核心**，見下 |
| ★ ⑧' G2 複驗 | 生影片之後 | 圖生影片把首格的字改掉 | 影片模型常改動源圖文字 |
| ★ ⑩' G3 | 合成之後 | 語音講出腳本沒有的話 | 生成語音的內容漂移 |
| ★ ⑫ | 發布之前 | 前四關想不到的錯誤 | 人是最後一道 |

**第 ⑦ 關是整個流程的經濟核心。** 一張圖 NT$1.5，一段 8 秒影片 NT$40。**在圖的階段重做二十次，仍比在影片階段重做一次便宜。** 且靜態圖的違規比影片容易驗——一張圖 OCR 一次就好，影片要抽格。

### G2／G3 的門檻設定

| Gate | 判準 | 建議門檻 |
|------|------|----------|
| G2 | 正規化後**逐字完全相同**，且無預期外的文字 | 完全相同才算過，不設相似度 |
| G2 重試上限 | 超過就退回程式化渲染 | 5 次 |
| G3 | ASR 結果與腳本的字元相似度 | ≥ 0.95，且**關鍵詞必須全中**（術語、數字、時間戳） |

G3 用相似度而非完全相同，是因為 ASR 本身有誤差；但**術語與數字必須全中**，那些正是講錯會害到學生的地方。

---

## 8. API 硬約束（直接決定架構）

| 規格 | 對實作的影響 |
|------|--------------|
| 生成延遲 **11 秒 ～ 6 分鐘** | ❗ 必須做成非同步 job，不可在 HTTP request 內等待。`ShortAsset.jobId` 正好承接 |
| 影片在伺服器**只保留 2 天** | ❗ 生成完成須**立即下載存檔**，不可只存 URL |
| **8 秒需 1080p/4K 或 referenceImages** | 要 8 秒段就必須指定 1080p |
| `referenceImages` 最多 **3 張** | 用來鎖風格，使 3–4 段畫面看起來像同一支片 |
| 輸出含 **SynthID 隱形浮水印** | 好事，但隱形——仍須另加可見的「AI 示意畫面」標示 |
| **完整支援英文**，其他語言未測試 | §5.1 提示詞一律英文 |
| `personGeneration` 在 EU/UK/CH 有地區限制 | 本專案在台灣，但若未來有跨境需求需注意 |

---

## 9. FFmpeg 合成規格

### 9.1 生成音軌怎麼處理（v2 改寫）

v1 一律剝除。v2 分兩條路，**取決於語音內容是誰決定的**：

| 路線 | 做法 | 驗證 |
|------|------|------|
| **A. 腳本鎖定（建議）** | 剝掉影片模型的原生音軌，改用我們提供逐字稿合成的語音 | G3 仍要跑，確認合成沒有漏字或唸錯 |
| **B. 原生對白** | 在 prompt 裡指定台詞，保留模型生成的語音 | **G3 必過**，ASR 回讀與腳本逐字比對 |

路線 A 剝音軌：

```bash
ffmpeg -i clip.mp4 -an -c:v copy clip_silent.mp4
```

路線 B 抽音軌驗證：

```bash
ffmpeg -i clip.mp4 -vn -acodec pcm_s16le -ar 16000 -ac 1 check.wav
```

**沒有第三條路**：讓影片模型自由生成語音、又不驗證，是 v1 當初一律剝除想避免的事，v2 沒有放寬這一點——只是把「禁止」換成「驗證」。

> 路線 B 的實務風險：多數影片模型對指定台詞的忠實度不穩定，重試率會明顯高於路線 A，而且重試的是整段影片（貴），不是語音（便宜）。**除非有特別理由，預設走 A。**

### 9.2 教師原片轉 9:16（混合式用）

原片為 16:9 時，用模糊背景填滿而非裁切，避免主體被切掉：

```bash
ffmpeg -i lecture.mp4 -filter_complex \
"[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=24[bg];\
 [0:v]scale=1080:-2[fg];\
 [bg][fg]overlay=(W-w)/2:(H-h)/2" \
-c:a copy vertical.mp4
```

### 9.3 拼接片段

```bash
ffmpeg -f concat -safe 0 -i list.txt -c:v libx264 -crf 20 -preset medium -an joined.mp4
```

### 9.4 疊旁白

```bash
ffmpeg -i joined.mp4 -i narration.wav -c:v copy -c:a aac -shortest with_audio.mp4
```

### 9.5 燒字幕（解釋層，用 ASS 控制樣式）

ASS 而非 SRT，因為需要精確控制 CJK 字級、描邊與安全區位置：

```bash
ffmpeg -i with_audio.mp4 -vf "ass=script.ass" -c:a copy subtitled.mp4
```

字幕樣式規格：

| 項目 | 規格 |
|------|------|
| 每屏字數 | **4–7 字** |
| 位置 | 下方安全區，距底部 ≥ 220px（避開手機 UI） |
| 字級 | 約 64px（1080 寬） |
| 樣式 | 白字 + 3px 黑描邊，或半透明黑底 |
| 驗收 | **靜音播放也能看懂** |

### 9.6 疊標示

```bash
ffmpeg -i subtitled.mp4 -vf \
"drawtext=fontfile=NotoSansTC-Medium.otf:text='AI 示意畫面':\
x=w-tw-28:y=28:fontsize=30:fontcolor=white@0.72:\
box=1:boxcolor=black@0.30:boxborderw=10" \
-c:a copy final.mp4
```

結尾收束字卡（第 25 秒起顯示）另用一段 `drawtext` 加 `enable='between(t,25,30)'`。

### 9.7 輸出規格

```
1080×1920 / H.264 / CRF 20 / 30fps / AAC 128k / faststart
```

---

## 10. `ShortAsset` 欄位增補

現有欄位（`courseId`、`sourceVideoId`、`jobId`、`title`、`status`、`youtubeVideoId` 等）不足以支撐本流程，需增補：

```js
// 狀態列舉增補
SHORT_ASSET_STATUSES = {
  GENERATING: 'generating',   // 非同步生成中
  ABORTED:    'aborted',      // G1 溯源驗證失敗，中止
  DRAFT:      'draft',
  READY:      'ready',
  PUBLISHED:  'published',
  ARCHIVED:   'archived',
}

// 欄位增補
{
  question: String,              // 學生原問句（槽①）
  lines: [{                      // 逐句腳本與溯源
    slot: Number,
    text: String,
    level: String,               // verbatim | corrected | rewritten | ai_added | template
    chunkIds: [String],
    approvedByTeacher: Boolean,  // level=ai_added 時必須為 true 才可發布
  }],
  primaryStartSec: Number,       // 溯源記錄用，不出現在畫面上

  // v2 新增：逐鏡的畫面驗證紀錄
  shots: [{
    shotId: String,              // S1、S2…
    profile: String,             // 'A' 帶文字 | 'B' 氛圍 | 'C' 虛擬講解員
    expectedText: String,        // profile A 必填，G2 比對的目標字串
    g2: {
      passed: Boolean,
      ocrResult: String,         // 回讀到的實際文字
      retryCount: Number,
      fellBackToProgrammatic: Boolean,   // 超過重試上限，改用程式化渲染
      verifiedAfterVideo: Boolean,       // ⑧' 複驗是否通過
    },
  }],

  // v2 新增：語音驗證紀錄
  narration: {
    mode: String,                // 'script_locked' | 'native_dialogue'
    voiceModel: String,
    g3: {
      passed: Boolean,
      asrResult: String,
      similarity: Number,        // 與腳本的字元相似度
      keyTermsAllPresent: Boolean,
      retryCount: Number,
    },
  },

  // v2 新增：虛擬講解員
  presenter: {
    enabled: Boolean,
    characterId: String,         // 同課程共用，鎖住長相
    disclosureLabel: String,     // 預設 'AI 講解員'
    impersonatesRealPerson: Boolean,   // 必須為 false 才可發布
  },

  generation: {
    imageModel: String,
    videoModel: String,
    promptVersion: String,       // 提示詞模板版本，用於追溯品質變化
    imageRetryCount: Number,
    videoClipCount: Number,
    estimatedCostUsd: Number,
  },
  reviewedBy: ObjectId,
  reviewedAt: Date,
}
```

**發布前置條件（v2 擴充）**：

1. 所有 `level === 'ai_added'` 的句子，`approvedByTeacher` 必須為 `true`
2. 所有 `profile === 'A'` 的鏡頭，`g2.passed === true` 或 `g2.fellBackToProgrammatic === true`
3. `narration.g3.passed === true` 且 `keyTermsAllPresent === true`
4. `presenter.enabled === true` 時，`impersonatesRealPerson` 必須為 `false`，且 `disclosureLabel` 非空

**連動失效**：課程或影片刪除時，對應 ShortAsset 應轉 `archived`；若已發布至 YouTube 應同步轉 private。既有 `privatizeVideoOnDelete` 已在做同樣的事，沿用相同模式。

---

## 11. 成本

單支 30 秒（含試錯，NT$ 以 1:32 概算）：

| 項目 | 用量 | 成本 |
|------|------|------|
| 生圖（含重試約 10 張） | Nano Banana | 約 NT$16 |
| 生影片 3 段 × 8 秒 | Veo 3.1 Fast | 約 NT$115 |
| 腳本、TTS | Gemini / TTS | < NT$1 |
| **全 AI 畫面合計** | | **約 NT$130** |
| **混合式合計**（只生頭尾 1 段） | | **約 NT$55** |

| 產量 | 全 AI | 混合式 |
|------|-------|--------|
| 10 支（原型） | NT$1,300 | NT$550 |
| 50 支（一門課） | NT$6,500 | NT$2,750 |

改用 Veo 3.1 Lite 可再降約三分之二，建議量產階段評估。

**務必設定用量上限與預算告警**，生成類 API 最容易失控的是失敗重試迴圈。

---

## 12. 驗收清單

**內容（G1）**
- [ ] 每句字幕都有對應的 `chunkId`
- [ ] 所有 🔴（AI 新增）句子已經老師逐句同意
- [ ] 只講了一個觀念
- [ ] 結論在前 10 秒內出現
- [ ] 最後 5 秒是收束重述，沒有導流

**畫面（G2）**
- [ ] 每個 profile A 鏡頭的 `expectedText` 與 OCR 回讀逐字相同
- [ ] 畫面上沒有預期外的文字
- [ ] **影片生成後複驗過**，首格的字沒有被改掉
- [ ] profile B 鏡頭無任何文字、標籤、商標
- [ ] 退回程式化渲染的鏡頭已記錄 `fellBackToProgrammatic`
- [ ] 有可見的 AI 生成標示
- [ ] 氛圍層低對比、不搶戲

**語音（G3）**
- [ ] ASR 回讀與腳本相似度 ≥ 0.95
- [ ] 術語、數字、時間戳**全部正確**
- [ ] 路線 A：原生音軌已剝除
- [ ] 路線 B：原生對白已通過 G3

**虛擬講解員（若使用）**
- [ ] 角落有 `AI 講解員` 標示
- [ ] 未取授課教師姓名、未模仿其長相與聲線
- [ ] 未使用真實師生的臉或聲音
- [ ] 畫面無校徽、系徽、制服標誌
- [ ] 跨支的角色長相一致

**呈現**
- [ ] 靜音播放能看懂
- [ ] 字幕未被手機 UI 遮擋
- [ ] 前 3 秒有吸引力
- [ ] 總長 25–40 秒
- [ ] 成品 normalize 到 −14 LUFS

**教師覆核（人工，不可因為有 G1–G3 就跳過）**
- [ ] 逐句看過分色標示
- [ ] **看過畫面上的字**（OCR 可能漏掉形近字與全形半形差異）
- [ ] 確認沒有斷章取義

---

## 13. 尚未確認事項

實作前需補：

**沿用 v1**

- `negativePrompt` 是否為所選模型的支援參數（§5.5）
- 生成內容用於教育場合的**授權條款**
- 生成品質的**實際重試率**（成本估算目前用保守 2 倍推估）
- 生圖模型的實際模型 ID 與 Node SDK 呼叫方式
- TTS 供應商與中文教學語音品質
- `referenceImages` 鎖風格的實際效果

**v2 新增（都是這次架構轉向帶來的）**

| 項目 | 為什麼要先確認 |
|------|----------------|
| **中文短字串的生成保真度** | 決定 profile A 到底可不可行。英文短字串已知還可以，中文未實測 |
| **圖生影片會不會改動首格文字** | 決定 ⑧' 複驗要不要做、以及重試成本 |
| **OCR 對中文的正確率** | G2 的可靠度上限就是 OCR 的可靠度。形近字與全形半形是已知盲點 |
| **G2／G3 帶來的實際重試率** | v1 的成本模型只算了紅線檢查，v2 多兩道關，**成本估算需要重算** |
| **虛擬講解員的跨支一致性** | reference 鎖角色的實際效果未知，飄掉的話十支會看起來像十個人 |
| **數位人平台的選型與價格** | 若走虛擬講解員路線，這是新增的固定成本 |
| **G3 的 ASR 中文正確率** | 相似度門檻 0.95 是拍的，要用實測校準 |

> **成本章節（§11）尚未依 v2 更新。** v2 多了兩道驗證關與可能的數位人平台費用，原本的 NT$130／支只涵蓋 v1 的流程，實測前不要拿來當預算依據。

---

## 14. 建議的第一步

**不要從寫程式開始。**

先用本規格手工做出 1–2 支：套四槽模板寫腳本、用 §5 的提示詞模板生圖、檢查紅線、生影片、剪映合成。成本約 NT$130，一個下午做得完。

這一步能實測出三件寫程式前必須知道的事：

1. §5.3 的禁止項清單在真實生成中**守不守得住**（守不住就要重寫模板，不是重寫程式）
2. 實際重試率是多少（直接修正 §11 的成本估算）
3. 成品能不能達到「30 秒教會一個觀念」（不行就要調整 §4.1 的槽位設計）

**在確認成品長相之前寫 pipeline，很可能做完才發現形式不對。**
