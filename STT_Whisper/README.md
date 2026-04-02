# FocusFlow AI Pipeline MVP

FocusFlow 的這個模組是本地端的 AI Data Producer，負責把教學影片轉成可供後續 MongoDB / Vector DB / Search API 使用的標準化資料。

目前這條 pipeline 已支援：

1. 掃描 `Test_video_file/` 內的本地影片
2. 使用 FFmpeg 抽出 Whisper 可用音訊
3. 用 `faster-whisper` 做 STT
4. 對 transcript 做術語校正 normalization
5. 將 normalized transcript 切成 chunks
6. 對 chunks 產生 embedding
7. 輸出標準化 JSON / JSONL

## 專案結構

```text
STT_Whisper/
├─ Test_video_file/
├─ data/
│  ├─ cache/
│  │  └─ transcripts/
│  ├─ outputs/
│  ├─ processed_audio/
│  └─ term_dictionary.json
├─ src/
│  ├─ chunking.py
│  ├─ config.py
│  ├─ embedding.py
│  ├─ export_outputs.py
│  ├─ extract_audio.py
│  ├─ main.py
│  ├─ normalize_transcript.py
│  ├─ scan_videos.py
│  ├─ transcribe.py
│  ├─ utils.py
│  └─ __init__.py
├─ .env.example
├─ .gitignore
├─ README.md
└─ requirements.txt
```

## 環境需求

- Python 3.10+
- FFmpeg
- 可連網的環境，第一次執行會下載 Whisper 與 embedding 模型

