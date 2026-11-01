<!-- ppt-master-schema: design-spec/v1 -->
# FocusFlow AI 鈦坦敏捷開發特別獎決賽簡報 - Design Spec

## I. Project Information

| Item | Value |
| --- | --- |
| Project Name | titansoft_agile_deck_20261101 |
| Canvas Format | ppt169 (1280×720) |
| Page Count | 15 |
| Primary Language | zh-Hant-TW |
| Target Audience | 鈦坦敏捷開發特別獎決賽評審團：由鈦坦科技與競賽委員會共同邀請的產、官、學代表，設召集人一名；個別評審與評分配分未公布。可預期熟悉敏捷方法（鈦坦自身實踐 Scrum），會檢查主張是否有證據、是否誠實。 |
| Communication Intent | 先說明團隊實際採用的敏捷方式（Notion Kanban 看板、每週教授檢視、階段 Milestone、AI 模組內短週期迭代），再用兩個真實案例佐證：案例 A 面對外部模型停用的快速適應與風險控制，案例 B 依測試結果調整產品品質；最後主動揭露證據限制與下一步改善。產品功能只當案例背景。 |
| Desired Audience Outcome | 評審能說出團隊實際怎麼工作，看懂兩個案例中「問題 → 決策 → 行動 → 改善」如何發生，相信每個日期與數字都能追溯到紀錄，也看到團隊清楚知道自己還缺什麼（CI 關卡、自動回滾、學生試用回饋）。 |
| Core Message / Ask / Action | 我們如何運用敏捷開發，讓每一次需求變動、技術問題與測試回饋，都成為下一次產品改善的起點。 |
| Delivery Context | 主要：2026-11-07 決賽現場主講，正文 10 頁約 6 分鐘（形式以行前通知為準）；接著約 7 分鐘詢答，用 5 張備用頁回答追問。次要：會後評審或組員自行翻閱。 |
| Artifact Afterlife | 作為詢答備用資料與敏捷佐證的延伸紀錄，可在系統手冊、期末報告引用；團隊後續補到證據時要能逐頁更新。 |
| Reading Mode | presentation |
| Content Strategy | balanced default（內容自由度欄留白）；事實只取自 09～11 號分析文件、附件 3 與其引用的原始紀錄 |
| Design Style | 證據儀表板（custom mode＋custom visual style） |
| AI Image Acquisition Path | not applicable |
| Generation Mode | continuous |
| Spec Refinement | disabled |
| Speaker Notes | enabled — final Stage-2 proactive policy（使用者在對話中確認建議） |
| Custom Animations | disabled — final Stage-2 proactive policy |
| Narration Audio | disabled — final Stage-2 proactive policy |
| Created Date | 2026-11-01 |

## II. Canvas Specification

| Property | Value |
| --- | --- |
| Format | PPT 16:9 |
| Dimensions | 1280 × 720 |
| viewBox | `0 0 1280 720` |
| Margins | 左右 64、上 48、下 40 |
| Content Area | x 64–1216，y 48–680 |

## III. Visual Theme

### Theme Style

- **Mode**: custom
- **Mode References**: narrative, pyramid
- **Mode Behavior**: 以案例敘事推進（起點 → 工作方式 → 兩個案例 → 回饋 → 交付 → 驗證 → 不足），每頁標題寫成判斷句；案例頁固定走「問題 → 決策 → 行動 → 改善」四拍，證據代號（日期、PR、commit、紀錄名）只放在節點角落的小標籤，限制說明以小字留在同一頁，不另開頁。
- **Visual style**: custom
- **Visual Style References**: swiss-minimal, editorial
- **Visual Style Behavior**: 瑞士網格的直角平面與大留白做骨架，搭配編輯式的細線規、kicker 小標與大號數字；資訊用扁平卡片、看板狀態欄（待辦／進行中／測試中／已完成）、橫向時間軸與堆疊長條呈現，卡片近乎直角、無陰影，只有被強調的一張卡片用深藍綠實底反白。琥珀色只出現在決策點、關鍵數字與警示標籤；每頁右上角放 Logo 標識與頁碼，左上角一條短琥珀線當作跨頁母題。
- **Theme**: Logo 品牌色延伸的明亮工程儀表板，像一個正在持續改善的軟體團隊的狀態牆配上調查報導的圖說
- **Tone**: 冷靜、可查核、誠實；不誇大、不行銷

