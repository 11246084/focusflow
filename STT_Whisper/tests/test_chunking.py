import os
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from chunk_strategy import validate_chunk_settings
from chunking import build_chunks_for_transcript
from config import PipelineConfig
from utils import TranscriptDocument, TranscriptSegment, VideoMetadata


def make_video(video_id: str = "video_001") -> VideoMetadata:
    return VideoMetadata(
        video_id=video_id,
        file_name="fixture.mp4",
        file_path="fixture.mp4",
        audio_path="fixture.wav",
        duration_sec=120.0,
        course_name="測試課程",
        week="1",
        lesson="1",
    )


def make_segments(texts: list[str], duration: float = 1.0, gap: float = 0.0) -> list[TranscriptSegment]:
    segments = []
    cursor = 0.0
    for index, text in enumerate(texts, start=1):
        segments.append(
            TranscriptSegment(
                segment_id=f"video_001_seg_{index:04d}",
                start_sec=cursor,
                end_sec=cursor + duration,
                text=text,
            )
        )
        cursor += duration + gap
    return segments


def make_config(
    *,
    overlap: int = 0,
    max_chars: int = 220,
    max_segments: int = 3,
    max_duration: float = 45.0,
):
    return SimpleNamespace(
        chunk_overlap_segments=overlap,
        chunk_max_chars=max_chars,
        chunk_max_segments=max_segments,
        chunk_max_duration_sec=max_duration,
    )


def build(texts: list[str], **config_kwargs):
    document = TranscriptDocument("video_001", make_segments(texts))
    return build_chunks_for_transcript(make_video(), document, make_config(**config_kwargs))


def tokens(chunks) -> list[list[str]]:
    return [chunk.text.split() for chunk in chunks]


