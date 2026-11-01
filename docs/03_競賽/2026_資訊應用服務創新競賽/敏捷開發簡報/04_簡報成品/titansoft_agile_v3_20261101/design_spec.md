<!-- ppt-master-schema: design-spec/v1 -->
# titansoft_agile_v3 - Design Spec

## I. Project Information

| Item | Value |
| --- | --- |
| Project Name | titansoft_agile_v3（FocusFlow AI 敏捷開發簡報第三版，匿名審查版） |
| Canvas Format | ppt169（1280×720） |
| Page Count | 38（正文 30＋證據附錄 8） |
| Primary Language | zh-Hant-TW |
| Target Audience | 鈦坦敏捷開發特別獎決賽評審，重視團隊實際怎麼調整、證據是否透明、技術處理是否確實 |
| Communication Intent | 用兩個真實案例，說明團隊遇到外部變動和品質問題時，怎麼小步調整、留下紀錄、驗證結果 |
| Desired Audience Outcome | 評審相信這是真的在跑的流程（有證據編號可查），也看到團隊誠實說出還沒做到的地方 |
| Core Message / Ask / Action | 需求一直在變，我們靠看板和每週進度檢視小步調整，每一步都留下可追溯的紀錄 |
| Delivery Context | 決賽現場約 6 分鐘、由人主講；之後約 7 分鐘問答，會跳到備用頁與證據附錄 |
| Artifact Afterlife | 留給團隊準備問答；不對外的內部證據對照表另外存放，不放進簡報 |
| Reading Mode | presentation |
| Content Strategy | 以 sources/第三版_分鏡與素材需求.md 第 3 節逐頁分鏡為定稿頁序與文字依據（使用者已逐頁確認），標題與講稿沿用；事實只來自該文件與其引用的 09～11 分析文件，不新增事實 |
| Design Style | 方向 A：編輯敘事為主的混合動態敘事（Motion Editorial 主導，產品發表式開場，資訊圖只用在真正有數字的地方） |
| AI Image Acquisition Path | not applicable |
| Generation Mode | continuous（先做三段樣板 14 頁給使用者確認，再做其餘頁；使用者指定的分段，不是 split 模式） |
| Spec Refinement | disabled |
| Speaker Notes | enabled — final Stage-2 proactive policy（使用者 2026-11-01 照建議採 A） |
| Custom Animations | enabled — final Stage-2 proactive policy（Morph 與少量進場效果；Canva 相容性未驗證） |
| Narration Audio | disabled — final Stage-2 proactive policy |
| Created Date | 2026-11-01 |

## II. Canvas Specification

| Property | Value |
| --- | --- |
| Format | PPT 16:9 |
| Dimensions | 1280 × 720 |
| viewBox | `0 0 1280 720` |
| Margins | 左右 64，上 48，下 40 |
| Content Area | x 64–1216，y 48–680 |

## III. Visual Theme

### Theme Style

- **Mode**: custom
- **Mode References**: narrative, showcase
- **Mode Behavior**: 一頁一句話的案例敘事。開場三頁用產品發表節奏（深青滿版、一句主張、產品畫面）；正文每章以「章節開場頁」重置，章內頁面是同一場景的連續狀態（時間軸、看板、堆疊條），每頁只往前推一步；標題就是講者要說的那句話，詳細說明放講稿。
- **Visual Style References**: editorial, swiss-minimal
- **Visual Style Behavior**: 米白紙面＋編輯式排版：大號粗體標題靠左、上方 kicker 小標與短琥珀線，細線規分隔；直角或 6px 小圓角的平面色塊，無陰影無漸層；深青滿版只用在封面、章節開場與結尾；案例頁共用一條橫向日期軸作為跨頁母題，軸上目前節點以琥珀標示並逐頁前移（Morph）；大數字只出現在有原始紀錄的數字上；證據以右下角 E 編號小標籤呈現；產品截圖以細框原樣置入不裁切。
- **Theme**: 產品 Logo 配色（深青、琥珀、米白），看板四色帶與日期軸為跨頁母題
- **Tone**: 誠實、克制、有節奏；不誇大、不使用行銷語氣

### Color Scheme

