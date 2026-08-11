"""Offline contract tests for Phase 2-2 Sprint 2A Parent Embedding."""

from __future__ import annotations

import json
import math
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch


SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from config import PipelineConfig  # noqa: E402
from embedding import embed_text_contents  # noqa: E402
from embedding_contract import build_parent_document_text  # noqa: E402
from hierarchy_chunking import ParentChunkRecord  # noqa: E402
from job_manager import STAGE_NAMES, create_manifest  # noqa: E402
from parent_embedding import (  # noqa: E402
    ParentEmbeddingStageError,
    embed_parent_chunks,
    validate_parent_embedding_artifact,
)
from parent_embedding_strategy import (  # noqa: E402
    PARENT_EMBEDDING_CONTRACT_VERSION,
    PARENT_EMBEDDING_GENERATION_VERSION,
    PARENT_EMBEDDING_INSTRUCTION,
    PARENT_EMBEDDING_INSTRUCTION_VERSION,
    build_parent_embedding_config_snapshot,
    build_parent_embedding_fingerprint,
)
from resume_checkpoint import (  # noqa: E402
    CheckpointError,
    _validate_parent_embedding_fingerprint,
)
from utils import load_jsonl_file, write_jsonl_file  # noqa: E402


class ParentEmbeddingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / ".env").write_text("", encoding="utf-8")
        self.env = patch.dict(
            os.environ,
            {
                "HIERARCHY_ENABLED": "true",
                "PARENT_EMBEDDING_ENABLED": "true",
                "ENABLE_GEMINI_EMBEDDING": "false",
                "GEMINI_EMBEDDING_OUTPUT_DIM": "3072",
            },
            clear=False,
        )
        self.env.start()
        self.config = PipelineConfig.from_env(self.root).with_overrides(
            parent_embeddings_output_path=self.root / "parent.jsonl",
            backup_existing_outputs=False,
        )
        self.parents = [
            ParentChunkRecord(
                parent_id="video-1_parent_0001",
                video_id="video-1",
                hierarchy_level=1,
                document_type="parent_chunk",
                start_sec=0.0,
                end_sec=20.0,
                text="alpha beta",
                child_chunk_ids=["video-1_chunk_0001", "video-1_chunk_0002"],
                child_count=2,
                order=1,
                course_name=None,
                week=None,
                lesson=None,
            ),
            ParentChunkRecord(
                parent_id="video-1_parent_0002",
                video_id="video-1",
                hierarchy_level=1,
                document_type="parent_chunk",
                start_sec=20.0,
                end_sec=40.0,
                text="gamma delta",
                child_chunk_ids=["video-1_chunk_0003"],
                child_count=1,
                order=2,
                course_name=None,
                week=None,
                lesson=None,
            ),
        ]
        self.hierarchy_fp = "a" * 64
        self.leaf_fp = "b" * 64
        snapshot = build_parent_embedding_config_snapshot(self.config)
        self.parent_fp = build_parent_embedding_fingerprint(snapshot, self.hierarchy_fp)

    def tearDown(self) -> None:
        self.env.stop()
        self.temp.cleanup()

    @staticmethod
    def fake_provider(texts: list[str], _: PipelineConfig):
        return [[1.0] + [0.0] * 3071 for _ in texts], "fake-request"

    def generate(self):
        return embed_parent_chunks(
            self.parents,
            self.config,
            self.hierarchy_fp,
            self.leaf_fp,
            self.parent_fp,
            provider=self.fake_provider,
        )

    def validate(self):
        return validate_parent_embedding_artifact(
            self.config.parent_embeddings_output_path,
            self.parents,
            3072,
            self.config.gemini_embedding_model_name,
            self.hierarchy_fp,
            self.leaf_fp,
            self.parent_fp,
        )

    def mutate(self, change) -> None:
        rows = load_jsonl_file(self.config.parent_embeddings_output_path)
        change(rows)
        write_jsonl_file(self.config.parent_embeddings_output_path, rows, backup_existing=False)

    def assert_invalid(self, change) -> None:
        self.generate()
        self.mutate(change)
        with self.assertRaises(ValueError):
            self.validate()

    def test_config_defaults_to_false(self):
        with patch.dict(os.environ, {"HIERARCHY_ENABLED": "false"}, clear=False):
            os.environ.pop("PARENT_EMBEDDING_ENABLED", None)
            config = PipelineConfig.from_env(self.root)
        self.assertFalse(config.parent_embedding_enabled)
        self.assertEqual(config.gemini_embedding_model_name, "gemini-embedding-2")

    def test_parent_enabled_rejects_preview_model(self):
        with self.assertRaisesRegex(ValueError, "stable gemini-embedding-2"):
            self.config.with_overrides(gemini_embedding_model_name="gemini-embedding-2-preview")

    def test_stable_wrapper_uses_document_instruction_without_task_type(self):
        captured = {}

        class Models:
            def embed_content(self, **kwargs):
                captured.update(kwargs)
                return types.SimpleNamespace(
                    embeddings=[types.SimpleNamespace(values=[1.0] + [0.0] * 3071)],
                    request_id="request-1",
                )

        class EmbedContentConfig:
            def __init__(self, **kwargs):
                self.values = kwargs

        google_module = types.ModuleType("google")
        genai_module = types.ModuleType("google.genai")
        genai_module.types = types.SimpleNamespace(EmbedContentConfig=EmbedContentConfig)
        google_module.genai = genai_module
        with patch.dict(sys.modules, {"google": google_module, "google.genai": genai_module}):
            vectors, request_id = embed_text_contents(
                types.SimpleNamespace(models=Models()),
                [" alpha beta "],
                self.config,
            )
        self.assertEqual(captured["contents"], [build_parent_document_text("alpha beta")])
        self.assertEqual(captured["config"].values, {"output_dimensionality": 3072})
        self.assertEqual(len(vectors[0]), 3072)
        self.assertEqual(request_id, "request-1")

    def test_config_parses_explicit_false(self):
        with patch.dict(os.environ, {"HIERARCHY_ENABLED": "false", "PARENT_EMBEDDING_ENABLED": "false"}, clear=False):
            self.assertFalse(PipelineConfig.from_env(self.root).parent_embedding_enabled)

    def test_config_rejects_ambiguous_boolean(self):
        with patch.dict(os.environ, {"PARENT_EMBEDDING_ENABLED": "yes"}, clear=False):
            with self.assertRaisesRegex(ValueError, "either true or false"):
                PipelineConfig.from_env(self.root)

    def test_config_requires_hierarchy(self):
        with patch.dict(os.environ, {"HIERARCHY_ENABLED": "false", "PARENT_EMBEDDING_ENABLED": "true"}, clear=False):
            with self.assertRaisesRegex(ValueError, "PARENT_EMBEDDING_ENABLED requires HIERARCHY_ENABLED=true"):
                PipelineConfig.from_env(self.root)

    def test_with_overrides_revalidates(self):
        with self.assertRaisesRegex(ValueError, "requires HIERARCHY_ENABLED=true"):
            self.config.with_overrides(hierarchy_enabled=False)

    def test_valid_round_trip_and_cross_module_mapping(self):
        records = self.generate()
        loaded = self.validate()
        self.assertEqual([r.parent_id for r in records], [r.parent_id for r in loaded])
        self.assertEqual(loaded[0].child_chunk_ids, self.parents[0].child_chunk_ids)
        self.assertEqual(loaded[0].video_id, "video-1")
        self.assertEqual(loaded[0].embedding_dimension, 3072)
        raw = load_jsonl_file(self.config.parent_embeddings_output_path)[0]
        self.assertEqual(raw["embedding_schema_version"], "parent_embedding_v2")
        self.assertIsNone(raw["embedding_task_type"])
        self.assertEqual(raw["embedding_instruction"], PARENT_EMBEDDING_INSTRUCTION)
        self.assertEqual(raw["embedding_instruction_version"], PARENT_EMBEDDING_INSTRUCTION_VERSION)
        self.assertEqual(raw["embedding_generation_version"], PARENT_EMBEDDING_GENERATION_VERSION)
        self.assertEqual(raw["embedding_contract_version"], PARENT_EMBEDDING_CONTRACT_VERSION)
        self.assertIn("embedding_error", raw)

    def test_empty_input_is_valid_completed_artifact(self):
        records = embed_parent_chunks([], self.config, self.hierarchy_fp, self.leaf_fp, self.parent_fp, provider=self.fake_provider)
        self.assertEqual(records, [])
        self.assertEqual(self.validate_empty(), [])

    def validate_empty(self):
        return validate_parent_embedding_artifact(self.config.parent_embeddings_output_path, [], 3072, self.config.gemini_embedding_model_name, self.hierarchy_fp, self.leaf_fp, self.parent_fp)

    def test_duplicate_parent_id_rejected(self):
        self.assert_invalid(lambda rows: rows.append(dict(rows[0])))

    def test_unknown_parent_id_rejected(self):
        self.assert_invalid(lambda rows: rows[0].update(parent_id="unknown"))

    def test_missing_parent_rejected(self):
        self.assert_invalid(lambda rows: rows.pop())

    def test_wrong_video_id_rejected(self):
        self.assert_invalid(lambda rows: rows[0].update(video_id="wrong"))

    def test_wrong_child_ids_rejected(self):
        self.assert_invalid(lambda rows: rows[0].update(child_chunk_ids=["wrong"]))

    def test_wrong_hierarchy_level_rejected(self):
        self.assert_invalid(lambda rows: rows[0].update(hierarchy_level=2))

    def test_wrong_document_type_rejected(self):
        self.assert_invalid(lambda rows: rows[0].update(document_type="leaf_chunk"))

    def test_empty_vector_rejected(self):
        self.assert_invalid(lambda rows: rows[0].update(embedding=[]))

    def test_wrong_dimension_rejected(self):
        self.assert_invalid(lambda rows: rows[0].update(embedding=[1.0]))

    def test_wrong_model_rejected(self):
        self.assert_invalid(lambda rows: rows[0].update(embedding_model="wrong-model"))

    def test_preview_and_legacy_task_type_are_rejected(self):
        self.assert_invalid(lambda rows: rows[0].update(
            embedding_model="gemini-embedding-2-preview",
            embedding_task_type="RETRIEVAL_DOCUMENT",
        ))

    def test_stable_contract_metadata_mismatch_is_rejected(self):
        for field_name in (
            "embedding_instruction",
            "embedding_instruction_version",
            "embedding_generation_version",
            "embedding_contract_version",
            "embedding_role",
        ):
            with self.subTest(field=field_name):
                self.assert_invalid(lambda rows, field_name=field_name: rows[0].update({field_name: "legacy"}))

    def test_nan_rejected(self):
        self.assert_invalid(lambda rows: rows[0].update(embedding=[math.nan, 0.0, 0.0]))

    def test_infinity_rejected(self):
        self.assert_invalid(lambda rows: rows[0].update(embedding=[math.inf, 0.0, 0.0]))

    def test_non_numeric_and_null_rejected(self):
        for value in ("1", None, True):
            with self.subTest(value=value):
                self.assert_invalid(lambda rows, value=value: rows[0].update(embedding=[value, 0.0, 0.0]))

    def test_malformed_jsonl_rejected(self):
        self.config.parent_embeddings_output_path.write_text("{bad\n", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.validate()

    def test_missing_file_rejected(self):
        with self.assertRaises(ValueError):
            self.validate()

    def test_fingerprint_is_deterministic_and_key_order_independent(self):
        snapshot = build_parent_embedding_config_snapshot(self.config)
        reverse = dict(reversed(list(snapshot.items())))
        self.assertEqual(build_parent_embedding_fingerprint(snapshot, self.hierarchy_fp), build_parent_embedding_fingerprint(reverse, self.hierarchy_fp))

    def test_fingerprint_changes_for_each_contract_dependency(self):
        snapshot = build_parent_embedding_config_snapshot(self.config)
        for key, value in {
            "provider": "other",
            "model": "other-model",
            "dimension": 4,
            "task_type": "OTHER",
            "instruction": "other",
            "instruction_version": "v2",
            "generation_version": "v2",
            "contract_version": "v2",
            "role": "other",
            "schema_version": "v2",
            "preprocessing_version": "v2",
            "normalization_version": "v2",
        }.items():
            with self.subTest(key=key):
                changed = dict(snapshot)
                changed[key] = value
                self.assertNotEqual(self.parent_fp, build_parent_embedding_fingerprint(changed, self.hierarchy_fp))
        self.assertNotEqual(self.parent_fp, build_parent_embedding_fingerprint(snapshot, "c" * 64))

    def test_fingerprint_ignores_run_id_and_path(self):
        first = build_parent_embedding_config_snapshot(self.config)
        changed_config = self.config.with_overrides(run_id="other", parent_embeddings_output_path=self.root / "elsewhere.jsonl")
        second = build_parent_embedding_config_snapshot(changed_config)
        self.assertEqual(first, second)

    def test_resume_accepts_same_contract_and_rejects_preview_contract(self):
        stable = build_parent_embedding_config_snapshot(self.config)
        stable_fp = build_parent_embedding_fingerprint(stable, self.hierarchy_fp)
        _validate_parent_embedding_fingerprint(
            {
                "parent_embedding_config": stable,
                "parent_embedding_fingerprint": stable_fp,
            },
            stable,
            stable_fp,
            self.hierarchy_fp,
        )
        preview = dict(stable)
        preview.update(model="gemini-embedding-2-preview", task_type="RETRIEVAL_DOCUMENT")
        preview_fp = build_parent_embedding_fingerprint(preview, self.hierarchy_fp)
        with self.assertRaisesRegex(CheckpointError, "PARENT_EMBEDDING_CONTRACT_MISMATCH"):
            _validate_parent_embedding_fingerprint(
                {
                    "parent_embedding_config": preview,
                    "parent_embedding_fingerprint": preview_fp,
                },
                stable,
                stable_fp,
                self.hierarchy_fp,
            )

    def test_valid_artifact_is_reused_without_provider_call(self):
        first = self.generate()
        calls = []
        records = embed_parent_chunks(self.parents, self.config, self.hierarchy_fp, self.leaf_fp, self.parent_fp, provider=lambda texts, config: calls.append(texts))
        self.assertFalse(calls)
        self.assertTrue(all(record.embedding_status == "reused_checkpoint" for record in records))
        self.assertEqual([r.embedding for r in first], [r.embedding for r in records])

    def test_corrupt_artifact_causes_rerun(self):
        self.generate()
        self.config.parent_embeddings_output_path.write_text("corrupt", encoding="utf-8")
        calls = []
        def provider(texts, _):
            calls.append(texts)
            return [[1.0] + [0.0] * 3071 for _ in texts], None
        embed_parent_chunks(self.parents, self.config, self.hierarchy_fp, self.leaf_fp, self.parent_fp, provider=provider)
        self.assertTrue(calls)

    def test_provider_failure_is_blocking_and_redacted(self):
        secret = "super-secret-api-key"
        def failing_provider(texts, config):
            raise RuntimeError(f"request failed key={secret} C:\\Users\\secret")
        with self.assertRaises(ParentEmbeddingStageError) as raised:
            embed_parent_chunks(self.parents, self.config, self.hierarchy_fp, self.leaf_fp, self.parent_fp, provider=failing_provider)
        self.assertEqual(len(raised.exception.records), 2)
        raw = self.config.parent_embeddings_output_path.read_text(encoding="utf-8")
        self.assertNotIn(secret, raw)
        self.assertNotIn("C:\\Users", raw)
        self.assertTrue(all(record.embedding_status == "failed" for record in raised.exception.records))

    def test_partial_failure_never_validates_as_publishable(self):
        self.config = self.config.with_overrides(gemini_embedding_batch_size=1)
        calls = 0
        def provider(texts, config):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise RuntimeError("failed")
            return [[1.0] + [0.0] * 3071], None
        with self.assertRaises(ParentEmbeddingStageError):
            embed_parent_chunks(self.parents, self.config, self.hierarchy_fp, self.leaf_fp, self.parent_fp, provider=provider)
        with self.assertRaises(ValueError):
            self.validate()

    def test_stage_order_places_parent_between_hierarchy_and_leaf(self):
        self.assertLess(STAGE_NAMES.index("hierarchy"), STAGE_NAMES.index("parent_embedding"))
        self.assertLess(STAGE_NAMES.index("parent_embedding"), STAGE_NAMES.index("text_embedding"))

    def test_manifest_metadata_contains_counts_without_vectors(self):
        snapshot = build_parent_embedding_config_snapshot(self.config)
        manager = create_manifest(
            self.root / "runs",
            run_id="run_parent",
            parent_embedding_config=snapshot,
            parent_embedding_fingerprint=self.parent_fp,
        )
        manager.set_parent_embedding_metadata(
            snapshot,
            self.parent_fp,
            artifact_path="embeddings_parent_gemini_stable.jsonl",
            required_count=2,
            success_count=1,
            reused_count=1,
            status="completed",
        )
        metadata = manager.manifest["parent_embedding"]
        self.assertEqual(metadata["success_count"] + metadata["reused_count"], 2)
        self.assertNotIn('"embedding":', json.dumps(metadata))


if __name__ == "__main__":
    unittest.main()
