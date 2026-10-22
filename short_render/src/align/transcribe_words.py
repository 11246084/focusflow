"""Word-level ASR. Writes JSON arrays of {w, s, e} (seconds, relative to each audio file).

Usage:
  python transcribe_words.py <audio.wav> <out.json> [model]
  python transcribe_words.py --batch <jobs.json> [model]      # jobs.json: [{"wav": ..., "out": ...}, ...]

Batch mode loads the model once, which dominates the cost for short windows.
Uses faster-whisper (same dependency as STT_Whisper). A "word" may be several characters;
callers only rely on its text and start/end times.
"""
import io
import json
import sys

from faster_whisper import WhisperModel

PROMPT = "以下是繁體中文的課堂講課內容，可能包含英文專有名詞與數字。"


def transcribe(model, wav, out):
    # vad_filter：老師寫板書時會有長段靜默，沒有 VAD 時 Whisper 會在靜默處重複同一句（實測「六十萬吧」重複數十次）。
    # condition_on_previous_text=False：不讓前一句的錯誤帶到下一句。
    # 溫度維持預設的 fallback 序列：貪婪解碼一旦進入重複迴圈，只有提高溫度才跳得出來。
    # 這代表同一段音訊重跑結果可能略有不同；所以對齊結果會快取，plan 的可重現性以快取為準。
    segments, _ = model.transcribe(
        wav, language="zh", word_timestamps=True, vad_filter=True, initial_prompt=PROMPT,
        condition_on_previous_text=False,
    )
    words = []
    for segment in segments:
        for word in segment.words or []:
            text = word.word.strip()
            if text:
                words.append({"w": text, "s": round(word.start, 3), "e": round(word.end, 3)})
    with io.open(out, "w", encoding="utf-8") as handle:
        json.dump(words, handle, ensure_ascii=False)


def main():
    args = sys.argv[1:]
    if args and args[0] == "--batch":
        with io.open(args[1], encoding="utf-8") as handle:
            jobs = json.load(handle)
        model_name = args[2] if len(args) > 2 else "small"
    else:
        jobs = [{"wav": args[0], "out": args[1]}]
        model_name = args[2] if len(args) > 2 else "small"

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    for job in jobs:
        transcribe(model, job["wav"], job["out"])


if __name__ == "__main__":
    main()
