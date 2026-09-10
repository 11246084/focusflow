// 把 shortscripts 的資料 render 成可直接複製的完整腳本 markdown。
//
// 依規格書 DR-01，系統只生成「因主題而異」的部分（證據表、全域設定、寫作四題、
// 視覺隱喻、8 拍分鏡）；模板固定章節（分身規格、配樂、字卡、ffmpeg、驗收清單）
// 是常數，不進資料庫，寫在這裡。
//
// 固定章節對應 docs/short-video-examples/10-teacher-avatar-metaphor.md（2026-09-10 依
// MiniMax H3 官方規格修訂，規格書 P-04 已結案）。重點：
//   - 生成模式是「全能參考」，H3 沒有「Reference-to-Video」這個模式名稱
//   - 官方單次長度 5–15 秒，無法一次生成 30 秒，分身要分 3–4 段拼接
//   - H3 沒有餵外部音檔驅動嘴型的功能，分身全程不說話，旁白純後製疊上
// 模板再改版時，這裡要同步。

function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// 專有名詞用 <lang xml:lang="en-US"> 包起來，避免中文語音把 OpenCV 唸成注音。
// 只做機械性的英數字串包裝；重音 <emphasis> 屬於編輯判斷，無法自動推導，留給教師標。
function toSsmlLine(text) {
  return String(text || '').replace(
    /[A-Za-z][A-Za-z0-9.+#-]*/g,
    (match) => `<lang xml:lang="en-US">${match}</lang>`,
  );
}

function renderEvidenceTable(evidence = []) {
  const rows = evidence.map((item) => [
    `| ${item.code}`,
    `\`${item.chunkId}\``,
    `${formatTimestamp(item.startSec)}–${formatTimestamp(item.endSec)}`,
    `「${String(item.rawText || '').replace(/\|/g, '｜')}」`,
    item.expandedFrom ? '鄰接擴展' : '檢索命中',
  ].join(' | ') + ' |');

  return [
    '| 代號 | chunkId | 原片時間 | 原始逐字稿（STT，未修飾） | 來源 |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function renderShots(shots = []) {
  return shots.map((shot) => {
    const basis = shot.basedOn === 'template'
      ? '`template`（反問，不給資料庫沒確認過的答案）'
      : `片段 ${(shot.basedOn || []).map((id) => `\`${id}\``).join('、')}・改寫`;

    return [
      `### 鏡 ${String(shot.shotNo).padStart(2, '0')}｜${shot.arcRole}（${shot.timeRange || ''}）`,
      '',
      '〔上 2/3｜B-roll〕',
      '- 素材：S1 / S2 / S3（依上方視覺概念挑選）',
      '',
      '〔下 1/3｜教師數位分身講述〕',
      `「${shot.narration}」`,
      `- 依據：${basis}`,
      '',
      `〔字幕〕：${shot.subtitle}`,
      `〔剪輯〕：${shot.editing || '正常'}`,
      `〔音效〕：${shot.sfx || '—'}`,
    ].join('\n');
  }).join('\n\n---\n\n');
}

function renderSsml(shots = []) {
  const body = shots.map((shot, index) => [
    `    <!-- ${index + 1} ${shot.arcRole} -->`,
    `    ${toSsmlLine(shot.narration)}`,
    '    <break time="500ms"/>',
  ].join('\n')).join('\n\n');

  return ['<speak>', '  <voice name="[複製聲線]">', '', body, '', '  </voice>', '</speak>'].join('\n');
}

function renderMetaphor(option) {
  if (!option) return '（尚未選擇視覺隱喻）';

  return [
    `**選用隱喻：${option.label}**`,
    '',
    '```',
    `S1  ${option.s1}`,
    '     ↓',
    `S2  ${option.s2}`,
    '     ↓',
    `S3  ${option.s3}`,
    '```',
    '',
    '三段共用的 MiniMax H3 限制（四段式 prompt 的【限制】欄）：',
    '',
    '```',
    '不要出現文字、字母、數字、座標軸、圖表、人臉。',
    '不可排列成可讀圖案或已知商標形狀。',
    '```',
  ].join('\n');
}

