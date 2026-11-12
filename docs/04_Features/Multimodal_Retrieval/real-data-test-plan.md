# 真實資料優先：盤點與測試計畫

以現有六支教材、原 Chunk 與人工題庫驗證多模態，不新增與教材無關的測試內容。前輪完成唯讀查證、離線回歸及真實片段解碼；交接後另接手程式缺口與計分政策，仍未執行品質評測或任何外部寫入。最新完成範圍看[狀態正本](../../current-status.md)，本文件記錄 2026-11-12 的資料快照與後續方案。

## 2026-11-12 交接後採用的執行順序

本輪依Weihao Q1～Q11及庭語新指示更新：不另做S60／六題新小樣本；11/11三筆實測證據沿用。階段1分列舊embedding與stableTextEmbedding基準，X01核准前42題計分、X01另列；階段3先只做影片一，費用／備份／寫入／三路正常才進其餘五片，成功資料保留、索引只更新一次、兩長片段略過影音、累計US$20停止。階段4仍做六模態組×兩權重及平面／分層MA，回答正確性延後，不作開啟依據。11/13交關閉狀態的完整程式；11/15中午報告與獨立驗算、判斷①，未通過不開啟。實際付費、Atlas操作與部署仍需當次授權，不依本計畫自動執行。

## 一、可用資料與現況

原片目錄：`C:/Users/user/Documents/GitHub/focusflow/backend/uploads/`。六個檔案都存在、可讀，已完整計算 SHA-256、用 FFmpeg 讀取容器時長；總計 630,096,168 bytes、11,176.42 秒（約 3.10 小時）。不是舊 README 的約 3.4 小時。本輪沒有逐秒完整解碼全部原片，只有後述 12 個真實切片完整解碼。

| 影片 | 檔名 | 時長秒 | Chunk | 可做影音 | 少於 8 秒 |
|---|---|---:|---:|---:|---:|
| V1 | `1785570957608-aiA10_1140119_1.mp4` | 1756.50 | 117 | 117 | 1 |
| V2 | `1785570958892-aiA10_1140119_2.mp4` | 1796.74 | 123 | 123 | 1 |
| V3 | `1785570960294-aiA10_1140119_3.mp4` | 1785.87 | 83 | 82 | 1 |
| V4 | `1785570961660-aiA10_1140119_4.mp4` | 1825.18 | 144 | 144 | 6 |
| V5 | `1785570962845-aiA10_1140119_5.mp4` | 1827.32 | 88 | 87 | 5 |
| V6 | `1785570963783-aiA10_1140119_6.mp4` | 2184.81 | 139 | 139 | 1 |
| 合計 | | 11176.42 | 694 | 692 | 15 |

15 段短片照現行規則延伸到 8 秒，不改引用原時間。V3 `6a6da69156dd124511ec51ca_chunk_0034`（524.29–1128.03，603.74 秒）、V5 `6a6da69356dd124511ec51e0_chunk_0016`（246.08–893.11，647.03 秒）超過 60 秒，依鎖定契約略過影音，不能自行切新 Chunk 或只取一小段冒充整段。

| 資料／工具 | 存在及可讀性 | 能否直接用於真實測試／需要補什麼 |
|---|---|---|
| Atlas 六支影片 694 筆 Leaf | 當次唯讀 694、無截斷或錯誤，無重複 ID／無效時間／缺字稿／越界 | 原始身份／時間可用；頂層 courseId、版本 metadata 缺少，依既有影片授權關係處理，不補寫欄位湊測試 |
| 原文字向量 | 694 筆全為 3072 維、有效且 unit norm | 與六份 `STT_Whisper/data/outputs/runs/run_20260801_155559/155600/155601/155603/155604/155605` 的 `embeddings_text_gemini.jsonl` 逐筆向量與時間相同；產物宣告 preview，無不可變服務端 revision。不能因維度相同視為 stable 相容 |
| Stable 小樣本 | `.local-tools/gemini-small-sample/gemini/checkpoints/`，3 query＋3 text＋3 audio＋3 visual；12 筆原輸入 signature／digest 重新驗證通過 | 本機接線／重播可用；不是全題庫 query cache，也不是全量資料 |
| 第一次真實 Atlas 證據 | [去敏摘要](evidence/2026-11-11-atlas-sample-summary.json)，完整 report／receipt 在 `.local-tools/atlas-preparation/live-round1/` | 可重算既有三題 RRF；實測後已完整回復。當次 Atlas 694 筆現有欄位仍只有舊 `embedding`，audio／visual 向量為 0，索引也只有舊 path |
| 43 題可回答題 | [question-bank.json](../QA_Evaluation/datasets/question-bank.json)＋xlsx 均可讀，附 Gold 答案要點與影片時間 | Gold 主要是人工時間區間，不是已人工標定的 Chunk ID；需按原半段重疊規則映射。X01 缺 V5 時間，原標註保留，核定前以42題計分、X01另列 |
| 7 題拒答 | 同一題庫 N01、N03、N04、N05、N06、N07、N10 | 可用；分開記 top score／實際拒答、無引用與不幻覺，不納入 43 題 Recall／MRR 分母 |
| Parent | 3 個 active Parent，僅 V6、涵蓋 9 個 Leaf，無斷鏈 | 不足全課程 Hierarchical 比較，不能用合成 Parent 補作真實資料 |

