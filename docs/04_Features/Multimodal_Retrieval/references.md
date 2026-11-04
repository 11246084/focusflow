# 多模態檢索參考文獻

這份文件保存多模態檢索設計時查過的論文與業界文件，作為實作、期末報告與面試時說明「為什麼這樣做」的依據。每筆寫明書目、我們實際讀到哪裡、取用了哪些數字，以及用在哪個決策；[設計決策](decisions.md)以 R、D 編號引用。查證日期都是 2026-10-27，文獻搜尋涵蓋到 2026-09 的預印本。

## 使用規則

- **只引用表中「查證範圍」內的內容。** 只讀過摘要的論文，不可引用摘要以外的數字或做法；要用之前先讀全文，並更新這裡的查證範圍。
- **數字要連同條件一起寫。** 論文的結果來自它自己的資料集與語言（多為英文），不代表在本專題的中文講課影片上也會一樣；引用時寫「某論文在某資料集上」。
- **新增文獻先登記在這裡**，再到 decisions 引用編號，不在 decisions 另寫一份書目。
- 不把論文 PDF 放進 repo；需要保存全文時放團隊雲端硬碟，這裡只留連結與 DOI。

## 論文

### R1：Reciprocal Rank Fusion（RRF 原始論文）

- **書目**：G. V. Cormack, C. L. A. Clarke, S. Büttcher. "Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods." *SIGIR 2009*（短文）。[PDF](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf)
- **查證範圍**：讀全文第 1 頁（方法與公式）。
- **重點**：分數公式是各路名次的 `1 / (k + 名次)` 相加；k=60 是先導實驗時定下，之後驗證都沒有再調。用 RRF 合併幾個檢索方法，結果幾乎都比其中最好的單一方法好。
- **用在**：Q3 融合參數 k=60、事先固定不調。
- **限制**：實驗是 TREC 文字檢索與 LETOR 3，沒有影片或跨模態資料。

### R2：VideoRAG（以影片庫做檢索增強生成）

