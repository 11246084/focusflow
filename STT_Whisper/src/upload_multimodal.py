"""Prepare scoped upload checkpoints. Real output waits for separate Atlas approval."""
import hashlib
import json
import re
import struct
import os
import stat
import subprocess
from pathlib import Path

from run_gemini_validation import FakeSDK, file_digest
from run_video1_batch import BatchAdapter, LEDGER, CATALOG, run_requests, stop_retry
from segment_media_embedding import cut_media, normalize_chunk, probe_duration, sample_window, write_json
from utils import resolve_ffmpeg_binary


def process_upload(root, source, course_id, video_id, chunks, *, mode="fake-sdk",
                   ledger=LEDGER, report=None, expected_hash=None):
    if mode not in ("fake-sdk", "gemini") or mode == "gemini" and not ledger.is_file():
        raise PermissionError("Real execution requires the existing shared acceptance ledger")
    if mode == "gemini":
        if os.getenv("UPLOAD_MULTIMODAL_ALLOW_PAID") != "true":
            raise PermissionError("Explicit paid upload authorization is required")
        if not root.is_absolute() or not root.is_dir() or not ledger.is_absolute():
            raise ValueError("Provision private persistent storage and the existing ledger first")
        if os.name == "posix" and any(stat.S_IMODE(p.stat().st_mode) & 0o077 for p in (root, ledger)):
            raise PermissionError("Acceptance storage and ledger must be service-private")
    if not all(re.fullmatch(r"[0-9a-f]{24}", value or "") for value in (course_id, video_id)):
        raise ValueError("Missing trusted upload scope")
    rows = [normalize_chunk({**chunk.to_dict(), "courseId": course_id}) for chunk in chunks]
    if not rows or len({row["chunkId"] for row in rows}) != len(rows) or any(
        row["videoId"] != video_id or not row["chunkId"].startswith(video_id + "_chunk_")
        or not row["text"].strip() for row in rows
    ):
        raise ValueError("Incomplete or mixed upload scope")
    source = Path(source)
    scope = {"sourceSha256": file_digest(source), "chunks": rows}
    if expected_hash and scope["sourceSha256"] != expected_hash:
        raise ValueError("Uploaded file differs from registered source")
    version = hashlib.sha256(json.dumps(scope, sort_keys=True).encode()).hexdigest()
    work = root / mode / course_id / video_id / version
    work.mkdir(parents=True, exist_ok=True)
    lock = work / "worker.lock"
    with lock.open("x") as handle:
        handle.write("Inspect interrupted worker before releasing ownership")
    progress = work / "progress.json"
    def publish(status, **details):
        value = {"status": status, "mode": mode, **details}
        write_json(progress, value)
        if report:
            report(version, value)
        return value

    try:
        write_json(work / "manifest.json", scope)
        publish("generating")
        ffmpeg = resolve_ffmpeg_binary()
        duration = probe_duration(source, ffmpeg)
        requests = []
        for index, row in enumerate(rows):
            if (work / "cancel").exists() or (work / "pause").exists():
                return publish("cancelled" if (work / "cancel").exists() else "paused")
            identity = {k: row[k] for k in ("courseId", "videoId", "chunkId", "startSec", "endSec")}
            requests.append({"identity": identity, "text": row["text"], "kind": "text"})
            window = sample_window(row, duration)
            if window is None:
                continue
            start, end = window
            for kind, ext in (("audio", "wav"), ("visual", "mp4")):
                media = work / f"{index}-{kind}.{ext}"
                cut_media(source, media, kind, start, end, ffmpeg)
                requests.append({"identity": identity, "kind": kind, "mediaRecord": {
                    **identity, "mediaPath": str(media), "modality": kind, "status": "success",
                    "sampleStartSec": start, "sampleEndSec": end}})
        if file_digest(source) != scope["sourceSha256"]:
            raise ValueError("Source changed during slicing")
        state_path = work / "state.json"
        previous = json.loads(state_path.read_text()) if state_path.exists() else {}
        sdk = FakeSDK() if mode == "fake-sdk" else None
        options = {"client_factory": lambda _: sdk} if sdk else {"ledger_path": ledger}
        adapter = BatchAdapter(work.parent / "checkpoints", max_cost_usd=20, sleep=stop_retry,
            known_successes={key for key, value in previous.get("results", {}).items()
                             if value["status"] == "success"},
            max_calls=CATALOG["maxCalls"], allow_paid=True, execution_mode=mode, **options)
        for start in range(0, len(rows), 10):
            for marker, status in (("cancel", "cancelled"), ("pause", "paused")):
                if (work / marker).exists():
                    return publish(status)
            publish("generating")
            state = run_requests(requests, adapter, work, manifest_hash=version, start=start,
                                 batch_size=min(10, len(rows)))
            publish("checkpoint_saved", records=len(state["results"]))
        if state["status"] != "complete" or state["manifestSha256"] != version or state["executionMode"] != mode:
            raise ValueError("Incomplete checkpoints")
        records = []
        for request in requests:
            identity, kind = request["identity"], request["kind"]
            signature = state["results"][identity["chunkId"] + ":" + kind]["signature"]
            if not re.fullmatch(r"[0-9a-f]{64}", signature):
                raise ValueError("Invalid checkpoint signature")
            cp = json.loads((adapter.output / (signature + ".json")).read_text())
            if (cp["signature"] != signature or cp["dimension"] != 3072 or cp["provider"] != mode
                    or cp["model"] != "gemini-embedding-2" or cp["modality"] != kind
                    or any(cp[key] != value for key, value in identity.items())
                    or hashlib.sha256(json.dumps(cp["embedding"]).encode()).hexdigest() != cp["embeddingDigest"]):
                raise ValueError("Checkpoint identity or vector digest mismatch")
            records.append({"identity": identity, "kind": kind, "text": request.get("text"),
                "metadata": {k: v for k, v in cp.items() if k not in ("embedding", "embeddingDigest")},
                "embedding": cp["embedding"],
                "vectorDigest": hashlib.sha256(struct.pack("<3072d", *cp["embedding"])).hexdigest()})
        write_json(work / "bundle.json", {"sourceSha256": scope["sourceSha256"],
                                          "executionMode": mode, "schemaVersion": "atlas_upload_v1",
                                          "manifestHash": version, "records": records})
        details = {"records": len(records)}
        if sdk:
            details["sdkCalls"] = len(sdk.calls)
        return publish("fake_checkpoints_complete" if sdk else "awaiting_atlas_approval", **details)
    except Exception as error:
        publish("stopped", errorType=type(error).__name__)
        raise
    finally:
        lock.unlink()


