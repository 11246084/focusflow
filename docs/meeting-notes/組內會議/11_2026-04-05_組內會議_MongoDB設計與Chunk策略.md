# 0405會議紀錄

- 會議日期: 2026-04-05
- 會議類型: 問題討論 / MongoDB 設計討論
- 與會者: 張庭語, 鍾百陶

## 討論內容

1. 影音檔案儲存位置與 `videos` 表設計
  - 目前資料庫內仍存在多個實體檔案路徑欄位，例如本地端影片與音檔路徑。
  - 團隊討論 MongoDB 是否適合直接存放大型影音檔，並評估系統效能與後續雲端部署的可行性。
  - 初步傾向將影片實體存放在外部雲端空間，例如 Google Drive 或 AWS S3，資料庫僅保留可供前端讀取的公開連結。
2. 語音轉文字的雙層文字結構 (`transcriptions` 表)
  - Whisper 會產出「原始文字 (Raw Text)」，後續再由 ChatGPT 修飾與校正為「校正文字 (Corrected Text)」。
  - 會議聚焦於這兩種文字是否都要保留，以及後續查詢、分析與檢索流程應該以哪一層文字為主。
3. `Chunks` 與 `Embeddings` 的資料結構關聯
  - 原本設計將影片分段資訊（含開始與結束時間）與 Embedding 向量拆成不同表或集合。
  - 團隊參考建議後確認，若把整部影片文字直接做成單一 embedding，語意會過度混雜，搜尋精準度會明顯下降。
  - 會議進一步討論是否應將分段文字與對應 embedding 合併儲存，以降低查詢複雜度並提升 RAG 檢索效率。
4. 使用者行為紀錄 (`user_logs` 表)
  - 會中簡要討論是否需要保留使用者搜尋關鍵字與點擊行為，作為後續優化搜尋結果與互動流程的依據。
5. MongoDB 設計補充觀察
  - 目前實作偏向以「整段文字」做 embedding，但團隊認為這會造成語意混雜、影響搜尋效果。
  - 針對 `Segment` 與 `Chunk` 兩種切分策略進行比較後，認為較適合以中等粒度的 chunk 作為 embedding 單位。
  - 文件中也補充記錄了 `video_segments` 與 `videos` 的 `courseId` 目前仍為 `null`，待 `courses` 建立後需要回填；`video_url` 之後也需改為雲端連結。

## 決議事項

1. MVP 階段不在 MongoDB 儲存實體影音檔或本地端路徑，影片統一改存外部雲端空間，資料庫僅保留 `video_url`。
2. `transcriptions` 同時保留 Whisper 原始文字與 ChatGPT 校正文字，但後續分析與檢索統一以「校正文字」為主。
3. RAG 流程必須採用「先切塊、再轉向量」的方式，不再使用整部影片或過大段落直接做 embedding。
4. 原本分離的 `Chunks` 與 `Embeddings` 結構合併為單一 document / collection，每筆資料需包含段落 ID、開始時間、結束時間、校正後文字與對應向量。
5. `user_logs` 暫時保留基本搜尋與操作紀錄，不額外加入過度複雜的行為追蹤設計。
6. Embedding 主體以 `Chunk` 為主，不採用過細的 `Segment` 作為主要向量化單位。

## 後續行動項目

1. 精簡 `videos` 結構，移除不必要的本地檔案路徑欄位，保留 `video_url` 供前端讀取。
2. 規劃影片雲端存放方案，並將目前在地端的 `video_url` 後續改為雲端硬碟或物件儲存連結。
3. 建立 `courses` 後回填 `video_segments` 與 `videos` 相關資料中的 `courseId`。
4. 定義新的 chunk 文件結構，至少包含 `start`、`end`、`correctedText`、`embedding` 等欄位。
5. 整理 chunking 規則，朝 20 到 30 秒、多句組成且語意完整的切分方式前進。
