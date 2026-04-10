"""Validate Gemini embedding outputs for text chunks or audio tracks."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from config import PipelineConfig


TEXT_REQUIRED_FIELDS = (
    "chunk_id",
    "video_id",
    "start_sec",
    "end_sec",
    "text",
    "embedding",
    "embedding_model",
    "embedding_modality",
    "embedding_dim",
    "embedding_timestamp",
    "embedding_status",
)

AUDIO_REQUIRED_FIELDS = (
    "video_id",
    "audio_path",
    "embedding",
    "embedding_model",
    "embedding_modality",
    "embedding_dim",
    "embedding_timestamp",
    "embedding_status",
)


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments for the Gemini validation helper."""
    parser = argparse.ArgumentParser(description="Validate Gemini embedding metadata and vectors.")
    parser.add_argument(
        "--file",
        type=Path,
        default=None,
        help="Path to a Gemini embedding JSONL file. Defaults to text embeddings.",
    )
    parser.add_argument(
        "--modality",
        choices=("text", "audio"),
        default="text",
        help="Validate text chunk embeddings or audio track embeddings.",
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Project root directory.",
    )
    parser.add_argument(
        "--expected-model",
        default=None,
        help="Optional expected Gemini model name override.",
    )
    parser.add_argument(
        "--expected-dim",
        type=int,
        default=None,
        help="Optional expected Gemini embedding dimension override.",
    )
    return parser.parse_args()


def load_records(file_path: Path) -> list[dict]:
    """Load embedding records from JSONL."""
    return [
        json.loads(line)
        for line in file_path.read_text(encoding="utf-8-sig").splitlines()
        if line.strip()
    ]


def main() -> int:
    """Run a lightweight validation over Gemini embedding records."""
    args = parse_args()
    project_root = args.project_root.resolve()
    config = PipelineConfig.from_env(project_root=project_root)
    expected_model = args.expected_model or config.gemini_embedding_model_name
    expected_dim = args.expected_dim or config.gemini_embedding_output_dim

    default_file = (
        config.text_embeddings_output_path
        if args.modality == "text"
        else config.audio_embeddings_output_path
    )
    file_path = args.file or default_file
    if not file_path.is_absolute():
        file_path = (project_root / file_path).resolve()

    if not file_path.exists():
        raise FileNotFoundError(f"Gemini embedding file was not found: {file_path}")

    required_fields = TEXT_REQUIRED_FIELDS if args.modality == "text" else AUDIO_REQUIRED_FIELDS
    records = load_records(file_path)
    missing_fields: set[str] = set()
    invalid_records: list[str] = []
    models: list[str] = []
    modalities: list[str] = []
    dims: list[int] = []
    status_counts: Counter[str] = Counter()

    for record in records:
        for field_name in required_fields:
            if field_name not in record:
                missing_fields.add(field_name)

        record_id = str(record.get("chunk_id") or record.get("video_id") or "")
        video_id = str(record.get("video_id", ""))
        embedding_model = str(record.get("embedding_model", ""))
        embedding_modality = str(record.get("embedding_modality", ""))
        embedding_dim = int(record.get("embedding_dim", 0) or 0)
        embedding_status = str(record.get("embedding_status", ""))
        vector = record.get("embedding", [])

        models.append(embedding_model)
        modalities.append(embedding_modality)
        dims.append(embedding_dim)
        status_counts[embedding_status] += 1

        if not isinstance(vector, list):
            invalid_records.append(f"{record_id}: embedding is not a list")
        elif vector and len(vector) != embedding_dim:
            invalid_records.append(f"{record_id}: embedding_dim={embedding_dim} but vector_len={len(vector)}")
        elif embedding_status in {"success", "reused_checkpoint"} and not vector:
            invalid_records.append(f"{record_id}: successful record has empty embedding")

        if embedding_model != expected_model:
            invalid_records.append(f"{record_id}: unexpected embedding_model={embedding_model}")
        if embedding_dim != expected_dim:
            invalid_records.append(f"{record_id}: unexpected embedding_dim={embedding_dim}")
        if embedding_modality != args.modality:
            invalid_records.append(f"{record_id}: unexpected embedding_modality={embedding_modality}")
        if args.modality == "text" and (not record_id or not record_id.startswith(f"{video_id}_chunk_")):
            invalid_records.append(f"{record_id}: chunk_id does not match video_id={video_id}")
        if args.modality == "audio" and not str(record.get("audio_path", "")).endswith(".wav"):
            invalid_records.append(f"{record_id}: audio_path does not point to a wav file")

    modality_counter = Counter(modalities)
    unique_models = sorted(set(models))
    unique_dims = sorted(set(dims))
    success_count = status_counts["success"] + status_counts["reused_checkpoint"]
    failed_count = len(records) - success_count

    print(f"Gemini records: {len(records)}")
    print(f"Model used: {', '.join(unique_models) if unique_models else 'none'}")
    print(f"Status counts: {dict(status_counts)}")
    if args.modality == "text" and set(modality_counter) == {"text"}:
        print("Modalities: text")
        print("This output uses Gemini, but is TEXT-ONLY. It is NOT multimodal embedding.")
        print("Embedding type: Gemini text embedding")
    else:
        print(f"Modalities: {dict(modality_counter)}")

    dimension_ok = unique_dims == [expected_dim]
    print(f"Dimension check: {'PASS' if dimension_ok else 'FAIL'}")
    print(f"Missing fields: {', '.join(sorted(missing_fields)) if missing_fields else 'none'}")
    print(f"Successful Gemini records: {success_count}")
    print(f"Unsuccessful Gemini records: {failed_count}")

    if invalid_records:
        print("Validation issues:")
        for issue in invalid_records[:20]:
            print(f"- {issue}")

    is_valid = not missing_fields and not invalid_records
    if is_valid and failed_count:
        print("Final result: VALID_WITH_PARTIAL_FAILURES")
        return 0
    print(f"Final result: {'VALID' if is_valid else 'INVALID'}")
    return 0 if is_valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
