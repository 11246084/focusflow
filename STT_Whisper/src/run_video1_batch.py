"""Approved per-video corpus batch using the existing adapter. Defaults to free dry-run."""
import argparse
import hashlib
import json
import struct
import re
import math
from pathlib import Path

from gemini_multimodal_adapter import GeminiMultimodalAdapter, estimate_cost, build_text_content
from plan_multimodal_validation import COURSE_ID, SOURCES, load_chunks
from run_gemini_validation import FakeSDK, file_digest, prepare_requests
from segment_media_embedding import probe_duration, sample_window, write_json
from utils import resolve_ffmpeg_binary
from multimodal_corpus import CATALOG, specification, validate_scope, verify_source, prepare_scope, verify_manifest_source

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
    if manifest.get("schemaVersion") == "video_manifest_v1":
        return validate_scope(manifest)
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
    if manifest["schemaVersion"] == "video_manifest_v1":
        verify_manifest_source(manifest)
    requests = []
    for c in manifest["chunks"]:
        identity = {k: c[k] for k in ("courseId", "videoId", "chunkId", "startSec", "endSec")}
        requests.append({"kind": "text", "identity": identity, "text": c["text"], "estimatedUsd": estimate_cost("text")})
        for kind, m in c["media"].items():
            path = private(m["mediaPath"])
            if file_digest(path) != m["sha256"]:
                raise ValueError("Media checksum mismatch")
            duration = probe_duration(path, resolve_ffmpeg_binary())
            start, end = sample_window(c, manifest.get("durationSec", 1756.5))
            if (m["sampleStartSec"], m["sampleEndSec"]) != (start, end) or duration != m["durationSec"]:
                raise ValueError("Media timing mismatch")
            requests.append({"kind": kind, "identity": identity,
                "mediaRecord": {**identity, "modality": kind, "status": "success", "mediaPath": str(path),
                                "sampleStartSec": start, "sampleEndSec": end},
                "inputDurationSec": duration, "estimatedUsd": estimate_cost(kind, seconds=max(duration, end - start))})
    return requests


def run_requests(requests, adapter, work, *, manifest_hash, start=0, batch_size=10):
    ids = list(dict.fromkeys(r["identity"]["chunkId"] for r in requests))
    if not isinstance(batch_size, int) or not 1 <= batch_size <= max(117, len(ids)) or not 0 <= start < len(ids):
        raise ValueError("Invalid batch range")
    work.mkdir(parents=True, exist_ok=True)
    file = work / "state.json"
    state = json.loads(file.read_text(encoding="utf-8")) if file.exists() else {
        "manifestSha256": manifest_hash, "executionMode": adapter.execution_mode, "results": {}}
    if state["manifestSha256"] != manifest_hash or state["executionMode"] != adapter.execution_mode:
        raise ValueError("Existing state belongs to another manifest or mode")
    selected_ids = set(ids[start:start + batch_size])
    selected = [r for r in requests if r["identity"]["chunkId"] in selected_ids]
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
    state["status"] = "complete" if len(state["results"]) == len({r["identity"]["chunkId"] + ":" + r["kind"] for r in requests}) and all(
        r["status"] == "success" for r in state["results"].values()) else "batch_complete"
    write_json(file, state)
    return state


def export_batch(manifest, state, checkpoints, destination, *, ledger_path=LEDGER):
    if state["status"] != "complete" or state["executionMode"] != "gemini":
        raise ValueError("All approved real checkpoints required")
    records = []
    for r in requests_for(manifest):
        key = r["identity"]["chunkId"] + ":" + r["kind"]
        cp = json.loads((checkpoints / (state["results"][key]["signature"] + ".json")).read_text(encoding="utf-8"))
        # Replay through the adapter with a forbidden factory, validating its native signature and digest.
        def forbidden(_):
            raise AssertionError("Export cannot call a provider")
        replay = GeminiMultimodalAdapter(checkpoints, max_cost_usd=20, max_calls=CATALOG["maxCalls"], allow_paid=True,
            ledger_path=ledger_path, client_factory=forbidden)
        verified = replay.embed_text(r["text"], role="text", identity=r["identity"]) if r["kind"] == "text" \
            else replay.embed_media(r["mediaRecord"])
        if verified["signature"] != cp["signature"] or not verified["reused"]:
            raise ValueError("Checkpoint does not match frozen input")
        vector = verified["embedding"]
        records.append({"kind": r["kind"], "identity": r["identity"], "text": r.get("text"),
            "embedding": vector, "vectorDigest": hashlib.sha256(struct.pack("<3072d", *vector)).hexdigest(),
            "metadata": {k: v for k, v in verified.items() if k not in ("embedding", "embeddingDigest")}})
    write_json(destination, {"schemaVersion": "atlas_video_v1" if manifest["schemaVersion"] == "video_manifest_v1" else "atlas_video1_v1", "executionMode": "gemini", "records": records})


