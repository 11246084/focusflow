# 03・無縫循環（頭尾相接）

> 共用素材、分鏡表格式、吸引力規格、聲音規格、三道驗證關、prompt 常數見 [_shared-conventions.md](_shared-conventions.md)（v7）。本檔只寫這支片的差異。
>
> **Shorts 播完會自動重播。** 如果最後一格能接回第一格、最後一句能接回第一句，觀眾看不出接縫，會不知不覺多看一到兩輪——完播率與播放數同時被拉高。這是十支裡唯一為「重播」設計的版本。
>
> **v6 變更**：**這支片全部維持 profile B，不採用生成字卡。** 理由見下方「為什麼這支不用 profile A」——不是規格不允許，是循環結構跟 baked-in 文字在物理上不相容。

## META

```yaml
id: SV-03
presentation: seamless_loop
facePolicy: none
personGeneration: dont_allow
style: "soft natural light, low contrast, muted desaturated palette"
durationSec: 26              # 刻意做短，重播才不累
generatedShots: 2            # 兩鏡共用同一張 startFrame
liveActionShots: 0
teacherOnCamera: false
loop: true
narration: TTS（台灣中文女聲）
estimatedCostTwd: 90
courseId: 69f82564736febac6db8e97b
sourceVideoId: 6a67ffd295668cc2b904f3c4
primaryStartSec: 56
chunksUsed: [chunk_0005, chunk_0006]
teacherApprovalRequired: false
```

## 分鏡腳本表

**循環腳本不能有收尾詞。**「以上」「總結一下」「所以結論是」全部禁用，因為下一秒就要接回第一句。

Token 這個知識特別適合做循環——**「連句點都算一個」會自然導回「所以它不是一個字」**，語意本身就是個圈。

| 鏡號 | 秒數 | Beat | 畫面 | 聲音 |
|------|------|------|------|------|
| S1 | 0–4s | **鉤子・反常識**（＝循環接點） | 景別：中景（生成）<br>運鏡：極慢推近，起點=首格構圖<br>構圖：單獨一小片吐司置中，左右對稱，上下 1/3 留白<br>光影：左上單一柔光，中性色調<br>字卡：`不一定是一個字` 96px 高對比，**0.3s 彈入**（本片的 pattern interrupt 靠字卡不靠鏡頭，鏡頭必須維持等速才接得回去） | 旁白：「一個 token／**不一定**是一個字」<br>語氣：平穩、不強調，**因為這句同時是結尾的接續句**，唸得太用力會讓循環接點被聽出來<br>字幕：逐字同步（karaoke）<br>配樂：ambient drone，−30 LUFS，**不淡入**<br>音效：字卡彈入輕點聲 −24dB；環境底噪 −32dB，**首尾同音量**<br>收音：無（原生音軌剝除，走腳本鎖定語音）<br>來源：`chunk_0005`・`rewritten` |
| S1 | 4–12s | 給結論 | 景別：同上（不切鏡）<br>運鏡：續推近<br>構圖：不變<br>光影：不變<br>字卡：`把一句話拆成碎片`，上 1/3 | 旁白：「它是把原本的一句話／拆成碎片之後／每一個碎片。」<br>語氣：平述<br>字幕：同上<br>配樂：不變<br>音效：字卡推入輕點 −24dB<br>收音：無<br>來源：`chunk_0005`・`rewritten` |
| S2 | 12–20s | 推到極端值（**兼 pattern interrupt**：字卡形態變化＋切鏡） | 景別：同構圖（生成，同一張 startFrame）<br>運鏡：極慢拉遠，終點=首格構圖<br>構圖：不變<br>光影：不變<br>字卡：`句點也算一個`，上 1/3，**24s 前必須淡出** | 旁白：「所以連最後的那個**句點**／都算一個 token。」<br>語氣：「句點」單獨咬清楚<br>字幕：同上<br>配樂：不變<br>音效：切點輕點 −26dB<br>收音：無<br>來源：`chunk_0006`・`rewritten` |
| S2 | 20–26s | 接回開頭 | 景別：同上（不切鏡）<br>運鏡：續拉遠，**末格 = S1 首格**<br>構圖：回到起始構圖<br>光影：不變<br>字卡：僅剩右下常駐字卡 | 旁白：「而如果連句點都算／那它當然就——」<br>語氣：**句尾不下沉也不上揚，維持水平**。任何句尾語調變化都會讓人聽出「這是結尾」。破折號處直接收聲，不拖長<br>字幕：同上<br>配樂：**不淡出**，尾端 0.5s 淡到與開頭同音量<br>音效：旁白後留 0.2–0.3s 空白<br>收音：無<br>來源：`chunk_0006`・`rewritten` |

