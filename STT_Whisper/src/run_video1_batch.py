"""Approved V1 batch using the existing adapter. Defaults to free dry-run."""
import argparse
import hashlib
import json
import struct
from pathlib import Path

from gemini_multimodal_adapter import GeminiMultimodalAdapter, estimate_cost
from plan_multimodal_validation import COURSE_ID, SOURCES, load_chunks
from run_gemini_validation import FakeSDK, file_digest, prepare_requests
from segment_media_embedding import probe_duration, sample_window, write_json
from utils import resolve_ffmpeg_binary

ROOT = Path(__file__).resolve().parents[2]
VIDEO_ID = SOURCES[0][1]
IDS = [f"{VIDEO_ID}_chunk_{i:04d}" for i in range(1, 118)]
WORK = ROOT / ".local-tools/video1-build"
LEDGER = ROOT / ".local-tools/multimodal-gemini/cost-ledger.json"
CHECKPOINTS = ROOT / ".local-tools/gemini-small-sample/gemini/checkpoints"
SOURCE_SHA = "2931462f4db6dc9779b18cc408663e7d15ad9861e928fcff5b7e817338672ccd"


def private(path):
    path = Path(path).resolve()
    if not path.is_relative_to(ROOT / ".local-tools"):
        raise ValueError("Private artifacts must stay inside .local-tools")
    return path


def validate_manifest(manifest):
    chunks = manifest.get("chunks", [])
    if manifest.get("schemaVersion") != "video1_manifest_v1" or manifest.get("courseId") != COURSE_ID \
            or manifest.get("videoId") != VIDEO_ID or manifest.get("ids") != IDS \
            or len(chunks) != 117 or {c["chunkId"] for c in chunks} != set(IDS):
        raise ValueError("Invalid V1 allowlist")
    for c in chunks:
        if c["courseId"] != COURSE_ID or c["videoId"] != VIDEO_ID or not c["text"].strip() \
                or not 0 <= c["startSec"] < c["endSec"] or c["endSec"] - c["startSec"] > 60:
            raise ValueError("Invalid V1 identity")
        if set(c["media"]) != {"audio", "visual"}:
            raise ValueError("Incomplete media pair")
    return manifest


