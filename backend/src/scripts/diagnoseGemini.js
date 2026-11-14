#!/usr/bin/env node
'use strict';

// 診斷 Gemini 為什麼呼叫失敗。預設只查模型資訊（不產生內容、不計費）；加 --probe 才送一次輸出上限 8 token 的極小生成請求。
// 用法：
//   node src/scripts/diagnoseGemini.js [--key-env GEMINI_API_KEY] [--model gemini-3.5-flash] [--probe] [--json]
// 不印出金鑰、請求內容或錯誤原文，只印 HTTP 狀態、錯誤分類、配額名稱與處理建議。

require('dotenv').config({ path: require('node:path').join(__dirname, '..', '..', '.env') });
const { classifyGeminiResponse, GUIDANCE } = require('../services/geminiDiagnostics.service');

const API = 'https://generativelanguage.googleapis.com/v1beta';

function parseArgs(argv) {
  const args = { keyEnv: 'GEMINI_API_KEY', model: process.env.RECUT_GEMINI_MODEL || process.env.GEMINI_CHAT_MODEL || 'gemini-3.5-flash', probe: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--probe') args.probe = true;
    else if (flag === '--json') args.json = true;
    else if (flag === '--key-env') args.keyEnv = argv[++i];
    else if (flag === '--model') args.model = argv[++i];
    else if (flag === '--help' || flag === '-h') args.help = true;
    else throw new Error(`Unknown option: ${flag}`);
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(args.keyEnv || '')) throw new Error('--key-env must be an environment variable name.');
  if (!/^[\w.-]+$/.test(args.model || '')) throw new Error('--model must be a plain model id.');
  return args;
}

async function request(url, options, fetchImpl) {
  try {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(30000) });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    return classifyGeminiResponse({ httpStatus: response.status, body });
  } catch {
    return classifyGeminiResponse({ networkError: true });
  }
}

async function diagnose({ apiKey, model, probe, fetchImpl = global.fetch }) {
  if (!apiKey) return { model: { category: 'KEY_MISSING', httpStatus: null, quotaIds: [], retryDelay: null, guidance: GUIDANCE.KEY_MISSING } };
  const headers = { 'x-goog-api-key': apiKey };
  const result = { model: await request(`${API}/models/${encodeURIComponent(model)}`, { headers }, fetchImpl) };
  if (probe) {
    result.generate = await request(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'OK' }] }], generationConfig: { maxOutputTokens: 8 } }),
    }, fetchImpl);
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('node src/scripts/diagnoseGemini.js [--key-env NAME] [--model MODEL] [--probe] [--json]');
    return;
  }
  const result = await diagnose({ apiKey: process.env[args.keyEnv], model: args.model, probe: args.probe });
  if (args.json) { console.log(JSON.stringify({ model: args.model, keyEnv: args.keyEnv, ...result }, null, 2)); return; }
  console.log(`模型：${args.model}（金鑰變數 ${args.keyEnv}）`);
  for (const [step, outcome] of Object.entries(result)) {
    const label = step === 'model' ? '查詢模型資訊（不計費）' : '極小生成請求';
    console.log(`\n${label}：${outcome.category}${outcome.httpStatus ? `（HTTP ${outcome.httpStatus}）` : ''}`);
    if (outcome.quotaIds?.length) console.log(`  配額：${outcome.quotaIds.join(', ')}`);
    if (outcome.retryDelay) console.log(`  建議等待：${outcome.retryDelay}`);
    console.log(`  ${outcome.guidance}`);
  }
  if (!args.probe && result.model.category === 'OK') console.log('\n模型資訊可讀不代表生成會成功（花費上限只在生成時才擋）；要確認請加 --probe（約 10 個 token）。');
  const failed = Object.values(result).some((outcome) => outcome.category !== 'OK');
  process.exitCode = failed ? 1 : 0;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 2; });
module.exports = { parseArgs, diagnose };
