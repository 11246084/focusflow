import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from chunk_strategy import build_chunk_config_fingerprint, build_chunk_config_snapshot
from config import PipelineConfig
from hierarchy_chunking import (
    DOCUMENT_TYPE,
    HIERARCHY_LEVEL,
    HierarchyArtifactError,
    build_child_to_parent_index,
    build_parent_chunks,
    validate_parent_artifact,
    write_parent_chunks,
)
from hierarchy_strategy import (
    HIERARCHY_TEXT_JOINER_VERSION,
    build_hierarchy_config_fingerprint,
    build_hierarchy_config_snapshot,
    validate_hierarchy_settings,
)
from job_manager import STAGE_NAMES, create_manifest
from resume_checkpoint import build_resume_plan
from utils import (
    ChunkRecord,
    TranscriptDocument,
    TranscriptSegment,
    VideoMetadata,
    write_json_file,
    write_jsonl_file,
)


def leaf(index, *, video_id="video_001", start=None, end=None, text=None):
    start = float((index - 1) * 10 if start is None else start)
    end = float(index * 10 if end is None else end)
    return ChunkRecord(
        f"{video_id}_chunk_{index:04d}",
        video_id,
        start,
        end,
        text or f"第{index}段",
        "課程",
        "第一週",
        "第一課",
    )


def hierarchy_snapshot(enabled=True, count=3, overlap=0):
    return build_hierarchy_config_snapshot(
        SimpleNamespace(
            hierarchy_enabled=enabled,
            hierarchy_parent_leaf_count=count,
            hierarchy_parent_overlap_leaves=overlap,
        )
    )


def chunk_snapshot(overlap=0):
    return build_chunk_config_snapshot(
        SimpleNamespace(
            chunk_max_chars=220,
            chunk_max_duration_sec=45,
            chunk_max_segments=6,
            chunk_overlap_segments=overlap,
        )
    )


class ParentGenerationTests(unittest.TestCase):
    def test_group_sizes_and_tail_windows(self):
        expected = {
            0: [],
            1: [1],
            2: [2],
            3: [3],
            4: [3, 1],
            6: [3, 3],
            7: [3, 3, 1],
        }
        for count, child_counts in expected.items():
            with self.subTest(count=count):
                parents = build_parent_chunks([leaf(i) for i in range(1, count + 1)], 3, 0)
                self.assertEqual([parent.child_count for parent in parents], child_counts)

    def test_deterministic_ids_order_and_output(self):
        leaves = [leaf(i) for i in range(1, 8)]
        first = build_parent_chunks(leaves, 3, 0)
        second = build_parent_chunks(leaves, 3, 0)
        self.assertEqual(first, second)
        self.assertEqual([item.parent_id for item in first], [
            "video_001_parent_0001",
            "video_001_parent_0002",
            "video_001_parent_0003",
        ])
        self.assertEqual([item.order for item in first], [1, 2, 3])
        self.assertTrue(all("_parent_" in item.parent_id and item.parent_id not in {
            item_id.chunk_id for item_id in leaves
        } for item in first))

    def test_text_timestamp_and_metadata_are_canonical(self):
        leaves = [
            leaf(1, start=0, end=12, text="第一段"),
            leaf(2, start=10, end=20, text="第二段"),
            leaf(3, start=20, end=30, text="第三段"),
        ]
        parent = build_parent_chunks(leaves, 3, 0)[0]
        self.assertEqual(parent.text, "第一段\n第二段\n第三段")
        self.assertEqual((parent.start_sec, parent.end_sec), (0, 30))
        self.assertEqual((parent.course_name, parent.week, parent.lesson), ("課程", "第一週", "第一課"))
        self.assertEqual(parent.hierarchy_level, HIERARCHY_LEVEL)
        self.assertEqual(parent.document_type, DOCUMENT_TYPE)

    def test_overlap_windows_step_and_no_duplicate_tail(self):
        leaves = [leaf(i) for i in range(1, 8)]
        overlap_one = build_parent_chunks(leaves, 3, 1)
        self.assertEqual(
            [item.child_chunk_ids for item in overlap_one],
            [
                [leaves[0].chunk_id, leaves[1].chunk_id, leaves[2].chunk_id],
                [leaves[2].chunk_id, leaves[3].chunk_id, leaves[4].chunk_id],
                [leaves[4].chunk_id, leaves[5].chunk_id, leaves[6].chunk_id],
            ],
        )
        overlap_two = build_parent_chunks(leaves[:4], 3, 2)
        self.assertEqual([item.child_count for item in overlap_two], [3, 3])
        self.assertEqual(len({tuple(item.child_chunk_ids) for item in overlap_two}), 2)

    def test_multi_video_has_separate_id_and_order_namespaces(self):
        parents = build_parent_chunks(
            [leaf(1), leaf(2), leaf(1, video_id="video_002"), leaf(2, video_id="video_002")],
            3,
            0,
        )
        self.assertEqual([parent.order for parent in parents], [1, 1])
        self.assertEqual([parent.video_id for parent in parents], ["video_001", "video_002"])

    def test_reverse_index_supports_overlap(self):
        leaves = [leaf(i) for i in range(1, 6)]
        parents = build_parent_chunks(leaves, 3, 1)
        index = build_child_to_parent_index(parents)
        self.assertEqual(index[leaves[2].chunk_id], [
            "video_001_parent_0001",
            "video_001_parent_0002",
        ])

    def test_invalid_leaf_data_fails_clearly(self):
        blank = leaf(1)
        blank.text = ""
        with self.assertRaisesRegex(ValueError, "non-empty"):
            build_parent_chunks([blank], 3, 0)
        with self.assertRaisesRegex(ValueError, "timestamp"):
            build_parent_chunks([leaf(1, start=20, end=10)], 3, 0)


