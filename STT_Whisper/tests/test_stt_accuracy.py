from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SRC = Path(__file__).resolve().parents[1] / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from config import PipelineConfig
from normalize_transcript import TermNormalizer, load_term_dictionary, normalize_transcripts
from stt_accuracy import (
    build_config_fingerprint,
    build_normalize_config_snapshot,
    build_stt_config_snapshot,
    character_error_rate,
    false_replacement_count,
    term_accuracy,
    transcript_diagnostics,
    word_error_rate,
)
from utils import TranscriptDocument, TranscriptSegment
from utils import VideoMetadata
from transcribe import transcribe_video


class STTAccuracyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / ".env").write_text("", encoding="utf-8")
        fixture = Path(__file__).parent / "fixtures" / "stt_accuracy"
        self.dictionary_path = fixture / "terminology.json"
        self.cases = json.loads((fixture / "cases.json").read_text(encoding="utf-8"))
        self.env = patch.dict(os.environ, {
            "STT_TERMINOLOGY_ENABLED": "true",
            "STT_TERMINOLOGY_PATH": str(self.dictionary_path),
            "STT_CORRECTION_AUDIT_ENABLED": "true",
        }, clear=False)
        self.env.start()
        self.config = PipelineConfig.from_env(self.root).with_overrides(
            correction_audit_output_path=self.root / "audit.jsonl",
            backup_existing_outputs=False,
        )
        self.normalizer = TermNormalizer(load_term_dictionary(self.dictionary_path), 85)

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def segment(self, text="使用 G P T 與 Jimini", start=1.0, end=2.0):
        return TranscriptSegment("v_seg_0001", start, end, text)

    def test_config_defaults_and_prompt(self):
        self.assertEqual(self.config.stt_task, "transcribe")
        self.assertEqual(self.config.stt_initial_prompt, "")
        self.assertTrue(self.config.stt_condition_on_previous_text)

    def test_invalid_task_and_missing_dictionary(self):
        with self.assertRaises(ValueError):
            self.config.with_overrides(stt_task="translate")
        with self.assertRaises(ValueError):
            self.config.with_overrides(stt_terminology_path=self.root / "missing.json")

    def test_malformed_dictionary(self):
        path = self.root / "bad.json"
        path.write_text('[{"canonical":"GPT","aliases":"bad"}]', encoding="utf-8")
        with self.assertRaises(ValueError):
            load_term_dictionary(path)

    def test_alias_collision_fails_fast(self):
        path = self.root / "collision.json"
        path.write_text('{"GPT":["G P T"],"Other":["gpt"]}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "alias collision"):
            load_term_dictionary(path)

    def test_longer_explicit_alias_wins_deterministically(self):
        normalizer = TermNormalizer({"ChatGPT": ["Chat G P T"], "GPT": ["G P T"]}, 85)
        self.assertEqual(normalizer.normalize_segment(self.segment("Chat G P T")).text, "ChatGPT")

    def test_safe_terms_and_mixed_language(self):
        result = self.normalizer.normalize_segment(self.segment())
        self.assertEqual(result.text, "使用 GPT 與 Gemini")
        self.assertEqual(len(result.corrections), 2)

    def test_all_fixture_terms_and_false_replacements(self):
        false_count = 0
        corrected = 0
        for case in self.cases:
            normalized = self.normalizer.normalize_segment(self.segment(case["raw"])).text
            corrected += normalized != case["raw"]
            false_count += false_replacement_count(case["reference"], case["raw"], normalized)
            self.assertEqual(normalized, case["reference"], case["id"])
            self.assertEqual(term_accuracy(case["terms"], normalized), 1.0)
        self.assertGreater(corrected, 0)
        self.assertEqual(false_count, 0)

    def test_word_boundary_and_no_fuzzy_replacement(self):
        self.assertEqual(self.normalizer.normalize_segment(self.segment("capitol geminified")).text, "capitol geminified")

    def test_deterministic_and_idempotent(self):
        first = self.normalizer.normalize_segment(self.segment("Chat G P T 與 A P I"))
        second = self.normalizer.normalize_segment(self.segment(first.text))
        self.assertEqual(first.text, second.text)
        self.assertEqual(second.corrections, [])

    def test_timestamp_segment_and_audit(self):
        doc = TranscriptDocument("v", [self.segment()])
        normalized = normalize_transcripts([doc], self.config)[0]
        self.assertEqual((normalized.segments[0].start_sec, normalized.segments[0].end_sec), (1.0, 2.0))
        self.assertEqual(len(normalized.segments), 1)
        audit = json.loads(self.config.correction_audit_output_path.read_text(encoding="utf-8").splitlines()[0])
        self.assertEqual(audit["original"], "使用 G P T 與 Jimini")
        self.assertEqual(audit["normalized"], "使用 GPT 與 Gemini")
        self.assertEqual(audit["correction_count"], 2)

    def test_audit_disabled_does_not_create_file(self):
        config = self.config.with_overrides(stt_correction_audit_enabled=False, correction_audit_output_path=self.root / "disabled.jsonl")
        normalize_transcripts([TranscriptDocument("v", [self.segment()])], config)
        self.assertFalse(config.correction_audit_output_path.exists())

    def test_fingerprints(self):
        stt = build_stt_config_snapshot(self.config)
        same = dict(reversed(list(stt.items())))
        self.assertEqual(build_config_fingerprint(stt), build_config_fingerprint(same))
        self.assertNotEqual(build_config_fingerprint(stt), build_config_fingerprint({**stt, "language": "zh"}))
        self.assertNotEqual(build_config_fingerprint(stt), build_config_fingerprint({**stt, "initial_prompt_fingerprint": "x"}))
        before = build_normalize_config_snapshot(self.config)
        changed = json.loads(self.dictionary_path.read_text(encoding="utf-8"))
        changed[0]["aliases"].append("gee pee tee")
        path = self.root / "changed.json"
        path.write_text(json.dumps(changed), encoding="utf-8")
        after = build_normalize_config_snapshot(self.config.with_overrides(stt_terminology_path=path))
        self.assertNotEqual(build_config_fingerprint(before), build_config_fingerprint(after))

    def test_metrics_and_diagnostics(self):
        self.assertEqual(character_error_rate("中文", "中英"), 0.5)
        self.assertEqual(word_error_rate("hello world", "hello there"), 0.5)
        doc = TranscriptDocument("v", [self.segment("GPT", 0, 1), self.segment("", 0.5, 0.4)])
        metrics = transcript_diagnostics([doc])
        self.assertEqual(metrics["segment_count"], 2)
        self.assertEqual(metrics["empty_segment_count"], 1)
        self.assertEqual(metrics["non_monotonic_timestamp_count"], 1)

    def test_transcribe_passes_prompt_language_and_decode_settings(self):
        class Info:
            language = "zh"
            language_probability = 0.99
        class Segment:
            start, end, text = 0.0, 1.0, " 測試 GPT "
        class Model:
            def __init__(self): self.kwargs = None
            def transcribe(self, path, **kwargs):
                self.kwargs = kwargs
                return iter([Segment()]), Info()
        model = Model()
        config = self.config.with_overrides(
            whisper_language="zh",
            stt_initial_prompt="GPT, Gemini",
            transcript_cache_dir=self.root / "cache",
        )
        video = VideoMetadata("v", "v.mp4", "v.mp4", "v.wav", 1.0, None, None, None)
        document = transcribe_video(video, model, config)
        self.assertEqual(document.segments[0].text, "測試 GPT")
        self.assertEqual(model.kwargs["language"], "zh")
        self.assertEqual(model.kwargs["initial_prompt"], "GPT, Gemini")
        self.assertEqual(model.kwargs["task"], "transcribe")
        self.assertTrue(model.kwargs["condition_on_previous_text"])


if __name__ == "__main__":
    unittest.main()
