# 10・抽象隱喻

> 共用素材、分鏡表格式、吸引力規格、聲音規格、三道驗證關、prompt 常數見 [_shared-conventions.md](_shared-conventions.md)（v7）。本檔只寫這支片的差異。
>
> 把概念翻成物理現象——不叫模型畫「一句話被拆開」，叫它畫「一條連續的光帶斷成一段一段」。
>
> **v6 變更**：v5 時代這支的難點是「要講關於文字的觀念，畫面卻不准出現文字」。**v6 開放之後這個矛盾解掉了一半**——鉤子與核心字卡改為生成（profile A），但**隱喻鏡本身仍然維持 profile B**，理由見下方。

## META

```yaml
id: SV-10
presentation: abstract_metaphor
facePolicy: none
personGeneration: dont_allow
style: "soft natural light, low contrast, muted desaturated palette" 低調暗部版
durationSec: 30
generatedShots: 4
liveActionShots: 0
teacherOnCamera: false
narration: TTS（台灣中文女聲）
estimatedCostTwd: 130
courseId: 69f82564736febac6db8e97b
sourceVideoId: 6a67ffd295668cc2b904f3c4
primaryStartSec: 56
chunksUsed: [chunk_0005, chunk_0006, chunk_0007]
retryRisk: high              # 抽象光帶最容易自己排成字母
teacherApprovalRequired: true # 有 ai_added 句
```

> **核心技巧**：`Subject` 欄位只能填**物件與場景詞彙**，禁止填課程術語或抽象概念。
>
> - ❌ `Subject: a sentence being tokenized` ← 概念，模型一定會把字寫出來
> - ✅ `Subject: a continuous ribbon of warm light breaking into separate segments` ← 畫面

## 分鏡腳本表

隱喻型的口播必須**明講隱喻對應什麼**，否則學生只覺得畫面很美但不知道在講什麼。

| 鏡號 | 秒數 | Beat | 畫面 | 聲音 |
|------|------|------|------|------|
| S1 | 0–3s | **鉤子・反常識** | **Profile：A**<br>`expectedText`: `不是一個字`<br>景別：抽象中景（生成）<br>運鏡：極慢推近<br>構圖：一條連續的暖色光帶橫貫畫面中央，四周暗場，字在上 1/3<br>光影：單一光源，低調暗部，muted<br>**注意**：本片畫面極暗，**生成的字要夠亮才讀得到**，prompt 要明寫 high contrast | 旁白：「一個 token／**不一定**是一個字。」<br>語氣：〔慢〕全片語速最慢，TTS `speakingRate 1.0`。重音落在「不一定」<br>字幕：逐字同步<br>配樂：ambient drone，−30 LUFS，0.5s 淡入<br>音效：字卡彈入時**單聲清脆的斷裂聲 −22dB**<br>收音：無（原生音軌剝除，走腳本鎖定語音）<br>來源：`chunk_0005`・`rewritten` |
| S1 | 3–7s | 建立隱喻 | 景別：同上（不切鏡）<br>運鏡：續推近<br>構圖：不變<br>光影：不變<br>字卡：大字卡淡出 | 旁白：「把一句話／想成一條連續的光。」<br>語氣：平穩、慢<br>字幕：同上<br>配樂：不變<br>音效：空曠底噪 −32dB<br>收音：無<br>來源：**`ai_added`** ⚠️ 需教師勾選 |
| S2 | 7–15s | 對應「拆成碎片」（**pattern interrupt**：切鏡＋光帶斷開，暗場裡第一次有大動作） | 景別：抽象中景（生成）<br>運鏡：固定<br>構圖：光帶斷成五段，段與段之間出現暗隙<br>光影：同上<br>字卡：`拆成碎片`，上 1/3 | 旁白：「token 是把它／**拆成碎片**之後／每一個碎片。」<br>語氣：「拆成碎片」略重<br>字幕：同上<br>配樂：不變<br>音效：斷裂聲，比開場輕<br>收音：無<br>來源：`chunk_0005`・`chunk_0006`・`rewritten` |
| S3 | 15–24s | 揭曉反直覺點（**第二次 pattern interrupt**：切鏡＋字卡停留 9 秒，形態與前面全部不同） | 景別：抽象中近景（生成）<br>運鏡：極慢拉遠<br>構圖：五段中最小的一段被單獨留在畫面中央，其餘退到邊緣變暗<br>光影：同上<br>字卡：`最小的那一段 = 句點`，中央，**停留 9 秒**（本片最重要的一張） | 旁白：「連最後那一小段／也就是**句點**／都算一個。／／它不是字／但它是 token。」<br>語氣：「句點」單獨咬清楚，前後各留短停<br>字幕：同上<br>配樂：不變<br>音效：—<br>收音：無<br>來源：`chunk_0006`・`rewritten` |
| S4 | 24–30s | **收束重述** | 景別：抽象中景（生成）<br>運鏡：固定，定格<br>構圖：五段光重新排開、亮度均等，下 1/3 留白<br>光影：光線略轉暖<br>字卡：`計費算的就是這些`（24–26s）→ `連那一小段都算`（26–30s，中央） | 旁白：「ChatGPT 的計費／算的就是這些。／／連最後那一小段／都算一個 token↘」<br>語氣：〔慢〕收尾下沉，重音落在「那一小段」<br>字幕：同上<br>配樂：最後 1.5s 淡出<br>音效：底噪淡出<br>收音：無<br>來源：`chunk_0007`・`chunk_0006`・`rewritten` |

