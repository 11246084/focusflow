"""Video discovery and metadata extraction."""

from __future__ import annotations

import logging
import re
import subprocess
from pathlib import Path

from config import PipelineConfig
from utils import VideoMetadata, extract_duration_seconds, resolve_ffmpeg_binary, round_seconds, to_relative_posix


logger = logging.getLogger(__name__)


def infer_optional_metadata(video_path: Path, video_input_dir: Path) -> tuple[str | None, str | None, str | None]:
    """Infer course fields from folder/file naming when possible."""
    # 使用第一個嵌套文件夾作為輕量級課程提示（如果可用）
    relative_parent = video_path.parent.relative_to(video_input_dir)
    course_name = relative_parent.parts[0] if relative_parent.parts else None

    # 保持 MVP 啟發式故意簡單且非破壞性
    # 使用正則表達式從文件名中提取週數
    week_match = re.search(r"week[_\s-]?(\d+)", video_path.stem, re.IGNORECASE)
    # 使用正則表達式從文件名中提取課程數
    lesson_match = re.search(r"lesson[_\s-]?(\d+)", video_path.stem, re.IGNORECASE)

    # 提取匹配的週數，如果沒有匹配則為 None
    week = week_match.group(1) if week_match else None
    # 提取匹配的課程數，如果沒有匹配則為 None
    lesson = lesson_match.group(1) if lesson_match else None
    # 返回課程名稱、週數和課程數
    return course_name, week, lesson


def probe_video_duration(video_path: Path, ffmpeg_binary: str) -> float:
    """Read a video's duration using FFmpeg stderr output."""
    # `ffmpeg -i` 將探測詳情打印到 stderr，這足以用於持續時間解析
    command = [ffmpeg_binary, "-i", str(video_path)]
    # 運行 FFmpeg 命令，捕獲輸出，不檢查返回值
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    # 合併 stderr 和 stdout 輸出
    ffmpeg_output = (completed.stderr or "") + "\n" + (completed.stdout or "")
    # 從輸出中提取持續時間秒數
    duration_sec = extract_duration_seconds(ffmpeg_output)
    # 將持續時間四捨五入並返回
    return round_seconds(duration_sec)


def iter_input_files(video_input_dir: Path):
    """Yield deterministic file paths without loading file contents."""
    yield from sorted(
        (path for path in video_input_dir.rglob("*") if path.is_file()),
        key=lambda item: item.as_posix().lower(),
    )


def discover_video_files(video_input_dir: Path, supported_extensions: tuple[str, ...]) -> list[Path]:
    """Find all supported video files recursively under the input directory."""
    return [
        path
        for path in iter_input_files(video_input_dir)
        if path.suffix.lower() in supported_extensions
    ]


def scan_videos(config: PipelineConfig) -> list[VideoMetadata]:
    """Scan the input folder and produce normalized metadata records."""
    # 在掃描前解析 FFmpeg，以便環境錯誤快速失敗
    ffmpeg_binary = resolve_ffmpeg_binary(config.ffmpeg_binary)

    # 若後端指定了單一影片路徑（由自動化觸發時傳入），只處理那一支影片
    if config.target_video_path is not None:
        video_files = [config.target_video_path]
    else:
        # 發現視頻文件
        video_files = discover_video_files(config.video_input_dir, config.supported_video_extensions)

    # 如果沒有找到視頻文件，記錄警告並返回空列表
    if not video_files:
        logger.warning("No supported video files were found in %s", config.video_input_dir)
        return []

    # 初始化視頻元數據列表
    videos: list[VideoMetadata] = []

    # 遍歷每個發現的視頻文件
    for index, video_path in enumerate(video_files, start=1):
        # 後端觸發時使用 MongoDB Video._id 作為 video_id，確保每支影片唯一
        # 手動掃描模式仍使用 video_001 等序號
        video_id = config.target_video_id if (config.target_video_id and len(video_files) == 1) else f"video_{index:03d}"
        # 推斷可選元數據（課程名稱、週數、課程數）
        course_name, week, lesson = infer_optional_metadata(video_path, config.video_input_dir)
        # 探測視頻持續時間
        duration_sec = probe_video_duration(video_path, ffmpeg_binary)
        # 構造音頻輸出路徑
        audio_path = config.processed_audio_dir / f"{video_id}.wav"

        # 創建視頻元數據記錄
        video_record = VideoMetadata(
            video_id=video_id,
            file_name=video_path.name,
            file_path=to_relative_posix(video_path, config.project_root),
            audio_path=to_relative_posix(audio_path, config.project_root),
            duration_sec=duration_sec,
            course_name=course_name,
            week=week,
            lesson=lesson,
        )
        # 添加到視頻列表
        videos.append(video_record)
        # 記錄掃描信息
        logger.info("Scanned %s (%s)", video_record.file_name, video_record.video_id)

    # 返回視頻元數據列表
    return videos
