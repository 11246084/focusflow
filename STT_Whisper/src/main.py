"""Entry point for the FocusFlow MVP AI pipeline."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from chunking import build_chunks
from config import PipelineConfig
from embedding import embed_chunks
from export_outputs import export_all_outputs
from extract_audio import extract_audio_for_videos
from normalize_transcript import normalize_transcripts
from scan_videos import scan_videos
from transcribe import transcribe_videos
from utils import configure_logging


logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments for the local MVP pipeline."""
    parser = argparse.ArgumentParser(description="Run the FocusFlow education video AI pipeline.")
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Project root directory. Defaults to the current repository root.",
    )
    parser.add_argument(
        "--video-dir",
        type=Path,
        default=None,
        help="Optional override for the video input directory.",
    )
    parser.add_argument(
        "--whisper-model",
        default=None,
        help="Optional faster-whisper model size or local path override.",
    )
    parser.add_argument(
        "--embedding-model",
        default=None,
        help="Optional sentence-transformers model override.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Rebuild cached audio/transcripts instead of reusing existing intermediate files.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only process the first N discovered videos for faster testing.",
    )
    return parser.parse_args()


def build_runtime_config(args: argparse.Namespace) -> PipelineConfig:
    """Merge environment config with CLI overrides."""
    # Load .env first, then let CLI flags override selected settings.
    config = PipelineConfig.from_env(project_root=args.project_root)
    overrides: dict[str, object] = {}

    if args.video_dir is not None:
        video_dir = args.video_dir
        if not video_dir.is_absolute():
            video_dir = args.project_root / video_dir
        overrides["video_input_dir"] = video_dir.resolve()
    if args.whisper_model is not None:
        overrides["whisper_model_size"] = args.whisper_model
    if args.embedding_model is not None:
        overrides["embedding_model_name"] = args.embedding_model
    if args.overwrite:
        overrides["overwrite_existing"] = True

    return config.with_overrides(**overrides) if overrides else config


def run_pipeline(config: PipelineConfig, limit: int | None = None) -> dict[str, Path]:
    """Execute the full local pipeline from video scan to export."""
    logger.info("Starting FocusFlow AI pipeline")

    # Step 1: scan videos and build normalized metadata.
    videos = scan_videos(config)

    if limit is not None:
        videos = videos[:limit]
        logger.info("Processing only the first %s videos because --limit was provided", len(videos))

    if not videos:
        raise FileNotFoundError(
            f"No supported video files were found in {config.video_input_dir}. "
            "Place .mp4/.mov/.mkv files there and rerun the pipeline."
        )

    # Step 2: extract Whisper-ready audio.
    extract_audio_for_videos(videos, config)
    # Step 3: run faster-whisper STT.
    transcripts = transcribe_videos(videos, config)
    # Step 4: normalize technical terms before search chunking.
    normalized_transcripts = normalize_transcripts(transcripts, config)
    # Step 5: merge normalized transcript segments into search chunks.
    chunks = build_chunks(videos, normalized_transcripts, config)
    # Step 6: generate multilingual embeddings.
    embeddings = embed_chunks(chunks, config)
    # Step 7: export JSON and JSONL files for downstream teams.
    output_paths = export_all_outputs(videos, transcripts, normalized_transcripts, chunks, embeddings, config)

    logger.info(
        "Pipeline completed: videos=%s transcripts=%s chunks=%s embeddings=%s",
        len(videos),
        len(transcripts),
        len(chunks),
        len(embeddings),
    )
    return output_paths


def main() -> int:
    """CLI wrapper that returns a process exit code."""
    args = parse_args()
    config = build_runtime_config(args)
    configure_logging(config.log_level)

    try:
        output_paths = run_pipeline(config, limit=args.limit)
    except Exception as exc:
        logger.exception("Pipeline failed: %s", exc)
        return 1

    print("FocusFlow AI pipeline completed successfully.")
    for name, path in output_paths.items():
        print(f"{name}: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
