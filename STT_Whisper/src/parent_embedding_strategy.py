"""Stable configuration and fingerprint contract for Parent Embedding."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from config import PipelineConfig


PARENT_EMBEDDING_PROVIDER = "gemini"
PARENT_EMBEDDING_TASK_TYPE = "RETRIEVAL_DOCUMENT"
PARENT_EMBEDDING_SCHEMA_VERSION = "parent_embedding_v1"
PARENT_EMBEDDING_PREPROCESSING_VERSION = "parent_text_passthrough_v1"
PARENT_EMBEDDING_NORMALIZATION_VERSION = "unit_l2_v1"


def build_parent_embedding_config_snapshot(config: PipelineConfig) -> dict[str, Any]:
    """Return only stable, non-secret settings that affect Parent vectors."""
    return {
        # getattr keeps legacy/fake config objects equivalent to the default-off gate.
        "enabled": bool(getattr(config, "parent_embedding_enabled", False)),
        "provider": PARENT_EMBEDDING_PROVIDER,
        "model": getattr(config, "gemini_embedding_model_name", "gemini-embedding-2-preview"),
        "dimension": int(getattr(config, "gemini_embedding_output_dim", 3072)),
        "task_type": PARENT_EMBEDDING_TASK_TYPE,
        "schema_version": PARENT_EMBEDDING_SCHEMA_VERSION,
        "preprocessing_version": PARENT_EMBEDDING_PREPROCESSING_VERSION,
        "normalization_version": PARENT_EMBEDDING_NORMALIZATION_VERSION,
    }


def build_parent_embedding_fingerprint(
    config_snapshot: dict[str, Any],
    hierarchy_fingerprint: str,
) -> str:
    """Hash Parent settings plus the exact Hierarchy dependency."""
    payload = {
        "hierarchy_fingerprint": hierarchy_fingerprint,
        "parent_embedding_config": config_snapshot,
    }
    canonical = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
