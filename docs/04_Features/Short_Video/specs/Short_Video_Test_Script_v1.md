# 短影音測試腳本 v2（單支・完整版）

**這是一份可以獨立執行的完整腳本，不需要搭配任何其他文件。**

**全片零真人參與**——不出鏡、不真人配音、不自己做音樂。動態背景、快節奏、對照結構、結尾留問題。

- 版本：v3（2026-08-14）
- 片名代號：`SV-TEST-01`
- 長度：30 秒｜9:16｜1080×1920

> **v3 變更**：全部改成生成——旁白用語音模型（附完整 SSML）、配樂與音效用 AI 音樂模型（附 prompt）、合成一律用 FFmpeg。文件裡不再有任何二選一。
>
> **v2 變更**：背景改成全片持續流動的光粒子；prompt 拆出 `Lighting:`／`Background:`／`Motion:` 欄位。

---

## 0. 先搞清楚：一個 prompt 生不出整支影片

**這件事必須先講，否則後面的流程會看不懂。**

目前沒有任何模型能用一個 prompt 產出「30 秒 + 中文旁白 + 逐字字幕 + 配樂」的完整影片。實際上要四種工具分開做：

| 步驟 | 用什麼 | 產出 | 本文件對應 |
|------|--------|------|-----------|
| ① 生圖 | 文字→圖（**要能寫中文字**） | 3 張靜圖 | §5 的 `imagePrompt` |
| ② 生影片 | 圖→影片，8 秒，**無聲** | 3 段影片 | §5 的 `videoPrompt` |
| ③ 配音 | **語音模型**（無真人） | 1 條旁白音檔 | §6 |
| ④ 配樂與音效 | **AI 音樂模型**（無真人） | 1 條背景音 + 3 個音效 | §7 |
| ⑤ 合成 | **FFmpeg** | 成品 | §9 |

**第 ⑤ 步的字幕、字卡、分割畫面都是在這裡疊上去的**，不是生成出來的。這是刻意的——生成模型寫字會錯，疊上去的字不會。

---

## 1. 這支片要證明什麼

**它不是成品，是測試件。** 做完要能回答五個問題：

| # | 要驗證的事 | 怎麼判斷 |
|---|-----------|----------|
| 1 | 生圖模型的**中文字**準不準 | S1、S2 的字有沒有逐字正確 |
| 2 | 圖生影片會不會**把字改掉** | 影片首格與末格的字有沒有變 |
| 3 | **全生成**的影片，30 秒能不能講懂一個觀念 | 給沒學過的人看，問他 token 是什麼 |
| 4 | 快節奏 + 動態背景**會不會蓋掉內容** | 同上，看他記不記得住 |
| 5 | 實際**要花多少錢、多少時間** | 記錄重試次數與總工時 |

**第 1 項最關鍵。** 中文字生成不準的話，整套「把字生進畫面」的設計就要退回用疊字。

---

## 2. 內容來源（全部實查自資料庫）

```
課程：影像處理導論（courseId: 69f82564736febac6db8e97b）
影片：aiA10_1140123_2（videoId: 6a67ffd295668cc2b904f3c4）
學生原問句：「說明token是什麼?」（2026-07-28 實際提出）
```

腳本只能用下面三個片段的內容，**不可新增資料庫沒有的資訊**：

| 代號 | chunkId | 原片時間 | 要點 |
|------|---------|----------|------|
| B | `6a67ffd295668cc2b904f3c4_chunk_0005` | 56.18–68.04s | token 是把原本的句子拆成碎片化之後的東西 |
| C | `6a67ffd295668cc2b904f3c4_chunk_0006` | 68.14–90.8s | 拆開後每一個碎片都是 token，**包含最後的句點** |
| D | `6a67ffd295668cc2b904f3c4_chunk_0007` | 90.9–110.17s | 不只 ChatGPT，其他語言模型的計費方式也都跟 token 有關 |

