"""由 FocusFlow_系統簡介.md 產生系統簡介 Word／PDF。

版面沿用初評最終版 DOCX（系所範本：A4、邊界 1.27 公分、標楷體 12pt、1.5 倍行高、
「一、」標題編號與頁尾頁碼），只替換內文。需要 python-docx；轉 PDF 需要本機安裝 Microsoft Word。

用法：python tools/build_overview.py [--no-pdf]
"""

import copy
import os
import re
import subprocess
import sys
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parent.parent
SOURCE_MD = ROOT / 'FocusFlow_系統簡介.md'
TEMPLATE = ROOT / 'source-documents' / '四技第115413組-FocusFlow AI-系統簡介_初評最終版.docx'
OUTPUT_DIR = ROOT / 'output'
OUTPUT_NAME = '四技第115413組-FocusFlow AI-系統簡介'

# 範本中各類段落的位置（初評最終版）
PROTO_TITLE = 0
PROTO_META = 1
PROTO_HEADING = 5
PROTO_BODY = 6
PROTO_LINE = 22
# 範本只有三組各自從 1 起算的編號清單，依章節分配
PROTO_NUMBERED = {'系統功能簡介': 8, '系統使用對象': 14, '系統特色': 17}

CJK = r'　-〿一-鿿＀-￯'


def normalize(text):
    """Word 會自動在中英文之間留間距，移除 Markdown 為了閱讀加上的空白。"""
    text = re.sub(rf'(?<=[{CJK}]) (?=[!-~])', '', text)
    text = re.sub(rf'(?<=[!-~]) (?=[{CJK}])', '', text)
    return text.strip()


def parse_markdown(path):
    blocks = []
    section = None
    for raw in path.read_text(encoding='utf-8').splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith('# '):
            blocks.append(('title', line[2:], None))
        elif line.startswith('## '):
            section = line[3:]
            blocks.append(('heading', section, section))
        elif line.startswith('- '):
            blocks.append(('item', line[2:], section))
        elif section is None:
            blocks.append(('meta', line, None))
        else:
            blocks.append(('body', line, section))
    return blocks


def make_paragraph(proto, text):
    element = copy.deepcopy(proto)
    runs = element.findall(qn('w:r'))
    run = runs[0]
    for extra in runs[1:]:
        element.remove(extra)
    for child in list(run):
        if child.tag != qn('w:rPr'):
            run.remove(child)
    node = run.makeelement(qn('w:t'), {})
    node.text = normalize(text)
    node.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    run.append(node)
    return element


def add_pagination_flag(paragraph, tag):
    """keepNext／keepLines 在 pPr 內必須緊接在 pStyle 之後。"""
    ppr = paragraph.find(qn('w:pPr'))
    index = 1 if ppr.find(qn('w:pStyle')) is not None else 0
    ppr.insert(index, ppr.makeelement(qn(tag), {}))


def build_docx(target):
    document = Document(str(TEMPLATE))
    body = document.element.body
    protos = [p._p for p in document.paragraphs]
    for element in protos:
        body.remove(element)
    sect = body.find(qn('w:sectPr'))

    for kind, text, section in parse_markdown(SOURCE_MD):
        if kind == 'title':
            proto = protos[PROTO_TITLE]
        elif kind == 'meta':
            proto = protos[PROTO_META]
        elif kind == 'heading':
            proto = protos[PROTO_HEADING]
        elif kind == 'item':
            proto = protos[PROTO_NUMBERED.get(section, PROTO_LINE)]
        else:
            proto = protos[PROTO_BODY]
        paragraph = make_paragraph(proto, text)
        if kind == 'heading':
            add_pagination_flag(paragraph, 'w:keepNext')  # 標題不單獨留在頁尾
        elif kind in ('item', 'body'):
            add_pagination_flag(paragraph, 'w:keepLines')  # 同一點不拆成兩頁
        sect.addprevious(paragraph)

    use_total_pages_field(document)
    target.parent.mkdir(parents=True, exist_ok=True)
    document.save(str(target))


def use_total_pages_field(document):
    """範本頁尾的「共 1 頁」是寫死的文字，改成 NUMPAGES 欄位讓總頁數正確。"""
    footer = document.sections[0].footer._element
    runs = list(footer.iter(qn('w:r')))
    for index, run in enumerate(runs[:-1]):
        if ''.join(t.text or '' for t in run.iter(qn('w:t'))).strip() != '，共':
            continue
        total = runs[index + 1]
        field = total.makeelement(qn('w:fldSimple'), {qn('w:instr'): ' NUMPAGES '})
        total.addprevious(field)
        field.append(total)
        return


def export_pdf(docx_path, pdf_path):
    script = (
        "$ErrorActionPreference = 'Stop'; "
        "$w = New-Object -ComObject Word.Application; $w.Visible = $false; "
        "try { $d = $w.Documents.Open($env:OVERVIEW_DOCX, $false, $true); "
        "$d.Repaginate(); $d.Fields.Update() | Out-Null; "
        "foreach ($s in $d.Sections) { foreach ($f in $s.Footers) { $f.Range.Fields.Update() | Out-Null } }; "
        "$d.ExportAsFixedFormat($env:OVERVIEW_PDF, 17); "
        "$pages = $d.ComputeStatistics(2); $d.Close($false); Write-Output \"pages=$pages\" } "
        "finally { $w.Quit() }"
    )
    env = dict(os.environ, OVERVIEW_DOCX=str(docx_path), OVERVIEW_PDF=str(pdf_path))
    pdf_path.unlink(missing_ok=True)
    result = subprocess.run(
        ['powershell', '-NoProfile', '-Command', script],
        capture_output=True, text=True, encoding='utf-8', errors='replace', env=env,
    )
    if result.returncode != 0 or not pdf_path.exists():
        raise SystemExit(f'PDF 轉檔失敗：{result.stderr.strip() or result.stdout.strip()}')
    return result.stdout.strip()


def main():
    docx_path = OUTPUT_DIR / f'{OUTPUT_NAME}.docx'
    build_docx(docx_path)
    print(f'已產生 {docx_path.relative_to(ROOT)}')
    if '--no-pdf' in sys.argv:
        return
    pdf_path = OUTPUT_DIR / f'{OUTPUT_NAME}.pdf'
    print(f'已產生 {pdf_path.relative_to(ROOT)}（{export_pdf(docx_path, pdf_path)}）')


if __name__ == '__main__':
    main()
