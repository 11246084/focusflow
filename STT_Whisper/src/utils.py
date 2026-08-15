"""Shared helpers and data models for the FocusFlow AI pipeline."""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import tempfile
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence


@dataclass(slots=True)
class VideoMetadata:
    """Normalized metadata for a single local teaching video."""

    video_id: str
    file_name: str
    file_path: str
    audio_path: str
    duration_sec: float
    course_name: str | None
    week: str | None
    lesson: str | None
    video_source: str = "local"
    video_url: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert the dataclass to a JSON-safe dictionary."""
        return asdict(self)


@dataclass(slots=True)
class TranscriptSegment:
    """A single STT segment aligned to a start and end timestamp."""

    segment_id: str
    start_sec: float
    end_sec: float
    text: str
    original_text: str | None = None
    corrections: list["CorrectionRecord"] = field(default_factory=list)

    def to_dict(self, include_normalization: bool = False) -> dict[str, Any]:
        """Convert the dataclass to a JSON-safe dictionary."""
        payload: dict[str, Any] = {
            "segment_id": self.segment_id,
            "start_sec": self.start_sec,
            "end_sec": self.end_sec,
            "text": self.text,
        }
        if include_normalization:
            payload["original_text"] = self.original_text if self.original_text is not None else self.text
            payload["corrections"] = [correction.to_dict() for correction in self.corrections]
        return payload

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "TranscriptSegment":
        """Build a transcript segment from JSON content."""
        return cls(
            segment_id=payload["segment_id"],
            start_sec=float(payload["start_sec"]),
            end_sec=float(payload["end_sec"]),
            text=payload["text"],
            original_text=payload.get("original_text"),
            corrections=[CorrectionRecord.from_dict(item) for item in payload.get("corrections", [])],
        )


@dataclass(slots=True)
class CorrectionRecord:
    """A traceable normalization action applied to transcript text."""

    from_text: str
    to_text: str
    method: str

    def to_dict(self) -> dict[str, Any]:
        """Convert the correction record to the agreed JSON schema."""
        return {
            "from": self.from_text,
            "to": self.to_text,
            "method": self.method,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "CorrectionRecord":
        """Build a correction record from JSON content."""
        return cls(
            from_text=payload["from"],
            to_text=payload["to"],
            method=payload["method"],
        )


@dataclass(slots=True)
class TranscriptDocument:
    """All transcript segments that belong to a single video."""

    video_id: str
    segments: list[TranscriptSegment]

    def to_dict(self, include_normalization: bool = False) -> dict[str, Any]:
        """Convert the transcript document to a JSON-safe dictionary."""
        return {
            "video_id": self.video_id,
            "segments": [segment.to_dict(include_normalization=include_normalization) for segment in self.segments],
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "TranscriptDocument":
        """Build a transcript document from JSON content."""
        return cls(
            video_id=payload["video_id"],
            segments=[TranscriptSegment.from_dict(segment) for segment in payload["segments"]],
        )


@dataclass(slots=True)
class ChunkRecord:
    """A search-oriented chunk merged from nearby transcript segments."""

    chunk_id: str
    video_id: str
    start_sec: float
    end_sec: float
    text: str
    course_name: str | None
    week: str | None
    lesson: str | None

    def to_dict(self) -> dict[str, Any]:
        """Convert the dataclass to a JSON-safe dictionary."""
        return asdict(self)


@dataclass(slots=True)
class EmbeddingRecord:
    """A Gemini text embedding record for one chunk."""

    chunk_id: str
    video_id: str
    start_sec: float
    end_sec: float
    text: str
    embedding: list[float]
    embedding_model: str
    embedding_modality: str
    embedding_dim: int
    embedding_timestamp: str
    embedding_provider: str
    embedding_task_type: str | None
    embedding_instruction_version: str
    embedding_generation_version: str
    embedding_normalization_version: str
    embedding_contract_version: str
    embedding_schema_version: str
    embedding_status: str = "success"
    embedding_error: str | None = None
    embedding_request_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert the dataclass to a JSON-safe dictionary."""
        payload = asdict(self)
        if self.embedding_error is None:
            payload.pop("embedding_error")
        if self.embedding_request_id is None:
            payload.pop("embedding_request_id")
        return payload


