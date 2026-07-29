"""Deterministic hierarchy settings and fingerprints."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Any


HIERARCHY_STRATEGY = "fixed_leaf_grouping_v1"
HIERARCHY_SCHEMA_VERSION = 1
HIERARCHY_TEXT_JOINER_VERSION = "newline_v1"


def validate_hierarchy_settings(enabled: bool, parent_leaf_count: int, parent_overlap_leaves: int) -> None:
    if not isinstance(enabled, bool):
        raise ValueError("HIERARCHY_ENABLED must be a boolean.")
    if not isinstance(parent_leaf_count, int) or isinstance(parent_leaf_count, bool):
        raise ValueError("HIERARCHY_PARENT_LEAF_COUNT must be an integer between 2 and 8.")
    if not 2 <= parent_leaf_count <= 8:
        raise ValueError("HIERARCHY_PARENT_LEAF_COUNT must be an integer between 2 and 8.")
    if not isinstance(parent_overlap_leaves, int) or isinstance(parent_overlap_leaves, bool):
        raise ValueError("HIERARCHY_PARENT_OVERLAP_LEAVES must be an integer between 0 and 2.")
    if not 0 <= parent_overlap_leaves <= 2:
        raise ValueError("HIERARCHY_PARENT_OVERLAP_LEAVES must be an integer between 0 and 2.")
    if parent_overlap_leaves >= parent_leaf_count:
        raise ValueError(
            "HIERARCHY_PARENT_OVERLAP_LEAVES must be smaller than HIERARCHY_PARENT_LEAF_COUNT."
        )


def build_hierarchy_config_snapshot(config: Any) -> dict[str, bool | int | str]:
    snapshot: dict[str, bool | int | str] = {
        "strategy": HIERARCHY_STRATEGY,
        "enabled": bool(getattr(config, "hierarchy_enabled", False)),
        "parent_leaf_count": int(getattr(config, "hierarchy_parent_leaf_count", 3)),
        "parent_overlap_leaves": int(getattr(config, "hierarchy_parent_overlap_leaves", 0)),
        "schema_version": HIERARCHY_SCHEMA_VERSION,
        "text_joiner_version": HIERARCHY_TEXT_JOINER_VERSION,
    }
    validate_hierarchy_settings(
        bool(snapshot["enabled"]),
        int(snapshot["parent_leaf_count"]),
        int(snapshot["parent_overlap_leaves"]),
    )
    return snapshot


def _canonical_json(payload: Mapping[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def build_hierarchy_config_fingerprint(
    hierarchy_config: Mapping[str, Any],
    leaf_chunk_fingerprint: str,
) -> str:
    payload = {
        "hierarchy_config": dict(hierarchy_config),
        "leaf_chunk_fingerprint": leaf_chunk_fingerprint,
        "schema_version": HIERARCHY_SCHEMA_VERSION,
    }
    return hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()
