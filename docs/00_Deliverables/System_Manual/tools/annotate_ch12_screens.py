"""相容入口：製圖程式已移至 figures/ch12/。"""
from pathlib import Path
import runpy

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).resolve().parents[1] / "figures" / "ch12" / "annotate_ch12_screens.py"), run_name="__main__")
