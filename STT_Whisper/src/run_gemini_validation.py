"""Three-chunk validation. Defaults to dry-run; paid execution requires explicit flags."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import wave
from pathlib import Path
from types import SimpleNamespace

from gemini_multimodal_adapter import GeminiMultimodalAdapter, PRICING_VERSION, build_text_content, create_client, estimate_cost
from plan_multimodal_validation import SOURCES, load_chunks, select_chunks
from segment_media_embedding import normalize_embedding, probe_duration, sample_window, write_json
from utils import resolve_ffmpeg_binary

QUERIES = ["老師提到哪種模型可以把文字轉成圖片？",
           "課程開頭預計介紹哪些自然語言處理與 ChatGPT 觀念？",
           "如何請工具蒐集 2024 年出版、與 ChatGPT 有關的論文？"]


def file_digest(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def prepare_requests(root: Path, media_root: Path) -> tuple[list[dict], list[dict]]:
    groups = select_chunks(*[load_chunks(root / "STT_Whisper/data/outputs/runs" / run / "embeddings_text_gemini.jsonl", video_id)
                             for run, video_id, _ in SOURCES])
    requests = []
    all_chunks = []
    ffmpeg = resolve_ffmpeg_binary()
    for (_, video_id, filename), chunks in zip(SOURCES, groups):
        manifest = json.loads((media_root / video_id / "manifest.json").read_text(encoding="utf-8"))
        source = root / "backend/uploads" / filename
        if file_digest(source) != manifest["sourceSha256"]:
            raise ValueError("Source changed; regenerate local slices")
        for chunk in chunks:
            question = QUERIES[len(all_chunks)]
            all_chunks.append(chunk)
            identity = {key: chunk[key] for key in ("courseId", "videoId", "chunkId", "startSec", "endSec")}
            for kind, text in (("query", question), ("text", chunk["text"])):
                requests.append({"requestId": f"{chunk['chunkId']}:{kind}", "kind": kind,
                                 "identity": identity, "text": text, "estimatedUsd": estimate_cost(kind),
                                 "input": {"sourceUtf8Bytes": len(text.encode("utf-8")),
                                           "requestUtf8Bytes": len(build_text_content(text, kind).encode("utf-8")),
                                           "reservedTextTokens": 8192}})
            for kind in ("audio", "visual"):
                matching = [row for row in manifest["records"] if row["chunkId"] == chunk["chunkId"] and row["modality"] == kind]
                if len(matching) != 1:
                    raise ValueError("Expected one prepared media record per chunk and modality")
                record = {key: value for key, value in matching[0].items() if key != "embedding"}
                if record["status"] != "success" or any(record[key] != chunk[key] for key in (*identity, "text")):
                    raise ValueError("Prepared media identity disagrees with original chunk")
                expected = sample_window(chunk, manifest["durationSec"])
                if expected != (record["sampleStartSec"], record["sampleEndSec"]):
                    raise ValueError("Prepared media window disagrees with sampling contract")
                media = Path(record["mediaPath"])
                if file_digest(media) != record["mediaSha256"]:
                    raise ValueError("Prepared media checksum differs")
                duration = probe_duration(media, ffmpeg)
                subprocess.run([ffmpeg, "-v", "error", "-i", str(media), "-f", "null", "-"],
                               capture_output=True, check=True, timeout=30)
                if kind == "audio":
                    with wave.open(str(media)) as audio:
                        if audio.getnchannels() != 1 or audio.getframerate() != 16000:
                            raise ValueError("Expected mono 16 kHz WAV")
                sample_seconds = expected[1] - expected[0]
                tolerance = 1 if kind == "visual" else 0.15
                if abs(duration - sample_seconds) > tolerance:
                    raise ValueError("Encoded duration differs from sample window")
                requests.append({"requestId": f"{chunk['chunkId']}:{kind}", "kind": kind,
                    "identity": identity, "mediaRecord": record,
                    "estimatedUsd": estimate_cost(kind, seconds=max(duration, sample_seconds)),
                    "input": {"mediaBytes": media.stat().st_size, "durationSec": duration,
                              "sampleStartSec": expected[0], "sampleEndSec": expected[1],
                              "sha256": record["mediaSha256"]}})
    return requests, all_chunks


class FakeSDK:
    """A deterministic nonsemantic SDK substitute, without networking capabilities."""
    def __init__(self):
        self.models = self
        self.calls = []

    def embed_content(self, *, model, contents, config):
        if isinstance(contents, str):
            kind = "query" if contents.startswith("task: search result | query:") else "text"
            data = contents.encode("utf-8")
        else:
            part = contents.parts[0].inline_data
            kind = {"audio/wav": "audio", "video/mp4": "visual"}[part.mime_type]
            data = part.data
        self.calls.append({"kind": kind, "model": model, "bytes": len(data), "dimension": config.output_dimensionality})
        digest = hashlib.sha256(data + kind.encode()).digest()
        vector = [(digest[index % len(digest)] - 127.5) / 127.5 for index in range(3072)]
        return SimpleNamespace(embeddings=[SimpleNamespace(values=vector)])

    def close(self):
        pass


def execute_requests(requests: list[dict], adapter: GeminiMultimodalAdapter, output: Path) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    state = {"executionMode": adapter.execution_mode, "results": [], "status": "running"}
    vectors = {}
    try:
        for request in requests:
            if request["kind"] in ("query", "text"):
                result = adapter.embed_text(request["text"], role=request["kind"], identity=request["identity"])
            else:
                result = adapter.embed_media(request["mediaRecord"])
            vectors[request["requestId"]] = result["embedding"]
            state["results"].append({"requestId": request["requestId"], "kind": request["kind"],
                **request["identity"], "provider": result["provider"], "model": result["model"],
                "dimension": result["dimension"], "status": result["status"], "reused": result["reused"],
                "inputBytes": result["inputBytes"],
                "createdAt": result["createdAt"], "input": request["input"], "signature": result["signature"]})
            write_json(output / "state.json", state)
        state["status"] = "success"
    except Exception as error:
        state.update(status="stopped", failedRequest=request["requestId"], errorType=type(error).__name__)
        raise
    finally:
        write_json(output / "state.json", state)
    return {"state": state, "vectors": vectors}


def load_preview_vectors(root: Path, chunks: list[dict]) -> dict:
    preview = {}
    selected = {chunk["chunkId"] for chunk in chunks}
    for run, _, _ in SOURCES:
        with (root / "STT_Whisper/data/outputs/runs" / run / "embeddings_text_gemini.jsonl").open(encoding="utf-8") as handle:
            for line in handle:
                row = json.loads(line)
                if row["chunk_id"] in selected:
                    if row.get("embedding_model") != "gemini-embedding-2-preview":
                        raise ValueError("Historical artifact model changed")
                    preview[row["chunk_id"]] = normalize_embedding(row["embedding"])
    if set(preview) != selected:
        raise ValueError("Historical comparison vectors incomplete")
    return preview


def analyze_vectors(root: Path, chunks: list[dict], vectors: dict, preview: dict, output: Path, *, mode: str, node: str) -> dict:
    def cosine(left, right):
        return sum(a * b for a, b in zip(normalize_embedding(left), normalize_embedding(right)))
    requests = []
    query_rankings = []
    for chunk in chunks:
        query = vectors[f"{chunk['chunkId']}:query"]
        lists = {}
        for modality in ("text", "audio", "visual"):
            lists[modality] = sorted([{**candidate, "score": cosine(query, vectors[f"{candidate['chunkId']}:{modality}"])}
                                     for candidate in chunks], key=lambda row: (-row["score"], row["chunkId"]))
        old_ranking = sorted([{"chunkId": candidate["chunkId"], "score": cosine(query, preview[candidate["chunkId"]])}
                              for candidate in chunks], key=lambda row: (-row["score"], row["chunkId"]))
        requests.append({"queryId": chunk["chunkId"], "lists": lists})
        query_rankings.append({"queryId": chunk["chunkId"], "stableChannels": lists, "previewDiagnostic": old_ranking})
    bridge = subprocess.run([node, str(root / "backend/scripts/multimodal-demo/fuseValidationCandidates.js")],
        input=json.dumps(requests), capture_output=True, text=True, encoding="utf-8", timeout=30, check=True)
    pairs = [{"chunkId": chunk["chunkId"], **{f"{a}_{b}": cosine(vectors[f"{chunk['chunkId']}:{a}"], vectors[f"{chunk['chunkId']}:{b}"])
              for a, b in (("text", "audio"), ("text", "visual"), ("audio", "visual"))},
              "stableText_previewText": cosine(vectors[f"{chunk['chunkId']}:text"], preview[chunk["chunkId"]])} for chunk in chunks]
    result = {"executionMode": mode, "semanticQualityVerified": False, "pairs": pairs,
        "queryRankings": query_rankings, "rrf": json.loads(bridge.stdout),
        "limitations": ["Three exploratory chunks only; no 43-question evaluation or production compatibility conclusion.",
                        "Stable-query versus preview-document scores are cross-version diagnostics, not a reproduced preview baseline."]}
    write_json(output / "comparison.json", result)
    return result


def run(root: Path, *, mode: str, output: Path, media_root: Path, max_cost_usd: float,
        max_calls: int, execute_paid: bool = False, node: str) -> dict:
    if mode not in ("dry-run", "fake-sdk", "gemini"):
        raise ValueError("Unknown execution mode")
    if not math.isfinite(max_cost_usd) or not 0 <= max_cost_usd <= 0.25 or not 1 <= max_calls <= 36:
        raise ValueError("Small-sample ceiling is USD 0.25 and 36 attempts")
    if (mode == "gemini") != execute_paid:
        raise PermissionError("Gemini requires explicit paid execution; other modes reject that flag")
    if not node:
        raise ValueError("Supported Node runtime is required")
    version = subprocess.run([node, "-p", "process.versions.node"], capture_output=True, text=True, check=True, timeout=10).stdout.strip()
    parts = tuple(int(part) for part in version.split('.'))
    if not ((parts[0] == 22 and parts >= (22, 23, 4)) or (parts[0] == 24 and parts >= (24, 22, 1))):
        raise ValueError("Node version does not meet repo requirements")
    subprocess.run([node, str(root / "backend/scripts/multimodal-demo/fuseValidationCandidates.js")],
        input="[]", capture_output=True, text=True, check=True, timeout=10)
    requests, chunks = prepare_requests(root, media_root)
    if len(requests) != 12:
        raise ValueError("Expected exactly twelve small-sample inputs")
    preview = load_preview_vectors(root, chunks)
    first = sum(request["estimatedUsd"] for request in requests)
    summary = {"mode": mode, "requestedModel": "gemini-embedding-2", "dimension": 3072,
        "pricingVersion": PRICING_VERSION, "estimatedFirstAttemptsUsd": round(first, 8),
        "estimatedAllRetriesUsd": round(first * 3, 8), "maxCostUsd": max_cost_usd, "maxCalls": max_calls,
        "requests": [{key: value for key, value in request.items() if key not in ("text", "mediaRecord")} for request in requests],
        "queries": QUERIES, "actualApiCalls": 0, "status": "dry-run"}
    work = output / mode
    work.mkdir(parents=True, exist_ok=True)
    write_json(work / "request-plan.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)
    if mode == "dry-run":
        return summary
    if first > max_cost_usd or max_calls < len(requests):
        raise PermissionError("Batch estimate or request count exceeds ceiling")
    fake = FakeSDK()
    def live_factory(timeout_ms):
        # Trusted dotenv loads credentials only at the explicitly paid execution boundary.
        from dotenv import load_dotenv
        os.environ.pop("GEMINI_API_KEY", None)
        load_dotenv(root / "backend/.env", override=True)
        return create_client(timeout_ms)
    factory = (lambda _: fake) if mode == "fake-sdk" else live_factory
    adapter = GeminiMultimodalAdapter(work / "checkpoints", max_cost_usd=max_cost_usd, allow_paid=True,
        max_calls=max_calls, execution_mode=mode, client_factory=factory)
    before = json.loads(adapter.ledger_path.read_text(encoding="utf-8"))["calls"] if adapter.ledger_path.exists() else 0
    result = execute_requests(requests, adapter, work)
    analyze_vectors(root, chunks, result["vectors"], preview, work, mode=mode, node=node)
    ledger = json.loads(adapter.ledger_path.read_text(encoding="utf-8"))
    summary.update(status="success", reused=sum(row["reused"] for row in result["state"]["results"]),
        sdkCallsThisRun=len(fake.calls) if mode == "fake-sdk" else None,
        ledgerCalls=ledger["calls"], reservedEstimateUsd=ledger["reservedUsd"],
        actualApiCalls=0 if mode == "fake-sdk" else ledger["calls"] - before)
    write_json(work / "summary.json", summary)
    return summary


def main():
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("dry-run", "fake-sdk", "gemini"), default="dry-run")
    parser.add_argument("--execute-paid", action="store_true")
    parser.add_argument("--max-cost-usd", type=float)
    parser.add_argument("--max-calls", type=int)
    parser.add_argument("--output", type=Path, default=root / ".local-tools/gemini-small-sample")
    parser.add_argument("--media-root", type=Path, default=root / ".local-tools/phase2-validation")
    parser.add_argument("--node", default=str(root / ".local-tools/node-v22.23.4-win-x64/node.exe") if (root / ".local-tools/node-v22.23.4-win-x64/node.exe").exists() else shutil.which("node"))
    args = parser.parse_args()
    if args.mode == "gemini" and (args.max_cost_usd is None or args.max_calls is None):
        parser.error("Paid mode requires explicit --max-cost-usd and --max-calls")
    try:
        summary = run(root, mode=args.mode, output=args.output, media_root=args.media_root,
            max_cost_usd=args.max_cost_usd if args.max_cost_usd is not None else 0.25,
            max_calls=args.max_calls if args.max_calls is not None else 36,
            execute_paid=args.execute_paid, node=args.node)
        print(json.dumps({key: summary.get(key) for key in ("mode", "status", "reused", "actualApiCalls", "ledgerCalls")}, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"status": "stopped", "errorType": type(error).__name__, "details": "redacted"}))
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
