# 02・教師實拍口播

> 共用素材、分鏡表格式、吸引力規格、聲音規格、三道驗證關見 [_shared-conventions.md](_shared-conventions.md)（v7）。本檔只寫這支片的差異。
>
> **成本 NT$0，可信度最高。** 沒有任何生成鏡頭，AI 只負責把 QA 答案濃縮成 30 秒口播稿。學生看到的是授課老師本人，這是生成畫面換不來的東西。
>
> **v6 變更**：本體不變（全實拍就沒有 G2 的問題），另附 **§B 虛擬講解員版本**當替代方案。**主版本是本體版**，理由見 §B 開頭。

## META

```yaml
id: SV-02
presentation: teacher_piece_to_camera
facePolicy: real_person
personGeneration: n/a
durationSec: 31
generatedShots: 0
liveActionShots: 4
teacherOnCamera: true
estimatedCostTwd: 0
courseId: 69f82564736febac6db8e97b
sourceVideoId: 6a67ffd295668cc2b904f3c4
primaryStartSec: 56
chunksUsed: [chunk_0005, chunk_0006, chunk_0007]
narration: 教師現場同步收音（不用 TTS）
cameras: 2                      # A 機位 35mm、B 機位 50mm
teacherApprovalRequired: false
```

## 分鏡腳本表

| 鏡號 | 秒數 | Beat | 畫面 | 聲音 |
|------|------|------|------|------|
| S1 | 0–3s | **鉤子・錯誤警告** | 景別：中近景（胸上）・35mm・A 機位<br>運鏡：固定<br>構圖：置中偏右，眼睛在上 1/3 線，頭頂留 8–10%<br>光影：主光左前 45°／高 30°，柔光箱，明暗比 3:1<br>字卡：`不是一個字` 96px 高對比，0.3s 彈入 | 旁白：「你在算 ChatGPT 要花多少錢／但**單位**可能算錯了↘」<br>語氣：不責備、平穩敘述。重音落在「單位」。**不要唸成質問句**<br>字幕：逐字同步（karaoke）<br>配樂：ambient pad 極輕，−32 LUFS<br>音效：字卡彈入輕擊 −22dB<br>收音：領夾麥 20cm／HPF 80Hz／安全軌 −12dB<br>來源：`chunk_0007`・`rewritten` |
| S1 | 3–7s | 共鳴 | 景別：同上（不切鏡）<br>運鏡：固定<br>構圖：不變<br>光影：不變<br>字卡：學生原問句 `說明token是什麼?`，左側小字，7s 淡出 | 旁白：「有同學問我／token 到底是什麼。／／這題講清楚了／後面很多事都會通。」<br>語氣：語速略降，像在轉述<br>字幕：同上<br>配樂：不變<br>音效：—<br>收音：同上<br>來源：`verbatim` + `template` |
| S2 | 7–13s | 給結論 | 景別：同上・35mm<br>運鏡：極慢推近（全片約 5%，不該被察覺）<br>構圖：不變<br>光影：不變<br>字卡：`token = 把句子拆成碎片`，上 1/3 | 旁白：「token 不是一個字／它是把原本的一句話／**拆成碎片**之後的東西↘」<br>語氣：講到「拆成碎片」時略停，讓字卡跟上<br>字幕：同上<br>配樂：不變<br>音效：字卡推入輕點聲 −24dB<br>收音：同上<br>來源：`chunk_0005`・`rewritten` |
| S3 | 13–18s | **第一次 pattern interrupt**（切機位） | 景別：中景・50mm・B 機位（偏左 45° 側身）<br>運鏡：固定<br>構圖：移到畫面左 1/3，右側整片留白<br>光影：加背景光（後方 1.5m 暖色 practical light）<br>字卡：右側第一行推入 | 旁白：「拆開之後／每一個碎片／都是一個 token。」<br>語氣：三個短句節奏一致<br>字幕：同上<br>配樂：不變<br>音效：切點輕點 −26dB<br>收音：同上<br>來源：`chunk_0006`・`rewritten` |
| S3 | 18–21s | **Open loop** | 景別：同上（不切鏡）<br>運鏡：固定<br>構圖：不變<br>光影：不變<br>字卡：第一行縮小移到左上 | 旁白：「而且有一個東西／大家都會忘記算↗」<br>語氣：**句尾上揚，全片唯一一次**；講完停 0.4 秒<br>字幕：同上<br>配樂：不變<br>音效：—<br>收音：同上<br>來源：`chunk_0006`・`rewritten` |
| S3 | 21–27s | **第二次 pattern interrupt**（字卡逐行） | 景別：同上<br>運鏡：極慢推近<br>構圖：不變<br>光影：不變<br>字卡：兩行逐行推入，前行不消失 | 旁白：「**句點**也是一個 token。／／所以 ChatGPT 跟其他語言模型／計費方式都跟這個有關↘」<br>語氣：「句點」加重<br>字幕：同上<br>配樂：不變<br>音效：字卡推入輕點 −24dB<br>收音：同上<br>來源：`chunk_0006`・`chunk_0007`・`rewritten` |
| S4 | 27–31s | **收束重述** | 景別：中近景收緊・35mm・A 機位<br>運鏡：固定，最後 0.5s 定格<br>構圖：回到置中偏右<br>光影：補光板拉近半格，明暗比降到 2:1（語氣轉友善）<br>字卡：`連句點都算一個`，中央 | 旁白：「所以連最後那個**句點**／都算一個 token↘」<br>語氣：〔慢〕友善收尾，重音落在「句點」<br>字幕：同上<br>配樂：最後 1.5s 淡出<br>音效：—<br>收音：同上<br>來源：`chunk_0006`・`rewritten` |

