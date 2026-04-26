"""Debug helper for one Gemini text embedding request."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from config import PipelineConfig
from embedding import embed_single_text_gemini


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments for the Gemini debug helper."""
    # 創建參數解析器，描述為 "Embed one chunk text with Gemini for debugging."
    parser = argparse.ArgumentParser(description="Embed one chunk text with Gemini for debugging.")
    # 添加 --text 參數，默認 None，用於直接提供要嵌入的原始文本
    parser.add_argument("--text", default=None, help="Raw text to embed directly.")
    # 添加 --chunk-id 參數，默認 None，用於指定現有的 chunk_id 從 chunks.jsonl 加載
    parser.add_argument("--chunk-id", default=None, help="Existing chunk_id to load from chunks.jsonl.")
    # 添加 --chunks-file 參數，類型為 Path，默認 "data/outputs/chunks.jsonl"，用於指定導出的 chunks.jsonl 文件路徑
    parser.add_argument(
        "--chunks-file",
        type=Path,
        default=Path("data/outputs/chunks.jsonl"),
        help="Path to the exported chunks.jsonl file.",
    )
    # 添加 --project-root 參數，類型為 Path，默認當前文件的父目錄的父目錄（項目根目錄），用於指定項目根目錄
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Project root directory.",
    )
    # 解析並返回參數
    return parser.parse_args()


def find_chunk_text(chunks_file: Path, chunk_id: str) -> str:
    """Locate one chunk by id and return its text payload."""
    # 讀取 chunks_file 的文本內容，使用 utf-8-sig 編碼處理 BOM
    for line in chunks_file.read_text(encoding="utf-8-sig").splitlines():
        # 如果行為空或只有空白，跳過
        if not line.strip():
            continue
        # 解析 JSON 行為記錄
        record = json.loads(line)
        # 如果記錄的 chunk_id 匹配指定的 chunk_id，返回其 text 字段
        if record.get("chunk_id") == chunk_id:
            return str(record["text"])
    # 如果沒有找到，拋出 FileNotFoundError
    raise FileNotFoundError(f"Could not find chunk_id={chunk_id} in {chunks_file}")


def main() -> int:
    """Run one Gemini embedding call and print lightweight debug information."""
    # 解析命令行參數
    args = parse_args()
    # 如果沒有提供 --text 和 --chunk-id，拋出 ValueError
    if not args.text and not args.chunk_id:
        raise ValueError("Provide either --text or --chunk-id.")

    # 解析項目根目錄
    project_root = args.project_root.resolve()
    # 從環境變數創建 PipelineConfig
    config = PipelineConfig.from_env(project_root=project_root)

    # 設置 chunks_file 路徑
    chunks_file = args.chunks_file
    # 如果不是絕對路徑，轉換為項目根目錄下的絕對路徑
    if not chunks_file.is_absolute():
        chunks_file = (project_root / chunks_file).resolve()

    # 設置 chunk_id，如果沒有提供則使用 "debug_chunk"
    chunk_id = args.chunk_id or "debug_chunk"
    # 設置 text，如果提供了 --text 則使用，否則從 chunks_file 中查找
    text = args.text if args.text is not None else find_chunk_text(chunks_file, chunk_id)
    # 調用 embed_single_text_gemini 進行嵌入，返回向量和元數據
    vector, metadata = embed_single_text_gemini(text, config, record_id=chunk_id)

    # 創建向量預覽：取前8個值，格式化為6位小數
    preview_values = ", ".join(f"{value:.6f}" for value in vector[:8])
    # 打印 chunk_id
    print(f"chunk_id: {chunk_id}")
    # 打印模型名稱
    print(f"model: {metadata.embedding_model}")
    # 打印嵌入模態
    print(f"modality: {metadata.embedding_modality}")
    # 打印嵌入類型
    print("embedding type: Gemini text embedding")
    # 打印向量長度
    print(f"vector_length: {len(vector)}")
    # 打印向量預覽
    print(f"vector_preview: [{preview_values}]")
    # 打印狀態
    print(f"status: {metadata.embedding_status}")
    # 打印錯誤信息
    print(f"error: {metadata.embedding_error}")
    # 打印時間戳
    print(f"timestamp: {metadata.embedding_timestamp}")
    # 打印成功狀態：向量存在且狀態為 'success' 或 'reused_checkpoint'
    print(f"success: {bool(vector) and metadata.embedding_status in {'success', 'reused_checkpoint'}}")
    # 返回 0 表示成功
    return 0


if __name__ == "__main__":
    # 如果作為主模塊運行，調用 main 函數並以其返回值退出
    raise SystemExit(main())