### Color Scheme

| Role | HEX | Purpose |
| --- | --- | --- |
| Background | #FBF8F2 | 全頁底色（品牌米白提亮） |
| Secondary background | #F5EFE3 | 卡片底、分區色帶（品牌米白原色） |
| Primary | #1B4D5C | 標題、主要結構、強調卡實底、時間軸主線 |
| Accent | #E8A93C | 決策點、關鍵數字底塊、警示標籤、左上母題線；不當作米白底上的文字色 |
| Secondary accent | #5E8F9C | 分類、次要流程、狀態欄、圖表第二系列 |
| Body text | #15171A | 內文 |
| Secondary text | #5A6066 | 圖說、證據標籤、註腳 |
| Divider | #D9D1C1 | 細線規、卡片邊框 |
| Negative | #B5482E | 失敗、缺口（只用於色塊與圖示，搭配文字標示） |
| Positive | #3E7D5A | 通過、已完成（只用於色塊與圖示，搭配文字標示） |

### Cross-page motif

左上角 48×6 的琥珀短線接 kicker 小標（章節／案例代號），右上角 Logo 標識＋頁碼；證據標籤統一為細框小膠囊「證據｜…」。

## IV. Typography System

### Font Plan

| Role | Character (Reference) | Primary | English if non-English | Fallback tail |
| --- | --- | --- | --- | --- |
| Title | 無襯線粗體，網格感 | Microsoft JhengHei | Segoe UI | sans-serif |
| Body | 無襯線常規 | Microsoft JhengHei | Segoe UI | sans-serif |

- **Title stack**: Microsoft JhengHei, Segoe UI, sans-serif
- **Body stack**: Microsoft JhengHei, Segoe UI, sans-serif

### Font Size Hierarchy

| Purpose | Anchor Size (px) |
| --- | ---: |
| Body | 28 |
| Title | 46 |
| Subtitle | 34 |
| Lead | 30 |
| Annotation | 22 |
| Footnote | 18 |
| Kicker | 20 |
| Cover title | 72 |
| Hero number | 96 |

## V. Layout Principles

### Deck-wide Direction

- **Hierarchy direction**: kicker → 判斷句標題 → 主視覺（流程、時間軸、對照）→ 角落證據標籤 → 底部限制小字
- **Composition tendency**: 每頁一個主視覺區塊；案例頁用橫向流程或雙軌時間軸；概念頁用循環或三欄；收尾頁用兩欄對照
- **Cross-page continuity**: 左上琥珀短線＋kicker、右上 Logo 與頁碼、證據膠囊樣式、四拍案例結構在 P05／P06 一致
- **Spacing posture**: 依 page_rhythm 變化；anchor 頁大留白，dense 頁緊湊但保留 32 間距
- **Spacing anchors**: 頁邊 64、區塊間距 32、欄間距 32、圓角 4、內文行距 1.4

## VI. Icon Usage Specification

- **Primary bundled library**: phosphor-duotone

| Icon Path | Suitable Scenarios |
| --- | --- |
| icons/phosphor-duotone/kanban.svg | |
| icons/phosphor-duotone/git-pull-request.svg | |
| icons/phosphor-duotone/git-commit.svg | |
| icons/phosphor-duotone/calendar-check.svg | |
| icons/phosphor-duotone/warning.svg | |
| icons/phosphor-duotone/check-circle.svg | |
| icons/phosphor-duotone/x-circle.svg | |
| icons/phosphor-duotone/magnifying-glass.svg | |
| icons/phosphor-duotone/users-three.svg | |
| icons/phosphor-duotone/chat-circle-dots.svg | |
| icons/phosphor-duotone/clipboard-text.svg | |
| icons/phosphor-duotone/rocket-launch.svg | |
| icons/phosphor-duotone/shield-check.svg | |
| icons/phosphor-duotone/flask.svg | |
| icons/phosphor-duotone/arrows-clockwise.svg | |
| icons/phosphor-duotone/lock-key.svg | |
| icons/phosphor-duotone/robot.svg | |
| icons/phosphor-duotone/list-checks.svg | |
| icons/phosphor-duotone/target.svg | |
| icons/phosphor-duotone/flag-pennant.svg | |
| icons/phosphor-duotone/gauge.svg | |
| icons/phosphor-duotone/chalkboard-teacher.svg | |
| icons/phosphor-duotone/student.svg | |
| icons/phosphor-duotone/git-branch.svg | |
| icons/phosphor-duotone/test-tube.svg | |
| icons/phosphor-duotone/cloud-arrow-up.svg | |

