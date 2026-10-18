"""圖1-2-2 全球MOOCs 市場快速擴張，凸顯線上課程與自主學習發展潛力：只重建這一張市場圖。"""
from market_charts import CHARTS, draw

if __name__ == "__main__":
    draw(next(chart for chart in CHARTS if chart["file"] == "圖1-2-2-全球MOOCs市場快速擴張，凸顯線上課程與自主學習發展潛力.png"))
