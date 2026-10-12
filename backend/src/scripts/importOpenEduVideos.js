const dns = require('node:dns');
const fs = require('node:fs');
const { MongoClient } = require('mongodb');
const env = require('../config/env');
const { parseCsv } = require('./importStudents');

// 匯入國家教育研究院愛學網教學影片清單（data.gov.tw 資料集 6318）到 open_edu_videos。
// 預設 dry-run；--apply 才寫入，並以 NO 欄位 upsert，重複執行不會產生重複資料。
// 只寫 open_edu_videos，不碰 videos / video_segments_*。
//
// 用法：
//   npm run db:import-open-edu-videos -- --file stvlist.csv
//   npm run db:import-open-edu-videos -- --file stvlist.csv --apply --expected-count <dry-run 的 validCount>

const COLLECTION = 'open_edu_videos';
const SOURCE_NAME = '國家教育研究院愛學網';
const HEADER_ALIASES = {
  sourceNo: ['no'],
  title: ['標題'],
  description: ['描述說明'],
  keywords: ['關鍵字'],
  learningField: ['學習領域'],
  learningStage: ['學習階段'],
  videoUrl: ['影片網址'],
};
const REQUIRED_COLUMNS = ['sourceNo', 'title', 'videoUrl'];

function parseArgs(argv) {
  const args = { file: '', apply: false, expectedCount: null };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--apply') {
      args.apply = true;
    } else if (token === '--file') {
      args.file = String(argv[index + 1] || '').trim();
      index += 1;
    } else if (token === '--expected-count') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error('--expected-count must be a non-negative integer.');
      }
      args.expectedCount = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.file) throw new Error('--file <stvlist.csv> is required.');
  if (args.apply && args.expectedCount === null) {
    throw new Error('--apply requires --expected-count from a fresh dry-run.');
  }
  return args;
}

function resolveColumns(headerRow) {
  const normalized = headerRow.map((cell) => cell.trim().toLowerCase());
  const columns = {};

  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const position = normalized.findIndex((cell) => aliases.includes(cell));
    if (position === -1 && REQUIRED_COLUMNS.includes(key)) {
      throw new Error(`CSV header must include ${aliases.join(' / ')}.`);
    }
    columns[key] = position;
  }
  return columns;
}

function splitKeywords(value) {
  return [...new Set(
    String(value || '')
      .split(/[、,，;；\n]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

// 愛學網的「學習階段」是十二年國教課綱的第一至第五學習階段代碼，多值以換行連接。
// 直接顯示「五」學生看不懂，匯入時轉成對應學制。
const LEARNING_STAGE_LABELS = {
  一: '國小低年級',
  二: '國小中年級',
  三: '國小高年級',
  四: '國中',
  五: '高中',
};

function splitMultiValue(value) {
  return [...new Set(
    String(value || '')
      .split(/[\r\n]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}

function normalizeLearningField(value) {
  return splitMultiValue(value).join('、');
}

function normalizeLearningStage(value) {
  return splitMultiValue(value)
    .map((item) => LEARNING_STAGE_LABELS[item] || item)
    .join('、');
}

function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function buildImportPlan(rows) {
  if (!rows.length) throw new Error('CSV is empty.');

  const columns = resolveColumns(rows[0]);
  const cell = (cells, key) => (columns[key] === -1 ? '' : String(cells[columns[key]] || '').trim());
  const valid = [];
  const invalid = [];
  const seen = new Set();

  rows.slice(1).forEach((cells, offset) => {
    const line = offset + 2;
    const sourceNo = cell(cells, 'sourceNo');
    const title = cell(cells, 'title');
    const videoUrl = cell(cells, 'videoUrl');

    if (!sourceNo) return invalid.push({ line, reason: 'NO is empty' });
    if (!title) return invalid.push({ line, reason: 'title is empty' });
    // 只收 http(s) 連結：這個網址會直接顯示成學生可點的連結。
    if (!isHttpUrl(videoUrl)) return invalid.push({ line, reason: 'video url is not http(s)' });
    if (seen.has(sourceNo)) return invalid.push({ line, reason: 'duplicate NO in CSV' });
    seen.add(sourceNo);

    valid.push({
      sourceNo,
      title,
      description: cell(cells, 'description'),
      keywords: splitKeywords(cell(cells, 'keywords')),
      learningField: normalizeLearningField(cell(cells, 'learningField')),
      learningStage: normalizeLearningStage(cell(cells, 'learningStage')),
      videoUrl,
    });
    return undefined;
  });

  return { valid, invalid };
}

async function applyImport(db, plan, { expectedCount, now = new Date() }) {
  if (plan.valid.length !== expectedCount) {
    throw new Error(
      `Valid count changed: expected ${expectedCount}, found ${plan.valid.length}. Run dry-run again.`,
    );
  }
  if (!plan.valid.length) return { upserted: 0, modified: 0 };

  const result = await db.collection(COLLECTION).bulkWrite(plan.valid.map((item) => ({
    updateOne: {
      filter: { sourceNo: item.sourceNo },
      update: {
        $set: { ...item, source: SOURCE_NAME, importedAt: now, updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      upsert: true,
    },
  })), { ordered: false });

  // sourceNo unique index：Mongoose 在 server 啟動時會 autoIndex，script 自己補一次以免匯入先於 server。
  await db.collection(COLLECTION).createIndex({ sourceNo: 1 }, { unique: true });

  return { upserted: result.upsertedCount || 0, modified: result.modifiedCount || 0 };
}

async function main() {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
  const args = parseArgs(process.argv.slice(2));
  const text = fs.readFileSync(args.file, 'utf8');
  if (text.includes('�')) {
    throw new Error('CSV is not valid UTF-8. Re-save it as UTF-8 and retry.');
  }
  const plan = buildImportPlan(parseCsv(text));

  const client = new MongoClient(env.mongodbUri, {
    connectTimeoutMS: 15000,
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 1,
  });

  try {
    await client.connect();
    const db = client.db();
    const result = args.apply ? await applyImport(db, plan, { expectedCount: args.expectedCount }) : null;

    console.log(JSON.stringify({
      database: db.databaseName,
      collection: COLLECTION,
      mode: args.apply ? 'apply' : 'dry-run',
      validCount: plan.valid.length,
      invalidCount: plan.invalid.length,
      invalid: plan.invalid.slice(0, 20),
      sample: plan.valid.slice(0, 3).map(({ title, keywords, learningField, learningStage }) => (
        { title, keywords, learningField, learningStage }
      )),
      result,
    }, null, 2));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('importOpenEduVideos failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  applyImport,
  buildImportPlan,
  normalizeLearningField,
  normalizeLearningStage,
  parseArgs,
  splitKeywords,
};
