#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  validatePlan, resolvePlan,
} = require('../src/plan');
const { alignClips } = require('../src/align/align');
const { stageProject, renderProject } = require('../src/render/render');
const { ensureFontLoaded } = require('../src/render/browser');
const {
  readJson, writeJson,
} = require('../src/util');

const USAGE = `short-render — recut plan validator and renderer

Usage:
  short-render validate <plan.json> --evidence <evidence.json> [--resolved <resolved.json>]
  short-render align    <plan.json> --evidence <evidence.json> --source <video> --out <dir> [--model small]
  short-render preview  <plan.json> --evidence <evidence.json> --source <video> --out <dir>
  short-render render   <plan.json> --evidence <source-with-sentences.json> --source <video> --out <dir>
                        --browser <existing-chrome-headless-shell> [--quality draft|standard|high]

sentence-v1 uses frozen source.sentences; align means deterministic resolution, no ASR.
preview stages a local preview.html; render uses the same animation with fixed gain.
Legacy fixtures support validate/align only.
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
  const sentences = evidence.sentences;

  if (plan.contractVersion === 'sentence-v1') {
    const { resolved, errors } = resolvePlan(plan, { sentences });
    if (errors.length) { printIssues('ERROR', errors); process.exitCode = 1; return; }
    exitIfInvalid(validatePlan(plan, { sentences, evidence, resolved }));
    if (command === 'validate') { console.log('sentence-v1 plan and timing are valid.'); return; }
    if (!['align', 'preview', 'render'].includes(command)) fail('unknown command');
    const out = path.resolve(require_(flags, 'out'));
    writeJson(path.join(out, 'resolved.json'), resolved);
    if (command === 'align') return;
    const sourcePath = path.resolve(require_(flags, 'source'));
    if (!fs.existsSync(sourcePath)) fail('source video not found');
    if (command === 'render') require_(flags, 'browser');
    const stageDir = await stageProject({ plan, resolved, sentences, evidence, sourcePath, outDir: out });
    if (command === 'preview') { console.log(path.join(stageDir, 'preview.html')); return; }
    const finalPath = await renderProject({ plan, resolved, stageDir, outDir: out,
      quality: typeof flags.quality === 'string' ? flags.quality : 'standard',
      ensureFontLoaded: ({ stageDir: staged }) => ensureFontLoaded({ stageDir: staged, browserExecutable: flags.browser }),
    });
    console.log(finalPath); return;
  }

  if (command === 'validate') {
    const resolved = flags.resolved ? readJson(flags.resolved) : null;
    const result = validatePlan(plan, { evidence, resolved });
    exitIfInvalid(result);
    console.log(`plan is valid${resolved ? ' (including resolved timing)' : ' (timing not checked; pass --resolved)'}.`);
    return;
  }
  if (command !== 'align') fail('legacy prototype supports validate/align only; build a sentence-v1 plan for preview/render');

  // 對齊前先做不需要時間的檢查，省掉明知會失敗的 ASR。
  exitIfInvalid(validatePlan(plan, { evidence }));

  if (!['align', 'preview', 'render'].includes(command)) fail(`unknown command "${command}"\n\n${USAGE}`);

  const { resolved, out } = await alignAndResolve(plan, evidence, flags);
  exitIfInvalid(validatePlan(plan, { evidence, resolved }));
  console.log(`aligned: speech ${resolved.speechTotal}s, total ${resolved.total}s -> ${path.join(out, 'resolved.json')}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(2);
});