總字數 76。**v7 起不做導流**，右下原本的常駐導流字卡已移除——這對循環反而更好，少一個常駐元素就少一個接點破綻。

**接點怎麼成立**：第 ④ 句「而如果連句點都算／那它當然就——」直接接第 ① 句「一個 token 不一定是一個字」，語意連續，聽起來像同一句話講完。

**這支片的吸引力設計與其他九支不同**：pattern interrupt 只能靠字卡，不能靠鏡頭——鏡頭一旦有「用力」的動作，尾格就接不回首格。開場 0.4 秒的鏡頭下沉在這支是**禁止**的。

**備選開場**：三種鉤子都可用，但**換開場時尾句要跟著換**，否則接不回去：

| 開場 | 對應尾句 |
|------|----------|
| 反常識（預設）「一個 token 不一定是一個字」 | 「…而如果連句點都算，那它當然就——」 |
| 錯誤警告「你在算 ChatGPT 的錢，但單位算錯了」 | 「…所以你算的那個單位，其實一直都——」 |
| 清單預告「一句話會被拆成幾個東西？」 | 「…連句點都要算進去，所以到底是幾個——」 |

## 為什麼這支不用 Profile A

v6 開放了「文字生成進畫面」，但**這支片用不了**，三個結構性原因：

| 原因 | 說明 |
|------|------|
| **兩鏡共用同一張 startFrame** | 文字一旦 baked in，S1 與 S2 會出現同一段文字。但這支的兩段字卡內容不同（`不一定是一個字` vs `句點也算一個`），做不到 |
| **字卡必須在第 24 秒前淡出** | baked-in 的字不會淡出，重播時會與新字疊在一起，接點立刻暴露 |
| **末格必須等於首格** | 若首格有字、末格沒字（或反之），畫面就接不回去 |

所以**這支的所有文字一律程式化渲染**，包括鉤子字卡。這不是保守，是循環結構的硬性限制。

> **反過來說**：如果哪天想做一支「文字全程不變」的循環片（例如整支只有一句話 baked 在畫面上），profile A 反而是最好的選擇——因為常駐不變的元素最有利於循環。那會是另一種設計。

## 生成鏡 Prompt

**兩鏡共用同一張 `startFrame`**，這是無縫的關鍵。各取 8 秒素材以 0.6 倍速放慢成 13 秒。兩鏡都是 **Profile B**。

### S1

```
imagePrompt: |
  A vertical 9:16 cinematic still.
  Subject: a single small slice of pale bread centred on a plain wooden board
  Action/State: perfectly still, one soft shaft of light from the upper left
  Setting: a quiet kitchen counter, even neutral tone, symmetrical composition
  Style: soft natural light, low contrast, muted desaturated palette,
         shallow depth of field, generous negative space in the upper and lower thirds,
         realistic photography, calm and unobtrusive
  Framing: vertical 9:16 aspect ratio, 1080x1920
  NEGATIVE: text, letters, words, numbers, digits, formulas, equations, charts, graphs,
            axes, diagrams, schematics, labels, captions, subtitles, signage, logos,
            brand marks, watermarks, user interface elements, any readable content,
            extra limbs, deformed hands, warped geometry, human face, recognizable person, portrait, eyes, facial features,
                                                          crowd of people, knife, hands, packaging, printed wrapper

videoPrompt: |
  Animate this image. 8 seconds.
  Motion: fine dust drifts slowly through the light shaft
  Camera: very slow push-in, starting at the exact framing of the source image
  Amplitude: minimal, gentle, natural. No abrupt movement.
  Do not add any object not present in the source image.
  Do not generate any text, numbers, charts, or human faces.
```

### S2

```
imagePrompt: 使用與 S1 完全相同的 startFrame（不重新生圖）

videoPrompt: |
  Animate this image. 8 seconds.
  Motion: fine dust drifts slowly through the light shaft
  Camera: very slow pull-back, ending at the exact framing of the source image
  Amplitude: minimal, gentle, natural. No abrupt movement.
  Do not add any object not present in the source image.
  Do not generate any text, numbers, charts, or human faces.
```

放慢至 13 秒：

```bash
ffmpeg -i s1.mp4 -filter:v "setpts=1.625*PTS" -an s1_slow.mp4
```

