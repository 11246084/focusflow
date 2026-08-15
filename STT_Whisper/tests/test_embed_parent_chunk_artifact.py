import io
import json
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

import build_parent_chunk_artifact as build_cli
import embed_parent_chunk_artifact as embed_cli


def _leaf(index: int) -> dict:
    return {
        "chunk_id": f"video-1_chunk_{index:04d}",
        "video_id": "video-1",
        "start_sec": float(index * 10),
        "end_sec": float(index * 10 + 9),
        "text": f"leaf {index}",
        "course_name": None,
        "week": None,
        "lesson": None,
    }


class EmbedParentChunkArtifactTests(unittest.TestCase):
    def _artifacts(self, root: Path) -> tuple[Path, Path, Path]:
        leaf_path = root / "leaf.jsonl"
        parent_path = root / "parent.jsonl"
        build_report = root / "parent-build.json"
        leaf_path.write_text(
            "".join(json.dumps(_leaf(index)) + "\n" for index in range(1, 4)),
            encoding="utf-8",
        )
        with redirect_stdout(io.StringIO()):
            build_cli.main(
                [
                    "--leaf-artifact",
                    str(leaf_path),
                    "--parent-artifact",
                    str(parent_path),
                    "--expected-video-id",
                    "video-1",
                    "--report",
                    str(build_report),
                ]
            )
        return leaf_path, parent_path, build_report

    def _args(self, root: Path, *, execute: bool = False) -> list[str]:
        leaf_path, parent_path, build_report = self._artifacts(root)
        args = [
            "--leaf-artifact",
            str(leaf_path),
            "--parent-artifact",
            str(parent_path),
            "--build-report",
            str(build_report),
            "--output",
            str(root / "embeddings.jsonl"),
            "--expected-video-id",
            "video-1",
            "--expected-parent-count",
            "1",
            "--report",
            str(root / "embed-report.json"),
        ]
        if execute:
            args.extend(["--execute", "--confirm-live", embed_cli.LIVE_CONFIRMATION])
        return args

    def test_default_mode_is_provider_free_preflight(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)

            def forbidden_provider(*_args, **_kwargs):
                raise AssertionError("provider must not be called during preflight")

            with patch.dict(os.environ, {}, clear=True), redirect_stdout(io.StringIO()):
                result = embed_cli.main(self._args(root), provider=forbidden_provider)

            self.assertEqual(result, 0)
            evidence = json.loads((root / "embed-report.json").read_text(encoding="utf-8"))
            self.assertEqual(evidence["mode"], "preflight")
            self.assertEqual(evidence["status"], "validated")
            self.assertFalse(evidence["providerCallsMade"])
            self.assertEqual(
                evidence["executionPolicy"],
                {"maxRetriesPerParent": 0, "maximumProviderCalls": 1},
            )
            self.assertFalse((root / "embeddings.jsonl").exists())

    def test_execute_uses_explicit_provider_and_writes_complete_artifact(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            calls = []

            def provider(texts, _config):
                calls.append(list(texts))
                return [[0.25] * 3072 for _ in texts], ["request-1"] * len(texts)

            with patch.dict(os.environ, {}, clear=True), redirect_stdout(io.StringIO()):
                result = embed_cli.main(self._args(root, execute=True), provider=provider)

            self.assertEqual(result, 0)
            self.assertEqual(len(calls), 1)
            evidence = json.loads((root / "embed-report.json").read_text(encoding="utf-8"))
            self.assertEqual(evidence["status"], "completed")
            self.assertTrue(evidence["providerCallsMade"])
            self.assertEqual(evidence["counts"], {"required": 1, "completed": 1})
            rows = [
                json.loads(line)
                for line in (root / "embeddings.jsonl").read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(len(rows), 1)
            self.assertEqual(len(rows[0]["embedding"]), 3072)

    def test_execute_requires_exact_confirmation(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            embed_cli.parse_args(
                [
                    "--leaf-artifact",
                    "leaf.jsonl",
                    "--parent-artifact",
                    "parent.jsonl",
                    "--build-report",
                    "build.json",
                    "--output",
                    "embedding.jsonl",
                    "--expected-video-id",
                    "video-1",
                    "--expected-parent-count",
                    "1",
                    "--execute",
                    "--confirm-live",
                    "WRONG",
                ]
            )


if __name__ == "__main__":
    unittest.main()
