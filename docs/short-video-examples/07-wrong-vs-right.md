# 07・錯誤 vs 正確對照

> 共用素材、分鏡表格式、吸引力規格、聲音規格、三道驗證關、prompt 常數見 [_shared-conventions.md](_shared-conventions.md)（v7）。本檔只寫這支片的差異。
>
> **v6 變更**：兩張對照字卡改為**生成進畫面**（profile A），這支因此變成「畫面本身就在對照」而不是「空景 + 疊字」。✕／✓ 記號仍為程式化渲染。
>
> 先演錯的、再演對的。**對照結構的記憶效果比單講正確答案好**，因為學生多半正在做錯的那一種，看到會有「那不就是我」的反應。
>
> Token 這個題目天生適合對照：**幾乎所有人第一次都以為「一個 token = 一個字」**。

## META

```yaml
id: SV-07
presentation: wrong_vs_right
facePolicy: none
personGeneration: dont_allow
style: "soft natural light, low contrast, muted desaturated palette"
durationSec: 30
generatedShots: 2
liveActionShots: 0
teacherOnCamera: false
splitScreen: true            # 20 秒後上下分割
narration: TTS（台灣中文女聲）
estimatedCostTwd: 90
courseId: 69f82564736febac6db8e97b
sourceVideoId: 6a67ffd295668cc2b904f3c4
primaryStartSec: 56
chunksUsed: [chunk_0005, chunk_0006]
teacherApprovalRequired: false
```

## 分鏡腳本表

**錯誤那段不可以嘲諷。** 講「很多人都這樣以為」而不是「不要再搞錯了」——被講的人就在螢幕另一頭。

| 鏡號 | 秒數 | Beat | 畫面 | 聲音 |
|------|------|------|------|------|
| S1 | 0–3s | **鉤子・錯誤警告** | **Profile：A**<br>`expectedText`: `一個 token 一個字`<br>景別：中景（生成）<br>運鏡：固定<br>構圖：一整條未切的吐司置中，單調、對稱，字在上 1/3<br>光影：均勻頂光，刻意平、無層次<br>**程式化疊加**：第 2s 一個紅色 ✕ 重重落下（本片的 pattern interrupt，全片唯一的紅色） | 旁白：「多數人以為／一個 token 就是**一個字**↘」<br>語氣：陳述不指責。`／／` 那個停頓與紅色 ✕ 落下**同格**<br>字幕：逐字同步<br>配樂：ambient pad −30 LUFS，0.5s 淡入<br>音效：**✕ 落下時低頻 thud −22dB（全片唯一一次）**<br>收音：無（原生音軌剝除，走腳本鎖定語音）<br>來源：`chunk_0005`・`rewritten` |
| S1 | 3–8s | 共鳴（為什麼不對） | 景別：同上（不切鏡）<br>運鏡：固定<br>構圖：不變<br>光影：不變<br>**程式化疊加**：`一個 token 一個字`（與 S1 生成的字同字樣）縮小移到左上，✕ 留著 | 旁白：「有同學問過我這題。／／如果一個字就是一個 token／那中文的「今天」／到底算一個還兩個？」<br>語氣：平述提問，不帶情緒<br>字幕：同上<br>配樂：不變<br>音效：環境底噪 −32dB<br>收音：無<br>來源：`verbatim` + `template` |
| S1 | 8–14s | **Open loop** | 景別：同上<br>運鏡：極慢推近<br>構圖：不變<br>光影：不變<br>字卡：中央空出來，只留左上小字 | 旁白：「而且還有一個東西／根本不是字／但它也算↗」<br>語氣：**句尾上揚，全片唯一一次**<br>字幕：同上<br>配樂：不變<br>音效：—<br>收音：無<br>來源：`chunk_0006`・`rewritten` |
| S2 | 14–20s | 給正確做法（**第一次 pattern interrupt**：切鏡＋✕ 換 ✓） | **Profile：A**<br>`expectedText`: `拆成碎片的每一塊`<br>景別：中景（生成，**同機位同光**）<br>運鏡：固定<br>構圖：同一條吐司已切成片整齊排開，字在上 1/3（**與 S1 的字同位置**）<br>光影：與 S1 完全一致<br>**程式化疊加**：右上 ✓ 記號 | 旁白：「token 是把一句話／**拆成碎片**之後／每一個碎片。」<br>語氣：平穩，**不要轉成興奮或說教**<br>字幕：同上<br>配樂：不變<br>音效：切點輕點 −26dB<br>收音：無<br>來源：`chunk_0005`・`rewritten` |
| S1+S2 | 20–25s | 並排對照（**第二次 pattern interrupt**：畫面一分為二，形態變化最大的一次） | 景別：**上下分割**（上=S1 整條／下=S2 切片）<br>運鏡：兩半皆固定<br>構圖：各半區 1080×960<br>光影：**上半亮度壓低 20%**<br>**程式化疊加**：上半 `✕ 一個字`／下半 `✓ 一個碎片`，各半區左上 | 旁白：「而剛剛說的那個東西／就是**句點**。／／它不是字／但它也是一個 token。」<br>語氣：「句點」加重<br>字幕：同上<br>配樂：不變<br>音效：分割瞬間輕點聲 −26dB<br>收音：無<br>來源：`chunk_0006`・`rewritten` |
| S1+S2 | 25–30s | **收束重述** | 景別：同上（維持分割）<br>運鏡：固定，最後 0.5s 定格<br>構圖：不變<br>光影：不變<br>字卡：`連句點都算一個`，跨越兩半區的中央 | 旁白：「所以連句點／都算一個 token↘」<br>語氣：〔慢〕收尾下沉，重音落在「句點」<br>字幕：同上<br>配樂：最後 1.5s 淡出<br>音效：底噪淡出<br>收音：無<br>來源：`chunk_0006`・`rewritten` |

