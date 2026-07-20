import json
import sys
import tempfile
import unittest
from collections import OrderedDict
from pathlib import Path
from types import SimpleNamespace


SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from chunk_strategy import build_chunk_config_fingerprint, build_chunk_config_snapshot
from job_manager import STAGE_NAMES, create_manifest, load_manifest
from resume_checkpoint import build_resume_plan
from run_summary import write_run_summary
from utils import (
    ChunkRecord,
    TranscriptDocument,
    TranscriptSegment,
    VideoMetadata,
    write_json_file,
    write_jsonl_file,
)


def snapshot(
    *,
    max_chars: int = 220,
    max_duration: float = 45.0,
    max_segments: int = 6,
    overlap: int = 0,
):
    return build_chunk_config_snapshot(
        SimpleNamespace(
            chunk_max_chars=max_chars,
            chunk_max_duration_sec=max_duration,
            chunk_max_segments=max_segments,
            chunk_overlap_segments=overlap,
        )
    )


class ResumeChunkFingerprintTests(unittest.TestCase):
    def _make_run(self, root: Path, stored_config=None):
        fingerprint = build_chunk_config_fingerprint(stored_config) if stored_config else None
        manager = create_manifest(
            root / "runs",
            "run_fixture",
            chunk_config=stored_config,
            chunk_config_fingerprint=fingerprint,
        )
        video = VideoMetadata(
            video_id="video_001",
            file_name="fixture.mp4",
            file_path="fixture.mp4",
            audio_path="audio.wav",
            duration_sec=10.0,
            course_name=None,
            week=None,
            lesson=None,
        )
        manager.add_video(video.video_id, video.file_name, video.file_path)
        for stage_name in ("scan", "extract_audio", "transcribe", "normalize", "chunk"):
            manager.manifest["videos"][0]["stages"][stage_name]["status"] = "completed"
        manager._persist()

        run_dir = manager.manifest_path.parent
        segment = TranscriptSegment("video_001_seg_0001", 0.0, 1.0, "測試內容")
        document = TranscriptDocument("video_001", [segment])
        chunk = ChunkRecord(
            "video_001_chunk_0001",
            "video_001",
            0.0,
            1.0,
            "測試內容",
            None,
            None,
            None,
        )
        write_json_file(run_dir / "videos.json", [video.to_dict()], backup_existing=False)
        write_json_file(run_dir / "transcripts.json", [document.to_dict()], backup_existing=False)
        write_json_file(
            run_dir / "transcripts_normalized.json",
            [document.to_dict(include_normalization=True)],
            backup_existing=False,
        )
        write_jsonl_file(run_dir / "chunks.jsonl", [chunk.to_dict()], backup_existing=False)
        (root / "audio.wav").write_bytes(b"offline-audio")
        return manager

    def _plan(self, manager, root: Path, current_config):
        return build_resume_plan(
            manager,
            root,
            current_config,
            build_chunk_config_fingerprint(current_config),
        )

    def test_same_fingerprint_skips_chunk(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config = snapshot(overlap=1)
            plan = self._plan(self._make_run(root, config), root, config)
            self.assertIn("chunk", plan.skipped_stages)
            self.assertEqual(plan.restart_stage, "text_embedding")

    def test_overlap_change_restarts_from_chunk(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manager = self._make_run(root, snapshot(overlap=0))
            plan = self._plan(manager, root, snapshot(overlap=1))
            self.assertEqual(plan.restart_stage, "chunk")

    def test_max_chars_change_restarts_from_chunk(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manager = self._make_run(root, snapshot())
            self.assertEqual(self._plan(manager, root, snapshot(max_chars=300)).restart_stage, "chunk")

    def test_duration_change_restarts_from_chunk(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manager = self._make_run(root, snapshot())
            self.assertEqual(self._plan(manager, root, snapshot(max_duration=30)).restart_stage, "chunk")

    def test_max_segments_change_restarts_from_chunk(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manager = self._make_run(root, snapshot())
            self.assertEqual(self._plan(manager, root, snapshot(max_segments=5)).restart_stage, "chunk")

    def test_legacy_manifest_with_legacy_defaults_can_skip_chunk(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manager = self._make_run(root)
            plan = self._plan(manager, root, snapshot())
            self.assertIn("chunk", plan.skipped_stages)

    def test_legacy_manifest_with_overlap_restarts_from_chunk(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manager = self._make_run(root)
            self.assertEqual(self._plan(manager, root, snapshot(overlap=1)).restart_stage, "chunk")

    def test_fingerprint_is_deterministic(self) -> None:
        config = snapshot(overlap=1)
        self.assertEqual(
            build_chunk_config_fingerprint(config),
            build_chunk_config_fingerprint(config),
        )

    def test_fingerprint_ignores_mapping_key_order(self) -> None:
        config = snapshot(overlap=1)
        reversed_config = OrderedDict(reversed(list(config.items())))
        self.assertEqual(
            build_chunk_config_fingerprint(config),
            build_chunk_config_fingerprint(reversed_config),
        )

    def test_chunk_invalidation_resets_all_downstream_stages(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manager = self._make_run(root, snapshot())
            for stage_name in STAGE_NAMES:
                manager.manifest["videos"][0]["stages"][stage_name]["status"] = "completed"
            manager._persist()
            self._plan(manager, root, snapshot(overlap=1))
            chunk_index = STAGE_NAMES.index("chunk")
            for stage_name in STAGE_NAMES[chunk_index:]:
                self.assertEqual(
                    manager.manifest["videos"][0]["stages"][stage_name]["status"],
                    "pending",
                )

    def test_old_manifest_without_optional_fields_still_loads(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manager = self._make_run(root)
            loaded = load_manifest(root / "runs", manager.run_id)
            self.assertNotIn("chunk_config", loaded.manifest)
            self.assertNotIn("chunk_config_fingerprint", loaded.manifest)

    def test_corrupt_fingerprint_cannot_skip_chunk(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config = snapshot()
            manager = self._make_run(root, config)
            manager.manifest["chunk_config_fingerprint"] = "not-a-sha256"
            manager._persist()
            self.assertEqual(self._plan(manager, root, config).restart_stage, "chunk")

    def test_snapshot_and_fingerprint_persist_in_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = snapshot(overlap=2)
            manager = create_manifest(
                Path(temp_dir),
                "run_metadata",
                chunk_config=config,
                chunk_config_fingerprint=build_chunk_config_fingerprint(config),
            )
            payload = json.loads(manager.manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["chunk_config"], config)
            self.assertEqual(payload["chunk_config_fingerprint"], build_chunk_config_fingerprint(config))

    def test_snapshot_and_fingerprint_persist_in_run_summary(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = snapshot(overlap=1)
            fingerprint = build_chunk_config_fingerprint(config)
            output_path = write_run_summary(
                Path(temp_dir),
                "run_summary_metadata",
                "completed",
                "2026-07-20T00:00:00+00:00",
                chunk_config=config,
                chunk_config_fingerprint=fingerprint,
            )
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["chunk_config"], config)
            self.assertEqual(payload["chunk_overlap_segments"], 1)
            self.assertEqual(payload["chunk_config_fingerprint"], fingerprint)


if __name__ == "__main__":
    unittest.main()
