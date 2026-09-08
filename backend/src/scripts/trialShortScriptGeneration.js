/**
 * 真實 LLM 生成試跑（SP-2 之後的遺留事項）。
 *
 * 目的：到 SP-2 為止的生成測試全部是 mock，證明的是「機制正確」而非「生成有用」。
 * 這支腳本用真實證據呼叫一次 Gemini，看模型實際上會不會遵守 basedOn 契約。
 *
 * 這是**唯讀**工具：不建立 shortscripts、不寫任何 collection。
 * 只有一次對外的 LLM 呼叫，成本約數千 token。
 *
 * 用法：
 *   node src/scripts/trialShortScriptGeneration.js <courseId> [--rank=2] [--dns=8.8.8.8]
 */
const dns = require('node:dns');
const mongoose = require('mongoose');
const { connectDatabase } = require('../config/database');
const env = require('../config/env');
const Course = require('../models/course.model');
require('../models/user.model');
require('../models/enrollment.model');
require('../models/video.model');
const { listTopicCandidates } = require('../services/shortScriptTopic.service');
const { retrieveSegmentsOnly } = require('../services/qa.service');
const { expandMatchesWithNeighbours, buildEvidence } = require('../services/shortScript.service');
const { generateScript, validateCitations } = require('../services/shortScriptGeneration.service');

function parseArgs(argv) {
  const positional = argv.filter((item) => !item.startsWith('--'));
  const flags = argv.filter((item) => item.startsWith('--'));
  const valueOf = (name) => {
    const found = flags.find((item) => item.startsWith(`${name}=`));
    return found ? found.split('=').slice(1).join('=') : null;
  };

  return {
    courseId: positional[0] || '',
    rank: Math.max(1, Number(valueOf('--rank')) || 1),
    dnsServers: (valueOf('--dns') || '').split(',').filter(Boolean),
  };
}

function truncate(text, limit = 60) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}…`;
}

async function run() {
  const { courseId, rank, dnsServers } = parseArgs(process.argv.slice(2));

  if (dnsServers.length) {
    dns.setServers(dnsServers);
  }

  if (!courseId) {
    console.error('用法：node src/scripts/trialShortScriptGeneration.js <courseId> [--rank=2] [--dns=8.8.8.8]');
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

  const user = { id: String(course.teacherId), role: 'teacher' };
  const { candidates } = await listTopicCandidates({ user, courseId });

  if (!candidates.length) {
    console.error('沒有候選主題。');
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  const selected = candidates[Math.min(rank, candidates.length) - 1];
  const retrieval = await retrieveSegmentsOnly({
    user,
    courseId,
    question: selected.question,
    limit: env.shortScriptMatchLimit,
  });
  const evidence = buildEvidence(await expandMatchesWithNeighbours(retrieval.matches));

  console.log('');
  console.log(`課程：${course.title}`);
  console.log(`主題：${selected.question}（排名 ${rank}，${selected.uniqueAskerCount} 人 / ${selected.totalAskCount} 次）`);
  console.log(`證據：${evidence.length} 筆　模型：${env.geminiChatModel}`);
  console.log('');
  console.log('證據包：');
  evidence.forEach((item) => {
    console.log(`  [${item.code}] ${item.chunkId}  ${truncate(item.rawText, 50)}`);
  });

  console.log('');
  console.log('呼叫 Gemini 生成中…');

  const started = Date.now();
  let result;
  try {
    result = await generateScript({ topic: selected.question, evidence });
  } catch (error) {
    console.log('');
    console.log(`生成失敗：${error.code || error.name} — ${error.message}`);
    if (error.details?.errors) {
      console.log('驗證錯誤：');
      error.details.errors.forEach((message) => console.log(`  - ${message}`));
    }
    if (error.details?.rawOutput) {
      console.log('');
      console.log('最後一次原始輸出（前 800 字）：');
      console.log(error.details.rawOutput.slice(0, 800));
    }
    await mongoose.disconnect();
    process.exitCode = 1;
    return;
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const { payload, attempts } = result;

  console.log(`完成：${attempts} 次嘗試通過引用驗證，耗時 ${elapsed}s`);
  console.log('');
  console.log('【全域設定】');
  Object.entries(payload.globalSettings || {}).forEach(([key, value]) => {
    console.log(`  ${key}：${value}`);
  });

  console.log('');
  console.log('【視覺隱喻選項】');
  (payload.visualMetaphorOptions || []).forEach((option, index) => {
    console.log(`  ${index + 1}. ${option.label}`);
    console.log(`     S1 ${truncate(option.s1, 45)}`);
    console.log(`     S2 ${truncate(option.s2, 45)}`);
    console.log(`     S3 ${truncate(option.s3, 45)}`);
  });

  console.log('');
  console.log('【8 拍分鏡】');
  payload.shots.forEach((shot) => {
    const basis = shot.basedOn === 'template' ? 'template' : (shot.basedOn || []).join(',');
    console.log(`  鏡 ${String(shot.shotNo).padStart(2, '0')} [${shot.arcRole}] ${shot.timeRange || ''}`);
    console.log(`     口白：${shot.narration}`);
    console.log(`     字幕：${shot.subtitle}`);
    console.log(`     依據：${basis}`);
  });

  // 再驗一次，確認回傳的內容確實通過（生成流程內部已驗過，這裡是獨立複核）。
  const check = validateCitations(payload, evidence);
  console.log('');
  console.log(`獨立複核引用：${check.valid ? '全部合法' : `失敗 — ${check.errors.join('；')}`}`);
  console.log('');
  console.log('（本腳本未寫入任何 collection）');

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error('試跑失敗：', error.message);
  if (error.code) console.error('錯誤碼：', error.code);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