總字數 118。

> ⚠️ **這支片有 `ai_added` 句，發布前必須教師逐句勾選。**
>
> S1 第二列的「把一句話想成一條連續的光」資料庫裡沒有，是 AI 加的比喻。Phase2 規格 §3.5 允許類比，但**錯的類比比講漏更糟**，所以要教師點頭。
>
> 這個比喻有一個已知的不精確處：**光帶是連續的，但文字本來就是一個一個字元**，所以「連續 → 斷開」在物理上比實際的 tokenization 更戲劇化。真正的重點不是「從連續變離散」，而是「切點在哪裡、以及句點也算一段」。**S3 那句「它不是字，但它是 token」就是用來把重點拉回切點的**，教師審核時要特別看這句有沒有被剪掉。

**備選開場**：預設「反常識」。「清單預告」版可用「五段光」當數量；「錯誤警告」版與這支片的沉靜調性不合，不建議。

## 生成鏡 Prompt

四鏡必須是**同一條光帶的演變**（連續 → 斷開 → 聚焦最小段 → 重新排開），`referenceImages` 一定要用。

### 為什麼只有 S1 用 Profile A

S2–S4 是**隱喻本體**：光帶斷成五段、聚焦最小那一段、重新排開。這三鏡的整個意義就是「光的形狀在變化」，**一旦畫面上有字，觀眾的視線會被字吸走，隱喻就失效了**。

而且這支片的 negative 特別排除了 `light forming letters or shapes`——**光排成字母正是要防的事**。同一鏡又要求它寫字、又要求它別讓光排成字，是自相矛盾的指令。

所以：**S1 有字（介紹用），S2–S4 純隱喻（理解用）**，中間的字卡全部程式化疊加。

### S1（Profile A — 帶指定文字）

```
imagePrompt: |
  A vertical 9:16 abstract cinematic still.
  Subject: a single continuous horizontal ribbon of warm light suspended in darkness
  Action/State: unbroken, perfectly still
  Setting: pure darkness, no floor, no horizon, no objects
  Text: the exact text "不是一個字" appears in bright high-contrast lettering,
        clearly readable against the dark background,
        horizontally centred in the upper third,
        no other text anywhere in the image.
  Style: soft natural light, low contrast, muted desaturated palette,
         shallow depth of field, generous negative space in the upper and lower thirds,
         realistic photography, calm and unobtrusive, low key, deep blacks, soft bloom, muted
  Framing: vertical 9:16 aspect ratio, 1080x1920
  NEGATIVE: misspelled text, garbled letters, duplicated text, extra words,
            watermarks, logos, user interface elements, recognizable human faces, light forming letters or shapes, morse code pattern

videoPrompt: |
  Animate this image. 8 seconds.
  Motion: the ribbon of light glows and breathes very slightly; nothing else moves
  Camera: very slow push-in
  Amplitude: minimal, gentle, natural. No abrupt movement.
  Do not add any object not present in the source image.
  Preserve all text in the source image exactly as it appears.
```

