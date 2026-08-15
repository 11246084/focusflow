import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from parent_mongodb_uploader import (
    PARENT_FIELD_MAPPING,
    map_parent_document,
    preflight_parent_publication,
    upload_parent_embeddings,
)


COURSE_ID = "64b7f4a2c9e77c2a1d123456"


def valid_record(parent_id="video-1_parent_0001", order=1):
    return {
        "parent_id": parent_id,
        "video_id": "video-1",
        "hierarchy_level": 1,
        "document_type": "parent_chunk",
        "start_sec": 1.0,
        "end_sec": 4.0,
        "text": "safe fixture text",
        "child_chunk_ids": ["video-1_chunk_1", "video-1_chunk_2"],
        "child_count": 2,
        "order": order,
        "embedding": [0.25] * 3072,
        "embedding_provider": "gemini",
        "embedding_model": "gemini-embedding-2",
        "embedding_dimension": 3072,
        "embedding_task_type": None,
        "embedding_status": "success",
        "embedding_timestamp": "2026-08-03T00:00:00+00:00",
        "embedding_schema_version": "parent_embedding_v2",
        "embedding_instruction": "title: none | text: {content}",
        "embedding_instruction_version": "gemini_embedding_2_asymmetric_retrieval_v2",
        "embedding_generation_version": "text_search_generation_v2",
        "embedding_contract_version": "gemini_embedding_2_text_v2",
        "embedding_role": "document",
        "preprocessing_version": "parent_text_passthrough_v1",
        "normalization_version": "unit_l2_v1",
        "hierarchy_fingerprint": "hierarchy-a",
        "source_leaf_fingerprint": "leaf-a",
        "parent_embedding_fingerprint": "embedding-a",
        "embedding_error": None,
    }


class FakeResult:
    def __init__(self, matched=0, modified=0, upserted=0):
        self.matched_count = matched
        self.modified_count = modified
        self.upserted_count = upserted


class FakeCollection:
    def __init__(self):
        self.calls = []
        self.documents = {}

    def bulk_write(self, operations, ordered):
        self.calls.append((operations, ordered))
        matched = modified = upserted = 0
        for operation in operations:
            parent_id = operation["filter"]["parentId"]
            document = operation["update"]["$set"]
            if parent_id in self.documents:
                matched += 1
                if self.documents[parent_id] != document:
                    modified += 1
            else:
                upserted += 1
            self.documents[parent_id] = document
        return FakeResult(matched, modified, upserted)


def fake_operation(filter_document, document):
    return {"filter": filter_document, "update": {"$set": document}, "upsert": True}