**「連句點都算一個」是這個題目天生的鉤子**——幾乎所有人第一次都以為一個 token 就是一個字。

---

## 3. 視覺概念：流動的光

**全片是暗場加上持續流動的暖色光粒子。** 三個場景是同一條光的演變：

```
S1  一條連續不斷的光帶        =  一整句話
     ↓
S2  光帶斷成五段，緩緩分開     =  被拆成 token
     ↓
S3  最小的那一段單獨發亮       =  句點
```

**為什麼用這個而不是實體物件**

- **持續有運動**。粒子一直在流，畫面不會有一秒是死的
- **暗背景讓字最跳**。白字疊在暗場上對比最高，手機上也讀得清楚
- **概念直接對應**。連續 → 斷開 → 剩一小段，物理上就是「拆成碎片」
- **不可能自己長出文字**。這點很重要，我們要驗證的是「指定的那串字」準不準，畫面多出別的字會讓驗證失效

**要特別防的一件事**：斷開的光帶模型很容易排成字母或摩斯電碼。所有 prompt 的 negative 都有針對性排除，出圖後要檢查。

---

## 4. 分鏡腳本表

**一列 = 一個視覺變化點。** 全片 8 個變化點，平均 3.75 秒一次。

**背景全程在動**，變化點指的是「構圖或疊加物的改變」，不是「畫面才開始動」。

### 唸法標記

| 記號 | 意思 |
|------|------|
| **粗體** | 重音 |
| `／` | 短停 0.3 秒 |
| `／／` | 長停 0.6 秒 |
| `↗` | 句尾上揚（留懸念） |
| `↘` | 句尾下沉（給結論） |
| `〔慢〕` | 放慢 |

### 表

| # | 秒數 | Beat | 畫面 | 聲音 |
|---|------|------|------|------|
| 1 | 0–3s | **鉤子・錯誤警告** | 素材：**S1**（生成，帶文字）<br>景別：中景<br>運鏡：極慢推近<br>背景：一條連續的暖色光帶橫貫畫面中央，粒子沿著光帶流動<br>光影：單一光源由上方打下，四周全暗，光帶本身是唯一亮源<br>字在上 1/3<br>疊加：**第 2.0 秒一個紅色 ✕ 重重落下**，蓋在字上（全片唯一的紅色） | 旁白：「多數人以為／一個 token 就是**一個字**↘」<br>語氣：陳述，不指責。**不要唸成質問**<br>字幕：逐字同步<br>配樂：0.5s 淡入，−30 LUFS<br>音效：✕ 落下時低頻 thud −22dB，與畫面同格 |
| 2 | 3–7s | 共鳴 + 埋問題 | 素材：S1（不換素材）<br>運鏡：**局部放大 110%**（這是切點，不用新素材）<br>背景：光帶持續流動<br>疊加：`一個 token 一個字` 縮小移到左上，✕ 跟著縮小 | 旁白：「有同學問過我這題。／／如果一個字就是一個 token／那中文的『今天』／算一個還兩個？」<br>語氣：平述提問，不帶情緒<br>音效：環境底噪 −32dB<br>來源：`template`（**反問，不給答案**） |
| 3 | 7–11s | 給正解（切素材） | 素材：**S2**（生成，帶文字）<br>景別：同 S1 機位<br>運鏡：固定<br>背景：光帶已斷成五段，段與段之間有暗隙，各段緩緩漂移<br>光影：同 S1，五段各自發光<br>字在上 1/3（**與 S1 的字同位置**）<br>疊加：右上 ✓ 記號（白色，**不給音效**） | 旁白：「都不是。／token 是把一句話／**拆成碎片**之後／每一個碎片。」<br>語氣：先否定再給定義，「都不是」講完停 0.3 秒<br>音效：切點輕點 −26dB |
| 4 | 11–15s | **上下分割對照** | 素材：S1 + S2 上下併排（§9 有指令）<br>構圖：各半區 1080×960<br>光影：**上半亮度壓低 20%**<br>疊加：上半 `✕ 一個字`／下半 `✓ 一個碎片`，各半區左上 | 旁白：「一個是字／一個是碎片。／／差在哪？」<br>語氣：兩句對仗，節奏一致；問句留半拍<br>音效：分割瞬間輕點 −26dB |
| 5 | 15–19s | **Open loop** | 素材：維持分割<br>運鏡：**上半淡出，只留下半**（形態變化，不用新素材）<br>背景：下半的光段持續漂移<br>疊加：左上小字保留 | 旁白：「而且還有一個東西／根本**不是字**／但它也算↗」<br>語氣：**句尾上揚，全片唯一一次**；講完停 0.4 秒 |
| 6 | 19–23s | 揭曉（切素材） | 素材：**S3**（生成，不帶文字）<br>景別：中近景<br>運鏡：固定<br>背景：五段光裡**最小的那一段留在中央發亮**，其餘四段退到邊緣變暗<br>光影：中央那段有微微脈動<br>疊加：`。也算一個` 96px，中央 | 旁白：「就是最後那個**句點**。／／它不是字／但它是一個 token。」<br>語氣：「句點」單獨咬清楚，前後各留短停<br>音效：字卡輕點 −24dB |
| 7 | 23–27s | 補上實用價值 | 素材：S3（不換素材）<br>運鏡：**極慢拉遠**<br>背景：五段光重新亮起、亮度趨於均等<br>疊加：`計費算的就是這個`，上 1/3 | 旁白：「ChatGPT 和其他語言模型／計費算的／就是這些碎片。」<br>語氣：平述收束<br>音效：— |
| 8 | 27–30s | **收束重述 + 問題** | 素材：S3，最後 1 秒定格<br>背景：光段緩緩靜止<br>疊加：`連句點都算一個` 96px 中央 → 最後 1 秒換成 `今天 = 幾個？` | 旁白：「所以連句點／都算一個 token。／／那『今天』兩個字／算幾個？」<br>語氣：〔慢〕重述下沉、問句上揚收尾<br>配樂：最後 1.5s 淡出<br>音效：底噪淡出 |

