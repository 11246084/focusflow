# 🎬 短影音腳本模板 v4.0｜01・AI 氛圍空景＋字卡

**背景全部 AI 生成、完全不搶戲，教師不用出鏡，適合大量產出。字卡承擔資訊，背景只負責氛圍。**

**這是空白模板，不綁定任何主題。所有 `【 】` 都是待填佔位符，填完即可獨立執行，不需要搭配任何其他文件。**

---

## 0. 手法卡（固定規則，不可自行更改）

| 項目 | 內容 |
|---|---|
| 畫面主體 | AI 生成的實體隱喻空景（全片無人），字卡承擔所有精確資訊 |
| 人臉政策 | `none`：生成畫面不得出現可辨識人臉 |
| 旁白 | TTS 台灣中文女聲（腳本鎖定，原生音軌剝除） |
| 生成鏡 | 3 鏡：S1 Profile A（鉤子字卡生成進畫面）＋ S2、S3 Profile B |
| 驗證關 | G1 溯源 ✓｜G2 字面 ✓｜G3 語音 ✓ |
| 影片長度 | 30 秒 |
| 適合 | 要大量產出、老師沒空出鏡；觀念能用一個日常物件的變化講清楚 |
| 不適合 | 需要演示過程的觀念；需要老師本人可信度的內容 |
| 需要資料庫轉折句 | **需要**：鏡04 的反轉要從資料庫原句裡找 |

**開拍前必須先確認的硬條件**（每支片都要重新確認一次）：

1. 選定的生圖模型能準確渲染**中文短字串**（Profile A 的前提；英文可以不代表中文可以）
2. 圖生影片不會改動首格的字（不行的話每段都要做 G2 複驗）

---

## 1. 內容來源（實查自資料庫，動筆前必填）

```
課程：【課程名稱】（courseId: 【________________】）
學生原問句：「【原問句逐字複製】」（【日期】實際提出，問過 【_】 次）
相關問法：「【同義問法】」（【_】 次）
```

| 代號 | videoId・chunkId | 原片時間 | 原始逐字稿（STT，未修飾，原樣貼） | 要點 |
|---|---|---|---|---|
| A | 【影片標題】・`chunk_【____】` | 【___–___s】 | 「【原句】」 | 【一句話摘要】 |
| B | | | | |
| C | | | | |
| D | | | | |
| E | | | | |
| F | | | | |

**片段【＿】是這支片的鉤子來源**——【多數人以為什麼，但資料庫原句講了什麼】。

**來源規則（每一句口白都要標）**

| 等級 | 意思 | 發布前 |
|---|---|---|
| `rewritten` | 改寫片段內容，沒有新增資訊 | — |
| `verbatim` | 老師原話 | — |
| `corrected` | 老師原話，只修 STT 聽錯的字 | — |
| `template` | 反問、懸念、承接句，**不含任何觀念內容** | — |
| `ai_added` | 資料庫沒有的類比或補充 | **教師逐句勾選** |

- 口白只能改寫這些片段的內容，不可新增資料庫沒有的資訊。找不到片段支撐的句子，一律標 `template`（不給答案）或 `ai_added`（送教師勾選），不可硬編答案。
- 查片段用 `chunkId`，不要用 `segmentId`。app-owned 影片的片段，`videoId` 存的是 `String(videos._id)`。
- 逐字稿常是簡體而且有 STT 錯字（例：「雀的gp」＝ChatGPT、「济费」＝計費），**原樣貼進表格**，改寫時才修正。
- 同一支影片可能在兩門課各上傳一份，要確認 courseId 對得上，否則溯源會記到另一門課。
- 系統回答「目前資料庫片段不足以回答這個問題」的題目**不能拿來做短影音**，沒有可溯源的內容。

---

## 2. 全域設定

- **影片主題**：【＿＿＿＿】
- **核心事件**：【觀眾原本的認知 vs 實際狀況】
- **核心觀點**：【你希望觀眾最後理解什麼】
- **觀眾原本可能以為**：【＿＿＿＿】
- **觀眾看完後應該發現**：【＿＿＿＿】
- **目標受眾**：【誰會對這件事有興趣】
- **影片長度**：30 秒
- **影片語氣**：☐知識解說 ☐冷知識 ☐故事敘事 ☐其他：【＿＿】