總字數 148。**無 `ai_added` 句。**

**備選開場**：本片預設「錯誤警告」，由老師本人講份量最重。另兩種：

| 公式 | 句子 |
|------|------|
| **反常識** | 「一個 token，不一定是一個字。」 |
| **清單預告** | 「一句話丟進 ChatGPT，會被拆成幾個東西？」 |

## 聲音設計（本片為真人收音，與 TTS 五支不同）

| 項目 | 規格 |
|------|------|
| 整體語氣 | 像在辦公室對一個學生講話，不是對著攝影機演講。**不要用上課的音量** |
| 語速 | 每分鐘約 280–300 字。念完計時，超過 31 秒就砍字不要加速 |
| 換氣 | 每個 `／／` 都是換氣點，**換氣聲要保留**——修得太乾淨反而像 AI 配音 |
| 重音配置 | 全片 4 個：`單位`、`拆成碎片`、`句點`（×2，第二次是收束）|
| 英文字唸法 | 老師唸 `token`、`ChatGPT` 是自然口音，**不用刻意標準化**。這是真人版相對 TTS 的優勢，不要後製改掉 |
| 配樂 | ambient pad −32 LUFS，比其他支更輕（真人聲音已經夠撐場） |
| 安全軌 | 老師講到「句點也是一個 token」時音量會自然拉高，安全軌必錄 |
| 後製 | HPF 80Hz 濾冷氣低頻；de-esser 輕壓齒音；**不要用降噪過度**，會出現水下感 |

## 燈光配置

```
                    [背景光 暖色]
                          │
                       (背景牆)
                          │  ← 教師離背景 ≥ 1.5m
                       (教師)
                      ╱       ╲
        [主光 45°/高30°]      [反光板 1/4 強度]
             柔光箱                白色
                      ╲       ╱
                   [A機位]  [B機位]
                    35mm     50mm
```

- 主光**距離愈近光愈柔**，不要為了怕過曝把燈拉遠
- 補光是讓暗部看得到細節，不是把臉打平
- **色溫統一 5000K**，教室日光燈與窗光不要混
- 只有自然光時：教師側對窗、窗在左前 45°，對側放反光板

## 拍攝參數

| 項目 | 設定 |
|------|------|
| 焦段 | A 機位 35mm（等效）／B 機位 50mm |
| 光圈 | f/2.0–f/2.8 |
| 快門 | 1/50（30fps） |
| 解析度 | 1080×1920 直拍，或 4K 拍後裁切 |
| 收音 | 領夾麥距嘴 20cm，HPF 80Hz，另錄 −12dB 安全軌 |
| 眼神 | 全程看鏡頭，提詞貼在鏡頭正上方 |

**麥克風是這支片最大的風險**：畫面差學生能忍，聲音差直接滑走。

## 背景注意

背景**不可拍到白板板書、投影片、課表、學生姓名**。這支片講的是 NLP 內容，若背景剛好有另一堂課的板書，學生會誤以為有關聯。背景一律清空或用淺景深糊掉。

## POST

無生成畫面，**不需要「AI 示意畫面」標示**。

**驗收（共用清單外加）**
- [ ] 每一列的「來源」欄都有值，且 chunkId 存在於 `video_segments_text`
- [ ] 教師念的每一句都指得回 chunkId
- [ ] 最後 5 秒是收束重述，沒有導流字卡
- [ ] 背景沒有拍到板書、課表、學生資訊
- [ ] 兩機位色溫、曝光一致，切換時不跳
- [ ] 安全軌有錄到，且未破音
- [ ] 開場那句聽起來不像質問

> **本版沒有 G2 也沒有 G3**：畫面全實拍、聲音是教師本人現場收音，沒有生成內容需要回讀驗證。字卡全部程式化渲染。**這是十支裡驗證負擔最低的一支。**