@dataclass(slots=True)
class AudioEmbeddingRecord:
    """A Gemini audio embedding record for one extracted audio track."""

    video_id: str
    audio_path: str
    embedding: list[float]
    embedding_model: str
    embedding_modality: str
    embedding_dim: int
    embedding_timestamp: str
    embedding_status: str = "success"
    embedding_error: str | None = None
    embedding_request_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert the dataclass to a JSON-safe dictionary."""
        payload = asdict(self)
        if self.embedding_error is None:
            payload.pop("embedding_error")
        if self.embedding_request_id is None:
            payload.pop("embedding_request_id")
        return payload


def configure_logging(log_level: str = "INFO") -> None:
    """Configure process-wide logging once at application startup."""
    # Use one consistent log format for local runs and future orchestration.
    logging.basicConfig(
        level=getattr(logging, log_level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )


def ensure_directory(path: Path) -> Path:
    """Create a directory if it does not exist and return the path."""
    path.mkdir(parents=True, exist_ok=True)
    return path


def normalize_text(text: str) -> str:
    """Collapse repeated whitespace to keep exported text stable."""
    return re.sub(r"\s+", " ", text).strip()


def round_seconds(value: float, digits: int = 3) -> float:
    """Round timestamps for cleaner JSON output."""
    return round(float(value), digits)


def seconds_to_hhmmss(total_seconds: float) -> str:
    """Format a float second value into HH:MM:SS for logs and debugging."""
    total_seconds_int = int(total_seconds)
    hours = total_seconds_int // 3600
    minutes = (total_seconds_int % 3600) // 60
    seconds = total_seconds_int % 60
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def to_relative_posix(path: Path, project_root: Path) -> str:
    """Return a project-relative POSIX path for stable exported JSON."""
    try:
        relative_path = path.resolve().relative_to(project_root.resolve())
    except ValueError:
        relative_path = path.resolve()
    return relative_path.as_posix()


def resolve_ffmpeg_binary(explicit_binary: str | None = None) -> str:
    """Resolve an FFmpeg executable from env, PATH, or imageio-ffmpeg."""
    logger = logging.getLogger(__name__)

    # First honor an explicit binary path configured by the user.
    if explicit_binary:
        explicit_path = Path(explicit_binary)
        if explicit_path.exists():
            return str(explicit_path)
        found_explicit = shutil.which(explicit_binary)
        if found_explicit:
            return found_explicit

    # Then try the system PATH.
    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        return system_ffmpeg

    try:
        import imageio_ffmpeg

        # Finally fall back to the packaged binary from imageio-ffmpeg.
        bundled_ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        logger.debug("Using bundled FFmpeg binary from imageio-ffmpeg: %s", bundled_ffmpeg)
        return bundled_ffmpeg
    except Exception as exc:  # pragma: no cover - environment-specific branch
        raise RuntimeError(
            "FFmpeg was not found. Install FFmpeg and add it to PATH, "
            "or install the Python package 'imageio-ffmpeg'."
        ) from exc


def atomic_write_text(path: Path, content: str, backup_existing: bool = True) -> None:
    """Write a file atomically to avoid half-written JSON/JSONL outputs."""
    ensure_directory(path.parent)

    # Keep one backup copy before replacing the official export file.
    if backup_existing and path.exists():
        backup_path = path.with_suffix(path.suffix + ".bak")
        shutil.copy2(path, backup_path)

    # Write into a temporary file first, then atomically replace the target.
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=str(path.parent),
        delete=False,
        suffix=".tmp",
    ) as temp_file:
        temp_file.write(content)
        temp_path = Path(temp_file.name)

    os.replace(temp_path, path)


def write_json_file(path: Path, payload: Any, backup_existing: bool = True) -> None:
    """Serialize a Python object to a UTF-8 JSON file."""
    serialized = json.dumps(payload, ensure_ascii=False, indent=2)
    atomic_write_text(path, serialized + "\n", backup_existing=backup_existing)


def write_jsonl_file(path: Path, records: Iterable[dict[str, Any]], backup_existing: bool = True) -> None:
    """Serialize an iterable of dictionaries to JSONL format."""
    lines = [json.dumps(record, ensure_ascii=False) for record in records]
    serialized = "\n".join(lines)
    if serialized:
        serialized += "\n"
    atomic_write_text(path, serialized, backup_existing=backup_existing)


def load_json_file(path: Path) -> Any:
    """Load JSON from disk when cached data is available."""
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl_file(path: Path) -> list[dict[str, Any]]:
    """Load a JSONL file into memory while tolerating UTF-8 BOM."""
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8-sig").splitlines()
        if line.strip()
    ]


def extract_duration_seconds(ffmpeg_stderr: str) -> float:
    """Parse the Duration field from FFmpeg stderr output."""
    duration_match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", ffmpeg_stderr)
    if not duration_match:
        raise ValueError("Could not parse video duration from FFmpeg output.")

    hours = int(duration_match.group(1))
    minutes = int(duration_match.group(2))
    seconds = float(duration_match.group(3))
    return (hours * 3600) + (minutes * 60) + seconds


def chunked(sequence: Sequence[Any], batch_size: int) -> Iterable[Sequence[Any]]:
    """Yield small batches from a larger sequence."""
    for index in range(0, len(sequence), batch_size):
        yield sequence[index : index + batch_size]


def utc_timestamp() -> str:
    """Return a stable UTC ISO timestamp for exported metadata and logs."""
    return datetime.now(timezone.utc).isoformat()


def summarize_modalities(modalities: Sequence[str]) -> dict[str, int]:
    """Count how many records belong to each Gemini modality."""
    return dict(Counter(modalities))