> **暗場生成文字是 G2 最容易失敗的組合**：字太暗讀不到，OCR 就回讀不出來，會被判成失敗。prompt 明寫 `bright high-contrast lettering, clearly readable against the dark background`，若仍不過就退回 profile B + 程式化字卡——這支片本來就是純隱喻，退回去毫無損失。

### S2–S4 皆為 Profile B

以下三鏡的 negative 保留 `light forming letters or shapes, morse code pattern`。一條斷開的光帶模型很容易排成摩斯電碼或字母，那會讓畫面意外帶上資訊。

### S2

```
imagePrompt: |
  A vertical 9:16 abstract cinematic still.
  Subject: the same ribbon of warm light, now broken into five separate segments with
           dark gaps between them, segments of clearly different lengths
  Action/State: still, floating in the same position
  Setting: pure darkness
  Style: soft natural light, low contrast, muted desaturated palette,
         shallow depth of field, generous negative space in the upper and lower thirds,
         realistic photography, calm and unobtrusive, low key, deep blacks, soft bloom, muted
  Framing: vertical 9:16 aspect ratio, 1080x1920
  NEGATIVE: text, letters, words, numbers, digits, formulas, equations, charts, graphs,
            axes, diagrams, schematics, labels, captions, subtitles, signage, logos,
            brand marks, watermarks, user interface elements, any readable content,
            extra limbs, deformed hands, warped geometry, human face, recognizable person, portrait, eyes, facial features,
                                                          crowd of people, light forming letters or shapes, morse code pattern

videoPrompt: |
  Animate this image. 8 seconds.
  Motion: the gaps widen very slowly; each segment drifts a fraction apart
  Camera: static
  Amplitude: minimal, gentle, natural. No abrupt movement.
  Do not add any object not present in the source image.
  Do not generate any text, numbers, charts, or human faces.
```

### S3

```
imagePrompt: |
  A vertical 9:16 abstract cinematic still.
  Subject: five segments of warm light, the smallest one centred and bright, the other
           four dimmed and pushed toward the edges of the frame
  Action/State: still
  Setting: pure darkness
  Style: soft natural light, low contrast, muted desaturated palette,
         shallow depth of field, generous negative space in the upper and lower thirds,
         realistic photography, calm and unobtrusive, low key, deep blacks, soft bloom, muted
  Framing: vertical 9:16 aspect ratio, 1080x1920
  NEGATIVE: text, letters, words, numbers, digits, formulas, equations, charts, graphs,
            axes, diagrams, schematics, labels, captions, subtitles, signage, logos,
            brand marks, watermarks, user interface elements, any readable content,
            extra limbs, deformed hands, warped geometry, human face, recognizable person, portrait, eyes, facial features,
                                                          crowd of people, light forming letters or shapes, morse code pattern

videoPrompt: |
  Animate this image. 8 seconds.
  Motion: the central small segment pulses very gently; the others stay dim and still
  Camera: very slow pull-back
  Amplitude: minimal, gentle, natural. No abrupt movement.
  Do not add any object not present in the source image.
  Do not generate any text, numbers, charts, or human faces.
```

### S4

