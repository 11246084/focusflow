"""Upload FocusFlow pipeline outputs into existing MongoDB collections."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from config import PipelineConfig
from utils import configure_logging, load_json_file, load_jsonl_file

LOGGER = logging.getLogger(__name__)

# These collection names are already provisioned by the DB team.
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
    if not file_path.exists():
        LOGGER.warning("JSON file does not exist: %s", file_path)
        return []

    payload = load_json_file(file_path)
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        return [payload]

    LOGGER.warning("Unexpected JSON root type in %s. Expected list or object.", file_path)
    return []


def read_jsonl(file_path: Path) -> list[dict[str, Any]]:
    """Read a JSONL file into a list of dictionaries."""
    if not file_path.exists():
        LOGGER.warning("JSONL file does not exist: %s", file_path)
        return []

    return [item for item in load_jsonl_file(file_path) if isinstance(item, dict)]


def log_summary(collection_name: str, stats: UploadStats) -> None:
    """Log one concise summary line for a collection upload."""
    LOGGER.info(
        "[MongoDB Summary] collection=%s success=%s skip=%s error=%s",
        collection_name,
        stats.success,
        stats.skip,
        stats.error,
    )


def safe_upsert(collection: Any, key_name: str, key_value: Any, document: dict[str, Any]) -> bool:
    """Upsert a single document and return whether it succeeded."""
    collection.update_one({key_name: key_value}, {"$set": document}, upsert=True)
    return True


def upload_videos(database: Any, config: PipelineConfig) -> UploadStats:
    """Upload normalized video metadata into the existing videos collection."""
    stats = UploadStats()
    source_path = config.output_dir / "videos.json"
    records = read_json(source_path)
    collection = database[VIDEOS_COLLECTION]

    LOGGER.info("Uploading videos from %s into collection=%s", source_path, VIDEOS_COLLECTION)

    required_keys = {"video_id", "file_name", "file_path", "audio_path", "duration_sec"}
    for record in records:
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

        try:
            safe_upsert(collection, "video_id", document["video_id"], document)
            stats.success += 1
        except Exception as exc:  # pragma: no cover - depends on external MongoDB state
            stats.error += 1
            LOGGER.error(
                "[MongoDB Error] collection=%s key=video_id value=%s error=%s",
                VIDEOS_COLLECTION,
                document["video_id"],
                exc,
            )

    log_summary(VIDEOS_COLLECTION, stats)
    return stats


def upload_transcripts_normalized(database: Any, config: PipelineConfig) -> UploadStats:
    """Upload normalized transcripts into the existing transcripts_normalized collection."""
    stats = UploadStats()
    source_path = config.normalized_transcript_output_path
    records = read_json(source_path)
    collection = database[TRANSCRIPTS_NORMALIZED_COLLECTION]

    LOGGER.info(
        "Uploading normalized transcripts from %s into collection=%s",
        source_path,
        TRANSCRIPTS_NORMALIZED_COLLECTION,
    )

    for record in records:
        video_id = record.get("video_id")
        segments = record.get("segments")
        if not video_id or not isinstance(segments, list):
            stats.skip += 1
            LOGGER.warning(
                "[MongoDB Skip] collection=%s reason=missing_video_id_or_segments record=%s",
                TRANSCRIPTS_NORMALIZED_COLLECTION,
                video_id or "<unknown>",
            )
            continue

        document = {
            "video_id": video_id,
            "segments": segments,
        }

        try:
            safe_upsert(collection, "video_id", video_id, document)
            stats.success += 1
        except Exception as exc:  # pragma: no cover - depends on external MongoDB state
            stats.error += 1
            LOGGER.error(
                "[MongoDB Error] collection=%s key=video_id value=%s error=%s",
                TRANSCRIPTS_NORMALIZED_COLLECTION,
                video_id,
                exc,
            )

    log_summary(TRANSCRIPTS_NORMALIZED_COLLECTION, stats)
    return stats


def upload_text_embeddings(database: Any, config: PipelineConfig) -> UploadStats:
    """Upload Gemini text embeddings into the existing video_segments_text collection."""
    stats = UploadStats()
    chunks_path = config.chunks_output_path
    embeddings_path = config.text_embeddings_output_path
    collection = database[VIDEO_SEGMENTS_TEXT_COLLECTION]

    chunk_records = read_jsonl(chunks_path)
    embedding_records = read_jsonl(embeddings_path)
    chunk_map = {
        record.get("chunk_id"): record
        for record in chunk_records
        if isinstance(record.get("chunk_id"), str)
    }

    LOGGER.info(
        "Uploading text embeddings from %s into collection=%s",
        embeddings_path,
        VIDEO_SEGMENTS_TEXT_COLLECTION,
    )

    required_keys = {"chunk_id", "video_id", "start_sec", "end_sec", "text", "embedding"}
    for record in embedding_records:
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

        embedding = record.get("embedding")
        if not isinstance(embedding, list) or not embedding:
            stats.skip += 1
            LOGGER.warning(
                "[MongoDB Skip] collection=%s chunk_id=%s reason=empty_embedding",
                VIDEO_SEGMENTS_TEXT_COLLECTION,
                chunk_id or "<unknown>",
            )
            continue

        chunk_record = chunk_map.get(chunk_id, {})
        document = {
            "chunk_id": chunk_id,
            "video_id": record["video_id"],
            "segment_id": chunk_record.get("segment_id"),
            "start_sec": float(record["start_sec"]),
            "end_sec": float(record["end_sec"]),
            "text": record["text"],
            "embedding": embedding,
        }

        try:
            safe_upsert(collection, "chunk_id", chunk_id, document)
            stats.success += 1
        except Exception as exc:  # pragma: no cover - depends on external MongoDB state
            stats.error += 1
            LOGGER.error(
                "[MongoDB Error] collection=%s key=chunk_id value=%s error=%s",
                VIDEO_SEGMENTS_TEXT_COLLECTION,
                chunk_id,
                exc,
            )

    log_summary(VIDEO_SEGMENTS_TEXT_COLLECTION, stats)
    return stats


def upload_video_embeddings(database: Any, config: PipelineConfig) -> UploadStats:
    """Upload Gemini video embeddings into the existing video_segments_video collection."""
    stats = UploadStats()
    source_path = config.video_embeddings_output_path
    records = read_jsonl(source_path)
    collection = database[VIDEO_SEGMENTS_VIDEO_COLLECTION]

    LOGGER.info(
        "Uploading video embeddings from %s into collection=%s",
        source_path,
        VIDEO_SEGMENTS_VIDEO_COLLECTION,
    )

    required_keys = {"clip_id", "video_id", "start_sec", "end_sec", "clip_path", "embedding"}
    for record in records:
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

        embedding = record.get("embedding")
        if not isinstance(embedding, list) or not embedding:
            stats.skip += 1
            LOGGER.warning(
                "[MongoDB Skip] collection=%s clip_id=%s reason=empty_embedding",
                VIDEO_SEGMENTS_VIDEO_COLLECTION,
                clip_id or "<unknown>",
            )
            continue

        document = {
            "clip_id": clip_id,
            "video_id": record["video_id"],
            "start_sec": float(record["start_sec"]),
            "end_sec": float(record["end_sec"]),
            "clip_path": record["clip_path"],
            "embedding": embedding,
        }

        try:
            safe_upsert(collection, "clip_id", clip_id, document)
            stats.success += 1
        except Exception as exc:  # pragma: no cover - depends on external MongoDB state
            stats.error += 1
            LOGGER.error(
                "[MongoDB Error] collection=%s key=clip_id value=%s error=%s",
                VIDEO_SEGMENTS_VIDEO_COLLECTION,
                clip_id,
                exc,
            )

    log_summary(VIDEO_SEGMENTS_VIDEO_COLLECTION, stats)
    return stats


def main() -> int:
    """Upload local pipeline outputs into the already existing MongoDB collections."""
    config = PipelineConfig.from_env()
    configure_logging(config.log_level)

    if not config.mongodb_uri:
        LOGGER.error("MONGODB_URI is not configured in .env.")
        return 1

    try:
        from pymongo import MongoClient
    except ImportError as exc:
        raise RuntimeError("pymongo is not installed. Run 'pip install -r requirements.txt' first.") from exc

    LOGGER.info("Connecting to MongoDB database=%s", config.mongodb_database_name)
    client = MongoClient(config.mongodb_uri)

    try:
        client.admin.command("ping")
    except Exception as exc:  # pragma: no cover - depends on external MongoDB state
        LOGGER.error("Failed to connect to MongoDB: %s", exc)
        return 1

    database = client[config.mongodb_database_name]

    upload_videos(database, config)
    upload_transcripts_normalized(database, config)
    upload_text_embeddings(database, config)
    upload_video_embeddings(database, config)

    print("MongoDB upload completed.")
    print(f"videos -> {VIDEOS_COLLECTION}")
    print(f"transcripts_normalized -> {TRANSCRIPTS_NORMALIZED_COLLECTION}")
    print(f"video_segments_text -> {VIDEO_SEGMENTS_TEXT_COLLECTION}")
    print(f"video_segments_video -> {VIDEO_SEGMENTS_VIDEO_COLLECTION}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
