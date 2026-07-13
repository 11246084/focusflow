"""Writers for the standardized JSON and JSONL export files."""

from __future__ import annotations

import logging
from pathlib import Path

from config import PipelineConfig
from utils import (
    AudioEmbeddingRecord,
    ChunkRecord,
    EmbeddingRecord,
    TranscriptDocument,
    VideoMetadata,
    write_json_file,
    write_jsonl_file,
)


logger = logging.getLogger(__name__)


def export_videos(videos: list[VideoMetadata], output_dir: Path, backup_existing: bool = True) -> Path:
    """Export video metadata as a single JSON array."""
    # 設置輸出路徑為 output_dir 下的 "videos.json"
    output_path = output_dir / "videos.json"
    # 將視頻列表轉換為字典列表並寫入 JSON 文件，如果 backup_existing 為 True 則備份現有文件
    write_json_file(output_path, [video.to_dict() for video in videos], backup_existing=backup_existing)
    # 記錄導出成功的日誌
    logger.info("Exported %s", output_path)
    # 返回輸出路徑
    return output_path


def export_transcripts(
    transcripts: list[TranscriptDocument],
    output_dir: Path,
    backup_existing: bool = True,
) -> Path:
    """Export transcript segments as a single JSON array."""
    # 設置輸出路徑為 output_dir 下的 "transcripts.json"
    output_path = output_dir / "transcripts.json"
    # 將轉錄文檔列表轉換為字典列表並寫入 JSON 文件，如果 backup_existing 為 True 則備份現有文件
    write_json_file(output_path, [transcript.to_dict() for transcript in transcripts], backup_existing=backup_existing)
    # 記錄導出成功的日誌
    logger.info("Exported %s", output_path)
    # 返回輸出路徑
    return output_path


def export_normalized_transcripts(
    transcripts: list[TranscriptDocument],
    output_path: Path,
    backup_existing: bool = True,
) -> Path:
    """Export normalized transcript segments plus correction history."""
    # 將轉錄文檔列表轉換為包含標準化信息的字典列表並寫入 JSON 文件，如果 backup_existing 為 True 則備份現有文件
    write_json_file(
        output_path,
        [transcript.to_dict(include_normalization=True) for transcript in transcripts],
        backup_existing=backup_existing,
    )
    # 記錄導出成功的日誌
    logger.info("Exported %s", output_path)
    # 返回輸出路徑
    return output_path


def export_chunks(chunks: list[ChunkRecord], output_path: Path, backup_existing: bool = True) -> Path:
    """Export all search chunks into one stable JSONL file."""
    # 將塊記錄生成器寫入 JSONL 文件，如果 backup_existing 為 True 則備份現有文件
    write_jsonl_file(output_path, (chunk.to_dict() for chunk in chunks), backup_existing=backup_existing)
    # 記錄導出成功的日誌
    logger.info("Exported %s", output_path)
    # 返回輸出路徑
    return output_path


def export_text_embeddings(
    embeddings: list[EmbeddingRecord],
    output_path: Path,
    backup_existing: bool = True,
) -> Path:
    """Export Gemini text embeddings into one JSONL file."""
    # 將嵌入記錄生成器寫入 JSONL 文件，如果 backup_existing 為 True 則備份現有文件
    write_jsonl_file(output_path, (record.to_dict() for record in embeddings), backup_existing=backup_existing)
    # 記錄導出成功的日誌
    logger.info("Exported %s", output_path)
    # 返回輸出路徑
    return output_path


def export_audio_embeddings(
    embeddings: list[AudioEmbeddingRecord],
    output_path: Path,
    backup_existing: bool = True,
) -> Path:
    """Export Gemini audio embeddings into one JSONL file."""
    # 將音頻嵌入記錄生成器寫入 JSONL 文件，如果 backup_existing 為 True 則備份現有文件
    write_jsonl_file(output_path, (record.to_dict() for record in embeddings), backup_existing=backup_existing)
    # 記錄導出成功的日誌
    logger.info("Exported %s", output_path)
    # 返回輸出路徑
    return output_path


def export_latest_compatibility_outputs(
    videos: list[VideoMetadata],
    transcripts: list[TranscriptDocument],
    normalized_transcripts: list[TranscriptDocument],
    chunks: list[ChunkRecord],
    text_embeddings: list[EmbeddingRecord],
    audio_embeddings: list[AudioEmbeddingRecord],
    config: PipelineConfig,
) -> None:
    """Refresh top-level latest outputs for older consumers."""
    latest_dir = config.active_output_dir.resolve()
    run_dir = config.output_dir.resolve()
    if latest_dir == run_dir:
        return

    export_videos(videos, latest_dir, config.backup_existing_outputs)
    export_transcripts(transcripts, latest_dir, config.backup_existing_outputs)
    export_normalized_transcripts(
        normalized_transcripts,
        latest_dir / "transcripts_normalized.json",
        config.backup_existing_outputs,
    )
    export_chunks(
        chunks,
        latest_dir / "chunks.jsonl",
        config.backup_existing_outputs,
    )
    export_text_embeddings(
        text_embeddings,
        latest_dir / "embeddings_text_gemini.jsonl",
        config.backup_existing_outputs,
    )
    export_audio_embeddings(
        audio_embeddings,
        latest_dir / "embeddings_audio_gemini.jsonl",
        config.backup_existing_outputs,
    )
    logger.info("Updated latest compatibility outputs in %s", latest_dir)


def export_all_outputs(
    videos: list[VideoMetadata],
    transcripts: list[TranscriptDocument],
    normalized_transcripts: list[TranscriptDocument],
    chunks: list[ChunkRecord],
    text_embeddings: list[EmbeddingRecord],
    audio_embeddings: list[AudioEmbeddingRecord],
    config: PipelineConfig,
    update_latest: bool = True,
) -> dict[str, Path]:
    """Export versioned run artifacts, then refresh top-level compatibility copies."""
    output_paths = {
        # 導出視頻元數據
        "videos": export_videos(videos, config.output_dir, config.backup_existing_outputs),
        # 導出轉錄文檔
        "transcripts": export_transcripts(transcripts, config.output_dir, config.backup_existing_outputs),
        # 導出標準化轉錄文檔
        "transcripts_normalized": export_normalized_transcripts(
            normalized_transcripts,
            config.normalized_transcript_output_path,
            config.backup_existing_outputs,
        ),
        # 導出塊記錄
        "chunks": export_chunks(chunks, config.chunks_output_path, config.backup_existing_outputs),
        # 導出文本嵌入
        "embeddings_text_gemini": export_text_embeddings(
            text_embeddings,
            config.text_embeddings_output_path,
            config.backup_existing_outputs,
        ),
        # 導出音頻嵌入
        "embeddings_audio_gemini": export_audio_embeddings(
            audio_embeddings,
            config.audio_embeddings_output_path,
            config.backup_existing_outputs,
        ),
    }

    if update_latest:
        export_latest_compatibility_outputs(
            videos,
            transcripts,
            normalized_transcripts,
            chunks,
            text_embeddings,
            audio_embeddings,
            config,
        )

    return output_paths
