"""Blocking, opt-in Parent Chunk embedding and artifact validation."""

from __future__ import annotations

import math
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Any

from config import PipelineConfig
from embedding import (
    EMBEDDING_STATUS_FAILED,
    EMBEDDING_STATUS_FAILED_AFTER_RETRIES,
    EMBEDDING_STATUS_REUSED_CHECKPOINT,
    EMBEDDING_STATUS_SUCCESS,
    _extract_retry_delay_seconds,
    _is_resource_exhausted_error,
    _load_gemini_client,
    embed_text_contents,
)
from hierarchy_chunking import ParentChunkRecord
from parent_embedding_strategy import (
    PARENT_EMBEDDING_NORMALIZATION_VERSION,
    PARENT_EMBEDDING_PREPROCESSING_VERSION,
    PARENT_EMBEDDING_PROVIDER,
    PARENT_EMBEDDING_SCHEMA_VERSION,
    PARENT_EMBEDDING_TASK_TYPE,
)
from utils import chunked, load_jsonl_file, utc_timestamp, write_jsonl_file


ParentProvider = Callable[[list[str], PipelineConfig], tuple[list[list[float]], str | None]]
PUBLISHABLE_STATUSES = {EMBEDDING_STATUS_SUCCESS, EMBEDDING_STATUS_REUSED_CHECKPOINT}


class ParentEmbeddingStageError(RuntimeError):
    """Raised when the blocking stage cannot cover every required Parent."""

    def __init__(self, message: str, records: list["ParentEmbeddingRecord"]) -> None:
        super().__init__(message)
        self.records = records


@dataclass(slots=True)
class ParentEmbeddingRecord:
    parent_id: str
    video_id: str
    hierarchy_level: int
    document_type: str
    start_sec: float
    end_sec: float
    text: str
    child_chunk_ids: list[str]
    child_count: int
    order: int
    embedding: list[float]
    embedding_provider: str
    embedding_model: str
    embedding_dimension: int
    embedding_task_type: str
    embedding_status: str
    embedding_timestamp: str
    embedding_schema_version: str
    preprocessing_version: str
    normalization_version: str
    hierarchy_fingerprint: str
    source_leaf_fingerprint: str
    parent_embedding_fingerprint: str
    embedding_error: str | None = None
    embedding_request_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        if self.embedding_request_id is None:
            payload.pop("embedding_request_id")
        return payload


def _safe_provider_error(_: Exception) -> str:
    return "Parent embedding provider request failed."


def _default_provider(texts: list[str], config: PipelineConfig) -> tuple[list[list[float]], str | None]:
    client = _load_gemini_client(config)
    return embed_text_contents(client, texts, config)


def _build_record(
    parent: ParentChunkRecord,
    config: PipelineConfig,
    hierarchy_fingerprint: str,
    source_leaf_fingerprint: str,
    parent_embedding_fingerprint: str,
    *,
    vector: list[float] | None,
    status: str,
    error: str | None = None,
    request_id: str | None = None,
    timestamp: str | None = None,
) -> ParentEmbeddingRecord:
    return ParentEmbeddingRecord(
        parent_id=parent.parent_id,
        video_id=parent.video_id,
        hierarchy_level=parent.hierarchy_level,
        document_type=parent.document_type,
        start_sec=parent.start_sec,
        end_sec=parent.end_sec,
        text=parent.text,
        child_chunk_ids=list(parent.child_chunk_ids),
        child_count=parent.child_count,
        order=parent.order,
        embedding=list(vector or []),
        embedding_provider=PARENT_EMBEDDING_PROVIDER,
        embedding_model=config.gemini_embedding_model_name,
        embedding_dimension=(len(vector) if vector else config.gemini_embedding_output_dim),
        embedding_task_type=PARENT_EMBEDDING_TASK_TYPE,
        embedding_status=status,
        embedding_timestamp=timestamp or utc_timestamp(),
        embedding_schema_version=PARENT_EMBEDDING_SCHEMA_VERSION,
        preprocessing_version=PARENT_EMBEDDING_PREPROCESSING_VERSION,
        normalization_version=PARENT_EMBEDDING_NORMALIZATION_VERSION,
        hierarchy_fingerprint=hierarchy_fingerprint,
        source_leaf_fingerprint=source_leaf_fingerprint,
        parent_embedding_fingerprint=parent_embedding_fingerprint,
        embedding_error=error,
        embedding_request_id=request_id,
    )