class ChunkConfigValidationTests(unittest.TestCase):
    def test_allowed_overlap_values(self) -> None:
        for value in (0, 1, 2):
            validate_chunk_settings(max_segments=6, overlap_segments=value)

    def test_negative_and_too_large_overlap_are_rejected(self) -> None:
        for value in (-1, 3):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "must be one of"):
                validate_chunk_settings(max_segments=6, overlap_segments=value)

    def test_overlap_must_be_smaller_than_max_segments(self) -> None:
        with self.assertRaisesRegex(ValueError, "smaller than CHUNK_MAX_SEGMENTS"):
            validate_chunk_settings(max_segments=2, overlap_segments=2)

    def test_non_integer_env_value_fails_during_config_load(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.dict(
            os.environ,
            {"CHUNK_OVERLAP_SEGMENTS": "invalid", "CHUNK_MAX_SEGMENTS": "6"},
            clear=False,
        ):
            with self.assertRaisesRegex(ValueError, "must be an integer"):
                PipelineConfig.from_env(Path(temp_dir))


class SegmentOverlapTests(unittest.TestCase):
    def test_overlap_zero_matches_legacy_output(self) -> None:
        chunks = build(["S1", "S2", "S3", "S4", "S5", "S6", "S7"], overlap=0)
        self.assertEqual(tokens(chunks), [["S1", "S2", "S3"], ["S4", "S5", "S6"], ["S7"]])

    def test_overlap_one_shares_one_segment(self) -> None:
        chunks = build(["S1", "S2", "S3", "S4", "S5"], overlap=1)
        self.assertEqual(tokens(chunks), [["S1", "S2", "S3"], ["S3", "S4", "S5"]])

    def test_overlap_two_shares_at_most_two_segments(self) -> None:
        chunks = build(["S1", "S2", "S3", "S4"], overlap=2)
        self.assertEqual(tokens(chunks), [["S1", "S2", "S3"], ["S2", "S3", "S4"]])

    def test_overlap_two_shrinks_to_one_when_needed(self) -> None:
        chunks = build(["A", "B", "C", "DDDDDDDD"], overlap=2, max_chars=10)
        self.assertEqual(tokens(chunks), [["A", "B", "C"], ["C", "DDDDDDDD"]])

    def test_overlap_one_shrinks_to_zero_when_needed(self) -> None:
        chunks = build(["A", "B", "CCCC", "DDDDDD"], overlap=1, max_chars=10)
        self.assertEqual(tokens(chunks), [["A", "B", "CCCC"], ["DDDDDD"]])

    def test_every_new_chunk_contains_a_new_segment(self) -> None:
        chunks = build([f"S{i}" for i in range(1, 10)], overlap=2)
        seen = set()
        for chunk_tokens in tokens(chunks):
            self.assertTrue(any(token not in seen for token in chunk_tokens))
            seen.update(chunk_tokens)

    def test_no_overlap_only_tail_chunk_is_emitted(self) -> None:
        chunks = build(["S1", "S2", "S3", "S4"], overlap=2)
        self.assertEqual(tokens(chunks)[-1], ["S2", "S3", "S4"])
        self.assertEqual(len(chunks), 2)

    def test_many_segments_terminate_without_looping(self) -> None:
        chunks = build([f"S{i}" for i in range(100)], overlap=1, max_segments=2)
        self.assertEqual(len(chunks), 99)
        self.assertEqual(chunks[-1].text.split()[-1], "S99")

    def test_all_non_empty_segments_appear(self) -> None:
        source = [f"S{i}" for i in range(1, 9)]
        output = [token for chunk_tokens in tokens(build(source, overlap=1)) for token in chunk_tokens]
        self.assertTrue(set(source).issubset(output))

    def test_only_expected_overlap_segments_repeat(self) -> None:
        chunks = build([f"S{i}" for i in range(1, 8)], overlap=1)
        counts = Counter(token for chunk_tokens in tokens(chunks) for token in chunk_tokens)
        self.assertEqual({token for token, count in counts.items() if count == 2}, {"S3", "S5"})
        self.assertTrue(all(count <= 2 for count in counts.values()))

    def test_character_limit_is_respected(self) -> None:
        chunks = build(["aaaa", "bbbb", "cccc"], overlap=1, max_chars=9)
        self.assertTrue(all(len(chunk.text) <= 9 for chunk in chunks))
        self.assertEqual(tokens(chunks), [["aaaa", "bbbb"], ["bbbb", "cccc"]])

    def test_duration_limit_is_respected(self) -> None:
        segments = make_segments(["S1", "S2", "S3"], duration=4.0, gap=0.0)
        document = TranscriptDocument("video_001", segments)
        chunks = build_chunks_for_transcript(
            make_video(), document, make_config(overlap=1, max_duration=8.0)
        )
        self.assertEqual(tokens(chunks), [["S1", "S2"], ["S2", "S3"]])
        self.assertTrue(all(chunk.end_sec - chunk.start_sec <= 8.0 for chunk in chunks))

    def test_segment_count_limit_is_respected(self) -> None:
        chunks = build([f"S{i}" for i in range(1, 8)], overlap=2, max_segments=3)
        self.assertTrue(all(len(chunk.text.split()) <= 3 for chunk in chunks))

    def test_single_oversized_segment_keeps_legacy_behavior(self) -> None:
        chunks = build(["X" * 30], overlap=2, max_chars=10)
        self.assertEqual(len(chunks), 1)
        self.assertEqual(len(chunks[0].text), 30)

    def test_empty_transcript(self) -> None:
        document = TranscriptDocument("video_001", [])
        self.assertEqual(build_chunks_for_transcript(make_video(), document, make_config()), [])

    def test_all_whitespace_segments_are_skipped(self) -> None:
        chunks = build(["   ", "\t", "\n"], overlap=1)
        self.assertEqual(chunks, [])

    def test_single_segment(self) -> None:
        chunks = build(["唯一片段"], overlap=2)
        self.assertEqual([chunk.text for chunk in chunks], ["唯一片段"])

    def test_short_final_chunk_is_preserved(self) -> None:
        chunks = build(["S1", "S2", "S3", "尾"], overlap=0)
        self.assertEqual(chunks[-1].text, "尾")

    def test_unicode_numbers_and_punctuation_keep_joining_format(self) -> None:
        chunks = build(["中文，", "English-API", "版本 2.0！"], overlap=0)
        self.assertEqual(chunks[0].text, "中文， English-API 版本 2.0！")

    def test_overlap_timestamps_use_first_and_last_segments(self) -> None:
        segments = make_segments(["S1", "S2", "S3", "S4"], duration=1.2345, gap=0.5)
        chunks = build_chunks_for_transcript(
            make_video(), TranscriptDocument("video_001", segments), make_config(overlap=1)
        )
        self.assertEqual((chunks[1].start_sec, chunks[1].end_sec), (3.469, 6.438))

    def test_chunk_ids_are_unique_and_contiguous(self) -> None:
        chunks = build([f"S{i}" for i in range(1, 9)], overlap=2)
        expected = [f"video_001_chunk_{index:04d}" for index in range(1, len(chunks) + 1)]
        self.assertEqual([chunk.chunk_id for chunk in chunks], expected)
        self.assertEqual(len({chunk.chunk_id for chunk in chunks}), len(chunks))

    def test_jsonl_record_schema_is_unchanged(self) -> None:
        record = build(["S1"], overlap=1)[0].to_dict()
        self.assertEqual(
            set(record),
            {"chunk_id", "video_id", "start_sec", "end_sec", "text", "course_name", "week", "lesson"},
        )

    def test_overlap_zero_chunk_ids_match_legacy_sequence(self) -> None:
        chunks = build(["S1", "S2", "S3", "S4"], overlap=0)
        self.assertEqual(
            [chunk.chunk_id for chunk in chunks],
            ["video_001_chunk_0001", "video_001_chunk_0002"],
        )


if __name__ == "__main__":
    unittest.main()
