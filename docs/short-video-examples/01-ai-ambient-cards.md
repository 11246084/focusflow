# 01・AI 氛圍空景 + 字卡

> 共用素材、分鏡表格式、吸引力規格、聲音規格、三道驗證關、prompt 常數見 [_shared-conventions.md](_shared-conventions.md)（v7）。本檔只寫這支片的差異。
>
> **基準款。** 背景全部 AI 生成、完全不搶戲。教師不用出鏡，適合大量產出。
>
> **v6 變更**：鉤子字卡改為**生成進畫面**（profile A），須通過 G2；會動的字卡仍為程式化渲染。

## META

```yaml
id: SV-01
presentation: ai_ambient_cards
facePolicy: none
personGeneration: dont_allow
imageModel: <依共用規範 §10 能力需求選型>
videoModel: <同上>
style: "soft natural light, low contrast, muted desaturated palette"
durationSec: 30
generatedShots: 3
liveActionShots: 0
teacherOnCamera: false
narration:
  mode: script_locked        # 剝原生音軌，用逐字稿合成
  voice: TTS（台灣中文女聲）
courseId: 69f82564736febac6db8e97b
sourceVideoId: 6a67ffd295668cc2b904f3c4
primaryStartSec: 56
chunksUsed: [chunk_0005, chunk_0006, chunk_0007]
teacherApprovalRequired: false
```

## 分鏡腳本表

「畫面」欄新增 `Profile` 標籤，A 的鏡頭要登記 `expectedText`。

| 鏡號 | 秒數 | Beat | 畫面 | 聲音 |
|------|------|------|------|------|
| S1 | 0–3s | **鉤子・反常識** | **Profile：A**（文字生成進畫面）<br>`expectedText`: `不一定是一個字`<br>景別：中景（生成）<br>運鏡：**開場 0.4s 鏡頭輕微下沉一次**，之後定住<br>構圖：貨架佔中央，字在上 1/3<br>光影：晨光斜射，低對比、低飽和 | 旁白：「一個 token／**不一定**是一個字↘」（13 字）<br>語氣：平述不催促，重音落在「不一定」；`speakingRate 1.0`<br>字幕：逐字同步（karaoke）<br>配樂：ambient pad 低頻，−30 LUFS，0.5s 淡入<br>音效：下沉瞬間低頻 thud −22dB<br>收音：無（原生音軌剝除，走腳本鎖定語音）<br>來源：`chunk_0005`・`rewritten` |
| S1 | 3–6s | 共鳴 | **Profile：A**（沿用同一張圖）<br>運鏡：靜止<br>構圖：不變<br>**程式化疊加**：學生原問句 `說明token是什麼?`，小字，6s 淡出 | 旁白：「這題有同學問過——／token 到底是什麼。」<br>語氣：平穩，略慢<br>字幕：同上<br>配樂：不變<br>音效：環境底噪 −32dB<br>收音：無<br>來源：`verbatim` + `template` |
| S1 | 6–12s | 給結論 | **Profile：A**<br>運鏡：極慢推近<br>構圖：不變<br>**程式化疊加**：`token = 把句子拆成碎片`，上 1/3，推入 0.3s（**會動，不生成**） | 旁白：「token 是把原本的一句話／**拆成碎片**之後的東西↘」<br>語氣：重音落在「拆成碎片」<br>字幕：同上<br>配樂：不變<br>音效：字卡推入輕點 −24dB<br>收音：無<br>來源：`chunk_0005`・`rewritten` |
| S2 | 12–17s | **第一次 pattern interrupt**（切鏡） | **Profile：B**（不帶文字）<br>景別：中景（生成）<br>運鏡：橫移，掃過整排切片<br>構圖：切片橫貫下 1/3，上方大留白<br>光影：高窗散射光<br>**程式化疊加**：`每一個碎片 = 一個 token`，逐行推入 | 旁白：「拆開之後／每一個碎片／都是一個 token。」<br>語氣：三個短句節奏一致<br>字幕：同上<br>配樂：不變<br>音效：切點輕點 −26dB<br>收音：無<br>來源：`chunk_0006`・`rewritten` |
| S2 | 17–20s | **Open loop** | **Profile：B**（不切鏡）<br>運鏡：續橫移<br>**程式化疊加**：第一行縮小移到左上 | 旁白：「而這件事／直接關係到你的**帳單**↗」<br>語氣：**句尾上揚，全片唯一一次**<br>字幕：同上<br>配樂：不變<br>音效：—<br>收音：無<br>來源：`chunk_0007`・`rewritten` |
| S3 | 20–26s | **第二次 pattern interrupt**（切鏡） | **Profile：B**<br>景別：中近景（生成）<br>運鏡：固定<br>構圖：單獨一小片在右，左側留白<br>光影：光線轉暖<br>**程式化疊加**：`計費方式跟 token 有關`，前一行留左上 | 旁白：「ChatGPT 和其他語言模型／計費方式基本上／都跟 token 有關↘」<br>語氣：最後一句放慢<br>字幕：同上<br>配樂：不變<br>音效：切點輕點 −26dB<br>收音：無<br>來源：`chunk_0007`・`rewritten` |
| S3 | 26–30s | **收束重述** | **Profile：B**（不切鏡）<br>運鏡：固定，最後 0.5s 定格<br>**程式化疊加**：`連句點都算一個` 96px，中央 | 旁白：「所以連最後的**句點**／都算一個 token↘」<br>語氣：〔慢〕收尾下沉，重音落在「句點」<br>字幕：同上<br>配樂：最後 1.5s 淡出<br>音效：底噪淡出<br>收音：無<br>來源：`chunk_0006`・`rewritten` |

