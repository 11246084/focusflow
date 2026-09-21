#!/usr/bin/env python3
"""Validate versioned PlantUML/Mermaid sources and their artifact chain.

This script checks repository contracts only. It does not parse UML semantics,
render diagrams, or inspect image readability; those remain separate review gates.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path


REQUIRED_HEADERS = (
    "ooad-phase",
    "chapter",
    "realizes",
    "source",
    "verified",
    "status",
    "implemented",
    "ai-assisted",
)
SOURCE_RE = re.compile(
    r"^(?P<id>圖\d+-\d+-\d+)-(?P<name>.+?)(?:-(?P<version>v\d+-\d+))?"
    r"\.(?P<extension>puml|mmd|mermaid)$",
    re.IGNORECASE,
)
IMAGE_RE = re.compile(
    r"^(?P<id>圖\d+-\d+-\d+)-(?P<name>.+?)(?:-(?P<version>v\d+-\d+))?\.(?:png|svg)$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Diagram:
    path: Path
    diagram_id: str
    name: str
    version: str | None
    extension: str
    title: str
    headers: dict[str, str]

    @property
    def stem(self) -> str:
        return self.path.stem


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="utf-8-sig")


def parse_diagram(path: Path, errors: list[str]) -> Diagram | None:
    match = SOURCE_RE.fullmatch(path.name)
    if not match:
        errors.append(
            f"{path}: filename must be 圖章-節-序-名稱-vX-x.puml or .mmd "
            "(version may be omitted only when --require-version is not used)"
        )
        return None

    text = read_text(path)
    headers = {
        key: value.strip()
        for key, value in re.findall(
            r"^(?:'|%%)\s*([\w-]+):\s*(.*?)\s*$", text, re.MULTILINE
        )
    }
    extension = match.group("extension").lower()
    if extension == "puml":
        title_match = re.search(r"^title\s+(.+?)\s*$", text, re.MULTILINE)
        title = title_match.group(1).strip() if title_match else ""
        if "@startuml" not in text or "@enduml" not in text:
            errors.append(f"{path}: missing @startuml or @enduml")
    else:
        title = parse_mermaid_title(text)
        if not re.search(
            r"^(?:sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|flowchart|graph)\b",
            text,
            re.MULTILINE,
        ):
            errors.append(f"{path}: missing a supported Mermaid diagram declaration")

    if not title:
        errors.append(f"{path}: missing display title")

    for key in REQUIRED_HEADERS:
        value = headers.get(key, "")
        if not value:
            errors.append(f"{path}: missing header '{key}'")
        elif any(token in value for token in ("<", ">", "YYYY-MM-DD")):
            errors.append(f"{path}: header '{key}' still contains a placeholder: {value}")

    return Diagram(
        path=path,
        diagram_id=match.group("id"),
        name=match.group("name"),
        version=match.group("version"),
        extension=extension,
        title=title,
        headers=headers,
    )


def parse_mermaid_title(text: str) -> str:
    """Read title from Mermaid YAML frontmatter at the start of the source."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return ""
    for line in lines[1:]:
        if line.strip() == "---":
            break
        match = re.match(r"^title:\s*(.+?)\s*$", line)
        if match:
            return match.group(1).strip().strip('"\'')
    return ""


def validate_sources(
    diagram_dir: Path, require_version: bool, errors: list[str]
) -> list[Diagram]:
    paths = sorted(
        path
        for path in diagram_dir.iterdir()
        if path.is_file() and path.suffix.lower() in {".puml", ".mmd", ".mermaid"}
    )
    if not paths:
        errors.append(f"{diagram_dir}: no .puml, .mmd, or .mermaid files found")
        return []

    diagrams: list[Diagram] = []
    seen_ids: dict[str, Path] = {}
    for path in paths:
        diagram = parse_diagram(path, errors)
        if diagram is None:
            continue
        diagrams.append(diagram)
        if require_version and not diagram.version:
            errors.append(f"{path}: version suffix is required")
        if diagram.title != diagram.name:
            errors.append(
                f"{path}: title '{diagram.title}' does not match display name '{diagram.name}'"
            )
        if diagram.diagram_id in seen_ids:
            errors.append(
                f"{path}: duplicate diagram id {diagram.diagram_id}; also in "
                f"{seen_ids[diagram.diagram_id]}"
            )
        else:
            seen_ids[diagram.diagram_id] = path
    return diagrams


