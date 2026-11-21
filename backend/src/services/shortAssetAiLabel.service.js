const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const env = require('../config/env');
const AppError = require('../utils/appError');

// 數位分身成品的 AI 揭露標示由系統壓上（2026-11-21，短影片決策 UX-28）。
// 教授只收腳本、在地端產片，影片傳回後才經過這裡；不再靠教師勾選「右上角全程顯示」。
// 樣式以腳本第 10 節的 drawtext 為基礎（1080×1920 時字級 30px、黑底半透明），依影片高度等比例縮放。
const AI_LABEL_TEXT = 'AI 合成影像・經本人授權';
const LABEL_TIMEOUT_MS = 10 * 60 * 1000;

// 只列單一語系的字型檔。NotoSansCJK-*.ttc 是日韓簡繁的合集，drawtext 指定檔案時只會用第一個（日文）字形，
// 所以找不到這些檔案時改交給 fontconfig 依名稱找繁中版本（Rocky VM 裝的是 google-noto-cjk 的 .ttc）。
const FONT_CANDIDATES = [
  'C:\\Windows\\Fonts\\NotoSansTC-VF.ttf',
  '/usr/share/fonts/noto-cjk/NotoSansTC-VF.ttf',
  '/usr/share/fonts/google-noto-cjk/NotoSansTC-VF.ttf',
  '/usr/share/fonts/truetype/noto/NotoSansTC-VF.ttf',
];
const FONTCONFIG_FALLBACK_FAMILY = 'Noto Sans CJK TC Medium';

function labelFailure(message) {
  const error = new AppError(message, 500, 'SHORT_ASSET_AI_LABEL_FAILED');
  // 標示在送出任何 bytes 前失敗，重試不會產生重複的 YouTube 影片。
  error.youtubeRetrySafe = true;
  return error;
}

// 回傳 { fontfile } 或 { family }。SHORT_ASSET_AI_LABEL_FONT 是存在的檔案就當字型檔，否則當 fontconfig 字型名稱。
function resolveLabelFont() {
  const configured = String(env.shortAssetAiLabelFont || '').trim();
  if (configured && !fs.existsSync(configured)) return { family: configured };
  const found = [configured, process.env.SHORT_RENDER_FONT, ...FONT_CANDIDATES]
    .filter(Boolean).find((candidate) => fs.existsSync(candidate));
  return found ? { fontfile: found } : { family: FONTCONFIG_FALLBACK_FAMILY };
}

// filtergraph 內的值：反斜線改斜線，冒號與單引號要跳脫（Windows 的 C:/ 也是冒號）。
function escapeFilterValue(value) {
  return String(value).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

// 數值都依 1080×1920 的設計換算成實際像素；boxborderw 不吃運算式，所以先用 ffprobe 量高度。
// Noto Sans TC 可變字型在 drawtext 只會用最細的字重，用同色描邊補粗，免得在亮的畫面上看不清。
function buildLabelFilter(font, height = 1920) {
  const px = (value) => Math.max(1, Math.round((value * height) / 1920));
  const spec = typeof font === 'string' ? { fontfile: font } : font;
  return [
    spec.fontfile ? `drawtext=fontfile='${escapeFilterValue(spec.fontfile)}'` : `drawtext=font='${escapeFilterValue(spec.family)}'`,
    `text='${escapeFilterValue(AI_LABEL_TEXT)}'`,
    `fontsize=${px(30)}`, 'fontcolor=white@0.9', `borderw=${px(1)}`, 'bordercolor=white@0.9',
    'box=1', 'boxcolor=black@0.45', `boxborderw=${px(10)}`,
    `x=w-tw-${px(38)}`, `y=${px(38)}`,
  ].join(':');
}

function buildLabelArgs(inputPath, outputPath, font, height) {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a?', '-vf', buildLabelFilter(font, height),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy', '-movflags', '+faststart', outputPath];
}

function probeHeight(inputPath) {
  return new Promise((resolve, reject) => {
    execFile(env.recutFfprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=height', '-of', 'csv=p=0', inputPath],
      { timeout: 60000, windowsHide: true }, (error, stdout, stderr) => {
        if (error) return reject(Object.assign(error, { stderr }));
        const height = Number.parseInt(String(stdout).trim(), 10);
        return Number.isFinite(height) && height > 0 ? resolve(height) : reject(new Error('Uploaded file has no video stream.'));
      });
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(env.recutFfmpeg, args, { timeout: LABEL_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, _stdout, stderr) => (error ? reject(Object.assign(error, { stderr })) : resolve()));
  });
}

let renderLabel = async (inputPath, outputPath) => {
  const font = resolveLabelFont();
  return runFfmpeg(buildLabelArgs(inputPath, outputPath, font, await probeHeight(inputPath)));
};

/**
 * 在原檔旁邊輸出一份壓上 AI 標示的暫存檔，回傳暫存檔路徑；原檔不動，呼叫端上傳完要刪除暫存檔。
 * 關閉 SHORT_ASSET_AI_LABEL_ENABLED 時回傳 null，呼叫端改傳原檔。
 */
async function burnAiLabel(inputPath, { attemptId = Date.now().toString(36) } = {}) {
  if (!env.shortAssetAiLabelEnabled) return null;
  const parsed = path.parse(inputPath);
  const outputPath = path.join(parsed.dir, `${parsed.name}.ai-label-${attemptId}.mp4`);
  try {
    await renderLabel(inputPath, outputPath);
  } catch (error) {
    await fs.promises.rm(outputPath, { force: true }).catch(() => null);
    if (error?.code === 'SHORT_ASSET_AI_LABEL_FAILED') throw error;
    throw labelFailure(`Failed to add the AI disclosure label: ${String(error?.stderr || error?.message || error).slice(0, 200)}`);
  }
  return outputPath;
}

function setAiLabelRendererForTest(renderer) {
  const previous = renderLabel;
  renderLabel = renderer;
  return () => { renderLabel = previous; };
}

module.exports = { AI_LABEL_TEXT, burnAiLabel, buildLabelArgs, buildLabelFilter, resolveLabelFont, setAiLabelRendererForTest };
