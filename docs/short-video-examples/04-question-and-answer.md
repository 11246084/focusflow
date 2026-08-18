# 04・學生提問 × 教師回答

> 共用素材、分鏡表格式、吸引力規格、聲音規格、三道驗證關見 [_shared-conventions.md](_shared-conventions.md)（v7）。本檔只寫這支片的差異。
>
> 一問一答的雙人剪接。**鉤子最強的一種**——學生原問句由學生自己講出來，不是教師轉述。**學生只拍背影 + 出聲**，代入感反而更強。
>
> **v6 變更**：S5 空鏡改為 profile A（把 `拆成碎片` 生成進畫面），須通過 G2。實拍段不受影響。

## META

```yaml
id: SV-04
presentation: question_and_answer
facePolicy: real_person
personGeneration: dont_allow
durationSec: 33
generatedShots: 1
liveActionShots: 5
teacherOnCamera: true
estimatedCostTwd: 40
courseId: 69f82564736febac6db8e97b
sourceVideoId: 6a67ffd295668cc2b904f3c4
primaryStartSec: 56
chunksUsed: [chunk_0005, chunk_0006, chunk_0007]
studentPresence: back_and_voice   # 定案：學生只拍背影 + 出聲，不露臉
consent: 學生只出背影與聲音，仍需口頭同意錄音；不需肖像同意書
cameras: 2                      # 學生 50mm、教師 35mm
teacherApprovalRequired: false
```

## 分鏡腳本表

問答型的節奏是**問句短、答句長，中間不要有停頓**。

| 鏡號 | 秒數 | Beat | 畫面 | 聲音 |
|------|------|------|------|------|
| S1 | 0–3s | **鉤子・學生原話當 pattern interrupt** | 景別：中近景・50mm・學生機位<br>運鏡：固定<br>構圖：**過肩背影**，學生置中偏**左**、面向畫面右外（不露臉）<br>光影：窗光單邊逆光，明暗比 4:1，人物幾乎剪影（刻意比教師暗）<br>字卡：`token 是什麼` 96px 高對比，**0.3s 彈入**；`學生提問` 小標，左上灰底 | 旁白（學生）：「老師／每次都看到 token 這個字／但我**一直不知道它是什麼**↘」<br>語氣：有點不好意思、略小聲，**不要演**。真實的困惑聽起來是低的<br>字幕：逐字同步，淺灰底（區分說話者）<br>配樂：無或極輕 −34 LUFS<br>音效：字卡彈入輕點聲 −24dB<br>收音：領夾麥 20cm／HPF 80Hz／安全軌 −12dB<br>來源：`verbatim`（原問句「說明token是什麼?」擴寫成口語） |
| S1 | 3–6s | 共鳴（補完問題） | 景別：同上（不切鏡）<br>運鏡：固定<br>構圖：不變<br>光影：同上<br>字卡：大字卡淡出，只留小標 | 旁白（學生）：「它是一個字嗎？還是一個詞？」<br>語氣：同上<br>字幕：同上<br>配樂：不變<br>音效：—<br>收音：同上<br>來源：`template` |
| S2 | 6–13s | 教師給結論（**pattern interrupt**：切機位＋明暗反轉） | 景別：中近景・35mm・教師機位<br>運鏡：固定<br>構圖：置中偏**右**，視線看向畫面左外<br>光影：柔光箱主光 + 反光板，明暗比 2.5:1（比學生亮）<br>字卡：`token = 把句子拆成碎片`，上 1/3 | 旁白（教師）：「都不是。／token 是把原本的一句話／**拆成碎片**之後的東西。」<br>語氣：先否定再給定義，「都不是」講完停 0.3 秒<br>字幕：標準白字黑邊<br>配樂：不變<br>音效：字卡推入輕點聲 −24dB<br>收音：同上<br>來源：`chunk_0005`・`rewritten` |
| S3 | 13–16s | **Open loop**（追問即微鉤子） | 景別：同 S1 收緊・50mm<br>運鏡：固定<br>構圖：不變（仍為背影）<br>光影：同 S1<br>字卡：— | 旁白（學生）：「那怎麼拆？拆到多小？」<br>語氣：追問，語速略快<br>字幕：淺灰底<br>配樂：不變<br>音效：—<br>收音：同上<br>來源：`template` |
| S4 | 16–22s | 教師展開 | 景別：同 S2・35mm<br>運鏡：極慢推近<br>構圖：不變<br>光影：同 S2<br>字卡：`每一個碎片 = 一個 token`，右側推入 | 旁白（教師）：「拆開之後／每一個碎片都是一個 token。／／而且**連最後那個句點**／也算一個。」<br>語氣：「連最後那個句點」加重<br>字幕：標準白字黑邊<br>配樂：不變<br>音效：同上<br>收音：同上<br>來源：`chunk_0006`・`rewritten` |
| S5 | 22–28s | 視覺化「拆成碎片」（**第二次 pattern interrupt**：切到空鏡） | **Profile：A**<br>`expectedText`: `拆成碎片`<br>景別：中景（生成）<br>運鏡：橫移，由整條掃到切片<br>構圖：一半是未切的整條、一半是切好排開的片，字在上 1/3<br>光影：均勻晨光，低對比<br>**程式化疊加**：`計費方式跟 token 有關`，前行不消失（會動，不生成） | 旁白（教師）：「所以 ChatGPT／還有其他語言模型／計費方式基本上／都跟這個有關↘」<br>語氣：平述收束<br>字幕：標準白字黑邊<br>配樂：不變<br>音效：切點輕點 −26dB<br>收音：無（原生音軌剝除，走腳本鎖定語音）<br>來源：`chunk_0007`・`rewritten` |
| S6 | 28–33s | **收束重述** | 景別：同 S2 收緊・35mm<br>運鏡：固定，最後 0.5s 定格<br>構圖：不變<br>光影：同 S2<br>字卡：`連句點都算一個`，中央 | 旁白（教師）：「所以連最後那個**句點**／都算一個 token↘」<br>語氣：〔慢〕友善收尾，重音落在「句點」<br>字幕：標準白字黑邊<br>配樂：最後 1.5s 淡出<br>音效：—<br>收音：領夾麥／HPF 80Hz／安全軌<br>來源：`chunk_0006`・`rewritten` |

