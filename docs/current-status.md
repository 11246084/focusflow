# FocusFlow 目前狀態

## 2026-11-21 短影片產生上限、數位分身通知與 AI 標示（未部署）

依[短影片決策 UX-28](04_Features/Short_Video/decisions.md)與 [recut 決策第 99 項](04_Features/Short_Video/recut-design-decisions.md)：

- **原片剪輯**：初次產生講稿的 Gemini 呼叫上限預設由 8 次改為 30 次（`RECUT_INITIAL_CALL_LIMIT`，修改仍為 5 次），因應佈展大量試用。
- **數位分身**：教授只收腳本，系統不串接教授的電腦。每支短片最多產生 10 版腳本（`SHORT_SCRIPT_MAX_VERSIONS`，超過回 409 `SHORT_SCRIPT_VERSION_LIMIT_EXCEEDED`）。傳回的影片在 YouTube 處理完成時通知建立腳本的教師（新通知來源 `short_asset_ready`）；原本畫面寫「完成會通知你」但沒有通知。

**正式站設定（2026-11-21，使用者在 VM 執行）**：`/opt/focusflow/backend/.env` 新增 `RECUT_INITIAL_CALL_LIMIT=30`（原本沒有這行，正式站一直用預設 8 次；備份 `.env.bak-20261121`），重啟 `focusflow-backend` 後 `/health` 的 `runtime.recut` 為 `ready: true`、無缺項。

**未執行**：程式部署、正式站以實際上傳的數位分身影片壓標示、正式站產片與真實 YouTube 上傳。

## 2026-11-20 短影音 A1 實測

