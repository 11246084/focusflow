"""Run-level summary artifacts for versioned pipeline outputs."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from utils import load_json_file, load_jsonl_file, write_json_file


OUTPUT_FILES = {
    "videos": "videos.json",
    "transcripts": "transcripts.json",
    "transcripts_normalized": "transcripts_normalized.json",
    "chunks": "chunks.jsonl",
    "parent_chunks": "parent_chunks.jsonl",
    "parent_embeddings": "embeddings_parent_gemini.jsonl",
    "text_embeddings": "embeddings_text_gemini.jsonl",
    "audio_embeddings": "embeddings_audio_gemini.jsonl",
    "upload_summary": "upload_summary.json",
    "manifest": "manifest.json",
}


def _utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json_count(path: Path) -> int:
    if not path.exists():
        return 0
    try:
        payload = load_json_file(path)
    except (OSError, ValueError, TypeError):
        return 0
    if isinstance(payload, list):
        return len(payload)
    return 1 if isinstance(payload, dict) else 0


def _jsonl_count(path: Path) -> int:
    if not path.exists():
        return 0
    try:
        return len(load_jsonl_file(path))
    except (OSError, ValueError, TypeError):
        return 0


def collect_output_counts(run_output_dir: Path) -> dict[str, int]:
    """Count available artifacts without failing when outputs are partial or missing."""
    return {
        "videos": _json_count(run_output_dir / OUTPUT_FILES["videos"]),
        "transcripts": _json_count(run_output_dir / OUTPUT_FILES["transcripts"]),
        "normalized_transcripts": _json_count(
            run_output_dir / OUTPUT_FILES["transcripts_normalized"]
        ),
        "chunks": _jsonl_count(run_output_dir / OUTPUT_FILES["chunks"]),
        "parent_chunks": _jsonl_count(run_output_dir / OUTPUT_FILES["parent_chunks"]),
        "parent_embeddings": _jsonl_count(run_output_dir / OUTPUT_FILES["parent_embeddings"]),
        "text_embeddings": _jsonl_count(run_output_dir / OUTPUT_FILES["text_embeddings"]),
        "audio_embeddings": _jsonl_count(run_output_dir / OUTPUT_FILES["audio_embeddings"]),
    }


def write_upload_summary(
    run_output_dir: Path,
    run_id: str,
    status: str,
    error: Exception | str | None = None,
    details: dict[str, Any] | None = None,
) -> Path:
    """Persist a detailed MongoDB upload outcome without changing DB schemas."""
    output_path = run_output_dir / OUTPUT_FILES["upload_summary"]
    report = details or {}
    collections = report.get("collections", {})
    count_fields = ("attempted", "inserted", "updated", "matched", "skipped", "failed")
    totals = {
        field_name: sum(
            int(collection_stats.get(field_name, 0) or 0)
            for collection_stats in collections.values()
            if isinstance(collection_stats, dict)
        )
        for field_name in count_fields
    }
    payload = {
        "run_id": run_id,
        "status": status,
        "started_at": report.get("started_at"),
        "finished_at": report.get("finished_at") or _utc_timestamp(),
        "collections": collections,
        "totals": totals,
        "errors": report.get("errors", []),
        "error": str(error) if error is not None else None,
    }
    write_json_file(output_path, payload, backup_existing=False)
    return output_path


def write_run_summary(
    run_output_dir: Path,
    run_id: str,
    status: str,
    created_at: str,
    error: Exception | str | None = None,
    chunk_config: dict[str, Any] | None = None,
    chunk_config_fingerprint: str | None = None,
    hierarchy_config: dict[str, Any] | None = None,
    hierarchy_config_fingerprint: str | None = None,
    hierarchy_metadata: dict[str, Any] | None = None,
    parent_embedding_config: dict[str, Any] | None = None,
    parent_embedding_fingerprint: str | None = None,
    parent_embedding_metadata: dict[str, Any] | None = None,
    stt_config: dict[str, Any] | None = None,
    stt_config_fingerprint: str | None = None,
    normalize_config: dict[str, Any] | None = None,
    normalize_config_fingerprint: str | None = None,
    stt_quality: dict[str, Any] | None = None,
) -> Path:
    """Write a final summary for either a completed or failed run."""
    output_path = run_output_dir / "run_summary.json"
    payload: dict[str, Any] = {
        "run_id": run_id,
        "status": status,
        "created_at": created_at,
        "finished_at": _utc_timestamp(),
        "output_files": dict(OUTPUT_FILES),
        "counts": collect_output_counts(run_output_dir),
        "error": str(error) if error is not None else None,
    }
    if chunk_config is not None:
        payload["chunk_config"] = dict(chunk_config)
        payload["chunk_overlap_segments"] = chunk_config.get("overlap_segments")
    if chunk_config_fingerprint is not None:
        payload["chunk_config_fingerprint"] = chunk_config_fingerprint
    if hierarchy_config is not None:
        payload["hierarchy"] = {
            "enabled": bool(hierarchy_config.get("enabled")),
            "strategy": hierarchy_config.get("strategy"),
            "parent_leaf_count": hierarchy_config.get("parent_leaf_count"),
            "parent_overlap_leaves": hierarchy_config.get("parent_overlap_leaves"),
            "fingerprint": hierarchy_config_fingerprint,
            "output_path": OUTPUT_FILES["parent_chunks"] if hierarchy_config.get("enabled") else None,
            "parent_count": payload["counts"]["parent_chunks"],
            "source_leaf_count": payload["counts"]["chunks"],
            **(hierarchy_metadata or {}),
        }
    if parent_embedding_config is not None:
        metadata = dict(parent_embedding_metadata or {})
        payload["parent_embedding"] = {
            "enabled": bool(parent_embedding_config.get("enabled")),
            "status": metadata.get("status", "skipped" if not parent_embedding_config.get("enabled") else None),
            "counts": {
                "required": int(metadata.get("required_count", 0) or 0),
                "success": int(metadata.get("success_count", 0) or 0),
                "reused": int(metadata.get("reused_count", 0) or 0),
                "failed": int(metadata.get("failed_count", 0) or 0),
            },
            "provider": parent_embedding_config.get("provider"),
            "model": parent_embedding_config.get("model"),
            "dimension": parent_embedding_config.get("dimension"),
            "fingerprint": parent_embedding_fingerprint,
            "output_path": metadata.get("artifact_path"),
        }
    if stt_config is not None:
        payload["stt"] = {
            "config": dict(stt_config),
            "fingerprint": stt_config_fingerprint,
            "quality": dict(stt_quality or {}),
        }
    if normalize_config is not None:
        payload["normalization"] = {
            "config": dict(normalize_config),
            "fingerprint": normalize_config_fingerprint,
        }
    write_json_file(output_path, payload, backup_existing=False)
    return output_path
