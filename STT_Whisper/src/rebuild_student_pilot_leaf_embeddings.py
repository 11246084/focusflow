"""Fail-closed rebuild for the fixed OpenCV student-pilot Leaf scope.

The command is deliberately a two-phase tool.  Its default is a database
read-only dry run.  ``--execute`` requires an exact confirmation string and a
new backup path; it never writes until every one of the 129 documents has been
read, checked, and embedded successfully.  Rollback is also explicit.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

from embedding_contract import (
    GEMINI_EMBEDDING_CONTRACT_VERSION,
    GEMINI_EMBEDDING_DIMENSION,
    GEMINI_EMBEDDING_GENERATION_VERSION,
    GEMINI_EMBEDDING_INSTRUCTION_VERSION,
    GEMINI_EMBEDDING_MODEL,
    GEMINI_EMBEDDING_NORMALIZATION_VERSION,
    GEMINI_EMBEDDING_TASK_TYPE,
    build_parent_document_text,
)


STUDENT_PILOT_OPENCV_COURSE_ID = "69fb4d4c069e21f4e65b74dc"
STUDENT_PILOT_EXCLUDED_VIDEO_ID = "6a5deabebece4943079410bd"
STUDENT_PILOT_ALLOWED_VIDEO_IDS = (
    "69fb55edb52433fda32db4e8",
    "69fb57edb52433fda32db706",
    "69fb59cfb52433fda32db827",
    "69fb5b5eb52433fda32db907",
    "69fb5c8db52433fda32dbab5",
    "69fb5d78b52433fda32dbc81",
    "69fc291cadf6d9dc08eb4cb7",
    "6a02f2d417c615e872035a68",
    "6a02f34d17c615e872035b3d",
    "6a02f38c17c615e872035b94",
    "6a02f3b217c615e872035beb",
    "6a02f42a17c615e872035c42",
    "6a02f46317c615e872035c93",
    "6a02f48c17c615e872035cea",
    "6a02f4b017c615e872035d41",
)
EXPECTED_VIDEO_COUNT = 15
EXPECTED_LEAF_COUNT = 129
REBUILD_CONFIRMATION = "REBUILD_STUDENT_PILOT_LEAVES"
ROLLBACK_CONFIRMATION = "ROLLBACK_STUDENT_PILOT_LEAVES"

CONTRACT_METADATA = {
    "embeddingProvider": "gemini",
    "embeddingModel": GEMINI_EMBEDDING_MODEL,
    "embeddingDimension": GEMINI_EMBEDDING_DIMENSION,
    "embeddingTaskType": GEMINI_EMBEDDING_TASK_TYPE,
    "embeddingInstructionVersion": GEMINI_EMBEDDING_INSTRUCTION_VERSION,
    "generationVersion": GEMINI_EMBEDDING_GENERATION_VERSION,
    "normalizationVersion": GEMINI_EMBEDDING_NORMALIZATION_VERSION,
    "embeddingContractVersion": GEMINI_EMBEDDING_CONTRACT_VERSION,
    "embeddingSchemaVersion": GEMINI_EMBEDDING_CONTRACT_VERSION,
}


class RebuildError(RuntimeError):
    """A small, non-secret error suitable for an operator evidence report."""


@dataclass(frozen=True)
class ScopeSnapshot:
    course_id: str
    allowed_video_ids: tuple[str, ...]
    excluded_video_present: bool
    leaves: tuple[dict[str, Any], ...]


def _object_id(value: str) -> Any:
    from bson import ObjectId

    if not ObjectId.is_valid(value):
        raise RebuildError("The fixed student-pilot identifier is invalid.")
    return ObjectId(value)


def _json_default(value: Any) -> Any:
    return str(value)


def load_env_file(path: Path, permitted_keys: set[str]) -> None:
    """Load only needed dotenv values without overriding a supplied process env.

    The tool never echoes values or records the dotenv path in its evidence
    report.  A missing default ``.env`` is intentionally harmless.
    """
    if not path.exists():
        return
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise RebuildError("The requested dotenv file cannot be read.") from exc
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, value = line.partition("=")
        key = key.strip()
        if not separator or key not in permitted_keys or key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if value:
            os.environ[key] = value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _unique_strings(values: Iterable[Any]) -> list[str]:
    return list(dict.fromkeys(str(value) for value in values if value is not None))


def _to_array(cursor: Any) -> list[dict[str, Any]]:
    return cursor.to_list(length=None) if hasattr(cursor, "to_list") else list(cursor)


def _read_scope(course_collection: Any, video_collection: Any, leaf_collection: Any) -> ScopeSnapshot:
    course_id = _object_id(STUDENT_PILOT_OPENCV_COURSE_ID)
    course = course_collection.find_one(
        {"_id": course_id},
        projection={"_id": 1, "videoIds": 1, "status": 1, "deletedAt": 1},
    )
    if not course or course.get("deletedAt") is not None or course.get("status") != "published":
        raise RebuildError("The fixed OpenCV course is not published and active.")

    expected_all_video_ids = (*STUDENT_PILOT_ALLOWED_VIDEO_IDS, STUDENT_PILOT_EXCLUDED_VIDEO_ID)
    listed_ids = _unique_strings(course.get("videoIds", []))
    if set(listed_ids) != set(expected_all_video_ids):
        raise RebuildError("OpenCV course videoIds do not match the fixed 15+TEST_0720 allowlist.")
    videos = _to_array(video_collection.find(
        {"_id": {"$in": [_object_id(video_id) for video_id in expected_all_video_ids]}, "deletedAt": None},
        projection={"_id": 1},
    ))
    all_video_ids = _unique_strings(video.get("_id") for video in videos)
    excluded_present = STUDENT_PILOT_EXCLUDED_VIDEO_ID in all_video_ids
    if set(all_video_ids) != set(expected_all_video_ids) or not excluded_present:
        raise RebuildError(
            f"OpenCV video scope mismatch: expected {EXPECTED_VIDEO_COUNT} allowed videos plus TEST_0720."
        )
    allowed_video_ids = STUDENT_PILOT_ALLOWED_VIDEO_IDS

    leaves = _to_array(leaf_collection.find(
        {"videoId": {"$in": list(allowed_video_ids)}},
        # Backup needs every current field for a complete rollback.  Rebuild
        # itself later applies only a narrow $set patch.
        projection=None,
    ))
    if len(leaves) != EXPECTED_LEAF_COUNT:
        raise RebuildError(f"OpenCV Leaf count must be exactly {EXPECTED_LEAF_COUNT}.")
    chunk_ids = [str(leaf.get("chunkId", "")) for leaf in leaves]
    if any(not chunk_id for chunk_id in chunk_ids) or len(set(chunk_ids)) != EXPECTED_LEAF_COUNT:
        raise RebuildError("OpenCV Leaf preflight requires 129 unique non-empty chunkId values.")
    for leaf in leaves:
        if str(leaf.get("videoId", "")) not in allowed_video_ids:
            raise RebuildError("Leaf escaped the fixed OpenCV video allowlist.")
        if not isinstance(leaf.get("text"), str) or not leaf["text"].strip():
            raise RebuildError("Every rebuild Leaf must have non-empty source text.")
    return ScopeSnapshot(
        course_id=STUDENT_PILOT_OPENCV_COURSE_ID,
        allowed_video_ids=allowed_video_ids,
        excluded_video_present=excluded_present,
        leaves=tuple(leaves),
    )


def _normalize_vector(values: Any) -> list[float]:
    if not isinstance(values, list) or len(values) != GEMINI_EMBEDDING_DIMENSION:
        raise RebuildError("Gemini returned a vector with an invalid dimension.")
    if any(not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) for value in values):
        raise RebuildError("Gemini returned a non-finite vector value.")
    magnitude = math.sqrt(sum(float(value) * float(value) for value in values))
    if not math.isfinite(magnitude) or magnitude == 0:
        raise RebuildError("Gemini returned an all-zero vector.")
    return [float(value) / magnitude for value in values]


def embed_document_with_gemini(text: str, api_key: str, *, max_retries: int = 3) -> list[float]:
    """Embed one document with the stable document instruction; no batch aggregation."""
    payload = json.dumps({
        "model": f"models/{GEMINI_EMBEDDING_MODEL}",
        "content": {"parts": [{"text": build_parent_document_text(text)}]},
        "output_dimensionality": GEMINI_EMBEDDING_DIMENSION,
    }).encode("utf-8")
    request = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_EMBEDDING_MODEL}:embedContent",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
    )
    for attempt in range(max_retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = json.loads(response.read().decode("utf-8"))
            return _normalize_vector(body.get("embedding", {}).get("values"))
        except urllib.error.HTTPError as exc:
            retryable = exc.code == 429 or 500 <= exc.code < 600
        except urllib.error.URLError:
            retryable = True
        except json.JSONDecodeError:
            retryable = False
        except RebuildError:
            retryable = False
        if not retryable or attempt >= max_retries:
            raise RebuildError("Gemini document embedding request failed.")
        # Per-Leaf checkpointing means retrying one transport failure can never
        # discard already staged vectors; keep the backoff bounded and explicit.
        time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def _backup_payload(snapshot: ScopeSnapshot) -> dict[str, Any]:
    return {
        "schemaVersion": "student_pilot_leaf_backup_v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "scope": {
            "courseId": snapshot.course_id,
            "excludedVideoId": STUDENT_PILOT_EXCLUDED_VIDEO_ID,
            "allowedVideoIds": list(snapshot.allowed_video_ids),
            "leafCount": len(snapshot.leaves),
        },
        "leaves": list(snapshot.leaves),
    }


def _source_record(leaf: dict[str, Any]) -> dict[str, str]:
    text_hash = hashlib.sha256(leaf["text"].encode("utf-8")).hexdigest()
    return {
        "id": str(leaf["_id"]),
        "chunkId": str(leaf["chunkId"]),
        "videoId": str(leaf["videoId"]),
        "textSha256": text_hash,
    }


def source_snapshot(snapshot: ScopeSnapshot) -> dict[str, Any]:
    records = sorted((_source_record(leaf) for leaf in snapshot.leaves), key=lambda item: item["chunkId"])
    encoded = json.dumps(records, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {
        "courseId": snapshot.course_id,
        "excludedVideoId": STUDENT_PILOT_EXCLUDED_VIDEO_ID,
        "allowedVideoIds": list(sorted(snapshot.allowed_video_ids)),
        "leafCount": len(records),
        "sha256": hashlib.sha256(encoded).hexdigest(),
        "records": records,
    }


def _write_json_atomically(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(path)


def _load_staging_artifact(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        artifact = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RebuildError("Staging artifact cannot be read.") from exc
    if not isinstance(artifact, dict):
        raise RebuildError("Staging artifact must be a JSON object.")
    return artifact


def _validate_staging_artifact(artifact: dict[str, Any], snapshot: ScopeSnapshot) -> list[dict[str, Any]]:
    expected_source = source_snapshot(snapshot)
    if artifact.get("schemaVersion") != "student_pilot_leaf_embedding_stage_v1":
        raise RebuildError("Staging artifact schema is not accepted.")
    source = artifact.get("sourceSnapshot")
    if not isinstance(source, dict) or source.get("sha256") != expected_source["sha256"]:
        raise RebuildError("Staging artifact source snapshot does not match the current 129 Leaves.")
    if source.get("allowedVideoIds") != expected_source["allowedVideoIds"] or source.get("leafCount") != EXPECTED_LEAF_COUNT:
        raise RebuildError("Staging artifact allowlist or Leaf count is invalid.")
    if artifact.get("embeddingContract") != CONTRACT_METADATA:
        raise RebuildError("Staging artifact does not declare the complete stable contract.")
    records = artifact.get("records")
    if not isinstance(records, list) or len(records) != EXPECTED_LEAF_COUNT:
        raise RebuildError("Staging artifact is incomplete; exactly 129 embeddings are required.")
    expected_by_chunk = {record["chunkId"]: record for record in expected_source["records"]}
    seen: set[str] = set()
    for record in records:
        if not isinstance(record, dict) or record.get("chunkId") in seen:
            raise RebuildError("Staging artifact has duplicate or invalid chunk provenance.")
        expected = expected_by_chunk.get(record.get("chunkId"))
        if not expected or any(record.get(key) != expected[key] for key in ("id", "videoId", "textSha256")):
            raise RebuildError("Staging artifact record does not match its source Leaf.")
        _normalize_vector(record.get("embedding"))
        seen.add(record["chunkId"])
    return records


def stage_embeddings(
    snapshot: ScopeSnapshot,
    artifact_path: Path,
    embed_document: Callable[[str], list[float]],
    *,
    checkpoint_every: int = 1,
) -> dict[str, Any]:
    """Generate a resumable, text-free artifact.  This never writes Atlas."""
    source = source_snapshot(snapshot)
    if checkpoint_every < 1:
        raise RebuildError("checkpoint_every must be at least one.")
    existing = _load_staging_artifact(artifact_path)
    existing_records: dict[str, dict[str, Any]] = {}
    if existing is not None:
        if existing.get("sourceSnapshot", {}).get("sha256") != source["sha256"] or existing.get("embeddingContract") != CONTRACT_METADATA:
            raise RebuildError("Existing staging artifact belongs to another source snapshot or contract.")
        for record in existing.get("records", []):
            if isinstance(record, dict):
                try:
                    _normalize_vector(record.get("embedding"))
                    existing_records[str(record.get("chunkId"))] = record
                except RebuildError:
                    continue
    staged: list[dict[str, Any]] = []
    generated = 0
    source_by_chunk = {record["chunkId"]: record for record in source["records"]}
    text_by_chunk = {str(leaf["chunkId"]): leaf["text"] for leaf in snapshot.leaves}
    for chunk_id in sorted(source_by_chunk):
        source_record = source_by_chunk[chunk_id]
        record = existing_records.get(chunk_id)
        if record and all(record.get(key) == source_record[key] for key in ("id", "chunkId", "videoId", "textSha256")):
            staged.append(record)
            continue
        staged.append({**source_record, "embedding": _normalize_vector(embed_document(text_by_chunk[chunk_id]))})
        generated += 1
        if generated % checkpoint_every == 0:
            _write_json_atomically(artifact_path, {
                "schemaVersion": "student_pilot_leaf_embedding_stage_v1",
                "sourceSnapshot": source,
                "embeddingContract": CONTRACT_METADATA,
                "records": staged,
            })
    artifact = {
        "schemaVersion": "student_pilot_leaf_embedding_stage_v1",
        "sourceSnapshot": source,
        "embeddingContract": CONTRACT_METADATA,
        "records": staged,
    }
    _write_json_atomically(artifact_path, artifact)
    _validate_staging_artifact(artifact, snapshot)
    return {"path": str(artifact_path.resolve()), "sha256": _sha256(artifact_path), "generatedCount": generated, "reusedCount": EXPECTED_LEAF_COUNT - generated}


def write_backup(path: Path, snapshot: ScopeSnapshot) -> dict[str, Any]:
    if path.exists():
        raise RebuildError("Backup path already exists; refusing to overwrite evidence.")
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = _backup_payload(snapshot)
    # Extended JSON preserves MongoDB ObjectIds so rollback can use the exact
    # original document identity rather than a lossy string conversion.
    from bson import json_util

    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(json_util.dumps(payload, ensure_ascii=False, indent=2))
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(path)
    return {"path": str(path.resolve()), "sha256": _sha256(path), "leafCount": len(snapshot.leaves)}


def load_backup(path: Path) -> list[dict[str, Any]]:
    try:
        from bson import json_util

        payload = json_util.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RebuildError("Rollback backup cannot be read.") from exc
    if not isinstance(payload, dict):
        raise RebuildError("Rollback backup must be a JSON object.")
    scope = payload.get("scope")
    if (
        payload.get("schemaVersion") != "student_pilot_leaf_backup_v1"
        or not isinstance(scope, dict)
        or scope.get("courseId") != STUDENT_PILOT_OPENCV_COURSE_ID
        or scope.get("excludedVideoId") != STUDENT_PILOT_EXCLUDED_VIDEO_ID
        or set(scope.get("allowedVideoIds", [])) != set(STUDENT_PILOT_ALLOWED_VIDEO_IDS)
        or scope.get("leafCount") != EXPECTED_LEAF_COUNT
    ):
        raise RebuildError("Rollback backup scope does not match the fixed OpenCV 129-Leaf contract.")
    leaves = payload.get("leaves")
    if not isinstance(leaves, list) or len(leaves) != EXPECTED_LEAF_COUNT:
        raise RebuildError("Rollback backup does not contain exactly 129 Leaves.")
    chunk_ids = [str(leaf.get("chunkId", "")) for leaf in leaves if isinstance(leaf, dict)]
    if len(chunk_ids) != EXPECTED_LEAF_COUNT or len(set(chunk_ids)) != EXPECTED_LEAF_COUNT:
        raise RebuildError("Rollback backup has invalid chunkId provenance.")
    if any(str(leaf.get("videoId", "")) not in STUDENT_PILOT_ALLOWED_VIDEO_IDS for leaf in leaves):
        raise RebuildError("Rollback backup contains a Leaf outside the fixed video allowlist.")
    return leaves


REBUILD_FIELDS = ("embedding", *CONTRACT_METADATA.keys())


def _rebuilt_records(snapshot: ScopeSnapshot, records: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Join a validated, text-free artifact to the current source snapshot."""
    by_chunk = {str(record["chunkId"]): record for record in records}
    rebuilt: list[dict[str, Any]] = []
    for leaf in snapshot.leaves:
        record = by_chunk.get(str(leaf["chunkId"]))
        if record is None:
            raise RebuildError("Staging artifact does not cover every current Leaf.")
        rebuilt.append({
            "_id": leaf["_id"],
            "chunkId": leaf["chunkId"],
            "videoId": leaf["videoId"],
            # Matching text makes a concurrent source edit fail closed instead
            # of attaching a vector generated for stale document content.
            "text": leaf["text"],
            "embedding": _normalize_vector(record["embedding"]),
        })
    return rebuilt


