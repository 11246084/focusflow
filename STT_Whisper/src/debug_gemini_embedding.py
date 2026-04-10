"""Debug helper for one Gemini text embedding request."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from config import PipelineConfig
from embedding import embed_single_text_gemini


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments for the Gemini debug helper."""
    parser = argparse.ArgumentParser(description="Embed one chunk text with Gemini for debugging.")
    parser.add_argument("--text", default=None, help="Raw text to embed directly.")
    parser.add_argument("--chunk-id", default=None, help="Existing chunk_id to load from chunks.jsonl.")
    parser.add_argument(
        "--chunks-file",
        type=Path,
        default=Path("data/outputs/chunks.jsonl"),
        help="Path to the exported chunks.jsonl file.",
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Project root directory.",
    )
    return parser.parse_args()


def find_chunk_text(chunks_file: Path, chunk_id: str) -> str:
    """Locate one chunk by id and return its text payload."""
    for line in chunks_file.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        if record.get("chunk_id") == chunk_id:
            return str(record["text"])
    raise FileNotFoundError(f"Could not find chunk_id={chunk_id} in {chunks_file}")


def main() -> int:
    """Run one Gemini embedding call and print lightweight debug information."""
    args = parse_args()
    if not args.text and not args.chunk_id:
        raise ValueError("Provide either --text or --chunk-id.")

    project_root = args.project_root.resolve()
    config = PipelineConfig.from_env(project_root=project_root)

    chunks_file = args.chunks_file
    if not chunks_file.is_absolute():
        chunks_file = (project_root / chunks_file).resolve()

    chunk_id = args.chunk_id or "debug_chunk"
    text = args.text if args.text is not None else find_chunk_text(chunks_file, chunk_id)
    vector, metadata = embed_single_text_gemini(text, config, record_id=chunk_id)

    preview_values = ", ".join(f"{value:.6f}" for value in vector[:8])
    print(f"chunk_id: {chunk_id}")
    print(f"model: {metadata.embedding_model}")
    print(f"modality: {metadata.embedding_modality}")
    print("embedding type: Gemini text embedding")
    print(f"vector_length: {len(vector)}")
    print(f"vector_preview: [{preview_values}]")
    print(f"status: {metadata.embedding_status}")
    print(f"error: {metadata.embedding_error}")
    print(f"timestamp: {metadata.embedding_timestamp}")
    print(f"success: {bool(vector) and metadata.embedding_status in {'success', 'reused_checkpoint'}}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
