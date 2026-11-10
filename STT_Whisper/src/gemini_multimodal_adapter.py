"""Opt-in Gemini SDK adapter. Importing or constructing it never calls an API."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

from embedding_contract import (GEMINI_EMBEDDING_CONTRACT_VERSION, GEMINI_EMBEDDING_GENERATION_VERSION,
                                GEMINI_EMBEDDING_INSTRUCTION_VERSION, GEMINI_EMBEDDING_NORMALIZATION_VERSION,
                                build_parent_document_text)
from segment_media_embedding import DIMENSION, MODEL, normalize_embedding, probe_duration, write_json
from utils import resolve_ffmpeg_binary

PRICING_VERSION = "google_standard_2026-11-10"
MAX_ATTEMPTS = 3


class EmbeddingRequestError(Exception):
    """Safe provider error containing only a numeric HTTP code."""


def estimate_cost(modality: str, *, seconds: float = 0) -> float:
    if modality in ("query", "text"):
        # Reserve the full 8192-token input allowance rather than guessing a tokenizer.
        return 8192 * 0.20 / 1_000_000
    if not math.isfinite(seconds) or seconds <= 0 or seconds > 60:
        raise ValueError("Media duration must be within (0, 60] seconds")
    if modality == "audio":
        return math.ceil(seconds) * 0.00016
    if modality == "visual":
        return min(32, math.ceil(seconds)) * 0.00079
    raise ValueError("Unsupported embedding modality")


def create_client(timeout_ms: int):
    # google-genai reads the key from its documented environment variables internally.
    from google import genai
    from google.genai import types
    return genai.Client(http_options=types.HttpOptions(timeout=timeout_ms,
        retry_options=types.HttpRetryOptions(attempts=1)))


class GeminiMultimodalAdapter:
    def __init__(self, output: Path, *, max_cost_usd: float, allow_paid: bool = False,
                 max_calls: int = 30, timeout_ms: int = 30000, client_factory=create_client,
                 sleep=time.sleep, duration_probe=None, ledger_path: Path | None = None):
        if not math.isfinite(max_cost_usd) or not 0 <= max_cost_usd <= 30:
            raise ValueError("Cost ceiling must be between USD 0 and 30")
        if not isinstance(max_calls, int) or max_calls <= 0 or not 1 <= timeout_ms <= 60000:
            raise ValueError("Invalid call or timeout limit")
        self.output = Path(output)
        self.max_cost_usd = max_cost_usd
        self.allow_paid = allow_paid
        self.max_calls = max_calls
        self.timeout_ms = timeout_ms
        self.client_factory = client_factory
        self.sleep = sleep
        self.duration_probe = duration_probe or (lambda media: probe_duration(media, resolve_ffmpeg_binary()))
        self.ledger_path = ledger_path or Path(__file__).resolve().parents[2] / ".local-tools/multimodal-gemini/cost-ledger.json"

    def embed_text(self, text: str, *, role: str = "query") -> dict:
        if role not in ("query", "text") or not isinstance(text, str) or not text.strip():
            raise ValueError("Expected a query or document text")
        payload = f"task: search result | query: {text.strip()}" if role == "query" else build_parent_document_text(text)
        if len(payload.encode("utf-8")) > 8192:
            raise ValueError("Text exceeds conservative UTF-8 input bound")
        return self._embed(role, payload, payload.encode("utf-8"), estimate_cost(role))

    def embed_media(self, record: dict) -> dict:
        from google.genai import types
        modality = record.get("modality")
        if modality not in ("audio", "visual") or record.get("status") != "success":
            raise ValueError("Expected a successful local media record")
        media = Path(record["mediaPath"])
        mime = {"audio": "audio/wav", "visual": "video/mp4"}[modality]
        if media.suffix.lower() != {"audio": ".wav", "visual": ".mp4"}[modality]:
            raise ValueError("Unsupported prepared media format")
        if media.stat().st_size > 15 * 1024 * 1024:
            raise ValueError("Prepared media exceeds 15 MB inline bound")
        data = media.read_bytes()
        seconds = self.duration_probe(media)
        sample_seconds = record["sampleEndSec"] - record["sampleStartSec"]
        if not math.isfinite(sample_seconds) or abs(seconds - sample_seconds) > 0.15:
            raise ValueError("Media duration disagrees with sample timestamps")
        if not record.get("chunkId") or not record.get("videoId"):
            raise ValueError("Media identity is required")
        # Exactly one media part per request, without an instruction prefix.
        content = types.Content(parts=[types.Part.from_bytes(data=data, mime_type=mime)])
        return self._embed(modality, content, data, estimate_cost(modality, seconds=seconds), identity={
            key: record[key] for key in ("courseId", "videoId", "chunkId", "startSec", "endSec", "sampleStartSec", "sampleEndSec")})

    def _embed(self, modality, content, data: bytes, cost: float, identity=None) -> dict:
        if not self.allow_paid:
            raise PermissionError("Paid API execution requires explicit opt-in")
        contract = GEMINI_EMBEDDING_CONTRACT_VERSION if modality in ("query", "text") else f"gemini_embedding_2_{modality}_v1"
        signature = hashlib.sha256(json.dumps([MODEL, DIMENSION, modality, contract, identity,
                                               hashlib.sha256(data).hexdigest()], sort_keys=True).encode()).hexdigest()
        self.output.mkdir(parents=True, exist_ok=True)
        self.ledger_path.parent.mkdir(parents=True, exist_ok=True)
        lock = self.ledger_path.with_suffix(".lock")
        with lock.open("x", encoding="utf-8") as handle:
            handle.write("Single writer for checkpoint and conservative cost ledger")
        try:
            return self._run_request(signature, modality, content, contract, cost, identity)
        finally:
            lock.unlink(missing_ok=True)

    def _run_request(self, signature, modality, content, contract, cost, identity):
        from google.genai import types
        import httpx
        checkpoint = self.output / f"{signature}.json"
        ledger_path = self.ledger_path
        ledger = json.loads(ledger_path.read_text(encoding="utf-8")) if ledger_path.exists() else {
            "reservedUsd": 0, "calls": 0, "pricingVersion": PRICING_VERSION}
        if ledger.get("pricingVersion") != PRICING_VERSION:
            raise ValueError("Ledger pricing version differs")
        if not isinstance(ledger.get("calls"), int) or ledger["calls"] < 0 \
                or not isinstance(ledger.get("reservedUsd"), (int, float)) \
                or not math.isfinite(ledger["reservedUsd"]) or ledger["reservedUsd"] < 0:
            raise ValueError("Invalid cost ledger")
        if checkpoint.exists():
            cached = json.loads(checkpoint.read_text(encoding="utf-8"))
            if cached.get("status") == "success" and cached.get("signature") == signature \
                    and cached.get("provider") == "gemini" and cached.get("model") == MODEL:
                normalize_embedding(cached["embedding"])
                return {**cached, "reused": True}
        record = {**(identity or {}), "signature": signature, "provider": "gemini", "model": MODEL,
                  "modelVersionSource": "requested model ID; immutable server revision unavailable",
                  "sdkVersion": importlib.metadata.version("google-genai"), "dimension": DIMENSION,
                  "contractVersion": contract, "modality": modality, "status": "pending", "embedding": None,
                  "normalizationVersion": GEMINI_EMBEDDING_NORMALIZATION_VERSION, "taskType": None,
                  "createdAt": datetime.now(timezone.utc).isoformat(), "reused": False,
                  "estimatedAttemptUsd": cost, "pricingVersion": PRICING_VERSION}
        if modality in ("query", "text"):
            record.update(instructionVersion=GEMINI_EMBEDDING_INSTRUCTION_VERSION,
                          generationVersion=GEMINI_EMBEDDING_GENERATION_VERSION, schemaVersion=contract)
        print(f"Gemini {modality} estimated attempt USD {cost:.8f}; cumulative ceiling USD {self.max_cost_usd:.8f}", flush=True)
        client = None
        try:
            for attempt in range(MAX_ATTEMPTS):
                next_total = math.ceil((ledger["reservedUsd"] + cost) * 1e8) / 1e8
                if next_total > self.max_cost_usd or next_total > 30 or ledger["calls"] >= self.max_calls:
                    record.update(status="blocked_budget", error={"code": "BUDGET_EXCEEDED"})
                    write_json(checkpoint, record)
                    raise PermissionError("Cost or call ceiling exceeded")
                if client is None:
                    try:
                        client = self.client_factory(self.timeout_ms)
                    except Exception:
                        raise EmbeddingRequestError("Gemini client initialization failed; details redacted") from None
                # Reserve before every attempt. Timeouts and unknown billing are never refunded.
                ledger.update(reservedUsd=next_total, calls=ledger["calls"] + 1)
                write_json(ledger_path, ledger)
                record.update(attempts=attempt + 1, reservedTotalUsd=next_total)
                write_json(checkpoint, record)
                try:
                    response = client.models.embed_content(model=MODEL, contents=content,
                        config=types.EmbedContentConfig(output_dimensionality=DIMENSION, auto_truncate=False,
                            http_options=types.HttpOptions(timeout=self.timeout_ms,
                                retry_options=types.HttpRetryOptions(attempts=1))))
                    embeddings = list(response.embeddings or [])
                    if len(embeddings) != 1:
                        raise ValueError("Expected exactly one embedding")
                    vector = normalize_embedding(embeddings[0].values)
                    record.update(status="success", embedding=vector, error=None,
                                  completedAt=datetime.now(timezone.utc).isoformat())
                    characters = getattr(getattr(response, "metadata", None), "billable_character_count", None)
                    if isinstance(characters, int) and characters >= 0:
                        record["billableCharacterCount"] = characters
                    write_json(checkpoint, record)
                    return record
                except Exception as error:
                    code = getattr(error, "code", None)
                    safe_code = code if isinstance(code, int) else None
                    retryable = safe_code in (408, 429, 500, 502, 503, 504) or isinstance(error, (TimeoutError, httpx.TransportError))
                    record.update(status="failed", error={"code": safe_code, "retryable": retryable})
                    write_json(checkpoint, record)
                    if not retryable or attempt == MAX_ATTEMPTS - 1:
                        raise EmbeddingRequestError(f"Gemini embedding request failed (HTTP {safe_code})") from None
                    self.sleep(2 ** attempt)
        finally:
            if client is not None:
                try:
                    client.close()
                except Exception:
                    raise EmbeddingRequestError("Gemini client close failed; details redacted") from None