def _rebuild_operations(documents: Sequence[dict[str, Any]], update_one: Callable[..., Any]) -> list[Any]:
    """Narrow updates only: never replace a Leaf or alter its source fields."""
    return [
        update_one(
            {"_id": document["_id"], "chunkId": document["chunkId"], "videoId": document["videoId"], "text": document["text"]},
            {"$set": {"embedding": document["embedding"], **CONTRACT_METADATA}},
            upsert=False,
        )
        for document in documents
    ]


def _rollback_operations(leaves: Sequence[dict[str, Any]], update_one: Callable[..., Any]) -> list[Any]:
    """Restore exactly the fields this tool owns; preserve every other field."""
    operations = []
    for leaf in leaves:
        set_fields = {name: leaf[name] for name in REBUILD_FIELDS if name in leaf}
        unset_fields = {name: "" for name in REBUILD_FIELDS if name not in leaf}
        update: dict[str, Any] = {}
        if set_fields:
            update["$set"] = set_fields
        if unset_fields:
            update["$unset"] = unset_fields
        operations.append(update_one(
            {"_id": leaf["_id"], "chunkId": leaf["chunkId"], "videoId": leaf["videoId"]},
            update,
            upsert=False,
        ))
    return operations


def _assert_read_back(leaf_collection: Any, expected: Sequence[dict[str, Any]], session: Any = None) -> None:
    ids = [document["_id"] for document in expected]
    find_kwargs = {"session": session} if session is not None else {}
    actual = _to_array(leaf_collection.find({"_id": {"$in": ids}}, **find_kwargs))
    if len(actual) != EXPECTED_LEAF_COUNT:
        raise RebuildError("Read-back did not return exactly 129 rebuilt Leaves.")
    expected_by_id = {str(document["_id"]): document for document in expected}
    for document in actual:
        expected_document = expected_by_id.get(str(document.get("_id")))
        if not expected_document or document.get("chunkId") != expected_document["chunkId"]:
            raise RebuildError("Read-back Leaf identity mismatch.")
        actual_vector = _normalize_vector(document.get("embedding"))
        expected_vector = expected_document["embedding"]
        if any(abs(actual_value - expected_value) > 1e-12 for actual_value, expected_value in zip(actual_vector, expected_vector)):
            raise RebuildError("Read-back embedding differs from the staged rebuild vector.")
        if any(document.get(name) != value for name, value in CONTRACT_METADATA.items()):
            raise RebuildError("Read-back metadata does not match the stable contract.")