| Role | HEX | Purpose |
| --- | --- | --- |
| Background | #FBF8F2 | 內容頁紙面 |
| Secondary background | #F5EFE3 | 卡片、附錄表格底 |
| Primary | #1B4D5C | 標題、滿版開場頁底色、強調卡 |
| Accent | #E8A93C | 目前節點、決策點、關鍵數字、短線母題 |
| Secondary accent | #5E8F9C | kicker、次要節點、行動標籤 |
| Body text | #15171A | 內文 |
| Secondary text | #5A6066 | 說明、限制、E 編號標籤 |
| Divider | #D9D1C1 | 細線規、外框 |
| Negative | #B5482E | 失敗、風險、缺口 |
| Positive | #3E7D5A | 通過、完成、改善 |

## IV. Typography System

### Font Plan

| Role | Character (Reference) | Primary | English if non-English | Fallback tail |
| --- | --- | --- | --- | --- |
| Title | 粗體黑體，編輯式大標 | Microsoft JhengHei | Microsoft JhengHei | sans-serif |
| Body | 一般黑體 | Microsoft JhengHei | Microsoft JhengHei | sans-serif |

- **Title stack**: Microsoft JhengHei, sans-serif
- **Body stack**: Microsoft JhengHei, sans-serif
- 使用者規格 R4：全份微軟正黑體，只用一般與粗體。

### Font Size Hierarchy

| Purpose | Anchor Size (px) |
| --- | ---: |
| Body | 28 |
| Title | 48 |
| Subtitle | 34 |
| Annotation | 22 |
| Lead | 30 |
| Footnote | 18 |
| Kicker | 20 |
| Statement | 60 |
| Cover title | 76 |
| Hero number | 150 |

## V. Layout Principles

### Deck-wide Direction

- **Hierarchy direction**: kicker → 大標（講者那句話）→ 單一視覺焦點 → 右下 E 編號
- **Composition tendency**: 左對齊編輯式；內容頁一個主視覺，留白多；開場與章節頁深青滿版
- **Cross-page continuity**: 左上短琥珀線＋kicker；案例 A／B 的日期軸在章內逐頁延伸（Morph 候選）；看板四色帶從封面延續到第 7、29 頁
- **Spacing posture**: 依 page_rhythm 變化；breathing 頁大量留白
- **Spacing anchors**: 頁邊 64、區塊間距 32、欄間距 40、圓角 6、內文行高 1.5

## VI. Icon Usage Specification

- **Primary bundled library**: tabler-outline
- **Stroke Width**: 2

| Icon Path | Suitable Scenarios |
| --- | --- |
| icons/tabler-outline/layout-kanban.svg | |
| icons/tabler-outline/calendar-event.svg | |
| icons/tabler-outline/git-merge.svg | |
| icons/tabler-outline/test-pipe.svg | |
| icons/tabler-outline/alert-triangle.svg | |
| icons/tabler-outline/circle-check.svg | |
| icons/tabler-outline/circle-x.svg | |
| icons/tabler-outline/lock.svg | |
| icons/tabler-outline/search.svg | |
| icons/tabler-outline/users.svg | |
| icons/tabler-outline/message-circle.svg | |
| icons/tabler-outline/rocket.svg | |
| icons/tabler-outline/shield-check.svg | |
| icons/tabler-outline/refresh.svg | |
| icons/tabler-outline/list-check.svg | |
| icons/tabler-outline/flag.svg | |
| icons/tabler-outline/player-play.svg | |
| icons/tabler-outline/clock.svg | |
| icons/tabler-outline/database.svg | |
| icons/tabler-outline/server.svg | |
| icons/tabler-outline/cpu.svg | |
| icons/tabler-outline/school.svg | |
| icons/tabler-outline/file-text.svg | |
| icons/tabler-outline/arrow-right.svg | |
| icons/tabler-outline/bug.svg | |

## VIII. Image Resource List

