'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  run, ffmpegBinary, fontPath, readJson, writeJson,
} = require('../util');
const { buildHtml } = require('./html');
const { cutTeacherClip } = require('./cut');
const { validatePlan, validateVersions, validateInstalledAssets } = require('../plan');
const { planHash } = require('../plan/sentences');

function hyperframesBin() {
  const root = path.dirname(require.resolve('hyperframes/package.json'));
  return path.join(root, 'bin', 'hyperframes.mjs');
}

async function hyperframes(args, cwd) {
  // HyperFrames 的 telemetry 預設是開的；本專案固定關閉（不外送使用資料）。
  const env = { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1' };
  return run(process.execPath, [hyperframesBin(), ...args], { cwd, env });
}

function assertRuntime(plan) {
  const errors = [...validateVersions(plan.versions), ...validateInstalledAssets()];
  for (const name of ['gsap', 'hyperframes']) {
    const version = require(`${name}/package.json`).version;
    if (version !== require('../../package.json').dependencies[name]) errors.push(`${name} installed version mismatch`);
  }
  if (plan.contractVersion !== 'sentence-v1') errors.push('legacy prototype plans cannot be staged; build a sentence-v1 plan first');
  if (errors.length) throw new Error(`RECUT_RENDER_VERSION_MISMATCH: ${errors.join('; ')}`);
}

/** 同一份動畫、字型與原音；預覽有控制項，渲染不含來源標示。 */
async function stageProject({ plan, resolved, sentences, evidence, sourcePath, outDir, skipCut = false, runCommand = run, resolveFont = fontPath }) {
  assertRuntime(plan);
  const validation = validatePlan(plan, { sentences, evidence, resolved });
  if (!validation.valid) throw new Error(`invalid render plan: ${JSON.stringify(validation.errors)}`);
  const stageDir = path.join(outDir, 'stage');
  fs.mkdirSync(path.join(stageDir, 'fonts'), { recursive: true });
  fs.mkdirSync(path.join(stageDir, 'vendor'), { recursive: true });

  fs.copyFileSync(resolveFont(), path.join(stageDir, 'fonts', 'NotoSansTC-VF.ttf'));
  fs.copyFileSync(require.resolve('gsap/dist/gsap.min.js'), path.join(stageDir, 'vendor', 'gsap.min.js'));
  fs.writeFileSync(path.join(stageDir, 'index.html'), buildHtml(plan, resolved, { mode: 'render' }), 'utf8');
  fs.writeFileSync(path.join(stageDir, 'preview.html'), buildHtml(plan, resolved, { mode: 'preview' }), 'utf8');
  if (!skipCut) {
    await cutTeacherClip({
      sourcePath,
      resolved,
      outPath: path.join(stageDir, 'narration.wav'), runCommand,
    });
  }
  const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(stageDir, file))).digest('hex');
  writeJson(path.join(stageDir, 'render-manifest.json'), { planHash: planHash(plan), versions: plan.versions, gainDb: plan.audio.gainDb,
    fontSha256: digest('fonts/NotoSansTC-VF.ttf'), htmlSha256: digest('index.html'), gsapSha256: digest('vendor/gsap.min.js'),
    // skipCut stages are for offline prototypes and cannot become render jobs.
    audioSha256: skipCut ? null : digest('narration.wav') });
  return stageDir;
}

/** 出幾張預覽圖（約 20 秒），給教師審 plan 用；不需要先渲染整支。 */
async function previewProject({ stageDir, resolved, hyperframesImpl = hyperframes }) {
  const lint = await hyperframesImpl(['lint'], stageDir);
  const times = resolved.scenes.map((scene) => Math.round(((scene.t0 + scene.t1) / 2 + 0.6) * 10) / 10)
    .concat([Math.round((resolved.total - 1) * 10) / 10]);
  const { stdout } = await hyperframesImpl(['snapshot', '.', '--at', times.join(',')], stageDir);
  return { lint: lint.stdout, snapshots: stdout };
}

async function renderProject({ plan, resolved, stageDir, outDir, quality = 'standard', runCommand = run, hyperframesImpl = hyperframes, ensureFontLoaded }) {
  assertRuntime(plan);
  const manifest = readJson(path.join(stageDir, 'render-manifest.json'));
  if (manifest.planHash !== planHash(plan) || resolved.planHash !== manifest.planHash || manifest.gainDb !== plan.audio.gainDb) throw new Error('RECUT_RENDER_VERSION_MISMATCH: staged plan or gain changed');
  if (!manifest.audioSha256) throw new Error('RECUT_RENDER_VERSION_MISMATCH: prototype has no staged narration');
  for (const [file, key] of [['index.html', 'htmlSha256'], ['fonts/NotoSansTC-VF.ttf', 'fontSha256'], ['vendor/gsap.min.js', 'gsapSha256'], ['narration.wav', 'audioSha256']]) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(stageDir, file))).digest('hex');
    if (hash !== manifest[key]) throw new Error(`RECUT_RENDER_VERSION_MISMATCH: staged ${file} changed`);
  }
  // Browser adapters must await window.__recutReady before screenshots, and
  // provide the observed font flag; no guessed success when no browser exists.
  if (typeof ensureFontLoaded !== 'function' || await ensureFontLoaded({ stageDir, readyExpression: 'window.__recutReady' }) !== true) throw new Error('RECUT_FONT_NOT_LOADED');
  const rawPath = path.join(outDir, 'render-raw.mp4');
  await hyperframesImpl(['render', '.', '-o', rawPath, '--fps', String(plan.canvas.fps), '--quality', quality], stageDir);

  const finalPath = path.join(outDir, 'final.mp4');
  await runCommand(ffmpegBinary(), [
    '-v', 'error', '-y', '-i', rawPath, '-c:v', 'copy',
    '-af', `volume=${plan.audio.gainDb}dB`, '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', finalPath,
  ]);
  return finalPath;
}

module.exports = {
  stageProject, previewProject, renderProject, readJson, writeJson,
  assertRuntime,
};