def run_rebuild(
    course_collection: Any,
    video_collection: Any,
    leaf_collection: Any,
    *,
    execute: bool,
    staging_artifact: dict[str, Any] | None = None,
    backup_path: Path | None = None,
    update_one: Callable[..., Any] | None = None,
    transaction_runner: Callable[[Callable[[Any], None]], None] | None = None,
) -> dict[str, Any]:
    snapshot = _read_scope(course_collection, video_collection, leaf_collection)
    report: dict[str, Any] = {
        "mode": "execute" if execute else "dry_run",
        "scope": {"courseId": snapshot.course_id, "allowedVideoCount": len(snapshot.allowed_video_ids), "leafCount": len(snapshot.leaves)},
        "embeddingContract": {**CONTRACT_METADATA},
        "writes": 0,
    }
    if not execute:
        return report
    if staging_artifact is None or backup_path is None or update_one is None:
        raise RebuildError("Execute mode requires a complete staged artifact, a new backup path, and an explicit write adapter.")
    if transaction_runner is None:
        raise RebuildError("Execute mode requires an Atlas transaction; non-transactional apply is forbidden.")
    staged_records = _validate_staging_artifact(staging_artifact, snapshot)
    rebuilt = _rebuilt_records(snapshot, staged_records)
    report["backup"] = write_backup(backup_path, snapshot)
    if len(rebuilt) != EXPECTED_LEAF_COUNT:
        raise RebuildError("Staging artifact did not produce all 129 Leaves; no writes were attempted.")
    write_result: dict[str, int] = {}

    def apply_writes(session: Any = None) -> None:
        write_kwargs = {"session": session} if session is not None else {}
        result = leaf_collection.bulk_write(_rebuild_operations(rebuilt, update_one), ordered=True, **write_kwargs)
        matched = int(getattr(result, "matched_count", 0) or 0)
        if matched != EXPECTED_LEAF_COUNT:
            raise RebuildError("Atlas did not match all 129 staged Leaves; read-back is unsafe.")
        _assert_read_back(leaf_collection, rebuilt, session)
        write_result["matched"] = matched

    # In the real CLI all 129 narrow updates and the read-back are one Atlas
    # transaction.  The injectable runner keeps the no-network unit tests small.
    transaction_runner(apply_writes)
    report.update({"writes": EXPECTED_LEAF_COUNT, "matchedCount": write_result["matched"], "readBack": "passed"})
    return report