---

## 3. 寫作順序：動筆前的 4 題

1. 我要讓觀眾「想知道什麼」？→【＿＿】
2. 我要故意延後哪個答案？→【＿＿】（留到鏡06才揭曉）
3. 中途最大的反轉是什麼？→【＿＿】（**優先從資料庫原句裡找現成的轉折**）
4. 最後觀眾應該記住哪一句話？→【＿＿】（鏡07會再講一次）

**鉤子三種公式**（本手法預設：**反常識**）

| 公式 | 做什麼 | 寫法 |
|---|---|---|
| 反常識 | 否定他相信的事 | 「你以為【X】？其實【Y】。」 |
| 錯誤警告 | 指出他正在犯的錯 | 「你在【做某事】，但【某處】可能搞錯了。」 |
| 清單預告 | 預告數量、製造缺口 | 「【主題】有【N】件事，第【N】件多數人不知道。」 |

- 口說鉤子 **3 秒內講完，約 10–14 字**，超過就是寫太長。
- 鉤子要從資料庫找得到的反差來寫，不要為了吸睛講資料庫沒有的話。

---

## 4. 視覺概念：實體隱喻三階段

全片沒有人，**觀念靠一個日常物件的狀態變化來演**。三鏡內容的變化本身就在講故事：

```
S1  【物件的完整狀態】          =  【對應的概念，例：原本的整體】
     ↓
S2  【物件被拆開／變化】        =  【對應的概念，例：處理後的樣子】
     ↓
S3  【聚焦最關鍵的那一小部分】  =  【對應的概念，例：多數人忽略的反直覺點】
```

**為什麼用這個隱喻**：【這個物件的變化為什麼貼切本主題的核心觀點】

- **新主題要換新隱喻**，不要重複用過的，避免不同影片看起來像換皮。先例：整排紙箱 → 輸送帶 → 空架（Token）
- 三鏡用同一組 `referenceImages`（S1 成品）鎖住風格，看起來才像同一支片
- **注意力由字卡與剪接點負責，不是氛圍層**。背景維持低對比、不搶戲；吸引力靠字卡動態與切鏡給

**哪些字生成、哪些字程式化**

| 字卡 | 做法 | 理由 |
|---|---|---|
| 鏡01 鉤子字卡 | **生成**（Profile A） | 靜態、單一字串、只出現一次，最適合生成 |
| 學生原問句、逐行推入、左上累積 | 程式化 | 會動、會縮小、會累積 |
| 鏡07 收束字卡 | 程式化 | 全片記憶點，寫錯等於整支白做 |

---

## 5. 分鏡（8 拍，標準敘事弧線，逐鏡填空）

---

### 鏡 01｜HOOK・鉤子（0:00–0:03）

〔畫面｜S1・Profile A〕
- `expectedText`：【鉤子字卡】（生成進畫面，上 1/3）
- 運鏡：**開場 0.4 秒鏡頭輕微下沉一次**，之後定住

〔旁白｜TTS〕
「【直接丟出核心衝突，不解釋背景。3 秒內講完，約 10–14 字】」
- 依據：【片段代號】・改寫 ／ `template`

〔字幕〕：3–10 字核心鉤子（承諾或反常識，不是問句）
〔剪輯〕：快切｜埋問題：【＿＿】
〔音效〕：開場強調 −22dB（或字卡輕點 −24dB）

> 前 3 秒同時做到三件事：打斷滑動（開場 0.5 秒內一次明顯的視覺事件）＋承諾＋好奇缺口

---

### 鏡 02｜交代（0:03–0:08）

〔畫面｜S1・Profile A（不切鏡）〕
- 程式化疊加：學生原問句小字，【＿】秒淡出

〔旁白｜TTS〕
「【事情是這樣的：交代背景。學生原問句適合放在這裡當共鳴，不要放開頭】」
- 依據：【片段代號】・改寫 ／ `template`

〔字幕〕：【＿＿】
〔剪輯〕：正常｜埋問題：【＿＿】
〔音效〕：—

---

### 鏡 03｜滿足好奇・給正解（0:08–0:13）

〔畫面｜S1・Profile A（不切鏡）〕
- 運鏡：極慢推近
- 程式化疊加：【定義字卡】上 1/3，推入 0.3s

