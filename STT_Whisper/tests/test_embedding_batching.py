import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

import embedding
from utils import ChunkRecord


class _FakeModels:
    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    def embed_content(self, *, model, contents, config):
        del model, config
        self.calls.append(list(contents))
        return SimpleNamespace(
            embeddings=[SimpleNamespace(values=[1.0, float(index + 1)]) for index in range(len(contents))],
            request_id=f"request-{len(self.calls)}",
        )


class GeminiTextBatchingTests(unittest.TestCase):
    def test_configured_batch_size_preserves_all_chunk_records(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            fake_models = _FakeModels()
            fake_client = SimpleNamespace(models=fake_models)
            config = SimpleNamespace(
                text_embeddings_output_path=Path(temp_dir) / "embeddings_text_gemini.jsonl",
                gemini_embedding_enabled=True,
                gemini_api_key="offline-test-key",
                gemini_embedding_model_name="offline-model",
                gemini_embedding_output_dim=2,
                gemini_embedding_batch_size=8,
                gemini_max_chunks_per_run=None,
                gemini_max_retries=0,
                gemini_retry_sleep_sec=0,
            )
            chunks = [
                ChunkRecord(
                    chunk_id=f"chunk_{index:02d}",
                    video_id="video_001",
                    start_sec=float(index),
                    end_sec=float(index + 1),
                    text=f"第 {index} 段內容",
                    course_name=None,
                    week=None,
                    lesson=None,
                )
                for index in range(9)
            ]

            with patch.object(embedding, "_load_gemini_client", return_value=fake_client):
                records = embedding.embed_chunks(chunks, config)

            self.assertEqual([len(call) for call in fake_models.calls], [8, 1])
            self.assertEqual([record.chunk_id for record in records], [chunk.chunk_id for chunk in chunks])
            self.assertTrue(all(record.embedding_status == embedding.EMBEDDING_STATUS_SUCCESS for record in records))
            self.assertTrue(all(len(record.embedding) == 2 for record in records))


if __name__ == "__main__":
    unittest.main()
