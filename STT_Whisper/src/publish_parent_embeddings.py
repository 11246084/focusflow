"""Explicit two-phase CLI for validating or publishing Parent embeddings.

The default mode is offline-only. MongoDB is imported and contacted only when
``--write`` and the matching confirmation phrase are both supplied.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

from embedding_contract import (
    GEMINI_EMBEDDING_CONTRACT_VERSION,
    GEMINI_EMBEDDING_GENERATION_VERSION,
    GEMINI_EMBEDDING_INSTRUCTION_VERSION,
    GEMINI_EMBEDDING_MODEL,
    GEMINI_EMBEDDING_NORMALIZATION_VERSION,
)
from parent_mongodb_uploader import (
    PARENT_COLLECTION_DEFAULT,
    preflight_parent_publication,
    upload_parent_embeddings,
)


INACTIVE_CONFIRMATION = "PUBLISH_INACTIVE_PARENT_V2"
ACTIVE_CONFIRMATION = "PUBLISH_ACTIVE_PARENT_V2"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def build_evidence(
    *,
    artifact_path: Path,
    course_id: str,
    expected_video_id: str,
    database_name: str,
    collection_name: str,
    mode: str,
    is_active: bool,
    summary: dict[str, Any],
) -> dict[str, Any]:
    resolved = artifact_path.resolve()
    artifact = {
        "path": str(resolved),
        "exists": resolved.is_file(),
        "sizeBytes": resolved.stat().st_size if resolved.is_file() else 0,
        "sha256": _sha256(resolved) if resolved.is_file() else None,
    }
    return {
        "schemaVersion": "parent_publication_evidence_v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "artifact": artifact,
        "scope": {
            "courseId": course_id,
            "expectedVideoId": expected_video_id,
            "database": database_name,
            "collection": collection_name,
            "isActive": is_active,
        },
        "embeddingContract": {
            "provider": "gemini",
            "model": GEMINI_EMBEDDING_MODEL,
            "dimension": 3072,
            "instructionVersion": GEMINI_EMBEDDING_INSTRUCTION_VERSION,
            "generationVersion": GEMINI_EMBEDDING_GENERATION_VERSION,
            "normalizationVersion": GEMINI_EMBEDDING_NORMALIZATION_VERSION,
            "contractVersion": GEMINI_EMBEDDING_CONTRACT_VERSION,
            "taskType": None,
        },
        "result": summary,
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate Parent embedding artifacts offline; publish only with explicit confirmation.",
    )
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--course-id", required=True)
    parser.add_argument("--expected-video-id", required=True)
    parser.add_argument("--report", type=Path, default=None)
    parser.add_argument("--database", default="focusflow")
    parser.add_argument("--collection", default=PARENT_COLLECTION_DEFAULT)
    parser.add_argument("--mongo-uri-env", default="MONGODB_URI")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--activate", action="store_true")
    parser.add_argument("--confirm-write", default="")
    args = parser.parse_args(argv)
    if args.activate and not args.write:
        parser.error("--activate requires --write")
    if args.write:
        expected = ACTIVE_CONFIRMATION if args.activate else INACTIVE_CONFIRMATION
        if args.confirm_write != expected:
            parser.error(f"--confirm-write must equal {expected}")
    return args


def _write_evidence(path: Path | None, evidence: dict[str, Any]) -> None:
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    artifact_path = args.artifact.resolve()
    is_active = bool(args.activate)

    if args.write:
        mongo_uri = os.getenv(args.mongo_uri_env, "").strip()
        if not mongo_uri:
            raise RuntimeError(f"{args.mongo_uri_env} is required for --write.")
        from pymongo import MongoClient

        client = MongoClient(mongo_uri)
        try:
            collection = client[args.database][args.collection]
            summary = upload_parent_embeddings(
                artifact_path,
                collection,
                course_id=args.course_id,
                expected_video_id=args.expected_video_id,
                generation_version=GEMINI_EMBEDDING_GENERATION_VERSION,
                is_active=is_active,
            )
        finally:
            client.close()
        mode = "publish_active" if is_active else "publish_inactive"
    else:
        _, summary = preflight_parent_publication(
            artifact_path,
            course_id=args.course_id,
            expected_video_id=args.expected_video_id,
            generation_version=GEMINI_EMBEDDING_GENERATION_VERSION,
            is_active=False,
        )
        mode = "preflight"

    evidence = build_evidence(
        artifact_path=artifact_path,
        course_id=args.course_id,
        expected_video_id=args.expected_video_id,
        database_name=args.database,
        collection_name=args.collection,
        mode=mode,
        is_active=is_active,
        summary=summary.to_dict(),
    )
    _write_evidence(args.report, evidence)
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    return 0 if summary.status == "validated" or summary.success else 1


if __name__ == "__main__":
    raise SystemExit(main())