短影音修正已部署。[GitHub Actions 部署紀錄](https://github.com/11246084/focusflow/actions/runs/44637458048)

| 教師題目 | 驗收結果 |
|---|---|
| 4090 顯示卡的記憶體大小是多少？ | 教師從正式站製作失敗頁重新產生講稿。比對新版與原版，來源影片相同且原話逐字相符。新版 MP4 一次渲染成功，52.23 秒、720 × 1280、30 fps，最長靜音由 3.08 秒降至 1.35 秒。教師已可進入成品審核，成品維持草稿待審。 |
| 摩爾定律、珍珠奶茶點餐 | 正式站各產出一份講稿，用本機同名課程原片分別渲染出 55.77 秒、51.10 秒的 MP4，兩支均通過音畫檢查。 |
| RAG 是什麼？ | 六份曾失敗的真實模型回覆都通過新版字幕驗證。正式站重新產生時遇到 Gemini 限流，這次沒有新講稿。 |
| OpenCV 跟 YOLO 的差異？ | 用教師管理的另一門課實測，正式站找不到該題對應的原片，未能剪製。 |

地理與音樂逐字稿的回歸測試使用模擬模型回覆與實際施工單驗證器，確認字幕能依當堂原話修復錯誤錨點並恢復播放順序。

## 2026-11-19 決評實測修正

修正 `15198912` 已合併至 `main`（`1e969965`）。[Deploy to VM](https://github.com/11246084/focusflow/actions/runs/44518815652) 完成前端建置、服務重啟及後端／反向代理就緒檢查。正式站首頁、教師登入和課程管理頁實測通過。

AI 入門課的顯示卡短片曾因辨識把型號和價格連寫而連續三次退回字幕。以當時三份輸出重播都通過。部署後用教師帳號重試同一支腳本，任務 `6afee3c9bbf9c9496f0361de` 成功產生 **55.41 秒**的講稿，版本 `6afee416bbf9c9496f036439` 已進入教師審稿。這次驗收到講稿，MP4 渲染、上架與播放仍待驗收。其他課程的原片缺檔與來源段落不足需個別處理。詳見[決評 demo 實測](10_Operations/2026-11-19_決評demo實測.md)。

## 2026-11-19 正式站 Gemini 恢復

Weihao 在 VM 執行 `npm run --silent diagnose:gemini -- --probe`：模型 `gemini-3.5-flash`，查詢模型資訊與極小生成請求都回 HTTP 200（OK）。先前的每月花費上限問題已解除，正式站可以產生回答。查詢向量（`gemini-embedding-2`）這次沒有另外測試；學生實際提問會同時用到兩者，要以正式站提問一題確認。

## 2026-11-17 多模態診斷成果Git保存

本輪只整理既有成果供暫時切換工作：確認本機dev與origin/dev同為 `3e62f27ae9804d12f89655baebb6a25db72f2055`，保留七份未提交異動。將先前已完成的真實評測與離線診斷，以欄位白名單整理為[可分享研究快照](04_Features/Multimodal_Retrieval/evidence/2026-11-17_multimodal-quality-diagnosis.md)及[結構化數據](04_Features/Multimodal_Retrieval/evidence/2026-11-17_multimodal-quality-diagnosis.json)，並登記索引、接手與AI使用紀錄；原始診斷檔及原24組結果不覆寫。快照保留指標、名次／分數與52份來源SHA-256，不含向量、影音、截圖、逐字稿、完整ledger／Checkpoint、憑證或連線資訊。

提交範圍只含確認安全的文件，訊息為 `docs: preserve multimodal retrieval diagnosis 2026-11-17`；前輪 `STT_Whisper/src/evaluation_embedding_batch.py` 與對應測試的兩份未提交修改留在本機，不納入此文件commit。未新增實驗、Gemini／Atlas呼叫、向量或正式程式修改；本輪驗證僅檔案保存指紋、快照數據一致性、連結、敏感資料與staged diff／git diff --check。實際提交與遠端同步結果以Git紀錄為準。

下次從品質審查、未定案候選A與獨立盲測設計接續；不重做已完成Embedding與原24組評測。跨機先安全交接私有原檔，不能把Git摘要當完整重算資料或把新增inspect能力當成已發布。詳見[HANDOFF](04_Features/Multimodal_Retrieval/HANDOFF.md)。

## 2026-11-17 多模態排名品質離線診斷完成

fetch與GitHub `ls-remote`確認最新dev仍為 `3e62f27ae9804d12f89655baebb6a25db72f2055`，保留原七份未提交異動。只分析 `.local-tools/gold-atlas-evaluation-20261117/` 的真實report／metrics／per-question／config／各路排名及獨立核驗紀錄，另讀原Leaf／Query向量診斷指定Chunk全庫名次、抽查原切片；沒有重新執行Atlas檢索、Gemini或候選參數實驗。原24組與所有原始評測檔案前後hash相同。

**主要可重現瓶頸是多路重合加票與精準語義／時間定位脫節，本批未發現可解釋退步的RRF實作缺陷。** RRF只看名次：單路第1名貢獻1／61＝0.016393，兩路各第20名已合計0.025；多路支持不等於彼此獨立、直接支持問題的多份證據。Gold時間外的候選可能仍在談斷詞／CKIP等相關概念，不能一概稱為完全語意錯誤。

| 指定來源 | 文字全庫名次 | 聲音全庫名次 | 畫面全庫名次 | 三路Flat等權／2:1:1名次 |
|---|---|---|---|---|
| D04／V6 chunk_0050，723.72–739.02秒 | 4 | 2 | 29（Top20外） | 4／6 |
| D05／V6 chunk_0071，1054.84–1070.98秒 | 2 | 49（Top20外） | 34（Top20外） | 16／12 |

**D04：**0050等權貢獻為文字0.015625＋聲音0.016129＋畫面0＝0.031754；2:1:1為0.031250＋0.016129＝0.047379，分數增加卻名次下降。0061（893.49–912.21秒、CKIP）與0076（1127.92–1141秒、停用詞）都獲三路支持，0054（英文空格斷詞）等文字前段候選也被加權；相對票數使0050落出Top5，不是去重或計算錯誤。分層時指定0050文字在第11名（第四名Parent的第二個child），三路等權／加權為第6／7；同Gold時間內其他片段可更早命中，因此「第一Gold名次」不等於指定Chunk名次。

**D05：**指定0071僅由文字支持，等權為1／62＝0.016129，2:1:1為2／62＝0.032258。0050／0051等斷詞片段由多路共同支持，排在詞幹片段前；0071等權第16、加權第12。聲音Top20沒有任何Gold，畫面有另一筆Gold在第15名；不能誤稱畫面Top20完全沒有Gold。指定片段已由文字進入融合聯集，不是整體候選遺失；在影音路徑落出Top20的名次也由全庫exact重算確認，不是本批Atlas ANN漏掉了本應在Top20的指定向量。尚無受控聽辨證據可將聲音低名次定因為錄音、發音或encoder，僅能確認此題的音訊檢索特異性不足。

**畫面抽查：**核對8個原生media SHA-256後取中點，兩個指定正確片段與多個競爭片段皆顯示同一張投影片18「Step1.資料預處理」，同時列出Tokenization、Stemming及停用詞。D05畫面有正確「詞幹處理(Stemming)、goes→go」，字稿卻是「磁幹處理」且未保留完整投影片定義。這證明存在字稿外畫面資訊，但靜態頁橫跨多個講述片段，視覺可能找對主題而定位不到老師當下所講的細項；不能直接把Gold外的畫面判成語意完全不符。僅抽查8個中點，未逐格看全片，也未做紅筆／講者小窗消融，不外推全體畫面或宣稱底層encoder成因已確診。

**42題整體貢獻（皆對stableText Flat）：**

| 加入通道／權重 | Recall@5改善／不變／退步 | MRR升／平／降 | Recall退步題 |
|---|---|---|---|
| 文字＋聲音等權 | 0／41／1 | 3／34／5 | D05 |
| 文字＋聲音2:1:1 | 0／41／1 | 2／36／4 | D05 |
| 文字＋畫面等權 | 0／38／4 | 1／25／16 | F11、M11、D04、D05 |
| 文字＋畫面2:1:1 | 0／38／4 | 1／29／12 | F11、M11、D04、D05 |
| 三路等權 | 0／41／1 | 2／30／10 | D05 |
| 三路2:1:1 | 0／40／2 | 2／29／11 | D04、D05 |

Top20平均重疊：文字／聲音11.86個（交集／20＝59.29%，平均Jaccard 43.26%）；文字／畫面3.26個（16.31%，9.39%）；聲音／畫面2.90個（14.52%，8.33%）。畫面Top5命中18／42、Top20命中26／42。17題的畫面Top20找到文字Top20沒有的另一個Gold Chunk，但文字已42題全中，這不是補回17題，也不足以證明找回了17個字稿缺失事實。

**分層文字＋聲音的MRR：**等權0.906926→0.950397，6升／34平／2降，Recall命中集合不變；2:1:1為6升／35平／1降，最終同為0.950397。等權改善F05、F15、M01、X04、T02各2→1，D05由11→6；退步D04由2→4、F12由1→2。影音候選完全不變，Parent改變文字候選與其展開順序，有時提升正確片段、有時移除舊競爭片段的文字票；X04正確片段兩路名次未變仍2→1，顯示競爭者改變也有作用。D05仍未進Top5，因此較高平均MRR不是全面改善或LLM答案品質證明。對stableText Flat則為3升／37平／2降，MRR差+0.019841。

**題庫驗證邊界：**README明記原題／Gold出自逐字稿；42題沒有視覺必要／ASR受損標籤，題文掃描亦無明確畫面指示詞，但不能單憑掃描斷言每題都不需視覺。口語錯字子集5題的文字Recall@5＝5／5、MRR＝1.0，三路等權仍5／5、MRR＝0.766667；口語錯字並非受控ASR對照。現題庫適合作回歸與時間定位，不足以單獨驗證視覺補洞或ASR韌性。QA Bridge仍只載入同Chunk逐字稿，未將畫面定義／OCR交給回答器，故畫面檢索與真正能回答字稿缺失資訊必須分開驗證。

**已執行驗證及保存：**Node 22.23.4以實際RRF函式重算1,200列、檢查所有通道Top20／來源範圍；通道內重複0、範圍錯誤0。唯讀負向控制通過：同路重複只計一次、跨路合法累加、衝突證據拒絕、k＝60／權重及未授權來源過濾。Python離線分析保存42題增退清單、逐題重疊率、完整競爭片段分數／原文、Parent變化及指定Chunk全庫名次。完整私有診斷在 `.local-tools/gold-quality-diagnosis-20261117/diagnosis.html`，各JSON、`visual-contact-sheet.png`與8張原生中點PNG可重查。原正式結果完全未覆寫；ledger仍2,371 calls／US$11.01956508。

**下一步建議：**最多三項候選及六項說明見[決策](04_Features/Multimodal_Retrieval/decisions.md#2026-11-17-正式評測後的品質診斷與待選方案)：優先A，另建離線query–evidence重排序候選；B是投影片時段感知的視覺訊號；C是獨立視覺／ASR盲測資料。皆未定案或實作。先鎖定未參與診斷的新盲測，原42題只作已看過的回歸，不把D04／D05叫holdout。原Gold／RRF／QA不改，正式整合與任何新付費需另授權。

未執行新Atlas查詢、Gemini、Embedding、候選參數實驗、正式程式修改、部署、VM E2E或無關全套回歸；本輪診斷只讀本機，沒有外部服務／旗標變更。新增唯讀診斷稿不作正式24組成效；文件連結與git diff --check通過，未stage／commit／push。

## 2026-11-17 真實 Gold 排名與 Atlas 唯讀評測完成

fetch／GitHub `ls-remote` 確認 dev 新增四筆儀表板文件，與原七份未提交異動不重疊，ff-only 安全同步至 `3e62f27ae9804d12f89655baebb6a25db72f2055`，原修改與私有成果保留。沿用 Node 22.23.4、既有 collector／Atlas Adapter／RRF／兩套評分工具，不修改功能或評測程式；私有執行稿只組合既有函式並保存證據。新授權及實驗邊界見[決策](04_Features/Multimodal_Retrieval/decisions.md#2026-11-17-真實-gold-排名與-atlas-唯讀評測授權)。

**完成真實 Atlas Flat 12組＋Atlas Leaf／本機 Parent Hierarchical 12組，共50題×24＝1,200列；另完成 MA 契約的真實 exact memory 24組。** 每次都是42題計分、7題拒答、X01另列，未用 Fake、Mock 或空排名。Atlas 對每題執行 stableText／audio／visual／舊 embedding 四次搜尋，共200次 `$vectorSearch`；candidate=100、每路Top20、RRF k=60及1:1:1／2:1:1固定。Hierarchical 的Parent是本機233筆真實text_v2、exact Top5，沿用展開上限30、15段／5000字，只替換文字一路，部分文字組少於20筆是契約上限，不補假排名。Atlas Parent當次實查只有3筆舊text_v1，完全未用，未發布任何Parent。

**以下每格為 Recall@5／MRR，計分題數均42。Atlas混合實驗與exact實驗的1,200列排名完全相同，24組指標逐項一致；仍分開保存設定與來源，不能推論未來所有ANN與exact必然一致。**

| 模態 | Flat等權 | Flat文字加權 | Hierarchical等權 | Hierarchical文字加權 |
|---|---|---|---|---|
| text | 100%／0.930556 | 100%／0.930556 | 100%／0.789683 | 100%／0.789683 |
| audio | 97.62%／0.896825 | 97.62%／0.896825 | 97.62%／0.896825 | 97.62%／0.896825 |
| visual | 42.86%／0.347421 | 42.86%／0.347421 | 42.86%／0.347421 | 42.86%／0.347421 |
| text_audio | 97.62%／0.906926 | 97.62%／0.901190 | 97.62%／0.950397 | 97.62%／0.950397 |
| text_visual | 90.48%／0.729034 | 90.48%／0.780650 | 88.10%／0.726077 | 97.62%／0.786735 |
| all | 97.62%／0.825694 | 95.24%／0.824206 | 95.24%／0.887302 | 95.24%／0.899802 |

保存的**原文字向量基準**為41／42、Recall@5 97.62%、MRR 0.867920；stableText Flat為42／42、MRR 0.930556。原文字基準以同一stable Query查舊preview文件向量，屬版本遷移比較，不能假稱重現歷史preview Query全流程，也不能把差異全部歸因模態。純模態比較另對照stableText：其Recall已滿分，三路融合沒有新增找回空間，但仍有退步。

| 三路融合 | 對原文字基準：新增／退步 | 對stableText Flat：新增／退步 |
|---|---|---|
| Flat等權 | 0／0 | 0／1（D05） |
| Flat文字加權 | 0／1（D04） | 0／2（D04、D05） |
| Hierarchical等權 | 0／1（D04） | 0／2（D04、D05） |
| Hierarchical文字加權 | 0／1（D04） | 0／2（D04、D05） |

**逐題退步證據：**D04「什麼是斷詞斷句？為什麼要做？」Gold為V6 708–768秒；stableText第一筆Gold是chunk_0050、723.72–739.02秒、第4名，Flat等權仍第4名，文字加權退至第6名；Hierarchical兩權重均第6名。D05「什麼是詞幹處理？」Gold為V6 1024–1097秒；stableText第一筆Gold是chunk_0071、1054.84–1070.98秒、第2名，Flat等權退至第16名、文字加權第12名，Hierarchical為第10／8名。D05聲音Top20無Gold、畫面第一筆Gold第15名；最前文字命中只由文字支持，被多路共同出現的其他片段擠壓。D04多路共同出現的非Gold候選也排在正確片段前方。逐題保存原題、Gold範圍、原文、全部排名／時間／來源通道名次／RRF貢獻；這些觀察不能替代完整LLM語義品質審查。

**已執行核驗：**檢索前後逐筆比較真實Atlas六片694文件的原文／身份／原時間、原embedding與2,078 Leaf、metadata／簽章／digest及六支影片課程關係，皆符合凍結來源。50 Query、233 Parent的bundle／原生Checkpoint校驗值一致；原索引ID、version 4、定義hash與三個READY／QUERYABLE節點未變。`auditMultimodalOffline.js`呼叫`verifyMultimodalAudit.js`獨立重算；另以不匯入既有scorer的Python核驗每次1,200列RRF、24組Recall@5／10／MRR、72組基準增退比較，逐項一致。七題拒答的檢索分數另存，沒有LLM拒答判定。

私有證據在 `.local-tools/gold-atlas-evaluation-20261117/`：`report.html`供人閱讀；`raw-atlas-rankings.json`、50份逐題讀回、`source-validation.json`、索引前像與`completion.json`保存Atlas來源；`atlas-local-parent/`與`exact-memory/`各含per-question／config／report／legacy-baseline／changes／change-evidence／independent-cli-report。前者另存逐組retrievedBy、channelRanks、channelScores與RRF貢獻。`metrics.csv`列出兩實驗48組完整精度指標；`independent-verification.json`與`artifact-checksums.json`可供獨立查核。原向量、私有備份、ledger及歷史證據不隨Git傳遞。

**結論與下一步：**數字核驗通過，但三路融合未顯示Recall改善，且相較stableText退步；不能宣稱「沒有變差」或品質驗收通過，不因結果而改Gold／權重／旗標。Parent發布不是本次評測的阻塞；正式VM如需Atlas Hierarchical，仍需獨立發布授權與備份／CAS計畫。本機資料可供下一階段真實LLM抽查，但模型費用、VM版本／provider／旗標／nginx串流與真實帳號權限等仍需另授權及實機驗收；X01仍缺V5人工時間，候選及核准流程維持原決策。

本輪Gemini／付費Embedding呼叫0、Atlas寫入／index變更0、Parent發布0；監測到的命令僅find／aggregate／getMore。共用ledger仍2,371 calls／US$11.01956508，SHA-256 `7b09cbc1dcc60928ec05b06e3c8295450bd4f630a0b04e9d2c68ba91d0584ca8`未變。未執行LLM回答品質、正式VM E2E、部署／旗標變更或無關前端／QA回歸，因本輪只做檢索評測、未改功能程式；工具保留`formalEvaluation=false`／`qualityClaim=false`外部簽核保護，並非使用Fake向量。文件連結及git diff --check通過，未stage／commit／push。

## 2026-11-17 正式 Gold Query／Parent Embedding 完成

依使用者本輪明確授權，沿用 `.local-tools/gold-preflight-20261117/next-batch-plan.json` 及既有 `evaluation_embedding_batch.py`，沒有重做 Preflight、修改評測工具或重跑已通過的離線測試。fetch 與 GitHub `ls-remote` 確認最新 dev 仍為 `b3a3a90c181fcc790f4926b4ee4a1fb8b5d9b508`，保留前輪七份未提交異動；開始前比對原 2,130 份保護檔案、283 筆輸入簽章、兩份核准 plan hash 與 ledger，皆未異常，無遺留鎖。

**50／50 個正式 Gold Query、233／233 個 text_v2 Parent 全部成功，新增 283 次請求、零重試。** 先完成五題 Query，再完成其餘 Query，最後執行 Parent，共 30 批，每批最多十個新輸入、單一並行、每次新請求後至少等待兩秒；保存的輸入建立時間最小間隔 3.048418 秒。沿用 backend 私有憑證、gemini-embedding-2／3072 維、Developer API v1beta 及共用 ledger／原生 Checkpoint，SDK attempts=1。沒有 429、逾時、未知計費、簽章異常或失敗；每批成功後讀回核驗，未重送已成功輸入。

**最終共用 ledger：2,371 calls／US$11.01956508 保守預留。** 相較執行前 2,088 calls／US$10.55589788，新增 US$0.46366720，低於 US$20 硬上限；每次請求前先預留，並非實際帳單。ledger SHA-256 `7b09cbc1dcc60928ec05b06e3c8295450bd4f630a0b04e9d2c68ba91d0584ca8`。原 attemptsBySignature 歷史完整保留，283 個新簽章均為一次嘗試；除獲准累計的 ledger 外，原 2,129 份 Checkpoint／六片 bundle／V6 JSON 稽核與備份雜湊完全一致，原 2,078 個 Leaf 未重建或改寫。

**已執行完成後核驗：**獨立禁止網路的讀回逐筆比對原 plan／bank 原文、六份凍結來源 SHA-256、Query 前綴／Parent 原文與固定三 Leaf 組成、來源身份／原時間、text_v2 完整契約、3072 維有限值／unit norm、原生簽章、Checkpoint JSON digest 與 bundle 二進位向量 digest，全部通過。X01 僅產生原題 Query；Gold 原檔未改，V5 人工時間仍待核定。所有批次鎖均已釋放，成功 Checkpoint 保存在原 `.local-tools/gemini-small-sample/gemini/checkpoints/`。

完整真實 bundle 為 `.local-tools/gold-preflight-20261117/query/bundle.json`（50 筆，SHA-256 `c40c834d19406da89886c8302f2061a01b546da0668328e0d1d6a0bac0224e6f`）與 `parent/bundle.json`（233 筆，`4d185ce9147a48c38e668d1b498eb7f9d060a22734573b864b59059b428b7f1d`）。同目錄 `authorized-execution/` 保存當次 authorization、ledger 前後像、30 批 Checkpoint 稽核／進度、完成 summary 與逐筆 verification；前輪盤點及 Fake／合成紀錄保留，不混作真實結果。

**正式排名的資料條件已齊備，成效尚未驗收。** 可沿用保存的 694 Chunk manifest、六片 Leaf、原文字基準及上述真實 Query／Parent bundle，在 memory 模式執行 24 組排名，不需先發布 Parent 到 Atlas。下一輪仍須另行授權正式排名與獨立評分；X01 核定前維持 42 題計分、7 題拒答、X01 另列。當次未連線或修改 Atlas、未發布 Parent、未跑正式排名／LLM 品質驗收、未部署或更動功能旗標；未跑前端／QA／短影片回歸，因本輪未改功能程式。文件連結及 git diff --check 通過，未 stage／commit／push。操作邊界見[決策](04_Features/Multimodal_Retrieval/decisions.md#2026-11-17-正式-queryparent-embedding-執行授權)。

## 2026-11-17 正式 Gold 輸入盤點與離線執行準備

基準為 `dev`／`origin/dev` `b3a3a90c181fcc790f4926b4ee4a1fb8b5d9b508`，開始時工作樹乾淨。本輪僅離線盤點、評測工具必要修正與測試；沒有 Gemini 請求、Atlas 連線／修改、真實 Gold 排名、部署、旗標變更或 Leaf 重建。

**正式可重用 Query 0／50，缺 50；Parent 0／233，缺 233，兩者均無歷史失敗簽章阻塞。** 逐題核對原始 ID／文字、query 前綴／text_v2、原生輸入簽章與共用 ledger／Checkpoint；掃描本機其他同簽章及無身份舊快取，沒有相符正式輸入。保存的三題探索 Query 原文不符 Gold，未計入。V6 舊 Parent 有 47 筆 preview 與 47 筆 stable 舊產物；後者仍是 `gemini_embedding_2_text_v1`／`text_search_generation_v1`，不同於本輪 text_v2，兩版均保留、均不計為可重用。

固定三 Leaf、零重疊 Parent 共 233 筆：V1～V6 分別 39／41／28／48／30／47，尾組容許不足三筆；原文用換行串接，時間取第一個 Leaf 起點與最後一個終點。六份凍結來源 SHA-256 符合 corpus，694 筆 Chunk 的原文／身份／時間及原文字向量核對通過；六片 bundle 的 2,078 個向量與原生 Checkpoint／digest 相符。42 題 Gold 都有可計分 Chunk，缺口只剩 X01 的 V5 人工時間；7 題拒答與 X01 另列，不改題庫。

**執行準備已落盤：**`.local-tools/gold-preflight-20261117/` 保存兩份 plan、逐筆 cache-inventory、manifest、original-text、六份 Leaf bundle 路徑、gold-chunk-map、舊 Parent／探索 Query 診斷、X01 原題及逐字稿候選、Fake 預演與測試證據。Query plan SHA-256 `5a54e3e24e9e41975a40c80cc3f58b840c1329ac7346899d921b29c39969f1b7`；Parent plan SHA-256 `4a17fae596fd68cb8575810c1cd731794323ce56b957a69a3fc785986ca3ec08`。這些是資料指紋，並非付費授權。X01 待確認問題及建議先看片段見[決策](04_Features/Multimodal_Retrieval/decisions.md#2026-11-17-正式-gold-執行準備邊界)。

**修正及已執行驗證：**評測批次工具明確使用 UTF-8 讀中文計畫／state，新增不初始化 provider 的 `inspect`，付費前與匯出前先核對全部所選快取的完整契約／身份／簽章／向量 digest。Node 22.23.4 下評測相關 12 項測試通過；既有 Python 3.11.9 venv 下 Evaluation Batch 11、Adapter 10、Corpus Batch 9、Video1 Batch 5，共 35 項通過，socket／DNS 阻擋、網路嘗試 0。50 Query／233 Parent 的 Fake 首次執行與零新增重播通過；以凍結 694 身份、合成向量跑完整 1,200 列、六組×兩權重×flat／hierarchical、Top20 上限、原文字基準分列及兩套獨立 Recall@5／10／MRR 核對通過。結果均標記 synthetic／formalEvaluation=false／qualityClaim=false，不能視為真實檢索成效。檔案連結與 git diff --check 通過。

**成本與保存：**當次真實 ledger 仍 2,088 calls／US$10.55589788，2,130 份原 ledger／原生 Checkpoint／六片 bundle／V6 JSON 證據的前後 SHA-256 相同。缺 283 筆首次輸入，依既有每筆 US$0.00163840 保守預留及逐次進位，新增 US$0.46366720，投影 2,371 calls／US$11.01956508，低於 US$20 硬上限；不是帳單或新授權。實際 API 配額／帳務、Atlas／VM 現況及 LLM 答案品質本輪未查證。

**下一輪：**另授權上述兩份 plan 的 50 Query＋233 Parent 首次付費輸入；先五題 Query，再每批至多 10 個新輸入，單一並行、每次新請求後等待 2 秒、每批核驗。任何 429／逾時／未知費用／契約或來源改變／成功快取異常／鎖衝突／預算阻擋立即停止，不重送。Embedding 完成後離線匯出完整 bundle；正式排名、Parent 發布、Atlas 與部署須另列授權。步驟見[批次工具](04_Features/Multimodal_Retrieval/remaining-videos-tools.md#執行前盤點與分批方式)。未跑前端／QA／短影片／VM 回歸，因本輪未改這些功能；沒有 stage／commit／push。

## 2026-11-17 對話功能第一批（W1～W5）與短影片頁重整上線

Weihao 授權合併 `dev` 到 `main`（`fbb7137`，Deploy to VM #164 成功）。部署流程的後端與代理健康檢查通過；「Verify production Atlas QA once」與其後的診斷步驟這次被略過，沒有對正式站實際提問。VM 上的版本尚未由人工核對。

- 上線內容：對話功能的複製回答、多行輸入、進度提示與中斷恢復、「這段在講什麼」及三輪修正（見[開發接手說明](04_Features/QA_Conversation/HANDOFF.md)）；短影片製作與管理頁重整、全站下拉選單樣式（`b41ca5d`，決策 UX-25）；多模態批次工具修正與六支影片寫入紀錄。兩題固定建議題的程式已上線但開關關閉。
- 合併前驗證（Node.js 22.23.4）：後端全套 2,001 項中 2,000 項通過、1 項略過、0 項失敗（在 `b41ca5d`、`530896b` 進來之前執行，兩筆都沒有改後端程式）；前端 251 項、lint、build 通過；以模擬 API 在瀏覽器實測對話欄七種情況與短影片兩頁。
- 未驗證：正式站 nginx 下進度事件是否即時送達；正式資料庫既有對話的顯示；真實回答（Gemini 是否已恢復未確認）；YouTube 播放器取得秒數；管理員頁與問題回報表單的下拉選單；STT_Whisper 的 Python 測試未執行（部署不安裝也不執行 Python）。
- 待人工驗收：學生帳號提問一題並觀察進度文字是否即時；打開一個舊對話確認沒有多出「重新產生」；播放影片後按「這段在講什麼」。

## 2026-11-16 六片 Leaf 成果 Git 保存檢查

本輪只整理 Git 成果：fetch 發現團隊 dev 新增 4 個對話修正提交，以 ff-only 安全同步至 `9f32f1c`，原六份未提交異動的檔案指紋完全保留。整理單次額外重試防護／測試、狀態與決策／HTML，更新 [Weihao 接手入口](04_Features/Multimodal_Retrieval/HANDOFF.md)、[進度導覽](04_Features/Multimodal_Retrieval/evidence/進度.md)及 AI 使用揭露；[可分享成果摘要](04_Features/Multimodal_Retrieval/evidence/2026-11-16_atlas-leaf-completion-summary.json)只含計數、驗收邊界與私有稽核檔校驗值，沒有向量、完整 receipt、備份或憑證。

**已執行：**目前版本下 Corpus Batch 9、Adapter 10、Video1 Batch 5、Evaluation Batch 6，共 30 項離線測試通過；socket／DNS 阻擋且網路嘗試 0。另檢查文件連結、提交範圍、敏感資料、私有檔忽略規則及 git diff --check。原始 139 筆 intent／receipt、14 批讀回、Checkpoint、ledger、bundle 與備份保留本機，不隨 Git 傳遞；成果提交由本檔 Git 紀錄查閱，訊息固定為 `docs: record completion of six-video multimodal Atlas ingestion`。

**未執行：**本輪沒有 Gemini、Atlas 連線／修改、向量重建、QA／大型回歸、Query／Parent 付費、部署或旗標變更。下節真實 Atlas／QA 驗證的實際版本仍為 `1fc5777`，不能把本輪同步的對話修正當成已重跑真實服務驗收。六片資料完成與正式 Gold／LLM 品質尚未驗收的邊界維持不變，後續依 HANDOFF 及下節接續。

## 2026-11-16 V6 正式寫入完成，六片 Atlas Leaf 齊備

使用者明確授權既有 V6 計畫及初步驗收，並初步確認沒有其他組員修改共用資料庫。fetch 後 dev 與 origin/dev 同為 `1fc5777dd5d0f067a460bcf7a8806e9b1288c141`，保留原六份未提交異動。沿用 Node 22.23.4、原 `video1.js` execute／control CAS 工具及 approvalHash `aec9b6574c05c32fc55e6367f7c06bcb5fff5864f591d0779fb9df10c728b663`；重新核對 V6 manifest、bundle、417 筆原生 Checkpoint、來源雜湊／時窗、簽章／digest 及實際 Atlas 前像，沒有產生新向量或重新建立寫入器。

**正式完成 V6 139 個 Chunk／417 個真實向量，Atlas 六片共 2,078／2,078。** 各片為 V1 351、V2 369、V3 247、V4 432、V5 262、V6 417；總計 stableText 694、audio 692、visual 692，兩個既定超長片段仍只保留文字。V6 僅新增 stableTextEmbedding／audioEmbedding／visualEmbedding 與 mediaEmbeddingMeta.text／audio／visual，原 embedding、字稿、時間、課程／影片關係及非目標 555 筆完整文件均保持一致；原 collection 815 筆未新增或刪除文件。

**備份／CAS／receipt：** 舊核准備份保留，另存 `.local-tools/v6-atlas-write-20261116/prewrite-backup.json`，302,553,638 bytes，包含六片 694 筆、六支影片版本與文字索引前像，已讀回校驗並比對原前像。台北 19:59:59 確認新備份後開始正式更新，20:09:47 完成最後一批讀回。139 次完整文件 CAS、upsert=false、限定精確六個欄位，intent 139 筆、receipt 139 筆，均落盤；receipt 每次 flush 並讀回，每 10 個 Chunk 核驗全六片預期指紋、三個索引與容量。沒有 CAS 衝突、未知寫入結果、重送或回復；唯一的 139 次更新均有成功讀回紀錄。

**驗證中止與唯讀釐清：** 全部 139 筆完成後，驗證包裝以六片舊文字 Top20 的完整分數雜湊判同，因分數最大差值 `1.1920928955078125e-7` 而中止（20:10:29）；原錯誤狀態、intent／receipt 均保留，未重跑寫入。後續唯讀核對全部 694 筆文件符合原前像加 139 份 receipt 的預期指紋，原 embedding／受保護欄位及索引未變；六片各 Top20 的 120 個排名、來源、時間完全相同、各自 self-rank 1，差異僅在浮點分數，不宣稱分數逐 bit 相同。獨立檢查另依原資料契約，對缺省 courseId 的既有文件透過 videos 課程關係核驗，沒有補寫舊文件。安全釐清與對帳結果保存於 write-reconciliation.json、postwrite-diagnostic.json；正式資料及 RRF 程式未為了通過驗證而修改。

**獨立讀回通過：** 逐筆核對六份 bundle 的 2,078 個向量／metadata、模型 gemini-embedding-2、3072 維、來源／時間、簽章與向量 digest，原 694 筆 embedding／受保護欄位及非目標 555 筆全文件一致；三個索引 ID／定義／版本不變，九個節點均 READY／QUERYABLE，沒有 stagedIndex，文字索引仍 version 4。dbStats dataSize `145748818`、storageSize `154738688`、一般 indexSize `4382720` bytes。控制台寫前／寫後未結告警均 0，M0 FREE／512 MB；Overview 寫後仍顯示舊 126.1 MB，未即時反映增量，容量數值以當次 dbStats 及實際 BSON 增量核對，不把一般 indexSize 當 Search 儲存量。

**真實 Atlas 初步檢索與 QA 接線通過，正式 Gold／答案品質未驗收。** V6 chunk_0001／0109／0139 各三路共 9 次保存文件 self-query，均排名第 1；這只驗索引可查詢。另以保存的真實探索 Query 原文／原向量重播，V1～V6 六個單片 QA／對話，以及五片、完整六片課程範圍均通過：三路各 Top20、無 fallback、正式 RRF 獨立重算一致、QA Bridge 引用原字稿與時間，撤銷課程權限後 403 且不搜尋。V6 範例引用 chunk_0045、647.14～660.68 秒，時間與實際教材一致。QA 使用既有 template 答案，本機記憶體保存會話／權限等測試狀態，Atlas 只供唯讀檢索；沒有寫正式 QA 狀態、沒有部署或變更正式旗標。保存的 Query 不是 V6 F11「BERT 的詞向量有幾個維度？」的相符輸入，因此不宣稱 F11 或答案語義品質已通過；新 Query 需求已先回報，沒有呼叫 Gemini。

**成本與後續：** ledger 前後雜湊相同，仍 2,088 calls／US$10.55589788 保守預留；417 筆 V6 Checkpoint 前後一致，沒有任何 Gemini、Query／Parent 付費或新 Embedding。正式 Gold 下一階段需另行授權相符的 50 個 Query（F11 是其中之一，不另加一筆）及固定三 Leaf 的 233 個 Parent；Parent 發布若需要另列授權。X01 仍缺 V5 人工時間，核定前維持 42 題計分、7 題拒答另列、X01 另列；沿用 24 組排名設定、原／stable 文字基準分列並做獨立評分，不修改 Gold 或 RRF。

已執行：本機來源／Checkpoint 核驗、實際 Atlas CAS／批次讀回、獨立 2,078 向量讀回、九個 self-query、六片 QA／對話及兩個課程範圍回歸、權限負向控制、控制台監測、文件連結及 git diff --check。未執行：新模型請求、正式 F11／Gold、LLM 答案品質、Parent 建置／發布、索引修改、部署或正式旗標變更；產品程式未改，不重跑無關全套回歸。完整私有證據在 `.local-tools/v6-atlas-write-20261116/`，含 summary、authorization、備份、intent／receipt、14 份批次紀錄、獨立讀回、三路搜尋、V1～V6 QA、multi-five／six、原中止與唯讀對帳。文件依[決策](04_Features/Multimodal_Retrieval/decisions.md)同步 HTML；未 stage／commit／push。

## 2026-11-16 V6 Atlas 正式寫入前準備

fetch 確認 dev 與 origin/dev 同為 `1fc5777dd5d0f067a460bcf7a8806e9b1288c141`，保留既有六份未提交程式／測試／文件。沿用 Node 22.23.4 及既有 `atlas-multimodal/video1.js`、`run.js`、`control.js`，沒有新增寫入器、啟動 app 或觸發 autoIndex。本輪只做本機資料檢查、Atlas 唯讀核對、備份與 executeWrite=false 的 CAS Dry Run。

**資料與技術檢查 GO；正式執行目前 NO-GO，待明確寫入授權及無重疊操作窗口確認。** V6 凍結 139 個 Chunk／417 個真實向量重新通過模型、3072 維、原片／逐字稿與切片雜湊、時窗、原生輸入簽章、Checkpoint 與 bundle digest 核驗；各模態 139 筆，來源與既有工具相容。manifest SHA256 `47028861def1af3218db9442fc09a86636aea2f4731439b861bc7095bca58608`、bundle SHA256 `6f9f249c521408227b24aa1f61fd6d6522ceb6f5c9ff85d0139d3d37c45aafef` 均未變。

**實際 Atlas：** `focusflow.video_segments_text` 共 815 筆，指定六片仍為 694 筆；V6 有完整 139 筆原文件與舊 embedding，新 stableText／audio／visual 路徑目前各 0。V1～V5 的 1,661 個向量及 metadata 逐筆符合原 bundle；694 筆舊文字 embedding、字稿及時間符合原始產物。六片完整文件指紋與 11/13 已驗證 final-backup 相同，本輪備份與稍後現況也相同，未發現目標或非目標資料衝突。

**容量與管理台：** 本次登入 Atlas 查得 M0 FREE、畫面使用 126.1／512 MB（25%）、雲端備份與 autoscaling 均 OFF、未結告警 0。dbStats dataSize `127842597`、storageSize `148013056`、一般 indexSize `4382720` bytes；V6 預估新增 BSON `17906221` bytes，投影 dataSize `145748818` bytes。這是未壓縮 BSON 估算，不能把 dataSize／storageSize 重複相加或把一般 indexSize 當 Search 儲存量，空間也未被預留。Search 管理台顯示 3／3 個索引，文字 29.34 MB、Parent 40.81 KB、影片 402.86 KB，均 READY／可查詢。Driver 另核對全部三個索引的九個節點及 mainIndex READY／QUERYABLE、沒有 stagedIndex；文字索引 ID 未變、version 4，三路向量 path 已存在，計畫 index.added=[]、indexMutationAllowed=false。

**備份與 CAS：** 既有工具完整保存六片 694 筆文件、六支影片版本與文字索引前像，檔案 `.local-tools/v6-atlas-preflight-20261116/write-plan.json.backup.json` 為 302,553,638 bytes，已讀回校驗並綁定 backupHash。逐筆 CAS Dry Run 139／139 通過，預計新增 834 個欄位（每筆三向量及三份 metadata），沒有既有目標欄位需覆蓋；有效 find／update／listSearchIndexes 權限已核對。intent 先落盤、完整文件 CAS、upsert=false、逐筆讀回與 receipt 保存的既有程式路徑已檢查，本機 receipt flush／讀回檢查通過；沒有建立正式寫入 receipt，也沒有以真實更新測試失敗或回復。任何衝突、讀回異常或未知結果均應停止，保留 intent／receipt，不盲目重試或自動回復。

**操作衝突限制：** Activity Feed 最近可見系統 SSL 憑證及叢集更新於台北 11/16 18:28:29 完成，未看到新的組員控制台變更；它不是完整 CRUD 稽核。`$currentOp` 唯讀查詢受 Atlas 限制（code 8000），不能宣稱已排除所有操作者。資料指紋沒有變動只代表本次觀察區間沒有發現衝突，不是跨操作者鎖；正式執行前仍要確認無重疊操作、重新備份並重驗所有目標前像與非目標 555 筆指紋。

待核准精確範圍：database `focusflow`、collection `video_segments_text`、courseId `6a6da68456dd124511ec5196`、videoId `6a6da69556dd124511ec51eb`、chunk_0001～chunk_0139 共 139 筆，僅新增 `stableTextEmbedding`／`audioEmbedding`／`visualEmbedding` 與 `mediaEmbeddingMeta.text`／`.audio`／`.visual`，合計 417 向量。原 embedding／字稿／時間／身份欄位與 V1～V5 全部保留；不含索引、Parent／Query、部署、旗標或自動回復。計畫 `.local-tools/v6-atlas-preflight-20261116/write-plan.json` 的 **approvalHash：`aec9b6574c05c32fc55e6367f7c06bcb5fff5864f591d0779fb9df10c728b663`**；前像、權限、影片版本或索引有變就停止並重新核准計畫，不沿用過期 hash。

已執行：本機 V6 原生核驗、實際 Atlas 備份／讀回／139 筆 CAS Dry Run、V1～V5 與 694 筆舊向量比較、容量／告警／活動／權限／九節點查核、文件連結及 git diff --check。未執行：任何 Gemini 請求、Atlas 更新／索引操作、Embedding 重建、QA／大型回歸、部署或旗標。ledger 前後雜湊相同，仍 **2,088 calls／US$10.55589788** 保守預留；Checkpoint 未修改。完整私有證據在 `.local-tools/v6-atlas-preflight-20261116/`（summary、local-integrity、cas-dry-run、atlas-readonly、control-plane 及計畫／備份）；本輪僅同步狀態、[授權邊界](04_Features/Multimodal_Retrieval/decisions.md)與 HTML 說明頁，未 stage／commit／push。

## 2026-11-16 V6 剩餘 93 筆真實 Leaf 補完

fetch 後確認 dev 與 origin/dev 同為 `1fc5777dd5d0f067a460bcf7a8806e9b1288c141`，保留前兩輪本檔未提交異動。依使用者明確授權，僅為 chunk_0109 原文字簽章開放第 4 次受控重試，其他簽章維持三次上限，CLI 未開放通用第四次選項。使用 backend/.env 原金鑰、gemini-embedding-2、Developer API v1beta、google-genai 1.70.0、3072 維及共用 US$20 ledger；未切換金鑰或修改模型。

**chunk_0109 額外重試成功，V6 已完成 417／417，六片共 2,078／2,078 個有效真實 Leaf。** 台北時間 18:43:00 核驗該筆第 4 次成功後，以單一並行、請求開始至少間隔 3 秒、每 9 個新向量保存並驗證一批，至 18:47:51 完成新增 93 筆：Text／Audio／Visual 各 31 筆。沒有 HTTP 429、逾時、未知結果或額外重送。原有 1,985 筆向量先離線重用核驗，完成後再比對原成功 Checkpoint 雜湊，全數一致；V1～V5 manifest 與 state 亦未變。

共用 ledger 由 1,995 次／US$10.05385735 增至 **2,088 次／US$10.55589788**，新增 93 次／US$0.50204053 保守預留（含既有逐次向上取整），不是實際帳單。前三次失敗及未知費用未清除、未沖回；舊 attemptsBySignature 除該筆由 3 增至 4 外全部保留。共用排他鎖內新增不可覆寫的 `controlled-retry-permits/<原簽章>-4.json`，保存第 3 次失敗前像與原 ledger 累計；原第 2、3 次 permit 仍保留，不能取得第 5 次許可。完整執行授權、原 ledger／失敗 Checkpoint／state／成功雜湊、每批記錄與結果在 `.local-tools/v6-recovery-20261116/`。

**完整 V6 bundle 已產生並通過離線驗證。** 路徑 `.local-tools/multimodal-build/V6/bundle.json`，SHA256 `6f9f249c521408227b24aa1f61fd6d6522ceb6f5c9ff85d0139d3d37c45aafef`。核對原片與逐字稿雜湊、影音切片雜湊／時窗、Chunk ID、來源時間、原生輸入簽章、模型與維度、有限值／unit norm、Checkpoint digest、bundle 向量與其二進位 digest；最終 417 筆完整重播及匯出使用禁止 provider 初始化的 factory，沒有額外付費請求。模型名稱沿用請求資訊，Google 未提供不可變 revision。

已執行：單次例外政策及錯簽章／重啟拒絕、成功重用、失敗不再重試、歷史保留與預算保護等離線測試；Corpus Batch 9、Adapter 10、Video1 Batch 5、Evaluation Batch 6，共 30 項通過；真實 93 次與全部資料核驗、文件連結及 git diff --check 通過。未執行：Atlas 連線／寫入、索引、Parent／Query 付費、部署、旗標變更或無關 Backend／Frontend／大型 E2E；本輪只修改最小重試政策及其測試與文件，未改 Gold、RRF 或 QA Bridge，未 stage／commit／push。

下一階段 V6 Atlas 寫入的**本機資料條件已具備**；尚未查證當前 Atlas 容量、索引 READY、前像／版本及 CAS 寫入計畫，不能宣稱外部寫入已安全驗收。需另行授權下一階段現況核對及限定 V6 寫入，不能沿用本輪本機建置許可。政策見[設計決策](04_Features/Multimodal_Retrieval/decisions.md)。

## 2026-11-16 Gemini Embedding 2 單次恢復探測

fetch 確認 dev 與 origin/dev 仍同為 `1fc5777dd5d0f067a460bcf7a8806e9b1288c141`，保留本檔既有未提交異動。使用 backend/.env 原 GEMINI_API_KEY、既有 GeminiMultimodalAdapter、Developer API v1beta 與 google-genai 1.70.0；獨立輸入 `OK` 經既有 query 前綴，只發送一次 gemini-embedding-2 請求，未使用 chunk_0109。共用成本預留先於請求落盤，累計 US$20 上限及單次新增呼叫上限生效，SDK attempts=1，失敗後立即停止、不重試。

**台北時間 2026-11-16 18:30:21～18:30:24 探測成功，回傳 1 個 3072 維有限數值向量，正規化範數約 1；未收到 HTTP 429。** SDK 沒有提供 HTTP status_code，證據僅記成功解析的 Embedding 回應，不將缺值補寫為 HTTP 200。請求及 Checkpoint 模型均為 gemini-embedding-2；供應商未提供不可變模型 revision，Checkpoint 模型名稱屬請求模型資訊。

ledger 由 1,994 次／US$10.05221895 增至 **1,995 次／US$10.05385735**，新增一次 US$0.00163840 保守預留，並非實際帳單。全部既有 Checkpoint 的前後雜湊一致，ledger 原有 attemptsBySignature 全數保留，chunk_0109 仍為 3 次。私有證據在 `.local-tools/embedding-probe-20261116/`，包含原 ledger、既有 Checkpoint 雜湊、新探測 Checkpoint 與 result.json；未輸出金鑰或改寫既有資料。

本次證明該模型的最小文字 Embedding 呼叫已可成功，API 可用性這項技術阻礙已通過本次測試；不代表影音輸入、持續配額或剩餘 93 筆已驗收。V6 未續跑；下一項需明確授權 chunk_0109 的額外一次受控恢復政策（目前三次上限不變，既有入口拒絕第四次），政策實作與驗證後才能執行；其餘 92 筆須另含明確續跑授權，不因本次成功自動啟動。

已執行一次真實 Embedding、維度及向量檢查、ledger 歷史與 Checkpoint 完整性核對、git diff --check。未執行第二次探測、V6、其他模型請求、Atlas、索引修改、部署或大型 E2E；本輪沒有產品程式變更。

## 2026-11-16 Gemini 最小恢復測試

安全 fetch 後確認本機 dev 與 origin/dev 同為 `1fc5777dd5d0f067a460bcf7a8806e9b1288c141`，無須合併；開始時沒有未提交變更，保留既有私有 Checkpoint 與 ledger。使用本機 Node 22.23.4、既有診斷工具及 backend/.env 的 GEMINI_API_KEY；沒有切換金鑰、啟動服務或操作 Atlas。

**本次生成測試成功，未出現 HTTP 429。** 先查 gemini-3.5-flash 模型資訊（HTTP 200），再於台北時間 2026-11-16 18:25:05～18:25:06 執行唯一一次、最多 8 輸出 token 的生成探測（HTTP 200）。最初沙箱網路失敗未收到 HTTP 回應，取得網路執行許可後才完成上述查詢。證據保存在本機 `.local-tools/gemini-recheck-20261116/metadata.json` 與 `probe.json`，不保存金鑰、生成內容或錯誤原文。

Google 本次未回傳限制原因、quota metric 或錯誤狀態；先前生成診斷的 monthly spending cap 是歷史結果，不能以本次成功認定先前原因為每日 300 次限制。V6 最近一次失敗仍為 11/14 19:24:28 的 gemini-embedding-2／HTTP 429，原紀錄沒有可還原的具體 quota 原因。模型資訊不能證明金鑰所屬專案，目前仍缺 Google 已登入管理介面或具權限的專案映射核對；未確認與老師調整的專案相同。

**V6 剩餘 93 筆仍未具備安全續跑條件。** 本輪沒有 Embedding 請求，不能由生成模型成功推定 gemini-embedding-2 已恢復；chunk_0109 原 Checkpoint 與 ledger 均記錄 3 次，未重試或修改上限。共用 ledger 仍為 1,994 次／US$10.05221895 保守預留，前後 SHA256 相同；本輪生成探測不經 Embedding ledger，該數字不包含探測費用，也不是 Google 實際帳單。

已執行：模型資訊查詢、一次最小生成探測、ledger 雜湊與三次上限核對、文件 diff 檢查。未執行：Embedding、其餘 93 筆、全套產品測試、Atlas 連線／寫入、索引操作與部署；本輪僅做診斷及狀態記錄。下一步先核對專案與 Embedding 模型配額，再另行授權獨立的最小 Embedding 探測及 chunk_0109 受控恢復政策；不沿用本輪一次探測許可續跑批次。

## 2026-11-16 對話功能優化第一批：W4、W5 進 dev

Codex 雲端版完成進度提示與中斷恢復（`b883d2b`）、依播放位置提問（`118423f`），由 Claude 審查後帶到團隊 `dev`。尚未合併 `main`、尚未部署；明細與待修項目見[開發接手說明](04_Features/QA_Conversation/HANDOFF.md)。

- 新增 `POST /conversations/:conversationId/messages/stream`（SSE）；新舊兩條提問 API 都先建立 `pending` 回答、都接受 `scope: "current_segment"`；重試 API 可接手逾時 2 分鐘的 `pending` 回答。新增錯誤碼 `CURRENT_SEGMENT_UNAVAILABLE`。
- 已驗證（Claude，Node.js 22.23.4）：後端全套 2,000 項中 1,999 項通過、1 項略過、0 項失敗；前端 245 項、lint、build、`docs:lint` 通過；以模擬 API 在桌面與手機寬度實測七種情況。
- 未驗證：真實後端與真實回答、正式站 nginx 下進度事件是否即時、YouTube 播放器取得秒數、正式資料庫既有對話的顯示。
- 審查提出的四項（「這段在講什麼」的擋下條件比定案嚴格、逾時後的「重新產生」按鈕沒有樣式、對話讀不到時無限重試、播放位置路徑多送一個進度步驟）已由 Codex 修正並複審通過（`8dad291`、`42d8399`、`8b7832f`、`9f32f1c`；後端全套 2,000 項通過、1 項略過，前端 246 項通過）。

## 2026-11-15 對話功能優化第一批：W1～W3 進 dev

依[對話功能優化決策](04_Features/QA_Conversation/decisions.md)與[開發接手說明](04_Features/QA_Conversation/HANDOFF.md)，Codex 雲端版完成複製回答（`a9884da`）、多行輸入（`ccfad08`）與預設關閉的兩題固定建議題（`19284af`），推到 Weihao 個人 repo 後由 Claude 審查並帶到團隊 `dev`。只改前端，尚未合併 `main`、尚未部署。

- 已驗證（Claude，Node.js 22.23.4）：前端測試 235 項、lint、build 通過；以模擬 API 在桌面與手機寬度實際操作複製、換行與送出。
- 未驗證：真實後端與真實回答、手機實機鍵盤與真人注音選字；後端沒有變更，未跑後端測試。
- 審查提出的三項（複製含格式符號、複製後沒有回饋、多行問題顯示成一行）已由 Codex 修正並複審通過（`879e5f7`、`74d13fe`、`0a8caee`；前端測試 237 項、lint、build 通過）。W4～W8 的進度見開發接手說明。固定建議題要等 Gemini 可用、實測答得出來才打開。

## 2026-11-15 短影片頁課程範圍與改版上線

Weihao 授權合併 dev 到 main（`7547eb5`，Deploy to VM #163 成功）；VM 核對版本 `7547eb5`、`/health` 200。合併前 Backend 全套 452 檔 0 失敗，Frontend 230 項、lint、build 通過。

- 課程清單 API 新增 `scope=managed`（教師只回自己授課的課程、admin 全部、student 空），短影片製作與管理頁的選單改用它；管理頁不再因別人的公開課程回 `COURSE_MANAGE_DENIED` 而整頁失敗。不帶參數時行為不變。
- 兩頁改為兩欄、暖炭黑降噪底、狀態點與動態（規則見 [DESIGN.md](../DESIGN.md)）。只用模擬 API 截圖檢查，尚未以真實帳號操作驗收。

## 2026-11-14 正式站開啟多模態融合

Weihao 定案產品方向為多模態（見[多模態決策](04_Features/Multimodal_Retrieval/decisions.md)）。VM 的 `backend/.env` 已設 `QA_MULTIMODAL_FUSION_ENABLED=true`（先備份 `.env`），`pm2 restart` 後 `online`、`/health` 回 200，啟動錯誤紀錄沒有新錯誤。同日 Weihao 授權合併 dev 到 main（`067abb3`，Deploy to VM #162 成功）；VM 核對版本為 `067abb3`、開關仍為 `true`、`/health` 200，`npm run diagnose:gemini -- --probe` 回報查模型 OK、生成請求 SPEND_CAP_REACHED（HTTP 429）。

- 生效範圍：AI入門 V1～V5 已有三路向量；V6 未完成部分與其他課程由程式自動用文字檢索。
- 未驗證：Gemini 專案已達每月花費上限，查詢向量呼叫回 429，所以還沒有真實提問確認三路結果與引用標籤；開關開或關都一樣無法回答新問題。上限由教授處理中。
- `runtime.flag_snapshot` 與 `/health` 目前不顯示此開關，只能從 `.env` 與重啟時間確認。
- 關閉方式：把該行改回 `false` 後 `pm2 restart focusflow-backend --update-env`。

## 2026-11-14 工具交接提交前驗證

使用者授權提交16個多模態程式／測試／文件（含CLOUD_DEPLOYMENT_HANDOFF.md），指定訊息`feat: finalize multimodal evaluation tools and handoff`。以dev `1361f2e`為基準，提交前確認origin/dev無新提交；Node22.23.4下Backend定向12項與Python七檔72項共84項通過，Python測試封鎖外部socket連線。全部變更語法、安全模式掃描與git diff --check通過，無新增失效連結，原三處implementation-log歷史缺檔維持。沒有Gemini請求、Atlas操作、向量建置、部署或旗標變更；未跑無關大型全套。原私有成果保持忽略、不stage，實際提交版本以Git紀錄為準。

## 2026-11-14 多模態雲端部署交接盤點

安全fetch／ff-only同步至dev `1361f2e`（遠端新增系統設定決策），保留全部既有未提交工具與文件。依workflow、Backend本機spawn／Queue、STT與多模態儲存／CAS程式完成[雲端部署交接](04_Features/Multimodal_Retrieval/CLOUD_DEPLOYMENT_HANDOFF.md)，區分必須／建議調整、程式已具備與主機待查證；未登入VM、未讀正式憑證、未呼叫模型或操作Atlas。

文件列明：部署workflow未提供Python與私有持久儲存佈建；六片Checkpoint／ledger不隨Git同步且有路徑遷移限制；程序內Queue／本機PID lease不是跨主機排程保證；新上傳付費階段尚缺可配置成功請求節流；health.runtime.multimodal仍是舊影像路徑，不作新三路啟用門檻。上述為部署準備與維運查核要求，不代表本輪已修正／實測VM環境。純文件變更只檢查連結、設定名稱、指令與git diff --check，不重跑產品測試、部署或E2E。

## 2026-11-14 HTTP429精準唯讀診斷與安全記錄

fetch／ff-only pull確認dev與origin/dev仍為`c4f6487312443c869e74ec917acc311b2ae23796`，保留既有工具程式及文件異動。沒有Gemini請求、Atlas操作或部署。本輪沒有開啟憑證檔或讀取完整Key；只核對程式載入規則、環境變數名稱是否存在與設定檔是否存在，不能據此判定實際憑證專案。

**確認的呼叫路徑：**Gemini Developer API `https://generativelanguage.googleapis.com`、v1beta、`genai.Client(vertexai=False)`、`client.models.embed_content`；模型gemini-embedding-2、3072維、單一輸入。安裝與第三次失敗Checkpoint記錄的google-genai均1.70.0。SDK client與單次請求均指定attempts=1；原生Adapter最多3次，V6 BatchAdapter配合stop_retry在任何provider失敗後先停，重啟須另有簽章許可。三次歷史嘗試不是本機無限制自動重送。

**環境載入：**V6 run_video1_batch與兩份歷史重試包裝均先移除程序GEMINI_API_KEY，再載入backend/.env、override=True，因此該路徑使用backend設定而非繼承值；但未核對Key內容，不能確認教授更新的專案相同。一般PipelineConfig則載入STT_Whisper/.env（不存在時dotenv自動尋找），未設override，程序環境優先；新evaluation batch直接沿用程序環境、不自動載入backend/.env；Parent預設provider用PipelineConfig。未來不得混用入口推定Key來源一致。本輪執行程序僅確認沒有繼承的GEMINI_API_KEY名稱，沒有載入真實Key測試。

| 待判原因 | 證據結論 |
|---|---|
| RPM／TPM／RPD | 尚無法確認。舊本機批次最高滾動60秒36次，沒有實際token、專案配額及其他呼叫者用量；不能由本機節流推定未超限 |
| 餘額不足／帳務未生效 | 尚無法確認。ledger不是Google帳單，三次錯誤無帳務訊息 |
| Key與教授更新專案不同 | 尚無法確認。只確認載入檔與優先順序，未查看Key或其專案映射 |
| 模型專屬metric或配額映射異常 | 尚無法確認。歷史無quota metric；公開案例不構成本專案證據 |
| Google暫時性限制 | 尚無法確認。沒有可對應的供應商事件／support結論 |
| 本機US$20預算阻擋 | 可排除為這三次429的直接原因：請求已送出且回ClientError429；帳本US$10.05221895未達20；Mock測試確認超額在provider初始化前停止 |

原三次createdAt（非精確回應抵達時間）為台北11/13 10:46:02、11/14 13:10:01、19:24:28。未保存HTTP body、headers、quotaDetails或Retry-After，無法事後還原。當次本機程序快照沒有node／python Worker、共用ledger.lock不存在；只代表該時點本機未觀察到，無法排除遠端或同專案其他程式。ledger排他鎖涵蓋單次請求，不是跨整批的全域單Worker保證。**目前只能定位為Google回覆的拒絕；沒有足夠證據將某一項配額／帳務原因排為確診或最可能根因。**

**最小程式修正：**新增gemini_error_diagnostics.py並在Adapter失敗Checkpoint的error.diagnostics保存白名單欄位。讀取SDK結構化錯誤與指定headers，不呼叫response.json／text、不寫原始訊息／Key／Authorization／教材；metrics僅保留Google服務格式，請求ID僅接受安全UUID／hex。新欄位只適用未來另獲授權的失敗請求，未重寫歷史檔案，也不為補紀錄發新請求。

**測試：**Mock診斷5項、既有Adapter10項及評測batch6項，共21項通過；含帶假Key／Authorization／私密文字的SDK429回應、Retry-After秒數／日期、quota metric、缺欄位降級、一次失敗即停／歷史預留保留與US$20前置阻擋。無大型回歸或真實模型驗證。證據在`.local-tools/429-precise-20261114/`，共用ledger仍1,994次／US$10.05221895，chunk_0109仍3次。

**教授最精簡查核：**①私下確認目前backend憑證所屬project ID／number與已調額專案相同，不傳Key；②在該專案選gemini-embedding-2查看RPM／TPM／RPD及上述時間用量／quota違規metric，包含其他程式；③查Billing的Prepay餘額、付款生效、帳務連結、專案／帳務帳號花費上限及暫停狀態。若均正常，附project／模型／時間請Google support查實際metric與套用限制，不以換Key／模型或反覆重試排查。

額度恢復也不能直接再跑chunk_0109：三次上限已耗盡，須先依教授資訊審查並明確授權後續受控恢復政策。政策獲准後才允許單次探測，成功再單一並行續跑其餘92輸入，重用324成功Checkpoint、原帳本不清除；任何429／未知費用即停。Query／Parent付費及完整V6 Atlas寫入仍各自另行授權。

## 2026-11-14 配額唯讀診斷與評測工具完成

本輪fetch／ff-only pull確認dev為`c4f6487312443c869e74ec917acc311b2ae23796`，保留原兩份未提交文件。沒有新Gemini請求、Atlas連線／寫入或索引修改，不重跑V1～V5 E2E；未查看本機憑證檔或輸出API Key。共用真實ledger雜湊未變，仍1,994次／US$10.05221895保守預留。

**429仍無法歸因。** 保存三次請求的createdAt為UTC `2026-11-13T02:46:02.140850`、`2026-11-14T05:10:01.118866`、`2026-11-14T11:24:28.022001`，模型均gemini-embedding-2，3072維、text；三次只保存ClientError／429／retryable，沒有原始response body、headers、Retry-After或quotaDetails。ledger是保守成本帳本，缺實際token與同專案其他呼叫資訊；前輪已知歷史滾動60秒峰值36次不能用來判定這三次碰到哪項限制，也不能由隔很久重試仍429就排除帳務以外原因。程式固定Gemini Developer API v1beta端點；本輪未讀Key，不能證明實際Key對應哪個專案或教授調整的是同一專案。

**請教授在Google AI Studio／對應帳務專案確認（不提供Key）：**本機使用憑證所屬的project ID／number，額度調整是否套用該專案與gemini-embedding-2；該模型當前RPM、TPM、RPD限制與上述時間的usage／quota違規metric；專案其他程式的同時用量；billing account連結與啟用狀態、付款／儲值是否已生效、有無花費上限或帳務暫停。若平台保留該次錯誤，提供已遮蔽憑證的quota metric／limit／retry資訊。資料不足前不猜測、不新測API，chunk_0109三次上限不變。

| 工具缺口 | 本輪完成 | 限制 |
|---|---|---|
| Parent共用ledger | 既有parent_embedding預設provider改用BatchAdapter、原共用ledger／Checkpoint及US$20上限；付費錯誤立即停止下一個Parent | 未呼叫模型、未發布Parent；注入Fake provider測試介面保留 |
| Gold Query批次 | 新evaluation_embedding_batch.py固定50題／233 Parent來源與計畫hash，子集、批次、排他鎖、逐筆state、原生Checkpoint、失敗拒絕自動重試、成功快取缺失拒絕重建及唯讀匯出 | live需額外allow-paid及當次授權；Fake state不能匯出為真實bundle |
| 排名與獨立評分 | 新collectMultimodalEvaluation.js依MA記憶體exact cosine收集50題×24組；固定三Leaf Parent，沿用展開／上下文函式；保存原排名、config／輸入hash、舊文字基準及兩個評分實作結果 | 不連DB或模型；formalEvaluation=false、無自動品質放行，仍需第11項與協調session審查 |

**本輪實際驗證：**新增Query／Parent批次6項（含失敗／預留／共用ledger／快取缺失與Parent立即停）、既有Parent36項及原Parent CLI3項通過；Backend新排名入口5項與既有離線評分7項，共12項通過（包含CLI收集後交獨立CLI重算）。新排名測試涵蓋完整1,200列、獨立重算、X01排除、非法資料拒絕、保存Gemini契約的合成向量與舊文字基準，均明確為合成資料。實際原題庫與Parent來源的Fake預演：50／233次首次成功，第二次新增呼叫0，真實ledger未改。產品前端與核心QA未改，未跑大型全套或正式模型／Atlas E2E。

Parent數仍39／41／28／48／30／47共233，Query五題是50題子集；費用首次預留分別US$0.38174720／US$0.08192000，未付費。排名保留42題計分、X01另列、7拒答、六組×兩權重×Flat／Hierarchical、Top20／k60；Hierarchical沿用Parent Top5、展開30、上下文15筆／5000字，只替換文字一路。舊文字與stable文字基準分列；不把完整語料exact cosine說成真實Atlas ANN E2E或正式品質驗收。

完整操作介面見[工具說明](04_Features/Multimodal_Retrieval/remaining-videos-tools.md#queryparent批次與記憶體評分入口)。私有Fake預演、原失敗時間與摘要位於`.local-tools/evaluation-tools-20261114/`；測試log為`.local-tools/evaluation-tools-{node,batch,parent,parent-cli}.txt`。API恢復且獲新授權後，先處理V6失敗簽章政策與93 Leaf，再建5個E2E Query、其餘45 Query及233 Parent；每批重用成功Checkpoint。完整V6 Atlas與Parent發布需獨立授權；全量資料齊備後用新入口收集／獨立重算，再交協調session審查，不開正式旗標。

## 2026-11-14 額度更新後的V6受控恢復

本輪使用者明確重新授權V6剩餘93個Leaf。fetch及ff-only pull確認dev與origin/dev均為`c4f6487312443c869e74ec917acc311b2ae23796`；保留既有兩份未提交文件，批次與Adapter相對前輪無程式差異。沿用backend/.env既有金鑰、gemini-embedding-2、原共用ledger與US$20上限；凍結manifest、原片來源、切片與324筆成功狀態核對後，僅對chunk_0109文字執行一次簽章第3次受控重試。

**結果仍為HTTP429，已立即停止。** 本輪新增1次請求、US$0.00163840保守預留；ledger累計1,994次／US$10.05221895，失敗預留未沖回，不代表實際帳單。未呼叫其餘92輸入，V6仍324/417，六片仍1,985/2,078；V1～V5不重建。失敗簽章已達工具MAX_ATTEMPTS=3，不能再使用原入口重試或清除歷史繞過限制；需先確認實際金鑰所屬專案的拒絕原因，再審查是否另行授權調整受控重試政策。單憑429無法認定儲值更新未生效或特定配額原因。

V6未完整，沒有完整bundle或可執行Atlas寫入計畫；Atlas寫入、索引操作、Query／Parent付費、部署及旗標均未執行。既有成功Checkpoint、原失敗前像與permit保留，證據在`.local-tools/v6-quota-restored/`的ledger-before.json、failed-before.json、result.json；共用controlled-retry-permits保存本次第3次許可。沒有產品程式變更，因此未重跑已通過回歸；來源檢查與實際一次API請求為本輪執行驗證，後續完整向量及Atlas驗收因429未執行。

## 2026-11-14 V2／V3／V5真實探索QA與多影片回退驗收

本輪fetch與ff-only pull後仍為dev `f43cd4f1d98fae9b85e2223d82cc5bcacd32c6a4`，保留六份未提交文件。新增Gemini請求、Atlas寫入、索引修改均0；Gold、原生Checkpoint及ledger雜湊未變。產品程式未改，未部署或開正式旗標。

| 影片 | 真實Atlas＋本機HTTP QA證據 | 正式Gold情境 |
|---|---|---|
| V1 | 沿用同SHA前輪兩個保存探索Query的QA／多輪重播通過 | 缺相符題庫Query |
| V2 | 本輪保存探索Query通過，三路各20筆、RRF、引用與多輪、撤銷授權403且不搜尋 | F06相符Query仍缺 |
| V3 | 本輪同上通過 | F08相符Query仍缺 |
| V4 | 沿用同SHA前輪一個保存探索Query的QA／多輪重播通過 | F15相符Query仍缺 |
| V5 | 本輪同上通過 | F12相符Query仍缺 |

V2／V3／V5直接呼叫既有runAcceptance，重用原文為「課程開頭預計介紹哪些自然語言處理與ChatGPT觀念？」的保存向量，實際比對保留原文空白；Query原始identity未改。各片以完整manifest掛載於合法本機授權範圍，讀取真實Atlas，不冒稱各片Gold問題或相關性驗收。回答為template，FAQ／對話／用量只存在Harness記憶體，無LLM品質或正式站驗收宣稱。

**本輪新增多影片實測：**V1～V5合併555筆範圍，三路各20筆、覆蓋555/555、RRF重算與原逐字稿／影片／Chunk／時間通過，無fallback。全六片694筆範圍偵測555/694覆蓋不足，文字路改為全範圍舊embedding檢索（15筆），保留已完成影片的影音候選，textSource=scoped_text_search。V6單片139筆範圍三路均0，成功全文字fallback，舊embedding取得15筆；不將V6部分Checkpoint寫入。三情境均驗證原逐字稿與引用時間，以及撤銷授權403且不再搜尋。

**回歸與限制：**本輪只跑multimodal-qa.integration與multimodal-authorization.integration兩檔，31/31通過，涵蓋FAQ旗標切換、未Ready／部分覆蓋回退、文字RAG、多輪及權限矩陣。Fake／Mock回歸與上述真實Atlas證據分開；未重跑大型全套。正式分層多模態、正式環境FAQ、LLM回答品質、正式Gold每題排名與獨立品質審查尚未驗收。正式評測仍缺50個相符Query、233個現契約Parent及V6剩餘93 Leaf；Parent共用ledger與全題排名收集入口缺口沿用下節，不因探索QA通過而解除。

完整證據在`.local-tools/qa-e2e-v1-v5-20261114/`：V2／V3／V5-qa.json、multi-five／six／v6.json、regression.txt及summary.json。這些包含真實檢索排名與引用，屬私有本機證據。下一步先確認API配額並另獲模型授權；V6完整後的Atlas寫入、Parent發布及正式旗標均另需授權。

## 2026-11-14 暫停API後的唯讀驗收

**本輪新增Gemini請求0、Atlas寫入0、索引變更0。** 再次fetch／ff-only pull後dev與origin/dev仍為`f43cd4f1d98fae9b85e2223d82cc5bcacd32c6a4`，保留前輪六份文件異動。原生Checkpoint、Gold及共用ledger前後雜湊完全相同，累計仍1,993次／US$10.05058055預留；未重試chunk_0109、未產生任何向量。完整私有證據在`.local-tools/no-api-acceptance-20261114/`。

| 證據類型 | 本輪實際結果 | 不能代表的範圍 |
|---|---|---|
| 真實Atlas self-query | V1～V5每片三路，共15次成功，保存各路Top20及原時間 | 不是學生題庫成績 |
| 保存探索Query的真實檢索 | 同一保存Query在V1～V5各片明確allowlist內各重播2次，三路均20筆；RRF k60、1:1:1獨立重算通過，原字稿／Chunk／時間相符，兩次排名與分數一致 | 不是各片題庫相關性或品質驗收；呼叫端scope為受控驗證範圍 |
| 真實Atlas＋本機HTTP QA | V1兩題、V4一題既有探索Query，各2次通過QA與多輪對話、原引用、無fallback、撤銷授權403且不搜尋；跨次三路排名／分數與scope一致 | 狀態只在Harness記憶體、template回答；不是正式站或LLM品質，V2／V3／V5及正式Gold QA仍缺相符Query |
| Mock／Fake補充回歸 | Backend 5檔30項通過：上傳授權／CAS／備份讀回／冪等回復、FAQ、分層QA、Parent整合、離線評測；Python續跑14項、原文字上傳12項通過 | 無真實Atlas寫入、無真實STT外部模型 |
| 正式評測工具Dry Run | 實際694筆來源與42題Gold對應均有可評分Chunk；50題×24組共1,200列空排名測試資料、config與獨立重算通過 | 空排名只測格式與計算，不能引用其分數；未做正式檢索評測 |

QA比較包裝初次把三路並行完成順序納入比較而停止；依模態名稱對齊後再驗。單程序跨題Harness重用也遇斷言停止，保留失敗log，改用既有獨立CLI程序完成其餘題目；產品QA／RRF／Bridge程式未修改。最終證據為`qa-final-summary.json`、`canonical-V1-0117-repeat*.json`與`isolated-V*-repeat*.json`，不將失敗包裝算作通過。

**資料現況：**本輪新備份694筆並重讀校驗；V1～V5仍1,661個Atlas向量，V6仍0。三索引各三節點READY／QUERYABLE、版本4／0／0及定義不變；原字稿、時間與舊embedding符合原生產物。完整本機1,985/2,078的前輪逐筆核驗沿用，這輪另核對所有Checkpoint檔案未變，不重跑已通過的全量影音解碼。Atlas仍只有3筆V6舊text_v1 Parent，不能扣抵目前233筆text_v2需求。

**上傳Pipeline：**沿用同SHA前輪真FFmpeg／Fake SDK的首次3次、重播及resume零新增呼叫、來源／世代變更拒絕證據；本輪補跑新上傳Atlas工具測試與原文字上傳／resume測試。未核准不寫向量、錯誤核准碼拒絕、CAS與讀回通過Mock驗證。程式接點位於原文字完成與通知後，多模態失敗獨立捕捉；本輪未啟動完整外部STT、live webhook或資料庫寫入。未Ready文字回退、授權矩陣及一般多模態QA沿用同SHA上一輪69項定向通過證據，沒有重跑大型全套。

**評測資料已備妥：**`pending-query-inputs.json`保存50題原文及實際輸入digest；`pending-parent-inputs.json`保存固定三Leaf的233筆Parent文字、child IDs與原時間（39／41／28／48／30／47），最大輸入784 bytes。三個探索Query與50題無同文匹配，可重用題庫Query仍0。`gold-chunk-map.json`、`evaluation-manifest.json`與`evaluation-dry-run-summary.json`綁定原題庫、42題計分／X01另列／7拒答；六模態組×兩權重×Flat／Hierarchical、Top20、k60、文字加權2:1:1維持不變。沒有修改Gold或人工標註。

**恢復後最短路徑與成本：**先確認配額並取得新的受控授權，完成93 Leaf（US$0.50204040）；先建5個E2E題庫Query（US$0.00819200，包含在50題內）以驗V2～V5，V6需完整417向量另獲139筆Chunk的Atlas寫入授權後驗收。其餘45 Query（US$0.07372800）與233 Parent（US$0.38174720）須另授權；合計新增376輸入、首次預留US$0.96570760，累計估US$11.01628815，不含重試且不是帳單。

**仍未完成：**受控全題Query批次匯出與實際Flat／Hierarchical排名收集入口仍須接線／驗證；現有audit工具只消費保存排名，不能誤用舊Top15文字／影片評測程式代替新Top20三路契約。Parent付費入口尚須接入共用ledger，Parent Atlas發布另需明確計畫與授權。真實分層多模態、FAQ正式環境、新上傳全流程E2E、正式每題排名／第11項與獨立品質審查仍缺證據。不得因離線Dry Run通過就宣稱API恢復後無工具缺口。正式部署及旗標仍未操作。

## 2026-11-14 同步與影片六受控重試

**Gemini 仍回 HTTP 429，已依使用者要求停止付費流程。** 本輪 `chunk_0109` 文字僅新增一次受控重試（該簽章第2次）；未續跑其他92筆，也未新增Query／Parent請求。429原因不能僅由安全錯誤碼判定為儲值或特定配額。原失敗前像、ledger與一次重試permit均保留；下一次不能沿用本輪重試許可。

Git 開始時 dev 工作目錄乾淨；fetch、`pull --ff-only origin dev` 完成，HEAD與origin/dev均為 `f43cd4f1d98fae9b85e2223d82cc5bcacd32c6a4`。近期變更包含短影片前端、渲染與語音辨識修正、Gemini診斷及上傳多模態串接，均保留。本輪未改產品程式、stage、commit或push。

| 影片 | 原Chunk | 本機文字／音訊／畫面 | 本機有效／目標向量 | 本輪Atlas唯讀新增向量 |
|---|---:|---|---:|---:|
| V1 | 117 | 117／117／117 | 351/351 | 351 |
| V2 | 123 | 123／123／123 | 369/369 | 369 |
| V3 | 83 | 83／82／82 | 247/247 | 247 |
| V4 | 144 | 144／144／144 | 432/432 | 432 |
| V5 | 88 | 88／87／87 | 262/262 | 262 |
| V6 | 139 | 108／108／108 | 324/417 | 0 |

後五片為1,634/1,727，六片為1,985/2,078；兩個超長段仍只建文字。本輪全部成功Checkpoint重新核對凍結來源、影音雜湊、原始時間、原生簽章、3072維與向量digest，重用核驗不新增模型呼叫。Gemini ledger由1,992次／US$10.04894215變為1,993次／US$10.05058055；本輪新增預留US$0.00163840，包含失敗且不代表實際帳單。尚缺93輸入原估預留US$0.50204040，金額上限仍有餘裕，但不能據此忽略429停止條件。

**Atlas（本輪唯讀）：**694筆原embedding、逐字稿、影片與原時間匹配原生產物；新建694筆範圍備份並重讀checksum，V1整份文件指紋與歷史驗證相同。V1～V5共1,661筆向量與metadata逐筆符合凍結bundle，V6三路仍0；三個索引各三節點READY／QUERYABLE、無staged，text version4、parent/video version0，定義無須變更。dbStats dataSize=127,908,581 bytes、storageSize=138,506,240、一般indexSize=4,382,720；不代表Search用量或可用容量。管理頁tier／容量／告警及組員操作窗口本輪未重新確認，不能沿用11/13確認作當次寫入放行。

V1～V5的15次三路self-query全部成功，完整排名、來源與原時間保存於`self-queries.json`；這只驗證可搜尋性，不是正式題庫成績。V6部分bundle驗證正確拒絕324/417，沒有可執行計畫或approvalHash；目前可核准的完整V6寫入為0。完成後預計僅對V6既有139筆Chunk新增417個向量與metadata；須當次備份、完整Dry Run、CAS前像與核准碼、容量／窗口確認後另請授權，不動舊embedding、字稿、時間或索引。V2～V5成功receipt與資料保留，不重送。

**本輪驗證：**Backend 9個定向檔69/69通過，涵蓋CAS、受控寫入、三路／RRF／Bridge、FAQ與降級、多輪與授權矩陣；沙箱內20項HTTP fetch失敗，沙箱外同組全過，未改程式繞過。Python corpus 7/7、Adapter 10/10、上傳階段1/1通過；上傳測試用真FFmpeg／Fake SDK，首次三路3次、重跑0次。影片一保存Query的真實Atlas HTTP QA及多輪對話通過，三路各20候選、RRF k60可重算、引用原影片與時間、無fallback；撤銷授權403且不搜尋。答案為template，狀態僅存Harness記憶體，不能宣稱LLM回答品質驗收。

**環境與未執行：**系統Node26不在專案指定版本線，實際使用既有Node22.23.4；前後端`npm ls --depth=0 --offline`通過。Python3.11.9、google-genai1.70.0、httpx0.28.1、PyAV17與FFmpeg可用；既有金鑰／DB設定存在，未輸出憑證。本機多模態旗標與上傳付費模式未設定（沿用預設關閉）；後端仍提示JWT設定只適合開發，未改設定或查改VM。未啟動正式服務、全上傳外部Pipeline、全前後端回歸或部署：本輪產品程式未改且外部操作未授權。新上傳真Atlas／QA E2E、共享儲存換機恢復與正式服務帳號政策仍未驗收。

**正式評測依賴：**原題庫及鎖定規則檢查通過，42題計分、X01另列、7拒答維持；未改Gold。當次核對仍需50個相符Query及233個固定三Leaf Parent，五片E2E的5個Query是50題子集，不能重複算成55。保守首次預留分別US$0.08192000與US$0.38174720；五片E2E先行子集為US$0.00819200，均未授權或呼叫。Parent入口仍須先接入共用成本ledger再執行。正式每題24組排名、獨立重算與第11項驗收尚未進行。

完整私有證據位於`.local-tools/resume-20261114/`（preflight、controlled-retry、vector-verification、backup-current、atlas-readonly、bundle-readback-and-dry-run、V1-qa-0001、測試及題庫檢查）。下一步先由教授確認本次金鑰所屬專案的配額／花費限制，再明確授權該簽章第3次且最多一次重試；成功才續跑其餘92輸入。Atlas、Query／Parent、部署與正式旗標均保持未授權。

### 2026-11-13 上傳後多模態串接（實作中）

本機以 V2 原片與第一筆原始 Chunk 重跑 FFmpeg／Fake SDK，三路首次 3 次、重跑 0 次。隔離 Backend 回歸 1,956 passed、1 skipped、0 failed；新增 Atlas 模擬驗證涵蓋缺授權、錯誤核准碼、CAS、讀回、冪等與回復。前端 229 項通過，lint、build 及 OpenAPI lint 通過。STT 全套 242 項通過；單獨續跑入口另以模擬資料庫核對來源及世代。以上無新增付費呼叫或共用 Atlas 寫入。

單片入口在文字 Pipeline 完成後可選擇產生三路 Checkpoint。合成影片驗證使用 FFmpeg 與 Fake SDK，首次三筆、相同輸入重跑零次 SDK 呼叫。新影片的 Atlas 工具依課程、原片雜湊、向量版本與當次核准計畫限制寫入。新上傳流程尚無真實 Atlas／QA E2E 證據，正式共享儲存、成本帳本移轉與服務帳號政策尚未驗收。執行與恢復方式見[交接](04_Features/Multimodal_Retrieval/HANDOFF.md)。

這份文件集中記錄各模組的進度，避免不同文件各寫一份。請先看狀態與依據，再由團隊填寫負責人及待決項目；後端技術說明見[技術索引](../backend/docs/current-state.md)。

**狀態定義：**「規劃中」指方案研究；「實作中」指仍在補功能；「已實作」只代表本段範圍的程式接線完成，不代表驗收通過，尚未查證的部分另列「○○未驗證」；「已驗收」需指定環境與驗收證據。各模組的執行與驗證範圍以該段記錄為準；日期為最後查閱或驗證日期，正式驗收日期另列。

## 影片二至五真實 Atlas CAS 寫入完成（2026-11-13 12:49，UTC+8）

**本輪限定438筆Chunk／1310個已保存向量的Atlas寫入已完成；沒有Gemini呼叫、影片六寫入、索引修改、部署或開旗標。** Git fetch／ff-only pull確認dev為`40b552f`（新增僅短影音前端）；保留本機七份未提交交接文件，多模態核心與寫入工具未變。庭語當次確認無其他組員修改共享Atlas，並負責協調監看。

| 影片 | CAS成功Chunk | stable文字／音訊／畫面 | 新增向量讀回 |
|---|---:|---|---:|
| V2 | 123/123 | 123／123／123 | 369/369 |
| V3 | 83/83 | 83／82／82 | 247/247 |
| V4 | 144/144 | 144／144／144 | 432/432 |
| V5 | 88/88 | 88／87／87 | 262/262 |
| 合計 | 438/438 | 438／436／436 | 1310/1310 |

V3 chunk_0034與V5 chunk_0016仍只寫穩定文字，原長段未改、沒有假影音欄位。每片先建立新的694筆範圍備份、六片版本與索引快照並讀回校驗，再建立plan hash；執行前再次自動備份、全目標前像／權限／版本／索引核對，逐筆CAS與讀回，intent／receipt逐筆落盤。共438次更新、全部verified，無already-applied重送、CAS衝突、未知寫入結果或回復。中斷後只接續既有程序，沒有重啟已完成更新。本機操作包裝腳本曾在解析階段出現語法錯誤、尚未連線／寫入即修正並通過node --check；既有CAS核心未改。

**寫後獨立查證：**1310個向量及metadata逐筆符合凍結bundle；694筆原embedding、字稿、原時間戳、courseId/videoId一致，影片一117筆全文件指紋及影片六139筆全文件均未變；集合仍815筆。每片完成後核對整個694範圍與已完成／非目標文件。三個索引各三節點READY／QUERYABLE，定義、ID及版本不變（text version4、parent/video version0）；新增資料的12次三路self-query成功，這是可搜尋性驗證，不是學生題庫QA或模態成效。

**回歸：**6個保存舊embedding自查詢，在四片寫後各次Top20順序與分數都和寫前相同。影片一兩個既有保存Query重跑真實Atlas HTTP QA＋對話，三路與RRF、原引用時間及授權撤銷403通過、無fallback；用量／FAQ／對話等狀態只在Harness記憶體，template答案不作LLM正確性宣稱。未執行影片二至五的學生題庫QA E2E，也未跑正式42題評測；沒有為了驗證修改QA／RRF／Bridge。

**當次容量：**寫前管理頁Free M0、72.48MB／512MB，前後未結案專案告警均0。寫後Driver dbStats dataSize=127,907,244 bytes（比寫前增加56,251,670）、storageSize=129,970,176、一般indexSize=4,349,952。管理頁寫後仍顯示舊72.48MB，未即時反映增量，因此不能用它宣稱寫後仍剩439.52MB。最終694範圍備份及checksum已讀回通過；此備份不是全815筆或全DB災難備份。

**目前課程覆蓋：**Atlas V1～V5共555筆stable文字、553筆音訊、553筆畫面，合計1661個新增向量；V6新增三路仍0。課程stable覆蓋555/694、complete=false，正式多模態旗標不能開啟。V6本機324/417及其餘成功Checkpoint皆保留，仍缺93模型輸入；共用ledger維持1992次／US$10.04894215保守預留，含歷史未知與429，不是實際帳單。

**下一步條件：**V2～V5向量落地與可搜尋性GO，原F06/F08/F15/F12題庫QA尚缺4個相符Query向量；它們是完整50題Query子集，不重複計算。現有3個探索Query不等於這4題，不能拿文件向量偽裝問題向量。所有Gemini呼叫仍NO-GO，等教授實際專案／配額及庭語另行授權；本輪不產Parent／Query。正式分層評測另需233個同契約Parent及完整題庫Query，沿用42題計分／X01另列及第11項門檻。成功資料與現有索引保留，後續不得自動回復、重寫或以本輪授權寫影片六。

敏感備份、前像、計畫、完整receipt及原生向量留在忽略的`.local-tools/atlas-write-v2-v5-20261113/`；當次主報告`report.md`、`independent-readback.json`、各片receipt／三路self-query／legacy-after與兩份V1-qa紀錄供本機追查。先前寫入輪僅更新文件；庭語已另行授權將本批交接文件提交並推送dev，Git紀錄見[進度](04_Features/Multimodal_Retrieval/evidence/進度.md)。沒有重跑不相關全套，因核心程式未變。下一位先讀本段，再看[後五片工具](04_Features/Multimodal_Retrieval/remaining-videos-tools.md)與[進度](04_Features/Multimodal_Retrieval/evidence/進度.md)，下節是寫入前歷史快照。

## 寫入前的多模態資料與工具準備快照（2026-11-13，現況以上節為準）

**Gemini 付費請求維持 NO-GO；本輪沒有模型請求、Atlas 寫入、索引更新、部署或開啟正式旗標。** 程式基準 dev `eb9d267`，工作項目只有唯讀查證、既有工具 Dry Run／本機測試與文件。影片六 HTTP 429 的調查不重做，等教授確認實際金鑰所屬專案與配額後，再由庭語明確授權恢復；目前任何既有付費範例都不可直接執行。

### 本機完成與 Atlas 寫入要分開看

影片一 351/351 個本機向量及 Atlas 117 筆三路資料均保留；本輪重新查證 Atlas 全文件指紋與先前驗證一致。後五片 1,634/1,727 個本機真實向量重新核對凍結 manifest、來源影音 SHA、原生請求簽章、Chunk／時間、模型、3072 維、正規化及向量 digest，全部通過；它們尚未寫入 Atlas。

| 影片 | 原 Chunk | 本機文字／音訊／畫面 | 本機有效／目標向量 | Atlas 新三路向量 |
|---|---:|---|---:|---:|
| V2 | 123 | 123／123／123 | 369/369 | 0 |
| V3 | 83 | 83／82／82 | 247/247 | 0 |
| V4 | 144 | 144／144／144 | 432/432（3 筆原有重用） | 0 |
| V5 | 88 | 88／87／87 | 262/262 | 0 |
| V6 | 139 | 108／108／108 | 324/417 | 0 |

兩筆超過 60 秒的原片段只保留文字；546/577 個 Chunk 已依規則完整，其中544筆三路完整、2筆僅文字。V6 剩93個向量（chunk_0109 text 的429失敗1筆、未嘗試92筆），不將它匯出成完整 bundle，也不縮小原139筆 allowlist 繞過檢查。共用 ledger 仍為1,992次紀錄、US$10.04894215保守預留；歷史 ReadTimeout、ConnectError 及429預留不沖回，不是已核實帳單。

### 當次 Atlas 與寫入保護

Driver唯讀查到六片694筆字稿、時間與原 embedding 全部匹配原生教材產物；三個 Search Index 各三節點 READY／QUERYABLE、無 staged，text_embedding_index version4，所需新增定義差異0。V1三路各117，後五片各0。dbStats：dataSize 71,655,574 bytes、storageSize 129,970,176 bytes、一般indexSize 4,349,952 bytes，這些不是Search索引用量。

這次管理頁也可讀：Free M0、MongoDB8.0.37，資料量72.48MB／512MB、名目餘額約439.52MB；Search三個名額已滿，text／parent／video索引顯示13.7MB／44.75KB／402.86KB，專案沒有未結案告警。**先前無法核實tier／容量的資訊缺口已補上，但這是當次快照、不是保留空間或無並行操作保證。** 雲端備份OFF；本輪自動本機備份及讀回驗證只涵蓋指定694筆、六片版本與索引，不是全collection815筆或整個資料庫災難備份。

V2～V5沿用B方案產生當次計畫、自動完整範圍備份與讀回、所有目標前像／版本／權限／索引雜湊查證，以及正向／回復Dry Run；完整結果見本機`.local-tools/atlas-ready-20261113/write-dry-run.json`。計畫不含影片一，前後核對其完整文件指紋；只新增stableTextEmbedding、audioEmbedding、visualEmbedding與相應metadata，不動舊embedding、原逐字稿、課程／影片／時間。V6未完整時拒絕可執行計畫；後五片入口禁止索引操作，不需要再次重建。四片當前bundle的未壓縮BSON增量合計56,251,670 bytes，不含Search索引增長，不是實際寫入量。

真正執行仍要重新建立當次計畫與備份、確認操作窗口／告警／容量、核對approvalHash，再獲限定寫入授權。CAS（只在文件仍符合前像時更新）、intent、receipt與逐筆讀回沿用；衝突、逾時／未知寫入結果或讀回不符即停，不盲目重送或自動回復。真實回復須另依證據與授權決定；回復Dry Run不是已在Atlas寫後實際回復。

### E2E 與正式評測依賴

沿用video1-qa.js與原題庫，每片預期來源如下；下表是核對用Gold與來源錨點，不保證檢索一定排名命中，也沒有改Gold。

| 影片／原題 | 原題庫時間秒 | 真實來源Chunk與原時間秒 |
|---|---|---|
| V2 F06 圖靈測試提出時間 | 462–504 | chunk_0037：476.61–491.49 |
| V3 F08 Llama 3最小版本及記憶體 | 180–234 | chunk_0012：180.08–201.28 |
| V4 F15 ChatGPT免費／付費版模型 | 838–879 | chunk_0067：849.20–865.20 |
| V5 F12 Transformer論文及引用 | 1635–1770 | chunk_0078：1671.41–1693.40 |
| V6 F11 BERT詞向量維度 | 1531–1574 | chunk_0101：1541.68–1558.86 |

Harness與題目／來源計畫已就緒；**後五片真實Atlas QA E2E尚未執行、目前資料條件不足**：需該片向量先正式寫入，且保存相符問題的Query向量。通過條件仍為真實三路vectorSearch、各路Top20、RRF k60排名／貢獻重算、QA Bridge同Chunk原逐字稿／影片／時間、無fallback、撤銷授權後403且不搜尋；問答／FAQ／用量等狀態只留本機記憶體。template答案只驗接線，不能宣稱LLM回答品質。

固定三Leaf Parent需求：V1～V6為39／41／28／48／30／47，共233。影片六本機已有47筆preview及47筆stable舊v1 Parent，Atlas只有3筆v1 Parent，均未證實符合現用text_v2，不能扣成可重用233筆。現有Parent獨立付費入口未見接入本次共用US$20 ledger；若後續獲准，先補最小成本保護接入，不直接執行。離線檢查固定233個Parent文字輸入均未超既有Adapter8192-byte保護。

原50題Query（43可回答、7拒答）目前可驗證重用0；三個探索Query與原題庫無同文匹配。五片E2E所需5題是50題子集，先建後可同簽章重用，不重複算成55；現有逐片Query入口可準備這5題，全50題受控匯出入口仍須確認／最小接入。Query／Parent模型呼叫及Atlas落地均未授權。42題計分、X01另列的題庫檢查通過；六模態×兩權重×Flat／Hierarchical、固定per-question格式與獨立重算規則不變，未執行正式檢索評測或第11項驗收。

本輪測試：Backend9個定向檔84/84通過（CAS、receipt／未知結果、索引保護、25授權矩陣、Bridge／RRF、五片Fake HTTP QA）；Python corpus7/7通過；1,634筆原生向量／來源完整性無付費核驗通過。沙箱內19項本機HTTP fetch失敗，沙箱外同組84項全過，未改程式繞過。Fake Atlas／Synthetic Vector不是後五片真實檢索證據。本輪未跑無關全套、未做付費Query或真實五片E2E，原因如上；文件另驗連結、路徑及git diff --check。

**判定：V2～V5本機資料與唯讀寫入工具條件GO；實際Atlas寫入NO-GO，待當次明確授權與操作窗口。V6完整寫入、後五片真實E2E、正式品質驗收及開旗標NO-GO。** 距11/15報告仍有配額、93筆Leaf、Parent／Query與真實驗收依賴，應立即請Weihao協調教授配額及驗收排程，不能將本輪工具準備當成完成驗收。交接入口為[HANDOFF](04_Features/Multimodal_Retrieval/HANDOFF.md)、[後五片工具](04_Features/Multimodal_Retrieval/remaining-videos-tools.md)與[進度](04_Features/Multimodal_Retrieval/evidence/進度.md)。敏感完整證據留忽略的`.local-tools/atlas-ready-20261113/`；本輪只修改文件，未stage、commit或push。

## 教師短影片製作／管理前端第一版（2026-11-12）

**實作中。** 依[短影片決策](04_Features/Short_Video/decisions.md) UX-20～UX-23，教師側欄的「短影片腳本、上傳短片、短影片審核」改為「短影片製作」「短影片管理」；recut 一條流程接上後端 API：選題（一批最多 5 支）、第一次使用時同意授課內容與老師原音、逐句加回／移除（每改一句存成後端草稿）、採納 AI 建議、核准講稿並製作、成品播放（字幕預設開啟、講稿同步標出目前那一句）、核准或退回、跨課程待辦清單與撤回同意。數位分身依 UX-24 併入短影片製作：選題時選「原片剪輯」或「數位分身」；數位分身由系統產生腳本，教師複製或下載後用地端模型製作，影片傳回後在同一畫面確認成品上架。舊的三個頁面保留網址到試跑結束，側欄與製作頁不再連過去；短片通知一律打開短影片製作。製作失敗時，`GET /short-scripts/:scriptId/recut` 新增的 `render` 欄位帶出錯誤代碼，畫面說明原因；圖卡文字太長、聲音異常、檢查不通過三種不提供「重新製作」。同一門課最多 5 支同時產生講稿，後端第 6 支回 `409 RECUT_BATCH_LIMIT_EXCEEDED`。實作中先採用的五項作法列在決策檔「教師工作區第一版實作待確認」。

之後依 `/impeccable critique`（28/40）的建議逐項修正：鍵盤焦點與螢幕閱讀器播報、手機退回改用底部面板、講稿改為短片時間軸（每句短片時間、原音按鈕、30／65 秒刻線、來源範圍）、核准後果與用詞、橘色只留給目前動作、新頁面字級層次、共用元件狀態與高度層級（`tokens.css` 的 `--ff-elev-*`、`--ff-spring`），以及頂欄鈴鐺與頭像改為可用鍵盤操作；功能未開放與沒有學生提問時的畫面也已整理。

第二次 `/impeccable critique` 仍為 28/40、P1 由 3 項降為 2 項，已修正：短影片製作頁加入「跳到主要動作」鍵盤捷徑、核准講稿提示改為具體句數與秒數、核准上架後顯示完成狀態，以及全站側欄未選中項目對比提高到 6.25:1。第三次 `/impeccable critique` 為 29/40，之後再修兩項 P1：數位分身「傳回影片」這一步改為主要按鈕「選擇影片」→「上傳影片」，確認框接在檔名下方，複製／下載移到腳本上方，重新產生、視覺隱喻、不做這支收進「更多」；全站外殼最前面加入「跳到主要內容」，從頁面開頭 4 個按鍵可到主要按鈕。

第四次 `/impeccable critique` 為 28/40，之後連續修正四輪，第八次為 **36/40**（P0 0 項、P1 1 項）。修正內容：
- 核准講稿與核准上架的後果寫在按鈕上方。
- 「跳到主要動作」固定落在主要按鈕，停用時也一樣，並念出原因。
- 退回原因在電腦與手機都開面板，分「內容」「聲音、畫面、字幕」兩組加「其他」。
- 每句標示「短片」「原音」兩個時間；講稿與數位分身腳本各有「怎麼看／怎麼做」說明（依畫面切換）；移除／加回與原音可用上下鍵換句。
- 數位分身步驟改為「產生腳本／做影片並傳回／確認成品」，兩項確認寫明標示文字與同意書內容，手機上移到主欄。
- 1440 成品審閱播放器與講稿左右並排；已上架可直接前往短影片管理撤下。
- 錯誤不再顯示英文技術訊息；觸控裝置頂欄按鈕 44px。

第八次留下、試跑後再處理：手機文字欄偏窄（全站側欄佔 72px）與修改後底部列偏高、1440 成品審閱版面、數位分身畫面上未顯示視覺隱喻、採納建議沒有先說會重排約一分鐘。

`/impeccable audit`（2026-11-13）原為 15/20，依序修正 harden、optimize、polish：
- 全站外殼加上 `<main>`、`<header>`、側欄 `<aside>` 地標，短影片管理頁補頁面標題。
- 短影片製作與管理的輪詢改用 `useVisiblePolling`，分頁在背景時暫停，回到分頁立刻刷新。
- 登入後各頁面改為用到時才載入，首頁的 three.js 背景與按鈕也改為延後載入：主程式由 1.6 MB（gzip 431 kB）降到 484 kB（gzip 140 kB）。
- 短影片頁面的 inline style 改成 class（只留時長尺的動態位置），透明白改用 `--ff-white-*` tokens。

修正後 axe-core 4.10.2 在 8 個畫面 0 項違規。

之後的 `/impeccable polish`：逐句修改失敗的訊息改在那一句下方；「放棄修改」移到講稿上方，手機修改後底部列由約 220px 降到 167px；採納建議前說明會重排約一分鐘；數位分身的視覺隱喻放到腳本上方、清單狀態改為「待傳回影片」；目前這一支改用細框（不用左側色條）；手機流程列不再出現行首連接線；短影片管理沒有任何短片時只顯示一個空狀態與「製作新短片」。

**正式站部署（2026-11-14）**：使用者授權後把 `dev` 合併到 `main`（`cb17930`，含組員 29 個提交、無衝突），部署 run #161 成功，部署流程新增的 short_render 套件安裝步驟也通過；從外部確認正式站已載入新版短影片頁。後端短影片能否產片取決於 VM 設定（`SHORT_SCRIPT_AUTOMATION_ENABLED`、recut runtime JSON、語音辨識模型、`YOUTUBE_API_KEY`、渲染 worker），外部看不到 `/health`，需在主機內 `curl localhost:4000/health` 看 `runtime.recut.ready`。Gemini 以新增的 `npm run diagnose:gemini -- --probe` 診斷：金鑰有效、模型存在，生成被「專案每月花費上限」擋下，要在 AI Studio 調高上限。

**recut 命中群改依題目關鍵字排序、無法回答時換段（2026-11-19）**：放寬後「羊駝」流程跑完，但選到講自然語言處理的影片而判定無法回答；依 [recut 決策第 97、98 項](04_Features/Short_Video/recut-design-decisions.md)，命中群先比題目關鍵字（每次從題目與學生問句自動抽取）再比命中數，模型判定無法回答時自動換下一群重跑，最多再試兩次。**未執行**：正式站重新產生。

**recut 穩定性：放寬程式檢查（2026-11-19，第三輪）**：依 [recut 決策第 95、96 項](04_Features/Short_Video/recut-design-decisions.md)，辨識結果中長度為 0 的字併進相鄰字、0.3 秒以內的小重疊與超窗自動對齊；圖卡長度放寬為 2～15 秒、開頭空白上限 3 秒；選段標籤矛盾以範圍為準修正、超長時最多拿掉三句。驗證：short_render 全套 173 項（172 通過、1 略過）；後端 recut 相關測試見本段 commit 紀錄。**未執行**：正式站重新產生。

**recut 穩定性：程式接手算數（2026-11-19，第二輪）**：上限 8 次後「摩爾定律」仍失敗，8 次中 6 次是算術錯誤。依 [recut 決策第 94 項](04_Features/Short_Video/recut-design-decisions.md)：選段總長略超過 65 秒時程式拿掉頭尾一句；配圖卡輸入加上每句播放秒數；chips 詞卡數量由程式修正；圖卡可拆成三張以上、開頭空白過久時移除最早的 cue。「羊駝」那題改在辨識步驟失敗（`RECUT_ASR_INVALID`）；錯誤訊息改為寫出第一個出錯的字後，查到是長度為 0 的字「就是」（28.4～28.4 秒），依 recut 決策第 95 項改為併進相鄰字。驗證見本段 commit 的測試紀錄。**未執行**：正式站重新產生、固定 10 題穩定度量測（會產生 Gemini 費用，待使用者同意）。

**recut 配圖卡程式修正與額度（2026-11-19）**：VM 用 yt-dlp 取回 AI入門 6 支原片後，正式站「摩爾定律」產生講稿已通過原片檢查、辨識與選段，但配圖卡連續修正字幕長度與圖卡秒數，用完 5 次呼叫（`RECUT_CALL_LIMIT_EXCEEDED`）。依 [recut 決策第 93 項](04_Features/Short_Video/recut-design-decisions.md)：初次產生上限預設改為 8；字幕過長與圖卡秒數由 `recutCardsAutoFix.service.js` 依句子邊界修正；辨識結果的簡體字由 `utils/simplifiedToTraditional.js` 轉成繁體。驗證：新增配圖卡修正 9 項、簡繁轉換 2 項、辨識正規化 1 項，連同既有配圖卡、修正停滯與 pipeline 共 81 項通過。**未執行**：正式站重新產生、後端全套測試。VM 的 `backend/.env` 若明確寫了 `RECUT_INITIAL_CALL_LIMIT=5`，要改成 8 或刪掉該行，新預設值才會生效。

**過渡工具：從 YouTube 取回缺少的原片（2026-11-19，未在 VM 執行）**：VM 唯讀查證，「影片處理工具 - OpenCV」14 講是 YouTube 連結匯入、從未有本機檔；「AI入門基礎課」6 支記錄了檔案路徑，但 VM 上沒有檔案，也沒有清理紀錄，所以 recut 回報找不到原片，現有的「補回原片」也不適用。依使用者決定，新增 `backend/src/scripts/recutFetchYoutubeSources.js`：用 yt-dlp 取回原片、比對長度後更新 `filePath`，不重跑語音辨識；用法見[後端 README](../backend/README.md#過渡工具從-youtube-取回缺少的原片)。驗證：`tests/recut-fetch-youtube-sources.test.js` 7 項全過（假下載）。**未執行**：在 VM 安裝 yt-dlp、實際下載、寫入 Atlas、重新產生講稿。

**命中分散不再整題失敗（2026-11-19，未部署）**：正式站「老師說的那個羊駝是什麼啊？」產生講稿失敗，Atlas 唯讀查證為 `RECUT_WINDOW_NOT_FOUND`（直接命中分散在 4 支影片，未呼叫模型、未用額度）。依[決策第 1 項](04_Features/Short_Video/recut-design-decisions.md)修訂，`loadSourceInputs` 改為把命中分成「同一影片、三分鐘內」的群，依命中數與檢索排名逐群嘗試，全部不行才失敗；工作區重新打開時也會顯示上次失敗的原因。驗證：`tests/recut-source.service.test.js` 27 項全過（新增 4 項）；前端 `npm test` 237 項全過、`RecutWorkspace.jsx` lint 通過。**未執行**：部署、正式站重新產生、前端 build。

**換產片方式、不做這支與恢復（2026-11-19，未部署）**：依[短影片決策](04_Features/Short_Video/decisions.md) UX-26，「等你處理」的短片可在工作區改用另一種產片方式（已產生的講稿或腳本保留），原片剪輯補上「不做這支」，「不做了」的短片可恢復到收起前的狀態。後端 `POST /short-scripts/:scriptId/review` 的 `dismiss` 改為兩種產片方式共用並記下 `statusBeforeDismiss`，新增 `restore`；收起的短片不能產生或換產片方式。驗證見同日回報；**未執行**：部署、正式站操作。

**上線準備（2026-11-14）**：`/health` 新增 `runtime.recut`（開關、是否就緒、主機設定狀態與缺項代碼），部署後可直接確認能否產生短片；上線所需設定、渲染 worker、驗證與關閉方式寫在[短影片上線步驟](10_Operations/deployment/短影片上線步驟.md)。正式上線仍需：調高 Gemini 專案花費上限、VM 設定 `YOUTUBE_API_KEY` 與 recut runtime（含離線 faster-whisper 模型）、準備渲染 worker、負責人授權部署（`dev` 合併到 `main`），以及真機、LINE 與真人教師驗收。

正式組裝的語音辨識路徑（同日）：以後端 `createRecutHostRuntime` 讀正式格式的 runtime JSON，在 Linux 跑真實的視窗、原片檢查、faster-whisper 逐字時間（small 模型）、切句與 worker 渲染，全部成功（44 句、成品 44.2 秒、-15.9 LUFS）；只有 Gemini 因花費上限改用固定輸出。過程中找到並修正三個會讓正式站失敗的問題：host 把 `python` 解開 symlink 後脫離虛擬環境、找不到 faster_whisper（Linux 虛擬環境預設是 symlink，Windows 試產沒踩到）；`STT_Whisper` 沒限制 PyAV，新安裝會拿到 19 版而讓辨識開檔失敗（改成 `av>=11,<19`）；切句把 Whisper 的「0.」「01」在小數點斷開（數字中的點與逗號不再斷句）。

**真實外部服務驗證（2026-11-14，使用者授權：FocusFlow 頻道、Gemini 不超過 15 美元）**：本機真後端＋隔離 Mongo（非 Atlas）＋真 short_render worker（chrome-headless-shell、Noto Sans TC）＋真 YouTube 上傳，原片用本機離線語音合成的講課（句子時間精確已知，取代這台機器沒有的語音辨識模型）。結果：
- **Gemini 未執行**：API 回 429「專案已超過每月花費上限」，沒有產生費用；選段、配圖與數位分身腳本改用依真實格式寫好的固定輸出，仍經過 short_render 的真實驗證。要真實生成需先在 AI Studio 調整花費上限。
- **原片剪輯**：教師在真前端完成同意 → 講稿 → 核准 → 真實渲染（49 秒 MP4，檢查全過）→ 自動上傳 YouTube（`A4h49gfOIQ0`，FocusFlow 頻道，unlisted、已處理完成）→ 畫面自動換成可核准 → 核准 → 已上架。
- **數位分身**（手機寬度）：同意肖像與聲音複製 → 腳本 → 傳回 48 秒影片 → 上傳 YouTube（`2MRKbNjUXCg`）→ 核准 → 已上架。
- 兩支都上架後學生牆仍是空的：學生牆要等 Shorts 同步（需 `YOUTUBE_API_KEY`），這個環境沒有金鑰；以同步會寫入的值代替後，學生牆看得到兩支。
- 驗證時找到並修正：**原片剪輯成品從不上傳 YouTube**（worker 完成只建立成品，沒有排程上傳；正式環境教師會一直停在「影片還在上傳」）；**short_render 檢查把 FFmpeg 的科學記號讀錯**（8.33e-05 秒讀成 8.3 秒靜音，任何有正常句間停頓的成品都會被判失敗）。
- 響度問題（同日修正）：峰值先碰上限時成品真峰值會略超 -1.5 dBTP；單聲道原片輸出成雙聲道後響度多 3 LU。已在 short_render staging 修正（-3 dBFS 峰值限制、單聲道每聲道 0.7071 倍），以真實渲染驗證單聲道（-16.11 LUFS）、雙聲道（-16.13）與峰值受限（-17.9 LUFS、-2.96 dBTP）三種原片都通過 worker 檢查。
- 裝置：以 LINE 內建瀏覽器的 user agent 模擬 iPhone 13 與 Pixel 7 尺寸，沒有頁面錯誤或水平捲動；讀取螢幕報讀器會讀到的無障礙樹，閱讀順序與按鈕名稱合理。這些都是模擬，**真機、真 LINE、真螢幕報讀器與真人教師驗收仍未執行**。
- 依使用者要求，測試結束後把兩支測試影片改為公開；系統設計是 unlisted（條款也這樣寫），系統若偵測到自己管理的影片是公開會自動改回私人並通知管理員，正式站不認得這兩支測試影片所以不受影響。

**本機真後端端到端驗證（2026-11-13）**：真後端程式＋隔離 Mongo（127.0.0.1，非 Atlas），AI 選段、配圖、整體檢查與數位分身腳本用固定的假回應，渲染用走正式 worker API 的假 worker（ffmpeg 產生 720×1280 測試影片），「YouTube 處理完成」以直接改本機資料代替；程序內移除執行環境帶的 Gemini／YouTube 憑證並擋下所有 Google／YouTube 網址。第一次啟動時尚未移除憑證，後端啟動檢查可能向 Google 取過一次 YouTube OAuth token（沒有上傳）。結果：
- 用真前端在 1440 與 390（觸控模擬）走完：同意 → 產生講稿 → 加回超過 65 秒時停用確定修改 → 移除後確定修改 → 核准講稿 → 製作 → 成品就緒自動更新 → 核准上架 → 短影片管理 → 學生短片牆看得到；成品退回顯示原因與下一步；數位分身同意 → 腳本 → 傳回影片 → 核准上架。
- 驗證時找到並修正：數位分身上架要肖像與聲音複製同意，前端原本沒問，核准後一直停在「已核准，等待上架」（後端只寫在 log）；同意後要回選題再按一次；已做過的題目仍在候選；成品等 YouTube 時畫面不會自己更新；審閱計時在換版本後才結束而收到 409；退回後沒說原因和下一步；退回通知寫「前往腳本頁重新生成」但畫面沒有這個按鈕；確認對話框被全站 `margin: 0` 擠到左上角；授權欄預設顯示別門課。另移除「上架後可在短影片管理撤下」的說法：目前沒有單支撤下的 API，撤下只能撤回整門課的授課內容同意。
- 教師操作驗收由子代理扮演教授，用畫面操作 5 項任務全部完成、沒有 P0；不等於真人教師驗收。留待決定：單支撤下需要後端 API；同意條款含 PoC、recut、Gemini、Kokoro 等技術詞（條款文字要經團隊確認）；數位分身下載的腳本是工程規格，非技術老師難以照做；手機全站側欄只有圖示且佔約 1/3 寬度；退回原因不能補充說明；傳回影片長度與腳本不符時沒有提醒。
- **未執行**：真實 Gemini 生成、真實 short_render 渲染、YouTube 上傳與播放（需授權與指定頻道）、真機、LINE 內建瀏覽器、螢幕報讀器、真人教師驗收。

驗證（2026-11-13）：前端 `npm test` 230 項全過；後端 `tests/recut.routes.test.js` 14 項全過、`docs:lint` 通過、`lint`、`build` 通過；Impeccable 偵測無問題；以 Vite 與模擬 API 在 Chromium 1440／1024／390px 走過選短片、加回句子、管理清單打開成品、退回原因、數位分身腳本與選產片方式，無頁面錯誤。**未執行**：連真實後端（需開啟 `SHORT_SCRIPT_AUTOMATION_ENABLED`）、真實原音播放、YouTube 成品播放、LINE 內建瀏覽器、教師操作驗收。

**呈現調整（2026-11-16，`b41ca5d` 已進 `dev`；尚未合併 `main`、尚未部署）**：依決策 UX-25 只改前端呈現、不改功能。兩頁拿掉外層底框。製作頁左欄列出四種狀態與數量，預設全部收合；電腦版的動作移到不固定的任務標題列，手機維持底部固定列；數位分身的重新產生與不做這支併入腳本工具列。管理頁改成狀態分頁、課程篩選、授權按鈕與製作新短片一列工具，加上無框清單。「製作新短片」會直接進選題；成品影片高度不再被遮住。全站所有 `<select>`（含行內樣式的管理頁選單）的選項改用比頁面更深的不透明底色，Chromium 135 以上改畫成無外框的深色浮層（`appearance: base-select`），其他瀏覽器維持原生清單；已在短影片製作、課程管理（新增課程的狀態）、上傳影片看過畫面，管理員頁與問題回報表單未看。驗證：前端 `npm test` 251 項全過，`lint`、`build` 通過；第一版畫面由使用者在本機（後端連 Shared Atlas）看過並回饋；修訂版在內建瀏覽器以 1440、900、375 寬檢查兩頁、從管理清單打開短片、選題取消回到原本那一支；主控台只有後端啟動前的 502 與登入前的 401。**未執行**：真機、修改講稿與上傳等寫入操作、教師驗收。

## 後五片可執行工具與無付費驗證（2026-11-12）

影片一正式驗收摘要已獨立提交並push `94014c7`，後五片工具提交 `2063ece`。後五片工具已完成最小擴充：同一corpus.json供Python／Node使用，凍結來源與產物hash、精確577筆allowlist；兩長段只建文字、影音略過。沿用既有Adapter／CAS及原生Checkpoint，按Chunk分批、共用US$20 ledger、簽章嘗試上限、失敗先停／明確一次重試permit、成功快取損壞拒絕重建。Atlas新清單只接受現有三路READY索引，禁止任何index操作，寫前／後核對影片一117筆全文件指紋；全694範圍自動備份、CAS、receipt與回復機制保留。QA Harness已支援各片授權範圍，沒有改核心QA／RRF／Bridge。

五份manifest與1150個真實影音檔已完成準備，1727輸入Fake SDK全成功，第二次全部重用、Fake SDK新增呼叫0；可重用V4原生向量3筆，尚缺1724真實模型輸入，首次保守預留US$8.6620184，加既有ledger共約US$10.5477036，不含另需授權的5個題庫query（最多US$0.008192）或Parent。最壞三次約US$27.8717會超20，仍由共用ledger硬停，不能宣稱所有重試保證完成。本輪真實ledger維持US$1.8856852。後端完整1951項、1950通過、0失敗、1既有略過；Pipeline受影響41項通過。五片Fake HTTP QA／對話、來源時間、RRF、無fallback及授權負例通過，不是真實五片QA。

當次Atlas唯讀694筆字稿／時間／原embedding與原生產物逐筆相同；V1三路完整、後五片新增欄位均0；三索引三節點READY/queryable、Leaf version4且所需定義差異0。dataSize約71.66MB、storage約129.97MB，依V1增量估後五片再加約74.16MB；Search用量及全叢集容量不由這些數字保證。管理頁存取逾時，當次tier／Search容量未核實，寫入窗口仍需確認告警／資源與無衝突。42題＋X01另列及7拒答的題庫檢查通過，六組×兩權重×Flat/Hierarchical的per-question格式與獨立重算工具沿用，未執行正式成效評測；query／真實Parent與全量覆蓋尚待建立。

**判定**：下一輪Leaf模型批次工具與首次預算GO，須先取得付費授權；Atlas逐片執行仍須當次Preflight／容量與授權，不做無條件全量GO。其他五片、正式旗標與部署本輪均未操作。可執行命令見[後五片工具](04_Features/Multimodal_Retrieval/remaining-videos-tools.md)，[可分享摘要](04_Features/Multimodal_Retrieval/evidence/2026-11-12-remaining-preparation-summary.json)不含原向量／字稿／備份／敏感receipt，完整證據留`.local-tools/remaining-videos-20261112/`。

## 影片一真實 Atlas／QA 技術驗證（2026-11-12）

已依當次授權完成117/117筆CAS新增三路欄位，351向量及metadata讀回符合本機Checkpoint。694筆原embedding／保護欄位未變，577非目標文件整份未變；694完整範圍前像備份重讀通過，寫前再自動備份。text_embedding_index僅一次擴充、version3→4，保留舊embedding／filters；三個Search Index各三節點READY/queryable、無staged，未新建／刪除索引或collection，無回復。當次人員無衝突／無告警由庭語確認並監看；M0 currentOp回8000不可用，不宣稱Driver已觀測全域零活動。

兩個保存問題各跑真實Atlas HTTP QA＋對話，文字／音訊／畫面各20候選，分別融合39／44候選；RRF k60、1:1:1重算與原時間戳引用通過，無fallback或文字替換；兩個未授權負例403且不搜尋。全部QA狀態只留Harness memory；答案沿用template，未驗LLM正確性。舊文字三個自查rank1、Top20順序全同；68項相關本機回歸通過（FAQ、Flat/Hierarchical、fallback、25授權矩陣及工具），未重跑無關全套。完整原生向量共351筆／117三路完整，六片stable覆蓋仍117/694、complete=false；本機旗標false、未查改正式VM旗標。

本輪未呼叫付費Gemini、未改核心QA/RRF/Bridge、未部署／正式評測、未建其餘五片。Gemini ledger維持US$1.88568520保守預留，原逾時帳單仍未知。影片一技術門檻GO；後五片需另授權、核准allowlist／工具範圍擴充；39筆V1 Parent與全量品質門檻仍待處理。向量預設保留，不能開正式旗標。私有證據與報告位於`.local-tools/video1-build/atlas-live-v1-20261112/`，索引journal固定於`.local-tools/video1-build/index-journal/`；安全摘要見[進度](04_Features/Multimodal_Retrieval/evidence/進度.md)。本輪僅更新交接文件，未commit/push。

## 影片一三項工具擴充（2026-11-12）

程式提交 `22bff4b`、`4c618f0`。三項工具缺口已完成本機實作：固定117筆 manifest／351輸入的 Gemini batch（共用20美元 ledger、跨重啟三次上限）、B方案117筆 CAS／自動備份／雜湊授權與固定索引 journal、安全真實 Atlas QA Harness（正式 QA 邏輯、全部狀態寫入記憶體）。目前只驗證 Fake Atlas，不宣稱真實 Atlas QA 成功或回答品質驗收。既有234個切片完成351輸入Fake SDK，6筆真實原生 Checkpoint 重用驗證成功且 ledger 未變。真實字稿／原時間／保存 query 的 Fake Atlas HTTP QA＋對話也通過。Backend完整1942項、1941通過、0失敗、1既有略過；最終寫入工具4項、QA工具2項另通過。Pipeline受影響五檔34項通過；全套 discover 在本機提前結束且未留下可採信測試輸出，不能列為通過。無付費、Atlas寫入／索引更新、部署、正式評測或開旗標，qa.service.js未改。工具層GO；下一輪真實執行仍需當次授權與當下索引／權限／容量檢查，Hierarchical真實Parent另待39筆。詳見[工具操作](04_Features/Multimodal_Retrieval/video1-tools.md)。

## 影片一建置前最終檢查（2026-11-12）

已 pull，dev e3774d4。唯讀實查 V1 117 Chunk、舊向量 117、新三路各 0；保存 6 筆向量可重用，尚缺 345 輸入。117 段影音共 234 檔實際切出並解碼；694 完整範圍備份重讀校驗、三索引三節點 READY、三筆 Dry Run／回復 Dry Run、62 項 Backend、10 項 Adapter、US$20 重試邊界通過。批次實作仍 NO-GO：現有 runner／writer 固定 12 輸入／原三筆，尚缺安全真實 Atlas QA harness。本輪僅提出最小修正，未改核心程式、未付費、未 Atlas 寫入／索引更新、未正式評測、未開旗標、未 commit/push。當次本機旗標未設定，未查正式站設定；完整結果與下一步見[影片一檢查](04_Features/Multimodal_Retrieval/video1-preflight.md)。

## 多模態交接缺口修正（2026-11-12）

庭語已接手三項：完整授權範圍stable文字覆蓋檢查（包含25/40但搜尋回滿20的回歸）、索引30秒成功／5秒失敗快取與清除、25項授權矩陣。Q5已核定合法共享向量，Adapter不再把來源courseId當ACL。受影響62項通過，完整Backend以檔案隔離4併行回歸1936項、1935通過、0失敗、1既有略過；最新矩陣25項另獨立通過，包含語意FAQ及draft角色子例。矩陣包含信任前置觀察，不全是攻擊阻擋證據。42題暫定計分支援已實作、X01排名／Gold保留、protocolHash分版，未執行正式評測。新覆蓋聚合實際唯讀查到0/694且正確不放行。未做全量向量／Atlas寫入／索引操作、開旗標或部署；ON＋shadow低優先缺口仍在。新版四階段取消S60，先V1、其餘五片、自動備份、索引只改一次、US$20停，成功資料保留且旗標關閉；詳見[計畫](04_Features/Multimodal_Retrieval/real-data-test-plan.md)及[進度](04_Features/Multimodal_Retrieval/evidence/進度.md)。

## 多模態交付範圍定案（2026-11-12）

Weihao 定案（見 [decisions.md](04_Features/Multimodal_Retrieval/decisions.md)「交付前規劃第一輪」）：11/13 交付程式完整且 `QA_MULTIMODAL_FUSION_ENABLED` 關閉、離線與三筆真實小樣本證據及未完成項清單；全量影音向量、Atlas 正式寫入與正式 43 題在 11/15 前完成，判斷①改在 11/15，通過才在 11/16 凍結前開啟。11/14 部署時開關關閉。章節與影片升級移出這一階段。X01 的 V5 時間待核准，核准前正式報告以 42 題計分。多模態由庭語接手，交接內容見[多模態進度](04_Features/Multimodal_Retrieval/evidence/進度.md)。

## 前輪多模態真實資料測試盤點（2026-11-12）

本輪只唯讀／離線檢查與文件。六原片可讀、合計630,096,168 bytes，694筆Atlas文字向量與六份preview產物逐筆向量及時間一致；692段影音合格，15段需延伸8秒，2段超60秒略過影音。現行Atlas仍是舊embedding索引，影音0筆，前輪三筆真實實測已回復。43可回答＋7拒答題庫可讀，但X01缺V5 Gold仍BLOCKED；三個保存探索query不在原題庫，不能代表43題成績。33項既有測試、12筆checkpoint重驗與保存3題72列離線重播通過；六個現有Gold anchor實際切片12/12解碼。四組同語料比較、S60探索及全量成本／M0方案見[真實資料測試計畫](04_Features/Multimodal_Retrieval/real-data-test-plan.md)。未改程式、未做新QA E2E／正式評測，無Atlas寫入、索引變更、模型呼叫、部署或commit/push；11/13完整交付仍需Gold、全量向量與契約／驗收支援。

## 多模態團隊溝通快照（2026-11-11）

組員先讀 [團隊總覽](04_Features/Multimodal_Retrieval/team-overview.md)，再依需要看 [契約矩陣](04_Features/Multimodal_Retrieval/authorization-contract-review.md) 與 [Atlas 去敏實測摘要](04_Features/Multimodal_Retrieval/evidence/2026-11-11-atlas-sample-summary.json)。總覽是當日溝通快照，本文件仍為唯一持續維護的狀態正本；不要把下方歷次快照直接當現在的放行條件。

| 完成層級 | 已有成果與證據 | 明確未完成 |
|---|---|---|
| 程式已實作 | 逐 Chunk 影音／Gemini Adapter、Atlas Adapter、固定 RRF、QA Bridge、QA 開關／回退、FAQ 分版與引用；CAS 與索引安全工具 | 不代表正式 runtime 已啟用；本輪未查正式旗標 |
| 離線驗證 | 66/66 安全工具與相關回歸；歷次本機 QA／引用及 Parent 合成驗證 | 新增 25 項 Contract-first 矩陣只完成設計，尚未實作／執行 |
| 真實小樣本 | 12 個保存 Gemini 輸入結果；三筆九向量實際 Atlas 寫入、三題三路、兩版 RRF、舊文字與安全回復均有來源 | 原偽造 scope probe 不構成正式 QA 漏洞證據，也不代表完整授權測試通過 |
| 全量／正式驗收 | 尚未完成；維持明確限制 | 694 筆全量影音、完整一致 Parent／語料、X01 核定、正式 43 題比較、正式網站多模態 E2E、開啟／部署決策 |

Atlas 第一輪實測已結束並完整回復，最後 694 筆指定範圍完整文件與備份相同、全 collection 815 筆、原索引三節點 READY／QUERYABLE、舊文字三筆 rank 1。新三路資料及 path 沒有留作持續啟用；原查詢／回復觀察詳見下節與去敏 JSON。該 JSON 只含 allowlist 的識別碼、時間、排名／分數及雜湊，不含向量、逐字稿、憑證、完整 metadata 或私人帳號。

契約審查已於 `0891715` 獨立保存；本輪另外授權團隊文件整理與 dev 提交，不授權功能實作、重新寫 Atlas 或部署。接下來先核定 U01/U02 與測試矩陣，再只補本機測試；合法前置下若有明確違約才提最小修補。之後全量、正式評測與部署各依條件另行授權。11/13 完整目標仍有時程風險，不以三題結果替代完整交付。

## 多模態 Contract-first 契約審查（2026-11-11）

以 dev `13e8a8c` 完成 HANDOFF／decisions／QA-Adapter 契約、Course／Video 授權、資料模型與相關測試的靜態審查。既有契約明確支援 Leaf 缺頂層 courseId：正式 QA 先驗課程存取，再由服務端 Course／Video 關係產生 canonical 影片 allowlist，並在候選與逐字稿階段複核。控制器不接受客戶端傳入的任意 scope；Adapter／Bridge 的 scope 則要求由呼叫端先授權。

更正前輪判定：把錯誤課程與原影片 allowlist 人工配成 scope，直接呼叫 Adapter 後期待零筆，屬超出契約前置條件的測試假設錯誤，不能定為已證實的 Adapter／正式 QA 漏洞。正常缺 courseId 的合法 Chunk 不應被補寫或排除。合法跨課掛載確為既有功能；明示 Leaf.courseId 與當次掛載課程不同、media metadata 課程語意則列 U01/U02 跨模組契約待決，不擅選拒絕或接受當成修正。

前輪真實 Atlas 觀察仍保留：三筆九向量 CAS 寫入、同名索引正向重建與三題三路／兩版 RRF 已完成；最後三筆與指定 694 筆完整文件皆回到前像、舊向量摘要不變、集合仍 815 筆、原索引三節點 READY／QUERYABLE、舊文字三筆 rank 1。原始來源在忽略目錄 `.local-tools/atlas-preparation/live-round1/` 的 report.json、scope-diagnostic.json、final.json 與正反向 receipt，不提交向量、備份或完整 metadata。當時因負例假設而安全停止並完整回復是有效事實；不能因此把正式 QA 跨課隔離或完整多模態品質驗收標成已通過。

已整理 [契約分析、25 列測試／待決矩陣與最小修正方案](04_Features/Multimodal_Retrieval/authorization-contract-review.md)：每列含依據、fixture、輸入、預期理由、責任層與合法檢索影響。本輪只做文件與測試設計，沒有新增／執行矩陣測試、沒有連 Atlas／模型、沒有改程式或 commit／push；之前 66/66 不能當成本矩陣已通過。正式修改與後續實測仍待審查及另行授權。下方是先前各階段紀錄，不代表本輪有寫入授權。

## Atlas B 異常處理演練與即時唯讀核對（2026-11-11 17:14–17:17，台灣時間）

**唯讀與離線演練 GO；正式 Atlas 寫入／索引更新 NO-GO，等待單獨授權。** 目標固定為現有 `focusflow.video_segments_text` 與 `text_embedding_index`；不另建資料庫、集合、專案、叢集或第四個索引。原晚間窗口已取消，不排程或自動開始。

使用者已確認無操作衝突，具有 Project Data Access Admin，並願意負責持續監看、停止、依前像回復及必要時聯繫 Project Owner／MongoDB 支援；不再把一般操作必須另有一位管理者當成缺口。角色與處置原則由使用者確認；本次是工具／程序演練，不是人工操作正式 Atlas 回復的實作測驗，也不保證外部支援能即時介入。

Node 22.23.4 重跑既有 8 檔定向測試，66/66、無失敗／略過；涵蓋 BUILDING 等待、FAILED／逾時／未知結果停止、跨執行禁止重送、receipt 損毀、CAS 衝突與安全回復。磁碟 Fake journal 寫入回讀、索引 before／after 純 JSON 雜湊核對均通過。程式／QA／RRF／Bridge 沒有修改。

當次 Atlas 唯讀結果：694 筆指定範圍備份回讀 checksum 通過，舊 embedding 與第七階段備份全部相同；三筆完整前像未變且新增欄位不存在。全 collection 計數 815；694 備份不是全 collection 災難備份。三節點 READY／QUERYABLE，mainIndex 定義在保留原始快照、辨識預設 numPartitions: 1 後一致；Driver 的 find／update／listSearchIndexes／updateSearchIndex 均可用，未試寫。三筆文字 self-query 都 rank 1、各 20 筆，耗時 133.77／73.37／73.61 ms；課程與未授權影片負例均 0 筆，這不是正式問題品質評測。

控制台確認 Free M0、8.0.37、AWS Hong Kong、全叢集三個 Search 索引已滿，目標索引 815/815、約 10.87 MB；資料 58.12 MB／512 MB、連線 20／500、無未結案告警。Operation Throttling 有入口但圖為空白，不能宣稱節流為 0；M0 監測盲區、重建時間及索引無伺服器 CAS 的風險保留。三路真實搜尋、兩版 RRF 的 Atlas 結果及正式回復尚未執行。

原始證據只存忽略的 `.local-tools/atlas-preparation/`，不提交備份、完整向量、checkpoint、逐字稿、憑證或私人帳號資訊。精確檔名與當次雜湊見 [操作計畫](04_Features/Multimodal_Retrieval/atlas-preparation.md#最終-gono-go-與管理者確認)，演練命令與來源見 [驗證紀錄](04_Features/Multimodal_Retrieval/evidence/進度.md)。本次實際 Atlas 寫入／索引更新／回復、付費 Gemini、部署與 VM 操作均為 0。後續必須另有正式授權；延後或狀態改變時刷新唯讀證據，不沿用本快照自動放行。

## Atlas B Driver 離線安全驗證（2026-11-11，先前工具階段紀錄）

當時原 20:00–22:00 窗口已取消，該工具階段授權只含獨立工具、Mock 測試、文件與 commit／push。當時待確認的人員與即時核對已由上節更新，不能把本段歷史限制當成目前缺口；正式寫入仍待單獨授權。

新增獨立 `index-control.js`：限定 B 方案與同名索引，預設 Dry Run；前像、版本、三節點與定義核對，正向／回復各只送出一次。含 checksum 的磁碟 receipt 記錄 prepared／submission_started／submitted／verified；結果不明時跨執行阻擋重送。資料 rollback 補逐筆 receipt，保留既有 CAS、原 embedding 與他人異動保護。未改 QA、RRF、Bridge 或部署。

Node 22.23.4 的 8 個相關檔案共 66/66 通過，無失敗／略過。包含實際安裝 Driver 的 Collection.updateSearchIndex 與命令建構器，執行端以 Fake 取代，沒有 connect／socket；驗證正反向 JSON、三節點輪詢、逾時／權限／配額／網路未知結果、receipt 損毀與程序重啟保護，並回歸三筆 CAS、資料回復及既有融合／Bridge。全部是離線 Fake／Synthetic 驗證；本輪未連 Atlas、未寫入／更新索引、未付費或部署，也未宣稱真實三路驗收完成。命令與日誌見 [驗證紀錄](04_Features/Multimodal_Retrieval/evidence/進度.md)。

工具路徑已離線驗證，餘下正式門檻為管理者協調／監測、執行當下 M0／配額／三節點、備份／舊 694 向量／planHash／baseline 重驗，以及符合最新正式操作授權。完整 [Go／No-Go 與管理者清單](04_Features/Multimodal_Retrieval/atlas-preparation.md#最終-gono-go-與管理者確認)。未跑 Backend 全套、前端或 pipeline，因本輪只修改獨立工具與對應測試。

## Atlas M0 管理端資訊與操作計畫（2026-11-11，先前準備紀錄）

使用者提供 Atlas UI 查證：focusflow 為 Free M0、MongoDB 8.0.37、AWS Hong Kong，全叢集三個 Search 索引達上限；text_embedding_index 三節點 READY／QUERYABLE、估算文件數 815/815、每節點約 10.87 MB，只有 embedding（3072／cosine）及 courseId、videoId filters，未做 UI 修改。本輪依官方文件核對，同名索引加入三條 vector path 符合定義／數量限制；既有 after 定義壓縮 JSON 424 bytes，低於 3 KB。

M0 Search CPU／Memory 不可取得已確認，改用基礎指標、Throttling、節點狀態與查詢基準。資源峰值與耗時仍未知；建議兩小時低峰窗口，含正向及回復兩次重建。815 為 UI 全 collection 口徑，694 為指定課程備份，重建影響範圍需當次核對。現有 index-wait 未逐節點驗證，計畫補上 Atlas UI 人工確認，沒有修改工具或正式設定。

目前技術支援限制核對完成，實際執行仍 NO-GO，等待窗口、風險接受及三筆寫入／索引更新／回復明確授權。詳見[更新後 Go／No-Go](04_Features/Multimodal_Retrieval/atlas-preparation.md)。本輪僅分析與更新文件，未連 Atlas、寫資料、改索引、升級或付費；純文件只做 diff／連結與計畫核對，未跑程式測試。

使用者另指定 2026-11-11 20:00–22:00 台灣時間，只核准準備檢查與文件 commit／push。當前 PREP-ONLY／NO-GO FOR WRITE；需在窗口內確認使用者在線、Atlas 管理者可接手、VM 無重疊，以及 fresh 備份／planHash／三節點／baseline，再取得獨立二次授權。不得自動開始或排程。

## 第十階段題庫一致性與完整本機問答（2026-11-11）

已核對 decisions 基線表／第 6、7、8 項及 MA，固定 50 題中 43 可回答為 Recall@5／Recall@10／MRR 分母，7 拒答只另列診斷。新增 annotation-issues.json、retrieval-protocol.json 與 protocolHash／goldVersion 綁定。X01 在主評分表「評分表」F25／G25、ad84f6d 最初題庫及 8/24、9/3 結果都是同一缺漏，無 V5 人工時間來源，原題庫與主評分表未改，正式品質評測仍 BLOCKED。

已用本機 Vite 的完整學生頁及隔離 Express 跑過實際登入、進課、六種問答情境、引用卡片、對話重載與 HTML video 跳轉。六情境為 off／flat／hierarchical／missing-index／all-failed／invalid-time，對話 POST 皆 201、越權課程皆 403，原始 1752.15–1754.55 秒與身份／排名保留，播放器實測落在原始起點附近。保存 Gemini query 為真實向量，Atlas／embedding HTTP 為 Fake、Parent 為 synthetic、回答為 template、影片為 1800 秒合成黑畫面。完整頁 headless Edge 自動驗收通過，未做正式站人工驗收、真實教學影片播放或真實生成品質驗收。

Atlas 管理端資源、低風險窗口與另外的資料／索引執行授權仍未取得。小樣本真實驗證沿用既有 B 工具，實際窗口才重驗前像，不重跑無意義的 Dry Run。本輪未連 Atlas、未呼叫付費模型、未部署或操作 VM。詳見[驗收操作](04_Features/Multimodal_Retrieval/offline-acceptance.md)及 [Go／No-Go](04_Features/Multimodal_Retrieval/atlas-preparation.md)。

Node 22.23.4：後端受影響回歸 210/210、無失敗／略過；含完整頁瀏覽器的 QA 檔 4/4 通過，主案例內跑六情境及對話重載。前端 184/184、lint／build 通過，保留大 bundle 警告。X01 inspect 預期 BLOCKED，沒有正式 Recall／MRR；未跑全套 Backend／pipeline、真實 Atlas 或正式站人工驗收。命令與來源快照見[驗證紀錄](04_Features/Multimodal_Retrieval/evidence/進度.md)。

推送前取得 Weihao 新增五筆至 `3e521ed`，以一般 merge `705ad76` 安全整合，保留 LINE 去重／逾時、教師統計及前端連結修正。合併後重跑受影響後端並納入 teacherStats，218/218；前端 192/192、lint／build、OpenAPI lint 通過；完整學生頁 QA 檔 4/4、六情境與對話重載再次通過。無失敗或略過，仍未跑全套 Backend／pipeline。

接續中斷工作時本機與 origin/dev 已同為 `b5bd95b`，包含本輪提交及後續短影片修補。本輪多模態程式與前端相對 `705ad76` 無差異；在 b5bd95b 再跑同一後端子集，218/218、無失敗／略過。前端與瀏覽器沿用上述相同程式版本的已通過結果。

## 第九階段多模態離線驗收（2026-11-11）

新增真正經既有 Parent search／Child expansion／Leaf context 的合成 fixture，Flat 與 Hierarchical 的文字候選不同，media 候選固定。覆蓋父子不同時間、合成向量排序、缺 Parent／Child、部分 Child、重複命中與跨課影片回退；正式 QA 測試另走 Fake Parent serve rollout。既有 Adapter、RRF、Bridge 與正式 QA 接線沿用。

新增本機排名 auditor 與獨立區間掃描 checker，校驗固定 43 題可回答／7 題拒答、gold 時間、manifest、身份、rank、完整 24 組與輸入 hash。發現 X01 宣告 V2+V3+V5，時間只標 V2／V3；真實題庫輸出 BLOCKED，未修改 gold 或產出正式品質分數。合成 43 題驗算僅驗證算式。完整 43 題實測還缺題庫維護者確認 X01、完整一致模型版本的語料／Parent／媒體向量與真實排名。

引用標籤抽成實際 React 元件並補 aria-label。保存真實 Gemini query、Fake Atlas／embedding HTTP、template answer 的本機 API 產出引用 fixture，headless Edge 驗證實際元件標籤、原始 1752.15–1754.55 秒、身份／排名、鍵盤跳轉與舊資料無標籤通過。這是最小元件 smoke，未驗整個 StudentCourses、正式播放器或正式站。

操作與資料來源見[離線驗收](04_Features/Multimodal_Retrieval/offline-acceptance.md)，Atlas 管理端資訊、低風險窗口與實際操作授權仍 BLOCKED，見 [Go／No-Go](04_Features/Multimodal_Retrieval/atlas-preparation.md)。本輪沒有 Atlas 連線／寫入／索引操作、付費呼叫、部署或 VM 操作。

Node 22.23.4 執行受影響後端回歸 209/209 通過；新增評分第六名邊界等案例後，auditor 定向重跑 6/6。第一次用共用程序跑相同子集為 205 通過／4 失敗，確認為 env 提問字數／每日次數的載入順序污染，改用 Node 預設檔案隔離後同子集全過，未改 production 配額邏輯。前端 184/184、lint／build 通過，保留既有大 bundle 警告；headless Edge 元件 smoke 通過並檢視截圖。未跑全套 Backend、pipeline、正式站或真實 Atlas；當次明細見[測試紀錄](04_Features/Multimodal_Retrieval/evidence/進度.md)。

## 多模態正式 QA 接線（2026-11-11）

第七階段已接 askQuestion、預設關閉的 QA_MULTIMODAL_FUSION_ENABLED、FAQ 分版、三路失敗回退、API 引用與網頁比對方式，對話 sources 保存來源與排名。使用保存 query 向量、Fake Atlas／embedding HTTP 及 template answer 的 4 項整合測試通過，涵蓋 API 到前端標籤、FAQ 開關切換、三路成功、單路失敗、缺索引、preflight 失敗、空結果與非法時間。既有授權、Leaf／Parent rollout 與 LINE 邏輯保留。測試均為本機 fixture，真實 Atlas 三路標記 BLOCKED，仍缺 stable paths；正式 runtime 開啟與部署未執行。

本次 Atlas 唯讀診斷仍為 694 筆、無截斷與診斷錯誤；29 個集合內共 3 個 READY/queryable Search 索引，隔離目標不存在。tier／全叢集剩餘配額仍未知。已建立當次 694 筆前像備份與索引 before/after 提案，實際寫入與索引變更皆 0。B 方案授權範圍見 [Atlas 授權單](04_Features/Multimodal_Retrieval/atlas-preparation.md)。

前端 183/183、lint、build 與 OpenAPI lint 通過，build 有大於 500 kB 的 bundle 警告。正式 43 題未執行；本機輸出 3 題、72 筆 comparison 及 config.json，分層僅使用相同文字 fixture。

Backend 全套首次 1849 項，1847 通過、1 失敗、1 略過；失敗為即時磁碟統計影響的預約測試，固定測試快照後 1/1 重跑通過，未改服務邏輯。最新定向回歸 28/28，後續修改未再重跑整套。命令與邊界見[驗證紀錄](04_Features/Multimodal_Retrieval/evidence/進度.md)。

## 多模態 QA 獨立橋接（2026-11-11）

第六階段新增 `multimodalQaBridge.service.js` 與離線評測輸出介面。已保存三筆真實 query 與九筆 document／audio／visual 向量經模擬 Atlas 排名、既有 adapter、RRF、教師逐字稿載入與引用輸出驗證，保留原始時間、retrievedBy、channelRanks。離線輸出涵蓋兩種文字檢索模式、六組模態及兩種權重，每題 24 筆逐題排名；小樣本分層文字沿用平面 fixture，沒有宣稱驗證完整 Parent 檢索。

預設關閉、全路失敗後文字回退、跨課／未授權影片、chunk allowlist、時間錯位及 FAQ 版本介面有回歸案例。正式 `qa.service.js`、LINE、S2／S3 未接線。Atlas 三路、全量媒體向量與正式 43 題尚待授權與整合。操作與精確接點見[橋接契約](04_Features/Multimodal_Retrieval/phase2-adapters.md)。

本輪使用 Node 22.23.4。新增橋接 8 項、連同既有 Atlas／RRF／三路模組 24 項通過。已保存向量驗證 3 題及 72 筆比較輸出，API／Atlas 呼叫均為 0。後端依既有全套命令執行，共 1776 項，首次 1765 通過、10 失敗、1 略過；10 項均為 short_render 缺少已鎖定的 iconify 套件，依現有 lockfile 執行 npm ci --ignore-scripts 後，相關 Recut 87 項與 runtime adapter 7 項重跑全過。未重新執行整套，保留首次結果與重跑紀錄。QA／LINE 回歸在本次全套中通過。原始本機證據位於忽略目錄 `.local-tools/phase2-validation/` 的 phase6-backend.tap、phase6-recut-retry.tap 與 qa-bridge.json。git diff --check 通過；本輪沒有前端行為修改，未跑前端 build。真實 Atlas／付費生成／正式 43 題與部署未執行。

## 多模態 Atlas 小樣本準備（2026-11-10）

2026-11-10 整合審查：已提交的檢索元件與工具審查通過，問答尚未接上多模態（沒有 `QA_MULTIMODAL_FUSION_ENABLED`、`retrievedBy`，43 題比較腳本也還沒有）；修正切片準備遇到超出影片長度的 chunk 會整支中斷的問題。接續點見[多模態進度](04_Features/Multimodal_Retrieval/evidence/進度.md)。

第五階段前置：新增專用 Collection／Index 的唯讀工具，準備原三筆／9 個真實 stable 向量，加入 Course／Video 雙 filter、兩版 RRF、本機排名比較與負向隔離探測。實查 `focusflow` 的 29 個 Collection 共 3 個 READY Search 索引，目標集合不存在，必要帳號權限可用；部署 tier／叢集剩餘配額與資源成本未核實，若為 Free 即已滿 3 個上限。Node 34 項通過、備份磁碟回讀與本機回復演練通過，尚未建立 Atlas 測試資源或執行真實三路查詢。等待 Weihao 確認配額及庭語另授權三筆寫入／索引建立／清理，不刪除正式索引、不自行升級。見[第五階段隔離驗證](04_Features/Multimodal_Retrieval/atlas-isolated.md)。

已實作獨立的本機 checkpoint 匯出、694 筆資料與索引備份、三筆受控寫入 Dry Run、索引差異／READY 輪詢、資料回復與 Atlas 三路 CLI。真實 Atlas 唯讀確認舊索引 READY、queryable，三筆舊向量自查詢各回傳 20 筆且自身排名 1；新三路 path 尚未建立，因此沒有真實三路搜尋成功的證據。Node 27、Python 29 項通過，真實切片＋Mock 候選的 MVD rescue 回歸成功。未做正式寫入、索引調整、額外付費呼叫、qa.service.js 整合或 43 題評測。建議三筆另存 stable 文字欄位的 B 方案，仍待 Weihao 確認契約與部署容量、庭語另授權寫入與索引操作。完整操作、取捨與回復方案見 [Atlas 準備說明](04_Features/Multimodal_Retrieval/atlas-preparation.md)。11/13 完整多模態／章節／RU／評測交付有時程風險，已提醒需 Weihao 支援。

## Recut 修正（2026-11-06，2026-11-10 核對合併狀態）

**已於 2026-11-09 透過 PR #11 合入團隊 `dev`，合併提交為 `8a4c181a`。** 2026-11-10 核對本機 Git 紀錄，合併提交已包含於本次拉取的 `dev`（`80791830`）。本輪僅確認 Git 合併；正式部署、發布與教師驗收未查證。

**2026-11-08 最終候選 `f708fa6`（程式），候選分支之後只有文件提交。** 第三次唯讀獨立審查（最終 diff，重點為 `e8d3c16` 之後）找到 1 項會阻擋交付的問題：版本不符時領取回錯誤，會讓已升級的 worker 在佇列只剩舊工作時自己停止；另有 2 項應修正（runtime 建立失敗時資料庫連線未關、輸出鎖殘留）。已在 `f708fa6` 修正並補回歸測試，同一位審查者複審結論為「接受，附註」。當日執行：backend `npm test` 1789 項 1788 通過、1 跳過、0 失敗；short_render `npm test` 165 項 164 通過、1 跳過，另設瀏覽器執行選用測試 4／4 通過。OpenAPI 未變更、未跑 `docs:lint`；`/recut-worker/jobs/claim` 在「只有版本不符的工作」時改回閒置，已記在 `backend/docs/recut-review.md` 與前端交接。提交身分稽核：本交付 15 筆提交的 author／committer 都是 `Weihao <11246062@ntub.edu.tw>`，沒有 AI trailer 或署名；提交都帶 SSH 簽章（金鑰 `SHA256:32dP45eSMmVSt/G/CGvcxl/P+MO3Nwj9xeTh/GSA2wc`，由執行環境提供），是否已登記到個人 GitHub 帳號尚未確認。Gemini schema 確認呼叫與教師審片仍待進行。

來源分支為 fork `Hao-weii/focusflow` 的 `wip/recut-cards-schema-fix`，從團隊 `dev` 的 `18aed4c` 切出，以候選 `955c7cb0` 合入。以下保留 2026-11-05 至 11-08 的試產、測試與審查紀錄，不作為 2026-11-10 重新執行的驗證證據。

2026-11-05 OpenCV 本機試產（教授影片 `aiA10_1140216_1.mp4` 18:04–20:26，本機 `recut_trial_opencv-20261105`，`gemini-3.8-flash`）：run-6 產出第一支可播放 MP4（46.5 秒），當天共 69 次 Gemini 外呼（含除錯），以回傳 token × 價目估算約 US$0.83，不是帳單。run-6 響度 −18.1 LUFS，不符決策 #62 的 ±2 LU；另有字幕跨剪接點 2.2 秒、scene-5 空白圖卡 3.18 秒、引言泡泡超出卡片 23 px、圖卡出現原話沒有的「大型模型」。

本分支修正：配圖 cues 改為清單（Gemini 400 的原因）；params 改為各元件獨立 schema（修正 compare 被 not-merge 覆蓋與跨元件欄位）；修正訊息附允許欄位與實際秒數；重複的修正失敗先改用定向修正、再停止並回 `RECUT_REPAIR_STALLED`；沒有 `trialPolicy` 的單題試產也在渲染前凍結 generation（`recuttrialgenerations`），可零呼叫重渲染；short_render 0.3.0 增益只套一次、字幕不跨剪接點、擋下空白圖卡、卡片文字超框時縮放或拒絕渲染。額度預設仍為 5。

修正版影片由 run-6 施工單離線重渲染，本階段 0 次模型呼叫：`revision-1`（43.3 秒，去掉 c3 尾端「當然啦」與 c4 開頭重說）與 `revision-1b`（45.5 秒，保留 c4 開頭重說）。兩支自動檢查都通過決策 #62 七項（−17.2／−17.1 LUFS、真峰值 −1.6 dBTP），沒有字幕跨剪接點、空白圖卡或文字超框。剪接改動會改變播放的老師原音，需重新核准講稿；c4 剪接點位於連續語音中，需人工聽音確認。run-6 沒有 generation checkpoint，也沒有資料庫綁定，無法用零呼叫重渲染流程回復，修正版不宣稱 checkpoint 來源。

驗證分三類。**本次新執行（2026-11-06，Node 22.23.4，程式候選 `6581ad0`）**：backend `npm test` 1787 項 1786 通過、1 跳過、0 失敗；short_render `npm test` 165 項 164 通過、1 跳過（需瀏覽器的選用測試），另設 `SHORT_RENDER_TEST_BROWSER` 單獨執行該檔 4／4 通過。之後只有文件提交。 OpenAPI 未變更，未跑 `docs:lint`。**真實本機堆疊驗證**（專用本機資料庫 `recut_trial_ckpt-verify-20261106`、假 provider、真實 CLI 與 short_render／HyperFrames／FFmpeg 渲染）：生成 3 次假呼叫後寫入 checkpoint 與資料庫綁定、刻意讓渲染失敗、另起程序重渲染 0 次 provider 嘗試並產出可播放 MP4（決策 #62 自動檢查通過）；被改、重算 hash、缺欄位、input／config 不同、腳本或來源已變的 checkpoint 都拒絕且未渲染；原 run 檔案與資料庫紀錄不變。**獨立審查**：兩輪唯讀審查（第二輪針對 `936430d` 之後的 7 筆）提出的問題已修正，包含 checkpoint 前提改在任何模型呼叫前檢查、worker 不再被版本不符的工作擋住。**未執行**：以真實 Gemini 確認新 schema 會被接受（新 schema 約 4.9 KB、124 節點；舊版 4.5 KB 已確認可用、20 KB 被拒；確認呼叫待授權）、前端、人工 code review、教師審片。2026-11-05 與先前的雲端測試結果是歷史紀錄。

## Recut 交付候選檢查點（2026-11-05）

前端串接準備度為 **CONDITIONAL**：可依 [OpenAPI](../backend/docs/openapi.yaml) 與[前端交接](../backend/docs/recut-integration-handoff.md)開發，但正式使用仍需設定、正式 UI、外部服務與人工驗收。[工程報告](07_HTML說明頁/Recut工程交付報告.html)是本日快照，後續狀態以本節更新為準。

本機 `feat/recut` 已快轉整合最新 `origin/dev` `8c0a5e0`（合併提交 `574daf2`），程式驗證點 `2232036`，recut 來源 `9ad9407`；交付範圍為 dev 協作分支，本輪未執行 main 或部署。獨立審查發現共用 provider 重試在 503 headers 已到、body 卡住時未釋放舊傳輸的 P2，`2232036` 在重試前中止被丟棄的傳輸，保留成功回應期限與取消行為。作者定向 57 項及獨立 60 項、native probe／cleanup matrix 通過，P2 已關閉；這不是教授 cards 失敗原因的修復。原 `8c0a5e0` 合併後全套主動中斷，不作通過證據；最新來源 `2232036` 完整 backend 全套 1,750 項、1,748 通過、0 失敗、2 跳過、0 取消，174 suites、exit 0，耗時 1,541,837 ms；481 個執行時 tracked 檔起訖 SHA-256 無差異。兩項跳過為 Windows symlink 與 consent Mongo opt-in；fencing suite 註記不另算第三項，專用 Mongo 已另驗 6＋1。前一候選 `028f8f8` 全套 1,712 項、1,710 通過、0 失敗、2 跳過、0 取消、exit 0，不能代替最新來源結果。較早 fresh 隔離 Mongo 租約 6／6、同意 1／1，renderer 148／148、0 跳過；Windows symlink 未驗證。本機 ignored 日誌不隨 Git 交付。

`ce4a76f` 自動組裝 backend runtime，fake HTTP 202 → queue → script_review 測試 7／7；`1da5097` 加入可持久保存的 render-ready 通知，fake 測試 22／22。這些是本機替身測試，不代表真服務或教師驗收。正式前端尚未串接 recut，現有網頁仍是八拍流程；管理員正常配置一次並維持 RC7 worker 常駐後，目標流程才是教師審完整講稿、再審實際 MP4，並待遠端 ready 與當前成品核准雙閘門成立。

獨立複核 core／consent 80／80、worker render／process 8／8；受限 sandbox 的 loopback 出現 EACCES，限定升權後 fake HTTP 15／15 通過。fresh 隔離 Mongo 租約 6／6、同意 1／1；後者使用的隨機資料庫保留，未刪除教授資料。對應測試及本機紀錄可由[工程報告](07_HTML說明頁/Recut工程交付報告.html)追溯。

**交接限制：**RC10 決策 #78 要求即使功能開關關閉，上傳仍先檢查內容同意；現有前端尚未接上，舊上傳流程在缺少有效內容同意時會收到 409。可供前端開發與 dev 整合，不能直接部署 main。使用者已授權本次合併並 push dev；部署流程僅 main push 觸發。

工程報告本身的離線瀏覽器複核通過 1440／390／360 寬度、六情境、12 個節點、8 種發布條件與鍵盤操作；這不是正式前端或教師驗收。

R2 獨立畫面複核：三種新卡 30 圖與 code 15 圖（短合成範例）通過；catalog 的 aiOnly 為 12，code 仍為 RC6 專用。這不代表真實課程影片或真人審片驗收。

教授授權原片經 CPU small ASR，45.03 秒、441 words、24 句；首尾截斷句 s1／s24 禁選。前三次 provider 呼叫取得用量，第三次選段成功；原 cards 工作嘗試被本機大小 guard 阻擋，未出站。`5102638` 將 cards payload 從 104,529 降至 36,144 bytes，保留選句原始 words／timing 與完整驗證。

實際受控續跑的第四次 provider 嘗試為 cards，36,144 bytes、4,603 ms，回 `RECUT_MODEL_FAILED`、usage null；HTTP 類型與遠端是否收件或計費尚不明。保守計額 provider 4 次、workflow 5 次，reservation 累計 US$0.1659405；原上限 5 次與 US$0.50 不變，僅餘一次，不足 cards 與必要 wholeCheck 兩步。永久 claim 不重置，也不自動付費重試；目前無 generation checkpoint 與 MP4，教授試片 **BLOCKED**，需額外決策。紀錄為本機 ignored 的 `short_render/out/professor-resume-cards-check-20261104/run.json` 與 `progress-checkpoint.json`。目前 adapter 將 HTTP 400／429／500／503 與網路錯誤折疊為同一代碼，未保存 HTTP 或 provider 狀態，因此無法回溯本次原因。cards schema 為 19,917 bytes、330 nodes、317 properties、210 optional、深度 8；複雜度只是候選風險，不能推定為 400 或服務故障。後續建議以白名單保存狀態碼、provider 狀態列舉、失敗階段及 schema hash／大小，不保存原始錯誤、本文、header 或 prompt；schema 瘦身另列改善，均尚未實作。正式十題、RC12 原音正式驗收與模型下載未授權；正式部署、真 YouTube／LINE、正式前端與真人審片未驗證。

## 各模組

**httpOnly cookie 認證｜已部署；2026-10-25 正式環境驗收通過。** 2026-10-25 13:13 部署到正式站（`main` = `d3de1ef`），部署探測與瀏覽器驗收通過，過程、Atlas 寫入與 VM 設定見[上線紀錄](10_Operations/deployment/2026-10-25_httpOnly_cookie認證上線紀錄.md)；正式站未測 step-up 與信任裝置，nginx 未轉送 `/uploads` 為既有問題。2026-10-24～25 已接上後端、前端及 deploy.yml，依[決策第 1～25 項](04_Features/HttpOnly_Cookie/decisions.md)完成獨立逐條審查及修正後複核。已修正 pending／忘記密碼重寄與猜碼次數的競態、admin 驗證失敗稽核、OpenAPI 描述及登入恢復重試按鈕遮擋。2026-10-25 依使用者補充定案完成升權撤銷：學生／教師實際升為 admin 時，同次更新角色與版本、撤銷全部憑證；重新登入並通過信箱兩段式驗證，才取得 12 小時新 session。原 admin 僅編輯姓名不撤銷，session 刪除故障也不放行舊憑證。原審查 findings 已全部處理，本輪完整後端測試通過。

| 驗證範圍 | 結果（本機 2026-10-24～25；正式環境另註日期） |
|---|---|
| Backend | 全套 1,154／1,154 通過；OpenAPI lint 通過，docs route 11 項通過。含 CSRF、Node fetch 分流、資料庫故障拒絕、撤銷、升權重登／MFA／12 小時效期與 GET 例外盤點 |
| 隔離 Mongo | 11／11 通過：索引重跑與衝突、真實 TTL、80 次並行簽發、單次驗證消耗、重寄計數與競態、原子版本遞增、最後一位 admin 保護，以及學生／教師升 admin 的舊憑證撤銷與新 12 小時 session；未連 Atlas |
| Frontend／workflow | 116／116、lint、相對 API 設定的 build 通過；deploy.yml 的 YAML、3 段 Node、21 段 Bash 語法通過；相同 dist 掃描通過（29 檔），在服務重啟前執行。原有非相對 API 環境設定會被 build guard 拒絕；未改本機 .env |
| 本機 Chromium＋Vite proxy | cookie 屬性、同來源 Network、重新整理、登入登出、全裝置登出、多分頁換帳號、admin 兩段式驗證與信任裝置、首次登入、註冊信箱驗證、step-up、影片上傳與 /uploads 讀取、頭像、回饋附件、跨來源表單 403、網路故障後重試通過；2026-10-25 另驗證升權後目標舊登入遭拒、畫面清除、操作人維持登入，目標重新 MFA 後取得 12 小時 cookie。使用記憶體資料與假寄信，影片只驗證上傳／讀取，未做 STT |
| 原有腳本 | runQaEval 用 mock／template 跑 1 題、0 錯誤；verifyShortsDeployment 經 fetch 登入通過，允許空 feed 且不查 YouTube；未呼叫付費服務 |
| 正式環境（2026-10-25） | 第 15 項第 6 層通過：真實寄信、admin 首次登入與兩段式驗證、教師與學生首次登入、cookie 屬性、同來源 Network、多分頁與全裝置登出、頭像與回饋附件、LINE 內建瀏覽器與 Email 連結進站恢復登入、部署探測（舊 JWT 拒收、登出即失效）。step-up 與信任裝置未在正式站測 |

**帳號、課程與管理功能｜已實作。** 範圍含登入、修課、通知、頭貼、統計及問題回報；依據：[路由入口](../backend/src/routes/index.js)、[帳號介面](../backend/src/routes/auth.routes.js)、[課程權限](../backend/src/services/courseAccess.service.js)。最後驗證：2026-10-14；負責人：＿＿（待填）。

**網頁操作｜已實作。** 範圍含角色頁面、課程影片、問答與上傳操作的後端呼叫；依據：[應用程式入口](../frontend/focus-flow/src/App.jsx)、[課程頁](../frontend/focus-flow/src/pages/StudentCourses.jsx)、[上傳頁](../frontend/focus-flow/src/pages/TeacherUpload.jsx)。瀏覽器操作結果 ⚠️ 未驗證。**已知問題（待修）**：2026-10-25 正式站發現首頁（未登入的介紹頁，`App.jsx`）在視窗較窄時跑版，例如桌機開著 DevTools、可視寬度約 900px：介紹卡片的「立即開始」按鈕被卡片底部切到，左側圖塊與統計卡片互相重疊；需另排時間修正並檢查手機寬度。最後驗證：2026-10-14；負責人：＿＿（待填）。

**文字問答與多輪對話｜已實作。** 含課程範圍檢查、來源引用、常見問題快取及對話紀錄；快取是保留可重用回答以減少重複計算。依據：[問答服務](../backend/src/services/qa.service.js)、[對話服務](../backend/src/services/conversation.service.js)；回答品質與外部模型 ⚠️ 未驗證。最後驗證：2026-10-14；負責人：＿＿（待填）。

**LINE 綁定與問答｜已實作。** 含訊息驗簽、帳號綁定與問答接線；依據：[LINE 介面](../backend/src/routes/line.routes.js)、[訊息處理](../backend/src/services/line.service.js)。2026-11-04 正式站以一個帳號在手機實測收送訊息正常，見下段。最後驗證：2026-11-04；負責人：＿＿（待填）。2026-11-10 整合審查修正了停用帳號仍可在 LINE 提問、回答卡第一筆引用可能連到別段等問題，2026-11-11 再補上 webhook 重送去重、LINE API 逾時、教師首頁網頁與 LINE 提問數分開顯示，以及回呼頁兩個操作卡點。以上都只有替身測試、尚未部署與實機驗證，見 [LINE 進度](04_Features/LINE_Binding/evidence/進度.md)。

**LINE Login 綁定與圖文選單｜已部署，正式站手機實測通過（僅一個帳號）。** 依 [LINE 決策](04_Features/LINE_Binding/decisions.md) LL、LM～LM4：學生按「連結帳號」到 LINE 授權後就完成綁定，不需綁定碼；未綁定看到「連結帳號」選單，綁定後換成 2×2 四格「切換課程、今日額度、使用說明、網頁版」，解除時換回；另有「今日額度」「使用說明」指令、課程卡片直接選課與回答分段。依據：[LINE Login 服務](../backend/src/services/lineLogin.service.js)、[選單服務](../backend/src/services/lineRichMenu.service.js)、[建立腳本](../backend/src/scripts/setupLineRichMenus.js)。2026-11-04 部署 `07c8c30`、`2d5e4d2`；LINE Login channel「FocusFlow 綁定」改為 Published，VM `backend/.env` 設定 `LINE_LOGIN_*` 三項與 `LINE_RICH_MENU_BOUND_ID`。同日以一個帳號在手機實測：解除綁定後選單換成「連結帳號」→ LINE 授權 → 綁定成功 → 選單換成 2×2。未測：從未加好友的帳號與歡迎訊息、電腦版 LINE、LINE 已綁定其他帳號的衝突、多位學生同時使用。後端完整測試有三支既有逾時測試會卡住整輪，本次排除未驗證（見決策 LM4）。最後驗證：2026-11-04；負責人：＿＿（待填）。

**單支影片與語音轉文字｜已實作。** 後端啟動處理程序，產生逐字稿、切段與搜尋向量，再接收完成或失敗通知；向量是用來比較內容相似度的一串數字。依據：[影片服務](../backend/src/services/video.service.js)、[處理入口](../STT_Whisper/src/main.py)、[回報處理](../backend/src/services/videoProcessing.service.js)；真實影片完整流程 ⚠️ 未驗證。最後驗證：2026-10-14；負責人：＿＿（待填）。

**YouTube Lifecycle F3／F4、Q-A～Q-F｜本機開發及隔離驗收完成；未部署。** 2026-10-29：F3／F4 經獨立複驗後，以 `b2feceb` 提交、`6cd381b` 合併至 dev；Q 共用契約 `3dc8c92`、後端 `ae8d22b`、前端 `5a0ee05`。範圍含額度暫停與單支試傳、租約與傳送階段、就緒／隱私政策、受保護 Range 播放、容量預約及半成品清理、教師與管理頁、來源切換續播與錯誤提示。隔離 Mongo **94／94**、Frontend **158／158**、lint／build／OpenAPI lint 通過，Chrome／Edge 三角色與原片起播／拖曳通過、延遲回應競態各 **7／7**；Backend 完整回歸共 1280 項（1278 通過、1 個舊開關數斷言失敗、1 項 OS 權限跳過）；修正斷言後該檔 13／13 複驗通過，沒有未解失敗。獨立審查確認三項 P2 已修復，沒有已知 P1／P2 合併阻礙；證據及驗收邊界見[本機整合驗證](04_Features/YouTube_Lifecycle/evidence/2026-10-29_q-integration.md)。沒有 push、部署、正式 Atlas／VM／YouTube 操作或正式清理。原片播放與 privacy_guard 預設仍關閉；Firefox／iOS Safari、正式 nginx／500 MB／中斷／507／20 個 Range、第一次實際 YouTube 隱私讀回與學生嵌入需另行授權或設備驗證。清理必須先通過 Q-B 正式就緒驗收，原 #33 的日期不能直接當啟用條件。

以下 YouTube 段落保留歷史時點，不能用來推定本輪正式環境現況。

**YouTube 上傳｜已實作。** [上傳服務](../backend/src/services/youtubeUpload.service.js)由[影片完成通知](../backend/src/services/videoProcessing.service.js)排程，受功能開關與憑證條件控制。2026-10-22 部署後正式站憑證檢查為 `ok`、權限含 `youtube.force-ssl`（見[上線紀錄](10_Operations/deployment/2026-10_YouTube恢復與清理上線紀錄.md)）；經新版程式實際上傳的結果未驗證，延後到團隊下次上傳課程影片時確認。最後驗證：2026-10-22；負責人：＿＿（待填）。

**YouTube 恢復／清理｜已部署；恢復已開啟，清理未開啟。** 依[設計決策](04_Features/YouTube_Lifecycle/decisions.md)實作兩層開關、定期[恢復排程](../backend/src/services/youtubeUpload.service.js)、依空間與保留期的[原片清理](../backend/src/services/youtubeLifecycle.service.js)與刪除預告、管理員[隔離收尾](../backend/src/services/youtubeQuarantine.service.js)（含已達重試上限的項目）、補回原片，短片成品一併納入；管理員操作在「YouTube 上傳管理」頁。2026-10-22 合併 `main` 部署到正式站（本機 Backend 1123、Frontend 107 項測試通過），恢復排程每 5 分鐘執行、管理員頁開關與待處理清單正常；清理的環境變數維持不允許，依決策 #33 於 2026-11-09～11-13 開啟。實際失敗後的自動恢復、清理刪檔與短片流程在正式站未驗證，過程見[上線紀錄](10_Operations/deployment/2026-10_YouTube恢復與清理上線紀錄.md)。最後驗證：2026-10-22；負責人：＿＿（待填）。

2026-10-27 收尾複驗（分支 `fix/youtube-lifecycle-review`，本機提交／未合併／未部署）：**F0～F2 可結案，FR01～FR06 PASS；沒有未解決的已知 P1／P2 程式合併阻礙，建議進入 Commit／Merge 整合。** 已確認 NR01 P1 的 intent 接管／刪檔收尾，以及 NR02 P2 的課程刪除交易／持久外部待辦；本輪另重現並修正外部請求無回應會卡住排程的 P2，加入含回應本文的 30 秒期限。最終 Backend 全套 **1199／1199**、隔離 Mongo **62／62**、`docs:lint` 與 `git diff --check` 通過；真實 120 秒租約 **58／58**、standalone 拒絕 **1／1** 沿用未受本輪修改影響的證據，沒有重跑同樣的長測試。判定是本輪程式審查與隔離驗證，不宣稱另一位未參與修復的獨立審查者或正式環境驗收；詳見[最終報告](04_Features/YouTube_Lifecycle/evidence/2026-10-27_f0-f2-final-review.md)。前輪 [FR 修復](04_Features/YouTube_Lifecycle/evidence/2026-10-27_fr01-fr06-fixes.md)與 [NR 交接](04_Features/YouTube_Lifecycle/evidence/2026-10-27_nr01-nr02-fixes.md)保留歷史結果。部署前仍需確認交易能力、所有 writer 升級與原有啟用門檻。沒有實作 Q-A～Q-F、F3／F4，未連 Atlas、VM 或真實 YouTube，未 Push、Merge 或部署。

2026-10-27 本機整合：使用者授權提交 F0～F2 修復與證據。合併前發現本機 `dev` 與修復分支已分歧（`dev` 獨有 8 個 commit，修復分支提交前獨有 3 個），無法 fast-forward；依使用者停止條件保留本機提交並暫停合併，不自行 rebase 或建立非 fast-forward merge。主工作目錄的第三輪 7 份規格與其他未提交檔案均不切換、不提交、不覆蓋。

2026-10-27 後續整合：F0～F2 已以 `5f60c12` 本機合併至 dev，前段「未合併／快轉受阻」保留當時記錄。本次將第三輪 YouTube 決策 #35～#64、Q-0 共用契約及 Q-A～Q-F 工單依主題提交並整合；#51～#64 定案原文完整保留，契約已對齊現行 claim update、attempt heartbeat、cleanup intent、持久備份與交易式刪課。這是純文件整合，沒有開始 F3／F4 或 Q-A～Q-F；F3／F4 仍為後續 Q 開始前的既定門檻，實作與正式環境操作均須另行授權。多模態、開放資料及競賽文件另作本機提交，沒有混入此次 dev 文件整合。

以下保留 2026-10-26 初次實作的歷史測試記錄，不作 FR01～FR06 已結案的依據：

| 問題 | 修改入口 | 測試證據與限制 |
|---|---|---|
| F0 快照／憑證 | [harness](../backend/tests/helpers/backendTestHarness.js)、[quarantine fixture](../backend/tests/youtube-quarantine.service.test.js) | backend 全套 1158／1158；fixture 補強後直接回歸 28／28。Date／ObjectId／Buffer、雙向隔離、主別名與 fetch 失敗還原均有案例 |
| R01、R02 | [實體檔辨識](../backend/src/utils/localVideoSource.js)、[共同清理判斷](../backend/src/services/localSourceCleanup.service.js) | [清理安全測試](../backend/tests/youtube-cleanup-safety.service.test.js)：跨集合／草稿／處理中引用、相對與絕對路徑、hard link、根外、Windows junction 與 Linux 容器 symlink；未讀 VM |
| R08、R09 | [清理排程](../backend/src/services/youtubeLifecycle.service.js)、[短片清理](../backend/src/services/shortAssetCleanup.service.js) | 同上測試與既有 lifecycle：逐檔讀空間、失敗後補選、刪檔前停用／設定失敗、保留期／補回重算、影片與短片 DB 收尾恢復；F1 全套 1171／1171，最後細修另跑相關 67／67 |
| R03 | [來源所有權](../backend/src/services/youtubeWorkOwnership.service.js)、[補回／既有重處理](../backend/src/services/video.service.js) | [F2 競態測試](../backend/tests/youtube-work-ownership.service.test.js)與[補回路由](../backend/tests/video-source-restore.routes.test.js)：同步取得輪次鎖、候選後路徑／時間／狀態／代數改變、真正補回後拒絕舊候選、最後設定等待中阻止審核／封存回復改草稿，另以真實 Mongo 驗證 |
| R04、R05 | [影片上傳](../backend/src/services/youtubeUpload.service.js)、[短片上傳](../backend/src/services/shortAssetPublish.service.js)、[短片恢復](../backend/src/services/shortAssetRecovery.service.js) | F2 競態：A／B 候選與教師重試交錯、unsafe／退避／上限、所有開始入口共用排他權、舊 attempt 拒絕回寫、DB 失敗不送 bytes、上傳後回寫失敗不再重傳、上傳中仍可審核且封存後不重新上架；YouTube 全為 mock |
| R06 | [隔離套用](../backend/src/services/youtubeQuarantine.service.js)、[共同備份檢查](../backend/src/services/youtubeWorkOwnership.service.js) | Video／Video 與 Video／ShortAsset 同 ID 競爭、驗證與回寫失敗釋放、歷史重複備份拒刪；採工單允許的單一 writer 限制，不是跨行程 DB 唯一性，詳見[實作約束](04_Features/YouTube_Lifecycle/decisions.md#f-工單的實作約束2026-10-26) |

2026-10-26 F2 整合：backend 全套 1199／1199、Windows 與 Linux 容器清理／所有權各 41／41、隔離 Mongo 14／14 通過（未載入記憶體 harness；明確 loopback URI、隨機 DB、成功與失敗移除 DB；另驗證 null／缺欄位初次上傳、略過上傳及重啟遺留 token 隔離）。測試只處理自建暫存檔，沒有連 Atlas、VM 或真實 YouTube；未執行 STT／FFmpeg、前端／瀏覽器及決策 #33 的正式驗收。

2026-10-27 F3／F4 修復（`fix/youtube-lifecycle-f3-f4`，基於 dev `b35c121`；未提交、未合併、未部署）：R07 已加入 completed 影片補回後的明確重新處理，沿用 F0～F2 原子來源所有權，保留 Video／YouTube ID、播放與保留期；R10～R12 已修正總覽有效開關、雙來源 7 天預告清單與並行 history。Backend **1208／1208**、隔離 Mongo **68／68**、Frontend **118／118**、真實元件瀏覽器（假 API）**8／8**，lint、build、OpenAPI lint、文件連結與 `git diff --check` 通過。未發現已知 P1／P2；程式與本機驗證達可提交候選標準，依既有 F 工單仍須獨立 diff 複驗後整合。本輪沒有驗證真實 STT／FFmpeg、YouTube、Atlas、VM 或正式清理，沒有實作 Q-A～Q-F；第三輪 #51～#64 與 Q-0／Q 工單完整保留。詳見[修復與驗證交接](04_Features/YouTube_Lifecycle/evidence/2026-10-27_f3-f4-fixes.md)。

**多影片批次｜已實作。** [批次服務](../backend/src/services/videoBatchProcessing.service.js)與[批次入口](../STT_Whisper/src/batch_main.py)串接排程、重試及恢復；真實語音模型、向量產生與部署的完整流程未驗證。最後驗證：2026-10-15；負責人：＿＿（待填）。

**學生短影片瀏覽｜已實作。** [短影片頁](../frontend/focus-flow/src/pages/StudentShortsWall.jsx)串接[學生介面](../backend/src/routes/youtube.routes.js)。較新紀錄：[2026-09-29 後端整體回歸](../backend/docs/implementation-log.md)（原文為工作分支紀錄，非正式環境驗收）；直接相關的[縮圖測試](../backend/tests/shorts.routes.test.js)於 2026-09-27 加入（Git `d8360fc`，未記載單項執行結果）。最近播放驗收仍為 2026-08-13（限當時環境），未找到更新的播放驗收。最後驗證：2026-10-15；負責人：＿＿（待填）。

**短影片腳本｜已實作；上架未驗證。** [腳本介面](../backend/src/routes/short-script.routes.js)串接選題、生成、成品上傳與審核；[發布服務](../backend/src/services/shortAssetPublish.service.js)處理 YouTube 上傳與審核後提供學生瀏覽。最後驗證：2026-10-15；負責人：＿＿（待填）。

**短影片自動產片｜開發中。** RC1 資料／狀態機／背景工作、RC2 視窗／原片檢查／辨識包裝／切句、RC3 設定轉接／選段判斷／逐字驗證、RC8 教師審閱／草稿／採納建議／核准／計時已完成本機實作；介面見 [RC1](../backend/docs/recut-foundation.md)、[RC2](../backend/docs/recut-source.md)、[RC3](../backend/docs/recut-selection.md)、[RC8](../backend/docs/recut-review.md)。2026-10-29 Node 22.23.4 的 backend 全套 1322／1322、隔離 loopback Mongo 6／6、OpenAPI lint 與文件路由測試 11／11 通過。RC2 專屬19項、RC3專屬21項、RC8專屬39項，8拍程式與既有測試未改。子 agent 已複核選段草稿與審閱API契約；外部工具及模型皆注入假實作。未執行真實辨識、Gemini、渲染、VM／Atlas／YouTube、前端或人工驗收；完整管線待 RC4、RC5，S1 尚用轉接。後續依 [HANDOFF](04_Features/Short_Video/HANDOFF.md) 接續，完整獨立審查排定 11/6 起。

**分層檢索與向量發布｜⚠️ 待決。** 依實際資料與部署環境判斷，相關部分未驗證。分層檢索是先找較大段落，再找可引用的小片段；[檢索服務](../backend/src/services/hierarchicalRetrieval.service.js)、[資料檢查](../backend/src/services/hierarchicalDataReadiness.service.js)與[發布入口](../STT_Whisper/src/publish_parent_embeddings.py)有對應程式，不據此判定可啟用。最後驗證：2026-10-15；負責人：＿＿（待填）。

**影像補充引用｜已實作；實際資料覆蓋未驗證。** [問答服務](../backend/src/services/qa.service.js)串接影像查詢與來源引用，但仍需另查課程影片是否有可用影像資料。最後驗證：2026-10-15；負責人：＿＿（待填）。

**教育開放資料推薦｜已實作。** [推薦服務](../backend/src/services/openDataExtension.service.js)與[課程頁](../frontend/focus-flow/src/pages/StudentCourses.jsx)以關鍵字推薦延伸影片。程式已隨 2026-10-22 部署上線，但正式站 `OPEN_DATA_EXTENSION_ENABLED` 未開、未匯入清單；真實清單匯入與推薦品質 ⚠️ 未驗證。最後驗證：2026-10-22；負責人：＿＿（待填）。

**資料庫交付工具｜已實作；真實資料還原未驗證。** [匯出與還原服務](../backend/src/services/databaseDeliverable.service.js)有對應程式；舊文的記憶體模擬測試不代表實際資料庫還原成功。最後驗證：2026-10-15；負責人：＿＿（待填）。

**學生試用與部署｜⚠️ 待決。** 依實際資料與部署環境判斷，相關部分未驗證。[部署設定](../.github/workflows/deploy.yml)只能證明部署步驟存在；歷史開放試用不等於本次驗收，需補目前環境與驗收紀錄。2026-10-23 VM 資安更新完成：Rocky Linux 9.8、Node.js 22.23.4、nginx 安全修補與 ngrok 更新，重開機後 `/health`、nginx 代理與 LINE 問答實測正常；語音轉文字流程更新後未實測。2026-10-30 查證 VM 核心受 CVE-2026-98432 影響，Rocky 尚未發布修補，等待中；同日檢查未發現入侵跡象，並將 `focusflow` 的 sudo 縮到部署所需兩個指令、關閉 root 直接 SSH 登入（縮權後的實際部署未驗證）；Node2Shell（CVE-2026-111497）已由 Node.js 22.23.4 與 `libbrotli` 安全更新修正；見[檢查報告](10_Operations/deployment/2026-10-23_VM資安檢查報告.md)。最後驗證：2026-10-30；負責人：＿＿（待填）。

## 歷史查證索引（保留原日期，未重新驗證）

以下是舊文記載的結果，不作為上述模組的本次驗收證據；舊數字不再列為現況。

- 2026-05-23／07-10／07-24／08-02：資料庫數量、向量索引及欄位分布的歷史查詢；完整數字保留於下述 Git 版本。
- 2026-07-26：帳號、通知與頭貼的隔離測試；2026-08-02：YouTube 上傳與刪除後轉私人影片的外部測試，均為舊文紀錄。
- <a id="2026-08-13-多影片批次整合與隔離重啟驗收"></a>2026-08-13：短影片播放驗收；批次隔離測試為「兩支影片 → 一支完成、一支失敗，重啟後保留結果」，另一教師讀取回 403；2026-08-14：單項重試與前端批次契約補強。未涵蓋真實語音模型或部署。
- 2026-08-09／08-13：分層檢索的本機契約與資料檢查紀錄，未能證明目前共用資料庫可用；2026-08-30：[後端第一階段本機測試](04_Features/Student_Pilot_Backend/evidence/2026-08-30_phase1-implementation-results.md)，不等同正式驗收。
- 2026-08-24：[問答品質評測](04_Features/QA_Evaluation/reports/2026-08-24-評測結果.md)；2026-09-10：[憑證申請](10_Operations/deployment/2026-09-10_Lets_Encrypt憑證申請紀錄.md)；2026-09-21／09-23：[開放試用與外部檢查](10_Operations/deployment/2026-09_開放學生試用紀錄.md)。2026-09-24 使用量只代表當時樣本。
- 2026-09-29：舊文記載影像資料尚未綁定課程影片；2026-10-03：推薦功能僅本機實作；2026-10-07：資料庫交付工具僅模擬測試；2026-10-14：本機產片工具紀錄，未宣稱系統串接或部署。

完整舊文（含其餘測試日期、原始數字與會議紀錄）保留在 Git 版本 `9140f9ec58beff5cc21cb97486bc4864f6898eec`，不另建一份狀態文件。查閱例：在 repo 根目錄輸入 `git show 9140f9e:docs/current-status.md` → 顯示整理前原文；把路徑換成 `backend/docs/current-state.md` 可查後端舊文。歷史文字與目前程式有差異時，以程式及新查證為準。

## 2026-10-29 recut 交付候選（進行中）

候選 worktree：`C:/Users/User/Documents/GitHub/_worktrees/focusflow/recut-delivery`；分支 `integration/recut-delivery-20261029`，整合基底 `0be742c`（dev `66caba4`＋recut `130aa4f`）。舊路徑 `D:/AI-workspace/focusflow-recut-delivery` 保留為相容 junction，兩者是同一份 checkout；後續直接接續此候選，不另建或搬移。正式前端與兩份已定案決策保留。

本輪 DoD：先完成 recut 成品核准／退回、ShortAsset review 與 YouTube ready 雙向發布及失敗修復；再接 RC4／RC5／RC6、本機 CLI，完成可隔離驗證的 RC7 後端 worker 身分／租約／成品回傳與 RC10 同意／撤回。每項必須有本輪 fake/記憶體或專用 loopback Mongo 證據，最後獨立審查、修正與全套檢查後才稱候選完成。歷史測試數字不作本輪證據。

當次外部服務、Atlas、VM、真 YouTube／Gemini、正式部署與人工驗收未執行；後續 Gemini 試產見上方 2026-11-04 檢查點。正式前端 UI 不在本輪。RC12 因原音技術試跑尚未通過且模型下載未授權，維持 BLOCKED；合成語音選項須明確回未就緒。

2026-11-01 本輪續接：成品核准同步 RecutApproval 與 ShortAsset 的精確 versionId／assetId／generationVersion；退回依呈現／內容分流，YouTube ready 與核准任一先到均可接續發布，中斷後修復同一成品。RC7 後端已加入雜湊 worker 金鑰、FIFO、10 分鐘租約、3 次派工上限、版本核對、受限原片下載、成品檢查與可恢復回傳。以禁止 dotenv 讀檔的 preload 執行 fake/harness targeted 58／58、路由契約 11／11、OpenAPI lint 通過；尚待跨程序 Mongo 競爭驗證、renderer／pipeline 整合、RC10 gate 與最終獨立驗證，不能據此稱整體完成。

候選已依序合入當次 `origin/dev` 與本機 `dev` 已提交文件，以及 renderer core／hardening、pipeline 與單題工具四筆原始提交。新增 Mongo mutation lease 與 revision／token fencing；專用 `127.0.0.1:27029` 資料庫驗證跨 Node 程序互斥、失效 token 拒絕、同工作僅一次派工與過期 lease 接手，與外部服務隔離。仍須整合最新 chunk 版本契約、RC10 與完整 fake E2E 後交獨立驗證。

2026-11-02 續接：後端整合由 `delivery_backend_resume` 負責 shared models／services／routes／harness／OpenAPI 與啟動組裝；`delivery_consent_resume` 負責 RC10 專屬同意模組；`delivery_pipeline_runtime` 負責 pipeline 與本機 CLI runtime。後端接續 DoD 是完成 RC4 真正註冊入口、API 與審閱共用 queue、持久化建議、RC10 在排程／worker／上傳／發布的實際閘門及撤回處置，再由最終驗證者序列執行全套與獨立審查。

本輪已完成 `45dfd69`：凍結證據與 RecutSource 保存逐字稿版本，異版不回查 chunk，審閱使用快照並提示來源更新；targeted 69／69、補強斷言後增量 4／4、OpenAPI lint 通過，均預載 `noDotenv.cjs` 且外部服務使用替身。`c0bc4ac` 已合入最新 `origin/dev`（`66f45fc`，含本機 dev `2d4ebc9`）；四份 LINE 定案文件與該 dev 一致。尚未完成本輪全套、完整 fake E2E、RC10 整合及最終獨立驗證，不據此稱候選完成。

2026-11-02 接續檢查點：程式整合 HEAD `abb60bb9`。`7c25e15` 抽出不讀設定的來源純演算法（19／19）；`42c3ada` 已實作惰性 application factory、API 與審閱共用 queue、建議持久化（18／18）。RC10 四筆已合入為 `905e21ef`、`866d544b`、`7d4f4b21`、`218ab5f8`；runtime 四筆已合入為 `c97d63e`、`fcf01a00`、`77aa47df`、`2f9b0630`。worker client 原 owner 的程式與文件已合入為 `94c85fe7`、`abb60bb9`；其 145／145 為 owner 本機證據，候選最終全套另驗。

shared backend 已以 `b73ed48` 接上同意閘門、撤回實際取消／封存／轉私人待辦與通知、harness 及跨模組測試。跨模組撤回 6／6 通過，包含未選中已發布成品保留、選中成品封存、管理員去重通知，以及發布 CAS／YouTube 已送 bytes／渲染成品建立三種交錯。factory 4／4 含真 HTTP controller（缺配置 503、配置後生成及建議重跑）與 runtime factory 接 RC2～RC4 三次 fake 判斷。shared／worker／queue／契約 targeted 63／63、OpenAPI lint 通過；上傳／批次／短片回歸 115 項中 114 項通過，唯一舊 fixture 缺少新課程同意已補成真 HTTP「409 → 明確同意 → 201」，其後該項與最新撤回增量 7／7 通過。尚未以完整新一輪全套取代上述分段證據。

最後四筆 pipeline／worker 合入後，factory 與三次選段增量 25／25 通過，包含真 HTTP 與實際 adapter 建構；外部仍全 fake。接續順序：處理已派給 pipeline owner 的獨立審查問題及教授原片本機 bootstrap → shared backend 修後獨立複驗 → 受影響子系統全套與 HTML 檢查。使用者已授權 `D:/User/Weihao/Videos/短影音測試用/原始上課完整片段` 內指定教授影片的本機試產；本輪教授試產 owner 回報重新執行 CPU small ASR 成功（45.03 秒、441 個有效 word、24 句），優先使用這份新辨識結果。較早 CPU／GPU 記憶體錯誤與 `legacy-cached-20261014` 快取仍為歷史紀錄，不把快取說成本次 ASR 成功。使用者另已授權單題 Gemini 費用不超過 US$0.50，後續試產固定 `gemini-3.8-flash`、最多 5 次、每次 output 4096，不傳原始影片且不使用備援模型；此段為當時授權紀錄；後續實際呼叫見上方 2026-11-04 檢查點。Atlas、YouTube、VM 仍未執行。尚無真實 recut MP4、正式部署或人工網頁驗收證據；fake 生成與審閱成功不能代替這些驗收。既有教師 UI 尚須補接同意請求，操作契約見[後端審閱介面](../backend/docs/recut-review.md#同意閘門與撤回整合)。

### shared backend 五項初審問題的修後檢查點

| 初審問題 | 本輪處理與證據 | 尚待 |
|---|---|---|
| feed 過濾後空頁拋錯、後方有效成品遺漏 | `dd57410` 持續掃描到滿頁或耗盡；新回歸 2／2 通過 | 非作者複驗 |
| 真 Mongo 隱藏 leaseHash 使撤回取消失敗 | `fa2995e` 明確 select 隱藏欄位；專用 `127.0.0.1:27029` 真 Mongo leased／completing 取消與原有 fencing 共 6／6 通過 | 非作者複驗 |
| 舊過期快照覆蓋已續期 worker 租約 | `fa2995e` 在逾期恢復 CAS 加原到期時間與過期條件；gated heartbeat 回歸及 worker 16／16 通過 | 非作者複驗 |
| 晚到成品不出現在管理員待辦 API | 當前 route 已合併 core actions 與 Asset 待辦；`a3533ef` 真 HTTP 驗證管理員 200 含該筆、教師 403。直接呼叫 core service 的空結果不能代表 route 缺接線 | 非作者確認初審是否撤回 |
| 同意 gate 之後、上傳 CAS 之前撤回留下 unlisted | `a3533ef` 上傳 CAS 排除 archived，CAS 後重讀，晚到 ID 留持久補償；新增 gated promise、privacy 失敗通知與恢復，撤回整合 8／8 通過 | 非作者複驗 |

上述 fake worker／撤回共 24／24 及真 Mongo 6／6 為修復作者本輪驗證，尚未宣稱獨立審查通過。pipeline 四筆初審修正已合入 `51e7f16f`、`474921fc`、`c7382504`、`304a6c8b`；教授裸影片 bootstrap 與後續 trial guard 由原 owner 接續。工作樹內前端交接文件由另一 owner 維護，不能因 shared 修復完成就稱正式教師 UI 可用。

### 2026-11-03 shared backend 恢復檢查點

候選已依序整合 pipeline 五筆：`a9a89d6a`、`b4ce888f`、`6ac0cca7`、`8d9a2881`、`f8c3a2ac`。正式 source/media 已接 ASR 正規化，持久保存原片 SHA-256、逐字稿版本／片段、辨識證據與截斷句禁止清單；模型、教師加回、片頭、句內微調及 RC8 鎖定重跑共用拒絕檢查。程式碼圖卡遇有／無行號的「會／可能／就…出錯」提示時保守保留原話，不讓 OCR／AI 修正錯誤示範。OpenAPI 補齊禁止加回的 422、逐句可選狀態、撤回成品清單與管理員待辦回應／403。

本輪作者精準測試 **140／140**、OpenAPI lint 與 `git diff --check` 通過；包含真 Express 本機 loopback、記憶體模型與真 Mongoose schema 的 `new/validateSync/toObject`。外部工具、模型與服務皆 fake，未連 Atlas／VM／YouTube／LINE；前端與兩份 Short_Video 決策無修改。精準測試 log：候選根目錄 `backend-shared-tests.log`；lint log：`backend-docs-lint.log`（忽略的本機證據檔，不提交）。完整 backend、隔離 Mongo、renderer 與非作者複驗由整合 owner 接續，不能將本輪作者測試當正式驗收。

恢復命令（PowerShell，在候選 `backend/`）：

```powershell
$env:NODE_PATH='C:/Users/User/Documents/GitHub/focusflow/backend/node_modules;C:/Users/User/Documents/GitHub/_worktrees/focusflow/recut-rc5/short_render/node_modules'
node --require ./tests/helpers/noDotenv.cjs --test --experimental-test-isolation=none --test-concurrency=1 --test-reporter=spec tests/recut-source.service.test.js tests/recut-media.service.test.js tests/recut-selection.service.test.js tests/recut-review.service.test.js tests/recut-review.routes.test.js tests/recut-state.service.test.js tests/recut-code-runtime.service.test.js tests/docs.routes.test.js tests/recut-consent-integration.test.js
npm.cmd run docs:lint
```

只使用指定 preload 禁止載入環境檔，不讀或回報任何金鑰值。整合 owner 當次回報的執行阻塞：Docker Desktop 兩次以隱藏視窗啟動仍未就緒、專用 `127.0.0.1:27029` 拒絕連線；教授試產 runner 只回報缺少 `GEMINI_API_KEY` 變數名，**0 次真模型呼叫**。以上為 2026-11-03 當次診斷，已由上方 2026-11-04 Docker 與真模型試產紀錄取代；不得改連正式資料庫。

## 窗口前唯讀證據（2026-11-11 15:39–15:44 台灣時間）

本次實際連線 Atlas，只讀取與查詢；資料寫入、索引更新／回復及付費模型呼叫皆為 0。全 collection 實際計數 815，指定課程備份 694 筆，與 phase7 備份逐筆比較舊 embedding 全部相同。三筆新欄位皆不存在，Dry Run 三筆通過；既有工具／Adapter 定向測試 20/20 通過。未執行新三路真實搜尋、正式網站 E2E 或完整 43 題評測。

本機證據位於忽略目錄 `.local-tools/atlas-preparation/`：`backup-1794382699301.json`（由既有工具回讀校驗）、`window-prep-20261111-dry-run.json`、`window-prep-20261111-baseline.json`、`window-prep-20261111-status.json`、`window-prep-20261111-latency.json`、`window-prep-20261111-definition-audit.json`。當次 planHash 為 `fcc472a27039656983b3bb4fe4e4db708b4886a9d20c99d3b0d68b7ca22249f2`；這是下午證據，不能直接視為 20:00 窗口的核准計畫。備份含指定範圍 694 筆，不是全 collection 815 筆的完整災難備份，也不授權全量還原。

目標索引與三節點 mainIndex 皆 READY／queryable；帳號 find、update、listSearchIndexes、updateSearchIndex 權限以唯讀方式確認，未試寫。三筆舊文字自查皆 rank 1，各回傳 20 筆，耗時依序 165.50／65.19／78.92 ms（0001／0117／0070）；未授權影片與錯誤課程 filter 均為 0 筆。這只是三次查詢觀察，不能推論 p95 或承諾重建期間效能。

執行狀態仍為 PREP-ONLY／NO-GO FOR WRITE：待窗口內 fresh 核對、Atlas 管理者值守與監測、無重疊 VM／部署確認、必要時接受不含正式站 E2E、M0 資源盲區與兩次重建風險接受，以及使用者再次明確授權。原始定義差異與回復核對方式見 [操作計畫](04_Features/Multimodal_Retrieval/atlas-preparation.md#索引前像的預設欄位核對)。
