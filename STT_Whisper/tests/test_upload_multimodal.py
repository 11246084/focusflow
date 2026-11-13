import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from upload_multimodal import file_digest, process_registered_upload, process_upload, resume_upload
from utils import ChunkRecord, resolve_ffmpeg_binary


class UploadMultimodalTests(unittest.TestCase):
    def test_uploaded_chunks_generate_three_checkpoints_and_replay_without_calls(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "upload.mp4"
            subprocess.run([resolve_ffmpeg_binary(), "-loglevel", "error", "-f", "lavfi",
                            "-i", "color=size=64x64:duration=3", "-f", "lavfi", "-i",
                            "anullsrc", "-t", "3", str(source)], check=True)
            video = "a" * 24
            chunk = ChunkRecord(video + "_chunk_0001", video, 0, 2, "fixture", None, None, None)
            args = (root, source, "b" * 24, video, [chunk])
            first = process_upload(*args)
            self.assertEqual(first["sdkCalls"], 3)
            second = process_upload(*args)
            self.assertEqual(second["sdkCalls"], 0)
            self.assertEqual(second["status"], "fake_checkpoints_complete")
            self.assertEqual(len(list(root.glob("**/checkpoints/*.json"))), 3 + 1)  # Includes fake ledger.
            directory = next(root.glob("**/progress.json")).parent
            for marker, status in (("pause", "paused"), ("cancel", "cancelled")):
                (directory / marker).touch()
                self.assertEqual(process_upload(*args)["status"], status)
                (directory / marker).unlink()
            db = MagicMock()
            from bson import ObjectId
            owner = {"_id": ObjectId(video), "courseId": ObjectId("b" * 24), "filePath": str(source),
                     "fileHash": file_digest(source), "processing": {"completedAt": 1}}
            videos, segments = MagicMock(), MagicMock()
            videos.find_one.return_value = owner
            videos.update_one.return_value.matched_count = 1
            segments.find.return_value = [{"chunkId": chunk.chunk_id, "text": "fixture", "startSec": 0, "endSec": 2}]
            db.__getitem__.side_effect = {"videos": videos, "video_segments_text": segments}.__getitem__
            with patch("pymongo.MongoClient") as client:
                client.return_value.__enter__.return_value.__getitem__.return_value = db
                config = SimpleNamespace(mongodb_uri="mock", mongodb_database_name="focusflow", project_root=root)
                result = process_registered_upload(config, SimpleNamespace(video_id=video, file_path=source),
                                                   [chunk], "fake-sdk", root, None)
                self.assertEqual(result["sdkCalls"], 0)
                statuses = [call.args[1]["$set"]["processing.multimodal"]["status"]
                            for call in videos.update_one.call_args_list]
                self.assertIn("checkpoint_saved", statuses)
                self.assertEqual(statuses[-1], "fake_checkpoints_complete")
                with (
                    patch.dict("os.environ", {"UPLOAD_MULTIMODAL_STORAGE": str(root),
                                              "UPLOAD_MULTIMODAL_MODE": "fake-sdk"}),
                    patch("config.PipelineConfig.from_env", return_value=config),
                ):
                    self.assertEqual(resume_upload(directory)["sdkCalls"], 0)
                segments.find.return_value[0]["text"] = "changed"
                with self.assertRaisesRegex(ValueError, "allowlist"):
                    process_registered_upload(config, SimpleNamespace(video_id=video, file_path=source),
                                              [chunk], "fake-sdk", root, None)
