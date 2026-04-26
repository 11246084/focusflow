"""Upload FocusFlow pipeline outputs into existing MongoDB collections."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from config import PipelineConfig
from utils import configure_logging, load_json_file, load_jsonl_file

LOGGER = logging.getLogger(__name__)

# 這些集合名稱已經由數據庫團隊預先配置
VIDEOS_COLLECTION = "videos"
TRANSCRIPTS_NORMALIZED_COLLECTION = "transcripts_normalized"
VIDEO_SEGMENTS_TEXT_COLLECTION = "video_segments_text"
VIDEO_SEGMENTS_VIDEO_COLLECTION = "video_segments_video"


@dataclass(slots=True)
class UploadStats:
    """Track how many records were upserted, skipped, or failed."""

    success: int = 0
    skip: int = 0
    error: int = 0


def read_json(file_path: Path) -> list[dict[str, Any]]:
    """Read a JSON file and normalize the result to a list of dictionaries."""
    # 檢查文件是否存在
    if not file_path.exists():
        LOGGER.warning("JSON file does not exist: %s", file_path)
        return []

    # 加載 JSON 文件內容
    payload = load_json_file(file_path)
    # 如果是列表，直接過濾字典項目
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    # 如果是單個對象，包裝成列表
    if isinstance(payload, dict):
        return [payload]

    # 記錄意外的 JSON 根類型
    LOGGER.warning("Unexpected JSON root type in %s. Expected list or object.", file_path)
    return []


def read_jsonl(file_path: Path) -> list[dict[str, Any]]:
    """Read a JSONL file into a list of dictionaries."""
    # 檢查文件是否存在
    if not file_path.exists():
        LOGGER.warning("JSONL file does not exist: %s", file_path)
        return []

    # 加載 JSONL 文件並過濾字典項目
    return [item for item in load_jsonl_file(file_path) if isinstance(item, dict)]


def log_summary(collection_name: str, stats: UploadStats) -> None:
    """Log one concise summary line for a collection upload."""
    # 記錄集合上傳的簡潔摘要
    LOGGER.info(
        "[MongoDB Summary] collection=%s success=%s skip=%s error=%s",
        collection_name,
        stats.success,
        stats.skip,
        stats.error,
    )


def safe_upsert(collection: Any, key_name: str, key_value: Any, document: dict[str, Any]) -> bool:
    """Upsert a single document and return whether it succeeded."""
    # 使用 update_one 進行 upsert 操作，設置文檔並在不存在時插入
    collection.update_one({key_name: key_value}, {"$set": document}, upsert=True)
    return True


def upload_videos(database: Any, config: PipelineConfig) -> UploadStats:
    """Upload normalized video metadata into the existing videos collection."""
    # 初始化上傳統計
    stats = UploadStats()
    # 設置源文件路徑
    source_path = config.output_dir / "videos.json"
    # 讀取視頻記錄
    records = read_json(source_path)
    # 獲取數據庫集合
    collection = database[VIDEOS_COLLECTION]

    # 記錄上傳開始
    LOGGER.info("Uploading videos from %s into collection=%s", source_path, VIDEOS_COLLECTION)

    # 定義必需的鍵
    required_keys = {"video_id", "file_name", "file_path", "audio_path", "duration_sec"}
    # 遍歷每個記錄
    for record in records:
        # 檢查缺少的鍵
        missing_keys = sorted(required_keys - record.keys())
        if missing_keys:
            stats.skip += 1
            LOGGER.warning(
                "[MongoDB Skip] collection=%s reason=missing_keys keys=%s record=%s",
                VIDEOS_COLLECTION,
                ",".join(missing_keys),
                record.get("video_id", "<unknown>"),
            )
            continue

        # 構建要插入的文檔
        document = {
            "video_id": record["video_id"],
            "file_name": record["file_name"],
            "file_path": record["file_path"],
            "audio_path": record["audio_path"],
            "duration_sec": float(record["duration_sec"]),
            "week": record.get("week"),
            "lesson": record.get("lesson"),
            "video_source": record.get("video_source", "local"),
            "video_url": record.get("video_url"),
        }

        # 嘗試安全 upsert
        try:
            safe_upsert(collection, "video_id", document["video_id"], document)
            stats.success += 1
        # 捕獲異常並記錄錯誤
        except Exception as exc:  # pragma: no cover - depends on external MongoDB state
            stats.error += 1
            LOGGER.error(
                "[MongoDB Error] collection=%s key=video_id value=%s error=%s",
                VIDEOS_COLLECTION,
                document["video_id"],
                exc,
            )

    # 記錄摘要
    log_summary(VIDEOS_COLLECTION, stats)
    return stats


def upload_transcripts_normalized(database: Any, config: PipelineConfig) -> UploadStats:
    """Upload normalized transcripts into the existing transcripts_normalized collection."""
    # 初始化上傳統計
    stats = UploadStats()
    # 設置源文件路徑
    source_path = config.normalized_transcript_output_path
    # 讀取轉錄記錄
    records = read_json(source_path)
    # 獲取數據庫集合
    collection = database[TRANSCRIPTS_NORMALIZED_COLLECTION]

    # 記錄上傳開始
    LOGGER.info(
        "Uploading normalized transcripts from %s into collection=%s",
        source_path,
        TRANSCRIPTS_NORMALIZED_COLLECTION,
    )

    # 遍歷每個記錄
    for record in records:
        # 獲取視頻 ID 和段落
        video_id = record.get("video_id")
        segments = record.get("segments")
        # 驗證必需字段
        if not video_id or not isinstance(segments, list):
            stats.skip += 1
            LOGGER.warning(
                "[MongoDB Skip] collection=%s reason=missing_video_id_or_segments record=%s",
                TRANSCRIPTS_NORMALIZED_COLLECTION,
                video_id or "<unknown>",
            )
            continue

        # 構建要插入的文檔
        document = {
            "video_id": video_id,
            "segments": segments,
        }

        # 嘗試安全 upsert
        try:
            safe_upsert(collection, "video_id", video_id, document)
            stats.success += 1
        # 捕獲異常並記錄錯誤
        except Exception as exc:  # pragma: no cover - depends on external MongoDB state
            stats.error += 1
            LOGGER.error(
                "[MongoDB Error] collection=%s key=video_id value=%s error=%s",
                TRANSCRIPTS_NORMALIZED_COLLECTION,
                video_id,
                exc,
            )

    # 記錄摘要
    log_summary(TRANSCRIPTS_NORMALIZED_COLLECTION, stats)
    return stats


def upload_text_embeddings(database: Any, config: PipelineConfig) -> UploadStats:
    """Upload Gemini text embeddings into the existing video_segments_text collection."""
    # 初始化上傳統計
    stats = UploadStats()
    # 設置塊和嵌入文件路徑
    chunks_path = config.chunks_output_path
    embeddings_path = config.text_embeddings_output_path
    # 獲取數據庫集合
    collection = database[VIDEO_SEGMENTS_TEXT_COLLECTION]

    # 讀取塊和嵌入記錄
    chunk_records = read_jsonl(chunks_path)
    embedding_records = read_jsonl(embeddings_path)
    # 創建塊 ID 到記錄的映射
    chunk_map = {
        record.get("chunk_id"): record
        for record in chunk_records
        if isinstance(record.get("chunk_id"), str)
    }

    # 記錄上傳開始
    LOGGER.info(
        "Uploading text embeddings from %s into collection=%s",
        embeddings_path,
        VIDEO_SEGMENTS_TEXT_COLLECTION,
    )

    # 定義必需的鍵
    required_keys = {"chunk_id", "video_id", "start_sec", "end_sec", "text", "embedding"}
    # 遍歷每個嵌入記錄
    for record in embedding_records:
        # 檢查缺少的鍵
        missing_keys = sorted(required_keys - record.keys())
        chunk_id = record.get("chunk_id")

        if missing_keys:
            stats.skip += 1
            LOGGER.warning(
                "[MongoDB Skip] collection=%s chunk_id=%s reason=missing_keys keys=%s",
                VIDEO_SEGMENTS_TEXT_COLLECTION,
                chunk_id or "<unknown>",
                ",".join(missing_keys),
            )
            continue

        # 驗證嵌入向量
        embedding = record.get("embedding")
        if not isinstance(embedding, list) or not embedding:
            stats.skip += 1
            LOGGER.warning(
                "[MongoDB Skip] collection=%s chunk_id=%s reason=empty_embedding",
                VIDEO_SEGMENTS_TEXT_COLLECTION,
                chunk_id or "<unknown>",
            )
            continue

        # 獲取對應的塊記錄
        chunk_record = chunk_map.get(chunk_id, {})
        # 構建要插入的文檔
        document = {
            "chunk_id": chunk_id,
            "video_id": record["video_id"],
            "segment_id": chunk_record.get("segment_id"),
            "start_sec": float(record["start_sec"]),
            "end_sec": float(record["end_sec"]),
            "text": record["text"],
            "embedding": embedding,
        }

        # 嘗試安全 upsert
        try:
            safe_upsert(collection, "chunk_id", chunk_id, document)
            stats.success += 1
        # 捕獲異常並記錄錯誤
        except Exception as exc:  # pragma: no cover - depends on external MongoDB state
            stats.error += 1
            LOGGER.error(
                "[MongoDB Error] collection=%s key=chunk_id value=%s error=%s",
                VIDEO_SEGMENTS_TEXT_COLLECTION,
                chunk_id,
                exc,
            )

    # 記錄摘要
    log_summary(VIDEO_SEGMENTS_TEXT_COLLECTION, stats)
    return stats


def upload_video_embeddings(database: Any, config: PipelineConfig) -> UploadStats:
    """Upload Gemini video embeddings into the existing video_segments_video collection."""
    # 初始化上傳統計
    stats = UploadStats()
    # 設置源文件路徑
    source_path = config.video_embeddings_output_path
    # 讀取記錄
    records = read_jsonl(source_path)
    # 獲取數據庫集合
    collection = database[VIDEO_SEGMENTS_VIDEO_COLLECTION]

    # 記錄上傳開始
    LOGGER.info(
        "Uploading video embeddings from %s into collection=%s",
        source_path,
        VIDEO_SEGMENTS_VIDEO_COLLECTION,
    )

    # 定義必需的鍵
    required_keys = {"clip_id", "video_id", "start_sec", "end_sec", "clip_path", "embedding"}
    # 遍歷每個記錄
    for record in records:
        # 檢查缺少的鍵
        missing_keys = sorted(required_keys - record.keys())
        clip_id = record.get("clip_id")

        if missing_keys:
            stats.skip += 1
            LOGGER.warning(
                "[MongoDB Skip] collection=%s clip_id=%s reason=missing_keys keys=%s",
                VIDEO_SEGMENTS_VIDEO_COLLECTION,
                clip_id or "<unknown>",
                ",".join(missing_keys),
            )
            continue

        # 驗證嵌入向量
        embedding = record.get("embedding")
        if not isinstance(embedding, list) or not embedding:
            stats.skip += 1
            LOGGER.warning(
                "[MongoDB Skip] collection=%s clip_id=%s reason=empty_embedding",
                VIDEO_SEGMENTS_VIDEO_COLLECTION,
                clip_id or "<unknown>",
            )
            continue

        # 構建要插入的文檔
        document = {
            "clip_id": clip_id,
            "video_id": record["video_id"],
            "start_sec": float(record["start_sec"]),
            "end_sec": float(record["end_sec"]),
            "clip_path": record["clip_path"],
            "embedding": embedding,
        }

        # 嘗試安全 upsert
        try:
            safe_upsert(collection, "clip_id", clip_id, document)
            stats.success += 1
        # 捕獲異常並記錄錯誤
        except Exception as exc:  # pragma: no cover - depends on external MongoDB state
            stats.error += 1
            LOGGER.error(
                "[MongoDB Error] collection=%s key=clip_id value=%s error=%s",
                VIDEO_SEGMENTS_VIDEO_COLLECTION,
                clip_id,
                exc,
            )

    # 記錄摘要
    log_summary(VIDEO_SEGMENTS_VIDEO_COLLECTION, stats)
    return stats


def main() -> int:
    """Upload local pipeline outputs into the already existing MongoDB collections."""
    # 從環境變數加載配置
    config = PipelineConfig.from_env()
    # 配置日誌記錄
    configure_logging(config.log_level)

    # 檢查 MongoDB URI 是否配置
    if not config.mongodb_uri:
        LOGGER.error("MONGODB_URI is not configured in .env.")
        return 1

    # 嘗試導入 pymongo
    try:
        from pymongo import MongoClient
    except ImportError as exc:
        raise RuntimeError("pymongo is not installed. Run 'pip install -r requirements.txt' first.") from exc

    # 記錄數據庫連接
    LOGGER.info("Connecting to MongoDB database=%s", config.mongodb_database_name)
    # 創建 MongoDB 客戶端
    client = MongoClient(config.mongodb_uri)

    # 測試連接
    try:
        client.admin.command("ping")
    except Exception as exc:  # pragma: no cover - depends on external MongoDB state
        LOGGER.error("Failed to connect to MongoDB: %s", exc)
        return 1

    # 獲取數據庫
    database = client[config.mongodb_database_name]

    # 執行所有上傳操作
    upload_videos(database, config)
    upload_transcripts_normalized(database, config)
    upload_text_embeddings(database, config)
    upload_video_embeddings(database, config)

    # 打印完成消息和集合名稱
    print("MongoDB upload completed.")
    print(f"videos -> {VIDEOS_COLLECTION}")
    print(f"transcripts_normalized -> {TRANSCRIPTS_NORMALIZED_COLLECTION}")
    print(f"video_segments_text -> {VIDEO_SEGMENTS_TEXT_COLLECTION}")
    print(f"video_segments_video -> {VIDEO_SEGMENTS_VIDEO_COLLECTION}")
    return 0


if __name__ == "__main__":
    # 以腳本方式運行並退出
    raise SystemExit(main())