def inspect_requests(requests):
    reused = []
    for r in requests:
        kind = r['kind']; identity = dict(r['identity'])
        if kind == 'text':
            data = build_text_content(r['text'], kind).encode('utf-8')
            from embedding_contract import GEMINI_EMBEDDING_CONTRACT_VERSION
            contract = GEMINI_EMBEDDING_CONTRACT_VERSION
        else:
            media = r['mediaRecord']; data = Path(media['mediaPath']).read_bytes()
            identity.update(sampleStartSec=media['sampleStartSec'], sampleEndSec=media['sampleEndSec'], mediaDurationSec=r['inputDurationSec'])
            contract = f'gemini_embedding_2_{kind}_v1'
        sig = hashlib.sha256(json.dumps(['gemini', 'gemini-embedding-2', 3072, kind, contract, identity,
            hashlib.sha256(data).hexdigest()], sort_keys=True).encode()).hexdigest()
        cp = CHECKPOINTS / (sig + '.json')
        if cp.exists():
            record = json.loads(cp.read_text(encoding='utf-8'))
            if record.get('status') != 'success':
                raise PermissionError('Prior failed/unknown input requires inspection before continuing')
            vector = record['embedding']
            if record.get('signature') != sig or record.get('provider') != 'gemini' or record.get('dimension') != 3072 \
                    or record.get('model') != 'gemini-embedding-2' or len(vector) != 3072 \
                    or not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in vector) \
                    or abs(sum(v*v for v in vector) - 1) > .001 \
                    or hashlib.sha256(json.dumps(vector).encode()).hexdigest() != record.get('embeddingDigest'):
                raise ValueError('Cached checkpoint integrity mismatch')
            reused.append(r)
    ledger = json.loads(LEDGER.read_text()) if LEDGER.exists() else None
    gross = sum(r['estimatedUsd'] for r in requests); new = gross - sum(r['estimatedUsd'] for r in reused)
    return {'chunks': len({r['identity']['chunkId'] for r in requests}), 'inputs': len(requests), 'reused': len(reused),
        'newInputs': len(requests) - len(reused), 'grossReserveUsd': gross, 'newReserveUsd': new,
        'ledgerReservedUsd': ledger['reservedUsd'] if ledger else None, 'cumulativeCeilingUsd': 20,
        'firstAttemptFitsBudget': ledger is not None and ledger['reservedUsd'] + new <= 20, 'paidCalls': 0}


def query_request(manifest, question_id=None):
    bank_file = ROOT / 'docs/04_Features/QA_Evaluation/datasets/question-bank.json'
    bank = json.loads(bank_file.read_text(encoding='utf-8'))
    spec = specification(manifest['videoId'])
    if bank['courseId'] != manifest['courseId']:
        raise ValueError('Question bank course differs')
    selected = next((q for q in bank['questions'] if not q['shouldRefuse'] and q['id'] != 'X01'
        and q['expectedVideos'].strip() == spec['key'] and (question_id is None or q['id'] == question_id)
        and re.fullmatch(r'\d+(?:\.\d+)?-\d+(?:\.\d+)?', q['expectedTimeRange'])), None)
    if selected is None:
        raise ValueError('Choose an existing answerable single-video question with human time labels')
    start, end = map(float, selected['expectedTimeRange'].split('-'))
    anchors = [c for c in manifest['chunks'] if min(c['endSec'], end) > max(c['startSec'], start)]
    if not anchors:
        raise ValueError('Existing gold time does not overlap a real chunk')
    anchor = max(anchors, key=lambda c: min(c['endSec'], end) - max(c['startSec'], start))
    return {'questionId': selected['id'], 'text': selected['question'], 'questionBankSha256': file_digest(bank_file),
        'identity': {k: anchor[k] for k in ['courseId', 'videoId', 'chunkId', 'startSec', 'endSec']},
        'estimatedUsd': estimate_cost('query')}


