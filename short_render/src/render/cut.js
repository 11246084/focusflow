'use strict';

const { run, ffmpegBinary } = require('../util');

/**
 * 只剪接原音，不讀取或輸出教師影像；增益在預覽（Web Audio）與渲染用音檔（staging 時 FFmpeg volume）各套一次。
 * 純函式：只組出 ffmpeg 參數，方便測試與在文件裡重現。
 */
function buildCutArgs({ sourcePath, resolved, outPath }) {
  const parts = [];
  const labels = [];

  resolved.clips.forEach((clip, index) => {
    parts.push(
      `[0:a]atrim=start=${clip.srcStart}:end=${clip.srcEnd},asetpts=PTS-STARTPTS[a${index}]`,
    );
    labels.push(`[a${index}]`);
  });

  const graph = `${parts.join(';')};${labels.join('')}concat=n=${resolved.clips.length}:v=0:a=1,apad,atrim=end=${resolved.total}[a]`;

  return [
    '-v', 'error', '-y', '-i', sourcePath,
    '-filter_complex', graph, '-map', '[a]', '-vn', '-c:a', 'pcm_s16le', '-ar', '48000', outPath,
  ];
}

async function cutTeacherClip(options) {
  const runCommand = options.runCommand || run;
  await runCommand(ffmpegBinary(), buildCutArgs(options));
}

module.exports = { buildCutArgs, cutTeacherClip, cutNarration: cutTeacherClip };