**旁白總字數 152 字。** 一般口播語速約 30 秒，**合成完要計時**，超過 32 秒就縮短 `<break>` 的值。

### 溯源對照（每一句都要對得回資料庫）

| # | 出處 |
|---|------|
| 1、3、4 | `chunk_0005`・改寫 |
| 2 | `template`——反問，不帶教學內容 |
| 5、6、8 前半 | `chunk_0006`・改寫 |
| 7 | `chunk_0007`・改寫 |
| 8 後半 | `template`——反問 |

**「今天算一個還兩個」全片出現兩次，都是反問、都不給答案**——因為資料庫沒講。給了答案就是編的。

### 節奏設計

**8 個變化點，只用 3 段生成素材。** 中間靠局部放大、上下分割、淡出、拉遠做出切點。測試階段先確認流程可行，不要一開始就把成本堆在生成上。

**切點都落在句子之間，不要切在句中。** 切在句中會讓人覺得急躁，不是明快。

---

## 5. 生成素材 Prompt

**三張都要做，不是三選一。** 每張圖各生一段 8 秒影片，共 3 段。

### S1 — 連續的光帶（帶文字）

```
imagePrompt:
A vertical 9:16 abstract cinematic still.
Subject: a single continuous horizontal ribbon of warm amber light suspended in darkness,
         made of countless fine glowing particles flowing along its length
Background: pure darkness, no floor, no horizon, no objects, deep black falling off
            toward all edges
Lighting: the light ribbon is the only light source in frame; a faint soft glow
          spills onto the surrounding darkness; no other light source
Text: the exact text "一個 token 一個字" appears, cleanly rendered in bright white,
      high contrast against the dark background, horizontally centred in the upper third,
      no other text anywhere in the image.
Style: cinematic, low key, deep blacks, soft bloom, muted warm palette,
       generous negative space in the upper and lower thirds
Framing: vertical 9:16 aspect ratio, 1080x1920
NEGATIVE: misspelled text, garbled letters, duplicated text, extra words,
          light forming letters or shapes, morse code pattern,
          watermarks, logos, user interface elements, recognizable human faces
```

