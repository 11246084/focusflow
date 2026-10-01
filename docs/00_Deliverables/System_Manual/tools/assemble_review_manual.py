"""Assemble existing chapter sources without generating replacement prose.

The output intentionally retains unresolved source notes. It is an integrated
review copy, not a claim that incomplete team-authored material is complete.
"""
from __future__ import annotations
import hashlib
import json
import re
from copy import deepcopy
from pathlib import Path
from docx import Document
from docx.enum.section import WD_SECTION_START
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor
from docx.table import Table
import build_manual as layout
import manual_math

MANUAL = Path(__file__).resolve().parents[1]
BASE = MANUAL / 'output/四技第115413組-FocusFlow AI-系統手冊_複評更新版_第5至11章.docx'
OUTPUT = MANUAL / 'output/四技第115413組-FocusFlow AI-系統手冊_1013全冊修訂版.docx'
REPORT = MANUAL / 'review/1013複評整合來源.json'
AI_SCOPE = {
    'AI-ORIG-01':[1,3,6,7], 'AI-ORIG-02':[4], 'AI-ORIG-03':[8,9], 'AI-ORIG-04':[15],
    'AI-DOC-20260913':list(range(1,16)), 'AI-DOC-20260914':list(range(1,16)),
    'AI-DOC-20260919':[1,2,3,14], 'AI-UML-20260917':[6],
    'AI-UML-20260919':[1,2,5,6,12,14], 'AI-DOC-UML-20260919':list(range(5,11)),
    'AI-UML-20260921':[5,6], 'AI-DOC-UML-20260924':list(range(5,10)),
    'AI-DOC-UML-20260925':list(range(5,10)),
    'AI-DOC-UML-20260929':[1,2,3,5,6,7,9,15], 'AI-DOC-20260930':[11],
    'AI-DOC-UML-20260930':[4,12],
    'AI-INTEGRATE-20260930':list(range(1,16)),
    'AI-DOC-20261001':list(range(1,16)),
}

NUMPAT = r'(?:附?圖|附?表)\s*\d+-\d+(?:-\d+)?[a-z]?'
PAGE_W_PT = 18 / 2.54 * 72          # 版心寬度（點）
FIG_CHAIN_PT = 400                   # 圖高度不超過此值才與前面的說明段落綁在同一頁
FIG_MAX_H = {'圖4-3-1-':5.0}           # 低解析度截圖放太大沒有意義，縮小後可與前文排在同一頁
KEEP_TABLE_PT = 300                  # 估計高度不超過此值的表格整張留在同一頁（約版心高度的 62%）
MAX_PAGE_PT = 740                    # 版心高度約 757 pt，留些餘裕

