# ============================================================
# focusflow — 寫入 term_dictionary
# 執行方式：python database/tools/legacy/import_term_dictionary.py
# 資料來源：STT_Whisper/data/term_dictionary.json
#
# 來源格式：{ "正確詞": ["錯誤寫法1", "錯誤寫法2", ...], ... }
# 寫入格式：{ correct: "正確詞", alternatives: [...] }
# upsert key：correct
# ============================================================

import json
import os
from pathlib import Path
from pymongo import MongoClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = Path(__file__).resolve().parent / ".env"
SOURCE_PATH = PROJECT_ROOT / "STT_Whisper" / "data" / "term_dictionary.json"

COLLECTION_NAME = "term_dictionary"


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
# 讀取 term_dictionary.json
# ============================================================
print(f"\n📂 讀取 {SOURCE_PATH}...")

if not SOURCE_PATH.exists():
    raise FileNotFoundError(f"找不到來源檔案：{SOURCE_PATH}")

raw = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))

if not isinstance(raw, dict):
    raise ValueError(f"term_dictionary.json 格式錯誤，預期為 object，實際為 {type(raw)}")

print(f"✅ 載入 {len(raw)} 筆詞條")

# ============================================================
# Upsert 寫入 term_dictionary
# ============================================================
print(f"\n📥 Upsert 寫入 {COLLECTION_NAME}...")

success_count = 0
skip_count = 0
error_count = 0

for correct_term, alternatives in raw.items():
    correct_term = correct_term.strip()
    if not correct_term:
        print("  ⚠️  跳過（correct 為空）")
        skip_count += 1
        continue

    if not isinstance(alternatives, list):
        print(f"  ⚠️  跳過（alternatives 格式錯誤）：{correct_term}")
        skip_count += 1
        continue

    document = {
        "correct":      correct_term,
        "alternatives": [str(a).strip() for a in alternatives if str(a).strip()],
    }

    try:
        collection.update_one(
            {"correct": correct_term},
            {"$set": document},
            upsert=True,
        )
        success_count += 1
    except Exception as exc:
        print(f"  ❌ 寫入失敗 correct={correct_term}：{exc}")
        error_count += 1

total = collection.count_documents({})
print(f"✅ 完成！success={success_count}  skip={skip_count}  error={error_count}")
print(f"   {COLLECTION_NAME} 目前共 {total} 筆")

client.close()
