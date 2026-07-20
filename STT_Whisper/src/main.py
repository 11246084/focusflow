"""Entry point for the FocusFlow MVP AI pipeline."""

from __future__ import annotations

import argparse
import logging
import shutil
import subprocess
import sys
import urllib.request
import wave
from pathlib import Path
from typing import Callable, TypeVar

from chunk_strategy import build_chunk_config_fingerprint, build_chunk_config_snapshot
from chunking import build_chunks
from config import PipelineConfig
from embedding import embed_audio_tracks, embed_chunks
from export_outputs import export_all_outputs, export_latest_compatibility_outputs
from extract_audio import extract_audio_for_videos
from job_manager import JobManager, create_manifest, load_manifest
from normalize_transcript import normalize_transcripts
from resume_checkpoint import ResumePlan, build_resume_plan
from run_summary import write_run_summary, write_upload_summary
from scan_videos import discover_video_files, scan_videos
from transcribe import transcribe_videos
from utils import VideoMetadata, configure_logging, ensure_directory


logger = logging.getLogger(__name__)
T = TypeVar("T")


def find_ffmpeg_location() -> str | None:
    """Find an ffmpeg binary location for yt-dlp without relying only on PATH."""
    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path:
        return ffmpeg_path

    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover - best effort fallback
        logger.debug("imageio-ffmpeg lookup failed: %s", exc)

    return None


