"""Upload FocusFlow pipeline outputs into existing MongoDB collections."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from config import PipelineConfig
from utils import chunked, configure_logging, load_json_file, load_jsonl_file

LOGGER = logging.getLogger(__name__)

VIDEOS_COLLECTION = "videos"
TRANSCRIPTS_NORMALIZED_COLLECTION = "transcripts_normalized"
VIDEO_SEGMENTS_TEXT_COLLECTION = "video_segments_text"
VIDEO_SEGMENTS_VIDEO_COLLECTION = "video_segments_video"

ERROR_MESSAGES = {
    "configuration_error": "MongoDB upload configuration is invalid.",
    "connection_error": "MongoDB connection failed.",
    "authentication_error": "MongoDB authentication failed.",
    "validation_error": "MongoDB upload data validation failed.",
    "duplicate_or_write_error": "MongoDB batch write failed.",
    "unknown_error": "MongoDB upload failed unexpectedly.",
}


def _utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class UploadStats:
    """Per-collection counters supported by PyMongo bulk results."""

    attempted: int = 0
    inserted: int = 0
    updated: int = 0
    matched: int = 0
    skipped: int = 0
    failed: int = 0
    bulk_operations: int = 0

    @property
    def success(self) -> int:
        """Compatibility count for older callers: inserted or matched records."""
        return self.inserted + self.matched

    @property
    def skip(self) -> int:
        return self.skipped

    @property
    def error(self) -> int:
        return self.failed

    def to_dict(self) -> dict[str, int]:
        return {
            "attempted": self.attempted,
            "inserted": self.inserted,
            "updated": self.updated,
            "matched": self.matched,
            "skipped": self.skipped,
            "failed": self.failed,
        }


@dataclass(slots=True)
class UploadReport:
    """Structured upload result used by upload_summary.json."""

    run_id: str | None
    started_at: str = field(default_factory=_utc_timestamp)
    finished_at: str | None = None
    status: str = "failed"
    collections: dict[str, UploadStats] = field(default_factory=dict)
    errors: list[dict[str, Any]] = field(default_factory=list)

    def finish(self, status: str) -> None:
        self.status = status
        self.finished_at = _utc_timestamp()

    def totals(self) -> dict[str, int]:
        fields = ("attempted", "inserted", "updated", "matched", "skipped", "failed")
        return {
            name: sum(getattr(stats, name) for stats in self.collections.values())
            for name in fields
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "status": self.status,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "collections": {
                name: stats.to_dict() for name, stats in self.collections.items()
            },
            "totals": self.totals(),
            "errors": list(self.errors),
        }

    def __bool__(self) -> bool:
        return self.status == "completed"


class MongoUploadError(RuntimeError):
    """Raised after a safe, non-sensitive failure report has been assembled."""

    def __init__(self, report: UploadReport, category: str = "unknown_error") -> None:
        self.report = report
        self.category = category
        super().__init__(ERROR_MESSAGES.get(category, ERROR_MESSAGES["unknown_error"]))


def read_json(file_path: Path) -> list[dict[str, Any]]:
    """Read JSON and normalize a list/object root to a list of dictionaries."""
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
    """Read JSONL into a list of dictionaries."""
    if not file_path.exists():
        LOGGER.warning("JSONL file does not exist: %s", file_path)
        return []
    return [item for item in load_jsonl_file(file_path) if isinstance(item, dict)]


def log_summary(collection_name: str, stats: UploadStats) -> None:
    LOGGER.info(
        "[MongoDB Summary] collection=%s attempted=%s inserted=%s updated=%s "
        "matched=%s skipped=%s failed=%s batches=%s",
        collection_name,
        stats.attempted,
        stats.inserted,
        stats.updated,
        stats.matched,
        stats.skipped,
        stats.failed,
        stats.bulk_operations,
    )


def _pymongo_types() -> tuple[Any, Any, Any]:
    """Import PyMongo lazily so compile-only checks do not require runtime services."""
    try:
        from pymongo import MongoClient, UpdateOne
        from pymongo import errors as pymongo_errors
    except ImportError as exc:
        raise RuntimeError(
            "pymongo is not installed. Run 'pip install -r requirements.txt' first."
        ) from exc
    return MongoClient, UpdateOne, pymongo_errors


def classify_error(exc: Exception) -> str:
    """Map an exception to a safe category without serializing its message."""
    try:
        _, _, pymongo_errors = _pymongo_types()
    except RuntimeError:
        return "configuration_error"

    if isinstance(exc, pymongo_errors.ConfigurationError):
        return "configuration_error"
    if isinstance(exc, pymongo_errors.OperationFailure) and getattr(exc, "code", None) == 18:
        return "authentication_error"
    if isinstance(
        exc,
        (
            pymongo_errors.ConnectionFailure,
            pymongo_errors.NetworkTimeout,
            pymongo_errors.ServerSelectionTimeoutError,
        ),
    ):
        return "connection_error"
    if isinstance(
        exc,
        (
            pymongo_errors.BulkWriteError,
            pymongo_errors.DuplicateKeyError,
            pymongo_errors.WriteError,
            pymongo_errors.WriteConcernError,
        ),
    ):
        return "duplicate_or_write_error"
    if isinstance(exc, (TypeError, ValueError)):
        return "validation_error"
    return "unknown_error"


def _append_error(
    errors: list[dict[str, Any]],
    category: str,
    collection_name: str | None = None,
    failed: int = 0,
) -> None:
    item: dict[str, Any] = {
        "category": category,
        "message": ERROR_MESSAGES.get(category, ERROR_MESSAGES["unknown_error"]),
    }
    if collection_name is not None:
        item["collection"] = collection_name
    if failed:
        item["failed"] = failed
    errors.append(item)


def _as_object_id(value: Any) -> Any | None:
    try:
        from bson import ObjectId
    except ImportError:  # pragma: no cover - pymongo provides bson in normal runs
        return None
    if not isinstance(value, str) or not ObjectId.is_valid(value):
        return None
    return ObjectId(value)


def _collection_names(config: PipelineConfig) -> dict[str, str]:
    return {
        "videos": config.mongodb_videos_collection or VIDEOS_COLLECTION,
        "transcripts": config.mongodb_transcripts_collection or TRANSCRIPTS_NORMALIZED_COLLECTION,
        "text_embeddings": (
            config.mongodb_text_embeddings_collection or VIDEO_SEGMENTS_TEXT_COLLECTION
        ),
        "video_embeddings": (
            config.mongodb_video_embeddings_collection or VIDEO_SEGMENTS_VIDEO_COLLECTION
        ),
    }


def _target_video_exists(database: Any, config: PipelineConfig) -> bool:
    """Protect backend-owned uploads from recreating a deleted Video record."""
    if not config.target_video_id:
        return True
    object_id = _as_object_id(config.target_video_id)
    if object_id is None:
        return True
    collection_name = _collection_names(config)["videos"]
    return database[collection_name].find_one({"_id": object_id}, {"_id": 1}) is not None


def _bulk_write(
    collection: Any,
    collection_name: str,
    operations: list[Any],
    stats: UploadStats,
    errors: list[dict[str, Any]],
    batch_size: int,
) -> None:
    """Execute unordered UpdateOne batches and retain supported PyMongo counters."""
    if not operations:
        return

    _, _, pymongo_errors = _pymongo_types()
    for batch in chunked(operations, max(1, batch_size)):
        stats.bulk_operations += 1
        try:
            result = collection.bulk_write(list(batch), ordered=False)
            stats.inserted += int(getattr(result, "upserted_count", 0) or 0)
            stats.updated += int(getattr(result, "modified_count", 0) or 0)
            stats.matched += int(getattr(result, "matched_count", 0) or 0)
        except pymongo_errors.BulkWriteError as exc:
            details = exc.details or {}
            stats.inserted += int(details.get("nUpserted", 0) or 0)
            stats.updated += int(details.get("nModified", 0) or 0)
            stats.matched += int(details.get("nMatched", 0) or 0)
            write_errors = details.get("writeErrors") or []
            failed_count = len(write_errors) or len(batch)
            stats.failed += failed_count
            _append_error(
                errors,
                "duplicate_or_write_error",
                collection_name,
                failed_count,
            )
            LOGGER.error(
                "[MongoDB Error] collection=%s category=duplicate_or_write_error failed=%s",
                collection_name,
                failed_count,
            )
        except Exception as exc:  # external driver/database state
            category = classify_error(exc)
            failed_count = len(batch)
            stats.failed += failed_count
            _append_error(errors, category, collection_name, failed_count)
            LOGGER.error(
                "[MongoDB Error] collection=%s category=%s failed=%s",
                collection_name,
                category,
                failed_count,
            )


def _new_update(filter_document: dict[str, Any], document: dict[str, Any], upsert: bool) -> Any:
    _, UpdateOne, _ = _pymongo_types()
    return UpdateOne(filter_document, {"$set": document}, upsert=upsert)


def upload_videos(
    database: Any,
    config: PipelineConfig,
    errors: list[dict[str, Any]] | None = None,
) -> UploadStats:
    """Batch-upload video metadata using _id for app videos or videoId otherwise."""
    error_items = errors if errors is not None else []
    collection_name = _collection_names(config)["videos"]
    collection = database[collection_name]
    source_path = config.output_dir / "videos.json"
    records = read_json(source_path)
    stats = UploadStats(attempted=len(records))
    operations: list[Any] = []
    required_keys = {"video_id", "file_name", "file_path", "audio_path", "duration_sec"}

    LOGGER.info("Uploading videos from %s into collection=%s", source_path, collection_name)
    for record in records:
        missing_keys = sorted(required_keys - record.keys())
        if missing_keys:
            stats.skipped += 1
            LOGGER.warning(
                "[MongoDB Skip] collection=%s reason=missing_keys keys=%s",
                collection_name,
                ",".join(missing_keys),
            )
            continue

        try:
            video_id = record["video_id"]
            video_source = record.get("video_source", "local")
            document = {
                "videoId": video_id,
                "fileName": record["file_name"],
                "filePath": record["file_path"],
                "audioPath": record["audio_path"],
                "durationSec": float(record["duration_sec"]),
                "week": record.get("week"),
                "lesson": record.get("lesson"),
                "videoSource": video_source,
                "videoUrl": record.get("video_url"),
            }
            object_id = _as_object_id(video_id)
            existing_app_video = (
                collection.find_one({"_id": object_id}) if object_id is not None else None
            )
            if existing_app_video is not None:
                if video_source == "youtube":
                    document = {
                        "videoId": video_id,
                        "durationSec": float(record["duration_sec"]),
                        "videoSource": "youtube",
                        "videoUrl": record.get("video_url"),
                    }
                operations.append(_new_update({"_id": object_id}, document, upsert=False))
            elif config.target_video_id and str(config.target_video_id) == str(video_id):
                stats.failed += 1
                _append_error(error_items, "validation_error", collection_name, 1)
                LOGGER.error(
                    "[MongoDB Error] collection=%s category=validation_error "
                    "reason=missing_backend_video",
                    collection_name,
                )
            else:
                operations.append(_new_update({"videoId": video_id}, document, upsert=True))
        except (TypeError, ValueError):
            stats.skipped += 1
            LOGGER.warning(
                "[MongoDB Skip] collection=%s reason=invalid_record",
                collection_name,
            )

    _bulk_write(
        collection,
        collection_name,
        operations,
        stats,
        error_items,
        config.mongodb_bulk_batch_size,
    )
    log_summary(collection_name, stats)
    return stats


def upload_transcripts_normalized(
    database: Any,
    config: PipelineConfig,
    errors: list[dict[str, Any]] | None = None,
) -> UploadStats:
    """Batch-upsert normalized transcripts by the existing video_id key."""
    error_items = errors if errors is not None else []
    collection_name = _collection_names(config)["transcripts"]
    collection = database[collection_name]
    source_path = config.normalized_transcript_output_path
    records = read_json(source_path)
    stats = UploadStats(attempted=len(records))
    operations: list[Any] = []

    LOGGER.info("Uploading normalized transcripts from %s into collection=%s", source_path, collection_name)
    for record in records:
        video_id = record.get("video_id")
        segments = record.get("segments")
        if not video_id or not isinstance(segments, list):
            stats.skipped += 1
            LOGGER.warning(
                "[MongoDB Skip] collection=%s reason=missing_video_id_or_segments",
                collection_name,
            )
            continue
        operations.append(
            _new_update(
                {"video_id": video_id},
                {"video_id": video_id, "segments": segments},
                upsert=True,
            )
        )

    _bulk_write(collection, collection_name, operations, stats, error_items, config.mongodb_bulk_batch_size)
    log_summary(collection_name, stats)
    return stats


def upload_text_embeddings(
    database: Any,
    config: PipelineConfig,
    errors: list[dict[str, Any]] | None = None,
) -> UploadStats:
    """Batch-upsert text embeddings by the existing camelCase chunkId key."""
    error_items = errors if errors is not None else []
    collection_name = _collection_names(config)["text_embeddings"]
    collection = database[collection_name]
    chunk_records = read_jsonl(config.chunks_output_path)
    embedding_records = read_jsonl(config.text_embeddings_output_path)
    chunk_map = {
        record.get("chunk_id"): record
        for record in chunk_records
        if isinstance(record.get("chunk_id"), str)
    }
    stats = UploadStats(attempted=len(embedding_records))
    operations: list[Any] = []
    required_keys = {"chunk_id", "video_id", "start_sec", "end_sec", "text", "embedding"}

    LOGGER.info(
        "Uploading text embeddings from %s into collection=%s",
        config.text_embeddings_output_path,
        collection_name,
    )
    for record in embedding_records:
        missing_keys = sorted(required_keys - record.keys())
        chunk_id = record.get("chunk_id")
        embedding = record.get("embedding")
        if missing_keys or not isinstance(embedding, list) or not embedding:
            stats.skipped += 1
            LOGGER.warning(
                "[MongoDB Skip] collection=%s reason=invalid_embedding_record",
                collection_name,
            )
            continue
        try:
            chunk_record = chunk_map.get(chunk_id, {})
            document = {
                "chunkId": chunk_id,
                "videoId": record["video_id"],
                "segmentId": chunk_record.get("segment_id"),
                "startSec": float(record["start_sec"]),
                "endSec": float(record["end_sec"]),
                "text": record["text"],
                "embedding": embedding,
            }
        except (TypeError, ValueError):
            stats.skipped += 1
            continue
        operations.append(_new_update({"chunkId": chunk_id}, document, upsert=True))

    _bulk_write(collection, collection_name, operations, stats, error_items, config.mongodb_bulk_batch_size)
    log_summary(collection_name, stats)
    return stats


def upload_video_embeddings(
    database: Any,
    config: PipelineConfig,
    errors: list[dict[str, Any]] | None = None,
) -> UploadStats:
    """Batch-upsert video embeddings by the existing clip_id key."""
    error_items = errors if errors is not None else []
    collection_name = _collection_names(config)["video_embeddings"]
    collection = database[collection_name]
    records = read_jsonl(config.video_embeddings_output_path)
    stats = UploadStats(attempted=len(records))
    operations: list[Any] = []
    required_keys = {"clip_id", "video_id", "start_sec", "end_sec", "clip_path", "embedding"}

    LOGGER.info(
        "Uploading video embeddings from %s into collection=%s",
        config.video_embeddings_output_path,
        collection_name,
    )
    for record in records:
        missing_keys = sorted(required_keys - record.keys())
        clip_id = record.get("clip_id")
        embedding = record.get("embedding")
        if missing_keys or not isinstance(embedding, list) or not embedding:
            stats.skipped += 1
            LOGGER.warning(
                "[MongoDB Skip] collection=%s reason=invalid_embedding_record",
                collection_name,
            )
            continue
        try:
            document = {
                "clip_id": clip_id,
                "video_id": record["video_id"],
                "start_sec": float(record["start_sec"]),
                "end_sec": float(record["end_sec"]),
                "clip_path": record["clip_path"],
                "embedding": embedding,
            }
        except (TypeError, ValueError):
            stats.skipped += 1
            continue
        operations.append(_new_update({"clip_id": clip_id}, document, upsert=True))

    _bulk_write(collection, collection_name, operations, stats, error_items, config.mongodb_bulk_batch_size)
    log_summary(collection_name, stats)
    return stats


def _determine_status(report: UploadReport, required_collections: Iterable[str]) -> str:
    required_missing = any(
        report.collections[name].success == 0 for name in required_collections
    )
    has_record_issues = any(
        stats.failed > 0 or stats.skipped > 0 for stats in report.collections.values()
    )
    total_success = sum(stats.success for stats in report.collections.values())
    if not required_missing and not has_record_issues and not report.errors:
        return "completed"
    return "partial" if total_success > 0 else "failed"


def upload_all(config: PipelineConfig) -> UploadReport:
    """Upload one output set; raise with a structured report on partial/failure."""
    names = _collection_names(config)
    report = UploadReport(run_id=config.run_id)
    for collection_name in names.values():
        report.collections.setdefault(collection_name, UploadStats())

    if not config.mongodb_uri:
        _append_error(report.errors, "configuration_error")
        report.finish("failed")
        raise MongoUploadError(report, "configuration_error")
    if config.mongodb_bulk_batch_size <= 0:
        _append_error(report.errors, "configuration_error")
        report.finish("failed")
        raise MongoUploadError(report, "configuration_error")

    try:
        MongoClient, _, _ = _pymongo_types()
    except RuntimeError:
        _append_error(report.errors, "configuration_error")
        report.finish("failed")
        raise MongoUploadError(report, "configuration_error")

    LOGGER.info("Connecting to MongoDB database=%s", config.mongodb_database_name)
    try:
        client = MongoClient(config.mongodb_uri)
    except Exception as exc:
        category = classify_error(exc)
        _append_error(report.errors, category)
        report.finish("failed")
        raise MongoUploadError(report, category) from None
    try:
        try:
            client.admin.command("ping")
        except Exception as exc:
            category = classify_error(exc)
            _append_error(report.errors, category)
            report.finish("failed")
            raise MongoUploadError(report, category) from None

        database = client[config.mongodb_database_name]
        try:
            target_exists = _target_video_exists(database, config)
        except Exception as exc:
            category = classify_error(exc)
            _append_error(report.errors, category, names["videos"])
            report.finish("failed")
            raise MongoUploadError(report, category) from None
        if not target_exists:
            _append_error(report.errors, "validation_error", names["videos"])
            report.finish("failed")
            raise MongoUploadError(report, "validation_error")

        uploaders = (
            (names["videos"], upload_videos),
            (names["transcripts"], upload_transcripts_normalized),
            (names["text_embeddings"], upload_text_embeddings),
            (names["video_embeddings"], upload_video_embeddings),
        )
        for collection_name, uploader in uploaders:
            try:
                report.collections[collection_name] = uploader(database, config, report.errors)
            except Exception as exc:
                category = classify_error(exc)
                stats = report.collections[collection_name]
                stats.failed += max(1, stats.attempted - stats.success - stats.skipped)
                _append_error(report.errors, category, collection_name, stats.failed)
                LOGGER.error(
                    "[MongoDB Error] collection=%s category=%s",
                    collection_name,
                    category,
                )

        required = (names["videos"], names["transcripts"], names["text_embeddings"])
        for collection_name, stats in report.collections.items():
            if stats.skipped > 0:
                _append_error(report.errors, "validation_error", collection_name)
        for collection_name in required:
            if report.collections[collection_name].success == 0:
                _append_error(report.errors, "validation_error", collection_name)

        status = _determine_status(report, required)
        report.finish(status)
        if status != "completed":
            category = report.errors[0]["category"] if report.errors else "unknown_error"
            raise MongoUploadError(report, category)

        LOGGER.info("MongoDB upload completed with status=completed")
        return report
    finally:
        close = getattr(client, "close", None)
        if callable(close):
            close()


def main() -> int:
    """Upload local pipeline outputs into configured MongoDB collections."""
    config = PipelineConfig.from_env()
    configure_logging(config.log_level)
    try:
        upload_all(config)
    except MongoUploadError as exc:
        LOGGER.error(
            "MongoDB upload ended with status=%s category=%s",
            exc.report.status,
            exc.category,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