```
videoPrompt:
Animate this image. 8 seconds.
Motion: the glowing particles flow steadily along the ribbon from left to right;
        the ribbon itself stays in place and stays unbroken;
        faint particles drift in the surrounding darkness
Camera: very slow push-in
Amplitude: continuous and smooth, never abrupt
Do not add any object not present in the source image.
Preserve all text in the source image exactly as it appears.
```

### S2 — 斷成五段（帶文字，與 S1 同機位）

```
imagePrompt:
A vertical 9:16 abstract cinematic still.
Subject: the same ribbon of warm amber light, now broken into five separate segments
         with dark gaps between them, the segments clearly different lengths,
         the rightmost one much smaller than the others
Background: pure darkness, identical to the reference image
Lighting: identical to the reference image; each segment glows on its own
Text: the exact text "拆成碎片的每一塊" appears, cleanly rendered in bright white,
      high contrast against the dark background, horizontally centred in the upper third,
      in the same position and at the same size as in the reference image,
      no other text anywhere in the image.
Style: cinematic, low key, deep blacks, soft bloom, muted warm palette,
       generous negative space in the upper and lower thirds
Framing: vertical 9:16 aspect ratio, 1080x1920
NEGATIVE: misspelled text, garbled letters, duplicated text, extra words,
          light forming letters or shapes, morse code pattern,
          watermarks, logos, user interface elements, recognizable human faces
```

```
videoPrompt:
Animate this image. 8 seconds.
Motion: each segment drifts very slowly apart from the others,
        widening the dark gaps; particles keep flowing within each segment
Camera: static
Amplitude: continuous and smooth, never abrupt
Do not add any object not present in the source image.
Preserve all text in the source image exactly as it appears.
```

> **S2 要用 S1 的成品當 reference image**，鎖住機位、光線與文字位置。第 4 個變化點要把兩段上下併排，**位置對不齊就不像對照表**。

### S3 — 最小那一段（不帶文字）

```
imagePrompt:
A vertical 9:16 abstract cinematic still.
Subject: five segments of warm amber light; the smallest segment is centred in frame
         and glowing brightly, the other four are dimmed and pushed toward the edges
Background: pure darkness, identical to the reference image, edges slightly warmer
Lighting: the central small segment is the brightest point in frame;
          the dimmed segments give only a faint residual glow
Style: cinematic, low key, deep blacks, soft bloom, muted warm palette,
       generous negative space in the lower third
Framing: vertical 9:16 aspect ratio, 1080x1920
NEGATIVE: text, letters, words, numbers, digits, formulas, equations, charts, graphs,
          axes, diagrams, schematics, labels, captions, subtitles, signage, logos,
          brand marks, watermarks, user interface elements, any readable content,
          light forming letters or shapes, morse code pattern,
          human face, recognizable person, portrait, eyes, facial features
```

```
videoPrompt:
Animate this image. 8 seconds.
Motion: the central small segment pulses very gently;
        the dimmed segments slowly brighten back toward even intensity
Camera: very slow pull-back
Amplitude: continuous and smooth, never abrupt
Do not add any object not present in the source image.
Do not generate any text, numbers, charts, or human faces.
```

---

## 6. 旁白：語音模型合成

**全片沒有任何真人參與，旁白用語音模型生成。**

但**不能聽起來像機器**——全片沒有人出鏡，聲音是唯一有溫度的東西，一有機器感整支會變成「PowerPoint 自動播放」。

所以這一節的重點不是「怎麼合成」，是**怎麼合成得不像機器**。

### 選什麼樣的語音模型

