"""Build chapter 4 figures: two-semester Gantt chart and GitHub commit record.

Gantt planned bars and first-semester actual bars are copied from the 2026-06-02
initial-review Gantt chart. Second-semester actual bars (Jul–Sep 2026) follow the
monthly commit activity of the matching repository paths; Oct–Dec only carries the
school-announced milestones (115-1 專題時程規劃). The GitHub figure counts every commit
on origin/main per author e-mail, which matches GitHub's contributor statistics.

Usage: python build_ch04_figures.py   (run inside the repository; needs git)
"""
import datetime as dt
import json
import subprocess
from collections import Counter
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

MANUAL = Path(__file__).resolve().parents[1]
REPO = MANUAL.parents[2]
OUT = MANUAL / 'images'
FONT = 'C:/Windows/Fonts/kaiu.ttf'
PLAN, ACTUAL, GRID, NOW = (165, 102, 216), (171, 230, 187), (0, 0, 0), (215, 40, 40)

# (task, planned month ranges, actual month ranges); months 2..12 of 2026.
GANTT = [
    ('主題構思', [(2, 3)], [(2, 3)]),
    ('相關資料蒐集', [(3, 4)], [(3, 4)]),
    ('開發工具學習', [(2, 3)], [(2, 2)]),
    ('系統功能分析', [(3, 4)], [(3, 4)]),
    ('系統模型', [(4, 4)], [(3, 4)]),
    ('UI/UX 設計', [(4, 5)], [(4, 5)]),
    ('Logo 設計', [(4, 4)], [(4, 4)]),
    ('Web 開發（前端）', [(5, 11)], [(4, 6), (7, 9)]),
    ('資料庫設計', [(3, 4)], [(3, 4)]),
    ('資料庫建立', [(4, 6)], [(4, 5), (7, 9)]),
    ('後端開發', [(4, 11)], [(4, 6), (7, 9)]),
    ('系統測試', [(6, 11)], [(6, 6), (7, 9)]),
    ('系統整合', [(5, 11)], [(5, 6), (7, 9)]),
    ('初審操作手冊', [(3, 5)], [(3, 6)]),
    ('複審操作手冊', [(9, 10)], [(9, 9)]),
    ('系統簡報', [(5, 6), (10, 11)], [(5, 5)]),
    ('複評發表', [(10, 10)], []),
    ('校內觀摩展', [(11, 11)], []),
    ('最終文件繳交', [(12, 12)], []),
]

MEMBERS = [  # e-mail, 學號, 姓名, GitHub 帳號
    ('11246084@ntub.edu.tw', '11246084', '鍾百陶', '11246084'),
    ('11246062@ntub.edu.tw', '11246062', '邱偉豪', 'Hao-weii'),
    ('11246064@ntub.edu.tw', '11246064', '張庭語', '11246064-hash'),
    ('11246085@ntub.edu.tw', '11246085', '張家瑜', '4ISHo0o0'),
]
ALIASES = {'h4533288@gmail.com': '11246062@ntub.edu.tw'}


def font(size):
    return ImageFont.truetype(FONT, size)


