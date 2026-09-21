"""第 3 章圖3-1-1 系統架構圖（非 UML）重繪腳本。

ai-assisted: Claude Code（Claude Opus 5），AI-DOC-20260919。
依 2026-09-19 查證的現況繪製：repository 程式碼、.github/workflows/deploy.yml、
正式站回應標頭與正式後端 /health（經 ngrok 通道唯讀讀取）。架構改變時需同步更新。

執行：python system_architecture.py（需 matplotlib；輸出至 ../../images/）
"""
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "images" / "圖3-1-1-系統架構圖-v1-0.png"

plt.rcParams.update({"font.family": ["Times New Roman", "DFKai-SB"]})

INK = "#0b0b0b"
INK_2 = "#52514e"
LINE_C = "#3d3d3a"
ZONE_USER = "#fdeee3"
ZONE_VM = "#e3eefb"
ZONE_EXT = "#e6f4ea"
BOX = "#ffffff"


def zone(ax, x, y, w, h, title, color):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0,rounding_size=0.15",
                                facecolor=color, edgecolor=INK_2, lw=1.2, linestyle="--"))
    ax.text(x + 0.15, y + h - 0.25, title, ha="left", va="center", fontsize=14, color=INK)


def box(ax, cx, cy, w, h, title, sub=None):
    ax.add_patch(FancyBboxPatch((cx - w / 2, cy - h / 2), w, h,
                                boxstyle="round,pad=0,rounding_size=0.08",
                                facecolor=BOX, edgecolor=LINE_C, lw=1.3))
    if sub:
        extra = 0.13 * sub.count("\n")  # 說明文字行數多時，標題與說明各自往外推
        ax.text(cx, cy + 0.17 + extra, title, ha="center", va="center", fontsize=13, color=INK)
        ax.text(cx, cy - 0.2 - extra * 0.4, sub, ha="center", va="center", fontsize=10.5,
                color=INK_2, linespacing=1.3)
    else:
        ax.text(cx, cy, title, ha="center", va="center", fontsize=13, color=INK)


