"""Canonical Gemini stable text-search embedding contract for the pipeline."""

from __future__ import annotations


GEMINI_EMBEDDING_MODEL = "gemini-embedding-2"
GEMINI_EMBEDDING_DIMENSION = 3072
GEMINI_EMBEDDING_TASK_TYPE = None
GEMINI_EMBEDDING_INSTRUCTION_VERSION = "gemini_embedding_2_search_v1"
GEMINI_EMBEDDING_GENERATION_VERSION = "text_search_generation_v1"
GEMINI_EMBEDDING_NORMALIZATION_VERSION = "unit_l2_v1"
GEMINI_EMBEDDING_CONTRACT_VERSION = "gemini_embedding_2_text_v1"
PARENT_DOCUMENT_ROLE = "document"
PARENT_DOCUMENT_INSTRUCTION_TEMPLATE = "task: search result | document: {content}"


def build_parent_document_text(content: str) -> str:
    """Apply the versioned searchable-document role without preview task types."""
    return PARENT_DOCUMENT_INSTRUCTION_TEMPLATE.format(content=str(content or "").strip())


def validate_stable_embedding_settings(model: str, dimension: int) -> None:
    if str(model or "").strip() != GEMINI_EMBEDDING_MODEL:
        raise ValueError(
            "GEMINI_EMBEDDING_MODEL_NAME must be the stable gemini-embedding-2 model."
        )
    if int(dimension) != GEMINI_EMBEDDING_DIMENSION:
        raise ValueError("GEMINI_EMBEDDING_OUTPUT_DIM must be 3072 for the stable contract.")