| Filename | Dimensions | Ratio | Purpose | Type | Image pattern | Crop Policy | Acquire Via | Status | Reference | text_policy | page_role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| lockup-color.png | 1920×540 | 3.56 | 產品 Logo（淺底） | Logo | 封面與結尾的產品標識 | no-crop | user | Existing | docs/05_圖庫/Logo，產品標識非學校標識 | none | local |
| lockup-white.png | 1920×540 | 3.56 | 產品 Logo（深底） | Logo | 深青滿版頁的產品標識 | no-crop | user | Existing | 同上 | none | local |
| mark-color.png | 800×800 | 1.00 | 頁角小標識 | Logo | 內容頁右上小標 | no-crop | user | Existing | 同上 | none | local |
| mark-white.png | 800×800 | 1.00 | 深底頁角小標識 | Logo | 深青頁右上小標 | no-crop | user | Existing | 同上 | none | local |
| p03_jump.png | 3200×1800 | 1.78 | 產品問答與時間點跳轉（已遮蔽講者影像與頭像） | Screenshot | 細框原樣置入，旁加編號標註指向提問、回答、25:36 片段 | no-crop | user | Existing | IMG-02 遮蔽版；R3 已遮影片畫面 | none | local |
| p07_kanban.png | 3200×1800 | 1.78 | 看板四欄結構（卡片內文全遮） | Screenshot | 細框置入，標示「已去識別」 | no-crop | user | Existing | IMG-04(1) 遮蔽版 B | none | local |
| p25_report_form.png | 3200×1800 | 1.78 | 學生端回報問題表單 | Screenshot | 細框小圖，作為回報機制佐證 | no-crop | user | Existing | IMG-12(2) | none | local |

## IX. Content Outline

### Part 1: 開場與產品

#### Slide 01 - 封面

- **Audience move**: 不知道這組要講什麼 → 知道今天講的是「過程」
- **Relationships**: 主標與產品名為同一主體；四色帶代表看板四欄（order）
- **Composition**: 深青滿版，左側超大主標，右下四段看板色帶
- **Title**: 每一次變化，都是下一次改善的起點
- **Core message**: 今天講的是過程，不是功能
- **Content**: 主標 · 副標「FocusFlow AI｜敏捷開發歷程」· 白色 Logo
- **Cover impact**: 主標句即鉤子
- **Motion suggestion**: 色帶由左到右擦入

#### Slide 02 - 問題

- **Audience move**: 不知道產品解決什麼 → 理解「長影片回看很難」
- **Relationships**: 長影片進度條（whole）與「那一段」問號（part）
- **Composition**: 米白滿版留白，一條橫跨畫面的長進度條，進度條某處一個問號
- **Title**: 課堂上講過，卻找不到在哪裡
- **Core message**: 長影片回看很難
- **Content**: 進度條標示「第 1 支 … 第 6 支影片」· 問號 · E01
- **Motion suggestion**: 進度條為 Morph 候選，於第 3 頁變成產品畫面旁的時間點標註

#### Slide 03 - 產品

- **Audience move**: 理解問題 → 看到產品如何回答（20 秒內）
- **Relationships**: 提問 → 附來源的回答 → 跳到時間點（order）
- **Composition**: 左側約 60% 產品截圖細框，右側三個編號步驟；截圖上以編號圈標出對應位置
- **Title**: 提問，就能跳回講解的那一秒
- **Core message**: 提問 → 附來源的回答 → 跳到時間點
- **Content**: ① 在網頁或 LINE 提問 · ② 只從課程影片找答案、附來源片段 · ③ 點來源，跳到 25:36
- **Images**: p03_jump.png 原樣置入
- **Motion suggestion**: 承接第 2 頁進度條；三步驟依序淡入

### Part 2: 起點

#### Slide 04 - 想做的太多

- **Audience move**: 以為一開始就很聚焦 → 知道起點範圍過大
- **Relationships**: 四個構想並列（membership）
- **Title**: 一開始，我們想做的太多
- **Core message**: 範圍過大
- **Content**: 智慧衣櫥題目 · 遊戲化寵物機制 · 短影音生成 · 個人化課程 · E02

#### Slide 05 - 六次檢視

- **Audience move**: → 知道方向是在每週進度檢視中收斂
- **Relationships**: 03-03 → 04-21 六個日期（order）
- **Title**: 兩個月，六次檢視，六次調整
- **Core message**: 方向在每週進度檢視中收斂
- **Content**: 六個日期節點各一句調整 · E02
- **Motion suggestion**: 第 4 頁構想 Morph 縮進時間軸

#### Slide 06 - 一條主線

- **Audience move**: → 知道 MVP 是什麼
- **Relationships**: 七步主線（order）；其他構想「之後再做」（contrast）
- **Title**: 先做好一條主線
- **Core message**: MVP＝影片知識化＋時間點回溯
- **Content**: 七步主線 · 其他構想淡出 · E02、E03