| 條件 | 為什麼 |
|------|--------|
| **有呼吸與換氣建模** | 這是機器感最大的來源。完全沒有氣音的語音，聽三秒就知道是合成的 |
| **支援 SSML 的 `break` 與 `emphasis`** | 沒有這兩個就做不出停頓長短與重音差異 |
| **台灣中文女聲** | 不要用大陸腔語音包 |
| **能穩定唸英文詞** | `token`、`ChatGPT` 出現多次，唸法必須一致 |

**傳統的參數式／拼接式 TTS 不要用**——那種語音無論怎麼調參數都會有機器感，問題在架構不在設定。

### 四個機器感來源，逐一對治

| 來源 | 怎麼避開 |
|------|----------|
| **語速固定不變** | 第 8 點用 `<prosody rate="90%">` 放慢，其餘維持 100% |
| **完全沒有換氣聲** | 選有呼吸建模的模型；`／／` 處用 `<break time="600ms"/>` 給它換氣的空間 |
| **句尾一律下沉** | 第 5 點結尾必須上揚（用 `↗` 對應的問句語氣），其餘下沉 |
| **停頓長度都一樣** | `／` 用 300ms、`／／` 用 600ms，**不可以都用同一個值** |

### 直接可用的 SSML

以下整段複製，**一次合成完整支，不要分段合成再拼接**——分段會有音色落差。

```xml
<speak>
  <voice name="[台灣中文女聲]">

    <!-- 1  鉤子 -->
    多數人以為<break time="300ms"/>一個 <lang xml:lang="en-US">token</lang> 就是<emphasis level="moderate">一個字</emphasis>。
    <break time="600ms"/>

    <!-- 2  共鳴 + 埋問題 -->
    有同學問過我這題。<break time="600ms"/>
    如果一個字就是一個 <lang xml:lang="en-US">token</lang><break time="300ms"/>
    那中文的「今天」<break time="300ms"/>算一個還兩個？
    <break time="600ms"/>

    <!-- 3  給正解 -->
    都不是。<break time="300ms"/>
    <lang xml:lang="en-US">token</lang> 是把一句話<break time="300ms"/>
    <emphasis level="moderate">拆成碎片</emphasis>之後<break time="300ms"/>每一個碎片。
    <break time="600ms"/>

    <!-- 4  對照 -->
    一個是字<break time="300ms"/>一個是碎片。<break time="600ms"/>差在哪？
    <break time="600ms"/>

    <!-- 5  Open loop：全片唯一上揚 -->
    而且還有一個東西<break time="300ms"/>
    根本<emphasis level="moderate">不是字</emphasis><break time="300ms"/>但它也算？
    <break time="400ms"/>

    <!-- 6  揭曉 -->
    就是最後那個<emphasis level="moderate">句點</emphasis>。<break time="600ms"/>
    它不是字<break time="300ms"/>但它是一個 <lang xml:lang="en-US">token</lang>。
    <break time="600ms"/>

    <!-- 7  實用價值 -->
    <lang xml:lang="en-US">ChatGPT</lang> 和其他語言模型<break time="300ms"/>
    計費算的<break time="300ms"/>就是這些碎片。
    <break time="600ms"/>

    <!-- 8  收束重述 + 問題（放慢） -->
    <prosody rate="90%">
      所以連句點<break time="300ms"/>都算一個 <lang xml:lang="en-US">token</lang>。
      <break time="600ms"/>
      那「今天」兩個字<break time="300ms"/>算幾個？
    </prosody>

  </voice>
</speak>
```

### 三個關鍵處理

**英文詞用 `<lang xml:lang="en-US">` 包起來。** `token` 與 `ChatGPT` 是這支片最容易唸壞的地方——中文語音模型常唸成拼音或變調。用 `lang` 標籤強制走英文發音，而且**全片統一這樣處理**，前後唸法才會一致。

**第 5 點結尾寫成問句（`但它也算？`）而不是句號。** 這是為了讓模型自然做出上揚語調——直接標 `↗` 語音模型讀不懂，改寫成問句最可靠。這是**唸法處理，不是改內容**，字幕仍照原句顯示。

