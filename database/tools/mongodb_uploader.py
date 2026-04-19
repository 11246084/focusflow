# ============================================================
# focusflow — 統一資料庫上傳工具
# 執行方式：
#   python database/tools/mongodb_uploader.py              # 執行全部
#   python database/tools/mongodb_uploader.py --only segments videos
#
# 可用模組：
#   segments     → video_segments_text（camelCase，主要 QA 資料）
#   videos       → videos
#   transcripts  → transcripts_normalized
#   audio        → video_segments_audio
#   video_clips  → video_segments_video
#   terms        → term_dictionary
#
# 環境變數（database/.env）：
#   MONGODB_URI          必填
#   FOCUSFLOW_COURSE_ID  選填，指定後 segments 會寫入 courseId
# ============================================================

import argparse
import json
import os
import sys
from pathlib import Path

from bson import ObjectId as BsonObjectId
from pymongo import MongoClient

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
OUTPUTS_DIR = PROJECT_ROOT / "STT_Whisper" / "data" / "outputs"
TERM_DICT_PATH = PROJECT_ROOT / "STT_Whisper" / "data" / "term_dictionary.json"

ALL_MODULES = ["segments", "videos", "transcripts", "audio", "video_clips", "terms"]


# ============================================================
# 共用工具
# ============================================================

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


def read_jsonl(path: Path, required_keys: set, id_key: str) -> tuple[list, int]:
    records = []
    skip_count = 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            missing = required_keys - record.keys()
            if missing:
                print(f"  ⚠️  跳過（缺少欄位 {missing}）：{record.get(id_key, '<unknown>')}")
                skip_count += 1
                continue
            embedding = record.get("embedding")
            if "embedding" in required_keys and (not isinstance(embedding, list) or not embedding):
                print(f"  ⚠️  跳過（embedding 為空）：{record.get(id_key, '<unknown>')}")
                skip_count += 1
                continue
            records.append(record)
    return records, skip_count


def print_result(collection_name: str, success: int, skip: int, error: int, total: int) -> None:
    print(f"✅ 完成！success={success}  skip={skip}  error={error}")
    print(f"   {collection_name} 目前共 {total} 筆")


# ============================================================
# 模組：segments（video_segments_text，camelCase）
# ============================================================