def run_rollback(
    leaf_collection: Any,
    backup_path: Path,
    update_one: Callable[..., Any],
    transaction_runner: Callable[[Callable[[Any], None]], None] | None = None,
) -> dict[str, Any]:
    if transaction_runner is None:
        raise RebuildError("Rollback requires an Atlas transaction; non-transactional apply is forbidden.")
    leaves = load_backup(backup_path)
    rollback_result: dict[str, int] = {}

    def apply_rollback(session: Any = None) -> None:
        write_kwargs = {"session": session} if session is not None else {}
        result = leaf_collection.bulk_write(_rollback_operations(leaves, update_one), ordered=True, **write_kwargs)
        matched = int(getattr(result, "matched_count", 0) or 0)
        if matched != EXPECTED_LEAF_COUNT:
            raise RebuildError("Rollback did not match all 129 backup Leaves.")
        find_kwargs = {"session": session} if session is not None else {}
        actual = _to_array(leaf_collection.find({"_id": {"$in": [leaf["_id"] for leaf in leaves]}}, **find_kwargs))
        if len(actual) != EXPECTED_LEAF_COUNT:
            raise RebuildError("Rollback read-back did not return all 129 Leaves.")
        expected_by_id = {str(leaf["_id"]): leaf for leaf in leaves}
        for document in actual:
            expected = expected_by_id.get(str(document.get("_id")))
            if not expected or any(document.get(field) != expected.get(field) for field in REBUILD_FIELDS):
                raise RebuildError("Rollback read-back does not match the backup fields.")
        rollback_result["matched"] = matched

    transaction_runner(apply_rollback)
    return {"mode": "rollback", "backup": {"path": str(backup_path.resolve()), "sha256": _sha256(backup_path)}, "writes": EXPECTED_LEAF_COUNT, "readBack": "passed"}


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Rebuild only the fixed 129 OpenCV student-pilot Leaf embeddings.")
    parser.add_argument("--mongo-uri-env", default="STUDENT_PILOT_REBUILD_MONGODB_URI")
    parser.add_argument("--env-file", type=Path, default=Path(".env"), help="Optional dotenv source; only required keys are loaded and never printed.")
    parser.add_argument("--database", default="focusflow")
    parser.add_argument("--collection", default="video_segments_text")
    parser.add_argument("--backup-file", type=Path)
    parser.add_argument("--artifact-file", type=Path)
    parser.add_argument("--stage", action="store_true", help="Generate/resume the text-free Gemini artifact; never writes Atlas.")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--rollback-from", type=Path)
    parser.add_argument("--confirm", default="")
    args = parser.parse_args(argv)
    if args.stage and (args.execute or args.rollback_from):
        parser.error("--stage cannot be combined with --execute or --rollback-from")
    if args.rollback_from and not args.execute:
        parser.error("--rollback-from requires --execute")
    if args.stage and args.artifact_file is None:
        parser.error("--stage requires --artifact-file")
    if args.execute and args.rollback_from is None and (args.confirm != REBUILD_CONFIRMATION or args.backup_file is None or args.artifact_file is None):
        parser.error("rebuild requires --artifact-file, --backup-file, and --confirm REBUILD_STUDENT_PILOT_LEAVES")
    if args.rollback_from and args.confirm != ROLLBACK_CONFIRMATION:
        parser.error("rollback requires --confirm ROLLBACK_STUDENT_PILOT_LEAVES")
    return args


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    load_env_file(args.env_file, {args.mongo_uri_env, "GEMINI_API_KEY"})
    mongo_uri = os.getenv(args.mongo_uri_env, "").strip()
    if not mongo_uri:
        raise RebuildError(f"{args.mongo_uri_env} is required even for dry-run scope preflight.")
    from pymongo import MongoClient, UpdateOne

    client = MongoClient(mongo_uri)
    try:
        database = client[args.database]
        leaf_collection = database[args.collection]
        def transaction_runner(operation: Callable[[Any], None]) -> None:
            with client.start_session() as session:
                session.with_transaction(lambda active_session: operation(active_session))

        if args.rollback_from:
            report = run_rollback(leaf_collection, args.rollback_from, UpdateOne, transaction_runner)
        elif args.stage:
            api_key = os.getenv("GEMINI_API_KEY", "").strip()
            if not api_key:
                raise RebuildError("GEMINI_API_KEY is required for --stage.")
            snapshot = _read_scope(database["courses"], database["videos"], leaf_collection)
            report = {
                "mode": "stage",
                "scope": {"courseId": snapshot.course_id, "allowedVideoCount": len(snapshot.allowed_video_ids), "leafCount": len(snapshot.leaves)},
                "embeddingContract": {**CONTRACT_METADATA},
                "stage": stage_embeddings(snapshot, args.artifact_file, lambda text: embed_document_with_gemini(text, api_key)),
            }
        else:
            artifact = _load_staging_artifact(args.artifact_file) if args.execute else None
            if args.execute and artifact is None:
                raise RebuildError("The required staging artifact cannot be found.")
            report = run_rebuild(
                database["courses"], database["videos"], leaf_collection,
                execute=args.execute, staging_artifact=artifact, backup_path=args.backup_file,
                update_one=UpdateOne, transaction_runner=transaction_runner if args.execute else None,
            )
    finally:
        client.close()
    print(json.dumps(report, ensure_ascii=False, indent=2, default=_json_default))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