〔旁白｜TTS〕
「【回答第一個疑問，只給一個觀念】」
- 依據：【片段代號】・改寫 ／ `template`

〔字幕〕：【＿＿】
〔剪輯〕：快切｜埋問題：【＿＿】
〔音效〕：字卡輕點 −24dB

---

### 鏡 04｜反轉（0:13–0:19）

〔畫面｜S2・Profile B（切鏡）〕
- 運鏡：【橫移，掃過拆開的物件】
- 程式化疊加：【＿＿】逐行推入

〔旁白｜TTS〕
「【改變認知，不只是「但是」。優先用資料庫原句裡現成的轉折，不要自己編】」
- 依據：【片段代號】・改寫 ／ `template`

〔字幕〕：反轉金句
〔剪輯〕：突停｜音樂抽掉一拍｜埋問題：【＿＿】
〔音效〕：低頻／靜音一拍

> 第一次 pattern interrupt 要落在 10–15 秒內（切鏡、字卡形態改變、局部放大）

---

### 鏡 05｜證據補刀（0:19–0:23）

〔畫面｜S2・Profile B（不切鏡）〕
- 程式化疊加：前一行縮小移到左上

〔旁白｜TTS〕
「【用資料庫片段裡的具體事實撐住反轉】」
- 依據：【片段代號】・改寫 ／ `template`

〔字幕〕：數字／關鍵事實
〔剪輯〕：快切｜埋問題：【＿＿】
〔音效〕：切點輕點 −26dB

> 可以在這裡埋一句微鉤子（open loop），句尾上揚 ↗，全片只用一次

---

### 鏡 06｜高潮・揭露（0:23–0:27）

〔畫面｜S3・Profile B（切鏡）〕
- 構圖：【關鍵那一小部分】單獨在畫面一側，另一側留白
- 光影：光線轉暖
- 程式化疊加：【揭露字卡】，前一行留左上

〔旁白｜TTS〕
「【揭露核心、回應鏡01的鉤子——全片最重要的一幕】」
- 依據：【片段代號】・改寫 ／ `template`

〔字幕〕：全片最重要金句
〔剪輯〕：緩推放大｜埋問題：【＿＿】
〔音效〕：情緒最高點（字卡輕點再提 2dB）

> 第二次 pattern interrupt 落在 20–25 秒

---

### 鏡 07｜結論・收束重述（0:27–0:29）

〔畫面｜S3・Profile B（不切鏡）〕
- 程式化疊加：【收束字卡】96px 中央

〔旁白｜TTS〕
「【把最反直覺的那句再講一次。不放新資訊（跨片段歸納可以）】」
- 依據：【片段代號】・改寫 ／ `template`

〔字幕〕：一句可獨立存在的觀點
〔剪輯〕：放慢｜埋問題：【＿＿】
〔音效〕：—

> 30 秒的教學靠重複建立記憶點；觀眾在第 25 秒已經準備滑走，這時給新東西等於丟掉

---

### 鏡 08｜收尾（0:29–0:30）

〔畫面｜S3・定格〕
- 最後 0.5 秒定格

〔旁白｜TTS〕
「【懸念型（反問，不給資料庫沒確認過的答案）或觀點型。不放導流 CTA】」
- 依據：【片段代號】・改寫 ／ `template`

〔字幕〕：留白收尾
〔剪輯〕：留白｜埋問題：【＿＿】
〔音效〕：尾音淡出

---

**旁白總字數建議 110–150 字**。合成後計時，超過 32 秒先縮短停頓，不要調快語速。

---

## 6. 旁白（TTS・台灣中文女聲）

**唸法標記**（分鏡的口白直接用這套寫，TTS 或真人照著唸）

| 記號 | 意思 |
|---|---|
| **粗體** | 重音。全片 4–6 個，到處都是重音等於沒有重音 |
| `／` | 短停約 0.3 秒 |
| `／／` | 長停約 0.6 秒（通常在鉤子與交代之間） |
| `↗` | 句尾上揚，留懸念，用在 open loop，全片只用一次 |
| `↘` | 句尾下沉，給結論，用在結論句與收尾 |
| 〔慢〕〔快〕 | 語速變化，作用到下一個標記為止 |