**重音全片只有 5 個**：`一個字`、`拆成碎片`、`不是字`、`句點`、`token`（第 8 點靠 `prosody` 放慢帶出來）。到處都加重等於沒有重音，而且 `emphasis` 用太多反而更像機器。

### 合成後一定要做的三件事

1. **實聽 `token` 與 `ChatGPT`**——這兩個字唸壞的機率最高。不對就換語音或改用 `<phoneme>` 指定發音
2. **計時**——目標 30 秒。超過 32 秒就把 `<break>` 的值各減 100ms，不要調語速
3. **找一個沒看過腳本的人聽**，問他覺不覺得是 AI 唸的。**這是這支片的驗收項之一**

### 後製

| 項目 | 規格 |
|------|------|
| 濾波 | HPF 80Hz |
| 齒音 | de-esser 輕壓 |
| 正規化 | 旁白軌 −16 LUFS |
| 禁止 | **不要加降噪**——合成語音本來就沒有噪音，加了會出現水下感 |

---

## 7. 配樂與音效

**配樂與音效一律用 AI 音樂模型生成**，不用現成音樂庫、不自己錄。

**配樂不能寫在生圖或生影片的 prompt 裡**，是獨立的一步。

### 配樂 Prompt

```
A 40-second ambient underscore for an educational short video.
No melody, no drums, no percussion, no vocals, no instruments with clear pitch.
A single sustained warm pad with slow evolving texture.
Dark, spacious, cinematic documentary feel.
Consistent volume throughout, no build-up, no drop, no ending flourish.
Seamlessly loopable.
```

**產出後要檢查三件事**：

- 有沒有出現旋律（有的話重生成，或把 `no melody` 加重）
- 音量起伏是不是 ≤ 3dB（起伏太大會跟旁白打架）
- 40 秒尾端接回開頭順不順（我們只用 30 秒，但留 10 秒緩衝比較好剪）

### 三個音效的 Prompt

一支片的音效**不超過三種**，種類一多就變成綜藝節目。

| 用途 | 出現時機 | Prompt | 目標音量 |
|------|----------|--------|----------|
| 開場 thud | 第 2.0 秒，紅色 ✕ 落下 | `A single deep low-frequency thud, around 60Hz, short decay under half a second, no reverb tail, no musical pitch, cinematic impact` | −22dB |
| 字卡輕點 | 字卡出現時 | `A single very short soft click, like a light UI tap, 2 to 3 milliseconds, minimal reverb, neutral tone, no musical pitch` | −24dB |
| 切點輕點 | 畫面切換時 | 同上，混音時再壓低 4dB | −26dB |

### 授權：這一項要先確認

**用 AI 生成的音樂與音效，要先讀該服務的授權條款**，特別是：

- 產出物**可不可以商用**
- 可不可以**上傳到 YouTube**
- 有沒有**署名義務**
- 產出物的權利歸誰

**這一項各家差很多，不能假設「我生成的就是我的」。** 確認後把條款頁截圖存檔，跟生成日期一起留著。

### 為什麼不能用有旋律的音樂

**有旋律的音樂會跟旁白搶語言處理區**，學生會覺得聽起來累但說不出為什麼。這支片只需要「不空」，不需要好聽。

所以 prompt 裡的 `no melody, no drums, no vocals, no instruments with clear pitch` 是硬性條件，不是風格偏好。

### 為什麼不用免費音樂庫

**「免費」和「不會被 Content ID 打」是兩件事。** Content ID 靠音訊指紋比對，不看授權文件——曲目被第三方註冊過，拿著合法授權一樣會被聲明。

AI 生成的音軌沒有指紋在庫裡，這一點比免費音樂庫安全。**但仍然要做上傳前預檢**（見 §10 最後一步）。

### 混音

