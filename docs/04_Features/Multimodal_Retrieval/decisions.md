# 多模態檢索設計決策

多模態檢索是讓學生的文字問題，除了比對逐字稿，也能比對老師講話的聲音與畫面，再把幾路結果合併成一份排名。這份文件回應 2026-10-22 複評評審 3-4「聲音做到哪」，記錄與使用者逐題討論後已定案的設計、目前這一輪的待答題目與實作切分；換 session 或換 agent 時以本文件接續。功能是否完成只看[目前狀態](../../current-status.md)。

問題來源：[複評後續處理總表](../../01_系統手冊/審查與修訂/2026-10-22_複評回放/後續處理總表.md) 3-4、R7 與「多模態檢索」「自研演算法與比較實驗」兩列；比較實驗的研究脈絡見[自研方法與比較實驗](../Research_Methods/自研方法與比較實驗.md)。

## 名詞

- **向量（embedding）**：把一段文字、聲音或畫面轉成一串數字，意思相近的內容數字也相近；本專題用 Gemini Embedding 2（`gemini-embedding-2`，3072 維），文字、聲音、畫面在同一個向量空間，所以文字問題可以直接比對聲音片段。
- **chunk（Leaf）**：逐字稿切出的小片段，存在 `video_segments_text`，有影片、起訖秒數與文字，是目前問答引用的單位。
- **Parent**：由數個相鄰 chunk 合併的較大段落，供分層檢索先找主題再展開，存在 `video_segments_parent`。
- **RRF（Reciprocal Rank Fusion，倒數排名融合）**：把幾路檢索各自的名次換算成分數（`1 / (k + 名次)`）再相加，只看名次、不看各路原始分數，因此不同模態的分數不必換算成同一尺度。
- **Recall@5**：一題的前 5 筆結果中，只要有一筆落在標準答案的影片與時間範圍內就算命中；命中題數除以題數。
- **MRR**：第一筆命中結果名次的倒數（第 1 名得 1、第 2 名得 0.5），再對所有題目取平均；看正確片段排得多前面。

## 整體流程（例，設計目標）

學生問「老師是在哪裡講全聯先生廣告的？」→ 問題轉成一個文字查詢向量 → 同時比對三路：逐字稿向量、聲音向量、畫面向量 → 各取前 20 名，以 RRF 合併成一份排名 → 前 5 筆片段送進回答模型。若某筆片段只靠聲音命中，送進回答模型與顯示給學生的證據仍是**同一時段的逐字稿**，引用跳到該片段起點播放。

## 現況查證（2026-10-27）

程式依 `dev` f08facb；資料庫以唯讀查詢 Shared Atlas `focusflow`。