def _load_checkpoint(
    path: Path,
    parents: list[ParentChunkRecord],
    config: PipelineConfig,
    hierarchy_fingerprint: str,
    source_leaf_fingerprint: str,
    parent_embedding_fingerprint: str,
) -> dict[str, ParentEmbeddingRecord]:
    if not path.exists():
        return {}
    try:
        records = validate_parent_embedding_artifact(
            path,
            parents,
            config.gemini_embedding_output_dim,
            config.gemini_embedding_model_name,
            hierarchy_fingerprint,
            source_leaf_fingerprint,
            parent_embedding_fingerprint,
        )
    except (OSError, ValueError, TypeError):
        return {}
    return {
        record.parent_id: _build_record(
            next(parent for parent in parents if parent.parent_id == record.parent_id),
            config,
            hierarchy_fingerprint,
            source_leaf_fingerprint,
            parent_embedding_fingerprint,
            vector=record.embedding,
            status=EMBEDDING_STATUS_REUSED_CHECKPOINT,
            request_id=record.embedding_request_id,
            timestamp=record.embedding_timestamp,
        )
        for record in records
    }


def embed_parent_chunks(
    parents: list[ParentChunkRecord],
    config: PipelineConfig,
    hierarchy_fingerprint: str,
    source_leaf_fingerprint: str,
    parent_embedding_fingerprint: str,
    *,
    provider: ParentProvider | None = None,
) -> list[ParentEmbeddingRecord]:
    """Embed all Parents, preserving deterministic order and resumable successes."""
    provider_fn = provider or _default_provider
    completed = _load_checkpoint(
        config.parent_embeddings_output_path,
        parents,
        config,
        hierarchy_fingerprint,
        source_leaf_fingerprint,
        parent_embedding_fingerprint,
    )
    pending = [parent for parent in parents if parent.parent_id not in completed]
    batch_size = max(config.gemini_embedding_batch_size, 1)
    for parent_batch in chunked(pending, batch_size):
        attempt = 0
        while True:
            timestamp = utc_timestamp()
            try:
                vectors, request_id = provider_fn([parent.text for parent in parent_batch], config)
                if len(vectors) != len(parent_batch):
                    raise RuntimeError("Parent embedding response count mismatch.")
                for parent, vector in zip(parent_batch, vectors):
                    completed[parent.parent_id] = _build_record(
                        parent,
                        config,
                        hierarchy_fingerprint,
                        source_leaf_fingerprint,
                        parent_embedding_fingerprint,
                        vector=vector,
                        status=EMBEDDING_STATUS_SUCCESS,
                        request_id=request_id,
                        timestamp=timestamp,
                    )
                break
            except Exception as exc:
                quota_error = _is_resource_exhausted_error(exc)
                if quota_error and attempt < config.gemini_max_retries:
                    attempt += 1
                    delay = _extract_retry_delay_seconds(exc, config.gemini_retry_sleep_sec)
                    time.sleep(delay * (2 ** (attempt - 1)))
                    continue
                status = EMBEDDING_STATUS_FAILED_AFTER_RETRIES if quota_error else EMBEDDING_STATUS_FAILED
                for parent in parent_batch:
                    completed[parent.parent_id] = _build_record(
                        parent,
                        config,
                        hierarchy_fingerprint,
                        source_leaf_fingerprint,
                        parent_embedding_fingerprint,
                        vector=None,
                        status=status,
                        error=_safe_provider_error(exc),
                        timestamp=timestamp,
                    )
                break
    records = [completed[parent.parent_id] for parent in parents]
    write_jsonl_file(
        config.parent_embeddings_output_path,
        (record.to_dict() for record in records),
        backup_existing=config.backup_existing_outputs,
    )
    failed = [record for record in records if record.embedding_status not in PUBLISHABLE_STATUSES]
    if failed:
        raise ParentEmbeddingStageError(
            f"Parent embedding incomplete: failed_count={len(failed)} required_count={len(records)}",
            records,
        )
    validate_parent_embedding_artifact(
        config.parent_embeddings_output_path,
        parents,
        config.gemini_embedding_output_dim,
        config.gemini_embedding_model_name,
        hierarchy_fingerprint,
        source_leaf_fingerprint,
        parent_embedding_fingerprint,
    )
    return records


