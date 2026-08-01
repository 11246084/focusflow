"""Offline fixture comparison; this does not measure real Whisper audio accuracy."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from normalize_transcript import TermNormalizer, load_term_dictionary
from stt_accuracy import character_error_rate, false_replacement_count, term_accuracy, word_error_rate
from utils import TranscriptSegment


def evaluate() -> dict:
    fixtures = ROOT / "tests" / "fixtures" / "stt_accuracy"
    cases = json.loads((fixtures / "cases.json").read_text(encoding="utf-8"))
    normalizer = TermNormalizer(load_term_dictionary(fixtures / "terminology.json"), 85)
    results = {}
    for name, normalize in (("baseline", False), ("prompt_only", False), ("prompt_plus_safe_terminology", True)):
        rows = []
        for case in cases:
            output = case["raw"]
            if normalize:
                output = normalizer.normalize_segment(TranscriptSegment(case["id"], 0, 1, output)).text
            rows.append({
                "cer": character_error_rate(case["reference"], output),
                "wer": word_error_rate(case["reference"], output),
                "term_accuracy": term_accuracy(case["terms"], output),
                "false_replacement": false_replacement_count(case["reference"], case["raw"], output),
                "corrected": int(output != case["raw"]),
            })
        results[name] = {key: round(sum(row[key] for row in rows) / len(rows), 4) for key in ("cer", "wer", "term_accuracy")}
        results[name]["false_replacement_count"] = sum(row["false_replacement"] for row in rows)
        results[name]["corrected_count"] = sum(row["corrected"] for row in rows)
    results["note"] = "Prompt-only equals baseline because fixtures contain text, not audio."
    return results


if __name__ == "__main__":
    print(json.dumps(evaluate(), ensure_ascii=False, indent=2))
