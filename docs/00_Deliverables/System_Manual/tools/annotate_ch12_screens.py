"""Build chapter 12 screenshots: red call-out boxes, numbered badges and privacy mosaics.

Sources are team screenshots (the Notion chapter-12 page and 2026-09-30 production
captures). Coordinates are in each source image's own pixel frame. Output files follow
the manual naming rule 圖{章}-{節}-{序}-{名稱}-v1-0.png under images/.

Usage: python annotate_ch12_screens.py <notion_dir> <capture_dir> <extra_dir>
extra_dir holds the forgot-password captures (12.png, 13.png, 14.png).
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

MANUAL = Path(__file__).resolve().parents[1]
OUT = MANUAL / 'images'
RED = (230, 30, 30)
FONT = 'C:/Windows/Fonts/arialbd.ttf'

notion_dir, capture_dir, extra_dir = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])


def src(name):
    if name.startswith('t12-'):
        return notion_dir / f'{name}.png'
    return capture_dir / f'螢幕擷取畫面 2026-09-30 {name}.png'


def mosaic(im, box, blocks=None):
    region = im.crop(box)
    w, h = region.size
    size = (blocks, max(1, round(blocks * h / w))) if blocks else (max(1, w // 14), max(1, h // 14))
    small = region.resize(size, Image.BILINEAR)
    im.paste(small.resize((w, h), Image.NEAREST).filter(ImageFilter.GaussianBlur(2)), box[:2])


# 授課教師的臉（課程影片的視訊畫面、教學短片）：公開 repo 不顯示可辨識的人臉。
# 以來源截圖的座標記錄，任何圖組合前都先遮蔽。
FACES = {
    't12-1-9_1': [(383, 140, 454, 213)],
    't12-1-11_2': [(536, 245, 583, 289)],
    't12-1-12_1': [(308, 178, 397, 274)],
    't12-1-12_2': [(302, 246, 422, 408), (28, 48, 172, 232)],
    't12-1-13_2': [(163, 434, 221, 480)],
}


def annotate(im, boxes):
    draw = ImageDraw.Draw(im)
    scale = max(im.width, 700) / 1917
    width = max(3, round(5 * scale))
    radius = max(12, round(19 * scale))
    font = ImageFont.truetype(FONT, max(14, round(24 * scale)))
    for number, (x0, y0, x1, y1) in enumerate(boxes, 1):
        draw.rounded_rectangle((x0, y0, x1, y1), radius=max(4, round(8 * scale)), outline=RED, width=width)
        cx = min(max(x0, radius + 2), im.width - radius - 2)
        cy = min(max(y0, radius + 2), im.height - radius - 2)
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=RED, outline='white', width=2)
        draw.text((cx, cy), str(number), fill='white', font=font, anchor='mm')


def load(name, blur=()):
    im = Image.open(src(name)).convert('RGB')
    for box in blur:
        mosaic(im, box)
    for box in FACES.get(name, []):
        mosaic(im, box, blocks=5)
    return im


def stack(images, vertical=True, gap=16, height=None):
    if not vertical and height:
        images = [i.resize((round(i.width * height / i.height), height), Image.LANCZOS) for i in images]
    if vertical:
        w = max(i.width for i in images); h = sum(i.height for i in images) + gap * (len(images) - 1)
    else:
        w = sum(i.width for i in images) + gap * (len(images) - 1); h = max(i.height for i in images)
    canvas = Image.new('RGB', (w, h), 'white')
    pos = 0
    for i in images:
        canvas.paste(i, (0, pos) if vertical else (pos, 0))
        pos += (i.height if vertical else i.width) + gap
    return canvas


FIGURES = [
    # ---- 12-2 登入與共用功能
    ('圖12-2-1-學生註冊畫面', 't12-1-2_1', [(1088, 238, 1472, 604), (1090, 632, 1472, 692), (1296, 704, 1360, 727)],
     [(1100, 272, 1460, 318), (1100, 364, 1460, 410)]),
    ('圖12-2-2-學生與教師登入畫面', 't12-1-1_1', [(1083, 274, 1465, 329), (1083, 352, 1465, 534), (1083, 564, 1465, 625),
                                         (1372, 443, 1465, 474), (1208, 636, 1340, 662)], []),
    ('圖12-2-3-忘記密碼流程', ('forgot',), [], []),
    ('圖12-2-4-管理員登入畫面', 't12-1-4_1', [], []),
    ('圖12-2-5-共用功能位置', 't12-1-3_2', [(1668, 6, 1714, 50), (1716, 4, 1768, 54), (4, 824, 226, 900),
                                    (1630, 850, 1766, 904), (1630, 906, 1766, 960), (8, 904, 92, 950)], []),
    # ---- 12-3 學生操作
    ('圖12-3-1-學生總覽', 't12-1-6_1', [(278, 86, 1766, 216), (280, 260, 1017, 638), (1028, 260, 1764, 638), (1586, 670, 1742, 719)], []),
    ('圖12-3-2-我的課程清單', 't12-1-7_1', [(1551, 156, 1655, 396), (1446, 156, 1550, 396), (348, 190, 682, 408)], []),
    ('圖12-3-3-課程影片與AI問答區', 't12-1-7_2', [(1030, 68, 1772, 584), (274, 70, 1022, 492), (274, 598, 1002, 972), (920, 612, 1000, 648)], []),
    ('圖12-3-4-輸入問題與等待回答', ('stack', ['t12-1-8_1', 't12-1-8_2']), [], []),
    ('圖12-3-5-AI回答與參考片段', 't12-1-8_3', [], []),
    ('圖12-3-6-點選片段跳轉影片', 't12-1-9_1', [], []),
    ('圖12-3-7-多輪問答與最近對話', ('stack', ['t12-1-10_1', 't12-1-10_2']), [(248, 78, 736, 152), (676, 4, 738, 32)], []),
    ('圖12-3-8-LINE綁定指引', 't12-1-11_1', [(84, 112, 408, 248), (428, 110, 570, 310), (82, 296, 408, 342)], []),
    ('圖12-3-9-LINE綁定成功', 't12-1-11_2', [], []),
    ('圖12-3-10-詢問助教與LINE提問', ('row', ['t12-1-13_1', 't12-1-13_2', 't12-1-13_3']), [], []),
    ('圖12-3-11-教學短片牆', 't12-1-12_1', [(280, 40, 410, 362)], []),
    ('圖12-3-12-教學短片播放', 't12-1-12_2', [], []),
    # ---- 12-4 教師操作
    ('圖12-4-1-教師總覽', '112138', [(30, 158, 292, 430), (355, 108, 1890, 263), (1022, 308, 1098, 342), (355, 787, 1890, 886)], []),
    ('圖12-4-2-課程列表', '112213', [(1745, 105, 1891, 158), (376, 244, 410, 482), (1746, 242, 1802, 484), (1806, 242, 1864, 484)], []),
    ('圖12-4-3-展開課程影片', '112303', [(1722, 418, 1862, 458), (426, 494, 1862, 910), (1782, 508, 1846, 552)], []),
    ('圖12-4-4-修課學生管理', '112319', [(16, 176, 712, 230), (16, 238, 154, 284), (610, 406, 696, 856)],
     [(30, 404, 400, 866)]),
    ('圖12-4-5-刪除課程確認', '112349', [(912, 436, 1332, 598), (1120, 614, 1328, 668)], []),
    ('圖12-4-6-上傳影片', '112408', [(356, 161, 1034, 440), (1058, 190, 1737, 258), (1058, 300, 1737, 368),
                               (1058, 388, 1737, 455), (356, 455, 1034, 690)], []),
    ('圖12-4-7-短影片腳本內容', '112500', [(1285, 104, 1889, 158), (356, 176, 1034, 484), (356, 508, 1034, 1020),
                                  (1058, 178, 1887, 242), (1080, 385, 1382, 434), (1080, 498, 1469, 551)], []),
    ('圖12-4-8-建立新腳本', '112552', [(356, 478, 1034, 545), (1080, 354, 1217, 407)], []),
    ('圖12-4-9-成品上傳', '112519', [(1468, 80, 1887, 142), (1083, 411, 1862, 582), (1083, 595, 1862, 795),
                               (1083, 812, 1862, 977), (1083, 988, 1262, 1032)], []),
    ('圖12-4-10-成品送審結果', '112647', [(28, 686, 834, 760), (28, 798, 382, 862)], []),
    ('圖12-4-11-選擇待審短影片', '112719', [(356, 114, 1010, 168), (356, 183, 1862, 260)], []),
    ('圖12-4-12-審核決定', '112734', [(378, 838, 528, 864), (378, 913, 770, 982)], []),
    ('圖12-4-13-不通過理由', '112820', [(1106, 88, 1814, 707), (1106, 718, 1478, 780)], []),
    ('圖12-4-14-確認送出審核', '112836', [(378, 408, 1858, 528), (378, 546, 769, 614)], []),
    # ---- 12-5 管理員操作
    ('圖12-5-1-系統總覽', '112912', [(356, 108, 1890, 264), (356, 281, 1115, 725), (1038, 310, 1094, 340), (1129, 281, 1890, 725)], []),
    ('圖12-5-2-使用者管理', '112935', [(1766, 230, 1828, 1004), (1744, 106, 1887, 155)], [(372, 232, 905, 1012)]),
    ('圖12-5-3-課程管理', '112948', [(1746, 110, 1890, 162), (1531, 238, 1592, 408), (1593, 238, 1654, 408), (1655, 238, 1717, 408)], []),
    ('圖12-5-4-編輯課程', '113103', [(28, 348, 487, 398), (28, 438, 487, 488), (368, 510, 487, 560)], []),
    ('圖12-5-5-影片管理', '113537', [(1268, 238, 1482, 1030), (1745, 236, 1804, 1030)], []),
    ('圖12-5-6-問題回報', ('inset', '113604', '113617', (1650, 660)), [(1306, 108, 1742, 160), (1492, 248, 1607, 645), (1650, 660, 1880, 947)], []),
    ('圖12-5-7-使用統計', '113632', [(356, 161, 1887, 500), (383, 538, 1860, 1030)], [(836, 978, 900, 1008)]),
]


def numbered(im, marks):
    """Draw boxes with explicit step numbers (for figures composed of several panels)."""
    draw = ImageDraw.Draw(im)
    font = ImageFont.truetype(FONT, 22)
    for number, (x0, y0, x1, y1) in marks:
        draw.rounded_rectangle((x0, y0, x1, y1), radius=8, outline=RED, width=4)
        cx, cy = max(x0, 17), max(y0, 17)
        draw.ellipse((cx - 16, cy - 16, cx + 16, cy + 16), fill=RED, outline='white', width=2)
        draw.text((cx, cy), str(number), fill='white', font=font, anchor='mm')
    return im


def forgot_password():
    """忘記密碼：輸入 Email → 收信 → 輸入驗證碼與新密碼（2026-09-30 正式站截圖）。

    Step numbers follow the order of use, so they run across the three panels.
    The (already expired) verification code in the e-mail is masked.
    """
    email = Image.open(extra_dir / '12.png').convert('RGB')
    reset = Image.open(extra_dir / '13.png').convert('RGB')
    mail = Image.open(extra_dir / '14.png').convert('RGB')
    mosaic(mail, (335, 352, 408, 374), blocks=6)
    numbered(email, [(1, (33, 160, 490, 222)), (2, (33, 240, 490, 300))])
    numbered(mail, [(3, (78, 350, 520, 400))])
    numbered(reset, [(4, (36, 152, 494, 214)), (5, (36, 232, 494, 372)),
                     (6, (36, 390, 494, 450)), (7, (136, 464, 386, 496))])
    top = stack([email, reset], vertical=False, gap=24)
    mail = mail.resize((top.width, round(mail.height * top.width / mail.width)), Image.LANCZOS)
    return stack([top, mail], gap=24)


def build(spec, blur):
    if isinstance(spec, str):
        return load(spec, blur)
    kind = spec[0]
    if kind == 'forgot':
        return forgot_password()
    if kind == 'stack':
        return stack([load(n) for n in spec[1]])
    if kind == 'row':
        return stack([load(n) for n in spec[1]], vertical=False, height=570)
    if kind == 'inset':
        base, inset = load(spec[1], blur), load(spec[2])
        inset = inset.resize((round(inset.width * 1.3), round(inset.height * 1.3)), Image.LANCZOS)
        base.paste(inset, spec[3])
        return base
    raise ValueError(kind)


def main():
    OUT.mkdir(exist_ok=True)
    for name, spec, boxes, blur in FIGURES:
        im = build(spec, blur)
        annotate(im, boxes)
        out = OUT / f'{name}-v1-0.png'
        im.save(out, optimize=True)
        print(out.name, im.size)


if __name__ == '__main__':
    main()
