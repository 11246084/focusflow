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
OUTPUT = MANUAL / 'output/四技第115413組-FocusFlow AI-系統手冊_1013複評全冊整合稿.docx'
REPORT = MANUAL / 'review/1013複評整合來源.json'
AI_SCOPE = {
    'AI-DOC-20260913':list(range(1,16)), 'AI-DOC-20260914':list(range(1,16)),
    'AI-DOC-20260919':[1,2,3,14], 'AI-UML-20260917':[6],
    'AI-UML-20260919':[1,2,5,6,12,14], 'AI-DOC-UML-20260919':list(range(5,11)),
    'AI-UML-20260921':[5,6], 'AI-DOC-UML-20260924':list(range(5,10)),
    'AI-DOC-UML-20260925':list(range(5,10)),
    'AI-DOC-UML-20260929':[1,2,3,5,6,7,9,15], 'AI-DOC-20260930':[11],
    'AI-DOC-UML-20260930':[4,12],
    'AI-INTEGRATE-20260930':list(range(1,16)),
}

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
    doc.styles['Heading 1'].paragraph_format.alignment=WD_ALIGN_PARAGRAPH.CENTER
    # 系辦段落設定：左右對齊、第一行位移 2 字元、單行間距、前後段 0 pt。
    body_pf=doc.styles['文字內文'].paragraph_format
    body_pf.alignment=WD_ALIGN_PARAGRAPH.JUSTIFY
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
    changes=[];images=[];sources=[];table_counts=[]
    readme=(MANUAL/'README.md').read_text(encoding='utf-8')
    ai_rows={line.split('|')[1].strip():line for line in readme.splitlines() if line.startswith('| AI-')}
    def para(text,style='文字內文',size=14):
        p=doc.add_paragraph(style=style)
        heading=style.startswith('Heading')
        if heading:no_number(p)
        layout.add_inline(p,text,size=size,base_bold=heading)
        p.paragraph_format.line_spacing=1.0
        return p
    def caption(text):
        # 系辦範例「圖3-1-1 系統架構」：編號與名稱以半形空格分隔。
        text=re.sub(r'^((?:圖|表)\s*\d+-\d+-\d+[a-z]?)[\s　]+',r'\1 ',text)
        p=para(text,'Figure Caption' if text.startswith('圖') else 'Table Caption')
        zero_indent(p)
        p.alignment=WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.keep_with_next=text.startswith('表')
        return p
    import os
    # 除錯用：MANUAL_CHAPTERS=15 或 1,2,3 只組指定章節，方便快速測試 Word 能否處理。
    only={int(x) for x in os.environ.get('MANUAL_CHAPTERS','').split(',') if x.strip()}
    for path in sorted((MANUAL/'chapters').glob('[0-9][0-9]_*.md')):
        num=int(path.name[:2]);raw=path.read_text(encoding='utf-8')
        if only and num not in only:continue
        sources.append({'chapter':num,'source':str(path.relative_to(MANUAL)),'sha256':digest(path)})
        if num==14:
            existing=set(re.findall(r'^\| (AI-[^| ]+)',raw,re.M))
            additional=[line for key,line in ai_rows.items() if key not in existing]
            last=max(m.end() for m in re.finditer(r'^\| AI-.*$',raw,re.M))
            raw=raw[:last]+'\n'+'\n'.join(additional)+raw[last:]
            changes.append('第14章補入README已存在但章內未同步的AI紀錄，共'+str(len(additional))+'筆')
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
                if num==15:
                    text='附錄' if level==1 else re.sub(r'^15-(\d+)',r'附錄\1',text)
                p=para(text,'Heading '+str(min(level,4)),18 if level==1 else 16 if level==2 else 14)
                if level==1:p.paragraph_format.page_break_before=(num!=1)
                continue
            if num==15 and line.replace('　',' ')=='國立臺北商業大學 資訊管理系':
                # 每次會議紀錄各自起頁，校系名稱置中（初評版面）。
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
                if num==15 and rows[0]==['階段','評審建議事項','修正情形與目前狀態','對應章節或證據','確認人']:
                    rows=[['評審建議事項','修正情形']]+[[r[0]+'<br>'+r[1],r[2]+'<br>對應章節或證據：'+r[3]+'<br>確認人：'+r[4]] for r in rows[1:]]
                    changes.append('附錄評審意見表按官方兩欄格式合併既有欄位，保留全部原文與確認狀態')
                if pending:caption(pending)
                # 會議紀錄表沿用初評版面：無底色、欄位標籤粗體、單值的列橫跨整列，
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
                        layout.prevent_row_split(row)
                        if j<=headers:layout.set_repeat_table_header(row)
                    for k in range(cols):
                        cell=cells[j*cols+k];cell.width=Inches(widths[k]);layout.set_cell_margins(cell)
                        p=cell.paragraphs[0];p.paragraph_format.first_line_indent=Pt(0);p.paragraph_format.line_spacing=1.0
                        if j==0 and not meeting:layout.set_cell_shading(cell,'D9EAD3')
                        if j<=headers and not meeting:p.paragraph_format.keep_with_next=True
                        layout.add_inline(p,values[k] if k<len(values) else '',size=14,base_bold=(j==0 and not meeting) or (meeting and not full))
                    if full:table.cell(j,0).merge(table.cell(j,cols-1))
                for row in table.rows:
                    for cell in row.cells:
                        for p in cell.paragraphs:
                            p.paragraph_format.first_line_indent=Pt(0)
                            for r in p.runs:font(r,14)
                if num==4 and tables==0:
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
                else:layout.add_picture(doc,marker,file)
                continue
            cap=re.match(r'^(圖|表)\s*\d+-\d+-\d+[a-z]?[\s　]+',line)
            nxt=next((x.strip() for x in lines[i:] if x.strip()),'')
            prev=next((x.strip() for x in reversed(lines[:i-1]) if x.strip()),'')
            if cap and ((cap.group(1)=='表' and (nxt.startswith(('|','```')) or num==4 and len(line)<70)) or (cap.group(1)=='圖' and prev.startswith('!['))):
                if cap.group(1)=='表':pending=line
                else:caption(line)
                continue
            if pending:caption(pending);pending=None
            if line.startswith('>'):line=line.lstrip('> ').strip()
            para(line)
        if pending:caption(pending)
        ids=[key for key,scope in AI_SCOPE.items() if num in scope]
        para('AI 輔助紀錄索引：'+'、'.join(ids)+'。')
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
