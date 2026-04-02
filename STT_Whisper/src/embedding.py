"""Chunk embedding generation for multilingual semantic search."""

from __future__ import annotations

import logging
import os

from config import PipelineConfig
from utils import ChunkRecord, EmbeddingRecord


logger = logging.getLogger(__name__)


def _load_embedding_model(config: PipelineConfig):
    """Load the sentence-transformers model lazily."""
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:  # pragma: no cover - depends on local environment
        raise RuntimeError(
            "sentence-transformers is not installed. Run 'pip install -r requirements.txt' first."
        ) from exc

    logger.info(
        "Loading embedding model '%s' on device=%s",
        config.embedding_model_name,
        config.embedding_device,
    )
    try:
        return SentenceTransformer(config.embedding_model_name, device=config.embedding_device)
    except Exception as exc:
        from huggingface_hub import snapshot_download

        logger.warning(
            "Online model resolution failed for %s, retrying from local cache only: %s",
            config.embedding_model_name,
            exc,
        )
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        local_model_path = snapshot_download(config.embedding_model_name, local_files_only=True)
        return SentenceTransformer(
            local_model_path,
            device=config.embedding_device,
            local_files_only=True,
        )


def embed_chunks(chunks: list[ChunkRecord], config: PipelineConfig) -> list[EmbeddingRecord]:
    """Encode chunks into dense vectors and keep metadata aligned."""
    if not chunks:
        return []

    # Batch encoding is simple and keeps CPU/GPU utilization reasonable.
    model = _load_embedding_model(config)
    texts = [chunk.text for chunk in chunks]

    vectors = model.encode(
        texts,
        batch_size=config.embedding_batch_size,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=True,
    )

    embedding_records = [
        # Preserve the original chunk metadata in the vector export.
        EmbeddingRecord(
            chunk_id=chunk.chunk_id,
            video_id=chunk.video_id,
            start_sec=chunk.start_sec,
            end_sec=chunk.end_sec,
            text=chunk.text,
            embedding=vector.astype(float).tolist(),
        )
        for chunk, vector in zip(chunks, vectors, strict=True)
    ]

    logger.info("Generated embeddings for %s chunks", len(embedding_records))
    return embedding_records
