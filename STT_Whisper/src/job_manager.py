"""Persistent run manifest support for the FocusFlow AI pipeline."""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PIPELINE_VERSION = "phase2_job_manager_v1"
MANIFEST_REPLACE_MAX_ATTEMPTS = 5
MANIFEST_REPLACE_RETRY_DELAY_SECONDS = 0.05
logger = logging.getLogger(__name__)
STAGE_NAMES = (
    "scan",
    "extract_audio",
    "transcribe",
    "normalize",
    "chunk",
    "hierarchy",
    "parent_embedding",
    "text_embedding",
    "audio_embedding",
    "export",
    "mongodb_upload",
    "backend_webhook",
)


def _utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_stage() -> dict[str, Any]:
    return {
        "status": "pending",
        "started_at": None,
        "ended_at": None,
        "error": None,
    }


class JobManager:
    """Keep one pipeline run manifest durable on disk."""

    def __init__(self, manifest_path: Path, manifest: dict[str, Any]) -> None:
        self.manifest_path = manifest_path
        self.manifest = manifest

    @classmethod
    def create_manifest(
        cls,
        runs_dir: Path,
        run_id: str | None = None,
        chunk_config: dict[str, Any] | None = None,
        chunk_config_fingerprint: str | None = None,
        hierarchy_config: dict[str, Any] | None = None,
        hierarchy_config_fingerprint: str | None = None,
        parent_embedding_config: dict[str, Any] | None = None,
        parent_embedding_fingerprint: str | None = None,
        stt_config: dict[str, Any] | None = None,
        stt_config_fingerprint: str | None = None,
        normalize_config: dict[str, Any] | None = None,
        normalize_config_fingerprint: str | None = None,
    ) -> "JobManager":
        """Create and persist a new manifest under runs/<run_id>/manifest.json."""
        runs_dir = runs_dir.resolve()
        runs_dir.mkdir(parents=True, exist_ok=True)

        base_run_id = run_id or datetime.now().strftime("run_%Y%m%d_%H%M%S")
        resolved_run_id = base_run_id
        suffix = 1
        while (runs_dir / resolved_run_id).exists():
            resolved_run_id = f"{base_run_id}_{suffix:02d}"
            suffix += 1

        now = _utc_timestamp()
        manifest = {
            "run_id": resolved_run_id,
            "pipeline_version": PIPELINE_VERSION,
            "created_at": now,
            "updated_at": now,
            "status": "pending",
            "error": None,
            "videos": [],
        }
        if chunk_config is not None:
            manifest["chunk_config"] = dict(chunk_config)
        if chunk_config_fingerprint is not None:
            manifest["chunk_config_fingerprint"] = chunk_config_fingerprint
        if hierarchy_config is not None:
            manifest["hierarchy_config"] = dict(hierarchy_config)
        if hierarchy_config_fingerprint is not None:
            manifest["hierarchy_config_fingerprint"] = hierarchy_config_fingerprint
        if parent_embedding_config is not None:
            manifest["parent_embedding_config"] = dict(parent_embedding_config)
        if parent_embedding_fingerprint is not None:
            manifest["parent_embedding_fingerprint"] = parent_embedding_fingerprint
        if stt_config is not None:
            manifest["stt_config"] = dict(stt_config)
        if stt_config_fingerprint is not None:
            manifest["stt_config_fingerprint"] = stt_config_fingerprint
        if normalize_config is not None:
            manifest["normalize_config"] = dict(normalize_config)
        if normalize_config_fingerprint is not None:
            manifest["normalize_config_fingerprint"] = normalize_config_fingerprint
        manager = cls(runs_dir / resolved_run_id / "manifest.json", manifest)
        manager._persist()
        return manager

    @classmethod
    def load_manifest(cls, runs_dir: Path, run_id: str) -> "JobManager":
        """Load an existing manifest for resume without creating or overwriting it."""
        run_dir = runs_dir.resolve() / run_id
        if not run_dir.exists():
            raise FileNotFoundError(f"Resume run directory does not exist: {run_dir}")
        if not run_dir.is_dir():
            raise NotADirectoryError(f"Resume run path is not a directory: {run_dir}")

        manifest_path = run_dir / "manifest.json"
        if not manifest_path.exists():
            raise FileNotFoundError(f"Resume manifest does not exist: {manifest_path}")

        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Resume manifest is not valid JSON: {manifest_path}") from exc

        if not isinstance(manifest, dict):
            raise ValueError(f"Resume manifest root must be a JSON object: {manifest_path}")
        if manifest.get("run_id") != run_id:
            raise ValueError(
                f"Resume manifest run_id mismatch: expected {run_id}, got {manifest.get('run_id')}"
            )
        if not isinstance(manifest.get("videos"), list):
            raise ValueError(f"Resume manifest is missing a videos list: {manifest_path}")

        return cls(manifest_path, manifest)

    @property
    def run_id(self) -> str:
        return str(self.manifest["run_id"])

    def add_video(self, video_id: str, file_name: str, file_path: str) -> None:
        """Add a video record once scan metadata is available."""
        existing_video = self._find_video(video_id)
        if existing_video is not None:
            existing_video.update(file_name=file_name, file_path=file_path)
            self._persist()
            return

        self.manifest["videos"].append(
            {
                "video_id": video_id,
                "file_name": file_name,
                "file_path": file_path,
                "status": "pending",
                "current_stage": None,
                "error": None,
                "stages": {stage_name: _new_stage() for stage_name in STAGE_NAMES},
            }
        )
        self._persist()

    def start_stage(self, video_id: str, stage_name: str) -> None:
        video, stage = self._get_stage(video_id, stage_name)
        now = _utc_timestamp()
        self.manifest["status"] = "running"
        video["status"] = "running"
        video["current_stage"] = stage_name
        stage.update(status="running", started_at=now, ended_at=None, error=None)
        self._persist()

    def complete_stage(self, video_id: str, stage_name: str) -> None:
        _, stage = self._get_stage(video_id, stage_name)
        stage.update(status="completed", ended_at=_utc_timestamp(), error=None)
        self._persist()

    def skip_stage(self, video_id: str, stage_name: str) -> None:
        video, stage = self._get_stage(video_id, stage_name)
        now = _utc_timestamp()
        video["current_stage"] = stage_name
        stage.update(status="skipped", started_at=now, ended_at=now, error=None)
        self._persist()

    def fail_stage(self, video_id: str, stage_name: str, error: Exception | str) -> None:
        video, stage = self._get_stage(video_id, stage_name)
        message = str(error)
        stage.update(status="failed", ended_at=_utc_timestamp(), error=message)
        video.update(status="failed", current_stage=stage_name, error=message)
        self._persist()

    def complete_video(self, video_id: str) -> None:
        video = self._require_video(video_id)
        video.update(status="completed", current_stage="completed", error=None)
        self._persist()

    def fail_video(self, video_id: str, error: Exception | str) -> None:
        video = self._require_video(video_id)
        video.update(status="failed", error=str(error))
        self._persist()

    def complete_run(self) -> None:
        self.manifest.update(status="completed", error=None)
        self._persist()

    def fail_run(self, error: Exception | str) -> None:
        self.manifest.update(status="failed", error=str(error))
        self._persist()

    def set_chunk_config(
        self,
        chunk_config: dict[str, Any],
        chunk_config_fingerprint: str,
    ) -> None:
        """Persist the Chunk settings used by a new or resumed run."""
        if (
            self.manifest.get("chunk_config") == chunk_config
            and self.manifest.get("chunk_config_fingerprint") == chunk_config_fingerprint
        ):
            return
        self.manifest["chunk_config"] = dict(chunk_config)
        self.manifest["chunk_config_fingerprint"] = chunk_config_fingerprint
        self._persist()

    def set_stt_accuracy_configs(
        self,
        stt_config: dict[str, Any],
        stt_fingerprint: str,
        normalize_config: dict[str, Any],
        normalize_fingerprint: str,
    ) -> None:
        """Persist STT and normalization snapshots after resume planning."""
        self.manifest["stt_config"] = dict(stt_config)
        self.manifest["stt_config_fingerprint"] = stt_fingerprint
        self.manifest["normalize_config"] = dict(normalize_config)
        self.manifest["normalize_config_fingerprint"] = normalize_fingerprint
        self._persist()

    def set_hierarchy_metadata(
        self,
        hierarchy_config: dict[str, Any],
        hierarchy_config_fingerprint: str,
        *,
        artifact_path: str | None = None,
        parent_count: int | None = None,
        source_leaf_count: int | None = None,
        failure_summary: str | None = None,
    ) -> None:
        """Persist hierarchy config and compact generation metadata."""
        self.manifest["hierarchy_config"] = dict(hierarchy_config)
        self.manifest["hierarchy_config_fingerprint"] = hierarchy_config_fingerprint
        metadata = self.manifest.setdefault("hierarchy", {})
        metadata.update(
            {
                "enabled": bool(hierarchy_config.get("enabled")),
                "strategy": hierarchy_config.get("strategy"),
                "artifact_path": artifact_path,
                "parent_count": parent_count,
                "source_leaf_count": source_leaf_count,
                "failure_summary": failure_summary,
            }
        )
        self._persist()

    def reset_stages_from(self, stage_name: str) -> None:
        """Mark one stage and all later stages pending before a linear resume rerun."""
        if stage_name not in STAGE_NAMES:
            raise ValueError(f"Unknown pipeline stage: {stage_name}")

        start_index = STAGE_NAMES.index(stage_name)
        for video in self.manifest["videos"]:
            video["status"] = "pending"
            video["current_stage"] = stage_name
            video["error"] = None
            stages = video.get("stages", {})
            for downstream_stage in STAGE_NAMES[start_index:]:
                stages[downstream_stage] = _new_stage()
        self.manifest.update(status="pending", error=None)
        self._persist()

    def set_parent_embedding_metadata(
        self,
        config_snapshot: dict[str, Any],
        fingerprint: str | None,
        *,
        artifact_path: str | None = None,
        required_count: int = 0,
        success_count: int = 0,
        reused_count: int = 0,
        failed_count: int = 0,
        status: str | None = None,
        failure_summary: str | None = None,
    ) -> None:
        """Persist compact Parent Embedding state without vectors or secrets."""
        self.manifest["parent_embedding_config"] = dict(config_snapshot)
        if fingerprint is None:
            self.manifest.pop("parent_embedding_fingerprint", None)
        else:
            self.manifest["parent_embedding_fingerprint"] = fingerprint
        metadata = self.manifest.setdefault("parent_embedding", {})
        metadata.update(
            {
                "enabled": bool(config_snapshot.get("enabled")),
                "status": status,
                "config_snapshot": dict(config_snapshot),
                "fingerprint": fingerprint,
                "provider": config_snapshot.get("provider"),
                "model": config_snapshot.get("model"),
                "dimension": config_snapshot.get("dimension"),
                "schema_version": config_snapshot.get("schema_version"),
                "artifact_path": artifact_path,
                "required_count": required_count,
                "success_count": success_count,
                "reused_count": reused_count,
                "failed_count": failed_count,
                "failure_summary": failure_summary,
            }
        )
        self._persist()

    def _find_video(self, video_id: str) -> dict[str, Any] | None:
        return next(
            (video for video in self.manifest["videos"] if video["video_id"] == video_id),
            None,
        )

    def _require_video(self, video_id: str) -> dict[str, Any]:
        video = self._find_video(video_id)
        if video is None:
            raise KeyError(f"Video is not registered in manifest: {video_id}")
        return video

    def _get_stage(self, video_id: str, stage_name: str) -> tuple[dict[str, Any], dict[str, Any]]:
        if stage_name not in STAGE_NAMES:
            raise ValueError(f"Unknown pipeline stage: {stage_name}")
        video = self._require_video(video_id)
        stage = video.setdefault("stages", {}).setdefault(stage_name, _new_stage())
        return video, stage

    def _persist(self) -> None:
        """Atomically replace the UTF-8 manifest after every state change."""
        self.manifest["updated_at"] = _utc_timestamp()
        self.manifest_path.parent.mkdir(parents=True, exist_ok=True)
        content = json.dumps(self.manifest, ensure_ascii=False, indent=2) + "\n"

        file_descriptor, temp_name = tempfile.mkstemp(
            prefix=f".{self.manifest_path.name}.",
            suffix=".tmp",
            dir=self.manifest_path.parent,
        )
        try:
            with os.fdopen(file_descriptor, "w", encoding="utf-8", newline="\n") as temp_file:
                temp_file.write(content)
                temp_file.flush()
                os.fsync(temp_file.fileno())
            for attempt in range(1, MANIFEST_REPLACE_MAX_ATTEMPTS + 1):
                try:
                    os.replace(temp_name, self.manifest_path)
                    break
                except OSError as exc:
                    is_transient_windows_lock = isinstance(exc, PermissionError) or getattr(
                        exc, "winerror", None
                    ) in {5, 32}
                    if not is_transient_windows_lock or attempt == MANIFEST_REPLACE_MAX_ATTEMPTS:
                        raise
                    delay = MANIFEST_REPLACE_RETRY_DELAY_SECONDS * attempt
                    logger.warning(
                        "Manifest replace temporarily blocked; retrying (%s/%s) in %.2fs: %s",
                        attempt,
                        MANIFEST_REPLACE_MAX_ATTEMPTS,
                        delay,
                        self.manifest_path,
                    )
                    time.sleep(delay)
        except Exception:
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass
            raise


def create_manifest(
    runs_dir: Path,
    run_id: str | None = None,
    chunk_config: dict[str, Any] | None = None,
    chunk_config_fingerprint: str | None = None,
    hierarchy_config: dict[str, Any] | None = None,
    hierarchy_config_fingerprint: str | None = None,
    parent_embedding_config: dict[str, Any] | None = None,
    parent_embedding_fingerprint: str | None = None,
    stt_config: dict[str, Any] | None = None,
    stt_config_fingerprint: str | None = None,
    normalize_config: dict[str, Any] | None = None,
    normalize_config_fingerprint: str | None = None,
) -> JobManager:
    """Convenience factory matching the pipeline-facing API."""
    return JobManager.create_manifest(
        runs_dir,
        run_id,
        chunk_config,
        chunk_config_fingerprint,
        hierarchy_config,
        hierarchy_config_fingerprint,
        parent_embedding_config,
        parent_embedding_fingerprint,
        stt_config,
        stt_config_fingerprint,
        normalize_config,
        normalize_config_fingerprint,
    )


def load_manifest(runs_dir: Path, run_id: str) -> JobManager:
    """Convenience loader for resume mode."""
    return JobManager.load_manifest(runs_dir, run_id)