def table_height(rows, widths_in, font_pt=14):
    """粗估表格高度（pt）：依欄寬與字數推算每格行數，取同列最大值。"""
    total = 0.0
    for r in rows:
        lines_max = 1
        for k, cell in enumerate(r):
            width = max(widths_in[k] * 72 - 9, 20) if k < len(widths_in) else 60
            n = 0
            for seg in re.split(r'<br>', cell):
                vl = layout.visual_len(re.sub(r'[*`]', '', seg)) * font_pt / 2 * 0.98
                n += max(1, -(-int(vl) // int(width)))
            lines_max = max(lines_max, n)
        total += lines_max * font_pt * 1.22 + 8
    return total

def load_chapter_pages():
    f = MANUAL / 'review/chapter_pages.json'
    try:
        return {int(k): v for k, v in json.loads(f.read_text(encoding='utf-8')).items()}
    except Exception:
        return {}

def chapters_of(text):
    """從 README AI 紀錄的「章節／頁碼」欄位取出章號（附錄 = 15）。"""
    if '全冊' in text:
        return list(range(1, 16))
    nums = set()
    for m in re.finditer(r'第\s*([\d～、\s]+?)\s*章', text):
        for part in m.group(1).split('、'):
            part = part.strip()
            if '～' in part:
                a, b = part.split('～'); nums.update(range(int(a), int(b) + 1))
            elif part.isdigit():
                nums.add(int(part))
    if '附錄' in text:
        nums.add(15)
    return sorted(nums)

def chapter_page_text(text, pages):
    nums = chapters_of(text)
    if not nums:
        return text
    runs, cur = [], [nums[0], nums[0]]
    for n in nums[1:]:
        if n == cur[1] + 1: cur[1] = n
        else: runs.append(cur); cur = [n, n]
    runs.append(cur)
    def name(a, b):
        if a == 15: return '附錄'
        hi = b if b < 15 else 14
        base = f'第 {a} 章' if a == hi else f'第 {a}～{hi} 章'
        return base + ('與附錄' if b == 15 else '')
    out = []
    for a, b in runs:
        label = '全冊' if (a, b) == (1, 15) else name(a, b)
        if a in pages and b in pages:
            lo, hi = pages[a][0], pages[b][1]
            label += f'（第 {lo} 頁）' if lo == hi else f'（第 {lo}～{hi} 頁）'
        out.append(label)
    return '；'.join(out)

FOOTNOTE_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'

def footnotes_xml(notes, ref_style_id):
    """footnotes.xml：分隔線兩則加上各章的 AI 輔助紀錄索引。"""
    from xml.sax.saxutils import escape
    body = ['<w:footnote w:id="0" w:type="separator"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>',
            '<w:footnote w:id="1" w:type="continuationSeparator"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>']
    for fid, text in notes:
        body.append(f'<w:footnote w:id="{fid}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr>'
                    f'<w:r><w:rPr><w:rStyle w:val="{ref_style_id}"/></w:rPr><w:footnoteRef/></w:r>'
                    f'<w:r><w:t xml:space="preserve"> {escape(text)}</w:t></w:r></w:p></w:footnote>')
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<w:footnotes {FOOTNOTE_NS}>' + ''.join(body) + '</w:footnotes>').encode('utf-8')

def add_footnote_ref(p, fid, ref_style_id):
    r = OxmlElement('w:r'); rpr = OxmlElement('w:rPr')
    st = OxmlElement('w:rStyle'); st.set(qn('w:val'), ref_style_id); rpr.append(st)
    va = OxmlElement('w:vertAlign'); va.set(qn('w:val'), 'superscript'); rpr.append(va)
    r.append(rpr)
    ref = OxmlElement('w:footnoteReference'); ref.set(qn('w:id'), str(fid)); r.append(ref)
    p._p.append(r)

def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def node_text(n):
    return ''.join(x.text or '' for x in n.iter(qn('w:t')))

def no_number(p):
    # Only for headings: their text already carries 第X章／X-Y. Word turns numId=0
    # into an explicit zero indent, so body paragraphs must never get this.
    p._p.get_or_add_pPr().get_or_add_numPr().get_or_add_numId().val = 0

def zero_indent(p):
    """Remove the first-line indent; firstLineChars overrides firstLine in Word."""
    ind = p._p.get_or_add_pPr().get_or_add_ind()
    ind.set(qn('w:firstLineChars'), '0'); ind.set(qn('w:firstLine'), '0')

def add_cover_logo(doc):
    """系辦封面範例有專題 Logo；取自初評原稿封面的同一張圖。"""
    source = Document(MANUAL / 'source-documents/專題手冊_初評最終版.docx')
    blob = next(source.part.related_parts[b.get(qn('r:embed'))].blob
                for p in source.paragraphs[:8] for b in p._p.iter(qn('a:blip')))
    title = next(p for p in doc.paragraphs[:8] if p.text.strip() == '系統手冊')
    logo = OxmlElement('w:p'); title._p.addnext(logo)
    from docx.text.paragraph import Paragraph
    from io import BytesIO
    p = Paragraph(logo, title._parent); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(BytesIO(blob), height=Inches(2.9))

def add_screen(doc, marker, path):
    """Chapter 12 screenshots: never enlarge beyond ~150 dpi so small captures stay sharp."""
    from PIL import Image
    with Image.open(path) as image:
        w, h = image.size
    width = min(6.75, w / 150, 6.0 * w / h)
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.keep_with_next = True; p.paragraph_format.first_line_indent = Pt(0)
    shape = p.add_run().add_picture(str(path), width=Inches(width))
    shape._inline.docPr.set('descr', path.stem)
    marker.addprevious(p._p)

def font(run, size=14, bold=None):
    layout.set_run_font(run, size=size, bold=bold)
    run.font.color.rgb = RGBColor(0, 0, 0)

def main():
    doc = Document(BASE)
    body = doc._element.body
    vector_images = {}
    for n in body:
        if n.tag == qn('w:p'):
            for blip in n.iter(qn('a:blip')):
                rid = blip.get(qn('r:embed'))
                if rid and rid in doc.part.related_parts:
                    vector_images[hashlib.sha256(doc.part.related_parts[rid].blob).hexdigest()] = deepcopy(n)
    cover = [deepcopy(p._p) for p in doc.paragraphs[:12]]
    for n in cover:
        for old in list(n.iter(qn('w:sectPr'))):old.getparent().remove(old)
    for n in list(body):
        if n.tag != qn('w:sectPr'): body.remove(n)
    for n in cover: body.insert(len(body)-1,n)
    for p in doc.paragraphs:
        for run in p.runs:
            run.text = run.text.replace('115年6月2日','115年10月13日')
    add_cover_logo(doc)
    for name,size in [('Normal',14),('文字內文',14),('Heading 1',18),('Heading 2',16),('Heading 3',14),('Heading 4',14),('Caption',14)]:
        st=doc.styles[name]; st.font.name='Times New Roman';st.font.size=Pt(size);st.font.color.rgb=RGBColor(0,0,0)
        st.element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:eastAsia'),'DFKai-SB')
        pf=st.paragraph_format;pf.line_spacing=1.0;pf.space_after=Pt(0);pf.space_before=Pt(0)
        if name.startswith('Heading'):pf.keep_with_next=True;pf.first_line_indent=Pt(0)
    for name in ['Figure Caption','Table Caption','Front Index']:
        if name not in doc.styles: doc.styles.add_style(name,WD_STYLE_TYPE.PARAGRAPH)
        st=doc.styles[name];st.base_style=doc.styles['Caption' if 'Caption' in name else 'Normal'];st.font.size=Pt(14)
        st.paragraph_format.first_line_indent=Pt(0)
    doc.styles['Heading 1'].paragraph_format.page_break_before=True
    for hname in ('Heading 2','Heading 3','Heading 4'):
        doc.styles[hname].paragraph_format.page_break_before=False   # 標題 4 原本繼承段前分頁，造成提早換頁
    doc.styles['Heading 1'].paragraph_format.alignment=WD_ALIGN_PARAGRAPH.CENTER
    # 內文靠左對齊（不左右對齊，避免拉開字距）、第一行位移 2 字元、單行間距、前後段 0 pt。
    body_pf=doc.styles['文字內文'].paragraph_format
    body_pf.alignment=WD_ALIGN_PARAGRAPH.LEFT
    body_pf.widow_control=True
    ind=doc.styles['文字內文'].element.get_or_add_pPr().get_or_add_ind()
    ind.set(qn('w:firstLineChars'),'200');ind.set(qn('w:firstLine'),'560')
    # 章節標題沿用初評版面：粗體，節標題前留白，避免段落擠在一起。
    for name,before,after in [('Heading 1',0,12),('Heading 2',12,6),('Heading 3',6,0),('Heading 4',6,0)]:
        st=doc.styles[name];st.font.bold=True
        st.paragraph_format.space_before=Pt(before);st.paragraph_format.space_after=Pt(after)
        ind=st.element.get_or_add_pPr().get_or_add_ind()
        ind.set(qn('w:firstLineChars'),'0');ind.set(qn('w:firstLine'),'0')
    for st in doc.styles:
        if st.type==WD_STYLE_TYPE.PARAGRAPH and st.name.lower().startswith(('toc','table of figures')):
            st.font.size=Pt(14)
            st.paragraph_format.space_before=Pt(0);st.paragraph_format.space_after=Pt(0);st.paragraph_format.line_spacing=1.0
            # 系辦目錄範本的章標題列為粗體。
            if st.name.lower()=='toc 1':st.font.bold=True
    for st in doc.styles:
        if st.type==WD_STYLE_TYPE.PARAGRAPH:
            snap=OxmlElement('w:snapToGrid');snap.set(qn('w:val'),'false');st.element.get_or_add_pPr().append(snap)
    def section(fmt=None):
        s=doc.sections[-1]
        s.page_width=Cm(21);s.page_height=Cm(29.7)
        s.top_margin=s.bottom_margin=s.left_margin=s.right_margin=Cm(1.5)
        s.header_distance=s.footer_distance=Cm(1)
        grid=s._sectPr.find(qn('w:docGrid'))
        if grid is not None:s._sectPr.remove(grid)
        s.header.is_linked_to_previous=False;s.footer.is_linked_to_previous=False
        for part in [s.header,s.footer]:
            for n in list(part._element):part._element.remove(n)
        if fmt:
            node=s._sectPr.find(qn('w:pgNumType'))
            if node is None:node=OxmlElement('w:pgNumType');s._sectPr.append(node)
            node.set(qn('w:fmt'),fmt);node.set(qn('w:start'),'1')
            p=s.footer.add_paragraph();p.alignment=WD_ALIGN_PARAGRAPH.CENTER
            layout.add_field(p,' PAGE ','1')
        return s
    section()
    doc.add_section(WD_SECTION_START.NEW_PAGE);section('upperRoman')
    for i,(title,code) in enumerate([('目錄',' TOC \\o "1-2" \\h \\z '),('圖目錄',' TOC \\t "Figure Caption,1" \\h \\z '),('表目錄',' TOC \\t "Table Caption,1" \\h \\z ')]):
        p=doc.add_paragraph(style='Front Index');p.alignment=WD_ALIGN_PARAGRAPH.CENTER;font(p.add_run(title),14,True)
        p.paragraph_format.page_break_before=bool(i)
        p=doc.add_paragraph(style='Front Index');layout.add_field(p,code,'更新目錄')
    doc.add_section(WD_SECTION_START.NEW_PAGE);section('decimal')
    marker=doc._element.body.sectPr
    layout.sanitize_text=lambda x:x
    manual_math.install_inline(layout)
    changes=[];images=[];sources=[];table_counts=[];table_log=[]
    readme=(MANUAL/'README.md').read_text(encoding='utf-8')
    ai_rows={line.split('|')[1].strip():line for line in readme.splitlines() if line.startswith('| AI-')}
    ref_id=doc.styles['footnote reference'].style_id
    fn={'pending':None,'notes':[],'last':None}
    ft=doc.styles['footnote text']
    ft.font.size=Pt(10);ft.font.name='Times New Roman'
    ft.element.get_or_add_rPr().get_or_add_rFonts().set(qn('w:eastAsia'),'DFKai-SB')
    ft.paragraph_format.alignment=WD_ALIGN_PARAGRAPH.LEFT;ft.paragraph_format.first_line_indent=Pt(0)
    ft.paragraph_format.space_before=Pt(0);ft.paragraph_format.space_after=Pt(0);ft.paragraph_format.line_spacing=1.0
    def attach_note(p):
        ids=fn['pending'];fn['pending']=None
        fid=len(fn['notes'])+2
        fn['notes'].append((fid,'AI 輔助紀錄索引：'+'、'.join(ids)+'（說明見第 14 章表14-5-1）。'))
        add_footnote_ref(p,fid,ref_id)
    def para(text,style='文字內文',size=14):
        p=doc.add_paragraph(style=style)
        heading=style.startswith('Heading')
        if heading:no_number(p)
        layout.add_inline(p,text,size=size,base_bold=heading)
        p.paragraph_format.line_spacing=1.0
        if style=='文字內文':
            fn['last']=p
            if fn['pending'] and len(text)>=6:attach_note(p)
        return p
    def caption(text):
        # 系辦範例「圖3-1-1 系統架構」：編號與名稱以半形空格分隔。
        text=re.sub(r'^('+NUMPAT+r')[\s　]+',r'\1 ',text)
        is_table=text.startswith(('表','附表'))
        p=para(text,'Table Caption' if is_table else 'Figure Caption')
        zero_indent(p)
        p.alignment=WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.keep_with_next=is_table
        return p
    import os
    # 除錯用：MANUAL_CHAPTERS=15 或 1,2,3 只組指定章節，方便快速測試 Word 能否處理。
    only={int(x) for x in os.environ.get('MANUAL_CHAPTERS','').split(',') if x.strip()}
    for path in sorted((MANUAL/'chapters').glob('[0-9][0-9]_*.md')):
        num=int(path.name[:2]);raw=path.read_text(encoding='utf-8')
        if only and num not in only:continue
        sources.append({'chapter':num,'source':str(path.relative_to(MANUAL)),'sha256':digest(path)})
        fn['pending']=[key for key,scope in AI_SCOPE.items() if num in scope]
        if num==14:
            # 表14-5-1 的資料列全部取自 README「AI 輔助產出說明」（單一來源），並依最近一次排版補上頁碼。
            pages=load_chapter_pages();rows14=[]
            for key,line in ai_rows.items():
                cells=[c.strip() for c in line.strip().strip('|').split('|')]
                cells[3]=chapter_page_text(cells[3],pages)
                rows14.append('| '+' | '.join(cells)+' |')
            raw=raw.rstrip()+'\n'+'\n'.join(rows14)+'\n'
            changes.append('第14章AI紀錄表由README產生，共'+str(len(rows14))+'筆')
        math_blocks=[]
        def save_math(match):
            math_blocks.append(match.group(1).strip())
            return '\n\n@@MATHBLOCK_'+str(len(math_blocks)-1)+'@@\n\n'
        raw=re.sub(r'\$\$(.*?)\$\$',save_math,raw,flags=re.S)
        lines=layout.collect_logical_lines(raw.splitlines());i=0;pending=None;tables=0;meetings=0
        while i<len(lines):
            line=lines[i].strip();i+=1
            if not line or line=='---' or line.startswith('[返回手冊索引]'):continue
            equation=re.fullmatch(r'@@MATHBLOCK_(\d+)@@',line)
            if equation:
                p=doc.add_paragraph();p.paragraph_format.first_line_indent=Pt(0)
                p._p.append(manual_math.omml(math_blocks[int(equation.group(1))]))
                p.paragraph_format.keep_with_next=True
                continue
            if line.startswith('#'):
                level=len(line)-len(line.lstrip('#'));text=line[level:].strip()
                p=para(text,'Heading '+str(min(level,4)),18 if level==1 else 16 if level==2 else 14)
                if level==1:p.paragraph_format.page_break_before=(num!=1)
                continue
            if num==15 and line.replace('　',' ')=='國立臺北商業大學 資訊管理系':
                # 每次會議紀錄各自起頁，校系名稱置中。
                p=doc.add_paragraph(style='Front Index');p.alignment=WD_ALIGN_PARAGRAPH.CENTER
                font(p.add_run(line),16);p.paragraph_format.page_break_before=meetings>0
                p.paragraph_format.keep_with_next=True;meetings+=1
                continue
            if line.startswith('```'):
                if pending:caption(pending);pending=None
                code=[]
                while i<len(lines) and not lines[i].strip().startswith('```'):code.append(lines[i]);i+=1
                i+=1;p=para('\n'.join(code));zero_indent(p);p.paragraph_format.keep_together=False
                continue
            if line.startswith('|'):
                rows=[line]
                while i<len(lines) and lines[i].strip().startswith('|'):rows.append(lines[i].strip());i+=1
                rows=[layout.split_table_row(x) for x in rows if not layout.is_separator_row(x)]
                if pending:caption(pending)
                # 會議紀錄表：無底色、欄位標籤粗體、單值的列橫跨整列，
                # 內容列可跨頁（不強制整列同頁）。
                meeting=num==15 and rows[0][0].startswith('會議日期')
                if meeting:
                    label=re.compile(r'^(會議議題|開會人員|缺席人員|會議內容：|一、|二、|下次開會時間|下次會議內容：)')
                    for r in rows:
                        if len(r)>1 and not r[1].strip():
                            r[0]='<br>'.join('**'+s+'**' if label.match(s) else s for s in r[0].split('<br>'))
                # Reuse formatting helpers only; never apply their prose rewrites.
                cols=max(len(r) for r in rows)
                table=doc.add_table(rows=len(rows),cols=cols)
                table.style='Table Grid';table.autofit=False
                widths=layout.column_widths(rows,cols,18/2.54)
                widths=[w*18/2.54/sum(widths) for w in widths]
                if meeting:widths=[18/2.54*0.6,18/2.54*0.4]  # 左欄較寬，會議日期才不會折行
                for col,w in zip(table.columns,widths):col.width=Inches(w)
                cells=table._cells
                headers=max([0]+[j for j,r in enumerate(rows[:4]) if r and r[0]=='欄位名稱'])
                for j,values in enumerate(rows):
                    row=table.rows[j]
                    full=meeting and len(values)>1 and not values[1].strip()
                    if not meeting:
                        if table_height([values],widths)<=260:layout.prevent_row_split(row)   # 特別高的列允許跨頁，避免整列被推到下一頁留下空白
                        if j<=headers:layout.set_repeat_table_header(row)
                    for k in range(cols):
                        cell=cells[j*cols+k];cell.width=Inches(widths[k]);layout.set_cell_margins(cell,**({'top':20,'bottom':20} if meeting else {'top':35,'bottom':35}))
                        p=cell.paragraphs[0];p.paragraph_format.first_line_indent=Pt(0);p.paragraph_format.line_spacing=1.0
                        if j==0 and not meeting:layout.set_cell_shading(cell,'D9EAD3')
                        if j<=headers and not meeting:p.paragraph_format.keep_with_next=True
                        layout.add_inline(p,values[k] if k<len(values) else '',size=13 if meeting else 14,base_bold=(j==0 and not meeting) or (meeting and not full))
                    if full:table.cell(j,0).merge(table.cell(j,cols-1))
                for row in table.rows:
                    for cell in row.cells:
                        for p in cell.paragraphs:
                            p.paragraph_format.first_line_indent=Pt(0)
                            for r in p.runs:font(r,13 if meeting else 14)
                if not meeting:
                    # 表格盡量不跨頁：估計高度不大的表整張同頁；較長的表重複標題列，
                    # 並讓標題列與前兩列、最後兩列各自同頁，避免只剩一兩列落單。
                    est=table_height(rows,widths);last_row=len(rows)-1;keep_all=est<=KEEP_TABLE_PT
                    for j,row in enumerate(table.rows):
                        if j<last_row if keep_all else (j<=headers or j==last_row-1):
                            for cell in row.cells:
                                for p in cell.paragraphs:p.paragraph_format.keep_with_next=True
                    table_log.append({'chapter':num,'caption':pending or '','rows':len(rows),'est_pt':round(est),'keep_together':keep_all})
                if num==4 and rows[0][0]=='類別':
                    # 分工表的類別欄依官方範本垂直合併：空白格併入上一個類別。
                    start=1
                    for j in range(2,len(rows)+1):
                        if j==len(rows) or rows[j][0]:
                            if j-1>start:table.cell(start,0).merge(table.cell(j-1,0))
                            start=j
                    for j in range(1,len(rows)):
                        for k in range(2,cols):table.cell(j,k).paragraphs[0].alignment=WD_ALIGN_PARAGRAPH.CENTER
                    changes.append('表4-2-1依母稿產生，類別欄依官方分工表範本垂直合併')
                pending=None;tables+=1;continue
            image=re.match(r'^!\[([^\]]*)\]\(([^)]+)\)$',line)
            if image:
                file=(path.parent/image.group(2)).resolve();assert file.exists(),file
                images.append({'source':str(file.relative_to(MANUAL)),'sha256':digest(file),'chapter':num})
                if file.suffix.lower() in ['.emf','.wmf']:
                    node=deepcopy(vector_images[digest(file)]);marker.addprevious(node)
                elif num==12:add_screen(doc,marker,file)
                else:layout.add_picture(doc,marker,file,max_h=FIG_MAX_H.get(file.name[:7],7.8))
                continue
            cap=re.match(r'^(附?圖|附?表)\s*\d+-\d+(?:-\d+)?[a-z]?[\s　]+',line)
            nxt=next((x.strip() for x in lines[i:] if x.strip()),'')
            prev=next((x.strip() for x in reversed(lines[:i-1]) if x.strip()),'')
            if cap and ((cap.group(1).endswith('表') and (nxt.startswith(('|','```')) or num==4 and len(line)<70)) or (cap.group(1).endswith('圖') and prev.startswith('!['))):
                if cap.group(1).endswith('表'):pending=line
                else:caption(line)
                continue
            if pending:caption(pending);pending=None
            if line.startswith('>'):line=line.lstrip('> ').strip()
            p=para(line)
            # 緊接在圖表之前、且提到該圖表編號的說明段落，與圖表排在同一頁。
            ahead=[x.strip() for x in lines[i:i+4] if x.strip()]
            if ahead and (ahead[0].startswith('![') or re.match(r'^'+NUMPAT+r'[\s　]',ahead[0])):
                m=next((re.search(NUMPAT,x) for x in ahead[:3] if re.match(r'^'+NUMPAT+r'[\s　]',x)),None)
                if m and m.group(0).replace(' ','') in line.replace(' ',''):
                    # 高度超過版心約 55% 的圖不與說明段落綁在一起，否則前一頁會留下大片空白；
                    # 說明段落留在前一頁底部，圖在下一頁頁首，仍屬相鄰位置。
                    tall=False
                    im=re.match(r'^!\[[^\]]*\]\(([^)]+)\)$',ahead[0])
                    if im:
                        from PIL import Image as _Im
                        with _Im.open((path.parent/im.group(1)).resolve()) as _i:
                            iw,ih=_i.size
                        hpt=(min(6.75,FIG_MAX_H.get(im.group(1).split('/')[-1][:7],7.8)*iw/ih) if num!=12 else min(6.75,iw/150,6.0*iw/ih))*72*ih/iw
                        tall=hpt>FIG_CHAIN_PT
                    if not tall:p.paragraph_format.keep_with_next=True
        if pending:caption(pending)
        if fn['pending'] and fn['last'] is not None:attach_note(fn['last'])
        table_counts.append({'chapter':num,'tables':tables})
    # Normalize table grids to the usable A4 width, including inherited tables.
    for table in doc.tables:
        widths=[c.width for c in table.columns];total=sum(w or 1 for w in widths)
        factor=int(Cm(18))/total
        for col,w in zip(table.columns,widths):col.width=int((w or 1)*factor)
        seen=set()
        for row in table.rows:
            for cell in row.cells:
                if cell._tc not in seen and cell.width:cell.width=int(cell.width*factor)
                seen.add(cell._tc)
        prop=table._tbl.tblPr.find(qn('w:tblW'))
        prop.set(qn('w:type'),'dxa');prop.set(qn('w:w'),str(round(18/2.54*1440)))
    for rel in doc.part.rels.values():
        if rel.reltype.endswith('/footnotes'):rel.target_part._blob=footnotes_xml(fn['notes'],ref_id)
    (MANUAL/'review/table_layout.json').write_text(json.dumps(table_log,ensure_ascii=False,indent=1),encoding='utf-8')
    settings=doc.settings.element
    upd=settings.find(qn('w:updateFields'))
    if upd is None:upd=OxmlElement('w:updateFields');settings.append(upd)
    upd.set(qn('w:val'),'true')
    # 可指定暫存路徑：交付檔只在 refresh_manual_word.ps1 完成後才被取代，
    # 避免有人在重建途中打開未完成的檔案（2026-09-30 曾因此讓 Word 當掉）。
    import sys
    doc.save(Path(sys.argv[1]) if len(sys.argv)>1 else OUTPUT)
    REPORT.write_text(json.dumps({'base':str(BASE.relative_to(MANUAL)),'base_sha256':digest(BASE),'sources':sources,'images':images,'table_counts':table_counts,'changes':changes,'output':str(OUTPUT.relative_to(MANUAL)),'missing_personal_reflections':True,'source_prose_rewritten':False},ensure_ascii=False,indent=2),encoding='utf-8')
    REPORT.with_name('1013複評AI章節對照.json').write_text(json.dumps(AI_SCOPE,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(OUTPUT),'chapters':len(sources),'images':len(images),'tables':len(doc.tables),'changes':changes},ensure_ascii=False))

if __name__=='__main__':main()