- **書目**：S. Jeong, K. Kim, J. Baek, S. J. Hwang. "VideoRAG: Retrieval-Augmented Generation over Video Corpus." *Findings of ACL 2025*。[arXiv:2501.05874](https://arxiv.org/abs/2501.05874)（v3，2025-05-28）
- **查證範圍**：讀 HTML 全文的 Table 2、「Analysis on Feature Ensemble」與 Figure 4 說明。
- **重點**：檢索時把影片的文字特徵（字幕，沒有字幕時用 Whisper 轉的逐字稿）與畫面特徵（每支取 4 格）以 `α × 文字 + (1−α) × 畫面` 合併。Table 2：只用畫面 R@1／R@5／R@10 為 0.054／0.193／0.288，只用文字 0.088／0.302／0.388，合併 0.103／0.311／0.442。作者指出 α 在 0.5～0.7（略偏重文字）最好，並把文字較強歸因於文字問題與文字特徵較對齊。
- **用在**：Q1 預期管理（合併只小幅提升）、Q3 文字加權版本、Q4「只用影像」組的預期。
- **限制**：資料是 HowTo100M 教學影片搭配 WikiHowQA 等英文問題，檢索單位是整支影片而非影片中的片段；向量模型是 InternVideo2，不是 Gemini。

### R3：MMMORRF（多模態、多語言的模組化 RRF）

- **書目**：S. Samuel, D. DeGenaro, J. Guallar-Blasco, K. Sanders, O. Eisape, T. Spendlove, A. Reddy, A. Martin, A. Yates, E. Yang, C. Carpenter, D. Etter, E. Kayi, M. Wiesner, K. Murray, R. Kriz. "MMMORRF: Multimodal Multilingual Modularized Reciprocal Rank Fusion." *SIGIR 2025*（短文）。[arXiv:2503.20698](https://arxiv.org/abs/2503.20698)（v4，2025-05-09）
- **查證範圍**：讀 HTML 全文的方法與結果表。會議別依論文 PDF 的 ACM 版權頁與 SIGIR 2025 論文列表；arXiv 頁面本身沒有標會議。
- **重點**：三種訊號——畫面向量（SigLIP，每支 16 格）、畫面文字（OCR）、語音轉文字（Whisper large-v2）；沒有直接用聲音向量。以加權 RRF 合併，k=0、權重依影片類型調整。MultiVENT 2.0 上的 nDCG@10：端到端多模態向量模型 0.005～0.324；只用語音轉文字 0.427、只用畫面文字 0.415；兩種文字合併索引 0.551；再加畫面向量，一般 RRF 0.562（提升未達統計顯著）、加權 RRF 0.586。
- **用在**：Q1 預期管理、Q3 加權版本、Q6 投影片文字（OCR）作為後備方案。
- **限制**：資料是多語言新聞影片，查詢以事件為主，不是講課影片；權重的換算方式論文沒有完整交代。

### R4：WavRAG（不經轉文字、直接以聲音檢索）

- **書目**：Y. Chen, S. Ji, H. Wang, Z. Wang, S. Chen, J. He, J. Xu, Z. Zhao. "WavRAG: Audio-Integrated Retrieval Augmented Generation for Spoken Dialogue Models." *ACL 2025*（長文），頁 12505–12523。[DOI 10.18653/v1/2025.acl-long.613](https://aclanthology.org/2025.acl-long.613/)
- **查證範圍**：只讀摘要。
- **重點**：主張轉文字流程會丟失聲音資訊並帶入辨識錯誤；直接用聲音建知識庫與檢索，作者自報檢索效果與先進的「轉文字再檢索」流程相當，速度約快 10 倍。
- **用在**：Q4 把「只用聲音」列為一組的理由。
- **限制**：摘要沒有給數字、資料集與聲音模型；面向口語對話模型，不是講課影片。

### R5：SpeechRAG（不經語音辨識的語音檢索增強生成）

- **書目**：D. J. Min, K. Mundnich, A. Lapastora, E. Soltanmohammadi, S. Ronanki, K. Han. "Speech Retrieval-Augmented Generation without Automatic Speech Recognition." *ICASSP 2025*。[arXiv:2412.16500](https://arxiv.org/abs/2412.16500)
- **查證範圍**：只讀摘要。
- **重點**：用文字問題直接檢索語音段落（把文字與語音向量對齊到同一空間）；作者自報檢索不比文字基準差、優於「先轉文字」的串接流程；逐字稿錯字率高時，直接用語音生成回答也較好。
- **用在**：Q4「只用聲音」組；說明本專題用 Whisper tiny、錯字多，是聲音向量可能有用的情境。
- **限制**：摘要沒有給數字與資料集名稱；需要微調語音編碼器，本專題沒有微調。

### R6：QVHighlights（影片片段定位的評測方式）

- **書目**：J. Lei, T. L. Berg, M. Bansal. "QVHighlights: Detecting Moments and Highlights in Videos via Natural Language Queries." *NeurIPS 2021*。[arXiv:2107.09609](https://arxiv.org/abs/2107.09609)
- **查證範圍**：讀評測指標定義（經搜尋結果摘錄論文內容，未逐頁閱讀全文）。
- **重點**：片段定位用「預測片段與標準答案的時間重疊比例（IoU）」判斷命中，常見門檻 0.5 與 0.7（R1@0.5、R1@0.7），多片段時另用 mAP。
- **用在**：Q3 說明為何不直接用 IoU：本專題 chunk 約 14 秒、標準答案範圍中位數 108 秒，IoU 最多約 0.13，改用「chunk 一半以上落在範圍內」。
- **限制**：該任務是預測任意長度的片段，與本專題「從固定切好的片段中排名」不同。

### R7：講課影片以語音與畫面文字檢索

- **書目**：H. Yang, C. Meinel. "Content Based Lecture Video Retrieval Using Speech and Video Text Information." *IEEE Transactions on Learning Technologies*, 2014。[DOI 10.1109/TLT.2014.2307305](https://doi.org/10.1109/TLT.2014.2307305)；同研究群的[講課影片索引專案頁](https://hpi.de/meinel/knowledge-tech/learning-engineering/tele-task/video-indexing.html)
- **查證範圍**：只核對書目與專案頁的搜尋摘要，未讀全文。
- **重點**（依專案頁摘要）：先偵測投影片切換、取關鍵格，對關鍵格 OCR、對聲音做語音辨識，兩者都用來產生關鍵字與分段；當時講課語音辨識錯字率高，畫面文字被當成較可靠的索引。
- **用在**：Q6 投影片文字列為後備方案的背景。
- **限制**：2014 年的技術，語音辨識與向量模型都已大幅進步；引用前應讀全文。

### R8：Gemini Embedding 2 技術報告

- **書目**：M. Shanbhogue, Z. Li, S. Zhang, G. Hernández Ábrego, et al.（Google Gemini Embedding Team）. "Gemini Embedding 2: A Native Multimodal Embedding Model from Gemini." 2026-05-26 預印本。[arXiv:2605.27295](https://arxiv.org/abs/2605.27295)
- **查證範圍**：讀 HTML 全文的聲音、影片、多模態輸入與維度段落。
- **重點**：
  - 聲音：在 MSEB（Massive Sound Embedding Benchmark）的檢索任務上，以「口說問題找文字段落」比較，直接用聲音向量的 mrr@10 平均 73.99，先轉文字再做文字向量 70.40；同語言 75.58 對 73.58，跨語言 72.56 對 67.55。作者歸因於轉文字的錯誤傳遞，以及聲音保留語調、重音等線索。
  - 影片：每秒 1 格、最多 32 格；文字找影片的 nDCG@10 平均 63.1（Vatex 68.8、MSR-VTT 68.0、YouCook2 52.5）。
  - 輸入可任意混合文字、圖片、影片、聲音；不加任務說明也能用。向量可縮短，針對 768 與 1536 維最佳化。
- **用在**：Q4 把「只用聲音」列為一組；現況查證的影片取樣方式。
- **限制**：MSEB 的方向是「口說問題 → 文字段落」，本專題是「文字問題 → 聲音片段」，報告**沒有**測這個方向；報告未說明有哪些口說語言，沒有提到中文。這是廠商自己的報告。

### R9：Omni-Embed-Nemotron（文字、圖片、聲音、影片的統一檢索模型）

- **書目**：M. Xu, W. Zhou, Y. Babakhin, G. Moreira, R. Ak, R. Osmulski, B. Liu, E. Oldridge, B. Schifferer（NVIDIA）. "Omni-Embed-Nemotron: A Unified Multimodal Retrieval Model for Text, Image, Audio, and Video." 2025-10-03 預印本。[arXiv:2510.03458](https://arxiv.org/abs/2510.03458)
- **查證範圍**：讀 HTML 全文的編碼方式與影片檢索結果表。
- **重點**：聲音與畫面**分開編碼**後再合併（late fusion），並與「混在一起編成一個向量」（early fusion）比較。nDCG@10：
  - LPM（有投影片與講者的錄製講課）：文字（逐字稿＋投影片 OCR）0.8636、只用聲音 0.8238、只用畫面 0.7365、聲音畫面混成一個 0.8373、分開再合併 0.8465。作者指出講課類內容以文字為主。
  - FineVideo（一般影片）：文字 0.6082、聲音 0.5407、畫面 0.4488、混成一個 0.4700、分開再合併 0.5662。
- **用在**：Q4 預期（講課影片上聲音接近文字、畫面最低）、Q5 聲音與畫面各存一個向量、Q6 投影片 OCR 的價值。
- **限制**：LPM 的逐字稿來自 Google 語音辨識、語言是英文；論文沒有測「文字＋聲音」合併。授權 CC BY-NC-ND（非商用）。

### R10：MAGMaR 2026 共同任務（影片檢索與依影片寫報導）

- **書目**：A. Martin, D. Zhang, J. Brogan, F. Ferraro, J. Gwinnup, R. Kriz, T. Long, K. Murray, A. Yates, X. Xiang. "Findings of the MAGMaR 2026 Shared Task." 2026-06-10 預印本（ACL 2026 MAGMaR 研討會）。[arXiv:2606.12295](https://arxiv.org/abs/2606.12295)；參賽系統 [MARQUIS](https://arxiv.org/abs/2605.17640)、[C2F-RAG](https://arxiv.org/abs/2606.07924)
- **查證範圍**：讀總結論文 HTML 的檢索任務段落；兩篇參賽系統只讀摘要。
- **重點**：檢索語料超過 11 萬支多語言事件影片（含中文）。最好的系統（nDCG@10 0.848）把影片轉成文字代理（整支摘要、關鍵格說明）建索引，再用大型語言模型重新排序；第二名（0.759）把問題拆成小問題分別檢索、合併排名再重新排序，主辦方指出它的提升主要來自問題拆解與重新排序，而不是合併方式。
- **用在**：說明「合併排名」之外，業界最新做法的提升多來自重新排序；本專題列為之後的工作，不在這次範圍。
- **限制**：新聞事件影片、以整支影片為檢索單位；論文沒有分模態的消融實驗。

### R11：NLPCC 2026 醫療教學影片理解評測

- **書目**：S. Liu, K. Li, M. Zhao, Y. Tian, B. Li. "Overview of the NLPCC 2026 Shared Task 1: Difficulty-Aware Multilingual and Multimodal Medical Instructional Video Understanding Evaluation." 2026-07 預印本。[arXiv:2607.06618](https://arxiv.org/abs/2607.06618)
- **查證範圍**：只讀摘要。
- **重點**：教學影片的問題依難度標註；主辦方的分法是簡單題多半能靠字幕回答，困難題需要畫面、步驟理解與跨模態整合。任務包含在單支影片與整個影片庫中找出答案的時間段。
- **用在**：Q3 依題型分開列結果。
- **限制**：這是主辦方的題目設計框架，摘要沒有實驗數字；醫療教學影片，不是講課。

### R12：資訊檢索評測的顯著性檢定比較

- **書目**：M. D. Smucker, J. Allan, B. Carterette. "A Comparison of Statistical Significance Tests for Information Retrieval Evaluation." *CIKM 2007*；同作者 "Agreement Among Statistical Significance Tests for Information Retrieval Evaluation at Varying Sample Sizes." *SIGIR 2009*。[CIKM 2007](https://ir.webis.de/anthology/2007.cikm_conference-2007.67)、[SIGIR 2009](https://ir.webis.de/anthology/2009.sigirconf_conference-2009.82)
- **查證範圍**：只讀摘要與第三方摘要。
- **重點**：比較配對 t 檢定、Wilcoxon、符號檢定、bootstrap 與隨機化檢定在 TREC 資料上的一致程度；題目數變少時，隨機化檢定與 t 檢定較一致，bootstrap 的 p 值偏小，一般建議用隨機化檢定。
- **用在**：Q7 報告配對隨機化檢定的 p 值。
- **限制**：資料是 TREC 文字檢索，題數 50 以下的結論來自第三方摘要；引用具體數字前應讀全文。

### R13：以大型語言模型當評審

- **書目**：L. Zheng, W.-L. Chiang, Y. Sheng, et al. "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena." *NeurIPS 2023 Datasets and Benchmarks*。[arXiv:2306.05685](https://arxiv.org/abs/2306.05685)
- **查證範圍**：只讀摘要與搜尋摘錄。
- **重點**：強模型（GPT-4）當評審時，與人類評分的一致率超過 80%，與人類彼此之間的一致率相當；同時指出評審模型有偏好自己產生答案的傾向（self-enhancement bias），以及位置、冗長等偏差。
- **用在**：Q17 改用雙模型評分、避開產生回答的 Gemini、以 80% 一致率為門檻。
- **限制**：評的是英文對話題，不是附來源的課程問答；具體數字引用前應讀全文。

## 業界與官方文件

| 編號 | 文件 | 取用內容 | 用在 |
|---|---|---|---|
| D1 | [Gemini API：Embeddings](https://ai.google.dev/gemini-api/docs/embeddings) | `gemini-embedding-2` 支援文字、圖片、影片、聲音、PDF；聲音每次 ≤180 秒、影片 ≤120 秒且不處理影片內聲音；維度 128～3072；同一 `contents` 多段會合併成一個向量；文字用前綴區分查詢與文件 | 現況查證、Q5 |
| D2 | [Gemini API：價格](https://ai.google.dev/gemini-api/docs/pricing) | 付費層文字 US$0.20、聲音 US$6.50（每秒 US$0.00016）、影片 US$12.00（每格 US$0.00079）每百萬 token；Batch 半價 | Q2、Q4 費用估算 |
| D3 | [Vertex AI：Gemini Embedding 2](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/embedding-2) | 聲音每秒 25 token、上下文 8,192 token | 現況查證 |
| D4 | [Vertex AI：多模態向量 API（舊版 `multimodalembedding`）](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/multimodal-embeddings-api) | 影片預設每 16 秒一段、最短 4 秒；超過 min(影片長度, 120 秒) 品質下降；1408 維 | Q5 切段長度 |
| D5 | [Amazon Bedrock：TwelveLabs Marengo 2.7](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-marengo.html)、[Marengo 3.0](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-marengo-3.html) | 影片預設依鏡頭切換切段，可改固定 2～10 秒、最短片段預設 4 秒；同一支影片分別產生畫面與聲音向量（3.0 另有逐字稿） | Q5、聲音與畫面分開存 |
| D6 | Twelve Labs 影片向量文件 | 預設每 6 秒一個向量、可設 2～10 秒（**據搜尋摘要，未直接開啟原頁**） | Q5 |
| D7 | [Elasticsearch：Reciprocal rank fusion](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion) | `rank_constant` 預設 60、須 ≥1 | Q3 |
| D8 | [MongoDB：免費與 Flex 叢集的搜尋限制](https://www.mongodb.com/docs/atlas/atlas-search/shared-tier-limitations/)、[免費叢集限制](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)、[向量索引欄位](https://www.mongodb.com/docs/vector-search/indexes/vector-search-type/) | 免費叢集不分種類最多 3 個搜尋索引、Flex 10 個；免費叢集資料上限 0.5 GB、MongoDB 8.0；一個向量索引可以有多個 `vector` 欄位、維度上限 8192 | Q9 |
| D9 | [MongoDB：updateSearchIndex](https://www.mongodb.com/docs/manual/reference/command/updateSearchIndex/) | 修改索引定義後會重建；重建期間舊定義仍可查詢，完成後自動替換；要查 `queryable` 欄位確認新定義可用 | Q9 |
| D10 | [MongoDB：BSON 向量（BinData）](https://www.mongodb.com/docs/atlas/atlas-vector-search/create-bson-vectors/) | BinData float32 向量比一般 float32 陣列約省三分之二的磁碟空間 | Q9 容量備案 |
| D11 | [LlamaIndex：AutoMergingRetriever](https://developers.llamaindex.ai/python/framework/integrations/retrievers/auto_merging_retriever/)、[API 參考](https://docs.llamaindex.ai/en/latest/api_reference/retrievers/auto_merging/) | 先檢索小片段，同一 Parent 的子片段命中比例超過門檻（`simple_ratio_thresh` 預設 0.5）才合併成 Parent | Q12 |

## 查過但未採用

- **OmniRet（Huynh et al., CVPR 2026，[arXiv:2603.02098](https://arxiv.org/abs/2603.02098)）**：可處理文字、畫面、聲音組合查詢的檢索模型，並提出聲音為主的評測集；需自行訓練模型，與本專題用現成 Gemini 向量不同，只讀摘要。
- **Ovis-Embedding（2026-09，[arXiv:2609.25165](https://arxiv.org/abs/2609.25165)）**：最新的全模態向量模型，自稱在多個評測集最佳；摘要沒有數字、沒有與 Gemini Embedding 2 比較、授權未知，暫不引用。
- **VideoRAG（Ren et al., 2025，[arXiv:2502.01549](https://arxiv.org/abs/2502.01549)）**：與 R2 同名的另一篇，處理極長影片並含講課類影片；本輪只看到搜尋摘要，未讀內容，不引用。
- **CFVBench（[arXiv:2510.09266](https://arxiv.org/abs/2510.09266)）**：細粒度影片檢索增強生成的評測集；只看到參考文獻列表，未確認是否含講課影片，不引用。
- **第三方部落格的 Gemini Embedding 2 切段建議**（15～30 秒）：來源非官方，且部分內容與官方文件矛盾（例：把舊版實驗模型名稱當成 Embedding 2），只在 decisions 當作參考範圍提到，不當依據。