def process_registered_upload(config, video, chunks, mode, root, ledger):
    from bson import ObjectId
    from pymongo import MongoClient
    with MongoClient(config.mongodb_uri, serverSelectionTimeoutMS=10000, retryWrites=False) as client:
        database = client[config.mongodb_database_name]
        videos = database["videos"]
        owner = videos.find_one({"_id": ObjectId(video.video_id), "processing.status": "completed",
                                 "deletedAt": None}, {"courseId": 1, "fileHash": 1, "filePath": 1, "processing.completedAt": 1,
                                                      "processing.multimodal": 1})
        if not owner or not owner.get("fileHash") or not owner["processing"].get("completedAt"):
            raise ValueError("Missing completed upload generation")
        guard = {"_id": owner["_id"], "courseId": owner["courseId"], "fileHash": owner["fileHash"],
                 "deletedAt": None, "processing.status": "completed",
                 "processing.completedAt": owner["processing"]["completedAt"]}
        def report(version, value):
            result = videos.update_one(guard, {"$set": {"processing.multimodal": {
                "version": version, **value}}})
            if result.matched_count != 1:
                raise ValueError("Upload generation changed")
        try:
            current = owner["processing"].get("multimodal") or {}
            if current.get("status") == "ready" and current.get("mode") == "gemini":
                return current
            if mode == "gemini" and (os.getenv("UPLOAD_MULTIMODAL_ALLOW_PAID") != "true"
                                     or not os.getenv("UPLOAD_MULTIMODAL_STORAGE")
                                     or not os.getenv("UPLOAD_MULTIMODAL_LEDGER")):
                raise PermissionError("Paid upload stage requires explicit configuration")
            stored = list(database["video_segments_text"].find({"videoId": video.video_id},
                          {"_id": 0, "chunkId": 1, "text": 1, "startSec": 1, "endSec": 1, "courseId": 1}))
            expected = {c.chunk_id: (c.text, c.start_sec, c.end_sec) for c in chunks}
            if (len(expected) != len(chunks) or len(stored) != len(chunks)
                    or len({row["chunkId"] for row in stored}) != len(chunks)
                    or any(expected.get(row["chunkId"]) != (row["text"], row["startSec"], row["endSec"])
                           or row.get("courseId") is not None and str(row["courseId"]) != str(owner["courseId"])
                           for row in stored)):
                raise ValueError("Uploaded transcript and stored chunk allowlist disagree")
            source = config.project_root / video.file_path
            state = process_upload(root, source, str(owner["courseId"]),
                                  video.video_id, chunks, mode=mode, ledger=ledger, report=report,
                                  expected_hash=owner["fileHash"])
            if state["status"] == "awaiting_atlas_approval" and os.getenv("UPLOAD_MULTIMODAL_ATLAS_ACCEPTANCE") == "true":
                saved = videos.find_one(guard, {"processing.multimodal.version": 1})
                if not saved:
                    raise ValueError("Upload changed before Atlas handoff")
                version = saved["processing"]["multimodal"]["version"]
                directory = root / mode / str(owner["courseId"]) / video.video_id / version
                command = [os.getenv("NODE_BINARY") or "node",
                           str(config.project_root.parent / "backend/scripts/atlas-multimodal/upload.js"),
                           "--directory", str(directory)]
                approval = directory / "atlas-approval.json"
                if approval.is_file():
                    permit = json.loads(approval.read_text())
                    if not re.fullmatch(r"[0-9a-f]{64}", permit.get("approvalHash", "")):
                        raise PermissionError("Malformed operator approval")
                    with (directory / ("approval-used-" + permit["approvalHash"])).open("x") as consumed:
                        consumed.write("Inspect the Atlas journal before any further execution.")
                    command.extend(["--approve", permit["approvalHash"]])
                subprocess.run(command, check=True)
            return state
        except FileExistsError:
            raise  # Another worker or a stale lock owns this generation.
        except Exception as error:
            videos.update_one({**guard, "processing.multimodal.status": "queued"},
                              {"$set": {"processing.multimodal.status": "stopped",
                                        "processing.multimodal.errorType": type(error).__name__}})
            raise


