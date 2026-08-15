"""CLI for durable batch orchestration of existing single-video runs."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from batch_manager import (
    BatchAlreadyRunningError,
    BatchExecutionLease,
    BatchManager,
    BatchValidationError,
    SubprocessPipelineRunner,
    create_batch,
    create_batch_from_request,
)
from config import PipelineConfig
from scan_videos import iter_input_files


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a bounded FocusFlow video batch.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--batch-input", type=Path, help="Directory scanned with existing video discovery.")
    mode.add_argument("--batch-resume", help="Existing batch_id to resume.")
    mode.add_argument("--batch-request", type=Path, help="Backend-created JSON batch request.")
    parser.add_argument(
        "--batch-retry-video-id",
        action="append",
        default=[],
        help="With --batch-resume, grant one additional attempt to a failed Backend video id.",
    )
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    config = PipelineConfig.from_env(args.project_root)
    batches_root = config.output_dir / "batches"
    # Every entry mode acquires the same per-batch lease before it can mutate
    # manifests or checkpoints, so Backend recovery cannot race a CLI resume.
    lease = None
    if args.batch_resume:
        batch_dir = batches_root / args.batch_resume
        lease = BatchExecutionLease(batch_dir)
        try:
            lease.acquire()
        except BatchAlreadyRunningError as exc:
            print(str(exc), file=sys.stderr)
            return 75
        manager = BatchManager.load(batch_dir)
        try:
            for video_id in args.batch_retry_video_id:
                manager.request_manual_retry(video_id)
        except BatchValidationError as exc:
            lease.release()
            print(f"Invalid manual retry: {exc}", file=sys.stderr)
            return 2
    elif args.batch_request:
        # Backend requests are a versioned handoff contract. Validate identity
        # and item shape before creating any durable Pipeline batch state.
        if args.batch_retry_video_id:
            print("--batch-retry-video-id requires --batch-resume.", file=sys.stderr)
            return 2
        request_path = args.batch_request.resolve()
        try:
            payload = json.loads(request_path.read_text(encoding="utf-8"))
            if payload.get("version") != 1 or not isinstance(payload.get("items"), list):
                raise BatchValidationError("Unsupported or invalid batch request.")
            requested_batch_id = str(payload.get("batchId") or "")
            lease = BatchExecutionLease(batches_root / requested_batch_id)
            lease.acquire()
            manager = create_batch_from_request(
                payload["items"],
                config.output_dir,
                batch_id=requested_batch_id,
                input_source=str(request_path),
                max_concurrency=config.batch_max_concurrency,
                max_retries=config.batch_item_max_retries,
                supported_extensions=config.supported_video_extensions,
            )
        except BatchAlreadyRunningError as exc:
            print(str(exc), file=sys.stderr)
            return 75
        except (OSError, json.JSONDecodeError, BatchValidationError) as exc:
            if lease:
                lease.release()
            print(f"Invalid batch request: {exc}", file=sys.stderr)
            return 2
    else:
        if args.batch_retry_video_id:
            print("--batch-retry-video-id requires --batch-resume.", file=sys.stderr)
            return 2
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
        lease = BatchExecutionLease(manager.batch_dir)
        try:
            lease.acquire()
        except BatchAlreadyRunningError as exc:
            print(str(exc), file=sys.stderr)
            return 75
    try:
        manager.run(SubprocessPipelineRunner(config.project_root))
        print(f"batch_id: {manager.job.batch_id}")
        print(f"batch_manifest: {manager.manifest_path}")
        print(f"batch_summary: {manager.summary_path}")
        return 0 if manager.job.status == "completed" else 1
    finally:
        if lease:
            lease.release()


if __name__ == "__main__":
    sys.exit(main())