def gantt():
    label_w, month_w, row_h, head_h = 330, 118, 30, 110
    months = list(range(2, 13))
    w = label_w + month_w * len(months) + 20
    h = head_h + row_h * 2 * len(GANTT) + 90
    im = Image.new('RGB', (w, h), 'white')
    d = ImageDraw.Draw(im)
    x0 = label_w
    # Semester band.
    bands = [(2, 6, '114 學年度第 2 學期'), (7, 8, '暑假'), (9, 12, '115 學年度第 1 學期')]
    for a, b, text in bands:
        left, right = x0 + (a - 2) * month_w, x0 + (b - 1) * month_w
        d.rectangle((left, 10, right, 55), outline=GRID, width=2, fill=(242, 242, 242))
        d.text(((left + right) / 2, 33), text, font=font(26), fill=GRID, anchor='mm')
    d.rectangle((0, 55, x0, head_h), outline=GRID, width=2)
    d.text((x0 / 2, (55 + head_h) / 2), '工作項目', font=font(28), fill=GRID, anchor='mm')
    for i, m in enumerate(months):
        left = x0 + i * month_w
        d.rectangle((left, 55, left + month_w, head_h), outline=GRID, width=2)
        d.text((left + month_w / 2, (55 + head_h) / 2), f'{m} 月', font=font(28), fill=GRID, anchor='mm')
    y = head_h
    for task, plan, actual in GANTT:
        d.rectangle((0, y, x0, y + 2 * row_h), outline=GRID, width=2)
        d.text((14, y + row_h), task, font=font(28), fill=GRID, anchor='lm')
        for k, ranges in enumerate((plan, actual)):
            top = y + k * row_h
            for a, b in ranges:
                d.rectangle((x0 + (a - 2) * month_w, top, x0 + (b - 1) * month_w, top + row_h),
                            fill=PLAN if k == 0 else ACTUAL)
            for i in range(len(months)):
                d.rectangle((x0 + i * month_w, top, x0 + (i + 1) * month_w, top + row_h), outline=GRID, width=1)
        y += 2 * row_h
    # Progress line after September.
    xn = x0 + 8 * month_w
    for yy in range(head_h, y, 16):
        d.line((xn, yy, xn, min(yy + 9, y)), fill=NOW, width=4)
    d.text((xn + 8, head_h + 6), '截至 9 月底', font=font(24), fill=NOW, anchor='la')
    # Legend.
    ly = y + 30
    for i, (color, text) in enumerate([(PLAN, '預期進度'), (ACTUAL, '實際進度')]):
        lx = 20 + i * 260
        d.rectangle((lx, ly, lx + 70, ly + 30), fill=color, outline=GRID)
        d.text((lx + 84, ly + 15), text, font=font(28), fill=GRID, anchor='lm')
    d.line((560, ly + 15, 620, ly + 15), fill=NOW, width=4)
    d.text((634, ly + 15), '目前進度（2026 年 9 月 30 日）', font=font(28), fill=GRID, anchor='lm')
    out = OUT / '圖4-1-1-專案時程甘特圖-v2-0.png'
    im.save(out, optimize=True)
    return out.name


def git_commits():
    log = subprocess.run(['git', 'log', 'origin/main', '--format=%ae|%ad', '--date=short'],
                         cwd=REPO, capture_output=True, text=True, check=True).stdout.split()
    head = subprocess.run(['git', 'rev-parse', '--short', 'origin/main'], cwd=REPO,
                          capture_output=True, text=True, check=True).stdout.strip()
    rows = []
    for line in log:
        mail, day = line.split('|')
        rows.append((ALIASES.get(mail, mail), dt.date.fromisoformat(day)))
    return head, rows


