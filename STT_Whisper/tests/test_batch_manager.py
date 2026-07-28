import json
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch


SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from batch_manager import (
    BatchManager,
    BatchValidationError,
    PipelineRunResult,
    create_batch,
)
from config import PipelineConfig


class FakeRunner:
    def __init__(self, failures=None, delay=0.01):
        self.failures = dict(failures or {})
        self.delay = delay
        self.calls = []
        self.running = 0
        self.max_running = 0
        self.lock = threading.Lock()

    def run(self, video_path, run_id, resume):
        with self.lock:
            self.calls.append((video_path.name, run_id, resume))
            self.running += 1
            self.max_running = max(self.max_running, self.running)
            remaining = self.failures.get(video_path.name, 0)
            if remaining:
                self.failures[video_path.name] = remaining - 1
        try:
            time.sleep(self.delay)
            if remaining == -1:
                raise BatchValidationError("invalid input")
            if remaining:
                raise RuntimeError(f"transient failure for {video_path.name}")
            return PipelineRunResult(
                run_id=run_id,
                output_directory=f"outputs/{run_id}",
                video_id=video_path.stem,
            )
        finally:
            with self.lock:
                self.running -= 1


class BatchManagerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def video(self, name):
        path = self.root / name
        path.write_bytes(b"offline-fixture")
        return path

    def create(self, names, **kwargs):
        paths = [self.video(name) for name in names]
        return create_batch(
            paths,
            self.root / "outputs",
            input_source="tests",
            **kwargs,
        )

    def test_single_video_batch(self):
        manager = self.create(["one.mp4"])
        self.assertEqual(len(manager.job.items), 1)

    def test_multi_video_order_is_deterministic(self):
        manager = self.create(["z.mov", "a.mp4", "m.mkv"])
        self.assertEqual([Path(item.video_path).name for item in manager.job.items], ["a.mp4", "m.mkv", "z.mov"])

    def test_empty_input_is_persisted_and_finishes_failed(self):
        manager = create_batch([], self.root / "outputs", input_source="empty")
        manager.run(FakeRunner())
        self.assertEqual(manager.job.status, "failed")
        self.assertEqual(manager.job.counts()["total_items"], 0)

    def test_duplicate_paths_are_removed(self):
        video = self.video("one.mp4")
        manager = create_batch([video, video], self.root / "outputs", input_source="duplicate")
        self.assertEqual(len(manager.job.items), 1)

    def test_valid_and_missing_inputs_are_both_recorded(self):
        manager = create_batch(
            [self.video("ok.mp4"), self.root / "missing.mp4"],
            self.root / "outputs",
            input_source="mixed",
        )
        self.assertEqual([item.status for item in manager.job.items], ["queued", "skipped"])
        self.assertEqual(manager.job.items[1].last_error_code, "INPUT_NOT_FOUND")

    def test_unsupported_extension_is_skipped(self):
        manager = create_batch([self.video("notes.txt")], self.root / "outputs", input_source="invalid")
        self.assertEqual(manager.job.items[0].status, "skipped")
        self.assertEqual(manager.job.items[0].last_error_code, "UNSUPPORTED_VIDEO_FORMAT")

    def test_batch_and_item_ids_are_unique(self):
        first = self.create(["a.mp4", "b.mp4"])
        second = self.create(["c.mp4"])
        self.assertNotEqual(first.job.batch_id, second.job.batch_id)
        self.assertEqual(len({item.item_id for item in first.job.items}), 2)
        self.assertEqual(len({item.run_id for item in first.job.items}), 2)

    def test_concurrency_one_never_overlaps(self):
        manager = self.create(["a.mp4", "b.mp4", "c.mp4"], max_concurrency=1)
        runner = FakeRunner()
        manager.run(runner)
        self.assertEqual(runner.max_running, 1)

    def test_concurrency_two_is_bounded(self):
        manager = self.create(["a.mp4", "b.mp4", "c.mp4", "d.mp4"], max_concurrency=2)
        runner = FakeRunner(delay=0.03)
        manager.run(runner)
        self.assertEqual(runner.max_running, 2)
        self.assertTrue(all(item.status == "completed" for item in manager.job.items))

    def test_failure_isolated_and_batch_partial(self):
        manager = self.create(["a.mp4", "b.mp4", "c.mp4"])
        manager.run(FakeRunner({"b.mp4": 1}))
        self.assertEqual([item.status for item in manager.job.items], ["completed", "failed", "completed"])
        self.assertEqual(manager.job.status, "partial")

    def test_all_success_is_completed(self):
        manager = self.create(["a.mp4", "b.mp4"])
        manager.run(FakeRunner())
        self.assertEqual(manager.job.status, "completed")

    def test_all_failure_is_failed(self):
        manager = self.create(["a.mp4", "b.mp4"])
        manager.run(FakeRunner({"a.mp4": 1, "b.mp4": 1}))
        self.assertEqual(manager.job.status, "failed")

    def test_zero_retries_runs_once(self):
        manager = self.create(["a.mp4"], max_retries=0)
        runner = FakeRunner({"a.mp4": 1})
        manager.run(runner)
        self.assertEqual(len(runner.calls), 1)

    def test_transient_failure_resumes_same_run(self):
        manager = self.create(["a.mp4"], max_retries=1)
        runner = FakeRunner({"a.mp4": 1})
        run_id = manager.job.items[0].run_id
        manager.run(runner)
        self.assertEqual([call[1] for call in runner.calls], [run_id, run_id])
        self.assertEqual([call[2] for call in runner.calls], [False, True])
        self.assertEqual(manager.job.items[0].attempt_count, 2)
        self.assertTrue(manager.job.items[0].resume_used)
        self.assertEqual(manager.job.items[0].status, "completed")

    def test_retry_limit_is_enforced(self):
        manager = self.create(["a.mp4"], max_retries=2)
        runner = FakeRunner({"a.mp4": 3})
        manager.run(runner)
        self.assertEqual(len(runner.calls), 3)
        self.assertEqual(manager.job.items[0].status, "failed")

    def test_validation_error_is_not_retried(self):
        manager = self.create(["a.mp4"], max_retries=2)
        runner = FakeRunner({"a.mp4": -1})
        manager.run(runner)
        self.assertEqual(len(runner.calls), 1)

    def test_sensitive_error_is_redacted(self):
        manager = self.create(["a.mp4"])

        class SecretRunner:
            def run(self, *_args):
                raise RuntimeError("MONGODB_URI=mongodb+srv://user:password@host token=abc")

        manager.run(SecretRunner())
        message = manager.job.items[0].last_error_message
        self.assertIn("redacted", message)
        self.assertNotIn("password", message)
        self.assertNotIn("abc", message)

    def test_completed_item_is_not_rerun_on_resume(self):
        manager = self.create(["a.mp4", "b.mp4"])
        manager.job.items[0].status = "completed"
        manager.job.items[0].completed_at = "2026-01-01T00:00:00+00:00"
        manager.persist()
        loaded = BatchManager.load(manager.batch_dir)
        runner = FakeRunner()
        loaded.run(runner)
        self.assertEqual([call[0] for call in runner.calls], ["b.mp4"])

    def test_interrupted_running_item_resumes_without_retry_allowance(self):
        manager = self.create(["a.mp4"], max_retries=0)
        manager.job.items[0].status = "running"
        manager.job.items[0].attempt_count = 1
        manager.persist()
        loaded = BatchManager.load(manager.batch_dir)
        runner = FakeRunner()
        loaded.run(runner)
        self.assertTrue(runner.calls[0][2])
        self.assertEqual(loaded.job.items[0].status, "completed")

    def test_queued_item_continues_after_resume(self):
        manager = self.create(["a.mp4"])
        loaded = BatchManager.load(manager.batch_dir)
        loaded.run(FakeRunner())
        self.assertEqual(loaded.job.items[0].status, "completed")

    def test_summary_counts_progress_and_references(self):
        manager = self.create(["a.mp4", "b.mp4"])
        manager.run(FakeRunner())
        summary = json.loads(manager.summary_path.read_text(encoding="utf-8"))
        self.assertEqual(summary["completed_items"], 2)
        self.assertEqual(summary["progress_percent"], 100.0)
        self.assertTrue(summary["items"][0]["run_id"])
        self.assertTrue(summary["items"][0]["output_directory"])

    def test_manifest_and_summary_are_parseable(self):
        manager = self.create(["中文.mp4"])
        manager.run(FakeRunner())
        self.assertEqual(json.loads(manager.manifest_path.read_text(encoding="utf-8"))["status"], "completed")
        self.assertEqual(json.loads(manager.summary_path.read_text(encoding="utf-8"))["status"], "completed")

    def test_atomic_write_failure_leaves_no_temporary_file(self):
        manager = self.create(["a.mp4"])
        with patch("batch_manager.os.replace", side_effect=PermissionError("blocked")):
            with self.assertRaises(PermissionError):
                manager.persist()
        self.assertEqual(list(manager.batch_dir.glob(".*.tmp")), [])
        self.assertTrue(json.loads(manager.manifest_path.read_text(encoding="utf-8")))

    def test_config_batch_bounds_and_override_validation(self):
        with patch.dict(os.environ, {"BATCH_MAX_CONCURRENCY": "1", "BATCH_ITEM_MAX_RETRIES": "0"}, clear=False):
            config = PipelineConfig.from_env(self.root)
        self.assertEqual(config.batch_max_concurrency, 1)
        with self.assertRaises(ValueError):
            config.with_overrides(batch_max_concurrency=0)
        with self.assertRaises(ValueError):
            config.with_overrides(batch_max_concurrency=3)
        with self.assertRaises(ValueError):
            config.with_overrides(batch_item_max_retries=-1)
        with self.assertRaises(ValueError):
            config.with_overrides(batch_item_max_retries=3)


if __name__ == "__main__":
    unittest.main()
