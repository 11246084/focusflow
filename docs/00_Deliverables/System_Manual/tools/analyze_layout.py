"""Report pages whose body leaves a large blank area at the bottom (layout review helper).

Usage: python analyze_layout.py <pdf> [--min-blank 0.35] [--first N]
Body area is y in [42.5, 799.5] pt of an A4 page (1.5 cm margins). Pages that end a chapter
(the next page starts with 第N章 / 附錄) are listed separately because the gap is expected.
"""
import argparse
import re
import pdfplumber

ap = argparse.ArgumentParser()
ap.add_argument('pdf')
ap.add_argument('--min-blank', type=float, default=0.35)
ap.add_argument('--first', type=int, default=1)
a = ap.parse_args()
TOP, BOTTOM = 42.5, 799.5


def first_text(page, n=34):
    words = page.extract_text() or ''
    return words.strip().split('\n')[0][:n] if words.strip() else ''


rows = []
with pdfplumber.open(a.pdf) as pdf:
    pages = pdf.pages
    for k in range(a.first - 1, len(pages)):
        p = pages[k]
        bottoms = [c['bottom'] for c in p.chars if c['bottom'] < BOTTOM + 1]
        bottoms += [i['bottom'] for i in p.images if i['bottom'] < BOTTOM + 1]
        bottoms += [l['bottom'] for l in p.lines if l['bottom'] < BOTTOM + 1]
        bottoms += [r['bottom'] for r in p.rects if r['bottom'] < BOTTOM + 1 and r['height'] < 700]
        content = max(bottoms) if bottoms else TOP
        blank = (BOTTOM - content) / (BOTTOM - TOP)
        rows.append((k + 1, blank, first_text(p), len(p.images), len(p.rects) + len(p.lines)))
    texts = [(pg.extract_text() or '')[:60] for pg in pages[a.first - 1:]]

print('pages:', len(pages))
for idx, (n, blank, first, imgs, lines) in enumerate(rows):
    nxt = texts[idx + 1] if idx + 1 < len(texts) else ''
    chapter_end = bool(re.match(r'\s*(第\s*\d+\s*章|附錄)', nxt)) or not nxt
    if blank >= a.min_blank:
        tag = 'CH-END' if chapter_end else 'BLANK '
        print(f'{tag} p{n:>3} blank={blank:4.0%} imgs={imgs} lines={lines} first="{first}"')