如果你的電腦目前連 `python --version` 或 `py --version` 都無法執行，請先到 [Python 官網](https://www.python.org/downloads/) 安裝 Python 3.10+，並在安裝畫面勾選 `Add python.exe to PATH`。

## 安裝方式

### 1. 建立虛擬環境

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

如果你的機器使用 Python Launcher，也可以：

```powershell
py -3.10 -m venv .venv
.venv\Scripts\Activate.ps1
```

### 2. 安裝套件

```powershell
pip install -r requirements.txt
```

### 3. 建立 `.env`

```powershell
Copy-Item .env.example .env
```

## 如何安裝 FFmpeg

### 方式 A：安裝系統版 FFmpeg

1. 到 [FFmpeg 官網](https://ffmpeg.org/download.html) 下載 Windows build
2. 將解壓後的 `bin/` 加到系統 `PATH`
3. 重新開 PowerShell
4. 驗證：

```powershell
ffmpeg -version
```

### 方式 B：使用 Python 套件內建的 FFmpeg

本專案已加入 `imageio-ffmpeg`。若系統 PATH 沒有 `ffmpeg`，程式會嘗試使用該套件的 bundled binary。

### 可選：手動指定 FFmpeg 路徑

如果 FFmpeg 不在 PATH，可以在 `.env` 設定：

```env
FFMPEG_BINARY=C:/tools/ffmpeg/bin/ffmpeg.exe
```

## 如何執行 Pipeline

### 全量執行

```powershell
python src/main.py
```

### 先測 1 支影片

```powershell
python src/main.py --limit 1
```

### 強制重跑中間產物

```powershell
python src/main.py --overwrite
```

### 切換模型

```powershell
python src/main.py --whisper-model medium --embedding-model BAAI/bge-m3
```

## Pipeline 流程

目前主流程是：

1. 掃描影片
2. 抽音訊
3. STT
4. Transcript normalization
5. Chunking
6. Embedding
7. 匯出資料

也就是說，chunking 與 embedding 預設使用的是 `transcripts_normalized.json` 對應的內容，而不是原始 STT 結果。

## 為什麼需要 Transcript Normalization

Whisper 對教學影片中的技術詞常會出現以下問題：

- 英文產品名辨識錯誤，例如 `ChatGPT` 被辨識成 `CHATGVT`
- 技術縮寫被拆開，例如 `API` 被辨識成 `A P I`
- 品牌或框架名稱大小寫錯亂，例如 `OpenAI`、`MongoDB`
- 術語被多插空格，例如 `Vector DB`、`Chat GPT`

這些問題會直接影響：

- chunk 文本品質
- embedding 品質
- 後續語意搜尋與知識檢索準確率

因此本專案在 STT 後、chunking 前新增 `normalize_transcript.py`，專門做術語校正。

## 術語詞庫

詞庫檔位於：

[`data/term_dictionary.json`](C:/Users/user/Desktop/STT_Whisper/data/term_dictionary.json)

格式為：

```json
{
  "ChatGPT": ["CHATGVT", "CHAT GPT", "chat gpt"],
  "OpenAI": ["Open A I", "open ai"],
  "MongoDB": ["Mongo DB", "mangodb"]
}
```

### 如何維護術語詞庫

每個 key 是 canonical term，也就是最後要統一成的正確詞。

每個 value 是該術語常見的變體，例如：

- 錯拼
- 大小寫差異
- 多餘空格
- 縮寫拆開

建議維護原則：

1. canonical term 保持穩定
2. 常見錯字與空格變體放進 alias list
3. 不要把過於一般的英文單字隨意放進去，避免過度修正

## Normalization 怎麼運作

`src/normalize_transcript.py` 目前支援兩層處理：

### 1. Dictionary-based exact replacement

先套用詞庫中的明確變體，例如：

- `CHATGVT` -> `ChatGPT`
- `Open A I` -> `OpenAI`
- `Mongo DB` -> `MongoDB`

這一層會標記 correction method 為 `dictionary`。

### 2. Fuzzy matching with rapidfuzz

接著針對英文或英文片段做模糊比對：

- 會先把文字標準化成小寫並移除空白 / 符號
- 與 canonical terms / aliases 做相似度比對
- 分數高於 `FUZZY_THRESHOLD` 時進行修正

預設閾值：

```env
FUZZY_THRESHOLD=85
```

如果 fuzzy 是透過某個 alias 找到 canonical term，會標記為：

- `dictionary+fuzzy`

如果 fuzzy 是直接靠 canonical term 命中，會標記為：

- `fuzzy`

### 避免過度修正的規則

MVP 版本刻意保守：

- fuzzy 只處理英文樣式片段
- 太短的片段不做 fuzzy 修正
- 一般中文內容不做通用錯字修正

## 輸出檔案

正式輸出都會位於：

[`data/outputs/`](C:/Users/user/Desktop/STT_Whisper/data/outputs)

### `videos.json`

影片 metadata 主檔。

### `transcripts.json`

原始 Whisper STT 結果，保留 debug 與追溯用途，不會被覆蓋成 normalized 內容。

### `transcripts_normalized.json`

加入術語校正後的 transcript，格式與 `transcripts.json` 類似，但 segment 額外包含：

- `original_text`
- `corrections`

範例：

```json
[
  {
    "video_id": "video_001",
    "segments": [
      {
        "segment_id": "video_001_seg_0010",
        "start_sec": 41.42,
        "end_sec": 48.02,
        "text": "雖然說生成式AI並不是說只有像ChatGPT這個樣子的",
        "original_text": "雖然說生成式AI並不是說只有像CHATGVT這個樣子的",
        "corrections": [
          {
            "from": "CHATGVT",
            "to": "ChatGPT",
            "method": "dictionary+fuzzy"
          }
        ]
      }
    ]
  }
]
```

### `chunks.jsonl`

每行一筆 chunk，內容已來自 normalized transcript。

### `embeddings.jsonl`

每行一筆 embedding，與 normalized chunks 對齊。

## `transcripts.json` 與 `transcripts_normalized.json` 的差異

`transcripts.json`：

- 保留原始 STT
- 適合除錯 Whisper 錯字
- 不包含校正紀錄

`transcripts_normalized.json`：

- 用於後續 chunking / embedding
- 保留 `original_text`
- 保留 `corrections`
- 適合給檢索、搜尋、DB 成員整合

## 如何交給 DB 成員整合

建議 DB 成員使用方式：

1. `videos.json` 當影片主檔
2. `transcripts.json` 做原始 STT 備份
3. `transcripts_normalized.json` 做可追溯文字版本
4. `chunks.jsonl` 建立搜尋文件
5. `embeddings.jsonl` 匯入向量欄位

建議保留的關聯欄位：

- `video_id`
- `segment_id`
- `chunk_id`
- `start_sec`
- `end_sec`

## 測試與驗證方式

### 1. 驗證術語是否被修正

你可以直接搜尋 `CHATGVT` 與 `ChatGPT`：

```powershell
Select-String -Path data\outputs\transcripts.json -Pattern "CHATGVT"
Select-String -Path data\outputs\transcripts_normalized.json -Pattern "ChatGPT"
```

### 2. 驗證 corrections 是否有被記錄

```powershell
Get-Content data\outputs\transcripts_normalized.json -TotalCount 80
```

確認每個被修改的 segment 內有：

- `original_text`
- `text`
- `corrections`

### 3. 驗證 normalized transcript JSON 可正常解析

```powershell
python -c "import json, pathlib; p=pathlib.Path('data/outputs/transcripts_normalized.json'); print(len(json.loads(p.read_text(encoding='utf-8'))))"
```

### 4. 驗證 chunk 與 embedding 數量一致

```powershell
(Get-Content data\outputs\chunks.jsonl).Count
(Get-Content data\outputs\embeddings.jsonl).Count
```

### 5. 驗證 `chunk_id` / `video_id` 對應一致

```powershell
Get-Content data\outputs\chunks.jsonl -TotalCount 3
Get-Content data\outputs\embeddings.jsonl -TotalCount 3
```

## 可重複執行設計

- 已存在的 `data/processed_audio/*.wav` 預設重用
- 已存在的 `data/cache/transcripts/*.json` 預設重用
- 正式輸出使用原子寫入，降低半寫入壞檔風險
- 如果正式輸出已存在，會先備份 `.bak`
- 若要強制重跑，使用 `--overwrite`

## 主要模組說明

- [scan_videos.py](C:/Users/user/Desktop/STT_Whisper/src/scan_videos.py): 掃描影片與產生 metadata
- [extract_audio.py](C:/Users/user/Desktop/STT_Whisper/src/extract_audio.py): 抽取 Whisper 用音訊
- [transcribe.py](C:/Users/user/Desktop/STT_Whisper/src/transcribe.py): faster-whisper STT
- [normalize_transcript.py](C:/Users/user/Desktop/STT_Whisper/src/normalize_transcript.py): 術語校正與 correction trace
- [chunking.py](C:/Users/user/Desktop/STT_Whisper/src/chunking.py): 規則式 chunking
- [embedding.py](C:/Users/user/Desktop/STT_Whisper/src/embedding.py): chunk embedding
- [export_outputs.py](C:/Users/user/Desktop/STT_Whisper/src/export_outputs.py): JSON / JSONL 匯出
- [config.py](C:/Users/user/Desktop/STT_Whisper/src/config.py): 全域設定
- [utils.py](C:/Users/user/Desktop/STT_Whisper/src/utils.py): 資料模型與共用工具
- [main.py](C:/Users/user/Desktop/STT_Whisper/src/main.py): 主流程控制

## 後續擴充方向

這份 MVP 已預留後續擴充空間：

1. MongoDB ingestion adapter
2. MongoDB Atlas Vector Search
3. Qdrant / Chroma / Weaviate connector
4. Query API
5. Query-time reranking
6. 影片時間戳跳轉
7. FFmpeg 片段剪輯
8. 更完整的課程結構欄位解析
9. 更進階的 normalization 策略，例如 domain-specific phrase correction