## VIII. Image Resource List

| Filename | Dimensions | Ratio | Purpose | Type | Image pattern | Crop Policy | Acquire Via | Status | Reference | text_policy | page_role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| lockup-color.png | 1920×540 | 3.56 | 封面品牌組合標識 | Logo | 封面左上或中段的完整組合標識，原比例 | no-crop | user | Existing | docs/05_圖庫/Logo/lockup-color.png，品牌原檔，不改色不變形；image_notes 寫向量優先，但 SVG 圖檔走匯出管線未驗證，採 1920px 透明 PNG 原比例放置 | none | local |
| mark-color.png | 800×800 | 1.00 | 每頁右上角品牌圖標 | Logo | 右上角小尺寸圖標與頁碼並排 | no-crop | user | Existing | docs/05_圖庫/Logo/mark-color.png，品牌原檔 | none | local |
| image_001.png | 963×571 | 1.69 | Notion Kanban 看板證據截圖（附件 3 圖 1） | Screenshot | 證據框內完整顯示，下方圖說標來源與日期 | no-crop | user | Existing | 附件 3 圖 1：Notion 任務看板（待辦／進行中／測試中／已完成） | none | local |
| image_005.png | 901×622 | 1.45 | GitHub Contributions 證據截圖（附件 3 圖 5） | Screenshot | 分工頁右側證據框完整顯示 | no-crop | user | Existing | 附件 3 圖 5：GitHub commits over time 與成員 Contributions | none | local |

## IX. Content Outline

### Part 1: 開場與方法

#### Slide 01 - 封面

- **Audience move**: 不知道這隊要講什麼 → 知道主題是「變化如何成為改善起點」，不是產品介紹
- **Relationships**: 標題 / 副標 / 團隊與場次資訊：parent（標題統領）
- **Cover impact**: 鉤子句「每一次變化，都是下一次改善的起點」；Logo 組合標識＋一條由左到右的四格看板狀態帶（待辦→進行中→測試中→已完成）暗示持續流動
- **Title**: 每一次變化，都是下一次改善的起點
- **Core message**: FocusFlow AI 的敏捷開發故事，主角是決策與改善過程
- **Content**: 副標「FocusFlow AI｜2026 第 31 屆大專校院資訊應用服務創新競賽・鈦坦敏捷開發特別獎」· 團隊 115413 組 · 2026-11-07 決賽

#### Slide 02 - 起點：想做的太多，先收斂主線

- **Audience move**: 以為團隊一開始就規劃好 → 看到方向是在每週檢視中一步步收斂
- **Relationships**: 最初構想（智慧衣櫥題目 03-03 未選、遊戲化寵物機制 03-31 放棄、短影音生成延到第二階段、個人化課程列第四階段；附件 3 的「推播與儀表板」找不到原始紀錄，不放）與 MVP 主線：contrast；3～4 月六次會議：order；MVP 七步：order
- **Composition**: 左側六個會議日期點的垂直時間線逐步收斂，右側 MVP 七步主線（音訊抽取 → 語音轉文字 → 切段 → embedding → 檢索 → AI 回答 → 時間點回溯）
- **Title**: 一開始想做的太多，我們先收斂出一條主線
- **Core message**: 3～4 月每次教授檢視都調整一次方向，最後先做「影片變成可問答的知識、回答能跳回影片時間點」
- **Content**: 03-03 兩題二選一 · 03-10 確定短影音 · 03-24 遊戲化構想 · 03-31 放棄寵物機制 · 04-07 改用 Gemini Embedding · 04-21 Phase 1 聚焦核心流程 / MVP 七步 / 小字：「六次方向調整」與六次會議的對應待團隊確認
- **Fact IDs**: 會議紀錄 06～11（Notion 會議資料庫）；附件 3 第一節

#### Slide 03 - 我們實際的工作方式

