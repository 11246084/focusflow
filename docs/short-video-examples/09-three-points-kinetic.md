# 09・三個重點・字卡驅動

> 共用素材、分鏡表格式、吸引力規格、聲音規格、三道驗證關、prompt 常數見 [_shared-conventions.md](_shared-conventions.md)（v7）。本檔只寫這支片的差異。
>
> **v6 變更**：只有開場的 `3 件事` 改為生成（profile A）。**其餘字卡全部維持程式化渲染**——這支片的字卡會推入、縮小、累積到左上，baked-in 的字做不到。
>
> **節奏最快、資訊密度最高。** 字卡是主角，背景只是襯底。適合複習型內容——學生已經上過課，需要的是快速把重點串一遍，不是從頭理解。

## META

```yaml
id: SV-09
presentation: three_points_kinetic
facePolicy: none
personGeneration: dont_allow
style: "soft natural light, low contrast, muted desaturated palette" 極低對比版
durationSec: 28
generatedShots: 3
liveActionShots: 0
teacherOnCamera: false
pace: fast                   # 每點約 7 秒，比其他版本快一倍
narration: TTS（台灣中文女聲）
estimatedCostTwd: 130
courseId: 69f82564736febac6db8e97b
sourceVideoId: 6a67ffd295668cc2b904f3c4
primaryStartSec: 56
chunksUsed: [chunk_0005, chunk_0006, chunk_0007]
teacherApprovalRequired: false
```

> **這支片的背景要比其他任何一支更淡。** 字卡佔畫面比重高、切換又快，背景只要稍微有動靜，認知負荷就爆掉。生圖時把 `low contrast` 加強成 `very low contrast, near-monochrome`。

## 分鏡腳本表

**節奏規則**：每一點的口播必須在 5 秒內講完，剩下 2 秒留給字卡停留。講不完就是這一點寫太長了，砍字不要加速。

| 鏡號 | 秒數 | Beat | 畫面 | 聲音 |
|------|------|------|------|------|
| S1 | 0–3s | **鉤子・清單預告** | **Profile：A**<br>`expectedText`: `3 件事`<br>景別：中景（生成）<br>運鏡：極慢推近<br>構圖：一整條未切的吐司置於下 1/3，`3 件事` 大字佔上半畫面<br>光影：極柔散射，near-monochrome，幾乎無陰影<br>**進場**：0.3s 淡入（**不做縮放**，見下方定案） | 旁白：「token／**三件事**講完／第三件多數人不知道↗」<br>語氣：〔快〕全片語速最快，TTS `speakingRate 1.1`（**不可超過 1.15**）。句尾上揚<br>字幕：逐字同步<br>配樂：**有節拍感的 pulse，−30 LUFS**——十支裡唯一有節拍的一支，但仍不可有旋律<br>音效：字卡彈入輕擊聲 −22dB；環境底噪 −34dB<br>收音：無（原生音軌剝除，走腳本鎖定語音）<br>來源：`template` + `chunk_0006`・`rewritten` |
| S1 | 3–11s | 第一點 | 景別：同上（不切鏡）<br>運鏡：續推近<br>構圖：不變<br>光影：不變<br>字卡：`① token = 把句子拆成碎片`，中央偏上，88px，由下往上推入 0.25s，講完停 2s | 旁白：「一／token 是把一句話／拆成碎片之後的東西。」<br>語氣：短句節奏一致<br>字幕：同上<br>配樂：不變<br>音效：字卡推入輕擊 −22dB<br>收音：無<br>來源：`chunk_0005`・`rewritten` |
| S2 | 11–18s | 第二點（**pattern interrupt**：切鏡＋清單開始累積）<br>16–18s 埋 **open loop** | 景別：中景（生成）<br>運鏡：極慢橫移<br>構圖：切好的吐司片整齊排開，沿下 1/3 延伸<br>光影：同上<br>字卡：主字卡 `② 每一個碎片 = 一個 token`；**左上縮小清單出現 `① 拆成碎片`** | 旁白：「二／每一個碎片／都是一個 token。／／第三件才是重點↗」<br>語氣：`↗` 處上揚<br>字幕：同上<br>配樂：不變<br>音效：切點輕點 −26dB<br>收音：無<br>來源：`chunk_0006`・`rewritten` |
| S3 | 18–25s | 第三點（含反直覺點） | 景別：中近景（生成）<br>運鏡：極慢拉遠<br>構圖：單獨一小片放在空木板上<br>光影：同上<br>字卡：主字卡 `③ 句點也算一個`；左上清單累積成 `① 拆成碎片`／`② 每塊都算` | 旁白：「三／連最後的**句點**／也是一個 token。／／ChatGPT 的計費／就是算這個。」<br>語氣：「句點」加重<br>字幕：同上<br>配樂：不變<br>音效：字卡推入輕擊 −22dB<br>收音：無<br>來源：`chunk_0006`・`chunk_0007`・`rewritten` |
| S3 | 25–28s | **收束重述** | 景別：同上（不切鏡）<br>運鏡：停止拉遠，定格<br>構圖：不變<br>光影：不變<br>字卡：`連句點都算一個`，中央；左上清單三點全列 | 旁白：「記住第三件／連**句點**都算一個↘」<br>語氣：〔慢〕收尾下沉，重音落在「句點」<br>字幕：同上<br>配樂：最後 1.5s 淡出<br>音效：底噪淡出<br>收音：無<br>來源：`chunk_0006`・`rewritten` |

