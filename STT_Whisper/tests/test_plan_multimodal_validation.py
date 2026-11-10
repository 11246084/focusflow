import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from plan_multimodal_validation import select_chunks
from gemini_multimodal_adapter import estimate_cost


class ValidationPlanTests(unittest.TestCase):
    def test_selection_includes_short_normal_and_other_video_without_mutation(self):
        first = [{"startSec": 0, "endSec": 2, "videoId": "one"}, {"startSec": 10, "endSec": 20, "videoId": "one"}]
        second = [{"startSec": 30, "endSec": 40, "videoId": "two"}]
        selected = select_chunks(first, second)
        self.assertEqual(selected, [first, second])
        self.assertEqual(first[0]["endSec"], 2)

    def test_conservative_text_and_media_estimates(self):
        self.assertAlmostEqual(estimate_cost("query"), 0.0016384)
        self.assertEqual(estimate_cost("audio", seconds=8), 0.00128)
        self.assertEqual(estimate_cost("visual", seconds=60), 0.02528)


if __name__ == "__main__":
    unittest.main()