def resume_upload(directory):
    """Operator recovery for the multimodal stage alone, bound to the registered source."""
    from bson import ObjectId
    from pymongo import MongoClient
    from config import PipelineConfig
    from types import SimpleNamespace
    from utils import ChunkRecord
    directory = directory.resolve()
    course_id, video_id, version = directory.parts[-3:]
    mode = directory.parents[2].name
    if mode not in ("gemini", "fake-sdk") or mode != os.getenv("UPLOAD_MULTIMODAL_MODE"):
        raise ValueError("Recovery mode differs from worker configuration")
    config = PipelineConfig.from_env(Path(__file__).resolve().parents[1])
    root = Path(os.getenv("UPLOAD_MULTIMODAL_STORAGE") or config.data_dir / "multimodal-acceptance").resolve()
    if directory != root / mode / course_id / video_id / version:
        raise ValueError("Checkpoint directory outside configured storage")
    scope = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if hashlib.sha256(json.dumps(scope, sort_keys=True).encode()).hexdigest() != version:
        raise ValueError("Checkpoint manifest digest differs")
    with MongoClient(config.mongodb_uri, serverSelectionTimeoutMS=10000) as client:
        owner = client[config.mongodb_database_name]["videos"].find_one({
            "_id": ObjectId(video_id), "courseId": ObjectId(course_id), "fileHash": scope["sourceSha256"],
            "processing.status": "completed", "processing.multimodal.version": version, "deletedAt": None},
            {"filePath": 1})
    if not owner:
        raise ValueError("Upload generation no longer current")
    chunks = [ChunkRecord(**{key: row[key] for key in ChunkRecord.__dataclass_fields__}) for row in scope["chunks"]]
    source = Path(owner["filePath"])
    if not source.is_absolute():
        source = config.project_root.parent / "backend" / source
    return process_registered_upload(config, SimpleNamespace(video_id=video_id, file_path=source), chunks,
                                     mode, root, Path(os.getenv("UPLOAD_MULTIMODAL_LEDGER") or LEDGER))


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=resume_upload.__doc__)
    parser.add_argument("--resume", required=True, type=Path)
    print(json.dumps(resume_upload(parser.parse_args().resume)))
