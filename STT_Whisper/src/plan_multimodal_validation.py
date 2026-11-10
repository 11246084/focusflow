"""Prepare a three-chunk validation plan locally, without any model or database call."""

import argparse
import json
from pathlib import Path

from gemini_multimodal_adapter import MAX_ATTEMPTS, estimate_cost
from segment_media_embedding import normalize_chunk, prepare_chunks, probe_duration, sample_window, write_json
from utils import resolve_ffmpeg_binary

COURSE_ID = "6a6da68456dd124511ec5196"
SOURCES = [
    ("run_20260801_155559", "6a6da68e56dd124511ec51b4", "1785570957608-aiA10_1140119_1.mp4"),
    ("run_20260801_155603", "6a6da69256dd124511ec51d5", "1785570961660-aiA10_1140119_4.mp4"),
]


def load_chunks(file: Path, video_id: str) -> list[dict]:
    rows = []
    if file.stat().st_size > 100 * 1024 * 1024:
        raise ValueError("Local artifact exceeds read limit")
    with file.open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            if row.get("video_id") == video_id:
                rows.append(normalize_chunk({"courseId": COURSE_ID, **{key: row[key]
                    for key in ("video_id", "chunk_id", "start_sec", "end_sec", "text")}}))
    return sorted(rows, key=lambda row: row["startSec"])


def select_chunks(first: list[dict], second: list[dict]) -> list[list[dict]]:
    short = next(row for row in first if 0 < row["endSec"] - row["startSec"] < 8)
    normal = next(row for row in first if 8 <= row["endSec"] - row["startSec"] <= 60)
    alternate = [row for row in second if 8 <= row["endSec"] - row["startSec"] <= 60]
    return [[short, normal], [alternate[len(alternate) // 2]]]


def build_plan(root: Path, output: Path, *, prepare: bool = False) -> dict:
    groups = select_chunks(*[load_chunks(root / "STT_Whisper/data/outputs/runs" / run / "embeddings_text_gemini.jsonl", video_id)
                             for run, video_id, _ in SOURCES])
    output.mkdir(parents=True, exist_ok=True)
    selected = []
    media_cost = 0
    records = []
    for (_, video_id, filename), chunks in zip(SOURCES, groups):
        source = root / "backend/uploads" / filename
        duration = probe_duration(source, resolve_ffmpeg_binary())
        for chunk in chunks:
            window = sample_window(chunk, duration)
            if window is None:
                raise ValueError("Selected validation chunk exceeds media contract")
            seconds = window[1] - window[0]
            media_cost += estimate_cost("audio", seconds=seconds) + estimate_cost("visual", seconds=seconds)
            selected.append({"videoId": video_id, "chunkId": chunk["chunkId"], "startSec": chunk["startSec"],
                "endSec": chunk["endSec"], "sampleStartSec": window[0], "sampleEndSec": window[1]})
        if prepare:
            manifest = prepare_chunks(source, chunks, output / video_id, max_cost_usd=0)
            records.extend(manifest["records"])
    if any(record["status"] != "success" for record in records):
        raise ValueError("Local media preparation incomplete; inspect local manifests")
    base = media_cost + 6 * estimate_cost("query")  # Three queries and three stable documents.
    plan = {"selected": selected, "requestedModel": "gemini-embedding-2", "dimension": 3072,
        "preparedMedia": len(records), "paidApiCallsExecuted": 0, "databaseWrites": 0,
        "nextRoundCalls": {"queries": 3, "stableDocuments": 3, "audio": 3, "visual": 3, "total": 12},
        "estimatedFirstAttemptsUsd": round(base, 8), "reservedMaximumWithRetriesUsd": round(base * MAX_ATTEMPTS, 8),
        "maximumAttempts": 36, "suggestedApprovalCeilingUsd": 0.25,
        "comparison": "Keep preview originals unchanged; store stable query/document/media vectors locally and compare full cosine rankings using the same chunk identities. No 43-question evaluation.",
        "atlasImpact": "Zero writes or index changes. Real audio/visual Atlas search waits for separate index/data approval.",
        "visualCoverage": "Two source videos and three time ranges selected; inspect actual clips for distinct slide content before paid validation."}
    write_json(output / "plan.json", plan)
    return plan


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true", help="Cut real media locally and create mock vectors")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[2] / ".local-tools/phase2-validation")
    args = parser.parse_args()
    plan = build_plan(Path(__file__).resolve().parents[2], args.output, prepare=args.prepare)
    print(json.dumps(plan, ensure_ascii=False, indent=2))
