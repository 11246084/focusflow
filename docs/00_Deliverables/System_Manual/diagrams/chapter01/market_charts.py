"""第 1 章市場圖（圖1-2-1、圖1-2-2）重繪腳本。

ai-assisted: Claude Code（Claude Opus 5），AI-DOC-20260919。
數據只取報告公開的起訖年數值與 CAGR，不自行內插中間年份
（出版商未公開逐年數值，且以起訖值反推的 CAGR 與報告標示值不完全一致）。

執行：python market_charts.py（需 matplotlib；輸出至 ../../images/）
"""
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

OUT_DIR = Path(__file__).resolve().parents[2] / "images"

plt.rcParams.update({
    # 英數用 Times New Roman，中文退回標楷體，與手冊字型規範一致
    "font.family": ["Times New Roman", "DFKai-SB"],
    "axes.unicode_minus": False,
})

BAR = "#2a78d6"
BAR_LIGHT = "#9ec5f0"
INK = "#0b0b0b"
INK_2 = "#52514e"
GRID = "#e4e3df"

CHARTS = [
    {
        "file": "圖1-2-1-台灣線上教育市場規模-v1-0.png",
        "title": "台灣線上教育市場規模預估",
        "years": ["2025", "2034（預估）"],
        "values": [7.774, 51.079],
        "cagr": "年複合成長率 22.57%\n（2026–2034）",
        "source": "資料來源：IMARC Group（2026），Taiwan Online Education Market Size, Share, Trends and Forecast, 2026–2034。本組依公開數值重繪。",
    },
    {
        "file": "圖1-2-2-全球MOOCs市場規模-v1-0.png",
        "title": "全球 MOOCs 市場規模預估",
        "years": ["2024", "2034（預估）"],
        "values": [260, 6843],
        "cagr": "年複合成長率 39.3%\n（2025–2034）",
        "source": "資料來源：Global Market Insights（2025），Massive Open Online Courses (MOOCs) Market Forecast 2025–2034。本組依公開數值重繪。",
    },
]


def fmt(v):
    return f"{v:,.3f}".rstrip("0").rstrip(".") if v < 100 else f"{v:,.0f}"


def draw(spec):
    fig, ax = plt.subplots(figsize=(8, 5), dpi=200)
    fig.patch.set_facecolor("white")
    x = [0, 1]
    ax.bar(x, spec["values"], width=0.5, color=[BAR_LIGHT, BAR], zorder=2)

    top = max(spec["values"])
    for xi, v in zip(x, spec["values"]):
        ax.text(xi, v + top * 0.02, f"{fmt(v)} 億美元", ha="center", va="bottom",
                fontsize=14, color=INK)

    # 起訖之間的成長箭頭與 CAGR 標註
    ax.annotate("", xy=(0.78, top * 0.82), xytext=(0.22, spec["values"][0] + top * 0.12),
                arrowprops=dict(arrowstyle="-|>", color=INK_2, lw=1.5,
                                connectionstyle="arc3,rad=-0.2"), zorder=3)
    ax.text(0.42, top * 0.62, spec["cagr"], ha="center", va="center", fontsize=13,
            color=INK, bbox=dict(boxstyle="round,pad=0.4", fc="white", ec=GRID))

    ax.set_xticks(x, spec["years"], fontsize=13, color=INK)
    ax.set_ylabel("市場規模（億美元）", fontsize=12, color=INK_2)
    ax.set_ylim(0, top * 1.15)
    ax.set_xlim(-0.6, 1.6)
    ax.tick_params(axis="y", labelsize=11, colors=INK_2)
    ax.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v:,.0f}"))
    ax.grid(axis="y", color=GRID, lw=0.8, zorder=0)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(INK_2)

    ax.set_title(spec["title"], fontsize=16, color=INK, pad=14)
    fig.text(0.02, 0.015, spec["source"], fontsize=9, color=INK_2, ha="left", va="bottom")
    fig.tight_layout(rect=(0, 0.05, 1, 1))
    fig.savefig(OUT_DIR / spec["file"])
    plt.close(fig)


if __name__ == "__main__":
    for chart in CHARTS:
        draw(chart)
        print("wrote", chart["file"])
