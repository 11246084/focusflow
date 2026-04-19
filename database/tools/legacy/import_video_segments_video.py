# ============================================================
# focusflow — 寫入 video_segments_video
# 執行方式：python database/tools/legacy/import_video_segments_video.py
# 資料來源：STT_Whisper/data/outputs/embeddings_video_gemini.jsonl
#
# upsert key：clip_id
# ============================================================

import json
import os
from pathlib import Path
from pymongo import MongoClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = Path(__file__).resolve().parent / ".env"
SOURCE_PATH = PROJECT_ROOT / "STT_Whisper" / "data" / "outputs" / "embeddings_video_gemini.jsonl"

COLLECTION_NAME = "video_segments_video"
REQUIRED_KEYS = {"clip_id", "video_id", "start_sec", "end_sec", "clip_path", "embedding"}


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
# 讀取 embeddings_video_gemini.jsonl
# ============================================================
print(f"\n📂 讀取 {SOURCE_PATH}...")

if not SOURCE_PATH.exists():
    raise FileNotFoundError(f"找不到來源檔案：{SOURCE_PATH}")

records = []
skip_count = 0

with open(SOURCE_PATH, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        record = json.loads(line)

        missing = REQUIRED_KEYS - record.keys()
        if missing:
            print(f"  ⚠️  跳過（缺少欄位 {missing}）：{record.get('clip_id', '<unknown>')}")
            skip_count += 1
            continue

        embedding = record.get("embedding")
        if not isinstance(embedding, list) or not embedding:
            print(f"  ⚠️  跳過（embedding 為空）：{record.get('clip_id', '<unknown>')}")
            skip_count += 1
            continue

        records.append(record)

print(f"✅ 載入 {len(records)} 筆，跳過 {skip_count} 筆")

# ============================================================
# Upsert 寫入 video_segments_video
# ============================================================
print(f"\n📥 Upsert 寫入 {COLLECTION_NAME}...")

success_count = 0
error_count = 0

for record in records:
    clip_id = record["clip_id"]
    document = {
        "clip_id":   clip_id,
        "video_id":  record["video_id"],
        "start_sec": float(record["start_sec"]),
        "end_sec":   float(record["end_sec"]),
        "clip_path": record["clip_path"],
        "embedding": record["embedding"],
    }

    try:
        collection.update_one({"clip_id": clip_id}, {"$set": document}, upsert=True)
        success_count += 1
    except Exception as exc:
        print(f"  ❌ 寫入失敗 clip_id={clip_id}：{exc}")
        error_count += 1

total = collection.count_documents({})
print(f"✅ 完成！success={success_count}  skip={skip_count}  error={error_count}")
print(f"   {COLLECTION_NAME} 目前共 {total} 筆")

client.close()
