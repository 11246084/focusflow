"""Transcript post-processing for technical term normalization."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path

from rapidfuzz import fuzz, process

from config import PipelineConfig
from utils import CorrectionRecord, TranscriptDocument, TranscriptSegment, load_json_file, normalize_text, write_json_file


logger = logging.getLogger(__name__)

ASCII_TERM_BOUNDARY = r"(?<![A-Za-z0-9]){pattern}(?![A-Za-z0-9])"
ENGLISH_SPAN_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9]*(?:[\s\-_/]+[A-Za-z0-9]+){0,4}")


@dataclass(slots=True)
class ExactRule:
    """A compiled rule that maps one known variant to its canonical term."""

    alias: str
    canonical: str
    pattern: re.Pattern[str]


def _normalize_term_key(text: str) -> str:
    """Normalize text for term matching and similarity comparison."""
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def _build_alias_pattern(alias: str) -> re.Pattern[str]:
    """Build a case-insensitive regex that tolerates whitespace variants."""
    alias_tokens = alias.split()
    alias_pattern = r"\s*".join(re.escape(token) for token in alias_tokens)
    return re.compile(ASCII_TERM_BOUNDARY.format(pattern=alias_pattern), flags=re.IGNORECASE)


def load_term_dictionary(term_dictionary_path: Path) -> dict[str, list[str]]:
    """Load the external term dictionary JSON file."""
    if not term_dictionary_path.exists():
        raise FileNotFoundError(
            f"Term dictionary was not found at {term_dictionary_path}. "
            "Create data/term_dictionary.json before running normalization."
        )

    payload = load_json_file(term_dictionary_path)
    if not isinstance(payload, dict):
        raise ValueError("Term dictionary must be a JSON object of canonical term -> alias list.")

    term_dictionary: dict[str, list[str]] = {}
    for canonical, aliases in payload.items():
        if not isinstance(canonical, str):
            raise ValueError("Each canonical term in the dictionary must be a string.")
        if not isinstance(aliases, list) or not all(isinstance(alias, str) for alias in aliases):
            raise ValueError(f"Aliases for '{canonical}' must be a list of strings.")
        term_dictionary[canonical] = aliases
    return term_dictionary


class TermNormalizer:
    """Applies exact and fuzzy normalization for technical terms."""

    def __init__(self, term_dictionary: dict[str, list[str]], fuzzy_threshold: int) -> None:
        """Prepare exact replacement rules and fuzzy lookup tables."""
        self.term_dictionary = term_dictionary
        self.fuzzy_threshold = fuzzy_threshold
        self.exact_rules = self._build_exact_rules(term_dictionary)
        self.term_lookup = self._build_term_lookup(term_dictionary)
        self.choice_keys = list(self.term_lookup.keys())

    @staticmethod
    def _build_exact_rules(term_dictionary: dict[str, list[str]]) -> list[ExactRule]:
        """Compile regex rules for all explicit aliases."""
        rules: list[ExactRule] = []
        for canonical, aliases in term_dictionary.items():
            for alias in aliases:
                rules.append(
                    ExactRule(
                        alias=alias,
                        canonical=canonical,
                        pattern=_build_alias_pattern(alias),
                    )
                )
        return sorted(rules, key=lambda rule: len(rule.alias), reverse=True)

    @staticmethod
    def _build_term_lookup(term_dictionary: dict[str, list[str]]) -> dict[str, tuple[str, str]]:
        """Map normalized canonical/alias keys back to their canonical term."""
        lookup: dict[str, tuple[str, str]] = {}
        for canonical, aliases in term_dictionary.items():
            canonical_key = _normalize_term_key(canonical)
            if canonical_key:
                lookup[canonical_key] = (canonical, canonical)
            for alias in aliases:
                alias_key = _normalize_term_key(alias)
                if alias_key:
                    lookup[alias_key] = (canonical, alias)
        return lookup

    def _apply_exact_rules(self, text: str, corrections: list[CorrectionRecord]) -> str:
        """Replace known alias variants with their canonical form."""
        normalized_text = text

        for rule in self.exact_rules:
            def replace_match(match: re.Match[str]) -> str:
                matched_text = match.group(0)
                if matched_text == rule.canonical:
                    return matched_text
                corrections.append(
                    CorrectionRecord(
                        from_text=matched_text,
                        to_text=rule.canonical,
                        method="dictionary",
                    )
                )
                return rule.canonical

            normalized_text = rule.pattern.sub(replace_match, normalized_text)

        return normalized_text

    def _fuzzy_replace_match(self, match: re.Match[str], corrections: list[CorrectionRecord]) -> str:
        """Apply fuzzy correction to a single English-like text span when it is safe."""
        candidate_text = match.group(0)
        candidate_key = _normalize_term_key(candidate_text)

        # Skip short spans to avoid over-correcting common words such as "API".
        if len(candidate_key) < 5:
            return candidate_text

        # Leave already-known canonical or alias forms untouched.
        if candidate_key in self.term_lookup:
            return candidate_text

        best_match = process.extractOne(candidate_key, self.choice_keys, scorer=fuzz.ratio)
        if best_match is None:
            return candidate_text

        matched_key, score, _ = best_match
        if score < self.fuzzy_threshold:
            return candidate_text

        canonical, matched_variant = self.term_lookup[matched_key]
        if candidate_text == canonical:
            return candidate_text

        corrections.append(
            CorrectionRecord(
                from_text=candidate_text,
                to_text=canonical,
                method="fuzzy" if matched_variant == canonical else "dictionary+fuzzy",
            )
        )
        return canonical

    def _apply_fuzzy_rules(self, text: str, corrections: list[CorrectionRecord]) -> str:
        """Replace likely misspellings of technical terms using rapidfuzz."""
        return ENGLISH_SPAN_PATTERN.sub(lambda match: self._fuzzy_replace_match(match, corrections), text)

    def normalize_segment(self, segment: TranscriptSegment) -> TranscriptSegment:
        """Normalize a transcript segment and keep correction history."""
        original_text = segment.text
        corrections: list[CorrectionRecord] = []
        corrected_text = self._apply_exact_rules(original_text, corrections)
        corrected_text = self._apply_fuzzy_rules(corrected_text, corrections)
        corrected_text = normalize_text(corrected_text)

        return TranscriptSegment(
            segment_id=segment.segment_id,
            start_sec=segment.start_sec,
            end_sec=segment.end_sec,
            text=corrected_text,
            original_text=original_text,
            corrections=corrections,
        )


def normalize_transcripts(
    transcripts: list[TranscriptDocument],
    config: PipelineConfig,
) -> list[TranscriptDocument]:
    """Normalize transcript documents in memory for downstream chunking."""
    term_dictionary = load_term_dictionary(config.term_dictionary_path)
    normalizer = TermNormalizer(term_dictionary=term_dictionary, fuzzy_threshold=config.fuzzy_threshold)

    normalized_documents: list[TranscriptDocument] = []
    total_corrections = 0

    for document in transcripts:
        normalized_segments = [normalizer.normalize_segment(segment) for segment in document.segments]
        total_corrections += sum(len(segment.corrections) for segment in normalized_segments)
        normalized_documents.append(TranscriptDocument(video_id=document.video_id, segments=normalized_segments))

    logger.info(
        "Normalized %s transcript documents with %s corrections",
        len(normalized_documents),
        total_corrections,
    )
    return normalized_documents


def normalize_transcript_file(
    transcript_path: Path,
    output_path: Path,
    config: PipelineConfig,
) -> list[TranscriptDocument]:
    """Load transcripts.json, normalize it, and write transcripts_normalized.json."""
    transcript_payload = load_json_file(transcript_path)
    transcript_documents = [TranscriptDocument.from_dict(item) for item in transcript_payload]
    normalized_documents = normalize_transcripts(transcript_documents, config)
    write_json_file(
        output_path,
        [document.to_dict(include_normalization=True) for document in normalized_documents],
        backup_existing=config.backup_existing_outputs,
    )
    logger.info("Exported %s", output_path)
    return normalized_documents
