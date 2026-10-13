#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  validatePlan, resolvePlan, compareCutText,
} = require('../src/plan');
const { alignClips } = require('../src/align/align');
const { stageProject, previewProject, renderProject } = require('../src/render/render');
const {
  run, ffmpegBinary, pythonBinary, readJson, writeJson,
} = require('../src/util');

const USAGE = `short-render — recut plan validator and renderer

Usage:
  short-render validate <plan.json> --evidence <evidence.json> [--resolved <resolved.json>]
  short-render align    <plan.json> --evidence <evidence.json> --source <video> --out <dir> [--model small]
  short-render preview  <plan.json> --evidence <evidence.json> --source <video> --out <dir>
  short-render render   <plan.json> --evidence <evidence.json> --source <video> --out <dir>
                        [--quality draft|standard|high] [--no-loudnorm] [--skip-verify]

align/preview/render write intermediate files under <dir> (aligned words are cached there).
Exit code: 0 ok, 1 validation/alignment errors, 2 usage or environment error.
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item.startsWith('--')) {
      const key = item.slice(2);
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        index += 1;
      }
    } else {
      positional.push(item);
    }
  }
  return { positional, flags };
}

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function printIssues(label, issues) {
  for (const item of issues) {
    console.error(`  ${label} ${item.code} @ ${item.path}: ${item.message}`);
  }
}

function require_(flags, name) {
  if (!flags[name] || flags[name] === true) fail(`missing --${name}\n\n${USAGE}`);
  return flags[name];
}

async function alignAndResolve(plan, evidence, flags) {
  const out = path.resolve(require_(flags, 'out'));
  const source = path.resolve(require_(flags, 'source'));
  if (!fs.existsSync(source)) fail(`source video not found: ${source}`);

  console.log('aligning clips (ASR results are cached)...');
  const aligned = await alignClips(plan, evidence, {
    sourcePath: source,
    cacheDir: path.join(out, 'cache'),
    model: typeof flags.model === 'string' ? flags.model : undefined,
    log: (line) => console.log(line),
  });

  const { resolved, errors } = resolvePlan(plan, aligned);
  if (!resolved) {
    printIssues('ERROR', errors);
    process.exit(1);
  }
  writeJson(path.join(out, 'resolved.json'), resolved);
  return { resolved, aligned, out, source };
}

function exitIfInvalid(result) {
  printIssues('WARN ', result.warnings);
  if (!result.valid) {
    printIssues('ERROR', result.errors);
    console.error(`plan is invalid (${result.errors.length} error(s)).`);
    process.exit(1);
  }
}

/** V6：剪出來的音訊重新轉錄，與預期文字比對。 */
async function verifyCut({ stageDir, resolved, aligned, out }) {
  const wav = path.join(out, 'cache', 'teacher-check.wav');
  const wordsFile = path.join(out, 'cache', 'teacher-check.json');
  await run(ffmpegBinary(), ['-v', 'error', '-y', '-i', path.join(stageDir, 'teacher.mp4'), '-vn', '-ac', '1', '-ar', '16000', wav]);
  await run(pythonBinary(), ['-I', path.join(__dirname, '..', 'src', 'align', 'transcribe_words.py'), wav, wordsFile], {
    env: { ...process.env, PYTHONUTF8: '1', HF_HUB_DISABLE_SYMLINKS_WARNING: '1' },
  });
  const actual = readJson(wordsFile).map((word) => word.w).join('');
  const expected = resolved.clips.map((clip) => aligned.wordsByClip[clip.id]
    .filter((word) => word.s >= clip.wordStart - 0.02 && word.s <= clip.wordEnd)
    .map((word) => word.w)
    .join('')).join('');
  return compareCutText(expected, actual);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const [command, planFile] = positional;

  if (!command || command === 'help' || flags.help) {
    console.log(USAGE);
    return;
  }
  if (!planFile) fail(`missing <plan.json>\n\n${USAGE}`);

  const plan = readJson(planFile);
  const evidence = readJson(require_(flags, 'evidence'));

  if (command === 'validate') {
    const resolved = flags.resolved ? readJson(flags.resolved) : null;
    const result = validatePlan(plan, { evidence, resolved });
    exitIfInvalid(result);
    console.log(`plan is valid${resolved ? ' (including resolved timing)' : ' (timing not checked; pass --resolved)'}.`);
    return;
  }

  // 對齊前先做不需要時間的檢查，省掉明知會失敗的 ASR。
  exitIfInvalid(validatePlan(plan, { evidence }));

  if (!['align', 'preview', 'render'].includes(command)) fail(`unknown command "${command}"\n\n${USAGE}`);

  const { resolved, aligned, out } = await alignAndResolve(plan, evidence, flags);
  exitIfInvalid(validatePlan(plan, { evidence, resolved }));
  console.log(`aligned: speech ${resolved.speechTotal}s, total ${resolved.total}s -> ${path.join(out, 'resolved.json')}`);
  if (command === 'align') return;

  const source = path.resolve(flags.source);
  console.log('staging project (cutting teacher footage)...');
  const stageDir = await stageProject({ plan, resolved, sourcePath: source, outDir: out });

  if (command === 'preview') {
    const { lint, snapshots } = await previewProject({ stageDir, resolved });
    console.log(lint.trim().split('\n').slice(-3).join('\n'));
    console.log(snapshots.trim());
    return;
  }

  if (!flags['skip-verify']) {
    console.log('verifying cut points (re-transcribing the cut audio)...');
    const check = await verifyCut({ stageDir, resolved, aligned, out });
    console.log(`  cut text similarity ${check.score}`);
    if (!check.ok) fail('cut audio does not match the expected text (a word may be clipped). Fix the anchors or use cut:"exact"; --skip-verify to ignore.', 1);
  }

  console.log('rendering (this takes a few minutes)...');
  const finalPath = await renderProject({
    stageDir,
    outDir: out,
    quality: typeof flags.quality === 'string' ? flags.quality : 'standard',
    loudnorm: !flags['no-loudnorm'],
  });
  console.log(`done: ${finalPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(2);
});
