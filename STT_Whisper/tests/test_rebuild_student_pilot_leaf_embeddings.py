import copy
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

import rebuild_student_pilot_leaf_embeddings as rebuild


class Cursor(list):
    def to_list(self, length=None):
        return list(self)


class Result:
    def __init__(self, matched_count):
        self.matched_count = matched_count


class Update:
    def __init__(self, selector, update, upsert=False):
        self.selector = selector
        self.update = update
        self.upsert = upsert


class Collection:
    def __init__(self, documents):
        self.documents = copy.deepcopy(documents)
        self.bulk_calls = 0
        self.find_one_calls = []
        self.find_calls = []
        self.last_operations = []

    def find_one(self, selector, projection=None, **kwargs):
        self.find_one_calls.append((selector, projection, kwargs))
        for document in self.documents:
            if all(document.get(key) == value for key, value in selector.items()):
                return copy.deepcopy(document)
        return None

    def find(self, selector, projection=None, **kwargs):
        self.find_calls.append((selector, projection, kwargs))
        if "_id" in selector and "deletedAt" in selector:
            ids = set(selector["_id"]["$in"])
            return Cursor(copy.deepcopy([d for d in self.documents if d.get("_id") in ids and d.get("deletedAt") is None]))
        if "videoId" in selector:
            allowed = set(selector["videoId"]["$in"])
            return Cursor(copy.deepcopy([d for d in self.documents if d.get("videoId") in allowed]))
        if "_id" in selector:
            ids = set(selector["_id"]["$in"])
            return Cursor(copy.deepcopy([d for d in self.documents if d.get("_id") in ids]))
        raise AssertionError(f"Unexpected selector: {selector}")

    def bulk_write(self, operations, ordered=True, **kwargs):
        self.bulk_calls += 1
        self.last_operations = list(operations)
        matched = 0
        by_id = {document["_id"]: index for index, document in enumerate(self.documents)}
        for operation in operations:
            index = by_id.get(operation.selector["_id"])
            if index is None:
                continue
            if any(self.documents[index].get(key) != value for key, value in operation.selector.items()):
                continue
            for key, value in operation.update.get("$set", {}).items():
                self.documents[index][key] = copy.deepcopy(value)
            for key in operation.update.get("$unset", {}):
                self.documents[index].pop(key, None)
            matched += 1
        return Result(matched)


def make_scope():
    allowed = list(rebuild.STUDENT_PILOT_ALLOWED_VIDEO_IDS)
    excluded = rebuild.STUDENT_PILOT_EXCLUDED_VIDEO_ID
    course = {
        "_id": rebuild.STUDENT_PILOT_OPENCV_COURSE_ID,
        "status": "published",
        "deletedAt": None,
        "videoIds": allowed + [excluded],
    }
    videos = [{"_id": video_id, "courseId": course["_id"], "deletedAt": None} for video_id in allowed + [excluded]]
    leaves = []
    for index in range(rebuild.EXPECTED_LEAF_COUNT):
        video_id = allowed[index % len(allowed)]
        leaves.append({
            "_id": f"leaf-{index}",
            "chunkId": f"{video_id}_chunk_{index:04d}",
            "videoId": video_id,
            "text": f"lesson text {index}",
            "segmentId": f"segment-{index}",
            "startSec": float(index),
            "endSec": float(index + 1),
            "embedding": [1.0] + [0.0] * (rebuild.GEMINI_EMBEDDING_DIMENSION - 1),
            "legacyOnly": True,
        })
    return Collection([course]), Collection(videos), Collection(leaves)