| 軌 | 音量 |
|----|------|
| 旁白 | 基準，−16 LUFS |
| 配樂 | −30 LUFS（旁白出現時再壓 3dB） |
| 音效 | 峰值不超過旁白 −6dB |
| **成品整體** | **−14 LUFS**，真峰值 ≤ −1 dBTP |

沒做 loudness normalization 的片子上 Shorts 會被平台自己壓，壓完聽起來會悶。

---

## 8. 字卡與字幕

| 用途 | 字型 | 字級 | 位置 |
|------|------|------|------|
| 主字卡 | **Noto Sans TC Bold** | 96px | 依分鏡表 |
| 逐字字幕 | **Noto Sans TC Medium** | 64px | 距底部 ≥ 220px（避開手機 UI） |
| 左上小標 | **Noto Sans TC Regular** | 40px | 左上 |

- 字型授權：SIL Open Font License，**商用免費、可嵌入**
- 樣式：白字 + 3px 黑描邊（暗背景上其實描邊可以更細，實際看成品調）
- 字幕同步：**逐字（karaoke 式）**，講到哪個字亮哪個字
- 每屏 4–7 字

**驗收標準：靜音播放要能看懂。** 多數人第一次看是靜音的。

**紅色全片只用一次**（第 1 個變化點的 ✕）。用第二次就失效了。✓ 用白色，**不給音效**——給了會變成遊戲的「答對了」音，太輕浮。

---

## 9. 合成指令

剝掉生成影片的原生音軌（**必做**，模型會自己配上資料庫沒有的旁白）：

```bash
ffmpeg -i s1.mp4 -an -c:v copy s1_silent.mp4
```

上下分割（第 4、5 個變化點用）：

```bash
ffmpeg -i s1_silent.mp4 -i s2_silent.mp4 -filter_complex \
"[0:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,eq=brightness=-0.08[top];\
 [1:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[bot];\
 [top][bot]vstack=inputs=2" \
-an split.mp4
```

`eq=brightness=-0.08` 就是上半壓暗 20%。

拼接：

```bash
ffmpeg -f concat -safe 0 -i list.txt -c:v libx264 -crf 20 -preset medium -an joined.mp4
```

疊旁白 + 配樂（兩軌混）：

```bash
ffmpeg -i joined.mp4 -i narration.wav -i bgm.wav -filter_complex \
"[1:a]volume=1.0[v];[2:a]volume=0.12[m];[v][m]amix=inputs=2:duration=first[a]" \
-map 0:v -map "[a]" -c:v copy -c:a aac with_audio.mp4
```

燒字幕（用 ASS 而非 SRT，需要精確控制 CJK 字級與描邊）：

```bash
ffmpeg -i with_audio.mp4 -vf "ass=script.ass" -c:a copy subtitled.mp4
```

疊「AI 示意畫面」標示（**含生成畫面必做**）：

```bash
ffmpeg -i subtitled.mp4 -vf \
"drawtext=fontfile=NotoSansTC-Medium.otf:text='AI 示意畫面':\
x=w-tw-28:y=28:fontsize=30:fontcolor=white@0.72:\
box=1:boxcolor=black@0.30:boxborderw=10" \
-c:a copy final.mp4
```

**用 FFmpeg，不要用剪輯軟體。** 這支是測試件，要產出可比較的數字——上半壓暗 20%、配樂 −30 LUFS、成品 −14 LUFS 這些值用眼睛調不準，下次重做也複製不回來。指令貼上去就好，不需要會寫程式。

輸出規格：`1080×1920 / H.264 / CRF 20 / 30fps / AAC 128k / faststart`

---

## 10. 製作順序