def validate_parent_embedding_artifact(
    path: Path,
    parents: list[ParentChunkRecord],
    expected_dimension: int,
    expected_model: str,
    hierarchy_fingerprint: str,
    source_leaf_fingerprint: str,
    parent_embedding_fingerprint: str,
) -> list[ParentEmbeddingRecord]:
    """Validate a complete, publishable Parent Embedding JSONL artifact."""
    if not path.exists() or not path.is_file():
        raise ValueError(f"Parent embedding artifact is missing: {path}")
    try:
        payload = load_jsonl_file(path)
    except Exception as exc:
        raise ValueError(f"Parent embedding artifact is invalid JSONL: {path}") from exc
    required = {parent.parent_id: parent for parent in parents}
    if len(payload) != len(required):
        raise ValueError("Parent embedding record count does not match required Parents")
    seen: set[str] = set()
    records: list[ParentEmbeddingRecord] = []
    for raw in payload:
        if not isinstance(raw, dict):
            raise ValueError("Parent embedding JSONL records must be objects")
        try:
            record = ParentEmbeddingRecord(**raw)
        except Exception as exc:
            raise ValueError("Parent embedding record schema is invalid") from exc
        if not record.parent_id or record.parent_id in seen:
            raise ValueError("Parent embedding parent_id must be non-empty and unique")
        parent = required.get(record.parent_id)
        if parent is None:
            raise ValueError(f"Parent embedding contains unknown parent_id: {record.parent_id}")
        seen.add(record.parent_id)
        if record.video_id != parent.video_id:
            raise ValueError(f"Parent embedding video_id mismatch: {record.parent_id}")
        if record.hierarchy_level != parent.hierarchy_level or record.hierarchy_level != 1:
            raise ValueError(f"Parent embedding hierarchy_level mismatch: {record.parent_id}")
        if record.document_type != parent.document_type or record.document_type != "parent_chunk":
            raise ValueError(f"Parent embedding document_type mismatch: {record.parent_id}")
        if record.child_chunk_ids != parent.child_chunk_ids:
            raise ValueError(f"Parent embedding child_chunk_ids mismatch: {record.parent_id}")
        if record.child_count != parent.child_count or record.child_count != len(record.child_chunk_ids):
            raise ValueError(f"Parent embedding child_count mismatch: {record.parent_id}")
        if record.start_sec != parent.start_sec or record.end_sec != parent.end_sec or record.text != parent.text:
            raise ValueError(f"Parent embedding source fields mismatch: {record.parent_id}")
        if record.order != parent.order:
            raise ValueError(f"Parent embedding order mismatch: {record.parent_id}")
        if record.embedding_status not in PUBLISHABLE_STATUSES:
            raise ValueError(f"Parent embedding is not publishable: {record.parent_id}")
        vector = record.embedding
        if not isinstance(vector, list) or not vector or len(vector) != expected_dimension:
            raise ValueError(f"Parent embedding vector dimension mismatch: {record.parent_id}")
        if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in vector):
            raise ValueError(f"Parent embedding vector contains non-finite or non-numeric values: {record.parent_id}")
        if record.embedding_dimension != expected_dimension:
            raise ValueError(f"Parent embedding metadata dimension mismatch: {record.parent_id}")
        if record.embedding_provider != PARENT_EMBEDDING_PROVIDER or record.embedding_model != expected_model or record.embedding_task_type != PARENT_EMBEDDING_TASK_TYPE:
            raise ValueError(f"Parent embedding provider metadata mismatch: {record.parent_id}")
        if record.embedding_schema_version != PARENT_EMBEDDING_SCHEMA_VERSION:
            raise ValueError(f"Parent embedding schema version mismatch: {record.parent_id}")
        if record.preprocessing_version != PARENT_EMBEDDING_PREPROCESSING_VERSION or record.normalization_version != PARENT_EMBEDDING_NORMALIZATION_VERSION:
            raise ValueError(f"Parent embedding processing version mismatch: {record.parent_id}")
        if record.hierarchy_fingerprint != hierarchy_fingerprint or record.source_leaf_fingerprint != source_leaf_fingerprint or record.parent_embedding_fingerprint != parent_embedding_fingerprint:
            raise ValueError(f"Parent embedding fingerprint metadata mismatch: {record.parent_id}")
        records.append(record)
    if seen != set(required):
        raise ValueError("Parent embedding artifact is missing required Parents")
    return records