| 參數 | 值 |
|---|---|
| 語音 | **台灣中文女聲**，全系列共用同一組參數（與真人出鏡的片子形成區隔，學生一聽就知道有沒有老師本人）。不要用大陸腔語音包 |
| `speakingRate` | 1.0。教學內容**不要超過 1.15** |
| `pitch` | 0（調高會變機器感） |
| 合成方式 | **整支一次合成再切**，分段合成會有音色落差 |
| 原生音軌 | 生成影片的原生音軌一律剝除，改用本節合成的語音（腳本鎖定） |
| 環境底噪 | **必須自己加** −32dB。全生成畫面沒有環境音，只有 TTS 會像 PowerPoint 旁白 |
| 停頓 | 每張程式化字卡推入前留 `／`（0.3 秒），讓字先出現 |

```xml
<speak>
  <voice name="[台灣中文女聲]">

    <!-- 1 HOOK -->
    【鏡01口白，短停用 <break time="300ms"/>】
    <break time="500ms"/>

    <!-- 2 交代 -->
    【鏡02口白】
    <break time="500ms"/>

    <!-- 3 給正解 -->
    【鏡03口白，重音用 <emphasis level="moderate">關鍵詞</emphasis>】
    <break time="500ms"/>

    <!-- 4 反轉 -->
    【鏡04口白】
    <break time="500ms"/>

    <!-- 5 證據 -->
    【鏡05口白】
    <break time="500ms"/>

    <!-- 6 高潮 -->
    【鏡06口白】
    <break time="500ms"/>

    <!-- 7 結論 -->
    【鏡07口白】
    <break time="500ms"/>

    <!-- 8 收尾 -->
    【鏡08口白】

  </voice>
</speak>
```

- 英文專有名詞一律用 `<lang xml:lang="en-US">詞</lang>` 包起來，全片發音統一
- 停頓不能都用同一個值：短停 300ms、長停 500–600ms
- 合成後務必計時，超時先縮短 `<break>`，**不要調快語速**（英文縮寫會唸不清楚）

**TTS 最容易出錯的是英文字與數字**：專有名詞、縮寫、「五個」這種數字，合成後逐一實聽，別被唸成拼音或阿拉伯數字。

**G3 語音驗證**：ASR 回讀成品音軌、逐字比對腳本，相似度 ≥ 0.95 且關鍵詞全中才過；不過就重新合成語音，不要調門檻。關鍵詞清單：【本片的專有名詞與數字】。

---

## 7. 生成鏡 Prompt

### 生成鏡規則（本手法有生成畫面，全部適用）

**每一鏡標定一種 Profile，同一鏡不可混用**——混用會讓模型同時收到「要有字」與「不准有字」。

| Profile | 用在 | Negative | 驗證 |
|---|---|---|---|
| **A 帶指定文字** | 靜態、單一字串、只出現一次的字卡 | 排除「拼錯、亂碼、重複、多餘的字」，**不排除文字本身** | G2 必過 |
| **B 氛圍／隱喻** | 背景空景、實體隱喻 | 全面排除文字與人臉 | 人工確認無字 |

- **要動的字用程式化渲染，要跟畫面融為一體的字用生成，兩者不能兼得。** baked-in 的字不會推入、縮小、累積、淡出
- 一律程式化的三種：**收束字卡**（全片記憶點，寫錯整支白做）、數學公式、多行條列
- Profile A **一鏡只放一個字串**，兩個以上就分鏡；`expectedText` 照原樣寫進 prompt，中文不要翻譯
- `Subject` 欄位**只能填物件與場景詞彙**，禁止填課程術語或抽象概念（寫「a sentence being tokenized」模型一定會把字寫出來）

**生成流程與 G2 字面驗證**

```
① 依 Profile 展開下方 prompt
      ↓
② 生首格靜圖
      ↓
③ G2：Profile A → OCR 回讀逐字等於 expectedText、沒有多餘文字
       Profile B → 畫面沒有任何文字
      → 不過重出圖；連續 5 次不過 → 退回程式化字卡，記 fellBackToProgrammatic
      ↓
④ 圖生影片
      ↓
④' G2 複驗：抽首／中／末格再回讀一次（模型常把首格的字改掉或糊掉；推近、橫移鏡風險最高）
      ↓
⑤ 立即下載存檔（生成服務通常只保留 2 天）
```