def import_segments(db: object) -> None:
    chunks_path = OUTPUTS_DIR / "chunks.jsonl"
    embeddings_path = OUTPUTS_DIR / "embeddings_text_gemini.jsonl"
    collection = db["video_segments_text"]

    print("\n" + "=" * 50)
    print("📦 segments → video_segments_text")

    if not chunks_path.exists():
        print(f"  ❌ 找不到 {chunks_path}，跳過")
        return
    if not embeddings_path.exists():
        print(f"  ❌ 找不到 {embeddings_path}，跳過")
        return

    print(f"📂 讀取 {chunks_path}...")
    chunk_map = {}
    with open(chunks_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            chunk = json.loads(line)
            chunk_id = chunk.get("chunk_id")
            if chunk_id:
                chunk_map[chunk_id] = chunk.get("segment_id")
    print(f"✅ 載入 {len(chunk_map)} 筆 chunks")

    print(f"📂 讀取 {embeddings_path}...")
    records, skip_count = read_jsonl(
        embeddings_path,
        required_keys={"chunk_id", "video_id", "start_sec", "end_sec", "text", "embedding"},
        id_key="chunk_id",
    )
    print(f"✅ 載入 {len(records)} 筆，跳過 {skip_count} 筆")

    course_object_id = None
    raw_course_id = os.getenv("FOCUSFLOW_COURSE_ID", "").strip()
    if raw_course_id:
        try:
            course_object_id = BsonObjectId(raw_course_id)
            print(f"📌 courseId 已設定：{raw_course_id}")
        except Exception:
            print(f"⚠️  FOCUSFLOW_COURSE_ID 格式錯誤，跳過 courseId 寫入：{raw_course_id}")

    print(f"📥 Upsert 寫入 video_segments_text...")
    success_count = error_count = 0
    for record in records:
        chunk_id = record["chunk_id"]
        document = {
            "chunkId":   chunk_id,
            "videoId":   record["video_id"],
            "segmentId": chunk_map.get(chunk_id),
            "startSec":  float(record["start_sec"]),
            "endSec":    float(record["end_sec"]),
            "text":      record["text"],
            "embedding": record["embedding"],
        }
        if course_object_id is not None:
            document["courseId"] = course_object_id
        try:
            collection.update_one({"chunkId": chunk_id}, {"$set": document}, upsert=True)
            success_count += 1
        except Exception as exc:
            print(f"  ❌ 寫入失敗 chunkId={chunk_id}：{exc}")
            error_count += 1

    print_result("video_segments_text", success_count, skip_count, error_count, collection.count_documents({}))


# ============================================================
# 模組：videos
# ============================================================

def import_videos(db: object) -> None:
    source_path = OUTPUTS_DIR / "videos.json"
    collection = db["videos"]

    print("\n" + "=" * 50)
    print("📦 videos → videos")

    if not source_path.exists():
        print(f"  ❌ 找不到 {source_path}，跳過")
        return

    print(f"📂 讀取 {source_path}...")
    raw = json.loads(source_path.read_text(encoding="utf-8"))
    records = raw if isinstance(raw, list) else [raw]
    print(f"✅ 載入 {len(records)} 筆")

    required_keys = {"video_id", "file_name", "file_path", "audio_path", "duration_sec"}
    print(f"📥 Upsert 寫入 videos...")
    success_count = skip_count = error_count = 0
    for record in records:
        missing = required_keys - record.keys()
        if missing:
            print(f"  ⚠️  跳過（缺少欄位 {missing}）：{record.get('video_id', '<unknown>')}")
            skip_count += 1
            continue
        video_id = record["video_id"]
        document = {
            "video_id":    video_id,
            "file_name":   record["file_name"],
            "file_path":   record["file_path"],
            "audio_path":  record["audio_path"],
            "duration_sec": float(record["duration_sec"]),
            "week":        record.get("week"),
            "lesson":      record.get("lesson"),
            "video_source": record.get("video_source", "local"),
            "video_url":   record.get("video_url"),
        }
        try:
            collection.update_one({"video_id": video_id}, {"$set": document}, upsert=True)
            success_count += 1
        except Exception as exc:
            print(f"  ❌ 寫入失敗 video_id={video_id}：{exc}")
            error_count += 1

    print_result("videos", success_count, skip_count, error_count, collection.count_documents({}))


# ============================================================
# 模組：transcripts
# ============================================================

def import_transcripts(db: object) -> None:
    source_path = OUTPUTS_DIR / "transcripts_normalized.json"
    collection = db["transcripts_normalized"]

    print("\n" + "=" * 50)
    print("📦 transcripts → transcripts_normalized")

    if not source_path.exists():
        print(f"  ❌ 找不到 {source_path}，跳過")
        return

    print(f"📂 讀取 {source_path}...")
    raw = json.loads(source_path.read_text(encoding="utf-8"))
    records = raw if isinstance(raw, list) else [raw]
    print(f"✅ 載入 {len(records)} 筆")

    print(f"📥 Upsert 寫入 transcripts_normalized...")
    success_count = skip_count = error_count = 0
    for record in records:
        video_id = record.get("video_id")
        segments = record.get("segments")
        if not video_id or not isinstance(segments, list):
            print(f"  ⚠️  跳過（缺少 video_id 或 segments）：{video_id or '<unknown>'}")
            skip_count += 1
            continue
        try:
            collection.update_one(
                {"video_id": video_id},
                {"$set": {"video_id": video_id, "segments": segments}},
                upsert=True,
            )
            success_count += 1
        except Exception as exc:
            print(f"  ❌ 寫入失敗 video_id={video_id}：{exc}")
            error_count += 1

    print_result("transcripts_normalized", success_count, skip_count, error_count, collection.count_documents({}))


# ============================================================
# 模組：audio（video_segments_audio）
# ============================================================

def import_audio(db: object) -> None:
    source_path = OUTPUTS_DIR / "embeddings_audio_gemini.jsonl"
    collection = db["video_segments_audio"]

    print("\n" + "=" * 50)
    print("📦 audio → video_segments_audio")

    if not source_path.exists():
        print(f"  ❌ 找不到 {source_path}，跳過")
        return

    print(f"📂 讀取 {source_path}...")
    records, skip_count = read_jsonl(
        source_path,
        required_keys={"segment_id", "video_id", "start_sec", "end_sec", "audio_path", "embedding"},
        id_key="segment_id",
    )
    print(f"✅ 載入 {len(records)} 筆，跳過 {skip_count} 筆")

    print(f"📥 Upsert 寫入 video_segments_audio...")
    success_count = error_count = 0
    for record in records:
        segment_id = record["segment_id"]
        document = {
            "segment_id": segment_id,
            "video_id":   record["video_id"],
            "start_sec":  float(record["start_sec"]),
            "end_sec":    float(record["end_sec"]),
            "audio_path": record["audio_path"],
            "embedding":  record["embedding"],
        }
        try:
            collection.update_one({"segment_id": segment_id}, {"$set": document}, upsert=True)
            success_count += 1
        except Exception as exc:
            print(f"  ❌ 寫入失敗 segment_id={segment_id}：{exc}")
            error_count += 1

    print_result("video_segments_audio", success_count, skip_count, error_count, collection.count_documents({}))


# ============================================================
# 模組：video_clips（video_segments_video）
# ============================================================

def import_video_clips(db: object) -> None:
    source_path = OUTPUTS_DIR / "embeddings_video_gemini.jsonl"
    collection = db["video_segments_video"]

    print("\n" + "=" * 50)
    print("📦 video_clips → video_segments_video")

    if not source_path.exists():
        print(f"  ❌ 找不到 {source_path}，跳過")
        return

    print(f"📂 讀取 {source_path}...")
    records, skip_count = read_jsonl(
        source_path,
        required_keys={"clip_id", "video_id", "start_sec", "end_sec", "clip_path", "embedding"},
        id_key="clip_id",
    )
    print(f"✅ 載入 {len(records)} 筆，跳過 {skip_count} 筆")

    print(f"📥 Upsert 寫入 video_segments_video...")
    success_count = error_count = 0
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

    print_result("video_segments_video", success_count, skip_count, error_count, collection.count_documents({}))


# ============================================================
# 模組：terms（term_dictionary）
# ============================================================

def import_terms(db: object) -> None:
    collection = db["term_dictionary"]

    print("\n" + "=" * 50)
    print("📦 terms → term_dictionary")

    if not TERM_DICT_PATH.exists():
        print(f"  ❌ 找不到 {TERM_DICT_PATH}，跳過")
        return

    print(f"📂 讀取 {TERM_DICT_PATH}...")
    raw = json.loads(TERM_DICT_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        print(f"  ❌ 格式錯誤，預期為 object，跳過")
        return
    print(f"✅ 載入 {len(raw)} 筆詞條")

    print(f"📥 Upsert 寫入 term_dictionary...")
    success_count = skip_count = error_count = 0
    for correct_term, alternatives in raw.items():
        correct_term = correct_term.strip()
        if not correct_term:
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
            collection.update_one({"correct": correct_term}, {"$set": document}, upsert=True)
            success_count += 1
        except Exception as exc:
            print(f"  ❌ 寫入失敗 correct={correct_term}：{exc}")
            error_count += 1

    print_result("term_dictionary", success_count, skip_count, error_count, collection.count_documents({}))


# ============================================================
# 主程式
# ============================================================

IMPORTERS = {
    "segments":    import_segments,
    "videos":      import_videos,
    "transcripts": import_transcripts,
    "audio":       import_audio,
    "video_clips": import_video_clips,
    "terms":       import_terms,
}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="FocusFlow 統一資料庫上傳工具")
    parser.add_argument(
        "--only",
        nargs="+",
        choices=ALL_MODULES,
        metavar="MODULE",
        help=f"只執行指定模組，可多選。可用值：{', '.join(ALL_MODULES)}",
    )
    args = parser.parse_args()

    load_env_file(ENV_PATH)

    MONGODB_URI = os.getenv("MONGODB_URI", "").strip()
    if not MONGODB_URI:
        print("❌ MONGODB_URI 未設定。請在 database/.env 加入連線字串。")
        sys.exit(1)

    client = MongoClient(MONGODB_URI)
    db = client["focusflow"]
    print("✅ 成功連線 MongoDB")

    modules_to_run = args.only if args.only else ALL_MODULES
    for module in modules_to_run:
        IMPORTERS[module](db)

    print("\n" + "=" * 50)
    print("🎉 全部完成")
    client.close()