- **Audience move**: 不清楚為何不是 Scrum → 看懂四個實際做法如何組成一個循環
- **Relationships**: 看板 → 實作 → 測試 → 每週教授檢視 → 回到看板：order（循環）；Milestone 管期限：parent；AI 模組短迭代：membership（循環中的一段）
- **Composition**: 中央循環四節點，右側證據框放 Notion 看板截圖；底部一行「我們沒有做的」
- **Title**: 看板管日常、每週檢視定方向、AI 模組內短週期迭代
- **Core message**: 需求常在每週教授檢視後調整，所以用看板讓工作隨時可見、隨時重排
- **Content**: 看板狀態：待辦／進行中／測試中／已完成（另有封存）· 教授會議 28 次（2026-01-22～10-01）· Milestone 依模組列負責人與預計起訖日 · AI 問答模組 09-02～09-03 多輪診斷 / 小字：沒有 WIP 上限、沒有固定回顧會議、沒有全組 Sprint
- **Images**: image_001.png 作為看板證據（附件 3 圖 1）
- **Fact IDs**: Notion 任務資料庫狀態欄；會議資料庫；commit 09-02～09-03

#### Slide 04 - 決策如何變成工作

- **Audience move**: 以為看板只是任務清單 → 看到會議決議直接變成任務、任務寫清楚還不能宣稱什麼
- **Relationships**: 會議決議 → 看板任務 → 任務中的「不可誤稱」：order；設計決策 decisions.md：parent（理由來源）
- **Composition**: 三格橫向流程，每格一個實例（08-04 會議 13 張任務 → 08-12～14 任務逐日紀錄 → 「尚未完成／不可誤稱」段）
- **Title**: 每週的決議，會直接變成看板上的任務
- **Core message**: 決策、工作與限制都留在同一條紀錄裡
- **Content**: 08-04 教授會議行動項目連到 13 張任務卡 · 批次處理任務 08-12／08-13／08-14 逐日寫進度與測試數 · 任務段落「尚未完成／不可誤稱」：真實 STT／Gemini 多影片未驗證、開關維持關閉 · 功能設計決策寫在 decisions.md（已定案／待答＋理由）
- **Fact IDs**: Notion 會議 3b24fe40…；任務 3b24fe40c8bb80009dd5f8004107462a

### Part 2: 兩個案例

#### Slide 05 - 案例 A：外部模型停用

- **Audience move**: 擔心「5 天」是挑好看的區間 → 看到程式切換與正式驗證被清楚分開，並理解這是風險控制而非單純維護
- **Relationships**: 外部公告 → 團隊發現 → 決策 → 開始處理 → 程式切換 → 正式資料重建與驗證：order；08-04→08-09：overlap（5 天區間）；程式切換 vs 正式驗證：contrast
- **Composition**: 雙軌時間軸——上軌「團隊決策」、下軌「交付與驗證」；08-04→08-09 標「5 天」，09-09 另成一段「正式環境完成」；四拍標籤（問題／決策／行動／改善）在上方
- **Title**: 外部模型要停用：先評估影響，再小步切換
- **Core message**: 面對外部技術變動，先控制風險再交付；08-09 是程式切換，09-09 才是正式資料重建與驗證
- **Content**: 外部公告：Google 列出 preview 模型最早可能停用日 08-10（公告發布日待確認）· 08-02 首次留下風險紀錄（Phase 2-2 報告、PR #5）· 08-04 教授會議決定：Backend、Pipeline、資料庫三組同步，只改一組不可接受；新檢索功能維持關閉 · 08-07 建立看板任務 · 08-09 PR #6 合併並自動部署，Pipeline 同日完成，Backend 371 項測試通過 · 09-09 重建試用資料向量、部署流程加入資料契約檢查、正式問答驗證首次失敗後同日修正 / 限制小字：08-09 尚未做 Gemini 真實連線、正式資料庫驗證與資料重建；PR #6 建立後 1.5 分鐘合併，沒有審查紀錄
- **Fact IDs**: PR #5、PR #6、d00a5ed、1157e3d、c823131、979cabd、da1b422、df40434；Notion 3b04fe40c8bb8110b991dc877c610996、3b54fe40c8bb81dc84b2d62f9e5432c4

#### Slide 06 - 案例 B：測試暴露問題之後