在圖的階段重做二十次，仍比在影片階段重做一次便宜。**跳過 G2 直接生影片是最常見的浪費。**

**選模型前要問的三個問題**：能不能指定畫面內文字（不能就走不了 Profile A）？圖生影片會不會改動首格文字？語音是模型自由生成還是吃我們的稿（一律吃稿）？

### 本片三鏡

**S1（Profile A — 帶指定文字）**

```
imagePrompt: |
  A vertical 9:16 cinematic still.
  Subject: 【物件與場景詞彙，例：rows of identical plain cardboard boxes on metal shelving】
  Action/State: 【物件的狀態，例：still, dust drifting in a shaft of light】
  Setting: 【場景，例：a quiet warehouse aisle, early morning】
  Text: the exact text "【expectedText，原樣中文】" appears, cleanly rendered,
        high contrast, horizontally centred in the upper third,
        no other text anywhere in the image.
  Style: soft natural light, low contrast, muted desaturated palette,
         shallow depth of field, generous negative space in the upper and lower thirds,
         realistic photography, calm and unobtrusive
  Framing: vertical 9:16 aspect ratio, 1080x1920
  NEGATIVE: misspelled text, garbled letters, duplicated text, extra words,
            watermarks, logos, user interface elements, recognizable human faces

videoPrompt: |
  Animate this image. 8 seconds.
  Motion: 【極微小的動態，例：dust drifts slowly; objects remain static】
  Camera: slow subtle push-in
  Amplitude: minimal, gentle, natural. No abrupt movement.
  Do not add any object not present in the source image.
  Preserve all text in the source image exactly as it appears.
```

**S2（Profile B — 不帶文字）**

```
imagePrompt: |
  A vertical 9:16 cinematic still.
  Subject: 【拆開／變化中的同一物件】
  Action/State: 【物件的狀態】
  Setting: 【同一場景】
  Style: soft natural light, low contrast, muted desaturated palette,
         shallow depth of field, generous negative space in the upper and lower thirds,
         realistic photography, calm and unobtrusive
  Framing: vertical 9:16 aspect ratio, 1080x1920
  NEGATIVE: text, letters, words, numbers, digits, formulas, equations, charts, graphs,
            axes, diagrams, schematics, labels, captions, subtitles, signage, logos,
            brand marks, watermarks, user interface elements, any readable content,
            extra limbs, deformed hands, warped geometry,
            human face, recognizable person, portrait, eyes, facial features, crowd of people

videoPrompt: |
  Animate this image. 8 seconds.
  Motion: 【物件緩慢移動或排開】
  Camera: slow lateral pan
  Amplitude: minimal, gentle, natural. No abrupt movement.
  Do not add any object not present in the source image.
  Do not generate any text, numbers, charts, or human faces.
```

**S3（Profile B — 不帶文字）**

```
imagePrompt: |
  A vertical 9:16 cinematic still.
  Subject: 【單獨留下的關鍵那一小部分】
  Action/State: 【物件的狀態】
  Setting: 【同一場景，光線略轉暖】
  Style: soft natural light, low contrast, muted desaturated palette,
         shallow depth of field, generous negative space in the upper and lower thirds,
         realistic photography, calm and unobtrusive
  Framing: vertical 9:16 aspect ratio, 1080x1920
  NEGATIVE: text, letters, words, numbers, digits, formulas, equations, charts, graphs,
            axes, diagrams, schematics, labels, captions, subtitles, signage, logos,
            brand marks, watermarks, user interface elements, any readable content,
            extra limbs, deformed hands, warped geometry,
            human face, recognizable person, portrait, eyes, facial features, crowd of people

videoPrompt: |
  Animate this image. 8 seconds.
  Motion: light warms gradually; nothing else moves
  Camera: static
  Amplitude: minimal, gentle, natural. No abrupt movement.
  Do not add any object not present in the source image.
  Do not generate any text, numbers, charts, or human faces.
```

S2、S3 用 S1 成品當 `referenceImages`。

---

## 8. 配樂與音效

**配樂與音效一律自製，不用現成音樂庫。**「免費」和「不會被 Content ID 打」是兩件事——Content ID 比對音訊指紋、不看授權文件。

配樂 Prompt（自製或生成皆可，40 秒可循環）：

