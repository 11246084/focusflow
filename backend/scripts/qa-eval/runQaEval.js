// 依 question-bank.json 逐題呼叫 QA API，輸出可直接貼進評分表的執行結果。
//
// 用法（PowerShell，於 backend/ 下）：
//   $env:QA_EVAL_EMAIL="student@focusflow.local"
//   $env:QA_EVAL_PASSWORD="Student123!"
//   node scripts/qa-eval/runQaEval.js
//
// 選用環境變數：
//   QA_EVAL_BASE_URL   預設 http://localhost:4000
//   QA_EVAL_BANK       題庫 JSON 路徑，預設 ../../docs/qa-eval/question-bank.json
//   QA_EVAL_OUT        輸出資料夾，預設 ../../docs/qa-eval/runs/<timestamp>
//   QA_EVAL_ROLE       登入角色，預設 student（login 契約要求 email+password+role）
//   QA_EVAL_DELAY_MS   每題間隔毫秒，預設 1200（避免打爆 provider rate limit）
//   QA_EVAL_ONLY       只跑指定題號，逗號分隔，例如 F01,M03,N05
//
// 重要：測試前請先關閉 FAQ 快取（FAQ_CACHE_ENABLED=false）並清空該課程 FAQ，
// 否則相似題會直接命中快取，量到的不是模型表現。腳本會在 faqCache 命中時警告。

const fs = require('fs');
const path = require('path');

const BASE_URL = (process.env.QA_EVAL_BASE_URL || 'http://localhost:4000').replace(/\/+$/, '');
const BANK_PATH = process.env.QA_EVAL_BANK
  || path.join(__dirname, '..', '..', '..', 'docs', 'qa-eval', 'question-bank.json');
const DELAY_MS = Number(process.env.QA_EVAL_DELAY_MS || 1200);
const ONLY = (process.env.QA_EVAL_ONLY || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

async function login() {
  const email = process.env.QA_EVAL_EMAIL;
  const password = process.env.QA_EVAL_PASSWORD;
  // /auth/login 的契約是 email + password + role 三者皆必填，缺 role 會回 VALIDATION_ERROR。
  const role = process.env.QA_EVAL_ROLE || 'student';

  if (!email || !password) {
    throw new Error('請設定 QA_EVAL_EMAIL 與 QA_EVAL_PASSWORD 環境變數。');
  }

  const response = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ email, password, role }),
  });

  const payload = await response.json();

  if (!response.ok || !payload?.data?.token) {
    throw new Error(`登入失敗 (${response.status}): ${JSON.stringify(payload)}`);
  }

  return payload.data.token;
}

