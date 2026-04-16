# ============================================================
# focusflow — 寫入 transcripts_normalized
# 執行方式：python database/import_transcripts_normalized.py
# 資料來源：STT_Whisper/data/outputs/transcripts_normalized.json
#
# upsert key：video_id
# ⚠️  此 collection 為中間產物，pipeline 跑完後可手動清除
# ============================================================

import json
import os
from pathlib import Path
from pymongo import MongoClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = Path(__file__).resolve().parent / ".env"
SOURCE_PATH = PROJECT_ROOT / "STT_Whisper" / "data" / "outputs" / "transcripts_normalized.json"

COLLECTION_NAME = "transcripts_normalized"


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
# 讀取 transcripts_normalized.json
# ============================================================
print(f"\n📂 讀取 {SOURCE_PATH}...")

if not SOURCE_PATH.exists():
    raise FileNotFoundError(f"找不到來源檔案：{SOURCE_PATH}")

raw = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))
records = raw if isinstance(raw, list) else [raw]
print(f"✅ 載入 {len(records)} 筆")

# ============================================================
# Upsert 寫入 transcripts_normalized
# ============================================================
print(f"\n📥 Upsert 寫入 {COLLECTION_NAME}...")

success_count = 0
skip_count = 0
error_count = 0

for record in records:
    video_id = record.get("video_id")
    segments = record.get("segments")

    if not video_id or not isinstance(segments, list):
        print(f"  ⚠️  跳過（缺少 video_id 或 segments）：{video_id or '<unknown>'}")
        skip_count += 1
        continue

    document = {
        "video_id": video_id,
        "segments": segments,
    }

    try:
        collection.update_one({"video_id": video_id}, {"$set": document}, upsert=True)
        success_count += 1
    except Exception as exc:
        print(f"  ❌ 寫入失敗 video_id={video_id}：{exc}")
        error_count += 1

total = collection.count_documents({})
print(f"✅ 完成！success={success_count}  skip={skip_count}  error={error_count}")
print(f"   {COLLECTION_NAME} 目前共 {total} 筆")

client.close()