總字數 112。**無 `ai_added` 句。**

### 哪些字生成、哪些字程式化

| 字卡 | 做法 | 理由 |
|------|------|------|
| `不一定是一個字`（鉤子） | **生成**（profile A） | 靜態、單一字串、只出現一次——最適合生成 |
| 學生原問句、逐行推入的兩行、左上累積清單 | 程式化 | **會動、會縮小、會累積**，baked-in 的字做不到 |
| `連句點都算一個`（收束） | 程式化 | 與 S1 的生成字卡同字型不同內容，避免整支只有一種字的呆板 |

**備選開場**：預設「反常識」。三種公式與來源見共用規範 §3.2。換開場時 `expectedText` 要跟著換。

## 生成鏡 Prompt

### S1（Profile A — 帶指定文字）

```
A vertical 9:16 cinematic still.
Subject: rows of identical plain cardboard boxes on metal warehouse shelving
Action/State: still, dust motes drifting in a shaft of light
Setting: a quiet warehouse aisle, early morning
Text: the exact text "不一定是一個字" appears, cleanly rendered,
      high contrast, horizontally centred in the upper third,
      no other text anywhere in the image.
Style: soft natural light, low contrast, muted desaturated palette,
       shallow depth of field, generous negative space in the upper and lower thirds,
       realistic photography, calm and unobtrusive
Framing: vertical 9:16 aspect ratio, 1080x1920
NEGATIVE: misspelled text, garbled letters, duplicated text, extra words,
          watermarks, logos, user interface elements, recognizable human faces
```

```
videoPrompt: |
  Animate this image. 8 seconds.
  Motion: dust motes drift slowly through the light shaft; boxes remain static
  Camera: slow subtle push-in
  Amplitude: minimal, gentle, natural. No abrupt movement.
  Do not add any object not present in the source image.
  Preserve all text in the source image exactly as it appears.
```

> `expectedText` 是中文，**照原樣寫進 prompt，不要翻譯**——要生成的就是那串中文。這也是共用規範 §14 列為待實測的原因。

### S2（Profile B）

```
A vertical 9:16 cinematic still.
Subject: a conveyor belt carrying plain unmarked boxes, one visible gap in the line
Action/State: belt mid-motion
Setting: an indoor distribution centre, overcast light from high windows
Style: soft natural light, low contrast, muted desaturated palette,
       shallow depth of field, generous negative space in the upper and lower thirds,
       realistic photography, calm and unobtrusive
Framing: vertical 9:16 aspect ratio, 1080x1920
NEGATIVE: text, letters, words, numbers, digits, formulas, equations, charts, graphs,
          axes, diagrams, schematics, labels, captions, subtitles, signage, logos,
          brand marks, watermarks, user interface elements, any readable content,
          extra limbs, deformed hands, warped geometry, human face, recognizable person, portrait, eyes, facial features,
                                                        crowd of people
```

