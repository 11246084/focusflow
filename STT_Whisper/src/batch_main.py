"""CLI for durable batch orchestration of existing single-video runs."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from batch_manager import BatchManager, SubprocessPipelineRunner, create_batch
from config import PipelineConfig
from scan_videos import iter_input_files


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a bounded FocusFlow video batch.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--batch-input", type=Path, help="Directory scanned with existing video discovery.")
    mode.add_argument("--batch-resume", help="Existing batch_id to resume.")
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = PipelineConfig.from_env(args.project_root)
    batches_root = config.output_dir / "batches"
    if args.batch_resume:
        manager = BatchManager.load(batches_root / args.batch_resume)
    else:
        input_dir = args.batch_input.resolve()
        if not input_dir.exists() or not input_dir.is_dir():
            print(f"Batch input directory does not exist: {input_dir}", file=sys.stderr)
            return 2
        paths = iter_input_files(input_dir)
        manager = create_batch(
            paths,
            config.output_dir,
            input_source=str(input_dir),
            max_concurrency=config.batch_max_concurrency,
            max_retries=config.batch_item_max_retries,
            supported_extensions=config.supported_video_extensions,
        )
    manager.run(SubprocessPipelineRunner(config.project_root))
    print(f"batch_id: {manager.job.batch_id}")
    print(f"batch_manifest: {manager.manifest_path}")
    print(f"batch_summary: {manager.summary_path}")
    return 0 if manager.job.status == "completed" else 1


if __name__ == "__main__":
    sys.exit(main())
