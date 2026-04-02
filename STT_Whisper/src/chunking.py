"""Rule-based transcript chunking for semantic search."""

from __future__ import annotations

import logging

from config import PipelineConfig
from utils import ChunkRecord, TranscriptDocument, TranscriptSegment, VideoMetadata, normalize_text, round_seconds


logger = logging.getLogger(__name__)


def _segment_fits_chunk(
    current_segments: list[TranscriptSegment],
    next_segment: TranscriptSegment,
    max_chars: int,
    max_segments: int,
    max_duration_sec: float,
) -> bool:
    """Check whether adding the next segment still respects the chunk limits."""
    if not current_segments:
        return True

    # Control chunk size by text length, segment count, and time span.
    merged_text = normalize_text(" ".join(segment.text for segment in current_segments + [next_segment]))
    chunk_duration = next_segment.end_sec - current_segments[0].start_sec

    return (
        len(merged_text) <= max_chars
        and len(current_segments) + 1 <= max_segments
        and chunk_duration <= max_duration_sec
    )


def _build_chunk_record(
    video: VideoMetadata,
    chunk_index: int,
    chunk_segments: list[TranscriptSegment],
) -> ChunkRecord:
    """Convert a buffered segment list into a final chunk record."""
    merged_text = normalize_text(" ".join(segment.text for segment in chunk_segments))
    return ChunkRecord(
        chunk_id=f"{video.video_id}_chunk_{chunk_index:04d}",
        video_id=video.video_id,
        start_sec=round_seconds(chunk_segments[0].start_sec),
        end_sec=round_seconds(chunk_segments[-1].end_sec),
        text=merged_text,
        course_name=video.course_name,
        week=video.week,
        lesson=video.lesson,
    )


def build_chunks_for_transcript(video: VideoMetadata, transcript: TranscriptDocument, config: PipelineConfig) -> list[ChunkRecord]:
    """Merge adjacent transcript segments into search-ready chunks."""
    if not transcript.segments:
        logger.warning("Transcript for %s has no segments to chunk.", video.video_id)
        return []

    chunks: list[ChunkRecord] = []
    current_segments: list[TranscriptSegment] = []
    chunk_index = 1

    for segment in transcript.segments:
        # Add to the current chunk when all limits still fit.
        if _segment_fits_chunk(
            current_segments=current_segments,
            next_segment=segment,
            max_chars=config.chunk_max_chars,
            max_segments=config.chunk_max_segments,
            max_duration_sec=config.chunk_max_duration_sec,
        ):
            current_segments.append(segment)
            continue

        chunks.append(_build_chunk_record(video, chunk_index, current_segments))
        chunk_index += 1
        current_segments = [segment]

    # Flush the final buffered chunk.
    if current_segments:
        chunks.append(_build_chunk_record(video, chunk_index, current_segments))

    logger.info("Built %s chunks for %s", len(chunks), video.video_id)
    return chunks


def build_chunks(
    videos: list[VideoMetadata],
    transcripts: list[TranscriptDocument],
    config: PipelineConfig,
) -> list[ChunkRecord]:
    """Build chunks for every transcript while preserving video order."""
    transcript_by_video_id = {transcript.video_id: transcript for transcript in transcripts}
    all_chunks: list[ChunkRecord] = []

    for video in videos:
        transcript = transcript_by_video_id.get(video.video_id)
        if transcript is None:
            logger.warning("Skipping chunking for %s because transcript is missing.", video.video_id)
            continue
        all_chunks.extend(build_chunks_for_transcript(video, transcript, config))

    return all_chunks