def prepare_manifest(media_manifest, destination):
    run, video_id, filename = SOURCES[0]
    source = ROOT / "backend/uploads" / filename
    if file_digest(source) != SOURCE_SHA:
        raise ValueError("Original V1 source changed")
    chunks = load_chunks(ROOT / "STT_Whisper/data/outputs/runs" / run / "embeddings_text_gemini.jsonl", video_id)
    media_rows = {r["chunkId"]: r for r in json.loads(private(media_manifest).read_text(encoding="utf-8"))}
    # Preserve byte-identical inputs of the six paid checkpoints already saved.
    prior, _ = prepare_requests(ROOT, ROOT / ".local-tools/phase2-validation")
    reused = {(r["identity"]["chunkId"], r["kind"]): r["mediaRecord"] for r in prior
              if r["kind"] in ("audio", "visual") and r["identity"]["videoId"] == VIDEO_ID}
    for c in chunks:
        row = media_rows[c["chunkId"]]
        if any(row[k] != c[k] for k in ("startSec", "endSec")):
            raise ValueError("Prepared slice identity changed")
        c["media"] = {}
        for kind, suffix in (("audio", ".wav"), ("visual", ".mp4")):
            old = reused.get((c["chunkId"], kind))
            path = Path(old["mediaPath"]) if old else private(media_manifest).parent / "media" / f"{c['chunkId']}-{kind}{suffix}"
            start, end = sample_window(c, 1756.5)
            digest = file_digest(path)
            if old and digest != old["mediaSha256"]:
                raise ValueError("Saved sample media changed")
            expected = next(r["sha256"] for r in row["media"] if r["modality"] == kind)
            if not old and digest != expected:
                raise ValueError("Prepared media checksum changed")
            c["media"][kind] = {"mediaPath": str(path.resolve()), "sha256": digest,
                "sampleStartSec": start, "sampleEndSec": end,
                "durationSec": probe_duration(path, resolve_ffmpeg_binary())}
    manifest = validate_manifest({"schemaVersion": "video1_manifest_v1", "courseId": COURSE_ID,
        "videoId": VIDEO_ID, "ids": IDS, "sourceSha256": SOURCE_SHA, "chunks": chunks})
    destination = private(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise ValueError("Manifest already exists; do not overwrite an approved plan")
    write_json(destination, manifest)
    return {"manifestSha256": file_digest(destination), "chunks": 117, "inputs": 351, "paidCalls": 0}


def requests_for(manifest):
    validate_manifest(manifest)
    requests = []
    for c in manifest["chunks"]:
        identity = {k: c[k] for k in ("courseId", "videoId", "chunkId", "startSec", "endSec")}
        requests.append({"kind": "text", "identity": identity, "text": c["text"], "estimatedUsd": estimate_cost("text")})
        for kind, m in c["media"].items():
            path = private(m["mediaPath"])
            if file_digest(path) != m["sha256"]:
                raise ValueError("Media checksum mismatch")
            duration = probe_duration(path, resolve_ffmpeg_binary())
            start, end = sample_window(c, 1756.5)
            if (m["sampleStartSec"], m["sampleEndSec"]) != (start, end) or duration != m["durationSec"]:
                raise ValueError("Media timing mismatch")
            requests.append({"kind": kind, "identity": identity,
                "mediaRecord": {**identity, "modality": kind, "status": "success", "mediaPath": str(path),
                                "sampleStartSec": start, "sampleEndSec": end},
                "estimatedUsd": estimate_cost(kind, seconds=max(duration, end - start))})
    return requests


def run_requests(requests, adapter, work, *, manifest_hash, start=0, batch_size=10):
    if not isinstance(batch_size, int) or not 1 <= batch_size <= 117 or not 0 <= start < 117:
        raise ValueError("Invalid batch range")
    work.mkdir(parents=True, exist_ok=True)
    file = work / "state.json"
    state = json.loads(file.read_text(encoding="utf-8")) if file.exists() else {
        "manifestSha256": manifest_hash, "executionMode": adapter.execution_mode, "results": {}}
    if state["manifestSha256"] != manifest_hash or state["executionMode"] != adapter.execution_mode:
        raise ValueError("Existing state belongs to another manifest or mode")
    selected = requests[start * 3:min(117, start + batch_size) * 3]
    for r in selected:
        key = r["identity"]["chunkId"] + ":" + r["kind"]
        state.update(status="running", current=key)
        write_json(file, state)
        try:
            result = adapter.embed_text(r["text"], role="text", identity=r["identity"]) if r["kind"] == "text" \
                else adapter.embed_media(r["mediaRecord"])
            state["results"][key] = {"status": "success", "signature": result["signature"], "reused": result["reused"]}
        except Exception as error:
            state["results"][key] = {"status": "stopped", "errorType": type(error).__name__}
            state["status"] = "stopped"
            write_json(file, state)
            raise
        write_json(file, state)
    state["status"] = "complete" if len(state["results"]) == 351 and all(
        r["status"] == "success" for r in state["results"].values()) else "batch_complete"
    write_json(file, state)
    return state


def export_batch(manifest, state, checkpoints, destination):
    if state["status"] != "complete" or state["executionMode"] != "gemini":
        raise ValueError("All 351 real checkpoints required")
    records = []
    for r in requests_for(manifest):
        key = r["identity"]["chunkId"] + ":" + r["kind"]
        cp = json.loads((checkpoints / (state["results"][key]["signature"] + ".json")).read_text(encoding="utf-8"))
        # Replay through the adapter with a forbidden factory, validating its native signature and digest.
        def forbidden(_):
            raise AssertionError("Export cannot call a provider")
        replay = GeminiMultimodalAdapter(checkpoints, max_cost_usd=20, max_calls=1048, allow_paid=True,
            ledger_path=LEDGER, client_factory=forbidden)
        verified = replay.embed_text(r["text"], role="text", identity=r["identity"]) if r["kind"] == "text" \
            else replay.embed_media(r["mediaRecord"])
        if verified["signature"] != cp["signature"] or not verified["reused"]:
            raise ValueError("Checkpoint does not match frozen input")
        vector = verified["embedding"]
        records.append({"kind": r["kind"], "identity": r["identity"], "text": r.get("text"),
            "embedding": vector, "vectorDigest": hashlib.sha256(struct.pack("<3072d", *vector)).hexdigest(),
            "metadata": {k: v for k, v in verified.items() if k not in ("embedding", "embeddingDigest")}})
    write_json(destination, {"schemaVersion": "atlas_video1_v1", "executionMode": "gemini", "records": records})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["prepare", "dry-run", "fake-sdk", "gemini", "export"], default="dry-run")
    parser.add_argument("--manifest", type=Path, default=WORK / "manifest.json")
    parser.add_argument("--media-manifest", type=Path)
    parser.add_argument("--approve-manifest")
    parser.add_argument("--allow-paid", action="store_true")
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--batch-size", type=int, default=10)
    args = parser.parse_args()
    if args.mode == "prepare":
        print(json.dumps(prepare_manifest(args.media_manifest, args.manifest)))
        return
    manifest_path = private(args.manifest)
    if file_digest(manifest_path) != args.approve_manifest:
        raise ValueError("Explicit frozen manifest hash required")
    manifest = validate_manifest(json.loads(manifest_path.read_text(encoding="utf-8")))
    if file_digest(ROOT / "backend/uploads" / SOURCES[0][2]) != SOURCE_SHA:
        raise ValueError("Source changed")
    requests = requests_for(manifest)
    if args.mode == "dry-run":
        print(json.dumps({"chunks": 117, "inputs": len(requests), "grossReserveUsd": sum(r["estimatedUsd"] for r in requests),
            "cumulativeCeilingUsd": 20, "paidCalls": 0}))
        return
    if args.mode == "export":
        state = json.loads((WORK / "state.json").read_text(encoding="utf-8"))
        if state["manifestSha256"] != args.approve_manifest:
            raise ValueError("State manifest mismatch")
        export_batch(manifest, state, CHECKPOINTS, WORK / "bundle.json")
        return
    fake = args.mode == "fake-sdk"
    if not fake and (not args.allow_paid or not LEDGER.exists()):
        raise PermissionError("Explicit paid authorization and existing shared ledger required; never reset it")
    sdk = FakeSDK() if fake else None
    options = {"client_factory": lambda _: sdk, "sleep": lambda _: None} if fake else {}
    work = WORK / "fake-sdk" if fake else WORK
    adapter = GeminiMultimodalAdapter(work / "checkpoints" if fake else CHECKPOINTS,
        max_cost_usd=20, max_calls=1048, allow_paid=True, execution_mode="fake-sdk" if fake else "gemini",
        ledger_path=work / "fake-ledger.json" if fake else LEDGER, **options)
    state = run_requests(requests, adapter, work, manifest_hash=args.approve_manifest,
                         start=args.start, batch_size=args.batch_size)
    print(json.dumps({"status": state["status"], "trackedInputs": len(state["results"]), "paidCalls": 0 if fake else "see shared ledger"}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"status": "stopped", "errorType": type(error).__name__, "details": "redacted"}))
        raise SystemExit(1) from None
