import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

import job_manager


class JobManagerAtomicWriteTests(unittest.TestCase):
    def test_transient_permission_error_is_retried(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            manager = job_manager.create_manifest(Path(temp_dir), "run_retry_success")
            manager.add_video("video_001", "中文影片.mp4", "C:/videos/中文影片.mp4")
            real_replace = os.replace
            attempts = 0

            def replace_after_two_failures(source, destination):
                nonlocal attempts
                attempts += 1
                if attempts < 3:
                    raise PermissionError(5, "Access is denied")
                return real_replace(source, destination)

            with patch.object(job_manager.os, "replace", side_effect=replace_after_two_failures), patch.object(
                job_manager.time, "sleep"
            ) as mocked_sleep:
                manager.start_stage("video_001", "transcribe")

            persisted = json.loads(manager.manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(attempts, 3)
            self.assertEqual(mocked_sleep.call_count, 2)
            self.assertEqual(persisted["videos"][0]["stages"]["transcribe"]["status"], "running")
            self.assertEqual(list(manager.manifest_path.parent.glob(".manifest.json.*.tmp")), [])

    def test_persistent_permission_error_is_not_swallowed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            manager = job_manager.create_manifest(Path(temp_dir), "run_retry_failure")
            manager.add_video("video_001", "影片.mp4", "C:/videos/影片.mp4")

            with patch.object(
                job_manager.os,
                "replace",
                side_effect=PermissionError(5, "Access is denied"),
            ) as mocked_replace, patch.object(job_manager.time, "sleep"):
                with self.assertRaises(PermissionError):
                    manager.start_stage("video_001", "transcribe")

            persisted = json.loads(manager.manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(mocked_replace.call_count, job_manager.MANIFEST_REPLACE_MAX_ATTEMPTS)
            self.assertEqual(persisted["videos"][0]["stages"]["transcribe"]["status"], "pending")
            self.assertEqual(list(manager.manifest_path.parent.glob(".manifest.json.*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
