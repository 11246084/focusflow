"""Speech-to-text transcription using faster-whisper."""

from __future__ import annotations

import logging

from config import PipelineConfig
from utils import TranscriptDocument, TranscriptSegment, VideoMetadata, load_json_file, normalize_text, round_seconds, write_json_file


logger = logging.getLogger(__name__)


def _load_whisper_model(config: PipelineConfig):
    """Load the faster-whisper model lazily to keep imports lightweight."""
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:  # pragma: no cover - depends on local environment
        raise RuntimeError(
            "faster-whisper is not installed. Run 'pip install -r requirements.txt' first."
        ) from exc

    logger.info(
        "Loading Whisper model '%s' on device=%s compute_type=%s",
        config.whisper_model_size,
        config.whisper_device,
        config.whisper_compute_type,
    )
    return WhisperModel(
        model_size_or_path=config.whisper_model_size,
        device=config.whisper_device,
        compute_type=config.whisper_compute_type,
    )


def _transcript_cache_path(video_id: str, config: PipelineConfig) -> Path:
    """Return the per-video transcript cache file location."""
    return config.transcript_cache_dir / f"{video_id}.json"


def _load_cached_transcript(video_id: str, config: PipelineConfig) -> TranscriptDocument | None:
    """Load cached transcript JSON when available and reuse is enabled."""
    cache_path = _transcript_cache_path(video_id, config)

    # Ignore cache when overwrite mode is enabled.
    if not cache_path.exists() or config.overwrite_existing:
        return None

    payload = load_json_file(cache_path)
    segments = [TranscriptSegment.from_dict(segment) for segment in payload["segments"]]
    logger.info("Loaded cached transcript for %s", video_id)
    return TranscriptDocument(video_id=payload["video_id"], segments=segments)


def _save_transcript_cache(document: TranscriptDocument, config: PipelineConfig) -> None:
    """Persist the transcript to a per-video cache file for faster reruns."""
    cache_path = _transcript_cache_path(document.video_id, config)
    write_json_file(
        cache_path,
        document.to_dict(),
        backup_existing=config.backup_existing_outputs,
    )


def transcribe_video(video: VideoMetadata, model, config: PipelineConfig) -> TranscriptDocument:
    """Run STT for a single WAV file and return normalized segment records."""
    # Reuse transcript cache first to avoid reprocessing long videos.
    cached_document = _load_cached_transcript(video.video_id, config)
    if cached_document:
        return cached_document

    audio_path = config.project_root / video.audio_path

    # faster-whisper returns a segment iterator plus language metadata.
    segments_iter, info = model.transcribe(
        str(audio_path),
        beam_size=config.whisper_beam_size,
        language=config.whisper_language,
        vad_filter=config.whisper_vad_filter,
    )

    logger.info(
        "Transcribing %s with detected language=%s probability=%.3f",
        video.video_id,
        info.language,
        info.language_probability,
    )

    normalized_segments: list[TranscriptSegment] = []

    for index, segment in enumerate(segments_iter, start=1):
        # Normalize whitespace so chunking and embedding stay stable.
        cleaned_text = normalize_text(segment.text)
        if not cleaned_text:
            continue

        # Keep the segment naming stable for downstream integrations.
        normalized_segments.append(
            TranscriptSegment(
                segment_id=f"{video.video_id}_seg_{index:04d}",
                start_sec=round_seconds(segment.start),
                end_sec=round_seconds(segment.end),
                text=cleaned_text,
            )
        )

    transcript_document = TranscriptDocument(video_id=video.video_id, segments=normalized_segments)
    _save_transcript_cache(transcript_document, config)
    logger.info("Transcribed %s into %s segments", video.video_id, len(normalized_segments))
    return transcript_document


def transcribe_videos(videos: list[VideoMetadata], config: PipelineConfig) -> list[TranscriptDocument]:
    """Run STT for all videos in order and return transcript documents."""
    if not videos:
        return []

    # Load the model only once for the full batch.
    model = _load_whisper_model(config)
    return [transcribe_video(video, model, config) for video in videos]