def get_wav_duration_sec(audio_path: Path) -> float:
    """Return WAV duration in seconds."""
    with wave.open(str(audio_path), "rb") as wav_file:
        frame_count = wav_file.getnframes()
        frame_rate = wav_file.getframerate()
        return round(frame_count / float(frame_rate), 3) if frame_rate else 0.0


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
    parser.add_argument(
        "--resume-run-id",
        default=None,
        help="Resume an existing run from data/outputs/runs/<run_id>/manifest.json.",
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
    # 由後端自動觸發時傳入：YouTube 影片 URL，啟用後改用 yt-dlp 下載音訊
    parser.add_argument(
        "--youtube-url",
        default=None,
        help="YouTube video URL. When provided, audio is downloaded via yt-dlp and local video scanning is skipped.",
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
    # 同時將 video_input_dir 設為該檔案的父目錄，讓 scan_videos 的 relative_to 能正確運作
    if args.video_path is not None:
        video_path = args.video_path
        if not video_path.is_absolute():
            video_path = args.project_root / video_path
        video_path = video_path.resolve()
        overrides["target_video_path"] = video_path
        overrides["video_input_dir"] = video_path.parent
    if args.video_id is not None:
        overrides["target_video_id"] = args.video_id
    if args.youtube_url is not None:
        overrides["youtube_url"] = args.youtube_url

    # 如果有覆蓋項，應用覆蓋並返回新配置，否則返回原配置
    return config.with_overrides(**overrides) if overrides else config


def bind_run_output(config: PipelineConfig, job_manager: JobManager) -> PipelineConfig:
    """Point every standard artifact at the Job Manager's versioned run directory."""
    run_output_dir = job_manager.manifest_path.parent.resolve()
    return config.with_overrides(
        run_id=job_manager.run_id,
        run_output_dir=run_output_dir,
        output_dir=run_output_dir,
        normalized_transcript_output_path=run_output_dir / "transcripts_normalized.json",
        chunks_output_path=run_output_dir / "chunks.jsonl",
        text_embeddings_output_path=run_output_dir / "embeddings_text_gemini.jsonl",
        audio_embeddings_output_path=run_output_dir / "embeddings_audio_gemini.jsonl",
        video_embeddings_output_path=run_output_dir / "embeddings_video_gemini.jsonl",
    )


def notify_backend(config, video_id: str, endpoint: str, body: dict | None = None) -> None:
    """通知後端更新影片處理狀態（start / complete / fail）。
    若缺少設定或發生錯誤，只記錄警告不中斷 pipeline。
    """
    if not video_id or not config.backend_url or not config.processing_webhook_secret:
        return
    import json
    url = f"{config.backend_url}/api/v1/internal/videos/{video_id}/processing/{endpoint}"
    req = urllib.request.Request(url, method="POST", data=json.dumps(body or {}).encode())
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Processing-Secret", config.processing_webhook_secret)
    try:
        urllib.request.urlopen(req, timeout=10)
        logger.info("Notified backend: processing/%s (videoId=%s)", endpoint, video_id)
    except Exception as exc:
        logger.warning("Failed to notify backend (%s): %s", endpoint, exc)


def _is_within_directory(path: Path, directory: Path) -> bool:
    try:
        path.resolve().relative_to(directory.resolve())
        return True
    except ValueError:
        return False


def _delete_runtime_file(path: Path, allowed_root: Path) -> bool:
    if not _is_within_directory(path, allowed_root):
        logger.warning("Skipping cleanup outside data dir: %s", path)
        return False

    if not path.exists() or not path.is_file():
        return False

    path.unlink()
    logger.info("Cleaned pipeline artifact: %s", path)
    return True


def _delete_empty_runtime_dirs(paths: list[Path], allowed_root: Path) -> int:
    deleted_count = 0
    for path in sorted({candidate.parent for candidate in paths}, key=lambda item: len(item.parts), reverse=True):
        cursor = path
        while _is_within_directory(cursor, allowed_root) and cursor != allowed_root:
            try:
                cursor.rmdir()
            except OSError:
                break
            deleted_count += 1
            logger.info("Cleaned empty pipeline directory: %s", cursor)
            cursor = cursor.parent
    return deleted_count


def cleanup_after_successful_upload(config: PipelineConfig, output_paths: dict[str, Path], videos: list) -> None:
    """Remove local runtime artifacts after MongoDB upload, when explicitly enabled."""
    if not config.cleanup_after_upload:
        return
    if config.cleanup_keep_checkpoints:
        logger.info("Skipping pipeline cleanup because cleanup_keep_checkpoints=true")
        return

    cleanup_targets: list[Path] = []
    for video in videos:
        cleanup_targets.append(config.project_root / video.audio_path)
        cleanup_targets.append(config.transcript_cache_dir / f"{video.video_id}.json")

    if not config.cleanup_keep_checkpoints and config.run_output_dir is None:
        for output_path in output_paths.values():
            cleanup_targets.append(output_path)
            cleanup_targets.append(output_path.with_suffix(output_path.suffix + ".bak"))

    deleted_count = 0
    for path in cleanup_targets:
        if _delete_runtime_file(path, config.data_dir):
            deleted_count += 1

    deleted_dir_count = _delete_empty_runtime_dirs(cleanup_targets, config.data_dir)

    logger.info(
        "Pipeline cleanup completed: deleted=%s deleted_dirs=%s keep_checkpoints=%s",
        deleted_count,
        deleted_dir_count,
        config.cleanup_keep_checkpoints,
    )


def download_youtube_audio(youtube_url: str, output_path: Path) -> None:
    """使用 yt-dlp 下載 YouTube 音訊並轉成 mono 16kHz WAV（與 Whisper 相容）。"""
    ensure_directory(output_path.parent)
    # yt-dlp 會把副檔名加在 -o 模板後面，所以先去掉 .wav 再用 %(ext)s 帶回
    output_template = str(output_path.with_suffix("")) + ".%(ext)s"
    command = [
        sys.executable,
        "-m",
        "yt_dlp",
        "-x",  # --extract-audio
        "--audio-format", "wav",
        "--postprocessor-args", "ffmpeg:-ac 1 -ar 16000",
        "-o", output_template,
        youtube_url,
    ]
    ffmpeg_location = find_ffmpeg_location()
    if ffmpeg_location:
        command[3:3] = ["--ffmpeg-location", ffmpeg_location]
        logger.info("Using ffmpeg for yt-dlp: %s", ffmpeg_location)

    logger.info("Downloading YouTube audio: %s", youtube_url)
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        raise RuntimeError(
            f"yt-dlp failed for {youtube_url}. stderr: {completed.stderr.strip()}"
        )
    if not output_path.exists():
        raise RuntimeError(
            f"yt-dlp completed but expected audio file not found at {output_path}"
        )
    logger.info("Downloaded YouTube audio -> %s", output_path)


def _register_videos(job_manager: JobManager, videos: list[VideoMetadata]) -> None:
    for video in videos:
        job_manager.add_video(video.video_id, video.file_name, video.file_path)


def _build_scan_placeholders(config: PipelineConfig, limit: int | None) -> list[VideoMetadata]:
    """Register predictable local video IDs before duration probing starts."""
    if config.target_video_path is not None:
        video_paths = [config.target_video_path]
    else:
        video_paths = discover_video_files(config.video_input_dir, config.supported_video_extensions)
        if limit is not None:
            video_paths = video_paths[:limit]

    placeholders: list[VideoMetadata] = []
    for index, video_path in enumerate(video_paths, start=1):
        video_id = (
            config.target_video_id
            if config.target_video_id and len(video_paths) == 1
            else f"video_{index:03d}"
        )
        try:
            file_path = video_path.resolve().relative_to(config.project_root.resolve()).as_posix()
        except ValueError:
            file_path = video_path.resolve().as_posix()
        placeholders.append(
            VideoMetadata(
                video_id=video_id,
                file_name=video_path.name,
                file_path=file_path,
                audio_path="",
                duration_sec=0.0,
                course_name=None,
                week=None,
                lesson=None,
            )
        )
    return placeholders


def _run_tracked_stage(
    job_manager: JobManager,
    videos: list[VideoMetadata],
    stage_name: str,
    action: Callable[[], T],
) -> T:
    """Run one batch operation while recording the same stage for every video."""
    for video in videos:
        job_manager.start_stage(video.video_id, stage_name)

    try:
        result = action()
    except Exception as exc:
        for video in videos:
            job_manager.fail_stage(video.video_id, stage_name, exc)
            job_manager.fail_video(video.video_id, exc)
        job_manager.fail_run(exc)
        raise

    for video in videos:
        job_manager.complete_stage(video.video_id, stage_name)
    return result


def run_pipeline(
    config: PipelineConfig,
    job_manager: JobManager,
    limit: int | None = None,
    resume_plan: ResumePlan | None = None,
) -> tuple[dict[str, Path], list, dict[str, object]]:
    """Execute the full local pipeline from video scan to export."""
    # 記錄管道開始
    logger.info("Starting FocusFlow AI pipeline")
    # 檢查 Gemini 嵌入是否啟用（現在是唯一的嵌入路徑）
    embedding_stages_skipped = (
        resume_plan is not None
        and resume_plan.should_skip("text_embedding")
        and resume_plan.should_skip("audio_embedding")
    )
    if not config.gemini_embedding_enabled and not embedding_stages_skipped:
        raise RuntimeError(
            "Gemini embedding is now the final embedding path. Set ENABLE_GEMINI_EMBEDDING=true in .env."
        )

    resume_data = resume_plan.data if resume_plan is not None else {}
    youtube_extract_done = False

    if resume_plan is not None and resume_plan.should_skip("scan"):
        videos = resume_data["videos"]
    elif config.youtube_url:
        # YouTube 模式：直接下載音訊，跳過影片掃描與本地音訊抽取
        video_id = config.target_video_id or "youtube_unknown"
        audio_rel_posix = f"data/processed_audio/{video_id}.wav"
        audio_abs = (config.project_root / audio_rel_posix).resolve()
        videos = [
            VideoMetadata(
                video_id=video_id,
                file_name="",
                file_path="",
                audio_path=audio_rel_posix,
                duration_sec=0.0,
                course_name=None,
                week=None,
                lesson=None,
                video_source="youtube",
                video_url=config.youtube_url,
            )
        ]
        _register_videos(job_manager, videos)
        job_manager.skip_stage(video_id, "scan")

        def prepare_youtube_audio() -> float:
            if not audio_abs.exists() or config.overwrite_existing:
                download_youtube_audio(config.youtube_url, audio_abs)
            else:
                logger.info("Reusing existing YouTube audio for %s", video_id)
            return get_wav_duration_sec(audio_abs)

        duration_sec = _run_tracked_stage(
            job_manager,
            videos,
            "extract_audio",
            prepare_youtube_audio,
        )
        youtube_extract_done = True
        videos = [
            VideoMetadata(
                video_id=video_id,
                file_name="",
                file_path="",
                audio_path=audio_rel_posix,
                duration_sec=duration_sec,
                course_name=None,
                week=None,
                lesson=None,
                video_source="youtube",
                video_url=config.youtube_url,
            )
        ]
    else:
        # 本地檔案模式：步驟 1 掃描視頻並構建標準化元數據
        scan_placeholders = _build_scan_placeholders(config, limit)
        _register_videos(job_manager, scan_placeholders)
        videos = _run_tracked_stage(
            job_manager,
            scan_placeholders,
            "scan",
            lambda: scan_videos(config),
        )

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

        _register_videos(job_manager, videos)

    if resume_plan is not None and resume_plan.should_skip("extract_audio"):
        logger.info("Checkpoint valid, skipping stage: extract_audio")
    elif not youtube_extract_done:
        # 步驟 2：提取 Whisper 兼容的音頻
        if config.youtube_url and videos and videos[0].video_source == "youtube":
            video = videos[0]
            audio_abs = (config.project_root / video.audio_path).resolve()

            def prepare_resumed_youtube_audio() -> float:
                if not audio_abs.exists() or config.overwrite_existing:
                    download_youtube_audio(config.youtube_url, audio_abs)
                else:
                    logger.info("Reusing existing YouTube audio for %s", video.video_id)
                return get_wav_duration_sec(audio_abs)

            duration_sec = _run_tracked_stage(
                job_manager,
                videos,
                "extract_audio",
                prepare_resumed_youtube_audio,
            )
            videos = [
                VideoMetadata(
                    video_id=video.video_id,
                    file_name=video.file_name,
                    file_path=video.file_path,
                    audio_path=video.audio_path,
                    duration_sec=duration_sec,
                    course_name=video.course_name,
                    week=video.week,
                    lesson=video.lesson,
                    video_source=video.video_source,
                    video_url=video.video_url,
                )
            ]
        else:
            _run_tracked_stage(
                job_manager,
                videos,
                "extract_audio",
                lambda: extract_audio_for_videos(videos, config),
            )
    # 步驟 3：運行 faster-whisper STT
    if resume_plan is not None and resume_plan.should_skip("transcribe"):
        transcripts = resume_data["transcripts"]
    else:
        transcripts = _run_tracked_stage(
            job_manager,
            videos,
            "transcribe",
            lambda: transcribe_videos(videos, config),
        )
    # 步驟 4：在搜索分塊前標準化技術術語
    if resume_plan is not None and resume_plan.should_skip("normalize"):
        normalized_transcripts = resume_data["normalized_transcripts"]
    else:
        normalized_transcripts = _run_tracked_stage(
            job_manager,
            videos,
            "normalize",
            lambda: normalize_transcripts(transcripts, config),
        )
    # 步驟 5：將標準化轉錄段合併為搜索塊
    if resume_plan is not None and resume_plan.should_skip("chunk"):
        chunks = resume_data["chunks"]
    else:
        chunks = _run_tracked_stage(
            job_manager,
            videos,
            "chunk",
            lambda: build_chunks(videos, normalized_transcripts, config),
        )
    # 步驟 6：從標準化塊生成 Gemini 文本嵌入
    if resume_plan is not None and resume_plan.should_skip("text_embedding"):
        text_embeddings = resume_data["text_embeddings"]
    else:
        text_embeddings = _run_tracked_stage(
            job_manager,
            videos,
            "text_embedding",
            lambda: embed_chunks(chunks, config),
        )
    # 步驟 7：直接從提取的音頻文件生成 Gemini 音頻嵌入
    if resume_plan is not None and resume_plan.should_skip("audio_embedding"):
        audio_embeddings = resume_data["audio_embeddings"]
    else:
        audio_embeddings = _run_tracked_stage(
            job_manager,
            videos,
            "audio_embedding",
            lambda: embed_audio_tracks(videos, config),
        )
    # 步驟 8：導出 JSON 和 JSONL 文件供下游團隊使用
    if resume_plan is not None and resume_plan.should_skip("export"):
        output_paths = resume_data["output_paths"]
    else:
        output_paths = _run_tracked_stage(
            job_manager,
            videos,
            "export",
            lambda: export_all_outputs(
                videos,
                transcripts,
                normalized_transcripts,
                chunks,
                text_embeddings,
                audio_embeddings,
                config,
                update_latest=False,
            ),
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
    # 返回輸出文件路徑與影片列表（供 main() 取得 video_id 回報後端）
    pipeline_data: dict[str, object] = {
        "transcripts": transcripts,
        "normalized_transcripts": normalized_transcripts,
        "chunks": chunks,
        "text_embeddings": text_embeddings,
        "audio_embeddings": audio_embeddings,
    }
    return output_paths, videos, pipeline_data


def main() -> int:
    """CLI wrapper that returns a process exit code."""
    # 解析命令行參數
    args = parse_args()
    # 構建運行時配置
    config = build_runtime_config(args)
    # 配置日誌記錄
    configure_logging(config.log_level)
    if args.overwrite and args.resume_run_id:
        logger.error("--overwrite cannot be used together with --resume-run-id")
        print("--overwrite cannot be used together with --resume-run-id", file=sys.stderr)
        return 2

    runs_dir = config.project_root / "data" / "outputs" / "runs"
    chunk_config = build_chunk_config_snapshot(config)
    chunk_config_fingerprint = build_chunk_config_fingerprint(chunk_config)
    resume_plan: ResumePlan | None = None
    try:
        if args.resume_run_id:
            logger.info("Resuming pipeline run: %s", args.resume_run_id)
            job_manager = load_manifest(runs_dir, args.resume_run_id)
            config = bind_run_output(config, job_manager)
            logger.info("Loaded manifest: %s", job_manager.manifest_path)
            resume_plan = build_resume_plan(
                job_manager,
                config.project_root,
                chunk_config,
                chunk_config_fingerprint,
            )
            job_manager.set_chunk_config(chunk_config, chunk_config_fingerprint)
        else:
            job_manager = create_manifest(
                runs_dir,
                chunk_config=chunk_config,
                chunk_config_fingerprint=chunk_config_fingerprint,
            )
            config = bind_run_output(config, job_manager)
    except Exception as exc:
        logger.error("Unable to initialize pipeline run: %s", exc)
        print(f"Unable to initialize pipeline run: {exc}", file=sys.stderr)
        return 1

    logger.info(
        "Pipeline run initialized: run_id=%s run_output_dir=%s",
        config.run_id,
        config.run_output_dir,
    )

    # 通知後端：STT 開始處理（狀態 queued → processing）。
    # 若 resume 已確認 backend_webhook completed，避免重複送出 start 通知。
    should_notify_start = not (
        resume_plan is not None and resume_plan.should_skip("backend_webhook")
    )
    if should_notify_start:
        notify_backend(config, args.video_id, "start")
    else:
        logger.info("Skipping backend start webhook for completed resume run: %s", job_manager.run_id)

    # 嘗試運行管道
    try:
        output_paths, pipeline_videos, pipeline_data = run_pipeline(
            config,
            job_manager,
            limit=args.limit,
            resume_plan=resume_plan,
        )

        # Pipeline 完成後自動上傳結果到 MongoDB
        upload_executed = False
        if resume_plan is not None and resume_plan.should_skip("mongodb_upload"):
            logger.info("Checkpoint valid, skipping stage: mongodb_upload")
        else:
            print("\nStarting MongoDB upload...")
            import mongodb_uploader

            def upload_to_mongodb() -> None:
                try:
                    report = mongodb_uploader.upload_all(config)
                except mongodb_uploader.MongoUploadError as exc:
                    write_upload_summary(
                        config.run_output_dir,
                        job_manager.run_id,
                        exc.report.status,
                        exc,
                        exc.report.to_dict(),
                    )
                    raise
                except Exception:
                    safe_error = "MongoDB upload failed unexpectedly."
                    write_upload_summary(
                        config.run_output_dir,
                        job_manager.run_id,
                        "failed",
                        safe_error,
                        {
                            "errors": [
                                {
                                    "category": "unknown_error",
                                    "message": safe_error,
                                }
                            ]
                        },
                    )
                    raise RuntimeError(safe_error) from None
                write_upload_summary(
                    config.run_output_dir,
                    job_manager.run_id,
                    report.status,
                    details=report.to_dict(),
                )

            _run_tracked_stage(
                job_manager,
                pipeline_videos,
                "mongodb_upload",
                upload_to_mongodb,
            )
            upload_executed = True

        if upload_executed:
            cleanup_after_successful_upload(config, output_paths, pipeline_videos)
        else:
            logger.info("Skipping cleanup because MongoDB upload was not executed in this run")

        # 通知後端：處理全部完成（狀態 processing → completed）
        external_video_id = pipeline_videos[0].video_id if pipeline_videos else None
        duration_sec = pipeline_videos[0].duration_sec if pipeline_videos else None
        if resume_plan is not None and resume_plan.should_skip("backend_webhook"):
            logger.info("Checkpoint valid, skipping stage: backend_webhook")
        elif args.video_id and config.backend_url and config.processing_webhook_secret:
            _run_tracked_stage(
                job_manager,
                pipeline_videos,
                "backend_webhook",
                lambda: notify_backend(config, args.video_id, "complete", {
                    "externalVideoId": external_video_id,
                    "durationSec": duration_sec,
                }),
            )
        else:
            for video in pipeline_videos:
                job_manager.skip_stage(video.video_id, "backend_webhook")

        for video in pipeline_videos:
            job_manager.complete_video(video.video_id)
        job_manager.complete_run()
        export_latest_compatibility_outputs(
            pipeline_videos,
            pipeline_data["transcripts"],
            pipeline_data["normalized_transcripts"],
            pipeline_data["chunks"],
            pipeline_data["text_embeddings"],
            pipeline_data["audio_embeddings"],
            config,
        )
        if resume_plan is not None:
            logger.info("Resume completed successfully: %s", job_manager.run_id)
        write_run_summary(
            config.run_output_dir,
            job_manager.run_id,
            "completed",
            job_manager.manifest["created_at"],
            chunk_config=chunk_config,
            chunk_config_fingerprint=chunk_config_fingerprint,
        )
    # 如果出現異常，通知後端失敗並返回退出碼 1
    except Exception as exc:
        logger.exception("Pipeline failed: %s", exc)
        registered_video_ids = [video["video_id"] for video in job_manager.manifest["videos"]]
        webhook_configured = bool(
            args.video_id and config.backend_url and config.processing_webhook_secret
        )
        if webhook_configured and registered_video_ids:
            for video_id in registered_video_ids:
                job_manager.start_stage(video_id, "backend_webhook")
            notify_backend(config, args.video_id, "fail", {"errorMessage": str(exc)})
            for video_id in registered_video_ids:
                job_manager.complete_stage(video_id, "backend_webhook")
        else:
            notify_backend(config, args.video_id, "fail", {"errorMessage": str(exc)})
            for video_id in registered_video_ids:
                job_manager.skip_stage(video_id, "backend_webhook")

        for video_id in registered_video_ids:
            job_manager.fail_video(video_id, exc)
        job_manager.fail_run(exc)
        if not (config.run_output_dir / "upload_summary.json").exists():
            write_upload_summary(
                config.run_output_dir,
                job_manager.run_id,
                "failed",
                "MongoDB upload was not completed for this run.",
                {
                    "errors": [
                        {
                            "category": "unknown_error",
                            "message": "MongoDB upload was not completed for this run.",
                        }
                    ]
                },
            )
        write_run_summary(
            config.run_output_dir,
            job_manager.run_id,
            "failed",
            job_manager.manifest["created_at"],
            exc,
            chunk_config=chunk_config,
            chunk_config_fingerprint=chunk_config_fingerprint,
        )
        return 1

    # 打印成功消息和輸出路徑
    print("FocusFlow AI pipeline completed successfully.")
    for name, path in output_paths.items():
        print(f"{name}: {path}")
    print(f"manifest: {job_manager.manifest_path}")
    print(f"run_summary: {config.run_output_dir / 'run_summary.json'}")

    # 返回成功退出碼 0
    return 0


if __name__ == "__main__":
    # 作為腳本運行時，退出並返回 main() 的退出碼
    sys.exit(main())
