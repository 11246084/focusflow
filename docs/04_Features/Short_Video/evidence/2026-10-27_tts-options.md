# 合成語音引擎選項查證（2026-10-27）

這份文件整理 recut 合成語音版（[recut 設計決策](../recut-design-decisions.md)第 78～80 項）可用的語音引擎，回答「除了 Azure，還有沒有免費或開源可自架的台灣華語語音」。讀者看完應能判斷哪些選項授權可用於上傳 YouTube（不公開連結）、展覽與競賽，以及各選項的口音、資料外送與硬體需求。

- 查閱日期皆為 2026-10-27；由子 agent 只讀網頁整理，未下載或安裝任何東西。授權條款的關鍵句定案前需再人工讀一次原文。
- **官方**指專案 repo、模型卡、廠商文件或授權條款原文；**第三方**指論壇、部落格、評測站。
- 使用情境：每月約幾十支、每支約 200 字，台灣華語夾雜英文術語（OpenCV、YOLO），不複製教師聲音。

## 結論摘要

1. **有原生台灣口音預設聲音的只有雲端服務**：Azure（HsiaoChen、YunJhe、HsiaoYu）、Google Cloud（cmn-TW，只有舊世代 Standard／WaveNet）、Windows 內建（舊世代）。開源模型沒有現成的台灣口音預設聲音。
2. **開源中唯一明確為台灣華語調整的是 BreezyVoice**（聯發科研究，程式與權重皆 Apache-2.0，支援注音控制發音與中英夾雜），但它**沒有預設聲音、必須提供參考音檔**，只能用本人書面同意的聲音（例：自願錄音的組員），不能用教師聲音或授權不明的範例音檔。官方只說 CPU 可跑，速度需實測；repo 自 2025-06 後未更新。
3. **Azure 免費層（F0）的音訊輸出使用權有疑義**：Microsoft Q&A 版主 2026-03-03 轉引 Product Terms，只有付費層明確可使用音訊輸出（第三方轉引，未讀到原文）。付費層（S0）以本專題用量每月約 US$0.15～0.2（第三方價格），但需綁付款方式。
4. **不建議**：Amazon Polly（沒有台灣聲音）、edge-tts（呼叫未公開端點，違反服務合約風險且會失效）、macOS 內建聲音（授權禁止公開發布）、Coqui XTTS-v2（CPML 非商用並排除政府補助專案）、ChatTTS（限學術用途、刻意加雜訊）、Gemini TTS 免費層（輸入輸出可能人工審查並用於改進產品、需年滿 18 歲，`cmn-tw` 仍為 Preview）。

## 開源／可自架

| 模型 | 程式／權重授權 | 台灣口音預設聲音 | 需參考音檔 | 硬體 | 最近更新 |
|---|---|---|---|---|---|
| **BreezyVoice** | Apache-2.0／Apache-2.0 | 為台灣華語調整，支援注音；沒有預設聲音 | 必須 | 官方稱 CPU 可跑，速度未知 | 2025-06-21 |
| CosyVoice 2／Fun-CosyVoice3 | Apache-2.0／Apache-2.0 | 18 種以上方言，沒有台灣腔 | zero-shot 需要 | 範例用 NVIDIA GPU | 2026-05-25 |
| MeloTTS | MIT／MIT | 一個中文聲音，口音未標示 | 不需要 | CPU 可即時 | 2024-12（約停更） |
| Kokoro-82M（v1.0／v1.1-zh） | Apache／Apache-2.0 | 中文聲音口音查不到 | 不需要 | 82M 參數 | 2025-04 |
| Piper | GPL-3.0（舊版 MIT 已封存）／依聲音而定 | 只有 zh_CN | 不需要 | 本機快速 | 2026-10-23 |
| F5-TTS | MIT／**CC-BY-NC** | 無 | 需要 | GPU | 2026-07-23 |
| GPT-SoVITS | MIT／MIT | 無（社群台灣版是台語） | 需要 | 支援 CPU | 2026-10-19 |
| Coqui XTTS-v2 | MPL-2.0／**CPML 非商用** | 無 | 需要 | 查不到 | 公司已關閉，社群 fork 維護 |
| ChatTTS | AGPL-3.0／**CC BY-NC 4.0，限學術** | 無 | 不需要 | GPU ≥4GB | 2026-04-10 |
| Fish Speech | Fish Audio Community／Research License | 無 | 需要 | 大模型 GPU | 2026-10 |
| IndexTTS 2／2.5 | bilibili Model Use License（大規模商用才需另外授權，適用中國法） | 無 | 需要 | GPU | 2026-09-29 |
| Qwen3-TTS | Apache-2.0／Apache-2.0 | 沒有台灣；可用文字描述設計聲音 | 不需要 | CUDA | 2026-01-22 |
| VoxCPM2 | Apache-2.0／Apache-2.0 | 沒有台灣腔；可用文字描述設計聲音 | 不需要 | 約 8GB VRAM，可 CPU | 2026-04 |
| BlueMagpie-TTS（台大等，論文） | 論文 CC BY-NC-ND；權重是否釋出查不到 | 專攻台灣口音與中英夾雜 | 查不到 | 查不到 | 2026-07-07 |
| Breeze TTS 2（BreezeBlue，與聯發科無關） | Apache-2.0／權重與產出音訊限研究非商用 | 台灣口音查不到 | 有文字設計模式 | Linux＋NVIDIA ≥12GB | 2026-08-25 |

