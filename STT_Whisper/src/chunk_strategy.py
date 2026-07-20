"""Chunk strategy configuration snapshots and deterministic fingerprints."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Mapping


CHUNK_STRATEGY_NAME = "adaptive_segment_overlap_v1"
ALLOWED_CHUNK_OVERLAP_SEGMENTS = (0, 1, 2)
LEGACY_CHUNK_CONFIG = {
    "strategy": CHUNK_STRATEGY_NAME,
    "max_chars": 220,
    "max_duration_sec": 45.0,
    "max_segments": 6,
    "overlap_segments": 0,
}


def validate_chunk_settings(max_segments: int, overlap_segments: int) -> None:
    """Reject unsupported overlap values before pipeline execution starts."""
    if overlap_segments not in ALLOWED_CHUNK_OVERLAP_SEGMENTS:
        raise ValueError("CHUNK_OVERLAP_SEGMENTS must be one of: 0, 1, 2.")
    if overlap_segments >= max_segments:
        raise ValueError("CHUNK_OVERLAP_SEGMENTS must be smaller than CHUNK_MAX_SEGMENTS.")


def build_chunk_config_snapshot(config: Any) -> dict[str, int | float | str]:
    """Return the stable, non-sensitive settings that define Chunk output."""
    snapshot = {
        "strategy": CHUNK_STRATEGY_NAME,
        "max_chars": int(config.chunk_max_chars),
        "max_duration_sec": float(config.chunk_max_duration_sec),
        "max_segments": int(config.chunk_max_segments),
        "overlap_segments": int(config.chunk_overlap_segments),
    }
    validate_chunk_settings(
        max_segments=int(snapshot["max_segments"]),
        overlap_segments=int(snapshot["overlap_segments"]),
    )
    return snapshot


def build_chunk_config_fingerprint(snapshot: Mapping[str, Any]) -> str:
    """Hash canonical JSON so key insertion order cannot change the result."""
    canonical_json = json.dumps(
        dict(snapshot),
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def is_legacy_compatible_chunk_config(snapshot: Mapping[str, Any]) -> bool:
    """Return whether a runtime config exactly matches pre-fingerprint defaults."""
    try:
        normalized = {
            "strategy": str(snapshot["strategy"]),
            "max_chars": int(snapshot["max_chars"]),
            "max_duration_sec": float(snapshot["max_duration_sec"]),
            "max_segments": int(snapshot["max_segments"]),
            "overlap_segments": int(snapshot["overlap_segments"]),
        }
    except (KeyError, TypeError, ValueError):
        return False
    return normalized == LEGACY_CHUNK_CONFIG
