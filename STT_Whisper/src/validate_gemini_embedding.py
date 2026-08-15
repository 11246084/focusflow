"""Validate Gemini embedding outputs for text chunks or audio tracks."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

from config import PipelineConfig
from embedding_contract import (
    GEMINI_EMBEDDING_CONTRACT_VERSION,
    GEMINI_EMBEDDING_GENERATION_VERSION,
    GEMINI_EMBEDDING_INSTRUCTION_VERSION,
    GEMINI_EMBEDDING_NORMALIZATION_VERSION,
    GEMINI_EMBEDDING_TASK_TYPE,
)


TEXT_REQUIRED_FIELDS = (
    "chunk_id",
    "video_id",
    "start_sec",
    "end_sec",
    "text",
    "embedding",
    "embedding_model",
    "embedding_modality",
    "embedding_dim",
    "embedding_timestamp",
    "embedding_status",
    "embedding_provider",
    "embedding_task_type",
    "embedding_instruction_version",
    "embedding_generation_version",
    "embedding_normalization_version",
    "embedding_contract_version",
    "embedding_schema_version",
)

AUDIO_REQUIRED_FIELDS = (
    "video_id",
    "audio_path",
    "embedding",
    "embedding_model",
    "embedding_modality",
    "embedding_dim",
    "embedding_timestamp",
    "embedding_status",
)


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments for the Gemini validation helper."""
    # 創建命令行參數解析器，用於驗證 Gemini 嵌入的工具
    parser = argparse.ArgumentParser(description="Validate Gemini embedding metadata and vectors.")
    # 添加文件路徑參數，指定要驗證的 Gemini 嵌入 JSONL 文件
    parser.add_argument(
        "--file",
        type=Path,
        default=None,
        help="Path to a Gemini embedding JSONL file. Defaults to text embeddings.",
    )
    # 添加模態參數，選擇驗證文本分塊嵌入還是音頻軌道嵌入
    parser.add_argument(
        "--modality",
        choices=("text", "audio"),
        default="text",
        help="Validate text chunk embeddings or audio track embeddings.",
    )
    # 添加項目根目錄參數，默認使用腳本父目錄的父目錄
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Project root directory.",
    )
    # 添加預期模型名稱參數，可選覆蓋默認的 Gemini 模型名稱
    parser.add_argument(
        "--expected-model",
        default=None,
        help="Optional expected Gemini model name override.",
    )
    # 添加預期嵌入維度參數，可選覆蓋默認的 Gemini 嵌入維度
    parser.add_argument(
        "--expected-dim",
        type=int,
        default=None,
        help="Optional expected Gemini embedding dimension override.",
    )
    # 解析並返回命令行參數
    return parser.parse_args()


def load_records(file_path: Path) -> list[dict]:
    """Load embedding records from JSONL."""
    # 從 JSONL 文件中載入嵌入記錄
    # 讀取文件內容，處理 UTF-8 BOM（位元組順序標記）
    # 按行分割，過濾空行，每行解析為 JSON 對象
    return [
        json.loads(line)
        for line in file_path.read_text(encoding="utf-8-sig").splitlines()
        if line.strip()
    ]


