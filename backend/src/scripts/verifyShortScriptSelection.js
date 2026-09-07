/**
 * SP-1 停止點的人工驗證工具（規格書 7.1）。
 *
 * 用途：對真實課程跑一次「自動選題 → 撈證據 → 鄰接擴展」，把結果印出來，
 * 讓人跟手寫腳本 V4／V5 的第 1 節證據表做比對。
 *
 * 這是**唯讀**工具：不建立 shortscripts、不寫 faqs／questions／usagelogs。
 * 檢索走 retrieveSegmentsOnly，本來就不寫入任何 collection。
 *
 * 用法：
 *   node src/scripts/verifyShortScriptSelection.js <courseId> [--window=1] [--json] [--dns=8.8.8.8]
 *
 * --dns 是本機環境的逃生門：部分家用路由器不回應 Node 的 SRV 查詢，
 * 導致 mongodb+srv:// 連線在 querySrv 階段就 ECONNREFUSED（但 PowerShell 的
 * Resolve-DnsName 查得到）。這個參數只影響本腳本，不改系統設定也不影響正式程式。
 *
 * 範例：
 *   node src/scripts/verifyShortScriptSelection.js 69fb4d4c069e21f4e65b74dc
 */
const dns = require('node:dns');
const mongoose = require('mongoose');
const { connectDatabase } = require('../config/database');
const env = require('../config/env');
const Course = require('../models/course.model');
const ShortScript = require('../models/shortScript.model');
const Faq = require('../models/faq.model');
const Question = require('../models/question.model');
// courseAccess.getCourseByIdOrThrow 會 populate('teacherId')，需要 User model 先註冊。
// 正式啟動時 server.js 會載入全部 model，獨立腳本必須自己補上。
require('../models/user.model');
require('../models/enrollment.model');
require('../models/video.model');
const { listTopicCandidates } = require('../services/shortScriptTopic.service');
const { retrieveSegmentsOnly } = require('../services/qa.service');
const { expandMatchesWithNeighbours, buildEvidence } = require('../services/shortScript.service');

function parseArgs(argv) {
  const positional = argv.filter((item) => !item.startsWith('--'));
  const flags = argv.filter((item) => item.startsWith('--'));
  const windowFlag = flags.find((item) => item.startsWith('--window='));
  const dnsFlag = flags.find((item) => item.startsWith('--dns='));
  const thresholdsFlag = flags.find((item) => item.startsWith('--thresholds='));

  return {
    courseId: positional[0] || '',
    window: windowFlag ? Number(windowFlag.split('=')[1]) : undefined,
    asJson: flags.includes('--json'),
    dnsServers: dnsFlag ? dnsFlag.split('=')[1].split(',').filter(Boolean) : [],
    thresholds: thresholdsFlag
      ? thresholdsFlag.split('=')[1].split(',').map(Number).filter(Number.isFinite)
      : [],
  };
}

function formatSeconds(value) {
  if (!Number.isFinite(value)) return '?';
  return `${value.toFixed(2)}s`;
}