**授權注意**：CC-BY-NC 類模型用於不公開影片與展覽，單看授權文字應可，但競賽有獎金、專題由政府經費補助、之後提供校內教師使用，都是灰色地帶。所有需要參考音檔的模型，聲音來源都必須本人書面同意；Fish 的授權也明文禁止未經同意模仿可辨識的個人聲音。

## 免費雲端服務

| 服務 | 台灣聲音 | 免費額度 | 資料 | 風險 |
|---|---|---|---|---|
| Azure 語音 F0／S0 | HsiaoChenNeural、YunJheNeural、HsiaoYuNeural（官方） | F0 每月 50 萬字元（官方）；S0 付費約 US$15～16／百萬字元（第三方） | 官方稱即時合成不保存文字與音訊 | F0 輸出使用權有疑義（第三方轉引）；需揭露合成語音（Microsoft AI Code of Conduct） |
| Google Cloud TTS | cmn-TW 只有 Standard、WaveNet（舊世代）；Chirp 3 HD 沒有 cmn-TW（官方） | 第三方說 Standard／WaveNet 各 400 萬字元，未驗證 | 送出 | 需先啟用帳單 |
| Gemini TTS 免費層 | `cmn-tw` 為 Preview（Cloud 文件） | 有免費層，每日上限未列出 | 可能人工審查並用於改進產品 | 需年滿 18 歲（官方條款） |
| Amazon Polly | 沒有台灣聲音（官方） | — | — | 排除 |
| edge-tts（非官方） | 有 | 0 | 送出 | 呼叫未公開端點，Microsoft 服務合約禁止規避存取限制；權杖輪替會失效 |

## 作業系統內建聲音

- **Windows**：有 zh-TW 標準聲音 Zhiwei、Yating、Hanhan（官方清單），音質為舊世代；**查不到官方授權條款**說明能否用於公開影片。
- **macOS**：系統聲音授權限個人非商用，並禁止發布、公開演出與分享（第三方轉載的授權原文），不能用於上傳 YouTube 或展覽。
- **YouTube**：只有寫實冒用真人的內容必須揭露（官方）；一般合成旁白不在列舉範圍，但 Azure 條款要求揭露，畫面與說明欄仍標示「旁白為合成語音」。

## 子 agent 的推薦（供討論，尚未定案）

- 第一版：**Azure zh-TW 神經語音開 S0 隨用隨付**，避開 F0 輸出權疑義；不能綁付款方式時才用 F0，並把風險記入決策。
- 備選：**自架 BreezyVoice**，不外送資料、不花錢；需組員自願錄參考音並簽書面同意，CPU 速度先實測。

## 查不到或未驗證

Azure Product Terms 原文與付費單價、Google 定價頁確切數字、Windows 內建聲音的官方授權、Kokoro 與 MeloTTS 中文聲音的口音、BreezyVoice 與 CosyVoice 的 CPU 速度與 VRAM、BlueMagpie-TTS 權重是否釋出。

## 主要來源

- 開源：[BreezyVoice](https://github.com/mtkresearch/BreezyVoice)（[模型卡](https://huggingface.co/MediaTek-Research/BreezyVoice)、[論文](https://arxiv.org/html/2501.17790v1)）、[CosyVoice](https://github.com/FunAudioLLM/CosyVoice)、[MeloTTS](https://github.com/myshell-ai/MeloTTS)、[Kokoro](https://huggingface.co/hexgrad/Kokoro-82M)、[Piper](https://github.com/OHF-Voice/piper1-gpl)、[F5-TTS](https://github.com/SWivid/F5-TTS)、[GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)、[XTTS-v2](https://huggingface.co/coqui/XTTS-v2)、[ChatTTS](https://github.com/2noise/ChatTTS)、[Fish Speech](https://github.com/fishaudio/fish-speech)、[IndexTTS](https://github.com/index-tts/index-tts)、[Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)、[VoxCPM](https://github.com/OpenBMB/VoxCPM)、[BlueMagpie-TTS](https://arxiv.org/abs/2607.06054)、[Breeze TTS 2](https://huggingface.co/BreezeBlue/Breeze-TTS-2)
- 雲端：[Azure 語音定價](https://azure.microsoft.com/en-us/pricing/details/speech/)、[Azure 語言支援](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support)、[Microsoft AI Code of Conduct](https://learn.microsoft.com/en-us/legal/ai-code-of-conduct)、[Azure 免費層輸出權問答（第三方轉引）](https://learn.microsoft.com/en-us/answers/questions/5805156)、[Google Cloud 聲音清單](https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types)、[Gemini TTS](https://docs.cloud.google.com/text-to-speech/docs/gemini-tts)、[Gemini API 定價](https://ai.google.dev/gemini-api/docs/pricing)、[Gemini API 條款](https://ai.google.dev/gemini-api/terms)、[Amazon Polly 聲音](https://docs.aws.amazon.com/polly/latest/dg/available-voices.html)、[edge-tts](https://github.com/rany2/edge-tts)、[Microsoft 服務合約](https://www.microsoft.com/en-us/servicesagreement)
- 其他：[YouTube 合成內容揭露](https://support.google.com/youtube/answer/14328491)、[macOS Sequoia 授權](https://www.apple.com/legal/sla/docs/macOSSequoia.pdf)
