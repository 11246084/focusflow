import json
import os
import subprocess
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
    BatchAlreadyRunningError,
    BatchExecutionLease,
    BatchManager,
    BatchValidationError,
    PipelineRunResult,
    SubprocessPipelineRunner,
    create_batch,
    create_batch_from_request,
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

    def run(self, video_path, run_id, resume, video_id=None):
        with self.lock:
            self.calls.append((video_path.name, run_id, resume, video_id))
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
                video_id=video_id or video_path.stem,
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

    def test_backend_request_preserves_item_and_video_ids(self):
        first = self.video("first.mp4")
        second = self.video("second.mov")
        manager = create_batch_from_request(
            [
                {"itemId": "item_0001", "videoId": "mongo-video-1", "videoPath": str(first)},
                {"itemId": "item_0002", "videoId": "mongo-video-2", "videoPath": str(second)},
            ],
            self.root / "outputs",
            batch_id="batch_20260812010101_abcdef12",
            input_source="backend-test",
        )
        runner = FakeRunner()
        manager.run(runner)
        self.assertEqual([item.item_id for item in manager.job.items], ["item_0001", "item_0002"])
        self.assertEqual([item.video_id for item in manager.job.items], ["mongo-video-1", "mongo-video-2"])
        self.assertEqual([call[3] for call in runner.calls], ["mongo-video-1", "mongo-video-2"])

    def test_backend_request_rejects_duplicate_paths(self):
        video = self.video("same.mp4")
        with self.assertRaises(BatchValidationError):
            create_batch_from_request(
                [
                    {"itemId": "item_0001", "videoId": "one", "videoPath": str(video)},
                    {"itemId": "item_0002", "videoId": "two", "videoPath": str(video)},
                ],
                self.root / "outputs",
                batch_id="batch_20260812010101_abcdef12",
                input_source="backend-test",
            )

    def test_manual_retry_grants_exactly_one_attempt_to_requested_failed_video(self):
        video = self.video("retry.mp4")
        manager = create_batch_from_request(
            [{"itemId": "item_0001", "videoId": "mongo-video-1", "videoPath": str(video)}],
            self.root / "outputs",
            batch_id="batch_20260812010101_abcdef12",
            input_source="backend-test",
            max_retries=0,
        )
        manager.run(FakeRunner(failures={"retry.mp4": 1}, delay=0))
        item = manager.job.items[0]
        self.assertEqual(item.status, "failed")
        self.assertEqual(item.attempt_count, 1)

        manager.request_manual_retry("mongo-video-1")
        manager.run(FakeRunner(delay=0))

        self.assertEqual(item.status, "completed")
        self.assertEqual(item.attempt_count, 2)
        self.assertEqual(item.max_attempts, 2)
        with self.assertRaises(BatchValidationError):
            manager.request_manual_retry("mongo-video-1")

    def test_execution_lease_rejects_a_second_live_owner(self):
        batch_dir = self.root / "outputs" / "batches" / "batch_lock"
        first = BatchExecutionLease(batch_dir).acquire()
        try:
            with self.assertRaises(BatchAlreadyRunningError):
                BatchExecutionLease(batch_dir).acquire()
        finally:
            first.release()
        self.assertFalse((batch_dir / ".execution.lock").exists())

    def test_execution_lease_reclaims_a_dead_owner(self):
        batch_dir = self.root / "outputs" / "batches" / "batch_stale"
        batch_dir.mkdir(parents=True)
        (batch_dir / ".execution.lock").write_text(
            json.dumps({"pid": 999999999, "token": "stale"}),
            encoding="utf-8",
        )
        lease = BatchExecutionLease(batch_dir).acquire()
        lease.release()
        self.assertFalse((batch_dir / ".execution.lock").exists())

    def test_subprocess_runner_passes_requested_video_id_once(self):
        runner = SubprocessPipelineRunner(self.root, python_executable="python-test")
        with patch("batch_manager.subprocess.run") as run:
            run.return_value.returncode = 0
            runner.run(self.video("one.mp4"), "run-1", False, "video-1")
        command = run.call_args.args[0]
        self.assertEqual(command.count("--video-id"), 1)
        self.assertEqual(command[command.index("--video-id") + 1], "video-1")

    def test_killed_batch_process_reclaims_lease_and_resumes_only_interrupted_item(self):
        video = self.video("interrupt.mp4")
        output_root = self.root / "outputs"
        batch_id = "batch_20260813010101_deadbeef"
        batch_dir = output_root / "batches" / batch_id
        script = "\n".join([
            "import sys, time",
            "from pathlib import Path",
            f"sys.path.insert(0, {str(SRC_DIR)!r})",
            "from batch_manager import BatchExecutionLease, PipelineRunResult, create_batch",
            "class BlockingRunner:",
            "    def run(self, video_path, run_id, resume, video_id=None):",
            "        time.sleep(30)",
            "        return PipelineRunResult(run_id=run_id, video_id=video_id)",
            f"manager = create_batch([Path({str(video)!r})], Path({str(output_root)!r}), input_source='kill-test', batch_id={batch_id!r})",
            "with BatchExecutionLease(manager.batch_dir):",
            "    manager.run(BlockingRunner())",
        ])
        child = subprocess.Popen([sys.executable, "-c", script])
        try:
            manifest_path = batch_dir / "batch_manifest.json"
            deadline = time.time() + 10
            while time.time() < deadline:
                if manifest_path.exists():
                    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
                    if payload["items"][0]["status"] == "running":
                        break
                time.sleep(0.05)
            else:
                self.fail("Child batch never reached running state.")

            child.terminate()
            child.wait(timeout=10)
            with BatchExecutionLease(batch_dir):
                loaded = BatchManager.load(batch_dir)
                runner = FakeRunner(delay=0)
                loaded.run(runner)

            self.assertEqual(child.returncode == 0, False)
            self.assertEqual([call[2] for call in runner.calls], [True])
            self.assertEqual(loaded.job.items[0].status, "completed")
            self.assertEqual(loaded.job.items[0].attempt_count, 1)
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=10)

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