- **Audience move**: 預期看到漂亮通過率 → 看到團隊如何用測試結果決定下一輪改什麼
- **Relationships**: 測試暴露問題 → 分析問題來源 → 不放寬標準 → 多輪調整：order；三類問題（程式邏輯／題目教材／搜尋品質）：membership
- **Composition**: 左側 baseline 堆疊長條（0／11／3），中段三色問題分類，鎖頭標「標準不變」，右側四格小步驟（3A → 3B → 3C 多輪 → 整合）
- **Title**: 第一次量測 0 題通過，我們沒有放寬標準
- **Core message**: 依原因決定怎麼改，而不是調門檻湊分數
- **Content**: 09-01 baseline 14 題：通過 0、偏弱 11、失敗 3（OpenCV 15 支影片、唯讀、人工逐題複核）· 程式邏輯：拒答仍附引用、引用等於全部搜尋結果、已有正確資料仍答錯 · 題目／教材：Q09 教材支持不足 · 搜尋品質：相鄰關鍵片段漏掉 · 不放寬課程隔離；Q09 依教材修正題目，不是降低判定標準 · 09-02～09-06：契約修正 → 評測工具 → 8 輪檢索診斷 → 整合 / 限制小字：調整後的正式驗收證據（題庫、設定、原始結果、人工複核）尚未建立
- **Visualization**: baseline-result 堆疊長條（PASS 0 / WEAK 11 / FAIL 3）
- **Native-ready**: baseline-result=no
- **Fact IDs**: evidence/2026-09-01_baseline_manual-review.md；commit 44e9108、25daa7b、a0a43b9、f404fe5、2050b26、915dcf1

### Part 3: 回饋、交付與驗證

#### Slide 07 - 回饋從哪裡來、改變了什麼

- **Audience move**: 以為「回饋」都是使用者回饋 → 看到三種來源分開記錄，以及學生回饋仍在整理
- **Relationships**: 團隊內部建議 / 教授與評審意見 / 實際學生試用回饋：membership（三類來源），各自「原本 → 改成」：order
- **Composition**: 三條泳道，前兩條各一個前後對照，第三條只畫機制與「整理中」
- **Title**: 回饋分來源記錄，每一條都寫下怎麼處理
- **Core message**: 有書面處理紀錄的是團隊內部與教授、評審意見；學生試用回饋的整理還在進行
- **Content**: 團隊內部：08-25 試用版建議 11 條逐條回應 → YouTube 上傳、LINE 多輪從「有餘力再做」改本輪必做（規格 v1.0→v1.1）；09-18 內部系統測試清單（示範帳號）→ 10-23 變成看板任務 · 教授與評審：09-10 教授「凍結新功能、啟動班級測試」；10-22 複評 12 題 → 逐題處理、新任務標「來源：複評 X-X」（多數進行中）· 學生試用：09-21 開放、09-22 上線「回報問題」；人數、內容與修改項目尚未整理
- **Fact IDs**: Notion 3c74fe40c8bb806bbfc0f0e9faf5cfbc、3dd4fe40c8bb802e9f8beddf28430a96、會議 25；PR #7；複評後續處理總表

#### Slide 08 - 一步一步交付

- **Audience move**: 看過片段 → 看到整體是連續交付、每步可操作
- **Relationships**: 七個交付節點：order
- **Composition**: 一條橫向時間軸七個節點，每點一行字與證據代號
- **Title**: 每一階段都交付能操作的版本
- **Core message**: 小步交付，再依檢視結果決定下一步
- **Content**: 04-21 核心流程可展示 · 05-28 自動部署上線 · 08-09 模型程式切換 · 08-15 批次處理與中斷續跑 · 08-30～09-06 課程隔離與問答改善 · 09-21 開放學生試用 · 10-25 cookie 登入正式上線並驗收
- **Fact IDs**: 會議 11；fe7fd98；PR #6；0ce4835／run 31876161586；e4f1163～915dcf1；試用紀錄；run 40164725618

#### Slide 09 - 怎麼確認「真的有效」

- **Audience move**: 以為測試通過就等於完成 → 理解四種驗證狀態與部署檢查的演進
- **Relationships**: 程式完成 → 自動化測試通過 → 外部服務可用 → 正式驗收：order（階梯）；部署流程三個時點：order
- **Composition**: 左側四階梯各附一個實例，右側部署流程三格演進＋小型測試數折線（標日期、不可相加）
- **Title**: 測試通過，不等於可以上線
- **Core message**: 分四種狀態確認，部署流程也一步步補上檢查
- **Content**: 四種狀態（附件 3 第三節）· 實例：08-09 371 項測試通過 → 09-09 正式問答驗證首次失敗、修正後通過 · 部署：05-28 純部署 → 09-09 部署後健康檢查 → 10-24 部署前同來源檢查；Actions 155 次執行、148 次成功 · Backend 全套測試：04-06 40 → 09-01 514 → 10-25 1,154（各為當日全套，不可相加）/ 小字：附件 3 寫健康檢查未完成是 09-01 時點，09-09 已補
- **Visualization**: backend-test-growth 折線（三點）
- **Native-ready**: backend-test-growth=no
- **Fact IDs**: deploy.yml commits fe7fd98、979cabd、5611fe5；Actions API 快照；current-status

