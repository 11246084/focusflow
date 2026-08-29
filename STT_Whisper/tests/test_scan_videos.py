import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from scan_videos import probe_video_duration


class ProbeVideoDurationTests(unittest.TestCase):
    @patch("scan_videos.subprocess.run")
    def test_reports_missing_moov_as_invalid_source_media(self, run_mock):
        run_mock.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="moov atom not found\nInvalid data found when processing input",
        )

        with self.assertRaisesRegex(ValueError, "moov atom not found"):
            probe_video_duration(Path("broken.mp4"), "ffmpeg")

    @patch("scan_videos.subprocess.run")
    def test_preserves_duration_parsing_for_valid_media(self, run_mock):
        run_mock.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=1,
            stdout="",
            stderr="Duration: 00:01:02.50, start: 0.000000, bitrate: 1000 kb/s",
        )

        self.assertEqual(probe_video_duration(Path("valid.mp4"), "ffmpeg"), 62.5)


if __name__ == "__main__":
    unittest.main()