// 模板固定章節（DR-01）。內容因主題而異的部分不在這裡。
const FIXED_SECTIONS = `## 7. 教師數位分身生成規格

| 項目 | 內容 |
|---|---|
| 生成模式 | **全能參考**（H3 官方沒有「Reference-to-Video」這個模式名稱） |
| 素材標記 | Prompt 開頭逐一交代每份素材用途，例：「@Image1 是人物外觀參考，保留臉部、短髮、原服裝特徵，不新增其他人物」 |
| 單次長度限制 | **官方規格 5–15 秒／次**，無法一次生成 30 秒。改成生成 3–4 段 5–8 秒素材後製拼接，每段重申「同一位主角」 |
| 對嘴 | **H3 沒有餵外部音檔驅動嘴型的功能**。分身全程嘴巴自然閉合、不說話，旁白完全靠後製疊上零樣本語音複製的音軌 |
| 素材數量 | 先用 2–4 份素材測試（臉部圖 1 張 + 動態影片 1 段），不要一次放滿 12 個 |
| 輸出需求 | 透明背景或綠幕（**開拍前必須實測確認**） |
| 驗收順序 | 主體→動作→鏡頭→聲音→商業細節，一次只改一類問題 |

## 8. 配樂與音效

\`\`\`
A 30-second ambient underscore for an educational short video.
No melody, no drums, no percussion, no vocals, no instruments with clear pitch.
A single sustained warm pad with slow evolving texture.
Dark, spacious, cinematic documentary feel.
Fade in over 1 second, fade out over 1.5 seconds.
\`\`\`

混音：旁白 −16 LUFS 基準、配樂 −30 LUFS、音效峰值不超過旁白 −6dB、成品整體 −14 LUFS，真峰值 ≤ −1 dBTP。

## 9. 字卡與字幕

| 用途 | 字型 | 字級 | 位置 |
|---|---|---|---|
| 主字卡 | Noto Sans TC Bold | 96px | 上 2/3 區塊內 |
| 逐字字幕 | Noto Sans TC Medium | 64px | 上 2/3 區塊內，距底部 ≥ 220px |
| 揭露標示 | Noto Sans TC Regular | 30px | 右上角，\`AI 合成影像・經本人授權\`，**全程常駐，必做** |

白字 + 3px 黑描邊；每屏 4–7 字；驗收標準：靜音播放要能看懂。

## 10. 合成指令

\`\`\`bash
# ① 分身逐段去背
ffmpeg -i avatar_seg1_green.mov -filter_complex "chromakey=0x00FF00:0.18:0.05[fg]" -c:v qtrle avatar_seg1_alpha.mov -y

# ② 拼接分身各段
ffmpeg -f concat -safe 0 -i avatar_segments_list.txt -c:v qtrle -an avatar_full_alpha.mov -y

# ③ B-roll 拼接
ffmpeg -f concat -safe 0 -i list.txt -c:v libx264 -crf 20 -preset medium -an broll_joined.mp4

# ④ 分身疊在下 1/3
ffmpeg -i broll_joined.mp4 -i avatar_full_alpha.mov -filter_complex \\
"[1:v]scale=1080:640[avatar];[0:v][avatar]overlay=0:1280:format=auto" -c:v libx264 -crf 18 -an composite.mp4 -y

# ⑤ 疊旁白與配樂
ffmpeg -i composite.mp4 -i narration.wav -i bgm.wav -filter_complex \\
"[1:a]volume=1.0[v];[2:a]volume=0.12[m];[v][m]amix=inputs=2:duration=first[a]" \\
-map 0:v -map "[a]" -c:v libx264 -crf 20 -c:a aac with_audio.mp4 -y

# ⑥ 燒字幕
ffmpeg -i with_audio.mp4 -vf "ass=script.ass" -c:a copy subtitled.mp4

# ⑦ 疊揭露標示（必做）
ffmpeg -i subtitled.mp4 -vf \\
"drawtext=fontfile=NotoSansTC-Regular.otf:text='AI 合成影像・經本人授權':x=w-tw-28:y=28:fontsize=30:fontcolor=white@0.78:box=1:boxcolor=black@0.35:boxborderw=10" \\
-c:a copy final.mp4
\`\`\`

輸出規格：\`1080×1920 / H.264 / CRF 20 / 30fps / AAC 128k / faststart\`

## 11. 驗收清單

**內容**
- [ ] 每一句都指得回上方證據表，或標為 \`template\`
- [ ] 沒有捏造證據表沒提到的名稱、數字或說法
- [ ] 只講了一個觀念

**教師數位分身（硬條件）**
- [ ] MiniMax H3 已實測能輸出透明背景或綠幕
- [ ] 書面同意已簽署，載明用途、範圍、期限、可撤回
- [ ] 右上角揭露標示全片常駐
- [ ] 分身全程嘴巴閉合、沒有自行生成台詞或口型
- [ ] 各段分身素材之間主體沒有跑掉

**畫面**
- [ ] B-roll 沒有出現文字、字母、數字、可辨識圖案
- [ ] 字卡／字幕都在上 2/3，沒有壓到分身

**聲音**
- [ ] 專有名詞唸法全片一致且正確
- [ ] 生成影片的原生音軌確實剝掉

**成品**
- [ ] 總長 28–32 秒
- [ ] 靜音播放能看懂
- [ ] 前 3 秒有明顯視覺事件

**發布前**
- [ ] 已用 unlisted 上傳、等 Content ID 掃完、確認無版權聲明

## 12. 一句話提醒

**內容全部來自課程逐字稿，教師的臉與聲音是複製的，但講的內容必須追得回資料庫。** 上方每一拍的「依據」都指得回證據表的 chunkId；製作時不要另外加入證據表沒有的內容。`;

