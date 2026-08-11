"""Stable configuration and fingerprint contract for Parent Embedding."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from config import PipelineConfig
from embedding_contract import (
    GEMINI_EMBEDDING_CONTRACT_VERSION,
    GEMINI_EMBEDDING_GENERATION_VERSION,
    GEMINI_EMBEDDING_INSTRUCTION_VERSION,
    GEMINI_EMBEDDING_NORMALIZATION_VERSION,
    GEMINI_EMBEDDING_TASK_TYPE,
    PARENT_DOCUMENT_INSTRUCTION_TEMPLATE,
    PARENT_DOCUMENT_ROLE,
)


PARENT_EMBEDDING_PROVIDER = "gemini"
PARENT_EMBEDDING_TASK_TYPE = GEMINI_EMBEDDING_TASK_TYPE
PARENT_EMBEDDING_SCHEMA_VERSION = "parent_embedding_v2"
PARENT_EMBEDDING_PREPROCESSING_VERSION = "parent_text_passthrough_v1"
PARENT_EMBEDDING_NORMALIZATION_VERSION = GEMINI_EMBEDDING_NORMALIZATION_VERSION
PARENT_EMBEDDING_INSTRUCTION = PARENT_DOCUMENT_INSTRUCTION_TEMPLATE
PARENT_EMBEDDING_INSTRUCTION_VERSION = GEMINI_EMBEDDING_INSTRUCTION_VERSION
PARENT_EMBEDDING_GENERATION_VERSION = GEMINI_EMBEDDING_GENERATION_VERSION
PARENT_EMBEDDING_CONTRACT_VERSION = GEMINI_EMBEDDING_CONTRACT_VERSION
PARENT_EMBEDDING_ROLE = PARENT_DOCUMENT_ROLE


def build_parent_embedding_config_snapshot(config: PipelineConfig) -> dict[str, Any]:
    """Return only stable, non-secret settings that affect Parent vectors."""
    return {
        # getattr keeps legacy/fake config objects equivalent to the default-off gate.
        "enabled": bool(getattr(config, "parent_embedding_enabled", False)),
        "provider": PARENT_EMBEDDING_PROVIDER,
        "model": getattr(config, "gemini_embedding_model_name", "gemini-embedding-2"),
        "dimension": int(getattr(config, "gemini_embedding_output_dim", 3072)),
        "task_type": PARENT_EMBEDDING_TASK_TYPE,
        "instruction": PARENT_EMBEDDING_INSTRUCTION,
        "instruction_version": PARENT_EMBEDDING_INSTRUCTION_VERSION,
        "generation_version": PARENT_EMBEDDING_GENERATION_VERSION,
        "contract_version": PARENT_EMBEDDING_CONTRACT_VERSION,
        "role": PARENT_EMBEDDING_ROLE,
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
