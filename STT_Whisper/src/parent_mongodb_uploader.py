"""Offline-safe Parent Embedding artifact validation and MongoDB upsert planning.

This module never creates a MongoDB client.  The caller must inject a collection,
which keeps publication explicit and makes the complete preflight independently
testable before any database write is attempted.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from parent_embedding import PUBLISHABLE_STATUSES
from parent_embedding_strategy import (
    PARENT_EMBEDDING_NORMALIZATION_VERSION,
    PARENT_EMBEDDING_PREPROCESSING_VERSION,
    PARENT_EMBEDDING_PROVIDER,
    PARENT_EMBEDDING_SCHEMA_VERSION,
    PARENT_EMBEDDING_TASK_TYPE,
    PARENT_EMBEDDING_INSTRUCTION,
    PARENT_EMBEDDING_INSTRUCTION_VERSION,
    PARENT_EMBEDDING_GENERATION_VERSION,
    PARENT_EMBEDDING_CONTRACT_VERSION,
    PARENT_EMBEDDING_ROLE,
)
from utils import chunked


PARENT_COLLECTION_DEFAULT = "video_segments_parent"
PARENT_DOCUMENT_SCHEMA_VERSION = "parent_document_v1"
EXPECTED_MODEL = "gemini-embedding-2"
EXPECTED_DIMENSION = 3072

# Storage is an explicit whitelist. Artifact-only diagnostics are deliberately absent.
PARENT_FIELD_MAPPING = {
    "parent_id": "parentId",
    "video_id": "videoId",
    "hierarchy_level": "hierarchyLevel",
    "document_type": "documentType",
    "start_sec": "startSec",
    "end_sec": "endSec",
    "text": "text",
    "child_chunk_ids": "childChunkIds",
    "child_count": "childCount",
    "order": "order",
    "embedding": "embedding",
    "embedding_provider": "embeddingProvider",
    "embedding_model": "embeddingModel",
    "embedding_dimension": "embeddingDimension",
    "embedding_task_type": "embeddingTaskType",
    "embedding_instruction_version": "embeddingInstructionVersion",
    "embedding_contract_version": "embeddingContractVersion",
    "embedding_schema_version": "embeddingSchemaVersion",
    "preprocessing_version": "preprocessingVersion",
    "normalization_version": "normalizationVersion",
    "hierarchy_fingerprint": "hierarchyFingerprint",
    "source_leaf_fingerprint": "sourceLeafFingerprint",
    "parent_embedding_fingerprint": "parentEmbeddingFingerprint",
}

REQUIRED_ARTIFACT_FIELDS = frozenset(
    set(PARENT_FIELD_MAPPING)
    | {
        "embedding_status",
        "embedding_timestamp",
        "embedding_error",
        "embedding_instruction",
        "embedding_generation_version",
        "embedding_role",
    }
)


@dataclass(slots=True)
class ParentUploadSummary:
    input_count: int = 0
    validated_count: int = 0
    operation_count: int = 0
    matched_count: int = 0
    modified_count: int = 0
    upserted_count: int = 0
    skipped_count: int = 0
    failed_count: int = 0
    success: bool = False
    status: str = "failed"
    errors: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "inputCount": self.input_count,
            "validatedCount": self.validated_count,
            "operationCount": self.operation_count,
            "matchedCount": self.matched_count,
            "modifiedCount": self.modified_count,
            "upsertedCount": self.upserted_count,
            "skippedCount": self.skipped_count,
            "failedCount": self.failed_count,
            "success": self.success,
            "status": self.status,
            "errors": list(self.errors),
        }


def _error(code: str, message: str, **context: Any) -> dict[str, Any]:
    """Return a deliberately small error record without source text or vectors."""
    return {"code": code, "message": message, **{k: v for k, v in context.items() if v is not None}}


def _object_id(value: Any) -> Any:
    try:
        from bson import ObjectId
    except ImportError as exc:
        raise RuntimeError("bson is required for Parent publication validation.") from exc
    if not isinstance(value, str) or not value.strip() or not ObjectId.is_valid(value.strip()):
        raise ValueError("courseId must be a valid MongoDB ObjectId.")
    return ObjectId(value.strip())


def read_parent_embedding_jsonl(path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    records: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    input_count = 0
    if not path.exists() or not path.is_file():
        return records, [_error("file_missing", "Parent embedding artifact does not exist.")], 0
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                input_count += 1
                try:
                    raw = json.loads(line)
                except (json.JSONDecodeError, UnicodeError):
                    errors.append(_error("invalid_json", "JSONL line is not valid JSON.", line=line_number))
                    continue
                if not isinstance(raw, dict):
                    errors.append(_error("invalid_record", "JSONL line must contain an object.", line=line_number))
                    continue
                records.append({"_line": line_number, **raw})
    except OSError:
        return [], [_error("file_unreadable", "Parent embedding artifact cannot be read.")], 0
    if input_count == 0:
        errors.append(_error("empty_input", "Parent embedding artifact is empty."))
    return records, errors, input_count


def _nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _integer(value: Any, minimum: int = 0) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= minimum


def _finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _validate_record(record: dict[str, Any]) -> list[dict[str, Any]]:
    line = record.get("_line")
    parent_id = record.get("parent_id") if _nonempty_string(record.get("parent_id")) else None
    context = {"line": line, "parentId": parent_id}
    errors: list[dict[str, Any]] = []
    missing = sorted(name for name in REQUIRED_ARTIFACT_FIELDS if name not in record)
    if missing:
        errors.append(_error("missing_fields", f"Required fields are missing: {', '.join(missing)}.", **context))
        return errors
    if not parent_id:
        errors.append(_error("invalid_parent_id", "parent_id must be a non-empty string.", **context))
    if not _nonempty_string(record["video_id"]):
        errors.append(_error("invalid_video_id", "video_id must be a non-empty canonical string.", **context))
    if record["hierarchy_level"] != 1 or isinstance(record["hierarchy_level"], bool):
        errors.append(_error("invalid_hierarchy_level", "hierarchy_level must be integer 1.", **context))
    if record["document_type"] != "parent_chunk":
        errors.append(_error("invalid_document_type", "document_type must be parent_chunk.", **context))
    if not _finite_number(record["start_sec"]) or not _finite_number(record["end_sec"]):
        errors.append(_error("invalid_time", "start_sec and end_sec must be finite numbers.", **context))
    elif record["start_sec"] < 0 or record["start_sec"] > record["end_sec"]:
        errors.append(_error("invalid_time_range", "Parent time range is invalid.", **context))
    if not _nonempty_string(record["text"]):
        errors.append(_error("invalid_text", "text must be non-empty.", **context))
    children = record["child_chunk_ids"]
    if not isinstance(children, list) or not children or any(not _nonempty_string(item) for item in children):
        errors.append(_error("invalid_children", "child_chunk_ids must be a non-empty string array.", **context))
    else:
        if len(children) != len(set(children)):
            errors.append(_error("duplicate_child_id", "child_chunk_ids contains duplicates.", **context))
        if record["child_count"] != len(children):
            errors.append(_error("child_count_mismatch", "child_count does not match child_chunk_ids.", **context))
    if not _integer(record["order"]):
        errors.append(_error("invalid_order", "order must be a non-negative integer.", **context))
    vector = record["embedding"]
    if not isinstance(vector, list) or len(vector) != EXPECTED_DIMENSION:
        errors.append(_error("invalid_embedding_dimension", "embedding must contain exactly 3072 values.", **context))
    elif any(not _finite_number(value) for value in vector):
        errors.append(_error("invalid_embedding_value", "embedding contains a non-finite or non-numeric value.", **context))
    elif not any(value != 0 for value in vector):
        errors.append(_error("zero_embedding", "embedding must not be an all-zero vector.", **context))
    if record["embedding_status"] not in PUBLISHABLE_STATUSES:
        errors.append(_error("unpublishable_embedding", "embedding_status is not publishable.", **context))
    if record["embedding_error"] not in (None, ""):
        errors.append(_error("embedding_error", "A record with embedding_error cannot be published.", **context))
    if record["embedding_provider"] != PARENT_EMBEDDING_PROVIDER:
        errors.append(_error("provider_mismatch", "embedding_provider does not match the Parent contract.", **context))
    if record["embedding_model"] != EXPECTED_MODEL:
        errors.append(_error("model_mismatch", "embedding_model does not match the Parent contract.", **context))
    if record["embedding_dimension"] != EXPECTED_DIMENSION:
        errors.append(_error("dimension_metadata_mismatch", "embedding_dimension does not match the Parent contract.", **context))
    if record["embedding_task_type"] is not PARENT_EMBEDDING_TASK_TYPE:
        errors.append(_error("task_type_mismatch", "embedding_task_type does not match the Parent contract.", **context))
    expected_metadata = {
        "embedding_timestamp": None,
        "embedding_schema_version": PARENT_EMBEDDING_SCHEMA_VERSION,
        "embedding_instruction": PARENT_EMBEDDING_INSTRUCTION,
        "embedding_instruction_version": PARENT_EMBEDDING_INSTRUCTION_VERSION,
        "embedding_generation_version": PARENT_EMBEDDING_GENERATION_VERSION,
        "embedding_contract_version": PARENT_EMBEDDING_CONTRACT_VERSION,
        "embedding_role": PARENT_EMBEDDING_ROLE,
        "preprocessing_version": PARENT_EMBEDDING_PREPROCESSING_VERSION,
        "normalization_version": PARENT_EMBEDDING_NORMALIZATION_VERSION,
        "hierarchy_fingerprint": None,
        "source_leaf_fingerprint": None,
        "parent_embedding_fingerprint": None,
    }
    for field_name, expected in expected_metadata.items():
        if not _nonempty_string(record[field_name]):
            errors.append(_error("invalid_metadata", f"{field_name} must be non-empty.", **context))
        elif expected is not None and record[field_name] != expected:
            errors.append(_error("metadata_mismatch", f"{field_name} does not match the Parent contract.", **context))
    return errors


def map_parent_document(
    record: dict[str, Any],
    course_id: Any,
    *,
    generation_version: str | None = None,
    is_active: bool = True,
) -> dict[str, Any]:
    """Map only schema-approved artifact fields to a Parent MongoDB document."""
    document = {target: record[source] for source, target in PARENT_FIELD_MAPPING.items()}
    document.update(
        {
            "courseId": course_id,
            "documentSchemaVersion": PARENT_DOCUMENT_SCHEMA_VERSION,
            "generationVersion": generation_version or record["embedding_generation_version"],
            "isActive": is_active,
        }
    )
    return document


def _default_operation(filter_document: dict[str, Any], document: dict[str, Any]) -> Any:
    from pymongo import UpdateOne
    return UpdateOne(filter_document, {"$set": document}, upsert=True)


def preflight_parent_publication(
    path: Path,
    *,
    course_id: str | None = None,
    course_id_resolver: Callable[[dict[str, Any]], str | None] | None = None,
    expected_video_id: str | None = None,
    generation_version: str | None = None,
    is_active: bool = True,
) -> tuple[list[dict[str, Any]], ParentUploadSummary]:
    records, errors, input_count = read_parent_embedding_jsonl(path)
    summary = ParentUploadSummary(input_count=input_count)
    for record in records:
        errors.extend(_validate_record(record))

    parent_ids = [record.get("parent_id") for record in records if _nonempty_string(record.get("parent_id"))]
    duplicates = sorted({value for value in parent_ids if parent_ids.count(value) > 1})
    for parent_id in duplicates:
        errors.append(_error("duplicate_parent_id", "parent_id is duplicated in the input batch.", parentId=parent_id))

    videos = {record.get("video_id") for record in records if _nonempty_string(record.get("video_id"))}
    if len(videos) > 1:
        errors.append(_error("mixed_video_scope", "Input batch contains more than one video_id."))
    if expected_video_id is not None and videos != {expected_video_id}:
        errors.append(_error("video_scope_mismatch", "Input batch does not match the expected video_id scope."))

    for field_name in ("hierarchy_fingerprint", "source_leaf_fingerprint", "parent_embedding_fingerprint"):
        values = {record.get(field_name) for record in records if _nonempty_string(record.get(field_name))}
        if len(values) > 1:
            errors.append(_error("mixed_fingerprint", f"Input batch mixes {field_name} values."))

    resolved_ids: list[Any] = []
    for record in records:
        raw_course_id = course_id if course_id is not None else (
            course_id_resolver(record) if course_id_resolver is not None else None
        )
        try:
            resolved_ids.append(_object_id(raw_course_id))
        except (ValueError, RuntimeError):
            errors.append(_error(
                "invalid_course_id",
                "A valid authoritative courseId is required for every Parent.",
                line=record.get("_line"),
                parentId=record.get("parent_id") if _nonempty_string(record.get("parent_id")) else None,
            ))
    if len({str(value) for value in resolved_ids}) > 1:
        errors.append(_error("course_scope_conflict", "Input batch resolves to more than one courseId."))

    if errors or len(records) != input_count or len(resolved_ids) != len(records):
        summary.errors = errors
        summary.failed_count = len(errors)
        summary.skipped_count = input_count
        summary.status = "preflight_blocked" if input_count else "empty_input"
        return [], summary

    documents = [
        map_parent_document(
            record,
            resolved_ids[index],
            generation_version=generation_version,
            is_active=is_active,
        )
        for index, record in enumerate(records)
    ]
    summary.validated_count = len(documents)
    summary.status = "validated"
    summary.success = True
    return documents, summary


def upload_parent_embeddings(
    path: Path,
    collection: Any,
    *,
    course_id: str | None = None,
    course_id_resolver: Callable[[dict[str, Any]], str | None] | None = None,
    expected_video_id: str | None = None,
    generation_version: str | None = None,
    is_active: bool = True,
    batch_size: int = 200,
    operation_factory: Callable[[dict[str, Any], dict[str, Any]], Any] | None = None,
) -> ParentUploadSummary:
    documents, summary = preflight_parent_publication(
        path,
        course_id=course_id,
        course_id_resolver=course_id_resolver,
        expected_video_id=expected_video_id,
        generation_version=generation_version,
        is_active=is_active,
    )
    if not documents:
        return summary
    factory = operation_factory or _default_operation
    operations = [factory({"parentId": document["parentId"]}, document) for document in documents]
    summary.operation_count = len(operations)
    processed = 0
    for operation_batch in chunked(operations, max(1, batch_size)):
        try:
            result = collection.bulk_write(operation_batch, ordered=False)
            summary.matched_count += int(getattr(result, "matched_count", 0))
            summary.modified_count += int(getattr(result, "modified_count", 0))
            summary.upserted_count += int(getattr(result, "upserted_count", 0))
            processed += len(operation_batch)
        except Exception as exc:
            details = getattr(exc, "details", {}) if isinstance(getattr(exc, "details", {}), dict) else {}
            write_errors = details.get("writeErrors", []) if isinstance(details.get("writeErrors", []), list) else []
            failed = len(write_errors) or len(operation_batch)
            summary.failed_count += failed
            processed += max(0, len(operation_batch) - failed)
            summary.matched_count += int(details.get("nMatched", 0) or 0)
            summary.modified_count += int(details.get("nModified", 0) or 0)
            summary.upserted_count += int(details.get("nUpserted", 0) or 0)
            if write_errors:
                for item in write_errors:
                    index = item.get("index") if isinstance(item, dict) else None
                    summary.errors.append(_error("bulk_write_error", "A Parent upsert operation failed.", operationIndex=index))
            else:
                summary.errors.append(_error("collection_error", "Parent collection bulk write failed."))
    summary.skipped_count = max(0, summary.operation_count - processed - summary.failed_count)
    if summary.failed_count:
        summary.status = "partial_failure" if processed else "failed"
        summary.success = False
    elif processed == summary.operation_count:
        summary.status = "completed"
        summary.success = True
    else:
        summary.status = "failed"
        summary.failed_count += summary.operation_count - processed
    return summary