總字數 142。**無 `ai_added` 句。**

> S1 第二列提到的「中文的『今天』算一個還兩個」是**反問，不是答案**——影片沒有回答它，因為資料庫片段沒講。這樣用是安全的：它製造缺口、把觀眾推向原片，而不是給出無來源的結論。**不要改寫成肯定句**，一改就變成 `ai_added`。

**備選開場**：預設「錯誤警告」，這支片的結構本來就是它。

| 公式 | 句子 | 開場要跟著改 |
|------|------|--------------|
| **反常識** | 「一個 token，不一定是一個字。」 | ✕ 改成問號並延後到第 3 秒 |
| **清單預告** | 不建議 | 會讓對照結構失焦 |

## 生成鏡 Prompt

兩鏡**必須同機位、同光線、同構圖**，只有內容不同——這樣分割並排時對照才成立。用 S1 成品當 `referenceImages`。

兩鏡都是 **Profile A**，而且**兩張圖的文字必須落在完全相同的位置**——分割並排時上下兩行字要對齊，沒對齊就不像對照表，像兩張隨便疊起來的圖。

### S1（0–14s，放慢至 14 秒）

```
imagePrompt: |
  A vertical 9:16 cinematic still.
  Subject: a whole uncut loaf of pale bread centred on a plain wooden board
  Action/State: still, uniform and unremarkable
  Setting: a kitchen counter, flat even overhead light, symmetrical composition
  Text: the exact text "一個 token 一個字" appears, cleanly rendered,
        high contrast, horizontally centred in the upper third,
        no other text anywhere in the image.
  Style: soft natural light, low contrast, muted desaturated palette,
         shallow depth of field, generous negative space in the upper and lower thirds,
         realistic photography, calm and unobtrusive
  Framing: vertical 9:16 aspect ratio, 1080x1920
  NEGATIVE: misspelled text, garbled letters, duplicated text, extra words,
            watermarks, logos, user interface elements, recognizable human faces, knife, hands, packaging, printed wrapper

videoPrompt: |
  Animate this image. 8 seconds.
  Motion: fine dust drifts slowly; the loaf remains completely static
  Camera: static
  Amplitude: minimal, gentle, natural. No abrupt movement.
  Do not add any object not present in the source image.
  Preserve all text in the source image exactly as it appears.
```

### S2（14–30s，放慢至 16 秒）

```
imagePrompt: |
  A vertical 9:16 cinematic still.
  Subject: the same loaf now fully sliced, the slices standing in an even row on the board
  Action/State: still
  Setting: the same kitchen counter, same flat even overhead light, same camera position
  Text: the exact text "拆成碎片的每一塊" appears, cleanly rendered,
        high contrast, horizontally centred in the upper third,
        in the same position and at the same size as in the reference image,
        no other text anywhere in the image.
  Style: soft natural light, low contrast, muted desaturated palette,
         shallow depth of field, generous negative space in the upper and lower thirds,
         realistic photography, calm and unobtrusive
  Framing: vertical 9:16 aspect ratio, 1080x1920
  NEGATIVE: misspelled text, garbled letters, duplicated text, extra words,
            watermarks, logos, user interface elements, recognizable human faces, knife, hands, packaging, printed wrapper

videoPrompt: |
  Animate this image. 8 seconds.
  Motion: fine dust drifts slowly; the slices remain completely static
  Camera: static
  Amplitude: minimal, gentle, natural. No abrupt movement.
  Do not add any object not present in the source image.
  Preserve all text in the source image exactly as it appears.
```

