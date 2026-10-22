'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/** 執行外部程式並收集輸出；非 0 結束碼視為錯誤（訊息帶 stderr 尾端，方便診斷）。 */
function run(command, args, { cwd, input, env, quiet = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!quiet) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (!quiet) process.stderr.write(chunk);
    });
    child.on('error', (error) => reject(new Error(`cannot start "${command}": ${error.message}`)));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`"${path.basename(command)} ${args.slice(0, 3).join(' ')} ..." exited with ${code}\n${stderr.slice(-1200)}`));
      }
    });
    child.stdin.end(input || '');
  });
}

function ffmpegBinary() {
  return process.env.SHORT_RENDER_FFMPEG || 'ffmpeg';
}

function ffprobeBinary() {
  return process.env.SHORT_RENDER_FFPROBE || 'ffprobe';
}

/** 對齊用 ASR 的 Python：優先環境變數，其次 repo 內 STT_Whisper 的 venv，最後用 PATH 上的 python。 */
function pythonBinary() {
  if (process.env.SHORT_RENDER_PYTHON) return process.env.SHORT_RENDER_PYTHON;
  const repoRoot = path.resolve(__dirname, '..', '..');
  const candidates = [
    path.join(repoRoot, 'STT_Whisper', '.venv', 'Scripts', 'python.exe'),
    path.join(repoRoot, 'STT_Whisper', '.venv', 'bin', 'python'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || 'python';
}

/** Noto Sans TC（OFL）。字型檔太大不進 git，所以由環境提供。 */
function fontPath() {
  const candidates = [
    process.env.SHORT_RENDER_FONT,
    'C:\\Windows\\Fonts\\NotoSansTC-VF.ttf',
    '/usr/share/fonts/noto-cjk/NotoSansTC-VF.ttf',
    '/usr/share/fonts/google-noto-cjk/NotoSansTC-VF.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansTC-VF.ttf',
    '/Library/Fonts/NotoSansTC-VF.ttf',
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error('Noto Sans TC font not found. Set SHORT_RENDER_FONT to a NotoSansTC variable .ttf file (see README).');
  }
  return found;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

module.exports = {
  run, ffmpegBinary, ffprobeBinary, pythonBinary, fontPath, readJson, writeJson,
};