總字數 152。

> **S1 的旁白是把資料庫原問句「說明token是什麼?」擴寫成口語**。原問句太短（7 個字），直接唸不像人講話。擴寫只是加語氣詞與情境，**沒有新增觀念內容**，所以維持 `verbatim`；S3 的追問句是設計出來承接節奏的 `template`。若追問句裡出現任何觀念性內容，就必須降級成 `ai_added` 並送教師勾選。

## 三個拍攝重點

**學生只拍背影 + 出聲（定案）。** 免肖像同意書的流程，而且困惑的聲音比臉更有代入感——**背影反而讓學生更容易把自己代入那個位置**。臉一旦出現，觀眾看到的就是「某個人」而不是「我」。

**朝向必須相反**：學生背影面向畫面右外、教師看向畫面左外，剪在一起才像在對話。兩人都朝同一邊會變成各說各話。**背影沒有視線，所以靠身體朝向與肩線角度來給方向**——拍的時候讓學生的肩線明顯往右偏。

**明暗差是刻意的**：學生逆光近乎剪影代表「還在困惑」，教師打亮代表「這裡有答案」。不要打成一樣。背影版的明暗差可以拉得比原本更大（4:1 甚至 5:1），因為不需要看清五官。

## 生成鏡 Prompt

### S5（Profile A — 帶指定文字）

```
imagePrompt: |
  A vertical 9:16 cinematic still.
  Subject: a wooden board holding an uncut loaf of pale bread on the left and a row of
           evenly cut slices on the right
  Action/State: still, even morning light
  Setting: a quiet kitchen counter
  Text: the exact text "拆成碎片" appears, cleanly rendered,
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
  Motion: only dust and light shift; the bread remains static
  Camera: slow lateral pan from the whole loaf to the row of slices
  Amplitude: minimal, gentle, natural. No abrupt movement.
  Do not add any object not present in the source image.
  Preserve all text in the source image exactly as it appears.
```

裁至 6 秒。這一鏡的作用是**把「拆成碎片」做成一個看得到的動作**——鏡頭從整條移到切片，同時畫面上就寫著那四個字，剛好對上口播。

> **注意這一鏡是橫移的**。橫移最容易讓 baked-in 的文字跟著跑掉或被裁切，所以 §4 的 G2 複驗（抽首/中/末格）對這一鏡特別重要。若複驗一直不過，退回 profile B + 程式化字卡即可，畫面本身仍然成立。

## 驗證紀錄

```js
shots: [
  { shotId: 'S5', profile: 'A', expectedText: '拆成碎片',
    g2: { passed: null, ocrResult: null, retryCount: 0,
          fellBackToProgrammatic: false, verifiedAfterVideo: null } },
],
narration: {
  mode: 'live_recording',      // 實拍收音，非合成
  g3: { passed: null, similarity: null, keyTermsAllPresent: null, retryCount: 0 },
}
```

**實拍收音仍然跑 G3**，但目的不同：不是防模型亂編，是確認**兩人講的內容與核准腳本一致**（現場可能講漏或改口）。關鍵詞清單：`token`、`ChatGPT`、`句點`。

## 聲音設計（雙人對話特有）

| 項目 | 規格 |
|------|------|
| 兩人音色 | 學生略小聲、語速略快（困惑的人講話會快）；老師略大聲、語速穩。**兩人音量差 3dB** |
| 接話 | 老師的第一個字要**壓在學生最後一個字結束後 0.2 秒內**。停超過 0.5 秒就不像對話，像兩段獨白剪在一起 |
| `token` 唸法 | **兩人唸法要一致**。學生唸「拓肯」老師唸「透肯」會很出戲，開拍前先對過 |
| 換氣 | 學生的換氣聲保留，這是真實感的來源 |
| 收音 | **兩人各一支領夾麥、各錄一軌**。共用一支指向麥會導致音量與空間感不一致 |
| 配樂 | 無或 −34 LUFS。對話已有節奏，配樂只會擠壓 |
| 禁止 | 不要加罐頭笑聲、不要加「叮」的提示音——這是課程內容不是綜藝 |

## POST

**字幕要區分說話者**：學生的加淺灰底、教師的用標準白字黑邊，靜音播放才分得出誰在講。

只有 S5 需疊「AI 示意畫面」標示。

**驗收（共用清單外加）**
- [ ] 每一列的「來源」欄都有值，且 chunkId 存在於 `video_segments_text`
- [ ] 最後 5 秒是收束重述，沒有導流字卡
- [ ] 學生全程只有背影，任何一格都沒有拍到臉
- [ ] 學生肩線朝右、教師看向左，兩人朝向相反
- [ ] 兩人的 `token` 唸法一致
- [ ] 靜音播放時分得出誰在說話
- [ ] 學生的追問句未夾帶觀念性內容
- [ ] 生成空景與實拍段色溫一致（都是 5000K）
- [ ] S5 的 `expectedText` 與 OCR 回讀逐字相同
- [ ] **S5 橫移後複驗過**，`拆成碎片` 四個字沒有跑掉或被裁切
- [ ] G3：兩人實際講的內容與核准腳本一致，關鍵詞全中
