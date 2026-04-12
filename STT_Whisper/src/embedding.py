"""Gemini embedding generation for text chunks and extracted audio tracks."""

from __future__ import annotations

import logging
import math
import mimetypes
import re
import time
from pathlib import Path
from typing import Any

from config import PipelineConfig
from utils import (
    AudioEmbeddingRecord,
    ChunkRecord,
    EmbeddingRecord,
    VideoMetadata,
    chunked,
    load_jsonl_file,
    utc_timestamp,
)


logger = logging.getLogger(__name__)

TEXT_MODALITY = "text"
AUDIO_MODALITY = "audio"
EMBEDDING_STATUS_SUCCESS = "success"
EMBEDDING_STATUS_REUSED_CHECKPOINT = "reused_checkpoint"
EMBEDDING_STATUS_FAILED_AFTER_RETRIES = "failed_after_retries"
EMBEDDING_STATUS_FAILED = "failed"
EMBEDDING_STATUS_SKIPPED_BY_LIMIT = "skipped_by_limit"


def _normalize_vector(values: list[float]) -> list[float]:
    """Normalize a vector to unit length for cosine-style comparisons."""
    norm = math.sqrt(sum(value * value for value in values))
    if norm == 0:
        return values
    return [value / norm for value in values]


def _load_gemini_client(config: PipelineConfig):
    """Load the Gemini client lazily and validate authentication."""
    if not config.gemini_embedding_enabled:
        raise RuntimeError("Gemini embedding is disabled. Set ENABLE_GEMINI_EMBEDDING=true.")
    if not config.gemini_api_key:
        raise RuntimeError("Gemini embedding is enabled but GEMINI_API_KEY is not set.")

    try:
        from google import genai
    except ImportError as exc:  # pragma: no cover - depends on local environment
        raise RuntimeError(
            "google-genai is not installed. Run 'pip install -r requirements.txt' first."
        ) from exc

    logger.info(
        "Loading Gemini embedding client for model '%s' with output_dim=%s",
        config.gemini_embedding_model_name,
        config.gemini_embedding_output_dim,
    )
    return genai.Client(api_key=config.gemini_api_key)


def _is_resource_exhausted_error(exc: Exception) -> bool:
    """Check whether an exception looks like a Gemini quota exhaustion error."""
    message = str(exc).upper()
    return "RESOURCE_EXHAUSTED" in message or "429" in message


def _extract_retry_delay_seconds(exc: Exception, default_delay: int) -> int:
    """Extract retry delay seconds from a Gemini error message when available."""
    message = str(exc)
    patterns = (
        r"retry[_\s]?delay[^0-9]*(\d+)\s*s",
        r"retry[_\s]?delay[^0-9]*seconds[^0-9]*(\d+)",
        r"seconds:\s*(\d+)",
        r"retry in\s*(\d+)\s*s",
    )
    for pattern in patterns:
        match = re.search(pattern, message, flags=re.IGNORECASE | re.DOTALL)
        if match:
            return max(int(match.group(1)), 1)
    return default_delay


def _log_embedding_event(
    *,
    record_id: str,
    model_name: str,
    modality: str,
    embedding_dim: int,
    status: str,
    timestamp: str,
) -> None:
    """Emit one structured log line per Gemini embedding attempt."""
    logger.info(
        "[Gemini] record_id=%s model=%s modality=%s dim=%s status=%s timestamp=%s",
        record_id,
        model_name,
        modality,
        embedding_dim,
        status,
        timestamp,
    )


def _build_text_record(
    chunk: ChunkRecord,
    config: PipelineConfig,
    *,
    embedding: list[float] | None = None,
    status: str,
    embedding_error: str | None = None,
    embedding_request_id: str | None = None,
    embedding_timestamp: str | None = None,
) -> EmbeddingRecord:
    """Create one Gemini text embedding record for a chunk."""
    vector = embedding or []
    return EmbeddingRecord(
        chunk_id=chunk.chunk_id,
        video_id=chunk.video_id,
        start_sec=chunk.start_sec,
        end_sec=chunk.end_sec,
        text=chunk.text,
        embedding=vector,
        embedding_model=config.gemini_embedding_model_name,
        embedding_modality=TEXT_MODALITY,
        embedding_dim=len(vector) if vector else config.gemini_embedding_output_dim,
        embedding_timestamp=embedding_timestamp or utc_timestamp(),
        embedding_status=status,
        embedding_error=embedding_error,
        embedding_request_id=embedding_request_id,
    )