先前三個探索問題與原 50 題逐字比對沒有相同題目；三個保存片段依既有半段命中規則，也沒有對應現行 Gold。這不否定接線實測，但不得將三題結果包裝成題庫成績。

本機 env loader 當次非敏感設定：Atlas、query provider Gemini／stable `gemini-embedding-2`、answer provider Gemini、多模態及分層 flag 關閉、`text_embedding_index`、未宣告 active Leaf contract。這是本機配置，不代表正式 VM。直接執行一般 QA 可能付費並寫對話／FAQ／用量，本輪未啟動。

## 二、既有評測與歷史結果

| 現有入口 | 可用範圍與限制 |
|---|---|
| [offlineRetrievalAudit.service.js](../../../backend/src/services/offlineRetrievalAudit.service.js)＋[verifyMultimodalAudit.js](../../../backend/scripts/verifyMultimodalAudit.js) | Recall@5、Recall@10、MRR，兩個獨立評分實作；bank／manifest／protocol／ranking hash 綁定，拒絕缺 Gold。只驗算現有排名，不替你產生 query 向量 |
| [auditMultimodalOffline.js](../../../backend/scripts/auditMultimodalOffline.js) | 當次 `--inspect-bank` 回 BLOCKED，50／43／7、X01 缺 V5，bank hash `2c20e387f61cab5de19756e3348389fad231957b6989891cfa03a8cc6a67b742`。不是測試失敗或模型品質差 |
| [multimodalOfflineEvaluation.service.js](../../../backend/src/services/multimodalOfflineEvaluation.service.js) | 沿用六模態組×Flat／Hierarchical×兩權重，共每題 24 列；本輪 A–D 是加列版本控制，不能取消 HANDOFF 的 MA／六組原驗收 |
| [retrievalEvaluation.service.js](../../../backend/src/services/retrievalEvaluation.service.js) | 一般 Chunk-ID hit／RR 算式，需先提供可信 relevant IDs，不能拿 item-recall 定義混充本專案題級 Recall |
| [evaluateMultimodalRetrieval.js](../../../backend/scripts/evaluateMultimodalRetrieval.js) | 舊 text＋整片 video 實驗；Top15、候選75、指標 K=1/3/5，預設題集路徑仍指舊 `docs/reports/`；會呼叫 embedQuery，且要求獨立只讀帳號。不是本次逐 Chunk 三路 runner，不能直接執行 |
| [runQaEval.js](../../../backend/scripts/qa-eval/runQaEval.js) | 支援既有題庫／QA_EVAL_ONLY；會登入並呼叫真實 QA，可能寫入、產生模型費用，這輪不跑。其「先清 FAQ」註解不能作為本輪刪正式資料的授權 |
| [validateMultimodalQaOffline.js](../../../backend/scripts/validateMultimodalQaOffline.js) | 本輪重播既有真實向量，3 query／72 列通過；Atlas 排名由本機 cosine 模擬，Parent 未改 fixture，不是新 Atlas 成績 |
| QA／Adapter／Bridge／RRF／E2E | [QA 整合](../../../backend/tests/multimodal-qa.integration.test.js)、[Bridge](../../../backend/tests/multimodal-qa-bridge.service.test.js)、[Adapter](../../../backend/tests/atlas-multimodal-adapter.service.test.js)、[RRF](../../../backend/tests/rank-fusion.service.test.js)、[瀏覽器 runner](../../../backend/scripts/runStudentBrowserFixture.mjs) 可沿用；現有 E2E 包含 Fake Atlas、template 答案、合成媒體／身份，不能直接當真實教材 E2E 驗收 |