> **同機位是這支片的技術重點**，v6 之後變成**同機位 + 同文字位置**。prompt 裡明寫 `same camera position` 與 `in the same position and at the same size as in the reference image`，並用 S1 的成品當 `referenceImages`。
>
> **兩鏡都是靜態鏡**（`Camera: static`），這對 profile A 是好事——不動的鏡頭最不容易讓 baked-in 的字跑掉。這支是十支裡最適合用生成文字的一支。
>
> 若 G2 一直過不了，退回 profile B + 程式化字卡，對照結構完全不受影響，只是少了「字長在畫面裡」的整體感。

## 驗證紀錄

```js
shots: [
  { shotId: 'S1', profile: 'A', expectedText: '一個 token 一個字',
    g2: { passed: null, ocrResult: null, retryCount: 0,
          fellBackToProgrammatic: false, verifiedAfterVideo: null } },
  { shotId: 'S2', profile: 'A', expectedText: '拆成碎片的每一塊',
    g2: { passed: null, ocrResult: null, retryCount: 0,
          fellBackToProgrammatic: false, verifiedAfterVideo: null } },
],
narration: {
  mode: 'script_locked',
  g3: { passed: null, similarity: null, keyTermsAllPresent: null, retryCount: 0 },
}
```

**G3 關鍵詞**：`token`、`句點`。

**G2 的額外檢查**：除了逐字比對，這支還要確認**兩張圖的文字位置一致**（分割並排時上下對得齊）。位置不一致但字都對，仍算 G2 過，但要人工調整或重出。

## 聲音設計（對照片的語氣是關鍵）

這支片的內容在講「你想錯了」，**聲音一旦帶情緒就會變成指責**。畫面上的紅色 ✕ 已經夠強烈，聲音必須往回拉。

| 項目 | 規格 |
|------|------|
| 整體語氣 | **陳述，不是糾正**。TTS 用 `speakingRate 1.0`，不要加 `emphasis level="strong"` |
| 錯誤段（0–14s） | 語氣**不可上揚、不可加重**。上揚會變成質問（「你居然以為是一個字？」），這支片就毀了 |
| 正確段（14–20s） | 語氣同樣平穩，**不要轉成興奮或說教**。對照的力量來自畫面，不是語調 |
| ✕ 的 thud | −22dB，**全片只有一次**。第 2 秒與畫面上的 ✕ 落下同格 |
| ✓ 的聲音 | **不給音效**。✓ 靜靜出現就好——給了音效就變成「答對了」的遊戲音，太輕浮 |
| 分割瞬間（20s） | 一個極輕的分割音 −26dB |
| `token` 唸法 | 全片出現 5 次，**唸法必須一致**。TTS 合成後逐次聽過 |
| 配樂 | ambient pad −30 LUFS，另加**一個低頻 stab** 落在第 2 秒（與 thud 疊在一起，讓鉤子更實） |
| 音效總數 | thud、切鏡輕點、分割音，**三種，不可再加** |

### 一個容易做錯的地方

分割畫面之後上下各是一段影片，很容易想給上下各配一個聲音（上半低沉、下半明亮）。**不要**。畫面已經用明暗（上半壓暗 20%）在區分了，聲音再區分一次是過度設計，而且分割只有 10 秒，兩個聲音層會互相打架。

## POST

### 分割畫面（20–30s）

直式影片用**上下切，不要左右切**——左右切每半邊只剩 540px 寬，什麼都看不清。

```bash
ffmpeg -i shot1.mp4 -i shot2.mp4 -filter_complex \
"[0:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[top];\
 [1:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960[bot];\
 [top][bot]vstack=inputs=2" \
-c:a copy split.mp4
```

**上半（錯誤）刻意壓暗 20%**，靜音播放時光靠明暗就知道哪個是對的。

右上角固定「AI 示意畫面」標示。

**驗收（共用清單外加）**
- [ ] 每一列的「來源」欄都有值，且 chunkId 存在於 `video_segments_text`
- [ ] 最後 5 秒是收束重述，沒有導流字卡
- [ ] 「今天算一個還兩個」維持反問，沒有被改寫成肯定句
- [ ] 兩鏡機位、光線、構圖一致（並排時像同一塊麵包）
- [ ] 分割用上下切，不是左右切
- [ ] 錯誤段的語氣沒有嘲諷
- [ ] thud 只出現一次，✓ 沒有配音效
- [ ] 靜音播放時分得出哪邊是正確的
- [ ] ✕ / ✓ 記號為程式化渲染，非生成
- [ ] S1、S2 的 `expectedText` 都與 OCR 回讀逐字相同
- [ ] **兩張圖的文字位置一致**（分割並排時上下對得齊）
- [ ] 影片生成後複驗過，兩鏡的字都沒有被改掉
