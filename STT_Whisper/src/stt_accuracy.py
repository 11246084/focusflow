"""Deterministic STT config fingerprints, diagnostics, and offline metrics."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Sequence

from config import PipelineConfig
from utils import TranscriptDocument, load_json_file

STT_SCHEMA_VERSION = "stt_accuracy_v1"
NORMALIZATION_VERSION = "safe_terminology_v1"
AUDIO_PREPROCESSING_VERSION = "pcm_s16le_mono_16khz_v1"


def _sha(payload: Any) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def load_terminology_payload(path: Path) -> Any:
    if not path.exists():
        raise FileNotFoundError(f"STT terminology dictionary was not found: {path}")
    return load_json_file(path)


def terminology_fingerprint(path: Path) -> str:
    return _sha(load_terminology_payload(path))


def build_stt_config_snapshot(config: PipelineConfig) -> dict[str, Any]:
    return {
        "provider": "faster-whisper",
        "model": getattr(config, "whisper_model_size", "small"),
        "device": getattr(config, "whisper_device", "cpu"),
        "compute_type": getattr(config, "whisper_compute_type", "int8"),
        "language": getattr(config, "whisper_language", None),
        "task": getattr(config, "stt_task", "transcribe"),
        "beam_size": int(getattr(config, "whisper_beam_size", 5)),
        "vad_filter": bool(getattr(config, "whisper_vad_filter", True)),
        "condition_on_previous_text": bool(getattr(config, "stt_condition_on_previous_text", True)),
        "initial_prompt_fingerprint": _sha(getattr(config, "stt_initial_prompt", "")),
        "audio_preprocessing_version": AUDIO_PREPROCESSING_VERSION,
        "schema_version": STT_SCHEMA_VERSION,
    }


def build_normalize_config_snapshot(config: PipelineConfig) -> dict[str, Any]:
    return {
        "enabled": bool(getattr(config, "stt_terminology_enabled", False)),
        "dictionary_fingerprint": (
            terminology_fingerprint(config.stt_terminology_path)
            if getattr(config, "stt_terminology_enabled", False)
            else None
        ),
        "correction_audit_enabled": bool(getattr(config, "stt_correction_audit_enabled", True)),
        "normalization_version": NORMALIZATION_VERSION,
    }


def build_config_fingerprint(snapshot: dict[str, Any]) -> str:
    return _sha(snapshot)


def levenshtein(reference: Sequence[Any], hypothesis: Sequence[Any]) -> int:
    previous = list(range(len(hypothesis) + 1))
    for row, expected in enumerate(reference, start=1):
        current = [row]
        for column, actual in enumerate(hypothesis, start=1):
            current.append(min(current[-1] + 1, previous[column] + 1, previous[column - 1] + (expected != actual)))
        previous = current
    return previous[-1]


def character_error_rate(reference: str, hypothesis: str) -> float:
    return levenshtein(list(reference), list(hypothesis)) / max(len(reference), 1)


def word_error_rate(reference: str, hypothesis: str) -> float:
    expected, actual = reference.split(), hypothesis.split()
    return levenshtein(expected, actual) / max(len(expected), 1)


def term_accuracy(expected_terms: list[str], hypothesis: str) -> float:
    if not expected_terms:
        return 1.0
    lowered = hypothesis.casefold()
    return sum(term.casefold() in lowered for term in expected_terms) / len(expected_terms)


def false_replacement_count(reference: str, raw: str, normalized: str) -> int:
    """Count a correction as false when raw was already correct but normalization changed it."""
    return int(raw == reference and normalized != reference)


def transcript_diagnostics(documents: list[TranscriptDocument]) -> dict[str, Any]:
    segments = [segment for document in documents for segment in document.segments]
    empty = sum(not segment.text.strip() for segment in segments)
    changed = sum(bool(segment.corrections) for segment in segments)
    non_monotonic = 0
    oversized = 0
    durations: list[float] = []
    for document in documents:
        previous_start = -1.0
        for segment in document.segments:
            duration = segment.end_sec - segment.start_sec
            durations.append(duration)
            oversized += duration > 60
            non_monotonic += segment.start_sec < previous_start or segment.end_sec < segment.start_sec
            previous_start = segment.start_sec
    return {
        "segment_count": len(segments),
        "empty_segment_count": empty,
        "normalization_changed_count": changed,
        "correction_count": sum(len(segment.corrections) for segment in segments),
        "average_segment_duration_sec": round(sum(durations) / len(durations), 3) if durations else 0.0,
        "oversized_segment_count": oversized,
        "non_monotonic_timestamp_count": non_monotonic,
    }