def _build_audio_record(
    video: VideoMetadata,
    config: PipelineConfig,
    *,
    embedding: list[float] | None = None,
    status: str,
    embedding_error: str | None = None,
    embedding_request_id: str | None = None,
    embedding_timestamp: str | None = None,
) -> AudioEmbeddingRecord:
    """Create one Gemini audio embedding record for an extracted track."""
    vector = embedding or []
    return AudioEmbeddingRecord(
        video_id=video.video_id,
        audio_path=video.audio_path,
        embedding=vector,
        embedding_model=config.gemini_embedding_model_name,
        embedding_modality=AUDIO_MODALITY,
        embedding_dim=len(vector) if vector else config.gemini_embedding_output_dim,
        embedding_timestamp=embedding_timestamp or utc_timestamp(),
        embedding_status=status,
        embedding_error=embedding_error,
        embedding_request_id=embedding_request_id,
    )


def _load_text_checkpoint(config: PipelineConfig) -> dict[str, EmbeddingRecord]:
    """Load successful Gemini text embeddings from the last output file."""
    checkpoint_path = config.text_embeddings_output_path
    if not checkpoint_path.exists():
        return {}

    completed_records: dict[str, EmbeddingRecord] = {}
    for record in load_jsonl_file(checkpoint_path):
        vector = record.get("embedding", [])
        if not record.get("chunk_id"):
            continue
        if record.get("embedding_model") != config.gemini_embedding_model_name:
            continue
        if record.get("embedding_modality") != TEXT_MODALITY:
            continue
        if int(record.get("embedding_dim", 0) or 0) != config.gemini_embedding_output_dim:
            continue
        if not isinstance(vector, list) or not vector:
            continue

        completed_records[str(record["chunk_id"])] = EmbeddingRecord(
            chunk_id=str(record["chunk_id"]),
            video_id=str(record["video_id"]),
            start_sec=float(record["start_sec"]),
            end_sec=float(record["end_sec"]),
            text=str(record["text"]),
            embedding=[float(value) for value in vector],
            embedding_model=str(record["embedding_model"]),
            embedding_modality=str(record["embedding_modality"]),
            embedding_dim=int(record["embedding_dim"]),
            embedding_timestamp=str(record.get("embedding_timestamp", utc_timestamp())),
            embedding_status=EMBEDDING_STATUS_REUSED_CHECKPOINT,
            embedding_error=None,
            embedding_request_id=(
                str(record["embedding_request_id"])
                if record.get("embedding_request_id") is not None
                else None
            ),
        )

    if completed_records:
        logger.info(
            "Loaded %s completed text embeddings from checkpoint %s",
            len(completed_records),
            checkpoint_path,
        )
    return completed_records


def _load_audio_checkpoint(config: PipelineConfig) -> dict[str, AudioEmbeddingRecord]:
    """Load successful Gemini audio embeddings from the last output file."""
    checkpoint_path = config.audio_embeddings_output_path
    if not checkpoint_path.exists():
        return {}

    completed_records: dict[str, AudioEmbeddingRecord] = {}
    for record in load_jsonl_file(checkpoint_path):
        vector = record.get("embedding", [])
        if not record.get("video_id"):
            continue
        if record.get("embedding_model") != config.gemini_embedding_model_name:
            continue
        if record.get("embedding_modality") != AUDIO_MODALITY:
            continue
        if int(record.get("embedding_dim", 0) or 0) != config.gemini_embedding_output_dim:
            continue
        if not isinstance(vector, list) or not vector:
            continue

        completed_records[str(record["video_id"])] = AudioEmbeddingRecord(
            video_id=str(record["video_id"]),
            audio_path=str(record["audio_path"]),
            embedding=[float(value) for value in vector],
            embedding_model=str(record["embedding_model"]),
            embedding_modality=str(record["embedding_modality"]),
            embedding_dim=int(record["embedding_dim"]),
            embedding_timestamp=str(record.get("embedding_timestamp", utc_timestamp())),
            embedding_status=EMBEDDING_STATUS_REUSED_CHECKPOINT,
            embedding_error=None,
            embedding_request_id=(
                str(record["embedding_request_id"])
                if record.get("embedding_request_id") is not None
                else None
            ),
        )

    if completed_records:
        logger.info(
            "Loaded %s completed audio embeddings from checkpoint %s",
            len(completed_records),
            checkpoint_path,
        )
    return completed_records