def main() -> int:
    """Run a lightweight validation over Gemini embedding records."""
    # 運行輕量級驗證來檢查 Gemini 嵌入記錄
    # 解析命令行參數
    args = parse_args()
    # 解析項目根目錄路徑
    project_root = args.project_root.resolve()
    # 從環境變數載入管道配置
    config = PipelineConfig.from_env(project_root=project_root)
    # 確定預期的模型名稱（使用參數覆蓋或配置默認值）
    expected_model = args.expected_model or config.gemini_embedding_model_name
    # 確定預期的嵌入維度（使用參數覆蓋或配置默認值）
    expected_dim = args.expected_dim or config.gemini_embedding_output_dim

    # 根據模態確定默認文件路徑
    default_file = (
        config.text_embeddings_output_path
        if args.modality == "text"
        else config.audio_embeddings_output_path
    )
    # 確定要驗證的文件路徑（使用參數或默認值）
    file_path = args.file or default_file
    # 如果路徑不是絕對路徑，轉換為基於項目根目錄的絕對路徑
    if not file_path.is_absolute():
        file_path = (project_root / file_path).resolve()

    # 檢查文件是否存在
    if not file_path.exists():
        raise FileNotFoundError(f"Gemini embedding file was not found: {file_path}")

    # 根據模態確定必需的字段
    required_fields = TEXT_REQUIRED_FIELDS if args.modality == "text" else AUDIO_REQUIRED_FIELDS
    # 載入所有記錄
    records = load_records(file_path)
    # 初始化驗證結果變數
    missing_fields: set[str] = set()
    invalid_records: list[str] = []
    models: list[str] = []
    modalities: list[str] = []
    dims: list[int] = []
    status_counts: Counter[str] = Counter()

    # 遍歷所有記錄進行驗證
    for record in records:
        # 檢查必需字段是否存在
        for field_name in required_fields:
            if field_name not in record:
                missing_fields.add(field_name)

        # 提取記錄標識符（chunk_id 或 video_id）
        record_id = str(record.get("chunk_id") or record.get("video_id") or "")
        # 提取視頻 ID
        video_id = str(record.get("video_id", ""))
        # 提取嵌入模型名稱
        embedding_model = str(record.get("embedding_model", ""))
        # 提取嵌入模態
        embedding_modality = str(record.get("embedding_modality", ""))
        # 提取嵌入維度
        embedding_dim = int(record.get("embedding_dim", 0) or 0)
        # 提取嵌入狀態
        embedding_status = str(record.get("embedding_status", ""))
        # 提取嵌入向量
        vector = record.get("embedding", [])

        # 收集統計信息
        models.append(embedding_model)
        modalities.append(embedding_modality)
        dims.append(embedding_dim)
        status_counts[embedding_status] += 1

        # 驗證嵌入向量格式
        if not isinstance(vector, list):
            invalid_records.append(f"{record_id}: embedding is not a list")
        elif vector and len(vector) != embedding_dim:
            invalid_records.append(f"{record_id}: embedding_dim={embedding_dim} but vector_len={len(vector)}")
        elif embedding_status in {"success", "reused_checkpoint"} and not vector:
            invalid_records.append(f"{record_id}: successful record has empty embedding")

        # 驗證模型名稱是否符合預期
        if embedding_model != expected_model:
            invalid_records.append(f"{record_id}: unexpected embedding_model={embedding_model}")
        # 驗證嵌入維度是否符合預期
        if embedding_dim != expected_dim:
            invalid_records.append(f"{record_id}: unexpected embedding_dim={embedding_dim}")
        expected_contract = {
            "embedding_provider": "gemini",
            "embedding_task_type": GEMINI_EMBEDDING_TASK_TYPE,
            "embedding_instruction_version": GEMINI_EMBEDDING_INSTRUCTION_VERSION,
            "embedding_generation_version": GEMINI_EMBEDDING_GENERATION_VERSION,
            "embedding_normalization_version": GEMINI_EMBEDDING_NORMALIZATION_VERSION,
            "embedding_contract_version": GEMINI_EMBEDDING_CONTRACT_VERSION,
            "embedding_schema_version": GEMINI_EMBEDDING_CONTRACT_VERSION,
        }
        if args.modality == "text":
            for field_name, expected_value in expected_contract.items():
                if record.get(field_name) != expected_value:
                    invalid_records.append(
                        f"{record_id}: unexpected {field_name}={record.get(field_name)}"
                    )
        # 驗證嵌入模態是否符合參數
        if embedding_modality != args.modality:
            invalid_records.append(f"{record_id}: unexpected embedding_modality={embedding_modality}")
        # 對於文本模態，驗證 chunk_id 格式
        if args.modality == "text" and (not record_id or not record_id.startswith(f"{video_id}_chunk_")):
            invalid_records.append(f"{record_id}: chunk_id does not match video_id={video_id}")
        # 對於音頻模態，驗證音頻路徑是否指向 WAV 文件
        if args.modality == "audio" and not str(record.get("audio_path", "")).endswith(".wav"):
            invalid_records.append(f"{record_id}: audio_path does not point to a wav file")

    # 計算統計信息
    modality_counter = Counter(modalities)
    unique_models = sorted(set(models))
    unique_dims = sorted(set(dims))
    # 計算成功和失敗的記錄數
    success_count = status_counts["success"] + status_counts["reused_checkpoint"]
    failed_count = len(records) - success_count

    # 輸出驗證結果摘要
    print(f"Gemini records: {len(records)}")
    print(f"Model used: {', '.join(unique_models) if unique_models else 'none'}")
    print(f"Status counts: {dict(status_counts)}")
    # 特殊處理文本模態的顯示
    if args.modality == "text" and set(modality_counter) == {"text"}:
        print("Modalities: text")
        print("This output uses Gemini, but is TEXT-ONLY. It is NOT multimodal embedding.")
        print("Embedding type: Gemini text embedding")
    else:
        print(f"Modalities: {dict(modality_counter)}")

    # 檢查維度是否一致
    dimension_ok = unique_dims == [expected_dim]
    print(f"Dimension check: {'PASS' if dimension_ok else 'FAIL'}")
    print(f"Missing fields: {', '.join(sorted(missing_fields)) if missing_fields else 'none'}")
    print(f"Successful Gemini records: {success_count}")
    print(f"Unsuccessful Gemini records: {failed_count}")

    # 如果有驗證問題，顯示前20個
    if invalid_records:
        print("Validation issues:")
        for issue in invalid_records[:20]:
            print(f"- {issue}")

    # 確定最終驗證結果
    is_valid = not missing_fields and not invalid_records
    if is_valid and failed_count:
        print("Final result: VALID_WITH_PARTIAL_FAILURES")
        return 0
    print(f"Final result: {'VALID' if is_valid else 'INVALID'}")
    return 0 if is_valid else 1


if __name__ == "__main__":
    # 當腳本直接執行時，運行主函數並以其返回值退出
    raise SystemExit(main())
