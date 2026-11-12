"""Local chunk-aligned media preparation. This entry point only uses mock embeddings."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import tempfile
import time
import subprocess
from pathlib import Path
from typing import Callable

from utils import extract_duration_seconds, resolve_ffmpeg_binary

MODEL = "gemini-embedding-2"
DIMENSION = 3072
MIN_SECONDS = 8
MAX_SECONDS = 60
CONTRACT_VERSION = "segment_media_v1"


class TransientEmbeddingError(Exception):
    """An injected adapter may signal a retryable rate-limit or transport error."""


def normalize_chunk(value: dict) -> dict:
    """Accept the pipeline's snake_case or the backend's camelCase timestamps."""
    chunk = dict(value)
    for target, legacy in (("chunkId", "chunk_id"), ("videoId", "video_id"),
                           ("startSec", "start_sec"), ("endSec", "end_sec")):
        chunk[target] = value.get(target, value.get(legacy))
    if not all(isinstance(chunk.get(key), str) and chunk[key] for key in ("courseId", "videoId", "chunkId")):
        raise ValueError("courseId, videoId and chunkId are required")
    start, end = chunk["startSec"], chunk["endSec"]
    if any(isinstance(number, bool) or not isinstance(number, (int, float))
           or not math.isfinite(number) for number in (start, end)) or start < 0 or end <= start:
        raise ValueError("Invalid chunk timestamps")
    return chunk


def sample_window(chunk: dict, duration: float) -> tuple[float, float] | None:
    if not math.isfinite(duration) or duration <= 0 or chunk["endSec"] > duration:
        raise ValueError("Chunk extends outside video duration")
    start, end = chunk["startSec"], chunk["endSec"]
    if end - start > MAX_SECONDS:
        return None
    if end - start < MIN_SECONDS:
        length = min(MIN_SECONDS, duration)
        start = max(0, min((start + end - length) / 2, duration - length))
        end = start + length
    return start, end


def probe_duration(video: Path, ffmpeg: str) -> float:
    probe = subprocess.run([ffmpeg, "-hide_banner", "-i", str(video)], capture_output=True,
                           text=True, encoding="utf-8", errors="replace", timeout=30)
    return extract_duration_seconds(probe.stderr)


def cut_media(video: Path, target: Path, modality: str, start: float, end: float, ffmpeg: str) -> None:
    temporary = target.with_name(target.stem + ".partial" + target.suffix)
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-ss", str(start),
               "-i", str(video), "-t", str(end - start)]
    if modality == "audio":
        command += ["-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"]
    else:
        command += ["-map", "0:v:0", "-an", "-vf", "fps=1,scale=-2:480", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
    try:
        subprocess.run(command + [str(temporary)], check=True, capture_output=True, timeout=180)
        if temporary.stat().st_size == 0:
            raise ValueError("Empty media output")
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def mock_embedding(media: Path, modality: str) -> list[float]:
    """Deterministic synthetic vectors, unrelated to semantic retrieval quality."""
    digest = hashlib.sha256(media.read_bytes() + modality.encode()).digest()
    vector = [(digest[index % len(digest)] - 127.5) / 127.5 for index in range(DIMENSION)]
    norm = math.sqrt(sum(value * value for value in vector))
    return [value / norm for value in vector]


def normalize_embedding(vector: list[float]) -> list[float]:
    if len(vector) != DIMENSION or any(isinstance(value, bool) or not isinstance(value, (int, float))
                                       or not math.isfinite(value) for value in vector):
        raise ValueError("Embedding must contain 3072 finite numbers")
    norm = math.sqrt(sum(value * value for value in vector))
    if not math.isfinite(norm) or norm == 0:
        raise ValueError("Embedding norm must be finite and positive")
    return [value / norm for value in vector]


def embed_with_adapter(media: Path, modality: str, adapter: Callable, *, provider: str,
                       model: str, sleep: Callable = time.sleep) -> dict:
    """Adapters receive one slice and return one vector with explicit provider provenance."""
    if provider != "mock" and model != MODEL:
        raise ValueError("Media embeddings require the stable Gemini model")
    for attempt in range(3):
        try:
            vector = adapter(media, modality)
            vector = normalize_embedding(vector)
            return {"provider": provider, "model": model, "dimension": DIMENSION,
                    "embedding": vector}
        except TransientEmbeddingError:
            if attempt == 2:
                raise
            sleep(2 ** attempt)
    raise RuntimeError("Embedding attempts exhausted")


def write_json(path: Path, value: dict) -> None:
    # Persist before replacement; Windows scanners can briefly hold the destination open.
    # Retry only local atomic replacement, never a model call or a database mutation.
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                     prefix=path.name + ".", suffix=".tmp", delete=False) as handle:
        temporary = Path(handle.name)
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        for attempt in range(10):
            try:
                temporary.replace(path)
                break
            except PermissionError:
                if attempt == 9:
                    raise
                time.sleep(0.05)
    finally:
        temporary.unlink(missing_ok=True)


def prepare_chunks(video: Path, chunks: list[dict], output: Path, *, max_cost_usd: float) -> dict:
    """Prepare local media and mock records, with source-bound, atomic checkpoints."""
    output.mkdir(parents=True, exist_ok=True)
    lock = output / ".prepare.lock"
    with lock.open("x", encoding="utf-8") as handle:
        handle.write("One media preparation process per output directory")
    try:
        return _prepare_chunks(video, chunks, output, max_cost_usd=max_cost_usd)
    finally:
        lock.unlink(missing_ok=True)


def _prepare_chunks(video: Path, chunks: list[dict], output: Path, *, max_cost_usd: float) -> dict:
    if not math.isfinite(max_cost_usd) or max_cost_usd < 0:
        raise ValueError("A nonnegative cost ceiling is required")
    video = video.resolve(strict=True)
    ffmpeg = resolve_ffmpeg_binary()
    duration = probe_duration(video, ffmpeg)
    # An unreadable duration is a problem with the video, not with individual chunks.
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError("Video duration is unavailable")
    normalized = [normalize_chunk(chunk) for chunk in chunks]
    identities = [(chunk["courseId"], chunk["videoId"], chunk["chunkId"]) for chunk in normalized]
    if len(set(identities)) != len(identities) or len({chunk["videoId"] for chunk in normalized}) != 1:
        raise ValueError("Use unique chunks from one video per run")
    source_hash = hashlib.sha256(video.read_bytes()).hexdigest()
    records = []
    for chunk in normalized:
        # One chunk whose end exceeds the probed duration (for example a final Whisper
        # segment that overruns the container by a few milliseconds) must not abort the
        # other chunks of the video; it is recorded as failed with an explicit reason.
        try:
            window = sample_window(chunk, duration)
            window_error = None
        except ValueError:
            window, window_error = None, "chunk_outside_video_duration"
        for modality in ("audio", "visual"):
            signature = hashlib.sha256(json.dumps([source_hash, chunk, modality, CONTRACT_VERSION],
                                                  sort_keys=True).encode()).hexdigest()
            record_path = output / f"{signature}.json"
            target = output / f"{signature}{'.wav' if modality == 'audio' else '.mp4'}"
            if record_path.exists() and target.exists():
                cached = json.loads(record_path.read_text(encoding="utf-8"))
                if cached.get("signature") == signature and cached.get("status") == "success" \
                        and cached.get("mediaSha256") == hashlib.sha256(target.read_bytes()).hexdigest():
                    records.append({**cached, "reused": True})
                    continue
            record = {**chunk, "modality": modality, "signature": signature,
                      "contractVersion": f"mock_{modality}_v1",
                      "targetContractVersion": f"gemini_embedding_2_{modality}_v1",
                      "pipelineVersion": CONTRACT_VERSION, "provider": "mock",
                      "model": "mock-sha256-v1", "dimension": DIMENSION, "status": "pending",
                      "error": None, "skipReason": None, "sampleStartSec": None, "sampleEndSec": None,
                      "embedding": None, "reused": False}
            if window_error:
                record.update(status="failed", skipReason=window_error,
                              error={"type": "ValueError", "message": "Chunk extends outside video duration"})
            elif window is None:
                record.update(status="skipped", skipReason="skipped_too_long")
            else:
                record.update(sampleStartSec=window[0], sampleEndSec=window[1])
                try:
                    cut_media(video, target, modality, *window, ffmpeg)
                    record.update(embed_with_adapter(target, modality, mock_embedding,
                                                     provider="mock", model="mock-sha256-v1"))
                    record.update(status="success", mediaPath=str(target.resolve()), mediaBytes=target.stat().st_size,
                                  mediaSha256=hashlib.sha256(target.read_bytes()).hexdigest())
                except (OSError, ValueError, subprocess.SubprocessError) as error:
                    record.update(status="failed", error={"type": type(error).__name__, "message": "Local media preparation failed"})
            write_json(record_path, record)
            records.append(record)
    manifest = {"source": str(video), "sourceSha256": source_hash, "durationSec": duration,
                "provider": "mock", "estimatedCostUsd": 0, "maxCostUsd": max_cost_usd, "records": records}
    write_json(output / "manifest.json", manifest)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--chunks", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--max-cost-usd", required=True, type=float)
    args = parser.parse_args()
    chunks = json.loads(args.chunks.read_text(encoding="utf-8-sig"))
    print("Mock adapter estimated cost USD 0; no API calls", flush=True)
    manifest = prepare_chunks(args.video, chunks, args.output, max_cost_usd=args.max_cost_usd)
    summary = {"manifest": str((args.output / "manifest.json").resolve()),
               "success": sum(record["status"] == "success" for record in manifest["records"]),
               "failed": sum(record["status"] == "failed" for record in manifest["records"])}
    print(json.dumps(summary))
    if summary["failed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