def embed_chunks(chunks: list[ChunkRecord], config: PipelineConfig) -> list[EmbeddingRecord]:
    """Embed text chunks with Gemini Embedding 2 and resume previous successes."""
    if not chunks:
        return []

    from google.genai import types

    checkpoint_records = _load_text_checkpoint(config)
    text_embeddings_by_chunk: dict[str, EmbeddingRecord] = {}
    pending_chunks: list[ChunkRecord] = []

    for chunk in chunks:
        checkpoint_record = checkpoint_records.get(chunk.chunk_id)
        if checkpoint_record is not None and checkpoint_record.text == chunk.text:
            text_embeddings_by_chunk[chunk.chunk_id] = checkpoint_record
            logger.info(
                "[Gemini Resume] record_id=%s modality=%s status=%s",
                chunk.chunk_id,
                TEXT_MODALITY,
                EMBEDDING_STATUS_REUSED_CHECKPOINT,
            )
            continue
        pending_chunks.append(chunk)

    if config.gemini_max_chunks_per_run is not None and config.gemini_max_chunks_per_run >= 0:
        runnable_chunks = pending_chunks[: config.gemini_max_chunks_per_run]
        skipped_chunks = pending_chunks[config.gemini_max_chunks_per_run :]
    else:
        runnable_chunks = pending_chunks
        skipped_chunks = []

    client = _load_gemini_client(config) if runnable_chunks else None

    for chunk in skipped_chunks:
        record = _build_text_record(
            chunk,
            config,
            status=EMBEDDING_STATUS_SKIPPED_BY_LIMIT,
            embedding_error=(
                f"Skipped in this run because GEMINI_MAX_CHUNKS_PER_RUN={config.gemini_max_chunks_per_run}"
            ),
        )
        text_embeddings_by_chunk[chunk.chunk_id] = record
        logger.info("[Gemini Skip] record_id=%s modality=%s status=%s", chunk.chunk_id, TEXT_MODALITY, record.embedding_status)

    for batch_index, chunk_batch in enumerate(chunked(runnable_chunks, config.gemini_embedding_batch_size), start=1):
        attempt_number = 0
        text_batch = [chunk.text for chunk in chunk_batch]

        while True:
            batch_timestamp = utc_timestamp()
            try:
                response = client.models.embed_content(
                    model=config.gemini_embedding_model_name,
                    contents=text_batch,
                    config=types.EmbedContentConfig(
                        task_type="RETRIEVAL_DOCUMENT",
                        output_dimensionality=config.gemini_embedding_output_dim,
                    ),
                )
                request_id = getattr(response, "request_id", None)

                for chunk, embedding in zip(chunk_batch, response.embeddings, strict=True):
                    record = _build_text_record(
                        chunk,
                        config,
                        embedding=_normalize_vector([float(value) for value in embedding.values]),
                        status=EMBEDDING_STATUS_SUCCESS,
                        embedding_request_id=request_id,
                        embedding_timestamp=batch_timestamp,
                    )
                    text_embeddings_by_chunk[chunk.chunk_id] = record
                    _log_embedding_event(
                        record_id=chunk.chunk_id,
                        model_name=record.embedding_model,
                        modality=record.embedding_modality,
                        embedding_dim=record.embedding_dim,
                        status=record.embedding_status,
                        timestamp=record.embedding_timestamp,
                    )
                break
            except Exception as exc:
                is_quota_error = _is_resource_exhausted_error(exc)
                if is_quota_error and attempt_number < config.gemini_max_retries:
                    attempt_number += 1
                    base_sleep_seconds = _extract_retry_delay_seconds(exc, config.gemini_retry_sleep_sec)
                    sleep_seconds = base_sleep_seconds * (2 ** (attempt_number - 1))
                    logger.warning(
                        "[Gemini Retry] batch=%s attempt=%s sleep=%ss reason=429 modality=%s",
                        batch_index,
                        attempt_number,
                        sleep_seconds,
                        TEXT_MODALITY,
                    )
                    time.sleep(sleep_seconds)
                    continue

                failure_status = (
                    EMBEDDING_STATUS_FAILED_AFTER_RETRIES if is_quota_error else EMBEDDING_STATUS_FAILED
                )
                error_message = str(exc)
                for chunk in chunk_batch:
                    record = _build_text_record(
                        chunk,
                        config,
                        status=failure_status,
                        embedding_error=error_message,
                        embedding_timestamp=batch_timestamp,
                    )
                    text_embeddings_by_chunk[chunk.chunk_id] = record
                    logger.warning(
                        "[Gemini Skip] record_id=%s modality=%s status=%s",
                        chunk.chunk_id,
                        TEXT_MODALITY,
                        failure_status,
                    )
                    _log_embedding_event(
                        record_id=chunk.chunk_id,
                        model_name=record.embedding_model,
                        modality=record.embedding_modality,
                        embedding_dim=record.embedding_dim,
                        status=record.embedding_status,
                        timestamp=record.embedding_timestamp,
                    )
                break

    ordered_records = [text_embeddings_by_chunk[chunk.chunk_id] for chunk in chunks]
    status_counts: dict[str, int] = {}
    for record in ordered_records:
        status_counts[record.embedding_status] = status_counts.get(record.embedding_status, 0) + 1
    logger.info("Gemini text embedding summary: %s", status_counts)
    logger.info("This output uses Gemini, but is TEXT-ONLY. It is NOT multimodal embedding.")
    return ordered_records