```
① 合成旁白（先做，時長決定畫面怎麼切）
      ↓
② 生成配樂與三個音效
      ↓
③ 生 S1、S2、S3 三張圖
      ↓
④ 檢查文字 ★  S1 是不是「一個 token 一個字」？S2 是不是「拆成碎片的每一塊」？
              有沒有多出別的字？光有沒有排成字母或摩斯電碼？S3 有沒有長出字？
      → 不對就重出圖（一張約 NT$1.5，很便宜）
      → 重試 5 次還不對 → 放棄生成文字，改用疊字卡
      ↓
⑤ 生三段影片（圖生影片，8 秒，無聲）
      ↓
⑥ 再檢查一次文字 ★  影片的首格與末格，字有沒有被改掉或糊掉？
      ↓
⑦ 立即下載存檔 ❗（生成服務通常只保留 2 天，只存連結等於沒存）
      ↓
⑧ 剝音軌 → 分割 → 拼接 → 疊旁白配樂 → 燒字幕 → 疊標示
      ↓
⑨ 聽一次成品 ★  旁白有沒有唸錯「token」「ChatGPT」「句點」？
      ↓
⑩ 先以 unlisted 上傳 YouTube，等 15 分鐘看有沒有版權聲明，再改可見度
```

**第 ④ 關是成本核心。** 一張圖約 NT$1.5、一段 8 秒影片約 NT$40——**在圖的階段重做二十次，還是比在影片階段重做一次便宜。**

---

## 11. 驗收清單

**內容**
- [ ] 每一句都指得回 `chunk_0005`／`0006`／`0007`，或標為 `template`
- [ ] 「今天算一個還兩個」兩次都是**反問，沒有給答案**
- [ ] 只講了一個觀念
- [ ] 結尾是收束重述 + 問題

**畫面**
- [ ] S1 的字是 `一個 token 一個字`，逐字正確
- [ ] S2 的字是 `拆成碎片的每一塊`，逐字正確
- [ ] **影片生成後再確認一次**，兩段的字都沒被改掉
- [ ] S1 與 S2 機位、光線、文字位置一致（上下併排時對得齊）
- [ ] S3 畫面上沒有任何文字
- [ ] **光沒有排成字母、摩斯電碼或任何可讀圖案**
- [ ] 全片沒有出現人臉
- [ ] 背景全程都在動，沒有一秒是死的
- [ ] 紅色只用一次；✓ 是白色且無音效
- [ ] 右上角有「AI 示意畫面」標示

**聲音**
- [ ] **聽起來不像機器**（給第三人聽，問他覺不覺得是 AI 唸的）
- [ ] `token`、`ChatGPT`、`句點` 三個詞都唸對
- [ ] 有換氣聲，`／` 與 `／／` 的停頓長短有差別
- [ ] 生成影片的原生音軌確實剝掉了
- [ ] 配樂無旋律、無節拍、全程音量平穩
- [ ] 成品 normalize 到 −14 LUFS

**成品**
- [ ] 總長 28–32 秒
- [ ] 靜音播放能看懂
- [ ] 字幕沒被手機 UI 遮到
- [ ] 前 3 秒有明顯的視覺事件
- [ ] 切點都落在句子之間，沒有切在句中

**發布前**
- [ ] 已用 unlisted 上傳、等 Content ID 掃完、確認無版權聲明

---

## 12. 做完之後要記錄的數字

| 項目 | 實際值 |
|------|--------|
| S1 出圖幾次才對？ | |
| S2 出圖幾次才對？ | |
| 光有沒有排成字母？發生幾次？ | |
| 影片階段有沒有把字改掉？ | |
| 生圖總花費 | |
| 生影片總花費 | |
| 旁白合成幾次才過 | |
| 從開始到成品的總工時 | |
| 給 3 個沒學過的人看，幾個講得出 token 是什麼 | |
| 幾個人覺得旁白是 AI 唸的 | |

**最後兩項最重要。** 前面那些是成本，這兩項是這支片到底有沒有用。

---

## 13. 一句話提醒

**這支片的內容全部來自課程逐字稿，沒有補充任何外部知識。** 這是它跟一般 AI 影片的差別，也是唯一不能妥協的地方——**畫面可以生成、聲音可以合成，但講的內容必須追得回資料庫。**
