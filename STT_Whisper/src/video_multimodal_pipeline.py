"""Minimal side-branch pipeline for video multimodal embedding MVP validation."""

from __future__ import annotations

import argparse
import logging
import math
import mimetypes
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path

from config import PipelineConfig
from scan_videos import scan_videos
from utils import (
    configure_logging,
    load_jsonl_file,
    resolve_ffmpeg_binary,
    to_relative_posix,
    utc_timestamp,
    write_jsonl_file,
)


logger = logging.getLogger(__name__)
VIDEO_MODALITY = "video"
STATUS_SUCCESS = "success"
STATUS_REUSED_CHECKPOINT = "reused_checkpoint"
STATUS_FAILED_AFTER_RETRIES = "failed_after_retries"
STATUS_FAILED = "failed"


@dataclass(slots=True)
class VideoClipRecord:
    """One short clip cut from the first source video for multimodal testing."""

    clip_id: str
    video_id: str
    clip_path: str
    start_sec: float
    end_sec: float
    duration_sec: float

    def to_dict(self) -> dict:
        """Convert the clip metadata to a JSON-safe dictionary."""
        return asdict(self)


@dataclass(slots=True)
class VideoEmbeddingRecord:
    """One multimodal Gemini embedding result for a short video clip."""

    clip_id: str
    video_id: str
    clip_path: str
    start_sec: float
    end_sec: float
    duration_sec: float
    embedding: list[float]
    embedding_model: str
    embedding_modality: str
    embedding_dim: int
    embedding_timestamp: str
    embedding_status: str
    embedding_error: str | None = None
    embedding_request_id: str | None = None

    def to_dict(self) -> dict:
        """Convert the embedding result to a JSON-safe dictionary."""
        payload = asdict(self)
        if self.embedding_error is None:
            payload.pop("embedding_error")
        if self.embedding_request_id is None:
            payload.pop("embedding_request_id")
        return payload


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments for the video multimodal branch."""
    parser = argparse.ArgumentParser(
        description="Split the first video into short clips and try Gemini multimodal video embeddings."
    )
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Project root directory.",
    )
    parser.add_argument(
        "--clip-duration",
        type=int,
        default=None,
        help="Optional override for VIDEO_CHUNK_DURATION_SEC.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Rebuild clip files even if they already exist.",
    )
    return parser.parse_args()


def _normalize_vector(values: list[float]) -> list[float]:
    """Normalize a vector to unit length for cosine-style comparisons."""
    norm = math.sqrt(sum(value * value for value in values))
    if norm == 0:
        return values
    return [value / norm for value in values]


def _guess_video_mime_type(video_path: Path) -> str:
    """Guess a MIME type for an MP4 or MOV file."""
    mime_type, _ = mimetypes.guess_type(video_path.name)
    return mime_type or "video/mp4"


def _is_rate_limit_error(exc: Exception) -> bool:
    """Detect quota or rate-limit errors from Gemini."""
    message = str(exc).upper()
    return "RESOURCE_EXHAUSTED" in message or "429" in message


def _load_gemini_client(config: PipelineConfig):
    """Load the Gemini client with the existing API key."""
    if not config.gemini_video_embedding_enabled:
        raise RuntimeError("Set ENABLE_GEMINI_VIDEO_EMBEDDING=true before running this side branch.")
    if not config.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is missing in .env.")

    try:
        from google import genai
    except ImportError as exc:  # pragma: no cover - depends on local environment
        raise RuntimeError(
            "google-genai is not installed. Run 'pip install -r requirements.txt' first."
        ) from exc

    client = genai.Client(api_key=config.gemini_api_key)
    if not getattr(client, "vertexai", False):
        logger.warning(
            "Current Gemini client is not using Vertex AI. Direct multimodal video embedding may be rejected by this backend."
        )
    return client


def _load_checkpoint(config: PipelineConfig) -> dict[str, VideoEmbeddingRecord]:
    """Load successful clip embeddings so reruns can skip completed clips."""
    output_path = config.video_embeddings_output_path
    if not output_path.exists():
        return {}

    completed: dict[str, VideoEmbeddingRecord] = {}
    for record in load_jsonl_file(output_path):
        vector = record.get("embedding", [])
        if not record.get("clip_id"):
            continue
        if record.get("embedding_model") != config.gemini_embedding_model_name:
            continue
        if record.get("embedding_modality") != VIDEO_MODALITY:
            continue
        if int(record.get("embedding_dim", 0) or 0) != config.gemini_embedding_output_dim:
            continue
        if not isinstance(vector, list) or not vector:
            continue

        completed[str(record["clip_id"])] = VideoEmbeddingRecord(
            clip_id=str(record["clip_id"]),
            video_id=str(record["video_id"]),
            clip_path=str(record["clip_path"]),
            start_sec=float(record["start_sec"]),
            end_sec=float(record["end_sec"]),
            duration_sec=float(record["duration_sec"]),
            embedding=[float(value) for value in vector],
            embedding_model=str(record["embedding_model"]),
            embedding_modality=str(record["embedding_modality"]),
            embedding_dim=int(record["embedding_dim"]),
            embedding_timestamp=str(record.get("embedding_timestamp", utc_timestamp())),
            embedding_status=STATUS_REUSED_CHECKPOINT,
            embedding_error=None,
            embedding_request_id=(
                str(record["embedding_request_id"])
                if record.get("embedding_request_id") is not None
                else None
            ),
        )
    return completed


def split_first_video(config: PipelineConfig) -> tuple[dict, list[VideoClipRecord]]:
    """Split only the first scanned video into <=120 second clips."""
    videos = scan_videos(config)
    max_files = max(config.video_max_files_per_run, 1)
    target_videos = videos[:max_files]
    if not target_videos:
        raise FileNotFoundError(f"No supported video files were found in {config.video_input_dir}.")

    ffmpeg_binary = resolve_ffmpeg_binary(config.ffmpeg_binary)
    clip_duration = max(config.video_chunk_duration_sec, 1)
    clip_records: list[VideoClipRecord] = []

    for video in target_videos:
        input_path = (config.project_root / video.file_path).resolve()
        total_parts = max(1, math.ceil(video.duration_sec / clip_duration))
        logger.info(
            "Splitting %s (%s) into %s clips of %s seconds or less",
            video.video_id,
            input_path.name,
            total_parts,
            clip_duration,
        )

        for part_index in range(total_parts):
            start_sec = part_index * clip_duration
            end_sec = min((part_index + 1) * clip_duration, video.duration_sec)
            duration_sec = round(end_sec - start_sec, 3)
            clip_id = f"{video.video_id}_part_{part_index + 1:04d}"
            clip_path = config.video_multimodal_chunk_dir / f"{clip_id}.mp4"

            if clip_path.exists() and not config.overwrite_existing:
                logger.info("[Video Split] Reusing existing clip %s", clip_id)
            else:
                command = [
                    ffmpeg_binary,
                    "-y",
                    "-ss",
                    str(start_sec),
                    "-i",
                    str(input_path),
                    "-t",
                    str(duration_sec),
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "23",
                    "-c:a",
                    "aac",
                    "-movflags",
                    "+faststart",
                    str(clip_path),
                ]
                logger.info(
                    "[Video Split] clip_id=%s start_sec=%.3f end_sec=%.3f duration_sec=%.3f",
                    clip_id,
                    start_sec,
                    end_sec,
                    duration_sec,
                )
                subprocess.run(command, check=True, capture_output=True, text=True)

            clip_records.append(
                VideoClipRecord(
                    clip_id=clip_id,
                    video_id=video.video_id,
                    clip_path=to_relative_posix(clip_path, config.project_root),
                    start_sec=round(start_sec, 3),
                    end_sec=round(end_sec, 3),
                    duration_sec=duration_sec,
                )
            )

    return target_videos[0].to_dict(), clip_records


def _persist_partial_results(
    clip_records: list[VideoClipRecord],
    records_by_clip: dict[str, VideoEmbeddingRecord],
    config: PipelineConfig,
) -> None:
    """Write the currently known clip embedding results so partial success is preserved."""
    ordered_records = [
        records_by_clip[clip_record.clip_id].to_dict()
        for clip_record in clip_records
        if clip_record.clip_id in records_by_clip
    ]
    write_jsonl_file(
        config.video_embeddings_output_path,
        ordered_records,
        backup_existing=config.backup_existing_outputs,
    )


def embed_video_clips(
    clip_records: list[VideoClipRecord],
    config: PipelineConfig,
) -> list[VideoEmbeddingRecord]:
    """Try Gemini multimodal embedding on the split video clips."""
    if not clip_records:
        return []

    from google.genai import types

    client = _load_gemini_client(config)
    checkpoint_records = _load_checkpoint(config)
    records_by_clip: dict[str, VideoEmbeddingRecord] = {}

    for clip_record in clip_records:
        checkpoint_record = checkpoint_records.get(clip_record.clip_id)
        if checkpoint_record is not None and checkpoint_record.clip_path == clip_record.clip_path:
            records_by_clip[clip_record.clip_id] = checkpoint_record
            logger.info("[Video Embed Resume] clip_id=%s status=%s", clip_record.clip_id, STATUS_REUSED_CHECKPOINT)
            continue

        clip_path = (config.project_root / clip_record.clip_path).resolve()
        attempt_number = 0

        while True:
            request_timestamp = utc_timestamp()
            try:
                logger.info(
                    "[Video Embed] clip_id=%s duration_sec=%.3f start_sec=%.3f end_sec=%.3f",
                    clip_record.clip_id,
                    clip_record.duration_sec,
                    clip_record.start_sec,
                    clip_record.end_sec,
                )
                uploaded_file = client.files.upload(file=str(clip_path))
                response = client.models.embed_content(
                    model=config.gemini_embedding_model_name,
                    contents=[
                        types.Content(
                            parts=[
                                types.Part.from_uri(
                                    file_uri=uploaded_file.uri,
                                    mime_type=uploaded_file.mime_type or _guess_video_mime_type(clip_path),
                                )
                            ]
                        )
                    ],
                    config=types.EmbedContentConfig(
                        output_dimensionality=config.gemini_embedding_output_dim,
                    ),
                )
                embedding = _normalize_vector([float(value) for value in response.embeddings[0].values])
                records_by_clip[clip_record.clip_id] = VideoEmbeddingRecord(
                    clip_id=clip_record.clip_id,
                    video_id=clip_record.video_id,
                    clip_path=clip_record.clip_path,
                    start_sec=clip_record.start_sec,
                    end_sec=clip_record.end_sec,
                    duration_sec=clip_record.duration_sec,
                    embedding=embedding,
                    embedding_model=config.gemini_embedding_model_name,
                    embedding_modality=VIDEO_MODALITY,
                    embedding_dim=len(embedding),
                    embedding_timestamp=request_timestamp,
                    embedding_status=STATUS_SUCCESS,
                    embedding_request_id=getattr(response, "request_id", None),
                )
                logger.info(
                    "[Video Embed] clip_id=%s model=%s modality=%s dim=%s status=%s",
                    clip_record.clip_id,
                    config.gemini_embedding_model_name,
                    VIDEO_MODALITY,
                    len(embedding),
                    STATUS_SUCCESS,
                )
                _persist_partial_results(clip_records, records_by_clip, config)
                break
            except Exception as exc:
                is_rate_limited = _is_rate_limit_error(exc)
                if is_rate_limited and attempt_number < config.gemini_max_retries:
                    attempt_number += 1
                    logger.warning(
                        "[Video Embed Retry] clip_id=%s attempt=%s sleep=%ss reason=429",
                        clip_record.clip_id,
                        attempt_number,
                        config.gemini_retry_sleep_sec,
                    )
                    time.sleep(config.gemini_retry_sleep_sec)
                    continue

                status = STATUS_FAILED_AFTER_RETRIES if is_rate_limited else STATUS_FAILED
                records_by_clip[clip_record.clip_id] = VideoEmbeddingRecord(
                    clip_id=clip_record.clip_id,
                    video_id=clip_record.video_id,
                    clip_path=clip_record.clip_path,
                    start_sec=clip_record.start_sec,
                    end_sec=clip_record.end_sec,
                    duration_sec=clip_record.duration_sec,
                    embedding=[],
                    embedding_model=config.gemini_embedding_model_name,
                    embedding_modality=VIDEO_MODALITY,
                    embedding_dim=config.gemini_embedding_output_dim,
                    embedding_timestamp=request_timestamp,
                    embedding_status=status,
                    embedding_error=str(exc),
                )
                logger.warning(
                    "[Video Embed Failed] clip_id=%s status=%s reason=%s",
                    clip_record.clip_id,
                    status,
                    exc,
                )
                _persist_partial_results(clip_records, records_by_clip, config)
                break

    return [records_by_clip[clip_record.clip_id] for clip_record in clip_records]


def build_runtime_config(args: argparse.Namespace) -> PipelineConfig:
    """Load config and apply CLI overrides for the video side branch."""
    config = PipelineConfig.from_env(project_root=args.project_root.resolve())
    overrides: dict[str, object] = {}
    if args.clip_duration is not None:
        overrides["video_chunk_duration_sec"] = args.clip_duration
    if args.overwrite:
        overrides["overwrite_existing"] = True
    return config.with_overrides(**overrides) if overrides else config


def main() -> int:
    """Run the minimal video multimodal embedding branch."""
    args = parse_args()
    config = build_runtime_config(args)
    configure_logging(config.log_level)

    try:
        first_video, clip_records = split_first_video(config)
        embedding_records = embed_video_clips(clip_records, config)
    except Exception as exc:
        logger.exception("Video multimodal branch failed: %s", exc)
        return 1

    success_count = sum(1 for record in embedding_records if record.embedding_status in {STATUS_SUCCESS, STATUS_REUSED_CHECKPOINT})
    failed_count = len(embedding_records) - success_count
    print("Video multimodal branch completed.")
    print(f"video_id: {first_video['video_id']}")
    print(f"clips: {len(clip_records)}")
    print(f"successful_embeddings: {success_count}")
    print(f"failed_embeddings: {failed_count}")
    print(f"output: {config.video_embeddings_output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
