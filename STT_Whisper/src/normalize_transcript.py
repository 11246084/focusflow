"""Transcript post-processing for technical term normalization."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path

from rapidfuzz import fuzz, process

from config import PipelineConfig
from utils import CorrectionRecord, TranscriptDocument, TranscriptSegment, load_json_file, normalize_text, write_json_file, write_jsonl_file


logger = logging.getLogger(__name__)

# 正則表達式模式：匹配術語邊界（避免部分匹配）
ASCII_TERM_BOUNDARY = r"(?<![A-Za-z0-9]){pattern}(?![A-Za-z0-9])"
# 匹配英文跨度的正則表達式：用於模糊匹配候選詞
ENGLISH_SPAN_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9]*(?:[\s\-_/]+[A-Za-z0-9]+){0,4}")


@dataclass(slots=True)
class ExactRule:
    """A compiled rule that maps one known variant to its canonical term."""

    alias: str
    canonical: str
    pattern: re.Pattern[str]


def _normalize_term_key(text: str) -> str:
    """Normalize text for term matching and similarity comparison."""
    # 移除所有非字母數字字符，轉為小寫，用於術語匹配和相似度比較
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def _build_alias_pattern(alias: str) -> re.Pattern[str]:
    """Build a case-insensitive regex that tolerates whitespace variants."""
    # 將別名分割為詞彙
    alias_tokens = alias.split()
    # 為每個詞彙添加可選空白，並進行正則轉義
    alias_pattern = r"\s*".join(re.escape(token) for token in alias_tokens)
    # 使用術語邊界模式創建不區分大小寫的正則表達式
    return re.compile(ASCII_TERM_BOUNDARY.format(pattern=alias_pattern), flags=re.IGNORECASE)


def load_term_dictionary(term_dictionary_path: Path) -> dict[str, list[str]]:
    """Load the external term dictionary JSON file."""
    # 檢查術語字典文件是否存在
    if not term_dictionary_path.exists():
        raise FileNotFoundError(
            f"Term dictionary was not found at {term_dictionary_path}. "
            "Create data/term_dictionary.json before running normalization."
        )

    # 加載 JSON 文件內容
    payload = load_json_file(term_dictionary_path)
    if isinstance(payload, list):
        converted: dict[str, list[str]] = {}
        for rule in payload:
            if not isinstance(rule, dict) or not isinstance(rule.get("canonical"), str):
                raise ValueError("Each terminology rule must contain a canonical string.")
            aliases = rule.get("aliases")
            if not isinstance(aliases, list) or not all(isinstance(alias, str) for alias in aliases):
                raise ValueError("Each terminology rule must contain a string aliases list.")
            if rule.get("case_sensitive", False):
                raise ValueError("case_sensitive=true is not supported by safe_terminology_v1.")
            if rule.get("word_boundary", True) is not True:
                raise ValueError("word_boundary=false is not allowed by safe_terminology_v1.")
            converted[rule["canonical"]] = aliases
        payload = converted
    # 驗證根對象是字典
    if not isinstance(payload, dict):
        raise ValueError("Term dictionary must be a JSON object of canonical term -> alias list.")

    # 初始化術語字典
    term_dictionary: dict[str, list[str]] = {}
    alias_owners: dict[str, str] = {}
    # 遍歷每個規範術語和其別名列表
    for canonical, aliases in payload.items():
        # 驗證規範術語是字符串
        if not isinstance(canonical, str):
            raise ValueError("Each canonical term in the dictionary must be a string.")
        # 驗證別名是字符串列表
        if not isinstance(aliases, list) or not all(isinstance(alias, str) for alias in aliases):
            raise ValueError(f"Aliases for '{canonical}' must be a list of strings.")
        for alias in aliases:
            alias_key = _normalize_term_key(alias)
            owner = alias_owners.get(alias_key)
            if alias_key and owner is not None and owner != canonical:
                raise ValueError(f"Terminology alias collision: '{alias}' belongs to both '{owner}' and '{canonical}'.")
            if alias_key:
                alias_owners[alias_key] = canonical
        term_dictionary[canonical] = aliases
    return term_dictionary


class TermNormalizer:
    """Applies exact and fuzzy normalization for technical terms."""

    def __init__(self, term_dictionary: dict[str, list[str]], fuzzy_threshold: int) -> None:
        """Prepare exact replacement rules and fuzzy lookup tables."""
        # 存儲術語字典
        self.term_dictionary = term_dictionary
        # 設置模糊匹配閾值
        self.fuzzy_threshold = fuzzy_threshold
        # 構建精確匹配規則
        self.exact_rules = self._build_exact_rules(term_dictionary)
        # 構建術語查找表
        self.term_lookup = self._build_term_lookup(term_dictionary)
        # 獲取查找表的鍵列表，用於模糊匹配
        self.choice_keys = list(self.term_lookup.keys())

    @staticmethod
    def _build_exact_rules(term_dictionary: dict[str, list[str]]) -> list[ExactRule]:
        """Compile regex rules for all explicit aliases."""
        # 初始化規則列表
        rules: list[ExactRule] = []
        # 為每個規範術語的每個別名創建規則
        for canonical, aliases in term_dictionary.items():
            for alias in aliases:
                rules.append(
                    ExactRule(
                        alias=alias,
                        canonical=canonical,
                        pattern=_build_alias_pattern(alias),
                    )
                )
        # 按別名長度降序排序，確保長匹配優先
        return sorted(rules, key=lambda rule: len(rule.alias), reverse=True)

    @staticmethod
    def _build_term_lookup(term_dictionary: dict[str, list[str]]) -> dict[str, tuple[str, str]]:
        """Map normalized canonical/alias keys back to their canonical term."""
        # 初始化查找表
        lookup: dict[str, tuple[str, str]] = {}
        # 為每個規範術語和其別名創建映射
        for canonical, aliases in term_dictionary.items():
            # 規範化規範術語鍵
            canonical_key = _normalize_term_key(canonical)
            if canonical_key:
                lookup[canonical_key] = (canonical, canonical)
            # 為每個別名創建映射
            for alias in aliases:
                alias_key = _normalize_term_key(alias)
                if alias_key:
                    lookup[alias_key] = (canonical, alias)
        return lookup

    def _apply_exact_rules(self, text: str, corrections: list[CorrectionRecord]) -> str:
        """Replace known alias variants with their canonical form."""
        # 初始化標準化文本
        normalized_text = text

        # 應用每個精確規則
        for rule in self.exact_rules:
            def replace_match(match: re.Match[str]) -> str:
                # 獲取匹配的文本
                matched_text = match.group(0)
                # 如果匹配文本已經是規範形式，保持不變
                if matched_text == rule.canonical:
                    return matched_text
                # 記錄更正記錄
                corrections.append(
                    CorrectionRecord(
                        from_text=matched_text,
                        to_text=rule.canonical,
                        method=f"terminology:{rule.canonical}",
                    )
                )
                # 返回規範術語
                return rule.canonical

            # 應用正則替換
            normalized_text = rule.pattern.sub(replace_match, normalized_text)

        return normalized_text

    def _fuzzy_replace_match(self, match: re.Match[str], corrections: list[CorrectionRecord]) -> str:
        """Apply fuzzy correction to a single English-like text span when it is safe."""
        # 獲取候選文本
        candidate_text = match.group(0)
        # 規範化候選鍵
        candidate_key = _normalize_term_key(candidate_text)

        # 跳過短跨度，避免過度糾正常見詞如 "API"
        if len(candidate_key) < 5:
            return candidate_text

        # 如果已經是已知規範或別名形式，保持不變
        if candidate_key in self.term_lookup:
            return candidate_text

        # 使用模糊匹配查找最佳匹配
        best_match = process.extractOne(candidate_key, self.choice_keys, scorer=fuzz.ratio)
        if best_match is None:
            return candidate_text

        # 解包匹配結果
        matched_key, score, _ = best_match
        # 如果分數低於閾值，保持不變
        if score < self.fuzzy_threshold:
            return candidate_text

        # 獲取規範術語和匹配變體
        canonical, matched_variant = self.term_lookup[matched_key]
        # 如果候選文本已經是規範形式，保持不變
        if candidate_text == canonical:
            return candidate_text

        # 記錄更正記錄
        corrections.append(
            CorrectionRecord(
                from_text=candidate_text,
                to_text=canonical,
                method="fuzzy" if matched_variant == canonical else "dictionary+fuzzy",
            )
        )
        # 返回規範術語
        return canonical

    def _apply_fuzzy_rules(self, text: str, corrections: list[CorrectionRecord]) -> str:
        """Replace likely misspellings of technical terms using rapidfuzz."""
        # 使用英文跨度模式應用模糊替換
        return ENGLISH_SPAN_PATTERN.sub(lambda match: self._fuzzy_replace_match(match, corrections), text)

    def normalize_segment(self, segment: TranscriptSegment) -> TranscriptSegment:
        """Normalize a transcript segment and keep correction history."""
        # 獲取原始文本
        original_text = segment.text
        # 初始化更正記錄列表
        corrections: list[CorrectionRecord] = []
        # 應用精確規則
        corrected_text = self._apply_exact_rules(original_text, corrections)
        # 應用模糊規則
        # Sprint 1 intentionally disables unconstrained fuzzy replacement. Only explicit,
        # boundary-aware aliases are allowed to modify transcript text.
        # 應用通用文本標準化
        corrected_text = normalize_text(corrected_text)

        # 返回標準化的段落
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
    normalizer = None
    if config.stt_terminology_enabled:
        term_dictionary = load_term_dictionary(config.stt_terminology_path)
        normalizer = TermNormalizer(term_dictionary=term_dictionary, fuzzy_threshold=config.fuzzy_threshold)

    # 初始化標準化文檔列表
    normalized_documents: list[TranscriptDocument] = []
    # 初始化總更正計數
    total_corrections = 0

    # 處理每個文檔
    for document in transcripts:
        # 標準化所有段落
        normalized_segments = [
            normalizer.normalize_segment(segment)
            if normalizer is not None
            else TranscriptSegment(
                segment_id=segment.segment_id,
                start_sec=segment.start_sec,
                end_sec=segment.end_sec,
                text=segment.text,
                original_text=segment.text,
                corrections=[],
            )
            for segment in document.segments
        ]
        # 累計更正數量
        total_corrections += sum(len(segment.corrections) for segment in normalized_segments)
        # 添加標準化文檔
        normalized_documents.append(TranscriptDocument(video_id=document.video_id, segments=normalized_segments))

    # 記錄處理統計
    logger.info(
        "Normalized %s transcript documents with %s corrections",
        len(normalized_documents),
        total_corrections,
    )
    if config.stt_correction_audit_enabled:
        audit_records = [
            {
                "video_id": document.video_id,
                "segment_id": segment.segment_id,
                "start_sec": segment.start_sec,
                "end_sec": segment.end_sec,
                "original": segment.original_text,
                "normalized": segment.text,
                "applied_rules": [correction.method for correction in segment.corrections],
                "correction_count": len(segment.corrections),
            }
            for document in normalized_documents
            for segment in document.segments
            if segment.corrections
        ]
        write_jsonl_file(
            config.correction_audit_output_path,
            audit_records,
            backup_existing=config.backup_existing_outputs,
        )
    return normalized_documents


def normalize_transcript_file(
    transcript_path: Path,
    output_path: Path,
    config: PipelineConfig,
) -> list[TranscriptDocument]:
    """Load transcripts.json, normalize it, and write transcripts_normalized.json."""
    # 加載轉錄文件
    transcript_payload = load_json_file(transcript_path)
    # 轉換為文檔對象
    transcript_documents = [TranscriptDocument.from_dict(item) for item in transcript_payload]
    # 標準化文檔
    normalized_documents = normalize_transcripts(transcript_documents, config)
    # 寫入標準化輸出文件
    write_json_file(
        output_path,
        [document.to_dict(include_normalization=True) for document in normalized_documents],
        backup_existing=config.backup_existing_outputs,
    )
    # 記錄導出完成
    logger.info("Exported %s", output_path)
    return normalized_documents
