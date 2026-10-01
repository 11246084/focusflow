"""Render PDF pages to PNG (pdfplumber/pypdfium2) and optionally build contact sheets for layout review.

Usage:
  python render_pages.py <pdf> <outdir> [--first N] [--last M] [--dpi 70] [--sheet K]
    --sheet K   also build contact sheets with K pages per sheet (sheet_###.png) in outdir
Images are layout-review scratch files; keep <outdir> outside the repository (or git-ignored).
"""
import argparse
from pathlib import Path
import pdfplumber
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument('pdf'); ap.add_argument('outdir')
ap.add_argument('--first', type=int, default=1); ap.add_argument('--last', type=int, default=0)
ap.add_argument('--dpi', type=int, default=70); ap.add_argument('--sheet', type=int, default=0)
a = ap.parse_args()
out = Path(a.outdir); out.mkdir(parents=True, exist_ok=True)
paths = []
with pdfplumber.open(a.pdf) as pdf:
    last = a.last or len(pdf.pages)
    for n in range(a.first, last + 1):
        f = out / f'p{n:03d}.png'
        pdf.pages[n - 1].to_image(resolution=a.dpi).original.convert('RGB').save(f)
        paths.append((n, f))
print('rendered', len(paths), 'pages')
if a.sheet:
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 22)
    for s in range(0, len(paths), a.sheet):
        chunk = paths[s:s + a.sheet]
        ims = [Image.open(f) for _, f in chunk]
        w, h = ims[0].size
        cols = len(ims)
        sheet = Image.new('RGB', (cols * (w + 8) + 8, h + 40), 'white')
        d = ImageDraw.Draw(sheet)
        for k, ((n, _), im) in enumerate(zip(chunk, ims)):
            x = 8 + k * (w + 8)
            d.text((x, 8), f'PDF p{n}', fill='red', font=font)
            sheet.paste(im, (x, 34)); d.rectangle((x - 1, 33, x + w, 34 + h), outline='gray')
        sheet.save(out / f'sheet_{chunk[0][0]:03d}.png')
    print('sheets done')