function truncate(text, limit = 70) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}…`;
}

// 候選為空時，分辨是「faqs 沒資料」還是「有資料但被門檻擋掉」。
// faqs 只收錄 runtime ready、非拒答、且不帶對話歷史的提問，
// 因此 LINE 多輪對話的提問不會進 faqs（規格書 P-05）。
async function printEmptyCandidateDiagnostics(course) {
  const [faqCount, questionCount] = await Promise.all([
    Faq.countDocuments({ courseId: course._id }),
    Question.countDocuments({ courseId: course._id }),
  ]);

  console.log('');
  console.log('【診斷：為什麼沒有候選】');
  console.log(`  faqs（候選來源）      ：${faqCount} 筆`);
  console.log(`  questions（提問紀錄）：${questionCount} 筆`);

  if (faqCount === 0 && questionCount > 0) {
    console.log('');
    console.log('  → 提問紀錄有資料，但 faqs 是空的。這是規格書 P-05 的已知缺口：');
    console.log('    faqs 只收錄 runtime ready、非拒答、且不帶對話歷史的提問，');
    console.log('    LINE 多輪對話的提問不會寫入；FAQ 快取也可能曾被手動清除。');
  }

  if (questionCount > 0) {
    const top = await Question.aggregate([
      { $match: { courseId: course._id } },
      { $group: { _id: '$question', count: { $sum: 1 }, sources: { $addToSet: '$source' } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    console.log('');
    console.log('  questions 裡最常出現的問句（未分群，僅字串完全相同才合併）：');
    top.forEach((item, index) => {
      console.log(`    ${index + 1}. [${item.count} 次] ${truncate(item._id, 50)}  來源: ${item.sources.join(',')}`);
    });
  }
}

// P-01 校準用：同一批資料在不同門檻下分成幾群、各群併了哪些問法。
// 目的是找出「同義寫法會合併，但不同問題不會被併」的門檻。
async function printThresholdComparison({ user, courseId, thresholds }) {
  console.log('');
  console.log('【門檻比較（P-01 校準）】');

  for (const threshold of thresholds) {
    const { candidates, totalClusters } = await listTopicCandidates({
      user,
      courseId,
      similarityThreshold: threshold,
      limit: 50,
    });

    console.log('');
    console.log(`  ── 門檻 ${threshold}：分成 ${totalClusters} 群，${candidates.length} 個候選 ──`);
    candidates.forEach((candidate, index) => {
      console.log(`    ${index + 1}. [${candidate.totalAskCount} 次] ${truncate(candidate.question, 40)}`);
      if (candidate.variants.length > 1) {
        candidate.variants.slice(1).forEach((variant) => {
          console.log(`         ＋併入 [${variant.askCount} 次] ${truncate(variant.question, 40)}`);
        });
      }
    });
  }
}

async function run() {
  const { courseId, window, asJson, dnsServers, thresholds } = parseArgs(process.argv.slice(2));

  if (dnsServers.length) {
    dns.setServers(dnsServers);
    console.error(`（已指定 DNS 伺服器：${dnsServers.join(', ')}）`);
  }

  if (!courseId) {
    console.error('用法：node src/scripts/verifyShortScriptSelection.js <courseId> [--window=1] [--json] [--dns=8.8.8.8] [--thresholds=0.80,0.85,0.90,0.95]');
    process.exitCode = 1;
    return;
  }

  await connectDatabase();

  const course = await Course.findById(courseId).lean();
  if (!course) {
    console.error(`找不到課程 ${courseId}`);
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  // 以課程 owner 的身分執行，讓權限檢查照常運作（不繞過）。
  const user = { id: String(course.teacherId), role: 'teacher' };

  const existing = await ShortScript.find({ courseId: course._id }).lean();
  const excludedTopicKeys = existing.map((script) => script.topicKey).filter(Boolean);

  const { candidates, totalClusters, similarityThreshold } = await listTopicCandidates({
    user,
    courseId,
    excludedTopicKeys,
  });

  const output = {
    course: { id: String(course._id), title: course.title },
    settings: {
      similarityThreshold,
      minHitCount: env.shortScriptTopicMinHitCount,
      candidateLimit: env.shortScriptTopicCandidateLimit,
      expandWindow: Number.isFinite(window) ? window : env.shortScriptEvidenceExpandWindow,
      matchLimitForScript: env.shortScriptMatchLimit,
      minEvidenceItems: env.shortScriptEvidenceMinItems,
      maxEvidenceItems: env.shortScriptEvidenceMaxItems,
      vectorSearchMode: env.qaVectorSearchMode,
      queryEmbeddingProvider: env.qaQueryEmbeddingProvider,
      matchLimit: env.qaMatchLimit,
    },
    totalClusters,
    excludedTopicKeyCount: excludedTopicKeys.length,
    candidates,
    selected: null,
    evidence: [],
  };

  if (candidates.length) {
    const selected = candidates[0];
    // 必須跟 createScriptWithFrozenEvidence 用同一個命中上限，否則驗證結果與實際流程不符。
    const retrieval = await retrieveSegmentsOnly({
      user,
      courseId,
      question: selected.question,
      limit: env.shortScriptMatchLimit,
    });
    const expanded = await expandMatchesWithNeighbours(retrieval.matches, { window });

    output.selected = selected;
    output.directMatchCount = retrieval.matches.length;
    output.evidence = buildEvidence(expanded);
  }

  if (asJson) {
    console.log(JSON.stringify(output, null, 2));
    await mongoose.disconnect();
    return;
  }

  console.log('');
  console.log(`課程：${output.course.title}（${output.course.id}）`);
  console.log(`設定：分群門檻 ${similarityThreshold ?? '停用'}｜最低熱度 ${output.settings.minHitCount}`
    + `｜擴展窗口 ${output.settings.expandWindow}｜證據下限 ${output.settings.minEvidenceItems}`);
  console.log(`檢索：${output.settings.vectorSearchMode} / ${output.settings.queryEmbeddingProvider}`
    + `｜QA_MATCH_LIMIT ${output.settings.matchLimit}`
    + `｜腳本命中上限 ${output.settings.matchLimitForScript}`);
  console.log(`分群結果：共 ${totalClusters} 群，已排除 ${excludedTopicKeys.length} 個既有主題`);

  if (thresholds.length) {
    await printThresholdComparison({ user, courseId, thresholds });
  }

  console.log('');
  console.log('【候選主題】');
  if (!candidates.length) {
    console.log('  （無候選通過過濾，實際執行時會回 SHORT_SCRIPT_NO_CANDIDATE）');
    await printEmptyCandidateDiagnostics(course);
  }
  candidates.forEach((candidate, index) => {
    console.log(`  ${index + 1}. ${candidate.question}`);
    console.log(`     熱度 ${candidate.totalAskCount}｜合併 ${candidate.variants.length} 種問法`);
    candidate.variants.forEach((variant) => {
      console.log(`       - ${variant.question}（${variant.askCount} 次）`);
    });
  });

  if (output.selected) {
    console.log('');
    console.log(`【選中主題】${output.selected.question}`);
    console.log(`  直接命中 ${output.directMatchCount} 筆，鄰接擴展後 ${output.evidence.length} 筆`);
    console.log('');
    console.log('【證據片段】');
    console.log('  代號  chunkId          時間              來源      逐字稿');
    output.evidence.forEach((item) => {
      const range = `${formatSeconds(item.startSec)}-${formatSeconds(item.endSec)}`.padEnd(17);
      const origin = item.expandedFrom ? '擴展' : '命中';
      console.log(`  ${item.code.padEnd(4)}  ${String(item.chunkId).padEnd(15)}  ${range} ${origin}      ${truncate(item.rawText)}`);
    });

    if (output.evidence.length < env.shortScriptEvidenceMinItems) {
      console.log('');
      console.log(`  ⚠ 證據 ${output.evidence.length} 筆低於下限 ${env.shortScriptEvidenceMinItems}，`
        + '實際執行時會回 SHORT_SCRIPT_EVIDENCE_EMPTY');
    }
  }

  console.log('');
  console.log('請與手寫腳本第 1 節的證據表對照：系統撈的是否包含手寫版採用的核心片段。');
  console.log('');

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error('驗證失敗：', error.message);
  if (error.code) console.error('錯誤碼：', error.code);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
