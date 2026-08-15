"""Build and verify a deterministic Parent chunk artifact from Leaf JSONL.

This command is intentionally offline-only. It does not import Gemini or
MongoDB clients and requires an explicit video scope so restored or historical
Leaf artifacts cannot be mixed accidentally.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

from hierarchy_chunking import (
    build_parent_chunks,
    validate_parent_artifact,
    write_parent_chunks,
)
from hierarchy_strategy import (
    HIERARCHY_SCHEMA_VERSION,
    HIERARCHY_STRATEGY,
    HIERARCHY_TEXT_JOINER_VERSION,
    build_hierarchy_config_fingerprint,
    validate_hierarchy_settings,
)
from utils import ChunkRecord, load_jsonl_file


EVIDENCE_SCHEMA_VERSION = "parent_chunk_build_evidence_v1"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _artifact_metadata(path: Path) -> dict[str, Any]:
    resolved = path.resolve()
    return {
        "path": str(resolved),
        "sizeBytes": resolved.stat().st_size,
        "sha256": _sha256(resolved),
    }


def load_leaf_chunks(path: Path, expected_video_id: str) -> list[ChunkRecord]:
    rows = load_jsonl_file(path)
    if not rows:
        raise ValueError("Leaf artifact must contain at least one record.")

    leaves: list[ChunkRecord] = []
    seen_chunk_ids: set[str] = set()
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            raise ValueError(f"Leaf record {index} must be a JSON object.")
        try:
            leaf = ChunkRecord(
                chunk_id=row["chunk_id"],
                video_id=row["video_id"],
                start_sec=float(row["start_sec"]),
                end_sec=float(row["end_sec"]),
                text=row["text"],
                course_name=row.get("course_name"),
                week=row.get("week"),
                lesson=row.get("lesson"),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"Leaf record {index} does not match the ChunkRecord contract.") from exc
        if leaf.chunk_id in seen_chunk_ids:
            raise ValueError(f"Duplicate Leaf chunk_id: {leaf.chunk_id}")
        seen_chunk_ids.add(leaf.chunk_id)
        leaves.append(leaf)

    video_ids = {leaf.video_id for leaf in leaves}
    if video_ids != {expected_video_id}:
        raise ValueError(
            "Leaf artifact video scope mismatch: "
            f"expected {expected_video_id!r}, found {sorted(video_ids)!r}."
        )
    return leaves


def build_evidence(
    *,
    leaf_path: Path,
    parent_path: Path,
    expected_video_id: str,
    leaf_count: int,
    parent_count: int,
    parent_leaf_count: int,
    parent_overlap_leaves: int,
) -> dict[str, Any]:
    leaf_artifact = _artifact_metadata(leaf_path)
    hierarchy_config = {
        "strategy": HIERARCHY_STRATEGY,
        "enabled": True,
        "parent_leaf_count": parent_leaf_count,
        "parent_overlap_leaves": parent_overlap_leaves,
        "schema_version": HIERARCHY_SCHEMA_VERSION,
        "text_joiner_version": HIERARCHY_TEXT_JOINER_VERSION,
    }
    return {
        "schemaVersion": EVIDENCE_SCHEMA_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "validated",
        "scope": {"expectedVideoId": expected_video_id},
        "sourceLeafArtifact": leaf_artifact,
        "parentArtifact": _artifact_metadata(parent_path),
        "hierarchyConfig": hierarchy_config,
        "hierarchyConfigFingerprint": build_hierarchy_config_fingerprint(
            hierarchy_config,
            str(leaf_artifact["sha256"]),
        ),
        "counts": {"leaf": leaf_count, "parent": parent_count},
    }


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build and validate Parent chunks from an existing Leaf JSONL artifact.",
    )
    parser.add_argument("--leaf-artifact", type=Path, required=True)
    parser.add_argument("--parent-artifact", type=Path, required=True)
    parser.add_argument("--expected-video-id", required=True)
    parser.add_argument("--report", type=Path, default=None)
    parser.add_argument("--parent-leaf-count", type=int, default=3)
    parser.add_argument("--parent-overlap-leaves", type=int, default=0)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    validate_hierarchy_settings(
        True,
        args.parent_leaf_count,
        args.parent_overlap_leaves,
    )
    leaf_path = args.leaf_artifact.resolve()
    parent_path = args.parent_artifact.resolve()
    if not leaf_path.is_file():
        raise FileNotFoundError(f"Leaf artifact is missing: {leaf_path}")
    if leaf_path == parent_path:
        raise ValueError("Leaf and Parent artifact paths must be different.")

    leaves = load_leaf_chunks(leaf_path, args.expected_video_id)
    parents = build_parent_chunks(
        leaves,
        args.parent_leaf_count,
        args.parent_overlap_leaves,
    )
    if not parents:
        raise ValueError("Parent generation produced no records.")
    write_parent_chunks(parent_path, parents)
    validated = validate_parent_artifact(parent_path, leaves)
    evidence = build_evidence(
        leaf_path=leaf_path,
        parent_path=parent_path,
        expected_video_id=args.expected_video_id,
        leaf_count=len(leaves),
        parent_count=len(validated),
        parent_leaf_count=args.parent_leaf_count,
        parent_overlap_leaves=args.parent_overlap_leaves,
    )
    if args.report is not None:
        report_path = args.report.resolve()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(evidence, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
