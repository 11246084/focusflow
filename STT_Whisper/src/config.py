"""Configuration layer for the FocusFlow AI pipeline."""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from pathlib import Path

from dotenv import load_dotenv

from utils import ensure_directory


@dataclass(slots=True)
class PipelineConfig:
    """Centralized runtime settings loaded from env and CLI overrides."""

    # 項目根目錄路徑
    project_root: Path
    # 視頻輸入目錄路徑
    video_input_dir: Path
    # 數據目錄路徑
    data_dir: Path
    # 處理後音頻目錄路徑
    processed_audio_dir: Path
    # 輸出目錄路徑
    output_dir: Path
    # 緩存目錄路徑
    cache_dir: Path
    # 轉錄緩存目錄路徑
    transcript_cache_dir: Path
    # 視頻多模態塊目錄路徑
    video_multimodal_chunk_dir: Path
    # 術語字典路徑
    term_dictionary_path: Path
    # 標準化轉錄輸出路徑
    normalized_transcript_output_path: Path
    # 塊輸出路徑
    chunks_output_path: Path
    # 文本嵌入輸出路徑
    text_embeddings_output_path: Path
    # 音頻嵌入輸出路徑
    audio_embeddings_output_path: Path
    # 視頻嵌入輸出路徑
    video_embeddings_output_path: Path
    # 支持的視頻擴展名元組
    supported_video_extensions: tuple[str, ...]
    # FFmpeg 二進制路徑（可選）
    ffmpeg_binary: str | None
    # Whisper 模型大小
    whisper_model_size: str
    # Whisper 設備（CPU/GPU）
    whisper_device: str
    # Whisper 計算類型
    whisper_compute_type: str
    # Whisper 語言（可選）
    whisper_language: str | None
    # Whisper 束搜索大小
    whisper_beam_size: int
    # Whisper VAD 過濾器是否啟用
    whisper_vad_filter: bool
    # 塊最大字符數
    chunk_max_chars: int
    # 塊最大段數
    chunk_max_segments: int
    # 塊最大持續時間（秒）
    chunk_max_duration_sec: float
    # 模糊匹配閾值
    fuzzy_threshold: int
    # Gemini 嵌入是否啟用
    gemini_embedding_enabled: bool
    # Gemini 視頻嵌入是否啟用
    gemini_video_embedding_enabled: bool
    # Gemini API 金鑰（可選）
    gemini_api_key: str | None
    # Gemini 嵌入模型名稱
    gemini_embedding_model_name: str
    # Gemini 嵌入輸出維度
    gemini_embedding_output_dim: int
    # Gemini 嵌入批次大小
    gemini_embedding_batch_size: int
    # Gemini 最大重試次數
    gemini_max_retries: int
    # Gemini 重試睡眠時間（秒）
    gemini_retry_sleep_sec: int
    # Gemini 每次運行最大塊數（可選）
    gemini_max_chunks_per_run: int | None
    # 視頻塊持續時間（秒）
    video_chunk_duration_sec: int
    # 每次運行最大文件數
    video_max_files_per_run: int
    # MongoDB URI（可選）
    mongodb_uri: str | None
    # MongoDB 數據庫名稱
    mongodb_database_name: str
    # MongoDB 視頻集合名稱
    mongodb_videos_collection: str
    # MongoDB 轉錄集合名稱
    mongodb_transcripts_collection: str
    # MongoDB 塊集合名稱
    mongodb_chunks_collection: str
    # MongoDB 文本嵌入集合名稱
    mongodb_text_embeddings_collection: str
    # MongoDB 視頻嵌入集合名稱
    mongodb_video_embeddings_collection: str
    # MongoDB 批量批次大小
    mongodb_bulk_batch_size: int
    # 是否覆蓋現有文件
    overwrite_existing: bool
    # 是否備份現有輸出
    backup_existing_outputs: bool
    # 日誌級別
    log_level: str
    # 後端伺服器 URL，用於回報影片處理狀態
    backend_url: str
    # 後端內部 Webhook 驗證 Secret
    processing_webhook_secret: str | None
    # 指定單一影片路徑（由後端觸發時傳入，None 表示掃描整個 video_input_dir）
    target_video_path: Path | None
    # 由後端傳入的 MongoDB Video._id，作為本次處理的 video_id（確保每支影片有唯一 ID）
    target_video_id: str | None

    @classmethod
    def from_env(cls, project_root: Path | None = None) -> "PipelineConfig":
        """Build the config object from .env values plus sane defaults."""
        # 解析項目根目錄：默認為當前文件的父目錄的父目錄（即倉庫根目錄），以便直接運行 python src/main.py
        resolved_root = (project_root or Path(__file__).resolve().parents[1]).resolve()
        # 設置 .env 文件路徑
        env_file = resolved_root / ".env"

        # 如果 .env 文件存在，則加載它；否則加載默認環境變數
        if env_file.exists():
            load_dotenv(env_file)
        else:
            load_dotenv()

        # 設置數據目錄，默認為 "data"
        data_dir = resolved_root / os.getenv("DATA_DIR", "data")
        # 設置處理後音頻目錄，默認為 "data/processed_audio"
        processed_audio_dir = resolved_root / os.getenv("PROCESSED_AUDIO_DIR", "data/processed_audio")
        # 設置輸出目錄，默認為 "data/outputs"
        output_dir = resolved_root / os.getenv("OUTPUT_DIR", "data/outputs")
        # 設置緩存目錄，默認為 "data/cache"
        cache_dir = resolved_root / os.getenv("CACHE_DIR", "data/cache")
        # 設置轉錄緩存目錄，為緩存目錄下的 "transcripts"
        transcript_cache_dir = cache_dir / "transcripts"
        # 設置視頻多模態塊目錄，默認為 "data/video_multimodal_chunks"
        video_multimodal_chunk_dir = resolved_root / os.getenv(
            "VIDEO_MULTIMODAL_CHUNK_DIR",
            "data/video_multimodal_chunks",
        )
        # 設置術語字典路徑，默認為 "data/term_dictionary.json"
        term_dictionary_path = resolved_root / os.getenv("TERM_DICTIONARY_PATH", "data/term_dictionary.json")
        # 設置標準化轉錄輸出路徑，默認為 "data/outputs/transcripts_normalized.json"
        normalized_transcript_output_path = resolved_root / os.getenv(
            "NORMALIZED_TRANSCRIPT_OUTPUT_PATH",
            "data/outputs/transcripts_normalized.json",
        )
        # 設置塊輸出路徑，默認為 "data/outputs/chunks.jsonl"
        chunks_output_path = resolved_root / os.getenv("CHUNKS_OUTPUT_PATH", "data/outputs/chunks.jsonl")
        # 設置文本嵌入輸出路徑，默認為 "data/outputs/embeddings_text_gemini.jsonl"
        text_embeddings_output_path = resolved_root / os.getenv(
            "TEXT_EMBEDDINGS_OUTPUT_PATH",
            "data/outputs/embeddings_text_gemini.jsonl",
        )
        # 設置音頻嵌入輸出路徑，默認為 "data/outputs/embeddings_audio_gemini.jsonl"
        audio_embeddings_output_path = resolved_root / os.getenv(
            "AUDIO_EMBEDDINGS_OUTPUT_PATH",
            "data/outputs/embeddings_audio_gemini.jsonl",
        )
        # 設置視頻嵌入輸出路徑，默認為 "data/outputs/embeddings_video_gemini.jsonl"
        video_embeddings_output_path = resolved_root / os.getenv(
            "VIDEO_EMBEDDINGS_OUTPUT_PATH",
            "data/outputs/embeddings_video_gemini.jsonl",
        )

        # 使用收集的路徑創建 PipelineConfig 實例
        config = cls(
            project_root=resolved_root,
            # 設置視頻輸入目錄，默認為 "Test_video_file"
            video_input_dir=resolved_root / os.getenv("VIDEO_INPUT_DIR", "Test_video_file"),
            data_dir=data_dir,
            processed_audio_dir=processed_audio_dir,
            output_dir=output_dir,
            cache_dir=cache_dir,
            transcript_cache_dir=transcript_cache_dir,
            video_multimodal_chunk_dir=video_multimodal_chunk_dir,
            term_dictionary_path=term_dictionary_path,
            normalized_transcript_output_path=normalized_transcript_output_path,
            chunks_output_path=chunks_output_path,
            text_embeddings_output_path=text_embeddings_output_path,
            audio_embeddings_output_path=audio_embeddings_output_path,
            video_embeddings_output_path=video_embeddings_output_path,
            # 支持的視頻擴展名固定為元組
            supported_video_extensions=(".mp4", ".mov", ".mkv"),
            # FFmpeg 二進制路徑從環境變數獲取
            ffmpeg_binary=os.getenv("FFMPEG_BINARY"),
            # Whisper 模型大小，默認 "small"
            whisper_model_size=os.getenv("WHISPER_MODEL_SIZE", "small"),
            # Whisper 設備，默認 "cpu"
            whisper_device=os.getenv("WHISPER_DEVICE", "cpu"),
            # Whisper 計算類型，默認 "int8"
            whisper_compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "int8"),
            # Whisper 語言，可選
            whisper_language=os.getenv("WHISPER_LANGUAGE") or None,
            # Whisper 束搜索大小，默認 5，轉換為整數
            whisper_beam_size=int(os.getenv("WHISPER_BEAM_SIZE", "5")),
            # Whisper VAD 過濾器，默認 true，轉換為布爾值
            whisper_vad_filter=os.getenv("WHISPER_VAD_FILTER", "true").lower() == "true",
            # 塊最大字符數，默認 220，轉換為整數
            chunk_max_chars=int(os.getenv("CHUNK_MAX_CHARS", "220")),
            # 塊最大段數，默認 6，轉換為整數
            chunk_max_segments=int(os.getenv("CHUNK_MAX_SEGMENTS", "6")),
            # 塊最大持續時間，默認 45.0，轉換為浮點數
            chunk_max_duration_sec=float(os.getenv("CHUNK_MAX_DURATION_SEC", "45")),
            # 模糊匹配閾值，默認 85，轉換為整數
            fuzzy_threshold=int(os.getenv("FUZZY_THRESHOLD", "85")),
            # Gemini 嵌入是否啟用，默認 false，轉換為布爾值
            gemini_embedding_enabled=os.getenv("ENABLE_GEMINI_EMBEDDING", "false").lower() == "true",
            # Gemini 視頻嵌入是否啟用，默認 false，轉換為布爾值
            gemini_video_embedding_enabled=os.getenv("ENABLE_GEMINI_VIDEO_EMBEDDING", "false").lower() == "true",
            # Gemini API 金鑰，可選
            gemini_api_key=os.getenv("GEMINI_API_KEY") or None,
            # Gemini 嵌入模型名稱，默認 "gemini-embedding-2-preview"
            gemini_embedding_model_name=os.getenv("GEMINI_EMBEDDING_MODEL_NAME", "gemini-embedding-2-preview"),
            # Gemini 嵌入輸出維度，默認 3072，轉換為整數
            gemini_embedding_output_dim=int(os.getenv("GEMINI_EMBEDDING_OUTPUT_DIM", "3072")),
            # Gemini 嵌入批次大小，默認 16，轉換為整數
            gemini_embedding_batch_size=int(os.getenv("GEMINI_EMBEDDING_BATCH_SIZE", "16")),
            # Gemini 最大重試次數，默認 3，轉換為整數
            gemini_max_retries=int(os.getenv("GEMINI_MAX_RETRIES", "3")),
            # Gemini 重試睡眠時間，默認 20，轉換為整數
            gemini_retry_sleep_sec=int(os.getenv("GEMINI_RETRY_SLEEP_SEC", "20")),
            # Gemini 每次運行最大塊數，可選，如果設置則轉換為整數
            gemini_max_chunks_per_run=(
                int(os.getenv("GEMINI_MAX_CHUNKS_PER_RUN"))
                if os.getenv("GEMINI_MAX_CHUNKS_PER_RUN")
                else None
            ),
            # 視頻塊持續時間，默認 120，轉換為整數
            video_chunk_duration_sec=int(os.getenv("VIDEO_CHUNK_DURATION_SEC", "120")),
            # 每次運行最大文件數，默認 1，轉換為整數
            video_max_files_per_run=int(os.getenv("VIDEO_MAX_FILES_PER_RUN", "1")),
            # MongoDB URI，可選
            mongodb_uri=os.getenv("MONGODB_URI") or None,
            # MongoDB 數據庫名稱，默認 "focusflow"
            mongodb_database_name=os.getenv("MONGODB_DATABASE_NAME", "focusflow"),
            # MongoDB 視頻集合名稱，默認 "videos"
            mongodb_videos_collection=os.getenv("MONGODB_VIDEOS_COLLECTION", "videos"),
            # MongoDB 轉錄集合名稱，默認 "transcripts_normalized"
            mongodb_transcripts_collection=os.getenv("MONGODB_TRANSCRIPTS_COLLECTION", "transcripts_normalized"),
            # MongoDB 塊集合名稱，默認 "video_segments_text"
            mongodb_chunks_collection=os.getenv("MONGODB_CHUNKS_COLLECTION", "video_segments_text"),
            # MongoDB 文本嵌入集合名稱，默認 "video_segments_text"
            mongodb_text_embeddings_collection=os.getenv(
                "MONGODB_TEXT_EMBEDDINGS_COLLECTION",
                "video_segments_text",
            ),
            # MongoDB 視頻嵌入集合名稱，默認 "video_segments_video"
            mongodb_video_embeddings_collection=os.getenv(
                "MONGODB_VIDEO_EMBEDDINGS_COLLECTION",
                "video_segments_video",
            ),
            # MongoDB 批量批次大小，默認 200，轉換為整數
            mongodb_bulk_batch_size=int(os.getenv("MONGODB_BULK_BATCH_SIZE", "200")),
            # 是否覆蓋現有文件，默認 false，轉換為布爾值
            overwrite_existing=os.getenv("OVERWRITE_EXISTING", "false").lower() == "true",
            # 是否備份現有輸出，默認 true，轉換為布爾值
            backup_existing_outputs=os.getenv("BACKUP_EXISTING_OUTPUTS", "true").lower() == "true",
            # 日誌級別，默認 "INFO"
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            # 後端伺服器 URL，預設本機 4000 port
            backend_url=os.getenv("BACKEND_URL", "http://localhost:4000"),
            # 後端 Webhook Secret，與後端 .env 的 PROCESSING_WEBHOOK_SECRET 一致
            processing_webhook_secret=os.getenv("PROCESSING_WEBHOOK_SECRET") or None,
            # 單一影片路徑，由 CLI 參數傳入，預設 None（掃描整個目錄）
            target_video_path=None,
            # 由後端傳入的 MongoDB Video._id，作為本次處理的 video_id
            target_video_id=None,
        )

        # 提前創建運行時目錄，以保持下游模塊簡單
        config.ensure_runtime_directories()
        # 返回配置對象
        return config

    def ensure_runtime_directories(self) -> None:
        """Create all directories that the pipeline needs before execution."""
        # 確保視頻輸入目錄存在
        ensure_directory(self.video_input_dir)
        # 確保數據目錄存在
        ensure_directory(self.data_dir)
        # 確保處理後音頻目錄存在
        ensure_directory(self.processed_audio_dir)
        # 確保輸出目錄存在
        ensure_directory(self.output_dir)
        # 確保緩存目錄存在
        ensure_directory(self.cache_dir)
        # 確保轉錄緩存目錄存在
        ensure_directory(self.transcript_cache_dir)
        # 確保視頻多模態塊目錄存在
        ensure_directory(self.video_multimodal_chunk_dir)
        # 確保術語字典路徑的父目錄存在
        ensure_directory(self.term_dictionary_path.parent)
        # 確保標準化轉錄輸出路徑的父目錄存在
        ensure_directory(self.normalized_transcript_output_path.parent)
        # 確保塊輸出路徑的父目錄存在
        ensure_directory(self.chunks_output_path.parent)
        # 確保文本嵌入輸出路徑的父目錄存在
        ensure_directory(self.text_embeddings_output_path.parent)
        # 確保音頻嵌入輸出路徑的父目錄存在
        ensure_directory(self.audio_embeddings_output_path.parent)
        # 確保視頻嵌入輸出路徑的父目錄存在
        ensure_directory(self.video_embeddings_output_path.parent)

    def with_overrides(self, **overrides: object) -> "PipelineConfig":
        """Create a modified config copy for CLI overrides."""
        # 使用 dataclass replace 創建修改後的配置副本，保持覆蓋流程可讀和明確
        updated_config = replace(self, **overrides)
        # 確保更新後的配置也有運行時目錄
        updated_config.ensure_runtime_directories()
        # 返回更新後的配置
        return updated_config