#### Slide 10 - 還沒做到的與下一步

- **Audience move**: 擔心團隊誇大 → 相信團隊清楚自己缺什麼並有具體下一步
- **Relationships**: 五個現況缺口與對應下一步：contrast（現況 vs 下一步）
- **Closing impact**: 收束句「我們會把這五項，當成下一輪看板上的第一批任務」；兩欄對照
- **Title**: 還沒做到的，就是下一輪的待辦
- **Core message**: 我們清楚流程還缺什麼，也知道下一步怎麼補
- **Content**: 沒有 CI 關卡，測試只在本機 → push／PR 觸發三端測試，失敗就阻止部署 · 沒有自動回滾 → 健康檢查失敗時自動退回上一版 · 部分 PR 自行合併、無審查紀錄；GitHub 沒有 Issue → 合併前至少一位組員審查；commit 寫看板任務編號 · 案例 B 正式驗收證據未建立 → 補齊題庫、設定、原始結果、人工複核 · 學生試用回饋未整理 → 用唯讀統計整理使用量與回報內容

### Part 4: 備用頁

#### Slide 11 - B1 案例 A 完整證據

- **Audience move**: 追問「5 天是否完整、有沒有審查」→ 看到逐日紀錄與限制原文
- **Relationships**: 08-02 → 08-04 → 08-07 → 08-09 → 08-11 → 09-09：order；四組責任（Backend／Pipeline／Database／Gate）：membership
- **Composition**: 上半完整事件表，下半 PR #6「尚未執行」與待確認事項
- **Title**: B1｜案例 A：每一天留下了什麼紀錄
- **Core message**: 時間軸每一點都有紀錄，限制也寫在原始紀錄裡
- **Content**: 08-02 PR #5 合併、報告記風險 · 08-04 會議決策 · 08-07 任務（截止 08-11）· 08-08 契約文件 · 08-09 00:27 PR #6 合併＋部署（run 31267006336）· 08-09 22:37 Pipeline 1157e3d · 08-11 Notion 進度報告 · 09-09 c823131 資料重建＋979cabd 契約檢查＋da1b422 失敗→df40434 修正 / PR #6 尚未執行：Gemini live smoke、shared Atlas 與索引、Pipeline 資料重建 / 待確認：公告發布日、是否評估其他模型
- **Fact IDs**: 同 Slide 05

#### Slide 12 - B2 Cookie 上線

- **Audience move**: 想知道流程是否持續變成熟 → 看到 v9 之後一條完整的審查到上線紀錄
- **Relationships**: 10-21 審查 → 25 項決策 → 修正 → 六層驗證 → 10-25 正式驗收：order；與 08 月流程：contrast
- **Composition**: 上方五步流程，下方「08 月 vs 10 月」對照
- **Title**: B2｜資安審查到上線五天：流程比 8 月更完整
- **Core message**: v9 之後，流程多了設計決策、獨立分支、部署前後檢查與正式驗收紀錄
- **Content**: 10-21 資安審查：登入憑證存在 localStorage、無法撤銷 · 10-21～24 decisions.md 25 項逐題定案 · 10-24 wip/httponly-cookie-auth 分支與 fix(auth) 修正 · 六層驗證：Backend 1,154／1,154、隔離 Mongo 11／11、Frontend 116／116、本機瀏覽器、腳本、正式站 · 10-25 部署 d3de1ef（run 40164725618），上線紀錄寫退回版本 / 08 月 vs 10 月：無分支→獨立分支；無部署後檢查→健康檢查＋同來源檢查；無上線紀錄→正式驗收紀錄 / 限制：沒有 PR；獨立審查者身分待確認
- **Fact IDs**: security-review 2026-10-21；HttpOnly_Cookie/decisions.md；commits 9058a13～751d9d5、97e23a6；上線紀錄 2026-10-25

#### Slide 13 - B3 Baseline 題目與後續紀錄

