import math
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from segment_media_embedding import (DIMENSION, TransientEmbeddingError, embed_with_adapter,
                                     mock_embedding, normalize_chunk, prepare_chunks, sample_window)


class SegmentMediaTests(unittest.TestCase):
    def chunk(self, start=10, end=12):
        return normalize_chunk({"courseId": "course", "video_id": "video", "chunk_id": "video_chunk_0001",
                                "start_sec": start, "end_sec": end, "text": "範例"})

    def test_short_window_keeps_original_times_and_clamps_edges(self):
        chunk = self.chunk()
        self.assertEqual(sample_window(chunk, 100), (7, 15))
        self.assertEqual((chunk["startSec"], chunk["endSec"]), (10, 12))
        self.assertEqual(sample_window(self.chunk(0, 2), 100), (0, 8))
        self.assertEqual(sample_window(self.chunk(98, 100), 100), (92, 100))
        self.assertEqual(sample_window(self.chunk(0, 2), 3), (0, 3))

    def test_limits_and_invalid_timestamps(self):
        self.assertIsNone(sample_window(self.chunk(0, 61), 100))
        self.assertEqual(sample_window(self.chunk(0, 60), 100), (0, 60))
        with self.assertRaises(ValueError):
            sample_window(self.chunk(98, 101), 100)
        for start, end in ((-1, 2), (1, 1), (0, math.inf), (False, 2)):
            with self.assertRaises(ValueError):
                self.chunk(start, end)

    def test_adapter_dimensions_norm_and_bounded_retries(self):
        calls = []
        delays = []
        def adapter(path, modality):
            calls.append(modality)
            if len(calls) < 3:
                raise TransientEmbeddingError()
            return [1.0] * DIMENSION
        result = embed_with_adapter(Path("unused"), "audio", adapter,
                                    provider="mock", model="mock", sleep=delays.append)
        self.assertEqual(delays, [1, 2])
        self.assertAlmostEqual(sum(value * value for value in result["embedding"]), 1)
        for vector in ([1], [0] * DIMENSION, [float("nan")] * DIMENSION):
            with self.assertRaises(ValueError):
                embed_with_adapter(Path("unused"), "audio", lambda *_: vector, provider="mock", model="mock")
        with self.assertRaises(ValueError):
            embed_with_adapter(Path("unused"), "audio", adapter, provider="gemini", model="preview")

    def test_checkpoint_reuses_success_and_invalidates_changed_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "source.mp4"
            video.write_bytes(b"first")
            def cut(source, target, *args):
                target.write_bytes(source.read_bytes())
            with patch("segment_media_embedding.probe_duration", return_value=100), \
                 patch("segment_media_embedding.cut_media", side_effect=cut) as cutter:
                first = prepare_chunks(video, [self.chunk()], root / "out", max_cost_usd=0)
                again = prepare_chunks(video, [self.chunk()], root / "out", max_cost_usd=0)
                self.assertEqual(cutter.call_count, 2)
                self.assertTrue(all(record["reused"] for record in again["records"]))
                self.assertEqual(first["records"][0]["provider"], "mock")
                video.write_bytes(b"changed")
                prepare_chunks(video, [self.chunk()], root / "out", max_cost_usd=0)
                self.assertEqual(cutter.call_count, 4)

    def test_failures_and_skips_are_recorded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "source.mp4"
            video.write_bytes(b"source")
            with patch("segment_media_embedding.probe_duration", return_value=100), \
                 patch("segment_media_embedding.cut_media", side_effect=OSError("failure")):
                failed = prepare_chunks(video, [self.chunk()], root / "failed", max_cost_usd=0)
                self.assertTrue(all(record["status"] == "failed" for record in failed["records"]))
                skipped = prepare_chunks(video, [self.chunk(0, 61)], root / "skipped", max_cost_usd=0)
                self.assertTrue(all(record["skipReason"] == "skipped_too_long" for record in skipped["records"]))

    def test_mock_vector_is_deterministic(self):
        with tempfile.TemporaryDirectory() as directory:
            media = Path(directory) / "audio.wav"
            media.write_bytes(b"mock")
            self.assertEqual(mock_embedding(media, "audio"), mock_embedding(media, "audio"))


if __name__ == "__main__":
    unittest.main()
