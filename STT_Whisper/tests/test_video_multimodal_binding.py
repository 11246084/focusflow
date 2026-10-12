"""Offline tests for binding video multimodal clips to course videos."""

from __future__ import annotations

import argparse
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

import video_multimodal_pipeline as pipeline  # noqa: E402

VIDEO_ID = "66f8a1b2c3d4e5f6a7b8c9d0"


def make_args(**overrides) -> argparse.Namespace:
    values = {"video_path": None, "video_id": None, "upload": False}
    values.update(overrides)
    return argparse.Namespace(**values)


class BindingArgumentTests(unittest.TestCase):
    def test_accepts_object_id_with_video_path_and_upload(self) -> None:
        pipeline.validate_binding_args(
            make_args(video_path=Path("lecture.mp4"), video_id=VIDEO_ID, upload=True)
        )

    def test_legacy_scan_without_binding_is_still_allowed(self) -> None:
        pipeline.validate_binding_args(make_args())

    def test_rejects_non_object_id(self) -> None:
        with self.assertRaises(ValueError):
            pipeline.validate_binding_args(make_args(video_path=Path("a.mp4"), video_id="video_001"))

    def test_rejects_video_id_without_video_path(self) -> None:
        with self.assertRaises(ValueError):
            pipeline.validate_binding_args(make_args(video_id=VIDEO_ID))

    def test_rejects_upload_without_binding(self) -> None:
        with self.assertRaises(ValueError):
            pipeline.validate_binding_args(make_args(upload=True))

    def test_bound_output_path_is_per_video(self) -> None:
        config = SimpleNamespace(
            video_embeddings_output_path=Path("data/outputs/embeddings_video_gemini.jsonl")
        )
        self.assertEqual(
            pipeline.bound_video_embeddings_output_path(config, VIDEO_ID),
            Path("data/outputs/video_embeddings") / f"{VIDEO_ID}.jsonl",
        )


if __name__ == "__main__":
    unittest.main()
