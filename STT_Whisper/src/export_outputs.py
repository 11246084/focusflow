"""Writers for the standardized JSON and JSONL export files."""

from __future__ import annotations

import logging
from pathlib import Path

from config import PipelineConfig
from utils import (
    AudioEmbeddingRecord,
    ChunkRecord,
    EmbeddingRecord,
    TranscriptDocument,
    VideoMetadata,
    write_json_file,
    write_jsonl_file,
)


logger = logging.getLogger(__name__)


def export_videos(videos: list[VideoMetadata], output_dir: Path, backup_existing: bool = True) -> Path:
    """Export video metadata as a single JSON array."""
    output_path = output_dir / "videos.json"
    write_json_file(output_path, [video.to_dict() for video in videos], backup_existing=backup_existing)
    logger.info("Exported %s", output_path)
    return output_path


def export_transcripts(
    transcripts: list[TranscriptDocument],
    output_dir: Path,
    backup_existing: bool = True,
) -> Path:
    """Export transcript segments as a single JSON array."""
    output_path = output_dir / "transcripts.json"
    write_json_file(output_path, [transcript.to_dict() for transcript in transcripts], backup_existing=backup_existing)
    logger.info("Exported %s", output_path)
    return output_path


def export_normalized_transcripts(
    transcripts: list[TranscriptDocument],
    output_path: Path,
    backup_existing: bool = True,
) -> Path:
    """Export normalized transcript segments plus correction history."""
    write_json_file(
        output_path,
        [transcript.to_dict(include_normalization=True) for transcript in transcripts],
        backup_existing=backup_existing,
    )
    logger.info("Exported %s", output_path)
    return output_path


def export_chunks(chunks: list[ChunkRecord], output_path: Path, backup_existing: bool = True) -> Path:
    """Export all search chunks into one stable JSONL file."""
    write_jsonl_file(output_path, (chunk.to_dict() for chunk in chunks), backup_existing=backup_existing)
    logger.info("Exported %s", output_path)
    return output_path


def export_text_embeddings(
    embeddings: list[EmbeddingRecord],
    output_path: Path,
    backup_existing: bool = True,
) -> Path:
    """Export Gemini text embeddings into one JSONL file."""
    write_jsonl_file(output_path, (record.to_dict() for record in embeddings), backup_existing=backup_existing)
    logger.info("Exported %s", output_path)
    return output_path


def export_audio_embeddings(
    embeddings: list[AudioEmbeddingRecord],
    output_path: Path,
    backup_existing: bool = True,
) -> Path:
    """Export Gemini audio embeddings into one JSONL file."""
    write_jsonl_file(output_path, (record.to_dict() for record in embeddings), backup_existing=backup_existing)
    logger.info("Exported %s", output_path)
    return output_path


def export_all_outputs(
    videos: list[VideoMetadata],
    transcripts: list[TranscriptDocument],
    normalized_transcripts: list[TranscriptDocument],
    chunks: list[ChunkRecord],
    text_embeddings: list[EmbeddingRecord],
    audio_embeddings: list[AudioEmbeddingRecord],
    config: PipelineConfig,
) -> dict[str, Path]:
    """Export every standardized artifact required by the downstream team."""
    return {
        "videos": export_videos(videos, config.output_dir, config.backup_existing_outputs),
        "transcripts": export_transcripts(transcripts, config.output_dir, config.backup_existing_outputs),
        "transcripts_normalized": export_normalized_transcripts(
            normalized_transcripts,
            config.normalized_transcript_output_path,
            config.backup_existing_outputs,
        ),
        "chunks": export_chunks(chunks, config.chunks_output_path, config.backup_existing_outputs),
        "embeddings_text_gemini": export_text_embeddings(
            text_embeddings,
            config.text_embeddings_output_path,
            config.backup_existing_outputs,
        ),
        "embeddings_audio_gemini": export_audio_embeddings(
            audio_embeddings,
            config.audio_embeddings_output_path,
            config.backup_existing_outputs,
        ),
    }