def _guess_audio_mime_type(audio_path: Path) -> str:
    """Guess an audio MIME type from the local file name."""
    mime_type, _ = mimetypes.guess_type(audio_path.name)
    return mime_type or "audio/wav"


def embed_audio_tracks(videos: list[VideoMetadata], config: PipelineConfig) -> list[AudioEmbeddingRecord]:
    """Embed extracted audio tracks directly with Gemini and keep partial progress."""
    if not videos:
        return []

    from google.genai import types

    checkpoint_records = _load_audio_checkpoint(config)
    audio_embeddings_by_video: dict[str, AudioEmbeddingRecord] = {}
    pending_videos: list[VideoMetadata] = []

    for video in videos:
        checkpoint_record = checkpoint_records.get(video.video_id)
        if checkpoint_record is not None and checkpoint_record.audio_path == video.audio_path:
            audio_embeddings_by_video[video.video_id] = checkpoint_record
            logger.info(
                "[Gemini Resume] record_id=%s modality=%s status=%s",
                video.video_id,
                AUDIO_MODALITY,
                EMBEDDING_STATUS_REUSED_CHECKPOINT,
            )
            continue
        pending_videos.append(video)

    if not pending_videos:
        return [audio_embeddings_by_video[video.video_id] for video in videos]

    client = _load_gemini_client(config)

    for batch_index, video_batch in enumerate(chunked(pending_videos, max(config.gemini_embedding_batch_size, 1)), start=1):
        for video_offset, video in enumerate(video_batch, start=1):
            audio_path = (config.project_root / video.audio_path).resolve()
            attempt_number = 0

            while True:
                batch_timestamp = utc_timestamp()
                try:
                    uploaded_file = client.files.upload(file=str(audio_path))
                    response = client.models.embed_content(
                        model=config.gemini_embedding_model_name,
                        contents=[
                            types.Content(
                                parts=[
                                    types.Part.from_uri(
                                        file_uri=uploaded_file.uri,
                                        mime_type=uploaded_file.mime_type or _guess_audio_mime_type(audio_path),
                                    )
                                ]
                            )
                        ],
                        config=types.EmbedContentConfig(
                            output_dimensionality=config.gemini_embedding_output_dim,
                        ),
                    )

                    embedding_object = response.embeddings[0]
                    record = _build_audio_record(
                        video,
                        config,
                        embedding=_normalize_vector([float(value) for value in embedding_object.values]),
                        status=EMBEDDING_STATUS_SUCCESS,
                        embedding_request_id=getattr(response, "request_id", None),
                        embedding_timestamp=batch_timestamp,
                    )
                    audio_embeddings_by_video[video.video_id] = record
                    _log_embedding_event(
                        record_id=video.video_id,
                        model_name=record.embedding_model,
                        modality=record.embedding_modality,
                        embedding_dim=record.embedding_dim,
                        status=record.embedding_status,
                        timestamp=record.embedding_timestamp,
                    )
                    break
                except Exception as exc:
                    is_quota_error = _is_resource_exhausted_error(exc)
                    if is_quota_error and attempt_number < config.gemini_max_retries:
                        attempt_number += 1
                        base_sleep_seconds = _extract_retry_delay_seconds(exc, config.gemini_retry_sleep_sec)
                        sleep_seconds = base_sleep_seconds * (2 ** (attempt_number - 1))
                        logger.warning(
                            "[Gemini Retry] batch=%s attempt=%s sleep=%ss reason=429 modality=%s item=%s/%s",
                            batch_index,
                            attempt_number,
                            sleep_seconds,
                            AUDIO_MODALITY,
                            video_offset,
                            len(video_batch),
                        )
                        time.sleep(sleep_seconds)
                        continue

                    failure_status = (
                        EMBEDDING_STATUS_FAILED_AFTER_RETRIES if is_quota_error else EMBEDDING_STATUS_FAILED
                    )
                    error_message = str(exc)
                    record = _build_audio_record(
                        video,
                        config,
                        status=failure_status,
                        embedding_error=error_message,
                        embedding_timestamp=batch_timestamp,
                    )
                    audio_embeddings_by_video[video.video_id] = record
                    logger.warning(
                        "[Gemini Skip] record_id=%s modality=%s status=%s",
                        video.video_id,
                        AUDIO_MODALITY,
                        failure_status,
                    )
                    _log_embedding_event(
                        record_id=video.video_id,
                        model_name=record.embedding_model,
                        modality=record.embedding_modality,
                        embedding_dim=record.embedding_dim,
                        status=record.embedding_status,
                        timestamp=record.embedding_timestamp,
                    )
                    break

    ordered_records = [audio_embeddings_by_video[video.video_id] for video in videos]
    status_counts: dict[str, int] = {}
    for record in ordered_records:
        status_counts[record.embedding_status] = status_counts.get(record.embedding_status, 0) + 1
    logger.info("Gemini audio embedding summary: %s", status_counts)
    return ordered_records


def embed_query_gemini(query_text: str, config: PipelineConfig) -> list[float]:
    """Embed a query string with Gemini using retrieval-query task type."""
    from google.genai import types

    client = _load_gemini_client(config)
    response = client.models.embed_content(
        model=config.gemini_embedding_model_name,
        contents=[query_text],
        config=types.EmbedContentConfig(
            task_type="RETRIEVAL_QUERY",
            output_dimensionality=config.gemini_embedding_output_dim,
        ),
    )
    return _normalize_vector([float(value) for value in response.embeddings[0].values])


def embed_single_text_gemini(
    text: str,
    config: PipelineConfig,
    record_id: str = "debug_chunk",
) -> tuple[list[float], EmbeddingRecord]:
    """Embed one text payload with Gemini for debugging and validation."""
    chunk = ChunkRecord(
        chunk_id=record_id,
        video_id="debug_video",
        start_sec=0.0,
        end_sec=0.0,
        text=text,
        course_name=None,
        week=None,
        lesson=None,
    )
    [record] = embed_chunks([chunk], config)
    return list(record.embedding), record