def arrow(ax, p1, p2, label=None, lpos=0.5, loff=(0, 0.14), dashed=False, both=False, rad=0.0):
    style = "<|-|>" if both else "-|>"
    ax.add_patch(FancyArrowPatch(p1, p2, arrowstyle=style, mutation_scale=13, color=LINE_C,
                                 lw=1.2, linestyle=(0, (4, 3)) if dashed else "-",
                                 connectionstyle=f"arc3,rad={rad}", shrinkA=2, shrinkB=2))
    if label:
        lx = p1[0] + (p2[0] - p1[0]) * lpos + loff[0]
        ly = p1[1] + (p2[1] - p1[1]) * lpos + loff[1]
        ax.text(lx, ly, label, ha="center", va="center", fontsize=10, color=INK,
                bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none"))


def polyline_arrow(ax, pts, label=None, label_at=None):
    xs, ys = zip(*pts[:-1])
    ax.plot(xs, ys, color=LINE_C, lw=1.2)
    arrow(ax, pts[-2], pts[-1])
    if label:
        ax.text(*label_at, label, ha="center", va="center", fontsize=10, color=INK,
                bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none"))


def main():
    fig, ax = plt.subplots(figsize=(16, 10), dpi=170)
    ax.set_xlim(0, 20)
    ax.set_ylim(0, 12.5)
    ax.axis("off")

    # 分區
    zone(ax, 0.2, 2.2, 3.6, 10.0, "使用者端", ZONE_USER)
    zone(ax, 4.6, 2.2, 9.0, 10.0, "學校虛擬機（Rocky Linux 9）", ZONE_VM)
    zone(ax, 14.4, 2.2, 5.4, 10.0, "外部雲端服務", ZONE_EXT)

    # 使用者端
    box(ax, 2.0, 10.4, 3.0, 0.95, "學生", "瀏覽器")
    box(ax, 2.0, 9.0, 3.0, 0.95, "教師", "瀏覽器")
    box(ax, 2.0, 7.6, 3.0, 0.95, "管理員", "瀏覽器（/admin 入口）")
    box(ax, 2.0, 3.4, 3.0, 0.95, "學生", "LINE App")

    # 虛擬機
    box(ax, 7.0, 9.0, 3.9, 1.5, "nginx", "HTTPS 443、Let's Encrypt 憑證\n提供 React 前端靜態檔\n/api 反向代理至後端")
    box(ax, 11.3, 7.2, 4.2, 1.5, "Express 後端（PM2）", "port 4000：REST API、身分與權限、\n問答、LINE、通知、統計、管理")
    box(ax, 11.3, 4.4, 3.8, 1.3, "AI Pipeline（Python）", "FFmpeg、Faster-Whisper、\n逐字稿分段與 embedding")
    box(ax, 7.0, 3.4, 3.6, 1.3, "ngrok 通道", "LINE Webhook 對外入口\n（繞過學校防火牆）")

    # 外部服務
    box(ax, 17.1, 10.6, 4.6, 1.1, "YouTube", "後端上傳（不公開）；瀏覽器嵌入播放")
    box(ax, 17.1, 9.0, 4.6, 1.1, "Google Gemini API", "問題與片段 embedding、生成回答")
    box(ax, 17.1, 7.4, 4.6, 1.1, "MongoDB Atlas", "應用資料、逐字稿片段、向量搜尋")
    box(ax, 17.1, 5.8, 4.6, 1.1, "SMTP 郵件服務", "忘記密碼驗證信")
    box(ax, 17.1, 3.4, 4.6, 1.1, "LINE Platform", "Messaging API")

    # 使用者 → nginx → 後端
    for y in (10.4, 9.0, 7.6):
        arrow(ax, (3.5, y), (5.05, 9.0))
    ax.text(4.3, 10.05, "HTTPS", ha="center", va="center", fontsize=10, color=INK)
    arrow(ax, (8.95, 8.6), (9.2, 7.7), "/api/", lpos=0.5, loff=(-0.45, 0))

    # 後端 → 外部服務
    arrow(ax, (13.4, 7.9), (14.8, 10.4))
    arrow(ax, (13.4, 7.6), (14.8, 9.0))
    arrow(ax, (13.4, 7.2), (14.8, 7.4), both=True)
    arrow(ax, (13.4, 6.8), (14.8, 5.9))
    arrow(ax, (13.4, 6.55), (14.8, 3.7), "回覆", lpos=0.55, loff=(0.3, 0.1))

    # 後端 ↔ Pipeline
    arrow(ax, (10.8, 6.45), (10.8, 5.05), "啟動處理", lpos=0.5, loff=(-0.6, 0))
    arrow(ax, (11.8, 5.05), (11.8, 6.45), "狀態回報", lpos=0.5, loff=(0.6, 0), dashed=True)
    # Pipeline → Gemini、Atlas
    arrow(ax, (13.2, 4.7), (14.8, 8.7), rad=0.18)
    arrow(ax, (13.2, 4.3), (14.8, 7.1), rad=0.18)

    # LINE：App → Platform（走下方）→ ngrok → 後端
    polyline_arrow(ax, [(2.0, 2.92), (2.0, 1.55), (17.1, 1.55), (17.1, 2.85)],
                   "傳送訊息", (9.5, 1.55))
    arrow(ax, (14.8, 3.35), (8.8, 3.35), "Webhook", lpos=0.5, loff=(0, 0.2))
    arrow(ax, (7.6, 4.05), (9.9, 6.45))

    # 瀏覽器直接嵌入播放 YouTube
    arrow(ax, (2.0, 10.88), (16.0, 11.15), dashed=True, rad=-0.12)

    ax.text(10.0, 0.75, "部署：push 到 GitHub main 後，GitHub Actions self-hosted runner 在虛擬機上拉取程式、"
            "安裝套件、建置前端、重啟後端並檢查問答就緒", ha="center", va="center", fontsize=10.5,
            color=INK, bbox=dict(boxstyle="round,pad=0.35", fc="#f4f4f2", ec=INK_2))
    ax.text(0.2, 0.1, "實線：請求或資料流向；虛線：狀態回報，或由瀏覽器直接連線播放。"
            "依 2026-09-19 程式碼、部署流程與正式環境狀態繪製。", fontsize=9.5, color=INK_2)

    fig.tight_layout(pad=0.2)
    fig.savefig(OUT, facecolor="white")
    plt.close(fig)
    print("wrote", OUT.name)


if __name__ == "__main__":
    main()
