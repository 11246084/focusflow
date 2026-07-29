"""Resume planning and checkpoint loading for versioned pipeline runs."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from chunk_strategy import (
    build_chunk_config_fingerprint,
    is_legacy_compatible_chunk_config,
)
from hierarchy_chunking import validate_parent_artifact
from hierarchy_strategy import build_hierarchy_config_fingerprint
from job_manager import STAGE_NAMES, JobManager
from run_summary import OUTPUT_FILES
from utils import (
    AudioEmbeddingRecord,
    ChunkRecord,
    EmbeddingRecord,
    TranscriptDocument,
    VideoMetadata,
    load_json_file,
    load_jsonl_file,
)


logger = logging.getLogger(__name__)


class CheckpointError(ValueError):
    """Raised when a checkpoint exists but cannot safely support resume."""


@dataclass(slots=True)
class ResumePlan:
    """Linear resume decision for one existing run."""

    run_id: str
    run_output_dir: Path
    restart_stage: str | None
    skipped_stages: set[str] = field(default_factory=set)
    data: dict[str, Any] = field(default_factory=dict)
    reason: str | None = None

    def should_skip(self, stage_name: str) -> bool:
        return stage_name in self.skipped_stages


def _require_non_empty_file(path: Path) -> None:
    if not path.exists():
        raise CheckpointError(f"checkpoint missing: {path}")
    if not path.is_file():
        raise CheckpointError(f"checkpoint is not a file: {path}")
    if path.stat().st_size <= 0:
        raise CheckpointError(f"checkpoint is empty: {path}")


def _load_non_empty_json(path: Path) -> Any:
    _require_non_empty_file(path)
    try:
        payload = load_json_file(path)
    except Exception as exc:
        raise CheckpointError(f"checkpoint JSON is invalid: {path}") from exc
    if payload in (None, [], {}):
        raise CheckpointError(f"checkpoint JSON has no records: {path}")
    return payload


def _load_non_empty_jsonl(path: Path) -> list[dict[str, Any]]:
    _require_non_empty_file(path)
    try:
        payload = load_jsonl_file(path)
    except Exception as exc:
        raise CheckpointError(f"checkpoint JSONL is invalid: {path}") from exc
    if not payload:
        raise CheckpointError(f"checkpoint JSONL has no records: {path}")
    if not all(isinstance(record, dict) for record in payload):
        raise CheckpointError(f"checkpoint JSONL must contain JSON objects: {path}")
    return payload


def _load_videos(run_output_dir: Path) -> list[VideoMetadata]:
    path = run_output_dir / OUTPUT_FILES["videos"]
    payload = _load_non_empty_json(path)
    if not isinstance(payload, list):
        raise CheckpointError(f"videos checkpoint must be a JSON array: {path}")
    try:
        videos = [VideoMetadata(**item) for item in payload if isinstance(item, dict)]
    except Exception as exc:
        raise CheckpointError(f"videos checkpoint schema is invalid: {path}") from exc
    if not videos or len(videos) != len(payload):
        raise CheckpointError(f"videos checkpoint has invalid records: {path}")
    logger.info("Loaded checkpoint: %s", path)
    return videos


def _load_transcripts(run_output_dir: Path, file_name: str) -> list[TranscriptDocument]:
    path = run_output_dir / file_name
    payload = _load_non_empty_json(path)
    if not isinstance(payload, list):
        raise CheckpointError(f"transcript checkpoint must be a JSON array: {path}")
    try:
        documents = [TranscriptDocument.from_dict(item) for item in payload if isinstance(item, dict)]
    except Exception as exc:
        raise CheckpointError(f"transcript checkpoint schema is invalid: {path}") from exc
    if not documents or len(documents) != len(payload):
        raise CheckpointError(f"transcript checkpoint has invalid records: {path}")
    logger.info("Loaded checkpoint: %s", path)
    return documents


def _load_chunks(run_output_dir: Path) -> list[ChunkRecord]:
    path = run_output_dir / OUTPUT_FILES["chunks"]
    payload = _load_non_empty_jsonl(path)
    try:
        chunks = [ChunkRecord(**record) for record in payload]
    except Exception as exc:
        raise CheckpointError(f"chunks checkpoint schema is invalid: {path}") from exc
    logger.info("Loaded checkpoint: %s", path)
    return chunks


def _load_text_embeddings(run_output_dir: Path) -> list[EmbeddingRecord]:
    path = run_output_dir / OUTPUT_FILES["text_embeddings"]
    payload = _load_non_empty_jsonl(path)
    try:
        embeddings = [EmbeddingRecord(**record) for record in payload]
    except Exception as exc:
        raise CheckpointError(f"text embedding checkpoint schema is invalid: {path}") from exc
    logger.info("Loaded checkpoint: %s", path)
    return embeddings


def _load_audio_embeddings(run_output_dir: Path) -> list[AudioEmbeddingRecord]:
    path = run_output_dir / OUTPUT_FILES["audio_embeddings"]
    payload = _load_non_empty_jsonl(path)
    try:
        embeddings = [AudioEmbeddingRecord(**record) for record in payload]
    except Exception as exc:
        raise CheckpointError(f"audio embedding checkpoint schema is invalid: {path}") from exc
    logger.info("Loaded checkpoint: %s", path)
    return embeddings


def _validate_audio_files(videos: list[VideoMetadata], project_root: Path) -> None:
    if not videos:
        raise CheckpointError("extract_audio checkpoint cannot be validated without videos")
    for video in videos:
        if not video.audio_path:
            raise CheckpointError(f"audio checkpoint path is empty for video: {video.video_id}")
        audio_path = project_root / video.audio_path
        if not audio_path.exists():
            raise CheckpointError(f"audio checkpoint missing: {audio_path}")
        if audio_path.stat().st_size <= 0:
            raise CheckpointError(f"audio checkpoint is empty: {audio_path}")
    logger.info("Loaded checkpoint: extracted audio files for %s videos", len(videos))


def _validate_export_outputs(run_output_dir: Path) -> dict[str, Path]:
    output_paths = {
        "videos": run_output_dir / OUTPUT_FILES["videos"],
        "transcripts": run_output_dir / OUTPUT_FILES["transcripts"],
        "transcripts_normalized": run_output_dir / OUTPUT_FILES["transcripts_normalized"],
        "chunks": run_output_dir / OUTPUT_FILES["chunks"],
        "embeddings_text_gemini": run_output_dir / OUTPUT_FILES["text_embeddings"],
        "embeddings_audio_gemini": run_output_dir / OUTPUT_FILES["audio_embeddings"],
    }
    for path in output_paths.values():
        _require_non_empty_file(path)
    logger.info("Loaded checkpoint: export outputs in %s", run_output_dir)
    return output_paths


def _validate_upload_summary(run_output_dir: Path) -> None:
    path = run_output_dir / OUTPUT_FILES["upload_summary"]
    payload = _load_non_empty_json(path)
    if not isinstance(payload, dict) or payload.get("status") != "completed":
        raise CheckpointError(f"upload_summary checkpoint is not completed: {path}")
    logger.info("Loaded checkpoint: %s", path)


def _validate_chunk_config_fingerprint(
    manifest: dict[str, Any],
    current_chunk_config: dict[str, Any],
    current_chunk_config_fingerprint: str,
) -> None:
    """Reject Chunk checkpoints produced with different or corrupt settings."""
    stored_fingerprint = manifest.get("chunk_config_fingerprint")
    stored_config = manifest.get("chunk_config")

    if stored_fingerprint is None:
        if is_legacy_compatible_chunk_config(current_chunk_config):
            return
        raise CheckpointError(
            "legacy manifest has no chunk fingerprint and current Chunk config is not legacy-compatible"
        )

    if not isinstance(stored_fingerprint, str) or len(stored_fingerprint) != 64:
        raise CheckpointError("manifest chunk_config_fingerprint is invalid")
    try:
        int(stored_fingerprint, 16)
    except ValueError as exc:
        raise CheckpointError("manifest chunk_config_fingerprint is invalid") from exc
    if not isinstance(stored_config, dict):
        raise CheckpointError("manifest chunk_config is missing or invalid")
    if build_chunk_config_fingerprint(stored_config) != stored_fingerprint:
        raise CheckpointError("manifest Chunk config fingerprint does not match its snapshot")
    if stored_fingerprint != current_chunk_config_fingerprint:
        raise CheckpointError("Chunk config fingerprint differs from the current runtime")


def _validate_hierarchy_config_fingerprint(
    manifest: dict[str, Any],
    current_hierarchy_config: dict[str, Any],
    current_hierarchy_fingerprint: str,
    current_chunk_fingerprint: str,
) -> None:
    stored_config = manifest.get("hierarchy_config")
    stored_fingerprint = manifest.get("hierarchy_config_fingerprint")
    if not isinstance(stored_config, dict) or not isinstance(stored_fingerprint, str):
        raise CheckpointError("manifest has no reusable hierarchy fingerprint")
    if len(stored_fingerprint) != 64:
        raise CheckpointError("manifest hierarchy_config_fingerprint is invalid")
    try:
        int(stored_fingerprint, 16)
    except ValueError as exc:
        raise CheckpointError("manifest hierarchy_config_fingerprint is invalid") from exc
    expected = build_hierarchy_config_fingerprint(stored_config, current_chunk_fingerprint)
    if expected != stored_fingerprint:
        raise CheckpointError("manifest hierarchy fingerprint does not match its dependencies")
    if stored_config != current_hierarchy_config or stored_fingerprint != current_hierarchy_fingerprint:
        raise CheckpointError("Hierarchy config fingerprint differs from the current runtime")


def _stage_statuses(job_manager: JobManager, stage_name: str) -> list[str]:
    return [
        str(video.get("stages", {}).get(stage_name, {}).get("status", "pending"))
        for video in job_manager.manifest["videos"]
    ]


def _all_completed_or_skipped(statuses: list[str]) -> bool:
    return bool(statuses) and all(status in {"completed", "skipped"} for status in statuses)


def _checkpoint_for_stage(
    stage_name: str,
    plan: ResumePlan,
    project_root: Path,
    run_status: str,
) -> None:
    data = plan.data
    run_output_dir = plan.run_output_dir

    if stage_name == "scan":
        data["videos"] = _load_videos(run_output_dir)
    elif stage_name == "extract_audio":
        _validate_audio_files(data.get("videos", []), project_root)
    elif stage_name == "transcribe":
        data["transcripts"] = _load_transcripts(run_output_dir, OUTPUT_FILES["transcripts"])
    elif stage_name == "normalize":
        data["normalized_transcripts"] = _load_transcripts(
            run_output_dir,
            OUTPUT_FILES["transcripts_normalized"],
        )
    elif stage_name == "chunk":
        data["chunks"] = _load_chunks(run_output_dir)
    elif stage_name == "hierarchy":
        try:
            data["parent_chunks"] = validate_parent_artifact(
                run_output_dir / OUTPUT_FILES["parent_chunks"],
                data.get("chunks", []),
            )
        except ValueError as exc:
            raise CheckpointError(str(exc)) from exc
    elif stage_name == "text_embedding":
        data["text_embeddings"] = _load_text_embeddings(run_output_dir)
    elif stage_name == "audio_embedding":
        data["audio_embeddings"] = _load_audio_embeddings(run_output_dir)
    elif stage_name == "export":
        data["output_paths"] = _validate_export_outputs(run_output_dir)
    elif stage_name == "mongodb_upload":
        _validate_upload_summary(run_output_dir)
    elif stage_name == "backend_webhook":
        if run_status != "completed":
            raise CheckpointError("backend_webhook can only be skipped for a completed run")
    else:
        raise CheckpointError(f"unknown stage: {stage_name}")


def build_resume_plan(
    job_manager: JobManager,
    project_root: Path,
    current_chunk_config: dict[str, Any],
    current_chunk_config_fingerprint: str,
    current_hierarchy_config: dict[str, Any] | None = None,
    current_hierarchy_fingerprint: str | None = None,
) -> ResumePlan:
    """Find the first stage that cannot be safely skipped and load prior checkpoints."""
    plan = ResumePlan(
        run_id=job_manager.run_id,
        run_output_dir=job_manager.manifest_path.parent,
        restart_stage=None,
    )
    hierarchy_enabled = bool(
        current_hierarchy_config and current_hierarchy_config.get("enabled")
    )

    for stage_name in STAGE_NAMES:
        if stage_name == "hierarchy" and not hierarchy_enabled:
            plan.skipped_stages.add(stage_name)
            logger.info("Hierarchy disabled, treating stage as skipped.")
            continue
        statuses = _stage_statuses(job_manager, stage_name)
        if _all_completed_or_skipped(statuses):
            try:
                if stage_name == "chunk":
                    _validate_chunk_config_fingerprint(
                        job_manager.manifest,
                        current_chunk_config,
                        current_chunk_config_fingerprint,
                    )
                elif stage_name == "hierarchy":
                    if current_hierarchy_config is None or current_hierarchy_fingerprint is None:
                        raise CheckpointError("current hierarchy config is missing")
                    _validate_hierarchy_config_fingerprint(
                        job_manager.manifest,
                        current_hierarchy_config,
                        current_hierarchy_fingerprint,
                        current_chunk_config_fingerprint,
                    )
                _checkpoint_for_stage(
                    stage_name,
                    plan,
                    project_root,
                    str(job_manager.manifest.get("status")),
                )
            except CheckpointError as exc:
                logger.info("Checkpoint invalid, restarting from stage: %s (%s)", stage_name, exc)
                plan.restart_stage = stage_name
                plan.reason = str(exc)
                break
            plan.skipped_stages.add(stage_name)
            logger.info("Checkpoint valid, skipping stage: %s", stage_name)
            continue

        if any(status == "running" for status in statuses):
            logger.info("Re-executing interrupted stage: %s", stage_name)
        elif any(status == "failed" for status in statuses):
            logger.info("Checkpoint missing, restarting from stage: %s", stage_name)
        else:
            logger.info("Checkpoint missing, restarting from stage: %s", stage_name)
        plan.restart_stage = stage_name
        plan.reason = f"stage status is not completed: {statuses}"
        break

    if plan.restart_stage is not None:
        job_manager.reset_stages_from(plan.restart_stage)

    return plan