```
A 40-second ambient underscore for an educational short video.
No melody, no drums, no percussion, no vocals, no instruments with clear pitch.
A single sustained warm pad with slow evolving texture.
Dark, spacious, cinematic documentary feel.
Seamless loop, dynamics within 3 dB, no sections.
```

| 用途 | 做法 | 目標音量 |
|---|---|---|
| 開場強調 | 60Hz 正弦波 + 0.3 秒指數衰減 | −22dB |
| 字卡輕點 | 2–3ms 短脈衝 + 極短 reverb | −24dB |
| 切點輕點 | 同上，再低 4dB | −26dB |

**本手法的配置**

| 配樂 | 音效（最多 3 種） | 特別注意 |
|---|---|---|
| ambient pad，低頻為主 | 開場 thud、字卡輕點、切點輕點 | 全生成畫面沒有環境音，要自己加 −32dB 底噪 |

**混音**：旁白 −16 LUFS 基準、配樂 −28～−32 LUFS（旁白出現時再壓 3dB）、音效峰值不超過旁白 −6dB、**成品整體 −14 LUFS，真峰值 ≤ −1 dBTP**。沒做 loudness normalization 的片子會被平台自己壓，聽起來會悶。

- 一支片的音效種類**不超過 3 種**，多了就變綜藝節目。
- **每一個音效都要有對應的視覺事件**。多數人第一次看是靜音的，有聲沒畫面的音效等於白做。
- 禁止：鼓點強烈的 trap／EDM、任何有人聲的音樂、版權不明的流行曲。

---

## 9. 字卡與字幕

| 用途 | 字型 | 字級 | 位置 |
|---|---|---|---|
| 主字卡 | Noto Sans TC Bold | 96px | 上 1/3，在上下安全區內 |
| 逐字字幕 | Noto Sans TC Medium | 64px | 距底部 ≥ 220px，逐字同步（講到哪亮到哪） |
| 小標 | Noto Sans TC Regular | 40px | 【例：`學生提問`】 |
| 揭露標示 | Noto Sans TC Regular | 30px | 右上角 `AI 示意畫面`，**全程常駐，必做** |

- 字型授權：SIL Open Font License，商用免費、可嵌入。**不要用微軟正黑體**（系統字型，散布授權有限制）
- 樣式：白字 + 3px 黑描邊；每屏 4–7 字
- 調色：5000K、低飽和、低對比，全系列同一組最終調整
- 驗收標準：**靜音播放要能看懂**

---

## 10. 合成指令

```bash
# ① 剝除生成影片的原生音軌（旁白走腳本鎖定語音）
ffmpeg -i S1.mp4 -an -c:v copy S1_silent.mp4

# ② G2 複驗：抽首／中／末格回讀文字
ffmpeg -i S1.mp4 -vf "select='eq(n\,0)+eq(n\,120)+eq(n\,239)'" -vsync 0 S1_frame_%02d.png

# ③ 拼接（list.txt 依序列出各鏡）
ffmpeg -f concat -safe 0 -i list.txt -c:v libx264 -crf 20 -preset medium -an joined.mp4

# ④ 疊旁白與配樂
ffmpeg -i joined.mp4 -i narration.wav -i bgm.wav -filter_complex \
"[1:a]volume=1.0[v];[2:a]volume=0.12[m];[v][m]amix=inputs=2:duration=first[a]" \
-map 0:v -map "[a]" -c:v libx264 -crf 20 -c:a aac with_audio.mp4 -y

# ⑤ 燒字幕與程式化字卡
ffmpeg -i with_audio.mp4 -vf "ass=script.ass" -c:a copy subtitled.mp4

# ⑥ 疊揭露標示（必做，全片常駐）
ffmpeg -i subtitled.mp4 -vf \
"drawtext=fontfile=NotoSansTC-Regular.otf:text='AI 示意畫面':\
x=w-tw-28:y=28:fontsize=30:fontcolor=white@0.78:\
box=1:boxcolor=black@0.35:boxborderw=10" \
-c:a copy final.mp4

# ⑦ 響度標準化到 −14 LUFS
ffmpeg -i final.mp4 -af loudnorm=I=-14:TP=-1:LRA=7 -c:v copy final_norm.mp4
```