```
imagePrompt: |
  A vertical 9:16 abstract cinematic still.
  Subject: the five segments of warm light arranged evenly in a row, all equally bright
  Action/State: still, balanced
  Setting: pure darkness turning slightly warmer at the edges
  Style: soft natural light, low contrast, muted desaturated palette,
         shallow depth of field, generous negative space in the upper and lower thirds,
         realistic photography, calm and unobtrusive, low key, soft bloom, generous negative space in the lower third
  Framing: vertical 9:16 aspect ratio, 1080x1920
  NEGATIVE: text, letters, words, numbers, digits, formulas, equations, charts, graphs,
            axes, diagrams, schematics, labels, captions, subtitles, signage, logos,
            brand marks, watermarks, user interface elements, any readable content,
            extra limbs, deformed hands, warped geometry, human face, recognizable person, portrait, eyes, facial features,
                                                          crowd of people, light forming letters or shapes, morse code pattern

videoPrompt: |
  Animate this image. 8 seconds.
  Motion: the segments glow steadily; warmth spreads slowly from the edges
  Camera: static
  Amplitude: minimal, gentle, natural. No abrupt movement.
  Do not add any object not present in the source image.
  Do not generate any text, numbers, charts, or human faces.
```

**S3 的「最小那一段被單獨留下」對應口播的「連句點也算一個」**，畫面與內容要對得上，不是隨便挑一段。

## 聲音設計（斷裂聲是隱喻的一部分）

| 項目 | 規格 |
|------|------|
| 語速 | 全片最慢，`speakingRate 1.0`。這支片的沉靜是它的本體，講快就毀了 |
| 配樂 | ambient drone −30 LUFS，**與斷裂聲融合**成同一個聲音層 |
| 音效 | S1 一聲清脆斷裂（呼應「不是一個字」）→ S2 較輕的斷裂聲 → S3 無音效 → S4 無音效。**斷裂聲的變化要跟著隱喻走，不是隨便鋪** |
| 留白 | S3 那張停留 9 秒的字卡，後 4 秒**旁白完全停止**，只剩 drone。這 4 秒是給學生消化「句點也算一個」的時間 |
| `token` 唸法 | 全片出現 3 次，語速慢所以最容易唸準，但仍要合成後聽過 |
| 音效總數 | 斷裂聲一種而已。不加字卡輕點——會破壞這支片的聲音世界 |
| 風險 | 這支片最容易變成「好聽但沒學到」。判斷標準：**關掉聲音只看字卡，邏輯要完整成立** |

## POST

隱喻畫面完全不帶資訊，**所有精確內容由字卡承擔**。

右上角固定「AI 示意畫面」標示。

**驗收（共用清單外加）**
- [ ] 每一列的「來源」欄都有值，且 chunkId 存在於 `video_segments_text`
- [ ] 最後 5 秒是收束重述，沒有導流字卡
- [ ] S1 的「一條連續的光」比喻已經教師逐句勾選同意
- [ ] 「它不是字，但它是 token」那句沒有被剪掉
- [ ] 光帶沒有排成字母、摩斯電碼或任何可讀圖案
- [ ] 四鏡是同一條光帶的演變，不是四個不同的抽象畫面
- [ ] S3 聚焦的是**最小**那一段，不是隨便一段
- [ ] 靜音播放時，光靠字卡就看得懂完整邏輯
- [ ] S1 的 `不是一個字` 與 OCR 回讀逐字相同，且在暗場中讀得到
- [ ] **S2–S4 畫面上沒有任何文字**，光沒有排成字母或摩斯電碼
- [ ] 影片生成後複驗過，S1 的字沒有被光暈吃掉

## 驗證紀錄

```js
shots: [
  { shotId: 'S1', profile: 'A', expectedText: '不是一個字',
    g2: { passed: null, ocrResult: null, retryCount: 0,
          fellBackToProgrammatic: false, verifiedAfterVideo: null } },
  { shotId: 'S2', profile: 'B', expectedText: null, g2: { passed: null } },
  { shotId: 'S3', profile: 'B', expectedText: null, g2: { passed: null } },
  { shotId: 'S4', profile: 'B', expectedText: null, g2: { passed: null } },
],
narration: {
  mode: 'script_locked',
  g3: { passed: null, similarity: null, keyTermsAllPresent: null, retryCount: 0 },
}
teacherApprovalRequired: true      // S1 第二列的水池／光帶比喻是 ai_added
```

**G3 關鍵詞**：`token`、`ChatGPT`、`句點`。

**這支的 G2 預期失敗率最高**（暗場 + 中文 + 抽象背景），重試上限建議調到 5 次就退回程式化，不要硬拚。
