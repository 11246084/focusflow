"""Video discovery and metadata extraction."""

from __future__ import annotations

import logging
import re
import subprocess
from pathlib import Path

from config import PipelineConfig
from utils import VideoMetadata, extract_duration_seconds, resolve_ffmpeg_binary, round_seconds, to_relative_posix


logger = logging.getLogger(__name__)


def infer_optional_metadata(video_path: Path, video_input_dir: Path) -> tuple[str | None, str | None, str | None]:
    """Infer course fields from folder/file naming when possible."""
    # Use the first nested folder as a lightweight course hint when available.
    relative_parent = video_path.parent.relative_to(video_input_dir)
    course_name = relative_parent.parts[0] if relative_parent.parts else None

    # Keep the MVP heuristic intentionally simple and non-destructive.
    week_match = re.search(r"week[_\s-]?(\d+)", video_path.stem, re.IGNORECASE)
    lesson_match = re.search(r"lesson[_\s-]?(\d+)", video_path.stem, re.IGNORECASE)

    week = week_match.group(1) if week_match else None
    lesson = lesson_match.group(1) if lesson_match else None
    return course_name, week, lesson


def probe_video_duration(video_path: Path, ffmpeg_binary: str) -> float:
    """Read a video's duration using FFmpeg stderr output."""
    # `ffmpeg -i` prints probe details to stderr, which is enough for duration parsing.
    command = [ffmpeg_binary, "-i", str(video_path)]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    ffmpeg_output = (completed.stderr or "") + "\n" + (completed.stdout or "")
    duration_sec = extract_duration_seconds(ffmpeg_output)
    return round_seconds(duration_sec)


def discover_video_files(video_input_dir: Path, supported_extensions: tuple[str, ...]) -> list[Path]:
    """Find all supported video files recursively under the input directory."""
    discovered_files = [
        path
        for path in video_input_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in supported_extensions
    ]
    return sorted(discovered_files, key=lambda item: item.as_posix().lower())


def scan_videos(config: PipelineConfig) -> list[VideoMetadata]:
    """Scan the input folder and produce normalized metadata records."""
    # Resolve FFmpeg before scanning so environment errors fail fast.
    ffmpeg_binary = resolve_ffmpeg_binary(config.ffmpeg_binary)
    video_files = discover_video_files(config.video_input_dir, config.supported_video_extensions)

    if not video_files:
        logger.warning("No supported video files were found in %s", config.video_input_dir)
        return []

    videos: list[VideoMetadata] = []

    for index, video_path in enumerate(video_files, start=1):
        # Stable ordering creates stable IDs across repeat runs.
        video_id = f"video_{index:03d}"
        course_name, week, lesson = infer_optional_metadata(video_path, config.video_input_dir)
        duration_sec = probe_video_duration(video_path, ffmpeg_binary)
        audio_path = config.processed_audio_dir / f"{video_id}.wav"

        video_record = VideoMetadata(
            video_id=video_id,
            file_name=video_path.name,
            file_path=to_relative_posix(video_path, config.project_root),
            audio_path=to_relative_posix(audio_path, config.project_root),
            duration_sec=duration_sec,
            course_name=course_name,
            week=week,
            lesson=lesson,
        )
        videos.append(video_record)
        logger.info("Scanned %s (%s)", video_record.file_name, video_record.video_id)

    return videos
