"""Speech-to-text transcription using faster-whisper."""

from __future__ import annotations

import logging
from pathlib import Path

from config import PipelineConfig
from stt_accuracy import build_config_fingerprint, build_stt_config_snapshot
from utils import TranscriptDocument, TranscriptSegment, VideoMetadata, load_json_file, normalize_text, round_seconds, write_json_file


logger = logging.getLogger(__name__)


def _load_whisper_model(config: PipelineConfig):
    """Load the faster-whisper model lazily to keep imports lightweight."""
    # 嘗試導入 faster-whisper 模塊
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:  # pragma: no cover - depends on local environment
        raise RuntimeError(
            "faster-whisper is not installed. Run 'pip install -r requirements.txt' first."
        ) from exc

    # 記錄模型加載信息
    logger.info(
        "Loading Whisper model '%s' on device=%s compute_type=%s cpu_threads=%s",
        config.whisper_model_size,
        config.whisper_device,
        config.whisper_compute_type,
        config.whisper_cpu_threads,
    )
    # 創建並返回 Whisper 模型實例
    return WhisperModel(
        model_size_or_path=config.whisper_model_size,
        device=config.whisper_device,
        compute_type=config.whisper_compute_type,
        cpu_threads=config.whisper_cpu_threads,
        num_workers=1,
    )


def _transcript_cache_path(video_id: str, config: PipelineConfig) -> Path:
    """Return the per-video transcript cache file location."""
    # 返回每個視頻的轉錄緩存文件位置
    return config.transcript_cache_dir / f"{video_id}.json"


def _load_cached_transcript(video_id: str, config: PipelineConfig) -> TranscriptDocument | None:
    """Load cached transcript JSON when available and reuse is enabled."""
    # 獲取緩存文件路徑
    cache_path = _transcript_cache_path(video_id, config)

    # 如果啟用覆蓋模式或緩存文件不存在，則忽略緩存
    if not cache_path.exists() or config.overwrite_existing:
        return None

    # 加載緩存的 JSON 文件
    payload = load_json_file(cache_path)
    current_fingerprint = build_config_fingerprint(build_stt_config_snapshot(config))
    if payload.get("stt_config_fingerprint") != current_fingerprint:
        logger.info("Ignoring stale transcript cache for %s", video_id)
        return None
    # 將段落字典轉換為 TranscriptSegment 對象
    segments = [TranscriptSegment.from_dict(segment) for segment in payload["segments"]]
    # 記錄緩存加載信息
    logger.info("Loaded cached transcript for %s", video_id)
    # 返回轉錄文檔
    return TranscriptDocument(video_id=payload["video_id"], segments=segments)


def _save_transcript_cache(document: TranscriptDocument, config: PipelineConfig) -> None:
    """Persist the transcript to a per-video cache file for faster reruns."""
    # 獲取緩存文件路徑
    cache_path = _transcript_cache_path(document.video_id, config)
    # 將轉錄文檔寫入 JSON 文件
    write_json_file(
        cache_path,
        {
            **document.to_dict(),
            "stt_config_fingerprint": build_config_fingerprint(build_stt_config_snapshot(config)),
        },
        backup_existing=config.backup_existing_outputs,
    )


def transcribe_video(video: VideoMetadata, model, config: PipelineConfig) -> TranscriptDocument:
    """Run STT for a single WAV file and return normalized segment records."""
    # 首先重用轉錄緩存以避免重新處理長視頻
    cached_document = _load_cached_transcript(video.video_id, config)
    if cached_document:
        return cached_document

    # 構造音頻文件的絕對路徑
    audio_path = config.project_root / video.audio_path

    # faster-whisper 返回段落迭代器加上語言元數據
    segments_iter, info = model.transcribe(
        str(audio_path),
        beam_size=config.whisper_beam_size,
        language=config.whisper_language,
        vad_filter=config.whisper_vad_filter,
        task=config.stt_task,
        initial_prompt=config.stt_initial_prompt or None,
        condition_on_previous_text=config.stt_condition_on_previous_text,
    )

    # 記錄轉錄開始信息
    logger.info(
        "Transcribing %s with detected language=%s probability=%.3f",
        video.video_id,
        info.language,
        info.language_probability,
    )

    # 初始化標準化段落列表
    normalized_segments: list[TranscriptSegment] = []

    # 遍歷 faster-whisper 返回的每個段落
    for index, segment in enumerate(segments_iter, start=1):
        # 標準化空白以保持分塊和嵌入的穩定性
        cleaned_text = normalize_text(segment.text)
        # 如果清理後的文本為空，跳過
        if not cleaned_text:
            continue

        # 保持段落命名穩定以供下游集成使用
        normalized_segments.append(
            TranscriptSegment(
                segment_id=f"{video.video_id}_seg_{index:04d}",
                start_sec=round_seconds(segment.start),
                end_sec=round_seconds(segment.end),
                text=cleaned_text,
            )
        )

    # 創建轉錄文檔
    transcript_document = TranscriptDocument(video_id=video.video_id, segments=normalized_segments)
    # 保存轉錄緩存
    _save_transcript_cache(transcript_document, config)
    # 記錄轉錄完成信息
    logger.info("Transcribed %s into %s segments", video.video_id, len(normalized_segments))
    # 返回轉錄文檔
    return transcript_document


def transcribe_videos(videos: list[VideoMetadata], config: PipelineConfig) -> list[TranscriptDocument]:
    """Run STT for all videos in order and return transcript documents."""
    # 如果沒有視頻，返回空列表
    if not videos:
        return []

    # 為整個批次只加載一次模型
    model = _load_whisper_model(config)
    # 為每個視頻運行轉錄並返回結果列表
    return [transcribe_video(video, model, config) for video in videos]