def stop_retry(_):
    raise PermissionError("Provider failure paused; inspect checkpoint/ledger and obtain controlled retry authorization")


class BatchAdapter(GeminiMultimodalAdapter):
    """Never regenerate a known success, or automatically restart a previously attempted input."""
    def __init__(self, *args, known_successes=None, retry_signature=None, retry_attempt=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.known_successes = known_successes or set()
        self.retry_signature, self.retry_attempt = retry_signature, retry_attempt

    def _run_request(self, signature, modality, content, contract, cost, identity, input_bytes):
        checkpoint = self.output / (signature + '.json')
        cached = json.loads(checkpoint.read_text(encoding='utf-8')) if checkpoint.exists() else {}
        if cached.get('status') == 'success':
            vector = cached.get('embedding', [])
            if cached.get('signature') != signature or cached.get('provider') != self.execution_mode \
                    or cached.get('model') != 'gemini-embedding-2' or cached.get('dimension') != 3072 \
                    or len(vector) != 3072 or not all(isinstance(v, (int, float)) and not isinstance(v, bool)
                        and math.isfinite(v) for v in vector) or abs(sum(v*v for v in vector) - 1) > .001 \
                    or hashlib.sha256(json.dumps(vector).encode()).hexdigest() != cached.get('embeddingDigest'):
                raise ValueError('Corrupt successful checkpoint must never be regenerated')
        key = (identity or {}).get('chunkId', '') + ':' + modality
        ledger = json.loads(self.ledger_path.read_text()) if self.ledger_path.exists() else {}
        previous = max(cached.get('attempts', 0), ledger.get('attemptsBySignature', {}).get(signature, 0))
        if cached.get('status') != 'success':
            if key in self.known_successes:
                raise PermissionError('Lost successful cache must be restored, never regenerated')
            if previous:
                if self.retry_signature != signature or self.retry_attempt != previous + 1 or self.retry_attempt > 3:
                    raise PermissionError('Prior input requires explicit signature and next-attempt authorization')
                permits = self.ledger_path.parent / 'controlled-retry-permits'
                permits.mkdir(exist_ok=True)
                permit = permits / f'{signature}-{self.retry_attempt}.json'
                # Preserve the unknown preimage and original reserve before the native checkpoint changes.
                with permit.open('x', encoding='utf-8') as handle:
                    json.dump({'signature': signature, 'nextAttempt': self.retry_attempt,
                        'beforeCheckpoint': cached, 'beforeLedgerCalls': ledger.get('calls'),
                        'beforeReservedUsd': ledger.get('reservedUsd')}, handle)
                    handle.flush()
                    import os
                    os.fsync(handle.fileno())
        return super()._run_request(signature, modality, content, contract, cost, identity, input_bytes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["prepare", "dry-run", "fake-sdk", "gemini", "export", "query-plan", "query"], default="dry-run")
    parser.add_argument("--video", type=int, choices=range(1, 7), default=1)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--media-manifest", type=Path)
    parser.add_argument("--question-id")
    parser.add_argument("--approve-manifest")
    parser.add_argument("--allow-paid", action="store_true")
    parser.add_argument("--retry-signature")
    parser.add_argument("--retry-attempt", type=int, choices=[2, 3])
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--batch-size", type=int, default=10)
    args = parser.parse_args()
    if bool(args.retry_signature) != (args.retry_attempt is not None) or args.retry_signature and not re.fullmatch('[a-f0-9]{64}', args.retry_signature):
        raise ValueError('Retry requires exact signature and next attempt')
    spec = CATALOG["videos"][args.video - 1]
    work_root = WORK if args.video == 1 else ROOT / ".local-tools/multimodal-build" / spec["key"]
    args.manifest = args.manifest or work_root / "manifest.json"
    if args.mode == "prepare":
        print(json.dumps(prepare_manifest(args.media_manifest, args.manifest) if args.video == 1 else prepare_scope(spec, args.manifest)))
        return
    manifest_path = private(args.manifest)
    if file_digest(manifest_path) != args.approve_manifest:
        raise ValueError("Explicit frozen manifest hash required")
    manifest = validate_manifest(json.loads(manifest_path.read_text(encoding="utf-8")))
    if manifest["videoId"] != spec["videoId"]:
        raise ValueError("CLI video does not match approved manifest")
    verify_source(spec)
    if file_digest(ROOT / "backend/uploads" / spec["filename"]) != spec["sourceSha256"]:
        raise ValueError("Source changed")
    requests = requests_for(manifest)
    if args.mode == "query-plan":
        print(json.dumps({**query_request(manifest, args.question_id), "paidCalls": 0}, ensure_ascii=False))
        return
    if args.mode == "dry-run":
        print(json.dumps(inspect_requests(requests)))
        return
    if args.mode == "export":
        state = json.loads((work_root / "state.json").read_text(encoding="utf-8"))
        if state["manifestSha256"] != args.approve_manifest:
            raise ValueError("State manifest mismatch")
        export_batch(manifest, state, CHECKPOINTS, work_root / "bundle.json")
        return
    fake = args.mode == "fake-sdk"
    if not fake and (not args.allow_paid or not LEDGER.exists()):
        raise PermissionError("Explicit paid authorization and existing shared ledger required; never reset it")
    sdk = FakeSDK() if fake else None
    def live_factory(timeout):
        from dotenv import load_dotenv
        import os
        os.environ.pop('GEMINI_API_KEY', None)
        load_dotenv(ROOT / 'backend/.env', override=True)
        from gemini_multimodal_adapter import create_client
        return create_client(timeout)
    options = {"client_factory": lambda _: sdk, "sleep": lambda _: None} if fake else {"client_factory": live_factory, "sleep": stop_retry}
    work = work_root / "fake-sdk" if fake else work_root
    adapter = BatchAdapter(work / "checkpoints" if fake else CHECKPOINTS,
        known_successes={k for k, v in json.loads((work / "state.json").read_text(encoding="utf-8")).get("results", {}).items() if v["status"] == "success"} if (work / "state.json").exists() else set(),
        retry_signature=args.retry_signature, retry_attempt=args.retry_attempt,
        max_cost_usd=20, max_calls=CATALOG["maxCalls"], allow_paid=True, execution_mode="fake-sdk" if fake else "gemini",
        ledger_path=work / "fake-ledger.json" if fake else LEDGER, **options)
    if args.mode == "query":
        request = query_request(manifest, args.question_id)
        result = adapter.embed_text(request['text'], role='query', identity=request['identity'])
        vector = result['embedding']
        record = {"kind": "query", "questionId": request['questionId'], "queryText": request['text'],
            "questionBankSha256": request['questionBankSha256'], "identity": request['identity'], "embedding": vector,
            "vectorDigest": hashlib.sha256(struct.pack('<3072d', *vector)).hexdigest(),
            "metadata": {k: v for k, v in result.items() if k not in ('embedding', 'embeddingDigest')}}
        write_json(work_root / 'query-bundle.json', {"schemaVersion": "atlas_query_v1", "executionMode": "gemini", "records": [record]})
        print(json.dumps({"questionId": request['questionId'], "reused": result['reused'], "queryBundleSha256": file_digest(work_root / 'query-bundle.json')}))
        return
    state = run_requests(requests, adapter, work, manifest_hash=args.approve_manifest,
                         start=args.start, batch_size=args.batch_size)
    print(json.dumps({"status": state["status"], "trackedInputs": len(state["results"]), "paidCalls": 0 if fake else "see shared ledger"}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"status": "stopped", "errorType": type(error).__name__, "details": "redacted"}))
        raise SystemExit(1) from None