def validate_images(
    diagrams: list[Diagram], image_dir: Path, errors: list[str]
) -> None:
    expected_stems = {diagram.stem for diagram in diagrams}
    ids = {diagram.diagram_id for diagram in diagrams}

    for diagram in diagrams:
        exports = [
            path
            for suffix in (".png", ".svg")
            if (path := image_dir / f"{diagram.stem}{suffix}").is_file()
        ]
        if not exports:
            errors.append(f"{diagram.path}: missing same-stem PNG or SVG in {image_dir}")

    for path in sorted(image_dir.iterdir() if image_dir.is_dir() else []):
        if not path.is_file():
            continue
        match = IMAGE_RE.fullmatch(path.name)
        if match and match.group("id") in ids and path.stem not in expected_stems:
            errors.append(
                f"{path}: orphan or stale export for an id owned by the selected diagram set"
            )


def validate_chapter(
    diagrams: list[Diagram], chapter_path: Path, errors: list[str]
) -> None:
    text = read_text(chapter_path)
    for diagram in diagrams:
        image_token = f"{diagram.stem}."
        caption_re = re.compile(
            rf"^{re.escape(diagram.diagram_id)}[ \t\u3000]+{re.escape(diagram.name)}\s*$",
            re.MULTILINE,
        )
        if image_token not in text:
            errors.append(f"{chapter_path}: missing image reference for {diagram.stem}")
        if not caption_re.search(text):
            errors.append(
                f"{chapter_path}: missing exact caption '{diagram.diagram_id} {diagram.name}'"
            )
        if text.count(diagram.diagram_id) < 2:
            errors.append(
                f"{chapter_path}: {diagram.diagram_id} appears fewer than twice; "
                "a body reference may be missing"
            )


def validate_toc(diagrams: list[Diagram], toc_path: Path, errors: list[str]) -> None:
    lines = read_text(toc_path).splitlines()
    for diagram in diagrams:
        matching = [line for line in lines if diagram.diagram_id in line]
        if len(matching) != 1:
            errors.append(
                f"{toc_path}: expected exactly one row for {diagram.diagram_id}, found {len(matching)}"
            )
            continue
        line = matching[0]
        if diagram.name not in line:
            errors.append(f"{toc_path}: row for {diagram.diagram_id} has a different name")
        if diagram.version and diagram.version not in line:
            errors.append(
                f"{toc_path}: row for {diagram.diagram_id} does not record {diagram.version}"
            )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--diagram-dir", type=Path, required=True)
    parser.add_argument("--image-dir", type=Path)
    parser.add_argument("--chapter", type=Path)
    parser.add_argument("--toc", type=Path)
    parser.add_argument("--require-version", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    errors: list[str] = []

    if not args.diagram_dir.is_dir():
        errors.append(f"{args.diagram_dir}: diagram directory does not exist")
        diagrams: list[Diagram] = []
    else:
        diagrams = validate_sources(args.diagram_dir, args.require_version, errors)

    if args.image_dir:
        if not args.image_dir.is_dir():
            errors.append(f"{args.image_dir}: image directory does not exist")
        else:
            validate_images(diagrams, args.image_dir, errors)
    if args.chapter:
        if not args.chapter.is_file():
            errors.append(f"{args.chapter}: chapter file does not exist")
        else:
            validate_chapter(diagrams, args.chapter, errors)
    if args.toc:
        if not args.toc.is_file():
            errors.append(f"{args.toc}: table-of-contents file does not exist")
        else:
            validate_toc(diagrams, args.toc, errors)

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"DIAGRAM_ARTIFACTS_FAIL errors={len(errors)} diagrams={len(diagrams)}")
        return 1

    print(f"DIAGRAM_ARTIFACTS_OK diagrams={len(diagrams)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
