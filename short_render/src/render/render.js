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

const MAX_AAC_CORRECTION_DB = 0.5;
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
  // Render page plays narration-render.wav, which already carries the fixed gain;
  // the preview plays unity narration.wav and applies the same gain in Web Audio.
  fs.writeFileSync(path.join(stageDir, 'index.html'), buildHtml(plan, resolved, { mode: 'render', audioSrc: 'narration-render.wav' }), 'utf8');
  fs.writeFileSync(path.join(stageDir, 'preview.html'), buildHtml(plan, resolved, { mode: 'preview' }), 'utf8');
  if (!skipCut) {
    await cutTeacherClip({
      sourcePath,
      resolved,
      outPath: path.join(stageDir, 'narration.wav'), runCommand,
    });
    // Apply the plan's fixed gain exactly once, before HyperFrames. Its AAC
    // true-peak ceiling (-1 dBFS) then has nothing to lower, because the gain
    // already caps the peak at -1.5 dBTP; the final mux copies that audio as-is.
    // 2026-11-05 run-6 applied the gain after HyperFrames had already lowered
    // unity audio by 1.1 dB, ending 2.1 LU under the -16 LUFS target.
    await runCommand(ffmpegBinary(), ['-v', 'error', '-y', '-i', path.join(stageDir, 'narration.wav'),
      '-af', `volume=${plan.audio.gainDb}dB`, '-c:a', 'pcm_s16le', '-ar', '48000', path.join(stageDir, 'narration-render.wav')]);
  }
  const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(stageDir, file))).digest('hex');
  writeJson(path.join(stageDir, 'render-manifest.json'), { planHash: planHash(plan), versions: plan.versions, gainDb: plan.audio.gainDb,
    fontSha256: digest('fonts/NotoSansTC-VF.ttf'), htmlSha256: digest('index.html'), gsapSha256: digest('vendor/gsap.min.js'),
    // skipCut stages are for offline prototypes and cannot become render jobs.
    audioSha256: skipCut ? null : digest('narration.wav'),
    renderAudioSha256: skipCut ? null : digest('narration-render.wav'), renderAudioGainDb: skipCut ? null : plan.audio.gainDb });
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
  if (!manifest.renderAudioSha256 || manifest.renderAudioGainDb !== plan.audio.gainDb) throw new Error('RECUT_RENDER_VERSION_MISMATCH: staged render narration missing or gain changed');
  for (const [file, key] of [['index.html', 'htmlSha256'], ['fonts/NotoSansTC-VF.ttf', 'fontSha256'], ['vendor/gsap.min.js', 'gsapSha256'], ['narration.wav', 'audioSha256'], ['narration-render.wav', 'renderAudioSha256']]) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(stageDir, file))).digest('hex');
    if (hash !== manifest[key]) throw new Error(`RECUT_RENDER_VERSION_MISMATCH: staged ${file} changed`);
  }
  // Browser adapters must await window.__recutReady before screenshots, and
  // provide the observed font flag; no guessed success when no browser exists.
  if (typeof ensureFontLoaded !== 'function' || await ensureFontLoaded({ stageDir, readyExpression: 'window.__recutReady' }) !== true) throw new Error('RECUT_FONT_NOT_LOADED');
  const rawPath = path.join(outDir, 'render-raw.mp4');
  const rendered = await hyperframesImpl(['render', '.', '-o', rawPath, '--fps', String(plan.canvas.fps), '--quality', quality], stageDir);
  // HyperFrames lowers AAC that peaks above -1 dBFS and logs "Audio lowered by X dB"
  // (info level; this call does not pass --quiet). The staged gain caps the PCM
  // peak at -1.5 dBTP, so a small AAC overshoot correction is tolerated; a larger
  // one means the gain was applied twice or staging is wrong.
  const lowered = Number(/Audio lowered by (\d+(?:\.\d+)?) dB/.exec(`${rendered?.stdout || ''}${rendered?.stderr || ''}`)?.[1] || 0);
  if (lowered > MAX_AAC_CORRECTION_DB) throw Object.assign(new Error(`RECUT_RENDER_AUDIO_LOWERED: HyperFrames lowered staged audio by ${lowered} dB (limit ${MAX_AAC_CORRECTION_DB} dB) although it already carries the plan gain`), { code: 'RECUT_RENDER_AUDIO_LOWERED' });

  const finalPath = path.join(outDir, 'final.mp4');
  await runCommand(ffmpegBinary(), [
    '-v', 'error', '-y', '-i', rawPath, '-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart', finalPath,
  ]);
  return finalPath;
}

module.exports = {
  stageProject, previewProject, renderProject, readJson, writeJson,
  assertRuntime,
};