輸出規格：`1080×1920 / H.264 / CRF 20 / 30fps / AAC 128k / faststart`

---

## 11. 製作順序

```
① 填完第 1 節證據表 → G1 溯源（每句對得回 chunkId）
      ↓
② 決定視覺隱喻三階段
      ↓
③ TTS 一次合成整支旁白 → 計時 → 實聽專有名詞 → G3
      ↓
④ 生 S1 首格（Profile A）→ G2 → 圖生影片 → G2 複驗
      ↓
⑤ 以 S1 為 reference 生 S2、S3（Profile B）→ 確認無字
      ↓
⑥ 立即下載存檔
      ↓
⑦ 拼接 → 疊旁白配樂與底噪 → 燒字幕與程式化字卡 → 疊揭露標示 → normalize
      ↓
⑧ 關掉聲音看一遍，看不懂就是不合格
      ↓
⑨ 上傳到 FocusFlow
```

---

## 12. 驗收清單

**內容（G1 溯源）**
- [ ] 每一句都指得回片段 A～F，或標為 `template`／`ai_added`
- [ ] 所有 `ai_added` 句子已經教師逐句勾選
- [ ] 鏡01的鉤子與鏡06的揭曉前後呼應
- [ ] 沒有捏造資料庫沒提到的數字、名稱或細節
- [ ] 結尾反問沒有給出資料庫沒確認過的答案
- [ ] 只講了一個觀念；最後是收束重述，沒有導流字卡

**畫面（G2）**
- [ ] S1 的 `expectedText` 與 OCR 回讀逐字相同
- [ ] 影片生成後複驗過，S1 的字沒有被改掉或糊掉
- [ ] S2、S3 畫面上沒有任何文字、標籤、商標；物件上沒有長出標籤文字
- [ ] 三段畫面看起來像同一支片（referenceImages 有生效）
- [ ] 氛圍層低對比、不搶字卡
- [ ] 右上角 `AI 示意畫面` 全程常駐
- [ ] 退回程式化的鏡頭已記錄 `fellBackToProgrammatic`

**聲音（G3）**
- [ ] ASR 回讀相似度 ≥ 0.95，關鍵詞全中
- [ ] 原生音軌已剝除；有加環境底噪

**成品**
- [ ] 總長 28–32 秒
- [ ] 靜音播放能看懂
- [ ] 字幕沒被手機 UI 遮到
- [ ] 前 3 秒有明顯視覺事件
- [ ] 成品 normalize 到 −14 LUFS
- [ ] 配樂是自製那首

**發布前**
- [ ] 上傳後等 Content ID 掃完、確認無版權聲明，才按審核通過

**教師覆核（人工，不可因為有驗證關就跳過）**
- [ ] 逐句看過來源標示
- [ ] **看過畫面上的字**——OCR 可能漏掉形近字與全形半形差異
- [ ] 確認沒有斷章取義

---

## 13. 上傳與發布（FocusFlow 系統流程）

```
① 在「短影片腳本」頁找到這份腳本 →「成品上傳」分頁上傳成品
      ↓
② 系統自動以 YouTube「非公開」上傳（有連結才看得到，不會出現在搜尋與頻道頁）
      ↓
③ 等約 15 分鐘讓 Content ID 掃完，到 YouTube Studio 確認沒有版權聲明
      ↓
④ 「短影片審核」頁看片審核
     ├─ 通過 → 進修課學生的短影片牆
     └─ 退回 → 不對學生公開，影片轉私人，理由寫回腳本重新生成
```

**標題**（Shorts 會截斷，重點放前 30 字）：`【反常識結論】｜30 秒搞懂`

**描述**（三行就夠）：

```
【一句話講完核心觀點】

這支影片的內容全部出自課程逐字稿，沒有額外補充。

#FocusFlow #AI教學 #【題目標籤】
```

第二句是溯源聲明，這是相對一般 AI 影片的優勢，要講出來。hashtag **三個上限**。

**檔名**：`SV-01_【主題】_v1.mp4`、`SV-01_【主題】_v1_S1.png`

---

## 14. 一句話提醒

**背景只是襯底，注意力由字卡與剪接點負責。** 這支最容易做成「畫面很美但沒學到」——判斷標準：關掉聲音、只看字卡，邏輯要完整成立。
