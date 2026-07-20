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
    # 如果當前段列表為空，則可以添加（因為沒有任何限制）
    if not current_segments:
        return True

    # 控制塊大小：通過文本長度、段數量和時間跨度
    # 合併當前段和下一個段的文本，並標準化
    merged_text = normalize_text(" ".join(segment.text for segment in current_segments + [next_segment]))
    # 計算塊的持續時間：從第一個段的開始到最後一個段的結束
    chunk_duration = next_segment.end_sec - current_segments[0].start_sec

    # 返回是否所有限制都滿足：文本長度 <= 最大字符數，段數 <= 最大段數，持續時間 <= 最大持續時間
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
    # 合併所有段的文本並標準化
    merged_text = normalize_text(" ".join(segment.text for segment in chunk_segments))
    # 創建並返回 ChunkRecord 對象，包含塊ID、視頻ID、開始時間、結束時間、文本、課程名稱、周數、課節
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


def _select_overlap_segments(
    current_segments: list[TranscriptSegment],
    next_segment: TranscriptSegment,
    overlap_segments: int,
    max_chars: int,
    max_segments: int,
    max_duration_sec: float,
) -> list[TranscriptSegment]:
    """Keep the largest allowed suffix while guaranteeing one new segment fits."""
    if overlap_segments <= 0:
        return []

    carried_segments = current_segments[-overlap_segments:]
    while carried_segments and not _segment_fits_chunk(
        current_segments=carried_segments,
        next_segment=next_segment,
        max_chars=max_chars,
        max_segments=max_segments,
        max_duration_sec=max_duration_sec,
    ):
        carried_segments = carried_segments[1:]
    return carried_segments


def build_chunks_for_transcript(video: VideoMetadata, transcript: TranscriptDocument, config: PipelineConfig) -> list[ChunkRecord]:
    """Merge adjacent transcript segments into search-ready chunks."""
    # Whisper 正常路徑已跳過空白段；此處再防守外部 checkpoint/fixture。
    source_segments = [segment for segment in transcript.segments if normalize_text(segment.text)]
    if not source_segments:
        logger.warning("Transcript for %s has no segments to chunk.", video.video_id)
        return []

    # 初始化塊列表、當前段列表和塊索引
    chunks: list[ChunkRecord] = []
    current_segments: list[TranscriptSegment] = []
    chunk_index = 1

    # 遍歷轉錄文檔中的每個段
    for segment in source_segments:
        # 檢查添加下一個段是否仍符合塊限制
        if _segment_fits_chunk(
            current_segments=current_segments,
            next_segment=segment,
            max_chars=config.chunk_max_chars,
            max_segments=config.chunk_max_segments,
            max_duration_sec=config.chunk_max_duration_sec,
        ):
            # 如果符合，將段添加到當前段列表中，並繼續下一個段
            current_segments.append(segment)
            continue

        # 如果不符合，創建當前塊記錄並添加到塊列表中
        chunks.append(_build_chunk_record(video, chunk_index, current_segments))
        # 增加塊索引，帶入允許的完整 segment suffix，再加入本輪新段。
        chunk_index += 1
        carried_segments = _select_overlap_segments(
            current_segments=current_segments,
            next_segment=segment,
            overlap_segments=config.chunk_overlap_segments,
            max_chars=config.chunk_max_chars,
            max_segments=config.chunk_max_segments,
            max_duration_sec=config.chunk_max_duration_sec,
        )
        current_segments = [*carried_segments, segment]

    # 處理最後一個緩衝的塊（如果有）
    if current_segments:
        chunks.append(_build_chunk_record(video, chunk_index, current_segments))

    # 記錄構建的塊數量
    logger.info("Built %s chunks for %s", len(chunks), video.video_id)
    # 返回所有塊
    return chunks


def build_chunks(
    videos: list[VideoMetadata],
    transcripts: list[TranscriptDocument],
    config: PipelineConfig,
) -> list[ChunkRecord]:
    """Build chunks for every transcript while preserving video order."""
    # 創建視頻ID到轉錄文檔的映射
    transcript_by_video_id = {transcript.video_id: transcript for transcript in transcripts}
    # 初始化所有塊列表
    all_chunks: list[ChunkRecord] = []

    # 遍歷每個視頻
    for video in videos:
        # 獲取對應的轉錄文檔
        transcript = transcript_by_video_id.get(video.video_id)
        # 如果轉錄文檔不存在，記錄警告並跳過
        if transcript is None:
            logger.warning("Skipping chunking for %s because transcript is missing.", video.video_id)
            continue
        # 為該視頻構建塊並添加到總塊列表中
        all_chunks.extend(build_chunks_for_transcript(video, transcript, config))

    # 返回所有塊
    return all_chunks
