/**
 * 補齊 `questions.questionEmbedding`（規格書 DR-14 / 附錄 B.4）。
 *
 * 背景：短影片自動選題以 `questions` 為候選來源，需要向量才能做同義題分群。
 * 該欄位是 2026-09-04 才加的，此前的紀錄沒有向量，只能做「文字完全相同」的合併，
 * 合併不到同一題的不同寫法。
 *
 * 成本控制：
 *   - 只對**去重後的問句**各算一次，不是每筆紀錄都算。
 *   - 已有向量的紀錄一律跳過，重跑安全（idempotent）。
 *   - 只處理可能成為候選的提問：排除 no_match、runtime 降級、以及「答不出來」的回答。
 *     這三類就算補了向量也永遠不會被選中，算了是白花錢。
 *
 * 用法（預設 dry-run，不寫入）：
 *   node src/scripts/backfillQuestionEmbeddings.js [--course=<courseId>] [--limit=50] [--dns=8.8.8.8]
 *   node src/scripts/backfillQuestionEmbeddings.js --course=<courseId> --write
 */
const dns = require('node:dns');
const mongoose = require('mongoose');
const { connectDatabase } = require('../config/database');
const env = require('../config/env');
const Question = require('../models/question.model');
const { embedQuery } = require('../services/queryEmbedding.service');
const { isNoAnswerReply } = require('../services/answerGeneration.service');
const { QUESTION_STATUSES } = require('../constants/enums');
const { normalizeQuestionText } = require('../services/shortScriptTopic.service');

function parseArgs(argv) {
  const flags = argv.filter((item) => item.startsWith('--'));
  const valueOf = (name) => {
    const found = flags.find((item) => item.startsWith(`${name}=`));
    return found ? found.split('=').slice(1).join('=') : null;
  };

  return {
    courseId: valueOf('--course'),
    limit: Number(valueOf('--limit')) || 0,
    dnsServers: (valueOf('--dns') || '').split(',').filter(Boolean),
    write: flags.includes('--write'),
  };
}

// 與 shortScriptTopic.service 的候選過濾一致：這三類提問永遠不會成為候選，
// 補向量沒有意義。判斷條件若日後改動，兩邊必須同步。
function isWorthEmbedding(question) {
  if (question.status === QUESTION_STATUSES.NO_MATCH) return false;
  if (question?.runtime?.degraded === true) return false;
  if (isNoAnswerReply(question.answer)) return false;
  return Boolean(String(question.question || '').trim());
}

async function main() {
  const { courseId, limit, dnsServers, write } = parseArgs(process.argv.slice(2));

  if (dnsServers.length) {
    dns.setServers(dnsServers);
    console.error(`（已指定 DNS 伺服器：${dnsServers.join(', ')}）`);
  }

  await connectDatabase();

  const filter = {};
  if (courseId) {
    filter.courseId = new mongoose.Types.ObjectId(courseId);
  }

  const questions = await Question.find(filter)
    .select('courseId question answer status runtime questionEmbedding')
    .lean();

  // 已有向量的問句不需要再算，但它們的「同一問句」其他紀錄仍要補上。
  const embeddedKeys = new Set();
  const pending = new Map();

  for (const question of questions) {
    if (!isWorthEmbedding(question)) {
      continue;
    }

    const key = `${String(question.courseId)}::${normalizeQuestionText(question.question)}`;
    if (!key.endsWith('::')) {
      if (Array.isArray(question.questionEmbedding) && question.questionEmbedding.length) {
        embeddedKeys.add(key);
        continue;
      }
      if (!pending.has(key)) {
        pending.set(key, {
          courseId: question.courseId,
          question: String(question.question).trim(),
          // 同一個正規化 key 底下可能有多種原始寫法（差空格、大小寫、標點）。
          // 更新時必須用 _id 清單，不能用單一原始字串比對，否則只會更新其中一種寫法，
          // 其餘紀錄留在「沒有向量」的狀態，之後分群會被迫自成一群。
          docIds: [],
        });
      }
      pending.get(key).docIds.push(question._id);
    }
  }

  // 已有向量的問句直接跳過整組
  for (const key of embeddedKeys) {
    pending.delete(key);
  }

  const targets = [...pending.entries()];
  const capped = limit > 0 ? targets.slice(0, limit) : targets;

  console.log('');
  console.log(`掃描 questions：${questions.length} 筆`);
  console.log(`可成為候選且缺向量的去重問句：${targets.length} 句`
    + `（涵蓋 ${targets.reduce((sum, [, item]) => sum + item.docIds.length, 0)} 筆紀錄）`);
  console.log(`已有向量的問句：${embeddedKeys.size} 句`);
  console.log(`本次將呼叫 embedding：${capped.length} 次`
    + `（provider=${env.qaQueryEmbeddingProvider}${limit > 0 ? `，--limit=${limit}` : ''}）`);

  if (!capped.length) {
    console.log('');
    console.log('沒有需要補的問句。');
    return;
  }

  if (!write) {
    console.log('');
    console.log('前 10 句預覽：');
    capped.slice(0, 10).forEach(([, item], index) => {
      console.log(`  ${index + 1}. [${item.docIds.length} 筆] ${item.question}`);
    });
    console.log('');
    console.log('這是 dry-run，沒有寫入任何資料。確認無誤後加 --write 實際執行。');
    return;
  }

  let embedded = 0;
  let updatedDocs = 0;
  const failures = [];

  for (const [, item] of capped) {
    try {
      const vector = await embedQuery(item.question);

      if (!Array.isArray(vector) || !vector.length) {
        failures.push({ question: item.question, reason: 'empty vector' });
        continue;
      }

      // 只補沒有向量的紀錄，不覆蓋既有值。
      // 以 _id 清單更新，涵蓋同一正規化 key 底下的所有原始寫法。
      const result = await Question.updateMany(
        { _id: { $in: item.docIds } },
        { $set: { questionEmbedding: vector } },
      );

      embedded += 1;
      updatedDocs += result.modifiedCount ?? result.nModified ?? 0;
    } catch (error) {
      failures.push({ question: item.question, reason: error.message });
    }
  }

  console.log('');
  console.log(JSON.stringify({ embedded, updatedDocs, failed: failures.length }, null, 2));

  if (failures.length) {
    console.log('');
    console.log('失敗項目：');
    failures.forEach((failure) => {
      console.log(`  - ${failure.question}：${failure.reason}`);
    });
  }
}

main()
  .catch((error) => {
    console.error('backfillQuestionEmbeddings failed:', error.message);
    if (error.code) console.error('錯誤碼：', error.code);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
