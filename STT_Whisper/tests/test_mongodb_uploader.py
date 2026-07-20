"""Offline tests for Phase 2 Sprint 4 MongoDB upload behavior."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

import mongodb_uploader  # noqa: E402
import main as pipeline_main  # noqa: E402
from resume_checkpoint import CheckpointError, _validate_upload_summary  # noqa: E402
from run_summary import write_upload_summary  # noqa: E402
from utils import VideoMetadata  # noqa: E402


class FakeBulkResult:
    def __init__(self, *, upserted: int, matched: int, modified: int) -> None:
        self.upserted_count = upserted
        self.matched_count = matched
        self.modified_count = modified


class FakeCollection:
    def __init__(self, *, fail_calls: set[int] | None = None) -> None:
        self.documents: list[dict] = []
        self.bulk_calls: list[int] = []
        self.fail_calls = fail_calls or set()

    @staticmethod
    def _matches(document: dict, filter_document: dict) -> bool:
        return all(document.get(key) == value for key, value in filter_document.items())

    def find_one(self, filter_document: dict, projection: dict | None = None):
        del projection
        return next(
            (document for document in self.documents if self._matches(document, filter_document)),
            None,
        )

    def bulk_write(self, operations: list, ordered: bool = False) -> FakeBulkResult:
        assert ordered is False
        call_number = len(self.bulk_calls) + 1
        self.bulk_calls.append(len(operations))
        if call_number in self.fail_calls:
            _, _, pymongo_errors = mongodb_uploader._pymongo_types()
            raise pymongo_errors.BulkWriteError(
                {
                    "writeErrors": [{"index": index, "code": 11000} for index in range(len(operations))],
                    "nUpserted": 0,
                    "nMatched": 0,
                    "nModified": 0,
                }
            )

        upserted = 0
        matched = 0
        modified = 0
        for operation in operations:
            filter_document = operation._filter
            update_document = operation._doc["$set"]
            existing = self.find_one(filter_document)
            if existing is not None:
                matched += 1
                changed = any(existing.get(key) != value for key, value in update_document.items())
                existing.update(update_document)
                modified += int(changed)
            elif operation._upsert:
                self.documents.append({**filter_document, **update_document})
                upserted += 1
        return FakeBulkResult(upserted=upserted, matched=matched, modified=modified)


class FakeDatabase:
    def __init__(self, collections: dict[str, FakeCollection] | None = None) -> None:
        self.collections = collections or {}

    def __getitem__(self, name: str) -> FakeCollection:
        return self.collections.setdefault(name, FakeCollection())


class FakeClient:
    def __init__(self, database: FakeDatabase, ping_error: Exception | None = None) -> None:
        self.database = database
        self.ping_error = ping_error
        self.admin = self
        self.closed = False

    def command(self, name: str) -> dict:
        assert name == "ping"
        if self.ping_error is not None:
            raise self.ping_error
        return {"ok": 1}

    def __getitem__(self, name: str) -> FakeDatabase:
        del name
        return self.database

    def close(self) -> None:
        self.closed = True


class FakePipelineConfig:
    def __init__(self, project_root: Path) -> None:
        self.project_root = project_root
        self.log_level = "INFO"
        self.run_id = None
        self.run_output_dir = None
        self.output_dir = project_root / "data" / "outputs"
        self.active_output_dir = self.output_dir
        self.backend_url = ""
        self.processing_webhook_secret = None
        self.chunk_max_chars = 220
        self.chunk_max_duration_sec = 45.0
        self.chunk_max_segments = 6
        self.chunk_overlap_segments = 0

    def with_overrides(self, **overrides):
        for name, value in overrides.items():
            setattr(self, name, value)
        if self.run_output_dir is not None:
            self.run_output_dir.mkdir(parents=True, exist_ok=True)
        return self


def write_json(path: Path, payload) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def write_jsonl(path: Path, records: list[dict]) -> None:
    path.write_text(
        "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records),
        encoding="utf-8",
    )


def make_config(root: Path, *, uri: str | None = "mongodb://offline.invalid", batch_size: int = 200):
    return SimpleNamespace(
        run_id="run_離線測試",
        output_dir=root,
        normalized_transcript_output_path=root / "transcripts_normalized.json",
        chunks_output_path=root / "chunks.jsonl",
        text_embeddings_output_path=root / "embeddings_text_gemini.jsonl",
        video_embeddings_output_path=root / "embeddings_video_gemini.jsonl",
        mongodb_uri=uri,
        mongodb_database_name="focusflow_test",
        mongodb_videos_collection="videos",
        mongodb_transcripts_collection="transcripts_normalized",
        mongodb_chunks_collection="video_segments_text",
        mongodb_text_embeddings_collection="video_segments_text",
        mongodb_video_embeddings_collection="video_segments_video",
        mongodb_bulk_batch_size=batch_size,
        target_video_id=None,
    )


def write_pipeline_outputs(root: Path, text_count: int = 451) -> None:
    write_json(
        root / "videos.json",
        [
            {
                "video_id": "video_001",
                "file_name": "中文教學影片.mp4",
                "file_path": "Test_video_file/中文教學影片.mp4",
                "audio_path": "data/processed_audio/video_001.wav",
                "duration_sec": 120.0,
            }
        ],
    )
    write_json(
        root / "transcripts_normalized.json",
        [{"video_id": "video_001", "segments": [{"text": "中文逐字稿"}]}],
    )
    chunks = [
        {"chunk_id": f"chunk_{index:04d}", "segment_id": f"segment_{index:04d}"}
        for index in range(text_count)
    ]
    embeddings = [
        {
            "chunk_id": f"chunk_{index:04d}",
            "video_id": "video_001",
            "start_sec": float(index),
            "end_sec": float(index + 1),
            "text": f"中文內容 {index}",
            "embedding": [0.1, 0.2],
        }
        for index in range(text_count)
    ]
    write_jsonl(root / "chunks.jsonl", chunks)
    write_jsonl(root / "embeddings_text_gemini.jsonl", embeddings)
    write_jsonl(
        root / "embeddings_video_gemini.jsonl",
        [
            {
                "clip_id": "clip_中文_001",
                "video_id": "video_001",
                "start_sec": 0.0,
                "end_sec": 30.0,
                "clip_path": "data/video_multimodal_chunks/中文片段.mp4",
                "embedding": [0.3, 0.4],
            }
        ],
    )


class MongoUploaderOfflineTests(unittest.TestCase):
    def _patch_client(self, client: FakeClient):
        real_types = mongodb_uploader._pymongo_types()
        client_factory = lambda uri: client
        return patch.object(
            mongodb_uploader,
            "_pymongo_types",
            return_value=(client_factory, real_types[1], real_types[2]),
        )

    def test_success_is_idempotent_batched_and_utf8_safe(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            write_pipeline_outputs(root)
            config = make_config(root)
            database = FakeDatabase()
            client = FakeClient(database)

            with self._patch_client(client):
                first = mongodb_uploader.upload_all(config)
                counts_after_first = {
                    name: len(collection.documents)
                    for name, collection in database.collections.items()
                }
                second = mongodb_uploader.upload_all(config)

            self.assertEqual(first.status, "completed")
            self.assertEqual(first.collections["video_segments_text"].inserted, 451)
            self.assertEqual(second.status, "completed")
            self.assertEqual(second.collections["video_segments_text"].matched, 451)
            self.assertEqual(second.totals()["matched"], 454)
            self.assertEqual(
                counts_after_first,
                {
                    name: len(collection.documents)
                    for name, collection in database.collections.items()
                },
            )
            self.assertEqual(len(database["video_segments_text"].documents), 451)
            self.assertEqual(len(database["video_segments_video"].documents), 1)
            self.assertEqual(database["video_segments_text"].bulk_calls, [200, 200, 51, 200, 200, 51])
            self.assertEqual(database["videos"].documents[0]["fileName"], "中文教學影片.mp4")
            self.assertNotIn("run_id", database["videos"].documents[0])

    def test_one_failed_batch_produces_partial_report(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            write_pipeline_outputs(root)
            config = make_config(root)
            database = FakeDatabase(
                {"video_segments_text": FakeCollection(fail_calls={2})}
            )
            client = FakeClient(database)

            with self._patch_client(client):
                with self.assertRaises(mongodb_uploader.MongoUploadError) as caught:
                    mongodb_uploader.upload_all(config)

            report = caught.exception.report
            self.assertEqual(report.status, "partial")
            self.assertEqual(report.collections["video_segments_text"].inserted, 251)
            self.assertEqual(report.collections["video_segments_text"].success, 251)
            self.assertEqual(report.collections["video_segments_text"].failed, 200)
            self.assertEqual(database["video_segments_text"].bulk_calls, [200, 200, 51])

    def test_missing_optional_video_embeddings_can_still_complete(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            write_pipeline_outputs(root, text_count=1)
            (root / "embeddings_video_gemini.jsonl").unlink()
            config = make_config(root)
            client = FakeClient(FakeDatabase())

            with self._patch_client(client):
                report = mongodb_uploader.upload_all(config)

            self.assertEqual(report.status, "completed")
            self.assertEqual(report.collections["video_segments_video"].attempted, 0)

    def test_missing_configuration_is_failed_without_connecting(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config = make_config(Path(temp_dir), uri=None)
            with self.assertRaises(mongodb_uploader.MongoUploadError) as caught:
                mongodb_uploader.upload_all(config)
            self.assertEqual(caught.exception.category, "configuration_error")
            self.assertEqual(caught.exception.report.status, "failed")

    def test_connection_failure_is_classified_and_redacted(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            write_pipeline_outputs(root, text_count=1)
            config = make_config(root, uri="mongodb://user:secret@offline.invalid")
            _, _, pymongo_errors = mongodb_uploader._pymongo_types()
            client = FakeClient(
                FakeDatabase(),
                ping_error=pymongo_errors.ConnectionFailure(
                    "failed mongodb://user:secret@offline.invalid"
                ),
            )

            with self._patch_client(client):
                with self.assertLogs("mongodb_uploader", level="INFO") as captured_logs:
                    with self.assertRaises(mongodb_uploader.MongoUploadError) as caught:
                        mongodb_uploader.upload_all(config)

            serialized = json.dumps(caught.exception.report.to_dict(), ensure_ascii=False)
            log_output = "\n".join(captured_logs.output)
            self.assertEqual(caught.exception.category, "connection_error")
            self.assertNotIn("secret", serialized)
            self.assertNotIn("mongodb://", serialized)
            self.assertNotIn("secret", log_output)
            self.assertNotIn("mongodb://", log_output)

    def test_upload_summary_resume_accepts_only_completed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            details = {
                "started_at": "2026-07-14T00:00:00+00:00",
                "finished_at": "2026-07-14T00:00:01+00:00",
                "collections": {"videos": {"attempted": 1, "inserted": 1}},
                "totals": {
                    "attempted": 999,
                    "inserted": 999,
                    "updated": 0,
                    "matched": 0,
                    "skipped": 0,
                    "failed": 0,
                },
                "errors": [],
            }
            write_upload_summary(root, "run_001", "completed", details=details)
            payload = json.loads((root / "upload_summary.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["status"], "completed")
            self.assertEqual(payload["totals"]["attempted"], 1)
            self.assertEqual(payload["totals"]["inserted"], 1)
            self.assertEqual(payload["errors"], [])
            self.assertIsNone(payload["error"])
            _validate_upload_summary(root)

            for status in ("partial", "failed"):
                write_upload_summary(root, "run_001", status, details=details)
                with self.assertRaises(CheckpointError):
                    _validate_upload_summary(root)

    def test_partial_upload_marks_run_failed_and_skips_latest_and_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            config = FakePipelineConfig(root)
            args = SimpleNamespace(
                overwrite=False,
                resume_run_id=None,
                video_id=None,
                limit=None,
            )

            def fake_run_pipeline(runtime_config, job_manager, limit=None, resume_plan=None):
                del runtime_config, limit, resume_plan
                video = VideoMetadata(
                    video_id="video_001",
                    file_name="中文影片.mp4",
                    file_path="Test_video_file/中文影片.mp4",
                    audio_path="data/processed_audio/video_001.wav",
                    duration_sec=10.0,
                    course_name=None,
                    week=None,
                    lesson=None,
                )
                job_manager.add_video(video.video_id, video.file_name, video.file_path)
                return {}, [video], {
                    "transcripts": [],
                    "normalized_transcripts": [],
                    "chunks": [],
                    "text_embeddings": [],
                    "audio_embeddings": [],
                }

            report = mongodb_uploader.UploadReport(run_id="run_partial")
            report.collections = {
                "videos": mongodb_uploader.UploadStats(attempted=1, inserted=1),
                "transcripts_normalized": mongodb_uploader.UploadStats(attempted=1, inserted=1),
                "video_segments_text": mongodb_uploader.UploadStats(
                    attempted=451,
                    inserted=251,
                    failed=200,
                ),
                "video_segments_video": mongodb_uploader.UploadStats(attempted=0),
            }
            report.errors = [{"category": "duplicate_or_write_error", "message": "safe"}]
            report.finish("partial")
            upload_error = mongodb_uploader.MongoUploadError(
                report,
                "duplicate_or_write_error",
            )

            with (
                patch.object(pipeline_main, "parse_args", return_value=args),
                patch.object(pipeline_main, "build_runtime_config", return_value=config),
                patch.object(pipeline_main, "configure_logging"),
                patch.object(pipeline_main, "run_pipeline", side_effect=fake_run_pipeline),
                patch.object(mongodb_uploader, "upload_all", side_effect=upload_error),
                patch.object(pipeline_main, "notify_backend"),
                patch.object(pipeline_main, "cleanup_after_successful_upload") as cleanup,
                patch.object(pipeline_main, "export_latest_compatibility_outputs") as latest,
            ):
                exit_code = pipeline_main.main()

            self.assertEqual(exit_code, 1)
            self.assertFalse(cleanup.called)
            self.assertFalse(latest.called)
            manifest = json.loads((config.run_output_dir / "manifest.json").read_text(encoding="utf-8"))
            upload_summary = json.loads(
                (config.run_output_dir / "upload_summary.json").read_text(encoding="utf-8")
            )
            run_summary = json.loads(
                (config.run_output_dir / "run_summary.json").read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["status"], "failed")
            self.assertEqual(
                manifest["videos"][0]["stages"]["mongodb_upload"]["status"],
                "failed",
            )
            self.assertEqual(upload_summary["status"], "partial")
            self.assertEqual(upload_summary["totals"]["inserted"], 253)
            self.assertEqual(upload_summary["totals"]["failed"], 200)
            self.assertEqual(run_summary["status"], "failed")

    def test_error_categories_cover_write_auth_validation_and_unknown(self) -> None:
        _, _, pymongo_errors = mongodb_uploader._pymongo_types()
        cases = (
            (pymongo_errors.OperationFailure("auth", code=18), "authentication_error"),
            (pymongo_errors.DuplicateKeyError("duplicate"), "duplicate_or_write_error"),
            (ValueError("bad data"), "validation_error"),
            (RuntimeError("unexpected"), "unknown_error"),
        )
        for error, expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(mongodb_uploader.classify_error(error), expected)


if __name__ == "__main__":
    unittest.main()