歷史 QA `runs/2026-08-24T12-55-33-516Z` 為 3 題試跑，其餘 8/24 13:00、9/3 10:20 兩份各 50 題，保存 raw.matches／citations／runtime。報告的 4.35／4.68 是人工六面向回答評分（/5），不是 Recall 或 MRR。9/3 為 memory、Top15、FAQ off；不可直接與新 Atlas Top20 比較。已盤點資料未提供同一配置、同一語料、完整四組的正式 43 題 Recall@5／Recall@10／MRR；不能新增不存在的歷史數字。舊 top15 可供錯題分析或明確截斷的回溯，不能冒充保存 top20 的 MRR。

## 三、四組公平比較

預先固定同一教材快照、同一 Chunk-ID 清單／原時間／字稿 hash、同題問題字串、canonical 影片 allowlist、索引及服務版本、candidate=100、每路取20、RRF k=60。先做 Flat，隔離模態差異；全量 Parent 就緒後再完成原 MA 的分層矩陣，保留缺資料診斷，不改鎖定門檻。

| 組別 | 文字／影音版本與 path | 目前可用性 |
|---|---|---|
| A 原版 Text-only | 凍結實際 legacy 設定，`text_embedding_index.embedding`、preview 文件；明記 query 模型／prefix／版本 | 有 694 文件與歷史排名；未找到同題庫 50 筆可驗證 query cache。當前本機是 stable query→preview doc，須標「原流程混合版本、相容性未證」，不能假稱已重現歷史 preview query |
| B Stable Text-only | stable query＋`stableTextEmbedding`，完整 v2 instruction／generation／normalization 契約 | 只有本機 3 文件；同語料全量待建置，不得以 3 筆對 A 694 筆 |
| C 多模態 1:1:1 | B 相同 text＋`audioEmbedding`／`visualEmbedding`；三路 stable、同一 query | 本機 3 組存在，Atlas 現況已回復，正式品質條件待建 |
| D 多模態 2:1:1 | 與 C 完全相同候選與向量，只改 RRF 文字權重2 | 沿用 C 的單次三路結果離線融合，不多呼叫模型或重查以挑結果 |

全量比較固定同一694個Chunk-ID／原時間，兩種文字基準各檢索694筆；三路文字694、影音692，兩個超60秒片段只留文字並明記skipReason。不能把不同候選範圍當同語料比較，也不事後按分數剔除片段。正式記憶體exact比較沿用鎖定每路top20；Atlas另作功能／效能驗證，不混用ANN與exact數字作未控制比較。

每題每組保存 `{questionId, group, modelContract, querySignature, corpusHash, indexDefinitionHash, topK, ranked:[rank,chunkId,videoId,startSec,endSec,score,goldHit], retrievedBy, channelRanks}`；無 query cache／缺向量即 blocked，不補零分或 Mock 排名。B/C/D 使用完全相同 query；A 若不同 embedding space 記為版本遷移比較，真正模態增益看 B→C/D，不把 A→C 的全部差異歸因模態。

沿用半個 Chunk 以上時間落在 Gold 區間聯集才命中。Recall@5／10 是有至少一筆相關結果的題數／43；MRR 是保存 top20 內首個相關名次倒數的平均。7 題拒答獨立列，六題小樣本分母只能6。X01由庭語提出V5候選給Weihao核准；核准前明記42題、X01另列，使用`--pending-x01`及對應protocolHash，核准後才更新gold並回到43題，不能混用兩版分母。RRF 分數不是相似度，拒答閾值不能把 A/B 原 score 與 C/D RRF 混用。

## 四、沿用三筆實測，影片一作全量第一批

11/11已保存真實三路／RRF／回復證據，不再另產六題或S60向量。前輪已切好的12份真實Gold影音只留作人工查看，不擴充成新的186輸入任務。

先處理V1全部117個既有Chunk：2組保存text／audio／visual可在簽章一致時重用，因此Leaf最多新增345個輸入；另需其39個固定三筆Parent與原題庫query。以既有cost ledger實際預留為準，先列精確計畫，再取得當次付費／Atlas寫入／索引及失敗回復授權。

寫入前自動匯出當次文件與原索引定義，回讀驗證checksum；V1資料就緒後同名索引加三path只做一次顯式更新，等待三節點READY／可查，並檢查保留的舊文字基準。其餘五片只追加既有path資料，不每片重建定義。成功後保留新增資料／path，開關繼續關閉；失敗才依receipt／備份回復，遇衝突停止，不覆蓋他人異動。

