"""第 2 章圖2-2-1 商業模式九宮格重繪腳本。

ai-assisted: Claude Code（Claude Opus 5），AI-DOC-20260919。
內容與正文表2-2-1 一致；修改九宮格時兩處需同步。

執行：python business_model_canvas.py（需 matplotlib；輸出至 ../../images/）
"""
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import Rectangle  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "images" / "圖2-2-1-FocusFlow商業模式-v1-0.png"

plt.rcParams.update({"font.family": ["Times New Roman", "DFKai-SB"]})

INK = "#0b0b0b"
EDGE = "#52514e"
# 淺色底：供給面（藍）、價值（白）、需求面（橘）、財務（綠）；黑白列印時靠框線與標題辨識
BLUE, WHITE, ORANGE, GREEN = "#e3eefb", "#ffffff", "#fdeee3", "#e6f4ea"

# (x, y, w, h, 標題, 項目, 底色)；畫布為 10 x 7 單位
CELLS = [
    (0, 2, 2, 5, "關鍵合作夥伴", ["授課教師", "校內教學與資訊單位", "Google Gemini", "YouTube", "LINE", "MongoDB Atlas"], BLUE),
    (2, 4.5, 2, 2.5, "關鍵活動", ["影片處理與知識化", "問答品質監測與改善", "權限與資料治理", "系統維運"], BLUE),
    (2, 2, 2, 2.5, "關鍵資源", ["系統程式與 AI Pipeline", "教師授權的課程影片", "雲端與 AI 服務帳號", "維運環境"], BLUE),
    (4, 2, 2, 5, "價值主張", ["學生：用問題找到\n教師講解的片段", "回答附時間點，\n可回影片核對", "教師與助教：\n減少重複答疑", "學校：提高課程錄影\n再利用價值"], WHITE),
    (6, 4.5, 2, 2.5, "顧客關係", ["教師自行建課與管理名單", "試用回饋與問題回報", "持續改善問答品質"], ORANGE),
    (6, 2, 2, 2.5, "通路", ["FocusFlow 網頁", "LINE Bot", "校內課程試用", "教師推薦"], ORANGE),
    (8, 2, 2, 5, "目標客群", ["有課程錄影的\n大專院校教師", "修課學生", "後續：他校與\n線上課程提供者"], ORANGE),
    (0, 0, 5, 2, "成本結構", ["模型與向量化 API 費用", "資料庫與主機", "語音轉文字運算", "維運人力"], GREEN),
    (5, 0, 5, 2, "收益流", ["第一階段：校內試用，不收費", "第二階段：他校推廣", "第三階段：學校授權／SaaS 訂閱"], GREEN),
]


def wrap(text):
    """項目內以換行字元指定斷行位置，避免自動換行把單字擠到下一行。"""
    return text.split("\n")


def main():
    fig, ax = plt.subplots(figsize=(13, 9.1), dpi=200)
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 7)
    ax.axis("off")

    for x, y, w, h, title, items, color in CELLS:
        ax.add_patch(Rectangle((x, y), w, h, facecolor=color, edgecolor=EDGE, lw=1.2))
        ax.text(x + w / 2, y + h - 0.22, title, ha="center", va="center",
                fontsize=16, color=INK)
        line_h = 0.3
        cursor = y + h - 0.6
        for item in items:
            parts = wrap(item)
            for i, part in enumerate(parts):
                prefix = "• " if i == 0 else "   "
                ax.text(x + 0.12, cursor, prefix + part, ha="left", va="center",
                        fontsize=12, color=INK)
                cursor -= line_h
            cursor -= 0.06

    fig.tight_layout(pad=0.3)
    fig.savefig(OUT, facecolor="white")
    plt.close(fig)
    print("wrote", OUT.name)


if __name__ == "__main__":
    main()