總字數 108（比其他版本短，因為字卡承擔了大部分資訊）。**無 `ai_added` 句。**

**這支片天生符合「清單預告」公式**——開場宣告數量本身就是好奇缺口。加上「第三件多數人不知道」之後缺口更明確。

**「左上清單累積不消失」是這支片的關鍵設計**：快節奏下學生記不住前面講過什麼，清單讓他隨時看得到已經講了幾點、還剩幾點。

**三鏡的內容變化本身就在講故事**：一整條 → 切成片 → 單獨一小片。第三鏡的「單獨一小片」剛好對上「連句點也算一個」。

**備選開場**：預設「清單預告」。「錯誤警告」版可改成開場先跳出 `1 token = 1 個字 ✕` 再接三點；「反常識」版不建議——它跟條列結構的節奏不合。

### 開場字卡：不做縮放（定案）

原本設計是「120px 彈入 → 縮成 88px」。**縮放與 profile A 相衝**——baked-in 的字大小固定，不會縮。

**定案：放棄縮放。** `3 件事` 直接以最終大小生成進畫面，用 **0.3 秒淡入**當 pattern interrupt。

理由：這支的 interrupt 密度本來就最高（每 7 秒一次切鏡），開場少一個縮放不影響整體節奏；而「字長在畫面裡」的質感是這支與 01 的主要區隔。

> 這是一個一般性原則，其他支也適用：**要動的字用程式化渲染，要跟畫面融為一體的字用生成。兩者不能兼得。**

## 驗證紀錄

```js
shots: [
  { shotId: 'S1', profile: 'A', expectedText: '3 件事',
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

**G3 關鍵詞**：`token`、`ChatGPT`、`句點`。

> **這支的 G3 風險最高**：`speakingRate 1.1` 是十支裡最快的，`token` 出現 4 次最容易唸糊。若 G3 一直不過，先把該處語速降回 1.0 再合成，不要調門檻。

## 生成鏡 Prompt

三鏡都用同一組 `referenceImages`，且**運鏡方向刻意不同**（推近／橫移／拉遠），讓快節奏下的切換有變化，但畫面內容維持單調。

### S1（Profile A — 帶指定文字）

```
imagePrompt: |
  A vertical 9:16 cinematic still.
  Subject: a whole uncut loaf of pale bread on a wide empty pale wooden surface
  Action/State: still, very soft diffused light, almost no shadow
  Setting: an empty kitchen counter, vast negative space above
  Text: the exact text "3 件事" appears large, cleanly rendered,
        high contrast, horizontally centred in the upper half,
        no other text anywhere in the image.
  Style: soft natural light, low contrast, muted desaturated palette,
         shallow depth of field, generous negative space in the upper and lower thirds,
         realistic photography, calm and unobtrusive, very low contrast, near-monochrome, extremely muted
  Framing: vertical 9:16 aspect ratio, 1080x1920
  NEGATIVE: misspelled text, garbled letters, duplicated text, extra words,
            watermarks, logos, user interface elements, recognizable human faces, knife, hands, packaging, printed wrapper

videoPrompt: |
  Animate this image. 8 seconds.
  Motion: barely perceptible drift of light across the surface
  Camera: very slow push-in
  Amplitude: minimal, gentle, natural. No abrupt movement.
  Do not add any object not present in the source image.
  Preserve all text in the source image exactly as it appears.
```

> **推近鏡對 profile A 是風險**：鏡頭推進時 baked-in 的字會跟著放大、也可能被裁到畫面外。這一鏡的推近幅度本來就極小（`very slow push-in`），但 G2 複驗仍要確認末格的字完整。過不了就把這一鏡改成 `Camera: static`。

### S2

```
imagePrompt: |
  A vertical 9:16 cinematic still.
  Subject: a long row of evenly cut bread slices receding across the surface
  Action/State: still, same very soft diffused light
  Setting: the same empty counter, vast negative space above
  Style: soft natural light, low contrast, muted desaturated palette,
         shallow depth of field, generous negative space in the upper and lower thirds,
         realistic photography, calm and unobtrusive, very low contrast, near-monochrome, extremely muted
  Framing: vertical 9:16 aspect ratio, 1080x1920
  NEGATIVE: text, letters, words, numbers, digits, formulas, equations, charts, graphs,
            axes, diagrams, schematics, labels, captions, subtitles, signage, logos,
            brand marks, watermarks, user interface elements, any readable content,
            extra limbs, deformed hands, warped geometry, human face, recognizable person, portrait, eyes, facial features,
                                                          crowd of people, knife, hands, packaging, printed wrapper