/**
 * 產生可直接複製的完整腳本 markdown。
 *
 * @param {object} script       shortscripts 文件
 * @param {object} version      要輸出的版本（預設最後一版）
 * @param {number} metaphorIndex 教師選用的視覺隱喻索引
 */
export function renderScriptMarkdown(script, version, metaphorIndex = 0) {
  if (!script || !version?.payload) return '';

  const { payload } = version;
  const settings = payload.globalSettings || {};
  const metaphor = (payload.visualMetaphorOptions || [])[metaphorIndex];

  return [
    `# 🎬 資訊型短影音腳本（教師數位分身 × 標準敘事弧線）`,
    '',
    `**主題：${script.topic}**`,
    '',
    `> 由 FocusFlow 自動選題並依課程逐字稿生成，第 ${version.versionNo} 版。`,
    '',
    '---',
    '',
    '## 1. 內容來源（實查自資料庫）',
    '',
    '```',
    `課程 ID：${script.courseId}`,
    `主題：${script.topic}`,
    `提問人數：${script.selectionReason?.uniqueAskerCount ?? '—'} 人・累計 ${script.selectionReason?.totalAskCount ?? '—'} 次`,
    `證據凍結時間：${script.evidenceFrozenAt || '—'}`,
    '```',
    '',
    renderEvidenceTable(script.evidence),
    '',
    '> 口白只能改寫上表內容，不可新增證據表沒有的資訊。',
    '',
    '---',
    '',
    '## 2. 全域設定',
    '',
    `- **影片主題**：${script.topic}`,
    `- **核心事件**：${settings.coreEvent || '—'}`,
    `- **核心觀點**：${settings.coreView || '—'}`,
    `- **觀眾原本可能以為**：${settings.audienceAssumption || '—'}`,
    `- **觀眾看完後應該發現**：${settings.audienceTakeaway || '—'}`,
    `- **目標受眾**：${settings.targetAudience || '—'}`,
    '- **影片長度**：30 秒',
    '- **影片語氣**：知識解說',
    '',
    '---',
    '',
    '## 3. 寫作順序：動筆前的 4 題',
    '',
    ...(payload.writingFourQuestions || []).map((item, index) => `${index + 1}. ${item}`),
    '',
    '---',
    '',
    '## 4. 視覺概念',
    '',
    renderMetaphor(metaphor),
    '',
    '---',
    '',
    '## 5. 分鏡（8 拍，標準弧線）',
    '',
    '> 教師數位分身全程在下 1/3，以下只標注上 2/3 的 B-roll 與講述內容。',
    '',
    renderShots(payload.shots),
    '',
    '---',
    '',
    '## 6. SSML（零樣本語音複製）',
    '',
    '```xml',
    renderSsml(payload.shots),
    '```',
    '',
    '> 專有名詞已自動以 `<lang xml:lang="en-US">` 包起來。**重音 `<emphasis>` 需由教師自行標註**——哪一句該強調屬於編輯判斷，無法自動推導。',
    '> 合成後務必計時，超過 32 秒先縮短 `<break>` 值，不要調快語速。',
    '',
    '---',
    '',
    FIXED_SECTIONS,
    '',
  ].join('\n');
}

export { formatTimestamp };
