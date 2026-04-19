# ============================================================
# focusflow — 寫入 video_segments_text
# 執行方式：python database/tools/legacy/import_video_segments_text.py
# 資料來源：
#   STT_Whisper/data/outputs/chunks.jsonl            ← segment_id
#   STT_Whisper/data/outputs/embeddings_text_gemini.jsonl ← embedding
#
# upsert key：chunk_id
# ⚠️  不存 courseId，後端查詢時透過 $lookup 從 videos 動態關聯
# ============================================================

import json
import os
from pathlib import Path
from pymongo import MongoClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = Path(__file__).resolve().parent / ".env"
CHUNKS_PATH = PROJECT_ROOT / "STT_Whisper" / "data" / "outputs" / "chunks.jsonl"
EMBEDDINGS_PATH = PROJECT_ROOT / "STT_Whisper" / "data" / "outputs" / "embeddings_text_gemini.jsonl"

COLLECTION_NAME = "video_segments_text"
REQUIRED_KEYS = {"chunk_id", "video_id", "start_sec", "end_sec", "text", "embedding"}


def load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_env_file(ENV_PATH)

MONGODB_URI = os.getenv("MONGODB_URI", "").strip()
if not MONGODB_URI:
    raise RuntimeError("MONGODB_URI is not set. Put it in database/.env or your shell environment.")

client = MongoClient(MONGODB_URI)
db = client["focusflow"]
collection = db[COLLECTION_NAME]
print("✅ 成功連線 MongoDB")

# ============================================================
# 第一步：讀取 chunks.jsonl，建立 chunk_id → segment_id 對照表
# ============================================================
print(f"\n📂 讀取 {CHUNKS_PATH}...")

if not CHUNKS_PATH.exists():
    raise FileNotFoundError(f"找不到 chunks 檔案：{CHUNKS_PATH}")

chunk_map = {}
with open(CHUNKS_PATH, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        chunk = json.loads(line)
        chunk_id = chunk.get("chunk_id")
        if chunk_id:
            chunk_map[chunk_id] = chunk.get("segment_id")

print(f"✅ 載入 {len(chunk_map)} 筆 chunks")

# ============================================================
# 第二步：讀取 embeddings_text_gemini.jsonl，合併 segment_id
# ============================================================
print(f"\n📂 讀取 {EMBEDDINGS_PATH}...")

if not EMBEDDINGS_PATH.exists():
    raise FileNotFoundError(f"找不到 embeddings 檔案：{EMBEDDINGS_PATH}")

records = []
skip_count = 0

with open(EMBEDDINGS_PATH, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        record = json.loads(line)

        missing = REQUIRED_KEYS - record.keys()
        if missing:
            print(f"  ⚠️  跳過（缺少欄位 {missing}）：{record.get('chunk_id', '<unknown>')}")
            skip_count += 1
            continue

        embedding = record.get("embedding")
        if not isinstance(embedding, list) or not embedding:
            print(f"  ⚠️  跳過（embedding 為空）：{record.get('chunk_id', '<unknown>')}")
            skip_count += 1
            continue

        records.append(record)

print(f"✅ 載入 {len(records)} 筆，跳過 {skip_count} 筆")

# ============================================================
# 第三步：Upsert 寫入 video_segments_text
# ============================================================
print(f"\n📥 Upsert 寫入 {COLLECTION_NAME}...")

success_count = 0
error_count = 0

for record in records:
    chunk_id = record["chunk_id"]
    document = {
        "chunk_id":   chunk_id,
        "video_id":   record["video_id"],
        "segment_id": chunk_map.get(chunk_id),
        "start_sec":  float(record["start_sec"]),
        "end_sec":    float(record["end_sec"]),
        "text":       record["text"],
        "embedding":  record["embedding"],
    }

    try:
        collection.update_one({"chunk_id": chunk_id}, {"$set": document}, upsert=True)
        success_count += 1
    except Exception as exc:
        print(f"  ❌ 寫入失敗 chunk_id={chunk_id}：{exc}")
        error_count += 1

total = collection.count_documents({})
print(f"✅ 完成！success={success_count}  skip={skip_count}  error={error_count}")
print(f"   {COLLECTION_NAME} 目前共 {total} 筆")

client.close()