class HierarchyConfigTests(unittest.TestCase):
    def test_defaults_and_environment_loading(self):
        with tempfile.TemporaryDirectory() as temp_dir, patch.dict(
            os.environ,
            {
                "HIERARCHY_ENABLED": "false",
                "HIERARCHY_PARENT_LEAF_COUNT": "3",
                "HIERARCHY_PARENT_OVERLAP_LEAVES": "0",
            },
            clear=False,
        ):
            config = PipelineConfig.from_env(Path(temp_dir))
            self.assertFalse(config.hierarchy_enabled)
            self.assertEqual(config.hierarchy_parent_leaf_count, 3)
            self.assertEqual(config.hierarchy_parent_overlap_leaves, 0)

    def test_valid_ranges(self):
        for count in range(2, 9):
            for overlap in range(0, min(2, count - 1) + 1):
                validate_hierarchy_settings(True, count, overlap)

    def test_invalid_ranges_and_types(self):
        for args in [
            (True, 1, 0),
            (True, 9, 0),
            (True, 3, -1),
            (True, 3, 3),
            (True, 2, 2),
            (True, 3.0, 0),
            ("true", 3, 0),
        ]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                validate_hierarchy_settings(*args)

    def test_non_integer_and_invalid_boolean_env_fail(self):
        for name, value in [
            ("HIERARCHY_PARENT_LEAF_COUNT", "3.0"),
            ("HIERARCHY_PARENT_OVERLAP_LEAVES", "one"),
            ("HIERARCHY_ENABLED", "yes"),
        ]:
            with tempfile.TemporaryDirectory() as temp_dir, patch.dict(
                os.environ, {name: value}, clear=False
            ):
                with self.assertRaises(ValueError):
                    PipelineConfig.from_env(Path(temp_dir))

    def test_with_overrides_revalidates(self):
        with tempfile.TemporaryDirectory() as temp_dir, patch.dict(
            os.environ,
            {
                "HIERARCHY_ENABLED": "false",
                "HIERARCHY_PARENT_LEAF_COUNT": "3",
                "HIERARCHY_PARENT_OVERLAP_LEAVES": "0",
            },
            clear=False,
        ):
            config = PipelineConfig.from_env(Path(temp_dir))
            with self.assertRaises(ValueError):
                config.with_overrides(
                    hierarchy_parent_leaf_count=2,
                    hierarchy_parent_overlap_leaves=2,
                )

    def test_fingerprint_dependencies_are_deterministic(self):
        config = hierarchy_snapshot()
        leaf_fingerprint = build_chunk_config_fingerprint(chunk_snapshot())
        first = build_hierarchy_config_fingerprint(config, leaf_fingerprint)
        self.assertEqual(first, build_hierarchy_config_fingerprint(config, leaf_fingerprint))
        self.assertNotEqual(first, build_hierarchy_config_fingerprint(hierarchy_snapshot(count=4), leaf_fingerprint))
        self.assertNotEqual(first, build_hierarchy_config_fingerprint(hierarchy_snapshot(overlap=1), leaf_fingerprint))
        self.assertNotEqual(first, build_hierarchy_config_fingerprint(config, "a" * 64))
        changed_joiner = dict(config, text_joiner_version="space_v1")
        self.assertNotEqual(first, build_hierarchy_config_fingerprint(changed_joiner, leaf_fingerprint))
        self.assertEqual(config["text_joiner_version"], HIERARCHY_TEXT_JOINER_VERSION)


class ArtifactValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.path = Path(self.temp_dir.name) / "parent_chunks.jsonl"
        self.leaves = [leaf(i) for i in range(1, 5)]
        self.parents = build_parent_chunks(self.leaves, 3, 0)
        write_parent_chunks(self.path, self.parents)

    def tearDown(self):
        self.temp_dir.cleanup()

    def rows(self):
        return [json.loads(line) for line in self.path.read_text(encoding="utf-8").splitlines()]

    def write_rows(self, rows):
        self.path.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
            encoding="utf-8",
        )

    def test_valid_artifact_round_trip(self):
        self.assertEqual(validate_parent_artifact(self.path, self.leaves), self.parents)

    def test_missing_and_malformed_artifacts_fail(self):
        with self.assertRaises(HierarchyArtifactError):
            validate_parent_artifact(self.path.with_name("missing.jsonl"), self.leaves)
        self.path.write_text("{broken\n", encoding="utf-8")
        with self.assertRaises(HierarchyArtifactError):
            validate_parent_artifact(self.path, self.leaves)

    def test_duplicate_id_empty_children_and_count_mismatch_fail(self):
        for mutate in [
            lambda rows: rows.append(dict(rows[0])),
            lambda rows: rows[0].update(child_chunk_ids=[], child_count=0),
            lambda rows: rows[0].update(child_count=99),
        ]:
            write_parent_chunks(self.path, self.parents)
            rows = self.rows()
            mutate(rows)
            self.write_rows(rows)
            with self.assertRaises(HierarchyArtifactError):
                validate_parent_artifact(self.path, self.leaves)

    def test_unknown_and_cross_video_children_fail(self):
        rows = self.rows()
        rows[0]["child_chunk_ids"][0] = "missing"
        self.write_rows(rows)
        with self.assertRaises(HierarchyArtifactError):
            validate_parent_artifact(self.path, self.leaves)
        foreign = leaf(1, video_id="video_002")
        rows = self.parents[0].to_dict()
        rows["child_chunk_ids"][0] = foreign.chunk_id
        self.write_rows([rows])
        with self.assertRaises(HierarchyArtifactError):
            validate_parent_artifact(self.path, [foreign, *self.leaves])

    def test_timestamp_text_level_type_and_order_fail(self):
        mutations = [
            lambda row: row.update(start_sec=99),
            lambda row: row.update(text="rewritten"),
            lambda row: row.update(hierarchy_level=2),
            lambda row: row.update(document_type="summary"),
            lambda row: row.update(order=2),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                row = self.parents[0].to_dict()
                mutate(row)
                self.write_rows([row])
                with self.assertRaises(HierarchyArtifactError):
                    validate_parent_artifact(self.path, self.leaves)


class HierarchyResumeTests(unittest.TestCase):
    def make_run(self, root, *, enabled=True, include_hierarchy=True):
        chunk_config = chunk_snapshot()
        chunk_fingerprint = build_chunk_config_fingerprint(chunk_config)
        hierarchy_config = hierarchy_snapshot(enabled=enabled)
        hierarchy_fingerprint = build_hierarchy_config_fingerprint(
            hierarchy_config, chunk_fingerprint
        )
        manager = create_manifest(
            root / "runs",
            "run_fixture",
            chunk_config=chunk_config,
            chunk_config_fingerprint=chunk_fingerprint,
            hierarchy_config=hierarchy_config if include_hierarchy else None,
            hierarchy_config_fingerprint=hierarchy_fingerprint if include_hierarchy else None,
        )
        video = VideoMetadata("video_001", "fixture.mp4", "fixture.mp4", "audio.wav", 10, None, None, None)
        manager.add_video(video.video_id, video.file_name, video.file_path)
        stages = ["scan", "extract_audio", "transcribe", "normalize", "chunk"]
        if include_hierarchy:
            stages.append("hierarchy")
        for stage in stages:
            manager.manifest["videos"][0]["stages"][stage]["status"] = "completed"
        manager._persist()
        run_dir = manager.manifest_path.parent
        segment = TranscriptSegment("video_001_seg_0001", 0, 10, "第一段")
        transcript = TranscriptDocument("video_001", [segment])
        leaves = [leaf(1)]
        write_json_file(run_dir / "videos.json", [video.to_dict()], backup_existing=False)
        write_json_file(run_dir / "transcripts.json", [transcript.to_dict()], backup_existing=False)
        write_json_file(run_dir / "transcripts_normalized.json", [transcript.to_dict()], backup_existing=False)
        write_jsonl_file(run_dir / "chunks.jsonl", [item.to_dict() for item in leaves], backup_existing=False)
        (root / "audio.wav").write_bytes(b"offline")
        if include_hierarchy and enabled:
            write_parent_chunks(run_dir / "parent_chunks.jsonl", build_parent_chunks(leaves, 3, 0))
        return manager, chunk_config, chunk_fingerprint, hierarchy_config, hierarchy_fingerprint

    def plan(self, manager, root, chunk_config, chunk_fingerprint, hierarchy_config, hierarchy_fingerprint):
        return build_resume_plan(
            manager,
            root,
            chunk_config,
            chunk_fingerprint,
            hierarchy_config,
            hierarchy_fingerprint,
        )

    def test_same_fingerprint_and_valid_artifact_reuses_hierarchy(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            values = self.make_run(root)
            plan = self.plan(values[0], root, *values[1:])
            self.assertIn("hierarchy", plan.skipped_stages)
            self.assertEqual(plan.restart_stage, "text_embedding")

    def test_disabled_legacy_manifest_is_compatible(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manager, chunk_config, chunk_fp, hierarchy_config, hierarchy_fp = self.make_run(
                root, enabled=False, include_hierarchy=False
            )
            plan = self.plan(manager, root, chunk_config, chunk_fp, hierarchy_config, hierarchy_fp)
            self.assertIn("hierarchy", plan.skipped_stages)
            self.assertEqual(plan.restart_stage, "text_embedding")

    def test_enabled_legacy_manifest_restarts_at_hierarchy(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manager, chunk_config, chunk_fp, _, _ = self.make_run(
                root, enabled=False, include_hierarchy=False
            )
            hierarchy_config = hierarchy_snapshot(enabled=True)
            hierarchy_fp = build_hierarchy_config_fingerprint(hierarchy_config, chunk_fp)
            plan = self.plan(manager, root, chunk_config, chunk_fp, hierarchy_config, hierarchy_fp)
            self.assertEqual(plan.restart_stage, "hierarchy")

    def test_config_change_missing_and_corrupt_artifact_restart_hierarchy(self):
        cases = ("config", "missing", "corrupt")
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as temp_dir:
                root = Path(temp_dir)
                manager, chunk_config, chunk_fp, hierarchy_config, hierarchy_fp = self.make_run(root)
                artifact = manager.manifest_path.parent / "parent_chunks.jsonl"
                if case == "config":
                    hierarchy_config = hierarchy_snapshot(count=4)
                    hierarchy_fp = build_hierarchy_config_fingerprint(hierarchy_config, chunk_fp)
                elif case == "missing":
                    artifact.unlink()
                else:
                    artifact.write_text("{broken\n", encoding="utf-8")
                plan = self.plan(manager, root, chunk_config, chunk_fp, hierarchy_config, hierarchy_fp)
                self.assertEqual(plan.restart_stage, "hierarchy")

    def test_leaf_change_restarts_chunk_and_invalidates_hierarchy_downstream(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manager, _, _, hierarchy_config, _ = self.make_run(root)
            for stage in STAGE_NAMES:
                manager.manifest["videos"][0]["stages"][stage]["status"] = "completed"
            manager._persist()
            changed_chunk = chunk_snapshot(overlap=1)
            changed_fp = build_chunk_config_fingerprint(changed_chunk)
            hierarchy_fp = build_hierarchy_config_fingerprint(hierarchy_config, changed_fp)
            plan = self.plan(manager, root, changed_chunk, changed_fp, hierarchy_config, hierarchy_fp)
            self.assertEqual(plan.restart_stage, "chunk")
            for stage in STAGE_NAMES[STAGE_NAMES.index("chunk"):]:
                self.assertEqual(manager.manifest["videos"][0]["stages"][stage]["status"], "pending")


if __name__ == "__main__":
    unittest.main()
