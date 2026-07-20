"""Deterministic offline comparison for segment-overlap Chunk strategies."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from types import SimpleNamespace


SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from chunking import build_chunks_for_transcript
from utils import TranscriptDocument, TranscriptSegment, VideoMetadata


FIXTURES = (
    (
        "auth",
        ["課程開始", "先看登入", "介紹帳號", "說明角色", "準備驗證", "權限檢查只有在", "使用者通過 JWT 驗證後才算完成", "接著授權", "讀取角色", "檢查範圍", "記錄事件", "完成流程"],
        "權限檢查只有在使用者通過 JWT 驗證後才算完成",
    ),
    (
        "retrieval",
        ["查詢流程", "建立索引", "準備問題", "計算向量", "搜尋候選", "系統找到相關片段之後", "還必須確認相似度門檻才能回答", "整理來源", "建立引用", "產生答案", "記錄結果", "結束查詢"],
        "系統找到相關片段之後還必須確認相似度門檻才能回答",
    ),
    (
        "timestamp",
        ["影片導覽", "第一章", "示範畫面", "操作按鈕", "記錄時間", "答案的開始時間是", "前一個 segment 的 start timestamp", "顯示引用", "建立跳轉", "播放影片", "確認位置", "完成示範"],
        "答案的開始時間是前一個 segment 的 start timestamp",
    ),
)


def _normalize(text: str) -> str:
    return re.sub(r"\s+", "", text).lower()


def _ngrams(text: str, size: int = 2) -> set[str]:
    normalized = _normalize(text)
    if len(normalized) < size:
        return {normalized} if normalized else set()
    return {normalized[index : index + size] for index in range(len(normalized) - size + 1)}


def _score(query: str, text: str) -> float:
    query_grams = _ngrams(query)
    text_grams = _ngrams(text)
    return len(query_grams & text_grams) / max(1, len(query_grams))


def _make_fixture(name: str, texts: list[str]):
    segments = [
        TranscriptSegment(
            segment_id=f"{name}_seg_{index:04d}",
            start_sec=float((index - 1) * 5),
            end_sec=float((index - 1) * 5 + 4),
            text=text,
        )
        for index, text in enumerate(texts, start=1)
    ]
    video = VideoMetadata(
        video_id=f"fixture_{name}",
        file_name="fixture.mp4",
        file_path="fixture.mp4",
        audio_path="fixture.wav",
        duration_sec=35.0,
        course_name=None,
        week=None,
        lesson=None,
    )
    return video, TranscriptDocument(video.video_id, segments), segments


def _source_ids(chunk, segments) -> set[str]:
    return {
        segment.segment_id
        for segment in segments
        if segment.start_sec >= chunk.start_sec and segment.end_sec <= chunk.end_sec
    }


def _pairwise_candidate_duplication(chunks) -> float:
    if len(chunks) < 2:
        return 0.0
    similarities = []
    for index, left in enumerate(chunks):
        left_grams = _ngrams(left.text)
        for right in chunks[index + 1 :]:
            right_grams = _ngrams(right.text)
            union = left_grams | right_grams
            similarities.append(len(left_grams & right_grams) / max(1, len(union)))
    return sum(similarities) / len(similarities)


def evaluate_strategy(overlap_segments: int) -> dict[str, int | float | str]:
    all_chunks = []
    unique_chars = 0
    occurrence_chars = 0
    top1_hits = 0
    top3_hits = 0
    boundary_hits = 0
    timestamp_hits = 0
    candidate_duplication_values = []

    for name, texts, question in FIXTURES:
        video, transcript, segments = _make_fixture(name, texts)
        config = SimpleNamespace(
            chunk_max_chars=220,
            chunk_max_segments=6,
            chunk_max_duration_sec=45.0,
            chunk_overlap_segments=overlap_segments,
        )
        chunks = build_chunks_for_transcript(video, transcript, config)
        all_chunks.extend(chunks)
        unique_chars += sum(len(segment.text) for segment in segments)
        segment_by_id = {segment.segment_id: segment for segment in segments}
        for chunk in chunks:
            occurrence_chars += sum(
                len(segment_by_id[segment_id].text)
                for segment_id in _source_ids(chunk, segments)
            )
        candidate_duplication_values.append(_pairwise_candidate_duplication(chunks))
        expected_ids = {segments[5].segment_id, segments[6].segment_id}
        ranked = sorted(chunks, key=lambda chunk: (-_score(question, chunk.text), chunk.chunk_id))
        top1_source_ids = _source_ids(ranked[0], segments)
        top1_hit = expected_ids.issubset(top1_source_ids)
        top3_hit = any(expected_ids.issubset(_source_ids(chunk, segments)) for chunk in ranked[:3])
        top1_hits += int(top1_hit)
        top3_hits += int(top3_hit)
        boundary_hits += int(top1_hit)
        timestamp_hits += int(
            ranked[0].start_sec <= segments[5].start_sec
            and ranked[0].end_sec >= segments[6].end_sec
        )

    total_chars = sum(len(chunk.text) for chunk in all_chunks)
    duplicated_chars = max(0, occurrence_chars - unique_chars)
    case_count = len(FIXTURES)
    return {
        "strategy": f"segment_overlap_{overlap_segments}",
        "chunk_count": len(all_chunks),
        "total_chars": total_chars,
        "duplicated_chars": duplicated_chars,
        "duplicate_ratio": round(duplicated_chars / max(1, occurrence_chars), 4),
        "top1_hit": f"{top1_hits}/{case_count}",
        "top3_hit": f"{top3_hits}/{case_count}",
        "boundary_question_hit": f"{boundary_hits}/{case_count}",
        "timestamp_usability": f"{timestamp_hits}/{case_count}",
        "candidate_duplication": round(
            sum(candidate_duplication_values) / max(1, len(candidate_duplication_values)),
            4,
        ),
    }


def main() -> int:
    results = [evaluate_strategy(overlap) for overlap in (0, 1, 2)]
    baseline_chunks = int(results[0]["chunk_count"])
    baseline_chars = int(results[0]["total_chars"])
    for result in results:
        result["chunk_increase"] = round(int(result["chunk_count"]) / baseline_chunks - 1, 4)
        result["text_increase"] = round(int(result["total_chars"]) / baseline_chars - 1, 4)
        result["estimated_embedding_input_increase"] = result["text_increase"]
    print(json.dumps({"offline_estimate": True, "results": results}, ensure_ascii=False, indent=2))
    print("Whisper cost is unchanged; Embedding, MongoDB, and Retrieval work may grow with Chunk count and text volume.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
