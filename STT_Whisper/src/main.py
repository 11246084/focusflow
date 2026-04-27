"""Entry point for the FocusFlow MVP AI pipeline."""

from __future__ import annotations

import argparse
import logging
import sys
import urllib.request
from pathlib import Path

from chunking import build_chunks
from config import PipelineConfig
from embedding import embed_audio_tracks, embed_chunks
from export_outputs import export_all_outputs
from extract_audio import extract_audio_for_videos
from normalize_transcript import normalize_transcripts
from scan_videos import scan_videos
from transcribe import transcribe_videos
from utils import configure_logging


logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments for the local MVP pipeline."""
    # 創建命令行參數解析器
    parser = argparse.ArgumentParser(description="Run the FocusFlow education video AI pipeline.")
    # 添加項目根目錄參數，默認為當前腳本的父父目錄（即項目根目錄）
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Project root directory. Defaults to the current repository root.",
    )
    # 添加視頻目錄覆蓋參數
    parser.add_argument(
        "--video-dir",
        type=Path,
        default=None,
        help="Optional override for the video input directory.",
    )
    # 添加 Whisper 模型覆蓋參數
    parser.add_argument(
        "--whisper-model",
        default=None,
        help="Optional faster-whisper model size or local path override.",
    )
    # 添加覆蓋現有文件參數
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Rebuild cached audio/transcripts instead of reusing existing intermediate files.",
    )
    # 添加處理視頻數量限制參數，用於快速測試
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only process the first N discovered videos for faster testing.",
    )
    # 添加 Gemini 文本塊處理限制參數
    parser.add_argument(
        "--gemini-max-chunks",
        type=int,
        default=None,
        help="Only send the first N pending text chunks to Gemini in this run.",
    )
    # 由後端自動觸發時傳入：指定要處理的單一影片絕對路徑
    parser.add_argument(
        "--video-path",
        type=Path,
        default=None,
        help="Path to a specific video file to process (used when triggered by the backend).",
    )
    # 由後端自動觸發時傳入：MongoDB 的 Video 文件 ID，用於回報處理狀態
    parser.add_argument(
        "--video-id",
        default=None,
        help="MongoDB Video document ID for status webhook callbacks.",
    )
    # 解析並返回命令行參數
    return parser.parse_args()


def build_runtime_config(args: argparse.Namespace) -> PipelineConfig:
    """Merge environment config with CLI overrides."""
    # 首先從環境變數加載配置
    config = PipelineConfig.from_env(project_root=args.project_root)
    # 準備覆蓋字典
    overrides: dict[str, object] = {}

    # 如果指定了視頻目錄，進行覆蓋
    if args.video_dir is not None:
        video_dir = args.video_dir
        # 如果是相對路徑，轉換為絕對路徑
        if not video_dir.is_absolute():
            video_dir = args.project_root / video_dir
        overrides["video_input_dir"] = video_dir.resolve()
    # 如果指定了 Whisper 模型，進行覆蓋
    if args.whisper_model is not None:
        overrides["whisper_model_size"] = args.whisper_model
    # 如果指定了 Gemini 塊限制，進行覆蓋
    if args.gemini_max_chunks is not None:
        overrides["gemini_max_chunks_per_run"] = args.gemini_max_chunks
    # 如果指定了覆蓋標誌，進行覆蓋
    if args.overwrite:
        overrides["overwrite_existing"] = True

    # 若指定了單一影片路徑，轉換為絕對路徑並存入 config
    if args.video_path is not None:
        video_path = args.video_path
        if not video_path.is_absolute():
            video_path = args.project_root / video_path
        overrides["target_video_path"] = video_path.resolve()

    # 如果有覆蓋項，應用覆蓋並返回新配置，否則返回原配置
    return config.with_overrides(**overrides) if overrides else config


def notify_backend(config, video_id: str, endpoint: str) -> None:
    """通知後端更新影片處理狀態（start / complete / fail）。
    若缺少設定或發生錯誤，只記錄警告不中斷 pipeline。
    """
    if not video_id or not config.backend_url or not config.processing_webhook_secret:
        return
    url = f"{config.backend_url}/api/v1/internal/videos/{video_id}/processing/{endpoint}"
    req = urllib.request.Request(url, method="POST", data=b"{}")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Processing-Secret", config.processing_webhook_secret)
    try:
        urllib.request.urlopen(req, timeout=10)
        logger.info("Notified backend: processing/%s (videoId=%s)", endpoint, video_id)
    except Exception as exc:
        logger.warning("Failed to notify backend (%s): %s", endpoint, exc)


def run_pipeline(config: PipelineConfig, limit: int | None = None) -> dict[str, Path]:
    """Execute the full local pipeline from video scan to export."""
    # 記錄管道開始
    logger.info("Starting FocusFlow AI pipeline")
    # 檢查 Gemini 嵌入是否啟用（現在是唯一的嵌入路徑）
    if not config.gemini_embedding_enabled:
        raise RuntimeError(
            "Gemini embedding is now the final embedding path. Set ENABLE_GEMINI_EMBEDDING=true in .env."
        )

    # 步驟 1：掃描視頻並構建標準化元數據
    videos = scan_videos(config)

    # 如果指定了限制，只處理前 N 個視頻
    if limit is not None:
        videos = videos[:limit]
        logger.info("Processing only the first %s videos because --limit was provided", len(videos))

    # 如果沒有找到視頻，拋出錯誤
    if not videos:
        raise FileNotFoundError(
            f"No supported video files were found in {config.video_input_dir}. "
            "Place .mp4/.mov/.mkv files there and rerun the pipeline."
        )

    # 步驟 2：提取 Whisper 兼容的音頻
    extract_audio_for_videos(videos, config)
    # 步驟 3：運行 faster-whisper STT
    transcripts = transcribe_videos(videos, config)
    # 步驟 4：在搜索分塊前標準化技術術語
    normalized_transcripts = normalize_transcripts(transcripts, config)
    # 步驟 5：將標準化轉錄段合併為搜索塊
    chunks = build_chunks(videos, normalized_transcripts, config)
    # 步驟 6：從標準化塊生成 Gemini 文本嵌入
    text_embeddings = embed_chunks(chunks, config)
    # 步驟 7：直接從提取的音頻文件生成 Gemini 音頻嵌入
    audio_embeddings = embed_audio_tracks(videos, config)
    # 步驟 8：導出 JSON 和 JSONL 文件供下游團隊使用
    output_paths = export_all_outputs(
        videos,
        transcripts,
        normalized_transcripts,
        chunks,
        text_embeddings,
        audio_embeddings,
        config,
    )

    # 記錄管道完成統計
    logger.info(
        "Pipeline completed: videos=%s transcripts=%s chunks=%s text_embeddings=%s audio_embeddings=%s",
        len(videos),
        len(transcripts),
        len(chunks),
        len(text_embeddings),
        len(audio_embeddings),
    )
    # 返回輸出文件路徑
    return output_paths


def main() -> int:
    """CLI wrapper that returns a process exit code."""
    # 解析命令行參數
    args = parse_args()
    # 構建運行時配置
    config = build_runtime_config(args)
    # 配置日誌記錄
    configure_logging(config.log_level)

    # 通知後端：STT 開始處理（狀態 queued → processing）
    notify_backend(config, args.video_id, "start")

    # 嘗試運行管道
    try:
        output_paths = run_pipeline(config, limit=args.limit)
    # 如果出現異常，通知後端失敗並返回退出碼 1
    except Exception as exc:
        logger.exception("Pipeline failed: %s", exc)
        notify_backend(config, args.video_id, "fail")
        return 1

    # 打印成功消息和輸出路徑
    print("FocusFlow AI pipeline completed successfully.")
    for name, path in output_paths.items():
        print(f"{name}: {path}")

    # Pipeline 完成後自動上傳結果到 MongoDB
    print("\nStarting MongoDB upload...")
    import mongodb_uploader
    if mongodb_uploader.main() != 0:
        logger.error("MongoDB upload failed.")
        notify_backend(config, args.video_id, "fail")
        return 1

    # 通知後端：處理全部完成（狀態 processing → completed）
    notify_backend(config, args.video_id, "complete")

    # 返回成功退出碼 0
    return 0


if __name__ == "__main__":
    # 作為腳本運行時，退出並返回 main() 的退出碼
    sys.exit(main())
