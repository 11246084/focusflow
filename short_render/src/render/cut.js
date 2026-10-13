'use strict';

const { run, ffmpegBinary } = require('../util');

const PANEL = { width: 720, height: 540 };

/**
 * 從原片剪出各段，裁出老師視窗，接成一支（保留原音、不加速）。
 * 純函式：只組出 ffmpeg 參數，方便測試與在文件裡重現。
 */
function buildCutArgs({ sourcePath, resolved, region, outPath }) {
  const parts = [];
  const labels = [];

  resolved.clips.forEach((clip, index) => {
    parts.push(
      `[0:v]trim=start=${clip.srcStart}:end=${clip.srcEnd},setpts=PTS-STARTPTS,`
      + `crop=${region.w}:${region.h}:${region.x}:${region.y},scale=${PANEL.width}:${PANEL.height}:flags=lanczos[v${index}]`,
    );
    // 起訖各做一個極短的淡入淡出，避免剪點爆音；不改變音量與速度。
    parts.push(
      `[0:a]atrim=start=${clip.srcStart}:end=${clip.srcEnd},asetpts=PTS-STARTPTS,`
      + `afade=t=in:d=0.03,afade=t=out:st=${Math.max(0, clip.dur - 0.05).toFixed(3)}:d=0.05[a${index}]`,
    );
    labels.push(`[v${index}][a${index}]`);
  });

  const graph = `${parts.join(';')};${labels.join('')}concat=n=${resolved.clips.length}:v=1:a=1[v][a]`;

  // -g/-keyint_min：每秒一個關鍵格，渲染器逐格 seek 才不會停格（HyperFrames 的建議）。
  return [
    '-v', 'error', '-y', '-i', sourcePath,
    '-filter_complex', graph, '-map', '[v]', '-map', '[a]',
    '-r', '30', '-c:v', 'libx264', '-crf', '16', '-g', '30', '-keyint_min', '30', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', outPath,
  ];
}

async function cutTeacherClip(options) {
  await run(ffmpegBinary(), buildCutArgs(options));
}

module.exports = { buildCutArgs, cutTeacherClip, PANEL };