合法QA／引用檢查沿用既有harness與25項授權矩陣，課程存取及canonical影片allowlist由正式HTTP邊界建立，不能人工偽造scope後要求獨立Adapter證明授權。Q5已定案：合法掛載沿用同一片段／向量，Leaf／media courseId是來源，不作ACL。真實QA會寫對話／用量／FAQ且可能呼叫模型，所以本輪不啟動；單元／Fake驗證與日後模型回答抽查清楚分開。11/15判斷①只依檢索，不以回答抽查代替固定門檻。

## X01 V5候選（待Weihao核准，不寫Gold）

依既有逐字稿找到以下候選：V5 chunk0039～0041，1179.82–1223.82秒，提到BERT、摘要及Google翻譯；chunk0060，1454.14–1469.14秒，提到OpenAI與ChatGPT後方模型；chunk0074～0079，1611.41–1707.47秒，提到Google與GPT／Transformer技術來源。它們只證明相關名稱／來源敘述出現，不足以自行核准X01完整答案或公司歸屬。

CLIP的1271.39–1394.14與Sora的1518–1552秒也談模型／OpenAI，但不是現有X01 GoldPoints列的同一組LLM，不能因為找到「模型」就全部補入Gold。請Weihao聽看候選後選定範圍或確認V5是否誤列；核准前原question-bank／xlsx／annotation issue不改，42題政策仍生效。

## 五、六片全量建置與成本