### Part 3: 工作方式

#### Slide 07 - 看板

- **Audience move**: → 知道全組用 Kanban
- **Relationships**: 四欄（order）
- **Title**: 看板讓工作隨時看得見
- **Core message**: 全組用 Kanban
- **Content**: 待辦／進行中／測試中／已完成 · 去識別截圖 · E04
- **Images**: p07_kanban.png
- **Motion suggestion**: 封面四色帶 Morph 成四欄標題

#### Slide 08 - 循環

- **Audience move**: → 知道看板與每週進度檢視形成循環
- **Relationships**: 看板 → 實作 → 測試 → 每週進度檢視 → 看板（order, loop）
- **Title**: 每週進度檢視，決定下一步
- **Core message**: 需求在檢視後改變，看板隨時重排
- **Content**: 五節點循環 · E05

#### Slide 09 - 13 張任務卡

- **Audience move**: → 相信決策直接變成工作
- **Relationships**: 一次檢視（parent）→ 13 張任務卡（children）
- **Title**: 檢視決議，直接變成任務
- **Core message**: 決策與工作連在一起
- **Content**: 13 · 張任務卡（08-04 檢視）· E06

#### Slide 10 - 不可誤稱

- **Audience move**: → 看到團隊會標示邊界
- **Relationships**: none
- **Title**: 也寫清楚還不能宣稱什麼
- **Core message**: 誠實標示邊界
- **Content**: 引言「尚未完成／不可誤稱」＋一行實例 · E07

#### Slide 11 - 沒有做的

- **Audience move**: → 不會以為這組在包裝 Scrum
- **Relationships**: 四個未採用做法（membership）與一個有做的（contrast）
- **Title**: 我們沒有做的
- **Core message**: 不包裝成 Scrum
- **Content**: 固定 Sprint · 每日站會 · 回顧會議 · WIP 上限（劃線）· AI 模組內短週期實驗 · E05

### Part 4: 案例 A：外部模型停用

#### Slide 12 - 案例 A 開場

- **Audience move**: → 進入案例 A，知道外部變動是什麼
- **Relationships**: 08-02 首次記錄 → 08-10 最早可能停用日（order）
- **Composition**: 深青滿版，超大日期 08-10，下方一句與小字
- **Title**: 案例 A：外部模型要停用
- **Core message**: 外部技術變動出現
- **Content**: 08-10 · 模型供應商列出的最早可能停用日 · 08-02 首次記錄風險 · E08
- **Hyperlinks**: E08 標籤 → #slide-33
- **Motion suggestion**: 日期 08-10 為 Morph 候選，於第 13 頁縮成日期軸上的終點標記

#### Slide 13 - 影響範圍

- **Audience move**: → 理解為什麼不能只換一組
- **Relationships**: 後端、資料處理、資料庫三者共用同一個向量空間（link, overlap）
- **Composition**: 三節點三角互連，中心「同一個向量空間」；上方保留日期軸（08-02 目前）
- **Title**: 只換一組，搜尋就會對不上
- **Core message**: 影響範圍是三個模組
- **Content**: 後端 · 資料處理 · 資料庫 · 同一個向量空間 · 只換一個 → 搜尋找錯 · E08
- **Hyperlinks**: E08 → #slide-33
- **Motion suggestion**: 日期軸自第 12 頁延續

#### Slide 14 - 決策

- **Audience move**: → 看到團隊先控制風險
- **Relationships**: 08-04 檢視（parent）→ 兩條決策（children）
- **Composition**: 日期軸 08-04 節點放大成決策卡
- **Title**: 決策：三組同步，新功能先關
- **Core message**: 先控制風險
- **Content**: 三組同步更換模型 · 還沒驗證的新檢索功能先關閉 · 08-04 每週進度檢視 · E09
- **Hyperlinks**: E09 → #slide-33
- **Motion suggestion**: 日期軸目前節點從 08-02 移到 08-04

#### Slide 15 - 五天程式切換

- **Audience move**: → 看到小步交付
- **Relationships**: 08-04 → 08-09 區間 5 天（order）
- **Composition**: 日期軸延伸，5 天區間琥珀；兩個事實並列
- **Title**: 五天，完成程式切換
- **Core message**: 小步交付
- **Content**: 08-09 遷移程式合併並自動部署 · 後端 371 項測試通過 · E10
- **Hyperlinks**: E10 → #slide-33
- **Motion suggestion**: 目前節點移到 08-09，5 天區間出現

