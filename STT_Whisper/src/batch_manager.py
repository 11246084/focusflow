"""Bounded, durable orchestration for isolated single-video pipeline runs."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Protocol


BATCH_STATUSES = {"pending", "running", "completed", "partial", "failed"}
ITEM_STATUSES = {"queued", "running", "completed", "retrying", "failed", "skipped"}
SENSITIVE_PATTERN = re.compile(
    r"(?i)(api[_-]?key|mongodb(?:\+srv)?://|token|secret|authorization|password)"
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_batch_id() -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return f"batch_{timestamp}_{uuid.uuid4().hex[:8]}"


def sanitize_error(error: object) -> str:
    message = str(error).replace("\r", " ").replace("\n", " ").strip()
    if SENSITIVE_PATTERN.search(message):
        return "Pipeline failed; sensitive error details were redacted."
    return message[:1000] or type(error).__name__


class BatchValidationError(ValueError):
    """An item error that must never consume retry allowance."""


class BatchAlreadyRunningError(RuntimeError):
    """Raised when another live process owns the batch execution lease."""


def _process_is_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except (OSError, SystemError):
        return False
    return True


class BatchExecutionLease:
    """Cross-process lease preventing concurrent mutation of one batch manifest."""

    def __init__(self, batch_dir: Path) -> None:
        self.batch_dir = batch_dir.resolve()
        self.path = self.batch_dir / ".execution.lock"
        self.token = uuid.uuid4().hex
        self.acquired = False

    def acquire(self) -> "BatchExecutionLease":
        self.batch_dir.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({
            "pid": os.getpid(),
            "token": self.token,
            "acquired_at": utc_now(),
        })
        for _attempt in range(2):
            try:
                descriptor = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
            except FileExistsError:
                try:
                    owner = json.loads(self.path.read_text(encoding="utf-8"))
                    owner_pid = int(owner.get("pid") or 0)
                except (OSError, ValueError, TypeError, json.JSONDecodeError):
                    owner_pid = 0
                if _process_is_alive(owner_pid):
                    raise BatchAlreadyRunningError(
                        f"Batch is already running in process {owner_pid}."
                    )
                try:
                    self.path.unlink()
                except FileNotFoundError:
                    pass
                continue
            try:
                os.write(descriptor, payload.encode("utf-8"))
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            self.acquired = True
            return self
        raise BatchAlreadyRunningError("Batch execution lease could not be acquired.")

    def release(self) -> None:
        if not self.acquired:
            return
        try:
            owner = json.loads(self.path.read_text(encoding="utf-8"))
            if owner.get("token") == self.token:
                self.path.unlink()
        except (FileNotFoundError, OSError, json.JSONDecodeError):
            pass
        finally:
            self.acquired = False

    def __enter__(self) -> "BatchExecutionLease":
        return self.acquire()

    def __exit__(self, _exc_type, _exc, _traceback) -> None:
        self.release()


@dataclass(slots=True)
class PipelineRunResult:
    run_id: str
    output_directory: str | None = None
    video_id: str | None = None


class PipelineRunner(Protocol):
    def run(
        self,
        video_path: Path,
        run_id: str,
        resume: bool,
        video_id: str | None = None,
    ) -> PipelineRunResult:
        """Run or resume exactly one existing single-video pipeline."""


@dataclass(slots=True)
class BatchItem:
    item_id: str
    video_path: str
    run_id: str
    requested_video_id: str | None = None
    status: str = "queued"
    video_id: str | None = None
    attempt_count: int = 0
    max_attempts: int = 1
    created_at: str = field(default_factory=utc_now)
    started_at: str | None = None
    completed_at: str | None = None
    last_error_code: str | None = None
    last_error_message: str | None = None
    resume_used: bool = False
    output_directory: str | None = None


@dataclass(slots=True)
class BatchJob:
    batch_id: str
    max_concurrency: int
    max_retries: int
    input_source: str
    items: list[BatchItem]
    status: str = "pending"
    created_at: str = field(default_factory=utc_now)
    started_at: str | None = None
    completed_at: str | None = None

    def counts(self) -> dict[str, int]:
        return {
            "total_items": len(self.items),
            "queued_items": sum(item.status == "queued" for item in self.items),
            "running_items": sum(item.status == "running" for item in self.items),
            "completed_items": sum(item.status == "completed" for item in self.items),
            "failed_items": sum(item.status == "failed" for item in self.items),
            "retrying_items": sum(item.status == "retrying" for item in self.items),
            "skipped_items": sum(item.status == "skipped" for item in self.items),
        }

    def to_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload.update(self.counts())
        terminal = payload["completed_items"] + payload["failed_items"] + payload["skipped_items"]
        payload["progress_percent"] = (
            round(terminal / len(self.items) * 100, 2) if self.items else 100.0
        )
        return payload

    @classmethod
    def from_dict(cls, payload: dict[str, object]) -> "BatchJob":
        return cls(
            batch_id=str(payload["batch_id"]),
            max_concurrency=int(payload["max_concurrency"]),
            max_retries=int(payload["max_retries"]),
            input_source=str(payload["input_source"]),
            items=[BatchItem(**item) for item in payload["items"]],
            status=str(payload["status"]),
            created_at=str(payload["created_at"]),
            started_at=payload.get("started_at"),
            completed_at=payload.get("completed_at"),
        )


def _atomic_write_json(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()


def create_batch(
    paths: Iterable[Path],
    output_root: Path,
    *,
    input_source: str,
    max_concurrency: int = 1,
    max_retries: int = 0,
    supported_extensions: tuple[str, ...] = (".mp4", ".mov", ".mkv"),
    batch_id: str | None = None,
) -> "BatchManager":
    if not 1 <= max_concurrency <= 2:
        raise BatchValidationError("max_concurrency must be between 1 and 2.")
    if not 0 <= max_retries <= 2:
        raise BatchValidationError("max_retries must be between 0 and 2.")

    resolved_batch_id = batch_id or create_batch_id()
    normalized: dict[str, Path] = {}
    invalid: list[tuple[Path, str, str]] = []
    for raw_path in paths:
        path = Path(raw_path).expanduser().resolve()
        key = os.path.normcase(str(path))
        if key in normalized:
            continue
        if not path.exists() or not path.is_file():
            invalid.append((path, "INPUT_NOT_FOUND", "Input video file does not exist."))
        elif path.suffix.lower() not in supported_extensions:
            invalid.append((path, "UNSUPPORTED_VIDEO_FORMAT", "Unsupported video file extension."))
        else:
            normalized[key] = path

    ordered_paths = sorted(normalized.values(), key=lambda value: os.path.normcase(str(value)))
    items: list[BatchItem] = []
    for index, path in enumerate(ordered_paths, start=1):
        item_id = f"item_{index:04d}"
        items.append(
            BatchItem(
                item_id=item_id,
                video_path=str(path),
                run_id=f"run_{resolved_batch_id}_{item_id}",
                max_attempts=1 + max_retries,
            )
        )
    for path, code, message in sorted(invalid, key=lambda value: os.path.normcase(str(value[0]))):
        item_id = f"item_{len(items) + 1:04d}"
        items.append(
            BatchItem(
                item_id=item_id,
                video_path=str(path),
                run_id=f"run_{resolved_batch_id}_{item_id}",
                status="skipped",
                max_attempts=1 + max_retries,
                completed_at=utc_now(),
                last_error_code=code,
                last_error_message=message,
            )
        )

    job = BatchJob(
        batch_id=resolved_batch_id,
        max_concurrency=max_concurrency,
        max_retries=max_retries,
        input_source=input_source,
        items=items,
    )
    manager = BatchManager(output_root / "batches" / resolved_batch_id, job)
    manager.persist()
    return manager


def create_batch_from_request(
    request_items: Iterable[dict[str, object]],
    output_root: Path,
    *,
    batch_id: str,
    input_source: str,
    max_concurrency: int = 1,
    max_retries: int = 0,
    supported_extensions: tuple[str, ...] = (".mp4", ".mov", ".mkv"),
) -> "BatchManager":
    if not re.fullmatch(r"batch_[0-9]{14}_[a-f0-9]{8}", str(batch_id), re.IGNORECASE):
        raise BatchValidationError("Invalid requested batch_id.")
    if not 1 <= max_concurrency <= 2:
        raise BatchValidationError("max_concurrency must be between 1 and 2.")
    if not 0 <= max_retries <= 2:
        raise BatchValidationError("max_retries must be between 0 and 2.")

    items: list[BatchItem] = []
    seen_item_ids: set[str] = set()
    seen_paths: set[str] = set()
    for raw in request_items:
        item_id = str(raw.get("itemId") or "").strip()
        video_id = str(raw.get("videoId") or "").strip()
        raw_path = str(raw.get("videoPath") or "").strip()
        if not re.fullmatch(r"item_[0-9]{4}", item_id):
            raise BatchValidationError("Invalid requested itemId.")
        if not video_id or not raw_path:
            raise BatchValidationError("Each requested item requires videoId and videoPath.")
        path = Path(raw_path).expanduser().resolve()
        normalized_path = os.path.normcase(str(path))
        if item_id in seen_item_ids or normalized_path in seen_paths:
            raise BatchValidationError("Requested batch contains duplicate itemId or videoPath.")
        seen_item_ids.add(item_id)
        seen_paths.add(normalized_path)
        error_code = None
        error_message = None
        status = "queued"
        completed_at = None
        if not path.exists() or not path.is_file():
            status = "skipped"
            completed_at = utc_now()
            error_code = "INPUT_NOT_FOUND"
            error_message = "Input video file does not exist."
        elif path.suffix.lower() not in supported_extensions:
            status = "skipped"
            completed_at = utc_now()
            error_code = "UNSUPPORTED_VIDEO_FORMAT"
            error_message = "Unsupported video file extension."
        items.append(BatchItem(
            item_id=item_id,
            video_path=str(path),
            run_id=f"run_{batch_id}_{item_id}",
            requested_video_id=video_id,
            video_id=video_id,
            status=status,
            max_attempts=1 + max_retries,
            completed_at=completed_at,
            last_error_code=error_code,
            last_error_message=error_message,
        ))

    job = BatchJob(
        batch_id=batch_id,
        max_concurrency=max_concurrency,
        max_retries=max_retries,
        input_source=input_source,
        items=items,
    )
    manager = BatchManager(output_root / "batches" / batch_id, job)
    manager.persist()
    return manager


class BatchManager:
    def __init__(self, batch_dir: Path, job: BatchJob) -> None:
        self.batch_dir = batch_dir.resolve()
        self.job = job
        self.manifest_path = self.batch_dir / "batch_manifest.json"
        self.summary_path = self.batch_dir / "batch_summary.json"
        self._lock = threading.Lock()

    @classmethod
    def load(cls, batch_dir: Path) -> "BatchManager":
        manifest_path = batch_dir.resolve() / "batch_manifest.json"
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        job = BatchJob.from_dict(payload)
        for item in job.items:
            if item.status == "running":
                # A process interruption is not a completed failed attempt. Return the
                # in-flight allowance, then resume the same run/checkpoint.
                item.attempt_count = max(0, item.attempt_count - 1)
                item.status = "retrying"
                item.last_error_code = "INTERRUPTED"
                item.last_error_message = "Previous batch process stopped while this item was running."
            elif item.status == "failed" and item.attempt_count < item.max_attempts:
                item.status = "retrying"
        manager = cls(batch_dir, job)
        manager.persist()
        return manager

    def persist(self) -> None:
        payload = self.job.to_dict()
        _atomic_write_json(self.manifest_path, payload)
        _atomic_write_json(self.summary_path, payload)

    def request_manual_retry(self, video_id: str) -> BatchItem:
        """Grant exactly one additional attempt to one failed Backend batch item."""
        normalized = str(video_id or "").strip()
        item = next(
            (
                candidate
                for candidate in self.job.items
                if normalized
                and normalized in {candidate.requested_video_id, candidate.video_id}
            ),
            None,
        )
        if item is None:
            raise BatchValidationError("Manual retry videoId is not part of this batch.")
        if item.status != "failed":
            raise BatchValidationError("Manual retry requires a failed batch item.")
        item.max_attempts = max(item.max_attempts, item.attempt_count + 1)
        item.status = "retrying"
        item.completed_at = None
        item.last_error_code = "MANUAL_RETRY_REQUESTED"
        item.last_error_message = "A manual retry was requested."
        self.job.status = "running"
        self.job.completed_at = None
        self.persist()
        return item

    def _transition(self, item: BatchItem, status: str) -> None:
        if status not in ITEM_STATUSES:
            raise BatchValidationError(f"Unknown item status: {status}")
        item.status = status
        self.persist()

    def _run_item(self, item: BatchItem, runner: PipelineRunner) -> None:
        while item.attempt_count < item.max_attempts:
            with self._lock:
                resume = item.attempt_count > 0 or item.status == "retrying"
                item.resume_used = item.resume_used or resume
                item.attempt_count += 1
                item.started_at = item.started_at or utc_now()
                self._transition(item, "running")
            try:
                result = runner.run(
                    Path(item.video_path),
                    item.run_id,
                    resume,
                    item.requested_video_id,
                )
            except BatchValidationError as exc:
                with self._lock:
                    item.last_error_code = type(exc).__name__
                    item.last_error_message = sanitize_error(exc)
                    item.completed_at = utc_now()
                    self._transition(item, "failed")
                return
            except Exception as exc:
                with self._lock:
                    item.last_error_code = type(exc).__name__
                    item.last_error_message = sanitize_error(exc)
                    if item.attempt_count < item.max_attempts:
                        self._transition(item, "retrying")
                    else:
                        item.completed_at = utc_now()
                        self._transition(item, "failed")
                        return
                continue
            with self._lock:
                item.video_id = result.video_id
                item.output_directory = result.output_directory
                item.last_error_code = None
                item.last_error_message = None
                item.completed_at = utc_now()
                self._transition(item, "completed")
            return

    def run(self, runner: PipelineRunner) -> BatchJob:
        runnable = [
            item for item in self.job.items
            if item.status in {"queued", "retrying"}
            and item.attempt_count < item.max_attempts
        ]
        with self._lock:
            self.job.status = "running"
            self.job.started_at = self.job.started_at or utc_now()
            self.job.completed_at = None
            self.persist()
        with ThreadPoolExecutor(max_workers=self.job.max_concurrency) as executor:
            futures = [executor.submit(self._run_item, item, runner) for item in runnable]
            for future in as_completed(futures):
                future.result()
        with self._lock:
            completed = sum(item.status == "completed" for item in self.job.items)
            unsuccessful = sum(item.status in {"failed", "skipped"} for item in self.job.items)
            if completed and not unsuccessful:
                self.job.status = "completed"
            elif completed:
                self.job.status = "partial"
            else:
                self.job.status = "failed"
            self.job.completed_at = utc_now()
            self.persist()
        return self.job


class SubprocessPipelineRunner:
    """Invoke the unchanged single-video CLI in isolated child processes."""

    def __init__(self, project_root: Path, python_executable: str | None = None) -> None:
        self.project_root = project_root.resolve()
        self.python_executable = python_executable or sys.executable

    def run(
        self,
        video_path: Path,
        run_id: str,
        resume: bool,
        video_id: str | None = None,
    ) -> PipelineRunResult:
        if resume:
            command = [
                self.python_executable,
                str(self.project_root / "src" / "main.py"),
                "--project-root",
                str(self.project_root),
                "--resume-run-id",
                run_id,
            ]
        else:
            command = [
                self.python_executable,
                str(self.project_root / "src" / "main.py"),
                "--project-root",
                str(self.project_root),
                "--video-path",
                str(video_path),
                "--run-id",
                run_id,
            ]
            if video_id:
                command.extend(["--video-id", video_id])
        completed = subprocess.run(command, cwd=self.project_root, check=False)
        if completed.returncode != 0:
            raise RuntimeError(f"Single-video pipeline exited with code {completed.returncode}.")
        output_directory = self.project_root / "data" / "outputs" / "runs" / run_id
        return PipelineRunResult(
            run_id=run_id,
            output_directory=str(output_directory),
            video_id=video_id,
        )
