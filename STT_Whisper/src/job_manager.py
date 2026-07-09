"""Persistent run manifest support for the FocusFlow AI pipeline."""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PIPELINE_VERSION = "phase2_job_manager_v1"
STAGE_NAMES = (
    "scan",
    "extract_audio",
    "transcribe",
    "normalize",
    "chunk",
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
    def create_manifest(cls, runs_dir: Path, run_id: str | None = None) -> "JobManager":
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
        manager = cls(runs_dir / resolved_run_id / "manifest.json", manifest)
        manager._persist()
        return manager

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
        return video, video["stages"][stage_name]

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
            os.replace(temp_name, self.manifest_path)
        except Exception:
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass
            raise


def create_manifest(runs_dir: Path, run_id: str | None = None) -> JobManager:
    """Convenience factory matching the pipeline-facing API."""
    return JobManager.create_manifest(runs_dir, run_id)