class StudentPilotLeafRebuildTests(unittest.TestCase):
    def setUp(self):
        self.object_id_patch = patch.object(rebuild, "_object_id", side_effect=lambda value: str(value))
        self.object_id_patch.start()
        self.addCleanup(self.object_id_patch.stop)

    @staticmethod
    def transaction(operation):
        operation(None)

    def stage(self, courses, videos, leaves, artifact, value=2.0):
        snapshot = rebuild._read_scope(courses, videos, leaves)
        return rebuild.stage_embeddings(
            snapshot,
            artifact,
            lambda text: [value] + [0.0] * (rebuild.GEMINI_EMBEDDING_DIMENSION - 1),
            checkpoint_every=rebuild.EXPECTED_LEAF_COUNT,
        )

    def test_dry_run_checks_fixed_scope_without_embedding_or_writing(self):
        courses, videos, leaves = make_scope()
        report = rebuild.run_rebuild(courses, videos, leaves, execute=False)
        self.assertEqual(report["mode"], "dry_run")
        self.assertEqual(report["scope"]["allowedVideoCount"], 15)
        self.assertEqual(report["scope"]["leafCount"], 129)
        self.assertEqual(leaves.bulk_calls, 0)
        self.assertEqual(report["embeddingContract"]["embeddingModel"], "gemini-embedding-2")
        self.assertEqual(len(report["embeddingContract"]), 9)
        self.assertEqual(courses.find_one_calls[0][1], {"_id": 1, "videoIds": 1, "status": 1, "deletedAt": 1})
        self.assertEqual(videos.find_calls[0][1], {"_id": 1})

    def test_scope_preflight_refuses_missing_leaf_without_any_write(self):
        courses, videos, leaves = make_scope()
        leaves.documents.pop()
        with self.assertRaisesRegex(rebuild.RebuildError, "exactly 129"):
            rebuild.run_rebuild(courses, videos, leaves, execute=False)
        self.assertEqual(leaves.bulk_calls, 0)

    def test_scope_preflight_refuses_same_count_but_wrong_video_allowlist(self):
        courses, videos, leaves = make_scope()
        foreign = "ffffffffffffffffffffffff"
        courses.documents[0]["videoIds"][0] = foreign
        videos.documents[0]["_id"] = foreign
        for leaf in leaves.documents:
            if leaf["videoId"] == rebuild.STUDENT_PILOT_ALLOWED_VIDEO_IDS[0]:
                leaf["videoId"] = foreign
        with self.assertRaisesRegex(rebuild.RebuildError, "fixed 15"):
            rebuild.run_rebuild(courses, videos, leaves, execute=False)
        self.assertEqual(leaves.bulk_calls, 0)

    def test_stage_checkpoint_is_text_free_and_resumes_without_writes(self):
        courses, videos, leaves = make_scope()
        with tempfile.TemporaryDirectory() as temp_dir:
            artifact = Path(temp_dir) / "stage.json"
            first = self.stage(courses, videos, leaves, artifact)
            second = self.stage(courses, videos, leaves, artifact)
            self.assertEqual((first["generatedCount"], first["reusedCount"]), (129, 0))
            self.assertEqual((second["generatedCount"], second["reusedCount"]), (0, 129))
            self.assertNotIn("lesson text", artifact.read_text(encoding="utf-8"))
            self.assertEqual(leaves.bulk_calls, 0)

    def test_incomplete_or_changed_stage_refuses_before_backup_or_write(self):
        courses, videos, leaves = make_scope()
        with tempfile.TemporaryDirectory() as temp_dir:
            artifact = Path(temp_dir) / "stage.json"
            backup = Path(temp_dir) / "before.json"
            self.stage(courses, videos, leaves, artifact)
            leaves.documents[0]["text"] = "changed after staging"
            with self.assertRaisesRegex(rebuild.RebuildError, "source snapshot"):
                rebuild.run_rebuild(
                    courses, videos, leaves, execute=True,
                    staging_artifact=rebuild._load_staging_artifact(artifact), backup_path=backup,
                    update_one=Update, transaction_runner=self.transaction,
                )
            self.assertFalse(backup.exists())
            self.assertEqual(leaves.bulk_calls, 0)

    def test_rebuild_writes_only_contract_fields_then_readbacks_and_is_rerunnable(self):
        courses, videos, leaves = make_scope()
        original_source = copy.deepcopy(leaves.documents[0])
        with tempfile.TemporaryDirectory() as temp_dir:
            artifact = Path(temp_dir) / "stage.json"
            backup = Path(temp_dir) / "before.json"
            self.stage(courses, videos, leaves, artifact)
            report = rebuild.run_rebuild(
                courses, videos, leaves, execute=True,
                staging_artifact=rebuild._load_staging_artifact(artifact), backup_path=backup,
                update_one=Update, transaction_runner=self.transaction,
            )
            self.assertEqual(report["writes"], 129)
            self.assertEqual(report["readBack"], "passed")
            self.assertEqual(leaves.bulk_calls, 1)
            for key, value in rebuild.CONTRACT_METADATA.items():
                self.assertEqual(leaves.documents[0][key], value)
            self.assertEqual(leaves.documents[0]["embedding"][0], 1.0)
            for field in ("_id", "chunkId", "videoId", "text", "legacyOnly", "segmentId", "startSec", "endSec"):
                self.assertEqual(leaves.documents[0][field], original_source[field])
            self.assertEqual(set(leaves.last_operations[0].update), {"$set"})
            self.assertEqual(set(leaves.last_operations[0].update["$set"]), set(rebuild.REBUILD_FIELDS))

            # A second operation uses a separate immutable backup and the same
            # staged source identities, so it remains a bounded idempotent repair.
            second_backup = Path(temp_dir) / "before-second.json"
            second = rebuild.run_rebuild(
                courses, videos, leaves, execute=True,
                staging_artifact=rebuild._load_staging_artifact(artifact), backup_path=second_backup,
                update_one=Update, transaction_runner=self.transaction,
            )
            self.assertEqual(second["matchedCount"], 129)
            self.assertEqual(leaves.bulk_calls, 2)

    def test_rollback_restores_backup_documents_with_readback(self):
        courses, videos, leaves = make_scope()
        original = copy.deepcopy(leaves.documents)
        with tempfile.TemporaryDirectory() as temp_dir:
            backup = Path(temp_dir) / "before.json"
            artifact = Path(temp_dir) / "stage.json"
            self.stage(courses, videos, leaves, artifact, value=3.0)
            rebuild.run_rebuild(
                courses, videos, leaves, execute=True,
                staging_artifact=rebuild._load_staging_artifact(artifact), backup_path=backup,
                update_one=Update, transaction_runner=self.transaction,
            )
            report = rebuild.run_rollback(leaves, backup, Update, self.transaction)
            self.assertEqual(report["mode"], "rollback")
            self.assertEqual(report["writes"], 129)
            self.assertEqual(leaves.documents, original)

    def test_execute_and_rollback_need_distinct_exact_confirmations(self):
        with self.assertRaises(SystemExit):
            rebuild.parse_args(["--execute"])
        with self.assertRaises(SystemExit):
            rebuild.parse_args(["--execute", "--rollback-from", "backup.json", "--confirm", rebuild.REBUILD_CONFIRMATION])
        args = rebuild.parse_args([
            "--execute", "--artifact-file", "stage.json", "--backup-file", "backup.json", "--confirm", rebuild.REBUILD_CONFIRMATION,
        ])
        self.assertTrue(args.execute)
        rollback = rebuild.parse_args([
            "--execute", "--rollback-from", "backup.json", "--confirm", rebuild.ROLLBACK_CONFIRMATION,
        ])
        self.assertEqual(rollback.rollback_from, Path("backup.json"))

    def test_execute_and_rollback_refuse_non_transactional_fallback(self):
        courses, videos, leaves = make_scope()
        with tempfile.TemporaryDirectory() as temp_dir:
            artifact = Path(temp_dir) / "stage.json"
            backup = Path(temp_dir) / "before.json"
            self.stage(courses, videos, leaves, artifact)
            with self.assertRaisesRegex(rebuild.RebuildError, "Atlas transaction"):
                rebuild.run_rebuild(
                    courses, videos, leaves, execute=True,
                    staging_artifact=rebuild._load_staging_artifact(artifact), backup_path=backup,
                    update_one=Update,
                )
            self.assertFalse(backup.exists())
            self.assertEqual(leaves.bulk_calls, 0)

    def test_dotenv_loader_limits_keys_and_preserves_explicit_environment(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            dotenv = Path(temp_dir) / "rebuild.env"
            dotenv.write_text("STUDENT_PILOT_REBUILD_MONGODB_URI=from-file\nGEMINI_API_KEY=from-file\nUNRELATED=ignore\n", encoding="utf-8")
            previous = {key: os.environ.get(key) for key in ("STUDENT_PILOT_REBUILD_MONGODB_URI", "GEMINI_API_KEY", "UNRELATED")}
            try:
                os.environ["STUDENT_PILOT_REBUILD_MONGODB_URI"] = "explicit"
                os.environ.pop("GEMINI_API_KEY", None)
                os.environ.pop("UNRELATED", None)
                rebuild.load_env_file(dotenv, {"STUDENT_PILOT_REBUILD_MONGODB_URI", "GEMINI_API_KEY"})
                self.assertEqual(os.environ["STUDENT_PILOT_REBUILD_MONGODB_URI"], "explicit")
                self.assertEqual(os.environ["GEMINI_API_KEY"], "from-file")
                self.assertNotIn("UNRELATED", os.environ)
            finally:
                for key, value in previous.items():
                    if value is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = value


if __name__ == "__main__":
    unittest.main()
