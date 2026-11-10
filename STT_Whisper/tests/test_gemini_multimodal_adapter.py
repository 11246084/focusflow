import json
import math
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from gemini_multimodal_adapter import EmbeddingRequestError, GeminiMultimodalAdapter, estimate_cost


class FakeClient:
    def __init__(self, failures=None, vector=None):
        self.models = self
        self.calls = []
        self.failures = list(failures or [])
        self.closed = False
        self.vector = vector if vector is not None else [1.0] * 3072

    def embed_content(self, **request):
        self.calls.append(request)
        if self.failures:
            raise self.failures.pop(0)
        return SimpleNamespace(embeddings=[SimpleNamespace(values=self.vector)])

    def close(self):
        self.closed = True


class GeminiAdapterTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.client = FakeClient()

    def tearDown(self):
        self.directory.cleanup()

    def adapter(self, **options):
        defaults = dict(max_cost_usd=1, allow_paid=True, client_factory=lambda _: self.client,
                        sleep=lambda _: None, ledger_path=self.root / "ledger.json")
        defaults.update(options)
        return GeminiMultimodalAdapter(self.root / "checkpoints", **defaults)

    def test_explicit_opt_in_and_budget_block_before_client_creation(self):
        for options in ({"allow_paid": False}, {"max_cost_usd": 0}):
            with self.assertRaises(PermissionError):
                self.adapter(**options).embed_text("人工智慧")
        self.assertEqual(self.client.calls, [])

    def test_query_document_contract_and_checkpoint_resume(self):
        adapter = self.adapter()
        first = adapter.embed_text("人工智慧")
        self.assertEqual(self.client.calls[0]["contents"], "task: search result | query: 人工智慧")
        self.assertEqual(self.client.calls[0]["model"], "gemini-embedding-2")
        config = self.client.calls[0]["config"]
        self.assertEqual(config.output_dimensionality, 3072)
        self.assertEqual(config.http_options.timeout, 30000)
        self.assertEqual(config.http_options.retry_options.attempts, 1)
        self.assertAlmostEqual(sum(value * value for value in first["embedding"]), 1)
        self.assertEqual(first["instructionVersion"], "gemini_embedding_2_asymmetric_retrieval_v2")
        self.assertEqual(first["normalizationVersion"], "unit_l2_v1")
        self.assertTrue(adapter.embed_text("人工智慧")["reused"])
        self.assertEqual(len(self.client.calls), 1)
        adapter.embed_text("人工智慧", role="text")
        self.assertEqual(self.client.calls[-1]["contents"], "title: none | text: 人工智慧")
        self.assertTrue(self.client.closed)

    def test_media_parts_and_original_identity(self):
        adapter = self.adapter(duration_probe=lambda _: 8)
        for modality, extension, mime in (("audio", ".wav", "audio/wav"), ("visual", ".mp4", "video/mp4")):
            media = self.root / f"clip{extension}"
            media.write_bytes(b"local-test-media")
            record = {"mediaPath": str(media), "modality": modality, "status": "success", "courseId": "c",
                      "videoId": "v", "chunkId": "v_chunk_0001", "startSec": 10, "endSec": 12,
                      "sampleStartSec": 7, "sampleEndSec": 15}
            result = adapter.embed_media(record)
            part = self.client.calls[-1]["contents"].parts[0]
            self.assertEqual(part.inline_data.mime_type, mime)
            self.assertEqual(part.inline_data.data, b"local-test-media")
            self.assertEqual(result["startSec"], 10)
            self.assertEqual(result["sampleStartSec"], 7)
            self.assertEqual(result["contractVersion"], f"gemini_embedding_2_{modality}_v1")

    def test_retries_reserve_each_attempt_and_errors_are_redacted(self):
        self.client.failures = [type("RateLimit", (Exception,), {"code": 429})("SECRET"), TimeoutError("SECRET")]
        delays = []
        result = self.adapter(sleep=delays.append).embed_text("retry")
        self.assertEqual(delays, [1, 2])
        self.assertEqual(result["attempts"], 3)
        ledger = json.loads((self.root / "ledger.json").read_text())
        self.assertEqual(ledger["calls"], 3)
        self.assertAlmostEqual(ledger["reservedUsd"], 3 * estimate_cost("query"), places=8)
        self.assertNotIn("SECRET", "".join(p.read_text() for p in self.root.rglob("*.json")))

    def test_terminal_error_invalid_vector_and_call_cap(self):
        self.client.failures = [type("Forbidden", (Exception,), {"code": 403})("SECRET")]
        with self.assertRaisesRegex(EmbeddingRequestError, "403"):
            self.adapter().embed_text("forbidden")
        self.assertEqual(len(self.client.calls), 1)
        with self.assertRaises(PermissionError):
            self.adapter(max_calls=1).embed_text("another")
        self.client.vector = [float("nan")] * 3072
        with self.assertRaises(EmbeddingRequestError):
            self.adapter().embed_text("bad vector")

    def test_cumulative_budget_shared_across_outputs_and_cost_limits(self):
        self.adapter(max_cost_usd=0.002).embed_text("first")
        second = GeminiMultimodalAdapter(self.root / "another-output", max_cost_usd=0.002,
            allow_paid=True, ledger_path=self.root / "ledger.json", client_factory=lambda _: self.client)
        with self.assertRaises(PermissionError):
            second.embed_text("second")
        self.assertEqual(len(self.client.calls), 1)
        for value in (-1, math.inf, 30.01):
            with self.assertRaises(ValueError):
                self.adapter(max_cost_usd=value)
        self.assertEqual(estimate_cost("visual", seconds=60), 32 * 0.00079)
        with self.assertRaises(ValueError):
            estimate_cost("audio", seconds=61)

    def test_client_initialization_error_is_safe(self):
        def fail(_):
            raise ValueError("SECRET")
        with self.assertRaises(EmbeddingRequestError) as result:
            self.adapter(client_factory=fail).embed_text("question")
        self.assertNotIn("SECRET", str(result.exception))


if __name__ == "__main__":
    unittest.main()