依現有8～60秒規則，692段取樣共約9656.35秒，音訊計價保留秒數9909、畫面9894格（最長32格／片段）。聲音與無聲畫面各一向量，畫面不是整片影片向量；同一原時間、來源 SHA 與契約綁定。官方[Embedding 規格](https://ai.google.dev/gemini-api/docs/embeddings)的影片最多取32格，畫面不處理音軌；[當次標準價](https://ai.google.dev/gemini-api/docs/pricing#gemini-embedding-2)為音訊 US$0.00016/秒、影片 US$0.00079/格、文字 US$0.20/百萬token。

| 項目 | 輸入筆數（未扣重用） | 首次保守預留 |
|---|---:|---:|
| 694段 stable text | 694 | US$1.1370496（每筆按8192 token上限） |
| 合格音訊 | 692 | US$1.58544 |
| 合格畫面 | 692 | US$7.81626 |
| 原題庫50 query（含7拒答） | 50 | US$0.08192（同文字上限） |
| 合計 | 2128 | US$10.6206696 |

重用現有3 text＋3 audio＋3 visual，可省9次首嘗試／US$0.0516252，新輸入約2119次、首輪預留約 **US$10.5690444**。三個探索query不等於原題庫，50 query不扣3。分層依固定3筆Leaf建Parent，六片理論上限39＋41＋28＋48＋30＋47＝233筆，另最多預留US$0.3817472，合計新增約2352輸入／US$10.9507916；Parent來源／契約需重驗，不能將現有3筆直接視為全部可重用。三次全重試約US$32.8523748，超過新US$20總上限，不能默認全重試。global ledger先合併先前約US$0.0589688預留與本次費用，預留後將達US$20即停，429以外錯誤重試後仍超過5%即停回報；不自行提高上限。費用是程式保留估算，非實際帳單；Batch半價不能在現有即時adapter上直接聲稱已實作或授權。

分批順序：先影片一，再其餘五支；影片內可分最多25 Chunk的可續跑工作批，不另開新代表小樣本。每批先產 manifest 與成本 Dry Run、核對來源/時間/檔案摘要，再產本機向量；checkpoint包含來源 SHA、chunk、sample窗、輸入hash、provider/model/契約、向量digest與成功時間。已成功且簽章不變才重用；改字稿、切片或模型不能沿用。429／可恢復失敗有限重試，永久失敗立即停止該批，未知結果不盲目重送；失敗超過5%按 HANDOFF 求援，非重新灌整批。

目前腳本仍固定三筆 allowlist，不能拿現有 CAS 工具直接上傳694。先完成全量離線 manifest／成本與範圍檢查，再另授權擴充既有工具，保留完整前像、原 embedding、不upsert、單筆CAS與receipt；不是另建一套Pipeline。

M0／3索引的管理端證據為11/11快照；11/12資料面讀到 text／parent／video 三個READY。當次 dbStats dataSize=56,582,918、storageSize=129,970,176、一般indexSize=4,358,144 bytes、38個collection。管理方案及叢集Logical Size／可用容量仍需窗口重驗，不能用此單庫統計保證[Free 512MB](https://www.mongodb.com/pricing)餘裕。

新增694＋692×2＝2078個向量，float64純數值約51.07MB；BSON陣列加key估約87.07MB，尚不含metadata、額外原文、Search結構與重建峰值。保留舊向量，沿用同名 `text_embedding_index` 加stable text／audio／visual path，不能新增第4個索引。[Free索引上限與資源限制](https://www.mongodb.com/docs/vector-search/indexes/vector-search-type/)仍適用，已成功一次三筆重建不代表全量M0能承受。

Atlas落地依11/13白天避開上課、Weihao可聯絡的當次授權窗口：備份六片694全文件與索引原定義（全collection另有其他資料，先查全範圍，694不等於災難備份）→分批CAS寫新欄位→V1時同名索引只更新一次，其餘批次不重送定義→三節點READY／queryable與資料可見性查證→固定同query的舊文字top20、延遲、原embedding hash／counts回歸。重建／查詢失敗、告警／節流嚴重或並行衝突即停，原定義回復及新增欄位回復須在下一次授權中明列；不刪collection、不整份覆寫。每批驗證receipt與備份hash，回復後完整前像一致。

## 六、本輪證據與下一步

前輪盤點證據：既有 `multimodal-diagnostics/run.js` 694筆無錯誤、`traceTextProvenance.js` 694/694匹配、既有 `isolated.inspect` 刷新容量及3索引。離線：五個既有測試檔合計33/33，沿用既有單元fixture驗算，沒有新增教材資料，也不將其當真實檢索證據；保存真實12筆來源／digest重驗、3題72列接線重播通過（Fake Atlas，無品質宣稱）；六個既有Gold anchor的12個切片完整解碼。原嚴格43題模式因X01預期BLOCKED，明確暫定42模式可檢查，沒有補Gold或改題庫。

```powershell
. ./.local-tools/activate.ps1
node backend/scripts/auditMultimodalOffline.js --inspect-bank docs/04_Features/QA_Evaluation/datasets/question-bank.json
node --test --test-concurrency=1 backend/tests/rank-fusion.service.test.js backend/tests/atlas-multimodal-adapter.service.test.js backend/tests/multimodal-qa-bridge.service.test.js backend/tests/offline-retrieval-audit.service.test.js backend/tests/multimodal-retrieval-evaluation.script.test.js
node backend/scripts/validateMultimodalQaOffline.js .local-tools/atlas-preparation/bundle.json .local-tools/real-data-audit-20261112/saved-replay
```

本機證據集中 `.local-tools/real-data-audit-20261112/`：`atlas.json`、`inventory.json`、`chunks.json`、`gold-mapping.json`、`sample-plan.json`（S60清單）、`capacity.json`、`gold-media-check.json`、`verified-bundle.json`、`saved-replay.json`。完整字稿／向量／原片留忽略目錄，不進Git。來源工具重用，不新增正式評測程式。

**下一步**：先交付三缺口修正與42題／X01分開的驗算口徑，再向Weihao提出上述X01候選。接著以V1為全量第一批列實際費用／自動備份／一次索引更新與回復操作計畫，取得當次授權才執行；不另花模型費做S60。11/15中午前保存report.md、per-question.json、config.json，交協調session獨立重算。

給Weihao：六原片、694文字向量與題庫可讀；692段符合影音規則，2段過長仍保留文字。第一次三題已回復，且不屬43題Gold。U01/U02已依Q5實作與測試，請聽看上述X01候選並核准Gold，依新定案先完成程式缺口，V1驗證後再擴五片；11/13程式交付與11/15檢索報告分開，章節／影片升級已移出本階段。

交接後三缺口及42題政策已提交，最新受影響62項通過、完整Backend回歸見狀態正本。新覆蓋聚合曾實際唯讀確認0/694、complete=false，158ms；這不是全量向量成功證據。未跑Frontend／Pipeline全套或新版教材瀏覽器E2E，因未改前端／媒體／pipeline入口；未跑正式評測、Gemini、Atlas寫入／索引更新、部署或開旗標。


## 影片一執行前檢查入口

117 筆的實際切片、備份、索引、成本邊界、工具缺口與下一輪操作順序見[影片一最終檢查](video1-preflight.md)。這輪僅完成無付費／唯讀檢查；既有三筆與 12 輸入工具不得直接視為全批次工具。最新狀態見[正本](../../current-status.md)。


影片一工具缺口後續已完成最小擴充；無付費預演、受控Atlas操作及安全QA入口見[工具說明](video1-tools.md)。真實建置需當次授權，不能以Fake預演取代成效驗收。
