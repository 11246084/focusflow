'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  run, ffmpegBinary, fontPath, readJson, writeJson,
} = require('../util');
const { buildHtml } = require('./html');
const { cutTeacherClip } = require('./cut');

function hyperframesBin() {
  const root = path.dirname(require.resolve('hyperframes/package.json'));
  return path.join(root, 'bin', 'hyperframes.mjs');
}

async function hyperframes(args, cwd) {
  // HyperFrames 的 telemetry 預設是開的；本專案固定關閉（不外送使用資料）。
  const env = { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1' };
  return run(process.execPath, [hyperframesBin(), ...args], { cwd, env });
}

/** 建立可渲染的專案資料夾（html、字型、gsap、老師畫面）。 */
async function stageProject({ plan, resolved, sourcePath, outDir, skipCut = false }) {
  const stageDir = path.join(outDir, 'stage');
  fs.mkdirSync(path.join(stageDir, 'fonts'), { recursive: true });
  fs.mkdirSync(path.join(stageDir, 'vendor'), { recursive: true });

  fs.copyFileSync(fontPath(), path.join(stageDir, 'fonts', 'NotoSansTC-VF.ttf'));
  fs.copyFileSync(require.resolve('gsap/dist/gsap.min.js'), path.join(stageDir, 'vendor', 'gsap.min.js'));
  fs.writeFileSync(path.join(stageDir, 'index.html'), buildHtml(plan, resolved), 'utf8');

  if (!skipCut) {
    await cutTeacherClip({
      sourcePath,
      resolved,
      region: plan.source.teacherRegion,
      outPath: path.join(stageDir, 'teacher.mp4'),
    });
  }
  return stageDir;
}

/** 出幾張預覽圖（約 20 秒），給教師審 plan 用；不需要先渲染整支。 */
async function previewProject({ stageDir, resolved }) {
  const lint = await hyperframes(['lint'], stageDir).catch((error) => ({ stdout: String(error.message), stderr: '' }));
  const times = resolved.scenes.map((scene) => Math.round(((scene.t0 + scene.t1) / 2 + 0.6) * 10) / 10)
    .concat([Math.round((resolved.total - 1) * 10) / 10]);
  const { stdout } = await hyperframes(['snapshot', '.', '--at', times.join(',')], stageDir);
  return { lint: lint.stdout, snapshots: stdout };
}

async function renderProject({ stageDir, outDir, quality = 'standard', loudnorm = true }) {
  const rawPath = path.join(outDir, 'render-raw.mp4');
  await hyperframes(['render', '.', '-o', rawPath, '--fps', '30', '--quality', quality], stageDir);
  if (!loudnorm) return rawPath;

  const finalPath = path.join(outDir, 'final.mp4');
  await run(ffmpegBinary(), [
    '-v', 'error', '-y', '-i', rawPath, '-c:v', 'copy',
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=7', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', finalPath,
  ]);
  return finalPath;
}

module.exports = {
  stageProject, previewProject, renderProject, readJson, writeJson,
};
