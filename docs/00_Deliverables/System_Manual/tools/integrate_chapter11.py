"""Insert chapter 11 into the latest exported manual, retaining chapter 10.

Run with a Python environment providing python-docx and Pillow. The output is
an intermediate DOCX; refresh its indexes in an office renderer before delivery.
Existing package parts are retained byte-for-byte except document.xml/settings.xml.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt
from docx.text.paragraph import Paragraph
from docx.table import Table
from lxml import etree

import build_manual as layout

ROOT = Path(__file__).resolve().parents[4]
MANUAL = ROOT / 'docs/00_Deliverables/System_Manual'
BASE = MANUAL / 'output/四技第115413組-FocusFlow AI-系統手冊_複評更新版_第5至9章.docx'
CH10 = MANUAL / 'output/四技第115413組-FocusFlow AI-系統手冊_複評更新版.docx'
CHAPTER = MANUAL / 'chapters/11_操作手冊.md'


def text(node):
    return ''.join(node.xpath('.//w:t/text()'))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def preserve_reference_values(paragraphs):
    count = 0
    for p in paragraphs:
        stack = []
        for run in list(p):
            for child in list(run):
                if child.tag == qn('w:fldChar'):
                    kind = child.get(qn('w:fldCharType'))
                    if kind == 'begin':
                        stack.append({'nodes': [child], 'instruction': ''})
                    elif kind == 'separate' and stack:
                        stack[-1]['nodes'].append(child)
                    elif kind == 'end' and stack:
                        frame = stack.pop()
                        frame['nodes'].append(child)
                        if frame['instruction'].strip().startswith(('REF ', 'STYLEREF ')):
                            for field_node in frame['nodes']:
                                field_node.getparent().remove(field_node)
                            count += 1
                elif child.tag == qn('w:instrText') and stack:
                    stack[-1]['instruction'] += child.text or ''
                    stack[-1]['nodes'].append(child)
    return count


def pin_sequence_values(paragraphs):
    """Retain existing caption numbers when office engines refresh sequences."""
    count = 0
    for p in paragraphs:
        stack = []
        for run in p:
            for node in run:
                if node.tag == qn('w:fldChar'):
                    kind = node.get(qn('w:fldCharType'))
                    if kind == 'begin':
                        stack.append({'instructions': [], 'result': '', 'separated': False})
                    elif kind == 'separate' and stack:
                        stack[-1]['separated'] = True
                    elif kind == 'end' and stack:
                        field = stack.pop()
                        code = ''.join(n.text or '' for n in field['instructions'])
                        result = field['result'].strip()
                        if code.strip().startswith('SEQ ') and result.isdecimal():
                            code = re.sub(r'\\[rs]\s+\d+', '', code).strip()
                            field['instructions'][0].text = f' {code} \\r {int(result)} '
                            for extra in field['instructions'][1:]:
                                extra.text = ''
                            count += 1
                elif node.tag == qn('w:instrText') and stack:
                    stack[-1]['instructions'].append(node)
                elif node.tag == qn('w:t') and stack and stack[-1]['separated']:
                    stack[-1]['result'] += node.text or ''
    return count


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    assert args.output.resolve() not in {BASE.resolve(), CH10.resolve()}
    doc, older = Document(BASE), Document(CH10)
    body = doc._element.body
    # The template combines custom heading styles with caption-based indexes;
    # LibreOffice otherwise adds chapter titles to both figure/table lists.
    # Normalize only the TOC instructions, retaining cached contents until refresh.
    for p in doc.paragraphs:
        instructions = []
        # Word splits one field instruction across multiple runs. Stop at its
        # first separator so cached PAGEREF fields are not consumed or edited.
        for run in p._p:
            if any(n.tag == qn('w:fldChar') and n.get(qn('w:fldCharType')) == 'separate' for n in run):
                break
            instructions.extend(n for n in run if n.tag == qn('w:instrText'))
        if instructions and (instructions[0].text or '').strip().startswith('TOC '):
            original = ''.join(n.text or '' for n in instructions)
            if '\\c "圖"' in original:
                instructions[0].text = ' TOC \\h \\z \\c "圖" '
            elif '\\c "表"' in original:
                instructions[0].text = ' TOC \\h \\z \\c "表" '
            else:
                instructions[0].text = ' TOC \\o "1-2" \\h \\z '
            for extra in instructions[1:]:
                extra.text = ''

    # Legacy REF/STYLEREF fields target bookmarks removed by older exports.
    # Preserve their existing displayed values during this chapter-only update.
    # LibreOffice ignores fldLock for these Word fields, so materialize only
    # their existing display text. TOC/PAGEREF/SEQ/page-number fields remain live.
    frozen_references = preserve_reference_values(doc._element.xpath('.//w:p'))
    marker = next(p._p for p in doc.paragraphs
                  if p.style.name == 'Heading 1' and p.text == '使用手冊')
    assert not any(p.text == '操作手冊' for p in doc.paragraphs)

    # The newer chapter-5–9 export omits chapter 10. Reuse the previously
    # delivered chapter, not a freshly rewritten or re-sanitized version.
    keep = False
    ch10_nodes = []
    for node in older._element.body:
        if text(node) == '測試模型':
            keep = True
        if text(node) == '使用手冊':
            break
        if keep:
            ch10_nodes.append(deepcopy(node))
    assert len(ch10_nodes) == 41
    assert not any(n.xpath('.//@r:embed|.//@r:id|.//@r:link') for n in ch10_nodes)
    bookmark_id = max([int(x) for x in body.xpath('.//w:bookmarkStart/@w:id')] + [0]) + 1
    mapping = {}
    for node in ch10_nodes:
        for start in node.xpath('.//w:bookmarkStart'):
            old = start.get(qn('w:id'))
            mapping[old] = str(bookmark_id)
            bookmark_id += 1
            start.set(qn('w:id'), mapping[old])
            start.set(qn('w:name'), 'Ch10_' + start.get(qn('w:name')))
        for end in node.xpath('.//w:bookmarkEnd'):
            end.set(qn('w:id'), mapping[end.get(qn('w:id'))])
        frozen_references += preserve_reference_values(
            [node] if node.tag == qn('w:p') else node.xpath('.//w:p'))
        marker.addprevious(node)

    before = set(body)
    # Chapter 11 has already been editorially reviewed. Preserve its exact
    # wording instead of applying the older chapter-5–10 rewrite rules.
    layout.sanitize_text = lambda value: value
    layout.should_skip_paragraph = lambda value: False
    layout.add_chapter(doc, marker, CHAPTER)
    inserted = [n for n in body if n not in before]
    tables = []
    for node in inserted:
        if node.tag == qn('w:p'):
            p = Paragraph(node, doc._body)
            if p.style.name == 'Heading 1':
                p.paragraph_format.page_break_before = True
            if p.style.name == 'Heading 3':
                # H3 text already contains 11-x-y; suppress inherited numbering.
                num_pr = p._p.get_or_add_pPr().get_or_add_numPr()
                num_pr.get_or_add_numId().val = 0
            if p.text.rstrip().endswith(('：', ':')):
                p.paragraph_format.keep_with_next = True
            if '\n' in p.text:
                p.paragraph_format.keep_together = True
                for run in p.runs:
                    run.font.name = 'Consolas'
                    run._element.rPr.rFonts.set(qn('w:ascii'), 'Consolas')
                    run._element.rPr.rFonts.set(qn('w:hAnsi'), 'Consolas')
                    run.font.size = Pt(10)
        elif node.tag == qn('w:tbl'):
            tables.append(Table(node, doc._body))
    assert len(tables) == 4
    # Allocate enough room for paths/flags while retaining the manual's A4 grid.
    for table, widths in zip(tables, [[.85, 1.90, 2.05, 2.20], [1.05, 2.50, 3.45], [1.45, 2.25, 3.30], [1.10, 2.75, 3.15]]):
        total = table._tbl.tblPr.find(qn('w:tblW'))
        total.set(qn('w:type'), 'dxa')
        total.set(qn('w:w'), str(round(sum(widths) * 1440)))
        for col, width in zip(table.columns, widths):
            col.width = Inches(width)
        for row in table.rows:
            for cell, width in zip(row.cells, widths):
                cell.width = Inches(width)
                for p in cell.paragraphs:
                    p.paragraph_format.first_line_indent = Inches(0)

    # Verify all master headings and table captions were inserted.
    new_text = '\n'.join(text(n) for n in inserted)
    for heading in ['操作手冊','系統元件與安裝','系統管理與部署','交付、備份與還原','11-3-3 還原與驗證']:
        assert heading in new_text, heading
    assert '正式環境的還原演練尚未完成驗證' in new_text
    pinned_sequences = pin_sequence_values(doc._element.xpath('.//w:p'))
    settings = doc.settings.element
    update = settings.find(qn('w:updateFields'))
    if update is None:
        update = OxmlElement('w:updateFields')
        settings.append(update)
    update.set(qn('w:val'), 'true')
    replacements = {
        'word/document.xml': etree.tostring(doc._element, xml_declaration=True, encoding='UTF-8', standalone=True),
        'word/settings.xml': etree.tostring(settings, xml_declaration=True, encoding='UTF-8', standalone=True),
    }
    with ZipFile(BASE) as source, ZipFile(args.output, 'w') as target:
        for info in source.infolist():
            target.writestr(info, replacements.get(info.filename, source.read(info.filename)))
    with ZipFile(BASE) as source, ZipFile(args.output) as target:
        assert all(source.read(n) == target.read(n) for n in source.namelist() if n not in replacements)
    report = {'base': str(BASE), 'base_sha256': digest(BASE), 'chapter10_source': str(CH10),
              'chapter10_sha256': digest(CH10), 'chapter11_master_sha256': digest(CHAPTER),
              'chapter10_nodes': len(ch10_nodes), 'chapter11_nodes': len(inserted), 'chapter11_tables': len(tables),
              'legacy_reference_display_values_preserved': frozen_references,
              'caption_sequence_values_pinned': pinned_sequences,
              'unchanged_package_parts_verified': True, 'output': str(args.output)}
    args.output.with_suffix('.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