class ParentUploaderTestCase(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.path = Path(self.tempdir.name) / "embeddings_parent_gemini_stable.jsonl"

    def tearDown(self):
        self.tempdir.cleanup()

    def write(self, records):
        self.path.write_text("".join(json.dumps(item) + "\n" for item in records), encoding="utf-8")

    def preflight(self, records, **kwargs):
        self.write(records)
        return preflight_parent_publication(self.path, course_id=COURSE_ID, **kwargs)

    def test_mapping_is_whitelisted_and_preserves_child_order(self):
        record = valid_record()
        record["unknown_snake_case"] = "not stored"
        record["embedding_request_id"] = "request"
        record["sourceVideoId"] = "forbidden"
        documents, summary = self.preflight([record], generation_version="audit-v1")
        self.assertEqual(summary.validated_count, 1)
        self.assertTrue(summary.success)
        document = documents[0]
        self.assertEqual(document["childChunkIds"], record["child_chunk_ids"])
        self.assertEqual(document["embeddingModel"], record["embedding_model"])
        self.assertIsNone(document["embeddingTaskType"])
        self.assertEqual(document["embeddingInstructionVersion"], record["embedding_instruction_version"])
        self.assertEqual(document["embeddingContractVersion"], record["embedding_contract_version"])
        self.assertEqual(document["generationVersion"], "audit-v1")
        self.assertTrue(document["isActive"])
        self.assertEqual(document["documentSchemaVersion"], "parent_document_v1")
        self.assertNotIn("unknown_snake_case", document)
        self.assertNotIn("embedding_request_id", document)
        self.assertNotIn("sourceVideoId", document)
        self.assertEqual(set(PARENT_FIELD_MAPPING.values()) | {
            "courseId", "documentSchemaVersion", "generationVersion", "isActive"
        }, set(document))

    def test_course_id_requirements_block_entire_batch(self):
        self.write([valid_record()])
        for value in (None, "", "not-an-object-id"):
            with self.subTest(value=value):
                collection = FakeCollection()
                summary = upload_parent_embeddings(
                    self.path, collection, course_id=value, operation_factory=fake_operation
                )
                self.assertEqual(summary.status, "preflight_blocked")
                self.assertEqual(collection.calls, [])

    def test_resolver_requires_every_record_and_one_course(self):
        records = [valid_record(), valid_record("video-1_parent_0002", 2)]
        self.write(records)
        collection = FakeCollection()
        summary = upload_parent_embeddings(
            self.path,
            collection,
            course_id_resolver=lambda item: COURSE_ID if item["parent_id"].endswith("1") else None,
            operation_factory=fake_operation,
        )
        self.assertFalse(summary.success)
        self.assertEqual(collection.calls, [])
        other = "64b7f4a2c9e77c2a1d123457"
        documents, summary = preflight_parent_publication(
            self.path,
            course_id_resolver=lambda item: COURSE_ID if item["parent_id"].endswith("1") else other,
        )
        self.assertEqual(documents, [])
        self.assertTrue(any(error["code"] == "course_scope_conflict" for error in summary.errors))

    def test_invalid_embedding_contract_blocks_write(self):
        mutations = {
            "short": lambda r: r.update(embedding=[0.1]),
            "nan": lambda r: r["embedding"].__setitem__(0, math.nan),
            "infinity": lambda r: r["embedding"].__setitem__(0, math.inf),
            "zero": lambda r: r.update(embedding=[0.0] * 3072),
            "model": lambda r: r.update(embedding_model="old-model"),
            "task": lambda r: r.update(embedding_task_type="OTHER"),
            "instruction": lambda r: r.update(embedding_instruction="legacy"),
            "instruction_version": lambda r: r.update(embedding_instruction_version="legacy"),
            "generation": lambda r: r.update(embedding_generation_version="legacy"),
            "contract": lambda r: r.update(embedding_contract_version="legacy"),
            "metadata_dimension": lambda r: r.update(embedding_dimension=768),
            "status": lambda r: r.update(embedding_status="failed"),
            "error": lambda r: r.update(embedding_error="provider failed"),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                record = valid_record()
                mutate(record)
                self.write([record])
                collection = FakeCollection()
                summary = upload_parent_embeddings(
                    self.path, collection, course_id=COURSE_ID, operation_factory=fake_operation
                )
                self.assertFalse(summary.success)
                self.assertEqual(collection.calls, [])

    def test_preview_and_missing_stable_metadata_are_rejected(self):
        scenarios = []
        preview = valid_record()
        preview.update(
            embedding_model="gemini-embedding-2-preview",
            embedding_task_type="RETRIEVAL_DOCUMENT",
        )
        scenarios.append(preview)
        missing = valid_record()
        missing.pop("embedding_instruction_version")
        scenarios.append(missing)
        for record in scenarios:
            with self.subTest(model=record.get("embedding_model")):
                self.write([record])
                collection = FakeCollection()
                summary = upload_parent_embeddings(
                    self.path, collection, course_id=COURSE_ID, operation_factory=fake_operation
                )
                self.assertFalse(summary.success)
                self.assertEqual(collection.calls, [])

    def test_invalid_parent_fields_block_write(self):
        mutations = {
            "parent": lambda r: r.update(parent_id=""),
            "video": lambda r: r.update(video_id=""),
            "time": lambda r: r.update(start_sec=5, end_sec=4),
            "text": lambda r: r.update(text=""),
            "children": lambda r: r.update(child_chunk_ids=[], child_count=0),
            "count": lambda r: r.update(child_count=1),
            "duplicate_child": lambda r: r.update(child_chunk_ids=["same", "same"]),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                record = valid_record()
                mutate(record)
                self.write([record])
                collection = FakeCollection()
                summary = upload_parent_embeddings(
                    self.path, collection, course_id=COURSE_ID, operation_factory=fake_operation
                )
                self.assertEqual(collection.calls, [])
                self.assertEqual(summary.operation_count, 0)

    def test_duplicate_parent_mixed_video_and_fingerprint_block_batch(self):
        scenarios = []
        duplicate = [valid_record(), valid_record()]
        scenarios.append(duplicate)
        mixed_video = [valid_record(), valid_record("video-2_parent_0001", 2)]
        mixed_video[1]["video_id"] = "video-2"
        scenarios.append(mixed_video)
        mixed_fingerprint = [valid_record(), valid_record("video-1_parent_0002", 2)]
        mixed_fingerprint[1]["hierarchy_fingerprint"] = "hierarchy-b"
        scenarios.append(mixed_fingerprint)
        mixed_model = [valid_record(), valid_record("video-1_parent_0002", 2)]
        mixed_model[1]["embedding_model"] = "old-model"
        scenarios.append(mixed_model)
        for records in scenarios:
            with self.subTest():
                self.write(records)
                collection = FakeCollection()
                summary = upload_parent_embeddings(
                    self.path, collection, course_id=COURSE_ID, operation_factory=fake_operation
                )
                self.assertFalse(summary.success)
                self.assertEqual(collection.calls, [])

    def test_parent_id_only_unordered_upsert_and_idempotent_second_run(self):
        records = [valid_record(), valid_record("video-1_parent_0002", 2)]
        self.write(records)
        collection = FakeCollection()
        first = upload_parent_embeddings(
            self.path, collection, course_id=COURSE_ID, operation_factory=fake_operation
        )
        self.assertTrue(first.success)
        self.assertEqual(first.upserted_count, 2)
        self.assertEqual(len(collection.documents), 2)
        self.assertTrue(all(
            document["generationVersion"] == "text_search_generation_v2"
            for document in collection.documents.values()
        ))
        operations, ordered = collection.calls[0]
        self.assertFalse(ordered)
        for operation in operations:
            self.assertEqual(set(operation["filter"]), {"parentId"})
            self.assertTrue(operation["upsert"])
            self.assertNotIn("courseId", operation["filter"])
            self.assertNotIn("generationVersion", operation["filter"])
        second = upload_parent_embeddings(
            self.path, collection, course_id=COURSE_ID, operation_factory=fake_operation
        )
        self.assertTrue(second.success)
        self.assertEqual(second.matched_count, 2)
        self.assertEqual(second.upserted_count, 0)
        self.assertEqual(len(collection.documents), 2)

    def test_empty_and_malformed_jsonl_are_safe(self):
        collection = FakeCollection()
        self.path.write_text("", encoding="utf-8")
        empty = upload_parent_embeddings(
            self.path, collection, course_id=COURSE_ID, operation_factory=fake_operation
        )
        self.assertEqual(empty.status, "empty_input")
        self.path.write_text('{"parent_id": bad}\n', encoding="utf-8")
        malformed = upload_parent_embeddings(
            self.path, collection, course_id=COURSE_ID, operation_factory=fake_operation
        )
        self.assertEqual(malformed.errors[0]["line"], 1)
        self.assertEqual(collection.calls, [])

    def test_collection_exception_is_sanitized(self):
        class ExplodingCollection:
            def bulk_write(self, operations, ordered):
                raise RuntimeError("mongodb://user:password@secret-host/?apiKey=secret")

        self.write([valid_record()])
        summary = upload_parent_embeddings(
            self.path, ExplodingCollection(), course_id=COURSE_ID, operation_factory=fake_operation
        )
        serialized = json.dumps(summary.to_dict())
        self.assertFalse(summary.success)
        self.assertEqual(summary.status, "failed")
        self.assertNotIn("mongodb://", serialized)
        self.assertNotIn("password", serialized)
        self.assertNotIn("safe fixture text", serialized)
        self.assertNotIn("0.25", serialized)

    def test_partial_bulk_failure_is_not_success(self):
        class PartialError(RuntimeError):
            details = {
                "writeErrors": [{"index": 1, "errmsg": "mongodb://secret"}],
                "nMatched": 1,
                "nModified": 1,
                "nUpserted": 0,
            }

        class PartialCollection:
            def bulk_write(self, operations, ordered):
                raise PartialError()

        self.write([valid_record(), valid_record("video-1_parent_0002", 2)])
        summary = upload_parent_embeddings(
            self.path, PartialCollection(), course_id=COURSE_ID, operation_factory=fake_operation
        )
        self.assertFalse(summary.success)
        self.assertEqual(summary.status, "partial_failure")
        self.assertEqual(summary.failed_count, 1)
        self.assertEqual(summary.matched_count, 1)
        self.assertNotIn("secret", json.dumps(summary.to_dict()))


if __name__ == "__main__":
    unittest.main()