```
videoPrompt: |
  Animate this image. 8 seconds.
  Motion: the belt moves slowly left to right, boxes drifting past
  Camera: slow lateral pan following the belt
  Amplitude: minimal, gentle, natural. No abrupt movement.
  Do not add any object not present in the source image.
  Do not generate any text, numbers, charts, or human faces.
```

### S3（Profile B）

```
A vertical 9:16 cinematic still.
Subject: a nearly empty shelf with two remaining boxes
Action/State: static, soft shadow pooling beneath the shelf
Setting: the same warehouse aisle, light now slightly warmer
Style: soft natural light, low contrast, muted desaturated palette,
       shallow depth of field, generous negative space in the upper and lower thirds,
       realistic photography, calm and unobtrusive
Framing: vertical 9:16 aspect ratio, 1080x1920
NEGATIVE: text, letters, words, numbers, digits, formulas, equations, charts, graphs,
          axes, diagrams, schematics, labels, captions, subtitles, signage, logos,
          brand marks, watermarks, user interface elements, any readable content,
          extra limbs, deformed hands, warped geometry, human face, recognizable person, portrait, eyes, facial features,
                                                        crowd of people
```

```
videoPrompt: |
  Animate this image. 8 seconds.
  Motion: light warms gradually across the shelf; nothing else moves
  Camera: static
  Amplitude: minimal, gentle, natural. No abrupt movement.
  Do not add any object not present in the source image.
  Do not generate any text, numbers, charts, or human faces.
```

用 S1 成品當 `referenceImages` 鎖住 S2、S3 的風格。

## 驗證紀錄

```js
shots: [
  { shotId: 'S1', profile: 'A', expectedText: '不一定是一個字',
    g2: { passed: null, ocrResult: null, retryCount: 0,
          fellBackToProgrammatic: false, verifiedAfterVideo: null } },
  { shotId: 'S2', profile: 'B', expectedText: null, g2: { passed: null } },
  { shotId: 'S3', profile: 'B', expectedText: null, g2: { passed: null } },
],
narration: {
  mode: 'script_locked',
  g3: { passed: null, similarity: null, keyTermsAllPresent: null, retryCount: 0 },
}
```

**G3 的關鍵詞清單**：`token`、`ChatGPT`、`句點`。這三個漏掉或唸錯就算不過。

## 聲音設計（全 TTS，沒有任何現場收音）

**這支片沒有真人、沒有實物聲、畫面又幾乎不動——聲音是唯一有溫度的東西。**

| 項目 | 規格 |
|------|------|
| 語音選擇 | **台灣中文女聲（定案）**，十支共用同一組參數 |
| 語速 | `speakingRate 1.0` |
| 重音配置 | 全片 3 個：`不一定`、`拆成碎片`、`帳單` |
| 停頓 | 每張程式化字卡推入前留 `／`（0.3s），讓字先出現 |
| 環境底噪 | **必須自己加** −32dB。全生成畫面沒有環境音，只有 TTS 會像 PowerPoint 旁白 |
| 配樂 | ambient pad 低頻為主，−30 LUFS |
| 音效 | 開場 thud −22dB、字卡輕點 −24dB、切鏡輕點 −26dB，三種 |
| 原生音軌 | **剝除**（走路線 A 腳本鎖定） |

### 這個知識特有的 TTS 坑

- **`token`、`ChatGPT` 是英文字**，中文 TTS 常變調或唸成拼音。合成後必須實聽
- 收束句的「句點」兩字要咬清楚，這是全片的記憶點
- 整支一次合成再切，分段合成會有音色落差

## POST

右上角固定「AI 示意畫面」標示。

**驗收（共用清單外加）**
- [ ] S1 的 `expectedText` 與 OCR 回讀逐字相同
- [ ] **影片生成後複驗過**，S1 的字沒有被改掉或糊掉
- [ ] S2、S3 畫面上沒有任何文字
- [ ] 三段畫面看起來像同一支片（`referenceImages` 有生效）
- [ ] 紙箱上沒有長出標籤文字
- [ ] G3 的三個關鍵詞全中
- [ ] 每一列的「來源」欄都有值，chunkId 存在於 `video_segments_text`
