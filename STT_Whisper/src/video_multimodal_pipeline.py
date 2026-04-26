"""Minimal side-branch pipeline for video multimodal embedding MVP validation."""

from __future__ import annotations

import argparse
import logging
import math
import mimetypes
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path

from config import PipelineConfig
from scan_videos import scan_videos
from utils import (
    configure_logging,
    load_jsonl_file,
    resolve_ffmpeg_binary,
    to_relative_posix,
    utc_timestamp,
    write_jsonl_file,
)


logger = logging.getLogger(__name__)
VIDEO_MODALITY = "video"
STATUS_SUCCESS = "success"
STATUS_REUSED_CHECKPOINT = "reused_checkpoint"
STATUS_FAILED_AFTER_RETRIES = "failed_after_retries"
STATUS_FAILED = "failed"


@dataclass(slots=True)
class VideoClipRecord:
    """One short clip cut from the first source video for multimodal testing."""

    clip_id: str
    video_id: str
    clip_path: str
    start_sec: float
    end_sec: float
    duration_sec: float

    def to_dict(self) -> dict:
        """Convert the clip metadata to a JSON-safe dictionary."""
        # 使用 dataclasses.asdict 將數據類實例轉換為字典
        return asdict(self)


@dataclass(slots=True)
class VideoEmbeddingRecord:
    """One multimodal Gemini embedding result for a short video clip."""

    clip_id: str
    video_id: str
    clip_path: str
    start_sec: float
    end_sec: float
    duration_sec: float
    embedding: list[float]
    embedding_model: str
    embedding_modality: str
    embedding_dim: int
    embedding_timestamp: str
    embedding_status: str
    embedding_error: str | None = None
    embedding_request_id: str | None = None

    def to_dict(self) -> dict:
        """Convert the embedding result to a JSON-safe dictionary."""
        # 將數據類轉換為字典
        payload = asdict(self)
        # 如果沒有錯誤，移除錯誤字段以保持輸出清潔
        if self.embedding_error is None:
            payload.pop("embedding_error")
        # 如果沒有請求ID，移除請求ID字段
        if self.embedding_request_id is None:
            payload.pop("embedding_request_id")
        return payload


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments for the video multimodal branch."""
    # 創建命令行參數解析器，用於視頻多模態分支
    parser = argparse.ArgumentParser(
        description="Split the first video into short clips and try Gemini multimodal video embeddings."
    )
    # 添加項目根目錄參數，默認使用腳本父目錄的父目錄
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Project root directory.",
    )
    # 添加片段持續時間參數，可選覆蓋默認的視頻分塊持續時間
    parser.add_argument(
        "--clip-duration",
        type=int,
        default=None,
        help="Optional override for VIDEO_CHUNK_DURATION_SEC.",
    )
    # 添加覆蓋標誌，如果設置，即使文件存在也要重建片段文件
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Rebuild clip files even if they already exist.",
    )
    # 解析並返回命令行參數
    return parser.parse_args()


def _normalize_vector(values: list[float]) -> list[float]:
    """Normalize a vector to unit length for cosine-style comparisons."""
    # 計算向量的 L2 範數（歐幾里得範數）
    norm = math.sqrt(sum(value * value for value in values))
    # 如果範數為0（零向量），直接返回原向量
    if norm == 0:
        return values
    # 將向量除以其範數，得到單位向量，用於餘弦相似度比較
    return [value / norm for value in values]


def _guess_video_mime_type(video_path: Path) -> str:
    """Guess a MIME type for an MP4 or MOV file."""
    # 使用 mimetypes 模組根據文件擴展名猜測 MIME 類型
    mime_type, _ = mimetypes.guess_type(video_path.name)
    # 如果無法猜測，返回默認的 video/mp4
    return mime_type or "video/mp4"


def _is_rate_limit_error(exc: Exception) -> bool:
    """Detect quota or rate-limit errors from Gemini."""
    # 將異常消息轉換為大寫進行檢查
    message = str(exc).upper()
    # 檢查是否包含資源耗盡或 429 狀態碼的標記
    return "RESOURCE_EXHAUSTED" in message or "429" in message


def _load_gemini_client(config: PipelineConfig):
    """Load the Gemini client with the existing API key."""
    # 檢查是否啟用了 Gemini 視頻嵌入功能
    if not config.gemini_video_embedding_enabled:
        raise RuntimeError("Set ENABLE_GEMINI_VIDEO_EMBEDDING=true before running this side branch.")
    # 檢查是否有 Gemini API 金鑰
    if not config.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is missing in .env.")

    try:
        # 嘗試導入 google-genai 包
        from google import genai
    except ImportError as exc:  # pragma: no cover - depends on local environment
        raise RuntimeError(
            "google-genai is not installed. Run 'pip install -r requirements.txt' first."
        ) from exc

    # 使用 API 金鑰創建 Gemini 客戶端
    client = genai.Client(api_key=config.gemini_api_key)
    # 檢查客戶端是否使用 Vertex AI
    if not getattr(client, "vertexai", False):
        logger.warning(
            "Current Gemini client is not using Vertex AI. Direct multimodal video embedding may be rejected by this backend."
        )
    return client


def _load_checkpoint(config: PipelineConfig) -> dict[str, VideoEmbeddingRecord]:
    """Load successful clip embeddings so reruns can skip completed clips."""
    # 載入成功的片段嵌入，以便重運行時可以跳過已完成的片段
    output_path = config.video_embeddings_output_path
    # 如果輸出文件不存在，返回空字典
    if not output_path.exists():
        return {}

    # 初始化已完成的記錄字典
    completed: dict[str, VideoEmbeddingRecord] = {}
    # 載入 JSONL 文件中的所有記錄
    for record in load_jsonl_file(output_path):
        # 提取嵌入向量
        vector = record.get("embedding", [])
        # 檢查必需的 clip_id 字段
        if not record.get("clip_id"):
            continue
        # 檢查模型名稱是否匹配
        if record.get("embedding_model") != config.gemini_embedding_model_name:
            continue
        # 檢查模態是否為視頻
        if record.get("embedding_modality") != VIDEO_MODALITY:
            continue
        # 檢查嵌入維度是否匹配
        if int(record.get("embedding_dim", 0) or 0) != config.gemini_embedding_output_dim:
            continue
        # 檢查向量是否有效
        if not isinstance(vector, list) or not vector:
            continue

        # 創建 VideoEmbeddingRecord 對象並添加到已完成字典中
        completed[str(record["clip_id"])] = VideoEmbeddingRecord(
            clip_id=str(record["clip_id"]),
            video_id=str(record["video_id"]),
            clip_path=str(record["clip_path"]),
            start_sec=float(record["start_sec"]),
            end_sec=float(record["end_sec"]),
            duration_sec=float(record["duration_sec"]),
            embedding=[float(value) for value in vector],
            embedding_model=str(record["embedding_model"]),
            embedding_modality=str(record["embedding_modality"]),
            embedding_dim=int(record["embedding_dim"]),
            embedding_timestamp=str(record.get("embedding_timestamp", utc_timestamp())),
            embedding_status=STATUS_REUSED_CHECKPOINT,
            embedding_error=None,
            embedding_request_id=(
                str(record["embedding_request_id"])
                if record.get("embedding_request_id") is not None
                else None
            ),
        )
    return completed


def split_first_video(config: PipelineConfig) -> tuple[dict, list[VideoClipRecord]]:
    """Split only the first scanned video into <=120 second clips."""
    # 只將掃描到的第一個視頻分割成 <=120 秒的片段
    # 掃描視頻目錄中的視頻文件
    videos = scan_videos(config)
    # 確定處理的最大文件數，至少為1
    max_files = max(config.video_max_files_per_run, 1)
    # 選擇要處理的目標視頻（前 max_files 個）
    target_videos = videos[:max_files]
    # 如果沒有找到支持的視頻文件，拋出異常
    if not target_videos:
        raise FileNotFoundError(f"No supported video files were found in {config.video_input_dir}.")

    # 解析 FFmpeg 二進制路徑
    ffmpeg_binary = resolve_ffmpeg_binary(config.ffmpeg_binary)
    # 確定片段持續時間，至少為1秒
    clip_duration = max(config.video_chunk_duration_sec, 1)
    # 初始化片段記錄列表
    clip_records: list[VideoClipRecord] = []

    # 遍歷目標視頻進行分割
    for video in target_videos:
        # 解析輸入視頻的絕對路徑
        input_path = (config.project_root / video.file_path).resolve()
        # 計算需要分割的總片段數
        total_parts = max(1, math.ceil(video.duration_sec / clip_duration))
        logger.info(
            "Splitting %s (%s) into %s clips of %s seconds or less",
            video.video_id,
            input_path.name,
            total_parts,
            clip_duration,
        )

        # 為每個片段創建剪輯
        for part_index in range(total_parts):
            # 計算片段的開始和結束時間
            start_sec = part_index * clip_duration
            end_sec = min((part_index + 1) * clip_duration, video.duration_sec)
            # 計算片段持續時間
            duration_sec = round(end_sec - start_sec, 3)
            # 生成片段ID
            clip_id = f"{video.video_id}_part_{part_index + 1:04d}"
            # 確定片段輸出路徑
            clip_path = config.video_multimodal_chunk_dir / f"{clip_id}.mp4"

            # 如果片段已存在且不覆蓋，記錄重用信息
            if clip_path.exists() and not config.overwrite_existing:
                logger.info("[Video Split] Reusing existing clip %s", clip_id)
            else:
                # 構建 FFmpeg 命令進行視頻剪輯
                command = [
                    ffmpeg_binary,
                    "-y",  # 覆蓋輸出文件
                    "-ss", str(start_sec),  # 開始時間
                    "-i", str(input_path),  # 輸入文件
                    "-t", str(duration_sec),  # 持續時間
                    "-c:v", "libx264",  # 視頻編碼器
                    "-preset", "veryfast",  # 編碼預設
                    "-crf", "23",  # 質量設置
                    "-c:a", "aac",  # 音頻編碼器
                    "-movflags", "+faststart",  # MP4 優化
                    str(clip_path),  # 輸出文件
                ]
                logger.info(
                    "[Video Split] clip_id=%s start_sec=%.3f end_sec=%.3f duration_sec=%.3f",
                    clip_id,
                    start_sec,
                    end_sec,
                    duration_sec,
                )
                # 執行 FFmpeg 命令
                subprocess.run(command, check=True, capture_output=True, text=True)

            # 創建片段記錄並添加到列表中
            clip_records.append(
                VideoClipRecord(
                    clip_id=clip_id,
                    video_id=video.video_id,
                    clip_path=to_relative_posix(clip_path, config.project_root),
                    start_sec=round(start_sec, 3),
                    end_sec=round(end_sec, 3),
                    duration_sec=duration_sec,
                )
            )

    # 返回第一個視頻的信息和所有片段記錄
    return target_videos[0].to_dict(), clip_records


def _persist_partial_results(
    clip_records: list[VideoClipRecord],
    records_by_clip: dict[str, VideoEmbeddingRecord],
    config: PipelineConfig,
) -> None:
    """Write the currently known clip embedding results so partial success is preserved."""
    # 寫入當前已知的片段嵌入結果，以便保存部分成功
    # 按照片段順序整理記錄
    ordered_records = [
        records_by_clip[clip_record.clip_id].to_dict()
        for clip_record in clip_records
        if clip_record.clip_id in records_by_clip
    ]
    # 將記錄寫入 JSONL 文件
    write_jsonl_file(
        config.video_embeddings_output_path,
        ordered_records,
        backup_existing=config.backup_existing_outputs,
    )


def embed_video_clips(
    clip_records: list[VideoClipRecord],
    config: PipelineConfig,
) -> list[VideoEmbeddingRecord]:
    """Try Gemini multimodal embedding on the split video clips."""
    # 嘗試對分割的視頻片段進行 Gemini 多模態嵌入
    # 如果沒有片段記錄，直接返回空列表
    if not clip_records:
        return []

    # 導入必要的 Gemini 類型
    from google.genai import types

    # 載入 Gemini 客戶端
    client = _load_gemini_client(config)
    # 載入檢查點記錄（已完成的嵌入）
    checkpoint_records = _load_checkpoint(config)
    # 初始化按片段ID索引的記錄字典
    records_by_clip: dict[str, VideoEmbeddingRecord] = {}

    # 遍歷每個片段進行嵌入
    for clip_record in clip_records:
        # 檢查是否有檢查點記錄且路徑匹配
        checkpoint_record = checkpoint_records.get(clip_record.clip_id)
        if checkpoint_record is not None and checkpoint_record.clip_path == clip_record.clip_path:
            # 重用檢查點記錄
            records_by_clip[clip_record.clip_id] = checkpoint_record
            logger.info("[Video Embed Resume] clip_id=%s status=%s", clip_record.clip_id, STATUS_REUSED_CHECKPOINT)
            continue

        # 解析片段文件的絕對路徑
        clip_path = (config.project_root / clip_record.clip_path).resolve()
        # 初始化嘗試次數
        attempt_number = 0

        # 重試循環
        while True:
            # 記錄請求時間戳
            request_timestamp = utc_timestamp()
            try:
                # 記錄嵌入開始信息
                logger.info(
                    "[Video Embed] clip_id=%s duration_sec=%.3f start_sec=%.3f end_sec=%.3f",
                    clip_record.clip_id,
                    clip_record.duration_sec,
                    clip_record.start_sec,
                    clip_record.end_sec,
                )
                # 上傳視頻文件到 Gemini
                uploaded_file = client.files.upload(file=str(clip_path))
                # 請求嵌入
                response = client.models.embed_content(
                    model=config.gemini_embedding_model_name,
                    contents=[
                        types.Content(
                            parts=[
                                types.Part.from_uri(
                                    file_uri=uploaded_file.uri,
                                    mime_type=uploaded_file.mime_type or _guess_video_mime_type(clip_path),
                                )
                            ]
                        )
                    ],
                    config=types.EmbedContentConfig(
                        output_dimensionality=config.gemini_embedding_output_dim,
                    ),
                )
                # 規範化嵌入向量
                embedding = _normalize_vector([float(value) for value in response.embeddings[0].values])
                # 創建嵌入記錄
                records_by_clip[clip_record.clip_id] = VideoEmbeddingRecord(
                    clip_id=clip_record.clip_id,
                    video_id=clip_record.video_id,
                    clip_path=clip_record.clip_path,
                    start_sec=clip_record.start_sec,
                    end_sec=clip_record.end_sec,
                    duration_sec=clip_record.duration_sec,
                    embedding=embedding,
                    embedding_model=config.gemini_embedding_model_name,
                    embedding_modality=VIDEO_MODALITY,
                    embedding_dim=len(embedding),
                    embedding_timestamp=request_timestamp,
                    embedding_status=STATUS_SUCCESS,
                    embedding_request_id=getattr(response, "request_id", None),
                )
                # 記錄成功信息
                logger.info(
                    "[Video Embed] clip_id=%s model=%s modality=%s dim=%s status=%s",
                    clip_record.clip_id,
                    config.gemini_embedding_model_name,
                    VIDEO_MODALITY,
                    len(embedding),
                    STATUS_SUCCESS,
                )
                # 保存部分結果
                _persist_partial_results(clip_records, records_by_clip, config)
                break
            except Exception as exc:
                # 檢測是否為速率限制錯誤
                is_rate_limited = _is_rate_limit_error(exc)
                # 如果是速率限制且未超過最大重試次數，則重試
                if is_rate_limited and attempt_number < config.gemini_max_retries:
                    attempt_number += 1
                    logger.warning(
                        "[Video Embed Retry] clip_id=%s attempt=%s sleep=%ss reason=429",
                        clip_record.clip_id,
                        attempt_number,
                        config.gemini_retry_sleep_sec,
                    )
                    # 等待重試間隔
                    time.sleep(config.gemini_retry_sleep_sec)
                    continue

                # 確定最終狀態（重試失敗或一般失敗）
                status = STATUS_FAILED_AFTER_RETRIES if is_rate_limited else STATUS_FAILED
                # 創建失敗記錄
                records_by_clip[clip_record.clip_id] = VideoEmbeddingRecord(
                    clip_id=clip_record.clip_id,
                    video_id=clip_record.video_id,
                    clip_path=clip_record.clip_path,
                    start_sec=clip_record.start_sec,
                    end_sec=clip_record.end_sec,
                    duration_sec=clip_record.duration_sec,
                    embedding=[],  # 失敗時嵌入向量為空
                    embedding_model=config.gemini_embedding_model_name,
                    embedding_modality=VIDEO_MODALITY,
                    embedding_dim=config.gemini_embedding_output_dim,
                    embedding_timestamp=request_timestamp,
                    embedding_status=status,
                    embedding_error=str(exc),  # 記錄錯誤信息
                )
                # 記錄失敗信息
                logger.warning(
                    "[Video Embed Failed] clip_id=%s status=%s reason=%s",
                    clip_record.clip_id,
                    status,
                    exc,
                )
                # 保存部分結果
                _persist_partial_results(clip_records, records_by_clip, config)
                break

    # 返回按片段順序排列的嵌入記錄列表
    return [records_by_clip[clip_record.clip_id] for clip_record in clip_records]


def build_runtime_config(args: argparse.Namespace) -> PipelineConfig:
    """Load config and apply CLI overrides for the video side branch."""
    # 載入配置並應用 CLI 覆蓋，用於視頻側分支
    # 從環境變數載入基礎配置
    config = PipelineConfig.from_env(project_root=args.project_root.resolve())
    # 初始化覆蓋字典
    overrides: dict[str, object] = {}
    # 如果指定了片段持續時間，添加到覆蓋
    if args.clip_duration is not None:
        overrides["video_chunk_duration_sec"] = args.clip_duration
    # 如果設置了覆蓋標誌，添加到覆蓋
    if args.overwrite:
        overrides["overwrite_existing"] = True
    # 如果有覆蓋，應用它們；否則返回原始配置
    return config.with_overrides(**overrides) if overrides else config


def main() -> int:
    """Run the minimal video multimodal embedding branch."""
    # 運行最小的視頻多模態嵌入分支
    # 解析命令行參數
    args = parse_args()
    # 構建運行時配置
    config = build_runtime_config(args)
    # 配置日誌記錄
    configure_logging(config.log_level)

    try:
        # 分割第一個視頻並獲取片段記錄
        first_video, clip_records = split_first_video(config)
        # 對片段進行嵌入處理
        embedding_records = embed_video_clips(clip_records, config)
    except Exception as exc:
        # 記錄異常並返回錯誤代碼
        logger.exception("Video multimodal branch failed: %s", exc)
        return 1

    # 計算成功和失敗的嵌入數
    success_count = sum(1 for record in embedding_records if record.embedding_status in {STATUS_SUCCESS, STATUS_REUSED_CHECKPOINT})
    failed_count = len(embedding_records) - success_count
    # 輸出完成摘要
    print("Video multimodal branch completed.")
    print(f"video_id: {first_video['video_id']}")
    print(f"clips: {len(clip_records)}")
    print(f"successful_embeddings: {success_count}")
    print(f"failed_embeddings: {failed_count}")
    print(f"output: {config.video_embeddings_output_path}")
    # 返回成功代碼
    return 0


if __name__ == "__main__":
    # 當腳本直接執行時，運行主函數並以其返回值退出
    raise SystemExit(main())