def github_chart():
    head, rows = git_commits()
    start = min(day for _, day in rows)
    start -= dt.timedelta(days=(start.weekday() + 1) % 7)  # week starts on Sunday, as on GitHub
    end = max(day for _, day in rows)
    weeks = (end - start).days // 7 + 1
    week_of = lambda day: (day - start).days // 7
    total = Counter(week_of(day) for _, day in rows)
    per = {m[0]: Counter(week_of(day) for mail, day in rows if mail == m[0]) for m in MEMBERS}
    counts = {m[0]: sum(1 for mail, _ in rows if mail == m[0]) for m in MEMBERS}

    W, pad = 2000, 60
    panel_h, small_h = 360, 300
    H = 140 + panel_h + 2 * (small_h + 120) + 40
    im = Image.new('RGB', (W, H), 'white')
    d = ImageDraw.Draw(im)
    blue, axis = (31, 111, 235), (90, 90, 90)

    def bars(x0, y0, w, h, counter, peak, title, subtitle):
        d.rounded_rectangle((x0, y0, x0 + w, y0 + h + 90), radius=12, outline=(200, 200, 200), width=2)
        d.text((x0 + 24, y0 + 22), title, font=font(34), fill='black')
        d.text((x0 + 24, y0 + 66), subtitle, font=font(24), fill=axis)
        gx0, gy1, gw, gh = x0 + 30, y0 + h + 40, w - 80, h - 100
        d.line((gx0, gy1, gx0 + gw, gy1), fill=axis, width=2)
        step = gw / weeks
        for i in range(weeks):
            v = counter.get(i, 0)
            if v:
                bh = gh * v / peak
                d.rectangle((gx0 + i * step + 2, gy1 - bh, gx0 + (i + 1) * step - 2, gy1), fill=blue)
        for i in range(0, weeks, 4):
            day = start + dt.timedelta(days=7 * i)
            d.text((gx0 + i * step, gy1 + 10), f'{day.month}/{day.day}', font=font(20), fill=axis, anchor='ma')
        d.text((gx0 + gw + 6, gy1 - gh), str(peak), font=font(20), fill=axis, anchor='lm')
        d.text((gx0 + gw + 6, gy1), '0', font=font(20), fill=axis, anchor='lm')

    peak = max(total.values())
    bars(pad, 40, W - 2 * pad, panel_h, total, peak, '全組每週提交次數',
         f'FocusFlow 主分支（main，{head}）{start:%Y/%m/%d}～{end:%Y/%m/%d}，共 {len(rows)} 次提交')
    small_w = (W - 2 * pad - 40) // 2
    member_peak = max(max(c.values(), default=0) for c in per.values())
    for i, (mail, sid, name, login) in enumerate(MEMBERS):
        x = pad + (i % 2) * (small_w + 40)
        y = 40 + panel_h + 130 + (i // 2) * (small_h + 120)
        bars(x, y, small_w, small_h, per[mail], member_peak, f'{sid} {name}',
             f'GitHub 帳號 {login}　提交 {counts[mail]} 次')
    out = OUT / '圖4-3-6-兩學期每週提交次數-v1-0.png'
    im.save(out, optimize=True)
    report = {'ref': f'origin/main {head}', 'first': str(min(day for _, day in rows)), 'last': str(end),
              'total': len(rows), 'members': {sid: counts[mail] for mail, sid, *_ in MEMBERS}}
    return out.name, report


def github_screens(src):
    """Label GitHub screenshots (captured 2026-09-30) with 學號／姓名, as in the initial review.

    src/2.png contributors graph, 3.png contributor cards, 4–7.png contribution calendars.
    Calendar owners were matched by comparing each calendar's active days with the
    members' per-day commits on origin/main (Jaccard 0.81–0.95).
    """
    graph, cards = Image.open(src / '2.png').convert('RGB'), Image.open(src / '3.png').convert('RGB')
    d = ImageDraw.Draw(cards)
    for x, y, text in [(184, 34, '11246062 邱偉豪'), (757, 34, '11246084 鍾百陶'),
                       (238, 330, '11246064 張庭語'), (762, 330, '11246085 張家瑜')]:
        d.rectangle((x, y, x + 178, y + 34), fill='white', outline='black', width=2)
        d.text((x + 89, y + 17), text, font=font(21), fill='black', anchor='mm')
    w = max(graph.width, cards.width)
    canvas = Image.new('RGB', (w, graph.height + cards.height + 12), 'white')
    canvas.paste(graph, (0, 0)); canvas.paste(cards, (0, graph.height + 12))
    names = ['圖4-3-1-GitHub貢獻者統計-v2-0.png']
    canvas.save(OUT / names[0], optimize=True)
    for file, name in [('5.png', '圖4-3-2-邱偉豪GitHub紀錄-v2-0.png'), ('4.png', '圖4-3-3-鍾百陶GitHub紀錄-v2-0.png'),
                       ('6.png', '圖4-3-4-張家瑜GitHub紀錄-v2-0.png'), ('7.png', '圖4-3-5-張庭語GitHub紀錄-v2-0.png')]:
        Image.open(src / file).convert('RGB').save(OUT / name, optimize=True)
        names.append(name)
    return names


if __name__ == '__main__':
    import sys
    print(gantt())
    name, report = github_chart()
    print(name, json.dumps(report, ensure_ascii=False))
    if len(sys.argv) > 1:
        print(github_screens(Path(sys.argv[1])))