- **Audience move**: 追問測試可信度 → 看到題目、判定標準、逐題結果與後續紀錄的正確定位
- **Relationships**: PASS / WEAK / FAIL 定義：membership；14 題逐題結果：membership；後續整合驗證 vs 正式驗收：contrast
- **Composition**: 左側判定標準＋14 題結果格（紅黃綠），右側 Q09 改寫前後與「非正式整合驗證紀錄」框
- **Title**: B3｜Baseline 題目、標準與後續紀錄
- **Core message**: baseline 證據完整；調整後結果只是非正式整合驗證紀錄
- **Content**: 判定：PASS＝回答正確完整、教材直接支持、引用主要指向支持內容；WEAK＝大致正確但遺漏或引用過廣；FAIL＝實質錯誤、教材不支持或負向題不符契約 · 逐題：WEAK Q01 Q02 Q03 Q05 Q06 Q07 Q08 Q10 Q11 Q12 N01；FAIL Q04 Q09 N02 · Q09 原題要求車牌流程中的配合，教材只支持定位後接 OCR → 改為「偵測與分類的輸出差異、教材所說的先後配合」· 非正式整合驗證紀錄：commit 915dcf1（09-06）記載 13 PASS／1 WEAK／0 FAIL；Q09 已改寫、原始結果未存檔、依團隊證據規則不算驗收；剩下 1 題 WEAK 待確認
- **Fact IDs**: baseline_manual-review.md、phase3-freeze-regression_questions.md、evidence_README.md、915dcf1

#### Slide 14 - B4 團隊分工

- **Audience move**: 懷疑一人專案 → 看到模組負責人與案例中其他組員的實際貢獻
- **Relationships**: 四位組員與模組：membership；commit 分布 vs 工作量：contrast
- **Composition**: 左側模組負責人矩陣，右側 Contributions 截圖證據
- **Title**: B4｜各模組有負責人，整合與部署較集中
- **Core message**: commit 分布不均是事實，但不代表只有一人工作
- **Content**: Notion 專案面板：後端與部署 邱偉豪 · AI 模組 張庭語 · 前端 張家瑜 · LINE 與資料庫 鍾百陶 · 案例中的協作：Pipeline 端模型遷移 1157e3d（張庭語）、baseline 人工複核兩人分工 · commit（2026-11-01 查詢，依 email 學號推定作者）：483／149／44／24，不代表工作量 · 待確認：部署負責人在附件 3、Notion、GitHub 三處不一致
- **Images**: image_005.png（附件 3 圖 5）
- **Fact IDs**: Notion 專案面板；git shortlog；附件 3 圖 5

#### Slide 15 - B5 AI 輔助開發

- **Audience move**: 追問 AI 寫的程式誰負責 → 看到人定義、AI 實作、人驗證的分工與目前缺口
- **Relationships**: 人定義需求與完成條件 → AI 依工作說明實作 → 人執行測試與正式驗收：order
- **Composition**: 三段流程，下方事實與缺口兩欄
- **Title**: B5｜人定義完成，AI 實作，人驗收
- **Core message**: 需求、決策與驗收由組員負責；PR 審查是目前缺口
- **Content**: 03-24 會議：「ChatGPT 規劃 → Codex 實作」，要求說明 AI 與人為貢獻的分界 · 04-24 全組任務「理解初評階段 AI 生成的程式碼」· decisions.md 每項寫組員同意日期 · 測試與正式驗收由組員執行；系統手冊 README 揭露 AI 使用 / 缺口：部分 PR 自行合併、無審查紀錄；獨立審查者是人或 AI 待確認
- **Fact IDs**: 會議 08（03-24）；任務 8ca50576c8994847bf133b3e252ffc81；decisions.md

## X. Speaker Notes Requirements

- **Generation**: enabled
- **Filename**: match each SVG filename under `notes/`
- **Content**: 每頁講稿依該頁主視覺講述，只用頁面與 09～11 號分析文件已有的事實；尚未確認的事項說「待確認」，不補寫；備用頁講稿寫成詢答回答方向
- **Total duration**: 正文約 6 分鐘（P01 10 秒、P02 35、P03 40、P04 35、P05 60、P06 60、P07 35、P08 30、P09 35、P10 25）；備用頁依追問使用
- **Notes style**: conversational，誠實、具體、不行銷
- **Presentation purpose**: 先說明團隊實際採用的敏捷方式，再用兩個真實案例佐證，最後主動揭露證據限制與下一步改善