#### Slide 16 - 不等於正式完成

- **Audience move**: 以為 08-09 就完成 → 理解程式切換與正式驗證要分開
- **Relationships**: 08-09 程式切換 與 09-09 正式驗證（contrast，中間相隔一個月）
- **Composition**: 日期軸在 08-09 後斷開，標「一個月」，接到 09-09
- **Title**: 但程式切換，不等於正式完成
- **Core message**: 程式切換與正式驗證要分開
- **Content**: 09-09 試用資料重建 · 正式驗證第一次失敗 → 同日修正 · E11
- **Hyperlinks**: E11 → #slide-33
- **Motion suggestion**: 日期軸延伸出斷裂與 09-09 節點

#### Slide 17 - 流程改善

- **Audience move**: → 看到事件帶來流程改變，也聽到缺口
- **Relationships**: 事件（cause）→ 部署加檢查（effect）；限制（contrast）
- **Composition**: 左事件、右流程改變；底部一行限制
- **Title**: 這次事件，讓部署多了一道檢查
- **Core message**: 從事件改善流程
- **Content**: 09-09 起部署加入資料相容檢查：模型或資料不一致就部署失敗 · 限制：那次合併沒有審查紀錄 · E12
- **Hyperlinks**: E12 → #slide-33

### Part 5: 案例 B：測試結果驅動改善

#### Slide 18 - 案例 B 開場

- **Audience move**: → 進入案例 B，看到 0 題通過
- **Relationships**: 14 題 = 通過 0 ＋ 偏弱 11 ＋ 失敗 3（parent / membership）
- **Composition**: 深青滿版，超大 0，下方一條 14 格三段比例條
- **Title**: 案例 B：第一次量測，0 題通過
- **Core message**: 測試暴露問題
- **Content**: 0 · 09-01 真實課程資料 14 題 · 通過 0／偏弱 11／失敗 3 · E13
- **Visualization**: 14 格比例條（以原生色塊表示 0／11／3，非資料圖表物件）
- **Hyperlinks**: E13 → #slide-34
- **Motion suggestion**: 14 格比例條為 Morph 候選，第 19 頁拆成三類

#### Slide 19 - 三類問題

- **Audience move**: → 知道團隊逐題找原因
- **Relationships**: 三類問題並列（membership）
- **Composition**: 三欄，各一例
- **Title**: 逐題複核，分成三類問題
- **Core message**: 分析問題來源
- **Content**: 程式邏輯 · 題目與教材 · 搜尋品質；各一句例子 · E13
- **Hyperlinks**: E13 → #slide-34
- **Motion suggestion**: 第 18 頁比例條拆成三欄色塊

#### Slide 20 - 標準不變

- **Audience move**: → 相信沒有調門檻湊分數
- **Relationships**: 標準（fixed）與題目修正（contrast）
- **Composition**: 單一大訊息，鎖頭圖示
- **Title**: 我們沒有放寬標準
- **Core message**: 依原因修，不調門檻湊分數
- **Content**: 判定標準不變 · Q09 因教材不支持而修正題目，不是降低判定 · E14
- **Hyperlinks**: E14 → #slide-34

#### Slide 21 - 八輪

- **Audience move**: → 看到短週期技術迭代
- **Relationships**: 09-02～09-06：契約修正 → 評測工具 → 8 輪檢索診斷 → 整合（order）
- **Composition**: 一列步驟，中間八個小格依序點亮
- **Title**: 五天，八輪診斷與調整
- **Core message**: 短週期技術迭代
- **Content**: 契約修正 · 建立評測工具 · 第 1～8 輪檢索診斷 · 整合 · E15
- **Hyperlinks**: E15 → #slide-34

#### Slide 22 - 驗收證據還在補

- **Audience move**: → 知道團隊清楚這個案例的邊界
- **Relationships**: 四項待補證據（membership）
- **Composition**: 留白頁，一句話＋四個待補標籤
- **Title**: 正式驗收證據，還在補
- **Core message**: 誠實邊界
- **Content**: 題庫 · 設定 · 原始結果 · 人工複核 · E16（附錄框內寫清非正式紀錄）
- **Hyperlinks**: E16 → #slide-34