> **這支片刻意只用「單獨一小片」**，不用整條或整排。單一物件左右對稱最好接回原構圖；物件一多，拉遠與推近的透視差就會讓末格對不上首格。

## 三個必要條件

| 條件 | 規格 | 沒做到會怎樣 |
|------|------|-------------|
| 畫面 | 尾鏡末格與首鏡首格構圖、色調、光線位置一致 | 重播瞬間畫面跳一下 |
| 語句 | 尾句與首句語意接得上，無收尾詞 | 聽得出「又重來了」 |
| 音訊 | 旁白尾端留 0.2–0.3 秒空白；背景音尾端 0.5 秒淡出到與開頭同音量 | 接點出現爆音或音量落差 |

**字卡也要循環**：常駐字卡全程不變，段落字卡在第 24 秒前全部淡出，否則重播時會與新出現的字卡疊在一起。

## 聲音設計（十支裡限制最多的一支）

其他九支的聲音是「怎麼講比較好聽」，**這支是「怎麼講才不會破壞循環」**。每一條都是限制，不是選擇。

| 項目 | 規格 | 為什麼 |
|------|------|--------|
| 配樂 | ambient drone，−30 LUFS，**不淡入、不淡出** | 淡入淡出等於在接點放一個音量斜坡，一定聽得出來 |
| 配樂選曲 | **必須是無起伏的持續音**，不可有段落感 | 有段落的音樂 26 秒剛好走到一半，第二輪就對不上了 |
| 音效種類 | **只有一種**：字卡輕點 −24dB | 多一種就多一個時間標記，觀眾會靠它認出「這裡我聽過」 |
| 尾句語調 | 句尾**維持水平**，不下沉也不上揚 | 下沉＝結束的訊號，上揚＝提問的訊號，兩種都會暴露這是尾巴 |
| 首句語氣 | 平穩、不強調 | 它同時是第 26 秒那句的續句，唸得比尾句用力就會出現落差 |
| 旁白長度 | 必須**短於畫面長度**，尾端留 0.2–0.3 秒空白 | 沒有空白，第二輪的第一個字會壓在第一輪的最後一個字上 |
| TTS | 整支一次合成，`speakingRate 1.0` | 分段合成會有音色落差，在接點最明顯 |
| `token` 唸法 | **首句與尾句都出現 token 這個字，唸法必須一致** | 同一個英文字在接點前後唸得不一樣，接縫立刻暴露 |
| 環境底噪 | −32dB，**首尾同音量** | 底噪音量若有變化，接點就會有「換場」的感覺 |

### 音訊的驗收方式

把成品音軌**首尾接起來，只聽聲音、不看畫面，連播三輪**：

- [ ] 聽得出來哪裡是接點嗎？
- [ ] 配樂有沒有出現音量斜坡或段落感？
- [ ] 第二輪的第一個字有沒有壓到第一輪的尾音？
- [ ] `token` 在接點前後的唸法一致嗎？
- [ ] 底噪音量在接點有沒有跳？

**只看畫面驗收會漏掉一半的問題。** 人對聲音的斷點比對畫面的斷點敏感。

## POST

右上角「AI 示意畫面」標示全程常駐（不影響循環）。

循環驗收用（把成品接三次）：

```bash
ffmpeg -stream_loop 2 -i final.mp4 -c copy loop_test.mp4
```

**驗收（共用清單外加）**
- [ ] 每一列的「來源」欄都有值，且 chunkId 存在於 `video_segments_text`
- [ ] 口播全文沒有任何收尾詞
- [ ] S1 與 S2 用的是同一張 startFrame
- [ ] 總長 ≤ 30 秒（太長的片重播會累）
- [ ] 全片沒有導流字卡（v7 起不做導流）
- [ ] **兩鏡都是 profile B**，畫面上沒有任何 baked-in 文字
- [ ] 畫面沒有出現刀、手、包裝袋、任何印刷文字
- [ ] G3：ASR 回讀相似度 ≥ 0.95，`token`／`句點` 全中

## 驗證紀錄

```js
shots: [
  { shotId: 'S1', profile: 'B', expectedText: null, g2: { passed: null } },
  { shotId: 'S2', profile: 'B', expectedText: null, g2: { passed: null } },
],
narration: {
  mode: 'script_locked',
  g3: { passed: null, similarity: null, keyTermsAllPresent: null, retryCount: 0 },
}
```

**G3 的關鍵詞清單**：`token`、`句點`。
