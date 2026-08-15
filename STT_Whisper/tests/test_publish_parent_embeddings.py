import json
import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch


SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

import publish_parent_embeddings as cli
from parent_mongodb_uploader import ParentUploadSummary


COURSE_ID = "64b7f4a2c9e77c2a1d123456"


class ParentPublisherCliTests(unittest.TestCase):
    def test_default_mode_is_offline_preflight_and_writes_hash_evidence(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            artifact = Path(temp_dir) / "parent.jsonl"
            report = Path(temp_dir) / "evidence.json"
            artifact.write_text('{"parent_id":"p1"}\n', encoding="utf-8")
            summary = ParentUploadSummary(
                input_count=1,
                validated_count=1,
                success=True,
                status="validated",
            )
            with patch.object(
                cli,
                "preflight_parent_publication",
                return_value=([{"parentId": "p1"}], summary),
            ) as preflight, patch.object(cli, "upload_parent_embeddings") as upload:
                with redirect_stdout(io.StringIO()):
                    exit_code = cli.main([
                        "--artifact", str(artifact),
                        "--course-id", COURSE_ID,
                        "--expected-video-id", "video-1",
                        "--report", str(report),
                    ])

            self.assertEqual(exit_code, 0)
            preflight.assert_called_once()
            upload.assert_not_called()
            evidence = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(evidence["mode"], "preflight")
            self.assertEqual(len(evidence["artifact"]["sha256"]), 64)
            self.assertFalse(evidence["scope"]["isActive"])
            self.assertTrue(evidence["result"]["success"])
            self.assertEqual(
                evidence["embeddingContract"]["generationVersion"],
                "text_search_generation_v2",
            )

    def test_write_requires_exact_confirmation_before_reading_mongo_env(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            cli.parse_args([
                "--artifact", "parent.jsonl",
                "--course-id", COURSE_ID,
                "--expected-video-id", "video-1",
                "--write",
            ])
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "MONGODB_URI is required"):
                cli.main([
                    "--artifact", "parent.jsonl",
                    "--course-id", COURSE_ID,
                    "--expected-video-id", "video-1",
                    "--write",
                    "--confirm-write", cli.INACTIVE_CONFIRMATION,
                ])

    def test_active_publication_requires_stronger_confirmation(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            cli.parse_args([
                "--artifact", "parent.jsonl",
                "--course-id", COURSE_ID,
                "--expected-video-id", "video-1",
                "--write",
                "--activate",
                "--confirm-write", cli.INACTIVE_CONFIRMATION,
            ])
        args = cli.parse_args([
            "--artifact", "parent.jsonl",
            "--course-id", COURSE_ID,
            "--expected-video-id", "video-1",
            "--write",
            "--activate",
            "--confirm-write", cli.ACTIVE_CONFIRMATION,
        ])
        self.assertTrue(args.activate)


if __name__ == "__main__":
    unittest.main()
