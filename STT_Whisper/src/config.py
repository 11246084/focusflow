"""Configuration layer for the FocusFlow AI pipeline."""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from pathlib import Path

from dotenv import load_dotenv

from utils import ensure_directory


@dataclass(slots=True)
class PipelineConfig:
    """Centralized runtime settings loaded from env and CLI overrides."""

    project_root: Path
    video_input_dir: Path
    data_dir: Path
    processed_audio_dir: Path
    output_dir: Path
    cache_dir: Path
    transcript_cache_dir: Path
    term_dictionary_path: Path
    normalized_transcript_output_path: Path
    supported_video_extensions: tuple[str, ...]
    ffmpeg_binary: str | None
    whisper_model_size: str
    whisper_device: str
    whisper_compute_type: str
    whisper_language: str | None
    whisper_beam_size: int
    whisper_vad_filter: bool
    chunk_max_chars: int
    chunk_max_segments: int
    chunk_max_duration_sec: float
    fuzzy_threshold: int
    embedding_model_name: str
    embedding_device: str
    embedding_batch_size: int
    overwrite_existing: bool
    backup_existing_outputs: bool
    log_level: str

    @classmethod
    def from_env(cls, project_root: Path | None = None) -> "PipelineConfig":
        """Build the config object from .env values plus sane defaults."""
        # Default to the repository root so `python src/main.py` works directly.
        resolved_root = (project_root or Path(__file__).resolve().parents[1]).resolve()
        env_file = resolved_root / ".env"

        if env_file.exists():
            load_dotenv(env_file)
        else:
            load_dotenv()

        data_dir = resolved_root / os.getenv("DATA_DIR", "data")
        processed_audio_dir = resolved_root / os.getenv("PROCESSED_AUDIO_DIR", "data/processed_audio")
        output_dir = resolved_root / os.getenv("OUTPUT_DIR", "data/outputs")
        cache_dir = resolved_root / os.getenv("CACHE_DIR", "data/cache")
        transcript_cache_dir = cache_dir / "transcripts"
        term_dictionary_path = resolved_root / os.getenv("TERM_DICTIONARY_PATH", "data/term_dictionary.json")
        normalized_transcript_output_path = resolved_root / os.getenv(
            "NORMALIZED_TRANSCRIPT_OUTPUT_PATH",
            "data/outputs/transcripts_normalized.json",
        )

        config = cls(
            project_root=resolved_root,
            video_input_dir=resolved_root / os.getenv("VIDEO_INPUT_DIR", "Test_video_file"),
            data_dir=data_dir,
            processed_audio_dir=processed_audio_dir,
            output_dir=output_dir,
            cache_dir=cache_dir,
            transcript_cache_dir=transcript_cache_dir,
            term_dictionary_path=term_dictionary_path,
            normalized_transcript_output_path=normalized_transcript_output_path,
            supported_video_extensions=(".mp4", ".mov", ".mkv"),
            ffmpeg_binary=os.getenv("FFMPEG_BINARY"),
            whisper_model_size=os.getenv("WHISPER_MODEL_SIZE", "small"),
            whisper_device=os.getenv("WHISPER_DEVICE", "cpu"),
            whisper_compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "int8"),
            whisper_language=os.getenv("WHISPER_LANGUAGE") or None,
            whisper_beam_size=int(os.getenv("WHISPER_BEAM_SIZE", "5")),
            whisper_vad_filter=os.getenv("WHISPER_VAD_FILTER", "true").lower() == "true",
            chunk_max_chars=int(os.getenv("CHUNK_MAX_CHARS", "220")),
            chunk_max_segments=int(os.getenv("CHUNK_MAX_SEGMENTS", "6")),
            chunk_max_duration_sec=float(os.getenv("CHUNK_MAX_DURATION_SEC", "45")),
            fuzzy_threshold=int(os.getenv("FUZZY_THRESHOLD", "85")),
            embedding_model_name=os.getenv("EMBEDDING_MODEL_NAME", "BAAI/bge-m3"),
            embedding_device=os.getenv("EMBEDDING_DEVICE", "cpu"),
            embedding_batch_size=int(os.getenv("EMBEDDING_BATCH_SIZE", "16")),
            overwrite_existing=os.getenv("OVERWRITE_EXISTING", "false").lower() == "true",
            backup_existing_outputs=os.getenv("BACKUP_EXISTING_OUTPUTS", "true").lower() == "true",
            log_level=os.getenv("LOG_LEVEL", "INFO"),
        )

        # Create runtime directories early to keep downstream modules simple.
        config.ensure_runtime_directories()
        return config

    def ensure_runtime_directories(self) -> None:
        """Create all directories that the pipeline needs before execution."""
        ensure_directory(self.video_input_dir)
        ensure_directory(self.data_dir)
        ensure_directory(self.processed_audio_dir)
        ensure_directory(self.output_dir)
        ensure_directory(self.cache_dir)
        ensure_directory(self.transcript_cache_dir)
        ensure_directory(self.term_dictionary_path.parent)
        ensure_directory(self.normalized_transcript_output_path.parent)

    def with_overrides(self, **overrides: object) -> "PipelineConfig":
        """Create a modified config copy for CLI overrides."""
        # Dataclass replace keeps the override flow readable and explicit.
        updated_config = replace(self, **overrides)
        updated_config.ensure_runtime_directories()
        return updated_config