async function ask(token, courseId, question) {
  const startedAt = Date.now();

  const response = await fetch(`${BASE_URL}/api/v1/qa/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ courseId, question }),
  });

  const elapsedSec = Number(((Date.now() - startedAt) / 1000).toFixed(2));
  const payload = await response.json().catch(() => ({}));

  return { ok: response.ok, status: response.status, payload, elapsedSec };
}

// 從回應中抽出評分表需要的欄位。
function summarize(result) {
  const { payload, elapsedSec, ok, status } = result;

  if (!ok) {
    return {
      answer: `【API 錯誤 ${status}】${payload?.error?.code || ''} ${payload?.message || ''}`.trim(),
      citedVideos: '',
      citedTimes: '',
      systemRefused: '',
      matchStatus: 'HTTP_ERROR',
      matchCount: '',
      topScore: '',
      faqCacheHit: '',
      elapsedSec,
      raw: payload,
    };
  }

  const data = payload.data || {};
  const matches = Array.isArray(data.matches) ? data.matches : [];
  const citations = Array.isArray(data.citations) ? data.citations : [];
  const runtime = data.runtime || {};
  const answerStatus = data.answerStatus || {};

  // 系統是否拒答：以 answerStatus 與罐頭字串雙重判斷。
  const answerText = String(data.answer || '');
  const cannedRefusal = /目前資料庫片段不足以回答這個問題|無法從提供的影片片段判斷|目前找不到足夠相關的影片片段/;
  const refused = answerStatus.status === 'no_answer' || cannedRefusal.test(answerText);

  const source = citations.length ? citations : matches;

  return {
    answer: answerText,
    citedVideos: [...new Set(source.map((c) => c.video?.title || c.videoTitle).filter(Boolean))].join(' | '),
    citedTimes: source
      .slice(0, 5)
      .map((c) => {
        const start = c.timestamp?.startSec ?? c.startSec;
        const end = c.timestamp?.endSec ?? c.endSec;
        return start === undefined ? '' : `${Math.round(start)}-${Math.round(end)}s`;
      })
      .filter(Boolean)
      .join(' | '),
    systemRefused: refused ? 'Y' : 'N',
    matchStatus: runtime.matchStatus || answerStatus.matchStatus || '',
    matchCount: matches.length,
    topScore: matches[0]?.score ?? '',
    faqCacheHit: runtime.faqCache?.hit ? 'Y' : 'N',
    answerProviderUsed: runtime.answerProviderUsed || '',
    elapsedSec,
    raw: data,
  };
}

async function main() {
  const bank = JSON.parse(fs.readFileSync(BANK_PATH, 'utf8'));
  const questions = ONLY.length
    ? bank.questions.filter((q) => ONLY.includes(q.id))
    : bank.questions;

  if (!questions.length) {
    throw new Error('題庫為空，或 QA_EVAL_ONLY 沒有比對到任何題號。');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = process.env.QA_EVAL_OUT
    || path.join(__dirname, '..', '..', '..', 'docs', 'qa-eval', 'runs', stamp);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Base URL     : ${BASE_URL}`);
  console.log(`Course       : ${bank.courseTitle} (${bank.courseId})`);
  console.log(`Questions    : ${questions.length}`);
  console.log(`Output       : ${outDir}\n`);

  const token = await login();
  const rows = [];
  let cacheHits = 0;
  let errors = 0;

  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];
    process.stdout.write(`[${i + 1}/${questions.length}] ${q.id} ${q.question.slice(0, 28)}… `);

    let summary;
    try {
      summary = summarize(await ask(token, bank.courseId, q.question));
    } catch (err) {
      errors += 1;
      summary = {
        answer: `【呼叫失敗】${err.message}`,
        citedVideos: '', citedTimes: '', systemRefused: '', matchStatus: 'REQUEST_FAILED',
        matchCount: '', topScore: '', faqCacheHit: '', elapsedSec: '', raw: null,
      };
    }

    if (summary.matchStatus === 'HTTP_ERROR' || summary.matchStatus === 'REQUEST_FAILED') {
      errors += 1;
    }
    if (summary.faqCacheHit === 'Y') {
      cacheHits += 1;
    }

    console.log(`${summary.matchStatus || '-'} / ${summary.matchCount} matches / ${summary.elapsedSec}s`
      + (summary.faqCacheHit === 'Y' ? '  ⚠ FAQ 快取命中' : ''));

    rows.push({ ...q, ...summary });

    if (i < questions.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(rows, null, 2), 'utf8');

  // 欄位順序刻意對齊評分表的 A~Q 欄，方便整段複製貼上。
  const header = [
    '題號', '題型', '難度', '問題', 'Gold 答案要點', '應命中影片', '應命中時間(秒)', '是否應拒答',
    '系統答案', '系統引用影片', '系統引用時間', '系統是否拒答',
    'matchStatus', 'matchCount', 'topScore', 'faqCache命中', '回應秒數',
  ];
  const lines = [header.map(csvCell).join(',')];

  for (const row of rows) {
    lines.push([
      row.id, row.type, row.difficulty, row.question, row.goldPoints,
      row.expectedVideos, row.expectedTimeRange, row.shouldRefuse ? 'Y' : 'N',
      row.answer, row.citedVideos, row.citedTimes, row.systemRefused,
      row.matchStatus, row.matchCount, row.topScore, row.faqCacheHit, row.elapsedSec,
    ].map(csvCell).join(','));
  }

  // BOM 讓 Excel 直接以 UTF-8 開啟，不會變亂碼。
  fs.writeFileSync(path.join(outDir, 'results.csv'), `﻿${lines.join('\r\n')}`, 'utf8');

  console.log(`\n完成：${rows.length} 題，錯誤 ${errors} 題，FAQ 快取命中 ${cacheHits} 題。`);
  if (cacheHits > 0) {
    console.log('⚠ 有題目命中 FAQ 快取，這些題量到的不是模型表現。'
      + '請設定 FAQ_CACHE_ENABLED=false 並呼叫 DELETE /api/v1/courses/'
      + `${bank.courseId}/faqs 後重跑。`);
  }
  console.log(`輸出：${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
