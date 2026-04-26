"""Audio extraction for Whisper-compatible WAV files."""

from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from config import PipelineConfig
from utils import VideoMetadata, ensure_directory, resolve_ffmpeg_binary


logger = logging.getLogger(__name__)


def extract_audio_for_video(video: VideoMetadata, config: PipelineConfig) -> Path:
    """Extract mono 16kHz WAV audio from a local video file."""
    # 解析 FFmpeg 二進制路徑
    ffmpeg_binary = resolve_ffmpeg_binary(config.ffmpeg_binary)
    # 將導出的相對路徑轉換回絕對路徑以供本地執行
    source_video_path = config.project_root / video.file_path
    # 設置目標音頻路徑
    target_audio_path = config.project_root / video.audio_path

    # 確保目標音頻路徑的父目錄存在
    ensure_directory(target_audio_path.parent)

    # 如果目標音頻文件已存在且不覆蓋現有文件，則重用現有音頻
    if target_audio_path.exists() and not config.overwrite_existing:
        logger.info("Reusing existing audio for %s at %s", video.video_id, target_audio_path)
        return target_audio_path

    # 保持輸出格式固定以兼容 Whisper：單聲道 16kHz WAV
    command = [
        ffmpeg_binary,  # FFmpeg 可執行文件路徑
        "-y",  # 覆蓋輸出文件而不詢問
        "-i",  # 輸入文件
        str(source_video_path),  # 源視頻文件路徑
        "-vn",  # 禁用視頻錄製
        "-acodec",  # 音頻編碼器
        "pcm_s16le",  # 16位小端 PCM
        "-ac",  # 音頻通道數
        "1",  # 單聲道
        "-ar",  # 音頻採樣率
        "16000",  # 16kHz
        str(target_audio_path),  # 目標音頻文件路徑
    ]

    # 運行 FFmpeg 命令，捕獲輸出，不檢查返回值（稍後手動檢查）
    completed = subprocess.run(command, capture_output=True, text=True, check=False)

    # 如果 FFmpeg 返回非零代碼，拋出運行時錯誤
    if completed.returncode != 0:
        raise RuntimeError(
            f"Audio extraction failed for {video.video_id}. "
            f"FFmpeg stderr: {completed.stderr.strip()}"
        )

    # 記錄音頻提取成功的日誌
    logger.info("Extracted audio for %s -> %s", video.video_id, target_audio_path)
    # 返回目標音頻路徑
    return target_audio_path


def extract_audio_for_videos(videos: list[VideoMetadata], config: PipelineConfig) -> None:
    """Extract audio files for all discovered videos."""
    # 順序執行保持 MVP 簡單且易於調試
    for video in videos:
        extract_audio_for_video(video, config)
