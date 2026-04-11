"""Configuration layer for the FocusFlow AI pipeline."""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from pathlib import Path

from dotenv import load_dotenv

from utils import ensure_directory


def _get_bool_env(name: str, default: bool) -> bool:
    """Parse a boolean env value with a predictable fallback."""
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


def _get_int_env(name: str, default: int) -> int:
    """Parse an integer env value or return the default."""
    raw_value = os.getenv(name)
    if raw_value is None or not raw_value.strip():
        return default
    return int(raw_value)


def _get_optional_int_env(name: str) -> int | None:
    """Parse an optional integer env value."""
    raw_value = os.getenv(name)
    if raw_value is None or not raw_value.strip():
        return None
    return int(raw_value)


def _get_float_env(name: str, default: float) -> float:
    """Parse a float env value or return the default."""
    raw_value = os.getenv(name)
    if raw_value is None or not raw_value.strip():
        return default
    return float(raw_value)


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
    gemini_embedding_enabled: bool
    gemini_api_key: str
    gemini_embedding_model_name: str
    gemini_embedding_output_dim: int
    gemini_embedding_batch_size: int
    gemini_max_retries: int
    gemini_retry_sleep_sec: int
    gemini_max_chunks_per_run: int | None
    chunks_output_path: Path
    text_embeddings_output_path: Path
    audio_embeddings_output_path: Path
    gemini_video_embedding_enabled: bool
    video_multimodal_chunk_dir: Path
    video_embeddings_output_path: Path
    video_chunk_duration_sec: int
    video_max_files_per_run: int
    mongodb_uri: str
    mongodb_database_name: str
    mongodb_videos_collection: str
    mongodb_transcripts_collection: str
    mongodb_chunks_collection: str
    mongodb_text_embeddings_collection: str
    mongodb_video_embeddings_collection: str
    mongodb_bulk_batch_size: int
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
        chunks_output_path = resolved_root / os.getenv("CHUNKS_OUTPUT_PATH", "data/outputs/chunks.jsonl")
        text_embeddings_output_path = resolved_root / os.getenv(
            "TEXT_EMBEDDINGS_OUTPUT_PATH",
            "data/outputs/embeddings_text_gemini.jsonl",
        )
        audio_embeddings_output_path = resolved_root / os.getenv(
            "AUDIO_EMBEDDINGS_OUTPUT_PATH",
            "data/outputs/embeddings_audio_gemini.jsonl",
        )
        video_multimodal_chunk_dir = resolved_root / os.getenv(
            "VIDEO_MULTIMODAL_CHUNK_DIR",
            "data/video_multimodal_chunks",
        )
        video_embeddings_output_path = resolved_root / os.getenv(
            "VIDEO_EMBEDDINGS_OUTPUT_PATH",
            "data/outputs/embeddings_video_gemini.jsonl",
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
            whisper_beam_size=_get_int_env("WHISPER_BEAM_SIZE", 5),
            whisper_vad_filter=_get_bool_env("WHISPER_VAD_FILTER", True),
            chunk_max_chars=_get_int_env("CHUNK_MAX_CHARS", 220),
            chunk_max_segments=_get_int_env("CHUNK_MAX_SEGMENTS", 6),
            chunk_max_duration_sec=_get_float_env("CHUNK_MAX_DURATION_SEC", 45),
            fuzzy_threshold=_get_int_env("FUZZY_THRESHOLD", 85),
            embedding_model_name=os.getenv("EMBEDDING_MODEL_NAME", "BAAI/bge-m3"),
            embedding_device=os.getenv("EMBEDDING_DEVICE", "cpu"),
            embedding_batch_size=_get_int_env("EMBEDDING_BATCH_SIZE", 16),
            gemini_embedding_enabled=_get_bool_env("ENABLE_GEMINI_EMBEDDING", True),
            gemini_api_key=os.getenv("GEMINI_API_KEY", ""),
            gemini_embedding_model_name=os.getenv(
                "GEMINI_EMBEDDING_MODEL_NAME",
                "gemini-embedding-2-preview",
            ),
            gemini_embedding_output_dim=_get_int_env("GEMINI_EMBEDDING_OUTPUT_DIM", 3072),
            gemini_embedding_batch_size=_get_int_env("GEMINI_EMBEDDING_BATCH_SIZE", 8),
            gemini_max_retries=_get_int_env("GEMINI_MAX_RETRIES", 3),
            gemini_retry_sleep_sec=_get_int_env("GEMINI_RETRY_SLEEP_SEC", 20),
            gemini_max_chunks_per_run=_get_optional_int_env("GEMINI_MAX_CHUNKS_PER_RUN"),
            chunks_output_path=chunks_output_path,
            text_embeddings_output_path=text_embeddings_output_path,
            audio_embeddings_output_path=audio_embeddings_output_path,
            gemini_video_embedding_enabled=_get_bool_env("ENABLE_GEMINI_VIDEO_EMBEDDING", True),
            video_multimodal_chunk_dir=video_multimodal_chunk_dir,
            video_embeddings_output_path=video_embeddings_output_path,
            video_chunk_duration_sec=_get_int_env("VIDEO_CHUNK_DURATION_SEC", 120),
            video_max_files_per_run=_get_int_env("VIDEO_MAX_FILES_PER_RUN", 1),
            mongodb_uri=os.getenv("MONGODB_URI", ""),
            mongodb_database_name=os.getenv("MONGODB_DATABASE_NAME", "focusflow"),
            mongodb_videos_collection=os.getenv("MONGODB_VIDEOS_COLLECTION", "videos"),
            mongodb_transcripts_collection=os.getenv("MONGODB_TRANSCRIPTS_COLLECTION", "transcripts"),
            mongodb_chunks_collection=os.getenv("MONGODB_CHUNKS_COLLECTION", "chunks"),
            mongodb_text_embeddings_collection=os.getenv(
                "MONGODB_TEXT_EMBEDDINGS_COLLECTION",
                "embeddings_text_gemini",
            ),
            mongodb_video_embeddings_collection=os.getenv(
                "MONGODB_VIDEO_EMBEDDINGS_COLLECTION",
                "embeddings_video_gemini",
            ),
            mongodb_bulk_batch_size=_get_int_env("MONGODB_BULK_BATCH_SIZE", 200),
            overwrite_existing=_get_bool_env("OVERWRITE_EXISTING", False),
            backup_existing_outputs=_get_bool_env("BACKUP_EXISTING_OUTPUTS", True),
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
        ensure_directory(self.chunks_output_path.parent)
        ensure_directory(self.text_embeddings_output_path.parent)
        ensure_directory(self.audio_embeddings_output_path.parent)
        ensure_directory(self.video_multimodal_chunk_dir)
        ensure_directory(self.video_embeddings_output_path.parent)

    def with_overrides(self, **overrides: object) -> "PipelineConfig":
        """Create a modified config copy for CLI overrides."""
        # Dataclass replace keeps the override flow readable and explicit.
        updated_config = replace(self, **overrides)
        updated_config.ensure_runtime_directories()
        return updated_config
