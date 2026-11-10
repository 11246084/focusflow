"""Export validated real checkpoints locally for the Node Atlas preparation tools."""

import argparse
import hashlib
import json
import math
import struct
from pathlib import Path

from gemini_multimodal_adapter import build_text_content
from run_gemini_validation import prepare_requests
from segment_media_embedding import write_json


def export_bundle(root: Path, output: Path) -> dict:
    requests, _ = prepare_requests(root, root / ".local-tools/phase2-validation")
    work = root / ".local-tools/gemini-small-sample/gemini"
    state = json.loads((work / "state.json").read_text(encoding="utf-8"))
    if state.get("status") != "success" or state.get("executionMode") != "gemini":
        raise ValueError("Successful real checkpoint state is required")
    rows = {row["requestId"]: row for row in state["results"]}
    if len(rows) != 12 or set(rows) != {request["requestId"] for request in requests}:
        raise ValueError("Unexpected checkpoint input set")
    result = []
    for request in requests:
        row = rows[request["requestId"]]
        record = json.loads((work / "checkpoints" / f"{row['signature']}.json").read_text(encoding="utf-8"))
        if record.get("status") != "success" or record.get("provider") != "gemini" \
                or record.get("model") != "gemini-embedding-2" or record.get("dimension") != 3072:
            raise ValueError("Checkpoint model contract failed")
        vector = record["embedding"]
        if len(vector) != 3072 or not all(isinstance(value, (int, float)) and not isinstance(value, bool)
                                        and math.isfinite(value) for value in vector):
            raise ValueError("Invalid checkpoint vector")
        if hashlib.sha256(json.dumps(vector).encode()).hexdigest() != record.get("embeddingDigest"):
            raise ValueError("Checkpoint vector integrity failed")
        if abs(sum(value * value for value in vector) - 1) > 0.001:
            raise ValueError("Vector is not unit normalized")
        identity = request["identity"].copy()
        if any(record.get(key) != value for key, value in identity.items()):
            raise ValueError("Checkpoint chunk identity mismatch")
        if request["kind"] in ("query", "text"):
            data = build_text_content(request["text"], request["kind"]).encode()
        else:
            media = request["mediaRecord"]
            data = Path(media["mediaPath"]).read_bytes()
            identity.update(sampleStartSec=media["sampleStartSec"], sampleEndSec=media["sampleEndSec"],
                            mediaDurationSec=request["input"]["durationSec"])
            if any(record.get(key) != value for key, value in identity.items()):
                raise ValueError("Checkpoint media window mismatch")
        signature = hashlib.sha256(json.dumps(["gemini", record["model"], 3072, request["kind"],
            record["contractVersion"], identity, hashlib.sha256(data).hexdigest()], sort_keys=True).encode()).hexdigest()
        if record["signature"] != signature:
            raise ValueError("Checkpoint input signature mismatch")
        result.append({"requestId": request["requestId"], "kind": request["kind"], "identity": request["identity"],
            "text": request.get("text") if request["kind"] == "text" else None,
            "embedding": vector, "vectorDigest": hashlib.sha256(struct.pack("<3072d", *vector)).hexdigest(),
            "metadata": {key: value for key, value in record.items() if key not in ("embedding", "embeddingDigest")}})
    bundle = {"schemaVersion": "atlas_sample_v1", "executionMode": "gemini", "records": result}
    output.parent.mkdir(parents=True, exist_ok=True)
    write_json(output, bundle)
    return {"records": len(result), "output": str(output.resolve()), "databaseOperations": 0, "apiCalls": 0}


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=root / ".local-tools/atlas-preparation/bundle.json")
    args = parser.parse_args()
    try:
        print(json.dumps(export_bundle(root, args.output)))
    except Exception as error:
        print(json.dumps({"status": "stopped", "errorType": type(error).__name__, "details": "redacted"}))
        raise SystemExit(1) from None
