"""Upload FocusFlow output artifacts into MongoDB with bulk upserts."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Iterable

from config import PipelineConfig
from utils import chunked, configure_logging, load_json_file, load_jsonl_file


logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments for the MongoDB uploader."""
    parser = argparse.ArgumentParser(description="Upload FocusFlow output files into MongoDB.")
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Project root directory.",
    )
    parser.add_argument(
        "--include-video-embeddings",
        action="store_true",
        help="Also upload embeddings_video_gemini.jsonl when it exists.",
    )
    return parser.parse_args()


def _load_collection_records(path: Path) -> list[dict]:
    """Load either JSON or JSONL records from disk."""
    if not path.exists():
        logger.warning("Skipping missing file: %s", path)
        return []

    if path.suffix.lower() == ".json":
        payload = load_json_file(path)
        return payload if isinstance(payload, list) else []
    if path.suffix.lower() == ".jsonl":
        return load_jsonl_file(path)
    raise ValueError(f"Unsupported upload file format: {path}")


def _bulk_upsert(collection, records: list[dict], key_field: str, batch_size: int) -> int:
    """Upsert documents into one MongoDB collection using bulk_write."""
    if not records:
        return 0

    try:
        from pymongo import UpdateOne
    except ImportError as exc:  # pragma: no cover - depends on local environment
        raise RuntimeError("pymongo is not installed. Run 'pip install -r requirements.txt' first.") from exc

    total_upserts = 0
    for batch in chunked(records, batch_size):
        operations = []
        for record in batch:
            if key_field not in record:
                logger.warning("Skipping record without key field %s: %s", key_field, record)
                continue
            operations.append(
                UpdateOne(
                    {key_field: record[key_field]},
                    {"$set": record},
                    upsert=True,
                )
            )
        if not operations:
            continue
        result = collection.bulk_write(operations, ordered=False)
        total_upserts += result.upserted_count + result.modified_count + result.matched_count
    return total_upserts


def _iter_upload_jobs(config: PipelineConfig, include_video_embeddings: bool) -> Iterable[tuple[str, Path, str, str]]:
    """Yield the file-path, collection-name, and primary-key mapping for upload."""
    yield ("videos", config.output_dir / "videos.json", config.mongodb_videos_collection, "video_id")
    yield (
        "transcripts",
        config.output_dir / "transcripts.json",
        config.mongodb_transcripts_collection,
        "video_id",
    )
    yield ("chunks", config.chunks_output_path, config.mongodb_chunks_collection, "chunk_id")
    yield (
        "embeddings_text_gemini",
        config.text_embeddings_output_path,
        config.mongodb_text_embeddings_collection,
        "chunk_id",
    )
    if include_video_embeddings:
        yield (
            "embeddings_video_gemini",
            config.video_embeddings_output_path,
            config.mongodb_video_embeddings_collection,
            "clip_id",
        )


def main() -> int:
    """Upload FocusFlow artifacts into MongoDB and return a process exit code."""
    args = parse_args()
    config = PipelineConfig.from_env(project_root=args.project_root.resolve())
    configure_logging(config.log_level)

    if not config.mongodb_uri:
        raise RuntimeError("MONGODB_URI is not set in .env.")

    try:
        from pymongo import MongoClient
    except ImportError as exc:  # pragma: no cover - depends on local environment
        raise RuntimeError("pymongo is not installed. Run 'pip install -r requirements.txt' first.") from exc

    logger.info("Connecting to MongoDB database=%s", config.mongodb_database_name)
    client = MongoClient(config.mongodb_uri)
    client.admin.command("ping")
    database = client[config.mongodb_database_name]

    summary: dict[str, int] = {}
    for job_name, file_path, collection_name, key_field in _iter_upload_jobs(
        config,
        include_video_embeddings=args.include_video_embeddings,
    ):
        records = _load_collection_records(file_path)
        if not records:
            summary[job_name] = 0
            continue

        logger.info(
            "Uploading %s records from %s into collection=%s using key=%s",
            len(records),
            file_path,
            collection_name,
            key_field,
        )
        summary[job_name] = _bulk_upsert(
            database[collection_name],
            records,
            key_field,
            config.mongodb_bulk_batch_size,
        )

    print("MongoDB upload completed.")
    for job_name, count in summary.items():
        print(f"{job_name}: {count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