videoPrompt: |
  Animate this image. 8 seconds.
  Motion: barely perceptible drift of light
  Camera: very slow lateral pan to the right
  Amplitude: minimal, gentle, natural. No abrupt movement.
  Do not add any object not present in the source image.
  Do not generate any text, numbers, charts, or human faces.
```

### S3

```
imagePrompt: |
  A vertical 9:16 cinematic still.
  Subject: one single small slice of bread alone on the wide empty surface
  Action/State: still, same very soft diffused light
  Setting: the same empty counter
  Style: soft natural light, low contrast, muted desaturated palette,
         shallow depth of field, generous negative space in the upper and lower thirds,
         realistic photography, calm and unobtrusive, very low contrast, near-monochrome, extremely muted
  Framing: vertical 9:16 aspect ratio, 1080x1920
  NEGATIVE: text, letters, words, numbers, digits, formulas, equations, charts, graphs,
            axes, diagrams, schematics, labels, captions, subtitles, signage, logos,
            brand marks, watermarks, user interface elements, any readable content,
            extra limbs, deformed hands, warped geometry, human face, recognizable person, portrait, eyes, facial features,
                                                          crowd of people, knife, hands, packaging, printed wrapper

videoPrompt: |
  Animate this image. 8 seconds.
  Motion: barely perceptible drift of light
  Camera: very slow pull-back
  Amplitude: minimal, gentle, natural. No abrupt movement.
  Do not add any object not present in the source image.
  Do not generate any text, numbers, charts, or human faces.
```

## 聲音設計（唯一有節拍的一支）

| 項目 | 規格 |
|------|------|
| 配樂 | **有節拍感的 pulse**，−30 LUFS。這是十支裡唯一允許節拍的——快節奏沒有節拍撐著會顯得毛躁。**但仍不可有旋律** |
| 節拍對位 | 字卡推入要**壓在拍點上**。三個點的推入間隔相等，聽起來才像設計過的，不像趕 |
| 語速 | `speakingRate 1.1`，全片最快。**上限 1.15**——超過就變成廣告口播 |
| 停頓 | 每點講完停 2 秒，這 2 秒**配樂繼續走**，不要一起停。停下來會有斷片感 |
| `token` 唸法 | 全片出現 4 次且語速快，**最容易唸糊的一支**。合成後逐次聽過，糊掉就把該處語速降回 1.0 |
| 音效 | 字卡輕擊 −22dB、切鏡輕點 −26dB，兩種而已 |
| 風險 | 這支片最容易做成「很像廣告」。判斷標準：**放給沒學過的人聽，如果他記不住三點，就是節奏太快了** |

## POST

字卡是這支片的主體，規格與其他版本不同。

| 項目 | 規格 |
|------|------|
| 主字卡字級 | 88px（其他版本約 64px） |
| 位置 | 畫面中央偏上，不是上 1/3 |
| 進場 | 生成的開場字卡：0.3s 淡入；其餘程式化字卡：由下往上推入，0.25 秒完成 |
| 停留 | 該點講完後再停 2 秒才換 |
| 累積 | 前面的點縮小移到左上排成清單，**不消失** |

右上角固定「AI 示意畫面」標示。

**驗收（共用清單外加）**
- [ ] 每一列的「來源」欄都有值，且 chunkId 存在於 `video_segments_text`
- [ ] 最後 5 秒是收束重述，沒有導流字卡
- [ ] 背景確實淡到不搶字卡（把影片縮到 30% 大小看，應該幾乎只看得到字）
- [ ] 每點口播都在 5 秒內講完，未使用加速
- [ ] `token` 四次唸法都清楚，沒有唸糊
- [ ] 左上清單全程正確累積
- [ ] 靜音播放時三個重點完整可讀
- [ ] 第三鏡的「單獨一小片」與「句點也算一個」對得上
- [ ] S1 的 `3 件事` 與 OCR 回讀逐字相同
- [ ] **S1 推近後複驗過**，字沒有被裁到畫面外
- [ ] S2、S3 畫面上沒有任何文字
- [ ] 開場字卡是 0.3s 淡入，**沒有做縮放**
