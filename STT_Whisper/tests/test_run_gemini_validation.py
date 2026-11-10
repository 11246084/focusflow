import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from gemini_multimodal_adapter import EmbeddingRequestError, GeminiMultimodalAdapter, PRICING_VERSION
from run_gemini_validation import FakeSDK, execute_requests, run


class ValidationRunnerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.fake = FakeSDK()
        self.requests = []
        for index in range(3):
            identity = {"courseId": "course", "videoId": "video", "chunkId": f"video_chunk_{index:04d}", "startSec": 10, "endSec": 12}
            for kind in ("query", "text", "audio", "visual"):
                request = {"requestId": f"{identity['chunkId']}:{kind}", "kind": kind, "identity": identity,
                           "text": f"question {index}", "input": {}, "estimatedUsd": 0.01}
                if kind in ("audio", "visual"):
                    media = self.root / f"{index}{'.wav' if kind == 'audio' else '.mp4'}"
                    media.write_bytes(f"test-media-{index}".encode())
                    request["mediaRecord"] = {**identity, "mediaPath": str(media), "modality": kind,
                        "status": "success", "sampleStartSec": 7, "sampleEndSec": 15}
                self.requests.append(request)

    def tearDown(self):
        self.directory.cleanup()

    def adapter(self, **extra):
        options = dict(max_cost_usd=0.25, max_calls=36, allow_paid=True, execution_mode="fake-sdk",
            client_factory=lambda _: self.fake, sleep=lambda _: None, duration_probe=lambda _: 8)
        options.update(extra)
        return GeminiMultimodalAdapter(self.root / "checkpoints", **options)

    def test_twelve_inputs_and_resume_without_duplicate_calls(self):
        adapter = self.adapter()
        first = execute_requests(self.requests, adapter, self.root / "results")
        self.assertEqual(len(self.fake.calls), 12)
        self.assertEqual({kind: sum(call["kind"] == kind for call in self.fake.calls)
                          for kind in ("query", "text", "audio", "visual")},
                         {"query": 3, "text": 3, "audio": 3, "visual": 3})
        self.assertEqual(len(first["vectors"]), 12)
        again = execute_requests(self.requests, adapter, self.root / "results")
        self.assertTrue(all(row["reused"] and row["provider"] == "fake-sdk" for row in again["state"]["results"]))
        self.assertEqual(len(self.fake.calls), 12)

    def test_permanent_failure_stops_remaining_batch_and_redacts_error(self):
        def fail(**_):
            raise type("Forbidden", (Exception,), {"code": 403})("SECRET")
        self.fake.embed_content = fail
        with self.assertRaises(EmbeddingRequestError):
            execute_requests(self.requests, self.adapter(), self.root / "results")
        state = json.loads((self.root / "results/state.json").read_text())
        self.assertEqual(state["status"], "stopped")
        self.assertEqual(state["failedRequest"], self.requests[0]["requestId"])
        self.assertEqual(state["results"], [])
        self.assertNotIn("SECRET", json.dumps(state))

    def test_call_cap_stops_before_second_sdk_call(self):
        with self.assertRaises(PermissionError):
            execute_requests(self.requests, self.adapter(max_calls=1), self.root / "results")
        self.assertEqual(len(self.fake.calls), 1)
        self.assertEqual(json.loads((self.root / "results/state.json").read_text())["status"], "stopped")

    def test_attempt_36_is_last_and_resume_does_not_reset_counter(self):
        adapter = self.adapter()
        adapter.ledger_path.parent.mkdir(parents=True, exist_ok=True)
        adapter.ledger_path.write_text(json.dumps({"pricingVersion": PRICING_VERSION, "reservedUsd": 0.1, "calls": 35}))
        for _ in range(2):
            with self.assertRaises(PermissionError):
                execute_requests(self.requests, adapter, self.root / "results")
        self.assertEqual(len(self.fake.calls), 1)
        self.assertEqual(json.loads(adapter.ledger_path.read_text())["calls"], 36)

    def test_quarter_dollar_ceiling_blocks_before_an_over_budget_attempt(self):
        adapter = self.adapter()
        adapter.ledger_path.parent.mkdir(parents=True, exist_ok=True)
        adapter.ledger_path.write_text(json.dumps({"pricingVersion": PRICING_VERSION, "reservedUsd": 0.249, "calls": 1}))
        with self.assertRaises(PermissionError):
            execute_requests(self.requests, adapter, self.root / "results")
        self.assertEqual(self.fake.calls, [])
        self.assertEqual(json.loads(adapter.ledger_path.read_text())["reservedUsd"], 0.249)

    def test_dry_run_never_builds_client(self):
        with patch("run_gemini_validation.subprocess.run") as process, \
             patch("run_gemini_validation.prepare_requests", return_value=(self.requests, [])), \
             patch("run_gemini_validation.load_preview_vectors", return_value={}), \
             patch("run_gemini_validation.create_client", side_effect=AssertionError("No client allowed")):
            process.return_value.stdout = "22.23.4"
            result = run(self.root, mode="dry-run", output=self.root / "out", media_root=self.root,
                         max_cost_usd=0.25, max_calls=36, node="node")
            self.assertEqual(result["actualApiCalls"], 0)
            self.assertEqual(result["status"], "dry-run")
        with self.assertRaises(PermissionError):
            run(self.root, mode="gemini", output=self.root, media_root=self.root,
                max_cost_usd=0.25, max_calls=36, node="node")

    def test_fake_checkpoint_cannot_be_reused_as_gemini(self):
        first = self.adapter().embed_text("same")
        second = self.adapter(execution_mode="gemini", ledger_path=self.root / "other-ledger.json").embed_text("same")
        self.assertNotEqual(first["signature"], second["signature"])
        self.assertEqual(first["provider"], "fake-sdk")
        self.assertEqual(second["provider"], "gemini")
        self.assertFalse(second["reused"])

    def test_corrupted_checkpoint_stops_without_spending_more(self):
        adapter = self.adapter()
        first = adapter.embed_text("corruption test")
        checkpoint = adapter.output / f"{first['signature']}.json"
        value = json.loads(checkpoint.read_text())
        value["embedding"][0] = value["embedding"][0] + 0.1
        checkpoint.write_text(json.dumps(value))
        with self.assertRaises(ValueError):
            adapter.embed_text("corruption test")
        self.assertEqual(len(self.fake.calls), 1)


if __name__ == "__main__":
    unittest.main()
