"""圖1-2-1 台灣線上教育市場規模持續成長，顯示數位學習需求快速提升：只重建這一張市場圖。"""
from market_charts import CHARTS, draw

if __name__ == "__main__":
    draw(next(chart for chart in CHARTS if chart["file"] == "圖1-2-1-台灣線上教育市場規模持續成長，顯示數位學習需求快速提升.png"))