| 項目 | 查證結果 | 依據 |
|---|---|---|
| 聲音向量 | `embed_audio_tracks` 把整支影片的音軌上傳後只產生**一個**向量，紀錄只有 `video_id`、`audio_path`，沒有起訖時間；只寫在本機 JSONL。Atlas 有空的 `video_segments_audio` 集合（0 筆、舊 snake_case 索引、沒有向量索引） | [embedding.py](../../../STT_Whisper/src/embedding.py) `embed_audio_tracks`、`_build_audio_record` |
| 影像向量 | 另一支實驗程式把**第一支**影片切成 120 秒片段產生影像向量；`video_segments_video` 只有 30 筆舊實驗資料（`video_001` 16 筆、其他 14 支各 1 筆），AI入門 6 支沒有影像向量 | [video_multimodal_pipeline.py](../../../STT_Whisper/src/video_multimodal_pipeline.py) `split_first_video`、`VIDEO_CHUNK_DURATION_SEC=120` |
| 後端影像檢索 | `QA_VISUAL_RETRIEVAL_ENABLED=false`（預設關閉）。開啟時與文字檢索並行，結果**不融合排名、不送進回答**，只在文字引用後面附加最多 3 筆時間不重疊的影像片段；文字 0 筆時才改用影像片段回答 | [qa.service.js](../../../backend/src/services/qa.service.js) `searchVisualSegmentsWithAtlas`、`selectSupplementalVisualMatches` |
| RRF | 問答程式**沒有** RRF 或任何排名融合；評測程式只有計算 MRR 的 `reciprocalRank` | [retrievalEvaluation.service.js](../../../backend/src/services/retrievalEvaluation.service.js) |
| 查詢向量格式 | 問題向量加上 `task: search result | query:` 前綴；文件向量用 `title: none | text:`。聲音與畫面沒有文字前綴可加 | [embeddingContract.service.js](../../../backend/src/services/embeddingContract.service.js)、[embedding_contract.py](../../../STT_Whisper/src/embedding_contract.py) |
| 分層開關 | `HIERARCHY_ENABLED`、`PARENT_EMBEDDING_ENABLED` 預設關閉，後者需要前者；Parent 規則是固定 3 個 chunk 合併 | [config.py](../../../STT_Whisper/src/config.py) |
| AI入門 6 支 chunk | 共 694 筆、總長約 10,846 秒。平均 12.7～21.0 秒；最短 2 秒；V3、V5 各有一筆 600 秒以上、文字只有「好好」的片段（長時間沒講話被併成一段） | Atlas 唯讀彙總 `video_segments_text` |
| 題庫 | 50 題，其中 43 題有標準答案（7 題課程外應拒答）；每題標註影片代號與秒數範圍。只涉及 V1 的有 7 題，另有 2 題同時涉及 V1 與 V2 | [question-bank.json](../QA_Evaluation/datasets/question-bank.json) |
| Atlas 搜尋索引 | 已有 3 個向量索引：`text_embedding_index`、`parent_embedding_index`、`video_embedding_index`（皆 READY）。2026-04-19 實作紀錄寫叢集是免費方案；**免費方案不分種類最多 3 個搜尋索引、資料上限 0.5 GB**，Flex 方案 10 個。目前資料量約 56 MB。**使用者 2026-10-29 確認目前是免費方案**，3 個索引名額已用滿；免費方案另有每秒 100 次讀寫、每 7 天進出各 10 GB 的限制，版本固定為 MongoDB 8.0（Atlas 管理 API 未開放給 AI 用戶端，無法以工具查證） | [實作紀錄](../../../backend/docs/implementation-log.md) 2026-04-19；[MongoDB 免費與 Flex 限制](https://www.mongodb.com/docs/atlas/atlas-search/shared-tier-limitations/)、[免費叢集限制](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/) |
| 重跑入口 | 重新處理只接受 `failed` 狀態的影片；已完成的 6 支要重跑需要另外的入口或狀態轉換 | [YouTube 恢復與清理](../YouTube_Lifecycle/decisions.md)交接紀錄 |
| 原片位置 | 進場實測要從原片切出聲音與畫面片段。6 支原片在使用者本機 `D:\AI-workspace\01_Projects\短影音測試製作\sourceiA10_1140119_1～6.mp4`（2025-04-18，H.264＋AAC，30 fps）；各支長度與資料庫 chunk 的最後時間相差 1～25 秒，是同一批影片。不必再從雲端硬碟下載 | ffprobe 實查；[學生端播放介面](../Student_Player_UX/decisions.md)第 2 項原本寫要重新下載 |
| 向量實際大小 | AI入門 694 筆 chunk 的 `embedding` 都是 3072 個 double 的陣列；整筆文件平均 42,227 bytes，扣掉向量只有 313 bytes，即每個向量約 41.9 KB | Atlas 唯讀彙總（`$bsonSize`），`mongodb` MCP |
| 重跑耗時估算 | 見下方「重跑耗時估算」 | 2026-05-06 pipeline 紀錄、本機硬體 |
| 畫面內容 | 抽查 V1、V3、V5、V6 每 5 分鐘一格：螢幕錄影為主，內容是中文投影片，老師常用紅筆手寫註記（含數字，例「4090 → 24GB ×4 = 96G」）；右側有講者鏡頭小窗；部分時段改顯示網頁、Colab 等畫面；也有只顯示「思齊」頭像、沒有分享畫面的時段 | ffmpeg 抽格檢視 |
| 目前的檢索架構 | 平面式：問題向量直接比對所有 chunk 取前幾名，再補同影片相鄰片段當上下文。分層檢索程式已有，但 `HIERARCHICAL_RETRIEVAL_ENABLED` 預設關閉，Parent 只有 1 支影片 3 筆；正式環境的實際值要看 `/health` 當次查證 | [env.js](../../../backend/src/config/env.js)、[qa.service.js](../../../backend/src/services/qa.service.js) |

### 重跑耗時估算（2026-10-29）

依本機（i7-12700H、RTX 3050 筆電版；pipeline 紀錄使用 CPU int8）與 2026-05-06 的 pipeline 紀錄估算，6 支共約 10,850 秒音訊。**只有「Whisper small」與「文字向量」兩項有實測依據，其他是推估**，正式重跑前先用 V1 試跑一次量實際時間。

| 步驟 | 依據 | 6 支估計 |
|---|---|---|
| Whisper 轉錄 | 實測：small、CPU int8，120 秒音訊（去靜音後 102 秒）轉錄約 50 秒，約為音訊長度的 0.4～0.5 倍 | small 約 75～90 分鐘；tiny 推估約 20～30 分鐘（未實測）；GPU 未設定、未實測 |
| 文字向量 | 實測：8 筆約 4.3 秒，每筆約 0.55 秒（一筆一次請求） | 694 筆約 6～7 分鐘 |
| Parent 向量 | 推估：約 230 筆 | 約 2 分鐘 |
| 逐段聲音＋影像向量 | 推估：1,388 次「切片＋呼叫」，每次 2～3 秒 | 依序約 45～70 分鐘，4 路平行約 15～20 分鐘 |
| 寫入 Atlas 與索引重建 | 推估：每筆 3 個向量約 126 KB，共約 87 MB | 數分鐘；索引重建時間未知，重建期間舊定義仍可查（D9） |

合計機器時間：Whisper small 約 2.5～3 小時、tiny 約 1.5 小時，另加失敗重試與人工檢查（章節抽查、50 題預先提問）。**尚未估入的工作**：已完成影片的重跑入口（目前只接受 `failed`）要先開發；11/3 落在期中考週（11/2～6）。

### Gemini Embedding 2 官方規格與價格（2026-10-27 查證）

- 輸入：文字、圖片、影片、聲音、PDF；整次請求上限 8,192 token。**聲音每次最多 180 秒**（MP3、WAV）；**影片每次最多 120 秒**，32 秒以內每秒取 1 格，更長則平均取 32 格，**影片內的聲音不處理**。
- 維度：預設 3072，可設 128～3072。不支援 `task_type`，文字用前綴區分查詢與文件。同一個 `contents` 放多段會合併成一個向量，要分開就各用一個 `Content`。
- 價格（付費層，每百萬 token）：文字 US$0.20；聲音 US$6.50（**每秒 US$0.00016**）；影片 US$12.00（**每格 US$0.00079**）。Batch API 半價。免費層可免費呼叫，但不能用 Batch。
- 估算：6 支聲音全做一次約 10,846 秒 × 0.00016 ≈ **US$1.7**；V1 單支約 US$0.3。影像每秒 1 格、6 支全做約 **US$8.6**（Batch 約 US$4.3）。

來源：[參考文獻](references.md) D1～D3。總表引用的 Vertex AI 文件（D3）寫每秒 25 token，與上列每秒價格一致。

### 業界與研究做法（2026-10-27 查證，涵蓋到 2026-09）

| 主題 | 做法與結果 | 對本專題的意義 |
|---|---|---|
| 切段長度 | Twelve Labs 預設每 6 秒一個向量、可設 2～10 秒（D6，據搜尋摘要）；AWS Bedrock 上的 Marengo 預設依鏡頭切換切段、最短 4 秒（D5）；Vertex AI 舊版多模態向量預設每 16 秒一段、最短 4 秒，超過 120 秒品質下降（D4） | 本專題 chunk 平均 13～21 秒，落在業界常用範圍；過短片段要補長 |
| 聲音與畫面分開 | Marengo 一支影片同時產生「畫面」「聲音」（3.0 另有「逐字稿」）幾種向量，各自檢索（D5） | 支持聲音、畫面各存一個向量，而不是混成一個 |
| 文字 vs 畫面 | VideoRAG（R2）：只用逐字稿 R@5 0.302、只用畫面 0.193、加權合併 0.311，文字權重 0.5～0.7 最好 | 預期畫面單獨不如逐字稿，合併只會小幅提升 |
| 融合方式 | MMMORRF（R3，新聞影片）：只看語音轉文字 nDCG@10 0.427、語音＋畫面文字 0.551、再用加權 RRF 加入畫面向量 0.586；**一般 RRF 只到 0.562，提升未達統計顯著**；端到端多模態向量模型只有 0.005～0.324 | 文字通道是主力；一般 RRF 可能不夠，要事先準備加權版本 |
| 講課影片的各模態 | Omni-Embed-Nemotron（R9）在 LPM 講課資料集：文字（逐字稿＋投影片 OCR）nDCG@10 0.8636、只用聲音 0.8238、只用畫面 0.7365；聲音與畫面**分開編碼再合併** 0.8465，優於混成一個向量的 0.8373 | 講課影片上聲音接近文字、畫面最低；聲音與畫面要各存一個向量。該論文沒有測「文字＋聲音」，正是本專題要量的 |
| Gemini 的聲音向量 | Gemini Embedding 2 技術報告（R8，2026-05）：「口說問題找文字段落」時，直接用聲音向量的 mrr@10 73.99，先轉文字再比對 70.40 | 支持 Gemini 的聲音與文字在同一空間對得上；但報告沒有測本專題的方向（文字問題找聲音片段），也沒提中文 |
| 直接用聲音向量 | WavRAG（R4）、SpeechRAG（R5），只讀過摘要：不經語音轉文字直接比對聲音，作者自報與轉文字流程相當，且能避開辨識錯誤 | 本專題逐字稿用 Whisper tiny，錯字多（題庫有「口語錯字」5 題），聲音向量可能在這類題目補回 |
| 投影片文字 | 講課影片的檢索研究長期把投影片 OCR（從畫面辨識文字）當主要索引、語音當補充（R7，只核對書目與專案頁） | 畫面資訊除了影像向量，也可以 OCR 成文字放進文字通道 |
| 最新做法的提升來源 | MAGMaR 2026 影片檢索任務（R10）：最好的系統把影片轉成文字摘要建索引，再用大型語言模型重新排序；第二名的提升主要來自拆解問題與重新排序，而不是合併方式 | 合併排名不是唯一手段；重新排序列為之後的工作，不在這次範圍 |
| RRF 參數 | Elasticsearch 的 `rank_constant` 預設 60（D7）；k=60 出自 RRF 原始論文（R1），在先導實驗定下後就不再調整 | k=60 是業界預設；MMMORRF 改用 k=0 加權重 |
| 時間定位評測 | 片段定位研究（R6）用「預測片段與標準答案的時間重疊比例（IoU）≥0.5 或 0.7」算 R@1、R@5 | 本專題的檢索單位（約 14 秒）比標準答案範圍（28～530 秒，中位數 108 秒）短很多，IoU 會偏低，要改用「片段多少比例落在範圍內」 |

完整書目、我們實際讀到的範圍與各篇限制見[參考文獻](references.md)；表中以 R（論文）、D（官方與業界文件）編號標示。只讀過摘要的論文，不引用摘要以外的內容。

## 已定案

討論前已確認的前提：

| # | 決策 | 理由與來源 |
|---|---|---|
| 1 | 對外說法更正為「現有聲音向量是整支音軌一個、沒有時間點、未匯入資料庫，不能定位影片位置」 | 程式查證；[總表對外說法更正](../../01_系統手冊/審查與修訂/2026-10-22_複評回放/後續處理總表.md) 3-4 |
| 2 | 使用者 2026-10-25 同意為進場實測付費呼叫 Gemini；實測向量只存本機，不寫 Atlas | 總表「多模態檢索」列 |
| 3 | Atlas 寫入、建立或修改索引都要使用者另外授權，目標要明確 | [AGENTS.md](../../../AGENTS.md) 工作邊界 |
| 4 | 向量模型維持 `gemini-embedding-2`；地端模型受授權與算力限制，這一版不換 | 總表「地端多模態向量模型」 |

### 第一輪（2026-10-27 使用者同意 Q1～Q6 全部照建議）

| # | 決策 | 理由、取捨與來源 |
|---|---|---|
| 5 | 目標分兩層：**必達**是完成進場實測並據實報告，且逐段產生、存放、檢索、RRF 合併、證據規則的程式全部做完並放在開關後面；**條件達成**是實測通過門檻，問答才預設開啟多模態 | 有日期、樣本與條件的數字最經得起追問；研究顯示合併不一定有提升（R2：R@5 0.302→0.311；R3：一般 RRF 不顯著）。兩種結果都有誠實說法：「接上了，有提升所以預設開啟」或「接上了，沒有提升所以預設關閉，數字如下」 |
| 6 | 進場實測用 AI入門 6 支、43 題有標準答案的題目，用目前資料庫的 chunk，不等重跑 | 只涉及 V1 的 9 題中，1 題就差 11 個百分點；6 支聲音全做約 US$1.7（D2）。重跑後的資料留給正式比較實驗 |
| 7 | 評分：檢索範圍整門課；chunk 時長一半以上落在標註範圍內才算相關；主指標 Recall@5，次指標 MRR、Recall@10，列出只有某組命中的題目並依題型分開；7 題課程外只記第一名分數；每路取前 20 名，融合跑一般 RRF（k=60、權重相同）與文字加權 RRF（文字 2、其他 1）兩版；完整比對；跑之前固定、不調參數 | 片段定位研究用 IoU≥0.5（R6），但 14 秒 chunk 對 108 秒範圍的 IoU 最多約 0.13；k=60 是 R1 與 D7 的預設；加權版依 R2、R3；依題型分開依 R11。同一份題庫之後還要用在正式比較實驗，報告須寫明進場實測只用來決定做不做 |
| 8 | 比較 6 組：只用文字、只用聲音、只用影像、文字＋聲音、文字＋影像、三路合併 | 重跑時要不要產生影像向量也需要數字；組合比較不必再付費，影像多約 US$8.6。預期影像最低、聲音接近文字（R9 講課資料：0.86／0.82／0.74）；R9 沒測文字＋聲音，正是本實測補上的數字。估計比只做聲音多約半天開發、30～60 分鐘執行，可先跑文字與聲音 |
| 9 | 聲音、影像都沿用 chunk 起訖時間，一個 chunk 各一個聲音向量、一個影像向量，分開算不混成一個；短於 8 秒前後延伸到 8 秒，向量仍掛原 chunk；長於 60 秒不產生並記錄原因 | 一對一對應讓證據與去重最單純；chunk 長度落在業界範圍（D4～D6）；分開再合併優於混成一個（R9：0.8465 對 0.8373）。60 秒以上多為沒講話的時段 |
| 10 | 這次實測不加投影片 OCR；畫面以中文投影片加手寫註記為主（2026-10-27 抽格確認），OCR 列為第一順位的後備方案，屆時改用 Gemini 直接讀畫面，不用一般 OCR | 研究支持 OCR 對講課影片有效（R7、R9），但題庫依逐字稿出題，效果可能量不出來。影像向量只能幫忙「找到」，不能當回答證據；只寫在投影片上、沒唸出來的資訊要靠 OCR 或把畫面給回答模型 |

### 第二輪（2026-10-29 使用者同意 Q7～Q11 全部照建議）

| # | 決策 | 理由、取捨與來源 |
|---|---|---|
| 11 | 聲音、影像**各自**判斷是否預設開啟。比較「只用文字」與該模態合併組（一般 RRF、文字加權 RRF 取較好者，兩版都列出）；通過條件是 Recall@5 淨多命中至少 3 題且 MRR 不低於只用文字，只用文字失敗題少於 6 題時改為救回一半以上；原本命中的題目最多掉 1 題，新命中題逐題人工確認；附配對隨機化檢定 p 值但不當門檻 | 43 題中 3 題約 7 個百分點，大於隨機波動；題目少時建議用隨機化檢定（R12），但預期提升小（R2、R3），以顯著當門檻等於事先決定不開。掉題上限避免「總數變多、原本答得出的反而答不出」 |
| 12 | 證據一律用同一筆 chunk 的逐字稿加相鄰片段，提示詞不改；引用多回傳 `retrievedBy`，網頁引用卡片顯示「比對方式」小標籤，LINE 不顯示；新開關 `QA_MULTIMODAL_FUSION_ENABLED` 打開時停用舊的影像補充引用路徑；FAQ 快取的證據版本納入檢索設定 | 向量不能當證據；回答與引用驗證不必改。標籤讓佈展看得出靠語音找到並誠實揭露。新舊影像路徑同開會重複引用。快取不分設定會在切換後回舊答案 |
| 13 | 聲音、影像向量存成 `video_segments_text` 每筆 chunk 的 `audioEmbedding`、`visualEmbedding`（3072 維數字陣列）及狀態、取樣時間、模型、契約版本、略過原因；`text_embedding_index` 加兩個向量欄位，沿用 `courseId`、`videoId` 過濾；RRF 在後端程式內做；舊影像集合與索引、空的 `video_segments_audio` 不動；改索引與寫入需另外授權 | 叢集是免費方案、3 個索引已滿（D8，使用者 2026-10-29 確認）；同一索引可放多個向量欄位、修改時舊定義仍可查（D8、D9）。程式內 RRF 讓 memory 模式評測與正式環境同一套邏輯，且不依賴免費叢集版本。實測每個向量 41.9 KB，AI入門多約 58 MB；之後每小時影片約 29 MB，約再 13 小時要改 BinData（D10）或升級 |
| 14 | 重跑時不論實測結果都產生逐段聲音與影像向量（約 US$10）；逐段向量做成可對已存在 chunk 補產的獨立步驟，趕不上 11/3 就重跑後補產；重跑同時開分層開關、關舊的整支音軌與 120 秒影像程式；Whisper 與 chunk 參數由重跑負責人決定並記錄實際值 | 實測延誤不會卡住重跑；chunk 一對一讓事後補產可行。舊整支音軌受 180 秒上限而無效（D1）。Whisper 改變文字組基準，必須記錄 |
| 15 | 正式比較實驗做成 2×2（平面／分層 × 只用文字／多模態），用重跑後資料、50 題全跑；每組算檢索指標並用六面向評分（Claude 先評、使用者抽 20% 盲評，一致率低於 80% 修準則）；四組都關 FAQ 快取、固定回答模型與提示詞；進場實測與正式實驗分開報告 | 分開兩組實驗看不出兩者合用時加分還是抵銷；2×2 只多 1 組、共 200 個回答。評分沿用[問答評測](../QA_Evaluation/README.md)做法 |

## 目前這一輪待答題目

第三輪。2026-10-29 Weihao 決定實作改由組員庭語負責；同日補充：庭語對技術不熟，**技術架構必須由 Weihao 這邊先全部定案**。原則：

- **需 Weihao 定案**：凡是影響資料結構、索引、模型、參數、實驗設計與結果判讀的事項。本輪 Q12～Q19 全部屬於這一類。
- **庭語可自行決定**：不影響架構的小細節，例如變數命名、報告排版、commit 訊息措辭。她的 AI 工具可用 repo 內的 `grilling` skill（`.claude/skills/grilling`、`.agents/skills/grilling`）和她確認這類細節。
- 文件寫不到、需要技術判斷的情況，一律停下來找 Weihao（列在 [HANDOFF](HANDOFF.md) 的「先找 Weihao 討論」一節）。

### Q12：分層模式下怎麼合併

**類別**：需 Weihao 定案（影響實驗設計與結果判讀）。

**問題**：是否在兩種模式都用同一條規則——「文字檢索器」先產出一份排好序的 chunk 清單（平面模式是直接向量比對；分層模式是先找 Parent 再展開出的 chunk 順序），聲音、影像各產出一份 chunk 清單，三份在 **chunk 層**做 RRF，之後交給同一個上下文組合步驟（沿用現有片段數與字數上限）？

**建議答案**：是。聲音或影像命中、但不在展開範圍內的 chunk，這一版不再回頭補它所屬 Parent 的其他片段。

**理由**：2×2 實驗要能分清楚「分層」與「多模態」各自的效果，最乾淨的做法是分層只改變文字檢索器、合併規則兩種模式完全相同。證據本來就在 chunk 層（已定案第 9、12 項），在同一層合併不必換算；業界常見的做法也是先在小片段層合併、再視需要往上合併（LlamaIndex 的 AutoMergingRetriever 在同一 Parent 的子片段命中超過一半時才換成 Parent，D11）。補 Parent 會讓上下文多出一批片段、擠掉其他證據，也讓實驗多一個變數；若正式實驗發現聲音命中的片段常缺上下文，再比照 D11 加入。

### Q13：誰做、誰審、誰按確認

**類別**：需 Weihao 定案。

**問題**：是否採以下分工？

- **實作與執行**：庭語，使用她自己選的 AI 工具（Claude Code 或 Codex），照工單與 Q19 的技術規格做，不自行改架構。
- **審查**：Weihao 的協調 session 依本文件逐條審查每張工單的 commit、實作紀錄與測試結果；不通過就退回並寫明要改什麼。
- **三個關卡由庭語按確認**：付費呼叫 Gemini、寫入 Atlas（含修改 `text_embedding_index`）、重跑 6 支影片。每個關卡的「寫入哪個集合與索引、跑哪個指令、費用上限、成功與失敗怎麼判斷」事先寫死在 HANDOFF 的關卡執行稿；庭語只核對與執行，**結果不符合成功條件就停下來找 Weihao**，不自行重試或修改。
- **Weihao 只做兩次判斷**：判斷①（進場實測後，是否預設開啟）、判斷②（正式實驗後，是否部署開啟）。

**建議答案**：是。

**理由**：把需要技術判斷的部分事先寫成可核對的條件，庭語按確認時只需比對「指令一樣、預估費用在上限內、結果符合成功條件」，不必理解底層技術；任何不符都停下來，避免在不了解影響的情況下擴大錯誤。審查與判斷留在 Weihao 這邊，確保結果符合已定案的設計。

### Q14：截止日

**類別**：需 Weihao 定案（各階段的每日安排寫在 HANDOFF）。

**問題**：是否採以下截止日？11/2～11/6 是期中考，不排需要庭語投入的工作。

| 截止 | 里程碑 | Weihao |
|---|---|---|
| 10/31（六） | 庭語讀完 HANDOFF、環境能跑測試、拿到原片與文字向量匯出檔 | 提供原片、匯出檔、Atlas 與 Gemini 專用帳號（Q18） |
| 11/1（日） | 先完成 M3 的 RRF 模組與 M1 的切片程式（不呼叫付費 API） | 協調 session 審查 |
| 11/8（日） | M1 產生逐段向量、M2 跑出進場實測報告 | **判斷①** |
| 11/10（二） | M1～M5 審查通過、合併，開關預設關閉；更新索引 | 協調 session 審查 |
| 11/13（五） | 重跑後補產、寫入 Atlas、正式 2×2 實驗與評分報告（M6） | — |
| 11/14（六） | — | **判斷②**：是否開啟與部署 |
| 11/16（一） | 凍結部署（佈展） | — |

**建議答案**：是。若 11/1 前已完成進場實測，判斷①提前。

**理由**：庭語需要上手時間，期中考又占掉一整週；「程式完成」仍維持 11/10、「正式實驗與是否開啟」放到 11/14，仍在 11/16 凍結前。程式先以開關預設關閉合併，正式實驗延誤也不影響部署。

### Q15：實驗結果放哪裡

**類別**：需 Weihao 定案（影響結果判讀與追溯）。

**問題**：是否把實驗紀錄放在 `docs/04_Features/Multimodal_Retrieval/evidence/`——每次一份報告（含日期、資料版本、設定、各組數字、逐題結果摘要與限制）與逐題結果 JSON；向量與切出的影音片段只留本機 `STT_Whisper/data/`（已在 `.gitignore`），不進 repo？

**建議答案**：是。

**理由**：報告與逐題結果是期末報告與面試的證據，要能追溯；向量一份就有數十 MB、影音片段更大，依 repo「只留最新、大檔上雲端」的原則不進版控。逐題結果保留每題各組的名次，日後有人質疑可以重算。

### Q16：實作紀錄怎麼寫

**類別**：需 Weihao 定案；段落排版可由庭語調整。

**問題**：是否採以下三層紀錄，讓日後出 bug 能追到「哪張工單、哪個決策、哪段程式」？

- **開發接手** `HANDOFF.md`：工單、分支、時程、狀態表與使用者判斷點，比照[系統設定](../System_Settings/HANDOFF.md)；功能完成時在同一個 PR 封存。
- **每張工單一份實作紀錄** `evidence/<日期>_<工單>-實作紀錄.md`：目標與對應決策編號、commit 清單、改了哪些檔案與各自責任、與工單或決策不同之處與原因、演算法與參數（例：RRF 的 k、補長規則）、測試指令與結果（已執行與未執行分開）、已知限制、**除錯指引**（相關開關、log 關鍵字、診斷欄位、怎麼重現）。由庭語的 AI 工具寫、Weihao 的協調 session 審查時核對。
- **執行期可追溯**：問答回應的 `runtime` 診斷記錄融合設定（是否開啟、版本、k、權重）、每一路的筆數、耗時與退回原因；每筆引用記錄 `retrievedBy` 與各路名次。pipeline 對每個 chunk 記錄聲音、影像向量的狀態與略過原因。

**建議答案**：是。功能狀態仍只寫在[目前狀態](../../current-status.md)，實作紀錄只連過去。

**理由**：每張工單各寫一份，平行開發時不會互相衝突，也能從 bug 直接對到負責的工單。除錯指引寫在紀錄裡，是因為接手的人通常不知道該看哪個開關或 log。執行期診斷讓正式環境出問題時，從一次提問的回應就看得出是哪一路找到、哪一路失敗，不必重現。後端原本的 `implementation-log.md` 已改成入口頁、不再逐筆記錄，所以紀錄改放在功能資料夾。

### Q17：人工確認與評分由誰做

**類別**：需 Weihao 定案。

**問題**：是否修改已定案第 11、15 項中需要人做的部分？

- 第 11 項「新命中題逐題確認證據」→ 庭語的 AI 工具依 M2 腳本產出每題的命中片段文字；Weihao 的協調 session 逐題確認是否真的相關，結果附在實測報告；Weihao 在判斷①看摘要。
- 第 15 項「使用者抽 20% 盲評」→ 兩個不同家族的模型各自獨立評全部 200 個回答：**Claude 主評、DeepSeek 第二評**，評分提示與準則沿用[問答評測](../QA_Evaluation/README.md)；一致率低於 80% 時停下來找 Weihao 修準則；**不用 Gemini 評分**（回答是 Gemini 產生的）。分歧題清單交 Weihao 在判斷②看。
- 庭語只負責照執行稿跑評分與整理清單，不做內容判斷。

**建議答案**：是。

**理由**：強模型當評審與人類的一致率可達 80% 以上，與人類彼此相當，但模型會偏好自己產生的答案（R13），所以避開 Gemini、用第二個不同家族的模型交叉檢查。內容是否正確的判斷需要懂題目與技術，留給 Weihao 這邊；庭語不必做判讀。

### Q18：原片、金鑰與資料庫權限

**類別**：需 Weihao 定案。

**問題**：是否採以下做法？

- **原片**：Weihao 把 6 支原片（約 630 MB，在 Weihao 電腦 `D:\AI-workspace\01_Projects\短影音測試製作\source\`）放到團隊雲端硬碟給庭語。
- **文字向量**：Weihao 的協調 session 從 Atlas 唯讀匯出 AI入門 694 筆 chunk（含文字向量，約 29 MB）給庭語；進場實測用 memory 模式，不連 Atlas。
- **Gemini**：建一把只開放 Generative Language API 的專用金鑰給庭語，並在 Google Cloud 設預算提醒（例：US$30）；佈展後撤銷。
- **Atlas**：建一個專用資料庫帳號，自訂角色只允許 `focusflow.video_segments_text` 的讀取與更新，以及該集合的搜尋索引查詢與更新；不能刪除、不能動其他集合。佈展後刪除這個帳號。
- 金鑰與帳密只放在庭語本機的 `.env`，不寫進任何文件或回報。

**建議答案**：是。

**理由**：庭語要按確認，就需要能執行的權限；把權限縮到「只能更新這一個集合與它的索引」，即使操作失誤也不會波及其他資料。專用金鑰與帳號可追蹤、用完可撤銷，不必交出主要帳密。自訂角色的實際權限名稱（`find`、`update`、`listSearchIndexes`、`updateSearchIndex`）在建立帳號時當場查證。

### Q19：技術規格

**類別**：需 Weihao 定案。

**問題**：是否把以下規格定為工單的唯一依據，庭語照做、不自行更改？

**① 逐段向量產生（M1，`STT_Whisper`）**

- 新增模組 `src/segment_media_embedding.py`，可單獨執行，也可由 `main.py` 在新階段 `segment_media_embedding` 呼叫。
- 輸入：原片路徑、`videoId`、chunk 清單（JSONL，欄位 `chunkId`、`videoId`、`startSec`、`endSec`、`text`）。輸出：`data/outputs/segment_media/<videoId>.jsonl`，每行一筆。
- 取樣時間：chunk 短於 8 秒時，以中點為準前後延伸到 8 秒（不超出影片頭尾）；長於 60 秒標為 `skipped_too_long`，不呼叫 API。8 與 60 寫成程式常數，不開放設定。
- 切片：聲音用 FFmpeg 轉單聲道 16 kHz WAV；畫面用 FFmpeg 轉無聲 MP4（高 480、每秒 1 格、H.264）。以 inline bytes 送出，每次請求只放一段、取回一個向量；不加文字前綴。
- 模型 `gemini-embedding-2`、3072 維、L2 正規化；最多 4 路平行；遇到 429 沿用現有退避重試。
- 每筆紀錄欄位：`chunkId`、`videoId`、`modality`（`audio`／`visual`）、`sampleStartSec`、`sampleEndSec`、`status`（`success`／`skipped_too_long`／`failed`）、`skipReason`、`embedding`、`model`、`dimension`、`contractVersion`（`gemini_embedding_2_audio_v1`／`gemini_embedding_2_visual_v1`）、`requestId`、`createdAt`。
- 斷點續跑：同一 `chunkId`＋`modality`＋取樣時間已成功的不重算。
- 費用保護：執行前印出預估費用（聲音秒數 × US$0.00016＋畫面格數 × US$0.00079），必須帶 `--max-cost-usd`，預估超過就不執行。
- 新開關（預設皆關閉）：`SEGMENT_AUDIO_EMBEDDING_ENABLED`、`SEGMENT_VISUAL_EMBEDDING_ENABLED`；舊的整支音軌向量改由新開關 `AUDIO_TRACK_EMBEDDING_ENABLED`（預設關閉）控制；`ENABLE_GEMINI_VIDEO_EMBEDDING` 維持關閉。

**② 進場實測（M2，`backend/scripts/multimodal-eval/`）**

- `exportCourseChunks.js`：唯讀匯出指定課程的 chunk 與文字向量成 JSONL（由 Weihao 的協調 session 執行）。
- `runEntryExperiment.js`：讀匯出檔、逐段向量 JSONL 與題庫，問題向量呼叫一次 Gemini 後快取成檔案；完整餘弦比對；依已定案第 7、8 項算 6 組 × 2 版；隨機化檢定 10,000 次、亂數種子固定 `20261108`。
- 輸出 `evidence/<日期>_entry-experiment/`：`report.md`、`per-question.json`（每題各組前 20 名的 `chunkId` 與名次）、`config.json`（輸入檔雜湊、參數、程式版本）。

**③ 資料與索引（M5）**

- `video_segments_text` 新欄位：`audioEmbedding`、`visualEmbedding`（3072 個數字的陣列）；`mediaEmbeddingMeta.audio`、`mediaEmbeddingMeta.visual`（`status`、`sampleStartSec`、`sampleEndSec`、`model`、`contractVersion`、`skipReason`、`createdAt`）。
- 寫入腳本 `STT_Whisper/src/upload_segment_media_embeddings.py`：只用 `chunkId`＋`videoId` 比對、只 `$set` 上述欄位、**不新增文件（不 upsert）**；有 `--dry-run`，會先印出「預計更新筆數」與「找不到的 chunkId」。
- 索引腳本 `backend/src/scripts/ensureMultimodalVectorFields.js`（比照 `ensureVideoVectorIndex.js`）：把 `text_embedding_index` 改為 `embedding`、`audioEmbedding`、`visualEmbedding` 三個 3072 維 cosine 向量欄位，加上原有的 `courseId`、`videoId` 過濾；有 `--dry-run`；套用後每 30 秒查一次，最多 30 分鐘，直到 `queryable: true` 且定義正確。
- 後端 model `videoSegment.model.js` 加上新欄位，預設不讀出向量。

**④ 後端融合（M3）**

- 新服務 `backend/src/services/rankFusion.service.js`：`reciprocalRankFusion(lists, { k = 60, weights })`，k 固定 60；輸出每筆的 `fusionScore`、`retrievedBy`、`channelRanks`。M2 直接呼叫這個函式。
- 環境變數：`QA_MULTIMODAL_FUSION_ENABLED`（預設 `false`）、`QA_MULTIMODAL_FUSION_CHANNELS`（`audio`、`visual` 的逗號清單，依判斷①填）、`QA_MULTIMODAL_FUSION_MODE`（`equal` 或 `text_weighted`，依判斷①填）、`QA_MULTIMODAL_CHANNEL_LIMIT`（預設 20）。
- Atlas 模式對同一個 `text_embedding_index` 分別以 `path` 查三個欄位；memory 模式用同一套函式計算；兩種模式都在 chunk 層合併（Q12）。
- 回應：每筆引用加 `retrievedBy`、`match.channelRanks`；`runtime.retrieval.fusion` 記錄 `enabled`、`channels`、`mode`、`k`、`weights` 與每一路的 `count`、`ms`、`fallback`。
- 開關打開時跳過 `searchVisualSegmentsWithAtlas` 與「只用影像回答」路徑；FAQ 的證據版本加入檢索設定指紋（開關、通道、模式、分層開關）。
- 同步 `backend/docs/openapi.yaml`、`.env.example`、`backend/docs/feature-flags.md`。

**⑤ 前端（M4）**

- `StudentCourses.jsx` 的引用卡片：`retrievedBy` 含 `audio` 或 `visual` 時，顯示「比對方式：逐字稿、語音、畫面」（只列出實際有的）；只有 `text` 時不顯示。LINE 不改。

**建議答案**：是。

**理由**：庭語不需做技術判斷，規格就必須寫到「照做即可」的程度：檔名、欄位、開關、參數、輸出格式與成功條件都固定。關鍵選擇的依據都已在前面定案（chunk 一對一、分開兩個向量、程式內 RRF、不新增索引）；這裡把它們落成具體名稱。切片用 inline bytes 而非上傳檔案，是因為 8～60 秒的片段只有數 MB，且可省去檔案上傳與清理；畫面降到 480 高是因為 Gemini 依格數計價，解析度不影響費用但影響上傳大小。

## 實作切分

待討論完成後切出工單，放在 `work-orders/`。
