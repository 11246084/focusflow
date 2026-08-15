"""Explicit, scope-locked CLI for live Parent embedding generation.

The default mode validates every local dependency without loading a provider.
Live Gemini calls require both ``--execute`` and an exact confirmation phrase.
MongoDB is never imported or contacted by this command.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

from build_parent_chunk_artifact import EVIDENCE_SCHEMA_VERSION, load_leaf_chunks
from config import PipelineConfig
from hierarchy_chunking import validate_parent_artifact
from parent_embedding import ParentProvider, embed_parent_chunks
from parent_embedding_strategy import (
    build_parent_embedding_config_snapshot,
    build_parent_embedding_fingerprint,
)


LIVE_CONFIRMATION = "EMBED_PARENT_V2"
RUN_EVIDENCE_SCHEMA_VERSION = "parent_embedding_run_evidence_v1"


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


def _load_build_evidence(
    path: Path,
    *,
    leaf_path: Path,
    parent_path: Path,
    expected_video_id: str,
    expected_parent_count: int,
) -> dict[str, Any]:
    try:
        evidence = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError) as exc:
        raise ValueError(f"Parent build evidence is invalid: {path}") from exc
    checks = {
        "schemaVersion": evidence.get("schemaVersion") == EVIDENCE_SCHEMA_VERSION,
        "status": evidence.get("status") == "validated",
        "scope": evidence.get("scope", {}).get("expectedVideoId") == expected_video_id,
        "leafSha256": evidence.get("sourceLeafArtifact", {}).get("sha256") == _sha256(leaf_path),
        "parentSha256": evidence.get("parentArtifact", {}).get("sha256") == _sha256(parent_path),
        "parentCount": evidence.get("counts", {}).get("parent") == expected_parent_count,
        "hierarchyConfigFingerprint": bool(evidence.get("hierarchyConfigFingerprint")),
    }
    failed = [name for name, passed in checks.items() if not passed]
    if failed:
        raise ValueError(
            "Parent build evidence does not match the requested artifacts: "
            + ", ".join(failed)
        )
    return evidence


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Preflight Parent artifacts; call live Gemini only with explicit confirmation.",
    )
    parser.add_argument("--leaf-artifact", type=Path, required=True)
    parser.add_argument("--parent-artifact", type=Path, required=True)
    parser.add_argument("--build-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, default=None)
    parser.add_argument("--expected-video-id", required=True)
    parser.add_argument("--expected-parent-count", type=int, required=True)
    parser.add_argument("--max-retries", type=int, choices=range(0, 4), default=0)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-live", default="")
    args = parser.parse_args(argv)
    if args.expected_parent_count < 1:
        parser.error("--expected-parent-count must be at least 1")
    if args.execute and args.confirm_live != LIVE_CONFIRMATION:
        parser.error(f"--confirm-live must equal {LIVE_CONFIRMATION}")
    if not args.execute and args.confirm_live:
        parser.error("--confirm-live is accepted only with --execute")
    return args


def _write_report(path: Path | None, evidence: dict[str, Any]) -> None:
    if path is None:
        return
    resolved = path.resolve()
    resolved.parent.mkdir(parents=True, exist_ok=True)
    resolved.write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main(
    argv: Sequence[str] | None = None,
    *,
    provider: ParentProvider | None = None,
) -> int:
    args = parse_args(argv)
    leaf_path = args.leaf_artifact.resolve()
    parent_path = args.parent_artifact.resolve()
    build_report_path = args.build_report.resolve()
    output_path = args.output.resolve()
    for label, path in (
        ("Leaf artifact", leaf_path),
        ("Parent artifact", parent_path),
        ("Parent build evidence", build_report_path),
    ):
        if not path.is_file():
            raise FileNotFoundError(f"{label} is missing: {path}")
    if output_path in {leaf_path, parent_path, build_report_path}:
        raise ValueError("Embedding output must not overwrite an input artifact.")

    leaves = load_leaf_chunks(leaf_path, args.expected_video_id)
    parents = validate_parent_artifact(parent_path, leaves)
    if len(parents) != args.expected_parent_count:
        raise ValueError(
            "Parent count mismatch: "
            f"expected {args.expected_parent_count}, found {len(parents)}."
        )
    build_evidence = _load_build_evidence(
        build_report_path,
        leaf_path=leaf_path,
        parent_path=parent_path,
        expected_video_id=args.expected_video_id,
        expected_parent_count=args.expected_parent_count,
    )

    config = PipelineConfig.from_env().with_overrides(
        hierarchy_enabled=True,
        parent_embedding_enabled=True,
        parent_embeddings_output_path=output_path,
        gemini_max_retries=args.max_retries,
    )
    embedding_config = build_parent_embedding_config_snapshot(config)
    hierarchy_fingerprint = str(build_evidence["hierarchyConfigFingerprint"])
    source_leaf_fingerprint = str(build_evidence["sourceLeafArtifact"]["sha256"])
    parent_embedding_fingerprint = build_parent_embedding_fingerprint(
        embedding_config,
        hierarchy_fingerprint,
    )
    evidence: dict[str, Any] = {
        "schemaVersion": RUN_EVIDENCE_SCHEMA_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "live_embed" if args.execute else "preflight",
        "status": "validated" if not args.execute else "running",
        "scope": {
            "expectedVideoId": args.expected_video_id,
            "expectedParentCount": args.expected_parent_count,
        },
        "executionPolicy": {
            "maxRetriesPerParent": args.max_retries,
            "maximumProviderCalls": args.expected_parent_count * (args.max_retries + 1),
        },
        "sourceLeafArtifact": _artifact_metadata(leaf_path),
        "parentArtifact": _artifact_metadata(parent_path),
        "parentBuildEvidence": _artifact_metadata(build_report_path),
        "hierarchyConfigFingerprint": hierarchy_fingerprint,
        "parentEmbeddingConfig": embedding_config,
        "parentEmbeddingFingerprint": parent_embedding_fingerprint,
        "providerCallsMade": False,
    }

    if args.execute:
        if not config.gemini_api_key and provider is None:
            raise RuntimeError("GEMINI_API_KEY is required for --execute.")
        records = embed_parent_chunks(
            parents,
            config,
            hierarchy_fingerprint,
            source_leaf_fingerprint,
            parent_embedding_fingerprint,
            provider=provider,
        )
        evidence.update(
            {
                "status": "completed",
                "providerCallsMade": True,
                "embeddingArtifact": _artifact_metadata(output_path),
                "counts": {
                    "required": len(parents),
                    "completed": len(records),
                },
            }
        )

    _write_report(args.report, evidence)
    print(json.dumps(evidence, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
