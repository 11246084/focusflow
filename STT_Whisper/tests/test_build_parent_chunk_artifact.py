import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path


SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

import build_parent_chunk_artifact as cli


def _leaf(index: int, video_id: str = "video-1") -> dict:
    return {
        "chunk_id": f"{video_id}_chunk_{index:04d}",
        "video_id": video_id,
        "start_sec": float(index * 10),
        "end_sec": float(index * 10 + 9),
        "text": f"leaf {index}",
        "course_name": None,
        "week": None,
        "lesson": None,
    }


class BuildParentChunkArtifactTests(unittest.TestCase):
    def _write_jsonl(self, path: Path, rows: list[dict]) -> None:
        path.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
            encoding="utf-8",
        )

    def test_builds_validated_artifact_and_evidence(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            leaf_path = root / "leaf.jsonl"
            parent_path = root / "parent.jsonl"
            report_path = root / "report.json"
            self._write_jsonl(leaf_path, [_leaf(index) for index in range(1, 6)])

            stdout = io.StringIO()
            with redirect_stdout(stdout):
                result = cli.main(
                    [
                        "--leaf-artifact",
                        str(leaf_path),
                        "--parent-artifact",
                        str(parent_path),
                        "--expected-video-id",
                        "video-1",
                        "--report",
                        str(report_path),
                        "--parent-leaf-count",
                        "3",
                        "--parent-overlap-leaves",
                        "1",
                    ]
                )

            self.assertEqual(result, 0)
            evidence = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(evidence["status"], "validated")
            self.assertEqual(evidence["counts"], {"leaf": 5, "parent": 2})
            self.assertEqual(evidence["scope"]["expectedVideoId"], "video-1")
            self.assertEqual(len(evidence["sourceLeafArtifact"]["sha256"]), 64)
            self.assertEqual(len(evidence["parentArtifact"]["sha256"]), 64)
            self.assertEqual(len(evidence["hierarchyConfigFingerprint"]), 64)
            self.assertEqual(json.loads(stdout.getvalue()), evidence)

            parent_rows = [
                json.loads(line)
                for line in parent_path.read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(
                parent_rows[0]["child_chunk_ids"],
                [
                    "video-1_chunk_0001",
                    "video-1_chunk_0002",
                    "video-1_chunk_0003",
                ],
            )
            self.assertEqual(
                parent_rows[1]["child_chunk_ids"],
                [
                    "video-1_chunk_0003",
                    "video-1_chunk_0004",
                    "video-1_chunk_0005",
                ],
            )

    def test_rejects_mixed_or_unexpected_video_scope(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            leaf_path = root / "leaf.jsonl"
            self._write_jsonl(leaf_path, [_leaf(1), _leaf(2, "video-2")])

            with self.assertRaisesRegex(ValueError, "video scope mismatch"):
                cli.main(
                    [
                        "--leaf-artifact",
                        str(leaf_path),
                        "--parent-artifact",
                        str(root / "parent.jsonl"),
                        "--expected-video-id",
                        "video-1",
                    ]
                )

    def test_rejects_duplicate_leaf_ids(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            leaf_path = root / "leaf.jsonl"
            self._write_jsonl(leaf_path, [_leaf(1), _leaf(1)])

            with self.assertRaisesRegex(ValueError, "Duplicate Leaf chunk_id"):
                cli.main(
                    [
                        "--leaf-artifact",
                        str(leaf_path),
                        "--parent-artifact",
                        str(root / "parent.jsonl"),
                        "--expected-video-id",
                        "video-1",
                    ]
                )


if __name__ == "__main__":
    unittest.main()