---

# §B 虛擬講解員版本（v6 新增）

**同一份腳本、同一組 chunkId、同一個分鏡表**，只把教師換成 AI 生成的固定講解員。

## 定位（已定案）

**本體版（教師實拍）是這支片的主版本，§B 是替代方案。**

理由：這支在十支裡的唯一優勢就是「學生看到的是自己的老師」。換成 AI 講解員之後，它的畫面、節奏、資訊量都輸給 01 與 09，而且成本從 NT$0 變成有平台月費——**沒有理由主推 §B**。

| 情況 | 用哪一版 |
|------|----------|
| 預設 | **本體版**。真人的可信度換不來 |
| 老師確定排不出時間、且非做不可 | §B |
| 要一次產二十支 | 用 01 或 09，不要用 §B——它們本來就是為量產設計的 |

## META 差異

```yaml
id: SV-02B
facePolicy: virtual_presenter
personGeneration: allow_adult
generatedShots: 4              # 原本 0
liveActionShots: 0
presenter:
  enabled: true
  characterId: ff-presenter-01     # 同課程所有短影音共用
  disclosureLabel: "AI 講解員"
  impersonatesRealPerson: false    # 必須為 false 才可發布
narration:
  mode: script_locked              # 預設走路線 A
  voice: TTS 或授權的語音模型
estimatedCostTwd: 依所選數位人平台而定（本體版是 NT$0，這一版不是）
```

## 分鏡對應

原本的 A/B 兩機位改成兩種景別，其餘完全不動：

| 原本 | §B 版 |
|------|-------|
| S1、S2、S4 — A 機位 35mm 中近景 | Profile C，胸上景，講解員置中偏右 |
| S3 — B 機位 50mm 側身 | Profile C，中景，講解員移到畫面左 1/3 |
| 燈光配置（主光 45°／背景光） | 寫進 prompt 的 `Lighting:` 欄位 |
| 領夾麥收音 | 改為腳本鎖定的合成語音 |

**每一鏡的旁白、語氣標記、字卡、來源欄全部照抄本體版，一個字都不用改。**

## Prompt（Profile C）

```
A vertical 9:16 portrait still.
Subject: an adult presenter in their early thirties, short neat dark hair,
         plain dark crew-neck top, no accessories, no glasses,
         neutral warm skin tone, calm resting expression
Action/State: facing camera, mid-gesture, calm and approachable
Setting: a plain out-of-focus indoor background, softly lit
Lighting: soft key from camera left 45°, gentle fill from the right,
          even skin tone, contrast ratio about 3:1
Composition: chest-up framing, subject centred slightly right,
             eyes on the upper-third line,
             generous negative space in the upper and lower thirds
Style: realistic photography, documentary feel
Framing: vertical 9:16 aspect ratio, 1080x1920
NEGATIVE: text, letters, numbers, logos, watermarks, university crest,
          uniform insignia, extra limbs, deformed hands, warped face
```

`Subject:` 那段外貌描述是**固定字串（暫定值）**，同課程所有短影音共用，並配 reference image。

第一次做的時候先出 5–10 張候選、選定一張當永久 reference，**之後所有片子都用同一張**。選定後把這裡的暫定描述改成與該張圖一致的文字。

> 外貌刻意寫得平淡（無眼鏡、無配件、素色上衣）——**特徵越少越容易跨支重現**。有辨識度的外型看起來好看，但二十支下來飄掉的機率高很多。

## 四條規則（不可省略）

1. **固定角色**：同課程共用同一個 `characterId` 與 reference image
2. **可見標示**：角落常駐 `AI 講解員`，與「AI 示意畫面」同樣是必要元素
3. **不得冒充**：不取授課教師姓名、不模仿其長相與聲線、不以第一人稱聲稱是授課教師
4. **未經書面同意，不得複製真實師生的臉或聲音**——這條不放寬

## §B 版的驗收（本體版清單外加）

- [ ] 角落有 `AI 講解員` 標示，全片常駐
- [ ] 講解員長相與 reference image 一致（跨支比對過）
- [ ] 畫面無校徽、系徽、制服標誌
- [ ] 手部沒有崩壞（多指、變形）
- [ ] 嘴型與語音對得上
- [ ] G3：ASR 回讀與腳本相似度 ≥ 0.95，`token`／`ChatGPT`／`句點` 全中
- [ ] `impersonatesRealPerson === false`

## §B 版的已知風險

- **跨支長相會飄**。reference 鎖不一定守得住，二十支下來可能變成好幾個人。每支完成後要與 reference 並排比對
- **嘴型對不上中文**是數位人平台的常見弱點，選型時要用中文試片段
- **成本從 NT$0 變成有平台月費**，這是本體版最大的優勢被拿掉的地方