### Part 6: 回饋

#### Slide 23 - 三種來源

- **Audience move**: → 知道回饋不混稱
- **Relationships**: 三個來源並列（membership）
- **Title**: 回饋，分三種來源記錄
- **Core message**: 不混稱使用者回饋
- **Content**: 團隊內部 · 指導端與審查端 · 學生試用 · E17
- **Hyperlinks**: E17 → #slide-35

#### Slide 24 - 改變了範圍

- **Audience move**: → 相信意見改變了計畫
- **Relationships**: 原本 → 改成（order, contrast）
- **Title**: 內部與指導端意見，改變了範圍
- **Core message**: 意見真的改變了計畫
- **Content**: 組員 11 條意見 → 兩項功能改列本輪必做 · 指導端建議凍結新功能、啟動班級測試 · 審查端 12 題逐題處理 · E17、E18
- **Hyperlinks**: E17 → #slide-35
- **Motion suggestion**: 前兩條泳道自第 23 頁展開

#### Slide 25 - 學生試用

- **Audience move**: → 不會誤以為有大量使用者回饋
- **Relationships**: none
- **Title**: 學生試用：小規模，還在整理
- **Core message**: 不誇大使用者回饋
- **Content**: 10 人以內（團隊確認）· 回報問題功能 · E19
- **Images**: p25_report_form.png
- **Hyperlinks**: E19 → #slide-35

### Part 7: 交付與驗證

#### Slide 26 - 增量交付

- **Audience move**: → 看到每階段都有可操作版本
- **Relationships**: 七個交付節點（order）
- **Title**: 每一階段，都交付能操作的版本
- **Core message**: 增量交付
- **Content**: 04-21 核心流程 · 05-28 自動部署 · 08-09 模型切換 · 08-15 批次續跑 · 08-30～09-06 隔離與問答改善 · 09-21 開放試用 · 10-25 cookie 登入上線 · E20
- **Hyperlinks**: E20 → #slide-36

#### Slide 27 - 四種驗證狀態

- **Audience move**: → 理解測試通過不等於可以上線
- **Relationships**: 程式完成 → 測試通過 → 外部服務可用 → 正式驗收（order, hierarchy）
- **Title**: 測試通過，不等於可以上線
- **Core message**: 四種驗證狀態
- **Content**: 四階各一例；案例 A：測試全過、正式驗證首次失敗 · E21
- **Hyperlinks**: E21 → #slide-36

#### Slide 28 - 部署檢查

- **Audience move**: → 看到工程實踐持續改善
- **Relationships**: 05-28 → 09-09 → 10-24（order）
- **Title**: 部署檢查，一步步補上
- **Core message**: 工程實踐持續改善
- **Content**: 純部署 → 部署後健康檢查 → 部署前檢查 · 155 次執行、148 次成功 · E22
- **Hyperlinks**: E22 → #slide-36
- **Motion suggestion**: 自第 27 頁階梯延續

### Part 8: 結尾

#### Slide 29 - 下一輪待辦

- **Audience move**: → 看到團隊清楚缺口
- **Relationships**: 五項缺口（membership）落入看板待辦欄
- **Title**: 還沒做到的，就是下一輪的待辦
- **Core message**: 清楚知道缺口
- **Content**: CI 關卡 · 自動回滾 · 合併審查與 Issue · 案例 B 正式驗收 · 學生回饋整理 · E23
- **Motion suggestion**: 呼應第 7 頁看板，五張卡依序落入待辦欄

#### Slide 30 - 收束

- **Audience move**: → 記住核心訊息
- **Relationships**: none
- **Title**: 下一輪看板的第一批任務
- **Core message**: 收束
- **Content**: 我們會把這五項，當成下一輪看板上的第一批任務 · 白色 Logo
- **Closing impact**: 待辦五項即下一輪任務
- **Motion suggestion**: 第 29 頁五張卡 Morph 收成一列

### Part 9: 證據附錄

#### Slide 31 - 附錄 1 方向收斂

- **Audience move**: 詢答時 → 可查證方向收斂
- **Relationships**: E02、E03 條目（order）
- **Title**: 附錄 1｜方向收斂
- **Core message**: E02、E03 的日期與摘要
- **Content**: E 編號 · 日期 · 改寫摘要 · 限制；回到第 5 頁
- **Hyperlinks**: 回到第 5 頁 → #slide-5

