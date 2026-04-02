"""Audio extraction for Whisper-compatible WAV files."""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from config import PipelineConfig
from utils import VideoMetadata, ensure_directory, resolve_ffmpeg_binary


logger = logging.getLogger(__name__)


def extract_audio_for_video(video: VideoMetadata, config: PipelineConfig) -> Path:
    """Extract mono 16kHz WAV audio from a local video file."""
    # Convert exported relative paths back to absolute paths for local execution.
    ffmpeg_binary = resolve_ffmpeg_binary(config.ffmpeg_binary)
    source_video_path = config.project_root / video.file_path
    target_audio_path = config.project_root / video.audio_path

    ensure_directory(target_audio_path.parent)

    # Reuse existing WAV files unless the user explicitly asks for a rebuild.
    if target_audio_path.exists() and not config.overwrite_existing:
        logger.info("Reusing existing audio for %s at %s", video.video_id, target_audio_path)
        return target_audio_path

    # Keep the output format fixed for Whisper compatibility.
    command = [
        ffmpeg_binary,
        "-y",
        "-i",
        str(source_video_path),
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ac",
        "1",
        "-ar",
        "16000",
        str(target_audio_path),
    ]

    completed = subprocess.run(command, capture_output=True, text=True, check=False)

    if completed.returncode != 0:
        raise RuntimeError(
            f"Audio extraction failed for {video.video_id}. "
            f"FFmpeg stderr: {completed.stderr.strip()}"
        )

    logger.info("Extracted audio for %s -> %s", video.video_id, target_audio_path)
    return target_audio_path


def extract_audio_for_videos(videos: list[VideoMetadata], config: PipelineConfig) -> None:
    """Extract audio files for all discovered videos."""
    # Sequential execution keeps the MVP simple and easier to debug.
    for video in videos:
        extract_audio_for_video(video, config)
