"""Deterministic Level-1 parent chunks derived from existing leaf chunks."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

from utils import ChunkRecord, load_jsonl_file, write_jsonl_file


HIERARCHY_LEVEL = 1
DOCUMENT_TYPE = "parent_chunk"
TEXT_JOINER = "\n"


class HierarchyArtifactError(ValueError):
    """Raised when a parent artifact cannot be safely reused."""


@dataclass(frozen=True, slots=True)
class ParentChunkRecord:
    parent_id: str
    video_id: str
    hierarchy_level: int
    document_type: str
    start_sec: float
    end_sec: float
    text: str
    child_chunk_ids: list[str]
    child_count: int
    order: int
    course_name: str | None
    week: str | None
    lesson: str | None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def build_parent_chunks(
    leaf_chunks: Iterable[ChunkRecord],
    parent_leaf_count: int,
    parent_overlap_leaves: int,
) -> list[ParentChunkRecord]:
    leaves_by_video: dict[str, list[ChunkRecord]] = {}
    for leaf in leaf_chunks:
        if not leaf.chunk_id or not leaf.video_id or not leaf.text:
            raise ValueError("Leaf chunks require non-empty chunk_id, video_id, and text.")
        if leaf.start_sec > leaf.end_sec:
            raise ValueError(f"Leaf chunk has an invalid timestamp range: {leaf.chunk_id}")
        leaves_by_video.setdefault(leaf.video_id, []).append(leaf)

    step = parent_leaf_count - parent_overlap_leaves
    parents: list[ParentChunkRecord] = []
    for video_id, video_leaves in leaves_by_video.items():
        for index, start in enumerate(range(0, len(video_leaves), step), start=1):
            children = video_leaves[start : start + parent_leaf_count]
            if not children:
                continue
            if start > 0 and len(children) <= parent_overlap_leaves:
                break
            if any(
                current.start_sec < previous.start_sec or current.end_sec < previous.end_sec
                for previous, current in zip(children, children[1:])
            ):
                raise ValueError(f"Leaf timestamps are not non-decreasing for video: {video_id}")
            parents.append(
                ParentChunkRecord(
                    parent_id=f"{video_id}_parent_{index:04d}",
                    video_id=video_id,
                    hierarchy_level=HIERARCHY_LEVEL,
                    document_type=DOCUMENT_TYPE,
                    start_sec=children[0].start_sec,
                    end_sec=children[-1].end_sec,
                    text=TEXT_JOINER.join(child.text for child in children),
                    child_chunk_ids=[child.chunk_id for child in children],
                    child_count=len(children),
                    order=index,
                    course_name=children[0].course_name,
                    week=children[0].week,
                    lesson=children[0].lesson,
                )
            )
    return parents


def build_child_to_parent_index(
    parents: Iterable[ParentChunkRecord],
) -> dict[str, list[str]]:
    index: dict[str, list[str]] = {}
    for parent in parents:
        for child_id in parent.child_chunk_ids:
            index.setdefault(child_id, []).append(parent.parent_id)
    return index


def write_parent_chunks(path: Path, parents: Iterable[ParentChunkRecord]) -> Path:
    write_jsonl_file(path, (parent.to_dict() for parent in parents), backup_existing=False)
    return path


def validate_parent_artifact(
    path: Path,
    leaf_chunks: list[ChunkRecord],
) -> list[ParentChunkRecord]:
    if not path.exists() or not path.is_file():
        raise HierarchyArtifactError(f"Parent chunk artifact is missing: {path}")
    try:
        rows = load_jsonl_file(path)
    except (OSError, ValueError, TypeError) as exc:
        raise HierarchyArtifactError(f"Parent chunk artifact is invalid JSONL: {path}") from exc

    leaf_by_id = {leaf.chunk_id: leaf for leaf in leaf_chunks}
    leaf_positions = {leaf.chunk_id: index for index, leaf in enumerate(leaf_chunks)}
    seen_ids: set[str] = set()
    expected_orders: dict[str, int] = {}
    parents: list[ParentChunkRecord] = []
    required = {field.name for field in ParentChunkRecord.__dataclass_fields__.values()}

    for row in rows:
        if not isinstance(row, dict) or not required.issubset(row):
            raise HierarchyArtifactError("Parent chunk record is missing required fields.")
        try:
            parent = ParentChunkRecord(**{key: row[key] for key in required})
        except (TypeError, ValueError) as exc:
            raise HierarchyArtifactError("Parent chunk record has invalid field types.") from exc
        if not parent.parent_id or parent.parent_id in seen_ids:
            raise HierarchyArtifactError("Parent IDs must be non-empty and unique.")
        seen_ids.add(parent.parent_id)
        if not parent.video_id:
            raise HierarchyArtifactError("Parent video_id is required.")
        if parent.hierarchy_level != HIERARCHY_LEVEL or parent.document_type != DOCUMENT_TYPE:
            raise HierarchyArtifactError("Parent hierarchy_level or document_type is invalid.")
        if not isinstance(parent.child_chunk_ids, list) or not parent.child_chunk_ids:
            raise HierarchyArtifactError("Parent child_chunk_ids must be a non-empty list.")
        if parent.child_count != len(parent.child_chunk_ids):
            raise HierarchyArtifactError("Parent child_count does not match child_chunk_ids.")
        try:
            children = [leaf_by_id[child_id] for child_id in parent.child_chunk_ids]
        except KeyError as exc:
            raise HierarchyArtifactError(f"Parent references an unknown leaf chunk: {exc.args[0]}") from exc
        if any(child.video_id != parent.video_id for child in children):
            raise HierarchyArtifactError("Parent references a leaf from another video.")
        positions = [leaf_positions[child.chunk_id] for child in children]
        if positions != sorted(positions):
            raise HierarchyArtifactError("Parent child order differs from leaf input order.")
        expected_order = expected_orders.get(parent.video_id, 1)
        if parent.order != expected_order:
            raise HierarchyArtifactError("Parent order must be consecutive and 1-based per video.")
        expected_orders[parent.video_id] = expected_order + 1
        if parent.start_sec != children[0].start_sec or parent.end_sec != children[-1].end_sec:
            raise HierarchyArtifactError("Parent timestamps do not match first and last children.")
        if parent.start_sec > parent.end_sec:
            raise HierarchyArtifactError("Parent timestamp range is invalid.")
        if not parent.text or parent.text != TEXT_JOINER.join(child.text for child in children):
            raise HierarchyArtifactError("Parent text does not match the canonical newline joiner.")
        parents.append(parent)
    return parents