#### Slide 32 - 附錄 2 工作方式

- **Audience move**: 詢答時 → 可查證看板與檢視
- **Relationships**: E04～E07 條目（order）
- **Title**: 附錄 2｜看板與每週進度檢視
- **Core message**: E04～E07
- **Content**: 每週進度檢視紀錄 28 次 · 13 張任務 · 不可誤稱段落；回到第 7 頁
- **Hyperlinks**: 回到第 7 頁 → #slide-7

#### Slide 33 - 附錄 3 案例 A

- **Audience move**: 詢答時 → 可查證案例 A 每一天
- **Relationships**: E08～E12 逐日（order）
- **Title**: 附錄 3｜案例 A 逐日紀錄
- **Core message**: E08～E12
- **Content**: 08-02 · 08-04 · 08-09 · 09-09 · 09-09；公告發布日待確認；回到第 12 頁
- **Hyperlinks**: 回到第 12 頁 → #slide-12

#### Slide 34 - 附錄 4 案例 B

- **Audience move**: 詢答時 → 可查證案例 B 與其邊界
- **Relationships**: E13～E15 條目；E16 非正式紀錄專框（contrast）
- **Title**: 附錄 4｜案例 B 題目、標準與後續紀錄
- **Core message**: E13～E16
- **Content**: 0／11／3 · 標準不變 · 8 輪 · 專框：13／1／0 非正式整合驗證紀錄，不是正式驗收、Q09 已改寫、原始結果未存檔、剩下 1 題待確認；回到第 18 頁
- **Hyperlinks**: 回到第 18 頁 → #slide-18

#### Slide 35 - 附錄 5 回饋

- **Audience move**: 詢答時 → 可查證回饋來源
- **Relationships**: E17～E19（membership）
- **Title**: 附錄 5｜回饋來源
- **Core message**: E17～E19
- **Content**: 11 條意見 · 指導端建議 · 審查端 12 題 · 試用 10 人以內；回到第 23 頁
- **Hyperlinks**: 回到第 23 頁 → #slide-23

#### Slide 36 - 附錄 6 交付與部署

- **Audience move**: 詢答時 → 可查證交付與部署
- **Relationships**: E20～E22（order）
- **Title**: 附錄 6｜交付節點與部署流程
- **Core message**: E20～E22
- **Content**: 七節點 · 四種驗證狀態 · 155／148；回到第 26 頁
- **Hyperlinks**: 回到第 26 頁 → #slide-26

#### Slide 37 - 附錄 7 cookie 登入（備用）

- **Audience move**: 詢答時 → 看到 10 月流程比 8 月完整
- **Relationships**: 資安檢查 → 25 項決策 → 有審查紀錄 → 正式驗收（order）
- **Title**: 附錄 7｜cookie 登入上線（備用）
- **Core message**: E24
- **Content**: 10-21～25 四步；審查者身分待確認；回到第 28 頁
- **Hyperlinks**: 回到第 28 頁 → #slide-28

#### Slide 38 - 附錄 8 AI 輔助開發（備用）

- **Audience move**: 詢答時 → 知道 AI 寫的程式由誰負責
- **Relationships**: 組員定義 → AI 實作 → 組員驗收（order）；合併審查缺口（contrast）
- **Title**: 附錄 8｜AI 輔助開發分工（備用）
- **Core message**: E25
- **Content**: 組員定義需求與完成條件 · AI 依工作說明實作 · 組員測試與驗收 · 缺口：合併審查；回到第 29 頁
- **Hyperlinks**: 回到第 29 頁 → #slide-29

## X. Speaker Notes Requirements

- **Generation**: enabled
- **Filename**: match each SVG filename under `notes/`
- **Content**: 正文頁沿用分鏡講稿（1～2 句），附錄頁寫一句詢答用法；只寫 E 編號，不寫 PR 編號、hash、帳號、網址、姓名、學校或組號；稱呼依 R1
- **Total duration**: 正文約 306 秒（含轉場約 6 分鐘）；附錄不計時
- **Notes style**: conversational
- **Presentation purpose**: 用兩個真實案例說明團隊如何小步調整、留下紀錄、驗證結果
